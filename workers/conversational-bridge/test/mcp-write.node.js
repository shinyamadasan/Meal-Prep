// TASK-069 (Phase B2A) focused coverage for the single new MCP write tool, record_ready_food.
// Mirrors the structure of mcp.node.js (lightweight auth-matrix fakes) and security.node.js
// (real in-memory fake Firestore for true persistence/conflict behavior) rather than inventing a
// third pattern.
import test from 'node:test';
import assert from 'node:assert/strict';
import { routeRequest } from '../src/index.js';
import { MCP_ISSUER, MCP_RESOURCE, MCP_SCOPE, MCP_WRITE_SCOPE } from '../src/mcpAuth.js';
import { testEnv } from './support/fixtures.js';
import { createFakeFirestore } from './support/fakeFirestore.js';

const MCP_URL = 'https://localhost/mcp';
const NOW = 1_800_000_000;
const VALID_ARGS = { name: 'Chili', servings: 2, storage: 'fridge', cookedDate: '2026-01-15', expectedRevision: 0 };

function mcpRequest(body, { method = 'POST', contentType = 'application/json', authorization = 'Bearer oauth-test-token' } = {}) {
  const headers = { Host: 'localhost', Accept: 'application/json, text/event-stream' };
  if (authorization) headers.Authorization = authorization;
  if (contentType) headers['Content-Type'] = contentType;
  const init = { method, headers };
  if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  return new Request(MCP_URL, init);
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

function readDeps(doc) {
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

// Real in-memory fake Firestore (same stand-in security.node.js uses for REST) so the revision/
// conflict matrix is proven against actual persistence, not a mock that assumes the answer.
function bridge(initialFields) {
  const fake = createFakeFirestore({ fields: initialFields });
  const env = testEnv();
  const call = (args, scope = [MCP_WRITE_SCOPE]) => routeRequest(
    mcpRequest(toolCall(1, 'record_ready_food', args)),
    env,
    { nowSeconds: NOW, fetchImpl: fake.fetch, cryptoImpl: globalThis.crypto },
    contextWithScope(scope)
  );
  return { fake, env, call };
}

// ── AUTH ─────────────────────────────────────────────────────────────────────

test('a read-only grant is denied record_ready_food with insufficient-scope challenge metadata', async () => {
  const read = readDeps({ revision: 0, pantry: [], cookedMeals: [] });
  const response = await routeRequest(
    mcpRequest(toolCall(1, 'record_ready_food', VALID_ARGS)),
    testEnv(),
    read.deps,
    contextWithScope([MCP_SCOPE])
  );
  const message = await responseMessage(response);
  assert.equal(message.result.isError, true);
  assert.match(message.result._meta['mcp/www_authenticate'][0], /insufficient_scope/);
  assert.match(message.result._meta['mcp/www_authenticate'][0], /scope="mealprep:write"/);
  assert.deepEqual(read.calls, { token: 0, read: 0, write: 0, fetch: 0 });
});

test('a write-only grant can call record_ready_food but is denied the two read tools', async () => {
  const writeOnly = contextWithScope([MCP_WRITE_SCOPE]);

  const deniedInventory = readDeps({ revision: 0, pantry: [], cookedMeals: [] });
  const inventoryResponse = await routeRequest(mcpRequest(toolCall(1, 'get_inventory')), testEnv(), deniedInventory.deps, writeOnly);
  assert.equal((await responseMessage(inventoryResponse)).result.isError, true);
  assert.deepEqual(deniedInventory.calls, { token: 0, read: 0, write: 0, fetch: 0 });

  const deniedReadyFood = readDeps({ revision: 0, pantry: [], cookedMeals: [] });
  const readyFoodResponse = await routeRequest(mcpRequest(toolCall(2, 'get_ready_food')), testEnv(), deniedReadyFood.deps, writeOnly);
  assert.equal((await responseMessage(readyFoodResponse)).result.isError, true);
  assert.deepEqual(deniedReadyFood.calls, { token: 0, read: 0, write: 0, fetch: 0 });
});

test('a combined read+write grant can call all three tools', async () => {
  const combined = contextWithScope([MCP_SCOPE, MCP_WRITE_SCOPE]);

  const readCall = readDeps({ revision: 3, pantry: [], cookedMeals: [] });
  const okInventory = await routeRequest(mcpRequest(toolCall(1, 'get_inventory')), testEnv(), readCall.deps, combined);
  assert.equal((await responseMessage(okInventory)).result.isError, undefined);

  const { call } = bridge({ version: 0, cookedMeals: [] });
  const okWrite = await call(VALID_ARGS, [MCP_SCOPE, MCP_WRITE_SCOPE]);
  assert.equal((await responseMessage(okWrite)).result.isError, undefined);
});

test('wrong owner is denied record_ready_food the same way it is denied the two read tools', async () => {
  const read = readDeps({ revision: 0, pantry: [], cookedMeals: [] });
  const wrongOwner = contextWithScope([MCP_WRITE_SCOPE], { auth: { userId: 'another-owner' } });
  const response = await routeRequest(mcpRequest(toolCall(1, 'record_ready_food', VALID_ARGS)), testEnv(), read.deps, wrongOwner);
  assert.equal((await responseMessage(response)).result.isError, true);
  assert.deepEqual(read.calls, { token: 0, read: 0, write: 0, fetch: 0 });
});

test('missing, empty, and unsupported scope tokens are each rejected before any Firestore access', async () => {
  for (const scope of [undefined, [], ['unknown'], [MCP_SCOPE, 'unknown'], [MCP_WRITE_SCOPE, 'unknown']]) {
    const read = readDeps({ revision: 0, pantry: [], cookedMeals: [] });
    const response = await routeRequest(
      mcpRequest(toolCall(1, 'record_ready_food', VALID_ARGS)),
      testEnv(),
      read.deps,
      contextWithScope(scope)
    );
    assert.equal((await responseMessage(response)).result.isError, true, JSON.stringify(scope));
    assert.deepEqual(read.calls, { token: 0, read: 0, write: 0, fetch: 0 }, JSON.stringify(scope));
  }
});

// ── REVISION / CONFLICT CONTRACT ────────────────────────────────────────────

test('correct-revision call succeeds, creates exactly one record, and returns the new canonical item + revision', async () => {
  const { fake, call } = bridge({ version: 0, cookedMeals: [] });
  const response = await call(VALID_ARGS);
  const message = await responseMessage(response);
  assert.equal(message.result.isError, undefined, JSON.stringify(message));
  assert.deepEqual(message.result.structuredContent, {
    ok: true,
    revision: 1,
    item: {
      cookedMealId: message.result.structuredContent.item.cookedMealId,
      recipeId: null,
      name: 'Chili',
      servingsRemaining: 2,
      trackedPortions: true,
      storage: 'fridge',
      cookedDate: '2026-01-15',
      updatedAt: null
    }
  });
  assert.equal(fake.store.fields.version, 1);
  assert.equal(fake.store.fields.cookedMeals.length, 1);
});

test('stale expectedRevision is rejected with zero mutation', async () => {
  const { fake, call } = bridge({ version: 5, cookedMeals: [] });
  const response = await call(Object.assign({}, VALID_ARGS, { expectedRevision: 4 }));
  const message = await responseMessage(response);
  assert.equal(message.result.isError, true);
  assert.match(message.result.content[0].text, /revision_conflict/);
  assert.equal(fake.store.fields.version, 5);
  assert.equal(fake.store.fields.cookedMeals.length, 0);
});

test('missing expectedRevision is rejected before any Firestore read', async () => {
  const read = readDeps({ revision: 0, pantry: [], cookedMeals: [] });
  const args = { name: 'Chili', servings: 2, storage: 'fridge', cookedDate: '2026-01-15' };
  const response = await routeRequest(mcpRequest(toolCall(1, 'record_ready_food', args)), testEnv(), read.deps, contextWithScope([MCP_WRITE_SCOPE]));
  const message = await responseMessage(response);
  assert.equal(message.result.isError, true);
  assert.match(message.result.content[0].text, /expectedRevision must be a non-negative integer/);
  assert.deepEqual(read.calls, { token: 0, read: 0, write: 0, fetch: 0 });
});

test('malformed expectedRevision (non-integer, negative, string, boolean) is rejected before any Firestore read', async () => {
  for (const expectedRevision of [1.5, -1, '0', true, null]) {
    const read = readDeps({ revision: 0, pantry: [], cookedMeals: [] });
    const args = Object.assign({}, VALID_ARGS, { expectedRevision });
    const response = await routeRequest(mcpRequest(toolCall(1, 'record_ready_food', args)), testEnv(), read.deps, contextWithScope([MCP_WRITE_SCOPE]));
    const message = await responseMessage(response);
    assert.equal(message.result.isError, true, JSON.stringify(expectedRevision));
    assert.match(message.result.content[0].text, /expectedRevision must be a non-negative integer/, JSON.stringify(expectedRevision));
    assert.deepEqual(read.calls, { token: 0, read: 0, write: 0, fetch: 0 }, JSON.stringify(expectedRevision));
  }
});

test('two calls racing the same expectedRevision: exactly one succeeds, the other fails revision_conflict with no silent overwrite', async () => {
  const { fake, call } = bridge({ version: 0, cookedMeals: [] });
  const first = await responseMessage(await call(VALID_ARGS));
  assert.equal(first.result.isError, undefined);
  const second = await responseMessage(await call(VALID_ARGS));
  assert.equal(second.result.isError, true);
  assert.match(second.result.content[0].text, /revision_conflict/);
  assert.equal(fake.store.fields.cookedMeals.length, 1, 'the race must not have produced a second record');
});

test('a transport-level retry of the exact same request cannot create a second record', async () => {
  const { fake, call } = bridge({ version: 0, cookedMeals: [] });
  const first = await responseMessage(await call(VALID_ARGS));
  assert.equal(first.result.isError, undefined);
  const retry = await responseMessage(await call(VALID_ARGS));
  assert.equal(retry.result.isError, true);
  assert.match(retry.result.content[0].text, /revision_conflict/);
  assert.equal(fake.store.fields.cookedMeals.length, 1, 'retry must not have created a second record');
});

test('the resulting cookedMealId is stable and reusable by a later get_ready_food call', async () => {
  const { fake, env, call } = bridge({ version: 0, cookedMeals: [] });
  const recorded = await responseMessage(await call(VALID_ARGS));
  const cookedMealId = recorded.result.structuredContent.item.cookedMealId;

  const readResponse = await routeRequest(
    mcpRequest(toolCall(2, 'get_ready_food')),
    env,
    { nowSeconds: NOW, fetchImpl: fake.fetch, cryptoImpl: globalThis.crypto },
    contextWithScope([MCP_SCOPE])
  );
  const readMessage = await responseMessage(readResponse);
  assert.equal(readMessage.result.structuredContent.items.length, 1);
  assert.equal(readMessage.result.structuredContent.items[0].cookedMealId, cookedMealId);
});

// ── WRITE TOOL / domain-validation shape ────────────────────────────────────

test('missing or malformed name, servings, storage, or cookedDate are rejected using the existing REST validation error shapes, with zero mutation', async () => {
  const cases = [
    { args: { servings: 2, storage: 'fridge', cookedDate: '2026-01-15', expectedRevision: 0 }, match: /name must be a non-empty string/ },
    { args: { name: 'Chili', storage: 'fridge', cookedDate: '2026-01-15', expectedRevision: 0 }, match: /servings must be a whole number/ },
    { args: { name: 'Chili', servings: 2, cookedDate: '2026-01-15', expectedRevision: 0 }, match: /storage must be one of/ },
    { args: { name: 'Chili', servings: 2, storage: 'fridge', expectedRevision: 0 }, match: /cookedDate must be a YYYY-MM-DD/ },
    { args: { name: 'Chili', servings: 2, storage: 'fridge', cookedDate: '2026-02-30', expectedRevision: 0 }, match: /not a real calendar date/ }
  ];
  for (const { args, match } of cases) {
    const { fake, call } = bridge({ version: 0, cookedMeals: [] });
    const message = await responseMessage(await call(args));
    assert.equal(message.result.isError, true, JSON.stringify(args));
    assert.match(message.result.content[0].text, match, JSON.stringify(args));
    assert.equal(fake.store.fields.version, 0, JSON.stringify(args));
    assert.equal(fake.store.fields.cookedMeals.length, 0, JSON.stringify(args));
  }
});

// ── ADVERSARIAL ──────────────────────────────────────────────────────────────

test('caller cannot supply a uid, Firebase path, Firestore collection, or existing-record id — over-posting is rejected before any Firestore access', async () => {
  for (const field of ['uid', 'owner', 'path', 'collection', 'document', 'TARGET_UID', 'cookedMealId']) {
    const read = readDeps({ revision: 0, pantry: [], cookedMeals: [] });
    const args = Object.assign({}, VALID_ARGS, { [field]: 'attacker-value' });
    const response = await routeRequest(mcpRequest(toolCall(1, 'record_ready_food', args)), testEnv(), read.deps, contextWithScope([MCP_WRITE_SCOPE]));
    const message = await responseMessage(response);
    assert.equal(message.result.isError, true, field);
    assert.match(message.result.content[0].text, /input validation error/i, field);
    assert.deepEqual(read.calls, { token: 0, read: 0, write: 0, fetch: 0 }, field);
  }
});

test('record_ready_food only ever appends — an existing cookedMeals record and pantry are both left untouched', async () => {
  const existingMeal = { id: 'existing-meal', name: 'Old Adobo', portionsRemaining: 1, storage: 'fridge', cookedDate: '2026-01-01' };
  const { fake, call } = bridge({
    version: 0,
    pantry: [{ id: 'p1', name: 'Rice', quantity: 1, staple: false }],
    cookedMeals: [existingMeal]
  });
  const message = await responseMessage(await call(VALID_ARGS));
  assert.equal(message.result.isError, undefined);
  assert.equal(fake.store.fields.cookedMeals.length, 2);
  assert.deepEqual(fake.store.fields.cookedMeals[0], existingMeal);
  assert.equal(fake.store.fields.pantry.length, 1, 'pantry must be untouched — D-082 forbids touching two collections in one write');
});
