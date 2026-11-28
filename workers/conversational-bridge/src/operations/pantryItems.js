// Register a new pantry lot and correct an existing lot's storage and dates from chat
// (TASK-099, PROP-041 P2-1 + P2-2; owner decisions D2-D3, D-092).
//
// add_pantry_item builds exactly the record the app's own Add paths build (app.js addToPantry() and
// the grocery `buy_` path in stockPurchasedGroceryItem()): id `buy_<ms>_<rand5>`, exact-name
// INGREDIENT_DB category / shelf life / unit / staple flag, purchaseDate = household day, storage,
// quantity, printed date. Only the shared rules (shared/foodSafety.js, MealPrepFoodSafety) and the
// shared ready-food contract are used; no app-only table (PANTRY_KNOWLEDGE) is copied, and the app's
// loose inferCategory match is used only where it is stricter (see categoryFor), so a name the
// shared data cannot place is asked about, never guessed.
//
// Raw meat, poultry and fish never get an invented storage or date (D3): a lot the shared fridge
// safety rules cover (or whose unknown name reads as meat or fish) must name its storage and its
// bought date, never goes on the counter, and a fridge lot already past its fridge limit is refused.
// A same-name lot with the same bought day and storage is `ambiguous` (add_stock to it, or confirm a
// new lot; only a new lot when either has a printed date); a different day, storage or printed date
// is always a new lot, so two safety clocks are never merged.
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
// unrecognizedSafetyFood). The shared 'ground' rule is left out on purpose: it matches "minced",
// which would catch minced garlic and other prepared vegetables. Its meat-only words are matched
// by NAME_ONLY_GROUND instead.
const NAME_ONLY_CLASSES = ['raw-sausage', 'variety', 'poultry', 'seafood', 'whole-cut'];
const NAME_ONLY_GROUND = { safetyClass: 'ground', days: 2, match: /\b(?:giniling|hamburgers?|stew[ -]+meats?)\b/i };

// Words that make a meat or fish word part of a non-meat food ("Goat cheese", "Lamb's lettuce",
// "Steak sauce", "Oyster mushrooms", "Tuna mayo", "Fish balls", "Artichoke hearts", "Hearts of
// palm", "Hamburger buns"). Used ONLY for names INGREDIENT_DB does not know; the shared rules for
// known names are untouched. Kept narrow on purpose: a word that can also name a raw cut or a cooked
// dish ("cubes", "balls", "chips" as in fish and chips, "butter" as in butter chicken) is not
// listed, so such a name is still asked about.
const NAME_ONLY_FALSE_FRIENDS = /\b(?:cheeses?|mushrooms?|sauces?|lettuces?|palms?|mayo|mayonnaise|artichokes?|fish[ -]?balls?|dressings?|pastes?|broths?|stocks?|bouillon|seasonings?|flavou?r(?:ed|ings?)|crackers?|crisps|noodles?|ramen|oils?|ketchup|gravy|marinades?|rubs?|buns?|breads?)\b/i;

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

// A name INGREDIENT_DB does not know (by name or alias) gets no Protein category, and the shared
// fridge limits only apply to category Protein, so "venison steak" or "squid rings" would get the
// 7-day default instead of their 2-3 day limit. Returns the raw meat, poultry or fish rule the name
// alone matches, or null.
function unrecognizedSafetyRule(name) {
  const n = String(name || '').trim().toLowerCase();
  if (!n || FoodSafety.stockIngredientEntry(n)) return null;
  if (FoodSafety.FRIDGE_SAFETY_EXCLUSIONS.test(n) || NAME_ONLY_FALSE_FRIENDS.test(n)) return null;
  const rule = FoodSafety.FRIDGE_SAFETY_LIMITS.find((candidate) =>
    NAME_ONLY_CLASSES.includes(candidate.safetyClass) && candidate.match.test(n) && !(candidate.exclude && candidate.exclude.test(n)));
  if (rule) return rule;
  return NAME_ONLY_GROUND.match.test(n) ? NAME_ONLY_GROUND : null;
}

function unrecognizedSafetyFood(name) {
  const rule = unrecognizedSafetyRule(name);
  return rule ? rule.safetyClass : null;
}

// Category for a new lot. Exact INGREDIENT_DB name first, then an exact alias (the shared
// stockIngredientEntry), so "chicken fillet" is stored as Protein and the app's Kitchen card applies
// the poultry limit. The app's own inferCategory() also takes a loose substring match ("chicken
// thighs" -> Chicken Thigh, but also "egg" -> Eggplant); that loose match is used here only where it
// is stricter: it yields Protein for a name that already reads as raw meat, poultry or fish.
function appLooseCategory(name) {
  const n = name.toLowerCase();
  const loose = FoodSafety.INGREDIENT_DB.find((i) => {
    const x = i.name.toLowerCase();
    return x.includes(n) || n.includes(x);
  });
  return loose ? loose.category : '';
}

function categoryFor(name) {
  const entry = FoodSafety.stockIngredientEntry(name.toLowerCase().trim());
  if (entry) return entry.category || '';
  if (unrecognizedSafetyRule(name) && String(appLooseCategory(name)).toLowerCase() === 'protein') return appLooseCategory(name);
  return '';
}

// Raw meat, poultry, fish (and the other shared fridge safety classes, plus a meat or fish name the
// ingredient list does not know): storage and bought date must be stated, and never the counter.
function needsStatedStorage(record, today) {
  return fridgeRuleFor(record, today) != null || unrecognizedSafetyFood(record.name) != null;
}

// The fridge clock of a lot as if it sat in the fridge: the shared rule, else (a name the ingredient
// list does not know) the rule its name matches. daysLeft null = the bought date is unknown.
function fridgeClock(record, today) {
  const shared = fridgeRuleFor(record, today);
  if (shared) return shared;
  const rule = unrecognizedSafetyRule(record.name);
  if (!rule) return null;
  const bought = isCalendarDay(record.purchaseDate) ? FoodSafety.stockCalendarDay(record.purchaseDate) : null;
  return {
    daysLeft: bought == null ? null : bought + rule.days - FoodSafety.stockCalendarDay(today),
    limitDays: rule.days,
    safetyClass: rule.safetyClass
  };
}

// The fridge shelf life of a lot leaving the freezer. A prepared lot add_pantry_item put in the
// freezer carries the ready-food freezer life and no stored marker, so a frozen lot whose shelf life
// is exactly that, and is not the raw item's own life, is read as prepared: in the fridge it gets the
// ready-food fridge life, never longer than the raw item's. Any other lot gets the app's
// ingredientShelfLife() (exact-name DB value, else the category default).
function fridgeLifeFor(record) {
  const raw = rawShelfLife(dbEntryByExactName(String(record.name || '')), record.category);
  if (record.shelfLifeDays === READY_FOOD_CONTRACT.defaultFreezerLife && raw !== READY_FOOD_CONTRACT.defaultFreezerLife) {
    return Math.min(READY_FOOD_CONTRACT.defaultFridgeLife, raw);
  }
  return raw;
}

const CHECK_IN_APP = 'Ask the user to check the item in the app.';
// Neutral wording: the name matched a fridge safety rule; it is not a claim about what the food is.
const MAY_BE_RAW = 'may be raw meat, poultry or fish (a food with a fridge safety limit)';

function unsafeCounterError(name) {
  return new ValidationError('unsafe_storage: "' + name + '" ' + MAY_BE_RAW + ', so it is not ' +
    'recorded on the counter (it needs the fridge or the freezer). ' + CHECK_IN_APP,
  { field: 'storage', code: 'unsafe_storage' });
}

function unrecognizedFoodError(name, unknownFood) {
  return new ValidationError('unrecognized_food: "' + name + '" may be ' + unknownFood + ' food, but it is not in the app\'s ' +
    'ingredient list under that name, so its fridge safety limit cannot be applied. Use the ingredient\'s name as the app ' +
    'lists it (for example "Salmon", "Chicken Breast", "Pork Chop"), or ask the user to check the item in the app.',
  { field: 'name', code: 'unrecognized_food' });
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
  const category = categoryFor(name);
  const purchaseDate = args.boughtDate !== undefined ? args.boughtDate : today;
  const probe = { name, category, purchaseDate };
  const safetyLot = needsStatedStorage(probe, today);

  let storage = args.storage;
  let storageSource = 'given';
  if (storage === undefined) {
    if (safetyLot) {
      throw new ValidationError('needs_storage: "' + name + '" ' + MAY_BE_RAW + ', so ' +
        'its storage is never guessed. Ask the user whether it is in the fridge or the freezer, and send storage.',
      { field: 'storage', code: 'needs_storage' });
    }
    storage = effectiveStorage({ name });
    storageSource = 'inferred';
    if (!storage) {
      throw new ValidationError('needs_storage: the app\'s ingredient list does not say where "' + name + '" is kept. Ask the user ' +
        'whether it is in the fridge, the freezer or on the counter, and send storage.', { field: 'storage', code: 'needs_storage' });
    }
  }
  if (storage === 'counter' && safetyLot) throw unsafeCounterError(name);

  if (args.boughtDate === undefined && safetyLot) {
    throw new ValidationError('needs_bought_date: "' + name + '" ' + MAY_BE_RAW + ', so ' +
      'its bought date is never assumed. Ask the user what day it was bought and send boughtDate (YYYY-MM-DD); use ' +
      'today only if they said "today" or "just bought".', { field: 'boughtDate', code: 'needs_bought_date' });
  }

  if (storage === 'fridge') {
    const unknownFood = unrecognizedSafetyFood(name);
    if (unknownFood && fridgeRuleFor(probe, today) == null) throw unrecognizedFoodError(name, unknownFood);
    const fridge = fridgeRuleFor(probe, today);
    if (fridge && fridge.daysLeft != null && fridge.daysLeft < 0) {
      throw new ValidationError('past_safety_limit: "' + name + '" bought on ' + purchaseDate + ' is past its ' + fridge.limitDays +
        '-day fridge safety limit (' + fridge.safetyClass + ') today, so it is not recorded as fridge stock. Tell the user it should ' +
        'not be eaten; if it was frozen in time, record it with storage freezer.', { field: 'boughtDate', code: 'past_safety_limit' });
    }
  }

  let shelfLifeDays = rawShelfLife(entry, category);
  if (args.prepared === true) {
    // Frozen prepared food with no printed date keeps the ready-food freezer life (freezing is what
    // makes it last; the raw item's fridge life does not apply). In the fridge, and whenever a printed
    // date is given, the ready-food life is never longer than the raw item's own life.
    if (storage === 'freezer' && args.printedDate === undefined) shelfLifeDays = readyFoodLife('freezer');
    else shelfLifeDays = Math.min(readyFoodLife(storage), shelfLifeDays);
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
    // Two different printed dates are two different lots (never asked about). When either lot has a
    // printed date, add_stock is not offered: it has no printed-date input, so a merge could lose or
    // mix up the date the lot is tracked by. Only a separate lot (confirmNewLot) is offered then.
    const newPrinted = args.printedDate !== undefined ? args.printedDate : null;
    const twins = (pantry || []).filter((p) => {
      if (!isStoredRecord(p) || !readableId(p.id) || !sameText(p.name, name)) return false;
      if (p.purchaseDate !== purchaseDate || effectiveStorage(p) !== storage) return false;
      if (deletionsPantry && Object.hasOwn(deletionsPantry, String(p.id))) return false;
      const printed = printedDateOf(p);
      return !(printed && newPrinted && printed !== newPrinted);
    });
    if (twins.length) {
      const ids = twins.map((p) => '"' + String(p.id) + '"').join(', ');
      const anyPrinted = newPrinted != null || twins.some((p) => printedDateOf(p) != null);
      const where = '"' + name + '" bought ' + purchaseDate + ' and stored in the ' + storage +
        ' is already recorded (ingredientId ' + ids + '). ';
      const message = anyPrinted
        ? where + 'Ask the user whether this is a separate lot; if so, call add_pantry_item again with confirmNewLot: true (and a ' +
          'new requestId). add_stock cannot be used for a lot with a printed date.'
        : where + 'Ask the user which they mean: 1) more of that same lot -> add_stock with that ingredientId; or 2) a separate lot ' +
          '-> call add_pantry_item again with confirmNewLot: true (and a new requestId).';
      throw new AmbiguousError(message, { field: 'name', code: 'ambiguous', existing: twins.map((p) => String(p.id)) });
    }
  }

  return {
    pantry: (pantry || []).concat([record]),
    record,
    item: readBackItem(record, today),
    storageSource
  };
}

// The printed date a lot is tracked by, or null.
function printedDateOf(p) {
  return p.dateMode === 'expiry' && typeof p.expiryDate === 'string' && p.expiryDate ? p.expiryDate : null;
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

const EDITED_FIELDS = ['storage', 'purchaseDate', 'expiryDate', 'dateMode', 'printedDateKind', 'shelfLifeDays'];

function pastLimitError(name, clock, when) {
  if (clock.daysLeft == null) {
    return new ValidationError('unknown_bought_date: "' + name + '" ' + MAY_BE_RAW + ', and ' +
      'its bought date is not known, so ' + when + ' cannot be done from chat. ' + CHECK_IN_APP,
    { field: 'boughtDate', code: 'unknown_bought_date' });
  }
  return new ValidationError('past_safety_limit: "' + name + '" is past its ' + clock.limitDays + '-day fridge safety limit (' +
    clock.safetyClass + '), so ' + when + ' is refused: freezing or moving it does not make it safe again. Tell the user it should ' +
    'not be eaten. ' + CHECK_IN_APP, { field: 'storage', code: 'past_safety_limit' });
}

// update_pantry_item: correct storage and dates of one existing lot. Never changes name, amount,
// staple flag or level. Returns unchanged:true (no write) when the values already match.
//
// Food safety (D3): an edit never makes raw meat, poultry or fish (or a meat or fish name the
// ingredient list does not know) read safer than it is:
//   - it never goes on the counter (unsafe_storage);
//   - it never leaves the fridge (or the counter) for the freezer while past its fridge limit or with
//     no known bought date (past_safety_limit / unknown_bought_date);
//   - its bought date only moves earlier, except when it leaves the freezer for the fridge with the
//     thaw day (thawedToday or boughtDate), which restarts the fridge clock (later_bought_date);
//   - a name the shared rules cannot place never moves into the fridge (unrecognized_food).
// Any lot leaving the freezer for the fridge with a shelf life longer than its fridge life (a frozen
// prepared ingredient) needs the thaw day too, and its shelf life is capped at the fridge life.
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
  const name = record.name;

  const next = Object.assign({}, record);
  if (args.storage !== undefined) next.storage = args.storage;
  const fromStorage = effectiveStorage(record);
  const toStorage = effectiveStorage(next);
  const wasFrozen = fromStorage === 'freezer';
  const safetyLot = needsStatedStorage(record, today);
  const leavesFreezerForFridge = wasFrozen && toStorage === 'fridge';
  const thawDateGiven = args.thawedToday === true || args.boughtDate !== undefined;

  if (args.thawedToday === true && !wasFrozen) {
    throw new ValidationError('thawedToday is only for an item that was in the freezer; "' + name + '" is not recorded in the freezer.', { field: 'thawedToday' });
  }
  if (args.thawedToday === true) next.purchaseDate = today;
  if (args.boughtDate !== undefined) next.purchaseDate = args.boughtDate;

  // Unknown raw meat, poultry or fish never enters the fridge without its limit (same as add).
  const unknownFood = unrecognizedSafetyFood(name);
  if (toStorage === 'fridge' && fromStorage !== 'fridge' && unknownFood && fridgeRuleFor(next, today) == null) {
    throw unrecognizedFoodError(name, unknownFood);
  }
  if (safetyLot && toStorage === 'counter') throw unsafeCounterError(name);

  // Leaving the fridge (or the counter, or an unknown place) for the freezer: freezing does not make
  // past-limit food safe again, and an unknown bought date cannot show it is within its limit.
  if (safetyLot && toStorage === 'freezer' && fromStorage !== 'freezer') {
    for (const lot of [record, next]) {
      const clock = fridgeClock(lot, today);
      if (clock && (clock.daysLeft == null || clock.daysLeft < 0)) throw pastLimitError(name, clock, 'moving it to the freezer');
    }
  }

  // A fridge-safety lot's bought date only moves earlier (a later date would hide used-up fridge
  // time), except the thaw restart when it leaves the freezer for the fridge.
  if (safetyLot && next.purchaseDate !== record.purchaseDate && !(leavesFreezerForFridge && thawDateGiven)) {
    if (!isCalendarDay(record.purchaseDate)) {
      throw pastLimitError(name, { daysLeft: null }, 'setting its bought date');
    }
    if (next.purchaseDate > record.purchaseDate) {
      throw new ValidationError('later_bought_date: "' + name + '" ' + MAY_BE_RAW + '; ' +
        'its bought date (' + record.purchaseDate + ') can only be corrected to an earlier day from chat, because a later ' +
        'day would hide fridge time it already used. The only exception is thawing: moving it from the freezer to the fridge with ' +
        'thawedToday or the day it moved. ' + CHECK_IN_APP, { field: 'boughtDate', code: 'later_bought_date' });
    }
  }

  // Leaving the freezer: a shelf life longer than the fridge life (a frozen prepared ingredient)
  // does not carry over.
  const fridgeLife = fridgeLifeFor(record);
  const longLife = wasFrozen && Number.isFinite(record.shelfLifeDays) && record.shelfLifeDays > fridgeLife;
  if (longLife && toStorage === 'counter') {
    throw new ValidationError('unsafe_storage: "' + name + '" has a freezer shelf life (' + record.shelfLifeDays + ' days) that does not ' +
      'apply out of the freezer, so it is not moved to the counter from chat. ' + CHECK_IN_APP, { field: 'storage', code: 'unsafe_storage' });
  }
  const thawing = leavesFreezerForFridge && (safetyLot || longLife);
  if (thawing && !thawDateGiven) {
    const why = safetyLot
      ? MAY_BE_RAW + '; moved'
      : 'has a freezer shelf life; moved';
    throw new ValidationError('needs_thaw_date: thaw reminder - "' + name + '" ' + why + ' from the freezer to the fridge, its ' +
      'fridge time counts from the day it thawed, not the day it was bought or made. Ask the user: if it moved to the fridge ' +
      'today, send thawedToday: true; otherwise send boughtDate as the day it moved.',
    { field: 'thawedToday', code: 'needs_thaw_date' });
  }
  if (leavesFreezerForFridge && longLife) next.shelfLifeDays = fridgeLife;

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
