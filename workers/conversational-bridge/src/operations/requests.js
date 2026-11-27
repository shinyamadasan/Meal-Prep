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
// Firestore TTL policy) covers both uses. TASK-095 adds `after` (the after-state undo compares
// against) and the pure undo planner at the end of this file.
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

// `unhashed` is the set of keys left out. undo_request (TASK-095) names its OWN id `undoRequestId`
// and uses `requestId` for the request it undoes, so it passes UNDO_UNHASHED_ARG_KEYS.
export function hashableArgs(args, unhashed = UNHASHED_ARG_KEYS) {
  const out = {};
  Object.keys(args || {}).forEach((key) => {
    if (!unhashed.has(key)) out[key] = args[key];
  });
  return out;
}

export const UNDO_UNHASHED_ARG_KEYS = new Set(['undoRequestId', 'expectedRevision']);

export async function argsHash(args, cryptoImpl = globalThis.crypto, unhashed = UNHASHED_ARG_KEYS) {
  const bytes = new TextEncoder().encode(canonicalJson(hashableArgs(args, unhashed)));
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

// The after-state of the same records (TASK-095): a full copy of every pantry / cookedMeals record
// the write changed or added (removed records are absent), plus the value the write left in every
// tombstone entry beforeSnapshot() lists (null = no tombstone). Undo compares the live document
// with this and refuses when anything changed since the request.
export function afterSnapshot(doc, write) {
  const paths = new Set(write.fieldPaths);
  const out = { pantry: [], cookedMeals: [], deletions: {} };
  SNAPSHOT_FIELDS.forEach((field) => {
    if (!paths.has(field)) return;
    const stored = new Set(doc[field] || []);
    out[field] = (write.fields[field] || []).filter((record) => !stored.has(record));
  });
  const before = beforeSnapshot(doc, write);
  SNAPSHOT_FIELDS.forEach((bucket) => {
    const touched = before.deletions[bucket];
    if (!touched) return;
    const next = (write.fields.deletions && write.fields.deletions[bucket]) || {};
    const values = {};
    Object.keys(touched).forEach((key) => { values[key] = Object.hasOwn(next, key) ? next[key] : null; });
    out.deletions[bucket] = values;
  });
  return out;
}

export const EMPTY_BEFORE = Object.freeze({ pantry: [], cookedMeals: [], deletions: {} });
export const EMPTY_AFTER = EMPTY_BEFORE;

export function buildRequestRecord({ tool, argsHash: hash, actor, nowMs, revisionBefore, revisionAfter, result, before, added, after, undoes }) {
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
    added: added || {},
    after: after || EMPTY_AFTER,
    // undo_request only: the requestId it undid.
    ...(undoes ? { undoes } : {})
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

// ---- Undo (TASK-095, PROP-041 P1-5; owner decisions 3 and 5) ---------------------------------
// planUndo() is pure: from the stored request record, the live user document and the clock it
// builds the ONE write that puts back the request's `before` state, or throws UndoRefusedError
// (nothing written). It restores only while every affected record is exactly as the request left
// it (its `after` copy), and a removed record comes back only while its id is still unused:
//   - changed record -> its `before` copy, `updatedAt` restamped (so a stale synced copy loses the
//     app's updatedAt merge, D-020);
//   - removed record -> its `before` copy re-inserted with the same id, `updatedAt` restamped and
//     its tombstone deleted (the app's restore, D-083);
//   - added record   -> removed with a fresh tombstone (D-071), only while untouched since and, for
//     a ready-food batch, only while no meal-consumption fact refers to it;
//   - any other tombstone entry the request touched -> its prior value exactly (null = absent).
// A `mealConsumptions` ledger fact is never deleted or edited. LEDGER_CONTRACT.md / the ChronaSense
// contract make the ledger append-only with a closed six-field schema whose portionsConsumed is
// 1..99, so there is no compensating (negative) fact either: a request that appended a fact
// (consume_ready_food) cannot be undone from chat.

export const UNDO_TOOL = 'undo_request';
const NOT_UNDOABLE_TOOLS = new Set(['consume_ready_food']);

export class UndoRefusedError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = 'UndoRefusedError';
    this.code = 'undo_refused';
    this.reason = reason;
  }
}

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function same(a, b) {
  return canonicalJson(a) === canonicalJson(b);
}

// A record the request ADDED is unchanged when it deep-equals the copy the request wrote. One
// exception (TASK-095 review must-fix): record_ready_food writes its batch without `updatedAt`, and
// the app stamps one on load and saves it back (loadFromFirestore + autosave), so when the written
// copy had no `updatedAt` a live `updatedAt` alone is not a change. Every other field must match.
function sameAdded(live, written) {
  if (written == null || typeof written !== 'object' || written.updatedAt != null) return same(live, written);
  if (!isPlainObject(live)) return false;
  const { updatedAt: _ignored, ...rest } = live;
  return same(rest, written);
}

function snapshotShapeOk(snapshot) {
  return isPlainObject(snapshot) &&
    SNAPSHOT_FIELDS.every((field) => Array.isArray(snapshot[field]) &&
      snapshot[field].every((r) => isPlainObject(r) && readableId(r.id))) &&
    isPlainObject(snapshot.deletions) &&
    Object.keys(snapshot.deletions).every((bucket) => SNAPSHOT_FIELDS.includes(bucket) && isPlainObject(snapshot.deletions[bucket]));
}

function incomplete(requestId, why) {
  return new UndoRefusedError('undo_record_incomplete', 'The record of request "' + requestId + '" ' + why +
    ', so it cannot be undone safely. Nothing was changed; fix it in the app.');
}

// Record-level checks, made before the user document is read.
export function checkUndoable(record, requestId, nowMs) {
  if (!isPlainObject(record)) {
    throw new UndoRefusedError('request_not_found', 'No chat request "' + requestId + '" is on record (it never ' +
      'committed, or it is older than ' + REQUEST_RETENTION_DAYS + ' days). Nothing was changed.');
  }
  const expireMs = typeof record.expireAt === 'string' ? Date.parse(record.expireAt) : NaN;
  if (!Number.isFinite(expireMs)) throw incomplete(requestId, 'has no readable expiry');
  if (!Number.isFinite(nowMs) || nowMs >= expireMs) {
    throw new UndoRefusedError('undo_expired', 'Request "' + requestId + '" is older than ' + REQUEST_RETENTION_DAYS +
      ' days and can no longer be undone. Nothing was changed; fix it in the app.');
  }
  if (record.tool === UNDO_TOOL) {
    throw new UndoRefusedError('undo_of_undo', 'Request "' + requestId + '" is itself an undo, and an undo cannot be ' +
      'undone from chat. Nothing was changed; make the change again as a new request.');
  }
  if (record.undoneBy != null) {
    throw new UndoRefusedError('already_undone', 'Request "' + requestId + '" was already undone (by "' +
      String(record.undoneBy) + '"). Nothing was changed.');
  }
  if (Number.isInteger(record.revisionBefore) && record.revisionBefore === record.revisionAfter) {
    throw new UndoRefusedError('nothing_to_undo', 'Request "' + requestId + '" changed nothing (for example the ' +
      'item was already out or already in stock), so there is nothing to undo.');
  }
  const addedFacts = isPlainObject(record.added) && Array.isArray(record.added.mealConsumptions) && record.added.mealConsumptions.length > 0;
  if (NOT_UNDOABLE_TOOLS.has(record.tool) || addedFacts) {
    throw new UndoRefusedError('undo_not_supported', 'Request "' + requestId + '" recorded food that was eaten. ' +
      'Eaten-meal history is permanent and cannot be undone from chat, so nothing was changed. Correct the ' +
      'ready-food portions in the app if needed.');
  }
  if (typeof record.tool !== 'string' || !Number.isInteger(record.revisionBefore) || !Number.isInteger(record.revisionAfter) ||
      !snapshotShapeOk(record.before) || !snapshotShapeOk(record.after) || !isPlainObject(record.added)) {
    throw incomplete(requestId, 'does not hold everything needed to undo it');
  }
}

function changedSince(requestId, what) {
  return new UndoRefusedError('changed_since', what + ' changed after request "' + requestId + '", so undoing it ' +
    'would overwrite the newer change. Nothing was changed; fix it in the app or with a new request.');
}

export function planUndo(record, doc, requestId, nowMs) {
  checkUndoable(record, requestId, nowMs);
  const nowIso = new Date(nowMs).toISOString();
  const fieldPaths = [];
  const fields = {};
  const deletions = {};
  const restored = [];
  const removed = [];

  SNAPSHOT_FIELDS.forEach((field) => {
    const before = record.before[field];
    const after = record.after[field];
    const added = Array.isArray(record.added[field]) ? record.added[field] : [];
    const beforeIds = new Set(before.map((r) => String(r.id)));
    const afterById = new Map(after.map((r) => [String(r.id), r]));
    const addedIds = new Set(added.filter((r) => isPlainObject(r) && readableId(r.id)).map((r) => String(r.id)));
    if (beforeIds.size !== before.length || afterById.size !== after.length) throw incomplete(requestId, 'lists one record twice');

    const current = Array.isArray(doc[field]) ? doc[field] : [];
    const at = (id) => current.reduce((acc, r, i) => (r && readableId(r.id) && String(r.id) === id ? acc.concat(i) : acc), []);
    const replace = new Map(); // index in current -> restored record
    const drop = new Set();    // index in current
    const revive = [];

    before.forEach((prior) => {
      const id = String(prior.id);
      const found = at(id);
      const restoredRecord = Object.assign({}, prior, { updatedAt: nowIso });
      if (afterById.has(id)) {
        if (found.length !== 1 || !same(current[found[0]], afterById.get(id))) throw changedSince(requestId, 'The ' + field + ' record "' + id + '"');
        replace.set(found[0], restoredRecord);
      } else {
        if (found.length) {
          throw new UndoRefusedError('id_in_use', 'The ' + field + ' record "' + id + '" that request "' + requestId +
            '" removed is in use again, so it cannot be restored. Nothing was changed.');
        }
        revive.push(restoredRecord);
      }
      restored.push({ collection: field, id });
    });

    after.forEach((written) => {
      const id = String(written.id);
      if (beforeIds.has(id)) return;
      if (!addedIds.has(id)) throw incomplete(requestId, 'is inconsistent (an after-state record with no before-state)');
      const found = at(id);
      if (found.length !== 1 || !sameAdded(current[found[0]], written)) throw changedSince(requestId, 'The ' + field + ' record "' + id + '"');
      if (field === 'cookedMeals') {
        if (!Array.isArray(doc.mealConsumptions)) throw incomplete(requestId, 'cannot be checked against unreadable meal history');
        if (doc.mealConsumptions.some((f) => f && f.cookedMealId != null && String(f.cookedMealId) === id)) {
          throw changedSince(requestId, 'Ready food "' + id + '" was eaten from: it');
        }
      }
      drop.add(found[0]);
      removed.push({ collection: field, id });
    });

    // Tombstones: every entry the request touched must still hold the value the request left.
    const priorTomb = record.before.deletions[field] || {};
    const afterTomb = record.after.deletions[field] || {};
    const keys = Object.keys(afterTomb);
    if (keys.length !== Object.keys(priorTomb).length || keys.some((k) => !Object.hasOwn(priorTomb, k))) {
      throw incomplete(requestId, 'is inconsistent (removal records)');
    }
    const live = isPlainObject(doc.deletions) && isPlainObject(doc.deletions[field]) ? doc.deletions[field] : {};
    const liveValue = (key) => (Object.hasOwn(live, key) ? live[key] : null);
    keys.forEach((key) => {
      if (!same(liveValue(key), afterTomb[key])) throw changedSince(requestId, 'The removal record for "' + key + '"');
    });
    const revivedIds = new Set(revive.map((r) => String(r.id)));
    revivedIds.forEach((id) => {
      if (!Object.hasOwn(afterTomb, id) && liveValue(id) != null) throw changedSince(requestId, 'The removal record for "' + id + '"');
    });

    const nextTomb = Object.assign({}, live);
    let tombChanged = false;
    const setTomb = (key, value) => {
      if (value == null) {
        if (Object.hasOwn(nextTomb, key)) { delete nextTomb[key]; tombChanged = true; }
      } else if (!Object.hasOwn(nextTomb, key) || !same(nextTomb[key], value)) {
        nextTomb[key] = value;
        tombChanged = true;
      }
    };
    keys.forEach((key) => setTomb(key, revivedIds.has(key) ? null : priorTomb[key]));
    revivedIds.forEach((id) => setTomb(id, null));
    drop.forEach((index) => setTomb(String(current[index].id), nowIso));

    if (replace.size || drop.size || revive.length) {
      fieldPaths.push(field);
      fields[field] = current
        .map((r, i) => (replace.has(i) ? replace.get(i) : r))
        .filter((_, i) => !drop.has(i))
        .concat(revive);
    }
    if (tombChanged) {
      fieldPaths.push('deletions.' + field);
      deletions[field] = nextTomb;
    }
  });

  if (!fieldPaths.length) {
    throw new UndoRefusedError('nothing_to_undo', 'Request "' + requestId + '" left nothing that can be put back, so there is nothing to undo.');
  }
  if (Object.keys(deletions).length) fields.deletions = deletions;
  return { write: { fieldPaths, fields }, restored, removed };
}
