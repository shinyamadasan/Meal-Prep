// In-memory stand-in for the Firestore REST API's `users/{uid}` document — the single shared
// "canonical store" every test (bridge writes, simulated app-side writes, consistency checks)
// reads and writes through. Faithful enough to matter: honors updateMask.fieldPaths (including
// dotted nested paths like `deletions.pantry`), the currentDocument.updateTime precondition
// (returning the real Firestore FAILED_PRECONDITION shape on mismatch), and 404 on a
// not-yet-created document. Never touches the network.
import { encodeFields, decodeFields } from '../../src/firestore.js';

export function createFakeFirestore(initial = {}) {
  const store = {
    exists: initial.exists !== false,
    fields: Object.assign({ version: 0, pantry: [], cookedMeals: [], deletions: {} }, initial.fields || {}),
    updateTime: initial.updateTime || '2026-01-01T00:00:00.000000Z'
  };
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
    if (!parsed.pathname.includes('/documents/users/')) {
      return respond(404, { error: { code: 404, status: 'NOT_FOUND', message: 'Unknown fake route: ' + parsed.pathname } });
    }

    const method = (init.method || 'GET').toUpperCase();

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

  return { store, fetch: fetchImpl };
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
