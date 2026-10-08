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
import { AmbiguousError, InsufficientServingsError, InsufficientStockError, NotFoundError, ValidationError } from './errors.js';
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

// A stock delta is not idempotent: replaying it against a fresh revision consumes again.
const CONSUME_STOCK_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false
};

// A stock delta is not idempotent: replaying it against a fresh revision adds stock again.
const ADD_STOCK_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false
};

const MARK_OUT_OF_STOCK_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false
};

const MARK_IN_STOCK_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};

// set_inventory_quantity overwrites an existing quantity, so destructiveHint is true (false would
// mean additive-only updates). idempotentHint is true by the MCP definition: repeated calls with the
// SAME ARGUMENTS add no further effect. expectedRevision is one of the arguments, so an exact
// replay (same revision) is a revision_conflict with zero mutation; a call with the new revision is
// a different call, not a replay.
const SET_QUANTITY_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
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

// Business-field values are deliberately left as z.unknown() rather than typed so malformed
// values fail with recordCookedFood()'s own validation error shape (matching the REST route).
// Servings is the exception: this public schema advertises whole portions, while the operation
// repeats integer validation for non-MCP callers. The object shape itself (exactly these keys,
// no more) is still enforced by strictObject — no UID, path, collection, or document field can
// ever reach the domain function.
function recordReadyFoodInputSchema() {
  return z.strictObject({
    name: z.unknown().optional(),
    servings: z.number().int().min(1).max(99).optional(),
    storage: z.unknown().optional(),
    cookedDate: z.unknown().optional(),
    recipeId: z.unknown().optional(),
    source: z.enum(readyFood.READY_FOOD_SOURCES).optional(),
    expectedRevision: z.unknown().optional()
  });
}

// Typed and required, so the public tool schema truthfully advertises the contract. servings is
// deliberately z.number() and NOT .int(): consumePortions() floors the value first (2.9 consumes
// 2, 99.9 consumes 99) and then rejects a floored value outside 1..99 with its own validation
// error, so the domain stays authoritative for consumption semantics. strictObject guarantees no uid/path/collection/
// operation key can reach the domain function.
function consumeReadyFoodInputSchema() {
  return z.strictObject({
    cookedMealId: z.string().min(1),
    servings: z.number(),
    expectedRevision: z.number().int().nonnegative()
  });
}

function inventoryStockInputSchema() {
  return z.strictObject({
    ingredientId: z.string().min(1),
    expectedRevision: z.number().int().nonnegative()
  });
}

// quantity is typed > 0 so the public schema advertises the contract; the message steers a zero
// ("none left") to mark_out_of_stock. expectedUnit is a precondition asserted against the stored
// unit, never a replacement; there is no `unit` key, so strictObject rejects it.
function setInventoryQuantityInputSchema() {
  return z.strictObject({
    ingredientId: z.string().min(1),
    quantity: z.number().positive('quantity must be a number > 0. For none left, use mark_out_of_stock.'),
    expectedUnit: z.string().min(1),
    expectedRevision: z.number().int().nonnegative()
  });
}

function consumeStockInputSchema() {
  return z.strictObject({
    ingredientId: z.string().min(1).refine((value) => value.trim().length > 0),
    quantity: z.number().finite().positive(),
    expectedUnit: z.string().min(1).refine((value) => value.trim().length > 0),
    expectedRevision: z.number().int().nonnegative()
  });
}

function addStockInputSchema() {
  return z.strictObject({
    ingredientId: z.string().min(1).refine((value) => value.trim().length > 0),
    quantity: z.number().finite().positive(),
    expectedUnit: z.string().min(1).refine((value) => value.trim().length > 0),
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
    source: z.enum(readyFood.READY_FOOD_SOURCES).nullable(),
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
        'never edits, removes, or finishes any existing record. Optional source is leftovers or ' +
        'takeout; either source uses the shared ready-food freshness defaults. Omit source to keep ' +
        'freshness unknown.',
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

  server.registerTool(
    'mark_out_of_stock',
    {
      title: 'Mark inventory item out of stock',
      description: 'Mark one existing pantry item out of stock using ingredientId from ' +
        'get_inventory. Never guess or fuzzy-match an id; if multiple rows match the user\'s ' +
        'words, ask which row. Staples remain as empty; non-staples are permanently removed ' +
        'from ChatGPT. On ambiguous, ask the user to set the staple flag in the app. Requires ' +
        'expectedRevision; on revision_conflict, re-read before deciding whether to retry.',
      inputSchema: inventoryStockInputSchema(),
      outputSchema: z.strictObject({
        ok: z.literal(true),
        revision: z.number().int().nonnegative(),
        item: inventoryItemSchema().nullable(),
        unchanged: z.boolean(),
        removed: z.boolean()
      }),
      _meta: { securitySchemes: WRITE_SECURITY_SCHEMES },
      annotations: MARK_OUT_OF_STOCK_ANNOTATIONS
    },
    async (args) => markOutOfStockTool(env, deps, ctx, args)
  );

  server.registerTool(
    'mark_in_stock',
    {
      title: 'Mark staple inventory item in stock',
      description: 'Mark one existing staple pantry item in stock using ingredientId from ' +
        'get_inventory. Never guess or fuzzy-match an id; if multiple rows match the user\'s ' +
        'words, ask which row. This does not create an item or restore a removed non-staple. ' +
        'Requires expectedRevision; on revision_conflict, re-read before deciding whether to retry.',
      inputSchema: inventoryStockInputSchema(),
      outputSchema: z.strictObject({
        ok: z.literal(true),
        revision: z.number().int().nonnegative(),
        item: inventoryItemSchema(),
        unchanged: z.boolean()
      }),
      _meta: { securitySchemes: WRITE_SECURITY_SCHEMES },
      annotations: MARK_IN_STOCK_ANNOTATIONS
    },
    async (args) => markInStockTool(env, deps, ctx, args)
  );

  server.registerTool(
    'set_inventory_quantity',
    {
      title: 'Set inventory quantity',
      description: 'Set the ABSOLUTE quantity of one existing non-staple pantry item ("I have 7 eggs", ' +
        '"chicken is 650g"). Not for adding, buying, using or consuming: "I bought/used/added N" is ' +
        'NOT supported. Required flow: 1) read get_inventory; 2) identify the stable row; 3) pass the ' +
        'stored unit of the row as expectedUnit (a precondition only: it is never saved, never relabels the ' +
        'row, and must match the stored unit exactly); 4) express quantity in that SAME stored unit; ' +
        '5) call this tool. Stored unit g: "I have 650g chicken" -> quantity=650, expectedUnit="g". ' +
        'Stored unit g: "I have 0.65kg chicken" -> do NOT send quantity=0.65 with expectedUnit="g"; ' +
        'resolve or ask first. The tool never converts units; g vs kg, ml vs L, pieces vs cans are ' +
        'rejected as unit_mismatch. For none left or out of milk, use mark_out_of_stock. Staples are refused (use ' +
        'mark_in_stock / mark_out_of_stock). Take ingredientId ONLY from get_inventory; never guess or ' +
        'fuzzy-match, and ask which row if several match. On ambiguous, ask the user to set the staple ' +
        'flag in the app. Requires expectedRevision; on revision_conflict, re-read before deciding ' +
        'whether to retry.',
      inputSchema: setInventoryQuantityInputSchema(),
      outputSchema: z.strictObject({
        ok: z.literal(true),
        revision: z.number().int().nonnegative(),
        item: inventoryItemSchema()
      }),
      _meta: { securitySchemes: WRITE_SECURITY_SCHEMES },
      annotations: SET_QUANTITY_ANNOTATIONS
    },
    async (args) => setInventoryQuantityTool(env, deps, ctx, args)
  );

  server.registerTool(
    'consume_stock',
    {
      title: 'Consume pantry stock',
      description: 'Consume a quantity from one existing pantry row using ingredientId ONLY from ' +
        'get_inventory; never guess or fuzzy-match, and ask which row if several match. Submit the ' +
        'amount the user used and its stated unit as expectedUnit; only exact same-unit arithmetic ' +
        'and g/kg or ml/L metric scaling are supported. Do not infer cups, density, pieces-to-mass, ' +
        'or can/package conversions. Partial consumption is for explicitly non-staple rows; a staple ' +
        'can only be marked empty when its exact current amount is consumed. If the user says “all”, ' +
        'first read the current quantity, unit, and revision, then submit that exact amount against ' +
        'that revision. On insufficient_stock, unit mismatch, or ambiguous, stop and clarify. This is ' +
        'a delta and is NOT safe to replay with a fresh revision; on revision_conflict, re-read before ' +
        'deciding whether to retry.',
      inputSchema: consumeStockInputSchema(),
      outputSchema: z.strictObject({
        ok: z.literal(true),
        revision: z.number().int().nonnegative(),
        item: inventoryItemSchema().nullable(),
        removed: z.boolean()
      }),
      _meta: { securitySchemes: WRITE_SECURITY_SCHEMES },
      annotations: CONSUME_STOCK_ANNOTATIONS
    },
    async (args) => consumeStockTool(env, deps, ctx, args)
  );

  server.registerTool(
    'add_stock',
    {
      title: 'Add pantry stock',
      description: 'Add an exact purchased quantity to one existing pantry row using ingredientId ' +
        'ONLY from get_inventory; never guess or fuzzy-match, and ask which row if several match. ' +
        'State the exact amount and unit the user bought. The Worker adds this delta to the live ' +
        'stored quantity; do not calculate or submit an absolute total. Only exact same-unit arithmetic ' +
        'and g/kg or ml/L metric scaling are supported. Do not infer cups, density, pieces-to-mass, ' +
        'or can/package conversions. Printed-expiry lots, expired or date-ambiguous rows, stock-level-only ' +
        'staples, and removed/tombstoned items must be handled in the app; use mark_in_stock for a ' +
        'stock-level-only staple. This delta is NOT safe to replay with a fresh revision; on ' +
        'revision_conflict, re-read before deciding whether to retry.',
      inputSchema: addStockInputSchema(),
      outputSchema: z.strictObject({
        ok: z.literal(true),
        revision: z.number().int().nonnegative(),
        item: inventoryItemSchema()
      }),
      _meta: { securitySchemes: WRITE_SECURITY_SCHEMES },
      annotations: ADD_STOCK_ANNOTATIONS
    },
    async (args) => addStockTool(env, deps, ctx, args)
  );

  return server;
}

// Same adapter shape as the stock-state tools: auth -> read -> compare expectedRevision (no retry)
// -> canonical wrapper -> ONE guarded pantry write -> sanitized result.
async function setInventoryQuantityTool(env, deps, ctx, args) {
  try {
    requireMcpWriteContext(env, ctx, deps.nowSeconds);
    const fetchImpl = deps.fetchImpl || fetch;
    const cryptoImpl = deps.cryptoImpl || globalThis.crypto;
    const getToken = deps.getFirestoreAccessToken || getFirestoreAccessToken;
    const readDoc = deps.getUserDocument || getUserDocument;
    const writeDoc = deps.patchUserDocument || patchUserDocument;

    const accessToken = await getToken(env, { fetchImpl, cryptoImpl });
    const doc = await readDoc(env, accessToken, fetchImpl);
    if (args.expectedRevision !== doc.revision) throw new RevisionConflictError(doc);

    const r = inventory.setCountedQuantity(doc.pantry, {
      ingredientId: args.ingredientId,
      quantity: args.quantity,
      expectedUnit: args.expectedUnit
    });
    const written = await writeDoc(env, accessToken, {
      fieldPaths: ['pantry'],
      fields: { pantry: r.pantry },
      expectedUpdateTime: doc.updateTime,
      nextVersion: doc.revision + 1
    }, fetchImpl);

    return toolResult({ ok: true, revision: written.revision, item: r.item });
  } catch (error) {
    return inventoryStockError(error, 'The inventory quantity could not be set.');
  }
}

// Apply exactly one delta against the observed revision, then make one guarded write. Exact-zero
// deletion and staple-empty semantics come from the canonical inventory operation.
async function consumeStockTool(env, deps, ctx, args) {
  try {
    requireMcpWriteContext(env, ctx, deps.nowSeconds);
    const fetchImpl = deps.fetchImpl || fetch;
    const cryptoImpl = deps.cryptoImpl || globalThis.crypto;
    const getToken = deps.getFirestoreAccessToken || getFirestoreAccessToken;
    const readDoc = deps.getUserDocument || getUserDocument;
    const writeDoc = deps.patchUserDocument || patchUserDocument;

    const accessToken = await getToken(env, { fetchImpl, cryptoImpl });
    const doc = await readDoc(env, accessToken, fetchImpl);
    if (args.expectedRevision !== doc.revision) throw new RevisionConflictError(doc);

    const r = inventory.consumeStock(doc.pantry, doc.deletions.pantry || {}, {
      ingredientId: args.ingredientId,
      quantity: args.quantity,
      expectedUnit: args.expectedUnit
    });
    const write = r.removed
      ? { fieldPaths: ['pantry', 'deletions.pantry'], fields: { pantry: r.pantry, deletions: { pantry: r.deletionsPantry } } }
      : { fieldPaths: ['pantry'], fields: { pantry: r.pantry } };
    const written = await writeDoc(env, accessToken, Object.assign(write, {
      expectedUpdateTime: doc.updateTime,
      nextVersion: doc.revision + 1
    }), fetchImpl);

    return toolResult({ ok: true, revision: written.revision, item: r.item, removed: r.removed });
  } catch (error) {
    return inventoryStockError(error, 'The inventory stock could not be consumed.');
  }
}

// Apply exactly one purchase delta to the observed existing row, then make one guarded pantry write.
async function addStockTool(env, deps, ctx, args) {
  try {
    requireMcpWriteContext(env, ctx, deps.nowSeconds);
    const fetchImpl = deps.fetchImpl || fetch;
    const cryptoImpl = deps.cryptoImpl || globalThis.crypto;
    const getToken = deps.getFirestoreAccessToken || getFirestoreAccessToken;
    const readDoc = deps.getUserDocument || getUserDocument;
    const writeDoc = deps.patchUserDocument || patchUserDocument;

    const accessToken = await getToken(env, { fetchImpl, cryptoImpl });
    const doc = await readDoc(env, accessToken, fetchImpl);
    if (args.expectedRevision !== doc.revision) throw new RevisionConflictError(doc);

    const r = inventory.addStock(doc.pantry, doc.deletions.pantry || {}, {
      ingredientId: args.ingredientId,
      quantity: args.quantity,
      expectedUnit: args.expectedUnit
    });
    const written = await writeDoc(env, accessToken, {
      fieldPaths: ['pantry'],
      fields: { pantry: r.pantry },
      expectedUpdateTime: doc.updateTime,
      nextVersion: doc.revision + 1
    }, fetchImpl);

    return toolResult({ ok: true, revision: written.revision, item: r.item });
  } catch (error) {
    return inventoryStockError(error, 'The inventory stock could not be increased.');
  }
}

async function markOutOfStockTool(env, deps, ctx, args) {
  try {
    requireMcpWriteContext(env, ctx, deps.nowSeconds);
    const fetchImpl = deps.fetchImpl || fetch;
    const cryptoImpl = deps.cryptoImpl || globalThis.crypto;
    const getToken = deps.getFirestoreAccessToken || getFirestoreAccessToken;
    const readDoc = deps.getUserDocument || getUserDocument;
    const writeDoc = deps.patchUserDocument || patchUserDocument;

    const accessToken = await getToken(env, { fetchImpl, cryptoImpl });
    const doc = await readDoc(env, accessToken, fetchImpl);
    if (args.expectedRevision !== doc.revision) throw new RevisionConflictError(doc);

    const r = inventory.markOutOfStock(doc.pantry, doc.deletions.pantry || {}, {
      ingredientId: args.ingredientId
    });
    if (r.unchanged) {
      return toolResult({ ok: true, revision: doc.revision, item: r.item, unchanged: true, removed: r.removed });
    }

    const write = r.removed
      ? { fieldPaths: ['pantry', 'deletions.pantry'], fields: { pantry: r.pantry, deletions: { pantry: r.deletionsPantry } } }
      : { fieldPaths: ['pantry'], fields: { pantry: r.pantry } };
    const written = await writeDoc(env, accessToken, Object.assign(write, {
      expectedUpdateTime: doc.updateTime,
      nextVersion: doc.revision + 1
    }), fetchImpl);

    return toolResult({
      ok: true,
      revision: written.revision,
      item: r.item,
      unchanged: false,
      removed: r.removed
    });
  } catch (error) {
    return inventoryStockError(error, 'The inventory item could not be marked out of stock.');
  }
}

async function markInStockTool(env, deps, ctx, args) {
  try {
    requireMcpWriteContext(env, ctx, deps.nowSeconds);
    const fetchImpl = deps.fetchImpl || fetch;
    const cryptoImpl = deps.cryptoImpl || globalThis.crypto;
    const getToken = deps.getFirestoreAccessToken || getFirestoreAccessToken;
    const readDoc = deps.getUserDocument || getUserDocument;
    const writeDoc = deps.patchUserDocument || patchUserDocument;

    const accessToken = await getToken(env, { fetchImpl, cryptoImpl });
    const doc = await readDoc(env, accessToken, fetchImpl);
    if (args.expectedRevision !== doc.revision) throw new RevisionConflictError(doc);

    const r = inventory.markInStock(doc.pantry, { ingredientId: args.ingredientId });
    if (r.unchanged) {
      return toolResult({ ok: true, revision: doc.revision, item: r.item, unchanged: true });
    }

    const written = await writeDoc(env, accessToken, {
      fieldPaths: ['pantry'],
      fields: { pantry: r.pantry },
      expectedUpdateTime: doc.updateTime,
      nextVersion: doc.revision + 1
    }, fetchImpl);

    return toolResult({ ok: true, revision: written.revision, item: r.item, unchanged: false });
  } catch (error) {
    return inventoryStockError(error, 'The inventory item could not be marked in stock.');
  }
}

function inventoryStockError(error, fallback) {
  if (error instanceof McpAuthError) return mcpAuthChallenge(error, MCP_WRITE_SCOPE);
  if (error instanceof RevisionConflictError) {
    return { content: [{ type: 'text', text: 'revision_conflict: ' + error.message }], isError: true };
  }
  if (error instanceof AmbiguousError) {
    return { content: [{ type: 'text', text: 'ambiguous: ' + error.message }], isError: true };
  }
  if (error instanceof NotFoundError) {
    return { content: [{ type: 'text', text: 'not_found: ' + error.message }], isError: true };
  }
  if (error instanceof InsufficientStockError) {
    return { content: [{ type: 'text', text: 'insufficient_stock: ' + error.message }], isError: true };
  }
  if (error instanceof ValidationError) {
    return { content: [{ type: 'text', text: error.message }], isError: true };
  }
  return { content: [{ type: 'text', text: fallback }], isError: true };
}

// Mirrors index.js's POST /v1/ready-food/consume flow: auth (input shape was already enforced by
// consumeReadyFoodInputSchema()) -> read -> compare expectedRevision (no retry, no re-read) ->
// readyFood.consumeReadyFood() (the canonical op shared with REST, TASK-071) -> ONE guarded write
// of cookedMeals + mealConsumptions (+ tombstone), same field-path spec as REST.
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

    // Project only the two business fields the canonical operation destructures.
    const r = readyFood.consumeReadyFood(
      { cookedMeals: doc.cookedMeals, deletionsCookedMeals: doc.deletions.cookedMeals || {}, mealConsumptions: doc.mealConsumptions },
      { cookedMealId: args.cookedMealId, servings: args.servings }
    );
    const write = readyFood.consumeWriteSpec(r);
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
      recipeId: args.recipeId,
      source: args.source
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
  consume_ready_food: WRITE_SECURITY_SCHEMES,
  mark_out_of_stock: WRITE_SECURITY_SCHEMES,
  mark_in_stock: WRITE_SECURITY_SCHEMES,
  set_inventory_quantity: WRITE_SECURITY_SCHEMES,
  consume_stock: WRITE_SECURITY_SCHEMES,
  add_stock: WRITE_SECURITY_SCHEMES
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
