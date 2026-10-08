import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { routeRequest } from '../src/index.js';
import { MCP_ISSUER, MCP_RESOURCE, MCP_SCOPE, MCP_WRITE_SCOPE } from '../src/mcpAuth.js';
import { testEnv } from './support/fixtures.js';
import { createFakeFirestore } from './support/fakeFirestore.js';

const MCP_URL = 'https://localhost/mcp';
const NOW = 1_800_000_000;
const NAME = 'consume_stock';
const AUTH_CONTEXT = (scope = [MCP_WRITE_SCOPE]) => ({
  auth: { token: 'not-a-real-token', audience: MCP_RESOURCE, expiresAt: NOW + 300, scope, userId: 'test-owner-subject', clientId: 'https://chatgpt.com/oauth/client.json' },
  props: { ownerSubject: 'test-owner-subject', issuer: MCP_ISSUER, resource: MCP_RESOURCE, notBefore: NOW - 1 }
});

function request(body) {
  return new Request(MCP_URL, {
    method: 'POST',
    headers: { Host: 'localhost', Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
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

function rpc(id, method, params = {}) { return { jsonrpc: '2.0', id, method, params }; }
function toolCall(id, args) { return rpc(id, 'tools/call', { name: NAME, arguments: args }); }
const VALID = { ingredientId: 'chicken', quantity: 300, expectedUnit: 'g', expectedRevision: 4 };

function bridge(initialFields = {}) {
  const fake = createFakeFirestore({ fields: Object.assign({
    version: 4,
    pantry: [{ id: 'chicken', name: 'Chicken', quantity: 500, unit: 'g', staple: false, storage: 'fridge', marker: 'preserve' }],
    cookedMeals: [{ id: 'meal-1', name: 'Chili' }],
    mealConsumptions: [{ id: 'consume-1' }],
    shopping: [{ id: 'shop-1' }],
    recipes: [{ id: 'recipe-1' }],
    deletions: { pantry: { old: '2026-01-01T00:00:00.000Z' }, cookedMeals: { oldMeal: '2026-01-02T00:00:00.000Z' } }
  }, initialFields) });
  const env = testEnv();
  const deps = { nowSeconds: NOW, fetchImpl: fake.fetch, cryptoImpl: globalThis.crypto };
  const call = (args, scope = [MCP_WRITE_SCOPE], id = 1) => routeRequest(
    request(toolCall(id, args)), env, deps, AUTH_CONTEXT(scope)
  );
  return { fake, env, deps, call };
}

function countingDeps(doc) {
  const calls = { token: 0, read: 0, write: 0, fetch: 0 };
  const deps = {
    nowSeconds: NOW,
    getFirestoreAccessToken: async () => { calls.token += 1; return 'fake-firestore-token'; },
    getUserDocument: async () => { calls.read += 1; return doc; },
    patchUserDocument: async () => { calls.write += 1; throw new Error('write path reached'); },
    fetchImpl: async () => { calls.fetch += 1; throw new Error('external fetch reached'); }
  };
  return { calls, deps };
}

function unchangedFields(fake) {
  const { cookedMeals, mealConsumptions, shopping, recipes, deletions } = fake.store.fields;
  return { cookedMeals: structuredClone(cookedMeals), mealConsumptions: structuredClone(mealConsumptions), shopping: structuredClone(shopping), recipes: structuredClone(recipes), deletions: structuredClone(deletions) };
}

test('tools/list exposes exactly eight tools and strict consume_stock input, output, write scope, and non-idempotent annotations', async () => {
  const { fake, env, deps } = bridge();
  const response = await routeRequest(request(rpc(1, 'tools/list')), env, deps, AUTH_CONTEXT());
  const message = await responseMessage(response);
  const tools = message.result.tools;
  assert.deepEqual(tools.map((tool) => tool.name), [
    'get_inventory', 'get_ready_food', 'record_ready_food', 'consume_ready_food',
    'mark_out_of_stock', 'mark_in_stock', 'set_inventory_quantity', NAME
  ]);
  const tool = tools.find((entry) => entry.name === NAME);
  assert.equal(tool.inputSchema.additionalProperties, false);
  assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), ['expectedRevision', 'expectedUnit', 'ingredientId', 'quantity']);
  assert.equal(tool.inputSchema.properties.ingredientId.type, 'string');
  assert.equal(tool.inputSchema.properties.ingredientId.minLength, 1);
  assert.equal(tool.inputSchema.properties.quantity.type, 'number');
  assert.equal(tool.inputSchema.properties.expectedUnit.type, 'string');
  assert.equal(tool.inputSchema.properties.expectedUnit.minLength, 1);
  assert.equal(tool.inputSchema.properties.expectedRevision.type, 'integer');
  assert.equal(tool.inputSchema.properties.expectedRevision.minimum, 0);
  assert.deepEqual(tool.securitySchemes, [{ type: 'oauth2', scopes: ['mealprep:write'] }]);
  assert.deepEqual(tool._meta.securitySchemes, [{ type: 'oauth2', scopes: ['mealprep:write'] }]);
  assert.deepEqual(tool.annotations, { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false });
  assert.match(tool.description, /get_inventory/);
  assert.match(tool.description, /ask which row/i);
  assert.match(tool.description, /NOT safe to replay/);
  assert.match(tool.description, /exact amount/i);
  assert.equal(fake.store.fields.version, 4, 'tools/list must not mutate inventory');
});

test('mcp.js remains a thin adapter without unit conversion, staple classification, tombstone, or pantry-array logic', async () => {
  const source = await readFile(new URL('../src/mcp.js', import.meta.url), 'utf8');
  assert.match(source, /inventory\.consumeStock\(/);
  const handler = source.slice(source.indexOf('async function consumeStockTool'), source.indexOf('async function markOutOfStockTool'));
  assert.doesNotMatch(handler, /convertQuantity|classifyStaple|stockLevel\s*===|category\s*===|new Date\(|pantry\.(filter|map|splice|push)\(|toGrams|getUnitConversion|normalizeUnit/);
});

test('write scope is required and denied before Firestore access', async () => {
  const doc = { revision: 4, updateTime: 't', pantry: [], cookedMeals: [], deletions: {} };
  const { calls, deps } = countingDeps(doc);
  const response = await routeRequest(request(toolCall(1, VALID)), testEnv(), deps, AUTH_CONTEXT([MCP_SCOPE]));
  const message = await responseMessage(response);
  assert.equal(message.result.isError, true);
  assert.match(message.result._meta['mcp/www_authenticate'][0], /scope="mealprep:write"/);
  assert.deepEqual(calls, { token: 0, read: 0, write: 0, fetch: 0 });
});

test('strict schema rejects malformed fields and extra identity/path keys before any Firestore access', async () => {
  const validDoc = { revision: 4, updateTime: 't', pantry: [], cookedMeals: [], deletions: {} };
  const cases = [
    { ...VALID, ingredientId: '' }, { ...VALID, ingredientId: '   ' }, { ...VALID, quantity: 0 }, { ...VALID, quantity: -1 },
    { ...VALID, quantity: '3' }, { ...VALID, expectedUnit: '' }, { ...VALID, expectedUnit: '   ' },
    { ...VALID, expectedRevision: -1 }, { ...VALID, expectedRevision: 4.5 },
    { ...VALID, expectedRevision: '4' }, { ...VALID, uid: 'owner' }, { ...VALID, path: 'users/x' },
    { ...VALID, collection: 'users' }, { ...VALID, unit: 'kg' }
  ];
  for (const args of cases) {
    const { calls, deps } = countingDeps(validDoc);
    const response = await routeRequest(request(toolCall(1, args)), testEnv(), deps, AUTH_CONTEXT());
    const message = await responseMessage(response);
    assert.equal(message.result.isError, true, JSON.stringify(args));
    assert.deepEqual(calls, { token: 0, read: 0, write: 0, fetch: 0 }, JSON.stringify(args));
  }
});

test('partial same-unit consume writes the semantic delta once and leaves unrelated state unchanged', async () => {
  const b = bridge();
  const untouched = unchangedFields(b.fake);
  const message = await responseMessage(await b.call(VALID));
  assert.equal(message.result.isError, undefined, JSON.stringify(message));
  assert.deepEqual(message.result.structuredContent, {
    ok: true, revision: 5,
    item: { ingredientId: 'chicken', name: 'Chicken', quantity: 200, unit: 'g', inStock: true, staple: false, stockLevel: null, storage: 'fridge', updatedAt: message.result.structuredContent.item.updatedAt },
    removed: false
  });
  assert.equal(b.fake.store.fields.pantry[0].id, 'chicken');
  assert.equal(b.fake.store.fields.pantry[0].marker, 'preserve');
  assert.deepEqual(unchangedFields(b.fake), untouched);
  assert.equal(b.fake.store.fields.version, 5);
});

test('same-unit phrases support fractional same-unit deltas and exact g/kg and ml/L metric inputs', async () => {
  const eggs = bridge({ pantry: [{ id: 'egg-row', name: 'Eggs', quantity: 3, unit: 'pieces', staple: false }] });
  const half = await responseMessage(await eggs.call({ ingredientId: 'egg-row', quantity: 0.5, expectedUnit: 'pieces', expectedRevision: 4 }));
  assert.equal(half.result.structuredContent.item.quantity, 2.5);

  const cans = bridge({ pantry: [{ id: 'tomatoes', name: 'Tomatoes', quantity: 5, unit: 'can', staple: false }] });
  const usedCans = await responseMessage(await cans.call({ ingredientId: 'tomatoes', quantity: 2, expectedUnit: 'can', expectedRevision: 4 }));
  assert.equal(usedCans.result.structuredContent.item.quantity, 3);

  const lastEggs = bridge({ pantry: [{ id: 'eggs', name: 'Eggs', quantity: 3, unit: 'pieces', staple: false }] });
  const usedLastEggs = await responseMessage(await lastEggs.call({ ingredientId: 'eggs', quantity: 3, expectedUnit: 'pieces', expectedRevision: 4 }));
  assert.equal(usedLastEggs.result.structuredContent.removed, true);
  assert.equal(usedLastEggs.result.structuredContent.item, null);

  const milkSameUnit = bridge({ pantry: [{ id: 'milk', name: 'Milk', quantity: 1000, unit: 'ml', staple: false }] });
  const usedMilk = await responseMessage(await milkSameUnit.call({ ingredientId: 'milk', quantity: 500, expectedUnit: 'ml', expectedRevision: 4 }));
  assert.equal(usedMilk.result.structuredContent.item.quantity, 500);

  const chicken = bridge();
  const convertedMass = await responseMessage(await chicken.call({ ingredientId: 'chicken', quantity: 0.3, expectedUnit: 'kg', expectedRevision: 4 }));
  assert.equal(convertedMass.result.structuredContent.item.quantity, 200);

  const milk = bridge({ pantry: [{ id: 'milk', name: 'Milk', quantity: 1000, unit: 'ml', staple: false }] });
  const convertedVolume = await responseMessage(await milk.call({ ingredientId: 'milk', quantity: 0.5, expectedUnit: 'L', expectedRevision: 4 }));
  assert.equal(convertedVolume.result.structuredContent.item.quantity, 500);
});

test('unsupported unit and unit conversions fail with zero mutation', async () => {
  const cases = [
    { quantity: 1, expectedUnit: 'cup' },
    { quantity: 1, expectedUnit: 'pieces' },
    { quantity: 1, expectedUnit: 'ml' },
    { quantity: 1, expectedUnit: 'G' },
    { quantity: 1, expectedUnit: 'per 100g' },
    { quantity: 1, expectedUnit: 'can' }
  ];
  for (const change of cases) {
    const b = bridge();
    const before = structuredClone(b.fake.store.fields);
    const message = await responseMessage(await b.call({ ...VALID, ...change }));
    assert.equal(message.result.isError, true, JSON.stringify(change));
    assert.deepEqual(b.fake.store.fields, before, JSON.stringify(change));
  }
});

test('exact zero removes only the addressed non-staple and writes one pantry tombstone', async () => {
  const target = { id: 12.5, name: 'Chicken', quantity: 500, unit: 'g', staple: false, keep: true };
  const other = { id: 'other', name: 'Chicken', quantity: 50, unit: 'g', staple: false };
  const b = bridge({ pantry: [target, other] });
  const before = unchangedFields(b.fake);
  const message = await responseMessage(await b.call({ ingredientId: '12.5', quantity: 0.5, expectedUnit: 'kg', expectedRevision: 4 }));
  assert.equal(message.result.isError, undefined);
  assert.deepEqual(message.result.structuredContent, { ok: true, revision: 5, item: null, removed: true });
  assert.deepEqual(b.fake.store.fields.pantry, [other]);
  assert.equal(typeof b.fake.store.fields.deletions.pantry['12.5'], 'string');
  assert.deepEqual(b.fake.store.fields.deletions.pantry.old, '2026-01-01T00:00:00.000Z');
  assert.deepEqual(b.fake.store.fields.cookedMeals, before.cookedMeals);
  assert.deepEqual(b.fake.store.fields.mealConsumptions, before.mealConsumptions);
  assert.deepEqual(b.fake.store.fields.shopping, before.shopping);
  assert.deepEqual(b.fake.store.fields.recipes, before.recipes);
  assert.deepEqual(b.fake.store.fields.deletions.cookedMeals, before.deletions.cookedMeals);
});

test('exact zero staple keeps stable identity and marks stockLevel empty without a tombstone', async () => {
  const staple = { id: 'rice', name: 'Rice', quantity: 500, unit: 'g', staple: true, stockLevel: 'full', storage: 'pantry' };
  const b = bridge({ pantry: [staple] });
  const before = unchangedFields(b.fake);
  const message = await responseMessage(await b.call({ ingredientId: 'rice', quantity: 500, expectedUnit: 'g', expectedRevision: 4 }));
  assert.equal(message.result.isError, undefined);
  assert.equal(message.result.structuredContent.removed, false);
  assert.equal(message.result.structuredContent.item.stockLevel, 'empty');
  assert.equal(b.fake.store.fields.pantry[0].id, 'rice');
  assert.deepEqual(b.fake.store.fields.deletions, before.deletions);
  assert.deepEqual(unchangedFields(b.fake), before);
});

test('over-consume, partial staple, ambiguous staple, blank stored unit, and missing quantity fail without writes', async () => {
  const cases = [
    [{ id: 'chicken', name: 'Chicken', quantity: 500, unit: 'g', staple: false }, { ingredientId: 'chicken', quantity: 900, expectedUnit: 'g' }, /insufficient_stock/],
    [{ id: 'rice', name: 'Rice', quantity: 500, unit: 'g', staple: true, stockLevel: 'full' }, { ingredientId: 'rice', quantity: 300, expectedUnit: 'g' }, /partial staple consumption is unsupported/i],
    [{ id: 'x', name: 'Custom', quantity: 500, unit: 'g', category: 'Dairy' }, { ingredientId: 'x', quantity: 500, expectedUnit: 'g' }, /^ambiguous:/],
    [{ id: 'chicken', name: 'Chicken', quantity: 500, unit: '', staple: false }, { ingredientId: 'chicken', quantity: 10, expectedUnit: 'g' }, /stored unit is missing/i],
    [{ id: 'chicken', name: 'Chicken', quantity: null, unit: 'g', staple: false }, { ingredientId: 'chicken', quantity: 10, expectedUnit: 'g' }, /stored quantity is missing or invalid/i]
  ];
  for (const [row, delta, expected] of cases) {
    const b = bridge({ pantry: [row] });
    const before = structuredClone(b.fake.store.fields);
    const message = await responseMessage(await b.call({ ...delta, expectedRevision: 4 }));
    assert.equal(message.result.isError, true);
    assert.match(message.result.content[0].text, expected);
    assert.deepEqual(b.fake.store.fields, before);
  }
});

test('stale revision fails before a write and never retries', async () => {
  const doc = { revision: 4, updateTime: 't', pantry: [{ id: 'chicken', quantity: 500, unit: 'g', staple: false }], cookedMeals: [], deletions: {} };
  const { calls, deps } = countingDeps(doc);
  const response = await routeRequest(request(toolCall(1, { ...VALID, expectedRevision: 3 })), testEnv(), deps, AUTH_CONTEXT());
  const message = await responseMessage(response);
  assert.equal(message.result.isError, true);
  assert.match(message.result.content[0].text, /^revision_conflict:/);
  assert.deepEqual(calls, { token: 1, read: 1, write: 0, fetch: 0 });
  assert.deepEqual(doc.pantry, [{ id: 'chicken', quantity: 500, unit: 'g', staple: false }]);
});

test('same-revision partial-consume race has exactly one winner and one conflict', async () => {
  const b = bridge();
  const results = await Promise.all([
    b.call({ ...VALID, quantity: 100 }, [MCP_WRITE_SCOPE], 1).then(responseMessage),
    b.call({ ...VALID, quantity: 200 }, [MCP_WRITE_SCOPE], 2).then(responseMessage)
  ]);
  assert.equal(results.filter((r) => r.result.isError === undefined).length, 1);
  assert.equal(results.filter((r) => r.result.isError && /^revision_conflict:/.test(r.result.content[0].text)).length, 1);
  assert.equal(b.fake.store.fields.version, 5);
  assert.ok([300, 400].includes(b.fake.store.fields.pantry[0].quantity));
});

test('exact-zero race produces one removal and one revision conflict, with one tombstone', async () => {
  const b = bridge({ pantry: [{ id: 'chicken', name: 'Chicken', quantity: 2, unit: 'pieces', staple: false }] });
  const results = await Promise.all([
    b.call({ ingredientId: 'chicken', quantity: 2, expectedUnit: 'pieces', expectedRevision: 4 }, [MCP_WRITE_SCOPE], 1).then(responseMessage),
    b.call({ ingredientId: 'chicken', quantity: 2, expectedUnit: 'pieces', expectedRevision: 4 }, [MCP_WRITE_SCOPE], 2).then(responseMessage)
  ]);
  assert.equal(results.filter((r) => r.result.isError === undefined).length, 1);
  assert.equal(results.filter((r) => r.result.isError && /^revision_conflict:/.test(r.result.content[0].text)).length, 1);
  assert.equal(b.fake.store.fields.version, 5);
  assert.deepEqual(b.fake.store.fields.pantry, []);
  assert.deepEqual(Object.keys(b.fake.store.fields.deletions.pantry).sort(), ['chicken', 'old']);
});

test('over-consume race cannot clamp or mutate either request', async () => {
  const b = bridge();
  const before = structuredClone(b.fake.store.fields);
  const results = await Promise.all([
    b.call({ ...VALID, quantity: 900 }, [MCP_WRITE_SCOPE], 1).then(responseMessage),
    b.call({ ...VALID, quantity: 900 }, [MCP_WRITE_SCOPE], 2).then(responseMessage)
  ]);
  assert.equal(results.length, 2);
  for (const message of results) {
    assert.equal(message.result.isError, true);
    assert.match(message.result.content[0].text, /^insufficient_stock:/);
  }
  assert.deepEqual(b.fake.store.fields, before);
});

test('duplicate-name selection follows stable id and persistence errors are sanitized', async () => {
  const first = { id: 'a', name: 'Chicken', quantity: 500, unit: 'g', staple: false };
  const second = { id: 'b', name: 'Chicken', quantity: 500, unit: 'g', staple: false };
  const b = bridge({ pantry: [first, second] });
  await responseMessage(await b.call({ ingredientId: 'b', quantity: 300, expectedUnit: 'g', expectedRevision: 4 }));
  assert.deepEqual(b.fake.store.fields.pantry[0], first);
  assert.equal(b.fake.store.fields.pantry[1].quantity, 200);

  const source = { revision: 4, updateTime: 't', pantry: [first], cookedMeals: [], deletions: {} };
  const before = JSON.stringify(source);
  const deps = { nowSeconds: NOW, getFirestoreAccessToken: async () => 'token', getUserDocument: async () => source,
    patchUserDocument: async () => { throw new Error('secret-firestore-detail'); } };
  const failed = await responseMessage(await routeRequest(request(toolCall(8, VALID)), testEnv(), deps, AUTH_CONTEXT()));
  assert.equal(failed.result.isError, true);
  assert.doesNotMatch(JSON.stringify(failed), /secret-firestore-detail/);
  assert.equal(JSON.stringify(source), before);
});
