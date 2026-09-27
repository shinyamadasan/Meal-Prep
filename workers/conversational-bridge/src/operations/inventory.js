// Server-side equivalents of the pantry-mutating UI functions in app.js — reimplemented against
// decoded Firestore field values, never against the app's in-browser AppState. Every function
// here is pure: it takes the current `pantry` array + the `pantry` tombstone bucket and returns
// a NEW array/bucket plus the response item, so index.js can diff "did anything actually change"
// cleanly for the `unchanged:true` cases the contract requires.
//
// CLASSIFICATION (D-082 addendum, corrected after independent review): the bridge has no access
// to INGREDIENT_DB, so it cannot fully reproduce the client's isStaple(). It DOES reproduce the
// client's other, INGREDIENT_DB-free fallback: an explicit flag, else `category === 'pantry'`.
// That leaves one real gap — a record with no explicit `staple` and a category that ISN'T
// 'pantry' can still be a staple in the live app via an INGREDIENT_DB entry (confirmed in
// app.js's own seed data: e.g. 'Garlic (Bawang)' and 'Evaporated Milk' are `isStaple: true` with
// category 'Vegetable'/'Dairy', not 'Pantry' — and at least two active pantry-creation call sites
// store `staple: undefined` outright for an unmatched custom ingredient, so this isn't a rare
// legacy-data corner case). classifyStaple() returns 'ambiguous' for exactly that gap, and
// markOutOfStock() refuses to guess: guessing "non-staple" here risks tombstoning a record the
// real app would only have marked empty, which is real, unrecoverable(ish) data loss; guessing
// "staple" risks nothing (the record just survives with stockLevel stamped). See
// AmbiguousError / the reserved `ambiguous` contract code in errors.js.
import { NotFoundError, ValidationError, AmbiguousError } from '../errors.js';

const MAX_UNIT_LENGTH = 40;

function classifyStaple(p) {
  if (!p) return 'non-staple';
  if (p.staple === true) return 'staple';
  if (p.staple === false) return 'non-staple';
  const category = (p.category == null ? '' : String(p.category)).trim().toLowerCase();
  if (category === 'pantry') return 'staple';
  return 'ambiguous';
}

function isStapleRecord(p) {
  return classifyStaple(p) === 'staple';
}

function findPantryIndex(pantry, ingredientId) {
  return pantry.findIndex((p) => p && String(p.id) === String(ingredientId));
}

function toInventoryItem(p) {
  return {
    ingredientId: String(p.id),
    name: p.name != null ? p.name : null,
    quantity: p.quantity != null ? p.quantity : null,
    unit: p.unit != null ? p.unit : null,
    inStock: isStapleRecord(p) ? p.stockLevel !== 'empty' : true,
    staple: isStapleRecord(p),
    stockLevel: p.stockLevel != null ? p.stockLevel : null,
    storage: p.storage != null ? p.storage : null,
    updatedAt: p.updatedAt != null ? p.updatedAt : null
  };
}

export function listInventory(pantry) {
  return (pantry || []).map(toInventoryItem);
}

function validateQuantity(quantity) {
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity < 0) {
    throw new ValidationError('quantity must be a finite number >= 0.', { field: 'quantity' });
  }
}

function validateUnit(unit) {
  if (unit == null) return;
  if (typeof unit !== 'string' || !unit.trim() || unit.length > MAX_UNIT_LENGTH) {
    throw new ValidationError('unit must be a non-empty string of ' + MAX_UNIT_LENGTH + ' characters or fewer.', { field: 'unit' });
  }
}

// Absolute set on an existing record only — idempotent by construction (D-082 / TASK-065:
// repeating the same value under a fresh expectedRevision reproduces the same state; repeating
// under the SAME stale expectedRevision is rejected upstream as a revision conflict, not
// re-applied).
export function setQuantity(pantry, { ingredientId, quantity, unit }) {
  validateQuantity(quantity);
  validateUnit(unit);
  const index = findPantryIndex(pantry, ingredientId);
  if (index === -1) throw new NotFoundError('No pantry record with ingredientId "' + ingredientId + '".');

  const next = pantry.slice();
  const updated = Object.assign({}, next[index], { quantity, updatedAt: new Date().toISOString() });
  if (unit != null) updated.unit = unit;
  next[index] = updated;
  return { pantry: next, item: toInventoryItem(updated), unchanged: false };
}

// Mirrors correctKitchenStock(): staple -> stockLevel 'empty'; non-staple -> removed with an
// explicit tombstone (D-071) written here directly, since the bridge has no client-side
// recordLocalDeletions() diff pass to write it for us. Already-out / already-removed is a
// deterministic no-op success (chaos test #4), not an error.
export function markOutOfStock(pantry, deletionsPantry, { ingredientId }) {
  const index = findPantryIndex(pantry, ingredientId);

  if (index === -1) {
    if (deletionsPantry && deletionsPantry[String(ingredientId)]) {
      return { pantry, deletionsPantry, item: null, unchanged: true, removed: true };
    }
    throw new NotFoundError('No pantry record with ingredientId "' + ingredientId + '".');
  }

  const record = pantry[index];
  const classification = classifyStaple(record);

  if (classification === 'ambiguous') {
    throw new AmbiguousError(
      'ingredientId "' + ingredientId + '" has no explicit staple flag and a category that does not resolve it; ' +
      'the bridge cannot safely tell whether removing it or marking it empty is correct without INGREDIENT_DB. ' +
      'Set an explicit staple value on this record (in the app) before retrying.',
      { field: 'ingredientId', category: record.category != null ? record.category : null }
    );
  }

  if (classification === 'staple') {
    if (record.stockLevel === 'empty') {
      return { pantry, deletionsPantry, item: toInventoryItem(record), unchanged: true, removed: false };
    }
    const next = pantry.slice();
    const updated = Object.assign({}, record, { stockLevel: 'empty', updatedAt: new Date().toISOString() });
    next[index] = updated;
    return { pantry: next, deletionsPantry, item: toInventoryItem(updated), unchanged: false, removed: false };
  }

  const nextPantry = pantry.filter((_, i) => i !== index);
  const nextDeletions = Object.assign({}, deletionsPantry, { [String(ingredientId)]: new Date().toISOString() });
  return { pantry: nextPantry, deletionsPantry: nextDeletions, item: null, unchanged: false, removed: true };
}

// Staples only — non-staple presence already means "in stock", so targeting one is a validation
// error, not a silent no-op (TASK-065 is explicit about this).
export function markInStock(pantry, { ingredientId }) {
  const index = findPantryIndex(pantry, ingredientId);
  if (index === -1) throw new NotFoundError('No pantry record with ingredientId "' + ingredientId + '".');

  const record = pantry[index];
  if (!isStapleRecord(record)) {
    throw new ValidationError('ingredientId "' + ingredientId + '" is not a staple; its presence already means in stock.', { field: 'ingredientId' });
  }
  if (record.stockLevel === 'full') {
    return { pantry, item: toInventoryItem(record), unchanged: true };
  }
  const next = pantry.slice();
  const updated = Object.assign({}, record, { stockLevel: 'full', updatedAt: new Date().toISOString() });
  next[index] = updated;
  return { pantry: next, item: toInventoryItem(updated), unchanged: false };
}
