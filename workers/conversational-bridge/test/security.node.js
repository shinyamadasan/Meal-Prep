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

// Uses the contract's reserved `ambiguous` code (TASKS.md shared error codes) — added per
// independent review finding 1: an undecorated, off-"pantry"-category record's staple-ness can't
// be proven server-side (real INGREDIENT_DB entries like Garlic/Evaporated Milk are `isStaple:
// true` despite a non-'Pantry' category), so a destructive mark-out-of-stock must refuse rather
// than risk tombstoning a record the app would only have marked empty.
test('inventory: mark-out-of-stock on an ambiguous (undecorated, non-"pantry"-category) record is refused, not destructive', async () => {
  const { call, fake } = bridge({ pantry: [{ id: 'g1', name: 'Garlic', category: 'Vegetable', quantity: 3 }], version: 0 });
  const res = await call('/v1/inventory/mark-out-of-stock', { method: 'POST', body: { ingredientId: 'g1', expectedRevision: 0 } });
  assert.equal(res.status, 422);
  assert.equal((await json(res)).error.code, 'ambiguous');
  assert.equal(fake.store.fields.version, 0, 'the ambiguous record must not have been touched');
  assert.equal(fake.store.fields.pantry[0].id, 'g1', 'and definitely not tombstoned away');
});

test('inventory: mark-out-of-stock on an undecorated record whose category IS "pantry" still resolves safely (staple path)', async () => {
  const { call } = bridge({ pantry: [{ id: 'p1', name: 'Flour', category: 'pantry', quantity: 1 }], version: 0 });
  const res = await call('/v1/inventory/mark-out-of-stock', { method: 'POST', body: { ingredientId: 'p1', expectedRevision: 0 } });
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.item.stockLevel, 'empty');
  assert.equal(body.removed, false);
});

// ── READY FOOD ───────────────────────────────────────────────────────────────

test('ready-food: read, record, consume a portion, and consume the exact remainder', async () => {
  const { call } = bridge({ cookedMeals: [], version: 0 });

  const empty = await json(await call('/v1/ready-food'));
  assert.deepEqual(empty.items, []);

  const recordRes = await call('/v1/ready-food/record', { method: 'POST', body: { name: 'Chili', servings: 2, storage: 'fridge', cookedDate: '2026-01-15', expectedRevision: 0 } });
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

// Corrected per independent review finding 2: cookedDate is now a required, caller-supplied
// local-calendar-date field, never derived from the Worker's own clock.
test('ready-food: record requires an explicit, valid cookedDate and rejects a missing/malformed/impossible one', async () => {
  const { call, fake } = bridge({ cookedMeals: [], version: 0 });

  const missing = await call('/v1/ready-food/record', { method: 'POST', body: { name: 'Chili', servings: 1, storage: 'fridge', expectedRevision: 0 } });
  assert.equal(missing.status, 422);
  assert.equal((await json(missing)).error.code, 'validation_failed');

  const impossible = await call('/v1/ready-food/record', { method: 'POST', body: { name: 'Chili', servings: 1, storage: 'fridge', cookedDate: '2026-02-30', expectedRevision: 0 } });
  assert.equal(impossible.status, 422);

  assert.equal(fake.store.fields.version, 0, 'no rejected record request touched the store');

  const ok = await json(await call('/v1/ready-food/record', { method: 'POST', body: { name: 'Chili', servings: 1, storage: 'fridge', cookedDate: '2026-01-15', expectedRevision: 0 } }));
  assert.equal(ok.item.cookedDate, '2026-01-15', 'the exact caller-supplied local date is preserved verbatim');
});

// ── FAILURE HANDLING ─────────────────────────────────────────────────────────

// Corrected per independent review: TASK-065's contract puts malformed (syntactically invalid)
// JSON at 400, distinct from well-formed JSON that fails domain/schema validation (422).
test('failure: malformed JSON body is rejected with 400, distinct from a well-formed-but-invalid body at 422', async () => {
  const { call, fake } = bridge({ pantry: [{ id: '1', name: 'Rice', quantity: 1, staple: false }], version: 0 });

  const malformed = await call('/v1/inventory/set-quantity', { method: 'POST', body: '{not json', contentType: 'application/json' });
  assert.equal(malformed.status, 400);
  assert.equal((await json(malformed)).error.code, 'validation_failed');

  const emptyBody = await call('/v1/inventory/set-quantity', { method: 'POST', body: '', contentType: 'application/json' });
  assert.equal(emptyBody.status, 400, 'an empty body is not valid JSON either');

  // Well-formed JSON with an invalid domain value must still be 422, not 400 — the two failure
  // modes stay distinct.
  const invalidDomain = await call('/v1/inventory/set-quantity', { method: 'POST', body: { ingredientId: '1', quantity: -5, expectedRevision: 0 } });
  assert.equal(invalidDomain.status, 422);
  assert.equal(fake.store.fields.version, 0, 'neither rejected request touched the store');
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

// Added per independent review finding 5: the Worker has implemented an 8 KB body cap since the
// first candidate, but nothing exercised it. Both the fast path (a truthful, oversized
// Content-Length header, computed automatically here from a genuinely large body) and the
// defensive streaming path (no Content-Length at all — the bounded-reader loop in
// readBoundedText()) are covered, since either is how a real oversized request could arrive.
test('failure: an oversized request body is rejected via Content-Length before any domain operation or Firestore call runs', async () => {
  const { call, fake } = bridge({ pantry: [{ id: '1', name: 'Rice', quantity: 1, staple: false }], version: 0 });
  let firestoreCalls = 0;
  const originalFetch = fake.fetch;
  fake.fetch = async (url, init) => { firestoreCalls += 1; return originalFetch(url, init); };

  const oversizedBody = JSON.stringify({ ingredientId: '1', quantity: 1, expectedRevision: 0, padding: 'x'.repeat(9000) });
  const res = await call('/v1/inventory/set-quantity', { method: 'POST', body: oversizedBody });

  assert.equal(res.status, 422);
  assert.equal((await json(res)).error.code, 'validation_failed');
  assert.equal(firestoreCalls, 0, 'an oversized body must be rejected before touching Firestore (no token exchange, no read, no write)');
  assert.equal(fake.store.fields.version, 0);
  assert.equal(fake.store.fields.pantry[0].quantity, 1);
});

test('failure: an oversized STREAMED body with no declared Content-Length is still rejected by the bounded reader', async () => {
  const fake = createFakeFirestore({ fields: { pantry: [{ id: '1', name: 'Rice', quantity: 1, staple: false }], version: 0 } });
  let firestoreCalls = 0;
  const countingFetch = async (url, init) => { firestoreCalls += 1; return fake.fetch(url, init); };

  const totalBytes = 9000; // > the Worker's 8 KB (8192-byte) MAX_BODY_BYTES limit
  const chunkSize = 1500;
  let sent = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (sent >= totalBytes) { controller.close(); return; }
      const size = Math.min(chunkSize, totalBytes - sent);
      controller.enqueue(new TextEncoder().encode('x'.repeat(size)));
      sent += size;
    }
  });
  const streamedRequest = new Request('https://worker.test/v1/inventory/set-quantity', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-bridge-token', 'Content-Type': 'application/json' },
    body: stream,
    duplex: 'half'
  });
  assert.equal(streamedRequest.headers.get('Content-Length'), null, 'test precondition: no Content-Length declared, so this exercises the streaming reader, not the header fast-path');

  const res = await handleRequest(streamedRequest, testEnv(), { fetchImpl: countingFetch, cryptoImpl: globalThis.crypto });

  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.error.code, 'validation_failed');
  assert.ok(!JSON.stringify(body).includes('x'.repeat(50)), 'the oversized payload content must never be echoed back');
  assert.equal(firestoreCalls, 0, 'no Firestore call for an oversized streamed body either');
  assert.equal(fake.store.fields.version, 0);
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
