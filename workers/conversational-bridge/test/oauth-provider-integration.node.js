import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { registerHooks } from 'node:module';
import { createLocalJWKSet, exportJWK, SignJWT } from 'jose';
import { MCP_ISSUER, MCP_RESOURCE, MCP_RESOURCE_METADATA, MCP_SCOPE } from '../src/mcpAuth.js';
import { createOAuthWorker } from '../src/oauth.js';
import { testEnv } from './support/fixtures.js';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'cloudflare:workers') {
      return {
        url: 'data:text/javascript,export class WorkerEntrypoint { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }',
        shortCircuit: true
      };
    }
    return nextResolve(specifier, context);
  }
});

const previousCloudflare = globalThis.Cloudflare;
const previousFetch = globalThis.fetch;
globalThis.Cloudflare = { compatibilityFlags: { global_fetch_strictly_public: true } };

const { default: OAuthProvider } = await import('@cloudflare/workers-oauth-provider');

const NOW = Math.floor(Date.now() / 1000);
const ACCESS_ISSUER = 'https://test.cloudflareaccess.com';
const CLIENT_ID = 'https://chatgpt.com/oauth/client.json';
const REDIRECT_URI = 'https://chatgpt.com/connector_platform_oauth_redirect';
const VERIFIER = 'task-068-pkce-verifier-' + 'v'.repeat(48);
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
const OWNER = 'test-owner-subject';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = await exportJWK(publicKey);
publicJwk.kid = 'provider-integration-key';
publicJwk.alg = 'RS256';
const jwks = createLocalJWKSet({ keys: [publicJwk] });
let cimdDocuments = new Map();

globalThis.fetch = async (input) => {
  const url = typeof input === 'string' ? input : input.url;
  const document = cimdDocuments.get(url);
  if (!document) throw new Error('Unexpected integration-test fetch: ' + url);
  return Response.json(document, { headers: { 'Cache-Control': 'no-store' } });
};

test.after(() => {
  globalThis.fetch = previousFetch;
  if (previousCloudflare === undefined) delete globalThis.Cloudflare;
  else globalThis.Cloudflare = previousCloudflare;
});

class MemoryKv {
  constructor() {
    this.records = new Map();
  }

  async get(key, options) {
    const record = this.records.get(key);
    if (!record) return null;
    if (record.expiration && record.expiration <= Math.floor(Date.now() / 1000)) {
      this.records.delete(key);
      return null;
    }
    const type = typeof options === 'string' ? options : options && options.type;
    if (type === 'json') return JSON.parse(record.value);
    if (type === 'arrayBuffer') return new TextEncoder().encode(record.value).buffer;
    return record.value;
  }

  async put(key, value, options = {}) {
    const expiration = options.expiration || (options.expirationTtl
      ? Math.floor(Date.now() / 1000) + options.expirationTtl
      : undefined);
    this.records.set(key, {
      value: String(value),
      metadata: options.metadata,
      expiration
    });
  }

  async delete(key) {
    this.records.delete(key);
  }

  async list(options = {}) {
    const prefix = options.prefix || '';
    const start = Number(options.cursor || 0);
    const limit = options.limit || 1000;
    const matching = [...this.records.entries()]
      .filter(([name, record]) => name.startsWith(prefix) && (!record.expiration || record.expiration > Math.floor(Date.now() / 1000)))
      .sort(([a], [b]) => a.localeCompare(b));
    const page = matching.slice(start, start + limit);
    const next = start + page.length;
    return {
      keys: page.map(([name, record]) => ({
        name,
        ...(record.expiration ? { expiration: record.expiration } : {}),
        ...(record.metadata !== undefined ? { metadata: record.metadata } : {})
      })),
      list_complete: next >= matching.length,
      ...(next < matching.length ? { cursor: String(next) } : {})
    };
  }

  async updateJson(key, update) {
    const record = this.records.get(key);
    assert.ok(record, 'expected KV record ' + key);
    record.value = JSON.stringify(update(JSON.parse(record.value)));
  }
}

function expectedCimd(overrides = {}) {
  return {
    client_id: CLIENT_ID,
    client_name: 'ChatGPT',
    redirect_uris: [REDIRECT_URI],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_methods_supported: ['none', 'private_key_jwt'],
    token_endpoint_auth_method: 'private_key_jwt',
    ...overrides
  };
}

async function accessAssertion(subject = OWNER) {
  return new SignJWT({
    type: 'app',
    iss: ACCESS_ISSUER,
    aud: ['test-access-policy-audience'],
    sub: subject,
    iat: NOW - 5,
    nbf: NOW - 5,
    exp: NOW + 300
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'provider-integration-key', typ: 'JWT' })
    .sign(privateKey);
}

function integrationEnv(kv = new MemoryKv()) {
  return { ...testEnv(), OAUTH_KV: kv };
}

function integrationWorker(reads = { count: 0 }) {
  return createOAuthWorker(OAuthProvider, async () => new Response('not found', { status: 404 }), {
    jwks,
    currentDate: new Date(NOW * 1000),
    nowSeconds: NOW,
    mcp: {
      nowSeconds: NOW,
      getFirestoreAccessToken: async () => 'fake-firestore-token',
      getUserDocument: async () => {
        reads.count += 1;
        return { revision: 7, pantry: [], cookedMeals: [] };
      },
      fetchImpl: async () => { throw new Error('network access must not occur'); }
    }
  });
}

function authorizationUrl({
  clientId = CLIENT_ID,
  redirectUri = REDIRECT_URI,
  scope = MCP_SCOPE,
  includeScope = true,
  resource = MCP_RESOURCE,
  includeResource = true
} = {}) {
  const url = new URL(MCP_ISSUER + '/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  if (includeScope) url.searchParams.set('scope', scope);
  url.searchParams.set('state', 'integration-state');
  url.searchParams.set('code_challenge', CHALLENGE);
  url.searchParams.set('code_challenge_method', 'S256');
  if (includeResource) url.searchParams.set('resource', resource);
  return url;
}

async function beginAuthorization(worker, env, options = {}) {
  const response = await worker.fetch(new Request(authorizationUrl(options), {
    headers: { 'Cf-Access-Jwt-Assertion': await accessAssertion() }
  }), env, {});
  if (response.status !== 200) return { response };
  const html = await response.text();
  const handle = /name="handle" value="([^"]+)"/.exec(html)?.[1];
  const cookie = response.headers.get('Set-Cookie')?.split(';')[0];
  assert.ok(handle, 'consent handle');
  assert.ok(cookie, 'consent binding cookie');
  return { response, html, handle, cookie };
}

async function approveAuthorization(worker, env, transaction) {
  const response = await worker.fetch(new Request(MCP_ISSUER + '/authorize', {
    method: 'POST',
    headers: {
      'Cf-Access-Jwt-Assertion': await accessAssertion(),
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: transaction.cookie
    },
    body: new URLSearchParams({ handle: transaction.handle, decision: 'approve' })
  }), env, {});
  assert.equal(response.status, 302);
  const redirect = new URL(response.headers.get('Location'));
  const code = redirect.searchParams.get('code');
  assert.ok(code, 'authorization code');
  return code;
}

async function authorizedCode(worker, env, options = {}) {
  const transaction = await beginAuthorization(worker, env, options);
  assert.equal(transaction.response.status, 200);
  return approveAuthorization(worker, env, transaction);
}

async function tokenRequest(worker, env, code, {
  verifier = VERIFIER,
  includeVerifier = true,
  resource = MCP_RESOURCE,
  includeResource = true,
  authorization
} = {}) {
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code,
    redirect_uri: REDIRECT_URI
  });
  if (includeVerifier) form.set('code_verifier', verifier);
  if (includeResource) form.set('resource', resource);
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (authorization) headers.Authorization = authorization;
  return worker.fetch(new Request(MCP_ISSUER + '/oauth/token', {
    method: 'POST',
    headers,
    body: form
  }), env, {});
}

async function issueTokens(worker, env, options = {}) {
  const code = await authorizedCode(worker, env, options);
  const response = await tokenRequest(worker, env, code);
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

function mcpRequest(token, method = 'tools/list') {
  const body = method === 'tools/call'
    ? { jsonrpc: '2.0', id: 1, method, params: { name: 'get_inventory', arguments: {} } }
    : { jsonrpc: '2.0', id: 1, method, params: {} };
  return new Request(MCP_RESOURCE, {
    method: 'POST',
    headers: {
      Authorization: token,
      Host: new URL(MCP_ISSUER).host,
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
}

async function mcpMessage(response) {
  const text = await response.text();
  if ((response.headers.get('Content-Type') || '').includes('text/event-stream')) {
    const line = text.split(/\r?\n/).find((item) => item.startsWith('data: '));
    return JSON.parse(line.slice(6));
  }
  return text ? JSON.parse(text) : null;
}

async function accessTokenRecord(env, accessToken) {
  const summary = await env.OAUTH_PROVIDER.unwrapToken(accessToken);
  assert.ok(summary, 'provider token summary');
  return {
    key: `token:${summary.userId}:${summary.grantId}:${summary.id}`,
    summary
  };
}

test('actual provider authorization path enforces the exact deduplicated read scope and displays it', async () => {
  cimdDocuments = new Map([[CLIENT_ID, expectedCimd()]]);
  const accepted = [MCP_SCOPE, MCP_SCOPE + ' ' + MCP_SCOPE];
  for (const scope of accepted) {
    const env = integrationEnv();
    const transaction = await beginAuthorization(integrationWorker(), env, { scope });
    assert.equal(transaction.response.status, 200, scope);
    assert.match(transaction.html, /<code>mealprep:read<\/code>/);
    assert.equal((await env.OAUTH_PROVIDER.listUserGrants(OWNER)).items.length, 0);
  }

  const rejected = [
    { includeScope: false },
    { scope: '' },
    { scope: 'mealprep:write' },
    { scope: 'unknown' },
    { scope: MCP_SCOPE + ' mealprep:write' },
    { scope: MCP_SCOPE + ' unknown' }
  ];
  for (const options of rejected) {
    const env = integrationEnv();
    const result = await beginAuthorization(integrationWorker(), env, options);
    assert.equal(result.response.status, 302, JSON.stringify(options));
    assert.equal(new URL(result.response.headers.get('Location')).searchParams.get('error'), 'invalid_scope');
    assert.equal((await env.OAUTH_PROVIDER.listUserGrants(OWNER)).items.length, 0);
  }
});

test('actual provider CIMD negotiation selects none and rejects incompatible metadata, Basic auth, and wrong redirect', async () => {
  cimdDocuments = new Map([[CLIENT_ID, expectedCimd()]]);
  const env = integrationEnv();
  const worker = integrationWorker();
  const transaction = await beginAuthorization(worker, env);
  assert.equal(transaction.response.status, 200);
  const client = await env.OAUTH_PROVIDER.lookupClient(CLIENT_ID);
  assert.equal(client.tokenEndpointAuthMethod, 'none');

  const code = await approveAuthorization(worker, env, transaction);
  const basic = 'Basic ' + Buffer.from(CLIENT_ID + ':not-a-client-secret').toString('base64');
  const basicResponse = await tokenRequest(worker, env, code, { authorization: basic });
  assert.notEqual(basicResponse.status, 200);
  assert.equal((await basicResponse.json()).error, 'invalid_request');
  const validResponse = await tokenRequest(worker, env, code);
  assert.equal(validResponse.status, 200);

  cimdDocuments = new Map([[CLIENT_ID, expectedCimd({
    token_endpoint_auth_methods_supported: ['private_key_jwt'],
    token_endpoint_auth_method: 'private_key_jwt'
  })]]);
  const incompatible = await beginAuthorization(integrationWorker(), integrationEnv());
  assert.equal(incompatible.response.status, 400);

  cimdDocuments = new Map([[CLIENT_ID, expectedCimd()]]);
  const wrongRedirect = await beginAuthorization(integrationWorker(), integrationEnv(), {
    redirectUri: 'https://attacker.example/callback'
  });
  assert.equal(wrongRedirect.response.status, 400);
});

test('actual provider PKCE path accepts valid S256, rejects missing/wrong verifier, and prevents code replay', async () => {
  cimdDocuments = new Map([[CLIENT_ID, expectedCimd()]]);
  const env = integrationEnv();
  const worker = integrationWorker();
  const code = await authorizedCode(worker, env);

  const missing = await tokenRequest(worker, env, code, { includeVerifier: false });
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).error, 'invalid_request');

  const wrong = await tokenRequest(worker, env, code, { verifier: 'wrong-' + VERIFIER });
  assert.equal(wrong.status, 400);
  assert.equal((await wrong.json()).error, 'invalid_grant');

  const valid = await tokenRequest(worker, env, code);
  assert.equal(valid.status, 200);
  const replay = await tokenRequest(worker, env, code);
  assert.equal(replay.status, 400);
  assert.equal((await replay.json()).error, 'invalid_grant');
});

test('actual provider requires the canonical resource on authorization and token requests and denies other-resource tokens', async () => {
  cimdDocuments = new Map([[CLIENT_ID, expectedCimd()]]);
  for (const options of [
    { includeResource: false },
    { resource: 'https://wrong.example/mcp' },
    { resource: 'https://meal-prep-conversational-bridge.example/mcp' }
  ]) {
    const result = await beginAuthorization(integrationWorker(), integrationEnv(), options);
    assert.equal(result.response.status, 302, JSON.stringify(options));
    assert.equal(new URL(result.response.headers.get('Location')).searchParams.get('error'), 'invalid_target');
  }

  const env = integrationEnv();
  const worker = integrationWorker();
  const code = await authorizedCode(worker, env);
  for (const options of [
    { includeResource: false },
    { resource: 'https://wrong.example/mcp' },
    { resource: 'https://meal-prep-conversational-bridge.example/mcp' }
  ]) {
    const response = await tokenRequest(worker, env, code, options);
    assert.equal(response.status, 400, JSON.stringify(options));
    assert.equal((await response.json()).error, 'invalid_target');
  }

  const validResponse = await tokenRequest(worker, env, code);
  const tokens = await validResponse.json();
  const record = await accessTokenRecord(env, tokens.access_token);
  await env.OAUTH_KV.updateJson(record.key, (value) => ({ ...value, audience: 'https://other-resource.example/mcp' }));
  const denied = await worker.fetch(mcpRequest('Bearer ' + tokens.access_token), env, {});
  assert.equal(denied.status, 401);
});

test('actual provider bearer path rejects malformed, nonexistent, expired, wrong-audience, missing-scope, and wrong-owner credentials', async () => {
  cimdDocuments = new Map([[CLIENT_ID, expectedCimd()]]);
  const reads = { count: 0 };
  const env = integrationEnv();
  const worker = integrationWorker(reads);
  const tokens = await issueTokens(worker, env);
  const token = tokens.access_token;
  const record = await accessTokenRecord(env, token);
  const original = JSON.parse(env.OAUTH_KV.records.get(record.key).value);

  for (const authorization of ['Bearer malformed', `Bearer ${OWNER}:missing-grant:missing-secret`, 'Bearer one, Bearer two']) {
    const response = await worker.fetch(mcpRequest(authorization), env, {});
    assert.equal(response.status, 401, authorization);
  }

  await env.OAUTH_KV.updateJson(record.key, (value) => ({ ...value, expiresAt: NOW - 1 }));
  assert.equal((await worker.fetch(mcpRequest('Bearer ' + token), env, {})).status, 401);
  env.OAUTH_KV.records.get(record.key).value = JSON.stringify(original);

  await env.OAUTH_KV.updateJson(record.key, (value) => ({ ...value, audience: 'https://wrong.example/mcp' }));
  assert.equal((await worker.fetch(mcpRequest('Bearer ' + token), env, {})).status, 401);
  env.OAUTH_KV.records.get(record.key).value = JSON.stringify(original);

  await env.OAUTH_KV.updateJson(record.key, (value) => ({ ...value, scope: [] }));
  const missingScope = await worker.fetch(mcpRequest('Bearer ' + token, 'tools/call'), env, {});
  assert.equal(missingScope.status, 200);
  assert.equal((await mcpMessage(missingScope)).result.isError, true);
  env.OAUTH_KV.records.get(record.key).value = JSON.stringify(original);

  const wrongOwnerEnv = { ...env, MCP_AUTHORIZED_OWNER_SUBJECT: 'different-owner' };
  delete wrongOwnerEnv.OAUTH_PROVIDER;
  const wrongOwner = await worker.fetch(mcpRequest('Bearer ' + token, 'tools/call'), wrongOwnerEnv, {});
  assert.equal(wrongOwner.status, 200);
  assert.equal((await mcpMessage(wrongOwner)).result.isError, true);
  assert.equal(reads.count, 0);

  const valid = await worker.fetch(mcpRequest('Bearer ' + token, 'tools/call'), env, {});
  assert.equal(valid.status, 200);
  assert.equal((await mcpMessage(valid)).result.structuredContent.revision, 7);
  assert.equal(reads.count, 1);
});

test('actual provider publishes exact production discovery and unauthenticated challenge metadata', async () => {
  cimdDocuments = new Map([[CLIENT_ID, expectedCimd()]]);
  const env = integrationEnv();
  const worker = integrationWorker();
  const protectedResponse = await worker.fetch(new Request(MCP_RESOURCE_METADATA), env, {});
  assert.equal(protectedResponse.status, 200);
  assert.deepEqual(await protectedResponse.json(), {
    resource: MCP_RESOURCE,
    authorization_servers: [MCP_ISSUER],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Meal Prep Planner private reads'
  });

  const metadataResponse = await worker.fetch(new Request(MCP_ISSUER + '/.well-known/oauth-authorization-server'), env, {});
  assert.equal(metadataResponse.status, 200);
  assert.deepEqual(await metadataResponse.json(), {
    issuer: MCP_ISSUER,
    authorization_endpoint: MCP_ISSUER + '/authorize',
    token_endpoint: MCP_ISSUER + '/oauth/token',
    protected_resources: [MCP_RESOURCE],
    scopes_supported: [MCP_SCOPE],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
    revocation_endpoint: MCP_ISSUER + '/oauth/token',
    code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true
  });

  const challenge = await worker.fetch(mcpRequest('', 'tools/list'), env, {});
  assert.equal(challenge.status, 401);
  assert.equal(
    challenge.headers.get('WWW-Authenticate'),
    `Bearer realm="OAuth", resource_metadata="${MCP_RESOURCE_METADATA}", scope="${MCP_SCOPE}"`
  );
});

test('provider revokeGrant removes the grant and all access/refresh token state and invalidates issued credentials', async () => {
  cimdDocuments = new Map([[CLIENT_ID, expectedCimd()]]);
  const env = integrationEnv();
  const worker = integrationWorker();
  const tokens = await issueTokens(worker, env);
  const before = await worker.fetch(mcpRequest('Bearer ' + tokens.access_token, 'tools/call'), env, {});
  assert.equal(before.status, 200);
  assert.equal((await mcpMessage(before)).result.structuredContent.revision, 7);

  const grants = await env.OAUTH_PROVIDER.listUserGrants(OWNER);
  assert.equal(grants.items.length, 1);
  const grant = grants.items[0];
  const storedGrant = await env.OAUTH_KV.get(`grant:${OWNER}:${grant.id}`, { type: 'json' });
  assert.equal(typeof storedGrant.refreshTokenId, 'string');
  const tokenPrefix = `token:${OWNER}:${grant.id}:`;
  assert.ok((await env.OAUTH_KV.list({ prefix: tokenPrefix })).keys.length >= 1);

  await env.OAUTH_PROVIDER.revokeGrant(grant.id, OWNER);
  assert.equal((await env.OAUTH_PROVIDER.listUserGrants(OWNER)).items.length, 0);
  assert.equal(await env.OAUTH_KV.get(`grant:${OWNER}:${grant.id}`), null);
  assert.equal((await env.OAUTH_KV.list({ prefix: tokenPrefix })).keys.length, 0);
  assert.equal((await worker.fetch(mcpRequest('Bearer ' + tokens.access_token), env, {})).status, 401);

  const refresh = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    refresh_token: tokens.refresh_token,
    resource: MCP_RESOURCE
  });
  const refreshResponse = await worker.fetch(new Request(MCP_ISSUER + '/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: refresh
  }), env, {});
  assert.equal(refreshResponse.status, 400);
  assert.equal((await refreshResponse.json()).error, 'invalid_grant');
});
