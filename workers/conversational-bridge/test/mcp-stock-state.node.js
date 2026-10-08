import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { routeRequest } from '../src/index.js';
import { MCP_ISSUER, MCP_RESOURCE, MCP_SCOPE, MCP_WRITE_SCOPE } from '../src/mcpAuth.js';
import { testEnv, request } from './support/fixtures.js';
import { createFakeFirestore } from './support/fakeFirestore.js';

const MCP_URL = 'https://localhost/mcp';
const NOW = 1_800_000_000;
const READY_FOOD = [{ id: 'meal-1', name: 'Chili', portionsRemaining: 2, storage: 'fridge' }];
const HISTORY = [{ id: 'mc-1', cookedMealId: 'meal-1', portionsConsumed: 1 }];
const VALID_OUT = { ingredientId: 'staple-1', expectedRevision: 0 };
const VALID_IN = { ingredientId: 'staple-1', expectedRevision: 0 };
const NO_ACCESS = { token: 0, read: 0, write: 0, fetch: 0 };

function mcpRequest(body, { authorization = 'Bearer oauth-test-token' } = {}) {
  const headers = { Host: 'localhost', Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' };
  if (authorization) headers.Authorization = authorization;
  return new Request(MCP_URL, { method: 'POST', headers, body: JSON.stringify(body) });
}

async function responseMessage(response) {
  const text = await response.text();
  if ((response.headers.get('Content-Type') || '').includes('text/event-stream')) {
    const dataLine = text.split(/\r?\n/).find((line) => line.startsWith('data: '));
    assert.ok(dataLine, 'SSE response must contain a data frame');
    return JSON.parse(dataLine.slice(6));
  }
  return JSON.parse(text);
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

async function rejected(name, args, context, authorization) {
  const doc = { revision: 0, updateTime: 't', pantry: [], cookedMeals: [], mealConsumptions: [], deletions: { pantry: {} } };
  const { calls, deps } = countingDeps(doc);
  const response = await routeRequest(
    mcpRequest(toolCall(1, name, args), { authorization }), testEnv(), deps, context
  );
  return { message: await responseMessage(response), calls };
}

function snapshotUnrelated(store) {
  return JSON.stringify({
    cookedMeals: store.fields.cookedMeals,
    mealConsumptions: store.fields.mealConsumptions,
    other: store.fields.other
  });
}

test('tools/list exposes exactly nine tools with strict stock schemas and annotations', async () => {
  const response = await routeRequest(
    mcpRequest(rpcRequest(1, 'tools/list')), testEnv(), { nowSeconds: NOW }, contextWithScope([MCP_SCOPE, MCP_WRITE_SCOPE])
  );
  const tools = (await responseMessage(response)).result.tools;
  assert.deepEqual(tools.map((tool) => tool.name), [
    'get_inventory', 'get_ready_food', 'record_ready_food', 'consume_ready_food',
    'mark_out_of_stock', 'mark_in_stock', 'set_inventory_quantity', 'consume_stock', 'add_stock'
  ]);
  assert.doesNotMatch(tools.map((tool) => tool.name).join(' '), /create_inventory|mutate_inventory|shopping/i);

  const out = tools.find((tool) => tool.name === 'mark_out_of_stock');
  const inStock = tools.find((tool) => tool.name === 'mark_in_stock');
  for (const tool of [out, inStock]) {
    assert.deepEqual(tool.securitySchemes, [{ type: 'oauth2', scopes: ['mealprep:write'] }]);
    assert.deepEqual(tool._meta.securitySchemes, [{ type: 'oauth2', scopes: ['mealprep:write'] }]);
    assert.equal(tool.inputSchema.additionalProperties, false);
    assert.deepEqual([...tool.inputSchema.required].sort(), ['expectedRevision', 'ingredientId']);
    assert.equal(tool.inputSchema.properties.ingredientId.type, 'string');
    assert.equal(tool.inputSchema.properties.ingredientId.minLength, 1);
    assert.equal(tool.inputSchema.properties.expectedRevision.type, 'integer');
    assert.equal(tool.inputSchema.properties.expectedRevision.minimum, 0);
    assert.equal(tool.annotations.readOnlyHint, false);
    assert.equal(tool.annotations.idempotentHint, true);
    assert.equal(tool.annotations.openWorldHint, false);
    assert.match(tool.description, /get_inventory/);
    assert.match(tool.description, /Never guess or fuzzy-match/);
    assert.match(tool.description, /revision_conflict/);
  }
  assert.equal(out.annotations.destructiveHint, true);
  assert.equal(inStock.annotations.destructiveHint, false);
  assert.match(out.description, /permanently removed/);
  assert.match(out.description, /ambiguous/);
});

test('stock tools require write scope; read-only, wrong-owner, missing-scope and no-token calls touch no Firestore', async () => {
  const cases = [
    ['mark_out_of_stock', VALID_OUT],
    ['mark_in_stock', VALID_IN]
  ];
  for (const [name, args] of cases) {
    const readOnly = await rejected(name, args, contextWithScope([MCP_SCOPE]));
    assert.equal(readOnly.message.result.isError, true);
    assert.match(readOnly.message.result._meta['mcp/www_authenticate'][0], /insufficient_scope/);
    assert.match(readOnly.message.result._meta['mcp/www_authenticate'][0], /scope="mealprep:write"/);
    assert.deepEqual(readOnly.calls, NO_ACCESS);

    const wrongOwner = await rejected(name, args, contextWithScope([MCP_WRITE_SCOPE], { auth: { userId: 'wrong-owner' } }));
    assert.equal(wrongOwner.message.result.isError, true);
    assert.deepEqual(wrongOwner.calls, NO_ACCESS);

    const missingScope = await rejected(name, args, contextWithScope([]));
    assert.equal(missingScope.message.result.isError, true);
    assert.deepEqual(missingScope.calls, NO_ACCESS);

    const noToken = await rejected(name, args, {}, null);
    assert.equal(noToken.message.result.isError, true);
    assert.match(noToken.message.result._meta['mcp/www_authenticate'][0], /Bearer/);
    assert.deepEqual(noToken.calls, NO_ACCESS);
  }
});

test('write-only and combined grants authorize both stock tools', async () => {
  for (const scope of [[MCP_WRITE_SCOPE], [MCP_SCOPE, MCP_WRITE_SCOPE]]) {
    const out = bridge({ pantry: [{ id: 'staple-1', name: 'Rice', staple: true, stockLevel: 'full' }] });
    assert.equal((await responseMessage(await out.call('mark_out_of_stock', VALID_OUT, scope))).result.isError, undefined);
    const inStock = bridge({ pantry: [{ id: 'staple-1', name: 'Rice', staple: true, stockLevel: 'empty' }] });
    assert.equal((await responseMessage(await inStock.call('mark_in_stock', VALID_IN, scope))).result.isError, undefined);
  }
});

test('over-posting and malformed required inputs are rejected before Firestore access', async () => {
  const extras = ['uid', 'owner', 'path', 'collection', 'document', 'staple', 'fields', 'operation', 'quantity', 'unit'];
  for (const name of ['mark_out_of_stock', 'mark_in_stock']) {
    for (const field of extras) {
      const result = await rejected(name, Object.assign({}, VALID_OUT, { [field]: 'attacker' }), contextWithScope([MCP_WRITE_SCOPE]));
      assert.match(result.message.result.content[0].text, /input validation error/i, field);
      assert.deepEqual(result.calls, NO_ACCESS, field);
    }
    for (const args of [
      { ingredientId: 'staple-1' },
      { ingredientId: 'staple-1', expectedRevision: -1 },
      { ingredientId: 'staple-1', expectedRevision: 0.5 },
      { ingredientId: 'staple-1', expectedRevision: '0' },
      { ingredientId: '', expectedRevision: 0 }
    ]) {
      const result = await rejected(name, args, contextWithScope([MCP_WRITE_SCOPE]));
      assert.match(result.message.result.content[0].text, /input validation error/i);
      assert.deepEqual(result.calls, NO_ACCESS);
    }
  }
});

test('mark_out_of_stock retains a staple as empty, changes only that id, and bumps revision once', async () => {
  const other = { id: 'other', name: 'Other rice', staple: true, stockLevel: 'full' };
  const { fake, call } = bridge({
    pantry: [{ id: 'staple-1', name: 'Rice', staple: true, stockLevel: 'full' }, other],
    other: { untouched: true }
  });
  const unrelated = snapshotUnrelated(fake.store);
  const message = await responseMessage(await call('mark_out_of_stock', VALID_OUT));
  assert.deepEqual(message.result.structuredContent, {
    ok: true,
    revision: 1,
    item: {
      ingredientId: 'staple-1', name: 'Rice', quantity: null, unit: null, inStock: false,
      staple: true, stockLevel: 'empty', storage: null, updatedAt: message.result.structuredContent.item.updatedAt
    },
    unchanged: false,
    removed: false
  });
  assert.equal(fake.store.fields.version, 1);
  assert.equal(fake.store.fields.pantry.length, 2);
  assert.equal(fake.store.fields.pantry[0].stockLevel, 'empty');
  assert.deepEqual(fake.store.fields.pantry[1], other);
  assert.equal(snapshotUnrelated(fake.store), unrelated);
  assert.deepEqual(fake.store.fields.deletions, { pantry: {} });
});

test('mark_out_of_stock removes a non-staple, writes one pantry tombstone, and preserves unrelated state', async () => {
  const chickenA = { id: 12.5, name: 'Chicken', quantity: 650, unit: 'g', staple: false };
  const chickenB = { id: 'chicken-b', name: 'Chicken', quantity: 1, unit: 'lb', staple: false };
  const { fake, call } = bridge({ pantry: [chickenA, chickenB], other: { untouched: true } });
  const unrelated = snapshotUnrelated(fake.store);
  const message = await responseMessage(await call('mark_out_of_stock', { ingredientId: '12.5', expectedRevision: 0 }));
  assert.deepEqual(message.result.structuredContent, { ok: true, revision: 1, item: null, unchanged: false, removed: true });
  assert.deepEqual(fake.store.fields.pantry, [chickenB]);
  assert.match(fake.store.fields.deletions.pantry['12.5'], /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(fake.store.fields.version, 1);
  assert.equal(snapshotUnrelated(fake.store), unrelated);
});

test('already-empty and already-tombstoned out-of-stock calls are unchanged successes with no write or revision bump', async () => {
  const empty = bridge({ pantry: [{ id: 'staple-1', name: 'Rice', staple: true, stockLevel: 'empty' }] });
  const emptyUpdateTime = empty.fake.store.updateTime;
  const emptyMessage = await responseMessage(await empty.call('mark_out_of_stock', VALID_OUT));
  assert.equal(emptyMessage.result.structuredContent.unchanged, true);
  assert.equal(emptyMessage.result.structuredContent.removed, false);
  assert.equal(emptyMessage.result.structuredContent.revision, 0);
  assert.equal(empty.fake.store.updateTime, emptyUpdateTime);

  const removed = bridge({ pantry: [], deletions: { pantry: { gone: '2026-01-01T00:00:00.000Z' } } });
  const removedUpdateTime = removed.fake.store.updateTime;
  const removedMessage = await responseMessage(await removed.call('mark_out_of_stock', { ingredientId: 'gone', expectedRevision: 0 }));
  assert.deepEqual(removedMessage.result.structuredContent, { ok: true, revision: 0, item: null, unchanged: true, removed: true });
  assert.equal(removed.fake.store.updateTime, removedUpdateTime);
  assert.equal(removed.fake.store.fields.version, 0);
});

test('ambiguous and unknown out-of-stock ids return distinct canonical errors with zero mutation', async () => {
  const ambiguous = bridge({ pantry: [{ id: 'x', name: 'Garlic', category: 'Vegetable' }] });
  const before = JSON.stringify(ambiguous.fake.store);
  const ambiguousMessage = await responseMessage(await ambiguous.call('mark_out_of_stock', { ingredientId: 'x', expectedRevision: 0 }));
  assert.equal(ambiguousMessage.result.isError, true);
  assert.match(ambiguousMessage.result.content[0].text, /^ambiguous:/);
  assert.match(ambiguousMessage.result.content[0].text, /Set an explicit staple value/);
  assert.equal(JSON.stringify(ambiguous.fake.store), before);

  const unknown = bridge({ pantry: [] });
  const unknownMessage = await responseMessage(await unknown.call('mark_out_of_stock', { ingredientId: 'ghost', expectedRevision: 0 }));
  assert.equal(unknownMessage.result.isError, true);
  assert.match(unknownMessage.result.content[0].text, /^not_found:/);
  assert.equal(unknown.fake.store.fields.version, 0);
});

test('mark_in_stock fills a staple and already-full is an unchanged no-op', async () => {
  const active = bridge({ pantry: [{ id: 'staple-1', name: 'Rice', staple: true, stockLevel: 'empty' }] });
  const unrelated = snapshotUnrelated(active.fake.store);
  const activeMessage = await responseMessage(await active.call('mark_in_stock', VALID_IN));
  assert.equal(activeMessage.result.structuredContent.revision, 1);
  assert.equal(activeMessage.result.structuredContent.item.stockLevel, 'full');
  assert.equal(activeMessage.result.structuredContent.unchanged, false);
  assert.equal(active.fake.store.fields.pantry[0].stockLevel, 'full');
  assert.equal(snapshotUnrelated(active.fake.store), unrelated);

  const full = bridge({ pantry: [{ id: 'staple-1', name: 'Rice', staple: true, stockLevel: 'full' }] });
  const updateTime = full.fake.store.updateTime;
  const fullMessage = await responseMessage(await full.call('mark_in_stock', VALID_IN));
  assert.equal(fullMessage.result.structuredContent.revision, 0);
  assert.equal(fullMessage.result.structuredContent.unchanged, true);
  assert.equal(full.fake.store.updateTime, updateTime);
  assert.equal(full.fake.store.fields.version, 0);
});

test('mark_in_stock rejects non-staples and unknown ids without mutation', async () => {
  for (const pantry of [[{ id: 'x', name: 'Spinach', staple: false }], []]) {
    const target = pantry.length ? 'x' : 'ghost';
    const stock = bridge({ pantry });
    const before = JSON.stringify(stock.fake.store);
    const message = await responseMessage(await stock.call('mark_in_stock', { ingredientId: target, expectedRevision: 0 }));
    assert.equal(message.result.isError, true);
    assert.match(message.result.content[0].text, pantry.length ? /not a staple/ : /^not_found:/);
    assert.equal(JSON.stringify(stock.fake.store), before);
  }
});

test('stale revisions and old-revision replay fail without a second mutation', async () => {
  for (const [name, pantry] of [
    ['mark_out_of_stock', [{ id: 'staple-1', staple: true, stockLevel: 'full' }]],
    ['mark_in_stock', [{ id: 'staple-1', staple: true, stockLevel: 'empty' }]]
  ]) {
    const stock = bridge({ version: 2, pantry });
    const stale = await responseMessage(await stock.call(name, { ingredientId: 'staple-1', expectedRevision: 1 }));
    assert.match(stale.result.content[0].text, /^revision_conflict:/);
    assert.equal(stock.fake.store.fields.version, 2);

    const first = await responseMessage(await stock.call(name, { ingredientId: 'staple-1', expectedRevision: 2 }));
    assert.equal(first.result.structuredContent.revision, 3);
    const replay = await responseMessage(await stock.call(name, { ingredientId: 'staple-1', expectedRevision: 2 }));
    assert.match(replay.result.content[0].text, /^revision_conflict:/);
    assert.equal(stock.fake.store.fields.version, 3);
  }
});

test('same-revision races allow exactly one guarded mutation for every writing path', async () => {
  const cases = [
    ['mark_out_of_stock', 'staple-1', [{ id: 'staple-1', staple: true, stockLevel: 'full' }], false],
    ['mark_out_of_stock', 'food-1', [{ id: 'food-1', staple: false }], true],
    ['mark_in_stock', 'staple-1', [{ id: 'staple-1', staple: true, stockLevel: 'empty' }], false]
  ];
  for (const [name, ingredientId, pantry, removed] of cases) {
    const stock = bridge({ pantry });
    const messages = await Promise.all([
      stock.call(name, { ingredientId, expectedRevision: 0 }).then(responseMessage),
      stock.call(name, { ingredientId, expectedRevision: 0 }).then(responseMessage)
    ]);
    assert.equal(messages.filter((message) => message.result.structuredContent).length, 1, name);
    assert.equal(messages.filter((message) => /^revision_conflict:/.test(message.result.content?.[0]?.text || '')).length, 1, name);
    assert.equal(stock.fake.store.fields.version, 1, name);
    assert.equal(Object.keys(stock.fake.store.fields.deletions.pantry).length, removed ? 1 : 0, name);
  }
});

test('persistence failures are sanitized and do not mutate the source document', async () => {
  for (const [name, pantry] of [
    ['mark_out_of_stock', [{ id: 'staple-1', staple: true, stockLevel: 'full' }]],
    ['mark_in_stock', [{ id: 'staple-1', staple: true, stockLevel: 'empty' }]]
  ]) {
    const source = { revision: 0, updateTime: 't', pantry, cookedMeals: READY_FOOD, mealConsumptions: HISTORY, deletions: { pantry: {} } };
    const before = JSON.stringify(source);
    const deps = {
      nowSeconds: NOW,
      getFirestoreAccessToken: async () => 'token',
      getUserDocument: async () => source,
      patchUserDocument: async () => { throw new Error('secret-firestore-detail'); }
    };
    const message = await responseMessage(await routeRequest(
      mcpRequest(toolCall(1, name, { ingredientId: 'staple-1', expectedRevision: 0 })),
      testEnv(), deps, contextWithScope([MCP_WRITE_SCOPE])
    ));
    assert.equal(message.result.isError, true);
    assert.doesNotMatch(message.result.content[0].text, /secret|firestore/i);
    assert.equal(JSON.stringify(source), before);
  }
});

test('MCP stock adapters match REST persistence and canonical results', async () => {
  const RealDate = Date;
  const fixed = '2026-10-03T12:00:00.000Z';
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(args.length ? args[0] : fixed); }
    static now() { return RealDate.parse(fixed); }
  };
  try {
    const cases = [
      ['mark_out_of_stock', '/v1/inventory/mark-out-of-stock', { ingredientId: 's', expectedRevision: 0 }, [{ id: 's', staple: true, stockLevel: 'full' }]],
      ['mark_out_of_stock', '/v1/inventory/mark-out-of-stock', { ingredientId: 'n', expectedRevision: 0 }, [{ id: 'n', staple: false }]],
      ['mark_in_stock', '/v1/inventory/mark-in-stock', { ingredientId: 's', expectedRevision: 0 }, [{ id: 's', staple: true, stockLevel: 'empty' }]]
    ];
    for (const [name, path, args, pantry] of cases) {
      const mcp = bridge({ pantry });
      const rest = bridge({ pantry });
      const mcpResult = (await responseMessage(await mcp.call(name, args))).result.structuredContent;
      const restResponse = await routeRequest(request(path, { method: 'POST', body: args }), rest.env, rest.deps);
      const restResult = await restResponse.json();
      assert.deepEqual(mcp.fake.store, rest.fake.store, name);
      const expected = name === 'mark_in_stock'
        ? { ok: restResult.ok, revision: restResult.revision, item: restResult.item, unchanged: restResult.unchanged }
        : restResult;
      assert.deepEqual(mcpResult, expected, name);
    }
  } finally {
    globalThis.Date = RealDate;
  }
});

test('mcp.js delegates stock rules and contains no staple classification or pantry-array mutation logic', async () => {
  const source = await readFile(new URL('../src/mcp.js', import.meta.url), 'utf8');
  assert.match(source, /inventory\.markOutOfStock\(/);
  assert.match(source, /inventory\.markInStock\(/);
  assert.doesNotMatch(source, /stockLevel\s*===|category\s*===|pantry\.(filter|map|splice|push)\(/);
});
