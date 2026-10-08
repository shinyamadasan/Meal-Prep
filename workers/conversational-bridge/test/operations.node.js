import test from 'node:test';
import assert from 'node:assert/strict';
import { listInventory, setQuantity, markOutOfStock, markInStock } from '../src/operations/inventory.js';
import { NotFoundError, ValidationError, InsufficientServingsError, AmbiguousError } from '../src/errors.js';
import { listReadyFood, recordCookedFood, consumePortions, finishCookedMeal } from '../src/operations/readyFood.js';

const COOKED_DATE = '2026-01-15';

// ── Inventory ────────────────────────────────────────────────────────────────

test('listInventory derives inStock and staple from stored data only, never a stored inStock field', () => {
  const items = listInventory([
    { id: '1', name: 'Milk', staple: false },
    { id: '2', name: 'Rice', staple: true, stockLevel: 'ok' },
    { id: '3', name: 'Salt', staple: true, stockLevel: 'empty' }
  ]);
  assert.equal(items[0].inStock, true); // non-staple present => in stock
  assert.equal(items[1].inStock, true); // staple, not empty
  assert.equal(items[2].inStock, false); // staple, empty
});

test('setQuantity is an absolute set on an existing record and rejects an unknown id', () => {
  const pantry = [{ id: '1', name: 'Rice', quantity: 1, staple: false }];
  const result = setQuantity(pantry, { ingredientId: '1', quantity: 5, unit: 'cups' });
  assert.equal(result.item.quantity, 5);
  assert.equal(result.item.unit, 'cups');
  assert.equal(pantry[0].quantity, 1, 'input array must not be mutated');

  assert.throws(() => setQuantity(pantry, { ingredientId: 'missing', quantity: 1 }), NotFoundError);
});

test('setQuantity rejects invalid quantity and unit values', () => {
  const pantry = [{ id: '1', name: 'Rice', staple: false }];
  assert.throws(() => setQuantity(pantry, { ingredientId: '1', quantity: -1 }), ValidationError);
  assert.throws(() => setQuantity(pantry, { ingredientId: '1', quantity: 'five' }), ValidationError);
  assert.throws(() => setQuantity(pantry, { ingredientId: '1', quantity: NaN }), ValidationError);
  assert.throws(() => setQuantity(pantry, { ingredientId: '1', quantity: 1, unit: '' }), ValidationError);
  assert.throws(() => setQuantity(pantry, { ingredientId: '1', quantity: 1, unit: 'x'.repeat(41) }), ValidationError);
});

test('setQuantity repeated with the same value under a fresh call is idempotent by construction', () => {
  const pantry = [{ id: '1', name: 'Rice', quantity: 1, staple: false }];
  const first = setQuantity(pantry, { ingredientId: '1', quantity: 5 });
  const second = setQuantity(first.pantry, { ingredientId: '1', quantity: 5 });
  assert.equal(second.item.quantity, 5);
});

test('markOutOfStock: staple goes empty, non-staple is removed with an explicit tombstone', () => {
  const pantry = [
    { id: 's1', name: 'Salt', staple: true, stockLevel: 'ok' },
    { id: 'n1', name: 'Milk', staple: false }
  ];
  const staple = markOutOfStock(pantry, {}, { ingredientId: 's1' });
  assert.equal(staple.item.stockLevel, 'empty');
  assert.equal(staple.unchanged, false);

  const nonStaple = markOutOfStock(pantry, {}, { ingredientId: 'n1' });
  assert.equal(nonStaple.pantry.find((p) => p.id === 'n1'), undefined);
  assert.ok(nonStaple.deletionsPantry.n1, 'removal must write an explicit tombstone (D-071)');
  assert.equal(nonStaple.removed, true);
});

test('markOutOfStock is a deterministic no-op on an already-out staple or already-removed record', () => {
  const pantry = [{ id: 's1', name: 'Salt', staple: true, stockLevel: 'empty' }];
  const alreadyEmpty = markOutOfStock(pantry, {}, { ingredientId: 's1' });
  assert.equal(alreadyEmpty.unchanged, true);

  const alreadyRemoved = markOutOfStock([], { n1: '2026-01-01T00:00:00.000Z' }, { ingredientId: 'n1' });
  assert.equal(alreadyRemoved.unchanged, true);
  assert.equal(alreadyRemoved.removed, true);
});

test('markOutOfStock rejects a truly unknown id (never existed, never tombstoned)', () => {
  assert.throws(() => markOutOfStock([], {}, { ingredientId: 'ghost' }), NotFoundError);
});

// Corrected per independent review: a record with no explicit `staple` flag can still be a
// staple through app.js's own category-only fallback (`category === 'pantry'`) — the bridge must
// match that, not silently treat every undecorated record as non-staple.
test('markOutOfStock treats an undecorated record with category "pantry" as a staple (retain + empty, no tombstone)', () => {
  const pantry = [{ id: 'p1', name: 'Rice', category: 'pantry', quantity: 2 }]; // staple field absent entirely
  const result = markOutOfStock(pantry, {}, { ingredientId: 'p1' });
  assert.equal(result.removed, false);
  assert.equal(result.pantry.find((p) => p.id === 'p1').stockLevel, 'empty');
  assert.deepEqual(result.deletionsPantry, {}, 'a category-fallback staple must never be tombstoned');
});

// The residual gap: no explicit flag AND a category that doesn't prove classification (real
// app.js seed data has `isStaple: true` entries with category 'Vegetable'/'Dairy'/'Protein' —
// e.g. Garlic, Evaporated Milk — so this is a genuine, common case, not a hypothetical). The
// bridge cannot safely guess without INGREDIENT_DB, so a destructive mark-out-of-stock must
// refuse rather than risk tombstoning a record that's actually a staple.
test('markOutOfStock refuses an ambiguous record (no explicit flag, non-"pantry" category) rather than guessing destructively', () => {
  const pantry = [{ id: 'g1', name: 'Garlic', category: 'Vegetable', quantity: 3 }];
  assert.throws(() => markOutOfStock(pantry, {}, { ingredientId: 'g1' }), AmbiguousError);
  // Confirm the refusal is a pure read: nothing was mutated or tombstoned by the failed attempt.
  const stillThere = pantry.find((p) => p.id === 'g1');
  assert.ok(stillThere);
  assert.equal(stillThere.stockLevel, undefined);
});

test('markOutOfStock still treats an ambiguous-shaped record as staple once explicitly flagged, even off-category', () => {
  const pantry = [{ id: 'g1', name: 'Garlic', category: 'Vegetable', quantity: 3, staple: true }];
  const result = markOutOfStock(pantry, {}, { ingredientId: 'g1' });
  assert.equal(result.pantry.find((p) => p.id === 'g1').stockLevel, 'empty');
});

test('markInStock only applies to staples and is a validation error on a non-staple', () => {
  const pantry = [
    { id: 's1', name: 'Salt', staple: true, stockLevel: 'empty' },
    { id: 'n1', name: 'Milk', staple: false }
  ];
  const result = markInStock(pantry, { ingredientId: 's1' });
  assert.equal(result.item.stockLevel, 'full');

  assert.throws(() => markInStock(pantry, { ingredientId: 'n1' }), ValidationError);
  assert.throws(() => markInStock(pantry, { ingredientId: 'ghost' }), NotFoundError);
});

test('duplicate display names cannot select pantry identity — lookup is by id only', () => {
  const pantry = [
    { id: 'a', name: 'Rice', quantity: 1, staple: false },
    { id: 'b', name: 'Rice', quantity: 2, staple: false }
  ];
  const result = setQuantity(pantry, { ingredientId: 'b', quantity: 9 });
  assert.equal(result.pantry.find((p) => p.id === 'a').quantity, 1);
  assert.equal(result.pantry.find((p) => p.id === 'b').quantity, 9);
});

// ── Ready food ───────────────────────────────────────────────────────────────

test('listReadyFood reports servingsRemaining null for an untracked batch', () => {
  const items = listReadyFood([
    { id: 'cm_1', name: 'Chili', portionsRemaining: 3 },
    { id: 'cm_2', name: 'Soup', portionsRemaining: null }
  ]);
  assert.equal(items[0].trackedPortions, true);
  assert.equal(items[1].trackedPortions, false);
  assert.equal(items[1].servingsRemaining, null);
});

test('recordCookedFood always creates a tracked batch shaped like _doMarkCooked()\'s output', () => {
  const result = recordCookedFood({ name: 'Chili', recipeId: '5', servings: 4, storage: 'fridge', cookedDate: COOKED_DATE });
  assert.equal(result.record.initialPortions, 4);
  assert.equal(result.record.portionsRemaining, 4);
  assert.match(result.record.id, /^cm_/);
  assert.equal(result.record.fridgeLife, null);
  assert.equal(result.record.cookedDate, COOKED_DATE);
});

test('recordCookedFood applies shared source freshness only when a canonical source is provided', () => {
  for (const source of ['leftovers', 'takeout']) {
    const result = recordCookedFood({ name: 'Pizza', recipeId: null, servings: 3, storage: 'fridge', cookedDate: COOKED_DATE, source });
    assert.equal(result.record.source, source);
    assert.equal(result.record.fridgeLife, globalThis.MealPrepReadyFoodContract.defaultFridgeLife);
    assert.equal(result.record.freezerLife, globalThis.MealPrepReadyFoodContract.defaultFreezerLife);
    assert.equal(result.record.recipeId, null);
  }

  assert.throws(() => recordCookedFood({ name: 'Food', servings: 1, storage: 'fridge', cookedDate: COOKED_DATE, source: 'unknown' }), ValidationError);
  assert.throws(() => recordCookedFood({ name: 'Food', servings: 1, storage: 'fridge', cookedDate: COOKED_DATE, source: null }), ValidationError);
});

test('recordCookedFood rejects invalid name, servings, and storage', () => {
  assert.throws(() => recordCookedFood({ name: '', servings: 1, storage: 'fridge', cookedDate: COOKED_DATE }), ValidationError);
  assert.throws(() => recordCookedFood({ name: 'Chili', servings: 0, storage: 'fridge', cookedDate: COOKED_DATE }), ValidationError);
  assert.throws(() => recordCookedFood({ name: 'Chili', servings: 1, storage: 'counter', cookedDate: COOKED_DATE }), ValidationError);
});

test('recordCookedFood rejects fractional, non-number, and out-of-range servings without coercion', () => {
  for (const servings of [1.5, 0.5, 0, -1, 100, NaN, Infinity, '2', null]) {
    assert.throws(
      () => recordCookedFood({ name: 'Chili', servings, storage: 'fridge', cookedDate: COOKED_DATE }),
      ValidationError,
      String(servings)
    );
  }
  for (const servings of [1, 2, 3]) {
    const result = recordCookedFood({ name: 'Chili', servings, storage: 'fridge', cookedDate: COOKED_DATE });
    assert.equal(result.record.initialPortions, servings);
    assert.equal(result.record.portionsRemaining, servings);
  }
});

// Corrected per independent review: cookedDate is now a REQUIRED, caller-supplied local calendar
// date (matching app.js's todayISO(), which is device-local) — the Worker never derives "today"
// itself, since a stateless server has no caller-timezone concept to borrow.
test('recordCookedFood requires an explicit, exact, real cookedDate — never a silent UTC fallback', () => {
  assert.throws(() => recordCookedFood({ name: 'Chili', servings: 1, storage: 'fridge' }), ValidationError, 'missing cookedDate');
  assert.throws(() => recordCookedFood({ name: 'Chili', servings: 1, storage: 'fridge', cookedDate: '2026/01/15' }), ValidationError, 'wrong shape');
  assert.throws(() => recordCookedFood({ name: 'Chili', servings: 1, storage: 'fridge', cookedDate: 'yesterday' }), ValidationError, 'free-form text');
  assert.throws(() => recordCookedFood({ name: 'Chili', servings: 1, storage: 'fridge', cookedDate: '2026-02-30' }), ValidationError, 'impossible calendar date');
  assert.throws(() => recordCookedFood({ name: 'Chili', servings: 1, storage: 'fridge', cookedDate: '2026-13-01' }), ValidationError, 'invalid month');

  // A caller resolving "yesterday" for a user near local midnight can legitimately supply a date
  // that differs from the Worker's own UTC "today" — that must be honored exactly, not corrected.
  const result = recordCookedFood({ name: 'Chili', servings: 1, storage: 'fridge', cookedDate: '2026-01-01' });
  assert.equal(result.record.cookedDate, '2026-01-01');
});

test('consumePortions decrements, rejects over-consumption, and removes on exact remainder with a tombstone', () => {
  const meals = [{ id: 'cm_1', name: 'Chili', portionsRemaining: 3, initialPortions: 3 }];

  const over = () => consumePortions(meals, {}, { cookedMealId: 'cm_1', servings: 5 });
  assert.throws(over, InsufficientServingsError);
  try { over(); } catch (e) { assert.equal(e.detail.remaining, 3); }

  const partial = consumePortions(meals, {}, { cookedMealId: 'cm_1', servings: 1 });
  assert.equal(partial.item.servingsRemaining, 2);
  assert.equal(partial.removed, false);

  const exact = consumePortions(meals, {}, { cookedMealId: 'cm_1', servings: 3 });
  assert.equal(exact.removed, true);
  assert.equal(exact.item, null);
  assert.ok(exact.deletionsCookedMeals.cm_1, 'exact-remainder consume must write an explicit tombstone');
});

test('consumePortions rejects an untracked batch and an unknown id', () => {
  const untracked = [{ id: 'cm_1', name: 'Soup', portionsRemaining: null }];
  assert.throws(() => consumePortions(untracked, {}, { cookedMealId: 'cm_1', servings: 1 }), ValidationError);
  assert.throws(() => consumePortions([], {}, { cookedMealId: 'ghost', servings: 1 }), NotFoundError);
});

test('finishCookedMeal removes the record regardless of servings remaining, with a tombstone', () => {
  const meals = [{ id: 'cm_1', name: 'Chili', portionsRemaining: 3 }];
  const result = finishCookedMeal(meals, {}, { cookedMealId: 'cm_1' });
  assert.equal(result.cookedMeals.length, 0);
  assert.ok(result.deletionsCookedMeals.cm_1);
  assert.throws(() => finishCookedMeal([], {}, { cookedMealId: 'ghost' }), NotFoundError);
});
