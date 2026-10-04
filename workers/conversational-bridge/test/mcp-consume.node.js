// TASK-070 (Phase B2B) focused coverage for the MCP write tool consume_ready_food.
// Same structure as mcp-write.node.js: lightweight auth-matrix fakes for deny paths, and the real
// in-memory fake Firestore for persistence/conflict behavior.
import test from 'node:test';
import assert from 'node:assert/strict';
import { routeRequest } from '../src/index.js';
import { MCP_ISSUER, MCP_RESOURCE, MCP_SCOPE, MCP_WRITE_SCOPE } from '../src/mcpAuth.js';
import { testEnv } from './support/fixtures.js';
import { createFakeFirestore } from './support/fakeFirestore.js';

const MCP_URL = 'https://localhost/mcp';
const NOW = 1_800_000_000;
const MEAL = { id: 'meal-1', name: 'Chili', portionsRemaining: 3, storage: 'fridge', cookedDate: '2026-01-15' };
const OTHER = { id: 'meal-2', name: 'Adobo', portionsRemaining: 2, storage: 'freezer', cookedDate: '2026-01-10' };
const PANTRY = [{ id: 'p1', name: 'Rice', quantity: 1, staple: false }];
const VALID_ARGS = { cookedMealId: 'meal-1', servings: 1, expectedRevision: 0 };
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

// Fake deps whose every Firestore touchpoint is counted; the write path throws so any
// unexpected write is loud.
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
  const fake = createFakeFirestore({ fields: initialFields });
  const env = testEnv();
  const deps = { nowSeconds: NOW, fetchImpl: fake.fetch, cryptoImpl: globalThis.crypto };
  const call = (args, scope = [MCP_WRITE_SCOPE]) => routeRequest(
    mcpRequest(toolCall(1, 'consume_ready_food', args)), env, deps, contextWithScope(scope)
  );
  return { fake, env, deps, call };
}

function seeded(extra = {}) {
  return bridge(Object.assign({ version: 0, pantry: PANTRY, cookedMeals: [MEAL, OTHER] }, extra));
}

async function rejected(args, context) {
  const { calls, deps } = countingDeps({ revision: 0, updateTime: 't', pantry: [], cookedMeals: [MEAL], deletions: {} });
  const response = await routeRequest(mcpRequest(toolCall(1, 'consume_ready_food', args)), testEnv(), deps, context);
  return { message: await responseMessage(response), calls };
}

// ── AUTH ─────────────────────────────────────────────────────────────────────

test('a read-only grant is denied consume_ready_food with the write insufficient-scope challenge', async () => {
  const { message, calls } = await rejected(VALID_ARGS, contextWithScope([MCP_SCOPE]));
  assert.equal(message.result.isError, true);
  assert.match(message.result._meta['mcp/www_authenticate'][0], /insufficient_scope/);
  assert.match(message.result._meta['mcp/www_authenticate'][0], /scope="mealprep:write"/);
  assert.deepEqual(calls, NO_ACCESS);
});

test('write-only and combined grants can consume', async () => {
  for (const scope of [[MCP_WRITE_SCOPE], [MCP_SCOPE, MCP_WRITE_SCOPE]]) {
    const { call } = seeded();
    const message = await responseMessage(await call(VALID_ARGS, scope));
    assert.equal(message.result.isError, undefined, JSON.stringify(scope));
  }
});

test('wrong owner and missing/unsupported scope are denied before any Firestore access', async () => {
  const contexts = [contextWithScope([MCP_WRITE_SCOPE], { auth: { userId: 'another-owner' } })]
    .concat([undefined, [], ['unknown'], [MCP_WRITE_SCOPE, 'unknown']].map((scope) => contextWithScope(scope)));
  for (const context of contexts) {
    const { message, calls } = await rejected(VALID_ARGS, context);
    assert.equal(message.result.isError, true);
    assert.deepEqual(calls, NO_ACCESS);
  }
});

test('an unauthenticated request never reaches consume_ready_food', async () => {
  const { calls, deps } = countingDeps({ revision: 0, updateTime: 't', pantry: [], cookedMeals: [MEAL], deletions: {} });
  const response = await routeRequest(
    mcpRequest(toolCall(1, 'consume_ready_food', VALID_ARGS), { authorization: null }), testEnv(), deps, {}
  );
  const message = await responseMessage(response);
  assert.equal(message.result.isError, true);
  assert.match(message.result._meta['mcp/www_authenticate'][0], /Bearer/);
  assert.deepEqual(calls, NO_ACCESS);
});

// ── PARTIAL CONSUME ──────────────────────────────────────────────────────────

test('partial consume subtracts exactly the requested servings, keeps the id, bumps revision by 1, touches nothing else', async () => {
  const { fake, call } = seeded();
  const message = await responseMessage(await call({ cookedMealId: 'meal-1', servings: 2, expectedRevision: 0 }));
  assert.equal(message.result.isError, undefined, JSON.stringify(message));
  const out = message.result.structuredContent;
  assert.equal(out.ok, true);
  assert.equal(out.revision, 1);
  assert.deepEqual(Object.keys(out).sort(), ['item', 'ok', 'removed', 'revision']);
  assert.equal(out.removed, false);
  assert.equal(out.item.cookedMealId, 'meal-1');
  assert.equal(out.item.servingsRemaining, 1);

  const f = fake.store.fields;
  assert.equal(f.version, 1);
  assert.equal(f.cookedMeals.length, 2);
  assert.equal(f.cookedMeals[0].id, 'meal-1');
  assert.equal(f.cookedMeals[0].portionsRemaining, 1);
  assert.deepEqual(f.cookedMeals[1], OTHER, 'unrelated record unchanged');
  assert.deepEqual(f.pantry, PANTRY, 'pantry unchanged');
  assert.deepEqual(f.deletions, {}, 'no tombstone on partial consume');
});

// ── FINAL SERVING ────────────────────────────────────────────────────────────

test('consuming the final serving removes the record, writes exactly one tombstone, returns removed=true/item=null', async () => {
  const { fake, call } = seeded();
  const message = await responseMessage(await call({ cookedMealId: 'meal-1', servings: 3, expectedRevision: 0 }));
  assert.equal(message.result.isError, undefined, JSON.stringify(message));
  assert.deepEqual(message.result.structuredContent, { ok: true, revision: 1, item: null, removed: true });

  const f = fake.store.fields;
  assert.equal(f.version, 1);
  assert.deepEqual(f.cookedMeals, [OTHER]);
  assert.deepEqual(Object.keys(f.deletions.cookedMeals), ['meal-1']);
  const stamp = f.deletions.cookedMeals['meal-1'];
  assert.equal(new Date(stamp).toISOString(), stamp, 'tombstone is a canonical ISO timestamp');
  assert.deepEqual(f.pantry, PANTRY);
});

test('final-serving write preserves pre-existing tombstones and a retired id can no longer be consumed', async () => {
  const { fake, call } = seeded({ deletions: { cookedMeals: { 'old-meal': '2026-01-01T00:00:00.000Z' } } });
  const first = await responseMessage(await call({ cookedMealId: 'meal-1', servings: 3, expectedRevision: 0 }));
  assert.equal(first.result.isError, undefined, JSON.stringify(first));
  assert.deepEqual(Object.keys(fake.store.fields.deletions.cookedMeals).sort(), ['meal-1', 'old-meal']);
  const again = await responseMessage(await call({ cookedMealId: 'meal-1', servings: 1, expectedRevision: 1 }));
  assert.equal(again.result.isError, true);
  assert.match(again.result.content[0].text, /^not_found:/);
});

// ── CONFLICT / REPLAY ────────────────────────────────────────────────────────

test('stale expectedRevision is rejected with zero mutation', async () => {
  const { fake, call } = seeded({ version: 5 });
  const before = JSON.stringify(fake.store.fields);
  const message = await responseMessage(await call({ cookedMealId: 'meal-1', servings: 1, expectedRevision: 4 }));
  assert.equal(message.result.isError, true);
  assert.match(message.result.content[0].text, /revision_conflict/);
  assert.equal(JSON.stringify(fake.store.fields), before);
});

test('replaying the same request with the old revision conflicts and never consumes twice', async () => {
  const { fake, call } = seeded();
  const first = await responseMessage(await call({ cookedMealId: 'meal-1', servings: 1, expectedRevision: 0 }));
  assert.equal(first.result.isError, undefined);
  const replay = await responseMessage(await call({ cookedMealId: 'meal-1', servings: 1, expectedRevision: 0 }));
  assert.equal(replay.result.isError, true);
  assert.match(replay.result.content[0].text, /revision_conflict/);
  assert.equal(fake.store.fields.cookedMeals[0].portionsRemaining, 2, 'exactly one serving consumed');
  assert.equal(fake.store.fields.version, 1);
});

test('the tool never retries internally: a stale call performs exactly one read and no write', async () => {
  const calls = { read: 0, write: 0 };
  const deps = {
    nowSeconds: NOW,
    getFirestoreAccessToken: async () => 'fake',
    getUserDocument: async () => { calls.read += 1; return { revision: 9, updateTime: 't', pantry: [], cookedMeals: [MEAL], deletions: {} }; },
    patchUserDocument: async () => { calls.write += 1; throw new Error('write reached'); }
  };
  const response = await routeRequest(
    mcpRequest(toolCall(1, 'consume_ready_food', VALID_ARGS)), testEnv(), deps, contextWithScope([MCP_WRITE_SCOPE])
  );
  assert.equal((await responseMessage(response)).result.isError, true);
  assert.deepEqual(calls, { read: 1, write: 0 });
});

// Deterministic race: the fetch wrapper holds every document PATCH until BOTH calls have completed
// their document GET, so both calls provably start from the same revision/updateTime. The
// persistence seam (Firestore currentDocument.updateTime precondition) must then admit exactly one
// write. No sleeps: the barrier is a promise released by the second GET.
function racingBridge(initialFields) {
  const fake = createFakeFirestore({ fields: initialFields });
  const stats = { docGets: 0, patches: 0, patchOk: 0, patchPreconditions: [] };
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const fetchImpl = async (url, init = {}) => {
    const method = (init.method || 'GET').toUpperCase();
    const isDoc = new URL(url).pathname.includes('/documents/users/');
    if (isDoc && method === 'GET') {
      stats.docGets += 1;
      const response = await fake.fetch(url, init);
      if (stats.docGets === 2) release();
      return response;
    }
    if (isDoc && method === 'PATCH') {
      stats.patches += 1;
      stats.patchPreconditions.push(new URL(url).searchParams.get('currentDocument.updateTime'));
      await barrier;
      const response = await fake.fetch(url, init);
      if (response.ok) stats.patchOk += 1;
      return response;
    }
    return fake.fetch(url, init);
  };
  const env = testEnv();
  const deps = { nowSeconds: NOW, fetchImpl, cryptoImpl: globalThis.crypto };
  const call = (args) => routeRequest(
    mcpRequest(toolCall(1, 'consume_ready_food', args)), env, deps, contextWithScope([MCP_WRITE_SCOPE])
  );
  return { fake, stats, call };
}

for (const [label, servings, expectRemoved] of [['partial consume', 1, false], ['final-serving consume', 3, true]]) {
  test('two concurrent ' + label + ' calls from the same expectedRevision: exactly one mutation wins, the other is revision_conflict', async () => {
    const { fake, stats, call } = racingBridge({ version: 0, pantry: PANTRY, cookedMeals: [MEAL, OTHER] });
    const args = { cookedMealId: 'meal-1', servings, expectedRevision: 0 };
    const [a, b] = await Promise.all([call(args), call(args)]);
    const messages = [await responseMessage(a), await responseMessage(b)];
    const successes = messages.filter((m) => m.result.isError === undefined);
    const conflicts = messages.filter((m) => m.result.isError === true && /^revision_conflict/.test(m.result.content[0].text));

    assert.equal(successes.length, 1);
    assert.equal(conflicts.length, 1);
    assert.equal(successes[0].result.structuredContent.removed, expectRemoved);
    assert.equal(successes[0].result.structuredContent.revision, 1);

    // Both writers reached the persistence seam against the same snapshot...
    assert.equal(stats.patches, 2);
    assert.equal(stats.patchPreconditions[0], stats.patchPreconditions[1]);
    // ...but only one mutation landed: no last-write-wins and no retry (no third PATCH).
    assert.equal(stats.patchOk, 1);
    assert.equal(fake.store.fields.version, 1, 'revision advanced exactly once');
    const f = fake.store.fields;
    if (expectRemoved) {
      assert.deepEqual(f.cookedMeals, [OTHER]);
      assert.deepEqual(Object.keys(f.deletions.cookedMeals), ['meal-1'], 'exactly one tombstone');
    } else {
      assert.equal(f.cookedMeals[0].portionsRemaining, 2, 'exactly one serving consumed');
      assert.deepEqual(f.deletions, {});
    }
    assert.deepEqual(f.pantry, PANTRY);
  });
}

// ── INPUT VALIDATION ─────────────────────────────────────────────────────────

test('missing or malformed expectedRevision is rejected before any Firestore access', async () => {
  for (const expectedRevision of [undefined, 1.5, -1, '0', true, null]) {
    const args = { cookedMealId: 'meal-1', servings: 1 };
    if (expectedRevision !== undefined) args.expectedRevision = expectedRevision;
    const { message, calls } = await rejected(args, contextWithScope([MCP_WRITE_SCOPE]));
    assert.equal(message.result.isError, true, JSON.stringify(expectedRevision));
    assert.match(message.result.content[0].text, /input validation error/i, JSON.stringify(expectedRevision));
    assert.match(message.result.content[0].text, /expectedRevision/, JSON.stringify(expectedRevision));
    assert.deepEqual(calls, NO_ACCESS, JSON.stringify(expectedRevision));
  }
});

test('missing or malformed cookedMealId and missing servings are rejected before any Firestore access', async () => {
  const cases = [
    { servings: 1, expectedRevision: 0 },
    { cookedMealId: '', servings: 1, expectedRevision: 0 },
    { cookedMealId: 7, servings: 1, expectedRevision: 0 },
    { cookedMealId: { id: 'meal-1' }, servings: 1, expectedRevision: 0 },
    { cookedMealId: 'meal-1', expectedRevision: 0 }
  ];
  for (const args of cases) {
    const { message, calls } = await rejected(args, contextWithScope([MCP_WRITE_SCOPE]));
    assert.equal(message.result.isError, true, JSON.stringify(args));
    assert.deepEqual(calls, NO_ACCESS, JSON.stringify(args));
  }
});

test('non-numeric servings (string, null, boolean, object) are rejected by the public tool schema before any Firestore access', async () => {
  for (const servings of ['2', null, true, {}]) {
    const { message, calls } = await rejected({ cookedMealId: 'meal-1', servings, expectedRevision: 0 }, contextWithScope([MCP_WRITE_SCOPE]));
    assert.equal(message.result.isError, true, JSON.stringify(servings));
    assert.match(message.result.content[0].text, /input validation error/i, JSON.stringify(servings));
    assert.deepEqual(calls, NO_ACCESS, JSON.stringify(servings));
  }
});

test('servings outside the domain range (0, negative, 100, <1 fraction) follow the domain validation error with zero mutation', async () => {
  for (const servings of [0, -1, 100, 0.5]) {
    const { fake, call } = seeded();
    const before = JSON.stringify(fake.store.fields);
    const message = await responseMessage(await call({ cookedMealId: 'meal-1', servings, expectedRevision: 0 }));
    assert.equal(message.result.isError, true, JSON.stringify(servings));
    assert.match(message.result.content[0].text, /servings must be a whole number between 1 and 99/, JSON.stringify(servings));
    assert.equal(JSON.stringify(fake.store.fields), before, JSON.stringify(servings));
  }
});

test('fractional servings >= 1 are floored by the domain exactly as REST does (2.9 consumes 2)', async () => {
  const { fake, call } = seeded();
  const message = await responseMessage(await call({ cookedMealId: 'meal-1', servings: 2.9, expectedRevision: 0 }));
  assert.equal(message.result.isError, undefined);
  assert.equal(fake.store.fields.cookedMeals[0].portionsRemaining, 1);
});

test('upper edge: 99.9 floors to 99 before the 1..99 check and consumes 99 (record of 99 is fully consumed)', async () => {
  const big = Object.assign({}, MEAL, { id: 'meal-big', portionsRemaining: 99 });
  const { fake, call } = bridge({ version: 0, pantry: PANTRY, cookedMeals: [big, OTHER] });
  const message = await responseMessage(await call({ cookedMealId: 'meal-big', servings: 99.9, expectedRevision: 0 }));
  assert.equal(message.result.isError, undefined, JSON.stringify(message));
  assert.deepEqual(message.result.structuredContent, { ok: true, revision: 1, item: null, removed: true });
  assert.deepEqual(fake.store.fields.cookedMeals, [OTHER]);
  assert.deepEqual(Object.keys(fake.store.fields.deletions.cookedMeals), ['meal-big']);
});

// ── ERROR MAPPING ────────────────────────────────────────────────────────────

test('over-consume maps to insufficient_servings with the remaining count and zero mutation', async () => {
  const { fake, call } = seeded();
  const before = JSON.stringify(fake.store.fields);
  const message = await responseMessage(await call({ cookedMealId: 'meal-1', servings: 4, expectedRevision: 0 }));
  assert.equal(message.result.isError, true);
  assert.equal(message.result.content[0].text, 'insufficient_servings: Not enough servings remaining. (remaining: 3)');
  assert.equal(JSON.stringify(fake.store.fields), before);
});

test('unknown cookedMealId maps to not_found with zero mutation', async () => {
  const { fake, call } = seeded();
  const before = JSON.stringify(fake.store.fields);
  const message = await responseMessage(await call({ cookedMealId: 'nope', servings: 1, expectedRevision: 0 }));
  assert.equal(message.result.isError, true);
  assert.match(message.result.content[0].text, /^not_found: No cooked-meal record with cookedMealId "nope"/);
  assert.equal(JSON.stringify(fake.store.fields), before);
});

test('an untracked batch surfaces the domain validation message, not the generic fallback', async () => {
  const { fake, call } = bridge({ version: 0, cookedMeals: [{ id: 'old', name: 'Legacy', storage: 'fridge' }] });
  const message = await responseMessage(await call({ cookedMealId: 'old', servings: 1, expectedRevision: 0 }));
  assert.equal(message.result.isError, true);
  assert.match(message.result.content[0].text, /untracked batch/);
  assert.equal(fake.store.fields.version, 0);
});

test('an unexpected infrastructure failure gets the tool-specific fallback and leaks nothing', async () => {
  const deps = {
    nowSeconds: NOW,
    getFirestoreAccessToken: async () => { throw new Error('secret-internal-detail'); }
  };
  const response = await routeRequest(
    mcpRequest(toolCall(1, 'consume_ready_food', VALID_ARGS)), testEnv(), deps, contextWithScope([MCP_WRITE_SCOPE])
  );
  const message = await responseMessage(response);
  assert.equal(message.result.isError, true);
  assert.equal(message.result.content[0].text, 'The ready-food record could not be consumed.');
});

// ── OVER-POSTING ─────────────────────────────────────────────────────────────

test('uid, owner, path, collection, document, TARGET_UID, operation and other extra keys are rejected before any Firestore access', async () => {
  for (const field of ['uid', 'owner', 'path', 'collection', 'document', 'TARGET_UID', 'operation', 'deletions', 'cookedMeals', 'removed']) {
    const args = Object.assign({}, VALID_ARGS, { [field]: 'attacker-value' });
    const { message, calls } = await rejected(args, contextWithScope([MCP_WRITE_SCOPE]));
    assert.equal(message.result.isError, true, field);
    assert.match(message.result.content[0].text, /input validation error/i, field);
    assert.deepEqual(calls, NO_ACCESS, field);
  }
});

// ── SURFACE / REGRESSION ─────────────────────────────────────────────────────

test('tools/list keeps the four ready-food tools unchanged alongside the two reviewed stock-state tools', async () => {
  const response = await routeRequest(
    mcpRequest(rpcRequest(2, 'tools/list')), testEnv(), { nowSeconds: NOW }, contextWithScope([MCP_SCOPE, MCP_WRITE_SCOPE])
  );
  const names = (await responseMessage(response)).result.tools.map((tool) => tool.name);
  assert.deepEqual(names, [
    'get_inventory', 'get_ready_food', 'record_ready_food', 'consume_ready_food',
    'mark_out_of_stock', 'mark_in_stock'
  ]);
  assert.doesNotMatch(names.join(' '), /finish|remove|delete|patch|execute|set_inventory|mutate/i);
});

test('consume_ready_food advertises typed, required, strict input and the exact result shape', async () => {
  const response = await routeRequest(
    mcpRequest(rpcRequest(2, 'tools/list')), testEnv(), { nowSeconds: NOW }, contextWithScope([MCP_SCOPE, MCP_WRITE_SCOPE])
  );
  const tool = (await responseMessage(response)).result.tools.find((t) => t.name === 'consume_ready_food');
  const input = tool.inputSchema;
  assert.equal(input.additionalProperties, false);
  assert.deepEqual([...input.required].sort(), ['cookedMealId', 'expectedRevision', 'servings']);
  assert.equal(input.properties.cookedMealId.type, 'string');
  assert.equal(input.properties.cookedMealId.minLength, 1);
  assert.equal(input.properties.servings.type, 'number', 'servings must stay a plain number so fractional >= 1 remains valid');
  assert.equal(input.properties.expectedRevision.type, 'integer');
  assert.equal(input.properties.expectedRevision.minimum, 0);
  assert.deepEqual(Object.keys(tool.outputSchema.properties).sort(), ['item', 'ok', 'removed', 'revision']);
});

test('record_ready_food stays non-destructive while consume_ready_food is destructive (separate annotation constants)', async () => {
  const response = await routeRequest(
    mcpRequest(rpcRequest(2, 'tools/list')), testEnv(), { nowSeconds: NOW }, contextWithScope([MCP_SCOPE, MCP_WRITE_SCOPE])
  );
  const tools = (await responseMessage(response)).result.tools;
  assert.equal(tools.find((t) => t.name === 'record_ready_food').annotations.destructiveHint, false);
  assert.equal(tools.find((t) => t.name === 'consume_ready_food').annotations.destructiveHint, true);
});

test('a record created by record_ready_food can be consumed to exhaustion end to end', async () => {
  const { env, deps, fake } = bridge({ version: 0 });
  const ctx = contextWithScope([MCP_SCOPE, MCP_WRITE_SCOPE]);
  const run = async (id, name, args) => responseMessage(await routeRequest(mcpRequest(toolCall(id, name, args)), env, deps, ctx));

  const rec = await run(1, 'record_ready_food', { name: 'Chili', servings: 2, storage: 'fridge', cookedDate: '2026-01-15', expectedRevision: 0 });
  const id = rec.result.structuredContent.item.cookedMealId;
  const one = await run(2, 'consume_ready_food', { cookedMealId: id, servings: 1, expectedRevision: 1 });
  assert.equal(one.result.structuredContent.removed, false);
  assert.equal(one.result.structuredContent.item.cookedMealId, id);
  const last = await run(3, 'consume_ready_food', { cookedMealId: id, servings: 1, expectedRevision: 2 });
  assert.deepEqual(last.result.structuredContent, { ok: true, revision: 3, item: null, removed: true });
  assert.deepEqual(fake.store.fields.cookedMeals, []);
});
