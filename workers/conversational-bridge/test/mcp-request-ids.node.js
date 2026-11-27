// TASK-093 (PROP-041 P1-3): required requestId + atomic request record on every MCP write tool.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { routeRequest } from '../src/index.js';
import { MCP_ISSUER, MCP_RESOURCE, MCP_WRITE_SCOPE } from '../src/mcpAuth.js';
import {
  commitRequestWrite,
  encodeRequestRecord,
  getRequestRecord,
  InfrastructureError,
  RequestAlreadyRecordedError,
  RevisionConflictError
} from '../src/firestore.js';
import * as requests from '../src/operations/requests.js';
import * as inventory from '../src/operations/inventory.js';
import * as readyFood from '../src/operations/readyFood.js';
import { testEnv } from './support/fixtures.js';
import { createFakeFirestore } from './support/fakeFirestore.js';
import { WRITE_TOOL_NAMES } from './support/requestIds.js';

const NOW = 1_800_000_000;
const CLOCK_MS = Date.parse('2026-11-27T03:04:05.678Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const OWNER = 'test-owner-subject';

const CHICKEN = { id: 'chicken', name: 'Chicken', quantity: 500, unit: 'g', staple: false, category: 'protein', storage: 'fridge' };
const EGGS = { id: 'eggs', name: 'Eggs', quantity: 6, unit: 'pcs', staple: false, category: 'dairy', storage: 'fridge' };
const SALT = { id: 'salt', name: 'Salt', staple: true, stockLevel: 'full', quantity: 1, unit: 'kg', category: 'spices' };
const RICE = { id: 'rice', name: 'Rice', staple: true, stockLevel: 'empty', category: 'grains' };
const MEAL = { id: 'meal-1', name: 'Chili', recipeId: 'recipe-9', portionsRemaining: 3, storage: 'fridge', cookedDate: '2026-11-26' };

// One valid call per write tool against the seed below.
const VALID_CALLS = {
  record_ready_food: { name: 'Soup', servings: 2, storage: 'fridge', cookedDate: '2026-11-26', expectedRevision: 3 },
  consume_ready_food: { cookedMealId: 'meal-1', servings: 1, expectedRevision: 3 },
  mark_out_of_stock: { ingredientId: 'salt', expectedRevision: 3 },
  mark_in_stock: { ingredientId: 'rice', expectedRevision: 3 },
  set_inventory_quantity: { ingredientId: 'eggs', quantity: 12, expectedUnit: 'pcs', expectedRevision: 3 },
  consume_stock: { ingredientId: 'chicken', quantity: 100, expectedUnit: 'g', expectedRevision: 3 },
  add_stock: { ingredientId: 'eggs', quantity: 6, expectedUnit: 'pcs', expectedRevision: 3 }
};

function seed(extra = {}) {
  return Object.assign({
    version: 3,
    pantry: [structuredClone(CHICKEN), structuredClone(EGGS), structuredClone(SALT), structuredClone(RICE)],
    cookedMeals: [structuredClone(MEAL)],
    mealConsumptions: [{ id: 'mc-prior', cookedMealId: 'meal-0', recipeId: null, mealName: 'Old', portionsConsumed: 1, consumedAt: '2026-11-01T00:00:00.000Z' }],
    deletions: { pantry: { 'old-lot': '2026-10-01T00:00:00.000Z' }, cookedMeals: {} }
  }, extra);
}

function context() {
  return {
    auth: { token: 'not-a-real-token', audience: MCP_RESOURCE, expiresAt: NOW + 300, scope: [MCP_WRITE_SCOPE], userId: OWNER, clientId: 'https://chatgpt.com/oauth/client.json' },
    props: { ownerSubject: OWNER, issuer: MCP_ISSUER, resource: MCP_RESOURCE, notBefore: NOW - 1 }
  };
}

function mcpRequest(name, args) {
  return new Request('https://localhost/mcp', {
    method: 'POST',
    headers: { Host: 'localhost', Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
  });
}

async function messageOf(response) {
  const raw = await response.text();
  if ((response.headers.get('Content-Type') || '').includes('text/event-stream')) {
    return JSON.parse(raw.split(/\r?\n/).find((line) => line.startsWith('data: ')).slice(6));
  }
  return JSON.parse(raw);
}

// The fake Firestore with every HTTP call recorded; `hook(kind, url, init)` may hold or replace a call.
function bridge(fields = seed(), { hook } = {}) {
  const fake = createFakeFirestore({ fields });
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = (init.method || 'GET').toUpperCase();
    let kind = 'other';
    if (u.pathname.endsWith('/documents:commit')) kind = 'commit';
    else if (/\/mcpRequests\//.test(u.pathname)) kind = 'requestGet';
    else if (/\/documents\/users\/[^/]+$/.test(u.pathname)) kind = method === 'GET' ? 'docGet' : 'patch';
    calls.push({ kind, url, init });
    if (hook) {
      const replaced = await hook(kind, url, init, fake);
      if (replaced) return replaced;
    }
    return fake.fetch(url, init);
  };
  const deps = { nowSeconds: NOW, now: () => CLOCK_MS, fetchImpl, cryptoImpl: globalThis.crypto };
  const call = (name, args) => routeRequest(mcpRequest(name, args), testEnv(), deps, context()).then(messageOf);
  const count = (kind) => calls.filter((c) => c.kind === kind).length;
  return { fake, calls, call, count };
}

function expectedHash(args) {
  return createHash('sha256').update(requests.canonicalJson(requests.hashableArgs(args))).digest('hex');
}

function text(message) {
  return message.result.content && message.result.content[0] && message.result.content[0].text;
}

// ── requestId is required and validated before any Firestore access ──────────────────────────

test('every write tool requires requestId in its public schema; read tools do not', async () => {
  const response = await routeRequest(
    new Request('https://localhost/mcp', {
      method: 'POST',
      headers: { Host: 'localhost', Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    }), testEnv(), { nowSeconds: NOW }, context()
  );
  const tools = (await messageOf(response)).result.tools;
  for (const tool of tools) {
    if (WRITE_TOOL_NAMES.includes(tool.name)) {
      assert.ok(tool.inputSchema.required.includes('requestId'), tool.name);
      assert.equal(tool.inputSchema.properties.requestId.type, 'string', tool.name);
      assert.equal(tool.inputSchema.properties.requestId.pattern, '^[A-Za-z0-9_-]{8,128}$', tool.name);
      assert.ok('replayed' in tool.outputSchema.properties, tool.name);
      assert.ok(!tool.outputSchema.required.includes('replayed'), tool.name + ': replayed is optional');
      assert.match(tool.description, /requestId is required/, tool.name);
      assert.match(tool.description, /SAME requestId when you retry/, tool.name);
      assert.match(tool.description, /request_id_reused/, tool.name);
    } else {
      assert.equal(tool.inputSchema.properties && tool.inputSchema.properties.requestId, undefined, tool.name);
    }
  }
  assert.deepEqual(tools.filter((t) => WRITE_TOOL_NAMES.includes(t.name)).map((t) => t.name).sort(), [...WRITE_TOOL_NAMES].sort());
});

test('a missing or malformed requestId is a validation error with zero Firestore access, on every write tool', async () => {
  const bad = [undefined, '', 'short7c', 'x'.repeat(129), 'has space1', 'slash/inid', 'dot.inside', 'ünïcödé-id', 12345678, null, true, ['abcdefgh'], { id: 'abcdefgh' }];
  for (const name of WRITE_TOOL_NAMES) {
    for (const requestId of bad) {
      const b = bridge();
      const message = await b.call(name, Object.assign({}, VALID_CALLS[name], { requestId }));
      assert.equal(message.result.isError, true, name + ' ' + JSON.stringify(requestId));
      assert.match(text(message), /requestId/, name + ' ' + JSON.stringify(requestId));
      assert.equal(b.calls.length, 0, name + ' ' + JSON.stringify(requestId) + ': no Firestore access');
    }
  }
});

test('boundary requestIds (8 and 128 characters, every allowed character) are accepted', async () => {
  for (const requestId of ['abcdefgh', 'A'.repeat(128), 'Az09_-Az09_-']) {
    const b = bridge();
    const message = await b.call('add_stock', Object.assign({ requestId }, VALID_CALLS.add_stock));
    assert.equal(message.result.isError, undefined, requestId);
    assert.ok(b.fake.requestRecord(requestId), requestId);
  }
});

test('validateRequestId repeats the rule for non-schema callers', () => {
  assert.equal(requests.validateRequestId('abcd_EF-12'), 'abcd_EF-12');
  for (const value of [undefined, null, 'abc', 'a'.repeat(129), 'bad id!!', 42]) {
    assert.throws(() => requests.validateRequestId(value), (error) => error.code === 'validation_failed' && error.detail.field === 'requestId');
  }
});

// ── One atomic commit: guarded user update + create-only request record ─────────────────────

test('each write tool makes exactly ONE documents:commit with the guarded user update and a create-only request record', async () => {
  const expectedMasks = {
    record_ready_food: ['cookedMeals', 'version'],
    consume_ready_food: ['cookedMeals', 'mealConsumptions', 'version'],
    mark_out_of_stock: ['pantry', 'version'],
    mark_in_stock: ['pantry', 'version'],
    set_inventory_quantity: ['pantry', 'version'],
    consume_stock: ['pantry', 'version'],
    add_stock: ['pantry', 'version']
  };
  for (const name of WRITE_TOOL_NAMES) {
    const b = bridge();
    const updateTime = b.fake.store.updateTime;
    const requestId = 'commit-shape-' + name;
    const message = await b.call(name, Object.assign({ requestId }, VALID_CALLS[name]));
    assert.equal(message.result.isError, undefined, name + ': ' + text(message));
    assert.equal(message.result.structuredContent.revision, 4, name);
    assert.equal(message.result.structuredContent.replayed, undefined, name + ': a first apply is not a replay');

    assert.equal(b.count('commit'), 1, name);
    assert.equal(b.count('patch'), 0, name + ': no separate PATCH');
    const writes = JSON.parse(b.calls.find((c) => c.kind === 'commit').init.body).writes;
    assert.equal(writes.length, 2, name);
    const [user, record] = writes;
    assert.equal(user.update.name, 'projects/meal-prep-test/databases/(default)/documents/users/test-uid-1', name);
    assert.deepEqual(user.updateMask.fieldPaths.slice().sort(), expectedMasks[name], name);
    assert.deepEqual(user.currentDocument, { updateTime }, name);
    assert.deepEqual(user.update.fields.version, { integerValue: '4' }, name);
    assert.equal(record.update.name, 'projects/meal-prep-test/databases/(default)/documents/users/test-uid-1/mcpRequests/' + requestId, name);
    assert.deepEqual(record.currentDocument, { exists: false }, name);
    assert.equal(record.updateMask, undefined, name + ': the record is written whole');

    assert.equal(b.fake.store.fields.version, 4, name);
    assert.ok(b.fake.requestRecord(requestId), name);
  }
});

test('a not-yet-created user document is still guarded with exists:false inside the commit', async () => {
  const fake = createFakeFirestore({ exists: false });
  let body;
  const fetchImpl = async (url, init = {}) => {
    if (new URL(url).pathname.endsWith('/documents:commit')) body = JSON.parse(init.body);
    return fake.fetch(url, init);
  };
  const deps = { nowSeconds: NOW, now: () => CLOCK_MS, fetchImpl, cryptoImpl: globalThis.crypto };
  const message = await messageOf(await routeRequest(mcpRequest('record_ready_food', Object.assign({ requestId: 'first-write-1' }, VALID_CALLS.record_ready_food, { expectedRevision: 0 })), testEnv(), deps, context()));
  assert.equal(message.result.isError, undefined, text(message));
  assert.deepEqual(body.writes[0].currentDocument, { exists: false });
  assert.equal(fake.store.fields.version, 1);
});

test('the request record stores tool, argsHash, actor, timestamps (+30 days), revisions, result and before', async () => {
  const b = bridge();
  const args = { requestId: 'record-contents-1', ingredientId: 'chicken', quantity: 100, expectedUnit: 'g', expectedRevision: 3 };
  const message = await b.call('consume_stock', args);
  const stored = b.fake.requestRecord('record-contents-1');
  assert.deepEqual(Object.keys(stored).sort(), ['actor', 'added', 'argsHash', 'before', 'createdAt', 'expireAt', 'result', 'revisionAfter', 'revisionBefore', 'tool']);
  assert.deepEqual(stored.added, {}, 'a partial consume adds no record');
  assert.equal(stored.tool, 'consume_stock');
  assert.equal(stored.argsHash, expectedHash(args));
  assert.equal(stored.argsHash, expectedHash({ quantity: 100, expectedUnit: 'g', ingredientId: 'chicken' }), 'requestId and expectedRevision are not hashed');
  assert.equal(stored.actor, OWNER);
  assert.equal(stored.createdAt, new Date(CLOCK_MS).toISOString());
  assert.equal(Date.parse(stored.expireAt) - Date.parse(stored.createdAt), 30 * DAY_MS);
  assert.equal(stored.revisionBefore, 3);
  assert.equal(stored.revisionAfter, 4);
  assert.deepEqual(stored.result, message.result.structuredContent);
  assert.deepEqual(stored.before, { pantry: [CHICKEN], cookedMeals: [], deletions: {} });

  // createdAt / expireAt go over the wire as Firestore timestamps (a TTL policy needs a timestamp).
  const recordWrite = JSON.parse(b.calls.find((c) => c.kind === 'commit').init.body).writes[1];
  assert.deepEqual(recordWrite.update.fields.createdAt, { timestampValue: '2026-11-27T03:04:05.678Z' });
  assert.deepEqual(recordWrite.update.fields.expireAt, { timestampValue: '2026-12-27T03:04:05.678Z' });
});

test('before: a removal snapshots the full record and the prior tombstone entry (null = none); untouched entries are not listed', async () => {
  const b = bridge(seed({ deletions: { pantry: { 'old-lot': '2026-10-01T00:00:00.000Z', chicken: '2026-09-01T00:00:00.000Z' }, cookedMeals: {} } }));
  // A live chicken row with a stale tombstone of its own: the removal overwrites that entry.
  const result = await b.call('consume_stock', { requestId: 'remove-chicken-1', ingredientId: 'chicken', quantity: 500, expectedUnit: 'g', expectedRevision: 3 });
  assert.equal(result.result.structuredContent.removed, true);
  const stored = b.fake.requestRecord('remove-chicken-1');
  assert.deepEqual(stored.before.pantry, [CHICKEN]);
  assert.deepEqual(stored.before.deletions, { pantry: { chicken: '2026-09-01T00:00:00.000Z' } });

  const c = bridge();
  await c.call('mark_out_of_stock', { requestId: 'remove-eggs-01', ingredientId: 'eggs', expectedRevision: 3 });
  const eggs = c.fake.requestRecord('remove-eggs-01');
  assert.deepEqual(eggs.before.pantry, [EGGS]);
  assert.deepEqual(eggs.before.deletions, { pantry: { eggs: null } });
  assert.ok(c.fake.store.fields.deletions.pantry['old-lot'], 'unrelated tombstone untouched');
});

test('before: ready food — a final serving snapshots the batch and its tombstone; a new record has no before', async () => {
  const b = bridge();
  await b.call('consume_ready_food', { requestId: 'final-serving-1', cookedMealId: 'meal-1', servings: 3, expectedRevision: 3 });
  const finalServing = b.fake.requestRecord('final-serving-1');
  assert.deepEqual(finalServing.before, { pantry: [], cookedMeals: [MEAL], deletions: { cookedMeals: { 'meal-1': null } } });
  assert.equal(finalServing.result.removed, true);

  const c = bridge();
  await c.call('record_ready_food', Object.assign({ requestId: 'new-batch-01' }, VALID_CALLS.record_ready_food));
  const created = c.fake.requestRecord('new-batch-01');
  assert.deepEqual(created.before, { pantry: [], cookedMeals: [], deletions: {} });
  assert.ok(created.result.item.cookedMealId, 'the created id is in the stored result');
});

test('a no-op write (already full) leaves the user document alone but spends the requestId', async () => {
  const b = bridge();
  const versionBefore = b.fake.store.fields.version;
  const pantryBefore = JSON.stringify(b.fake.store.fields.pantry);
  const message = await b.call('mark_in_stock', { requestId: 'noop-full-01', ingredientId: 'salt', expectedRevision: 3 });
  assert.equal(message.result.structuredContent.unchanged, true);
  assert.equal(message.result.structuredContent.revision, 3);
  assert.equal(b.count('commit'), 1, 'one record-only commit');
  // The exact commit body: ONE write, the create-only request record; no user-document write.
  const body = JSON.parse(b.calls.find((c) => c.kind === 'commit').init.body);
  assert.equal(body.writes.length, 1);
  assert.match(body.writes[0].update.name, /\/users\/[^/]+\/mcpRequests\/noop-full-01$/);
  assert.deepEqual(body.writes[0].currentDocument, { exists: false });
  assert.equal(body.writes[0].updateMask, undefined);
  assert.equal(b.fake.store.fields.version, versionBefore, 'user document version unchanged');
  assert.equal(JSON.stringify(b.fake.store.fields.pantry), pantryBefore, 'pantry unchanged');
  const record = b.fake.requestRecord('noop-full-01');
  assert.equal(record.tool, 'mark_in_stock');
  assert.equal(record.revisionBefore, 3);
  assert.equal(record.revisionAfter, 3);
  assert.deepEqual(record.before, { pantry: [], cookedMeals: [], deletions: {} });
  assert.deepEqual(record.added, {});

  // Lost response, then a retry with the same id: the stored answer, nothing applied.
  const again = await b.call('mark_in_stock', { requestId: 'noop-full-01', ingredientId: 'salt', expectedRevision: 3 });
  assert.deepEqual(again.result.structuredContent, Object.assign({}, message.result.structuredContent, { replayed: true }));
  assert.equal(b.count('commit'), 1);
  // The same id for a different change is refused.
  const reused = await b.call('mark_out_of_stock', { requestId: 'noop-full-01', ingredientId: 'salt', expectedRevision: 3 });
  assert.match(text(reused), /^request_id_reused/);
});

test('added: consume_ready_food records the ledger fact it appended; record_ready_food records the new batch', async () => {
  const b = bridge();
  const consumptionsBefore = (b.fake.store.fields.mealConsumptions || []).length;
  await b.call('consume_ready_food', { requestId: 'eat-one-0001', cookedMealId: 'meal-1', servings: 1, expectedRevision: 3 });
  const rec = b.fake.requestRecord('eat-one-0001');
  const written = b.fake.store.fields.mealConsumptions;
  assert.equal(written.length, consumptionsBefore + 1);
  assert.deepEqual(rec.added, { mealConsumptions: [written[written.length - 1]] });
  assert.equal(rec.added.mealConsumptions[0].cookedMealId, 'meal-1');

  const c = bridge();
  await c.call('record_ready_food', Object.assign({ requestId: 'new-batch-02' }, VALID_CALLS.record_ready_food));
  const created = c.fake.requestRecord('new-batch-02');
  assert.equal(created.added.cookedMeals.length, 1);
  assert.equal(String(created.added.cookedMeals[0].id), created.result.item.cookedMealId);
});

test('no-op failure paths: concurrent same-id no-ops give one record and one replay; ABORTED with no record is revision_conflict', async () => {
  const b = racingBridge();
  const args = { requestId: 'noop-race-001', ingredientId: 'salt', expectedRevision: 3 };
  const [x, y] = await Promise.all([b.call('mark_in_stock', args), b.call('mark_in_stock', args)]);
  for (const m of [x, y]) {
    assert.equal(m.result.isError, undefined, text(m));
    assert.equal(m.result.structuredContent.unchanged, true);
    assert.equal(m.result.structuredContent.revision, 3);
  }
  assert.equal([x, y].filter((m) => m.result.structuredContent.replayed === true).length, 1);
  assert.equal(b.fake.store.fields.version, 3, 'user document untouched');
  assert.equal(b.fake.requestRecord('noop-race-001').tool, 'mark_in_stock');

  const aborted = bridge(seed(), {
    hook: async (kind) => (kind === 'commit'
      ? new Response(JSON.stringify({ error: { code: 409, status: 'ABORTED', message: 'Transaction aborted.' } }),
        { status: 409, headers: { 'Content-Type': 'application/json' } })
      : null)
  });
  const failed = await aborted.call('mark_in_stock', { requestId: 'noop-abort-01', ingredientId: 'salt', expectedRevision: 3 });
  assert.equal(failed.result.isError, true);
  assert.match(text(failed), /^revision_conflict/);
  assert.equal(aborted.fake.requestRecord('noop-abort-01'), undefined);
  assert.equal(aborted.fake.store.fields.version, 3);
});

// ── Replay and reuse ─────────────────────────────────────────────────────────────────────────

test('replay after success returns the stored result with replayed:true and writes nothing, on every write tool', async () => {
  for (const name of WRITE_TOOL_NAMES) {
    const b = bridge();
    const args = Object.assign({ requestId: 'replay-' + name }, VALID_CALLS[name]);
    const first = await b.call(name, args);
    assert.equal(first.result.isError, undefined, name + ': ' + text(first));
    const storeAfterFirst = JSON.stringify(b.fake.store);
    const commits = b.count('commit');

    const again = await b.call(name, args);
    assert.equal(again.result.isError, undefined, name);
    assert.deepEqual(again.result.structuredContent, Object.assign({}, first.result.structuredContent, { replayed: true }), name);
    assert.equal(b.count('commit'), commits, name + ': no second commit');
    assert.equal(JSON.stringify(b.fake.store), storeAfterFirst, name + ': store unchanged');
  }
});

test('a replay with a now-stale expectedRevision (or reordered keys) still returns the stored result and writes nothing', async () => {
  const b = bridge();
  const first = await b.call('add_stock', { requestId: 'stale-replay-1', ingredientId: 'eggs', quantity: 6, expectedUnit: 'pcs', expectedRevision: 3 });
  assert.equal(b.fake.store.fields.version, 4);
  for (const expectedRevision of [3, 4, 99]) {
    const again = await b.call('add_stock', { expectedRevision, expectedUnit: 'pcs', quantity: 6, ingredientId: 'eggs', requestId: 'stale-replay-1' });
    assert.equal(again.result.isError, undefined, String(expectedRevision));
    assert.equal(again.result.structuredContent.replayed, true);
    assert.equal(again.result.structuredContent.revision, first.result.structuredContent.revision);
  }
  assert.equal(b.fake.store.fields.pantry.find((p) => p.id === 'eggs').quantity, 12, 'added exactly once');
  assert.equal(b.count('commit'), 1);
  assert.equal(b.count('docGet'), 1, 'a replay never reads the user document');
});

test('same requestId with different arguments or a different tool is request_id_reused with zero writes', async () => {
  const b = bridge();
  await b.call('add_stock', { requestId: 'reused-id-01', ingredientId: 'eggs', quantity: 6, expectedUnit: 'pcs', expectedRevision: 3 });
  const storeAfterFirst = JSON.stringify(b.fake.store);
  const cases = [
    ['add_stock', { requestId: 'reused-id-01', ingredientId: 'eggs', quantity: 7, expectedUnit: 'pcs', expectedRevision: 4 }],
    ['add_stock', { requestId: 'reused-id-01', ingredientId: 'chicken', quantity: 6, expectedUnit: 'g', expectedRevision: 4 }],
    ['consume_stock', { requestId: 'reused-id-01', ingredientId: 'eggs', quantity: 6, expectedUnit: 'pcs', expectedRevision: 4 }]
  ];
  for (const [name, args] of cases) {
    const message = await b.call(name, args);
    assert.equal(message.result.isError, true, name);
    assert.match(text(message), /^request_id_reused: /, name);
  }
  assert.equal(b.count('commit'), 1);
  assert.equal(JSON.stringify(b.fake.store), storeAfterFirst);
  assert.equal(b.fake.requestRecord('reused-id-01').tool, 'add_stock', 'the original record is untouched');
});

test('replay after a timeout where the commit DID land: one write, the retry is a replay', async () => {
  let dropped = false;
  const b = bridge(seed(), {
    hook: async (kind, url, init, fake) => {
      if (kind === 'commit' && !dropped) {
        dropped = true;
        await fake.fetch(url, init); // Firestore applied it...
        throw new Error('socket hang up'); // ...but the response never arrived.
      }
      return null;
    }
  });
  const args = { requestId: 'timeout-landed-1', ingredientId: 'chicken', quantity: 100, expectedUnit: 'g', expectedRevision: 3 };
  const first = await b.call('consume_stock', args);
  assert.equal(first.result.isError, true);
  assert.equal(text(first), 'The inventory stock could not be consumed.');
  assert.equal(b.fake.store.fields.version, 4, 'the commit landed');

  const retry = await b.call('consume_stock', args);
  assert.equal(retry.result.isError, undefined, text(retry));
  assert.equal(retry.result.structuredContent.replayed, true);
  assert.equal(retry.result.structuredContent.revision, 4);
  assert.equal(retry.result.structuredContent.item.quantity, 400);
  assert.equal(b.fake.store.fields.pantry.find((p) => p.id === 'chicken').quantity, 400, 'consumed exactly once');
  assert.equal(b.fake.counters.commits, 1);
});

test('a timeout where the commit did NOT land: the retry applies it once', async () => {
  let dropped = false;
  const b = bridge(seed(), {
    hook: async (kind) => {
      if (kind === 'commit' && !dropped) { dropped = true; throw new Error('connect timeout'); }
      return null;
    }
  });
  const args = { requestId: 'timeout-lost-01', ingredientId: 'chicken', quantity: 100, expectedUnit: 'g', expectedRevision: 3 };
  assert.equal((await b.call('consume_stock', args)).result.isError, true);
  assert.equal(b.fake.store.fields.version, 3);
  const retry = await b.call('consume_stock', args);
  assert.equal(retry.result.structuredContent.replayed, undefined);
  assert.equal(b.fake.store.fields.pantry.find((p) => p.id === 'chicken').quantity, 400);
  assert.equal(b.fake.counters.commits, 1);
});

// Both calls pass the request-record read and the user-document read before either commits.
function racingBridge() {
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  let docGets = 0;
  return bridge(seed(), {
    hook: async (kind, url, init, fake) => {
      if (kind === 'docGet') {
        const response = await fake.fetch(url, init);
        docGets += 1;
        if (docGets === 2) release();
        return response;
      }
      if (kind === 'commit') await barrier;
      return null;
    }
  });
}

test('concurrent identical requests (same requestId): one write, the loser reads the record back as a replay', async () => {
  for (const name of WRITE_TOOL_NAMES) {
    const b = racingBridge();
    const args = Object.assign({ requestId: 'concurrent-' + name }, VALID_CALLS[name]);
    const [x, y] = await Promise.all([b.call(name, args), b.call(name, args)]);
    for (const m of [x, y]) assert.equal(m.result.isError, undefined, name + ': ' + text(m));
    const replays = [x, y].filter((m) => m.result.structuredContent.replayed === true);
    assert.equal(replays.length, 1, name + ': exactly one replay');
    const winner = [x, y].find((m) => m.result.structuredContent.replayed === undefined);
    assert.deepEqual(replays[0].result.structuredContent, Object.assign({}, winner.result.structuredContent, { replayed: true }), name);
    assert.equal(b.count('commit'), 2, name + ': both reached the commit');
    assert.equal(b.fake.counters.commits, 1, name + ': only one landed');
    assert.equal(b.fake.store.fields.version, 4, name);
  }
});

test('concurrent different requests at the same revision: one wins, the other is revision_conflict and leaves no record', async () => {
  const b = racingBridge();
  const [x, y] = await Promise.all([
    b.call('consume_stock', { requestId: 'race-left-001', ingredientId: 'chicken', quantity: 100, expectedUnit: 'g', expectedRevision: 3 }),
    b.call('consume_stock', { requestId: 'race-right-01', ingredientId: 'chicken', quantity: 100, expectedUnit: 'g', expectedRevision: 3 })
  ]);
  const ok = [x, y].filter((m) => m.result.isError === undefined);
  const conflicts = [x, y].filter((m) => /^revision_conflict: /.test(text(m) || ''));
  assert.equal(ok.length, 1);
  assert.equal(conflicts.length, 1);
  assert.equal(b.fake.store.fields.pantry.find((p) => p.id === 'chicken').quantity, 400);
  assert.equal(b.fake.requests.size, 1, 'both writes or neither: the loser left no request record');
});

test('a reused requestId that loses the commit race to a DIFFERENT change is request_id_reused, not a replay', async () => {
  const b = racingBridge();
  const [x, y] = await Promise.all([
    b.call('add_stock', { requestId: 'race-reuse-01', ingredientId: 'eggs', quantity: 6, expectedUnit: 'pcs', expectedRevision: 3 }),
    b.call('add_stock', { requestId: 'race-reuse-01', ingredientId: 'eggs', quantity: 9, expectedUnit: 'pcs', expectedRevision: 3 })
  ]);
  assert.equal([x, y].filter((m) => m.result.isError === undefined).length, 1);
  assert.equal([x, y].filter((m) => /^request_id_reused: /.test(text(m) || '')).length, 1);
  assert.equal(b.fake.counters.commits, 1);
});

// ── Pure helpers ─────────────────────────────────────────────────────────────────────────────

test('canonicalJson sorts keys at every depth and the hash ignores requestId and expectedRevision', async () => {
  assert.equal(requests.canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null }, u: undefined }), '{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}');
  const a = await requests.argsHash({ requestId: 'one-11111', expectedRevision: 1, x: 1, y: 'two' });
  const b = await requests.argsHash({ y: 'two', x: 1, expectedRevision: 7, requestId: 'two-22222' });
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, await requests.argsHash({ x: 2, y: 'two' }));
});

test('buildRequestRecord sets expireAt to createdAt + 30 days and replayResult rejects anything but the same change', () => {
  const record = requests.buildRequestRecord({ tool: 't', argsHash: 'h', actor: 'a', nowMs: Date.parse('2028-02-15T00:00:00.000Z'), revisionBefore: 1, revisionAfter: 2, result: { ok: true, revision: 2 }, before: {} });
  assert.equal(record.expireAt, '2028-03-16T00:00:00.000Z', 'leap-year February counted in real days');
  assert.equal(requests.REQUEST_RETENTION_DAYS, 30);
  assert.deepEqual(requests.replayResult(record, 't', 'h'), { ok: true, revision: 2, replayed: true });
  assert.throws(() => requests.replayResult(record, 't', 'other'), requests.RequestIdReusedError);
  assert.throws(() => requests.replayResult(record, 'other', 'h'), requests.RequestIdReusedError);
  assert.throws(() => requests.replayResult(Object.assign({}, record, { result: null }), 't', 'h'), requests.RequestIdReusedError);
  assert.throws(() => requests.buildRequestRecord({ nowMs: NaN }), /finite clock/);
});

// ── Transport ────────────────────────────────────────────────────────────────────────────────

function respond(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const COMMIT_ARGS = {
  fieldPaths: ['pantry'],
  fields: { pantry: [] },
  expectedUpdateTime: '2026-01-01T00:00:00.000000Z',
  nextVersion: 2,
  requestId: 'transport-001',
  record: { tool: 'add_stock', argsHash: 'h', actor: OWNER, createdAt: '2026-11-27T00:00:00.000Z', expireAt: '2026-12-27T00:00:00.000Z', revisionBefore: 1, revisionAfter: 2, result: { ok: true }, before: {} }
};

test('commitRequestWrite: success returns the next revision; ALREADY_EXISTS with a stored record is RequestAlreadyRecordedError', async () => {
  const ok = await commitRequestWrite(testEnv(), 't', COMMIT_ARGS, async () => respond(200, { writeResults: [{ updateTime: 'u1' }, { updateTime: 'u1' }], commitTime: 'u1' }));
  assert.deepEqual(ok, { revision: 2, updateTime: 'u1' });

  const stored = { tool: 'add_stock', argsHash: 'h', result: { ok: true } };
  const urls = [];
  const fetchImpl = async (url, init = {}) => {
    urls.push(url);
    if ((init.method || 'GET') === 'POST') return respond(409, { error: { status: 'ALREADY_EXISTS' } });
    return respond(200, { fields: encodeRequestRecord(stored) });
  };
  await assert.rejects(commitRequestWrite(testEnv(), 't', COMMIT_ARGS, fetchImpl), (error) => {
    assert.ok(error instanceof RequestAlreadyRecordedError);
    assert.deepEqual(error.record, stored);
    return true;
  });
  assert.match(urls[0], /\/documents:commit$/);
  assert.match(urls[1], /\/users\/test-uid-1\/mcpRequests\/transport-001$/);
});

test('commitRequestWrite: a precondition failure with no request record is a revision conflict; other failures are infrastructure', async () => {
  const fetchImpl = async (url, init = {}) => {
    if ((init.method || 'GET') === 'POST') return respond(400, { error: { status: 'FAILED_PRECONDITION' } });
    if (/mcpRequests/.test(url)) return respond(404, { error: { status: 'NOT_FOUND' } });
    return respond(200, { fields: { version: { integerValue: '5' } }, updateTime: 'u5' });
  };
  await assert.rejects(commitRequestWrite(testEnv(), 't', COMMIT_ARGS, fetchImpl), (error) => error instanceof RevisionConflictError && error.current.revision === 5);
  await assert.rejects(commitRequestWrite(testEnv(), 't', COMMIT_ARGS, async () => respond(503, { error: { status: 'UNAVAILABLE' } })), InfrastructureError);
  await assert.rejects(commitRequestWrite(testEnv(), 't', COMMIT_ARGS, async () => { throw new Error('net'); }), InfrastructureError);
});

test('getRequestRecord: 404 is null, a stored record decodes (timestamps as strings), errors are infrastructure', async () => {
  assert.equal(await getRequestRecord(testEnv(), 't', 'abcdefgh', async () => respond(404, {})), null);
  const decoded = await getRequestRecord(testEnv(), 't', 'abcdefgh', async () => respond(200, { fields: encodeRequestRecord(COMMIT_ARGS.record) }));
  assert.deepEqual(decoded, COMMIT_ARGS.record);
  await assert.rejects(getRequestRecord(testEnv(), 't', 'abcdefgh', async () => respond(500, {})), InfrastructureError);
});

// ── TASK-092 review carry-over: write lookups use the reads' safe id rule ────────────────────

// A stored map id whose `toString` is data, not a function: String() on it throws a TypeError.
const HOSTILE_ID = { toString: 'not-a-function' };

test('write lookups skip a stored map id instead of throwing (pantry and cooked meals)', async () => {
  assert.throws(() => String(HOSTILE_ID), TypeError, 'precondition: String() throws on this id');
  const pantry = [{ id: HOSTILE_ID, name: 'Broken' }, structuredClone(EGGS)];
  assert.equal(inventory.setCountedQuantity(pantry, { ingredientId: 'eggs', quantity: 3, expectedUnit: 'pcs' }).item.quantity, 3);
  assert.throws(() => inventory.markInStock(pantry, { ingredientId: '[object Object]' }), (error) => error.code === 'not_found');
  const meals = [{ id: HOSTILE_ID, name: 'Broken', portionsRemaining: 2 }, structuredClone(MEAL)];
  assert.equal(readyFood.consumePortions(meals, {}, { cookedMealId: 'meal-1', servings: 1 }).item.servingsRemaining, 2);

  // End to end through MCP, the hostile record survives untouched.
  const b = bridge(seed({ pantry: [{ id: HOSTILE_ID, name: 'Broken' }, structuredClone(EGGS)], cookedMeals: [{ id: HOSTILE_ID, name: 'Broken' }, structuredClone(MEAL)] }));
  const set = await b.call('set_inventory_quantity', { requestId: 'hostile-id-01', ingredientId: 'eggs', quantity: 9, expectedUnit: 'pcs', expectedRevision: 3 });
  assert.equal(set.result.isError, undefined, text(set));
  const eat = await b.call('consume_ready_food', { requestId: 'hostile-id-02', cookedMealId: 'meal-1', servings: 1, expectedRevision: 4 });
  assert.equal(eat.result.isError, undefined, text(eat));
  assert.deepEqual(b.fake.store.fields.pantry[0], { id: HOSTILE_ID, name: 'Broken' });
  assert.deepEqual(b.fake.store.fields.cookedMeals[0], { id: HOSTILE_ID, name: 'Broken' });
});
