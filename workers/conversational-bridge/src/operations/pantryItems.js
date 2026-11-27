// Register a new pantry lot and correct an existing lot's storage and dates from chat
// (TASK-099, PROP-041 P2-1 + P2-2; owner decisions D2-D3, D-092).
//
// add_pantry_item builds exactly the record the app's own Add paths build (app.js addToPantry() and
// the grocery `buy_` path in stockPurchasedGroceryItem()): id `buy_<ms>_<rand5>`, exact-name
// INGREDIENT_DB category / shelf life / unit / staple flag, purchaseDate = household day, storage,
// quantity, printed date. Only the shared rules (shared/foodSafety.js, MealPrepFoodSafety) and the
// shared ready-food contract are used; no app-only table (PANTRY_KNOWLEDGE, the loose inferCategory
// match) is copied, so a name the shared data cannot place is asked about, never guessed.
//
// Raw meat, poultry and fish never get an invented storage or date (D3): a lot the shared fridge
// safety rules cover must name its storage and its bought date, and a fridge lot already past its fridge limit on the
// day it was bought is refused. A same-name lot with the same bought day and storage is `ambiguous`
// (add_stock to it, or confirm a new lot); a different day or storage is always a new lot, so two
// safety clocks are never merged.
//
// Pure: no Firestore, no clock (callers pass the household day, the time and a random source).
import { AmbiguousError, NotFoundError, ValidationError } from '../errors.js';
import { isCalendarDay, isStoredRecord, listInventoryWithSafety, readableId, requireHouseholdDay, validateBoughtDate } from './inventory.js';
import '../../../../shared/foodSafety.js';
import '../../../../shared/readyFoodContract.js';

const FoodSafety = globalThis.MealPrepFoodSafety;
const READY_FOOD_CONTRACT = globalThis.MealPrepReadyFoodContract;

export const PANTRY_STORAGE = Object.freeze(['fridge', 'freezer', 'counter']);
export const PREPARED_STORAGE = Object.freeze(['fridge', 'freezer']);
export const STOCK_LEVELS = Object.freeze(['full', 'ok', 'low', 'empty']);
export const PRINTED_DATE_KINDS = Object.freeze(['use-by', 'best-before']);
export const MAX_NAME_LENGTH = 200;
export const MAX_UNIT_LENGTH = 40;

// Fridge safety classes the name alone can show for a name INGREDIENT_DB does not know (see
// unrecognizedSafetyFood). 'ground' is left out on purpose: it matches "minced", which would catch
// minced garlic and other prepared vegetables; ground meat names carry a meat word as well.
const NAME_ONLY_CLASSES = ['raw-sausage', 'variety', 'poultry', 'seafood', 'whole-cut'];

function dbEntryByExactName(name) {
  const n = name.toLowerCase().trim();
  return FoodSafety.INGREDIENT_DB.find((i) => i.name.toLowerCase() === n) || null;
}

// The app's ingredientShelfLife(): exact-name INGREDIENT_DB value, else the category default.
function rawShelfLife(entry, category) {
  if (entry && entry.shelfLifeDays != null) return entry.shelfLifeDays;
  return FoodSafety.categoryShelfLife(category);
}

function readyFoodLife(storage) {
  return storage === 'freezer' ? READY_FOOD_CONTRACT.defaultFreezerLife : READY_FOOD_CONTRACT.defaultFridgeLife;
}

// The shared fridge safety rule for this lot as if it were stored in the fridge (null = the lot has
// no fridge safety limit: not meat, poultry, seafood, cured or cooked food by the shared rules).
function fridgeRuleFor(record, today) {
  return FoodSafety.pantryFridgeSafety(Object.assign({}, record, { storage: 'fridge' }), today);
}

// A name INGREDIENT_DB does not know (by name or alias) gets category '', and the shared fridge
// limits only apply to category Protein, so "venison steak" or "squid rings" would get the 7-day
// default instead of their 2-3 day limit. When the name alone matches a raw meat, poultry or fish
// rule, say so instead of storing a clock that is too long.
function unrecognizedSafetyFood(name) {
  const n = name.trim().toLowerCase();
  if (FoodSafety.stockIngredientEntry(n)) return null;
  if (FoodSafety.FRIDGE_SAFETY_EXCLUSIONS.test(n)) return null;
  const rule = FoodSafety.FRIDGE_SAFETY_LIMITS.find((candidate) =>
    NAME_ONLY_CLASSES.includes(candidate.safetyClass) && candidate.match.test(n) && !(candidate.exclude && candidate.exclude.test(n)));
  return rule ? rule.safetyClass : null;
}

// Raw meat, poultry, fish (and the other shared fridge safety classes): storage must be stated.
function needsStatedStorage(record, today) {
  return fridgeRuleFor(record, today) != null || unrecognizedSafetyFood(record.name) != null;
}

function sameText(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase();
}

// Storage as the shared default path reads it: the stored value, else INGREDIENT_DB's.
function effectiveStorage(p) {
  if (PANTRY_STORAGE.includes(p.storage)) return p.storage;
  try { return FoodSafety.defaultInferStorage(p.name) || null; } catch { return null; }
}

// get_inventory's item for this record (same safety computation), plus the stored shelf life.
export function readBackItem(record, today) {
  const [item] = listInventoryWithSafety([record], today);
  return Object.assign(item, {
    shelfLifeDays: typeof record.shelfLifeDays === 'number' && Number.isFinite(record.shelfLifeDays) ? record.shelfLifeDays : null
  });
}

function requireName(name) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > MAX_NAME_LENGTH) {
    throw new ValidationError('name must be a non-blank string of ' + MAX_NAME_LENGTH + ' characters or fewer.', { field: 'name' });
  }
  return name.trim();
}

function requireOneOf(value, allowed, field) {
  if (value !== undefined && !allowed.includes(value)) {
    throw new ValidationError(field + ' must be one of: ' + allowed.join(', ') + '.', { field });
  }
}

function requirePrintedDate(value) {
  if (!isCalendarDay(value)) {
    throw new ValidationError('printedDate must be a real calendar day in YYYY-MM-DD form.', { field: 'printedDate' });
  }
}

function requireBoolean(value, field) {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new ValidationError(field + ' must be true or false.', { field });
  }
}

// Everything add_pantry_item can check without the stored document (run before any Firestore
// access, then again inside addPantryItem).
export function validateAddPantryItemArgs(args, today) {
  requireHouseholdDay(today);
  const name = requireName(args.name);
  if (args.quantity !== undefined && args.quantity !== null &&
      (typeof args.quantity !== 'number' || !Number.isFinite(args.quantity) || args.quantity <= 0 || args.quantity > Number.MAX_SAFE_INTEGER)) {
    throw new ValidationError('quantity must be a finite number > 0, or left out when the amount is not known.', { field: 'quantity' });
  }
  if (args.unit !== undefined && (typeof args.unit !== 'string' || !args.unit.trim() || args.unit.trim().length > MAX_UNIT_LENGTH)) {
    throw new ValidationError('unit must be a non-blank string of ' + MAX_UNIT_LENGTH + ' characters or fewer.', { field: 'unit' });
  }
  requireOneOf(args.storage, PANTRY_STORAGE, 'storage');
  validateBoughtDate(args.boughtDate, today);
  if (args.printedDate !== undefined) requirePrintedDate(args.printedDate);
  requireOneOf(args.printedDateKind, PRINTED_DATE_KINDS, 'printedDateKind');
  if (args.printedDateKind !== undefined && args.printedDate === undefined) {
    throw new ValidationError('printedDateKind needs printedDate (the date printed on the pack).', { field: 'printedDateKind' });
  }
  requireBoolean(args.staple, 'staple');
  requireOneOf(args.level, STOCK_LEVELS, 'level');
  requireBoolean(args.prepared, 'prepared');
  requireBoolean(args.confirmNewLot, 'confirmNewLot');
  if (args.prepared === true) {
    if (args.storage === undefined) {
      throw new ValidationError('needs_storage: a prepared ingredient ("' + name + '") must say where it is kept (fridge or freezer). ' +
        'Ask the user; do not guess.', { field: 'storage', code: 'needs_storage' });
    }
    if (!PREPARED_STORAGE.includes(args.storage)) {
      throw new ValidationError('A prepared ingredient is kept in the fridge or the freezer, not on the counter. Ask the user where it is.', { field: 'storage' });
    }
  }
  return name;
}

function newLotId(pantry, deletionsPantry, nowMs, random) {
  const taken = new Set((pantry || []).filter((p) => p && readableId(p.id)).map((p) => String(p.id)));
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = 'buy_' + nowMs + '_' + random().toString(36).slice(2, 7);
    if (!taken.has(id) && !(deletionsPantry && Object.hasOwn(deletionsPantry, id))) return id;
  }
  throw new Error('Could not mint a new pantry id.');
}

// add_pantry_item: one new lot, shaped like the app's manual Add. Returns the new pantry array, the
// stored record, the read-back item and where the storage came from.
export function addPantryItem(pantry, deletionsPantry, args, { today, nowMs, random = Math.random }) {
  const name = validateAddPantryItemArgs(args, today);
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) throw new Error('A finite clock is required.');
  const entry = dbEntryByExactName(name);
  const category = entry ? entry.category : '';
  const purchaseDate = args.boughtDate !== undefined ? args.boughtDate : today;
  const probe = { name, category, purchaseDate };

  let storage = args.storage;
  let storageSource = 'given';
  if (storage === undefined) {
    if (needsStatedStorage(probe, today)) {
      throw new ValidationError('needs_storage: "' + name + '" is raw meat, poultry, fish or another food with a fridge safety limit, ' +
        'so its storage is never guessed. Ask the user whether it is in the fridge or the freezer, and send storage.',
        { field: 'storage', code: 'needs_storage' });
    }
    storage = effectiveStorage({ name });
    storageSource = 'inferred';
    if (!storage) {
      throw new ValidationError('needs_storage: the app\'s ingredient list does not say where "' + name + '" is kept. Ask the user ' +
        'whether it is in the fridge, the freezer or on the counter, and send storage.', { field: 'storage', code: 'needs_storage' });
    }
  }

  if (args.boughtDate === undefined && needsStatedStorage(probe, today)) {
    throw new ValidationError('needs_bought_date: "' + name + '" is raw meat, poultry, fish or another food with a fridge safety limit, ' +
      'so its bought date is never assumed. Ask the user what day it was bought and send boughtDate (YYYY-MM-DD); use today only ' +
      'if they said "today" or "just bought".', { field: 'boughtDate', code: 'needs_bought_date' });
  }

  if (storage === 'fridge') {
    const unknownFood = unrecognizedSafetyFood(name);
    if (unknownFood && fridgeRuleFor(probe, today) == null) {
      throw new ValidationError('unrecognized_food: "' + name + '" looks like ' + unknownFood + ' food, but it is not in the app\'s ' +
        'ingredient list under that name, so its fridge safety limit cannot be applied. Use the ingredient\'s name as the app ' +
        'lists it (for example "Salmon", "Chicken Breast", "Pork Chop"), or add it in the app.', { field: 'name', code: 'unrecognized_food' });
    }
    const fridge = fridgeRuleFor(probe, today);
    if (fridge && fridge.daysLeft != null && fridge.daysLeft < 0) {
      throw new ValidationError('past_safety_limit: "' + name + '" bought on ' + purchaseDate + ' is past its ' + fridge.limitDays +
        '-day fridge safety limit (' + fridge.safetyClass + ') today, so it is not recorded as fridge stock. Tell the user it should ' +
        'not be eaten; if it was frozen in time, record it with storage freezer.', { field: 'boughtDate', code: 'past_safety_limit' });
    }
  }

  let shelfLifeDays = rawShelfLife(entry, category);
  if (args.prepared === true) {
    // Ready-food default life for this storage, never longer than the raw item's own life.
    shelfLifeDays = Math.min(readyFoodLife(storage), shelfLifeDays);
  }

  let staple;
  if (args.staple !== undefined) staple = args.staple;
  else if (entry) staple = !!entry.isStaple;
  if (args.level !== undefined && staple !== true) {
    throw new ValidationError('level is only for staples (tracked by stock level). Send staple: true with it, or leave level out.', { field: 'level' });
  }

  const quantity = typeof args.quantity === 'number' ? args.quantity : null;
  const unit = args.unit !== undefined ? args.unit.trim() : (entry && entry.unit ? entry.unit : '');
  const record = {
    id: newLotId(pantry, deletionsPantry, nowMs, random),
    name,
    category,
    purchaseDate,
    shelfLifeDays,
    storage,
    quantity,
    unit
  };
  if (staple !== undefined) record.staple = staple;
  if (staple === true) record.stockLevel = args.level !== undefined ? args.level : 'full';
  if (args.printedDate !== undefined) {
    record.expiryDate = args.printedDate;
    record.dateMode = 'expiry';
    if (args.printedDateKind === 'best-before') record.printedDateKind = 'best-before';
  }
  record.updatedAt = new Date(nowMs).toISOString();

  if (args.confirmNewLot !== true) {
    const twins = (pantry || []).filter((p) => isStoredRecord(p) && readableId(p.id) && sameText(p.name, name) &&
      p.purchaseDate === purchaseDate && effectiveStorage(p) === storage &&
      !(deletionsPantry && Object.hasOwn(deletionsPantry, String(p.id))));
    if (twins.length) {
      const ids = twins.map((p) => '"' + String(p.id) + '"').join(', ');
      throw new AmbiguousError('"' + name + '" bought ' + purchaseDate + ' and stored in the ' + storage + ' is already recorded (ingredientId ' + ids +
        '). Ask the user which they mean: 1) more of that same lot -> add_stock with that ingredientId; or 2) a separate lot -> call ' +
        'add_pantry_item again with confirmNewLot: true (and a new requestId).', { field: 'name', code: 'ambiguous', existing: twins.map((p) => String(p.id)) });
    }
  }

  return {
    pantry: (pantry || []).concat([record]),
    record,
    item: readBackItem(record, today),
    storageSource
  };
}

// Everything update_pantry_item can check without the stored document.
export function validateUpdatePantryItemArgs(args, today) {
  requireHouseholdDay(today);
  if (typeof args.ingredientId !== 'string' || !args.ingredientId.trim()) {
    throw new ValidationError('ingredientId must be a non-blank string.', { field: 'ingredientId' });
  }
  requireOneOf(args.storage, PANTRY_STORAGE, 'storage');
  validateBoughtDate(args.boughtDate, today);
  if (args.printedDate !== undefined && args.printedDate !== null) requirePrintedDate(args.printedDate);
  requireOneOf(args.printedDateKind, PRINTED_DATE_KINDS, 'printedDateKind');
  if (args.printedDateKind !== undefined && args.printedDate === null) {
    throw new ValidationError('printedDateKind cannot be set while clearing printedDate.', { field: 'printedDateKind' });
  }
  if (args.thawedToday !== undefined && args.thawedToday !== true) {
    throw new ValidationError('thawedToday is only sent as true (the item was moved from the freezer to the fridge today).', { field: 'thawedToday' });
  }
  if (args.thawedToday === true && args.boughtDate !== undefined) {
    throw new ValidationError('Send thawedToday or boughtDate, not both.', { field: 'thawedToday' });
  }
  if (args.thawedToday === true && args.storage !== 'fridge') {
    throw new ValidationError('thawedToday goes with storage: "fridge" (moving an item out of the freezer).', { field: 'thawedToday' });
  }
  const changes = ['storage', 'boughtDate', 'printedDate', 'printedDateKind', 'thawedToday'].filter((key) => args[key] !== undefined);
  if (!changes.length) {
    throw new ValidationError('Nothing to change: send at least one of storage, boughtDate, printedDate, printedDateKind or thawedToday.', { field: 'ingredientId' });
  }
}

const EDITED_FIELDS = ['storage', 'purchaseDate', 'expiryDate', 'dateMode', 'printedDateKind'];

// update_pantry_item: correct storage and dates of one existing lot. Never changes name, amount,
// staple flag or level. Returns unchanged:true (no write) when the values already match.
export function updatePantryItem(pantry, deletionsPantry, args, { today, nowMs }) {
  validateUpdatePantryItemArgs(args, today);
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) throw new Error('A finite clock is required.');
  const ingredientId = args.ingredientId;
  const index = (pantry || []).findIndex((p) => p && readableId(p.id) && String(p.id) === String(ingredientId));
  if (index === -1 || (deletionsPantry && Object.hasOwn(deletionsPantry, String(ingredientId)))) {
    throw new NotFoundError('No active pantry record with ingredientId "' + ingredientId + '". Take ingredientId from get_inventory.');
  }
  const record = pantry[index];
  // The same gate as get_inventory: a lot it reports as invalid-record is never changed.
  const [read] = listInventoryWithSafety([record], today);
  if (read.tracking == null || typeof record.name !== 'string' || !record.name.trim()) {
    throw new ValidationError('invalid_record: ingredientId "' + ingredientId + '" could not be read safely, so it cannot be changed ' +
      'from chat. Ask the user to check it in the app.', { field: 'ingredientId', code: 'invalid_record' });
  }

  const next = Object.assign({}, record);
  if (args.storage !== undefined) next.storage = args.storage;
  const wasFrozen = effectiveStorage(record) === 'freezer';
  const thawing = wasFrozen && next.storage === 'fridge' && needsStatedStorage(record, today);
  if (thawing && args.thawedToday !== true && args.boughtDate === undefined) {
    throw new ValidationError('needs_thaw_date: thaw reminder - "' + record.name + '" is raw meat, poultry, fish or another food with a ' +
      'fridge safety limit; moved from the freezer to the fridge, its fridge time counts from the day it thawed, not the day it was ' +
      'bought. Ask the user: if it moved to the fridge today, send thawedToday: true; otherwise send boughtDate as the day it moved.',
    { field: 'thawedToday', code: 'needs_thaw_date' });
  }
  if (args.thawedToday === true) {
    if (!wasFrozen) {
      throw new ValidationError('thawedToday is only for an item that was in the freezer; "' + record.name + '" is not recorded in the freezer.', { field: 'thawedToday' });
    }
    next.purchaseDate = today;
  }
  if (args.boughtDate !== undefined) next.purchaseDate = args.boughtDate;
  if (args.printedDate === null) {
    delete next.expiryDate;
    delete next.dateMode;
    delete next.printedDateKind;
  } else if (args.printedDate !== undefined) {
    next.expiryDate = args.printedDate;
    next.dateMode = 'expiry';
    // A new printed date is a use-by unless the user says best before (the stricter default).
    delete next.printedDateKind;
  }
  if (args.printedDateKind !== undefined) {
    if (next.dateMode !== 'expiry' || !isCalendarDay(next.expiryDate)) {
      throw new ValidationError('printedDateKind needs a printed date: send printedDate with it.', { field: 'printedDateKind' });
    }
    if (args.printedDateKind === 'best-before') next.printedDateKind = 'best-before';
    else delete next.printedDateKind;
  }

  let storageSource = null;
  if (args.storage !== undefined) storageSource = 'given';
  else if (PANTRY_STORAGE.includes(record.storage)) storageSource = 'recorded';
  else if (effectiveStorage(record)) storageSource = 'inferred';

  const unchanged = EDITED_FIELDS.every((key) => next[key] === record[key] && Object.hasOwn(next, key) === Object.hasOwn(record, key));
  if (unchanged) {
    return { pantry, record, item: readBackItem(record, today), storageSource, unchanged: true, thawed: false };
  }
  next.updatedAt = new Date(nowMs).toISOString();
  const nextPantry = pantry.slice();
  nextPantry[index] = next;
  return { pantry: nextPantry, record: next, item: readBackItem(next, today), storageSource, unchanged: false, thawed: thawing };
}
