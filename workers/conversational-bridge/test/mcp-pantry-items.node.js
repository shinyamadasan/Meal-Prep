// TASK-099 (PROP-041 P2-1 + P2-2): add_pantry_item registers a new lot shaped like the app's own
// Add; update_pantry_item corrects storage and dates. Both are undoable and state back safety.
import test from 'node:test';
import assert from 'node:assert/strict';
import { routeRequest } from '../src/index.js';
import { MCP_ISSUER, MCP_RESOURCE, MCP_SCOPE, MCP_WRITE_SCOPE } from '../src/mcpAuth.js';
import * as pantryItems from '../src/operations/pantryItems.js';
import { testEnv } from './support/fixtures.js';
import { createFakeFirestore } from './support/fakeFirestore.js';
import '../../../shared/foodSafety.js';
import '../../../shared/readyFoodContract.js';

const FoodSafety = globalThis.MealPrepFoodSafety;
const READY = globalThis.MealPrepReadyFoodContract;
const NOW = 1_800_000_000;
// 03:04 UTC = 11:04 in Asia/Manila: the household day is 2026-11-27.
const CLOCK_MS = Date.parse('2026-11-27T03:04:05.678Z');
const CLOCK_ISO = new Date(CLOCK_MS).toISOString();
const TODAY = '2026-11-27';
const RANDOM = 0.123456789;
const NEW_ID = 'buy_' + CLOCK_MS + '_' + RANDOM.toString(36).slice(2, 7);
const OWNER = 'test-owner-subject';

const EGGS = { id: 'eggs-1', name: 'Eggs', quantity: 6, unit: 'pieces', category: 'Protein', staple: false, storage: 'fridge', purchaseDate: TODAY, shelfLifeDays: 35, updatedAt: '2026-11-20T00:00:00.000Z' };
const FROZEN_CHICKEN = { id: 'chicken-1', name: 'Chicken Breast', quantity: 1, unit: 'kg', category: 'Protein', staple: false, storage: 'freezer', purchaseDate: '2026-10-01', shelfLifeDays: 2, updatedAt: '2026-10-01T00:00:00.000Z' };
const SAUCE = { id: 'sauce-1', name: 'Soy Sauce', unit: 'ml', quantity: 500, category: 'Pantry', storage: 'counter', purchaseDate: '2026-11-01', dateMode: 'expiry', expiryDate: '2027-06-01', printedDateKind: 'best-before', updatedAt: '2026-11-01T00:00:00.000Z' };
const BROKEN = { id: 'broken-1', name: 'Broken', quantity: 'lots', unit: 'g', storage: 'fridge' };

function seed() {
  return {
    version: 5,
    pantry: [structuredClone(EGGS), structuredClone(FROZEN_CHICKEN), structuredClone(SAUCE), structuredClone(BROKEN)],
    cookedMeals: [],
    mealConsumptions: [],
    deletions: { pantry: {}, cookedMeals: {} }
  };
}

function context() {
  return {
    auth: { token: 'not-a-real-token', audience: MCP_RESOURCE, expiresAt: NOW + 300, scope: [MCP_SCOPE, MCP_WRITE_SCOPE], userId: OWNER, clientId: 'https://chatgpt.com/oauth/client.json' },
    props: { ownerSubject: OWNER, issuer: MCP_ISSUER, resource: MCP_RESOURCE, notBefore: NOW - 1 }
  };
}

function rpc(method, params) {
  return new Request('https://localhost/mcp', {
    method: 'POST',
    headers: { Host: 'localhost', Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
}

async function messageOf(response) {
  const raw = await response.text();
  if ((response.headers.get('Content-Type') || '').includes('text/event-stream')) {
    return JSON.parse(raw.split(/\r?\n/).find((line) => line.startsWith('data: ')).slice(6));
  }
  return JSON.parse(raw);
}

let ids = 0;
function nextId(prefix = 'pantry-item') {
  ids += 1;
  return prefix + '-' + String(ids).padStart(5, '0');
}

function bridge(fields = seed()) {
  const fake = createFakeFirestore({ fields });
  let commits = 0;
  const fetchImpl = async (url, init = {}) => {
    if (new URL(url).pathname.endsWith('/documents:commit')) commits += 1;
    return fake.fetch(url, init);
  };
  // The first lot a bridge mints is NEW_ID; later lots get other ids (the clock is fixed).
  let draws = 0;
  const random = () => { draws += 1; return draws === 1 ? RANDOM : (RANDOM + draws / 100) % 1; };
  const deps = { nowSeconds: NOW, now: () => CLOCK_MS, random, fetchImpl, cryptoImpl: globalThis.crypto };
  const raw = (name, args) => routeRequest(rpc('tools/call', { name, arguments: args }), testEnv(), deps, context()).then(messageOf);
  const call = (name, args) => raw(name, Object.assign({ requestId: nextId(), expectedRevision: fake.store.fields.version }, args));
  const snapshot = () => JSON.stringify({ store: fake.store, requests: [...fake.requests.entries()] });
  return { fake, deps, raw, call, snapshot, commits: () => commits };
}

function text(message) {
  return message.result.content && message.result.content[0] && message.result.content[0].text;
}

function ok(message, label = '') {
  assert.equal(message.result.isError, undefined, label + ': ' + text(message));
  return message.result.structuredContent;
}

async function refused(b, promise, code) {
  const before = b.snapshot();
  const commits = b.commits();
  const message = await promise;
  assert.equal(message.result.isError, true, 'expected a refusal: ' + JSON.stringify(message.result));
  assert.match(text(message), new RegExp('^' + code + ': '));
  assert.equal(b.commits(), commits, code + ': no commit');
  assert.equal(b.snapshot(), before, code + ': nothing written');
  return text(message);
}

function stored(b, id) {
  return b.fake.store.fields.pantry.find((p) => String(p.id) === id);
}

async function inventoryItem(b, id) {
  const read = ok(await b.raw('get_inventory', {}), 'get_inventory');
  return read.items.find((item) => item.ingredientId === id);
}

// ── Public contract ──────────────────────────────────────────────────────────────────────────

test('tools/list: add_pantry_item and update_pantry_item have strict schemas, write scope and honest annotations', async () => {
  const response = await routeRequest(rpc('tools/list', {}), testEnv(), { nowSeconds: NOW }, context());
  const tools = (await messageOf(response)).result.tools;
  const add = tools.find((t) => t.name === 'add_pantry_item');
  const update = tools.find((t) => t.name === 'update_pantry_item');
  assert.deepEqual(Object.keys(add.inputSchema.properties).sort(), ['boughtDate', 'confirmNewLot', 'expectedRevision', 'level', 'name',
    'prepared', 'printedDate', 'printedDateKind', 'quantity', 'requestId', 'staple', 'storage', 'unit']);
  assert.deepEqual(add.inputSchema.required.slice().sort(), ['expectedRevision', 'name', 'requestId']);
  assert.deepEqual(Object.keys(update.inputSchema.properties).sort(), ['boughtDate', 'expectedRevision', 'ingredientId', 'printedDate',
    'printedDateKind', 'requestId', 'storage', 'thawedToday']);
  assert.deepEqual(update.inputSchema.required.slice().sort(), ['expectedRevision', 'ingredientId', 'requestId']);
  for (const tool of [add, update]) {
    assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
    assert.deepEqual(tool.inputSchema.properties.storage.enum, ['fridge', 'freezer', 'counter'], tool.name);
    assert.deepEqual(tool.securitySchemes, [{ type: 'oauth2', scopes: ['mealprep:write'] }], tool.name);
    assert.deepEqual(tool._meta.securitySchemes, [{ type: 'oauth2', scopes: ['mealprep:write'] }], tool.name);
    assert.match(tool.description, /requestId is required/, tool.name);
    assert.ok('safety' in tool.outputSchema.properties.item.properties, tool.name + ': states back safety');
  }
  assert.deepEqual(add.annotations, { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });
  assert.deepEqual(update.annotations, { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false });
  assert.match(add.description, /needs_storage/);
  assert.match(add.description, /does NOT deduct/);
  assert.match(add.description, /confirmNewLot/);
  assert.match(update.description, /needs_thaw_date/);
  assert.match(add.description, /unsafe_storage/);
  for (const code of ['unsafe_storage', 'past_safety_limit', 'unknown_bought_date', 'later_bought_date', 'unrecognized_food']) {
    assert.match(update.description, new RegExp(code), 'update_pantry_item names ' + code);
  }
  assert.match(update.description, /get_inventory/);
});

test('malformed arguments are refused before any Firestore access', async () => {
  const cases = [
    ['add_pantry_item', { name: '  ' }],
    ['add_pantry_item', { name: 'Eggs', quantity: 0 }],
    ['add_pantry_item', { name: 'Eggs', storage: 'Fridge' }],
    ['add_pantry_item', { name: 'Eggs', boughtDate: '2026-11-28' }],
    ['add_pantry_item', { name: 'Eggs', boughtDate: '2026-02-30' }],
    ['add_pantry_item', { name: 'Eggs', printedDateKind: 'best-before' }],
    ['add_pantry_item', { name: 'Minced Garlic', prepared: true }],
    ['add_pantry_item', { name: 'Minced Garlic', prepared: true, storage: 'counter' }],
    ['add_pantry_item', { name: 'Eggs', uid: 'someone-else' }],
    ['update_pantry_item', { ingredientId: 'eggs-1' }],
    ['update_pantry_item', { ingredientId: 'eggs-1', thawedToday: false }],
    ['update_pantry_item', { ingredientId: 'chicken-1', thawedToday: true }],
    ['update_pantry_item', { ingredientId: 'chicken-1', storage: 'fridge', thawedToday: true, boughtDate: TODAY }],
    ['update_pantry_item', { ingredientId: 'eggs-1', printedDate: null, printedDateKind: 'use-by' }],
    ['update_pantry_item', { ingredientId: 'eggs-1', boughtDate: '2026-12-01' }],
    ['update_pantry_item', { ingredientId: 'eggs-1', storage: 'garage' }]
  ];
  for (const [name, args] of cases) {
    const calls = { fetch: 0 };
    const deps = { nowSeconds: NOW, now: () => CLOCK_MS, fetchImpl: async () => { calls.fetch += 1; throw new Error('fetch reached'); }, cryptoImpl: globalThis.crypto };
    const message = await messageOf(await routeRequest(rpc('tools/call', { name, arguments: Object.assign({ requestId: nextId(), expectedRevision: 5 }, args) }), testEnv(), deps, context()));
    assert.equal(message.result.isError, true, name + ' ' + JSON.stringify(args));
    assert.equal(calls.fetch, 0, name + ' ' + JSON.stringify(args) + ': no Firestore access');
  }
});

// ── add_pantry_item: the app's record shape ─────────────────────────────────────────────────

test('a known grocery item gets the app Add record shape, inferred storage stated back, and get_inventory safety', async () => {
  const b = bridge();
  const result = ok(await b.call('add_pantry_item', { name: '  Tomato (Kamatis) ', quantity: 2 }), 'add tomato');
  const entry = FoodSafety.INGREDIENT_DB.find((i) => i.name === 'Tomato (Kamatis)');
  assert.ok(entry, 'fixture: Tomato (Kamatis) is in INGREDIENT_DB');
  const expected = {
    id: NEW_ID,
    name: 'Tomato (Kamatis)',
    category: entry.category,
    purchaseDate: TODAY,
    shelfLifeDays: entry.shelfLifeDays,
    storage: entry.storage,
    quantity: 2,
    unit: entry.unit,
    staple: !!entry.isStaple,
    updatedAt: CLOCK_ISO
  };
  assert.deepEqual(stored(b, NEW_ID), expected);
  assert.equal(b.fake.store.fields.version, 6);
  assert.equal(result.revision, 6);
  assert.equal(result.storageSource, 'inferred');
  assert.equal(result.prepared, false);
  const read = await inventoryItem(b, NEW_ID);
  assert.deepEqual(result.item, Object.assign({}, read, { shelfLifeDays: entry.shelfLifeDays }), 'same item and safety as get_inventory');
  assert.equal(result.item.safety.usable, true);
  assert.equal(result.item.purchaseDate, TODAY);
});

test('a name the ingredient list does not know gets category "", the category shelf life, and asks for storage', async () => {
  const b = bridge();
  const why = await refused(b, b.call('add_pantry_item', { name: 'Grandma Jam' }), 'needs_storage');
  assert.match(why, /fridge, the freezer or on the counter/);
  const result = ok(await b.call('add_pantry_item', { name: 'Grandma Jam', storage: 'counter', unit: 'jar', quantity: 1 }));
  assert.deepEqual(stored(b, NEW_ID), {
    id: NEW_ID, name: 'Grandma Jam', category: '', purchaseDate: TODAY, shelfLifeDays: FoodSafety.categoryShelfLife(''),
    storage: 'counter', quantity: 1, unit: 'jar', updatedAt: CLOCK_ISO
  });
  assert.equal('staple' in stored(b, NEW_ID), false, 'no INGREDIENT_DB entry -> staple left unset (app: undefined)');
  assert.equal(result.storageSource, 'given');
  assert.equal(result.item.tracking, 'quantity');
});

test('staples: the DB flag or an explicit staple sets stockLevel; level without a staple is refused', async () => {
  const b = bridge();
  const salt = ok(await b.call('add_pantry_item', { name: 'Salt', storage: 'counter' }));
  assert.equal(salt.item.staple, true);
  assert.equal(salt.item.stockLevel, 'full');
  assert.equal(salt.item.tracking, 'level');
  assert.equal(stored(b, NEW_ID).staple, true);

  const b2 = bridge();
  const jam = ok(await b2.call('add_pantry_item', { name: 'House Chili Oil', storage: 'counter', staple: true, level: 'low' }));
  assert.equal(jam.item.stockLevel, 'low');
  assert.equal(stored(b2, NEW_ID).staple, true);

  const b3 = bridge();
  const before = b3.snapshot();
  const levelOnly = await b3.call('add_pantry_item', { name: 'Grandma Jam', storage: 'counter', level: 'low' });
  assert.equal(levelOnly.result.isError, true);
  assert.match(text(levelOnly), /^level is only for staples/);
  assert.equal(b3.snapshot(), before);
});

test('printed dates: best-before is stored, use-by is the default and stores no kind', async () => {
  const b = bridge();
  ok(await b.call('add_pantry_item', { name: 'Grandma Jam', storage: 'counter', printedDate: '2027-01-31', printedDateKind: 'best-before' }));
  const jam = stored(b, NEW_ID);
  assert.equal(jam.expiryDate, '2027-01-31');
  assert.equal(jam.dateMode, 'expiry');
  assert.equal(jam.printedDateKind, 'best-before');

  const b2 = bridge();
  const milk = ok(await b2.call('add_pantry_item', { name: 'Oat Milk', storage: 'fridge', printedDate: '2026-12-02', printedDateKind: 'use-by' }));
  assert.equal(stored(b2, NEW_ID).dateMode, 'expiry');
  assert.equal('printedDateKind' in stored(b2, NEW_ID), false);
  assert.equal(milk.item.expiryDate, '2026-12-02');
  assert.equal(milk.item.safety.daysLeft, 5);
});

// ── D3: raw meat, poultry, fish ─────────────────────────────────────────────────────────────

test('raw meat, poultry and fish never get a guessed storage or bought date', async () => {
  const b = bridge();
  await refused(b, b.call('add_pantry_item', { name: 'Chicken Breast', quantity: 1, unit: 'kg' }), 'needs_storage');
  await refused(b, b.call('add_pantry_item', { name: 'Salmon', storage: 'fridge' }), 'needs_bought_date');
  await refused(b, b.call('add_pantry_item', { name: 'Ground Pork', storage: 'freezer' }), 'needs_bought_date');
  const fresh = ok(await b.call('add_pantry_item', { name: 'Chicken Breast', quantity: 1, unit: 'kg', storage: 'fridge', boughtDate: TODAY }));
  assert.equal(fresh.storageSource, 'given');
  assert.equal(fresh.item.purchaseDate, TODAY);
  assert.equal(fresh.item.safety.daysLeft, 2, 'poultry 2-day fridge limit from today');
  assert.equal(fresh.item.safety.status, 'use-soon');
});

test('a fridge lot already past its fridge safety limit is refused; the same lot in the freezer is recorded', async () => {
  const b = bridge();
  const why = await refused(b, b.call('add_pantry_item', { name: 'Chicken Breast', storage: 'fridge', boughtDate: '2026-11-24' }), 'past_safety_limit');
  assert.match(why, /2-day fridge safety limit/);
  const frozen = ok(await b.call('add_pantry_item', { name: 'Chicken Breast', storage: 'freezer', boughtDate: '2026-11-24', quantity: 1, unit: 'kg' }));
  assert.equal(frozen.item.storage, 'freezer');
  assert.equal(frozen.item.safety.usable, true);
});

test('a meat or fish name the ingredient list does not know is not given the 7-day default in the fridge', async () => {
  const b = bridge();
  await refused(b, b.call('add_pantry_item', { name: 'Cod fillet' }), 'needs_storage');
  // No shared fridge limit for "cod", even as Protein: refused in the fridge.
  await refused(b, b.call('add_pantry_item', { name: 'Cod fillet', storage: 'fridge', boughtDate: TODAY }), 'unrecognized_food');
  // Known by alias: the shared rules apply the poultry limit, so it is accepted.
  ok(await b.call('add_pantry_item', { name: 'chicken fillet', storage: 'fridge', boughtDate: TODAY }));
  // Freezer: no fridge clock is at stake.
  ok(await b.call('add_pantry_item', { name: 'Cod fillet', storage: 'freezer', boughtDate: TODAY }));
  // SF2: an unknown name the shared rule places once it is Protein is stored, with the 3-day limit.
  const b2 = bridge();
  const venison = ok(await b2.call('add_pantry_item', { name: 'Venison Steak', storage: 'fridge', boughtDate: TODAY }));
  assert.equal(stored(b2, NEW_ID).category, 'Protein');
  assert.equal(venison.item.safety.daysLeft, 3);
});

// ── Prepared ingredients ────────────────────────────────────────────────────────────────────

test('prepared ingredients: the freezer keeps the ready-food freezer life; the fridge never exceeds the raw item; nothing is deducted', async () => {
  const b = bridge();
  const pantryBefore = structuredClone(b.fake.store.fields.pantry);
  const paste = ok(await b.call('add_pantry_item', { name: 'Frozen Minced Garlic', storage: 'freezer', quantity: 200, unit: 'g', prepared: true }));
  assert.equal(paste.prepared, true);
  assert.equal(paste.item.name, 'Frozen Minced Garlic', 'name used as given');
  assert.equal(stored(b, NEW_ID).shelfLifeDays, READY.defaultFreezerLife, 'frozen prepared food: ready-food freezer life, not the raw 7-day cap');
  assert.deepEqual(b.fake.store.fields.pantry.slice(0, pantryBefore.length), pantryBefore, 'raw lots untouched (D2)');

  const b2 = bridge();
  ok(await b2.call('add_pantry_item', { name: 'Garlic (Bawang)', storage: 'freezer', prepared: true }));
  assert.equal(stored(b2, NEW_ID).shelfLifeDays, READY.defaultFreezerLife);
  // A printed date drives the verdict, and the stored life stays the prepared 90-day signature (review 3 MF-B).
  const b5 = bridge();
  ok(await b5.call('add_pantry_item', { name: 'Frozen Minced Garlic', storage: 'freezer', prepared: true, printedDate: '2027-03-01' }));
  assert.equal(stored(b5, NEW_ID).shelfLifeDays, READY.defaultFreezerLife);

  const b3 = bridge();
  ok(await b3.call('add_pantry_item', { name: 'Chopped Onions', storage: 'fridge', prepared: true }));
  assert.equal(stored(b3, NEW_ID).shelfLifeDays, READY.defaultFridgeLife);

  const b4 = bridge();
  ok(await b4.call('add_pantry_item', { name: 'Chicken Breast', storage: 'fridge', boughtDate: TODAY, prepared: true }));
  assert.equal(stored(b4, NEW_ID).shelfLifeDays, 2, 'raw chicken breast life (2) is shorter than the ready-food fridge life');
});

// ── Duplicate guard ─────────────────────────────────────────────────────────────────────────

test('same name, bought day and storage is ambiguous; confirmNewLot adds; a different day or storage adds without asking', async () => {
  const b = bridge();
  const why = await refused(b, b.call('add_pantry_item', { name: ' eggs ', quantity: 12 }), 'ambiguous');
  assert.match(why, /"eggs-1"/);
  assert.match(why, /add_stock/);
  assert.match(why, /confirmNewLot: true/);
  ok(await b.call('add_pantry_item', { name: 'Eggs', quantity: 12, confirmNewLot: true }));
  assert.equal(b.fake.store.fields.pantry.filter((p) => p.name === 'Eggs').length, 2);

  const b2 = bridge();
  ok(await b2.call('add_pantry_item', { name: 'Eggs', quantity: 12, boughtDate: '2026-11-26' }));
  const b3 = bridge();
  ok(await b3.call('add_pantry_item', { name: 'Eggs', quantity: 12, storage: 'counter' }));
});

// ── Replay and undo of an added lot ─────────────────────────────────────────────────────────

test('a retried add_pantry_item replays and never adds twice; undo removes the lot with a tombstone', async () => {
  const b = bridge();
  const requestId = 'add-eggs-once-001';
  const first = ok(await b.raw('add_pantry_item', { requestId, expectedRevision: 5, name: 'Tofu', storage: 'fridge' }));
  const again = ok(await b.raw('add_pantry_item', { requestId, expectedRevision: 6, name: 'Tofu', storage: 'fridge' }));
  assert.equal(again.replayed, true);
  assert.deepEqual(Object.assign({}, again, { replayed: undefined }), Object.assign({}, first, { replayed: undefined }));
  assert.equal(b.fake.store.fields.pantry.filter((p) => p.name === 'Tofu').length, 1);

  const record = b.fake.requests.get(requestId);
  assert.ok(record, 'request record kept');
  const undo = ok(await b.raw('undo_request', { requestId, undoRequestId: 'undo-add-tofu-01', expectedRevision: 6 }));
  assert.deepEqual(undo.removed, [{ collection: 'pantry', id: NEW_ID }]);
  assert.deepEqual(undo.restored, []);
  assert.equal(stored(b, NEW_ID), undefined);
  assert.equal(b.fake.store.fields.deletions.pantry[NEW_ID], CLOCK_ISO, 'removed with a tombstone');
  assert.equal(b.fake.store.fields.pantry.length, seed().pantry.length);
});

// ── update_pantry_item ──────────────────────────────────────────────────────────────────────

test('update_pantry_item corrects storage and dates and states back the recomputed safety', async () => {
  const b = bridge();
  const moved = ok(await b.call('update_pantry_item', { ingredientId: 'eggs-1', storage: 'counter', boughtDate: '2026-11-25' }));
  assert.equal(moved.unchanged, false);
  assert.equal(moved.storageSource, 'given');
  assert.equal(moved.thawed, false);
  assert.deepEqual(stored(b, 'eggs-1'), Object.assign({}, EGGS, { storage: 'counter', purchaseDate: '2026-11-25', updatedAt: CLOCK_ISO }));
  assert.deepEqual(moved.item, Object.assign({}, await inventoryItem(b, 'eggs-1'), { shelfLifeDays: 35 }));

  const dated = ok(await b.call('update_pantry_item', { ingredientId: 'eggs-1', printedDate: '2026-12-10', printedDateKind: 'best-before' }));
  assert.equal(dated.storageSource, 'recorded');
  assert.equal(stored(b, 'eggs-1').dateMode, 'expiry');
  assert.equal(stored(b, 'eggs-1').printedDateKind, 'best-before');
  assert.equal(dated.item.safety.daysLeft, 13);

  // A new printed date without a kind is a use-by (the stricter default).
  ok(await b.call('update_pantry_item', { ingredientId: 'sauce-1', printedDate: '2027-07-01' }));
  assert.equal('printedDateKind' in stored(b, 'sauce-1'), false);
  // null clears the printed date.
  ok(await b.call('update_pantry_item', { ingredientId: 'eggs-1', printedDate: null }));
  const cleared = stored(b, 'eggs-1');
  assert.equal('expiryDate' in cleared || 'dateMode' in cleared || 'printedDateKind' in cleared, false);
  assert.equal(cleared.name, 'Eggs');
  assert.equal(cleared.quantity, 6, 'amount never changed here');
});

test('moving raw poultry from the freezer to the fridge needs the thaw day', async () => {
  const b = bridge();
  const why = await refused(b, b.call('update_pantry_item', { ingredientId: 'chicken-1', storage: 'fridge' }), 'needs_thaw_date');
  assert.match(why, /thaw reminder/);
  const thawed = ok(await b.call('update_pantry_item', { ingredientId: 'chicken-1', storage: 'fridge', thawedToday: true }));
  assert.equal(thawed.thawed, true);
  assert.equal(stored(b, 'chicken-1').purchaseDate, TODAY);
  assert.equal(thawed.item.safety.daysLeft, 2);

  const b2 = bridge();
  const dated = ok(await b2.call('update_pantry_item', { ingredientId: 'chicken-1', storage: 'fridge', boughtDate: '2026-11-26' }));
  assert.equal(stored(b2, 'chicken-1').purchaseDate, '2026-11-26');
  assert.equal(dated.item.safety.daysLeft, 1);
  // Non-protein lots move freely.
  ok(await b2.call('update_pantry_item', { ingredientId: 'eggs-1', storage: 'freezer' }));
  ok(await b2.call('update_pantry_item', { ingredientId: 'eggs-1', storage: 'fridge' }));
});

test('update_pantry_item refuses unknown and invalid records, and an unchanged value writes nothing to the user document', async () => {
  const b = bridge();
  await refused(b, b.call('update_pantry_item', { ingredientId: 'nope', storage: 'fridge' }), 'not_found');
  await refused(b, b.call('update_pantry_item', { ingredientId: 'broken-1', storage: 'freezer' }), 'invalid_record');
  const userBefore = JSON.stringify(b.fake.store);
  const same = ok(await b.call('update_pantry_item', { ingredientId: 'eggs-1', storage: 'fridge' }));
  assert.equal(same.unchanged, true);
  assert.equal(same.revision, 5);
  assert.equal(JSON.stringify(b.fake.store), userBefore);
});

test('undo_request restores an edited lot exactly, and refuses once it changed again', async () => {
  const b = bridge();
  const requestId = 'edit-chicken-0001';
  ok(await b.raw('update_pantry_item', { requestId, expectedRevision: 5, ingredientId: 'chicken-1', storage: 'fridge', thawedToday: true }));
  assert.equal(stored(b, 'chicken-1').storage, 'fridge');
  const undo = ok(await b.raw('undo_request', { requestId, undoRequestId: 'undo-edit-chick-1', expectedRevision: 6 }));
  assert.deepEqual(undo.restored, [{ collection: 'pantry', id: 'chicken-1' }]);
  assert.deepEqual(stored(b, 'chicken-1'), Object.assign({}, FROZEN_CHICKEN, { updatedAt: CLOCK_ISO }));

  const b2 = bridge();
  const second = 'edit-eggs-000001';
  ok(await b2.raw('update_pantry_item', { requestId: second, expectedRevision: 5, ingredientId: 'eggs-1', storage: 'counter' }));
  ok(await b2.call('update_pantry_item', { ingredientId: 'eggs-1', boughtDate: '2026-11-26' }));
  const message = await b2.raw('undo_request', { requestId: second, undoRequestId: 'undo-edit-eggs-01', expectedRevision: 7 });
  assert.match(text(message), /^changed_since: /);
});

// ── Pure operation ──────────────────────────────────────────────────────────────────────────

test('addPantryItem never mutates its input and mints a fresh id that avoids existing ids and tombstones', () => {
  const pantry = [{ id: NEW_ID, name: 'Old' }];
  const frozen = structuredClone(pantry);
  let calls = 0;
  const random = () => { calls += 1; return calls === 1 ? RANDOM : 0.987654321; };
  const r = pantryItems.addPantryItem(pantry, {}, { name: 'Tofu', storage: 'fridge' }, { today: TODAY, nowMs: CLOCK_MS, random });
  assert.deepEqual(pantry, frozen);
  assert.notEqual(r.record.id, NEW_ID);
  assert.match(r.record.id, /^buy_\d+_[0-9a-z]{1,5}$/);
  assert.equal(r.pantry.length, 2);
});

// ── Review fixes (STRICT review of TASK-099): edits never make unsafe protein read as safe ───

const OLD_CHICKEN = { id: 'old-chicken-1', name: 'Chicken Breast', quantity: 1, unit: 'kg', category: 'Protein', staple: false, storage: 'fridge', purchaseDate: '2026-11-20', shelfLifeDays: 2, updatedAt: '2026-11-20T00:00:00.000Z' };

function seedWith(...extra) {
  const fields = seed();
  fields.pantry.push(...extra.map((p) => structuredClone(p)));
  return fields;
}

test('M1: unknown raw protein never enters the fridge by an edit (freezer -> fridge, counter -> fridge)', async () => {
  // A freezer lot of a meat name the shared rules cannot place.
  const b = bridge();
  ok(await b.call('add_pantry_item', { name: 'Cod fillet', storage: 'freezer', boughtDate: '2026-11-01' }));
  const why = await refused(b, b.call('update_pantry_item', { ingredientId: NEW_ID, storage: 'fridge', thawedToday: true }), 'unrecognized_food');
  assert.match(why, /check the item in the app/);
  await refused(b, b.call('update_pantry_item', { ingredientId: NEW_ID, storage: 'fridge', boughtDate: TODAY }), 'unrecognized_food');

  // The reviewer's repro on a lot stored the old way (category ''): refused.
  const legacy = { id: 'thighs-1', name: 'Chicken Thighs', quantity: 1, unit: 'kg', category: '', storage: 'freezer', purchaseDate: '2026-11-01', shelfLifeDays: 7 };
  const b2 = bridge(seedWith(legacy));
  await refused(b2, b2.call('update_pantry_item', { ingredientId: 'thighs-1', storage: 'fridge', thawedToday: true }), 'unrecognized_food');

  // Counter -> fridge.
  const counter = { id: 'venison-2', name: 'Venison Steak', quantity: 1, unit: 'kg', category: '', storage: 'counter', purchaseDate: TODAY, shelfLifeDays: 7 };
  const b3 = bridge(seedWith(counter));
  await refused(b3, b3.call('update_pantry_item', { ingredientId: 'venison-2', storage: 'fridge' }), 'unrecognized_food');

  // The same repro through add_pantry_item now stores Protein (a name that reads as raw meat,
  // poultry or fish), so the thawed lot carries the 2-day poultry limit, never 7 days.
  const b4 = bridge();
  ok(await b4.call('add_pantry_item', { name: 'Chicken Thighs', storage: 'freezer', boughtDate: '2026-11-01' }));
  assert.equal(stored(b4, NEW_ID).category, 'Protein');
  const thawed = ok(await b4.call('update_pantry_item', { ingredientId: NEW_ID, storage: 'fridge', thawedToday: true }));
  assert.equal(thawed.item.safety.daysLeft, 2);
  assert.equal(thawed.item.safety.status, 'use-soon');
});

test('M2a: raw meat, poultry, fish and unknown protein are never stored on the counter (add and update)', async () => {
  const b = bridge();
  for (const args of [
    { name: 'Chicken Breast', storage: 'counter', boughtDate: TODAY },
    { name: 'Chicken Breast', storage: 'counter', boughtDate: '2026-11-20' },
    { name: 'Salmon', storage: 'counter' },
    { name: 'Venison Steak', storage: 'counter', boughtDate: TODAY }
  ]) {
    const why = await refused(b, b.call('add_pantry_item', args), 'unsafe_storage');
    assert.match(why, /check the item in the app/);
  }
  const b2 = bridge(seedWith(OLD_CHICKEN));
  await refused(b2, b2.call('update_pantry_item', { ingredientId: 'old-chicken-1', storage: 'counter' }), 'unsafe_storage');
  await refused(b2, b2.call('update_pantry_item', { ingredientId: 'chicken-1', storage: 'counter' }), 'unsafe_storage');
});

test('M2b-c: an expired fridge lot cannot be hidden by freezing it, moving it, or a later bought date', async () => {
  const b = bridge(seedWith(OLD_CHICKEN));
  const before = await inventoryItem(b, 'old-chicken-1');
  assert.equal(before.safety.status, 'expired', 'fixture: past the 2-day fridge limit');
  const frozen = await refused(b, b.call('update_pantry_item', { ingredientId: 'old-chicken-1', storage: 'freezer' }), 'past_safety_limit');
  assert.match(frozen, /does not make it safe again/);
  assert.match(frozen, /check the item in the app/);
  await refused(b, b.call('update_pantry_item', { ingredientId: 'old-chicken-1', storage: 'freezer', boughtDate: '2026-11-19' }), 'past_safety_limit');
  const later = await refused(b, b.call('update_pantry_item', { ingredientId: 'old-chicken-1', boughtDate: '2026-11-27' }), 'later_bought_date');
  assert.match(later, /check the item in the app/);
  // An earlier day is allowed (it can only make the lot read less safe).
  const earlier = ok(await b.call('update_pantry_item', { ingredientId: 'old-chicken-1', boughtDate: '2026-11-19' }));
  assert.equal(earlier.item.safety.status, 'expired');

  // A lot within its limit may be frozen; a later bought date on a frozen lot is still refused.
  const fresh = Object.assign({}, OLD_CHICKEN, { id: 'fresh-chicken-1', purchaseDate: TODAY });
  const b2 = bridge(seedWith(fresh));
  const moved = ok(await b2.call('update_pantry_item', { ingredientId: 'fresh-chicken-1', storage: 'freezer' }));
  assert.equal(moved.item.storage, 'freezer');
  await refused(b2, b2.call('update_pantry_item', { ingredientId: 'chicken-1', boughtDate: '2026-10-05' }), 'later_bought_date');
  // The thaw exit is the one exception: freezer -> fridge with the thaw day restarts the clock.
  ok(await b2.call('update_pantry_item', { ingredientId: 'chicken-1', storage: 'fridge', boughtDate: '2026-11-26' }));
});

test('M2b: a fridge lot with no known bought date cannot be frozen or given a bought date from chat', async () => {
  const undated = { id: 'undated-1', name: 'Chicken Breast', quantity: 1, unit: 'kg', category: 'Protein', storage: 'fridge', shelfLifeDays: 2 };
  const b = bridge(seedWith(undated));
  const read = await inventoryItem(b, 'undated-1');
  assert.equal(read.safety.usable, false, 'fixture: an unknown date is never usable');
  const why = await refused(b, b.call('update_pantry_item', { ingredientId: 'undated-1', storage: 'freezer' }), 'unknown_bought_date');
  assert.match(why, /check the item in the app/);
  await refused(b, b.call('update_pantry_item', { ingredientId: 'undated-1', boughtDate: TODAY }), 'unknown_bought_date');
});

test('a refused edit leaves its requestId unspent: the same requestId then applies a valid change', async () => {
  const b = bridge(seedWith(OLD_CHICKEN));
  const requestId = 'refused-then-ok-01';
  await refused(b, b.raw('update_pantry_item', { requestId, expectedRevision: 5, ingredientId: 'old-chicken-1', storage: 'freezer' }), 'past_safety_limit');
  assert.equal(b.fake.requests.has(requestId), false);
  const applied = ok(await b.raw('update_pantry_item', { requestId, expectedRevision: 5, ingredientId: 'eggs-1', storage: 'counter' }));
  assert.notEqual(applied.replayed, true, 'applied, not replayed');
  assert.equal(stored(b, 'eggs-1').storage, 'counter');
});

test('should-fix 1: a frozen prepared lot (or any long-life frozen lot) needs the thaw day and is capped at its fridge life', async () => {
  const b = bridge();
  ok(await b.call('add_pantry_item', { name: 'Frozen Minced Garlic', storage: 'freezer', prepared: true, boughtDate: '2026-09-01' }));
  assert.equal(stored(b, NEW_ID).shelfLifeDays, READY.defaultFreezerLife);
  const why = await refused(b, b.call('update_pantry_item', { ingredientId: NEW_ID, storage: 'fridge' }), 'needs_thaw_date');
  assert.match(why, /freezer shelf life/);
  await refused(b, b.call('update_pantry_item', { ingredientId: NEW_ID, storage: 'counter' }), 'unsafe_storage');
  const requestId = 'thaw-garlic-00001';
  const thawed = ok(await b.raw('update_pantry_item', { requestId, expectedRevision: 6, ingredientId: NEW_ID, storage: 'fridge', thawedToday: true }));
  assert.equal(thawed.thawed, true);
  assert.equal(stored(b, NEW_ID).shelfLifeDays, Math.min(READY.defaultFridgeLife, FoodSafety.categoryShelfLife('')));
  assert.equal(stored(b, NEW_ID).purchaseDate, TODAY);
  assert.equal(thawed.item.safety.daysLeft, READY.defaultFridgeLife);
  // Undo restores the frozen lot exactly, shelf life included.
  ok(await b.raw('undo_request', { requestId, undoRequestId: 'undo-thaw-garlic1', expectedRevision: 7 }));
  assert.equal(stored(b, NEW_ID).shelfLifeDays, READY.defaultFreezerLife);
  assert.equal(stored(b, NEW_ID).storage, 'freezer');

  // Not prepared: a frozen lot whose shelf life was lengthened is capped at the app shelf life.
  const jam = { id: 'jam-1', name: 'Grandma Jam', quantity: 1, unit: 'jar', category: '', storage: 'freezer', purchaseDate: '2026-08-01', shelfLifeDays: 120 };
  const b2 = bridge(seedWith(jam));
  await refused(b2, b2.call('update_pantry_item', { ingredientId: 'jam-1', storage: 'fridge' }), 'needs_thaw_date');
  ok(await b2.call('update_pantry_item', { ingredientId: 'jam-1', storage: 'fridge', boughtDate: '2026-11-25' }));
  assert.equal(stored(b2, 'jam-1').shelfLifeDays, FoodSafety.categoryShelfLife(''));
});

test('should-fix 2: printed dates split lots; a same-date printed lot offers only confirmNewLot', async () => {
  const printed = { id: 'milk-1', name: 'Oat Milk', quantity: 1, unit: 'L', category: '', storage: 'fridge', purchaseDate: TODAY, shelfLifeDays: 7, dateMode: 'expiry', expiryDate: '2026-12-05' };
  const b = bridge(seedWith(printed));
  const why = await refused(b, b.call('add_pantry_item', { name: 'oat milk', storage: 'fridge', printedDate: '2026-12-05' }), 'ambiguous');
  assert.match(why, /"milk-1"/);
  assert.match(why, /confirmNewLot: true/);
  assert.doesNotMatch(why, /add_stock with/);
  ok(await b.call('add_pantry_item', { name: 'Oat Milk', storage: 'fridge', printedDate: '2026-12-09' }), 'different printed date = new lot');
  // SF1: a printed date missing on either side is unknown, not different: still asked, and only a
  // separate lot is offered (add_stock has no printed-date input).
  const b2 = bridge(seedWith(printed));
  const missing = await refused(b2, b2.call('add_pantry_item', { name: 'Oat Milk', storage: 'fridge' }), 'ambiguous');
  assert.match(missing, /confirmNewLot: true/);
  assert.doesNotMatch(missing, /add_stock with/);
  ok(await b2.call('add_pantry_item', { name: 'Oat Milk', storage: 'fridge', confirmNewLot: true }));
  const b3 = bridge();
  const undated = await refused(b3, b3.call('add_pantry_item', { name: 'Eggs', printedDate: '2026-12-20' }), 'ambiguous');
  assert.doesNotMatch(undated, /add_stock with/);
});

test('should-fix 3: non-meat foods that contain a meat or fish word are not refused; neutral wording', async () => {
  const names = ['Goat cheese', 'Lamb’s lettuce', "Lamb's lettuce", 'Steak sauce', 'Oyster mushrooms', 'Tuna mayo', 'Fish balls',
    'Artichoke hearts', 'Hearts of palm'];
  for (const name of names) {
    const b = bridge();
    const result = ok(await b.call('add_pantry_item', { name, storage: 'fridge' }), name);
    assert.equal(result.item.storage, 'fridge', name);
    assert.equal(stored(b, NEW_ID).category, '', name + ': no loose category');
  }
  for (const name of ['Pork giniling', 'Hamburger patties', 'Stew meat', 'Giniling']) {
    const b = bridge();
    const why = await refused(b, b.call('add_pantry_item', { name }), 'needs_storage');
    assert.match(why, /looks like raw meat, poultry or fish, or a food the bridge cannot classify/);
    await refused(b, b.call('add_pantry_item', { name, storage: 'fridge' }), 'needs_bought_date');
  }
  // In the fridge: refused as unrecognized, or (when the app's loose match gives Protein) stored
  // with the 2-day ground-meat limit — never the 7-day default.
  for (const name of ['Hamburger patties', 'Stew meat', 'Giniling']) {
    const b = bridge();
    const message = await b.call('add_pantry_item', { name, storage: 'fridge', boughtDate: TODAY });
    if (message.result.isError) assert.match(text(message), /^unrecognized_food: /, name);
    else assert.ok(message.result.structuredContent.item.safety.daysLeft <= 2, name + ': fridge limit applied');
  }
  // "minced" alone is not a meat word.
  const b = bridge();
  ok(await b.call('add_pantry_item', { name: 'Minced Onion', storage: 'fridge' }));
});

test('should-fix 4: a name known only by an INGREDIENT_DB alias takes the alias entry category', async () => {
  const b = bridge();
  ok(await b.call('add_pantry_item', { name: 'chicken fillet', storage: 'fridge', boughtDate: TODAY }));
  assert.equal(stored(b, NEW_ID).category, 'Protein');
  const item = await inventoryItem(b, NEW_ID);
  assert.equal(item.safety.daysLeft, 2, 'poultry limit applies on the stored record');
  const b2 = bridge();
  ok(await b2.call('add_pantry_item', { name: 'itlog', storage: 'fridge' }));
  assert.equal(stored(b2, NEW_ID).category, 'Protein');
});

// ── STRICT re-review round 2 (MF1, MF2, SF1-SF3) ─────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

async function undoRefused(b, requestId, undoRequestId, expectedRevision) {
  const why = await refused(b, b.raw('undo_request', { requestId, undoRequestId, expectedRevision }), 'unsafe_restore');
  assert.match(why, /check the item in the app/);
  assert.equal(b.fake.requests.has(undoRequestId), false, 'undoRequestId unspent');
  assert.equal(b.fake.requestRecord(requestId).undoneBy, undefined, 'original request not marked undone');
  return why;
}

test('MF1: undo of a thaw is refused once the thawed lot is past its fridge limit (no write, ids unspent)', async () => {
  const b = bridge();
  b.deps.now = () => CLOCK_MS - 7 * DAY_MS; // household day 2026-11-20
  const r1 = 'thaw-chicken-r1-001';
  ok(await b.raw('update_pantry_item', { requestId: r1, expectedRevision: 5, ingredientId: 'chicken-1', storage: 'fridge', thawedToday: true }));
  assert.equal(stored(b, 'chicken-1').purchaseDate, '2026-11-20');
  b.deps.now = () => CLOCK_MS; // 2026-11-27: the thawed chicken is 5 days past its 2-day limit
  const why = await undoRefused(b, r1, 'undo-thaw-r1-00001', 6);
  assert.match(why, /past its 2-day fridge safety limit/);
  assert.equal(stored(b, 'chicken-1').storage, 'fridge', 'lot left as it is');
  // The refusal left the undo id unspent: the same undo id then undoes another, safe request.
  const r2 = 'eggs-counter-r2-001';
  ok(await b.raw('update_pantry_item', { requestId: r2, expectedRevision: 6, ingredientId: 'eggs-1', storage: 'counter' }));
  const undo = ok(await b.raw('undo_request', { requestId: r2, undoRequestId: 'undo-thaw-r1-00001', expectedRevision: 7 }));
  assert.deepEqual(undo.restored, [{ collection: 'pantry', id: 'eggs-1' }]);
});

test('MF1: undo that would move a fridge-limited bought date later is refused', async () => {
  const fresh = { id: 'chick-26', name: 'Chicken Breast', quantity: 1, unit: 'kg', category: 'Protein', storage: 'fridge', purchaseDate: '2026-11-26', shelfLifeDays: 2 };
  const b = bridge(seedWith(fresh));
  const r1 = 'date-fix-chicken-01';
  const fixed = ok(await b.raw('update_pantry_item', { requestId: r1, expectedRevision: 5, ingredientId: 'chick-26', boughtDate: '2026-11-20' }));
  assert.equal(fixed.item.safety.usable, false);
  const why = await undoRefused(b, r1, 'undo-date-fix-0001', 6);
  assert.match(why, /later bought date/);
  assert.equal(stored(b, 'chick-26').purchaseDate, '2026-11-20');
});

test('MF1: undo of a prepared thaw is refused once the thawed lot is not usable (the general rule)', async () => {
  const b = bridge();
  ok(await b.call('add_pantry_item', { name: 'Frozen Minced Garlic', storage: 'freezer', prepared: true, boughtDate: '2026-09-01' }));
  b.deps.now = () => CLOCK_MS - 7 * DAY_MS;
  const r1 = 'thaw-garlic-r1-0001';
  ok(await b.raw('update_pantry_item', { requestId: r1, expectedRevision: 6, ingredientId: NEW_ID, storage: 'fridge', thawedToday: true }));
  b.deps.now = () => CLOCK_MS;
  assert.equal((await inventoryItem(b, NEW_ID)).safety.status, 'check', 'fixture: thawed 7 days ago, 3-day life');
  const why = await undoRefused(b, r1, 'undo-garlic-r1-001', 7);
  assert.match(why, /would make it read as usable/);
});

test('MF1: safe undos still restore exactly; undo of add_pantry_item is unaffected', async () => {
  const b = bridge();
  const r1 = 'eggs-to-counter-01';
  ok(await b.raw('update_pantry_item', { requestId: r1, expectedRevision: 5, ingredientId: 'eggs-1', storage: 'counter' }));
  ok(await b.raw('undo_request', { requestId: r1, undoRequestId: 'undo-eggs-ctr-0001', expectedRevision: 6 }));
  assert.deepEqual(stored(b, 'eggs-1'), Object.assign({}, EGGS, { updatedAt: CLOCK_ISO }));
  // A printed-date correction on an ok item.
  const r2 = 'sauce-printed-0001';
  ok(await b.raw('update_pantry_item', { requestId: r2, expectedRevision: 7, ingredientId: 'sauce-1', printedDate: '2027-05-01' }));
  ok(await b.raw('undo_request', { requestId: r2, undoRequestId: 'undo-sauce-pr-0001', expectedRevision: 8 }));
  assert.deepEqual(stored(b, 'sauce-1'), Object.assign({}, SAUCE, { updatedAt: CLOCK_ISO }));
  // Same-day undo of a mistaken thaw: the thawed lot is within its limit, so it goes back.
  const r3 = 'thaw-same-day-0001';
  ok(await b.raw('update_pantry_item', { requestId: r3, expectedRevision: 9, ingredientId: 'chicken-1', storage: 'fridge', thawedToday: true }));
  ok(await b.raw('undo_request', { requestId: r3, undoRequestId: 'undo-thaw-same-001', expectedRevision: 10 }));
  assert.deepEqual(stored(b, 'chicken-1'), Object.assign({}, FROZEN_CHICKEN, { updatedAt: CLOCK_ISO }));
  // Undo of an add (a removal) a week later, even of raw poultry now past its limit.
  const b2 = bridge();
  b2.deps.now = () => CLOCK_MS - 7 * DAY_MS;
  const r4 = 'add-chicken-old-01';
  ok(await b2.raw('add_pantry_item', { requestId: r4, expectedRevision: 5, name: 'Chicken Breast', storage: 'fridge', boughtDate: '2026-11-20' }));
  b2.deps.now = () => CLOCK_MS;
  const removed = ok(await b2.raw('undo_request', { requestId: r4, undoRequestId: 'undo-add-old-00001', expectedRevision: 6 }));
  assert.equal(removed.removed.length, 1);
});

test('MF2: a frozen prepared lot whose raw life is over 90 days still needs the thaw day and gets the fridge life', async () => {
  for (const name of ['Rice', 'Peanut Butter', 'Pasta']) {
    const b = bridge();
    ok(await b.call('add_pantry_item', { name, prepared: true, storage: 'freezer' }), name);
    assert.equal(stored(b, NEW_ID).shelfLifeDays, READY.defaultFreezerLife, name);
    await refused(b, b.call('update_pantry_item', { ingredientId: NEW_ID, storage: 'fridge' }), 'needs_thaw_date');
    const thawed = ok(await b.call('update_pantry_item', { ingredientId: NEW_ID, storage: 'fridge', thawedToday: true }), name);
    assert.equal(stored(b, NEW_ID).shelfLifeDays, READY.defaultFridgeLife, name + ': capped at the ready-food fridge life');
    assert.ok(thawed.item.safety.daysLeft <= READY.defaultFridgeLife, name);
  }
});

test('MF2: a printed-date lot leaving the freezer for the fridge needs the thaw day, then is refused (never invented or cleared)', async () => {
  const b = bridge();
  ok(await b.call('add_pantry_item', { name: 'Chopped onions', prepared: true, storage: 'freezer', printedDate: '2027-02-27' }));
  await refused(b, b.call('update_pantry_item', { ingredientId: NEW_ID, storage: 'fridge' }), 'needs_thaw_date');
  const why = await refused(b, b.call('update_pantry_item', { ingredientId: NEW_ID, storage: 'fridge', thawedToday: true }), 'frozen_printed_date');
  assert.match(why, /check the item in the app/);
  assert.equal(stored(b, NEW_ID).expiryDate, '2027-02-27');
  assert.equal(stored(b, NEW_ID).storage, 'freezer');
});

test('SF1: a printed date on one side only is unknown, not different: ambiguous, offering only confirmNewLot', async () => {
  const milk = { id: 'milk-2', name: 'Milk', quantity: 1, unit: 'L', category: 'Dairy', storage: 'fridge', purchaseDate: TODAY, shelfLifeDays: 7, dateMode: 'expiry', expiryDate: '2026-12-05' };
  const b = bridge(seedWith(milk));
  const why = await refused(b, b.call('add_pantry_item', { name: 'Milk', storage: 'fridge' }), 'ambiguous');
  assert.match(why, /"milk-2"/);
  assert.match(why, /confirmNewLot: true/);
  assert.doesNotMatch(why, /add_stock with/);
  // Two different printed dates, both present: a new lot without asking.
  ok(await b.call('add_pantry_item', { name: 'Milk', storage: 'fridge', printedDate: '2026-12-09' }));
});

test('SF2: a raw meat, poultry or fish name the ingredient list does not know is stored as Protein with the shared limit', async () => {
  const names = ['Chicken wings', 'Steak', 'Turkey', 'Sausages', 'Lamb chops', 'Chicken liver', 'Rib eye', 'Spare ribs', 'Scallops',
    'Fish fillet', 'Pork mince', 'Chicken sausage'];
  for (const name of names) {
    assert.ok(FoodSafety.pantryFridgeSafety({ name, category: 'Protein', storage: 'fridge', purchaseDate: TODAY }, TODAY), name + ': shared limit');
    const b = bridge();
    await refused(b, b.call('add_pantry_item', { name }), 'needs_storage');
    await refused(b, b.call('add_pantry_item', { name, storage: 'counter', boughtDate: TODAY }), 'unsafe_storage');
    await refused(b, b.call('add_pantry_item', { name, storage: 'fridge' }), 'needs_bought_date');
    const added = ok(await b.call('add_pantry_item', { name, storage: 'fridge', boughtDate: TODAY }), name);
    if (!FoodSafety.stockIngredientEntry(name.toLowerCase())) assert.equal(stored(b, NEW_ID).category, 'Protein', name);
    assert.ok(added.item.safety.daysLeft <= 3, name + ': fridge limit applied, not the 7-day default');
    const yesterday = bridge();
    const late = ok(await yesterday.call('add_pantry_item', { name, storage: 'fridge', boughtDate: '2026-11-26' }), name);
    assert.ok(late.item.safety.daysLeft <= 2, name);
  }
  // "Pork mince" is ground meat: the 2-day limit, not the 3-day whole-cut one.
  const b = bridge();
  const mince = ok(await b.call('add_pantry_item', { name: 'Pork mince', storage: 'fridge', boughtDate: TODAY }));
  assert.equal(mince.item.safety.daysLeft, 2);
  // A name with no shared limit even as Protein is still refused in the fridge, with no rename advice.
  const why = await refused(b, b.call('add_pantry_item', { name: 'Bratwurst', storage: 'fridge', boughtDate: TODAY }), 'unrecognized_food');
  assert.doesNotMatch(why, /name as the app lists it|for example/);
  assert.match(why, /check the item in the app/);
});

test('SF3: more meat and fish words need storage, are never on the counter, and are stored as Protein; non-meat foods pass', async () => {
  const names = ['Meatballs', 'Patties', 'Burger patties', 'Bratwurst', 'Cod', 'Mackerel', 'Sliced ham', 'Ham', 'Salmon', 'Tilapia',
    'Bangus', 'Galunggong', 'Tuna steak', 'Trout fillet', 'Lapu-lapu'];
  for (const name of names) {
    const b = bridge();
    await refused(b, b.call('add_pantry_item', { name }), 'needs_storage');
    await refused(b, b.call('add_pantry_item', { name, storage: 'counter', boughtDate: TODAY }), 'unsafe_storage');
    await refused(b, b.call('add_pantry_item', { name, storage: 'freezer' }), 'needs_bought_date');
    ok(await b.call('add_pantry_item', { name, storage: 'freezer', boughtDate: TODAY }), name);
    assert.equal(stored(b, NEW_ID).category, 'Protein', name);
  }
  for (const name of ['Goat cheese', 'Steak sauce', 'Oyster mushrooms', 'Hamburger buns', 'Fish balls', 'Tuna mayo', 'Chicken stock',
    'Beef broth', 'Veggie burger patties']) {
    const b = bridge();
    ok(await b.call('add_pantry_item', { name, storage: 'fridge' }), name);
    assert.notEqual(stored(b, NEW_ID).category, 'Protein', name);
  }
});

test('MF1: undo never puts raw protein back on the counter, nor an unplaceable meat name back into the fridge', async () => {
  const counter = { id: 'ctr-chicken-1', name: 'Chicken Breast', quantity: 1, unit: 'kg', category: 'Protein', storage: 'counter', purchaseDate: TODAY, shelfLifeDays: 2 };
  const b = bridge(seedWith(counter));
  const r1 = 'ctr-to-fridge-0001';
  ok(await b.raw('update_pantry_item', { requestId: r1, expectedRevision: 5, ingredientId: 'ctr-chicken-1', storage: 'fridge' }));
  const why = await undoRefused(b, r1, 'undo-ctr-fridge-01', 6);
  assert.match(why, /on the counter/);

  // A legacy lot (category '') whose meat name has no shared fridge limit, frozen from chat.
  const legacy = { id: 'venison-3', name: 'Venison Steak', quantity: 1, unit: 'kg', category: '', storage: 'fridge', purchaseDate: TODAY, shelfLifeDays: 7 };
  const b2 = bridge(seedWith(legacy));
  const r2 = 'venison-freeze-001';
  ok(await b2.raw('update_pantry_item', { requestId: r2, expectedRevision: 5, ingredientId: 'venison-3', storage: 'freezer' }));
  const why2 = await undoRefused(b2, r2, 'undo-venison-0001', 6);
  assert.match(why2, /no shared fridge safety limit/);
});

// ── STRICT review 3 ─────────────────────────────────────────────────────────────────────────

// A refusal by update_pantry_item with an explicit requestId: zero writes and the requestId unspent.
async function updateRefused(b, args, code) {
  const requestId = nextId('r3-refused');
  const why = await refused(b, b.raw('update_pantry_item', Object.assign({ requestId, expectedRevision: b.fake.store.fields.version }, args)), code);
  assert.equal(b.fake.requests.has(requestId), false, code + ': requestId unspent');
  assert.match(why, /check the item in the app/, code + ': tells chat to have the user check the app');
  return why;
}

const PASSED_BREAST = { id: 'passed-breast-1', name: 'Chicken Breast', quantity: 1, unit: 'kg', category: 'Protein', staple: false, storage: 'fridge', purchaseDate: '2026-11-26', shelfLifeDays: 2, dateMode: 'expiry', expiryDate: '2026-11-25', updatedAt: '2026-11-26T00:00:00.000Z' };
const PASSED_THIGH = Object.assign({}, PASSED_BREAST, { id: 'passed-thigh-1', name: 'Chicken Thigh' });

test('MF-A: a passed use-by on raw protein is never cleared, moved later, made a best-before, or frozen', async () => {
  const b = bridge(seedWith(PASSED_BREAST, PASSED_THIGH));
  assert.equal((await inventoryItem(b, 'passed-breast-1')).safety.usable, false, 'fixture: the use-by has passed');
  await updateRefused(b, { ingredientId: 'passed-breast-1', printedDate: null }, 'unsafe_printed_date');
  await updateRefused(b, { ingredientId: 'passed-breast-1', printedDate: '2026-12-20' }, 'unsafe_printed_date');
  await updateRefused(b, { ingredientId: 'passed-breast-1', printedDateKind: 'best-before' }, 'unsafe_printed_date');
  const why = await updateRefused(b, { ingredientId: 'passed-thigh-1', storage: 'freezer' }, 'not_usable');
  assert.match(why, /Use-by date passed/);
  assert.equal(stored(b, 'passed-breast-1').expiryDate, '2026-11-25');
  assert.equal(stored(b, 'passed-thigh-1').storage, 'fridge');
});

test('MF-A: a printed date on in-date raw protein can move earlier, or later within its fridge limit, but not past it', async () => {
  // Bought today: the 2-day poultry limit ends 2026-11-29.
  const lot = { id: 'fresh-breast-1', name: 'Chicken Breast', quantity: 1, unit: 'kg', category: 'Protein', storage: 'fridge', purchaseDate: TODAY, shelfLifeDays: 2, dateMode: 'expiry', expiryDate: '2026-11-28' };
  const b = bridge(seedWith(lot));
  await updateRefused(b, { ingredientId: 'fresh-breast-1', printedDate: '2026-11-30' }, 'unsafe_printed_date');
  ok(await b.call('update_pantry_item', { ingredientId: 'fresh-breast-1', printedDate: '2026-11-27' }), 'earlier');
  assert.equal(stored(b, 'fresh-breast-1').expiryDate, '2026-11-27');
  const later = ok(await b.call('update_pantry_item', { ingredientId: 'fresh-breast-1', printedDate: '2026-11-29' }), 'later within the limit');
  assert.equal(later.item.safety.usable, true);
  ok(await b.call('update_pantry_item', { ingredientId: 'fresh-breast-1', printedDateKind: 'best-before' }), 'best-before within the limit');
  ok(await b.call('update_pantry_item', { ingredientId: 'fresh-breast-1', printedDate: null }), 'cleared: the fridge limit governs');
  assert.equal((await inventoryItem(b, 'fresh-breast-1')).safety.daysLeft, 2);

  // In the freezer the read has no fridge limit, so a printed date on old raw protein never moves later; clearing
  // it is made because the bought-date clock then reads stricter (past its estimate).
  const frozen = Object.assign({}, FROZEN_CHICKEN, { id: 'frozen-printed-1', dateMode: 'expiry', expiryDate: '2027-01-01' });
  const b2 = bridge(seedWith(frozen));
  await updateRefused(b2, { ingredientId: 'frozen-printed-1', printedDate: '2027-02-01' }, 'unsafe_printed_date');
  const cleared = ok(await b2.call('update_pantry_item', { ingredientId: 'frozen-printed-1', printedDate: null }), 'frozen clear');
  assert.equal(cleared.item.safety.status, 'check');
});

test('MF-A: an edit that would make a lot that is not usable, or carries a warning, read usable or clean is refused (shared with undo)', async () => {
  // Not a fridge-safety lot: a soy sauce past its best-before (check) never loses the warning by a later or cleared printed date.
  const old = Object.assign({}, SAUCE, { id: 'old-sauce-1', expiryDate: '2026-11-01' });
  const b = bridge(seedWith(old));
  assert.equal((await inventoryItem(b, 'old-sauce-1')).safety.status, 'check');
  await updateRefused(b, { ingredientId: 'old-sauce-1', printedDate: '2027-06-01' }, 'unsafe_edit');
  await updateRefused(b, { ingredientId: 'old-sauce-1', printedDate: null }, 'unsafe_edit');
  // An in-date lot still takes the same change.
  ok(await b.call('update_pantry_item', { ingredientId: 'sauce-1', printedDate: '2027-07-01' }), 'in-date sauce');
  // A frozen lot past only its quality estimate still thaws onto a fresh fridge clock.
  const thawed = ok(await b.call('update_pantry_item', { ingredientId: 'chicken-1', storage: 'fridge', thawedToday: true }), 'thaw');
  assert.equal(thawed.item.safety.usable, true);
});

test('MF-B: a frozen prepared lot keeps its 90-day signature through a printed date, so clearing it then thawing needs the thaw day', async () => {
  const b = bridge();
  ok(await b.call('add_pantry_item', { name: 'Minced garlic', storage: 'freezer', prepared: true, printedDate: '2027-03-01' }));
  assert.equal(stored(b, NEW_ID).shelfLifeDays, READY.defaultFreezerLife);
  ok(await b.call('update_pantry_item', { ingredientId: NEW_ID, printedDate: null }), 'clear the printed date');
  const requestId = nextId('r3-thaw');
  const why = await refused(b, b.raw('update_pantry_item', { requestId, expectedRevision: b.fake.store.fields.version, ingredientId: NEW_ID, storage: 'fridge' }), 'needs_thaw_date');
  assert.equal(b.fake.requests.has(requestId), false, 'requestId unspent');
  assert.match(why, /freezer shelf life/);
  const thawed = ok(await b.call('update_pantry_item', { ingredientId: NEW_ID, storage: 'fridge', thawedToday: true }), 'thaw');
  const raw = FoodSafety.INGREDIENT_DB.find((i) => i.name.toLowerCase() === 'minced garlic');
  const rawLife = raw && raw.shelfLifeDays != null ? raw.shelfLifeDays : FoodSafety.categoryShelfLife(stored(b, NEW_ID).category);
  assert.equal(stored(b, NEW_ID).shelfLifeDays, Math.min(READY.defaultFridgeLife, rawLife));
  assert.equal(stored(b, NEW_ID).purchaseDate, TODAY);
  assert.ok(thawed.item.safety.daysLeft <= READY.defaultFridgeLife);
});

test('SF-2: tocino, tapa, pata, gizzards, oxtail, rabbit, quail, eel and herring follow the name-only raw meat and fish rules', async () => {
  for (const name of ['Tocino', 'Beef tapa', 'Pata', 'Gizzards', 'Gizzard', 'Oxtail', 'Rabbit', 'Quail', 'Eel', 'Smoked herring']) {
    const b = bridge();
    await refused(b, b.call('add_pantry_item', { name }), 'needs_storage');
    await refused(b, b.call('add_pantry_item', { name, storage: 'counter', boughtDate: TODAY }), 'unsafe_storage');
    const why = await refused(b, b.call('add_pantry_item', { name, storage: 'freezer' }), 'needs_bought_date');
    assert.match(why, /has a fridge safety limit \(raw meat, poultry, fish or a cooked leftover\)/);
    if (!FoodSafety.pantryFridgeSafety({ name, category: 'Protein', storage: 'fridge', purchaseDate: TODAY }, TODAY)) {
      await refused(b, b.call('add_pantry_item', { name, storage: 'fridge', boughtDate: TODAY }), 'unrecognized_food');
    }
    ok(await b.call('add_pantry_item', { name, storage: 'freezer', boughtDate: TODAY }), name);
    assert.equal(stored(b, NEW_ID).category, 'Protein', name);
  }
  for (const name of ['Goat cheese', 'Steak sauce', 'Oyster mushrooms', 'Hamburger buns', 'Fish balls', 'Tuna mayo', 'Chicken stock',
    'Beef broth', 'Veggie burger patties', 'Vegan tocino', 'Meatless tapa', 'Eel sauce', 'Quail eggs']) {
    const b = bridge();
    ok(await b.call('add_pantry_item', { name, storage: 'fridge' }), name);
    assert.notEqual(stored(b, NEW_ID).category, 'Protein', name);
  }
  // Sardines and anchovies are left out of the name-only words: commonly canned and kept on the counter.
  for (const name of ['Sardines', 'Anchovies', 'Canned sardines']) {
    const b = bridge();
    ok(await b.call('add_pantry_item', { name, storage: 'counter' }), name);
  }
});
