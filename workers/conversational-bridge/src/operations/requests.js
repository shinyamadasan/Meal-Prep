// Duplicate-write protection for chat writes (PROP-041 P1-3, TASK-093; owner decisions 2 and 5).
//
// Every MCP write tool takes a caller-generated `requestId`. The write commits, in ONE Firestore
// `documents:commit`, the guarded user-document update AND a create-only
// `users/{uid}/mcpRequests/{requestId}` record (firestore.js commitRequestWrite()). A retried
// request therefore finds its own record and gets the stored result back (`replayed: true`)
// instead of applying a second time.
//
// The record is also the undo input for TASK-095: `before` holds a full copy of every pantry /
// cookedMeals record the write changed or removed, plus the prior value of every tombstone entry
// it touched (null = there was no tombstone). One 30-day retention (`expireAt`, for an owner-set
// Firestore TTL policy) covers both uses.
//
// Pure apart from Web Crypto's SHA-256 digest: no Firestore, no clock (callers pass `nowMs`).
import { ValidationError } from '../errors.js';
import { readableId } from './inventory.js';

export const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
export const REQUEST_ID_MESSAGE = 'requestId must be 8-128 characters using only A-Z, a-z, 0-9, _ or -.';
export const REQUEST_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// Never part of the args hash: requestId names the request, and expectedRevision only says which
// revision the caller saw — a retry after a timeout may legitimately carry a fresher one.
const UNHASHED_ARG_KEYS = new Set(['requestId', 'expectedRevision']);

const SNAPSHOT_FIELDS = ['pantry', 'cookedMeals'];

export class RequestIdReusedError extends Error {
  constructor() {
    super('This requestId was already used for a different change. Generate a new requestId for a new change; reuse a requestId only to retry the exact same change.');
    this.name = 'RequestIdReusedError';
    this.code = 'request_id_reused';
  }
}

export function validateRequestId(value) {
  if (typeof value !== 'string' || !REQUEST_ID_PATTERN.test(value)) {
    throw new ValidationError(REQUEST_ID_MESSAGE, { field: 'requestId' });
  }
  return value;
}

// JSON with object keys sorted at every depth, so the same arguments always hash the same no
// matter the key order the caller sent. Same value rules as JSON.stringify (undefined object
// members are dropped, non-finite numbers become null).
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    const text = JSON.stringify(value);
    return text === undefined ? 'null' : text;
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
  return '{' + keys.map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
}

export function hashableArgs(args) {
  const out = {};
  Object.keys(args || {}).forEach((key) => {
    if (!UNHASHED_ARG_KEYS.has(key)) out[key] = args[key];
  });
  return out;
}

export async function argsHash(args, cryptoImpl = globalThis.crypto) {
  const bytes = new TextEncoder().encode(canonicalJson(hashableArgs(args)));
  const digest = new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

// What the write changes, as the undo input. The operations never mutate a stored record in place:
// a changed record is a NEW object and an untouched one keeps its reference (slice/filter/concat),
// so "not present by reference in the written array" is exactly "changed or removed". A record the
// write only ADDS (record_ready_food) has no before state and is not listed.
export function beforeSnapshot(doc, write) {
  const paths = new Set(write.fieldPaths);
  const out = { pantry: [], cookedMeals: [], deletions: {} };
  SNAPSHOT_FIELDS.forEach((field) => {
    if (!paths.has(field)) return;
    const kept = new Set(write.fields[field] || []);
    out[field] = (doc[field] || []).filter((record) => !kept.has(record));
  });
  SNAPSHOT_FIELDS.forEach((bucket) => {
    if (!paths.has('deletions.' + bucket)) return;
    const prior = (doc.deletions && doc.deletions[bucket]) || {};
    const next = (write.fields.deletions && write.fields.deletions[bucket]) || {};
    const touched = {};
    Object.keys(next).forEach((key) => {
      const had = Object.hasOwn(prior, key);
      if (!had || prior[key] !== next[key]) touched[key] = had ? prior[key] : null;
    });
    Object.keys(prior).forEach((key) => {
      if (!Object.hasOwn(next, key)) touched[key] = prior[key];
    });
    if (Object.keys(touched).length) out.deletions[bucket] = touched;
  });
  return out;
}

// What the write ADDS, as the other half of the undo input (review should-fix 1): every record in
// a written array whose id was not in the stored array — a new ready-food batch, or the ledger fact
// consume_ready_food appends to mealConsumptions (TASK-095 compensates for it instead of guessing
// it back from cookedMealId + consumedAt). Changed records keep their id and are in `before`.
const ADDED_FIELDS = ['pantry', 'cookedMeals', 'mealConsumptions'];

export function addedRecords(doc, write) {
  const paths = new Set(write.fieldPaths);
  const out = {};
  ADDED_FIELDS.forEach((field) => {
    if (!paths.has(field)) return;
    // Only text or finite-number ids are compared (String() on a stored map id throws).
    const ids = new Set((doc[field] || []).filter((r) => r && readableId(r.id)).map((r) => String(r.id)));
    const added = (write.fields[field] || []).filter((r) => r && readableId(r.id) && !ids.has(String(r.id)));
    if (added.length) out[field] = added;
  });
  return out;
}

export const EMPTY_BEFORE = Object.freeze({ pantry: [], cookedMeals: [], deletions: {} });

export function buildRequestRecord({ tool, argsHash: hash, actor, nowMs, revisionBefore, revisionAfter, result, before, added }) {
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) throw new Error('A request record needs a finite clock.');
  return {
    tool,
    argsHash: hash,
    actor,
    createdAt: new Date(nowMs).toISOString(),
    expireAt: new Date(nowMs + REQUEST_RETENTION_DAYS * DAY_MS).toISOString(),
    revisionBefore,
    revisionAfter,
    result,
    before,
    added: added || {}
  };
}

// A stored record answers a retry only when it is the SAME change: same tool, same canonical
// arguments. Anything else is a reused id and changes nothing.
export function replayResult(stored, tool, hash) {
  if (!stored || stored.tool !== tool || stored.argsHash !== hash ||
      !stored.result || typeof stored.result !== 'object' || Array.isArray(stored.result)) {
    throw new RequestIdReusedError();
  }
  return Object.assign({}, stored.result, { replayed: true });
}
