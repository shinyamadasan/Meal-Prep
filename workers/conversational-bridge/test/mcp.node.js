import test from 'node:test';
import assert from 'node:assert/strict';
import { routeRequest } from '../src/index.js';
import { MCP_ISSUER, MCP_RESOURCE, MCP_SCOPE } from '../src/mcpAuth.js';
import { testEnv } from './support/fixtures.js';

const MCP_URL = 'https://localhost/mcp';
const NOW = 1_800_000_000;

function mcpRequest(body, { method = 'POST', contentType = 'application/json', authorization = 'Bearer oauth-test-token' } = {}) {
  const headers = {
    Host: 'localhost',
    Accept: 'application/json, text/event-stream'
  };
  if (authorization) headers.Authorization = authorization;
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

function validContext(overrides = {}) {
  return {
    auth: Object.assign({
      token: 'not-a-real-token',
      audience: MCP_RESOURCE,
      expiresAt: NOW + 300,
      scope: [MCP_SCOPE],
      userId: 'test-owner-subject',
      clientId: 'https://chatgpt.com/oauth/client.json'
    }, overrides.auth || {}),
    props: Object.assign({
      ownerSubject: 'test-owner-subject',
      issuer: MCP_ISSUER,
      resource: MCP_RESOURCE,
      notBefore: NOW - 1
    }, overrides.props || {})
  };
}

function readDeps(doc) {
  const calls = { token: 0, read: 0, write: 0, fetch: 0 };
  return {
    calls,
    deps: {
      nowSeconds: NOW,
      getFirestoreAccessToken: async () => { calls.token += 1; return 'fake-firestore-token'; },
      getUserDocument: async () => { calls.read += 1; return doc; },
      patchUserDocument: async () => { calls.write += 1; throw new Error('write path reached'); },
      fetchImpl: async () => { calls.fetch += 1; throw new Error('external fetch reached'); }
    }
  };
}

test('MCP initialize handshake succeeds for an authenticated owner context', async () => {
  const response = await routeRequest(mcpRequest(rpcRequest(1, 'initialize', {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'task-068-test', version: '1.0.0' }
  })), testEnv(), { nowSeconds: NOW }, validContext());
  assert.equal(response.status, 200);
  const message = await responseMessage(response);
  assert.equal(message.result.protocolVersion, '2025-11-25');
  assert.equal(message.result.serverInfo.name, 'meal-prep-private-reads');
});

test('tools/list exposes exactly eight tools total — two read, six write — with correct annotations', async () => {
  const response = await routeRequest(
    mcpRequest(rpcRequest(2, 'tools/list')),
    testEnv(),
    { nowSeconds: NOW },
    validContext()
  );
  const message = await responseMessage(response);
  assert.deepEqual(message.result.tools.map((tool) => tool.name), [
    'get_inventory', 'get_ready_food', 'record_ready_food', 'consume_ready_food',
    'mark_out_of_stock', 'mark_in_stock', 'set_inventory_quantity', 'consume_stock'
  ]);

  const [getInventory, getReadyFood, recordReadyFood, consumeReadyFood] = message.result.tools;
  for (const tool of [getInventory, getReadyFood]) {
    assert.deepEqual(tool.securitySchemes, [{ type: 'oauth2', scopes: ['mealprep:read'] }]);
    assert.deepEqual(tool._meta.securitySchemes, [{ type: 'oauth2', scopes: ['mealprep:read'] }]);
    assert.deepEqual(tool.annotations, {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false
    });
    assert.deepEqual(tool.inputSchema.properties, {});
    assert.equal(tool.inputSchema.additionalProperties, false);
  }

  assert.deepEqual(recordReadyFood.securitySchemes, [{ type: 'oauth2', scopes: ['mealprep:write'] }]);
  assert.deepEqual(recordReadyFood._meta.securitySchemes, [{ type: 'oauth2', scopes: ['mealprep:write'] }]);
  assert.deepEqual(recordReadyFood.annotations, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false
  });
  assert.equal(recordReadyFood.inputSchema.additionalProperties, false);
  assert.deepEqual(
    new Set(Object.keys(recordReadyFood.inputSchema.properties)),
    new Set(['name', 'servings', 'storage', 'cookedDate', 'recipeId', 'source', 'expectedRevision'])
  );
  assert.deepEqual(recordReadyFood.inputSchema.properties.source.enum, ['leftovers', 'takeout']);
  assert.equal(recordReadyFood.inputSchema.properties.servings.type, 'integer');
  assert.equal(recordReadyFood.inputSchema.properties.servings.minimum, 1);
  assert.equal(recordReadyFood.inputSchema.properties.servings.maximum, 99);

  assert.deepEqual(consumeReadyFood.securitySchemes, [{ type: 'oauth2', scopes: ['mealprep:write'] }]);
  assert.deepEqual(consumeReadyFood._meta.securitySchemes, [{ type: 'oauth2', scopes: ['mealprep:write'] }]);
  assert.deepEqual(consumeReadyFood.annotations, {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false
  });
  assert.equal(consumeReadyFood.inputSchema.additionalProperties, false);
  assert.deepEqual(
    new Set(Object.keys(consumeReadyFood.inputSchema.properties)),
    new Set(['cookedMealId', 'servings', 'expectedRevision'])
  );

  const toolNames = message.result.tools.map((tool) => tool.name).join(' ');
  assert.doesNotMatch(toolNames, /probe_read|probe_write|delete|remove|clear|patch|execute/i);
});

test('get_inventory preserves the canonical revision and stable ingredient ids without mutation', async () => {
  const read = readDeps({
    revision: 17,
    pantry: [{ id: 'pantry-stable-1', name: 'Rice', quantity: 2, unit: 'cups', staple: true, stockLevel: 'ok', storage: 'pantry' }],
    cookedMeals: []
  });
  const response = await routeRequest(mcpRequest(toolCall(3, 'get_inventory')), testEnv(), read.deps, validContext());
  const message = await responseMessage(response);
  assert.deepEqual(message.result.structuredContent, {
    ok: true,
    revision: 17,
    items: [{
      ingredientId: 'pantry-stable-1',
      name: 'Rice',
      quantity: 2,
      unit: 'cups',
      inStock: true,
      staple: true,
      stockLevel: 'ok',
      storage: 'pantry',
      updatedAt: null
    }]
  });
  assert.deepEqual(read.calls, { token: 1, read: 1, write: 0, fetch: 0 });
});

test('get_ready_food preserves the canonical revision and stable cooked-meal ids without mutation', async () => {
  const read = readDeps({
    revision: 18,
    pantry: [],
    cookedMeals: [{ id: 'meal-stable-1', recipeId: 'recipe-1', name: 'Adobo', portionsRemaining: 3, storage: 'fridge', cookedDate: '2026-09-30' }]
  });
  const response = await routeRequest(mcpRequest(toolCall(4, 'get_ready_food')), testEnv(), read.deps, validContext());
  const message = await responseMessage(response);
  assert.deepEqual(message.result.structuredContent, {
    ok: true,
    revision: 18,
    items: [{
      cookedMealId: 'meal-stable-1',
      recipeId: 'recipe-1',
      source: null,
      name: 'Adobo',
      servingsRemaining: 3,
      trackedPortions: true,
      storage: 'fridge',
      cookedDate: '2026-09-30',
      updatedAt: null
    }]
  });
  assert.deepEqual(read.calls, { token: 1, read: 1, write: 0, fetch: 0 });
});

test('read tool schemas reject caller-controlled identity and Firestore targeting fields', async () => {
  for (const field of ['uid', 'owner', 'path', 'collection', 'document', 'TARGET_UID']) {
    const read = readDeps({ revision: 1, pantry: [], cookedMeals: [] });
    const response = await routeRequest(
      mcpRequest(toolCall(5, 'get_inventory', { [field]: 'attacker-value' })),
      testEnv(),
      read.deps,
      validContext()
    );
    const message = await responseMessage(response);
    assert.equal(message.result.isError, true, field);
    assert.match(message.result.content[0].text, /input validation error/i, field);
    assert.deepEqual(read.calls, { token: 0, read: 0, write: 0, fetch: 0 }, field);
  }
});

test('missing, expired, not-yet-valid, wrong-resource, wrong-issuer, missing-scope, and wrong-owner contexts fail before reads', async () => {
  const cases = [
    { name: 'missing', ctx: {} },
    { name: 'expired', ctx: validContext({ auth: { expiresAt: NOW } }) },
    { name: 'not-yet-valid', ctx: validContext({ props: { notBefore: NOW + 1 } }) },
    { name: 'wrong-resource', ctx: validContext({ auth: { audience: 'https://attacker.example/mcp' } }) },
    { name: 'wrong-issuer', ctx: validContext({ props: { issuer: 'https://attacker.example' } }) },
    { name: 'missing-scope', ctx: validContext({ auth: { scope: [] } }) },
    { name: 'write-scope-is-not-a-substitute', ctx: validContext({ auth: { scope: ['mealprep:write'] } }) },
    { name: 'wrong-owner-token', ctx: validContext({ auth: { userId: 'another-owner' } }) },
    { name: 'wrong-owner-props', ctx: validContext({ props: { ownerSubject: 'another-owner' } }) }
  ];

  for (const item of cases) {
    const read = readDeps({ revision: 1, pantry: [], cookedMeals: [] });
    const response = await routeRequest(mcpRequest(toolCall(6, 'get_inventory')), testEnv(), read.deps, item.ctx);
    const message = await responseMessage(response);
    assert.equal(message.result.isError, true, item.name);
    assert.ok(Array.isArray(message.result._meta['mcp/www_authenticate']), item.name);
    assert.match(message.result._meta['mcp/www_authenticate'][0], /resource_metadata=/, item.name);
    if (item.name.includes('scope')) assert.match(message.result._meta['mcp/www_authenticate'][0], /insufficient_scope/, item.name);
    assert.deepEqual(read.calls, { token: 0, read: 0, write: 0, fetch: 0 }, item.name);
    assert.doesNotMatch(JSON.stringify(message), /test-owner-subject|TARGET_UID|BRIDGE_API_TOKEN/, item.name);
  }
});

test('a REST bearer cannot authorize MCP and an OAuth bearer cannot authorize REST', async () => {
  const read = readDeps({ revision: 1, pantry: [], cookedMeals: [] });
  const mcpResponse = await routeRequest(
    mcpRequest(toolCall(7, 'get_inventory'), { authorization: 'Bearer test-bridge-token' }),
    testEnv(),
    read.deps,
    {}
  );
  const mcpMessage = await responseMessage(mcpResponse);
  assert.equal(mcpMessage.result.isError, true);
  assert.deepEqual(read.calls, { token: 0, read: 0, write: 0, fetch: 0 });

  const restResponse = await routeRequest(
    new Request('https://worker.test/v1/inventory', { headers: { Authorization: 'Bearer oauth-test-token' } }),
    testEnv(),
    read.deps
  );
  assert.equal(restResponse.status, 401);
  assert.deepEqual(read.calls, { token: 0, read: 0, write: 0, fetch: 0 });
});

test('malformed JSON, unknown tools, wrong methods, and wrong media types fail safely', async () => {
  const malformed = await routeRequest(mcpRequest('{not json'), testEnv(), { nowSeconds: NOW }, validContext());
  assert.equal(malformed.status, 400);
  assert.doesNotMatch(await malformed.text(), /stack|BRIDGE_API_TOKEN|TARGET_UID|test-owner-subject/i);

  const unknown = await routeRequest(mcpRequest(toolCall(8, 'unknown_tool')), testEnv(), { nowSeconds: NOW }, validContext());
  const unknownMessage = await responseMessage(unknown);
  assert.equal(unknownMessage.error.code, -32602);

  for (const method of ['GET', 'DELETE', 'PUT']) {
    const response = await routeRequest(mcpRequest(undefined, { method, contentType: null }), testEnv(), { nowSeconds: NOW }, validContext());
    assert.equal(response.status, 405, method);
  }
  const wrongType = await routeRequest(
    mcpRequest(rpcRequest(9, 'tools/list'), { contentType: 'text/plain' }),
    testEnv(),
    { nowSeconds: NOW },
    validContext()
  );
  assert.equal(wrongType.status, 415);
});

test('MCP rejects untrusted Host and browser Origin values before protocol handling', async () => {
  const body = JSON.stringify(rpcRequest(10, 'tools/list'));
  const badHost = await routeRequest(new Request(MCP_URL, {
    method: 'POST',
    headers: { Host: 'attacker.example', Accept: 'application/json', 'Content-Type': 'application/json' },
    body
  }), testEnv(), { nowSeconds: NOW }, validContext());
  assert.equal(badHost.status, 403);

  const badOrigin = await routeRequest(new Request(MCP_URL, {
    method: 'POST',
    headers: { Host: 'localhost', Origin: 'https://attacker.example', Accept: 'application/json', 'Content-Type': 'application/json' },
    body
  }), testEnv(), { nowSeconds: NOW }, validContext());
  assert.equal(badOrigin.status, 403);
});

test('exact REST routes remain bearer-gated and near MCP paths fail closed', async () => {
  for (const pathname of ['/v1/inventory', '/v1/ready-food', '/mcp/', '/mcp-evil']) {
    const read = readDeps({ revision: 1, pantry: [], cookedMeals: [] });
    const response = await routeRequest(new Request('https://worker.test' + pathname), testEnv(), read.deps);
    assert.equal(response.status, 401, pathname);
    assert.deepEqual(read.calls, { token: 0, read: 0, write: 0, fetch: 0 }, pathname);
  }
});
