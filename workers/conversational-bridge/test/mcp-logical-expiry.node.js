// D-092 (PROP-041 on the Spark plan, no TTL): request records are kept, never auto-deleted, and the
// 30-day rule is enforced in code. After expireAt: undo is refused (undo_expired), and a retried
// requestId still replays its stored answer — it never applies the change a second time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { routeRequest } from '../src/index.js';
import { MCP_ISSUER, MCP_RESOURCE, MCP_SCOPE, MCP_WRITE_SCOPE } from '../src/mcpAuth.js';
import { testEnv } from './support/fixtures.js';
import { createFakeFirestore } from './support/fakeFirestore.js';

const NOW = 1_800_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const OWNER = 'test-owner-subject';
const START_MS = Date.parse('2026-11-27T03:00:00.000Z');

function context() {
  return {
    auth: { token: 'not-a-real-token', audience: MCP_RESOURCE, expiresAt: NOW + 300, scope: [MCP_SCOPE, MCP_WRITE_SCOPE], userId: OWNER, clientId: 'https://chatgpt.com/oauth/client.json' },
    props: { ownerSubject: OWNER, issuer: MCP_ISSUER, resource: MCP_RESOURCE, notBefore: NOW - 1 }
  };
}

async function call(deps, name, args) {
  const response = await routeRequest(new Request('https://localhost/mcp', {
    method: 'POST',
    headers: { Host: 'localhost', Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
  }), testEnv(), deps, context());
  const raw = await response.text();
  const json = (response.headers.get('Content-Type') || '').includes('text/event-stream')
    ? JSON.parse(raw.split(/\r?\n/).find((line) => line.startsWith('data: ')).slice(6))
    : JSON.parse(raw);
  return json.result;
}

test('D-092: 31 days later the record still exists, the same requestId replays without re-applying, and undo is refused', async () => {
  const fake = createFakeFirestore({ fields: {
    version: 3,
    pantry: [{ id: 'eggs', name: 'Eggs', quantity: 6, unit: 'pcs', staple: false, category: 'dairy', storage: 'fridge', updatedAt: '2026-11-20T00:00:00.000Z' }],
    cookedMeals: [], mealConsumptions: [], deletions: { pantry: {}, cookedMeals: {} }
  } });
  const clock = { ms: START_MS };
  const deps = { nowSeconds: NOW, now: () => clock.ms, fetchImpl: fake.fetch, cryptoImpl: globalThis.crypto };
  const args = { requestId: 'use-eggs-expiry', ingredientId: 'eggs', quantity: 2, expectedUnit: 'pcs', expectedRevision: 3 };

  const first = await call(deps, 'consume_stock', args);
  assert.notEqual(first.isError, true, JSON.stringify(first.content));
  assert.equal(fake.store.fields.pantry[0].quantity, 4);
  assert.equal(fake.store.fields.version, 4);

  clock.ms = START_MS + 31 * DAY_MS;
  assert.ok(fake.requests.size >= 1, 'the request record is kept (no TTL, no pruning)');

  const retry = await call(deps, 'consume_stock', args);
  assert.notEqual(retry.isError, true, JSON.stringify(retry.content));
  assert.equal(retry.structuredContent.replayed, true);
  assert.equal(fake.store.fields.pantry[0].quantity, 4, 'never applied twice');
  assert.equal(fake.store.fields.version, 4);

  const undo = await call(deps, 'undo_request', { requestId: 'use-eggs-expiry', undoRequestId: 'undo-eggs-expiry', expectedRevision: 4 });
  assert.equal(undo.isError, true);
  assert.match(JSON.stringify(undo.content), /undo_expired/);
  assert.equal(fake.store.fields.pantry[0].quantity, 4);
});
