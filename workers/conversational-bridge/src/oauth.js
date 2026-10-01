import { handleMcpRequest } from './mcp.js';
import {
  MCP_ISSUER,
  MCP_RESOURCE,
  MCP_SCOPE,
  McpAuthError,
  requireAccessOwner
} from './mcpAuth.js';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 14 * 24 * 60 * 60;
let oauthWorkerPromise = null;

export const OAUTH_PROVIDER_CONFIG = Object.freeze({
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/oauth/token',
  scopesSupported: [MCP_SCOPE],
  requiredScopes: [MCP_SCOPE],
  resourceMetadata: {
    resource: MCP_RESOURCE,
    authorization_servers: [MCP_ISSUER],
    bearer_methods_supported: ['header'],
    resource_name: 'Meal Prep Planner private reads'
  },
  clientIdMetadataDocumentEnabled: true,
  accessTokenTTL: ACCESS_TOKEN_TTL_SECONDS,
  refreshTokenTTL: REFRESH_TOKEN_TTL_SECONDS,
  allowTokenExchangeGrant: false
});

export function getOAuthWorker(handleRestRequest) {
  if (!oauthWorkerPromise) {
    oauthWorkerPromise = import('@cloudflare/workers-oauth-provider').then(({ default: OAuthProvider }) =>
      createOAuthWorker(OAuthProvider, handleRestRequest));
  }
  return oauthWorkerPromise;
}

export function createOAuthWorker(OAuthProvider, handleRestRequest, deps = {}) {
  const mcpApiHandler = {
    fetch(request, env, ctx) {
      return handleMcpRequest(request, env, deps.mcp || {}, ctx);
    }
  };

  const defaultHandler = {
    fetch(request, env, ctx) {
      return handleDefaultRequest(request, env, { ...deps, handleRestRequest }, ctx);
    }
  };

  const provider = new OAuthProvider({
    apiRoute: '/mcp',
    apiHandler: mcpApiHandler,
    defaultHandler,
    ...OAUTH_PROVIDER_CONFIG
  });
  return {
    async fetch(request, env, ctx) {
      const rejected = await rejectInvalidTokenResource(request);
      return rejected || provider.fetch(request, env, ctx);
    }
  };
}

export async function handleDefaultRequest(request, env = {}, deps = {}, ctx) {
  const url = new URL(request.url);
  if (url.pathname !== '/authorize') {
    if (!deps.handleRestRequest) throw new Error('REST handler dependency is not configured.');
    return deps.handleRestRequest(request, env, deps, ctx);
  }

  try {
    const owner = await requireAccessOwner(request, env, deps);
    const oauth = deps.oauth || (env && env.OAUTH_PROVIDER);
    if (!oauth) throw new McpAuthError('auth_configuration_missing');

    if (request.method === 'GET') return await beginAuthorization(request, oauth);
    if (request.method === 'POST') return await finishAuthorization(request, oauth, owner.subject, deps);
    return new Response('Method not allowed.', { status: 405, headers: { Allow: 'GET, POST' } });
  } catch (error) {
    if (error && error.name === 'AuthorizationError' && error.redirectTo) return Response.redirect(error.redirectTo, 302);
    if (error && (error.name === 'AuthorizationError' || error.name === 'CimdFetchError')) {
      return textResponse('The authorization request is invalid or expired.', 400);
    }
    if (error instanceof McpAuthError) return textResponse('Owner authentication is required.', 401);
    return textResponse('Authorization is temporarily unavailable.', 503);
  }
}

async function beginAuthorization(request, oauth) {
  const authRequest = await oauth.parseAuthRequest(request);
  requireExactAuthorizationRequest(request, authRequest);
  const details = await oauth.describeConsent(authRequest);
  const consent = await oauth.beginConsent(authRequest);
  consent.headers.set('Content-Type', 'text/html; charset=utf-8');
  return new Response(consentPage(details, consent.handle), { status: 200, headers: consent.headers });
}

async function finishAuthorization(request, oauth, ownerSubject, deps) {
  const form = await request.formData();
  const handle = String(form.get('handle') || '');
  if (form.get('decision') !== 'approve') {
    const denied = await oauth.denyConsent(request, handle);
    return new Response(null, { status: 302, headers: denied.headers });
  }

  const approved = await oauth.approveConsent(request, handle, { scope: [MCP_SCOPE] });
  requireExactAuthorizationScope(approved.request.scope, approved.request);
  const issuedAt = deps.nowSeconds == null ? Math.floor(Date.now() / 1000) : deps.nowSeconds;
  const { redirectTo } = await oauth.completeAuthorization({
    request: approved.request,
    userId: ownerSubject,
    metadata: {},
    scope: [MCP_SCOPE],
    props: {
      ownerSubject,
      issuer: MCP_ISSUER,
      resource: MCP_RESOURCE,
      notBefore: issuedAt
    }
  });
  approved.headers.set('Location', redirectTo);
  return new Response(null, { status: 302, headers: approved.headers });
}

function consentPage(details, handle) {
  const name = escapeHtml(details.clientName);
  const clientOrigin = details.clientDomain
    ? 'Published by <strong>' + escapeHtml(details.clientDomain) + '</strong>.'
    : 'This client registered itself; its displayed name is not verified.';
  const localWarning = details.redirectIsLoopback
    ? '<p><strong>This sends access to an app on this computer. Continue only if you started this sign-in.</strong></p>'
    : '';
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Authorize ' + name + '</title></head><body><main><h1>Allow ' + name + ' to read your meal-prep data?</h1>' +
    '<p>' + clientOrigin + ' Access will be sent to <strong>' + escapeHtml(details.redirectHost) + '</strong>.</p>' +
    localWarning + '<p>This grants scope <code>' + MCP_SCOPE + '</code>: read-only access to inventory and ready food. It cannot write or delete data.</p>' +
    '<form method="post"><input type="hidden" name="handle" value="' + escapeHtml(handle) + '">' +
    '<button name="decision" value="approve">Allow read access</button> ' +
    '<button name="decision" value="deny">Deny</button></form></main></body></html>';
}

export function requireExactAuthorizationScope(requestedScope, authRequest = {}) {
  const tokens = (Array.isArray(requestedScope) ? requestedScope : [requestedScope])
    .flatMap((value) => typeof value === 'string' ? value.split(' ') : [])
    .filter(Boolean);
  const unique = [...new Set(tokens)];
  if (unique.length !== 1 || unique[0] !== MCP_SCOPE) {
    throw authorizationPolicyError('invalid_scope', 'Exactly mealprep:read must be requested.', authRequest);
  }
  return [MCP_SCOPE];
}

function requireExactAuthorizationRequest(request, authRequest) {
  requireExactAuthorizationScope(authRequest.scope, authRequest);
  const resources = new URL(request.url).searchParams.getAll('resource');
  if (resources.length !== 1 || resources[0] !== MCP_RESOURCE || authRequest.resource !== MCP_RESOURCE) {
    throw authorizationPolicyError('invalid_target', 'The canonical MCP resource is required.', authRequest);
  }
}

function authorizationPolicyError(code, description, authRequest) {
  const error = new Error(description);
  error.name = 'AuthorizationError';
  if (authRequest && authRequest.redirectUri) {
    const redirect = new URL(authRequest.redirectUri);
    for (const parameter of ['error', 'error_description', 'error_uri', 'state', 'iss']) {
      redirect.searchParams.delete(parameter);
    }
    redirect.searchParams.set('error', code);
    redirect.searchParams.set('error_description', description);
    if (authRequest.state) redirect.searchParams.set('state', authRequest.state);
    if (authRequest.issuer) redirect.searchParams.set('iss', authRequest.issuer);
    error.redirectTo = redirect.href;
  }
  return error;
}

async function rejectInvalidTokenResource(request) {
  const url = new URL(request.url);
  if (url.pathname !== OAUTH_PROVIDER_CONFIG.tokenEndpoint || request.method !== 'POST') return null;

  let form;
  try {
    form = await request.clone().formData();
  } catch (error) {
    return null;
  }
  const grantType = String(form.get('grant_type') || '');
  if (grantType !== 'authorization_code' && grantType !== 'refresh_token') return null;
  const resources = form.getAll('resource').map(String);
  if (resources.length === 1 && resources[0] === MCP_RESOURCE) return null;
  return new Response(JSON.stringify({
    error: 'invalid_target',
    error_description: 'The canonical MCP resource is required.'
  }), {
    status: 400,
    headers: {
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      'Content-Type': 'application/json; charset=utf-8'
    }
  });
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (character) => '&#' + character.charCodeAt(0) + ';');
}

function textResponse(message, status) {
  return new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
