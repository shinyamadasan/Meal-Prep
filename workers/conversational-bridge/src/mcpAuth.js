import { createRemoteJWKSet, jwtVerify } from 'jose';

export const MCP_SCOPE = 'mealprep:read';
export const MCP_WRITE_SCOPE = 'mealprep:write';
export const MCP_ISSUER = 'https://meal-prep-conversational-bridge.shinyamadasan.workers.dev';
export const MCP_RESOURCE = MCP_ISSUER + '/mcp';
export const MCP_RESOURCE_METADATA = MCP_ISSUER + '/.well-known/oauth-protected-resource/mcp';

const ACCESS_ASSERTION_HEADER = 'Cf-Access-Jwt-Assertion';
const ACCESS_ALGORITHM = 'RS256';

export class McpAuthError extends Error {
  constructor(code) {
    super('MCP authorization failed.');
    this.name = 'McpAuthError';
    this.code = code;
  }
}

let remoteJwksUrl = null;
let remoteJwks = null;

function configuredValue(env, name) {
  const value = env && typeof env[name] === 'string' ? env[name].trim() : '';
  if (!value) throw new McpAuthError('auth_configuration_missing');
  return value;
}

function normalizedTeamDomain(env) {
  const raw = configuredValue(env, 'ACCESS_TEAM_DOMAIN');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (cause) {
    throw new McpAuthError('auth_configuration_invalid');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') {
    throw new McpAuthError('auth_configuration_invalid');
  }
  return parsed.origin;
}

function getRemoteJwks(teamDomain) {
  const url = teamDomain + '/cdn-cgi/access/certs';
  if (!remoteJwks || remoteJwksUrl !== url) {
    remoteJwksUrl = url;
    remoteJwks = createRemoteJWKSet(new URL(url));
  }
  return remoteJwks;
}

export async function requireAccessOwner(request, env, deps = {}) {
  const token = request.headers.get(ACCESS_ASSERTION_HEADER) || '';
  if (!token) throw new McpAuthError('access_assertion_missing');

  const issuer = normalizedTeamDomain(env);
  const audience = configuredValue(env, 'ACCESS_POLICY_AUD');
  const ownerSubject = configuredValue(env, 'MCP_AUTHORIZED_OWNER_SUBJECT');
  const jwks = deps.jwks || getRemoteJwks(issuer);

  let payload;
  try {
    ({ payload } = await jwtVerify(token, jwks, {
      algorithms: [ACCESS_ALGORITHM],
      issuer,
      audience,
      requiredClaims: ['iss', 'aud', 'sub', 'exp', 'nbf'],
      clockTolerance: 0,
      currentDate: deps.currentDate
    }));
  } catch (cause) {
    throw new McpAuthError('access_assertion_invalid');
  }

  if (typeof payload.sub !== 'string' || payload.sub !== ownerSubject || payload.type !== 'app') {
    throw new McpAuthError('owner_mismatch');
  }
  return { subject: ownerSubject };
}

// TASK-069 (Phase B2A): TASK-068 shipped a single-scope assumption (exactly `mealprep:read`).
// Adding a write tool requires a deliberate allow-list of supported scope combinations instead,
// shared with oauth.js's authorization-request policy so both layers agree on what a token may
// contain. A read-only, write-only, or combined token is each a distinct, intentional grant;
// anything else (empty, unknown, or any other combination) is rejected.
const SUPPORTED_MCP_SCOPE_SETS = [[MCP_SCOPE], [MCP_WRITE_SCOPE], [MCP_SCOPE, MCP_WRITE_SCOPE]];

function scopeSetKey(tokens) {
  return [...new Set(tokens)].sort().join(' ');
}

const SUPPORTED_MCP_SCOPE_KEYS = new Set(SUPPORTED_MCP_SCOPE_SETS.map(scopeSetKey));

export function isSupportedMcpScopeSet(tokens) {
  return Array.isArray(tokens) && tokens.length > 0 && SUPPORTED_MCP_SCOPE_KEYS.has(scopeSetKey(tokens));
}

function requireMcpScopeContext(env, ctx, requiredScope, nowSeconds) {
  const ownerSubject = configuredValue(env, 'MCP_AUTHORIZED_OWNER_SUBJECT');
  const auth = ctx && ctx.auth;
  const props = ctx && ctx.props;

  if (!auth || !props || typeof auth.token !== 'string' || !auth.token) {
    throw new McpAuthError('token_missing');
  }
  if (auth.audience !== MCP_RESOURCE || props.resource !== MCP_RESOURCE || props.issuer !== MCP_ISSUER) {
    throw new McpAuthError('token_wrong_resource');
  }
  if (!Number.isFinite(auth.expiresAt) || auth.expiresAt <= nowSeconds) {
    throw new McpAuthError('token_expired');
  }
  if (!Number.isFinite(props.notBefore) || props.notBefore > nowSeconds) {
    throw new McpAuthError('token_not_yet_valid');
  }
  if (!isSupportedMcpScopeSet(auth.scope) || !auth.scope.includes(requiredScope)) {
    throw new McpAuthError('scope_missing');
  }
  if (auth.userId !== ownerSubject || props.ownerSubject !== ownerSubject) {
    throw new McpAuthError('owner_mismatch');
  }
  return { subject: ownerSubject };
}

export function requireMcpReadContext(env, ctx, nowSeconds = Math.floor(Date.now() / 1000)) {
  return requireMcpScopeContext(env, ctx, MCP_SCOPE, nowSeconds);
}

export function requireMcpWriteContext(env, ctx, nowSeconds = Math.floor(Date.now() / 1000)) {
  return requireMcpScopeContext(env, ctx, MCP_WRITE_SCOPE, nowSeconds);
}

export function mcpAuthChallenge(error, requiredScope = MCP_SCOPE) {
  const insufficientScope = error instanceof McpAuthError && error.code === 'scope_missing';
  const code = insufficientScope ? 'insufficient_scope' : 'invalid_token';
  const description = insufficientScope ? ('The ' + requiredScope + ' scope is required.') : 'Authentication is required.';
  const challenge = 'Bearer resource_metadata="' + MCP_RESOURCE_METADATA + '", error="' + code +
    '", error_description="' + description + '", scope="' + requiredScope + '"';
  return {
    content: [{ type: 'text', text: description }],
    isError: true,
    _meta: { 'mcp/www_authenticate': [challenge] }
  };
}
