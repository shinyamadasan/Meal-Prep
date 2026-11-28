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
import { commitRequestWrite, getRequestDocument, getRequestRecord, getUserDocument, RequestAlreadyRecordedError, RevisionConflictError } from './firestore.js';
import { AmbiguousError, InsufficientServingsError, InsufficientStockError, NotFoundError, ValidationError } from './errors.js';
import * as inventory from './operations/inventory.js';
import * as pantryItems from './operations/pantryItems.js';
import * as readyFood from './operations/readyFood.js';
import * as requests from './operations/requests.js';
import { householdDayFromEnv } from './householdDay.js';
import '../../../shared/foodSafety.js';
import {
  MCP_SCOPE,
  MCP_WRITE_SCOPE,
  McpAuthError,
  mcpAuthChallenge,
  requireMcpReadContext,
  requireMcpWriteContext
} from './mcpAuth.js';

const MAX_MCP_BODY_BYTES = 8 * 1024;
// The app's cooked-leftover fridge limit, from the shared rules (loaded by the operations imports).
const COOKED_FRIDGE_LIMIT = globalThis.MealPrepFoodSafety.COOKED_FRIDGE_LIMIT;
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

// add_pantry_item (TASK-099) creates one new lot with a fresh id on every applied call, so it is not
// idempotent across different requestIds; it never removes or overwrites anything.
const ADD_PANTRY_ITEM_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
};

// update_pantry_item (TASK-099) overwrites storage and dates (destructive); the same arguments give
// the same record, so repeating it adds no further effect.
const UPDATE_PANTRY_ITEM_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false
};

// undo_request (TASK-095) can remove a ready-food batch and overwrites values, so destructiveHint is
// true. idempotentHint is true: repeating the same call (same undoRequestId) replays the stored
// result, and any other undo of the same request is refused as already_undone.
const UNDO_ANNOTATIONS = {
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

// TASK-093: required on every write tool. Same rule as operations/requests.js validateRequestId(),
// which the adapter repeats before any Firestore access.
function requestIdSchema() {
  return z.string().regex(requests.REQUEST_ID_PATTERN, requests.REQUEST_ID_MESSAGE);
}

// Present (true) only when a retried request returns its stored result instead of writing again.
const REPLAYED_SCHEMA = z.boolean().optional();

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
    requestId: requestIdSchema(),
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
    requestId: requestIdSchema(),
    expectedRevision: z.number().int().nonnegative()
  });
}

function inventoryStockInputSchema() {
  return z.strictObject({
    ingredientId: z.string().min(1),
    requestId: requestIdSchema(),
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
    requestId: requestIdSchema(),
    expectedRevision: z.number().int().nonnegative()
  });
}

function consumeStockInputSchema() {
  return z.strictObject({
    ingredientId: z.string().min(1).refine((value) => value.trim().length > 0),
    quantity: z.number().finite().positive(),
    expectedUnit: z.string().min(1).refine((value) => value.trim().length > 0),
    requestId: requestIdSchema(),
    expectedRevision: z.number().int().nonnegative()
  });
}

function addStockInputSchema() {
  return z.strictObject({
    ingredientId: z.string().min(1).refine((value) => value.trim().length > 0),
    quantity: z.number().finite().positive(),
    expectedUnit: z.string().min(1).refine((value) => value.trim().length > 0),
    // TASK-094: the day the NEW stock was bought (household calendar). Required by the Worker for a
    // fridge safety lot; a business argument, so it is part of the request's argsHash.
    boughtDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    requestId: requestIdSchema(),
    expectedRevision: z.number().int().nonnegative()
  });
}

// TASK-099: add_pantry_item / update_pantry_item. Shapes are typed for the public schema; the
// operation repeats every rule (operations/pantryItems.js) before and after the read.
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

function addPantryItemInputSchema() {
  return z.strictObject({
    name: z.string().min(1).max(pantryItems.MAX_NAME_LENGTH).refine((value) => value.trim().length > 0),
    quantity: z.number().finite().positive().optional(),
    unit: z.string().min(1).max(pantryItems.MAX_UNIT_LENGTH).refine((value) => value.trim().length > 0).optional(),
    storage: z.enum(pantryItems.PANTRY_STORAGE).optional(),
    boughtDate: z.string().regex(CALENDAR_DAY).optional(),
    printedDate: z.string().regex(CALENDAR_DAY).optional(),
    printedDateKind: z.enum(pantryItems.PRINTED_DATE_KINDS).optional(),
    staple: z.boolean().optional(),
    level: z.enum(pantryItems.STOCK_LEVELS).optional(),
    prepared: z.boolean().optional(),
    confirmNewLot: z.boolean().optional(),
    requestId: requestIdSchema(),
    expectedRevision: z.number().int().nonnegative()
  });
}

function updatePantryItemInputSchema() {
  return z.strictObject({
    ingredientId: z.string().min(1).refine((value) => value.trim().length > 0),
    storage: z.enum(pantryItems.PANTRY_STORAGE).optional(),
    boughtDate: z.string().regex(CALENDAR_DAY).optional(),
    printedDate: z.string().regex(CALENDAR_DAY).nullable().optional(),
    printedDateKind: z.enum(pantryItems.PRINTED_DATE_KINDS).optional(),
    thawedToday: z.literal(true).optional(),
    requestId: requestIdSchema(),
    expectedRevision: z.number().int().nonnegative()
  });
}

// TASK-095: requestId names the request to undo; undoRequestId is this undo's own id.
function undoRequestInputSchema() {
  return z.strictObject({
    requestId: requestIdSchema(),
    undoRequestId: requestIdSchema(),
    expectedRevision: z.number().int().nonnegative()
  });
}

function undoRecordRefSchema() {
  return z.strictObject({
    collection: z.enum(['pantry', 'cookedMeals']),
    id: z.string()
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

// TASK-092 (D-091): the safety verdict on every get_inventory / get_ready_food item.
function safetySchema() {
  return z.strictObject({
    status: z.enum(['ok', 'use-soon', 'check', 'expired', 'unknown']),
    reason: z.string(),
    label: z.string(),
    daysLeft: z.number().int().nullable(),
    usable: z.boolean()
  });
}

// get_inventory's item: the write-result item plus stored dates/category and the safety verdict.
// Write tools keep inventoryItemSchema() / readyFoodItemSchema() unchanged.
function inventoryReadItemSchema() {
  return inventoryItemSchema().extend({
    // TASK-097: how the lot is tracked; null only for an invalid-record lot (never guessed).
    tracking: z.enum(['level', 'quantity', 'presence']).nullable(),
    category: z.string().nullable(),
    purchaseDate: z.string().nullable(),
    expiryDate: z.string().nullable(),
    dateMode: z.string().nullable(),
    printedDateKind: z.string().nullable(),
    safety: safetySchema()
  });
}

// TASK-099: the pantry-item tools state back the get_inventory item plus the stored shelf life.
function pantryItemReadBackSchema() {
  return inventoryReadItemSchema().extend({ shelfLifeDays: z.number().nullable() });
}

function readyFoodReadItemSchema() {
  return readyFoodItemSchema().extend({ safety: safetySchema() });
}

// Shared by both read tools so chat gets one rule.
const SAFETY_RULES_TEXT = 'Every item carries safety {status, reason, label, daysLeft, usable}, ' +
  'computed with the app\'s own food-safety rules for the household\'s calendar day. NEVER suggest, ' +
  'plan with, or describe as available any item with usable:false. status "unknown" means safety ' +
  'information is missing or unreadable (for example no storage location, a ready-food batch with ' +
  'no valid cooked date, or a record the app must fix): it is NOT usable; ' +
  'tell the user to check it in the app. status "check" means the user must look at it before ' +
  'using it; say so whenever you mention it. status "expired" is never usable. Give the label as ' +
  'the reason; daysLeft is whole days left on the household calendar. A pantry item labelled "No ' +
  'date recorded" has no freshness information; say so when you suggest it. safety.usable is the ' +
  'only availability signal: inStock, staple and servingsRemaining are bookkeeping fields and never ' +
  'override it.';

// TASK-097: staple classification is the app's own rule (shared/foodSafety.js isStaple).
const TRACKING_TEXT = 'Every pantry item carries tracking, decided by the app\'s own staple rule: "level" = a ' +
  'staple tracked by stockLevel (full/ok/low/empty), changed with mark_in_stock / mark_out_of_stock (add_stock ' +
  'and consume_stock also accept a staple that has a recorded quantity, within their unit rules; consume_stock ' +
  'only when the whole recorded amount is used); "quantity" = a non-staple with a recorded quantity and unit, ' +
  'changed with set_inventory_quantity, consume_stock and add_stock within their unit rules (a negative stored ' +
  'quantity can only be corrected with set_inventory_quantity); "presence" = a non-staple recorded without an amount: being listed ' +
  'means it is in stock and the quantity tools refuse it, so never invent an amount; ask the user how much they ' +
  'have. tracking null means the record could not be read (safety reason invalid-record): do not change it ' +
  'from chat.';

// TASK-093: appended to every write tool's description.
const REQUEST_ID_TEXT = ' requestId is required: generate a new unique id (8-128 characters of A-Z, a-z, 0-9, _ or -) ' +
  'once for each change the user asks for, and send the SAME requestId when you retry that same change ' +
  '(for example after a timeout or a dropped connection). A retried requestId never applies twice: it ' +
  'returns the original result with replayed:true and changes nothing. Never reuse a requestId for a ' +
  'different change; that is refused as request_id_reused.';

export function createReadServer(env = {}, deps = {}, ctx = {}) {
  const server = new McpServer({
    name: 'meal-prep-private-reads',
    version: '1.0.0'
  });

  server.registerTool(
    'get_inventory',
    {
      title: 'Get inventory',
      description: 'Read the owner\'s current canonical pantry inventory. ' + TRACKING_TEXT + ' ' + SAFETY_RULES_TEXT,
      inputSchema: z.strictObject({}),
      outputSchema: z.strictObject({
        ok: z.literal(true),
        revision: z.number().int().nonnegative(),
        items: z.array(inventoryReadItemSchema())
      }),
      _meta: { securitySchemes: READ_SECURITY_SCHEMES },
      annotations: READ_ANNOTATIONS
    },
    async () => readTool(env, deps, ctx, (doc, today) => ({
      ok: true,
      revision: doc.revision,
      items: inventory.listInventoryWithSafety(doc.pantry, today)
    }))
  );

  server.registerTool(
    'get_ready_food',
    {
      title: 'Get ready food',
      description: 'Read the owner\'s current canonical ready-to-eat food. ' + SAFETY_RULES_TEXT,
      inputSchema: z.strictObject({}),
      outputSchema: z.strictObject({
        ok: z.literal(true),
        revision: z.number().int().nonnegative(),
        items: z.array(readyFoodReadItemSchema())
      }),
      _meta: { securitySchemes: READ_SECURITY_SCHEMES },
      annotations: READ_ANNOTATIONS
    },
    async () => readTool(env, deps, ctx, (doc, today) => ({
      ok: true,
      revision: doc.revision,
      items: readyFood.listReadyFoodWithSafety(doc.cookedMeals, today)
    }))
  );

  server.registerTool(
    'record_ready_food',
    {
      title: 'Record ready food',
      // Audit C3 (TASK-092): without a source the app still caps a fridge batch at its cooked
      // fridge limit (null fridgeLife included), so "freshness unknown" was no longer true.
      description: 'Create exactly one new ready-to-eat (cooked) food record. Append-only: ' +
        'never edits, removes, or finishes any existing record. Optional source is leftovers or ' +
        'takeout; with a source the record stores the shared ready-food shelf lives (' +
        readyFood.READY_FOOD_DEFAULT_FRIDGE_LIFE + ' fridge days, ' + readyFood.READY_FOOD_DEFAULT_FREEZER_LIFE +
        ' freezer days). Without a source no shelf life is stored, but freshness is NOT unknown: the ' +
        'app still applies its ' + COOKED_FRIDGE_LIMIT + '-day fridge safety limit from cookedDate, so a ' +
        'fridge record shows Expired after ' + COOKED_FRIDGE_LIMIT + ' days and the app can offer it for ' +
        'removal; a freezer record without a source has no quality date. cookedDate is the day it was ' +
        'cooked on the household calendar.' + REQUEST_ID_TEXT,
      inputSchema: recordReadyFoodInputSchema(),
      outputSchema: z.strictObject({
        ok: z.literal(true),
        revision: z.number().int().nonnegative(),
        replayed: REPLAYED_SCHEMA,
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
        'Requires expectedRevision; on revision_conflict, re-read before deciding whether to retry.' + REQUEST_ID_TEXT,
      inputSchema: consumeReadyFoodInputSchema(),
      outputSchema: z.strictObject({
        ok: z.literal(true),
        revision: z.number().int().nonnegative(),
        replayed: REPLAYED_SCHEMA,
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
        'from ChatGPT (staple or not is the app\'s own rule: tracking "level" in get_inventory). On ' +
        'invalid_record, ask the user to check the item in the app. Requires ' +
        'expectedRevision; on revision_conflict, re-read before deciding whether to retry.' + REQUEST_ID_TEXT,
      inputSchema: inventoryStockInputSchema(),
      outputSchema: z.strictObject({
        ok: z.literal(true),
        revision: z.number().int().nonnegative(),
        replayed: REPLAYED_SCHEMA,
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
        'Requires expectedRevision; on revision_conflict, re-read before deciding whether to retry.' + REQUEST_ID_TEXT,
      inputSchema: inventoryStockInputSchema(),
      outputSchema: z.strictObject({
        ok: z.literal(true),
        revision: z.number().int().nonnegative(),
        replayed: REPLAYED_SCHEMA,
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
        'rejected as unit_mismatch. For none left or out of milk, use mark_out_of_stock. Only items with ' +
        'tracking "quantity" in get_inventory: staples (tracking "level") are refused (use ' +
        'mark_in_stock / mark_out_of_stock), and an item with tracking "presence" (no amount recorded) is ' +
        'refused as presence_only: never invent an amount, ask the user. Take ingredientId ONLY from ' +
        'get_inventory; never guess or fuzzy-match, and ask which row if several match. On invalid_record, ' +
        'ask the user to check the item in the app. Requires expectedRevision; on revision_conflict, re-read before deciding ' +
        'whether to retry.' + REQUEST_ID_TEXT,
      inputSchema: setInventoryQuantityInputSchema(),
      outputSchema: z.strictObject({
        ok: z.literal(true),
        revision: z.number().int().nonnegative(),
        replayed: REPLAYED_SCHEMA,
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
        'or can/package conversions. Partial consumption is for items with tracking "quantity" in ' +
        'get_inventory; a staple can only be marked empty when its exact current amount is consumed, and ' +
        'an item with tracking "presence" (no amount recorded) is refused as presence_only: never invent ' +
        'an amount, ask the user. If the user says “all”, ' +
        'first read the current quantity, unit, and revision, then submit that exact amount against ' +
        'that revision. On insufficient_stock, unit mismatch, presence_only, or invalid_record, stop and clarify. This is ' +
        'a delta and is NOT safe to replay with a fresh revision; on revision_conflict, re-read before ' +
        'deciding whether to retry.' + REQUEST_ID_TEXT,
      inputSchema: consumeStockInputSchema(),
      outputSchema: z.strictObject({
        ok: z.literal(true),
        revision: z.number().int().nonnegative(),
        replayed: REPLAYED_SCHEMA,
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
        'or can/package conversions. New stock only joins a lot the shared safety verdict allows: a lot ' +
        'that is expired, unknown, check, or has a printed date is refused, and the user must record the ' +
        'new purchase separately in the app. For a fridge safety lot (raw meat, poultry, seafood, ground ' +
        'or variety meat, sausage, cooked food) send boughtDate (YYYY-MM-DD, the day the NEW stock was ' +
        'bought); it merges only when it equals the bought date of the lot, otherwise it must be recorded ' +
        'separately in the app. On needs_bought_date, ask the user when they bought it; use today only ' +
        'if they said "today" or "just bought", never guess. A future boughtDate is rejected. Other lots ' +
        'keep their stored dates; stock bought BEFORE the bought date of the lot is refused. Tell the user the ' +
        'bought date and storage of the lot from the result; when lot.storageSource is "inferred", say ' +
        'the storage was not recorded and was guessed from the ingredient. ' +
        'Stock-level-only staples and removed/tombstoned items must be handled in the app; use ' +
        'mark_in_stock for a stock-level-only staple. An item with tracking "presence" in get_inventory (no ' +
        'amount recorded) is refused as presence_only: never invent an amount, ask the user. This delta is NOT safe to replay with a fresh ' +
        'revision; on revision_conflict, re-read before deciding whether to retry.' + REQUEST_ID_TEXT,
      inputSchema: addStockInputSchema(),
      outputSchema: z.strictObject({
        ok: z.literal(true),
        revision: z.number().int().nonnegative(),
        replayed: REPLAYED_SCHEMA,
        item: inventoryItemSchema(),
        // TASK-094: stated back to the user ("bought 2026-11-27, stored in fridge").
        lot: z.strictObject({
          boughtDate: z.string().nullable(),
          storage: z.string().nullable(),
          // 'recorded' = stored on the lot; 'inferred' = no storage recorded, guessed from the
          // ingredient (say so to the user); null = unknown.
          storageSource: z.enum(['recorded', 'inferred']).nullable()
        })
      }),
      _meta: { securitySchemes: WRITE_SECURITY_SCHEMES },
      annotations: ADD_STOCK_ANNOTATIONS
    },
    async (args) => addStockTool(env, deps, ctx, args)
  );

  server.registerTool(
    'add_pantry_item',
    {
      title: 'Add a pantry item',
      description: 'Register ONE new pantry lot the user explicitly asked to record: a grocery purchase, or (prepared: true) a ' +
        'prepared ingredient such as frozen minced garlic or chopped onions. It creates a new record the same way the app\'s ' +
        'own Add does and never changes an existing lot (to add to an existing lot use add_stock). name is used exactly as ' +
        'given; the app\'s ingredient list (exact name) supplies shelf life, default unit and the staple flag, and the ' +
        'category (exact name or alias). ' +
        'boughtDate defaults to today on the household calendar; a future boughtDate is refused. storage: send it when the ' +
        'user said it; otherwise it is inferred from the ingredient list and the result says storageSource "inferred": tell ' +
        'the user ("stored in the fridge - say if not"). For raw meat, poultry, fish, other foods with a fridge safety limit ' +
        'and foods the bridge cannot classify, storage and bought date are never guessed: on needs_storage or ' +
        'needs_bought_date ask the user (use today only if they said "today" or "just bought"); they are never kept on the ' +
        'counter (unsafe_storage). A fridge lot already past its fridge safety limit is refused (past_safety_limit). On ' +
        'unrecognized_food or unsafe_storage, ask for the ingredient\'s name as the app lists it, or ask the user to check ' +
        'the item in the app. A prepared ingredient needs storage (fridge or freezer); in the freezer with no printed date ' +
        'it gets the ready-food freezer life, in the fridge the ready-food fridge life, never longer than the raw ' +
        'ingredient\'s; this tool ' +
        'does NOT deduct the raw ingredients used. printedDate is the date printed on the pack (printedDateKind "use-by", ' +
        'the default, or "best-before"). staple: true makes it a staple tracked by level (default "full"). If the same ' +
        'item with the same bought date, storage and printed date is already recorded, the result is ambiguous with its ' +
        'ingredientId: ask the user, then use add_stock on that lot (offered only when neither lot has a printed date) or ' +
        'call again with confirmNewLot: true and a new requestId. A different printed date is a new lot. Never ' +
        'register items the user did not mention. State back the stored name, amount, storage, bought date, printed date ' +
        'and safety label from the result. Requires expectedRevision; on revision_conflict, re-read before deciding ' +
        'whether to retry.' + REQUEST_ID_TEXT,
      inputSchema: addPantryItemInputSchema(),
      outputSchema: z.strictObject({
        ok: z.literal(true),
        revision: z.number().int().nonnegative(),
        replayed: REPLAYED_SCHEMA,
        item: pantryItemReadBackSchema(),
        storageSource: z.enum(['given', 'inferred']),
        prepared: z.boolean()
      }),
      _meta: { securitySchemes: WRITE_SECURITY_SCHEMES },
      annotations: ADD_PANTRY_ITEM_ANNOTATIONS
    },
    async (args) => addPantryItemTool(env, deps, ctx, args)
  );

  server.registerTool(
    'update_pantry_item',
    {
      title: 'Correct a pantry item\'s storage or dates',
      description: 'Correct the storage location and/or dates of ONE existing pantry lot, using ingredientId ONLY from ' +
        'get_inventory (never guess or fuzzy-match; ask which row if several match). storage is fridge, freezer or ' +
        'counter; boughtDate is the bought day (not in the future); printedDate is the date printed on the pack (null ' +
        'clears it; a new printed date counts as use-by unless printedDateKind "best-before" is sent). Moving raw meat, ' +
        'poultry or fish, or a frozen prepared ingredient (any lot whose freezer shelf life is longer than its fridge life), ' +
        'from the freezer to the fridge needs the thaw day: on needs_thaw_date remind the user that fridge time counts from ' +
        'thawing, then send thawedToday: true if it moved today, or boughtDate as the day it moved; a freezer shelf life is ' +
        'capped at the fridge life. Food safety refusals (raw meat, poultry, fish or a food the bridge cannot classify): ' +
        'unsafe_storage (never the counter), past_safety_limit or unknown_bought_date (a lot past its fridge limit, or with ' +
        'no known bought date, is not moved to the freezer: freezing does not make it safe again), later_bought_date (its ' +
        'bought date may only move earlier, except the thaw day when leaving the freezer for the fridge), ' +
        'unrecognized_food (a meat or fish name with no shared fridge limit never moves into the fridge), ' +
        'frozen_printed_date (a lot with a printed date is not moved from the freezer to the fridge from chat, even with ' +
        'the thaw day: its printed date no longer applies). On any of these, tell the user and ' +
        'ask them to check the item in the app; never retry with a different date to get past it. Name, ' +
        'amount, staple flag and level are not changed here. unchanged: true means nothing needed changing. On ' +
        'invalid_record, ask the user to check the item in the app. Tell the user the new safety label from the result. ' +
        'Requires expectedRevision; on revision_conflict, re-read before deciding whether to retry.' + REQUEST_ID_TEXT,
      inputSchema: updatePantryItemInputSchema(),
      outputSchema: z.strictObject({
        ok: z.literal(true),
        revision: z.number().int().nonnegative(),
        replayed: REPLAYED_SCHEMA,
        item: pantryItemReadBackSchema(),
        storageSource: z.enum(['given', 'recorded', 'inferred']).nullable(),
        unchanged: z.boolean(),
        thawed: z.boolean()
      }),
      _meta: { securitySchemes: WRITE_SECURITY_SCHEMES },
      annotations: UPDATE_PANTRY_ITEM_ANNOTATIONS
    },
    async (args) => updatePantryItemTool(env, deps, ctx, args)
  );

  server.registerTool(
    'undo_request',
    {
      title: 'Undo an earlier chat change',
      description: 'Undo ONE earlier chat change (within 30 days) when the user asks to undo, reverse or ' +
        'put back something chat did. requestId is the requestId of the change to undo (the one you sent ' +
        'with it); undoRequestId is a NEW unique id for this undo (8-128 characters of A-Z, a-z, 0-9, _ or ' +
        '-), and you send the SAME undoRequestId when you retry this undo after a timeout: a retried ' +
        'undoRequestId never applies twice and returns the original result with replayed:true. Never ' +
        'reuse an undoRequestId for a different undo (request_id_reused). Removed items come back with ' +
        'the same id, changed items return to their earlier values, and ready food that change recorded is ' +
        'removed again. The undo is refused and NOTHING changes when: the change is unknown or older than ' +
        '30 days (request_not_found, undo_expired); it was already undone (already_undone); any affected ' +
        'item changed since (changed_since; so to undo two changes to the same item, only the latest can ' +
        'be undone - the earlier one is then refused) or a removed item\'s id is in use again (id_in_use); it was ' +
        'itself an undo (undo_of_undo); it changed nothing (nothing_to_undo); it recorded food that was ' +
        'eaten (undo_not_supported: eaten-meal history is permanent); putting back an update_pantry_item ' +
        'edit would make the item read safer than it is (unsafe_restore: for example a thawed item now past its ' +
        'fridge limit going back into the freezer, or a later bought date); or its record is incomplete ' +
        '(undo_record_incomplete). Tell the user the reason and suggest fixing it in the app. Requires ' +
        'expectedRevision from a fresh read; on revision_conflict, re-read before deciding whether to retry. ' +
        'Undo one change per call.',
      inputSchema: undoRequestInputSchema(),
      outputSchema: z.strictObject({
        ok: z.literal(true),
        revision: z.number().int().nonnegative(),
        replayed: REPLAYED_SCHEMA,
        undoneRequestId: z.string(),
        undoneTool: z.string(),
        restored: z.array(undoRecordRefSchema()),
        removed: z.array(undoRecordRefSchema())
      }),
      _meta: { securitySchemes: WRITE_SECURITY_SCHEMES },
      annotations: UNDO_ANNOTATIONS
    },
    async (args) => undoRequestTool(env, deps, ctx, args)
  );

  return server;
}

// Every write tool runs through this one adapter (TASK-093, PROP-041 P1-3):
//   auth -> requestId shape (before ANY Firestore access) -> tool-specific prechecks ->
//   argsHash -> read this request's record: present => stored result (replayed:true) or
//   request_id_reused, zero writes, whatever expectedRevision now says -> read the user document
//   -> compare expectedRevision (no retry) -> the canonical operation (unchanged) -> ONE commit of
//   the guarded user-document update plus the create-only request record.
// `plan.apply(doc)` returns { write: { fieldPaths, fields } | null, result(revision) }. A no-op
// (write null, e.g. an already-out item) leaves the user document alone but still commits its
// request record, so the id is spent: a lost-response retry gets the same "unchanged" answer
// instead of applying a change nobody confirmed (review should-fix 2).
// TASK-095 (undo_request) adds four optional plan hooks, unused by the other tools:
//   `idKey` / `unhashed` - the argument naming THIS request's id and the keys left out of argsHash;
//   `load(io)`           - async, after the replay check and before the user-document read;
//                          its value is passed to apply(doc, loaded);
//   step.markRequest     - a guarded field update of another request record in the same commit;
//   `onCommitConflict`   - async, may replace a revision_conflict from the commit with a clearer error.
// Every request record also stores `after` (TASK-095): the after-state undo compares against.
async function requestWriteTool(env, deps, ctx, tool, args, plan) {
  try {
    const auth = requireMcpWriteContext(env, ctx, deps.nowSeconds);
    const idKey = plan.idKey || 'requestId';
    requests.validateRequestId(args ? args[idKey] : undefined);
    if (plan.precheck) plan.precheck(args);

    const fetchImpl = deps.fetchImpl || fetch;
    const cryptoImpl = deps.cryptoImpl || globalThis.crypto;
    const getToken = deps.getFirestoreAccessToken || getFirestoreAccessToken;
    const readDoc = deps.getUserDocument || getUserDocument;
    const readRequest = deps.getRequestRecord || getRequestRecord;
    const commitWrite = deps.commitRequestWrite || commitRequestWrite;
    const nowMs = typeof deps.now === 'function' ? Number(deps.now()) : Date.now();

    const hash = await requests.argsHash(args, cryptoImpl, plan.unhashed);
    const accessToken = await getToken(env, { fetchImpl, cryptoImpl });
    const ownId = args[idKey];
    const stored = await readRequest(env, accessToken, ownId, fetchImpl);
    if (stored) return toolResult(requests.replayResult(stored, tool, hash));

    const io = { env, accessToken, fetchImpl, deps, nowMs };
    const loaded = plan.load ? await plan.load(io) : undefined;
    const doc = await readDoc(env, accessToken, fetchImpl);
    if (args.expectedRevision !== doc.revision) throw new RevisionConflictError(doc);

    const step = plan.apply(doc, loaded);
    const write = step.write || null;
    const revisionAfter = write ? doc.revision + 1 : doc.revision;
    const result = step.result(revisionAfter);
    const record = requests.buildRequestRecord({
      tool,
      argsHash: hash,
      actor: auth.subject,
      nowMs,
      revisionBefore: doc.revision,
      revisionAfter,
      result,
      before: write ? requests.beforeSnapshot(doc, write) : requests.EMPTY_BEFORE,
      added: write ? requests.addedRecords(doc, write) : {},
      after: write ? requests.afterSnapshot(doc, write) : requests.EMPTY_AFTER,
      undoes: step.undoes
    });
    try {
      await commitWrite(env, accessToken, Object.assign({}, write || { fieldPaths: [], fields: {}, recordOnly: true }, {
        expectedUpdateTime: doc.updateTime,
        nextVersion: revisionAfter,
        requestId: ownId,
        record
      }, step.markRequest ? { markRequest: step.markRequest } : {}), fetchImpl);
    } catch (error) {
      // A concurrent call with this requestId committed first: answer as its replay.
      if (error instanceof RequestAlreadyRecordedError) return toolResult(requests.replayResult(error.record, tool, hash));
      if (error instanceof RevisionConflictError && plan.onCommitConflict) await plan.onCommitConflict(io);
      throw error;
    }
    return toolResult(result);
  } catch (error) {
    return (plan.mapError || inventoryStockError)(error, plan.fallback);
  }
}

// set_inventory_quantity: the canonical wrapper decides; one guarded pantry write.
async function setInventoryQuantityTool(env, deps, ctx, args) {
  return requestWriteTool(env, deps, ctx, 'set_inventory_quantity', args, {
    fallback: 'The inventory quantity could not be set.',
    apply: (doc) => {
      const r = inventory.setCountedQuantity(doc.pantry, {
        ingredientId: args.ingredientId,
        quantity: args.quantity,
        expectedUnit: args.expectedUnit
      });
      return {
        write: { fieldPaths: ['pantry'], fields: { pantry: r.pantry } },
        result: (revision) => ({ ok: true, revision, item: r.item })
      };
    }
  });
}

// Apply exactly one delta against the observed revision, then make one guarded write. Exact-zero
// deletion and staple-empty semantics come from the canonical inventory operation.
async function consumeStockTool(env, deps, ctx, args) {
  return requestWriteTool(env, deps, ctx, 'consume_stock', args, {
    fallback: 'The inventory stock could not be consumed.',
    apply: (doc) => {
      const r = inventory.consumeStock(doc.pantry, doc.deletions.pantry || {}, {
        ingredientId: args.ingredientId,
        quantity: args.quantity,
        expectedUnit: args.expectedUnit
      });
      return {
        write: pantryWriteSpec(r),
        result: (revision) => ({ ok: true, revision, item: r.item, removed: r.removed })
      };
    }
  });
}

// Apply exactly one purchase delta to the observed existing row, then make one guarded pantry write.
// The household day (TASK-092 setting, injectable clock) is fixed once per call, before any
// Firestore access: an invalid HOUSEHOLD_TIME_ZONE or a malformed/future boughtDate fails here.
async function addStockTool(env, deps, ctx, args) {
  let today;
  return requestWriteTool(env, deps, ctx, 'add_stock', args, {
    fallback: 'The inventory stock could not be increased.',
    precheck: (input) => {
      today = householdDayFromEnv(env, deps.now);
      inventory.validateBoughtDate(input.boughtDate, today);
    },
    apply: (doc) => {
      const r = inventory.addStock(doc.pantry, doc.deletions.pantry || {}, {
        ingredientId: args.ingredientId,
        quantity: args.quantity,
        expectedUnit: args.expectedUnit,
        boughtDate: args.boughtDate
      }, today);
      return {
        write: { fieldPaths: ['pantry'], fields: { pantry: r.pantry } },
        result: (revision) => ({ ok: true, revision, item: r.item, lot: r.lot })
      };
    }
  });
}

// add_pantry_item (TASK-099): one new lot, built by operations/pantryItems.js; one guarded pantry
// write. The household day and the arguments are checked before any Firestore access.
function toolClock(deps) {
  return typeof deps.now === 'function' ? Number(deps.now()) : Date.now();
}

async function addPantryItemTool(env, deps, ctx, args) {
  let today;
  return requestWriteTool(env, deps, ctx, 'add_pantry_item', args, {
    fallback: 'The pantry item could not be added.',
    precheck: (input) => {
      today = householdDayFromEnv(env, deps.now);
      pantryItems.validateAddPantryItemArgs(input, today);
    },
    apply: (doc) => {
      const r = pantryItems.addPantryItem(doc.pantry || [], doc.deletions.pantry || {}, args, {
        today,
        nowMs: toolClock(deps),
        random: typeof deps.random === 'function' ? deps.random : Math.random
      });
      return {
        write: { fieldPaths: ['pantry'], fields: { pantry: r.pantry } },
        result: (revision) => ({ ok: true, revision, item: r.item, storageSource: r.storageSource, prepared: args.prepared === true })
      };
    }
  });
}

// update_pantry_item (TASK-099): storage/date correction of one existing lot; one guarded pantry
// write, or none when nothing changes (the request record is still kept, like mark_in_stock).
async function updatePantryItemTool(env, deps, ctx, args) {
  let today;
  return requestWriteTool(env, deps, ctx, 'update_pantry_item', args, {
    fallback: 'The pantry item could not be updated.',
    precheck: (input) => {
      today = householdDayFromEnv(env, deps.now);
      pantryItems.validateUpdatePantryItemArgs(input, today);
    },
    apply: (doc) => {
      const r = pantryItems.updatePantryItem(doc.pantry || [], doc.deletions.pantry || {}, args, { today, nowMs: toolClock(deps) });
      return {
        write: r.unchanged ? null : { fieldPaths: ['pantry'], fields: { pantry: r.pantry } },
        result: (revision) => ({ ok: true, revision, item: r.item, storageSource: r.storageSource, unchanged: r.unchanged, thawed: r.thawed })
      };
    }
  });
}

async function markOutOfStockTool(env, deps, ctx, args) {
  return requestWriteTool(env, deps, ctx, 'mark_out_of_stock', args, {
    fallback: 'The inventory item could not be marked out of stock.',
    apply: (doc) => {
      const r = inventory.markOutOfStock(doc.pantry, doc.deletions.pantry || {}, {
        ingredientId: args.ingredientId
      });
      return {
        write: r.unchanged ? null : pantryWriteSpec(r),
        result: (revision) => ({ ok: true, revision, item: r.item, unchanged: r.unchanged, removed: r.removed })
      };
    }
  });
}

async function markInStockTool(env, deps, ctx, args) {
  return requestWriteTool(env, deps, ctx, 'mark_in_stock', args, {
    fallback: 'The inventory item could not be marked in stock.',
    apply: (doc) => {
      const r = inventory.markInStock(doc.pantry, { ingredientId: args.ingredientId });
      return {
        write: r.unchanged ? null : { fieldPaths: ['pantry'], fields: { pantry: r.pantry } },
        result: (revision) => ({ ok: true, revision, item: r.item, unchanged: r.unchanged })
      };
    }
  });
}

// The pantry field-path split shared by consume_stock and mark_out_of_stock: a removal also
// writes the tombstone bucket (D-071).
function pantryWriteSpec(r) {
  return r.removed
    ? { fieldPaths: ['pantry', 'deletions.pantry'], fields: { pantry: r.pantry, deletions: { pantry: r.deletionsPantry } } }
    : { fieldPaths: ['pantry'], fields: { pantry: r.pantry } };
}

function requestError(error) {
  if (error instanceof requests.RequestIdReusedError) {
    return { content: [{ type: 'text', text: 'request_id_reused: ' + error.message }], isError: true };
  }
  return null;
}

function inventoryStockError(error, fallback) {
  if (error instanceof McpAuthError) return mcpAuthChallenge(error, MCP_WRITE_SCOPE);
  const reused = requestError(error);
  if (reused) return reused;
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
  return requestWriteTool(env, deps, ctx, 'consume_ready_food', args, {
    fallback: 'The ready-food record could not be consumed.',
    mapError: readyFoodError,
    apply: (doc) => {
      // Project only the two business fields the canonical operation destructures.
      const r = readyFood.consumeReadyFood(
        { cookedMeals: doc.cookedMeals, deletionsCookedMeals: doc.deletions.cookedMeals || {}, mealConsumptions: doc.mealConsumptions },
        { cookedMealId: args.cookedMealId, servings: args.servings }
      );
      return {
        write: readyFood.consumeWriteSpec(r),
        result: (revision) => ({ ok: true, revision, item: r.item, removed: r.removed })
      };
    }
  });
}

// Mirrors index.js's POST /v1/ready-food/record flow exactly: auth -> expectedRevision shape ->
// read -> compare expectedRevision -> recordCookedFood() (the one, already-reviewed
// validation+record-shape function) -> write. No persistence or business validation is
// reimplemented here (D-082 decision 7 / TASK-069).
async function recordReadyFoodTool(env, deps, ctx, args) {
  return requestWriteTool(env, deps, ctx, 'record_ready_food', args, {
    fallback: 'The ready-food record could not be created.',
    mapError: readyFoodError,
    precheck: (a) => requireValidExpectedRevision(a ? a.expectedRevision : undefined),
    apply: (doc) => {
      // Project only the canonical business fields recordCookedFood() actually destructures —
      // expectedRevision and requestId (not business fields) must never reach it.
      const r = readyFood.recordCookedFood({
        name: args.name,
        servings: args.servings,
        storage: args.storage,
        cookedDate: args.cookedDate,
        recipeId: args.recipeId,
        source: args.source
      });
      return {
        write: { fieldPaths: ['cookedMeals'], fields: { cookedMeals: (doc.cookedMeals || []).concat([r.record]) } },
        result: (revision) => ({ ok: true, revision, item: r.item })
      };
    }
  });
}

// undo_request (TASK-095, PROP-041 P1-5): puts back what one earlier chat request changed. Its
// own id is `undoRequestId`; `requestId` names the request to undo (part of argsHash, so the same
// undoRequestId used for a different request is request_id_reused). Flow: the shared adapter
// (auth, id shapes, replay of THIS undo) -> load the original record with its updateTime ->
// record-level refusals -> read the user document -> expectedRevision -> requests.planUndo() ->
// ONE commit: the guarded user-document update, this undo's create-only record, and `undoneBy` on
// the original record under its updateTime precondition (two undos can never both apply).
// A refusal writes nothing, not even this undo's record: undoRequestId stays unspent, so a retry
// re-evaluates against the then-current state (TASK-095 decision, README).
async function undoRequestTool(env, deps, ctx, args) {
  let originalUpdateTime = null;
  const readOriginal = (io) => (deps.getRequestDocument || getRequestDocument)(io.env, io.accessToken, args.requestId, io.fetchImpl);
  return requestWriteTool(env, deps, ctx, requests.UNDO_TOOL, args, {
    idKey: 'undoRequestId',
    unhashed: requests.UNDO_UNHASHED_ARG_KEYS,
    fallback: 'The request could not be undone.',
    mapError: undoError,
    precheck: (a) => requests.validateRequestId(a.requestId),
    load: async (io) => {
      const found = await readOriginal(io);
      requests.checkUndoable(found ? found.record : null, args.requestId, io.nowMs);
      originalUpdateTime = found.updateTime;
      // One household day for the whole call (the restore safety check below).
      return Object.assign({ nowMs: io.nowMs, today: householdDayFromEnv(env, deps.now) }, found);
    },
    apply: (doc, original) => {
      const plan = requests.planUndo(original.record, doc, args.requestId, original.nowMs);
      if (original.record.tool === 'update_pantry_item') refuseUnsafeRestore(original.record, plan, original.today, args.requestId);
      return {
        write: plan.write,
        undoes: args.requestId,
        markRequest: { requestId: args.requestId, updateTime: originalUpdateTime, fields: { undoneBy: args.undoRequestId } },
        result: (revision) => ({
          ok: true,
          revision,
          undoneRequestId: args.requestId,
          undoneTool: original.record.tool,
          restored: plan.restored,
          removed: plan.removed
        })
      };
    },
    // Lost the commit race: if another undo of the same request won, say so plainly.
    onCommitConflict: async (io) => {
      const found = await readOriginal(io);
      if (found && found.record && found.record.undoneBy != null) requests.checkUndoable(found.record, args.requestId, io.nowMs);
    }
  });
}

// undo_request of update_pantry_item (TASK-099 review MF1): putting the edited lot back is itself
// a storage/date edit, so it must pass the same food-safety rules update_pantry_item applies. Each
// restored pantry record is checked as the move from what the request left (its `after` copy, which
// planUndo has just matched against the live record) to its `before` copy. A refusal throws before
// any write, so undoRequestId stays unspent.
function refuseUnsafeRestore(record, plan, today, requestId) {
  plan.restored.filter((entry) => entry.collection === 'pantry').forEach((entry) => {
    const current = record.after.pantry.find((r) => String(r.id) === entry.id);
    const restored = record.before.pantry.find((r) => String(r.id) === entry.id);
    if (!current || !restored) return;
    const reason = pantryItems.unsafeRestoreReason(current, restored, today);
    if (reason) {
      throw new requests.UndoRefusedError('unsafe_restore', 'Request "' + requestId + '" cannot be undone from chat: ' + reason +
        ' Nothing was changed. Ask the user to check the item in the app.');
    }
  });
}

function undoError(error, fallback) {
  if (error instanceof requests.UndoRefusedError) {
    return { content: [{ type: 'text', text: error.reason + ': ' + error.message }], isError: true };
  }
  return inventoryStockError(error, fallback);
}

function readyFoodError(error, fallback) {
  if (error instanceof McpAuthError) return mcpAuthChallenge(error, MCP_WRITE_SCOPE);
  const reused = requestError(error);
  if (reused) return reused;
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
  return { content: [{ type: 'text', text: fallback }], isError: true };
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
    // Household calendar day (TASK-092): computed before any Firestore access; a missing or
    // invalid HOUSEHOLD_TIME_ZONE fails the read closed instead of guessing a day.
    const today = householdDayFromEnv(env, deps.now);
    const fetchImpl = deps.fetchImpl || fetch;
    const cryptoImpl = deps.cryptoImpl || globalThis.crypto;
    const getToken = deps.getFirestoreAccessToken || getFirestoreAccessToken;
    const readDoc = deps.getUserDocument || getUserDocument;
    const accessToken = await getToken(env, { fetchImpl, cryptoImpl });
    const doc = await readDoc(env, accessToken, fetchImpl);
    return toolResult(selectResult(doc, today));
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
  add_stock: WRITE_SECURITY_SCHEMES,
  add_pantry_item: WRITE_SECURITY_SCHEMES,
  update_pantry_item: WRITE_SECURITY_SCHEMES,
  undo_request: WRITE_SECURITY_SCHEMES
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
