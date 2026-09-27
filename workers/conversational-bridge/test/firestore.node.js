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
