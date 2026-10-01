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

function createOAuthWorker(OAuthProvider, handleRestRequest) {
  const mcpApiHandler = {
    fetch(request, env, ctx) {
      return handleMcpRequest(request, env, {}, ctx);
    }
  };

  const defaultHandler = {
    fetch(request, env, ctx) {
      return handleDefaultRequest(request, env, { handleRestRequest }, ctx);
    }
  };

  return new OAuthProvider({
    apiRoute: '/mcp',
    apiHandler: mcpApiHandler,
    defaultHandler,
    ...OAUTH_PROVIDER_CONFIG
  });
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

    if (request.method === 'GET') return beginAuthorization(request, oauth);
    if (request.method === 'POST') return finishAuthorization(request, oauth, owner.subject, deps);
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
    localWarning + '<p>This grants read-only access to inventory and ready food. It cannot write or delete data.</p>' +
    '<form method="post"><input type="hidden" name="handle" value="' + escapeHtml(handle) + '">' +
    '<button name="decision" value="approve">Allow read access</button> ' +
    '<button name="decision" value="deny">Deny</button></form></main></body></html>';
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (character) => '&#' + character.charCodeAt(0) + ';');
}

function textResponse(message, status) {
  return new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
