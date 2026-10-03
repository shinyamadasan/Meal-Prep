import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeValue, decodeValue, encodeFields, decodeFields, getUserDocument, patchUserDocument, RevisionConflictError } from '../src/firestore.js';
import { createFakeFirestore } from './support/fakeFirestore.js';
import { testEnv } from './support/fixtures.js';

test('typed-value codec round-trips every JS type Firestore needs to carry', () => {
  const plain = {
    name: 'Rice',
    quantity: 2.5,
    count: 3,
    staple: true,
    missing: null,
    tags: ['a', 'b'],
    nested: { x: 1, y: 'z' },
    empty: []
  };
  const decoded = decodeFields(encodeFields(plain));
  assert.deepEqual(decoded, plain);
});

test('encodeValue distinguishes integers from doubles the way Firestore requires', () => {
  assert.deepEqual(encodeValue(3), { integerValue: '3' });
  assert.deepEqual(encodeValue(3.5), { doubleValue: 3.5 });
  assert.equal(decodeValue({ integerValue: '3' }), 3);
  assert.equal(decodeValue({ doubleValue: 3.5 }), 3.5);
});

test('encodeFields drops undefined rather than sending a value Firestore rejects', () => {
  const encoded = encodeFields({ a: 1, b: undefined });
  assert.deepEqual(Object.keys(encoded), ['a']);
});

test('getUserDocument decodes a missing document as an empty version-0 shell, not an error', async () => {
  const fake = createFakeFirestore({ exists: false });
  const doc = await getUserDocument(testEnv(), 'token', fake.fetch);
  assert.equal(doc.exists, false);
  assert.equal(doc.revision, 0);
  assert.deepEqual(doc.pantry, []);
  assert.deepEqual(doc.cookedMeals, []);
});

test('getUserDocument decodes an existing document\'s bridge-scoped fields', async () => {
  const fake = createFakeFirestore({ fields: { version: 4, pantry: [{ id: '1', name: 'Rice' }], cookedMeals: [] } });
  const doc = await getUserDocument(testEnv(), 'token', fake.fetch);
  assert.equal(doc.revision, 4);
  assert.equal(doc.pantry[0].name, 'Rice');
});

test('patchUserDocument applies a narrow field-mask patch and bumps version', async () => {
  const fake = createFakeFirestore({ fields: { version: 1, pantry: [], cookedMeals: [] } });
  const before = await getUserDocument(testEnv(), 'token', fake.fetch);
  const result = await patchUserDocument(testEnv(), 'token', {
    fieldPaths: ['pantry'],
    fields: { pantry: [{ id: '1', name: 'Rice', quantity: 2 }] },
    expectedUpdateTime: before.updateTime,
    nextVersion: before.revision + 1
  }, fake.fetch);
  assert.equal(result.revision, 2);
  assert.equal(result.pantry[0].name, 'Rice');
  // Untouched field survives the mask exactly as it was.
  assert.deepEqual(result.cookedMeals, []);
});

test('patchUserDocument only mutates the nested bucket named by a dotted field path', async () => {
  const fake = createFakeFirestore({ fields: { version: 1, pantry: [], cookedMeals: [], deletions: { pantry: { existing: 'x' }, cookedMeals: { other: 'y' } } } });
  const before = await getUserDocument(testEnv(), 'token', fake.fetch);
  await patchUserDocument(testEnv(), 'token', {
    fieldPaths: ['pantry', 'deletions.pantry'],
    fields: { pantry: [], deletions: { pantry: { existing: 'x', added: '2026-01-01T00:00:00.000Z' } } },
    expectedUpdateTime: before.updateTime,
    nextVersion: before.revision + 1
  }, fake.fetch);
  assert.deepEqual(fake.store.fields.deletions.pantry, { existing: 'x', added: '2026-01-01T00:00:00.000Z' });
  // The cookedMeals tombstone bucket was never named in the mask and must be untouched.
  assert.deepEqual(fake.store.fields.deletions.cookedMeals, { other: 'y' });
});

test('patchUserDocument rejects a stale updateTime with a RevisionConflictError carrying fresh state', async () => {
  const fake = createFakeFirestore({ fields: { version: 5, pantry: [{ id: '1', name: 'Rice' }], cookedMeals: [] } });
  await assert.rejects(
    () => patchUserDocument(testEnv(), 'token', {
      fieldPaths: ['pantry'],
      fields: { pantry: [] },
      expectedUpdateTime: 'stale-time',
      nextVersion: 6
    }, fake.fetch),
    (err) => {
      assert.ok(err instanceof RevisionConflictError);
      assert.equal(err.current.revision, 5);
      assert.equal(err.current.pantry[0].name, 'Rice');
      return true;
    }
  );
  // Nothing was applied.
  assert.equal(fake.store.fields.version, 5);
});

// TASK-071: mealConsumptions joined the bridge field mask.
test('getUserDocument decodes mealConsumptions: absent -> [], present -> as stored, malformed -> passed through (never coerced)', async () => {
  const absent = createFakeFirestore({ fields: { version: 1 } });
  assert.deepEqual((await getUserDocument(testEnv(), 'token', absent.fetch)).mealConsumptions, []);
  const fact = { id: 'mc_a', cookedMealId: 'c', recipeId: null, mealName: 'X', portionsConsumed: 1, consumedAt: '2026-01-01T00:00:00.000Z' };
  const present = createFakeFirestore({ fields: { version: 1, mealConsumptions: [fact] } });
  assert.deepEqual((await getUserDocument(testEnv(), 'token', present.fetch)).mealConsumptions, [fact]);
  const corrupt = createFakeFirestore({ fields: { version: 1, mealConsumptions: { not: 'an array' } } });
  assert.deepEqual((await getUserDocument(testEnv(), 'token', corrupt.fetch)).mealConsumptions, { not: 'an array' });
});

test('a missing document decodes with an empty mealConsumptions shell', async () => {
  const fake = createFakeFirestore({ exists: false });
  assert.deepEqual((await getUserDocument(testEnv(), 'token', fake.fetch)).mealConsumptions, []);
});

test('patchUserDocument writes mealConsumptions only when named in the mask and returns it decoded', async () => {
  const prior = { id: 'mc_p', cookedMealId: 'c', recipeId: null, mealName: 'X', portionsConsumed: 1, consumedAt: '2026-01-01T00:00:00.000Z' };
  const fake = createFakeFirestore({ fields: { version: 1, pantry: [], cookedMeals: [], mealConsumptions: [prior] } });
  const before = await getUserDocument(testEnv(), 'token', fake.fetch);
  const next = { id: 'mc_n', cookedMealId: 'c', recipeId: 'r', mealName: 'X', portionsConsumed: 2, consumedAt: '2026-01-02T00:00:00.000Z' };
  const written = await patchUserDocument(testEnv(), 'token', {
    fieldPaths: ['cookedMeals', 'mealConsumptions'],
    fields: { cookedMeals: [], mealConsumptions: [prior, next] },
    expectedUpdateTime: before.updateTime,
    nextVersion: 2
  }, fake.fetch);
  assert.deepEqual(written.mealConsumptions, [prior, next]);
  assert.deepEqual(fake.store.fields.mealConsumptions, [prior, next]);

  const pantryOnly = await getUserDocument(testEnv(), 'token', fake.fetch);
  await patchUserDocument(testEnv(), 'token', {
    fieldPaths: ['pantry'], fields: { pantry: [] }, expectedUpdateTime: pantryOnly.updateTime, nextVersion: 3
  }, fake.fetch);
  assert.deepEqual(fake.store.fields.mealConsumptions, [prior, next], 'a pantry write never touches the history');
});
