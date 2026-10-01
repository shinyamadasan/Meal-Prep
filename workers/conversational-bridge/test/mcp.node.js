import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { routeRequest } from '../src/index.js';

const MCP_URL = 'https://localhost/mcp';

function mcpRequest(body, { method = 'POST', contentType = 'application/json' } = {}) {
  const headers = {
    Host: 'localhost',
    Accept: 'application/json, text/event-stream'
  };
  if (contentType) headers['Content-Type'] = contentType;
  const init = { method, headers };
  if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  return new Request(MCP_URL, init);
}

async function responseMessage(response) {
  const text = await response.text();
  if ((response.headers.get('Content-Type') || '').includes('text/event-stream')) {
    const dataLine = text.split(/\r?\n/).find((line) => line.startsWith('data: '));
    assert.ok(dataLine, 'SSE response must contain a data frame');
    return JSON.parse(dataLine.slice(6));
  }
  return JSON.parse(text);
}

function rpcRequest(id, method, params = {}) {
  return { jsonrpc: '2.0', id, method, params };
}

function toolCall(id, name, args = {}) {
  return rpcRequest(id, 'tools/call', { name, arguments: args });
}

function isolationGuards() {
  const calls = { token: 0, read: 0, write: 0, fetch: 0 };
  const deps = {
    getFirestoreAccessToken: async () => { calls.token += 1; throw new Error('token path reached'); },
    getUserDocument: async () => { calls.read += 1; throw new Error('read path reached'); },
    patchUserDocument: async () => { calls.write += 1; throw new Error('write path reached'); },
    fetchImpl: async () => { calls.fetch += 1; throw new Error('external fetch reached'); }
  };
  const env = new Proxy({}, {
    get(_target, property) {
      throw new Error('environment binding read: ' + String(property));
    }
  });
  return { calls, deps, env };
}

test('MCP initialize handshake succeeds over Streamable HTTP without secrets', async () => {
  const response = await routeRequest(mcpRequest(rpcRequest(1, 'initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'task-067-test', version: '1.0.0' }
  })));
  assert.equal(response.status, 200);
  const message = await responseMessage(response);
  assert.equal(message.jsonrpc, '2.0');
  assert.equal(message.id, 1);
  assert.equal(message.result.protocolVersion, '2025-11-25');
  assert.equal(message.result.serverInfo.name, 'meal-prep-mcp-feasibility-probes');

  const initialized = await routeRequest(mcpRequest({
    jsonrpc: '2.0',
    method: 'notifications/initialized'
  }));
  assert.equal(initialized.status, 202);
  assert.equal(await initialized.text(), '');
});

test('tools/list exposes exactly the two probes with exact annotations', async () => {
  const response = await routeRequest(mcpRequest(rpcRequest(2, 'tools/list')));
  assert.equal(response.status, 200);
  const message = await responseMessage(response);
  const tools = message.result.tools;
  assert.deepEqual(tools.map((tool) => tool.name), ['probe_read', 'probe_write']);
  assert.deepEqual(tools[0].annotations, {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: false
  });
  assert.deepEqual(tools[1].annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  });
  const emptyInputSchema = {
    type: 'object',
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    properties: {},
    additionalProperties: false
  };
  assert.deepEqual(tools[0].inputSchema, emptyInputSchema);
  assert.deepEqual(tools[1].inputSchema, emptyInputSchema);
});

for (const probe of [
  { name: 'probe_read', expected: { ok: true, probe: 'read' } },
  { name: 'probe_write', expected: { ok: true, probe: 'write-classified-noop' } }
]) {
  test(probe.name + ' returns only static data and reaches no environment, Firestore, domain, fetch, or state path', async () => {
    const guards = isolationGuards();
    const originalFetch = globalThis.fetch;
    let globalFetchCalls = 0;
    globalThis.fetch = async () => { globalFetchCalls += 1; throw new Error('global fetch reached'); };
    try {
      const response = await routeRequest(mcpRequest(toolCall(3, probe.name)), guards.env, guards.deps);
      assert.equal(response.status, 200);
      const message = await responseMessage(response);
      assert.deepEqual(message.result.structuredContent, probe.expected);
      assert.deepEqual(JSON.parse(message.result.content[0].text), probe.expected);
      assert.deepEqual(guards.calls, { token: 0, read: 0, write: 0, fetch: 0 });
      assert.equal(globalFetchCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
}

test('probe schemas reject inputs instead of accepting hidden parameters', async () => {
  const response = await routeRequest(mcpRequest(toolCall(4, 'probe_read', { uid: 'must-not-be-accepted' })));
  assert.equal(response.status, 200);
  const message = await responseMessage(response);
  assert.equal(message.result.isError, true);
  assert.match(message.result.content[0].text, /input validation error/i);
  assert.doesNotMatch(JSON.stringify(message), /stack|TARGET_UID|FIREBASE_SERVICE_ACCOUNT_JSON/);
});

test('probe module has no import or call path to bridge domain, Firestore, secrets, or durable state', async () => {
  const source = await readFile(new URL('../src/mcp.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\.\/firestore|\.\/operations\/|inventory|readyFood/);
  assert.doesNotMatch(source, /TARGET_UID|FIREBASE_SERVICE_ACCOUNT_JSON|FIRESTORE_PROJECT_ID|BRIDGE_API_TOKEN/);
  assert.doesNotMatch(source, /DurableObject|KVNamespace|D1Database|R2Bucket|\.put\s*\(|\.write\s*\(/);
});

test('malformed MCP JSON fails safely without stack or secret disclosure', async () => {
  const response = await routeRequest(mcpRequest('{not json'));
  assert.equal(response.status, 400);
  const text = await response.text();
  assert.doesNotMatch(text, /stack|BRIDGE_API_TOKEN|FIREBASE_SERVICE_ACCOUNT_JSON|TARGET_UID|at file:/i);
});

test('an unknown MCP tool fails safely without reaching bridge dependencies', async () => {
  const guards = isolationGuards();
  const response = await routeRequest(mcpRequest(toolCall(5, 'unknown_tool')), guards.env, guards.deps);
  assert.equal(response.status, 200);
  const message = await responseMessage(response);
  assert.equal(message.error.code, -32602);
  assert.match(message.error.message, /tool unknown_tool not found/i);
  assert.deepEqual(guards.calls, { token: 0, read: 0, write: 0, fetch: 0 });
  assert.doesNotMatch(JSON.stringify(message), /stack|BRIDGE_API_TOKEN|FIREBASE_SERVICE_ACCOUNT_JSON|TARGET_UID/i);
});

test('unsupported MCP HTTP methods and media types are rejected', async () => {
  for (const method of ['GET', 'DELETE', 'PUT']) {
    const response = await routeRequest(mcpRequest(undefined, { method, contentType: null }));
    assert.equal(response.status, 405, method + ' must be rejected');
  }
  const wrongType = await routeRequest(mcpRequest(rpcRequest(6, 'tools/list'), { contentType: 'text/plain' }));
  assert.equal(wrongType.status, 415);
});

test('MCP rejects untrusted Host and browser Origin values before protocol handling', async () => {
  const body = JSON.stringify(rpcRequest(7, 'tools/list'));
  const badHost = await routeRequest(new Request(MCP_URL, {
    method: 'POST',
    headers: { Host: 'attacker.example', Accept: 'application/json', 'Content-Type': 'application/json' },
    body
  }));
  assert.equal(badHost.status, 403);

  const badOrigin = await routeRequest(new Request(MCP_URL, {
    method: 'POST',
    headers: { Host: 'localhost', Origin: 'https://attacker.example', Accept: 'application/json', 'Content-Type': 'application/json' },
    body
  }));
  assert.equal(badOrigin.status, 403);
});

test('routeRequest keeps exact REST routes behind bearer auth before downstream access', async () => {
  const cases = [
    { method: 'GET', pathname: '/v1/inventory', authorization: null },
    { method: 'GET', pathname: '/v1/inventory', authorization: 'Bearer wrong-token' },
    { method: 'POST', pathname: '/v1/ready-food/record', authorization: null },
    { method: 'POST', pathname: '/v1/ready-food/record', authorization: 'Bearer wrong-token' }
  ];

  for (const { method, pathname, authorization } of cases) {
    const guards = isolationGuards();
    const headers = authorization ? { Authorization: authorization } : {};
    const response = await routeRequest(
      new Request('https://worker.test' + pathname, { method, headers }),
      { BRIDGE_API_TOKEN: 'expected-token' },
      guards.deps
    );
    assert.equal(response.status, 401);
    assert.deepEqual(guards.calls, { token: 0, read: 0, write: 0, fetch: 0 });
  }
});

test('routeRequest sends only exact /mcp to the unauthenticated MCP handler', async () => {
  const exact = await routeRequest(mcpRequest(rpcRequest(8, 'tools/list')));
  assert.equal(exact.status, 200);

  for (const pathname of ['/mcp/', '/mcp-evil']) {
    const guards = isolationGuards();
    const response = await routeRequest(
      new Request('https://worker.test' + pathname),
      { BRIDGE_API_TOKEN: 'expected-token' },
      guards.deps
    );
    assert.equal(response.status, 401);
    assert.deepEqual(guards.calls, { token: 0, read: 0, write: 0, fetch: 0 });
  }
});
