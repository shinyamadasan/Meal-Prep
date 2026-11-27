// TASK-092: the Worker side of the ready-food parity check. The browser side is
// tests/ready-food-parity.spec.js; both evaluate tests/fixtures/ready-food-parity.json with the
// same evaluator, so passing both means the app and the Worker give identical ready-food verdicts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import '../../../tests/fixtures/food-safety-parity-eval.js';

await import('../src/index.js');
const FoodSafety = globalThis.MealPrepFoodSafety;
const fixture = JSON.parse(readFileSync(new URL('../../../tests/fixtures/ready-food-parity.json', import.meta.url), 'utf8'));
const { evaluateCase } = globalThis.FoodSafetyParity;

test('the shared module exposes the moved portion and availability rules', () => {
  for (const name of ['portionCountOrNull', 'cookedMealTracksPortions', 'cookedMealAvailable']) {
    assert.equal(typeof FoodSafety[name], 'function', name);
  }
  assert.equal(FoodSafety.PORTION_COUNT_MAX, 99);
  assert.throws(() => FoodSafety.cookedMealAvailable({ name: 'Adobo', cookedDate: '2026-11-25' }), TypeError);
});

test('the ready-food fixture covers portions, shelf life, storage and malformed records', () => {
  assert.ok(fixture.cases.length >= 25, `${fixture.cases.length} cases`);
  assert.deepEqual(fixture.todays, ['2026-11-26', '2026-12-31', '2028-02-29']);
  const verdicts = fixture.cases.flatMap((c) => Object.values(c.expected));
  assert.ok(verdicts.some((v) => v.available) && verdicts.some((v) => !v.available));
  for (const kind of ['expired', 'check', 'use-soon', null]) {
    assert.ok(verdicts.some((v) => v.signal.kind === kind), String(kind));
  }
});

for (const today of fixture.todays) {
  test(`Node ready-food verdicts match the app's for today = ${today}`, () => {
    for (const testCase of fixture.cases) {
      assert.deepEqual(evaluateCase(FoodSafety, testCase, today), testCase.expected[today], testCase.id);
    }
  });
}
