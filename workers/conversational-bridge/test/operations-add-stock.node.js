import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addStock, validateBoughtDate } from '../src/operations/inventory.js';
import { ValidationError, NotFoundError } from '../src/errors.js';

const FoodSafety = globalThis.MealPrepFoodSafety;
// Every verdict is for an explicit household day (TASK-094): no test depends on the real clock.
const TODAY = '2026-11-27';
// The arithmetic tests use a lot with no fridge safety class (frozen) so only the delta is tested.
const freshRow = (overrides = {}) => ({
  id: 'chicken', name: 'Chicken', quantity: 500, unit: 'g', staple: false,
  purchaseDate: '2026-11-01', shelfLifeDays: 90, storage: 'freezer',
  expiryDate: null, dateMode: 'purchase', category: 'protein', marker: 'preserve',
  ...overrides
});
const call = (pantry, args, tombstones = {}, today = TODAY) => addStock(pantry, tombstones, args, today);
const SEPARATE = /record the new purchase separately in the app/;

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

test('same-unit additions preserve finer decimals and ordinary deltas exactly', () => {
  assert.equal(call([freshRow()], { ingredientId: 'chicken', quantity: 0.006, expectedUnit: 'g' }).item.quantity, 500.006);
  assert.equal(call([freshRow()], { ingredientId: 'chicken', quantity: 0.014, expectedUnit: 'g' }).item.quantity, 500.014);
  assert.equal(call([freshRow()], { ingredientId: 'chicken', quantity: 0.01, expectedUnit: 'g' }).item.quantity, 500.01);
  assert.equal(call([freshRow()], { ingredientId: 'chicken', quantity: 300, expectedUnit: 'g' }).item.quantity, 800);
  assert.equal(call([freshRow()], { ingredientId: 'chicken', quantity: 1e-7, expectedUnit: 'g' }).item.quantity, 500.0000001);
  assert.equal(call([freshRow({ quantity: 1.2 })], { ingredientId: 'chicken', quantity: 0.8, expectedUnit: 'g' }).item.quantity, 2);

  assert.equal(call([freshRow({ quantity: 0.001, unit: 'kg' })], { ingredientId: 'chicken', quantity: 0.002, expectedUnit: 'kg' }).item.quantity, 0.003);
});

test('forward and reverse metric conversions preserve exact fine decimals', () => {
  assert.equal(call([freshRow()], { ingredientId: 'chicken', quantity: 0.000006, expectedUnit: 'kg' }).item.quantity, 500.006);
  assert.equal(call([freshRow({ unit: 'ml' })], { ingredientId: 'chicken', quantity: 0.000014, expectedUnit: 'L' }).item.quantity, 500.014);
  assert.equal(call([freshRow({ quantity: 0.001, unit: 'kg' })], { ingredientId: 'chicken', quantity: 1, expectedUnit: 'g' }).item.quantity, 0.002);
  assert.equal(call([freshRow({ quantity: 0.001, unit: 'L' })], { ingredientId: 'chicken', quantity: 1, expectedUnit: 'ml' }).item.quantity, 0.002);
  assert.equal(call([freshRow({ quantity: 0.001, unit: 'kg' })], { ingredientId: 'chicken', quantity: 0.001, expectedUnit: 'g' }).item.quantity, 0.001001);
});

test('true loss of significance and numeric overflow reject without mutation', () => {
  const cases = [
    [freshRow({ quantity: Number.MAX_SAFE_INTEGER - 1 }), 0.1],
    [freshRow({ quantity: Number.MAX_VALUE }), Number.MAX_VALUE],
    [freshRow({ quantity: Number.MAX_SAFE_INTEGER }), 1]
  ];
  for (const [row, quantity] of cases) {
    const pantry = [row];
    const before = structuredClone(pantry);
    assert.throws(() => call(pantry, { ingredientId: 'chicken', quantity, expectedUnit: 'g' }), ValidationError);
    assert.deepEqual(pantry, before);
  }
});

test('delta can restore a numeric staple to full without changing its stable id', () => {
  const row = { id: 'rice', name: 'Rice', quantity: 2, unit: 'kg', staple: true, stockLevel: 'empty', storage: 'counter', suggestDismissed: true };
  const result = call([row], { ingredientId: 'rice', quantity: 500, expectedUnit: 'g' });
  assert.equal(result.pantry[0].id, 'rice');
  assert.equal(result.pantry[0].quantity, 2.5);
  assert.equal(result.pantry[0].stockLevel, 'full');
  assert.equal(result.pantry[0].storage, 'counter');
  assert.equal('suggestDismissed' in result.pantry[0], false);

  const empty = call([{ ...row, quantity: 0 }], { ingredientId: 'rice', quantity: 500, expectedUnit: 'g' });
  assert.equal(empty.item.quantity, 0.5);
  assert.equal(empty.item.stockLevel, 'full');
});

test('stock-level-only staples, presence-only and unreadable rows, absent rows, and tombstones fail without mutation', () => {
  const cases = [
    [{ id: 'rice', staple: true, stockLevel: 'empty' }, {}, /use set_stock_level or mark_in_stock/],
    // TASK-097: was AmbiguousError; an unflagged Dairy row with an amount is now the app's
    // non-staple (accepted, see mcp-staple-parity). Presence-only and unreadable rows are refused.
    [{ id: 'custom', category: 'Dairy' }, {}, /presence_only:/],
    [{ id: 'custom', quantity: 1, unit: 'g', category: { label: 'Dairy' } }, {}, /invalid_record:/]
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
    [{ quantity: 1 }, { quantity: Infinity, expectedUnit: 'g' }]
  ];
  for (const [rowChange, input] of invalid) {
    const pantry = [freshRow(rowChange)];
    const before = structuredClone(pantry);
    assert.throws(() => call(pantry, { ingredientId: 'chicken', ...input }), ValidationError);
    assert.deepEqual(pantry, before);
  }
});

test('the merge gate is the shared verdict: printed-date, expired, unknown and check lots are refused unchanged', () => {
  const rows = [
    // A printed date (use-by or best-before, in date or not, staple or not) never takes new stock.
    freshRow({ dateMode: 'expiry', expiryDate: '2026-12-31' }),
    freshRow({ dateMode: 'expiry', printedDateKind: 'best-before', expiryDate: '2026-12-31' }),
    { id: 'chicken', name: 'Canned tuna', quantity: 2, unit: 'g', staple: true, storage: 'counter', dateMode: 'expiry', expiryDate: '2027-06-01' },
    // Raw fridge poultry past its 2-day limit; with no bought date, or a malformed one (never guessed).
    freshRow({ storage: 'fridge', purchaseDate: '2026-11-24' }),
    freshRow({ storage: 'fridge', purchaseDate: null }),
    freshRow({ storage: 'fridge', purchaseDate: '2026-02-30' }),
    // Unknown: no storage recorded and none the shared rules can infer.
    freshRow({ name: 'Mystery item', storage: null }),
    // Check: a perishable past its shelf-life estimate.
    freshRow({ name: 'Carrots', category: 'vegetable', storage: 'fridge', purchaseDate: '2026-11-10', shelfLifeDays: 7 }),
    // Check: a staple past its estimate (the bridge used to merge every staple without a date check).
    { id: 'chicken', name: 'Rice', quantity: 2, unit: 'g', staple: true, storage: 'counter', category: 'grain', purchaseDate: '2025-01-01', shelfLifeDays: 180 },
    // Unreadable shelf life: the shared verdict reads it as unknown.
    freshRow({ shelfLifeDays: 1e20 })
  ];
  for (const row of rows) {
    const pantry = [row];
    const before = structuredClone(pantry);
    assert.throws(() => call(pantry, { ingredientId: 'chicken', quantity: 1, expectedUnit: 'g' }), (error) =>
      error instanceof ValidationError && SEPARATE.test(error.message), JSON.stringify(row));
    assert.deepEqual(pantry, before);
  }
});

const SAFETY_LOTS = [
  ['Chicken thighs', 'poultry'],
  ['Pork liempo', 'whole-cut'],
  ['Bangus', 'seafood'],
  ['Ground pork', 'ground'],
  ['Chicken liver', 'variety'],
  ['Longganisa', 'raw-sausage'],
  ['Leftover adobo', 'cooked-leftover']
];

test('a fridge safety lot needs the bought date of the new stock: missing asks, different refuses, equal merges', () => {
  for (const [name, safetyClass] of SAFETY_LOTS) {
    const row = freshRow({ name, storage: 'fridge', purchaseDate: TODAY, shelfLifeDays: undefined });
    assert.equal(FoodSafety.pantryFridgeSafety(row, TODAY).safetyClass, safetyClass, name);
    const pantry = [row];
    const before = structuredClone(pantry);
    assert.throws(() => call(pantry, { ingredientId: 'chicken', quantity: 100, expectedUnit: 'g' }), (error) =>
      error instanceof ValidationError && /^needs_bought_date: /.test(error.message) &&
      /Ask the user/.test(error.message) && /"today" or "just bought"/.test(error.message) &&
      error.detail.code === 'needs_bought_date' && error.detail.field === 'boughtDate', name);
    assert.throws(() => call(pantry, { ingredientId: 'chicken', quantity: 100, expectedUnit: 'g', boughtDate: '2026-11-26' }), SEPARATE, name);
    assert.deepEqual(pantry, before);

    const merged = call(pantry, { ingredientId: 'chicken', quantity: 100, expectedUnit: 'g', boughtDate: TODAY });
    assert.equal(merged.item.quantity, 600, name);
    assert.equal(merged.pantry[0].purchaseDate, TODAY, 'the lot keeps its bought date');
    assert.deepEqual(merged.lot, { boughtDate: TODAY, storage: 'fridge', storageSource: 'recorded' });
  }
});

test('a safety lot exactly at its limit merges on its last day ("Use today") and is refused the next day', () => {
  const row = freshRow({ name: 'Chicken thighs', storage: 'fridge', purchaseDate: '2026-11-25', shelfLifeDays: undefined });
  const args = { ingredientId: 'chicken', quantity: 100, expectedUnit: 'g', boughtDate: '2026-11-25' };
  // 2-day poultry limit from 2026-11-25: 2026-11-27 is the last day.
  const lastDay = call([row], args, {}, '2026-11-27');
  assert.equal(lastDay.item.quantity, 600);
  assert.deepEqual(lastDay.lot, { boughtDate: '2026-11-25', storage: 'fridge', storageSource: 'recorded' });
  const pantry = [row];
  const before = structuredClone(pantry);
  assert.throws(() => call(pantry, args, {}, '2026-11-28'), (error) => SEPARATE.test(error.message) && /Past safe fridge time/.test(error.message));
  assert.deepEqual(pantry, before);
});

test('boughtDate must be a real calendar day that is not after the household day', () => {
  const row = freshRow({ name: 'Chicken thighs', storage: 'fridge', purchaseDate: TODAY, shelfLifeDays: undefined });
  for (const boughtDate of ['2026-11-28', '2027-01-01', '2026-02-30', '2026-13-01', '27-11-2026', '', 20261127, null]) {
    const pantry = [row];
    const before = structuredClone(pantry);
    assert.throws(() => call(pantry, { ingredientId: 'chicken', quantity: 1, expectedUnit: 'g', boughtDate }), (error) =>
      error instanceof ValidationError && error.detail.field === 'boughtDate', String(boughtDate));
    assert.deepEqual(pantry, before);
  }
  assert.throws(() => validateBoughtDate('2026-11-28', TODAY), /after today \(2026-11-27/);
  assert.doesNotThrow(() => validateBoughtDate(undefined, TODAY));
  assert.doesNotThrow(() => validateBoughtDate(TODAY, TODAY));
  // No household day, no verdict: the caller must supply one (never a guessed UTC day).
  for (const today of [null, '2026-02-30', 'today']) {
    assert.throws(() => call([freshRow()], { ingredientId: 'chicken', quantity: 1, expectedUnit: 'g' }, {}, today), TypeError);
  }
});

test('staples and non-safety lots keep the merge behaviour when usable, and state back their bought date and storage', () => {
  // A frozen lot has no fridge safety class: no boughtDate is needed, and a given one changes nothing.
  const frozen = call([freshRow()], { ingredientId: 'chicken', quantity: 100, expectedUnit: 'g' });
  assert.equal(frozen.item.quantity, 600);
  assert.deepEqual(frozen.lot, { boughtDate: '2026-11-01', storage: 'freezer', storageSource: 'recorded' });
  const withDate = call([freshRow()], { ingredientId: 'chicken', quantity: 100, expectedUnit: 'g', boughtDate: TODAY });
  assert.equal(withDate.pantry[0].purchaseDate, '2026-11-01');
  assert.deepEqual(withDate.lot, { boughtDate: '2026-11-01', storage: 'freezer', storageSource: 'recorded' });
  // Eggs in the fridge are excluded from the fridge safety limits.
  const eggs = call([freshRow({ name: 'Eggs', storage: 'fridge', unit: 'pcs', quantity: 6, purchaseDate: '2026-11-20', shelfLifeDays: 21 })], { ingredientId: 'chicken', quantity: 6, expectedUnit: 'pcs' });
  assert.equal(eggs.item.quantity, 12);
  assert.deepEqual(eggs.lot, { boughtDate: '2026-11-20', storage: 'fridge', storageSource: 'recorded' });
  // A lot with no date and a storage location is ok/no-date and merges as before.
  const undated = call([freshRow({ purchaseDate: null, shelfLifeDays: undefined })], { ingredientId: 'chicken', quantity: 1, expectedUnit: 'g' });
  assert.deepEqual(undated.lot, { boughtDate: null, storage: 'freezer', storageSource: 'recorded' });
  // A use-soon (non-safety) lot is still usable and merges.
  const soon = call([freshRow({ name: 'Milk', category: 'dairy', storage: 'fridge', unit: 'ml', purchaseDate: '2026-11-21', shelfLifeDays: 7 })], { ingredientId: 'chicken', quantity: 500, expectedUnit: 'ml' });
  assert.equal(soon.item.quantity, 1000);
  // An empty staple whose dates are fine is refilled (out of stock is not a date problem).
  const staple = call([{ id: 'rice', name: 'Rice', quantity: 0, unit: 'kg', staple: true, stockLevel: 'empty', storage: 'counter' }], { ingredientId: 'rice', quantity: 1, expectedUnit: 'kg' });
  assert.equal(staple.item.stockLevel, 'full');
  assert.deepEqual(staple.lot, { boughtDate: null, storage: 'counter', storageSource: 'recorded' });
});

test('the bridge-only category shelf-life defaults and the UTC skew window are gone', async () => {
  const source = await readFile(new URL('../src/operations/inventory.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /CATEGORY_SHELF_LIFE_DAYS|DEFAULT_CATEGORY_SHELF_LIFE_DAYS|UTC_LOCAL_DATE_SKEW_DAYS|validateMergeFreshness|dateStringToUtcDay|Date\.now\(/);
});

test('review fixes: unreadable or non-exact storage is refused; older boughtDate refused; bad dates and inferred storage stated honestly', () => {
  const chicken = (storage) => ({ id: 'a', name: 'Chicken Breast', category: 'Protein', storage, purchaseDate: '2026-11-26', quantity: 500, unit: 'g', staple: false });
  for (const storage of [{}, 1, 'Fridge', ' fridge', 'pantry']) {
    // Non-text storage is an unreadable record, refused first as invalid_record (TASK-097 review M1);
    // text that is not exactly fridge/freezer/counter is refused by the TASK-094 lot gate.
    const expected = typeof storage === 'string' ? /record the new purchase separately in the app/ : /^invalid_record:/;
    assert.throws(() => call([chicken(storage)], { ingredientId: 'a', quantity: 1, expectedUnit: 'g', boughtDate: '2026-11-26' }),
      (e) => e instanceof ValidationError && expected.test(e.message), JSON.stringify(storage));
  }
  // Non-safety lot: older stock must not take a newer lot's date; newer stock may join.
  const spinach = () => [{ id: 's', name: 'Spinach', category: 'Vegetable', storage: 'counter', purchaseDate: '2026-11-26', shelfLifeDays: 30, quantity: 1, unit: 'pcs', staple: false }];
  assert.throws(() => call(spinach(), { ingredientId: 's', quantity: 1, expectedUnit: 'pcs', boughtDate: '2026-11-15' }),
    (e) => e instanceof ValidationError && /before this lot \(2026-11-26\)/.test(e.message));
  assert.equal(call(spinach(), { ingredientId: 's', quantity: 1, expectedUnit: 'pcs', boughtDate: '2026-11-26' }).item.quantity, 2);
  // A stored date that is not a real calendar day is never stated back.
  const odd = call([{ id: 'o', name: 'Onion', category: 'Vegetable', storage: 'counter', purchaseDate: 'yesterday', quantity: 1, unit: 'kg', staple: false }], { ingredientId: 'o', quantity: 1, expectedUnit: 'kg' });
  assert.deepEqual(odd.lot, { boughtDate: null, storage: 'counter', storageSource: 'recorded' });
  // No storage recorded: the guess is labelled inferred.
  const inferred = call([{ id: 'r', name: 'Tuna (Canned)', category: 'Protein', purchaseDate: '2026-11-20', shelfLifeDays: 365, quantity: 1, unit: 'can', staple: false }], { ingredientId: 'r', quantity: 1, expectedUnit: 'can' });
  assert.equal(inferred.lot.storageSource, 'inferred');
  assert.equal(inferred.lot.storage, 'counter');
});

test('review: empty-string storage behaves like none (inferred; fridge safety rules still apply)', () => {
  const chicken = () => [{ id: 'c', name: 'Chicken Breast', category: 'Protein', storage: '', purchaseDate: '2026-11-26', quantity: 500, unit: 'g', staple: false }];
  assert.throws(() => call(chicken(), { ingredientId: 'c', quantity: 1, expectedUnit: 'g' }),
    (e) => e instanceof ValidationError && /^needs_bought_date/.test(e.message));
  assert.throws(() => call(chicken(), { ingredientId: 'c', quantity: 1, expectedUnit: 'g', boughtDate: '2026-11-27' }),
    (e) => e instanceof ValidationError && /record the new purchase separately in the app/.test(e.message));
  const merged = call(chicken(), { ingredientId: 'c', quantity: 1, expectedUnit: 'g', boughtDate: '2026-11-26' });
  assert.equal(merged.item.quantity, 501);
  assert.deepEqual(merged.lot, { boughtDate: '2026-11-26', storage: 'fridge', storageSource: 'inferred' });
});
