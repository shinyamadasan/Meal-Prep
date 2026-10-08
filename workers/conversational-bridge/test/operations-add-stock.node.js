import test from 'node:test';
import assert from 'node:assert/strict';
import { addStock } from '../src/operations/inventory.js';
import { ValidationError, NotFoundError, AmbiguousError } from '../src/errors.js';

const utcDay = Math.floor(Date.now() / 86400000);
const isoDay = (day) => new Date(day * 86400000).toISOString().slice(0, 10);
const freshRow = (overrides = {}) => ({
  id: 'chicken', name: 'Chicken', quantity: 500, unit: 'g', staple: false,
  purchaseDate: isoDay(utcDay - 30), shelfLifeDays: 90, storage: 'fridge',
  expiryDate: null, dateMode: 'purchase', category: 'protein', marker: 'preserve',
  ...overrides
});
const call = (pantry, args, tombstones = {}) => addStock(pantry, tombstones, args);

test('same-unit and supported metric additions preserve identity and existing lot metadata', () => {
  const row = freshRow();
  const same = call([row], { ingredientId: 'chicken', quantity: 250, expectedUnit: 'g' });
  assert.equal(same.pantry[0].quantity, 750);
  assert.equal(same.pantry[0].id, row.id);
  assert.equal(same.pantry[0].purchaseDate, row.purchaseDate);
  assert.equal(same.pantry[0].shelfLifeDays, row.shelfLifeDays);
  assert.equal(same.pantry[0].storage, row.storage);
  assert.equal(same.pantry[0].expiryDate, row.expiryDate);
  assert.equal(same.pantry[0].marker, row.marker);
  assert.notEqual(same.pantry[0].updatedAt, row.updatedAt);
  assert.deepEqual(same.pantry.slice(1), []);

  const converted = call([freshRow()], { ingredientId: 'chicken', quantity: 0.5, expectedUnit: 'kg' });
  assert.equal(converted.item.quantity, 1000);
});

test('delta can restore a numeric staple to full without changing its stable id', () => {
  const row = { id: 'rice', name: 'Rice', quantity: 2, unit: 'kg', staple: true, stockLevel: 'empty', storage: 'pantry', suggestDismissed: true };
  const result = call([row], { ingredientId: 'rice', quantity: 500, expectedUnit: 'g' });
  assert.equal(result.pantry[0].id, 'rice');
  assert.equal(result.pantry[0].quantity, 2.5);
  assert.equal(result.pantry[0].stockLevel, 'full');
  assert.equal(result.pantry[0].storage, 'pantry');
  assert.equal('suggestDismissed' in result.pantry[0], false);

  const empty = call([{ ...row, quantity: 0 }], { ingredientId: 'rice', quantity: 500, expectedUnit: 'g' });
  assert.equal(empty.item.quantity, 0.5);
  assert.equal(empty.item.stockLevel, 'full');
});

test('stock-level-only staples, ambiguous rows, absent rows, and tombstones fail without mutation', () => {
  const cases = [
    [{ id: 'rice', staple: true, stockLevel: 'empty' }, {}, /use mark_in_stock/],
    [{ id: 'custom', quantity: 1, unit: 'g', category: 'Dairy' }, {}, AmbiguousError]
  ];
  for (const [row, tombstones, expected] of cases) {
    const pantry = [row];
    const before = structuredClone(pantry);
    assert.throws(() => call(pantry, { ingredientId: row.id, quantity: 1, expectedUnit: 'g' }, tombstones), expected);
    assert.deepEqual(pantry, before);
  }
  assert.throws(() => call([], { ingredientId: 'missing', quantity: 1, expectedUnit: 'g' }), NotFoundError);
  assert.throws(() => call([freshRow()], { ingredientId: 'chicken', quantity: 1, expectedUnit: 'g' }, { chicken: 'deleted' }), NotFoundError);
});

test('invalid quantity, unit mismatch, unknown conversion, overflow, and unrepresentable increments fail unchanged', () => {
  const invalid = [
    [{ quantity: -1 }, { quantity: 1, expectedUnit: 'g' }],
    [{ quantity: Number.MAX_SAFE_INTEGER }, { quantity: 1, expectedUnit: 'g' }],
    [{ quantity: 1 }, { quantity: Number.MAX_VALUE, expectedUnit: 'kg' }],
    [{ quantity: 1 }, { quantity: 0, expectedUnit: 'g' }],
    [{ quantity: 1 }, { quantity: 1, expectedUnit: 'ml' }],
    [{ quantity: 1 }, { quantity: 1, expectedUnit: 'cup' }],
    [{ quantity: 1 }, { quantity: 1, expectedUnit: '' }],
    [{ quantity: 1 }, { quantity: 0.001, expectedUnit: 'g' }]
  ];
  for (const [rowChange, input] of invalid) {
    const pantry = [freshRow(rowChange)];
    const before = structuredClone(pantry);
    assert.throws(() => call(pantry, { ingredientId: 'chicken', ...input }), ValidationError);
    assert.deepEqual(pantry, before);
  }
});

test('printed expiry, expired stock, timezone-boundary freshness, and malformed metadata fail unchanged', () => {
  const rows = [
    [freshRow({ dateMode: 'expiry', expiryDate: isoDay(utcDay + 30) }), /printed expiry/],
    [freshRow({ purchaseDate: isoDay(utcDay - 10), shelfLifeDays: 3 }), /already expired/],
    [freshRow({ purchaseDate: isoDay(utcDay - 3), shelfLifeDays: 3 }), /UTC\/local date boundary/],
    [freshRow({ purchaseDate: '2026-02-30' }), /purchaseDate is malformed/],
    [freshRow({ shelfLifeDays: 2.5 }), /shelf life is malformed/]
  ];
  for (const [row, expected] of rows) {
    const pantry = [row];
    const before = structuredClone(pantry);
    assert.throws(() => call(pantry, { ingredientId: 'chicken', quantity: 1, expectedUnit: 'g' }), expected);
    assert.deepEqual(pantry, before);
  }
});
