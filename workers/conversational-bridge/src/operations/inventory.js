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
import { InsufficientStockError, NotFoundError, ValidationError, AmbiguousError } from '../errors.js';
import { convertQuantity } from './quantity.js';
// Shared food-safety rules (TASK-091, D-090): defines globalThis.MealPrepFoodSafety, the same rules
// the app uses. Only the get_inventory safety verdict reads it (TASK-092); the write operations
// below still use the bridge's own classification described above.
import '../../../../shared/foodSafety.js';

const FoodSafety = globalThis.MealPrepFoodSafety;

const MAX_UNIT_LENGTH = 40;
const MAX_STOCK_QUANTITY = Number.MAX_SAFE_INTEGER;
const MILLISECONDS_PER_DAY = 86400000;
const UTC_LOCAL_DATE_SKEW_DAYS = 1;
const DEFAULT_CATEGORY_SHELF_LIFE_DAYS = 7;

const CATEGORY_SHELF_LIFE_DAYS = Object.freeze({
  protein: 3,
  vegetable: 7,
  fruit: 5,
  dairy: 7,
  grain: 180,
  pantry: 365
});

function classifyStaple(p) {
  if (!p) return 'non-staple';
  if (p.staple === true) return 'staple';
  if (p.staple === false) return 'non-staple';
  // Same text as before for every value String() can convert (write tools unchanged); a stored
  // map whose toString cannot convert reads as no category instead of throwing.
  let text = '';
  try { text = p.category == null ? '' : String(p.category); } catch { text = ''; }
  const category = text.trim().toLowerCase();
  if (category === 'pantry') return 'staple';
  return 'ambiguous';
}

function isStapleRecord(p) {
  return classifyStaple(p) === 'staple';
}

function findPantryIndex(pantry, ingredientId) {
  // Same safe id rule as the reads (readableId): a stored id that is not text or a finite number
  // (a map, array, boolean) can never match and is never passed to String(), which can throw.
  return pantry.findIndex((p) => p && readableId(p.id) && String(p.id) === String(ingredientId));
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

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// A real YYYY-MM-DD calendar day by the shared calendar rule (no rollover: 2026-02-30 is not one).
export function isCalendarDay(value) {
  return typeof value === 'string' && DATE_ONLY.test(value) && FoodSafety.stockCalendarDay(value) != null;
}

export function requireHouseholdDay(today) {
  if (!isCalendarDay(today)) {
    throw new TypeError('A YYYY-MM-DD household day is required for safety verdicts.');
  }
  return today;
}

function textOrNull(value) {
  return typeof value === 'string' ? value : null;
}

export function useSoonLabel(daysLeft) {
  return daysLeft === 0 ? 'Use today' : 'Use soon - ' + daysLeft + 'd left';
}

// Chat's safety verdict for one pantry lot (TASK-092, D-091), computed ONLY from the shared rules
// on the household day, with the shared default storage path (no PANTRY_KNOWLEDGE): a lot with no
// storage that INGREDIENT_DB cannot place is `unknown`. `usable` is the app's pantryLotAvailable()
// verdict, except that an `expired` or `unknown` lot is never usable (stricter than the app for a
// staple past its printed use-by, TASK-091 finding F2). Labels reuse the app's own wording.
export function pantrySafety(p, today) {
  requireHouseholdDay(today);
  let signal;
  let available;
  let fridge;
  try {
    signal = FoodSafety.pantryDateSignal(p, today);
    available = FoodSafety.pantryLotAvailable(p, today);
    fridge = FoodSafety.pantryFridgeSafety(p, today);
  } catch {
    // A record the shared rules cannot read is unknown, never usable; it must not hide the rest.
    return { status: 'unknown', reason: 'unreadable-record', label: 'Record could not be checked - check it in the app before use', daysLeft: null, usable: false };
  }
  // An absurd stored shelf life (1e20, +/-Infinity, NaN) gives a day count the schema cannot carry
  // or that would read as "no date"; that lot alone is unknown, never ok and never a failed read.
  if (signal.daysLeft != null && !Number.isSafeInteger(signal.daysLeft)) {
    return { status: 'unknown', reason: 'unreadable-record', label: 'Record could not be checked - check it in the app before use', daysLeft: null, usable: false };
  }
  let daysLeft = signal.daysLeft == null ? null : signal.daysLeft;
  let kind = signal.kind;
  // Within a fridge safety limit the app shows the shelf-life estimate, which can outlast the
  // limit (raw chicken: 3-day protein estimate, 2-day poultry limit). Chat gets the sooner day, so
  // "days left" never runs past the safety limit; this can only make the answer stricter.
  if (kind !== 'expired' && kind !== 'unknown' && fridge && Number.isFinite(fridge.daysLeft) &&
      (daysLeft == null || fridge.daysLeft < daysLeft)) {
    daysLeft = fridge.daysLeft;
    if (kind == null && daysLeft <= FoodSafety.FRESHNESS_WARN_DAYS) kind = 'use-soon';
  }
  // The app's Fridge list shows any lot past its shelf-life estimate (no printed date) as
  // "Estimated window passed" in check styling, wherever it is stored (counter, freezer,
  // non-perishables). Chat must not call it in-date. Availability is unchanged (quality only).
  if (kind == null && daysLeft != null && daysLeft < 0 && !signal.printed) kind = 'check';
  let status;
  let reason;
  let label;
  if (kind === 'unknown') {
    status = 'unknown';
    reason = 'unknown-storage';
    label = 'Storage location not recorded - set it in the app before use';
  } else if (kind === 'expired') {
    status = 'expired';
    if (signal.safety === 'unknown-date') {
      reason = 'no-bought-date';
      label = 'No bought date - add it before use';
    } else if (signal.safety === 'past-limit') {
      reason = 'past-safety-limit';
      label = 'Past safe fridge time - do not use (' + signal.safetyClass + ', ' + signal.limitDays + '-day limit)';
    } else {
      reason = 'printed-date-passed';
      label = 'Use-by date passed' + (daysLeft != null ? ' ' + Math.abs(daysLeft) + 'd ago' : '') + ' - do not use';
    }
  } else if (kind === 'check') {
    status = 'check';
    reason = signal.bestBefore ? 'best-before-passed' : 'estimate-passed';
    label = signal.bestBefore ? 'Best before passed — check it' : 'Estimated window passed — check it';
  } else if (kind === 'use-soon') {
    status = 'use-soon';
    reason = 'use-soon';
    label = useSoonLabel(daysLeft);
  } else {
    status = 'ok';
    reason = daysLeft == null ? 'no-date' : 'in-date';
    label = daysLeft == null ? 'No date recorded' : daysLeft + 'd left';
  }
  const usable = available === true && status !== 'expired' && status !== 'unknown';
  if (!usable && status === 'check') {
    // Past its estimate AND out of stock: keep the app's warning wording, add the stock state.
    label = label + ' (out of stock)';
  } else if (!usable && status !== 'expired' && status !== 'unknown') {
    // The date allows it; the app's availability rule does not (empty staple, no quantity left).
    reason = 'out-of-stock';
    label = 'Out of stock';
  }
  return { status, reason, label, daysLeft, usable };
}

// get_inventory's item (TASK-092): the existing read item plus the stored date/category fields
// (null when absent or not a string) and the safety verdict. Write results keep toInventoryItem().
//
// One stored lot the read schema cannot carry (non-text name/unit/storage/updatedAt, a quantity
// that is not a finite number, a stockLevel outside full/ok/low/empty) must not fail the whole
// read (re-review must-fix 2): that lot alone is unknown / invalid-record and not usable, with
// schema-safe fields. A null or non-object entry is not a record and is skipped. Write results
// keep toInventoryItem() unchanged.
const READ_STOCK_LEVELS = ['full', 'ok', 'low', 'empty'];

function textOrNullField(value) {
  return value == null || typeof value === 'string';
}

// An id is read only when it is text or a finite number (String() on a stored map can throw).
export function readableId(value) {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

// The app keeps only object records with an id (unionById); chat sees the same set.
export function isStoredRecord(entry) {
  return entry != null && typeof entry === 'object' && !Array.isArray(entry) && entry.id != null;
}

function readableLot(p) {
  return readableId(p.id) && textOrNullField(p.name) && textOrNullField(p.unit) && textOrNullField(p.storage) &&
    textOrNullField(p.updatedAt) &&
    (p.quantity == null || (typeof p.quantity === 'number' && Number.isFinite(p.quantity))) &&
    (p.stockLevel == null || READ_STOCK_LEVELS.includes(p.stockLevel));
}

export function listInventoryWithSafety(pantry, today) {
  requireHouseholdDay(today);
  return (pantry || []).filter(isStoredRecord).map((p, index) => {
    const dates = {
      category: textOrNull(p.category),
      purchaseDate: textOrNull(p.purchaseDate),
      expiryDate: textOrNull(p.expiryDate),
      dateMode: textOrNull(p.dateMode),
      printedDateKind: textOrNull(p.printedDateKind)
    };
    if (readableLot(p)) return Object.assign(toInventoryItem(p), dates, { safety: pantrySafety(p, today) });
    return Object.assign({
      // An unreadable id gets a placeholder no write tool will match.
      ingredientId: readableId(p.id) ? String(p.id) : 'unreadable-id-' + index,
      name: textOrNull(p.name),
      quantity: typeof p.quantity === 'number' && Number.isFinite(p.quantity) ? p.quantity : null,
      unit: textOrNull(p.unit),
      inStock: false,
      staple: isStapleRecord(p),
      stockLevel: READ_STOCK_LEVELS.includes(p.stockLevel) ? p.stockLevel : null,
      storage: textOrNull(p.storage),
      updatedAt: textOrNull(p.updatedAt)
    }, dates, {
      safety: { status: 'unknown', reason: 'invalid-record', label: 'Record could not be read - check it in the app before use', daysLeft: null, usable: false }
    });
  });
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

function decimalFromNumber(quantity) {
  const [mantissa, exponentText] = quantity.toString().toLowerCase().split('e');
  const exponent = exponentText == null ? 0 : Number(exponentText);
  const [whole, fraction = ''] = mantissa.split('.');
  const negative = whole.startsWith('-');
  const digits = (whole.replace('-', '') + fraction).replace(/^0+/, '') || '0';
  let coefficient = BigInt(digits) * (negative ? -1n : 1n);
  let scale = fraction.length - exponent;
  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale);
    scale = 0;
  }
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  return { coefficient, scale };
}

function convertedDecimal(quantity, expectedUnit, storedUnit) {
  const decimal = decimalFromNumber(quantity);
  if ((expectedUnit === 'kg' && storedUnit === 'g') || (expectedUnit === 'L' && storedUnit === 'ml')) {
    decimal.coefficient *= 1000n;
  } else if ((expectedUnit === 'g' && storedUnit === 'kg') || (expectedUnit === 'ml' && storedUnit === 'L')) {
    decimal.scale += 3;
  }
  while (decimal.scale > 0 && decimal.coefficient % 10n === 0n) {
    decimal.coefficient /= 10n;
    decimal.scale -= 1;
  }
  return decimal;
}

function addDecimals(left, right) {
  const scale = Math.max(left.scale, right.scale);
  const sum = {
    coefficient: left.coefficient * 10n ** BigInt(scale - left.scale) + right.coefficient * 10n ** BigInt(scale - right.scale),
    scale
  };
  while (sum.scale > 0 && sum.coefficient % 10n === 0n) {
    sum.coefficient /= 10n;
    sum.scale -= 1;
  }
  return sum;
}

function decimalToString(decimal) {
  const negative = decimal.coefficient < 0n;
  const digits = String(negative ? -decimal.coefficient : decimal.coefficient);
  const value = decimal.scale === 0
    ? digits
    : digits.padStart(decimal.scale + 1, '0').slice(0, -decimal.scale) + '.' + digits.padStart(decimal.scale + 1, '0').slice(-decimal.scale);
  return negative ? '-' + value : value;
}

function sameDecimal(left, right) {
  return left.coefficient === right.coefficient && left.scale === right.scale;
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

// Conversational (MCP) narrowing of setQuantity(): an absolute count for an EXISTING, non-staple
// row, in the row's EXISTING unit. It adds only the guards the chat surface needs and then
// delegates to the unchanged setQuantity() — no `unit` is passed, so the stored unit can never be
// relabelled (500 g -> 500 kg). Zero is refused here, not translated: "none left" is
// markOutOfStock(). Staples are modelled by stockLevel, not by a count, so they are refused; an
// unclassifiable row is refused for the same reason markOutOfStock() refuses it.
export function setCountedQuantity(pantry, { ingredientId, quantity, expectedUnit }) {
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
    throw new ValidationError('quantity must be a finite number > 0. For none left, use mark_out_of_stock.', { field: 'quantity' });
  }
  const index = findPantryIndex(pantry, ingredientId);
  if (index === -1) throw new NotFoundError('No pantry record with ingredientId "' + ingredientId + '".');

  const classification = classifyStaple(pantry[index]);
  if (classification === 'staple') {
    throw new ValidationError('ingredientId "' + ingredientId + '" is a staple tracked by stock level, not by count; use mark_in_stock or mark_out_of_stock.', { field: 'ingredientId' });
  }
  if (classification === 'ambiguous') {
    throw new AmbiguousError(
      'ingredientId "' + ingredientId + '" has no explicit staple flag and a category that does not resolve it; ' +
      'the bridge cannot safely tell whether it is counted or stock-level tracked. ' +
      'Set an explicit staple value on this record (in the app) before retrying.',
      { field: 'ingredientId', category: pantry[index].category != null ? pantry[index].category : null }
    );
  }
  // expectedUnit is an immutable PRECONDITION: exact equality with the stored unit, no trimming,
  // case folding or conversion (g != kg, ml != L, pieces != cans). It is never forwarded, so it
  // cannot relabel the row or be persisted.
  const storedUnit = pantry[index].unit;
  if (typeof storedUnit !== 'string' || !storedUnit.trim()) {
    throw new ValidationError('unit_mismatch: ingredientId "' + ingredientId + '" has no stored unit, so a count cannot be set safely. Re-read get_inventory and clarify with the user.', { field: 'expectedUnit' });
  }
  if (typeof expectedUnit !== 'string' || expectedUnit !== storedUnit) {
    throw new ValidationError('unit_mismatch: the stored unit for ingredientId "' + ingredientId + '" is "' + storedUnit + '", not the asserted unit. Re-read get_inventory and state the quantity in the stored unit, or clarify with the user.', { field: 'expectedUnit', storedUnit });
  }
  return setQuantity(pantry, { ingredientId, quantity });
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

// Apply a conversational delta to an existing, counted non-staple row. Exact-zero paths use
// markOutOfStock() so they retain the canonical removal/tombstone or staple-empty behavior.
export function consumeStock(pantry, deletionsPantry, { ingredientId, quantity, expectedUnit }) {
  if (typeof ingredientId !== 'string' || !ingredientId.trim()) {
    throw new ValidationError('ingredientId must be a non-blank string.', { field: 'ingredientId' });
  }
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
    throw new ValidationError('quantity must be a finite number > 0.', { field: 'quantity' });
  }
  if (typeof expectedUnit !== 'string' || !expectedUnit.trim()) {
    throw new ValidationError('expectedUnit must be a non-blank string.', { field: 'expectedUnit' });
  }

  const index = findPantryIndex(pantry, ingredientId);
  if (index === -1) throw new NotFoundError('No pantry record with ingredientId "' + ingredientId + '".');

  const record = pantry[index];
  const classification = classifyStaple(record);
  if (classification === 'ambiguous') {
    throw new AmbiguousError(
      'ingredientId "' + ingredientId + '" has no explicit staple flag and a category that does not resolve it; ' +
      'set an explicit staple value in the app before retrying.',
      { field: 'ingredientId', category: record.category != null ? record.category : null }
    );
  }

  if (typeof record.quantity !== 'number' || !Number.isFinite(record.quantity) || record.quantity < 0) {
    throw new ValidationError('The stored quantity is missing or invalid; re-read inventory and clarify before consuming.', { field: 'quantity' });
  }
  const storedUnit = record.unit;
  if (typeof storedUnit !== 'string' || !storedUnit.trim()) {
    throw new ValidationError('The stored unit is missing; re-read inventory and clarify before consuming.', { field: 'expectedUnit' });
  }
  const amount = convertQuantity(quantity, expectedUnit, storedUnit);
  if (amount > record.quantity || (classification === 'staple' && record.stockLevel === 'empty')) {
    throw new InsufficientStockError(classification === 'staple' && record.stockLevel === 'empty' ? 0 : record.quantity);
  }

  if (classification === 'staple') {
    if (amount !== record.quantity) {
      throw new ValidationError(
        'Staple quantities are stock-level tracked; only an exact depletion can mark the staple empty. Partial staple consumption is unsupported.',
        { field: 'quantity' }
      );
    }
    return Object.assign(markOutOfStock(pantry, deletionsPantry, { ingredientId }), { unchanged: false });
  }

  if (amount === record.quantity) {
    return markOutOfStock(pantry, deletionsPantry, { ingredientId });
  }

  const next = pantry.slice();
  const updated = Object.assign({}, record, {
    quantity: record.quantity - amount,
    updatedAt: new Date().toISOString()
  });
  next[index] = updated;
  return {
    pantry: next,
    deletionsPantry,
    item: toInventoryItem(updated),
    unchanged: false,
    removed: false
  };
}

function dateStringToUtcDay(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError('The stored ' + field + ' is malformed; clarify freshness in the app before adding stock.', { field });
  }
  const timestamp = Date.parse(value + 'T00:00:00.000Z');
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new ValidationError('The stored ' + field + ' is malformed; clarify freshness in the app before adding stock.', { field });
  }
  return Math.floor(timestamp / MILLISECONDS_PER_DAY);
}

function validateMergeFreshness(record) {
  if (record.dateMode === 'expiry') {
    throw new ValidationError('This item has a printed expiry date and cannot be merged safely; use the app to record the new purchase separately.', { field: 'dateMode' });
  }
  if (record.purchaseDate == null) return;

  const purchaseDay = dateStringToUtcDay(record.purchaseDate, 'purchaseDate');
  let shelfLifeDays = record.shelfLifeDays;
  if (shelfLifeDays == null) {
    if (record.category != null && typeof record.category !== 'string') {
      throw new ValidationError('The stored category is malformed; clarify freshness in the app before adding stock.', { field: 'category' });
    }
    const category = (record.category || '').trim().toLowerCase();
    shelfLifeDays = Object.hasOwn(CATEGORY_SHELF_LIFE_DAYS, category)
      ? CATEGORY_SHELF_LIFE_DAYS[category]
      : DEFAULT_CATEGORY_SHELF_LIFE_DAYS;
  }
  if (typeof shelfLifeDays !== 'number' || !Number.isFinite(shelfLifeDays) || !Number.isInteger(shelfLifeDays) || shelfLifeDays < 0) {
    throw new ValidationError('The stored shelf life is malformed; clarify freshness in the app before adding stock.', { field: 'shelfLifeDays' });
  }

  const expiryDay = purchaseDay + shelfLifeDays;
  const utcToday = Math.floor(Date.now() / MILLISECONDS_PER_DAY);
  // The app uses the browser-local calendar day; this Worker has no stored caller timezone.
  // A local date can be one day behind or ahead of UTC, so decide only outside that window.
  if (expiryDay < utcToday - UTC_LOCAL_DATE_SKEW_DAYS) {
    throw new ValidationError('This item is already expired and cannot be merged; use the app to record the new purchase separately.', { field: 'purchaseDate' });
  }
  if (expiryDay <= utcToday) {
    throw new ValidationError('Freshness is near a UTC/local date boundary; re-check the item in the app before adding stock.', { field: 'purchaseDate' });
  }
}

// Apply a conversational purchase delta to an existing row only. Preserve the old lot's
// freshness/storage metadata; reject printed-expiry rows, unsafe dates, and resurrection.
export function addStock(pantry, deletionsPantry, { ingredientId, quantity, expectedUnit }) {
  if (typeof ingredientId !== 'string' || !ingredientId.trim()) {
    throw new ValidationError('ingredientId must be a non-blank string.', { field: 'ingredientId' });
  }
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
    throw new ValidationError('quantity must be a finite number > 0.', { field: 'quantity' });
  }
  if (typeof expectedUnit !== 'string' || !expectedUnit.trim()) {
    throw new ValidationError('expectedUnit must be a non-blank string.', { field: 'expectedUnit' });
  }

  const id = String(ingredientId);
  const index = findPantryIndex(pantry, ingredientId);
  if (index === -1 || (deletionsPantry && Object.hasOwn(deletionsPantry, id))) {
    throw new NotFoundError('No active pantry record with ingredientId "' + ingredientId + '"; add or restore it in the app first.');
  }

  const record = pantry[index];
  const classification = classifyStaple(record);
  if (classification === 'ambiguous') {
    throw new AmbiguousError(
      'ingredientId "' + ingredientId + '" has no explicit staple flag and a category that does not resolve it; ' +
      'set an explicit staple value in the app before adding stock.',
      { field: 'ingredientId', category: record.category != null ? record.category : null }
    );
  }
  if (classification === 'staple' && (typeof record.quantity !== 'number' || !Number.isFinite(record.quantity))) {
    throw new ValidationError('This staple has no counted quantity; use mark_in_stock instead.', { field: 'quantity' });
  }
  if (typeof record.quantity !== 'number' || !Number.isFinite(record.quantity) || record.quantity < 0) {
    throw new ValidationError('The stored quantity is missing or invalid; clarify the amount in the app before adding stock.', { field: 'quantity' });
  }
  if (typeof record.unit !== 'string' || !record.unit.trim()) {
    throw new ValidationError('The stored unit is missing; re-read inventory and clarify before adding stock.', { field: 'expectedUnit' });
  }
  if (classification === 'non-staple') validateMergeFreshness(record);
  const amount = convertQuantity(quantity, expectedUnit, record.unit);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ValidationError('The resulting stock quantity is outside the safely representable range.', { field: 'quantity' });
  }
  const intendedTotal = addDecimals(decimalFromNumber(record.quantity), convertedDecimal(quantity, expectedUnit, record.unit));
  const exactTotal = Number(decimalToString(intendedTotal));
  if (!Number.isFinite(exactTotal) || exactTotal > MAX_STOCK_QUANTITY) {
    throw new ValidationError('The resulting stock quantity is outside the safely representable range.', { field: 'quantity' });
  }
  if (exactTotal <= record.quantity || !sameDecimal(decimalFromNumber(exactTotal), intendedTotal)) {
    throw new ValidationError('The requested increment cannot be represented without losing quantity.', { field: 'quantity' });
  }

  const next = pantry.slice();
  const updated = Object.assign({}, record, {
    quantity: exactTotal,
    updatedAt: new Date().toISOString()
  });
  if (classification === 'staple') {
    updated.stockLevel = 'full';
    delete updated.suggestDismissed;
  }
  next[index] = updated;
  return { pantry: next, item: toInventoryItem(updated), unchanged: false };
}
