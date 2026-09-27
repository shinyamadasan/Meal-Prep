// Conversational Control Bridge v1 (TASK-065 / D-082). HTTP + auth layer -> request
// validation -> domain operation -> Firestore adapter. No arbitrary Firestore CRUD: every route
// below is a fixed, narrow domain command, never a passthrough for a caller-supplied path,
// collection, or uid.
import { requireBearerToken, getFirestoreAccessToken, UnauthorizedError } from './auth.js';
import { getUserDocument, patchUserDocument, RevisionConflictError, InfrastructureError } from './firestore.js';
import { NotFoundError, ValidationError, InsufficientServingsError } from './errors.js';
import * as inventory from './operations/inventory.js';
import * as readyFood from './operations/readyFood.js';

const MAX_BODY_BYTES = 8 * 1024;

export default {
  async fetch(request, env) {
    return handleRequest(request, env || {});
  }
};

export async function handleRequest(request, env = {}, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const cryptoImpl = deps.cryptoImpl || globalThis.crypto;
  const readDoc = deps.getUserDocument || getUserDocument;
  const writeDoc = deps.patchUserDocument || patchUserDocument;
  const getToken = deps.getFirestoreAccessToken || getFirestoreAccessToken;

  try {
    requireBearerToken(request, env);

    const url = new URL(request.url);
    const route = matchRoute(request.method, url.pathname);
    if (!route) return errorResponse('not_found', 404, 'No such route.');
    if (route === METHOD_NOT_ALLOWED) return errorResponse('validation_failed', 405, 'Method not allowed for this route.');

    const body = route.method === 'POST' ? await readJsonBody(request) : {};
    validateBody(route.name, body);

    const accessToken = await getToken(env, { fetchImpl, cryptoImpl });
    const doc = await readDoc(env, accessToken, fetchImpl);

    if (route.method === 'POST' && body.expectedRevision !== doc.revision) {
      throw new RevisionConflictError(doc);
    }

    const result = await route.handler(doc, body);
    if (!result.write) {
      return jsonResponse(Object.assign({ ok: true, revision: doc.revision }, result.body), 200);
    }

    const written = await writeDoc(env, accessToken, {
      fieldPaths: result.write.fieldPaths,
      fields: result.write.fields,
      expectedUpdateTime: doc.updateTime,
      nextVersion: doc.revision + 1
    }, fetchImpl);

    return jsonResponse(Object.assign({ ok: true, revision: written.revision }, result.body), 200);
  } catch (error) {
    return errorFromException(error);
  }
}

const METHOD_NOT_ALLOWED = Symbol('method-not-allowed');

const ROUTES = [
  { method: 'GET', path: '/v1/inventory', name: 'inventory.get', handler: (doc) => ({ body: { items: inventory.listInventory(doc.pantry) } }) },
  { method: 'GET', path: '/v1/ready-food', name: 'readyFood.get', handler: (doc) => ({ body: { items: readyFood.listReadyFood(doc.cookedMeals) } }) },
  {
    method: 'POST', path: '/v1/inventory/set-quantity', name: 'inventory.setQuantity',
    handler: (doc, body) => {
      const r = inventory.setQuantity(doc.pantry, body);
      return { body: { item: r.item, unchanged: r.unchanged, removed: false }, write: { fieldPaths: ['pantry'], fields: { pantry: r.pantry } } };
    }
  },
  {
    method: 'POST', path: '/v1/inventory/mark-out-of-stock', name: 'inventory.markOutOfStock',
    handler: (doc, body) => {
      const r = inventory.markOutOfStock(doc.pantry, doc.deletions.pantry || {}, body);
      if (r.unchanged) return { body: { item: r.item, unchanged: true, removed: r.removed } };
      const write = r.removed
        ? { fieldPaths: ['pantry', 'deletions.pantry'], fields: { pantry: r.pantry, deletions: { pantry: r.deletionsPantry } } }
        : { fieldPaths: ['pantry'], fields: { pantry: r.pantry } };
      return { body: { item: r.item, unchanged: false, removed: r.removed }, write };
    }
  },
  {
    method: 'POST', path: '/v1/inventory/mark-in-stock', name: 'inventory.markInStock',
    handler: (doc, body) => {
      const r = inventory.markInStock(doc.pantry, body);
      if (r.unchanged) return { body: { item: r.item, unchanged: true, removed: false } };
      return { body: { item: r.item, unchanged: false, removed: false }, write: { fieldPaths: ['pantry'], fields: { pantry: r.pantry } } };
    }
  },
  {
    method: 'POST', path: '/v1/ready-food/record', name: 'readyFood.record',
    handler: (doc, body) => {
      const r = readyFood.recordCookedFood(body);
      const nextMeals = (doc.cookedMeals || []).concat([r.record]);
      return { body: { item: r.item, unchanged: false, removed: false }, write: { fieldPaths: ['cookedMeals'], fields: { cookedMeals: nextMeals } } };
    }
  },
  {
    method: 'POST', path: '/v1/ready-food/consume', name: 'readyFood.consume',
    handler: (doc, body) => {
      const r = readyFood.consumePortions(doc.cookedMeals, doc.deletions.cookedMeals || {}, body);
      const write = r.removed
        ? { fieldPaths: ['cookedMeals', 'deletions.cookedMeals'], fields: { cookedMeals: r.cookedMeals, deletions: { cookedMeals: r.deletionsCookedMeals } } }
        : { fieldPaths: ['cookedMeals'], fields: { cookedMeals: r.cookedMeals } };
      return { body: { item: r.item, unchanged: false, removed: r.removed }, write };
    }
  },
  {
    method: 'POST', path: '/v1/ready-food/finish', name: 'readyFood.finish',
    handler: (doc, body) => {
      const r = readyFood.finishCookedMeal(doc.cookedMeals, doc.deletions.cookedMeals || {}, body);
      return {
        body: { item: r.item, unchanged: false, removed: true },
        write: { fieldPaths: ['cookedMeals', 'deletions.cookedMeals'], fields: { cookedMeals: r.cookedMeals, deletions: { cookedMeals: r.deletionsCookedMeals } } }
      };
    }
  }
];

// Allow-lists exactly the keys each route accepts — an extra/unexpected key (e.g. an attempt to
// smuggle a `path`, `collection`, or `uid`) is rejected as over-posting rather than ignored.
const BODY_SCHEMAS = {
  'inventory.setQuantity': { required: ['ingredientId', 'quantity', 'expectedRevision'], optional: ['unit'] },
  'inventory.markOutOfStock': { required: ['ingredientId', 'expectedRevision'], optional: [] },
  'inventory.markInStock': { required: ['ingredientId', 'expectedRevision'], optional: [] },
  'readyFood.record': { required: ['name', 'servings', 'storage', 'expectedRevision'], optional: ['recipeId'] },
  'readyFood.consume': { required: ['cookedMealId', 'servings', 'expectedRevision'], optional: [] },
  'readyFood.finish': { required: ['cookedMealId', 'expectedRevision'], optional: [] }
};

function matchRoute(method, pathname) {
  const byPath = ROUTES.filter((r) => r.path === pathname);
  if (byPath.length === 0) return null;
  const match = byPath.find((r) => r.method === method);
  return match || METHOD_NOT_ALLOWED;
}

async function readJsonBody(request) {
  const contentType = request.headers.get('Content-Type') || '';
  if (!/^application\/json\b/i.test(contentType)) {
    throw new ValidationError('Content-Type must be application/json.', { field: 'Content-Type' });
  }

  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > MAX_BODY_BYTES) {
    throw new ValidationError('Request body exceeds the ' + MAX_BODY_BYTES + '-byte limit.', { field: 'body' });
  }

  const text = await readBoundedText(request, MAX_BODY_BYTES);
  if (!text) throw new ValidationError('Request body must be valid JSON.', { field: 'body' });
  let body;
  try {
    body = JSON.parse(text);
  } catch (e) {
    throw new ValidationError('Request body must be valid JSON.', { field: 'body' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object.', { field: 'body' });
  }
  return body;
}

async function readBoundedText(request, limit) {
  if (!request.body || typeof request.body.getReader !== 'function') {
    // Test doubles / environments without a streamable body still expose .text().
    const text = await request.text();
    if (new TextEncoder().encode(text).length > limit) throw new ValidationError('Request body exceeds the ' + limit + '-byte limit.', { field: 'body' });
    return text;
  }
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      try { await reader.cancel(); } catch (e) { /* best-effort */ }
      throw new ValidationError('Request body exceeds the ' + limit + '-byte limit.', { field: 'body' });
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  chunks.forEach((chunk) => { merged.set(chunk, offset); offset += chunk.byteLength; });
  return new TextDecoder().decode(merged);
}

function validateBody(routeName, body) {
  const schema = BODY_SCHEMAS[routeName];
  if (!schema) return; // GET routes take no body
  const allowed = new Set(schema.required.concat(schema.optional));
  const missing = schema.required.filter((key) => body[key] === undefined);
  if (missing.length) throw new ValidationError('Missing required field(s): ' + missing.join(', ') + '.', { fields: missing });
  const extra = Object.keys(body).filter((key) => !allowed.has(key));
  if (extra.length) throw new ValidationError('Unexpected field(s): ' + extra.join(', ') + '.', { fields: extra });
  if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 0) {
    throw new ValidationError('expectedRevision must be a non-negative integer.', { field: 'expectedRevision' });
  }
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

function errorResponse(code, status, message, detail) {
  const error = { code, message };
  if (detail !== undefined) error.detail = detail;
  return jsonResponse({ ok: false, error }, status);
}

function errorFromException(error) {
  if (error instanceof UnauthorizedError) return errorResponse('unauthorized', 401, error.message);
  if (error instanceof NotFoundError) return errorResponse('not_found', 404, error.message);
  if (error instanceof ValidationError) return errorResponse('validation_failed', 422, error.message, error.detail);
  if (error instanceof InsufficientServingsError) return errorResponse('insufficient_servings', 422, error.message, error.detail);
  if (error instanceof RevisionConflictError) {
    return errorResponse('revision_conflict', 409, error.message, {
      revision: error.current.revision,
      pantry: inventory.listInventory(error.current.pantry),
      readyFood: readyFood.listReadyFood(error.current.cookedMeals)
    });
  }
  if (error instanceof InfrastructureError) return errorResponse('infrastructure_error', 502, 'A downstream service failed. Try again.');
  // Anything unclassified is still an infrastructure failure from the caller's point of view —
  // never leak a stack trace or raw error message for an error we didn't expect.
  return errorResponse('infrastructure_error', 500, 'An unexpected error occurred.');
}
