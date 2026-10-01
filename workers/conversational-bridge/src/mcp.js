import {
  McpServer,
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  originValidationResponse
} from '@modelcontextprotocol/server';
import { z } from 'zod';
import { getFirestoreAccessToken } from './auth.js';
import { getUserDocument } from './firestore.js';
import * as inventory from './operations/inventory.js';
import * as readyFood from './operations/readyFood.js';
import { MCP_SCOPE, McpAuthError, mcpAuthChallenge, requireMcpReadContext } from './mcpAuth.js';

const MAX_MCP_BODY_BYTES = 8 * 1024;
const PRODUCTION_HOSTNAME = 'meal-prep-conversational-bridge.shinyamadasan.workers.dev';
const ALLOWED_HOSTNAMES = localhostAllowedHostnames().concat(PRODUCTION_HOSTNAME);
const ALLOWED_ORIGIN_HOSTNAMES = localhostAllowedOrigins().concat(PRODUCTION_HOSTNAME);

const READ_SECURITY_SCHEMES = [{ type: 'oauth2', scopes: [MCP_SCOPE] }];
const READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false
};

function toolResult(data) {
  return {
    structuredContent: data,
    content: [{ type: 'text', text: JSON.stringify(data) }]
  };
}

function inventoryItemSchema() {
  return z.strictObject({
    ingredientId: z.string(),
    name: z.string().nullable(),
    quantity: z.number().nullable(),
    unit: z.string().nullable(),
    inStock: z.boolean(),
    staple: z.boolean(),
    stockLevel: z.enum(['full', 'ok', 'low', 'empty']).nullable(),
    storage: z.string().nullable(),
    updatedAt: z.string().nullable()
  });
}

function readyFoodItemSchema() {
  return z.strictObject({
    cookedMealId: z.string(),
    recipeId: z.string().nullable(),
    name: z.string().nullable(),
    servingsRemaining: z.number().int().nullable(),
    trackedPortions: z.boolean(),
    storage: z.enum(['fridge', 'freezer']),
    cookedDate: z.string().nullable(),
    updatedAt: z.string().nullable()
  });
}

export function createReadServer(env = {}, deps = {}, ctx = {}) {
  const server = new McpServer({
    name: 'meal-prep-private-reads',
    version: '1.0.0'
  });

  server.registerTool(
    'get_inventory',
    {
      title: 'Get inventory',
      description: 'Read the owner\'s current canonical pantry inventory.',
      inputSchema: z.strictObject({}),
      outputSchema: z.strictObject({
        ok: z.literal(true),
        revision: z.number().int().nonnegative(),
        items: z.array(inventoryItemSchema())
      }),
      _meta: { securitySchemes: READ_SECURITY_SCHEMES },
      annotations: READ_ANNOTATIONS
    },
    async () => readTool(env, deps, ctx, (doc) => ({
      ok: true,
      revision: doc.revision,
      items: inventory.listInventory(doc.pantry)
    }))
  );

  server.registerTool(
    'get_ready_food',
    {
      title: 'Get ready food',
      description: 'Read the owner\'s current canonical ready-to-eat food.',
      inputSchema: z.strictObject({}),
      outputSchema: z.strictObject({
        ok: z.literal(true),
        revision: z.number().int().nonnegative(),
        items: z.array(readyFoodItemSchema())
      }),
      _meta: { securitySchemes: READ_SECURITY_SCHEMES },
      annotations: READ_ANNOTATIONS
    },
    async () => readTool(env, deps, ctx, (doc) => ({
      ok: true,
      revision: doc.revision,
      items: readyFood.listReadyFood(doc.cookedMeals)
    }))
  );

  return server;
}

async function readTool(env, deps, ctx, selectResult) {
  try {
    requireMcpReadContext(env, ctx, deps.nowSeconds);
    const fetchImpl = deps.fetchImpl || fetch;
    const cryptoImpl = deps.cryptoImpl || globalThis.crypto;
    const getToken = deps.getFirestoreAccessToken || getFirestoreAccessToken;
    const readDoc = deps.getUserDocument || getUserDocument;
    const accessToken = await getToken(env, { fetchImpl, cryptoImpl });
    const doc = await readDoc(env, accessToken, fetchImpl);
    return toolResult(selectResult(doc));
  } catch (error) {
    if (error instanceof McpAuthError) return mcpAuthChallenge(error);
    return {
      content: [{ type: 'text', text: 'The meal-prep data could not be read.' }],
      isError: true
    };
  }
}

export async function handleMcpRequest(request, env = {}, deps = {}, ctx = {}) {
  const rejected = validateMcpRequestOrigin(request);
  if (rejected) return rejected;
  const handler = createMcpHandler(() => createReadServer(env, deps, ctx), {
    legacy: 'stateless',
    maxRequestBodySize: MAX_MCP_BODY_BYTES
  });
  const response = await handler.fetch(request);
  return addToolSecuritySchemes(response);
}

async function addToolSecuritySchemes(response) {
  // @modelcontextprotocol/server 2.2 emits the compatibility mirror in `_meta` but its standard
  // Tool schema drops OpenAI's top-level extension. Decorate only tools/list wire responses so
  // ChatGPT receives both forms without replacing the reviewed MCP transport.
  const contentType = response.headers.get('Content-Type') || '';
  if (!/application\/json|text\/event-stream/i.test(contentType)) return response;

  const original = await response.clone().text();
  let changed = false;
  const decorate = (message) => {
    const tools = message && message.result && message.result.tools;
    if (!Array.isArray(tools)) return message;
    for (const tool of tools) {
      if (tool && (tool.name === 'get_inventory' || tool.name === 'get_ready_food')) {
        tool.securitySchemes = READ_SECURITY_SCHEMES;
        changed = true;
      }
    }
    return message;
  };

  let body = original;
  try {
    if (/text\/event-stream/i.test(contentType)) {
      body = original.split(/(\r?\n)/).map((line) => {
        if (!line.startsWith('data: ')) return line;
        return 'data: ' + JSON.stringify(decorate(JSON.parse(line.slice(6))));
      }).join('');
    } else {
      body = JSON.stringify(decorate(JSON.parse(original)));
    }
  } catch (error) {
    return response;
  }
  if (!changed) return response;

  const headers = new Headers(response.headers);
  headers.delete('Content-Length');
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export function validateMcpRequestOrigin(request) {
  return hostHeaderValidationResponse(request, ALLOWED_HOSTNAMES) ||
    originValidationResponse(request, ALLOWED_ORIGIN_HOSTNAMES);
}
