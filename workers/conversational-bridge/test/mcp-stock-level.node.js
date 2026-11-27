// TASK-098 (PROP-041 P2-3 + P2-0b, owner decision D1): set_stock_level for staples, makeStaple for
// an item recorded without an amount, and set_inventory_quantity's `unit` for the same items. Every
// change is one requestId-guarded commit with a request record, and undo_request puts it back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { routeRequest } from '../src/index.js';
import { MCP_ISSUER, MCP_RESOURCE, MCP_SCOPE, MCP_WRITE_SCOPE } from '../src/mcpAuth.js';
import * as inventory from '../src/operations/inventory.js';
import { testEnv } from './support/fixtures.js';
import { createFakeFirestore, simulateAppWrite } from './support/fakeFirestore.js';

const NOW = 1_800_000_000;
const CLOCK_MS = Date.parse('2026-11-27T03:04:05.678Z');
const CLOCK_ISO = new Date(CLOCK_MS).toISOString();
const OWNER = 'test-owner-subject';
const STAMP = '2026-11-20T00:00:00.000Z';

// A flagged staple, a staple by INGREDIENT_DB name only, a staple with no level, a counted item,
// three presence-only items (nothing, a quantity without a unit, a unit without a quantity) and a
// presence-only raw protein.
const RICE = { id: 'rice', name: 'Rice', staple: true, stockLevel: 'full', category: 'grains', storage: 'counter', updatedAt: STAMP };
const GARLIC = { id: 'garlic', name: 'Garlic (Bawang)', category: 'Vegetable', stockLevel: 'ok', storage: 'counter', updatedAt: STAMP };
const OIL = { id: 'oil', name: 'Cooking Oil', staple: true, category: 'Pantry', updatedAt: STAMP };
const EGGS = { id: 'eggs', name: 'Eggs', quantity: 6, unit: 'pcs', staple: false, category: 'dairy', storage: 'fridge', updatedAt: STAMP };
const SALT = { id: 'salt', name: 'Custom Salt', category: 'Condiment', storage: 'counter', marker: 'keep', updatedAt: STAMP };
const PAPRIKA = { id: 'paprika', name: 'Custom Paprika', category: 'Spice', quantity: 2, storage: 'counter', updatedAt: STAMP };
const SOY = { id: 'soy', name: 'Custom Soy Sauce', category: 'Condiment', unit: 'ml', storage: 'counter', updatedAt: STAMP };
const CHICKEN = { id: 'chicken', name: 'Chicken Thigh', category: 'Protein', staple: false, updatedAt: STAMP };

function seed() {
  return {
    version: 3,
    pantry: [RICE, GARLIC, OIL, EGGS, SALT, PAPRIKA, SOY, CHICKEN].map((r) => structuredClone(r)),
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

let counter = 0;
function rid(prefix) {
  counter += 1;
  return (prefix + '-' + String(counter).padStart(6, '0')).slice(0, 128);
}

function bridge(fields = seed()) {
  const fake = createFakeFirestore({ fields });
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return fake.fetch(url, init);
  };
  const deps = { nowSeconds: NOW, now: () => CLOCK_MS, fetchImpl, cryptoImpl: globalThis.crypto };
  const call = (name, args) => routeRequest(rpc('tools/call', { name, arguments: args }), testEnv(), deps, context()).then(messageOf);
  const rev = () => fake.store.fields.version;
  const level = (args) => call('set_stock_level', Object.assign({ requestId: rid('lvl'), expectedRevision: rev() }, args));
  const setQty = (args) => call('set_inventory_quantity', Object.assign({ requestId: rid('qty'), expectedRevision: rev() }, args));
  const undo = (requestId) => call('undo_request', { requestId, undoRequestId: rid('undo'), expectedRevision: rev() });
  const snapshot = () => JSON.stringify({ store: fake.store, requests: [...fake.requests.entries()] });
  return { fake, calls, call, level, setQty, undo, snapshot, rev };
}

function text(message) {
  return message.result.content && message.result.content[0] && message.result.content[0].text;
}

function ok(message, label) {
  assert.equal(message.result.isError, undefined, (label || '') + ': ' + text(message));
  return message.result.structuredContent;
}

function find(b, id) {
  return b.fake.store.fields.pantry.find((r) => String(r.id) === id);
}

function withoutUpdatedAt(record) {
  const copy = Object.assign({}, record);
  delete copy.updatedAt;
  return copy;
}

// Refused with ZERO writes: no commit, user document and request records byte-identical.
async function assertRefused(b, promise, pattern) {
  const before = b.snapshot();
  const commits = b.fake.counters.commits;
  const message = await promise;
  assert.equal(message.result.isError, true, 'expected a refusal: ' + JSON.stringify(message.result));
  assert.match(text(message), pattern);
  assert.equal(b.fake.counters.commits, commits, 'no commit');
  assert.equal(b.snapshot(), before, 'nothing written');
  return text(message);
}

async function tools() {
  const response = await routeRequest(rpc('tools/list', {}), testEnv(), { nowSeconds: NOW }, context());
  return (await messageOf(response)).result.tools;
}

// ── Public contract ──────────────────────────────────────────────────────────────────────────

test('tools/list: set_stock_level has a strict schema, write scope, the four levels and makeStaple true-only', async () => {
  const tool = (await tools()).find((t) => t.name === 'set_stock_level');
  assert.ok(tool);
  assert.equal(tool.inputSchema.additionalProperties, false);
  assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), ['expectedRevision', 'ingredientId', 'level', 'makeStaple', 'requestId']);
  assert.deepEqual([...tool.inputSchema.required].sort(), ['expectedRevision', 'ingredientId', 'level', 'requestId']);
  assert.deepEqual(tool.inputSchema.properties.level.enum, ['full', 'ok', 'low', 'empty']);
  assert.equal(tool.inputSchema.properties.makeStaple.const, true);
  assert.deepEqual(tool.securitySchemes, [{ type: 'oauth2', scopes: ['mealprep:write'] }]);
  assert.deepEqual(tool._meta.securitySchemes, [{ type: 'oauth2', scopes: ['mealprep:write'] }]);
  assert.deepEqual(tool.annotations, { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false });
  for (const key of ['previousLevel', 'level', 'converted', 'unchanged', 'item']) assert.ok(tool.outputSchema.required.includes(key), key);
  assert.ok(!tool.outputSchema.required.includes('replayed'));
  for (const phrase of [/makeStaple: true/, /ONLY when the user says/, /never on your own initiative/, /one item per call/,
    /presence_only/, /quantity_tracked/, /invalid_record/, /never removed/, /previousLevel/, /mark_in_stock/, /mark_out_of_stock/,
    /requestId is required/, /revision_conflict/]) {
    assert.match(tool.description, phrase);
  }
});

test('tools/list: set_inventory_quantity advertises an optional unit from the inventory unit list; get_inventory explains conversions', async () => {
  const list = await tools();
  const tool = list.find((t) => t.name === 'set_inventory_quantity');
  assert.ok(!tool.inputSchema.required.includes('unit'));
  assert.deepEqual(tool.inputSchema.properties.unit.enum, ['g', 'kg', 'ml', 'L', 'pcs', 'pieces', 'can', 'pack', 'bunches', 'cloves', 'stalks', 'tbsp', 'tsp']);
  assert.match(tool.description, /200 g of paprika/);
  assert.match(tool.description, /unit_not_allowed/);
  const read = list.find((t) => t.name === 'get_inventory');
  assert.match(read.description, /set_stock_level/);
  assert.match(read.description, /makeStaple: true/);
  assert.match(read.description, /never convert one on your own initiative/);
});

test('schema: a bad level, makeStaple false, an unknown key or a missing requestId fail before any Firestore access', async () => {
  const base = { ingredientId: 'rice', level: 'low', requestId: 'schema-0001', expectedRevision: 3 };
  for (const args of [
    Object.assign({}, base, { level: 'half' }),
    Object.assign({}, base, { level: 'LOW' }),
    Object.assign({}, base, { makeStaple: false }),
    Object.assign({}, base, { makeStaple: 'yes' }),
    Object.assign({}, base, { staple: true }),
    Object.assign({}, base, { requestId: undefined }),
    Object.assign({}, base, { expectedRevision: undefined })
  ]) {
    const b = bridge();
    const message = await b.call('set_stock_level', args);
    assert.equal(message.result.isError, true, JSON.stringify(args));
    assert.equal(b.calls.length, 0, JSON.stringify(args) + ': no Firestore access');
  }
});

// ── set_stock_level on staples ───────────────────────────────────────────────────────────────

test('sets a staple level and states back the item, previous level and new level', async () => {
  const b = bridge();
  const requestId = 'rice-low-0001';
  const result = ok(await b.level({ requestId, ingredientId: 'rice', level: 'low' }));
  assert.equal(result.revision, 4);
  assert.equal(result.previousLevel, 'full');
  assert.equal(result.level, 'low');
  assert.equal(result.unchanged, false);
  assert.equal(result.converted, false);
  assert.equal(result.item.ingredientId, 'rice');
  assert.equal(result.item.name, 'Rice');
  assert.equal(result.item.stockLevel, 'low');
  assert.equal(result.item.staple, true);
  assert.equal(result.item.inStock, true);
  const rice = find(b, 'rice');
  assert.deepEqual(withoutUpdatedAt(rice), Object.assign(withoutUpdatedAt(RICE), { stockLevel: 'low' }), 'only the level changes');
  assert.notEqual(rice.updatedAt, STAMP);
  assert.equal(b.rev(), 4);
  const record = b.fake.requestRecord(requestId);
  assert.equal(record.tool, 'set_stock_level');
  assert.deepEqual(record.before.pantry, [RICE]);
  assert.deepEqual(record.after.pantry, [rice]);
  assert.deepEqual(record.added, {});
});

test('every level works; empty keeps the record (no removal, no tombstone) and reads as out of stock', async () => {
  const b = bridge();
  for (const level of ['ok', 'low', 'empty', 'full', 'empty']) {
    const result = ok(await b.level({ ingredientId: 'rice', level }), level);
    assert.equal(find(b, 'rice').stockLevel, level);
    assert.equal(result.item.inStock, level !== 'empty');
  }
  assert.ok(find(b, 'rice'), 'still listed');
  assert.deepEqual(b.fake.store.fields.deletions.pantry, {});
  const read = ok(await b.call('get_inventory', {}));
  const rice = read.items.find((i) => i.ingredientId === 'rice');
  assert.equal(rice.tracking, 'level');
  assert.equal(rice.stockLevel, 'empty');
  assert.equal(rice.safety.usable, false);
});

test('the same level is a no-op: unchanged, user document untouched, request record still committed', async () => {
  const b = bridge();
  const before = JSON.stringify(b.fake.store.fields);
  const requestId = 'rice-same-001';
  const result = ok(await b.level({ requestId, ingredientId: 'rice', level: 'full' }));
  assert.equal(result.unchanged, true);
  assert.equal(result.previousLevel, 'full');
  assert.equal(result.level, 'full');
  assert.equal(result.revision, 3);
  assert.equal(JSON.stringify(b.fake.store.fields), before);
  const record = b.fake.requestRecord(requestId);
  assert.equal(record.revisionBefore, 3);
  assert.equal(record.revisionAfter, 3);
  // Retry of the same request replays; undo has nothing to put back.
  const replay = ok(await b.call('set_stock_level', { requestId, ingredientId: 'rice', level: 'full', expectedRevision: 3 }));
  assert.equal(replay.replayed, true);
  const undo = await b.undo(requestId);
  assert.match(text(undo), /^nothing_to_undo: /);
});

test('a staple by the app rule only (INGREDIENT_DB name, no flag) and a staple with no level both work', async () => {
  const b = bridge();
  const garlic = ok(await b.level({ ingredientId: 'garlic', level: 'low' }));
  assert.equal(garlic.previousLevel, 'ok');
  assert.equal(find(b, 'garlic').staple, undefined, 'no flag is written for a staple by name');
  const oil = ok(await b.level({ ingredientId: 'oil', level: 'ok' }));
  assert.equal(oil.previousLevel, null);
  assert.equal(oil.converted, false);
  assert.equal(find(b, 'oil').stockLevel, 'ok');
});

test('makeStaple on an item that is already a staple is accepted and changes only the level', async () => {
  const b = bridge();
  const result = ok(await b.level({ ingredientId: 'garlic', level: 'empty', makeStaple: true }));
  assert.equal(result.converted, false);
  assert.equal(find(b, 'garlic').staple, undefined);
  assert.equal(find(b, 'garlic').stockLevel, 'empty');
});

test('mark_in_stock and mark_out_of_stock still work unchanged as aliases for full and empty', async () => {
  const b = bridge();
  const out = ok(await b.call('mark_out_of_stock', { requestId: rid('out'), ingredientId: 'rice', expectedRevision: 3 }));
  assert.equal(out.removed, false);
  assert.equal(find(b, 'rice').stockLevel, 'empty');
  const back = ok(await b.call('mark_in_stock', { requestId: rid('in'), ingredientId: 'rice', expectedRevision: 4 }));
  assert.equal(back.unchanged, false);
  assert.equal(find(b, 'rice').stockLevel, 'full');
  assert.deepEqual(Object.keys(out).sort(), ['item', 'ok', 'removed', 'revision', 'unchanged']);
  assert.deepEqual(Object.keys(back).sort(), ['item', 'ok', 'revision', 'unchanged']);
});

// ── makeStaple: a presence-only item becomes a staple ────────────────────────────────────────

test('makeStaple turns a presence item into a staple at the level; every other field is kept', async () => {
  const b = bridge();
  const requestId = 'salt-staple-01';
  const result = ok(await b.level({ requestId, ingredientId: 'salt', level: 'full', makeStaple: true }));
  assert.equal(result.converted, true);
  assert.equal(result.previousLevel, null);
  assert.equal(result.level, 'full');
  assert.equal(result.item.staple, true);
  const salt = find(b, 'salt');
  assert.deepEqual(withoutUpdatedAt(salt), Object.assign(withoutUpdatedAt(SALT), { staple: true, stockLevel: 'full' }));
  assert.equal(inventory.classifyStaple(salt), 'staple');
  const read = ok(await b.call('get_inventory', {}));
  assert.equal(read.items.find((i) => i.ingredientId === 'salt').tracking, 'level');
  assert.deepEqual(b.fake.requestRecord(requestId).before.pantry, [SALT]);
});

test('makeStaple on presence items with a stray quantity or unit keeps those fields and never adds storage or dates (raw protein included)', async () => {
  const b = bridge();
  ok(await b.level({ ingredientId: 'paprika', level: 'low', makeStaple: true }));
  assert.deepEqual(withoutUpdatedAt(find(b, 'paprika')), Object.assign(withoutUpdatedAt(PAPRIKA), { staple: true, stockLevel: 'low' }));
  ok(await b.level({ ingredientId: 'soy', level: 'ok', makeStaple: true }));
  assert.deepEqual(withoutUpdatedAt(find(b, 'soy')), Object.assign(withoutUpdatedAt(SOY), { staple: true, stockLevel: 'ok' }));
  // Stored staple:false is the user's earlier answer; makeStaple is their new, explicit one.
  ok(await b.level({ ingredientId: 'chicken', level: 'full', makeStaple: true }));
  const chicken = find(b, 'chicken');
  assert.deepEqual(withoutUpdatedAt(chicken), Object.assign(withoutUpdatedAt(CHICKEN), { staple: true, stockLevel: 'full' }));
  for (const key of ['storage', 'purchaseDate', 'expiryDate', 'dateMode', 'shelfLifeDays']) assert.equal(chicken[key], undefined, key);
});

test('a presence item without makeStaple is refused as presence_only: zero writes, requestId not spent', async () => {
  const b = bridge();
  const requestId = 'salt-nomake-1';
  const message = await assertRefused(b, b.level({ requestId, ingredientId: 'salt', level: 'full' }), /^presence_only: /);
  assert.match(message, /Only if the user says it is a staple/);
  assert.match(message, /set_inventory_quantity with unit/);
  assert.equal(b.fake.requestRecord(requestId), undefined);
});

test('a counted item is refused as quantity_tracked, with or without makeStaple: zero writes', async () => {
  const b = bridge();
  const plain = await assertRefused(b, b.level({ ingredientId: 'eggs', level: 'low' }), /^quantity_tracked: /);
  assert.match(plain, /not a staple/);
  const make = await assertRefused(b, b.level({ ingredientId: 'eggs', level: 'full', makeStaple: true }), /^quantity_tracked: /);
  assert.match(make, /keeps its count/);
  assert.equal(b.fake.requests.size, 0);
});

test('an unreadable record is refused as invalid_record and an unknown id as not_found: zero writes', async () => {
  for (const bad of [
    { id: 'odd', name: 'Odd', staple: true, stockLevel: 'plenty' },
    { id: 'odd', name: 42, category: 'Pantry', stockLevel: 'ok' },
    { id: 'odd', name: 'Odd', category: 'Condiment', quantity: 'lots' }
  ]) {
    const fields = seed();
    fields.pantry.push(bad);
    const b = bridge(fields);
    await assertRefused(b, b.level({ ingredientId: 'odd', level: 'ok', makeStaple: true }), /^invalid_record: /);
  }
  const b = bridge();
  await assertRefused(b, b.level({ ingredientId: 'nope', level: 'ok' }), /^not_found: /);
});

test('a stale expectedRevision is revision_conflict with zero writes', async () => {
  const b = bridge();
  await assertRefused(b, b.level({ ingredientId: 'rice', level: 'low', expectedRevision: 2 }), /^revision_conflict: /);
});

// ── set_inventory_quantity with unit: a presence-only item becomes counted ───────────────────

test('"we have 200 g of paprika": a presence item records quantity and unit, then reads as tracking quantity', async () => {
  const b = bridge();
  const requestId = 'paprika-200g1';
  const result = ok(await b.setQty({ requestId, ingredientId: 'salt', quantity: 200, unit: 'g', expectedUnit: 'g' }));
  assert.equal(result.item.quantity, 200);
  assert.equal(result.item.unit, 'g');
  assert.deepEqual(withoutUpdatedAt(find(b, 'salt')), Object.assign(withoutUpdatedAt(SALT), { quantity: 200, unit: 'g' }));
  const read = ok(await b.call('get_inventory', {}));
  assert.equal(read.items.find((i) => i.ingredientId === 'salt').tracking, 'quantity');
  // From now on the ordinary counted rule applies: expectedUnit only, no unit.
  ok(await b.setQty({ ingredientId: 'salt', quantity: 150, expectedUnit: 'g' }));
  await assertRefused(b, b.setQty({ ingredientId: 'salt', quantity: 150, unit: 'g', expectedUnit: 'g' }), /^unit_not_allowed: /);
  assert.deepEqual(b.fake.requestRecord(requestId).before.pantry, [SALT]);
});

test('a presence item with a stray quantity (no unit) takes the new quantity and unit', async () => {
  const b = bridge();
  ok(await b.setQty({ ingredientId: 'paprika', quantity: 50, unit: 'g', expectedUnit: 'g' }));
  assert.deepEqual(withoutUpdatedAt(find(b, 'paprika')), Object.assign(withoutUpdatedAt(PAPRIKA), { quantity: 50, unit: 'g' }));
});

test('a presence item with a stored unit keeps it: the same unit is accepted, another is unit_mismatch', async () => {
  const b = bridge();
  await assertRefused(b, b.setQty({ ingredientId: 'soy', quantity: 1, unit: 'L', expectedUnit: 'L' }), /^unit_mismatch: .*"ml"/);
  ok(await b.setQty({ ingredientId: 'soy', quantity: 250, unit: 'ml', expectedUnit: 'ml' }));
  assert.equal(find(b, 'soy').quantity, 250);
  assert.equal(find(b, 'soy').unit, 'ml');
});

test('unit must equal expectedUnit, and a raw-protein presence item gets no invented storage or date', async () => {
  const b = bridge();
  await assertRefused(b, b.setQty({ ingredientId: 'chicken', quantity: 500, unit: 'g', expectedUnit: 'kg' }), /^unit_mismatch: /);
  ok(await b.setQty({ ingredientId: 'chicken', quantity: 500, unit: 'g', expectedUnit: 'g' }));
  const chicken = find(b, 'chicken');
  assert.deepEqual(withoutUpdatedAt(chicken), Object.assign(withoutUpdatedAt(CHICKEN), { quantity: 500, unit: 'g' }));
  for (const key of ['storage', 'purchaseDate', 'expiryDate', 'dateMode', 'shelfLifeDays']) assert.equal(chicken[key], undefined, key);
});

test('refusals: unit on a counted item (unit_not_allowed), unit on a staple, and a presence item without unit (presence_only)', async () => {
  const b = bridge();
  const counted = await assertRefused(b, b.setQty({ ingredientId: 'eggs', quantity: 12, unit: 'pcs', expectedUnit: 'pcs' }), /^unit_not_allowed: /);
  assert.match(counted, /pass the stored unit as expectedUnit/);
  const staple = await assertRefused(b, b.setQty({ ingredientId: 'rice', quantity: 2, unit: 'kg', expectedUnit: 'kg' }), /staple tracked by stock level/);
  assert.match(staple, /no unit can be recorded/);
  assert.match(staple, /set_stock_level/);
  const presence = await assertRefused(b, b.setQty({ ingredientId: 'salt', quantity: 200, expectedUnit: 'g' }), /^presence_only: /);
  assert.match(presence, /ask the user how much/);
  assert.match(presence, /both unit and expectedUnit/);
  assert.equal(b.fake.requests.size, 0);
});

test('operation guard for non-schema callers: an unsupported unit is refused before the record is read', () => {
  assert.throws(() => inventory.setCountedQuantity([SALT], { ingredientId: 'salt', quantity: 1, unit: 'kilos', expectedUnit: 'kilos' }),
    (error) => error.code === 'validation_failed' && /^unsupported_unit:/.test(error.message));
  assert.throws(() => inventory.setStockLevel([RICE], { ingredientId: 'rice', level: 'half' }), /level must be one of/);
  assert.throws(() => inventory.setStockLevel([SALT], { ingredientId: 'salt', level: 'ok', makeStaple: false }), /makeStaple may only be true/);
});

// ── undo_request restores each change exactly ────────────────────────────────────────────────

async function assertUndoRestores(b, requestId, original, tool) {
  const result = ok(await b.undo(requestId), 'undo ' + requestId);
  assert.equal(result.undoneTool, tool);
  assert.deepEqual(result.restored, [{ collection: 'pantry', id: String(original.id) }]);
  assert.deepEqual(result.removed, []);
  const live = find(b, String(original.id));
  assert.deepEqual(withoutUpdatedAt(live), withoutUpdatedAt(original), 'exact prior record');
  assert.equal(live.updatedAt, CLOCK_ISO, 'restamped (D-090 addendum 2)');
  assert.deepEqual(Object.keys(live).sort(), Object.keys(original).sort(), 'no added keys left behind');
}

test('undo set_stock_level puts the previous level back', async () => {
  const b = bridge();
  ok(await b.level({ requestId: 'undo-rice-low', ingredientId: 'rice', level: 'low' }));
  await assertUndoRestores(b, 'undo-rice-low', RICE, 'set_stock_level');
  ok(await b.level({ requestId: 'undo-oil-full', ingredientId: 'oil', level: 'full' }));
  await assertUndoRestores(b, 'undo-oil-full', OIL, 'set_stock_level');
  assert.equal(find(b, 'oil').stockLevel, undefined, 'a staple that had no level gets none back');
});

test('undo makeStaple removes the staple flag and level again (the item is presence-only once more)', async () => {
  const b = bridge();
  ok(await b.level({ requestId: 'undo-salt-make', ingredientId: 'salt', level: 'full', makeStaple: true }));
  await assertUndoRestores(b, 'undo-salt-make', SALT, 'set_stock_level');
  ok(await b.level({ requestId: 'undo-chkn-make', ingredientId: 'chicken', level: 'ok', makeStaple: true }));
  await assertUndoRestores(b, 'undo-chkn-make', CHICKEN, 'set_stock_level');
  assert.equal(find(b, 'chicken').staple, false, 'the stored false flag comes back');
  const read = ok(await b.call('get_inventory', {}));
  assert.equal(read.items.find((i) => i.ingredientId === 'salt').tracking, 'presence');
});

test('undo of a presence item given a quantity and unit removes both again', async () => {
  const b = bridge();
  ok(await b.setQty({ requestId: 'undo-salt-qty1', ingredientId: 'salt', quantity: 200, unit: 'g', expectedUnit: 'g' }));
  await assertUndoRestores(b, 'undo-salt-qty1', SALT, 'set_inventory_quantity');
  ok(await b.setQty({ requestId: 'undo-papr-qty1', ingredientId: 'paprika', quantity: 50, unit: 'g', expectedUnit: 'g' }));
  await assertUndoRestores(b, 'undo-papr-qty1', PAPRIKA, 'set_inventory_quantity');
  assert.equal(find(b, 'paprika').quantity, 2);
  assert.equal(find(b, 'paprika').unit, undefined);
});

test('undo is refused (changed_since) after a later level change, and after the app changed the item; only the latest undoes', async () => {
  const b = bridge();
  ok(await b.level({ requestId: 'chain-rice-01', ingredientId: 'rice', level: 'low' }));
  ok(await b.level({ requestId: 'chain-rice-02', ingredientId: 'rice', level: 'empty' }));
  await assertRefused(b, b.undo('chain-rice-01'), /^changed_since: /);
  ok(await b.undo('chain-rice-02'));
  assert.equal(find(b, 'rice').stockLevel, 'low');

  const c = bridge();
  ok(await c.level({ requestId: 'app-salt-make', ingredientId: 'salt', level: 'full', makeStaple: true }));
  simulateAppWrite(c.fake, (fields) => { fields.pantry.find((p) => p.id === 'salt').stockLevel = 'low'; });
  await assertRefused(c, c.undo('app-salt-make'), /^changed_since: /);
});

test('a second undo of the same set_stock_level is already_undone', async () => {
  const b = bridge();
  ok(await b.level({ requestId: 'twice-rice-01', ingredientId: 'rice', level: 'ok' }));
  ok(await b.undo('twice-rice-01'));
  await assertRefused(b, b.undo('twice-rice-01'), /^already_undone: /);
});
