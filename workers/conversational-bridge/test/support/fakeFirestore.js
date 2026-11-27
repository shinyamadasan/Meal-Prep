// In-memory stand-in for the Firestore REST API's `users/{uid}` document — the single shared
// "canonical store" every test (bridge writes, simulated app-side writes, consistency checks)
// reads and writes through. Faithful enough to matter: honors updateMask.fieldPaths (including
// dotted nested paths like `deletions.pantry`), the currentDocument.updateTime precondition
// (returning the real Firestore FAILED_PRECONDITION shape on mismatch), and 404 on a
// not-yet-created document. Never touches the network.
//
// TASK-093: also models the `users/{uid}/mcpRequests/{requestId}` subcollection (kept in
// `requests`, outside `store`, so whole-store comparisons with REST still hold) and the atomic
// `documents:commit` the MCP write tools use: every write's precondition is checked first, then all
// writes apply or none do. `commits` counts successful commits.
import { encodeFields, decodeFields } from '../../src/firestore.js';

const REQUEST_PATH = /\/documents\/users\/[^/]+\/mcpRequests\/([^/]+)$/;
const USER_PATH = /\/documents\/users\/[^/]+$/;

export function createFakeFirestore(initial = {}) {
  const store = {
    exists: initial.exists !== false,
    fields: Object.assign({ version: 0, pantry: [], cookedMeals: [], deletions: {} }, initial.fields || {}),
    updateTime: initial.updateTime || '2026-01-01T00:00:00.000000Z'
  };
  const requests = new Map(); // requestId -> { fields (wire-encoded), createTime }
  const counters = { commits: 0 };
  let tick = 0;

  function nextUpdateTime() {
    tick += 1;
    return '2026-01-01T00:' + String(tick).padStart(2, '0') + ':00.000000Z';
  }

  function setAtPath(root, path, value) {
    const parts = path.split('.');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (typeof node[parts[i]] !== 'object' || node[parts[i]] == null) node[parts[i]] = {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = value;
  }

  function getAtPath(root, path) {
    return path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), root);
  }

  function respond(status, body) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }

  async function fetchImpl(url, init = {}) {
    const parsed = new URL(url);

    if (parsed.hostname === 'oauth2.googleapis.com') {
      return respond(200, { access_token: 'fake-access-token', expires_in: 3600 });
    }
    const method = (init.method || 'GET').toUpperCase();

    if (parsed.pathname.endsWith('/documents:commit') && method === 'POST') return commit(init);

    const requestMatch = parsed.pathname.match(REQUEST_PATH);
    if (requestMatch) {
      if (method !== 'GET') return respond(405, { error: { code: 405, status: 'INVALID_ARGUMENT', message: 'Unsupported method in fake.' } });
      const entry = requests.get(decodeURIComponent(requestMatch[1]));
      if (!entry) return respond(404, { error: { code: 404, status: 'NOT_FOUND', message: 'Document not found.' } });
      return respond(200, { fields: entry.fields, createTime: entry.createTime, updateTime: entry.updateTime || entry.createTime });
    }

    if (!parsed.pathname.includes('/documents/users/')) {
      return respond(404, { error: { code: 404, status: 'NOT_FOUND', message: 'Unknown fake route: ' + parsed.pathname } });
    }

    if (method === 'GET') {
      if (!store.exists) return respond(404, { error: { code: 404, status: 'NOT_FOUND', message: 'Document not found.' } });
      return respond(200, { fields: encodeFields(store.fields), updateTime: store.updateTime });
    }

    if (method === 'PATCH') {
      const fieldPaths = parsed.searchParams.getAll('updateMask.fieldPaths');
      const expectedUpdateTime = parsed.searchParams.get('currentDocument.updateTime');
      const expectNotExists = parsed.searchParams.get('currentDocument.exists') === 'false';

      if (expectNotExists && store.exists) {
        return respond(400, { error: { code: 400, status: 'FAILED_PRECONDITION', message: 'Document already exists.' } });
      }
      if (expectedUpdateTime && (!store.exists || store.updateTime !== expectedUpdateTime)) {
        return respond(400, { error: { code: 400, status: 'FAILED_PRECONDITION', message: 'updateTime mismatch — document was modified.' } });
      }

      let body;
      try {
        body = JSON.parse(init.body || '{}');
      } catch (e) {
        return respond(400, { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Malformed patch body.' } });
      }
      const decodedPatch = decodeFields(body.fields || {});
      fieldPaths.forEach((path) => setAtPath(store.fields, path, getAtPath(decodedPatch, path)));
      store.exists = true;
      store.updateTime = nextUpdateTime();
      return respond(200, { fields: encodeFields(store.fields), updateTime: store.updateTime });
    }

    return respond(405, { error: { code: 405, status: 'INVALID_ARGUMENT', message: 'Unsupported method in fake: ' + method } });
  }

  function commit(init) {
    let body;
    try {
      body = JSON.parse(init.body || '{}');
    } catch (e) {
      return respond(400, { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Malformed commit body.' } });
    }
    const writes = Array.isArray(body.writes) ? body.writes : [];
    const planned = [];
    for (const write of writes) {
      const name = write.update && write.update.name;
      const pre = write.currentDocument || {};
      const requestMatch = typeof name === 'string' && name.match(REQUEST_PATH);
      if (requestMatch) {
        const exists = requests.has(requestMatch[1]);
        if (pre.exists === false && exists) {
          return respond(409, { error: { code: 409, status: 'ALREADY_EXISTS', message: 'Document already exists.' } });
        }
        // TASK-095: a masked field update of an existing record under its updateTime (undoneBy).
        if (pre.updateTime) {
          const entry = requests.get(requestMatch[1]);
          if (!entry || (entry.updateTime || entry.createTime) !== pre.updateTime) {
            return respond(400, { error: { code: 400, status: 'FAILED_PRECONDITION', message: 'updateTime mismatch — request record was modified.' } });
          }
          planned.push({ kind: 'requestUpdate', id: requestMatch[1], fieldPaths: (write.updateMask && write.updateMask.fieldPaths) || [], fields: write.update.fields || {} });
          continue;
        }
        planned.push({ kind: 'request', id: requestMatch[1], fields: write.update.fields || {} });
      } else if (typeof name === 'string' && USER_PATH.test(name)) {
        if (pre.exists === false && store.exists) {
          return respond(400, { error: { code: 400, status: 'FAILED_PRECONDITION', message: 'Document already exists.' } });
        }
        if (pre.updateTime && (!store.exists || store.updateTime !== pre.updateTime)) {
          return respond(400, { error: { code: 400, status: 'FAILED_PRECONDITION', message: 'updateTime mismatch — document was modified.' } });
        }
        planned.push({ kind: 'user', fieldPaths: (write.updateMask && write.updateMask.fieldPaths) || [], fields: decodeFields(write.update.fields || {}) });
      } else {
        return respond(400, { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Unknown fake commit target.' } });
      }
    }
    const commitTime = nextUpdateTime();
    const writeResults = planned.map((p) => {
      if (p.kind === 'request') {
        requests.set(p.id, { fields: p.fields, createTime: commitTime, updateTime: commitTime });
      } else if (p.kind === 'requestUpdate') {
        const entry = requests.get(p.id);
        const fields = Object.assign({}, entry.fields);
        p.fieldPaths.forEach((path) => { fields[path] = p.fields[path]; });
        requests.set(p.id, { fields, createTime: entry.createTime, updateTime: commitTime });
      } else {
        p.fieldPaths.forEach((path) => setAtPath(store.fields, path, getAtPath(p.fields, path)));
        store.exists = true;
        store.updateTime = commitTime;
      }
      return { updateTime: commitTime };
    });
    counters.commits += 1;
    return respond(200, { writeResults, commitTime });
  }

  // Decoded request record (timestamps as RFC 3339 strings), or undefined.
  function requestRecord(requestId) {
    const entry = requests.get(requestId);
    return entry ? decodeFields(entry.fields) : undefined;
  }

  return { store, fetch: fetchImpl, requests, requestRecord, counters };
}

// Simulates what the APP would have written on its own next `saveToFirestore()` — a full-field
// mutation of pantry/cookedMeals/deletions plus a version bump — WITHOUT going through the
// bridge at all. Used by the app<->bridge consistency suite to prove there is one shared truth
// store, not two competing models.
export function simulateAppWrite(fake, mutate) {
  const next = JSON.parse(JSON.stringify(fake.store.fields));
  mutate(next);
  fake.store.fields = next;
  fake.store.exists = true;
  fake.store.fields.version = (fake.store.fields.version || 0) + 1;
  fake.store.updateTime = '2026-01-01T09:' + String(fake.store.fields.version).padStart(2, '0') + ':00.000000Z';
}
