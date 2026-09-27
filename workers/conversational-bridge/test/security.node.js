// Full TASK-065 chaos/security matrix, exercised through handleRequest end-to-end against the
// in-memory fake Firestore — no network, no real credentials, no production data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../src/index.js';
import { createFakeFirestore } from './support/fakeFirestore.js';
import { testEnv, request } from './support/fixtures.js';

function bridge(initialFields) {
  const fake = createFakeFirestore({ fields: initialFields });
  const env = testEnv();
  const call = (path, opts) => handleRequest(request(path, opts), env, { fetchImpl: fake.fetch, cryptoImpl: globalThis.crypto });
  return { fake, env, call };
}

async function json(res) {
  return res.json();
}

// ── AUTH ─────────────────────────────────────────────────────────────────────

test('auth: missing bearer is rejected', async () => {
  const { call } = bridge({});
  const res = await call('/v1/inventory', { token: null });
  assert.equal(res.status, 401);
  assert.equal((await json(res)).error.code, 'unauthorized');
});

test('auth: wrong bearer is rejected', async () => {
  const { call } = bridge({});
  const res = await call('/v1/inventory', { token: 'not-the-token' });
  assert.equal(res.status, 401);
});

test('auth: valid bearer is accepted', async () => {
  const { call } = bridge({});
  const res = await call('/v1/inventory');
  assert.equal(res.status, 200);
});

test('auth: an arbitrary caller-supplied uid/path/collection field is rejected as over-posting, never honored', async () => {
  const { call } = bridge({ pantry: [{ id: '1', name: 'Rice', quantity: 1, staple: false }] });
  const res = await call('/v1/inventory/set-quantity', {
    method: 'POST',
    body: { ingredientId: '1', quantity: 2, expectedRevision: 0, uid: 'someone-elses-account', path: 'users/other/secret' }
  });
  assert.equal(res.status, 422);
  assert.equal((await json(res)).error.code, 'validation_failed');
});

test('auth: there is no route that accepts a Firestore path or collection name', async () => {
  const { call } = bridge({});
  const res = await call('/v1/documents/users/other-uid', { method: 'GET' });
  assert.equal(res.status, 404);
});

// ── INVENTORY ────────────────────────────────────────────────────────────────

test('inventory: read returns items with derived inStock', async () => {
  const { call } = bridge({ pantry: [{ id: '1', name: 'Rice', staple: false }] });
  const res = await call('/v1/inventory');
  const body = await json(res);
  assert.equal(body.ok, true);
  assert.equal(body.items[0].inStock, true);
});

test('inventory: set-quantity succeeds and a repeat with the new revision is idempotent', async () => {
  const { call } = bridge({ pantry: [{ id: '1', name: 'Rice', quantity: 1, staple: false }], version: 0 });
  const first = await call('/v1/inventory/set-quantity', { method: 'POST', body: { ingredientId: '1', quantity: 5, expectedRevision: 0 } });
  assert.equal(first.status, 200);
  const firstBody = await json(first);
  assert.equal(firstBody.revision, 1);

  const second = await call('/v1/inventory/set-quantity', { method: 'POST', body: { ingredientId: '1', quantity: 5, expectedRevision: 1 } });
  assert.equal(second.status, 200);
  assert.equal((await json(second)).item.quantity, 5);
});

test('inventory: mark-out-of-stock on an already-out staple is a deterministic 200 unchanged:true, not an error', async () => {
  const { call } = bridge({ pantry: [{ id: '1', name: 'Salt', staple: true, stockLevel: 'empty' }], version: 0 });
  const res = await call('/v1/inventory/mark-out-of-stock', { method: 'POST', body: { ingredientId: '1', expectedRevision: 0 } });
  assert.equal(res.status, 200);
  assert.equal((await json(res)).unchanged, true);
});

test('inventory: unknown ingredientId is rejected as not_found', async () => {
  const { call } = bridge({ pantry: [], version: 0 });
  const res = await call('/v1/inventory/set-quantity', { method: 'POST', body: { ingredientId: 'ghost', quantity: 1, expectedRevision: 0 } });
  assert.equal(res.status, 404);
  assert.equal((await json(res)).error.code, 'not_found');
});

test('inventory: invalid quantity/unit is rejected as validation_failed and leaves state unchanged', async () => {
  const { call, fake } = bridge({ pantry: [{ id: '1', name: 'Rice', quantity: 1, staple: false }], version: 0 });
  const res = await call('/v1/inventory/set-quantity', { method: 'POST', body: { ingredientId: '1', quantity: -5, expectedRevision: 0 } });
  assert.equal(res.status, 422);
  assert.equal(fake.store.fields.version, 0, 'a rejected write must not touch the store');
});

test('inventory: a stale expectedRevision is rejected with 409 and applies nothing', async () => {
  const { call, fake } = bridge({ pantry: [{ id: '1', name: 'Rice', quantity: 1, staple: false }], version: 3 });
  const res = await call('/v1/inventory/set-quantity', { method: 'POST', body: { ingredientId: '1', quantity: 99, expectedRevision: 0 } });
  assert.equal(res.status, 409);
  const body = await json(res);
  assert.equal(body.error.code, 'revision_conflict');
  assert.equal(body.error.detail.revision, 3);
  assert.equal(fake.store.fields.pantry[0].quantity, 1, 'no partial write on conflict');
});

// ── READY FOOD ───────────────────────────────────────────────────────────────

test('ready-food: read, record, consume a portion, and consume the exact remainder', async () => {
  const { call } = bridge({ cookedMeals: [], version: 0 });

  const empty = await json(await call('/v1/ready-food'));
  assert.deepEqual(empty.items, []);

  const recordRes = await call('/v1/ready-food/record', { method: 'POST', body: { name: 'Chili', servings: 2, storage: 'fridge', expectedRevision: 0 } });
  assert.equal(recordRes.status, 200);
  const recorded = await json(recordRes);
  assert.equal(recorded.item.servingsRemaining, 2);
  const id = recorded.item.cookedMealId;

  const consumeOne = await json(await call('/v1/ready-food/consume', { method: 'POST', body: { cookedMealId: id, servings: 1, expectedRevision: recorded.revision } }));
  assert.equal(consumeOne.item.servingsRemaining, 1);

  const consumeRest = await json(await call('/v1/ready-food/consume', { method: 'POST', body: { cookedMealId: id, servings: 1, expectedRevision: consumeOne.revision } }));
  assert.equal(consumeRest.removed, true);

  const finalList = await json(await call('/v1/ready-food'));
  assert.deepEqual(finalList.items, []);
});

test('ready-food: over-consuming is rejected with the actual remaining count attached', async () => {
  const { call } = bridge({ cookedMeals: [{ id: 'cm_1', name: 'Chili', portionsRemaining: 2, initialPortions: 2 }], version: 0 });
  const res = await call('/v1/ready-food/consume', { method: 'POST', body: { cookedMealId: 'cm_1', servings: 5, expectedRevision: 0 } });
  assert.equal(res.status, 422);
  const body = await json(res);
  assert.equal(body.error.code, 'insufficient_servings');
  assert.equal(body.error.detail.remaining, 2);
});

test('ready-food: unknown cookedMealId is rejected as not_found', async () => {
  const { call } = bridge({ cookedMeals: [], version: 0 });
  const res = await call('/v1/ready-food/finish', { method: 'POST', body: { cookedMealId: 'ghost', expectedRevision: 0 } });
  assert.equal(res.status, 404);
});

test('ready-food: finish removes the record regardless of servings remaining', async () => {
  const { call } = bridge({ cookedMeals: [{ id: 'cm_1', name: 'Chili', portionsRemaining: 5 }], version: 0 });
  const res = await json(await call('/v1/ready-food/finish', { method: 'POST', body: { cookedMealId: 'cm_1', expectedRevision: 0 } }));
  assert.equal(res.removed, true);
});

test('ready-food: stale expectedRevision is rejected and a retry with the stale value cannot double-apply', async () => {
  const { call } = bridge({ cookedMeals: [{ id: 'cm_1', name: 'Chili', portionsRemaining: 3 }], version: 0 });
  const first = await json(await call('/v1/ready-food/consume', { method: 'POST', body: { cookedMealId: 'cm_1', servings: 1, expectedRevision: 0 } }));
  assert.equal(first.item.servingsRemaining, 2);

  // Simulated lost-response retry: caller resends the SAME (operation, expectedRevision) pair.
  const retry = await call('/v1/ready-food/consume', { method: 'POST', body: { cookedMealId: 'cm_1', servings: 1, expectedRevision: 0 } });
  assert.equal(retry.status, 409);
  const finalRead = await json(await call('/v1/ready-food'));
  assert.equal(finalRead.items[0].servingsRemaining, 2, 'the retry must not have decremented a second time');
});

// ── FAILURE HANDLING ─────────────────────────────────────────────────────────

test('failure: malformed JSON body is rejected', async () => {
  const { call } = bridge({});
  const res = await call('/v1/inventory/set-quantity', { method: 'POST', body: '{not json', contentType: 'application/json' });
  assert.equal(res.status, 422);
});

test('failure: wrong method on a known route is rejected', async () => {
  const { call } = bridge({});
  const res = await call('/v1/inventory/set-quantity', { method: 'GET' });
  assert.equal(res.status, 405);
});

test('failure: wrong content-type on a write is rejected', async () => {
  const { call } = bridge({});
  const res = await call('/v1/inventory/set-quantity', { method: 'POST', body: { ingredientId: '1', quantity: 1, expectedRevision: 0 }, contentType: 'text/plain' });
  assert.equal(res.status, 422);
});

test('failure: over-posting an undocumented field is rejected', async () => {
  const { call } = bridge({ pantry: [{ id: '1', name: 'Rice', quantity: 1, staple: false }], version: 0 });
  const res = await call('/v1/inventory/set-quantity', { method: 'POST', body: { ingredientId: '1', quantity: 1, expectedRevision: 0, extra: 'nope' } });
  assert.equal(res.status, 422);
});

test('failure: a missing required field is rejected', async () => {
  const { call } = bridge({});
  const res = await call('/v1/inventory/set-quantity', { method: 'POST', body: { quantity: 1, expectedRevision: 0 } });
  assert.equal(res.status, 422);
});

test('failure: an infrastructure error is sanitized — no stack trace, no secrets, in the response', async () => {
  const env = testEnv();
  const throwingReadDoc = async () => { throw new Error('ECONNREFUSED 10.0.0.1:443 while holding ya29.secret-token'); };
  const res = await handleRequest(request('/v1/inventory'), env, { getUserDocument: throwingReadDoc, cryptoImpl: globalThis.crypto });
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.ok, false);
  const text = JSON.stringify(body);
  assert.ok(!text.includes('ya29.secret-token'));
  assert.ok(!text.includes('ECONNREFUSED'));
});

test('failure: a failed write reports failure, never a partial success as ok:true', async () => {
  const { call, fake } = bridge({ pantry: [{ id: '1', name: 'Rice', quantity: 1, staple: false }], version: 0 });
  const originalFetch = fake.fetch;
  fake.fetch = async (url, init) => {
    if ((init && init.method) === 'PATCH') return new Response(JSON.stringify({ error: { status: 'INTERNAL' } }), { status: 500 });
    return originalFetch(url, init);
  };
  const res = await call('/v1/inventory/set-quantity', { method: 'POST', body: { ingredientId: '1', quantity: 9, expectedRevision: 0 } });
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, 'infrastructure_error');
});
