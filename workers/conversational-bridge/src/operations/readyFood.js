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
export function recordCookedFood({ name, recipeId, servings, storage, cookedDate }) {
  validateName(name);
  const portions = validateServings(servings, 'servings');
  validateStorage(storage);
  const date = validateCookedDate(cookedDate);

  const record = {
    id: 'cm_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    recipeId: recipeId != null ? String(recipeId) : null,
    name,
    cookedDate: date,
    storage,
    fridgeLife: null,
    freezerLife: null,
    initialPortions: portions,
    portionsRemaining: portions
  };
  return { item: toReadyFoodItem(record), record };
}

// Decrements portionsRemaining. Consuming exactly the remainder removes the record via an
// explicit tombstone (see module note) rather than leaving a zero-portion record behind.
export function consumePortions(cookedMeals, deletionsCookedMeals, { cookedMealId, servings }) {
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
    const nextDeletions = Object.assign({}, deletionsCookedMeals, { [String(cookedMealId)]: new Date().toISOString() });
    return { cookedMeals: nextMeals, deletionsCookedMeals: nextDeletions, item: null, removed: true };
  }

  const next = cookedMeals.slice();
  const updated = Object.assign({}, meal, { portionsRemaining: remaining, updatedAt: new Date().toISOString() });
  next[index] = updated;
  return { cookedMeals: next, deletionsCookedMeals, item: toReadyFoodItem(updated), removed: false };
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
