import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { routeRequest } from '../src/index.js';
import { MCP_ISSUER, MCP_RESOURCE, MCP_SCOPE, MCP_WRITE_SCOPE } from '../src/mcpAuth.js';
import { testEnv } from './support/fixtures.js';
import { createFakeFirestore } from './support/fakeFirestore.js';
import { withRequestId } from './support/requestIds.js';

const MCP_URL = 'https://localhost/mcp';
const NOW = 1_800_000_000;
const VALID = { ingredientId: 'chicken', quantity: 250, expectedUnit: 'g', expectedRevision: 4 };
const FRESH_ROW = { id: 'chicken', name: 'Chicken', quantity: 500, unit: 'g', staple: false, purchaseDate: null, category: 'protein', storage: 'freezer', marker: 'keep' };
const AUTH_CONTEXT = (scope = [MCP_WRITE_SCOPE]) => ({
  auth: { token: 'not-a-real-token', audience: MCP_RESOURCE, expiresAt: NOW + 300, scope, userId: 'test-owner-subject', clientId: 'https://chatgpt.com/oauth/client.json' },
  props: { ownerSubject: 'test-owner-subject', issuer: MCP_ISSUER, resource: MCP_RESOURCE, notBefore: NOW - 1 }
});

function request(body) {
  return new Request(MCP_URL, { method: 'POST', headers: { Host: 'localhost', Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
function requestRaw(body) {
  return new Request(MCP_URL, { method: 'POST', headers: { Host: 'localhost', Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' }, body });
}
function rpc(id, method, params = {}) { return { jsonrpc: '2.0', id, method, params }; }
function toolCall(id, name, args = {}) { return rpc(id, 'tools/call', { name, arguments: withRequestId(name, args) }); }

async function responseMessage(response) {
  const raw = await response.text();
  if ((response.headers.get('Content-Type') || '').includes('text/event-stream')) {
    const line = raw.split(/\r?\n/).find((entry) => entry.startsWith('data: '));
    assert.ok(line);
    return JSON.parse(line.slice(6));
  }
  return JSON.parse(raw);
}

function bridge(row = FRESH_ROW) {
  const fake = createFakeFirestore({ fields: {
    version: 4,
    pantry: [structuredClone(row)],
    cookedMeals: [{ id: 'meal-1', name: 'Chili' }],
    mealConsumptions: [{ id: 'history-1' }],
    shopping: [{ id: 'shopping-1' }],
    recipes: [{ id: 'recipe-1' }],
    deletions: { pantry: {}, cookedMeals: {} }
  } });
  const env = testEnv();
  const deps = { nowSeconds: NOW, fetchImpl: fake.fetch, cryptoImpl: globalThis.crypto };
  let nextId = 1;
  const call = (name, args, scope = [MCP_WRITE_SCOPE]) => routeRequest(
    request(toolCall(nextId++, name, args)), env, deps, AUTH_CONTEXT(scope)
  );
  return { fake, env, deps, call };
}

function countingDeps(doc) {
  const calls = { token: 0, read: 0, write: 0, fetch: 0 };
  return {
    calls,
    deps: {
      nowSeconds: NOW,
      getFirestoreAccessToken: async () => { calls.token += 1; return 'fake-token'; },
      getUserDocument: async () => { calls.read += 1; return doc; },
      getRequestRecord: async () => null, commitRequestWrite: async () => { calls.write += 1; throw new Error('write reached'); },
      fetchImpl: async () => { calls.fetch += 1; throw new Error('fetch reached'); }
    }
  };
}

test('tools/list exposes exactly twelve tools and add_stock strict schema, scope, and delta annotations', async () => {
  const b = bridge();
  const message = await responseMessage(await routeRequest(request(rpc(1, 'tools/list')), b.env, b.deps, AUTH_CONTEXT()));
  const tools = message.result.tools;
  assert.deepEqual(tools.map((tool) => tool.name), [
    'get_inventory', 'get_ready_food', 'record_ready_food', 'consume_ready_food',
    'mark_out_of_stock', 'mark_in_stock', 'set_inventory_quantity', 'consume_stock', 'add_stock', 'add_pantry_item', 'update_pantry_item', 'undo_request'
  ]);
  const tool = tools.find((entry) => entry.name === 'add_stock');
  assert.equal(tool.inputSchema.additionalProperties, false);
  assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), ['boughtDate', 'expectedRevision', 'expectedUnit', 'ingredientId', 'quantity', 'requestId']);
  assert.equal(tool.inputSchema.properties.quantity.type, 'number');
  assert.equal(tool.inputSchema.properties.expectedRevision.type, 'integer');
  assert.deepEqual(tool.securitySchemes, [{ type: 'oauth2', scopes: ['mealprep:write'] }]);
  assert.deepEqual(tool._meta.securitySchemes, [{ type: 'oauth2', scopes: ['mealprep:write'] }]);
  assert.deepEqual(tool.annotations, { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false });
  assert.match(tool.description, /get_inventory/);
  assert.match(tool.description, /exact amount/i);
  assert.match(tool.description, /NOT safe to replay/);
  assert.equal(b.fake.store.fields.version, 4);
});

test('invalid schema and non-finite JSON quantity reject before Firestore access', async () => {
  const doc = { revision: 4, updateTime: 't', pantry: [], cookedMeals: [], deletions: {} };
  const inputs = [
    { ...VALID, ingredientId: '' }, { ...VALID, ingredientId: '  ' }, { ...VALID, quantity: 0 },
    { ...VALID, quantity: -1 }, { ...VALID, quantity: '1' }, { ...VALID, expectedUnit: '' },
    { ...VALID, expectedUnit: ' ' }, { ...VALID, expectedRevision: 4.5 }, { ...VALID, expectedRevision: -1 },
    { ...VALID, uid: 'owner' }, { ...VALID, path: 'users/x' }, { ...VALID, collection: 'users' },
    { ...VALID, storage: 'freezer' }
  ];
  for (const args of inputs) {
    const { calls, deps } = countingDeps(doc);
    const message = await responseMessage(await routeRequest(request(toolCall(1, 'add_stock', args)), testEnv(), deps, AUTH_CONTEXT()));
    assert.equal(message.result.isError, true, JSON.stringify(args));
    assert.deepEqual(calls, { token: 0, read: 0, write: 0, fetch: 0 });
  }

  const { calls, deps } = countingDeps(doc);
  const body = '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"add_stock","arguments":{"ingredientId":"chicken","quantity":1e999,"expectedUnit":"g","expectedRevision":4}}}';
  const message = await responseMessage(await routeRequest(requestRaw(body), testEnv(), deps, AUTH_CONTEXT()));
  assert.equal(message.result.isError, true);
  assert.deepEqual(calls, { token: 0, read: 0, write: 0, fetch: 0 });
});

test('write scope is required before Firestore access', async () => {
  const doc = { revision: 4, updateTime: 't', pantry: [], cookedMeals: [], deletions: {} };
  const { calls, deps } = countingDeps(doc);
  const message = await responseMessage(await routeRequest(request(toolCall(1, 'add_stock', VALID)), testEnv(), deps, AUTH_CONTEXT([MCP_SCOPE])));
  assert.equal(message.result.isError, true);
  assert.match(message.result._meta['mcp/www_authenticate'][0], /scope="mealprep:write"/);
  assert.deepEqual(calls, { token: 0, read: 0, write: 0, fetch: 0 });
});

test('a failed persistence attempt is not retried', async () => {
  const doc = { revision: 4, updateTime: 't', pantry: [FRESH_ROW], cookedMeals: [], deletions: { pantry: {} } };
  const { calls, deps } = countingDeps(doc);
  deps.patchUserDocument = async () => { calls.write += 1; throw new Error('sensitive firestore detail'); };
  const message = await responseMessage(await routeRequest(request(toolCall(1, 'add_stock', VALID)), testEnv(), deps, AUTH_CONTEXT()));
  assert.equal(message.result.isError, true);
  assert.doesNotMatch(JSON.stringify(message), /sensitive firestore detail/);
  assert.deepEqual(calls, { token: 1, read: 1, write: 1, fetch: 0 });
  assert.equal(doc.revision, 4);
  assert.equal(doc.pantry[0].quantity, 500);
});

test('precision loss and numeric overflow fail without changing the document or retrying', async () => {
  const cases = [
    [Number.MAX_SAFE_INTEGER - 1, 0.1],
    [Number.MAX_VALUE, Number.MAX_VALUE],
    [Number.MAX_SAFE_INTEGER, 1]
  ];
  for (const [storedQuantity, quantity] of cases) {
    const doc = {
      revision: 4,
      updateTime: 't',
      pantry: [{ ...structuredClone(FRESH_ROW), quantity: storedQuantity }],
      cookedMeals: [{ id: 'meal-1', name: 'Chili' }],
      mealConsumptions: [{ id: 'history-1' }],
      shopping: [{ id: 'shopping-1' }],
      recipes: [{ id: 'recipe-1' }],
      deletions: { pantry: {}, cookedMeals: {} }
    };
    const before = structuredClone(doc);
    const { calls, deps } = countingDeps(doc);
    const message = await responseMessage(await routeRequest(
      request(toolCall(1, 'add_stock', { ...VALID, quantity })), testEnv(), deps, AUTH_CONTEXT()
    ));
    assert.equal(message.result.isError, true);
    assert.match(message.result.content[0].text, /represent|precision|range|safely/i);
    assert.deepEqual(doc, before);
    assert.deepEqual(calls, { token: 1, read: 1, write: 0, fetch: 0 });
  }
});

test('add_stock adds server-side, preserves lot metadata, increments revision once, and leaves other state unchanged', async () => {
  const b = bridge();
  const unrelated = { id: 'milk', name: 'Milk', quantity: 2, unit: 'L', staple: false, note: 'unchanged' };
  b.fake.store.fields.pantry.push(unrelated);
  const untouched = structuredClone({ cookedMeals: b.fake.store.fields.cookedMeals, mealConsumptions: b.fake.store.fields.mealConsumptions, shopping: b.fake.store.fields.shopping, recipes: b.fake.store.fields.recipes, deletions: b.fake.store.fields.deletions });
  const message = await responseMessage(await b.call('add_stock', VALID));
  assert.equal(message.result.structuredContent.item.quantity, 750);
  assert.equal(message.result.structuredContent.revision, 5);
  assert.equal(b.fake.store.fields.pantry[0].id, 'chicken');
  assert.equal(b.fake.store.fields.pantry[0].purchaseDate, null);
  assert.equal(b.fake.store.fields.pantry[0].storage, 'freezer');
  assert.deepEqual(message.result.structuredContent.lot, { boughtDate: null, storage: 'freezer', storageSource: 'recorded' });
  assert.equal(b.fake.store.fields.pantry[0].marker, 'keep');
  assert.deepEqual(b.fake.store.fields.pantry[1], unrelated);
  assert.deepEqual({ cookedMeals: b.fake.store.fields.cookedMeals, mealConsumptions: b.fake.store.fields.mealConsumptions, shopping: b.fake.store.fields.shopping, recipes: b.fake.store.fields.recipes, deletions: b.fake.store.fields.deletions }, untouched);
  assert.equal(b.fake.store.fields.version, 5);
});

test('supported metric delta, staple restock, stale revision, and absent/tombstone rows behave safely', async () => {
  const metric = bridge({ ...FRESH_ROW, quantity: 1, unit: 'kg' });
  const converted = await responseMessage(await metric.call('add_stock', { ...VALID, quantity: 500, expectedUnit: 'g' }));
  assert.equal(converted.result.structuredContent.item.quantity, 1.5);

  const staple = bridge({ id: 'rice', name: 'Rice', quantity: 2, unit: 'kg', staple: true, stockLevel: 'empty', storage: 'counter', suggestDismissed: true });
  const restocked = await responseMessage(await staple.call('add_stock', { ingredientId: 'rice', quantity: 500, expectedUnit: 'g', expectedRevision: 4 }));
  assert.equal(restocked.result.structuredContent.item.quantity, 2.5);
  assert.equal(restocked.result.structuredContent.item.stockLevel, 'full');
  assert.equal('suggestDismissed' in staple.fake.store.fields.pantry[0], false);

  const staleDoc = { revision: 4, updateTime: 't', pantry: [FRESH_ROW], cookedMeals: [], deletions: { pantry: {} } };
  const staleCounts = countingDeps(staleDoc);
  const staleMessage = await responseMessage(await routeRequest(request(toolCall(1, 'add_stock', { ...VALID, expectedRevision: 3 })), testEnv(), staleCounts.deps, AUTH_CONTEXT()));
  assert.equal(staleMessage.result.isError, true);
  assert.match(staleMessage.result.content[0].text, /^revision_conflict:/);
  assert.deepEqual(staleCounts.calls, { token: 1, read: 1, write: 0, fetch: 0 });
  assert.equal(staleDoc.revision, 4);

  for (const [rows, tombstones] of [[[], {}], [[FRESH_ROW], { chicken: 'deleted' }]]) {
    const missing = bridge();
    missing.fake.store.fields.pantry = rows;
    missing.fake.store.fields.deletions.pantry = tombstones;
    const before = structuredClone(missing.fake.store.fields);
    const message = await responseMessage(await missing.call('add_stock', VALID));
    assert.equal(message.result.isError, true);
    assert.deepEqual(missing.fake.store.fields, before);
  }
});

// TASK-094 clocks. Asia/Manila is UTC+8 with no daylight saving.
const MANILA_JUST_AFTER_MIDNIGHT = Date.UTC(2026, 10, 26, 16, 30); // Manila 2026-11-27 00:30, UTC 2026-11-26
const MANILA_LATE_EVENING = Date.UTC(2026, 10, 27, 15, 30); // Manila 2026-11-27 23:30, UTC 2026-11-27
const MANILA_NEXT_DAY_EARLY = Date.UTC(2026, 10, 27, 17, 0); // Manila 2026-11-28 01:00, UTC 2026-11-27
const RAW_CHICKEN = { id: 'chicken', name: 'Chicken thighs', quantity: 500, unit: 'g', staple: false, category: 'protein', storage: 'fridge', purchaseDate: '2026-11-27' };

function clockBridge(row, instant) {
  const b = bridge(row);
  b.deps.now = () => instant;
  return b;
}

function text(message) {
  return message.result.content[0].text;
}

test('unit mismatch, unsupported units, expired, check or printed-date lots, and staple-only stock fail without writes or request records', async () => {
  const cases = [
    [{ ...FRESH_ROW, unit: 'g' }, { ...VALID, expectedUnit: 'ml' }],
    [{ ...FRESH_ROW, unit: 'g' }, { ...VALID, expectedUnit: 'cup' }],
    [{ ...FRESH_ROW, purchaseDate: '2026-11-17', shelfLifeDays: 3 }, VALID],
    [{ ...FRESH_ROW, dateMode: 'expiry', expiryDate: '2027-01-01' }, VALID],
    [{ ...RAW_CHICKEN, purchaseDate: '2026-11-20' }, { ...VALID, boughtDate: '2026-11-20' }],
    [{ ...RAW_CHICKEN, purchaseDate: null }, VALID],
    [{ ...FRESH_ROW, name: 'Mystery item', storage: null }, VALID],
    [{ id: 'rice', name: 'Rice', staple: true, stockLevel: 'empty' }, { ...VALID, ingredientId: 'rice' }],
    // TASK-094 review: storage the read calls unreadable, or not exactly fridge/freezer/counter.
    [{ ...RAW_CHICKEN, storage: {} }, { ...VALID, boughtDate: '2026-11-27' }],
    [{ ...RAW_CHICKEN, storage: 'Fridge' }, { ...VALID, boughtDate: '2026-11-27' }]
  ];
  for (const [row, args] of cases) {
    const b = clockBridge(row, MANILA_LATE_EVENING);
    const before = structuredClone(b.fake.store.fields);
    const message = await responseMessage(await b.call('add_stock', args));
    assert.equal(message.result.isError, true, JSON.stringify(row));
    assert.deepEqual(b.fake.store.fields, before);
    assert.equal(b.fake.requests.size, 0, 'a refusal commits no request record');
  }
});

test('refused lots tell chat to record the new purchase separately in the app', async () => {
  for (const row of [
    { ...FRESH_ROW, dateMode: 'expiry', expiryDate: '2027-01-01' },
    { ...RAW_CHICKEN, purchaseDate: '2026-11-20' },
    { ...FRESH_ROW, name: 'Mystery item', storage: null }
  ]) {
    const b = clockBridge(row, MANILA_LATE_EVENING);
    const message = await responseMessage(await b.call('add_stock', { ...VALID, boughtDate: row.purchaseDate || undefined }));
    assert.equal(message.result.isError, true);
    assert.match(text(message), /record the new purchase separately in the app/);
    assert.equal(b.fake.store.fields.version, 4);
    assert.equal(b.fake.requests.size, 0);
  }
});

test('fridge safety lot: missing boughtDate is needs_bought_date, a different day is refused, the same day merges and is stated back', async () => {
  const missing = clockBridge(RAW_CHICKEN, MANILA_LATE_EVENING);
  const asked = await responseMessage(await missing.call('add_stock', VALID));
  assert.equal(asked.result.isError, true);
  assert.match(text(asked), /^needs_bought_date: /);
  assert.match(text(asked), /Ask the user/);
  assert.match(text(asked), /"today" or "just bought"/);
  assert.equal(missing.fake.store.fields.version, 4);
  assert.equal(missing.fake.requests.size, 0);

  const different = clockBridge(RAW_CHICKEN, MANILA_LATE_EVENING);
  const refused = await responseMessage(await different.call('add_stock', { ...VALID, boughtDate: '2026-11-26' }));
  assert.equal(refused.result.isError, true);
  assert.match(text(refused), /record the new purchase separately in the app/);
  assert.equal(different.fake.store.fields.version, 4);
  assert.equal(different.fake.requests.size, 0);

  const same = clockBridge(RAW_CHICKEN, MANILA_LATE_EVENING);
  const merged = await responseMessage(await same.call('add_stock', { ...VALID, boughtDate: '2026-11-27' }));
  assert.equal(merged.result.isError, undefined);
  assert.equal(merged.result.structuredContent.item.quantity, 750);
  assert.deepEqual(merged.result.structuredContent.lot, { boughtDate: '2026-11-27', storage: 'fridge', storageSource: 'recorded' });
  assert.equal(same.fake.store.fields.pantry[0].purchaseDate, '2026-11-27');
  assert.equal(same.fake.store.fields.version, 5);
});

test('household-day boundary: "today" in Manila is accepted while UTC is still yesterday; a Manila tomorrow is rejected before Firestore', async () => {
  // 00:30 in Manila on 2026-11-27 is still 2026-11-26 in UTC: a lot bought "today" is not future.
  const early = clockBridge(RAW_CHICKEN, MANILA_JUST_AFTER_MIDNIGHT);
  const merged = await responseMessage(await early.call('add_stock', { ...VALID, boughtDate: '2026-11-27' }));
  assert.equal(merged.result.isError, undefined, JSON.stringify(merged));
  assert.equal(merged.result.structuredContent.item.quantity, 750);

  // 23:30 in Manila: 2026-11-28 is tomorrow in both zones; it is rejected before any Firestore access.
  const doc = { revision: 4, updateTime: 't', pantry: [RAW_CHICKEN], cookedMeals: [], deletions: { pantry: {} } };
  for (const [instant, boughtDate] of [[MANILA_LATE_EVENING, '2026-11-28'], [MANILA_JUST_AFTER_MIDNIGHT, '2026-11-28']]) {
    const { calls, deps } = countingDeps(doc);
    deps.now = () => instant;
    const message = await responseMessage(await routeRequest(request(toolCall(1, 'add_stock', { ...VALID, boughtDate })), testEnv(), deps, AUTH_CONTEXT()));
    assert.equal(message.result.isError, true);
    assert.match(text(message), /after today \(2026-11-27/);
    assert.deepEqual(calls, { token: 0, read: 0, write: 0, fetch: 0 });
  }
});

test('household-day boundary: a poultry lot is "Use today" on its last Manila day and refused once Manila reaches the next day (UTC still the last day)', async () => {
  const lot = { ...RAW_CHICKEN, purchaseDate: '2026-11-25' };
  const lastDay = clockBridge(lot, MANILA_LATE_EVENING);
  const read = await responseMessage(await lastDay.call('get_inventory', {}, [MCP_SCOPE]));
  assert.equal(read.result.structuredContent.items[0].safety.label, 'Use today');
  const merged = await responseMessage(await lastDay.call('add_stock', { ...VALID, boughtDate: '2026-11-25', expectedRevision: 4 }));
  assert.equal(merged.result.isError, undefined, JSON.stringify(merged));
  assert.equal(merged.result.structuredContent.item.quantity, 750);

  const nextDay = clockBridge(lot, MANILA_NEXT_DAY_EARLY);
  const refused = await responseMessage(await nextDay.call('add_stock', { ...VALID, boughtDate: '2026-11-25' }));
  assert.equal(refused.result.isError, true);
  assert.match(text(refused), /Past safe fridge time/);
  assert.match(text(refused), /record the new purchase separately in the app/);
  assert.equal(nextDay.fake.store.fields.version, 4);
  assert.equal(nextDay.fake.requests.size, 0);
});

test('boughtDate shape is enforced by the schema and the calendar before Firestore; an invalid household time zone fails closed', async () => {
  const doc = { revision: 4, updateTime: 't', pantry: [RAW_CHICKEN], cookedMeals: [], deletions: { pantry: {} } };
  for (const boughtDate of ['2026-11-2', '27-11-2026', '2026-02-30', 'today', 20261127, null]) {
    const { calls, deps } = countingDeps(doc);
    deps.now = () => MANILA_LATE_EVENING;
    const message = await responseMessage(await routeRequest(request(toolCall(1, 'add_stock', { ...VALID, boughtDate })), testEnv(), deps, AUTH_CONTEXT()));
    assert.equal(message.result.isError, true, String(boughtDate));
    assert.deepEqual(calls, { token: 0, read: 0, write: 0, fetch: 0 });
  }
  const { calls, deps } = countingDeps(doc);
  const message = await responseMessage(await routeRequest(
    request(toolCall(1, 'add_stock', { ...VALID, boughtDate: '2026-11-27' })), { ...testEnv(), HOUSEHOLD_TIME_ZONE: 'Not/AZone' }, deps, AUTH_CONTEXT()
  ));
  assert.equal(message.result.isError, true);
  assert.equal(text(message), 'The inventory stock could not be increased.');
  assert.deepEqual(calls, { token: 0, read: 0, write: 0, fetch: 0 });
});

test('boughtDate is a hashed business argument: same id + same date replays, same id + another date is request_id_reused', async () => {
  const b = clockBridge(RAW_CHICKEN, MANILA_LATE_EVENING);
  const args = { ...VALID, requestId: 'bought-date-01', boughtDate: '2026-11-27' };
  const first = await responseMessage(await b.call('add_stock', args));
  assert.equal(first.result.isError, undefined);
  const replay = await responseMessage(await b.call('add_stock', args));
  assert.equal(replay.result.structuredContent.replayed, true);
  assert.deepEqual(replay.result.structuredContent.lot, { boughtDate: '2026-11-27', storage: 'fridge', storageSource: 'recorded' });
  const storeAfterFirst = JSON.stringify(b.fake.store);
  for (const changed of [{ ...args, boughtDate: '2026-11-26' }, { ...args, boughtDate: undefined }]) {
    const reused = await responseMessage(await b.call('add_stock', changed));
    assert.equal(reused.result.isError, true);
    assert.match(text(reused), /^request_id_reused: /);
  }
  assert.equal(JSON.stringify(b.fake.store), storeAfterFirst);
  assert.equal(b.fake.store.fields.pantry[0].quantity, 750, 'added exactly once');
});

test('add/add and add/consume, add/set, add/mark-out races permit only one guarded write', async () => {
  const races = [
    ['add_stock', { ...VALID, quantity: 20 }],
    ['consume_stock', { ...VALID, quantity: 20 }],
    ['set_inventory_quantity', { ingredientId: 'chicken', quantity: 450, expectedUnit: 'g', expectedRevision: 4 }],
    ['mark_out_of_stock', { ingredientId: 'chicken', expectedRevision: 4 }]
  ];
  for (const [otherTool, otherArgs] of races) {
    const b = bridge();
    const responses = await Promise.all([
      b.call('add_stock', VALID).then(responseMessage),
      b.call(otherTool, otherArgs).then(responseMessage)
    ]);
    assert.equal(responses.filter((response) => response.result.isError === undefined).length, 1, otherTool);
    assert.equal(responses.filter((response) => response.result.isError && /^revision_conflict:/.test(response.result.content[0].text)).length, 1, otherTool);
    assert.equal(b.fake.store.fields.version, 5, otherTool);
  }
});

test('mcp.js keeps add_stock as a thin adapter', async () => {
  const source = await readFile(new URL('../src/mcp.js', import.meta.url), 'utf8');
  assert.match(source, /inventory\.addStock\(/);
  const handler = source.slice(source.indexOf('async function addStockTool'), source.indexOf('async function markOutOfStockTool'));
  assert.doesNotMatch(handler, /convertQuantity|classifyStaple|stockLevel\s*===|category\s*===|new Date\(|pantry\.(filter|map|splice|push)\(|toGrams|getUnitConversion|normalizeUnit/);
});
