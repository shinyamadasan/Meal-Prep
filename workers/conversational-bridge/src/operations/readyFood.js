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

// Always creates a TRACKED batch (initialPortions === portionsRemaining === servings) —
// `servings` and `expectedRevision` are both required, no exceptions, which is what makes a
// lost-response retry of this create safe (D-082 idempotency model): a retry under the same
// stale expectedRevision is rejected upstream, never re-applied as a second batch.
//
// `cookedDate` uses the Worker's own UTC calendar date as "today". The app's equivalent is the
// user's LOCAL calendar date (docs/DATA_MODEL.md) and a Worker has no caller-timezone concept —
// this is a recorded, accepted judgment call (not a STOP condition): dates created via the
// bridge within a few hours of the caller's local midnight may land on the adjacent calendar day
// versus what the app would have stamped. See CHANGELOG.md / D-082 addendum.
export function recordCookedFood({ name, recipeId, servings, storage }) {
  validateName(name);
  const portions = validateServings(servings, 'servings');
  validateStorage(storage);

  const record = {
    id: 'cm_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    recipeId: recipeId != null ? String(recipeId) : null,
    name,
    cookedDate: new Date().toISOString().slice(0, 10),
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
