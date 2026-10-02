import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createLocalJWKSet, exportJWK, SignJWT } from 'jose';
import {
  MCP_ISSUER,
  MCP_RESOURCE,
  MCP_RESOURCE_METADATA,
  MCP_SCOPE,
  MCP_WRITE_SCOPE,
  McpAuthError,
  requireAccessOwner,
  requireMcpReadContext,
  requireMcpWriteContext
} from '../src/mcpAuth.js';
import { OAUTH_PROVIDER_CONFIG, handleDefaultRequest, requireExactAuthorizationScope } from '../src/oauth.js';
import { testEnv } from './support/fixtures.js';

const NOW = 1_800_000_000;
const ACCESS_ISSUER = 'https://test.cloudflareaccess.com';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = await exportJWK(publicKey);
publicJwk.kid = 'task-068-test-key';
publicJwk.alg = 'RS256';
const jwks = createLocalJWKSet({ keys: [publicJwk] });

async function accessAssertion(overrides = {}, signingKey = privateKey, kid = 'task-068-test-key') {
  const claims = Object.assign({
    type: 'app',
    email: 'changed-display-value@example.test',
    iss: ACCESS_ISSUER,
    aud: ['test-access-policy-audience'],
    sub: 'test-owner-subject',
    iat: NOW - 5,
    nbf: NOW - 5,
    exp: NOW + 300
  }, overrides);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' })
    .sign(signingKey);
}

function authorizeRequest(token, { method = 'GET', body } = {}) {
  const headers = {};
  if (token) headers['Cf-Access-Jwt-Assertion'] = token;
  if (body !== undefined) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  return new Request('https://meal-prep-conversational-bridge.shinyamadasan.workers.dev/authorize?resource=' + encodeURIComponent(MCP_RESOURCE), {
    method,
    headers,
    body
  });
}

test('OAuth provider configuration is read-only, resource-bound, and CIMD-first', () => {
  assert.equal(OAUTH_PROVIDER_CONFIG.authorizeEndpoint, '/authorize');
  assert.equal(OAUTH_PROVIDER_CONFIG.tokenEndpoint, '/oauth/token');
  assert.equal(OAUTH_PROVIDER_CONFIG.clientIdMetadataDocumentEnabled, true);
  assert.equal(OAUTH_PROVIDER_CONFIG.clientRegistrationEndpoint, undefined);
  assert.deepEqual(OAUTH_PROVIDER_CONFIG.scopesSupported, ['mealprep:read']);
  assert.deepEqual(OAUTH_PROVIDER_CONFIG.requiredScopes, ['mealprep:read']);
  assert.deepEqual(OAUTH_PROVIDER_CONFIG.resourceMetadata, {
    resource: MCP_RESOURCE,
    authorization_servers: [MCP_ISSUER],
    bearer_methods_supported: ['header'],
    resource_name: 'Meal Prep Planner private reads'
  });
  assert.equal(OAUTH_PROVIDER_CONFIG.allowTokenExchangeGrant, false);
  assert.equal(MCP_RESOURCE_METADATA, MCP_ISSUER + '/.well-known/oauth-protected-resource/mcp');
  assert.equal(OAUTH_PROVIDER_CONFIG.accessTokenTTL, 15 * 60);
  assert.equal(OAUTH_PROVIDER_CONFIG.refreshTokenTTL, 14 * 24 * 60 * 60);
  assert.doesNotMatch(JSON.stringify(OAUTH_PROVIDER_CONFIG), /mealprep:write|clientRegistrationEndpoint/);
});

test('valid signed owner assertion passes regardless of email/display claim changes or field order', async () => {
  const token = await accessAssertion({
    email: 'a-different-address@example.test',
    country: 'US'
  });
  const owner = await requireAccessOwner(authorizeRequest(token), testEnv(), {
    jwks,
    currentDate: new Date(NOW * 1000)
  });
  assert.deepEqual(owner, { subject: 'test-owner-subject' });

  const reorderedToken = await new SignJWT({
    sub: 'test-owner-subject',
    exp: NOW + 300,
    type: 'app',
    nbf: NOW - 5,
    aud: ['test-access-policy-audience'],
    iss: ACCESS_ISSUER,
    email: 'another-display-value@example.test'
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'task-068-test-key', typ: 'JWT' })
    .sign(privateKey);
  const reorderedOwner = await requireAccessOwner(authorizeRequest(reorderedToken), testEnv(), {
    jwks,
    currentDate: new Date(NOW * 1000)
  });
  assert.deepEqual(reorderedOwner, { subject: 'test-owner-subject' });
});

test('missing, malformed, invalid-signature, expired, future, wrong issuer/audience, and ambiguous identity assertions fail closed', async () => {
  const cases = [
    { name: 'missing', token: null },
    { name: 'malformed', token: 'not-a-jwt' },
    { name: 'invalid-signature', token: await accessAssertion({}, otherKey.privateKey) },
    { name: 'wrong-kid', token: await accessAssertion({}, privateKey, 'unusable-test-key') },
    { name: 'expired', token: await accessAssertion({ exp: NOW - 1 }) },
    { name: 'not-yet-valid', token: await accessAssertion({ nbf: NOW + 1 }) },
    { name: 'wrong-issuer', token: await accessAssertion({ iss: 'https://attacker.example' }) },
    { name: 'wrong-audience', token: await accessAssertion({ aud: ['wrong-audience'] }) },
    { name: 'wrong-owner', token: await accessAssertion({ sub: 'another-owner' }) },
    { name: 'ambiguous-owner-array', token: await accessAssertion({ sub: ['test-owner-subject', 'another-owner'] }) },
    { name: 'service-token-shape', token: await accessAssertion({ sub: '', type: 'app' }) },
    { name: 'wrong-token-type', token: await accessAssertion({ type: 'org' }) }
  ];

  for (const item of cases) {
    await assert.rejects(
      requireAccessOwner(authorizeRequest(item.token), testEnv(), {
        jwks,
        currentDate: new Date(NOW * 1000)
      }),
      (error) => error instanceof McpAuthError,
      item.name
    );
  }
});

test('missing authorized-owner configuration fails closed', async () => {
  const env = testEnv();
  delete env.MCP_AUTHORIZED_OWNER_SUBJECT;
  await assert.rejects(
    requireAccessOwner(authorizeRequest(await accessAssertion()), env, {
      jwks,
      currentDate: new Date(NOW * 1000)
    }),
    (error) => error instanceof McpAuthError && error.code === 'auth_configuration_missing'
  );
  assert.throws(
    () => requireMcpReadContext(env, {
      auth: { token: 'opaque', audience: MCP_RESOURCE, expiresAt: NOW + 300, scope: [MCP_SCOPE], userId: 'test-owner-subject' },
      props: { ownerSubject: 'test-owner-subject', issuer: MCP_ISSUER, resource: MCP_RESOURCE, notBefore: NOW - 5 }
    }, NOW),
    (error) => error instanceof McpAuthError && error.code === 'auth_configuration_missing'
  );
  assert.throws(
    () => requireMcpWriteContext(env, {
      auth: { token: 'opaque', audience: MCP_RESOURCE, expiresAt: NOW + 300, scope: [MCP_WRITE_SCOPE], userId: 'test-owner-subject' },
      props: { ownerSubject: 'test-owner-subject', issuer: MCP_ISSUER, resource: MCP_RESOURCE, notBefore: NOW - 5 }
    }, NOW),
    (error) => error instanceof McpAuthError && error.code === 'auth_configuration_missing'
  );
});

test('authorization scope normalization accepts a deduplicated read, write, or combined set — TASK-069 allow-list', () => {
  assert.deepEqual(requireExactAuthorizationScope(['mealprep:read']), ['mealprep:read']);
  assert.deepEqual(requireExactAuthorizationScope(['mealprep:read', 'mealprep:read']), ['mealprep:read']);
  assert.deepEqual(requireExactAuthorizationScope('  mealprep:read  mealprep:read  '), ['mealprep:read']);
  assert.deepEqual(requireExactAuthorizationScope(['mealprep:write']), ['mealprep:write']);
  assert.deepEqual(requireExactAuthorizationScope(['mealprep:write', 'mealprep:write']), ['mealprep:write']);
  assert.deepEqual(requireExactAuthorizationScope(['mealprep:write', 'mealprep:read']), ['mealprep:read', 'mealprep:write']);
  assert.deepEqual(requireExactAuthorizationScope(['mealprep:read', 'mealprep:write', 'mealprep:read']), ['mealprep:read', 'mealprep:write']);
  assert.deepEqual(requireExactAuthorizationScope('mealprep:read mealprep:write'), ['mealprep:read', 'mealprep:write']);
  for (const scope of [undefined, '', [], 'mealprep:read\tmealprep:read', ['unknown'], ['mealprep:read', 'unknown'], ['mealprep:write', 'unknown'], ['mealprep:read', 'mealprep:write', 'unknown']]) {
    assert.throws(() => requireExactAuthorizationScope(scope), (error) => error.name === 'AuthorizationError');
  }
});

test('authorization GET requires the signed owner before parsing client metadata and escapes consent content', async () => {
  const calls = [];
  const oauth = {
    parseAuthRequest: async () => {
      calls.push('parse');
      return {
        clientId: 'https://chatgpt.com/oauth/client.json',
        redirectUri: 'https://chatgpt.com/connector_platform_oauth_redirect',
        scope: [MCP_SCOPE],
        resource: MCP_RESOURCE,
        state: 'test-state',
        issuer: MCP_ISSUER
      };
    },
    describeConsent: async () => ({
      clientName: '<script>alert(1)</script>',
      clientDomain: 'chatgpt.com',
      redirectHost: 'chatgpt.com',
      redirectIsLoopback: false,
      scope: [MCP_SCOPE]
    }),
    beginConsent: async () => ({
      handle: 'safe-handle',
      headers: new Headers({
        'Content-Security-Policy': "frame-ancestors 'none'",
        'X-Frame-Options': 'DENY'
      })
    })
  };
  const token = await accessAssertion();
  const response = await handleDefaultRequest(authorizeRequest(token), testEnv(), {
    oauth,
    jwks,
    currentDate: new Date(NOW * 1000)
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
  const html = await response.text();
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&#60;script&#62;/);
  assert.match(html, /read-only access/);
  assert.match(html, /<code>mealprep:read<\/code>/);
  assert.deepEqual(calls, ['parse']);

  calls.length = 0;
  const denied = await handleDefaultRequest(authorizeRequest(await accessAssertion({ sub: 'another-owner' })), testEnv(), {
    oauth,
    jwks,
    currentDate: new Date(NOW * 1000)
  });
  assert.equal(denied.status, 401);
  assert.deepEqual(calls, []);
});

test('authorization GET names write and combined authority exactly as requested — TASK-069', async () => {
  function oauthFor(scope) {
    return {
      parseAuthRequest: async () => ({
        clientId: 'https://chatgpt.com/oauth/client.json',
        redirectUri: 'https://chatgpt.com/connector_platform_oauth_redirect',
        scope,
        resource: MCP_RESOURCE,
        state: 'test-state',
        issuer: MCP_ISSUER
      }),
      describeConsent: async () => ({
        clientName: 'ChatGPT',
        clientDomain: 'chatgpt.com',
        redirectHost: 'chatgpt.com',
        redirectIsLoopback: false,
        scope
      }),
      beginConsent: async () => ({ handle: 'safe-handle', headers: new Headers() })
    };
  }

  const token = await accessAssertion();
  const writeResponse = await handleDefaultRequest(authorizeRequest(token), testEnv(), {
    oauth: oauthFor([MCP_WRITE_SCOPE]),
    jwks,
    currentDate: new Date(NOW * 1000)
  });
  const writeHtml = await writeResponse.text();
  assert.equal(writeResponse.status, 200);
  assert.match(writeHtml, /<code>mealprep:write<\/code>/);
  assert.doesNotMatch(writeHtml, /read-only access/);
  assert.match(writeHtml, /record one new ready-to-eat batch/);

  const combinedResponse = await handleDefaultRequest(authorizeRequest(token), testEnv(), {
    oauth: oauthFor([MCP_SCOPE, MCP_WRITE_SCOPE]),
    jwks,
    currentDate: new Date(NOW * 1000)
  });
  const combinedHtml = await combinedResponse.text();
  assert.equal(combinedResponse.status, 200);
  assert.match(combinedHtml, /<code>mealprep:read mealprep:write<\/code>/);
  assert.match(combinedHtml, /read-only access/);
  assert.match(combinedHtml, /record one new ready-to-eat batch/);
});

test('authorization POST grants only mealprep:read to the configured owner and fixed resource', async () => {
  let approvedOptions;
  let completedOptions;
  const oauth = {
    approveConsent: async (_request, handle, options) => {
      assert.equal(handle, 'stored-handle');
      approvedOptions = options;
      return {
        request: { clientId: 'https://chatgpt.com/oauth/client.json', scope: [MCP_SCOPE], resource: MCP_RESOURCE },
        headers: new Headers({ 'Set-Cookie': '__Host-oauth-consent-test=; Max-Age=0' })
      };
    },
    completeAuthorization: async (options) => {
      completedOptions = options;
      return { redirectTo: 'https://chatgpt.com/connector_platform_oauth_redirect?code=fake' };
    }
  };
  const token = await accessAssertion();
  const response = await handleDefaultRequest(authorizeRequest(token, {
    method: 'POST',
    body: 'handle=stored-handle&decision=approve&scope=mealprep%3Awrite&uid=attacker'
  }), testEnv(), {
    oauth,
    jwks,
    currentDate: new Date(NOW * 1000),
    nowSeconds: NOW
  });
  assert.equal(response.status, 302);
  assert.equal(approvedOptions, undefined);
  assert.deepEqual(completedOptions.request.scope, [MCP_SCOPE]);
  assert.equal(completedOptions.userId, 'test-owner-subject');
  assert.deepEqual(completedOptions.scope, [MCP_SCOPE]);
  assert.deepEqual(completedOptions.props, {
    ownerSubject: 'test-owner-subject',
    issuer: MCP_ISSUER,
    resource: MCP_RESOURCE,
    notBefore: NOW
  });
  assert.doesNotMatch(JSON.stringify(completedOptions), /mealprep:write|attacker/);
});

test('authorization POST rejects a stored unsupported request before grant creation', async () => {
  let completed = 0;
  const oauth = {
    approveConsent: async () => ({
      request: {
        clientId: 'https://chatgpt.com/oauth/client.json',
        redirectUri: 'https://chatgpt.com/connector_platform_oauth_redirect',
        scope: ['unknown'],
        resource: MCP_RESOURCE,
        state: 'test-state',
        issuer: MCP_ISSUER
      },
      headers: new Headers()
    }),
    completeAuthorization: async () => { completed += 1; throw new Error('must not complete'); }
  };
  const response = await handleDefaultRequest(authorizeRequest(await accessAssertion(), {
    method: 'POST',
    body: 'handle=stored-handle&decision=approve'
  }), testEnv(), {
    oauth,
    jwks,
    currentDate: new Date(NOW * 1000)
  });
  assert.equal(response.status, 302);
  assert.equal(new URL(response.headers.get('Location')).searchParams.get('error'), 'invalid_scope');
  assert.equal(completed, 0);
});

test('non-authorization requests remain delegated to the unchanged REST handler', async () => {
  let delegated = 0;
  const response = await handleDefaultRequest(new Request('https://worker.test/v1/inventory'), testEnv(), {
    handleRestRequest: async () => { delegated += 1; return new Response('rest', { status: 418 }); }
  });
  assert.equal(response.status, 418);
  assert.equal(delegated, 1);
});
