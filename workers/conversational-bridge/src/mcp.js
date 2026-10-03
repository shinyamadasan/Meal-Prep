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
import { getUserDocument, patchUserDocument, RevisionConflictError } from './firestore.js';
import { InsufficientServingsError, NotFoundError, ValidationError } from './errors.js';
import * as inventory from './operations/inventory.js';
import * as readyFood from './operations/readyFood.js';
import {
  MCP_SCOPE,
  MCP_WRITE_SCOPE,
  McpAuthError,
  mcpAuthChallenge,
  requireMcpReadContext,
  requireMcpWriteContext
} from './mcpAuth.js';

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

const WRITE_SECURITY_SCHEMES = [{ type: 'oauth2', scopes: [MCP_WRITE_SCOPE] }];
// idempotentHint is deliberately false: recordCookedFood() mints a fresh random cookedMealId on
// every call, so two calls made with two different (sequentially valid) expectedRevision values
// create two distinct records. Conflict-safety under expectedRevision is not idempotence.
const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
};

// consume_ready_food has its own annotations: consuming the final serving removes the record and
// writes a deletion tombstone, so destructiveHint is true (the tool's worst case). idempotentHint
// is false: replaying with a freshly re-read revision consumes AGAIN. A replay with the SAME
// revision is safe only because the first success advanced it (revision_conflict) — conflict-safety
// is not idempotence, and transport/model replay of this tool is unsafe.
const CONSUME_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
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

// Business-field values are deliberately left as z.unknown() rather than typed: a malformed
// name/servings/storage/cookedDate must fail with recordCookedFood()'s own validation error
// shape (matching the REST route), not a generic schema error. The object shape itself (exactly
// these keys, no more) is still enforced by strictObject — no UID, path, collection, or document
// field can ever reach the domain function.
function recordReadyFoodInputSchema() {
  return z.strictObject({
    name: z.unknown().optional(),
    servings: z.unknown().optional(),
    storage: z.unknown().optional(),
    cookedDate: z.unknown().optional(),
    recipeId: z.unknown().optional(),
    expectedRevision: z.unknown().optional()
  });
}

// Typed and required, so the public tool schema truthfully advertises the contract. servings is
// deliberately z.number() and NOT .int(): consumePortions() floors fractional values >= 1 (2.9
// consumes 2) and rejects values outside 1..99 with its own validation error, so the domain stays
// authoritative for consumption semantics. strictObject guarantees no uid/path/collection/
// operation key can reach the domain function.
function consumeReadyFoodInputSchema() {
  return z.strictObject({
    cookedMealId: z.string().min(1),
    servings: z.number(),
    expectedRevision: z.number().int().nonnegative()
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

  server.registerTool(
    'record_ready_food',
    {
      title: 'Record ready food',
      description: 'Create exactly one new ready-to-eat (cooked) food record. Append-only: ' +
        'never edits, removes, or finishes any existing record.',
      inputSchema: recordReadyFoodInputSchema(),
      outputSchema: z.strictObject({
        ok: z.literal(true),
        revision: z.number().int().nonnegative(),
        item: readyFoodItemSchema()
      }),
      _meta: { securitySchemes: WRITE_SECURITY_SCHEMES },
      annotations: WRITE_ANNOTATIONS
    },
    async (args) => recordReadyFoodTool(env, deps, ctx, args)
  );

  server.registerTool(
    'consume_ready_food',
    {
      title: 'Consume ready food',
      description: 'Consume N servings from one existing ready-to-eat record, identified by ' +
        'cookedMealId (from get_ready_food). Consuming the final serving permanently removes the ' +
        'record. NOT safe to replay: calling again with a freshly read revision consumes again. ' +
        'Requires expectedRevision; on revision_conflict, re-read before deciding whether to retry.',
      inputSchema: consumeReadyFoodInputSchema(),
      outputSchema: z.strictObject({
        ok: z.literal(true),
        revision: z.number().int().nonnegative(),
        item: readyFoodItemSchema().nullable(),
        removed: z.boolean()
      }),
      _meta: { securitySchemes: WRITE_SECURITY_SCHEMES },
      annotations: CONSUME_ANNOTATIONS
    },
    async (args) => consumeReadyFoodTool(env, deps, ctx, args)
  );

  return server;
}

// Mirrors index.js's POST /v1/ready-food/consume flow: auth (input shape was already enforced by
// consumeReadyFoodInputSchema()) -> read -> compare expectedRevision (no retry, no re-read) ->
// consumePortions() (unchanged domain function) -> write with the same fieldPaths split as REST.
async function consumeReadyFoodTool(env, deps, ctx, args) {
  try {
    requireMcpWriteContext(env, ctx, deps.nowSeconds);
    const fetchImpl = deps.fetchImpl || fetch;
    const cryptoImpl = deps.cryptoImpl || globalThis.crypto;
    const getToken = deps.getFirestoreAccessToken || getFirestoreAccessToken;
    const readDoc = deps.getUserDocument || getUserDocument;
    const writeDoc = deps.patchUserDocument || patchUserDocument;

    const accessToken = await getToken(env, { fetchImpl, cryptoImpl });
    const doc = await readDoc(env, accessToken, fetchImpl);

    if (args.expectedRevision !== doc.revision) {
      throw new RevisionConflictError(doc);
    }

    // Project only the two business fields consumePortions() destructures.
    const r = readyFood.consumePortions(doc.cookedMeals, doc.deletions.cookedMeals || {}, {
      cookedMealId: args.cookedMealId,
      servings: args.servings
    });
    const write = r.removed
      ? { fieldPaths: ['cookedMeals', 'deletions.cookedMeals'], fields: { cookedMeals: r.cookedMeals, deletions: { cookedMeals: r.deletionsCookedMeals } } }
      : { fieldPaths: ['cookedMeals'], fields: { cookedMeals: r.cookedMeals } };
    const written = await writeDoc(env, accessToken, Object.assign(write, {
      expectedUpdateTime: doc.updateTime,
      nextVersion: doc.revision + 1
    }), fetchImpl);

    return toolResult({
      ok: true,
      revision: written.revision,
      item: r.item,
      removed: r.removed
    });
  } catch (error) {
    if (error instanceof McpAuthError) return mcpAuthChallenge(error, MCP_WRITE_SCOPE);
    if (error instanceof RevisionConflictError) {
      return { content: [{ type: 'text', text: 'revision_conflict: ' + error.message }], isError: true };
    }
    if (error instanceof InsufficientServingsError) {
      return { content: [{ type: 'text', text: 'insufficient_servings: ' + error.message + ' (remaining: ' + error.detail.remaining + ')' }], isError: true };
    }
    if (error instanceof NotFoundError) {
      return { content: [{ type: 'text', text: 'not_found: ' + error.message }], isError: true };
    }
    if (error instanceof ValidationError) {
      return { content: [{ type: 'text', text: error.message }], isError: true };
    }
    return { content: [{ type: 'text', text: 'The ready-food record could not be consumed.' }], isError: true };
  }
}

// Mirrors index.js's POST /v1/ready-food/record flow exactly: auth -> expectedRevision shape ->
// read -> compare expectedRevision -> recordCookedFood() (the one, already-reviewed
// validation+record-shape function) -> write. No persistence or business validation is
// reimplemented here (D-082 decision 7 / TASK-069).
async function recordReadyFoodTool(env, deps, ctx, args) {
  try {
    requireMcpWriteContext(env, ctx, deps.nowSeconds);
    requireValidExpectedRevision(args ? args.expectedRevision : undefined);

    const fetchImpl = deps.fetchImpl || fetch;
    const cryptoImpl = deps.cryptoImpl || globalThis.crypto;
    const getToken = deps.getFirestoreAccessToken || getFirestoreAccessToken;
    const readDoc = deps.getUserDocument || getUserDocument;
    const writeDoc = deps.patchUserDocument || patchUserDocument;

    const accessToken = await getToken(env, { fetchImpl, cryptoImpl });
    const doc = await readDoc(env, accessToken, fetchImpl);

    if (args.expectedRevision !== doc.revision) {
      throw new RevisionConflictError(doc);
    }

    // Project only the canonical business fields recordCookedFood() actually destructures —
    // expectedRevision (already validated above, not a business field) must never reach it.
    const r = readyFood.recordCookedFood({
      name: args.name,
      servings: args.servings,
      storage: args.storage,
      cookedDate: args.cookedDate,
      recipeId: args.recipeId
    });
    const nextMeals = (doc.cookedMeals || []).concat([r.record]);
    const written = await writeDoc(env, accessToken, {
      fieldPaths: ['cookedMeals'],
      fields: { cookedMeals: nextMeals },
      expectedUpdateTime: doc.updateTime,
      nextVersion: doc.revision + 1
    }, fetchImpl);

    return toolResult({ ok: true, revision: written.revision, item: r.item });
  } catch (error) {
    if (error instanceof McpAuthError) return mcpAuthChallenge(error, MCP_WRITE_SCOPE);
    if (error instanceof RevisionConflictError) {
      return { content: [{ type: 'text', text: 'revision_conflict: ' + error.message }], isError: true };
    }
    if (error instanceof ValidationError) {
      return { content: [{ type: 'text', text: error.message }], isError: true };
    }
    return { content: [{ type: 'text', text: 'The ready-food record could not be created.' }], isError: true };
  }
}

// Mirrors index.js's validateBody() expectedRevision shape check exactly (same message, code,
// and field) so MCP and REST reject a missing/malformed expectedRevision identically, before any
// Firestore read.
function requireValidExpectedRevision(value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new ValidationError('expectedRevision must be a non-negative integer.', { field: 'expectedRevision' });
  }
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

const TOOL_SECURITY_SCHEMES = {
  get_inventory: READ_SECURITY_SCHEMES,
  get_ready_food: READ_SECURITY_SCHEMES,
  record_ready_food: WRITE_SECURITY_SCHEMES,
  consume_ready_food: WRITE_SECURITY_SCHEMES
};

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
      const schemes = tool && TOOL_SECURITY_SCHEMES[tool.name];
      if (schemes) {
        tool.securitySchemes = schemes;
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
