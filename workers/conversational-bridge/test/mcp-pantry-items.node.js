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
  await refused(b, b.call('add_pantry_item', { name: 'Venison Steak' }), 'needs_storage');
  await refused(b, b.call('add_pantry_item', { name: 'Venison Steak', storage: 'fridge', boughtDate: TODAY }), 'unrecognized_food');
  // Known by alias: the shared rules apply the poultry limit, so it is accepted.
  ok(await b.call('add_pantry_item', { name: 'chicken fillet', storage: 'fridge', boughtDate: TODAY }));
  // Freezer: no fridge clock is at stake.
  ok(await b.call('add_pantry_item', { name: 'Venison Steak', storage: 'freezer', boughtDate: TODAY, confirmNewLot: true }));
});

// ── Prepared ingredients ────────────────────────────────────────────────────────────────────

test('prepared ingredients take the ready-food life for their storage, never longer than the raw item, and deduct nothing', async () => {
  const b = bridge();
  const pantryBefore = structuredClone(b.fake.store.fields.pantry);
  const paste = ok(await b.call('add_pantry_item', { name: 'Frozen Minced Garlic', storage: 'freezer', quantity: 200, unit: 'g', prepared: true }));
  assert.equal(paste.prepared, true);
  assert.equal(paste.item.name, 'Frozen Minced Garlic', 'name used as given');
  assert.equal(stored(b, NEW_ID).shelfLifeDays, Math.min(READY.defaultFreezerLife, FoodSafety.categoryShelfLife('')));
  assert.deepEqual(b.fake.store.fields.pantry.slice(0, pantryBefore.length), pantryBefore, 'raw lots untouched (D2)');

  const b2 = bridge();
  ok(await b2.call('add_pantry_item', { name: 'Garlic (Bawang)', storage: 'freezer', prepared: true }));
  assert.equal(stored(b2, NEW_ID).shelfLifeDays, Math.min(READY.defaultFreezerLife, 180));

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
