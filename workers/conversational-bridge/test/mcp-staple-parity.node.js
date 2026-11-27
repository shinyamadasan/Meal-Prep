// TASK-097 (PROP-041 P2-0a): the bridge classifies staple vs non-staple exactly as the app does
// (MealPrepFoodSafety.isStaple, shared/foodSafety.js), reports `tracking` on get_inventory, and the
// quantity tools refuse presence-only lots. Lots that were refused as `ambiguous` before TASK-097
// now follow the app's answer; every Phase 1 guard (requestId, revision, undo) still applies.
import test from 'node:test';
import assert from 'node:assert/strict';
import { routeRequest } from '../src/index.js';
import { MCP_ISSUER, MCP_RESOURCE, MCP_SCOPE, MCP_WRITE_SCOPE } from '../src/mcpAuth.js';
import { classifyStaple, listInventoryWithSafety } from '../src/operations/inventory.js';
import { testEnv } from './support/fixtures.js';
import { createFakeFirestore } from './support/fakeFirestore.js';
import { withRequestId } from './support/requestIds.js';

const FoodSafety = globalThis.MealPrepFoodSafety;
const MCP_URL = 'https://localhost/mcp';
const NOW = 1_800_000_000;
const TODAY = '2026-11-27';
const AUTH_CONTEXT = () => ({
  auth: { token: 'not-a-real-token', audience: MCP_RESOURCE, expiresAt: NOW + 300, scope: [MCP_SCOPE, MCP_WRITE_SCOPE], userId: 'test-owner-subject', clientId: 'https://chatgpt.com/oauth/client.json' },
  props: { ownerSubject: 'test-owner-subject', issuer: MCP_ISSUER, resource: MCP_RESOURCE, notBefore: NOW - 1 }
});

function request(body) {
  return new Request(MCP_URL, { method: 'POST', headers: { Host: 'localhost', Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

async function responseMessage(response) {
  const raw = await response.text();
  if ((response.headers.get('Content-Type') || '').includes('text/event-stream')) {
    const line = raw.split(/\r?\n/).find((entry) => entry.startsWith('data: '));
    assert.ok(line);
    return JSON.parse(line.slice(6));
  }
  return JSON.parse(raw);
}

function bridge(pantry) {
  const fake = createFakeFirestore({ fields: {
    version: 4,
    pantry: structuredClone(pantry),
    cookedMeals: [{ id: 'meal-1', name: 'Chili' }],
    mealConsumptions: [{ id: 'history-1' }],
    shopping: [{ id: 'shopping-1' }],
    deletions: { pantry: {}, cookedMeals: {} }
  } });
  const deps = { nowSeconds: NOW, now: () => new Date(TODAY + 'T12:00:00+08:00'), fetchImpl: fake.fetch, cryptoImpl: globalThis.crypto };
  let nextId = 1;
  const call = async (name, args) => {
    const body = { jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: withRequestId(name, args) } };
    return (await responseMessage(await routeRequest(request(body), testEnv(), deps, AUTH_CONTEXT()))).result;
  };
  return { fake, call };
}

// ── Parity: the bridge's answer equals the app's for every fixture ─────────────────────────────

const PARITY_FIXTURES = [
  // Stored flag wins over name and category.
  { label: 'flag true, off-category', record: { name: 'Mystery Paste', category: 'Vegetable', staple: true } },
  { label: 'flag false, INGREDIENT_DB staple name', record: { name: 'Garlic (Bawang)', category: 'Pantry', staple: false } },
  { label: 'flag missing, INGREDIENT_DB staple by exact name, category Vegetable', record: { name: 'Garlic (Bawang)', category: 'Vegetable' } },
  { label: 'flag missing, INGREDIENT_DB staple, case-folded exact name', record: { name: 'EVAPORATED MILK', category: 'Dairy' } },
  { label: 'flag missing, INGREDIENT_DB staple by exact name, no category', record: { name: 'White Rice (Bigas)' } },
  { label: 'flag null, INGREDIENT_DB staple', record: { name: 'Onion (Sibuyas)', category: 'Vegetable', staple: null } },
  { label: 'flag "true" (string) is not a flag', record: { name: 'Custom Sauce', category: 'Condiment', staple: 'true' } },
  // Near misses: an alias or almost-the-name is NOT an exact-name match.
  { label: 'near miss: alias only', record: { name: 'Garlic', category: 'Vegetable' } },
  { label: 'near miss: trailing space', record: { name: 'Garlic (Bawang) ', category: 'Vegetable' } },
  { label: 'near miss: missing parentheses', record: { name: 'Garlic Bawang', category: 'Vegetable' } },
  // INGREDIENT_DB entry with no isStaple: falls through to the record's own category.
  { label: 'DB entry without isStaple, category Condiment', record: { name: 'Sesame Oil', category: 'Condiment' } },
  { label: 'DB entry without isStaple, category Pantry', record: { name: 'Sesame Oil', category: 'Pantry' } },
  // Category Pantry in any case.
  { label: 'category Pantry', record: { name: 'Custom Spice', category: 'Pantry' } },
  { label: 'category pantry', record: { name: 'Custom Spice', category: 'pantry' } },
  { label: 'category PANTRY', record: { name: 'Custom Spice', category: 'PANTRY' } },
  { label: 'category " Pantry " (the app does not trim)', record: { name: 'Custom Spice', category: ' Pantry ' } },
  // Empty / missing category.
  { label: 'empty category', record: { name: 'Custom Item', category: '' } },
  { label: 'null category', record: { name: 'Custom Item', category: null } },
  { label: 'no category, no name', record: {} },
  { label: 'other category', record: { name: 'Custom Cheese', category: 'Dairy' } },
  // Unreadable values the flag makes irrelevant: the app answers, so does the bridge.
  { label: 'flag true, numeric name', record: { name: 42, staple: true } },
  { label: 'flag false, map category', record: { name: 'X', category: { a: 1 }, staple: false } },
  { label: 'DB staple name, map category never read', record: { name: 'Garlic (Bawang)', category: { a: 1 } } }
];

test('parity: bridge classification equals MealPrepFoodSafety.isStaple for every fixture', () => {
  assert.equal(typeof FoodSafety.isStaple, 'function');
  for (const { label, record } of PARITY_FIXTURES) {
    const app = FoodSafety.isStaple(record);
    const bridgeAnswer = classifyStaple(record);
    assert.equal(bridgeAnswer, app ? 'staple' : 'non-staple', label);
    // The same answer reaches get_inventory's `staple` and `tracking`.
    const [item] = listInventoryWithSafety([Object.assign({ id: 'p' }, record)], TODAY);
    if (item.safety.reason !== 'invalid-record') {
      assert.equal(item.staple, app, label + ' (read)');
      assert.equal(item.tracking === 'level', app, label + ' (tracking)');
    }
  }
  // Spot-check the expected answers so the fixtures really cover both outcomes.
  const answers = Object.fromEntries(PARITY_FIXTURES.map(({ label, record }) => [label, FoodSafety.isStaple(record)]));
  assert.equal(answers['flag missing, INGREDIENT_DB staple by exact name, category Vegetable'], true);
  assert.equal(answers['near miss: alias only'], false);
  assert.equal(answers['category PANTRY'], true);
  assert.equal(answers['category " Pantry " (the app does not trim)'], false);
  assert.equal(answers['empty category'], false);
  assert.equal(answers['flag false, INGREDIENT_DB staple name'], false);
});

test('parity: a record the shared rule cannot read is invalid in the bridge, never guessed', () => {
  const unreadable = [
    { label: 'numeric category', record: { name: 'Custom', category: 5 } },
    { label: 'map category', record: { name: 'Custom', category: { label: 'Pantry' } } },
    { label: 'array category', record: { name: 'Custom', category: ['Pantry'] } },
    { label: 'numeric name', record: { name: 7, category: 'Pantry' } },
    { label: 'map name', record: { name: { text: 'Salt' } } },
    { label: 'throwing getter', record: Object.defineProperty({}, 'name', { get() { throw new Error('boom'); }, enumerable: true }) }
  ];
  for (const { label, record } of unreadable) {
    assert.throws(() => FoodSafety.isStaple(record), label + ': the app rule throws');
    assert.equal(classifyStaple(record), 'invalid', label);
  }
  for (const value of [null, undefined, 'Salt', 3, ['Salt']]) assert.equal(classifyStaple(value), 'invalid', String(value));
  // get_inventory flags it invalid-record with tracking null; the other lots still load.
  const items = listInventoryWithSafety([
    { id: 'bad', name: 'Custom', category: { label: 'Pantry' }, quantity: 1, unit: 'g', storage: 'counter' },
    { id: 'ok', name: 'Custom', category: 'Dairy', quantity: 1, unit: 'g', storage: 'counter' }
  ], TODAY);
  assert.equal(items[0].safety.reason, 'invalid-record');
  assert.equal(items[0].safety.usable, false);
  assert.equal(items[0].tracking, null);
  assert.equal(items[0].staple, false);
  assert.equal(items[1].tracking, 'quantity');
});

// ── get_inventory tracking ───────────────────────────────────────────────────────────────────

test('get_inventory reports tracking level / quantity / presence by the app\'s staple rule', async () => {
  const b = bridge([
    { id: 'garlic', name: 'Garlic (Bawang)', category: 'Vegetable', stockLevel: 'ok', storage: 'counter' },
    { id: 'salt', name: 'Salt', category: 'pantry', storage: 'counter' },
    { id: 'cheese', name: 'Custom Cheese', category: 'Dairy', quantity: 200, unit: 'g', storage: 'fridge', purchaseDate: TODAY },
    { id: 'zero', name: 'Custom Cheese', category: 'Dairy', quantity: 0, unit: 'g', storage: 'fridge', purchaseDate: TODAY },
    { id: 'soy', name: 'Custom Soy Sauce', category: 'Condiment', storage: 'counter' },
    { id: 'nounit', name: 'Custom Soy Sauce', category: 'Condiment', quantity: 2, unit: '  ', storage: 'counter' },
    { id: 'noqty', name: 'Custom Soy Sauce', category: 'Condiment', unit: 'ml', storage: 'counter' },
    { id: 'neg', name: 'Custom Soy Sauce', category: 'Condiment', quantity: -1, unit: 'ml', storage: 'counter' }
  ]);
  const result = await b.call('get_inventory', {});
  assert.equal(result.isError, undefined, JSON.stringify(result.content));
  const byId = Object.fromEntries(result.structuredContent.items.map((item) => [item.ingredientId, item]));
  assert.equal(byId.garlic.tracking, 'level');
  assert.equal(byId.garlic.staple, true);
  assert.equal(byId.salt.tracking, 'level');
  assert.equal(byId.cheese.tracking, 'quantity');
  assert.equal(byId.cheese.staple, false);
  assert.equal(byId.zero.tracking, 'quantity');
  assert.equal(byId.soy.tracking, 'presence');
  assert.equal(byId.soy.inStock, true);
  assert.equal(byId.nounit.tracking, 'presence');
  assert.equal(byId.noqty.tracking, 'presence');
  assert.equal(byId.neg.tracking, 'presence');
  assert.equal(b.fake.counters.commits, 0);
});

test('get_inventory description explains the three tracking kinds', async () => {
  const b = bridge([]);
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
  const message = await responseMessage(await routeRequest(request(body), testEnv(), { nowSeconds: NOW, fetchImpl: b.fake.fetch }, AUTH_CONTEXT()));
  const tool = message.result.tools.find((entry) => entry.name === 'get_inventory');
  assert.match(tool.description, /"level"/);
  assert.match(tool.description, /"quantity"/);
  assert.match(tool.description, /"presence"/);
  assert.match(tool.description, /never invent an amount/);
  assert.deepEqual(tool.outputSchema.properties.items.items.properties.tracking.anyOf
    ? tool.outputSchema.properties.items.items.properties.tracking.anyOf.flatMap((s) => s.enum || [s.type]).sort()
    : tool.outputSchema.properties.items.items.properties.tracking.enum.slice().sort(),
  ['level', 'null', 'presence', 'quantity'].sort());
  for (const name of ['set_inventory_quantity', 'consume_stock', 'add_stock']) {
    const quantityTool = message.result.tools.find((entry) => entry.name === name);
    assert.match(quantityTool.description, /presence_only/, name);
    assert.doesNotMatch(quantityTool.description, /On ambiguous/, name);
  }
});

// ── Per-tool: previously ambiguous lots now follow the app's answer ───────────────────────────

// No staple flag, category Dairy, not an INGREDIENT_DB name: `ambiguous` before TASK-097,
// non-staple with a quantity in the app.
const FORMER_AMBIGUOUS = { id: 'cheese', name: 'Custom Cheese', category: 'Dairy', quantity: 500, unit: 'g', storage: 'freezer', purchaseDate: null, marker: 'keep' };
// No staple flag, category Vegetable, INGREDIENT_DB staple: `ambiguous` before, staple in the app.
const FORMER_AMBIGUOUS_STAPLE = { id: 'garlic', name: 'Garlic (Bawang)', category: 'Vegetable', stockLevel: 'empty', storage: 'counter' };
// The app calls it non-staple and it has no amount: presence-only.
const PRESENCE = { id: 'soy', name: 'Custom Soy Sauce', category: 'Condiment', storage: 'counter' };

test('set_inventory_quantity accepts a formerly ambiguous quantity lot', async () => {
  const b = bridge([FORMER_AMBIGUOUS]);
  const result = await b.call('set_inventory_quantity', { ingredientId: 'cheese', quantity: 300, expectedUnit: 'g', expectedRevision: 4 });
  assert.equal(result.isError, undefined, JSON.stringify(result.content));
  assert.equal(b.fake.store.fields.pantry[0].quantity, 300);
  assert.equal(b.fake.store.fields.pantry[0].marker, 'keep');
  assert.equal(b.fake.store.fields.version, 5);
  assert.equal(b.fake.requests.size, 1);
});

test('consume_stock accepts a formerly ambiguous quantity lot (partial and exact-zero removal)', async () => {
  const b = bridge([FORMER_AMBIGUOUS]);
  const partial = await b.call('consume_stock', { ingredientId: 'cheese', quantity: 0.2, expectedUnit: 'kg', expectedRevision: 4 });
  assert.equal(partial.isError, undefined, JSON.stringify(partial.content));
  assert.equal(b.fake.store.fields.pantry[0].quantity, 300);
  const all = await b.call('consume_stock', { ingredientId: 'cheese', quantity: 300, expectedUnit: 'g', expectedRevision: 5 });
  assert.equal(all.isError, undefined, JSON.stringify(all.content));
  assert.equal(all.structuredContent.removed, true);
  assert.deepEqual(b.fake.store.fields.pantry, []);
  assert.ok(b.fake.store.fields.deletions.pantry.cheese, 'non-staple removal writes a tombstone');
});

test('add_stock accepts a formerly ambiguous quantity lot', async () => {
  const b = bridge([FORMER_AMBIGUOUS]);
  const result = await b.call('add_stock', { ingredientId: 'cheese', quantity: 250, expectedUnit: 'g', expectedRevision: 4 });
  assert.equal(result.isError, undefined, JSON.stringify(result.content));
  assert.equal(b.fake.store.fields.pantry[0].quantity, 750);
  assert.equal(b.fake.store.fields.pantry[0].stockLevel, undefined, 'a non-staple gets no stock level');
});

test('mark_out_of_stock follows the app: formerly ambiguous non-staple is removed, INGREDIENT_DB staple is kept empty', async () => {
  const b = bridge([FORMER_AMBIGUOUS, Object.assign({}, FORMER_AMBIGUOUS_STAPLE, { stockLevel: 'ok' })]);
  const removed = await b.call('mark_out_of_stock', { ingredientId: 'cheese', expectedRevision: 4 });
  assert.equal(removed.isError, undefined, JSON.stringify(removed.content));
  assert.equal(removed.structuredContent.removed, true);
  assert.ok(b.fake.store.fields.deletions.pantry.cheese);
  const kept = await b.call('mark_out_of_stock', { ingredientId: 'garlic', expectedRevision: 5 });
  assert.equal(kept.isError, undefined, JSON.stringify(kept.content));
  assert.equal(kept.structuredContent.removed, false);
  assert.deepEqual(b.fake.store.fields.pantry.map((p) => [p.id, p.stockLevel]), [['garlic', 'empty']]);
  assert.equal(b.fake.store.fields.deletions.pantry.garlic, undefined, 'a staple is never tombstoned');
});

test('mark_in_stock accepts a formerly ambiguous INGREDIENT_DB staple and still refuses a non-staple', async () => {
  const b = bridge([FORMER_AMBIGUOUS_STAPLE, PRESENCE]);
  const filled = await b.call('mark_in_stock', { ingredientId: 'garlic', expectedRevision: 4 });
  assert.equal(filled.isError, undefined, JSON.stringify(filled.content));
  assert.equal(b.fake.store.fields.pantry[0].stockLevel, 'full');
  const before = JSON.stringify(b.fake.store);
  const refused = await b.call('mark_in_stock', { ingredientId: 'soy', expectedRevision: 5 });
  assert.equal(refused.isError, true);
  assert.match(refused.content[0].text, /is not a staple/);
  assert.equal(JSON.stringify(b.fake.store), before);
});

test('quantity tools on an INGREDIENT_DB staple keep the staple rules (refused for a count, never removed)', async () => {
  const b = bridge([Object.assign({}, FORMER_AMBIGUOUS_STAPLE, { quantity: 3, unit: 'pcs', stockLevel: 'ok' })]);
  const before = JSON.stringify(b.fake.store);
  const set = await b.call('set_inventory_quantity', { ingredientId: 'garlic', quantity: 2, expectedUnit: 'pcs', expectedRevision: 4 });
  assert.match(set.content[0].text, /staple tracked by stock level/);
  const partial = await b.call('consume_stock', { ingredientId: 'garlic', quantity: 1, expectedUnit: 'pcs', expectedRevision: 4 });
  assert.match(partial.content[0].text, /Partial staple consumption is unsupported/);
  assert.equal(JSON.stringify(b.fake.store), before);
  assert.equal(b.fake.requests.size, 0);
});

// ── Per-tool: presence-only lots are refused by the quantity tools ──────────────────────────────

test('quantity tools refuse a presence-only lot: validation error, zero writes, no request record', async () => {
  const calls = [
    ['set_inventory_quantity', { ingredientId: 'soy', quantity: 2, expectedUnit: 'ml', expectedRevision: 4 }],
    ['consume_stock', { ingredientId: 'soy', quantity: 2, expectedUnit: 'ml', expectedRevision: 4 }],
    ['add_stock', { ingredientId: 'soy', quantity: 2, expectedUnit: 'ml', expectedRevision: 4 }]
  ];
  const presenceRows = [
    PRESENCE,
    Object.assign({}, PRESENCE, { quantity: 2 }),
    Object.assign({}, PRESENCE, { unit: 'ml' }),
    Object.assign({}, PRESENCE, { quantity: 2, unit: '' })
  ];
  for (const row of presenceRows) {
    for (const [name, args] of calls) {
      const b = bridge([row]);
      const before = JSON.stringify(b.fake.store);
      const result = await b.call(name, args);
      assert.equal(result.isError, true, name);
      assert.match(result.content[0].text, /^presence_only:/, name);
      assert.match(result.content[0].text, /ask the user how much/, name);
      assert.equal(JSON.stringify(b.fake.store), before, name + ' wrote');
      assert.equal(b.fake.counters.commits, 0, name);
      assert.equal(b.fake.requests.size, 0, name + ' recorded a request');
    }
  }
});

test('a refused presence-only call does not spend its requestId', async () => {
  const b = bridge([PRESENCE, FORMER_AMBIGUOUS]);
  const requestId = 'presence-retry-01';
  const refused = await b.call('set_inventory_quantity', { requestId, ingredientId: 'soy', quantity: 2, expectedUnit: 'ml', expectedRevision: 4 });
  assert.match(refused.content[0].text, /^presence_only:/);
  assert.equal(b.fake.requestRecord(requestId), undefined);
});

test('write tools refuse an unreadable record as invalid_record with zero writes', async () => {
  const bad = { id: 'bad', name: 'Custom', category: { label: 'Pantry' }, quantity: 5, unit: 'g', storage: 'counter' };
  const calls = [
    ['set_inventory_quantity', { ingredientId: 'bad', quantity: 2, expectedUnit: 'g', expectedRevision: 4 }],
    ['consume_stock', { ingredientId: 'bad', quantity: 2, expectedUnit: 'g', expectedRevision: 4 }],
    ['add_stock', { ingredientId: 'bad', quantity: 2, expectedUnit: 'g', expectedRevision: 4 }],
    ['mark_out_of_stock', { ingredientId: 'bad', expectedRevision: 4 }],
    ['mark_in_stock', { ingredientId: 'bad', expectedRevision: 4 }]
  ];
  for (const [name, args] of calls) {
    const b = bridge([bad]);
    const before = JSON.stringify(b.fake.store);
    const result = await b.call(name, args);
    assert.equal(result.isError, true, name);
    assert.match(result.content[0].text, /^invalid_record:/, name);
    assert.equal(JSON.stringify(b.fake.store), before, name);
    assert.equal(b.fake.requests.size, 0, name);
  }
});

// ── Phase 1 guards still apply to the newly accepted lots ──────────────────────────────────────

test('formerly ambiguous lot: stale revision conflicts, a retried requestId replays, undo restores', async () => {
  const b = bridge([FORMER_AMBIGUOUS]);
  const stale = await b.call('set_inventory_quantity', { ingredientId: 'cheese', quantity: 300, expectedUnit: 'g', expectedRevision: 3 });
  assert.match(stale.content[0].text, /^revision_conflict:/);
  assert.equal(b.fake.counters.commits, 0);

  const args = { requestId: 'cheese-set-0001', ingredientId: 'cheese', quantity: 300, expectedUnit: 'g', expectedRevision: 4 };
  const first = await b.call('set_inventory_quantity', args);
  assert.equal(first.isError, undefined, JSON.stringify(first.content));
  const replay = await b.call('set_inventory_quantity', args);
  assert.equal(replay.structuredContent.replayed, true);
  assert.equal(b.fake.counters.commits, 1);
  assert.equal(b.fake.store.fields.version, 5);

  const undone = await b.call('undo_request', { requestId: 'cheese-set-0001', undoRequestId: 'cheese-undo-0001', expectedRevision: 5 });
  assert.equal(undone.isError, undefined, JSON.stringify(undone.content));
  assert.equal(b.fake.store.fields.pantry[0].quantity, 500);
});
