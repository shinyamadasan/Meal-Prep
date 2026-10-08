import test from 'node:test';
import assert from 'node:assert/strict';
import '../../../shared/readyFoodContract.js';
import { READY_FOOD_SOURCES } from '../src/operations/readyFood.js';

test('the shared ready-food contract defines the only source values and freshness defaults', () => {
  assert.deepEqual(READY_FOOD_SOURCES, ['leftovers', 'takeout']);
  assert.deepEqual(globalThis.MealPrepReadyFoodContract, {
    sources: ['leftovers', 'takeout'],
    defaultFridgeLife: 3,
    defaultFreezerLife: 90
  });
});
