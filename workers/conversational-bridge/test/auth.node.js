import test from 'node:test';
import assert from 'node:assert/strict';
import { constantTimeEqual, requireBearerToken, UnauthorizedError, getFirestoreAccessToken, resetAccessTokenCache, parseServiceAccount } from '../src/auth.js';
import { InfrastructureError } from '../src/firestore.js';
import { createFakeFirestore } from './support/fakeFirestore.js';
import { testEnv, request, FAKE_SERVICE_ACCOUNT_JSON } from './support/fixtures.js';

test('constantTimeEqual matches equal strings and rejects different ones, including length mismatches', () => {
  assert.equal(constantTimeEqual('abc', 'abc'), true);
  assert.equal(constantTimeEqual('abc', 'abd'), false);
  assert.equal(constantTimeEqual('abc', 'abcd'), false);
  assert.equal(constantTimeEqual('', ''), true);
  assert.equal(constantTimeEqual(undefined, undefined), true);
});

test('requireBearerToken rejects a missing header, a malformed header, and a wrong token', () => {
  const env = testEnv();
  assert.throws(() => requireBearerToken(request('/v1/inventory', { token: null }), env), UnauthorizedError);
  assert.throws(() => requireBearerToken(new Request('https://worker.test/v1/inventory', { headers: { Authorization: 'Token abc' } }), env), UnauthorizedError);
  assert.throws(() => requireBearerToken(request('/v1/inventory', { token: 'wrong' }), env), UnauthorizedError);
});

test('requireBearerToken accepts exactly the configured token and nothing else', () => {
  const env = testEnv();
  assert.doesNotThrow(() => requireBearerToken(request('/v1/inventory', { token: 'test-bridge-token' }), env));
});

test('requireBearerToken fails closed when BRIDGE_API_TOKEN is not configured', () => {
  assert.throws(() => requireBearerToken(request('/v1/inventory', { token: '' }), testEnv({ BRIDGE_API_TOKEN: undefined })), UnauthorizedError);
});

test('parseServiceAccount rejects missing or malformed configuration without ever echoing it back', () => {
  assert.throws(() => parseServiceAccount({}), InfrastructureError);
  assert.throws(() => parseServiceAccount({ FIREBASE_SERVICE_ACCOUNT_JSON: 'not json' }), InfrastructureError);
  assert.throws(() => parseServiceAccount({ FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({}) }), InfrastructureError);
});

test('getFirestoreAccessToken signs a real JWT with Web Crypto and caches the exchanged token', async () => {
  resetAccessTokenCache();
  const fake = createFakeFirestore();
  let calls = 0;
  const countingFetch = async (url, init) => { calls += 1; return fake.fetch(url, init); };

  const token1 = await getFirestoreAccessToken(testEnv(), { fetchImpl: countingFetch, cryptoImpl: globalThis.crypto });
  const token2 = await getFirestoreAccessToken(testEnv(), { fetchImpl: countingFetch, cryptoImpl: globalThis.crypto });

  assert.equal(token1, 'fake-access-token');
  assert.equal(token2, 'fake-access-token');
  assert.equal(calls, 1, 'the second call must reuse the cached token instead of re-exchanging');
});

test('getFirestoreAccessToken surfaces a token-endpoint failure as a sanitized InfrastructureError', async () => {
  resetAccessTokenCache();
  const failingFetch = async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
  await assert.rejects(
    () => getFirestoreAccessToken(testEnv(), { fetchImpl: failingFetch, cryptoImpl: globalThis.crypto }),
    InfrastructureError
  );
});
