// Two distinct auth hops, per D-082 — never conflate them:
//   1. caller -> Worker: a static bearer token compared in constant time.
//   2. Worker -> Firestore: the service account's own JWT-bearer OAuth2 exchange.
// Neither secret is ever logged, echoed, or reachable from a caller-controlled path.

import { InfrastructureError } from './firestore.js';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore';
const TOKEN_REFRESH_SKEW_MS = 60 * 1000;

export class UnauthorizedError extends Error {
  constructor(message) {
    super(message || 'Missing or invalid bearer token.');
    this.name = 'UnauthorizedError';
    this.code = 'unauthorized';
  }
}

// Constant-time string compare (Web Crypto timingSafeEqual is Node-only; this is the
// runtime-portable equivalent used by both Cloudflare Workers and the Node test suite).
export function constantTimeEqual(a, b) {
  const bufA = new TextEncoder().encode(String(a == null ? '' : a));
  const bufB = new TextEncoder().encode(String(b == null ? '' : b));
  // Length is compared openly (it is not secret-dependent in any way an attacker can exploit
  // here — the token length is not itself a secret), but every byte the shorter buffer would
  // have is still walked so total loop time doesn't leak WHICH byte differed.
  const len = Math.max(bufA.length, bufB.length);
  let diff = bufA.length === bufB.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    diff |= (bufA[i] || 0) ^ (bufB[i] || 0);
  }
  return diff === 0;
}

// Rejects missing/malformed/wrong bearer tokens. Never returns a caller-supplied value —
// there is exactly one valid identity (env.BRIDGE_API_TOKEN), so there is nothing to "select."
export function requireBearerToken(request, env) {
  const header = request.headers.get('Authorization') || '';
  const match = /^Bearer (.+)$/.exec(header);
  if (!match || !env.BRIDGE_API_TOKEN || !constantTimeEqual(match[1], env.BRIDGE_API_TOKEN)) {
    throw new UnauthorizedError();
  }
}

function base64UrlFromBytes(bytes) {
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlFromString(str) {
  return base64UrlFromBytes(new TextEncoder().encode(str));
}

function pemToPkcs8(pem) {
  const stripped = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = atob(stripped);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function parseServiceAccount(env) {
  const raw = env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new InfrastructureError('FIREBASE_SERVICE_ACCOUNT_JSON secret is not configured.');
  let parsed;
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (cause) {
    throw new InfrastructureError('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.', cause);
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new InfrastructureError('FIREBASE_SERVICE_ACCOUNT_JSON is missing client_email/private_key.');
  }
  return parsed;
}

async function signJwt(serviceAccount, cryptoImpl) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: serviceAccount.client_email,
    scope: FIRESTORE_SCOPE,
    aud: TOKEN_ENDPOINT,
    iat: now,
    exp: now + 3600
  };
  const unsigned = base64UrlFromString(JSON.stringify(header)) + '.' + base64UrlFromString(JSON.stringify(claims));

  const key = await cryptoImpl.subtle.importKey(
    'pkcs8',
    pemToPkcs8(serviceAccount.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await cryptoImpl.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  return unsigned + '.' + base64UrlFromBytes(new Uint8Array(signature));
}

// Module-scope cache: one exchanged access token reused across requests in the same isolate,
// per D-082 ("do not fetch a fresh one per call"). Tests must call resetAccessTokenCache()
// between runs so one fixture's cached token can't leak into another's assertions.
let cachedToken = null;

export function resetAccessTokenCache() {
  cachedToken = null;
}

export async function getFirestoreAccessToken(env, { fetchImpl = fetch, cryptoImpl = globalThis.crypto } = {}) {
  if (cachedToken && cachedToken.expiresAt > Date.now() + TOKEN_REFRESH_SKEW_MS) {
    return cachedToken.value;
  }
  const serviceAccount = parseServiceAccount(env);
  const assertion = await signJwt(serviceAccount, cryptoImpl);

  let response;
  try {
    response = await fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + assertion
    });
  } catch (cause) {
    throw new InfrastructureError('Could not reach the Firestore token endpoint.', cause);
  }
  if (!response.ok) {
    throw new InfrastructureError('Firestore service-account token exchange failed (' + response.status + ').');
  }
  let data;
  try {
    data = await response.json();
  } catch (cause) {
    throw new InfrastructureError('Firestore token endpoint returned an unreadable response.', cause);
  }
  if (!data.access_token) throw new InfrastructureError('Firestore token endpoint returned no access_token.');

  cachedToken = { value: data.access_token, expiresAt: Date.now() + (Number(data.expires_in || 3600) * 1000) };
  return cachedToken.value;
}
