import test from 'node:test';
import assert from 'node:assert/strict';
import { consumeStock } from '../src/operations/inventory.js';
import { convertQuantity } from '../src/operations/quantity.js';
import { AmbiguousError, InsufficientStockError, ValidationError } from '../src/errors.js';

const NOW = '2026-10-08T12:00:00.000Z';
const call = (pantry, args, deletionsPantry = {}) => consumeStock(pantry, deletionsPantry, args);

test('quantity helper supports exact same-unit arithmetic and only exact g/kg and ml/L scaling', () => {
  assert.equal(convertQuantity(300, 'g', 'g'), 300);
  assert.equal(convertQuantity(0.3, 'kg', 'g'), 300);
  assert.equal(convertQuantity(300, 'g', 'kg'), 0.3);
  assert.equal(convertQuantity(0.5, 'L', 'ml'), 500);
  assert.equal(convertQuantity(500, 'ml', 'L'), 0.5);
  assert.equal(convertQuantity(3, 'pcs', 'pcs'), 3);
  assert.equal(convertQuantity(3, 'can', 'can'), 3);
  assert.equal(convertQuantity(0.5, 'pieces', 'pieces'), 0.5);
});

test('quantity helper rejects unsupported units, aliases, dimensions, and non-positive values', () => {
  for (const [quantity, from, to] of [
    [1, 'cup', 'g'], [1, 'G', 'g'], [1, 'g', 'ml'], [1, 'pieces', 'g'],
    [1, 'can', 'pack'], [1, 'tsp', 'tbsp'], [1, 'pcs', 'pieces'], [1, 'g', 'toString'],
    [1, '', 'g'], [1, 'g', ' '], [0, 'g', 'g'], [-1, 'g', 'g'], [NaN, 'g', 'g']
  ]) {
    assert.throws(() => convertQuantity(quantity, from, to), ValidationError, `${from} -> ${to}`);
  }
});

test('partial same-unit consume subtracts the delta and preserves stable identity and metadata', () => {
  const pantry = [
    { id: 12.5, name: 'Chicken', quantity: 500, unit: 'g', staple: false, storage: 'freezer', updatedAt: NOW, note: 'keep' },
    { id: 'other', name: 'Milk', quantity: 2, unit: 'L', staple: false }
  ];
  const result = call(pantry, { ingredientId: '12.5', quantity: 300, expectedUnit: 'g' });
  assert.equal(result.pantry[0].quantity, 200);
  assert.equal(result.pantry[0].id, 12.5);
  assert.equal(result.pantry[0].note, 'keep');
  assert.equal(result.pantry[0].storage, 'freezer');
  assert.notEqual(result.pantry[0].updatedAt, NOW);
  assert.deepEqual(result.pantry[1], pantry[1]);
  assert.equal(result.removed, false);
  assert.equal(result.item.ingredientId, '12.5');
});

test('metric delta is converted only within its exact dimension', () => {
  const mass = call([{ id: 'chicken', name: 'Chicken', quantity: 500, unit: 'g', staple: false }], {
    ingredientId: 'chicken', quantity: 0.3, expectedUnit: 'kg'
  });
  assert.equal(mass.item.quantity, 200);

  const volume = call([{ id: 'milk', name: 'Milk', quantity: 1000, unit: 'ml', staple: false }], {
    ingredientId: 'milk', quantity: 0.5, expectedUnit: 'L'
  });
  assert.equal(volume.item.quantity, 500);
});

test('exact zero removes a non-staple and writes a tombstone without changing the input arrays', () => {
  const row = { id: 'chicken', name: 'Chicken', quantity: 300, unit: 'g', staple: false };
  const pantry = [row];
  const deletions = { older: '2026-01-01T00:00:00.000Z' };
  const result = call(pantry, { ingredientId: 'chicken', quantity: 300, expectedUnit: 'g' }, deletions);
  assert.deepEqual(result.pantry, []);
  assert.equal(result.item, null);
  assert.equal(result.removed, true);
  assert.equal(typeof result.deletionsPantry.chicken, 'string');
  assert.equal(new Date(result.deletionsPantry.chicken).toISOString(), result.deletionsPantry.chicken);
  assert.equal(result.deletionsPantry.older, deletions.older);
  assert.deepEqual(pantry, [row]);
  assert.deepEqual(deletions, { older: '2026-01-01T00:00:00.000Z' });
});

test('exact zero for a staple follows canonical markOutOfStock and retains its identity as empty', () => {
  const pantry = [{ id: 'rice', name: 'Rice', quantity: 500, unit: 'g', staple: true, stockLevel: 'full', storage: 'pantry' }];
  const result = call(pantry, { ingredientId: 'rice', quantity: 0.5, expectedUnit: 'kg' });
  assert.equal(result.removed, false);
  assert.equal(result.pantry.length, 1);
  assert.equal(result.pantry[0].id, 'rice');
  assert.equal(result.pantry[0].stockLevel, 'empty');
  assert.deepEqual(result.deletionsPantry, {});
  assert.deepEqual(pantry[0], { id: 'rice', name: 'Rice', quantity: 500, unit: 'g', staple: true, stockLevel: 'full', storage: 'pantry' });
});

test('over-consume, partial staple, ambiguous staple, malformed stored quantity/unit, and unit mismatch fail safely', () => {
  const cases = [
    [{ id: 'x', name: 'Chicken', quantity: 500, unit: 'g', staple: false }, { ingredientId: 'x', quantity: 900, expectedUnit: 'g' }, InsufficientStockError],
    [{ id: 'x', name: 'Rice', quantity: 500, unit: 'g', staple: true, stockLevel: 'full' }, { ingredientId: 'x', quantity: 300, expectedUnit: 'g' }, ValidationError],
    [{ id: 'x', name: 'Custom', quantity: 500, unit: 'g', category: 'Dairy' }, { ingredientId: 'x', quantity: 500, expectedUnit: 'g' }, AmbiguousError],
    [{ id: 'x', name: 'Chicken', quantity: null, unit: 'g', staple: false }, { ingredientId: 'x', quantity: 1, expectedUnit: 'g' }, ValidationError],
    [{ id: 'x', name: 'Chicken', quantity: 500, unit: '', staple: false }, { ingredientId: 'x', quantity: 1, expectedUnit: 'g' }, ValidationError],
    [{ id: 'x', name: 'Chicken', quantity: 500, unit: 'g', staple: false }, { ingredientId: 'x', quantity: 1, expectedUnit: 'ml' }, ValidationError]
  ];
  for (const [row, args, ErrorType] of cases) {
    const pantry = [row];
    const before = structuredClone(pantry);
    assert.throws(() => call(pantry, args), ErrorType);
    assert.deepEqual(pantry, before);
  }
});

test('unknown stable id fails as not found without mutation', () => {
  const pantry = [{ id: 'x', quantity: 1, unit: 'pieces', staple: false }];
  const before = structuredClone(pantry);
  assert.throws(() => call(pantry, { ingredientId: 'missing', quantity: 1, expectedUnit: 'pieces' }), (error) => error.code === 'not_found');
  assert.deepEqual(pantry, before);
  assert.throws(() => call(pantry, { ingredientId: '  ', quantity: 1, expectedUnit: 'pieces' }), ValidationError);
});
