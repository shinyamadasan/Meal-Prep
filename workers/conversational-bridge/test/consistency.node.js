// Proves there is exactly ONE canonical store, not two competing models (D-082's whole premise).
// "App-side" writes are simulated directly against the fake Firestore document the same way
// saveToFirestore() would leave it, WITHOUT going through the bridge; bridge reads must see them,
// and bridge writes must be visible to a subsequent "app-side" read. Real Firestore/app.js are
// never touched — this runs entirely against the shared in-memory fake.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../src/index.js';
import { createFakeFirestore, simulateAppWrite } from './support/fakeFirestore.js';
import { testEnv, request } from './support/fixtures.js';

function bridgeOn(fake) {
  const env = testEnv();
  return (path, opts) => handleRequest(request(path, opts), env, { fetchImpl: fake.fetch, cryptoImpl: globalThis.crypto });
}

test('a pantry write made by the bridge is visible to a simulated app-side read', async () => {
  const fake = createFakeFirestore({ fields: { pantry: [{ id: '1', name: 'Rice', quantity: 1, staple: false }], version: 0 } });
  const call = bridgeOn(fake);

  await call('/v1/inventory/set-quantity', { method: 'POST', body: { ingredientId: '1', quantity: 7, expectedRevision: 0 } });

  // "App-side hydration" = reading the raw document the way loadFromFirestore() would.
  assert.equal(fake.store.fields.pantry[0].quantity, 7);
});

test('an app-side pantry mutation is visible to the next bridge read', async () => {
  const fake = createFakeFirestore({ fields: { pantry: [{ id: '1', name: 'Rice', quantity: 1, staple: false }], version: 0 } });
  const call = bridgeOn(fake);

  simulateAppWrite(fake, (fields) => {
    fields.pantry.push({ id: '2', name: 'Milk', staple: false, quantity: 1 });
  });

  const res = await call('/v1/inventory');
  const body = await res.json();
  assert.equal(body.items.length, 2);
  assert.ok(body.items.some((i) => i.ingredientId === '2'));
});

test('a bridge cooked-food write is visible in the Ready-to-Eat model an app-side read would see', async () => {
  const fake = createFakeFirestore({ fields: { cookedMeals: [], version: 0 } });
  const call = bridgeOn(fake);

  const recorded = await (await call('/v1/ready-food/record', { method: 'POST', body: { name: 'Chili', servings: 3, storage: 'fridge', cookedDate: '2026-01-15', expectedRevision: 0 } })).json();

  assert.equal(fake.store.fields.cookedMeals.length, 1);
  assert.equal(fake.store.fields.cookedMeals[0].id, recorded.item.cookedMealId);
  assert.equal(fake.store.fields.cookedMeals[0].portionsRemaining, 3);
});

test('an app-side consume/remove of a cooked meal is visible to the next bridge read', async () => {
  const fake = createFakeFirestore({ fields: { cookedMeals: [{ id: 'cm_1', name: 'Chili', portionsRemaining: 3 }], version: 0 } });
  const call = bridgeOn(fake);

  simulateAppWrite(fake, (fields) => {
    fields.cookedMeals = fields.cookedMeals.filter((m) => m.id !== 'cm_1');
    fields.deletions = fields.deletions || {};
    fields.deletions.cookedMeals = Object.assign({}, fields.deletions.cookedMeals, { cm_1: new Date().toISOString() });
  });

  const res = await call('/v1/ready-food');
  const body = await res.json();
  assert.deepEqual(body.items, []);
});

test('bridge writes always advance the same version the app-side sync protocol reads', async () => {
  const fake = createFakeFirestore({ fields: { pantry: [{ id: '1', name: 'Rice', quantity: 1, staple: false }], version: 0 } });
  const call = bridgeOn(fake);

  await call('/v1/inventory/set-quantity', { method: 'POST', body: { ingredientId: '1', quantity: 2, expectedRevision: 0 } });
  assert.equal(fake.store.fields.version, 1);

  simulateAppWrite(fake, () => {});
  assert.equal(fake.store.fields.version, 2);

  const res = await call('/v1/inventory/set-quantity', { method: 'POST', body: { ingredientId: '1', quantity: 3, expectedRevision: 2 } });
  assert.equal(res.status, 200);
  assert.equal(fake.store.fields.version, 3);
});
