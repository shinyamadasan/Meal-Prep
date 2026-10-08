// Server-side equivalents of the ready-food (cookedMeals) UI functions in app.js:
// _doMarkCooked() (record shape only — see note below), useCookedPortion()/removeCookedMeal()
// (consume), and finishCookedMeal() (finish).
//
// SCOPE NOTE (D-082 decision #4: a write targets ONE in-scope collection only, never both):
// `record` creates a cookedMeals row but deliberately does NOT reimplement _doMarkCooked()'s
// pantry-ingredient deduction — that would require writing pantry AND cookedMeals in the same
// operation, which the architecture forbids. This is an intentional scope narrowing, not a
// missed behavior; recorded in CHANGELOG.md.
//
// TOMBSTONE NOTE (D-071): removeCookedMeal() itself does not call writeTombstone() — the
// client's recordLocalDeletions() detects the vanished id by diffing an in-memory baseline on
// the NEXT saveToFirestore() call. The bridge has no such baseline across stateless requests, so
// `consume` (exact-remainder) and `finish` write the cookedMeals tombstone explicitly and
// immediately, the same way TASK-065 already requires for pantry's mark-out-of-stock. This
// preserves D-071's actual invariant (a removed record must not be resurrected by a union merge
// from a stale synced copy) rather than the specific code path that happens to produce it
// client-side.
import { NotFoundError, ValidationError, InsufficientServingsError } from '../errors.js';
import '../../../../shared/readyFoodContract.js';

const READY_FOOD_CONTRACT = globalThis.MealPrepReadyFoodContract;
export const READY_FOOD_SOURCES = READY_FOOD_CONTRACT.sources;

const PORTION_COUNT_MAX = 99;
const VALID_STORAGE = ['fridge', 'freezer'];
const MAX_NAME_LENGTH = 200;

function tracksPortions(meal) {
  return meal != null && meal.portionsRemaining != null && Number.isFinite(Number(meal.portionsRemaining));
}

function toReadyFoodItem(meal) {
  return {
    cookedMealId: String(meal.id),
    recipeId: meal.recipeId != null ? String(meal.recipeId) : null,
    source: meal.source != null ? meal.source : null,
    name: meal.name != null ? meal.name : null,
    servingsRemaining: tracksPortions(meal) ? meal.portionsRemaining : null,
    trackedPortions: tracksPortions(meal),
    storage: meal.storage || 'fridge',
    cookedDate: meal.cookedDate != null ? meal.cookedDate : null,
    updatedAt: meal.updatedAt != null ? meal.updatedAt : null
  };
}

export function listReadyFood(cookedMeals) {
  return (cookedMeals || []).map(toReadyFoodItem);
}

function findMealIndex(cookedMeals, cookedMealId) {
  return cookedMeals.findIndex((m) => m && String(m.id) === String(cookedMealId));
}

function validateServings(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ValidationError(field + ' must be a whole number between 1 and ' + PORTION_COUNT_MAX + '.', { field });
  }
  const n = Math.floor(value);
  if (n < 1 || n > PORTION_COUNT_MAX) {
    throw new ValidationError(field + ' must be a whole number between 1 and ' + PORTION_COUNT_MAX + '.', { field });
  }
  return n;
}

function validateStorage(storage) {
  if (!VALID_STORAGE.includes(storage)) {
    throw new ValidationError('storage must be one of: ' + VALID_STORAGE.join(', ') + '.', { field: 'storage' });
  }
}

function validateName(name) {
  if (typeof name !== 'string' || !name.trim() || name.length > MAX_NAME_LENGTH) {
    throw new ValidationError('name must be a non-empty string of ' + MAX_NAME_LENGTH + ' characters or fewer.', { field: 'name' });
  }
}

// A stateless Worker has no "local timezone" of its own — only the caller (the conversational
// client resolving what the human actually meant by "today"/"yesterday") can know the user's
// intended calendar date. So `cookedDate` is a REQUIRED, caller-supplied `YYYY-MM-DD` string,
// validated as a real calendar date, never derived from `new Date()` server-side (D-082 addendum,
// corrected after independent review — an earlier draft used the Worker's own UTC date, which
// could silently shift `cookedDate` by a day versus app.js's `todayISO()`, a LOCAL-calendar-date
// helper). Rejects both malformed shapes (regex) and impossible dates (e.g. 2024-02-30, which the
// regex alone would accept) by round-tripping through Date.UTC() and checking every component.
function validateCookedDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError('cookedDate must be a YYYY-MM-DD calendar date string.', { field: 'cookedDate' });
  }
  const [year, month, day] = value.split('-').map(Number);
  const asDate = new Date(Date.UTC(year, month - 1, day));
  const roundTrips = asDate.getUTCFullYear() === year && asDate.getUTCMonth() === month - 1 && asDate.getUTCDate() === day;
  if (!roundTrips) {
    throw new ValidationError('cookedDate "' + value + '" is not a real calendar date.', { field: 'cookedDate' });
  }
  return value;
}

// Always creates a TRACKED batch (initialPortions === portionsRemaining === servings) —
// `servings` and `expectedRevision` are both required, no exceptions, which is what makes a
// lost-response retry of this create safe (D-082 idempotency model): a retry under the same
// stale expectedRevision is rejected upstream, never re-applied as a second batch.
export function recordCookedFood({ name, recipeId, servings, storage, cookedDate, source }) {
  validateName(name);
  const portions = validateServings(servings, 'servings');
  validateStorage(storage);
  const date = validateCookedDate(cookedDate);
  if (source !== undefined && !READY_FOOD_SOURCES.includes(source)) {
    throw new ValidationError('source must be one of: ' + READY_FOOD_SOURCES.join(', ') + '.', { field: 'source' });
  }

  const record = {
    id: 'cm_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    recipeId: recipeId != null ? String(recipeId) : null,
    name,
    cookedDate: date,
    storage,
    fridgeLife: source === undefined ? null : READY_FOOD_CONTRACT.defaultFridgeLife,
    freezerLife: source === undefined ? null : READY_FOOD_CONTRACT.defaultFreezerLife,
    initialPortions: portions,
    portionsRemaining: portions
  };
  if (source !== undefined) record.source = source;
  return { item: toReadyFoodItem(record), record };
}

// Decrements portionsRemaining. Consuming exactly the remainder removes the record via an
// explicit tombstone (see module note) rather than leaving a zero-portion record behind.
export function consumePortions(cookedMeals, deletionsCookedMeals, { cookedMealId, servings }, nowIso = new Date().toISOString()) {
  const index = findMealIndex(cookedMeals, cookedMealId);
  if (index === -1) throw new NotFoundError('No cooked-meal record with cookedMealId "' + cookedMealId + '".');

  const meal = cookedMeals[index];
  if (!tracksPortions(meal)) {
    throw new ValidationError('cookedMealId "' + cookedMealId + '" is an untracked batch with no portion count to consume; use finish instead.', { field: 'cookedMealId' });
  }
  const amount = validateServings(servings, 'servings');
  if (amount > meal.portionsRemaining) {
    throw new InsufficientServingsError(meal.portionsRemaining);
  }

  const remaining = meal.portionsRemaining - amount;
  if (remaining === 0) {
    const nextMeals = cookedMeals.filter((_, i) => i !== index);
    const nextDeletions = Object.assign({}, deletionsCookedMeals, { [String(cookedMealId)]: nowIso });
    return { cookedMeals: nextMeals, deletionsCookedMeals: nextDeletions, item: null, removed: true, amount };
  }

  const next = cookedMeals.slice();
  const updated = Object.assign({}, meal, { portionsRemaining: remaining, updatedAt: nowIso });
  next[index] = updated;
  return { cookedMeals: next, deletionsCookedMeals, item: toReadyFoodItem(updated), removed: false, amount };
}

const MEAL_CONSUMPTION_ID_ATTEMPTS = 10;

function newMealConsumptionId() {
  return 'mc_' + globalThis.crypto.randomUUID();
}

// THE canonical "I ate it" operation for the bridge (TASK-071) — the server-side twin of app.js's
// useCookedPortion() + recordMealConsumption(). REST and MCP both call this and nothing else, so
// there is exactly one place that decides what a consume writes:
//   - decrement / remove the cookedMeals batch (+ tombstone on the final serving), and
//   - append ONE immutable mealConsumptions fact (closed six-field schema, see LEDGER_CONTRACT.md).
// N servings in one command is ONE fact with portionsConsumed = N (the ledger contract allows
// 1..99 per fact), never N facts. recipeId/mealName snapshots come from the PRE-mutation batch.
// Pure: returns the next state; the caller persists all three fields in ONE guarded PATCH.
// Existing facts are passed through untouched (append-only: no canonicalize, dedupe or reorder).
export function consumeReadyFood({ cookedMeals, deletionsCookedMeals, mealConsumptions }, { cookedMealId, servings }, { now = () => new Date(), newId = newMealConsumptionId } = {}) {
  if (!Array.isArray(mealConsumptions)) {
    throw new Error('mealConsumptions is present but not an array; refusing to overwrite it.');
  }
  const nowIso = now().toISOString();
  const before = cookedMeals[findMealIndex(cookedMeals, cookedMealId)];

  // Validates id/tracked/servings/sufficiency and throws before anything is built.
  const r = consumePortions(cookedMeals, deletionsCookedMeals, { cookedMealId, servings }, nowIso);

  // Same refusal as app.js recordMealConsumption(): a batch the closed schema cannot describe
  // must not be consumed without its fact. Thrown before any caller write.
  if (typeof before.name !== 'string') {
    throw new ValidationError('cookedMealId "' + cookedMealId + '" has no name, so a consumption fact cannot be recorded.', { field: 'cookedMealId' });
  }
  const used = new Set(mealConsumptions.map((f) => (f && f.id != null ? String(f.id) : null)));
  let id = null;
  for (let attempt = 0; attempt < MEAL_CONSUMPTION_ID_ATTEMPTS && id == null; attempt++) {
    const candidate = newId();
    if (!used.has(candidate)) id = candidate;
  }
  if (id == null) throw new Error('Unable to generate a unique meal consumption id.');

  const consumption = {
    id,
    cookedMealId: String(before.id),
    recipeId: before.recipeId != null ? String(before.recipeId) : null,
    mealName: before.name,
    portionsConsumed: r.amount,
    consumedAt: nowIso
  };
  return {
    cookedMeals: r.cookedMeals,
    deletionsCookedMeals: r.deletionsCookedMeals,
    mealConsumptions: mealConsumptions.concat([consumption]),
    consumption,
    item: r.item,
    removed: r.removed
  };
}

// The single atomic write spec for consumeReadyFood(): shared by REST and MCP so the field-path
// split cannot drift between them.
export function consumeWriteSpec(r) {
  return r.removed
    ? {
        fieldPaths: ['cookedMeals', 'deletions.cookedMeals', 'mealConsumptions'],
        fields: { cookedMeals: r.cookedMeals, deletions: { cookedMeals: r.deletionsCookedMeals }, mealConsumptions: r.mealConsumptions }
      }
    : {
        fieldPaths: ['cookedMeals', 'mealConsumptions'],
        fields: { cookedMeals: r.cookedMeals, mealConsumptions: r.mealConsumptions }
      };
}

// Removes the record regardless of servings remaining, mirroring finishCookedMeal(). Same
// explicit-tombstone treatment as the exact-remainder path in consumePortions().
export function finishCookedMeal(cookedMeals, deletionsCookedMeals, { cookedMealId }) {
  const index = findMealIndex(cookedMeals, cookedMealId);
  if (index === -1) throw new NotFoundError('No cooked-meal record with cookedMealId "' + cookedMealId + '".');

  const nextMeals = cookedMeals.filter((_, i) => i !== index);
  const nextDeletions = Object.assign({}, deletionsCookedMeals, { [String(cookedMealId)]: new Date().toISOString() });
  return { cookedMeals: nextMeals, deletionsCookedMeals: nextDeletions, item: null, removed: true };
}
