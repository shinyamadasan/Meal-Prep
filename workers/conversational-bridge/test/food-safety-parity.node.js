// TASK-091: the Worker side of the food-safety parity check. The browser side is
// tests/food-safety-parity.spec.js; both evaluate tests/fixtures/food-safety-parity.json with
// the same evaluator, so passing both means the app and the Worker give identical verdicts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../../../tests/fixtures/food-safety-parity-eval.js';

const sharedBeforeWorkerLoad = globalThis.MealPrepFoodSafety;
// Load the Worker the way production does: the shared rules arrive only through its own imports.
await import('../src/index.js');
const FoodSafety = globalThis.MealPrepFoodSafety;
const fixture = JSON.parse(readFileSync(new URL('../../../tests/fixtures/food-safety-parity.json', import.meta.url), 'utf8'));
const { evaluateCase } = globalThis.FoodSafetyParity;

test('the Worker loads the shared food-safety rules by side-effect import', () => {
  assert.equal(sharedBeforeWorkerLoad, undefined);
  assert.ok(FoodSafety, 'globalThis.MealPrepFoodSafety is defined after importing the Worker');
  assert.ok(Object.isFrozen(FoodSafety));
  for (const name of ['categoryShelfLife', 'stockIngredientEntry', 'stockFoodClass', 'stockCalendarDay',
    'daysLeftFrom', 'pantryDaysLeft', 'pantryFridgeSafety', 'pantryDateSignal', 'pantryLotAvailable',
    'isStaple', 'cookedShelfLife', 'cookedDateSignal', 'defaultInferStorage']) {
    assert.equal(typeof FoodSafety[name], 'function', name);
  }
  assert.ok(FoodSafety.INGREDIENT_DB.length > 100);
  assert.equal(FoodSafety.COOKED_FRIDGE_LIMIT, 4);
  assert.equal(FoodSafety.FRESHNESS_WARN_DAYS, 2);
});

test('the parity fixture covers the required cases', () => {
  assert.ok(fixture.cases.length >= 40, `${fixture.cases.length} cases`);
  assert.deepEqual(fixture.todays, ['2026-11-26', '2026-12-31', '2028-02-29']);
  const classes = new Set(fixture.cases.flatMap((c) =>
    Object.values(c.expected).map((e) => e.fridge && e.fridge.safetyClass).filter(Boolean)));
  const ruleClasses = new Set(FoodSafety.FRIDGE_SAFETY_LIMITS.map((rule) => rule.safetyClass));
  assert.deepEqual([...classes].sort(), [...ruleClasses].sort());
});

for (const today of fixture.todays) {
  test(`Node verdicts match the fixture for today = ${today} (shared default storage path)`, () => {
    for (const testCase of fixture.cases) {
      const expected = (testCase.expectedDefault || testCase.expected)[today];
      assert.deepEqual(evaluateCase(FoodSafety, testCase, today), expected, testCase.id);
    }
  });
}

test('without a storage location the shared default verdict is unknown and never usable', () => {
  const unknown = fixture.cases.filter((c) => c.defaultStorageUnknown);
  assert.ok(unknown.length >= 3);
  for (const testCase of unknown) {
    for (const today of fixture.todays) {
      const result = evaluateCase(FoodSafety, testCase, today);
      assert.equal(result.signal.kind, 'unknown', testCase.id);
      assert.equal(result.signal.safety, 'unknown-storage', testCase.id);
      assert.equal(result.available, false, testCase.id);
    }
  }
});

test('shared functions never read the clock: a missing or malformed today throws', () => {
  const lot = { name: 'Chicken Breast', category: 'Protein', storage: 'fridge', purchaseDate: '2026-11-25' };
  for (const bad of [undefined, '', '2026-2-1', '2027-02-29', '2026-11-26T00:00:00Z', 20261126]) {
    assert.throws(() => FoodSafety.pantryDateSignal(lot, bad), TypeError, String(bad));
    assert.throws(() => FoodSafety.pantryLotAvailable(lot, bad), TypeError, String(bad));
    assert.throws(() => FoodSafety.daysLeftFrom('2026-11-25', 3, bad), TypeError, String(bad));
    assert.throws(() => FoodSafety.cookedDateSignal({ cookedDate: '2026-11-25' }, bad), TypeError, String(bad));
  }
  assert.equal(FoodSafety.pantryLotAvailable(lot, '2026-11-26'), true);
  assert.equal(FoodSafety.pantryLotAvailable(lot, '2026-11-28'), false);
});

test('a supplied inferStorage hook is used when the lot has no storage', () => {
  const lot = { name: 'chicken', category: 'Protein', purchaseDate: '2026-11-25' };
  assert.equal(FoodSafety.pantryDateSignal(lot, '2026-11-26').kind, 'unknown');
  const signal = FoodSafety.pantryDateSignal(lot, '2026-11-26', () => 'fridge');
  assert.equal(signal.safetyClass, 'poultry');
  assert.equal(signal.kind, 'use-soon');
  assert.equal(FoodSafety.defaultInferStorage('Chicken Breast'), 'fridge');
  assert.equal(FoodSafety.defaultInferStorage('chicken'), null);
});
