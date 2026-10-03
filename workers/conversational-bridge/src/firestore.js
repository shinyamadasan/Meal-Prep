// Firestore REST v1 transport: typed-value codec + a narrow client scoped to the single
// `users/{uid}` document this bridge is allowed to touch. No arbitrary path/collection ever
// reaches this module — callers pass only `env.TARGET_UID` (baked in by auth.js) and a fixed
// field mask (`pantry`, `cookedMeals`, `mealConsumptions`, `deletions`, `version`).
//
// Firestore REST represents every value as a typed wrapper (stringValue, integerValue as a
// STRING, doubleValue, booleanValue, nullValue, arrayValue, mapValue). encodeValue/decodeValue
// round-trip plain JS <-> that wire shape so the operations layer never has to think about it.

const FIRESTORE_HOST = 'https://firestore.googleapis.com';
const BRIDGE_FIELD_PATHS = ['pantry', 'cookedMeals', 'mealConsumptions', 'deletions', 'version'];

export class InfrastructureError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'InfrastructureError';
    this.code = 'infrastructure_error';
    this.cause = cause;
  }
}

export class RevisionConflictError extends Error {
  constructor(current) {
    super('Document was modified since it was read.');
    this.name = 'RevisionConflictError';
    this.code = 'revision_conflict';
    this.current = current; // { revision, pantry, cookedMeals, deletions }
  }
}

export function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: value.length ? { values: value.map(encodeValue) } : {} };
  }
  if (typeof value === 'object') {
    return { mapValue: { fields: encodeFields(value) } };
  }
  throw new InfrastructureError('Cannot encode value of type ' + typeof value + ' for Firestore.');
}

export function encodeFields(obj) {
  const fields = {};
  Object.keys(obj || {}).forEach((key) => {
    if (obj[key] === undefined) return; // Firestore rejects undefined; drop rather than send it
    fields[key] = encodeValue(obj[key]);
  });
  return fields;
}

export function decodeValue(wrapped) {
  if (wrapped == null) return null;
  if ('nullValue' in wrapped) return null;
  if ('stringValue' in wrapped) return wrapped.stringValue;
  if ('booleanValue' in wrapped) return wrapped.booleanValue;
  if ('integerValue' in wrapped) return parseInt(wrapped.integerValue, 10);
  if ('doubleValue' in wrapped) return wrapped.doubleValue;
  if ('timestampValue' in wrapped) return wrapped.timestampValue;
  if ('arrayValue' in wrapped) return (wrapped.arrayValue.values || []).map(decodeValue);
  if ('mapValue' in wrapped) return decodeFields(wrapped.mapValue.fields || {});
  return null;
}

export function decodeFields(fields) {
  const out = {};
  Object.keys(fields || {}).forEach((key) => { out[key] = decodeValue(fields[key]); });
  return out;
}

function documentPath(env) {
  return 'projects/' + env.FIRESTORE_PROJECT_ID + '/databases/(default)/documents/users/' + env.TARGET_UID;
}

function documentUrl(env, extraParams) {
  const url = new URL(FIRESTORE_HOST + '/v1/' + documentPath(env));
  BRIDGE_FIELD_PATHS.forEach((p) => url.searchParams.append('mask.fieldPaths', p));
  Object.keys(extraParams || {}).forEach((k) => url.searchParams.set(k, extraParams[k]));
  return url;
}

async function readErrorBody(response) {
  try {
    const data = await response.json();
    return (data && data.error && data.error.status) || null;
  } catch (e) {
    return null;
  }
}

// Absent -> []. Present but not an array is passed through as-is (NOT coerced to []) so a consume
// can refuse to overwrite it rather than silently destroy unexpected data.
function decodeMealConsumptions(value) {
  return value == null ? [] : value;
}

// Reads the bridge-scoped slice of the user's document. A missing document (never yet saved
// by the app) decodes as an empty, version-0 shell rather than an error — there is nothing to
// read or conflict with yet.
export async function getUserDocument(env, accessToken, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl(documentUrl(env).toString(), {
      headers: { Authorization: 'Bearer ' + accessToken }
    });
  } catch (cause) {
    throw new InfrastructureError('Firestore read failed.', cause);
  }

  if (response.status === 404) {
    return { exists: false, revision: 0, updateTime: null, pantry: [], cookedMeals: [], mealConsumptions: [], deletions: {} };
  }
  if (!response.ok) {
    const status = await readErrorBody(response);
    throw new InfrastructureError('Firestore read failed (' + (status || response.status) + ').');
  }

  let doc;
  try {
    doc = await response.json();
  } catch (cause) {
    throw new InfrastructureError('Firestore returned an unreadable document.', cause);
  }
  const fields = decodeFields(doc.fields || {});
  return {
    exists: true,
    revision: typeof fields.version === 'number' ? fields.version : 0,
    updateTime: doc.updateTime || null,
    pantry: Array.isArray(fields.pantry) ? fields.pantry : [],
    cookedMeals: Array.isArray(fields.cookedMeals) ? fields.cookedMeals : [],
    mealConsumptions: decodeMealConsumptions(fields.mealConsumptions),
    deletions: fields.deletions && typeof fields.deletions === 'object' ? fields.deletions : {}
  };
}

// Applies a narrow PATCH: only `updateMask.fieldPaths` are touched, and the write is guarded by
// `currentDocument.updateTime` so the whole check-then-set is atomic at the Firestore protocol
// level (D-082) rather than a separate read-then-hope race in our own code. On a precondition
// failure we re-read the live document and surface it as a RevisionConflictError so the caller
// gets fresh state to retry against, per the operation contract.
export async function patchUserDocument(env, accessToken, { fieldPaths, fields, expectedUpdateTime, nextVersion }, fetchImpl = fetch) {
  const patchFields = Object.assign({}, fields, { version: nextVersion });
  const url = documentUrl(env);
  fieldPaths.concat(['version']).forEach((p) => url.searchParams.append('updateMask.fieldPaths', p));
  if (expectedUpdateTime) url.searchParams.set('currentDocument.updateTime', expectedUpdateTime);
  else url.searchParams.set('currentDocument.exists', 'false');

  let response;
  try {
    response = await fetchImpl(url.toString(), {
      method: 'PATCH',
      headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: encodeFields(patchFields) })
    });
  } catch (cause) {
    throw new InfrastructureError('Firestore write failed.', cause);
  }

  if (!response.ok) {
    // FAILED_PRECONDITION is Firestore's exact error status for a currentDocument guard
    // (updateTime mismatch or unexpected exists/not-exists) — the one case that means someone
    // else wrote first, not that our request was malformed. Re-read and surface fresh state so
    // the caller can decide whether to retry (D-082 concurrency model). Anything else (bad
    // request shape, auth failure re-surfacing here, transient 5xx) is a real infrastructure
    // failure and must not be reinterpreted as a conflict.
    const status = await readErrorBody(response);
    if (status === 'FAILED_PRECONDITION' || status === 'ABORTED') {
      const current = await getUserDocument(env, accessToken, fetchImpl);
      throw new RevisionConflictError(current);
    }
    throw new InfrastructureError('Firestore write failed (' + (status || response.status) + ').');
  }

  let doc;
  try {
    doc = await response.json();
  } catch (cause) {
    throw new InfrastructureError('Firestore returned an unreadable document after write.', cause);
  }
  const decoded = decodeFields(doc.fields || {});
  return {
    exists: true,
    revision: typeof decoded.version === 'number' ? decoded.version : nextVersion,
    updateTime: doc.updateTime || null,
    pantry: Array.isArray(decoded.pantry) ? decoded.pantry : [],
    cookedMeals: Array.isArray(decoded.cookedMeals) ? decoded.cookedMeals : [],
    mealConsumptions: decodeMealConsumptions(decoded.mealConsumptions),
    deletions: decoded.deletions && typeof decoded.deletions === 'object' ? decoded.deletions : {}
  };
}
