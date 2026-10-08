import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { routeRequest } from '../src/index.js';
import { MCP_ISSUER, MCP_RESOURCE, MCP_SCOPE, MCP_WRITE_SCOPE } from '../src/mcpAuth.js';
import { testEnv, request } from './support/fixtures.js';
import { createFakeFirestore } from './support/fakeFirestore.js';

const MCP_URL = 'https://localhost/mcp';
const NOW = 1_800_000_000;
const NAME = 'set_inventory_quantity';
const READY_FOOD = [{ id: 'meal-1', name: 'Chili', portionsRemaining: 2, storage: 'fridge' }];
const HISTORY = [{ id: 'mc-1', cookedMealId: 'meal-1', portionsConsumed: 1 }];
const EGGS = { id: 'eggs', name: 'Eggs', quantity: 12, unit: 'pcs', staple: false, updatedAt: '2026-01-01T00:00:00.000Z' };
const VALID = { ingredientId: 'eggs', quantity: 7, expectedUnit: 'pcs', expectedRevision: 0 };
const NO_ACCESS = { token: 0, read: 0, write: 0, fetch: 0 };

function mcpRequest(body, { authorization = 'Bearer oauth-test-token' } = {}) {
  const headers = { Host: 'localhost', Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' };
  if (authorization) headers.Authorization = authorization;
  return new Request(MCP_URL, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
}

async function responseMessage(response) {
  const raw = await response.text();
  if ((response.headers.get('Content-Type') || '').includes('text/event-stream')) {
    const dataLine = raw.split(/\r?\n/).find((line) => line.startsWith('data: '));
    assert.ok(dataLine, 'SSE response must contain a data frame');
    return JSON.parse(dataLine.slice(6));
  }
  return JSON.parse(raw);
}

function rpcRequest(id, method, params = {}) {
  return { jsonrpc: '2.0', id, method, params };
}

function toolCall(id, name, args = {}) {
  return rpcRequest(id, 'tools/call', { name, arguments: args });
}

function contextWithScope(scope, overrides = {}) {
  return {
    auth: Object.assign({
      token: 'not-a-real-token',
      audience: MCP_RESOURCE,
      expiresAt: NOW + 300,
      scope,
      userId: 'test-owner-subject',
      clientId: 'https://chatgpt.com/oauth/client.json'
    }, overrides.auth || {}),
    props: Object.assign({
      ownerSubject: 'test-owner-subject',
      issuer: MCP_ISSUER,
      resource: MCP_RESOURCE,
      notBefore: NOW - 1
    }, overrides.props || {})
  };
}

function countingDeps(doc) {
  const calls = { token: 0, read: 0, write: 0, fetch: 0 };
  return {
    calls,
    deps: {
      nowSeconds: NOW,
      getFirestoreAccessToken: async () => { calls.token += 1; return 'fake-firestore-token'; },
      getUserDocument: async () => { calls.read += 1; return doc; },
      patchUserDocument: async () => { calls.write += 1; throw new Error('write path reached'); },
      fetchImpl: async () => { calls.fetch += 1; throw new Error('external fetch reached'); }
    }
  };
}

function bridge(initialFields) {
  const fake = createFakeFirestore({ fields: Object.assign({
    version: 0,
    pantry: [],
    cookedMeals: READY_FOOD,
    mealConsumptions: HISTORY,
    deletions: { pantry: {} }
  }, initialFields) });
  const env = testEnv();
  const deps = { nowSeconds: NOW, fetchImpl: fake.fetch, cryptoImpl: globalThis.crypto };
  const call = (name, args, scope = [MCP_WRITE_SCOPE]) => routeRequest(
    mcpRequest(toolCall(1, name, args)), env, deps, contextWithScope(scope)
  );
  return { fake, env, deps, call };
}

const EMPTY_DOC = { revision: 0, updateTime: 't', pantry: [], cookedMeals: [], mealConsumptions: [], deletions: { pantry: {} } };

async function rejected(name, args, context, authorization) {
  const { calls, deps } = countingDeps(EMPTY_DOC);
  const body = typeof args === 'string' ? args : toolCall(1, name, args);
  const response = await routeRequest(mcpRequest(body, { authorization }), testEnv(), deps, context);
  return { message: await responseMessage(response), calls };
}

function snapshotUnrelated(store) {
  return JSON.stringify({
    cookedMeals: store.fields.cookedMeals,
    mealConsumptions: store.fields.mealConsumptions,
    other: store.fields.other
  });
}

function text(message) {
  return message.result.content[0].text;
}

test('tools/list exposes exactly eight tools; set_inventory_quantity has a strict schema with an expectedUnit precondition and no unit', async () => {
  const response = await routeRequest(
    mcpRequest(rpcRequest(1, 'tools/list')), testEnv(), { nowSeconds: NOW }, contextWithScope([MCP_SCOPE, MCP_WRITE_SCOPE])
  );
  const tools = (await responseMessage(response)).result.tools;
  const names = tools.map((tool) => tool.name);
  assert.deepEqual(names, [
    'get_inventory', 'get_ready_food', 'record_ready_food', 'consume_ready_food',
    'mark_out_of_stock', 'mark_in_stock', NAME, 'consume_stock'
  ]);
  assert.doesNotMatch(names.join(' '), /add_stock|create_inventory|mutate_inventory|shopping|convert|leftover/i);

  const tool = tools.find((t) => t.name === NAME);
  assert.deepEqual(tool.securitySchemes, [{ type: 'oauth2', scopes: ['mealprep:write'] }]);
  assert.deepEqual(tool._meta.securitySchemes, [{ type: 'oauth2', scopes: ['mealprep:write'] }]);
  assert.equal(tool.inputSchema.additionalProperties, false);
  assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), ['expectedRevision', 'expectedUnit', 'ingredientId', 'quantity']);
  assert.deepEqual([...tool.inputSchema.required].sort(), ['expectedRevision', 'expectedUnit', 'ingredientId', 'quantity']);
  assert.equal(tool.inputSchema.properties.quantity.exclusiveMinimum, 0);
  assert.equal(tool.inputSchema.properties.expectedRevision.minimum, 0);
  assert.deepEqual(tool.annotations, { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false });
  assert.match(tool.description, /ABSOLUTE/);
  assert.match(tool.description, /mark_out_of_stock/);
  assert.match(tool.description, /never converts/);
  assert.match(tool.description, /expectedUnit/);
  assert.match(tool.description, /0\.65kg chicken" -> do NOT send quantity=0\.65/);
  assert.match(tool.description, /unit_mismatch/);
  assert.equal(tool.inputSchema.properties.expectedUnit.minLength, 1);
  assert.match(tool.description, /I bought\/used\/added N" is NOT supported/);
  assert.match(tool.description, /revision_conflict/);
});

test('write scope required; read-only, wrong-owner, missing-scope and no-token calls touch no Firestore', async () => {
  const readOnly = await rejected(NAME, VALID, contextWithScope([MCP_SCOPE]));
  assert.equal(readOnly.message.result.isError, true);
  assert.match(readOnly.message.result._meta['mcp/www_authenticate'][0], /insufficient_scope/);
  assert.match(readOnly.message.result._meta['mcp/www_authenticate'][0], /scope="mealprep:write"/);
  assert.deepEqual(readOnly.calls, NO_ACCESS);

  const wrongOwner = await rejected(NAME, VALID, contextWithScope([MCP_WRITE_SCOPE], { auth: { userId: 'wrong-owner' } }));
  assert.equal(wrongOwner.message.result.isError, true);
  assert.deepEqual(wrongOwner.calls, NO_ACCESS);

  const missingScope = await rejected(NAME, VALID, contextWithScope([]));
  assert.equal(missingScope.message.result.isError, true);
  assert.deepEqual(missingScope.calls, NO_ACCESS);

  const noToken = await rejected(NAME, VALID, {}, null);
  assert.match(noToken.message.result._meta['mcp/www_authenticate'][0], /Bearer/);
  assert.deepEqual(noToken.calls, NO_ACCESS);
});

test('write-only and combined grants both authorize the tool', async () => {
  for (const scope of [[MCP_WRITE_SCOPE], [MCP_SCOPE, MCP_WRITE_SCOPE]]) {
    const b = bridge({ pantry: [Object.assign({}, EGGS)] });
    assert.equal((await responseMessage(await b.call(NAME, VALID, scope))).result.isError, undefined);
    assert.equal(b.fake.store.fields.pantry[0].quantity, 7);
  }
});

test('over-posting and malformed inputs are rejected before Firestore access', async () => {
  const extras = ['uid', 'owner', 'path', 'collection', 'document', 'staple', 'fields', 'operation', 'unit', 'stockLevel', 'delta'];
  for (const field of extras) {
    const result = await rejected(NAME, Object.assign({}, VALID, { [field]: 'attacker' }), contextWithScope([MCP_WRITE_SCOPE]));
    assert.match(text(result.message), /input validation error/i, field);
    assert.deepEqual(result.calls, NO_ACCESS, field);
  }
  for (const args of [
    { quantity: 7, expectedUnit: 'pcs', expectedRevision: 0 },
    { ingredientId: 'eggs', expectedUnit: 'pcs', expectedRevision: 0 },
    { ingredientId: 'eggs', quantity: 7, expectedUnit: 'pcs' },
    { ingredientId: 'eggs', quantity: 7, expectedUnit: 'pcs', expectedRevision: -1 },
    { ingredientId: 'eggs', quantity: 7, expectedUnit: 'pcs', expectedRevision: 0.5 },
    { ingredientId: 'eggs', quantity: 7, expectedUnit: 'pcs', expectedRevision: '0' },
    { ingredientId: '', quantity: 7, expectedUnit: 'pcs', expectedRevision: 0 },
    { ingredientId: 'eggs', quantity: 0, expectedUnit: 'pcs', expectedRevision: 0 },
    { ingredientId: 'eggs', quantity: -3, expectedUnit: 'pcs', expectedRevision: 0 },
    { ingredientId: 'eggs', quantity: '7', expectedUnit: 'pcs', expectedRevision: 0 },
    { ingredientId: 'eggs', quantity: { value: 7 }, expectedUnit: 'pcs', expectedRevision: 0 },
    { ingredientId: 'eggs', quantity: null, expectedUnit: 'pcs', expectedRevision: 0 },
    { ingredientId: 'eggs', quantity: [7], expectedUnit: 'pcs', expectedRevision: 0 }
  ]) {
    const result = await rejected(NAME, args, contextWithScope([MCP_WRITE_SCOPE]));
    assert.match(text(result.message), /input validation error/i, JSON.stringify(args));
    assert.deepEqual(result.calls, NO_ACCESS, JSON.stringify(args));
  }
});

test('zero steers to mark_out_of_stock; non-finite numbers never reach Firestore', async () => {
  const zero = await rejected(NAME, { ingredientId: 'eggs', quantity: 0, expectedUnit: 'pcs', expectedRevision: 0 }, contextWithScope([MCP_WRITE_SCOPE]));
  assert.match(text(zero.message), /mark_out_of_stock/);
  assert.deepEqual(zero.calls, NO_ACCESS);

  for (const raw of ['NaN', 'Infinity', '-Infinity', '1e999']) {
    const body = '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"' + NAME +
      '","arguments":{"ingredientId":"eggs","quantity":' + raw + ',"expectedRevision":0}}}';
    const result = await rejected(NAME, body, contextWithScope([MCP_WRITE_SCOPE]));
    assert.deepEqual(result.calls, NO_ACCESS, raw);
    assert.ok(result.message.error || result.message.result?.isError, raw);
  }
});

test('valid set changes only that quantity, preserves id/unit/other rows, and bumps revision once', async () => {
  const other = { id: 'tuna', name: 'Tuna', quantity: 4, unit: 'can', staple: false };
  const { fake, call } = bridge({
    pantry: [Object.assign({}, EGGS), other],
    other: { untouched: true },
    deletions: { pantry: { old: '2026-01-01T00:00:00.000Z' } }
  });
  const unrelated = snapshotUnrelated(fake.store);
  const deletions = JSON.stringify(fake.store.fields.deletions);
  const message = await responseMessage(await call(NAME, VALID));
  const item = message.result.structuredContent.item;
  assert.deepEqual(message.result.structuredContent, {
    ok: true,
    revision: 1,
    item: {
      ingredientId: 'eggs', name: 'Eggs', quantity: 7, unit: 'pcs', inStock: true,
      staple: false, stockLevel: null, storage: null, updatedAt: item.updatedAt
    }
  });
  assert.notEqual(item.updatedAt, EGGS.updatedAt);
  assert.equal(fake.store.fields.version, 1);
  assert.equal(fake.store.fields.pantry.length, 2);
  assert.deepEqual(fake.store.fields.pantry[0], Object.assign({}, EGGS, { quantity: 7, updatedAt: item.updatedAt }));
  assert.deepEqual(fake.store.fields.pantry[1], other);
  assert.equal(snapshotUnrelated(fake.store), unrelated);
  assert.equal(JSON.stringify(fake.store.fields.deletions), deletions);
});

test('stored unit is preserved; expectedUnit is never persisted; float quantity and numeric ids round-trip', async () => {
  const chicken = { id: 12.5, name: 'Chicken', quantity: 500, unit: 'g', staple: false };
  const { fake, call } = bridge({ pantry: [chicken] });
  const a = await responseMessage(await call(NAME, { ingredientId: '12.5', quantity: 650.5, expectedUnit: 'g', expectedRevision: 0 }));
  assert.equal(a.result.structuredContent.item.unit, 'g');
  assert.equal(a.result.structuredContent.item.quantity, 650.5);
  const row = fake.store.fields.pantry[0];
  assert.equal(row.unit, 'g');
  assert.equal(Object.prototype.hasOwnProperty.call(row, 'expectedUnit'), false);
  assert.deepEqual(Object.keys(row).sort(), ['id', 'name', 'quantity', 'staple', 'unit', 'updatedAt']);
  assert.equal(JSON.stringify(fake.store).includes('expectedUnit'), false);
  assert.equal(fake.store.fields.version, 1);
});

test('unit precondition: only an exact stored-unit match writes; every mismatch is zero mutation', async () => {
  const cases = [
    ['A', 'g', 'g', true],
    ['B', 'g', 'kg', false],
    ['C', 'kg', 'g', false],
    ['D', 'ml', 'L', false],
    ['E', 'pieces', 'cans', false],
    ['case', 'g', 'G', false],
    ['space', 'g', ' g', false],
    ['H stale chat assumption', 'g', 'lb', false]
  ];
  for (const [label, stored, expected, ok] of cases) {
    const b = bridge({ pantry: [{ id: 'x', name: 'Item', quantity: 500, unit: stored, staple: false }] });
    const before = JSON.stringify(b.fake.store);
    const message = await responseMessage(await b.call(NAME, { ingredientId: 'x', quantity: 650, expectedUnit: expected, expectedRevision: 0 }));
    if (ok) {
      assert.equal(message.result.structuredContent.item.unit, stored, label);
      assert.equal(b.fake.store.fields.pantry[0].quantity, 650, label);
    } else {
      assert.equal(message.result.isError, true, label);
      assert.match(text(message), /^unit_mismatch:/, label);
      assert.equal(JSON.stringify(b.fake.store), before, label);
    }
  }
});

test('F: blank, null, missing and non-string stored units are rejected with zero mutation', async () => {
  for (const unit of [undefined, null, '', '   ', 7]) {
    const row = { id: 'x', name: 'Item', quantity: 5, staple: false };
    if (unit !== undefined) row.unit = unit;
    for (const expectedUnit of ['pcs', 'g']) {
      const b = bridge({ pantry: [row] });
      const before = JSON.stringify(b.fake.store);
      const message = await responseMessage(await b.call(NAME, { ingredientId: 'x', quantity: 2, expectedUnit, expectedRevision: 0 }));
      assert.match(text(message), /^unit_mismatch:.*no stored unit/, String(unit));
      assert.equal(JSON.stringify(b.fake.store), before);
    }
  }
});

test('I/J: unit mismatch with a current revision mutates nothing; correct unit with a stale revision is revision_conflict', async () => {
  const b = bridge({ version: 3, pantry: [Object.assign({}, EGGS)] });
  const before = JSON.stringify(b.fake.store);
  const bad = await responseMessage(await b.call(NAME, { ingredientId: 'eggs', quantity: 7, expectedUnit: 'cans', expectedRevision: 3 }));
  assert.match(text(bad), /^unit_mismatch:/);
  assert.equal(JSON.stringify(b.fake.store), before);
  const stale = await responseMessage(await b.call(NAME, { ingredientId: 'eggs', quantity: 7, expectedUnit: 'pcs', expectedRevision: 2 }));
  assert.match(text(stale), /^revision_conflict:/);
  assert.equal(JSON.stringify(b.fake.store), before);
});

test('G: missing, empty and non-string expectedUnit fail the schema before Firestore; unit key is still rejected', async () => {
  for (const extra of [{}, { expectedUnit: '' }, { expectedUnit: 5 }, { expectedUnit: null }, { expectedUnit: ['g'] }]) {
    const args = Object.assign({ ingredientId: 'eggs', quantity: 7, expectedRevision: 0 }, extra);
    const result = await rejected(NAME, args, contextWithScope([MCP_WRITE_SCOPE]));
    assert.match(text(result.message), /input validation error/i, JSON.stringify(extra));
    assert.deepEqual(result.calls, NO_ACCESS);
  }
  const withUnit = await rejected(NAME, Object.assign({}, VALID, { unit: 'kg' }), contextWithScope([MCP_WRITE_SCOPE]));
  assert.match(text(withUnit.message), /input validation error/i);
  assert.deepEqual(withUnit.calls, NO_ACCESS);
});

test('idempotentHint reasoning: an exact replay with the SAME arguments (same expectedRevision) has no additional effect', async () => {
  const b = bridge({ pantry: [Object.assign({}, EGGS)] });
  const args = { ingredientId: 'eggs', quantity: 7, expectedUnit: 'pcs', expectedRevision: 0 };
  const first = await responseMessage(await b.call(NAME, args));
  assert.equal(first.result.structuredContent.revision, 1);
  const afterFirst = JSON.stringify(b.fake.store);
  const replay = await responseMessage(await b.call(NAME, args));
  assert.match(text(replay), /^revision_conflict:/);
  assert.equal(JSON.stringify(b.fake.store), afterFirst);
});

test('duplicate-name rows: only the named id changes', async () => {
  const a = { id: 'a', name: 'Chicken', quantity: 1, unit: 'lb', staple: false };
  const b = { id: 'b', name: 'Chicken', quantity: 650, unit: 'g', staple: false };
  const { fake, call } = bridge({ pantry: [a, b] });
  await call(NAME, { ingredientId: 'b', quantity: 700, expectedUnit: 'g', expectedRevision: 0 });
  assert.deepEqual(fake.store.fields.pantry[0], a);
  assert.equal(fake.store.fields.pantry[1].quantity, 700);
});

test('staple, ambiguous and unknown rows are refused with distinct messages and zero mutation', async () => {
  const cases = [
    [{ id: 'eggs', name: 'Rice', staple: true, stockLevel: 'full' }, /^(?!ambiguous|not_found).*mark_in_stock or mark_out_of_stock/],
    [{ id: 'eggs', name: 'Salt', category: 'Pantry' }, /^(?!ambiguous|not_found).*mark_in_stock or mark_out_of_stock/],
    [{ id: 'eggs', name: 'Garlic', category: 'Vegetable' }, /^ambiguous:.*Set an explicit staple value/]
  ];
  for (const [row, pattern] of cases) {
    const b = bridge({ pantry: [row] });
    const before = JSON.stringify(b.fake.store);
    const message = await responseMessage(await b.call(NAME, VALID));
    assert.equal(message.result.isError, true);
    assert.match(text(message), pattern);
    assert.equal(JSON.stringify(b.fake.store), before);
  }
  const unknown = bridge({ pantry: [] });
  const message = await responseMessage(await unknown.call(NAME, { ingredientId: 'ghost', quantity: 1, expectedUnit: 'pcs', expectedRevision: 0 }));
  assert.match(text(message), /^not_found:/);
  assert.equal(unknown.fake.store.fields.version, 0);
});

test('a removed (tombstoned) row is not_found and is never resurrected', async () => {
  const b = bridge({ pantry: [], deletions: { pantry: { eggs: '2026-01-01T00:00:00.000Z' } } });
  const message = await responseMessage(await b.call(NAME, VALID));
  assert.match(text(message), /^not_found:/);
  assert.deepEqual(b.fake.store.fields.pantry, []);
});

test('stale revision fails with zero mutation and an old-revision replay is a conflict', async () => {
  const b = bridge({ version: 2, pantry: [Object.assign({}, EGGS)] });
  const stale = await responseMessage(await b.call(NAME, Object.assign({}, VALID, { expectedRevision: 1 })));
  assert.match(text(stale), /^revision_conflict:/);
  assert.equal(b.fake.store.fields.pantry[0].quantity, 12);
  assert.equal(b.fake.store.fields.version, 2);

  const first = await responseMessage(await b.call(NAME, Object.assign({}, VALID, { expectedRevision: 2 })));
  assert.equal(first.result.structuredContent.revision, 3);
  const replay = await responseMessage(await b.call(NAME, Object.assign({}, VALID, { expectedRevision: 2 })));
  assert.match(text(replay), /^revision_conflict:/);
  assert.equal(b.fake.store.fields.version, 3);
});

test('same-revision race: exactly one write succeeds, one revision_conflict, no retry', async () => {
  const b = bridge({ pantry: [Object.assign({}, EGGS)] });
  const messages = await Promise.all([
    b.call(NAME, { ingredientId: 'eggs', quantity: 7, expectedUnit: 'pcs', expectedRevision: 0 }).then(responseMessage),
    b.call(NAME, { ingredientId: 'eggs', quantity: 9, expectedUnit: 'pcs', expectedRevision: 0 }).then(responseMessage)
  ]);
  assert.equal(messages.filter((m) => m.result.structuredContent).length, 1);
  assert.equal(messages.filter((m) => /^revision_conflict:/.test(m.result.content?.[0]?.text || '')).length, 1);
  assert.equal(b.fake.store.fields.version, 1);
  const winner = messages.find((m) => m.result.structuredContent).result.structuredContent.item.quantity;
  assert.equal(b.fake.store.fields.pantry[0].quantity, winner);
});

test('same-value set is a real guarded write, not a no-op: revision advances and quantity converges', async () => {
  const b = bridge({ pantry: [Object.assign({}, EGGS, { quantity: 7 })] });
  const first = await responseMessage(await b.call(NAME, VALID));
  assert.equal(first.result.structuredContent.revision, 1);
  const again = await responseMessage(await b.call(NAME, Object.assign({}, VALID, { expectedRevision: 1 })));
  assert.equal(again.result.structuredContent.revision, 2);
  assert.equal(again.result.structuredContent.item.quantity, 7);
  assert.equal(b.fake.store.fields.pantry.length, 1);
});

test('persistence failure is sanitized and does not mutate the source document', async () => {
  const source = { revision: 0, updateTime: 't', pantry: [Object.assign({}, EGGS)], cookedMeals: READY_FOOD, mealConsumptions: HISTORY, deletions: { pantry: {} } };
  const before = JSON.stringify(source);
  const deps = {
    nowSeconds: NOW,
    getFirestoreAccessToken: async () => 'token',
    getUserDocument: async () => source,
    patchUserDocument: async () => { throw new Error('secret-firestore-detail'); }
  };
  const message = await responseMessage(await routeRequest(
    mcpRequest(toolCall(1, NAME, VALID)), testEnv(), deps, contextWithScope([MCP_WRITE_SCOPE])
  ));
  assert.equal(message.result.isError, true);
  assert.doesNotMatch(text(message), /secret|firestore/i);
  assert.equal(JSON.stringify(source), before);
});

test('MCP set matches REST /v1/inventory/set-quantity persistence for the same absolute set', async () => {
  const RealDate = Date;
  const fixed = '2026-10-04T12:00:00.000Z';
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(args.length ? args[0] : fixed); }
    static now() { return RealDate.parse(fixed); }
  };
  try {
    const pantry = [Object.assign({}, EGGS)];
    const mcp = bridge({ pantry });
    const rest = bridge({ pantry });
    const mcpResult = (await responseMessage(await mcp.call(NAME, VALID))).result.structuredContent;
    const restResult = await (await routeRequest(
      request('/v1/inventory/set-quantity', { method: 'POST', body: { ingredientId: 'eggs', quantity: 7, expectedRevision: 0 } }), rest.env, rest.deps
    )).json();
    assert.deepEqual(mcp.fake.store, rest.fake.store);
    assert.deepEqual(mcpResult, { ok: restResult.ok, revision: restResult.revision, item: restResult.item });
  } finally {
    globalThis.Date = RealDate;
  }
});

test('regression: existing stock tools behave as before alongside the new tool', async () => {
  const b = bridge({ pantry: [{ id: 's', name: 'Rice', staple: true, stockLevel: 'full' }] });
  const out = await responseMessage(await b.call('mark_out_of_stock', { ingredientId: 's', expectedRevision: 0 }));
  assert.equal(out.result.structuredContent.item.stockLevel, 'empty');
  const inn = await responseMessage(await b.call('mark_in_stock', { ingredientId: 's', expectedRevision: 1 }));
  assert.equal(inn.result.structuredContent.item.stockLevel, 'full');
  assert.equal(b.fake.store.fields.version, 2);
});

test('mcp.js holds no classification, conversion or pantry-array logic; setCountedQuantity delegates to setQuantity', async () => {
  const source = await readFile(new URL('../src/mcp.js', import.meta.url), 'utf8');
  assert.match(source, /inventory\.setCountedQuantity\(/);
  assert.doesNotMatch(source, /stockLevel\s*===|category\s*===|\.staple\b|pantry\.(filter|map|splice|push)\(|toGrams|getUnitConversion|normalizeUnit/);
  const domain = await readFile(new URL('../src/operations/inventory.js', import.meta.url), 'utf8');
  const wrapper = domain.slice(domain.indexOf('export function setCountedQuantity'), domain.indexOf('// Mirrors correctKitchenStock()'));
  assert.doesNotMatch(wrapper, /toGrams|getUnitConversion|normalizeUnit/);
  assert.match(wrapper, /return setQuantity\(pantry, \{ ingredientId, quantity \}\);/);
});
