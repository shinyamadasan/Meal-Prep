// Register a new pantry lot and correct an existing lot's storage and dates from chat
// (TASK-099, PROP-041 P2-1 + P2-2; owner decisions D2-D3, D-092).
//
// add_pantry_item builds exactly the record the app's own Add paths build (app.js addToPantry() and
// the grocery `buy_` path in stockPurchasedGroceryItem()): id `buy_<ms>_<rand5>`, INGREDIENT_DB
// category (exact name, else exact alias, else the app's loose match only when it gives Protein to a
// name that reads as raw meat, poultry or fish), exact-name shelf life / unit / staple flag,
// purchaseDate = household day, storage, quantity, printed date. Only the shared rules
// (shared/foodSafety.js, MealPrepFoodSafety) and the shared ready-food contract are used; no
// app-only table (PANTRY_KNOWLEDGE) is copied, so a name the shared data cannot place is asked
// about, never guessed.
//
// Raw meat, poultry and fish (and a meat or fish name the ingredient list does not know) never get
// an invented storage or date and never go on the counter (D3): such a lot must name its storage
// (fridge or freezer) and its bought date, and a fridge lot already past its fridge limit on the day
// it was bought is refused. A same-name lot with the same bought day and storage is `ambiguous`
// unless both lots have different printed dates (add_stock to it when neither has a printed date,
// or confirm a new lot); anything else is a new lot, so two safety clocks are never merged.
// update_pantry_item never lets an edit make such a lot read safer than it is (see
// updatePantryItem), and neither does an undo of one (unsafeRestoreReason).
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
const NAME_ONLY_GROUND = { safetyClass: 'ground', days: 2, match: /\b(?:giniling|hamburgers?|stew[ -]+meats?|mince|meat[ -]?balls?|(?:burger[ -]+)?patty|patties)\b/i };
// Meat and fish words the shared regex does not list (review SF3). They only make a name the
// ingredient list does not know need a stated storage and bought date, keep it off the counter and
// give it category Protein; with no shared fridge limit such a name is still refused in the fridge.
// Sardines and anchovies are left out on purpose: they are commonly canned and kept on the counter.
const NAME_ONLY_EXTRA = [
  { safetyClass: 'raw-sausage', days: 2, match: /\b(?:bratwursts?|kielbasas?)\b/i },
  { safetyClass: 'cured-processed', days: 3, match: /\bhams?\b/i },
  // Raw cured Filipino breakfast meats (review 3 SF-2): kept in the fridge or freezer, never shelf-stable.
  { safetyClass: 'cured-processed', days: 2, match: /\b(?:tocino|tapa)\b/i },
  { safetyClass: 'variety', days: 2, match: /\bgizzards?\b/i },
  { safetyClass: 'poultry', days: 2, match: /\bquails?\b/i },
  { safetyClass: 'whole-cut', days: 3, match: /\b(?:pata|oxtails?|rabbits?)\b/i },
  { safetyClass: 'seafood', days: 2, match: new RegExp('\\b(?:' + [
    'cod', 'mackerel', 'trout', 'halibut', 'haddock', 'pollock', 'snapper', 'sea[ -]?bass', 'catfish', 'hito', 'tanigue',
    'lapu[ -]?lapu', 'maya[ -]?maya', 'milkfish', 'dalagang[ -]+bukid', 'hasa[ -]?hasa', 'tulingan', 'swordfish', 'mahi[ -]?mahi',
    'lobsters?', 'octopus', 'cuttlefish', 'eels?', 'herrings?'
  ].join('|') + ')\\b', 'i') }
];

// Words that make a meat or fish word part of a non-meat food ("Goat cheese", "Lamb's lettuce",
// "Steak sauce", "Oyster mushrooms", "Tuna mayo", "Fish balls", "Artichoke hearts", "Hearts of
// palm", "Hamburger buns"). Used ONLY for names INGREDIENT_DB does not know; the shared rules for
// known names are untouched.
const NAME_ONLY_FALSE_FRIENDS = new RegExp('\\b(?:' + [
  'cheeses?', 'mushrooms?', 'sauces?', 'lettuces?', 'palms?', 'mayo', 'mayonnaise', 'balls?', 'artichokes?',
  'dressings?', 'pastes?', 'broths?', 'stocks?', 'bouillon', 'cubes?', 'seasonings?', 'flavou?r(?:ed|ing)?s?',
  'chips?', 'crackers?', 'crisps?', 'noodles?', 'ramen', 'oils?', 'ketchup', 'gravy', 'marinades?', 'rubs?',
  'buns?', 'breads?', 'milk', 'yogh?urts?', 'creams?', 'butter', 'veggie', 'vegan', 'vegetarian', 'plant[ -]?based',
  'meatless'
].join('|') + ')\\b', 'i');

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
  // Ground meat first: "pork mince" is ground (2 days), not a whole cut (3 days).
  if (NAME_ONLY_GROUND.match.test(n)) return NAME_ONLY_GROUND;
  if (rule) return rule;
  return NAME_ONLY_EXTRA.find((candidate) => candidate.match.test(n)) || null;
}

function unrecognizedSafetyFood(name) {
  const rule = unrecognizedSafetyRule(name);
  return rule ? rule.safetyClass : null;
}

// Category for a new lot. Exact INGREDIENT_DB name first, then an exact alias (the shared
// stockIngredientEntry), so "chicken fillet" is stored as Protein and the app's Kitchen card applies
// the poultry limit. A name the ingredient list does not know that reads as raw meat, poultry or fish
// is stored as Protein (review SF2): the shared fridge limits apply only to category Protein, so
// "Chicken wings" or "Steak" then get their 2-3 day limit in the app and here. Any other unknown
// name gets '' (the app's manual Add with no match).
function categoryFor(name) {
  const entry = FoodSafety.stockIngredientEntry(name.toLowerCase().trim());
  if (entry) return entry.category || '';
  return unrecognizedSafetyRule(name) ? 'Protein' : '';
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

// The fridge shelf life of a lot leaving the freezer. A bridge-prepared frozen lot carries the
// ready-food freezer life (90); that value is read as the prepared signature whatever the raw item's
// life is (review MF2: prepared rice, pasta or peanut butter has a raw life above 90), and in the
// fridge it gets the ready-food fridge life, never longer than the raw item's. A lot whose shelf life
// is 90 for another reason only gets a shorter life, the safe direction. Any other lot gets the app's
// ingredientShelfLife() (exact-name DB value, else the category default).
function fridgeLifeFor(record) {
  const raw = rawShelfLife(dbEntryByExactName(String(record.name || '')), record.category);
  if (record.shelfLifeDays === READY_FOOD_CONTRACT.defaultFreezerLife) {
    return Math.min(READY_FOOD_CONTRACT.defaultFridgeLife, raw);
  }
  return raw;
}

const CHECK_IN_APP = 'Ask the user to check the item in the app.';

// Shared by update_pantry_item and undo_request (review 3 MF-A). A lot that is not usable now never
// becomes usable by a chat change, and a lot with a warning now (expired, unknown, past its estimate
// or best-before) never loses it. Returns the current verdict when `next` would read safer than
// `current`, else null.
const WARNING_STATUSES = ['expired', 'unknown', 'check'];

function readsSaferThan(current, next, today) {
  const now = readBackItem(current, today).safety;
  const after = readBackItem(next, today).safety;
  if ((now.usable !== true && after.usable === true) ||
      (WARNING_STATUSES.includes(now.status) && !WARNING_STATUSES.includes(after.status))) {
    return now;
  }
  return null;
}

function daysFromToday(day, today) {
  return isCalendarDay(day) ? FoodSafety.stockCalendarDay(day) - FoodSafety.stockCalendarDay(today) : null;
}

function unsafeCounterError(name) {
  return new ValidationError('unsafe_storage: "' + name + '" looks like raw meat, poultry or fish, or a food the bridge cannot ' +
    'classify, so it is not recorded on the counter (it needs the fridge or the freezer). ' + CHECK_IN_APP,
  { field: 'storage', code: 'unsafe_storage' });
}

function unrecognizedFoodError(name, unknownFood) {
  return new ValidationError('unrecognized_food: "' + name + '" looks like ' + unknownFood + ' food, but the shared food-safety ' +
    'rules have no fridge safety limit for that name, so it is not recorded in the fridge from chat. It can be recorded in ' +
    'the freezer. ' + CHECK_IN_APP, { field: 'name', code: 'unrecognized_food' });
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
      throw new ValidationError('needs_storage: "' + name + '" looks like raw meat, poultry or fish, or a food the bridge cannot ' +
        'classify, so its storage is never guessed. Ask the user whether it is in the fridge or the freezer, and send storage.',
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
    throw new ValidationError('needs_bought_date: "' + name + '" has a fridge safety limit (raw meat, poultry, fish or a cooked ' +
      'leftover), so its bought date is never assumed. Ask the user what day it was bought and send boughtDate (YYYY-MM-DD); use ' +
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
  // A name the ingredient list does not know never keeps a shelf life longer than its name-only
  // fridge limit ("pork mince": 2 days, not the 3-day Protein default).
  const nameOnly = unrecognizedSafetyRule(name);
  if (nameOnly) shelfLifeDays = Math.min(shelfLifeDays, nameOnly.days);
  if (args.prepared === true) {
    // Frozen prepared food keeps the ready-food freezer life (freezing is what makes it last; the
    // raw item's fridge life does not apply), with or without a printed date (review 3 MF-B): the
    // printed date governs the read while it is set, and the 90-day value stays the prepared
    // signature, so a later printed-date clear plus a move to the fridge still needs the thaw day
    // and is capped at the fridge life (fridgeLifeFor). In the fridge the ready-food life is never
    // longer than the raw item's own life.
    if (storage === 'freezer') shelfLifeDays = readyFoodLife('freezer');
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
    // Only two different printed dates, both present, make a different lot. A printed date missing
    // on either side is unknown, not different (review SF1), so it is still asked about. A lot with a
    // printed date on either side is never merged by add_stock (it has no printed-date input), so
    // only a separate lot is offered then.
    const newPrinted = args.printedDate !== undefined ? args.printedDate : null;
    const twins = (pantry || []).filter((p) => isStoredRecord(p) && readableId(p.id) && sameText(p.name, name) &&
      p.purchaseDate === purchaseDate && effectiveStorage(p) === storage &&
      (printedDateOf(p) === newPrinted || printedDateOf(p) == null || newPrinted == null) &&
      !(deletionsPantry && Object.hasOwn(deletionsPantry, String(p.id))));
    if (twins.length) {
      const ids = twins.map((p) => '"' + String(p.id) + '"').join(', ');
      const anyPrinted = newPrinted != null || twins.some((p) => printedDateOf(p) != null);
      const where = '"' + name + '" bought ' + purchaseDate + ' and stored in the ' + storage +
        (newPrinted ? ' with printed date ' + newPrinted : '') + ' is already recorded (ingredientId ' + ids + '). ';
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
    return new ValidationError('unknown_bought_date: "' + name + '" looks like raw meat, poultry or fish, or a food the bridge cannot ' +
      'classify, and its bought date is not known, so ' + when + ' cannot be done from chat. ' + CHECK_IN_APP,
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
    // Not usable for any other reason (a passed use-by, an unknown storage): freezing it would hide
    // that, because the freezer read has no fridge limit (review 3 MF-A).
    const nowSafety = readBackItem(record, today).safety;
    if (nowSafety.usable !== true) {
      throw new ValidationError('not_usable: "' + name + '" is not safe to use as it is now (' + nowSafety.label + '), so moving it ' +
        'to the freezer is refused: freezing does not make it safe again. ' + CHECK_IN_APP, { field: 'storage', code: 'not_usable' });
    }
  }

  // A fridge-safety lot's bought date only moves earlier (a later date would hide used-up fridge
  // time), except the thaw restart when it leaves the freezer for the fridge.
  if (safetyLot && next.purchaseDate !== record.purchaseDate && !(leavesFreezerForFridge && thawDateGiven)) {
    if (!isCalendarDay(record.purchaseDate)) {
      throw pastLimitError(name, { daysLeft: null }, 'setting its bought date');
    }
    if (next.purchaseDate > record.purchaseDate) {
      throw new ValidationError('later_bought_date: "' + name + '" looks like raw meat, poultry or fish, or a food the bridge cannot ' +
        'classify; its bought date (' + record.purchaseDate + ') can only be corrected to an earlier day from chat, because a later ' +
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
  const frozenPrinted = leavesFreezerForFridge && printedDateOf(record) != null;
  const thawing = leavesFreezerForFridge && (safetyLot || longLife || frozenPrinted);
  if (thawing && !thawDateGiven) {
    let why = 'has a freezer shelf life; moved';
    if (safetyLot) why = 'looks like raw meat, poultry or fish, or a food the bridge cannot classify; moved';
    else if (frozenPrinted && !longLife) why = 'has a printed date and is moving';
    throw new ValidationError('needs_thaw_date: thaw reminder - "' + name + '" ' + why + ' from the freezer to the fridge, its ' +
      'fridge time counts from the day it thawed, not the day it was bought or made. Ask the user: if it moved to the fridge ' +
      'today, send thawedToday: true; otherwise send boughtDate as the day it moved.',
    { field: 'thawedToday', code: 'needs_thaw_date' });
  }
  // A printed date is read for the pack's own storage; out of the freezer it no longer says how long
  // the lot keeps, and the bridge never invents or silently clears it (review MF2).
  if (frozenPrinted) {
    throw new ValidationError('frozen_printed_date: "' + name + '" has a printed date (' + printedDateOf(record) + ') recorded while ' +
      'it was in the freezer. Once it thaws that date no longer says how long it keeps in the fridge, so the move is not made ' +
      'from chat. ' + CHECK_IN_APP, { field: 'storage', code: 'frozen_printed_date' });
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

  // A fridge-safety lot's printed date is never loosened (cleared, moved later, or turned from a
  // use-by into a best-before) once it has passed, nor past the lot's fridge limit counted from its
  // bought date (review 3 MF-A). Moving it earlier, or a correction within the fridge limit on an
  // in-date lot, is still made.
  const oldPrinted = printedDateOf(record);
  const newPrinted = printedDateOf(next);
  const loosens = oldPrinted != null && (newPrinted == null || newPrinted > oldPrinted ||
    (next.printedDateKind === 'best-before' && record.printedDateKind !== 'best-before'));
  if (safetyLot && loosens) {
    const clock = fridgeClock(next, today);
    const oldLeft = daysFromToday(oldPrinted, today);
    let newLeft = newPrinted != null ? daysFromToday(newPrinted, today) : FoodSafety.pantryDaysLeft(next, today);
    if (newPrinted == null && toStorage === 'fridge' && clock && clock.daysLeft != null && Number.isFinite(newLeft)) newLeft = Math.min(newLeft, clock.daysLeft);
    if (oldLeft == null || oldLeft < 0 || !clock || clock.daysLeft == null || !Number.isFinite(newLeft) || newLeft > clock.daysLeft) {
      const what = newPrinted == null ? 'clearing it' : (newPrinted > oldPrinted ? 'moving it later' : 'making it a best-before date');
      throw new ValidationError('unsafe_printed_date: "' + name + '" has a fridge safety limit (raw meat, poultry, fish or a cooked ' +
        'leftover) and its printed date (' + oldPrinted + ') ' + (oldLeft != null && oldLeft < 0 ? 'has passed' : 'ends its safe time') +
        ', so ' + what + ' is refused: it would make the item read safer than it is. ' + CHECK_IN_APP,
      { field: 'printedDate', code: 'unsafe_printed_date' });
    }
  }

  // Any route: an edit never makes a lot read safer than it is now (the rule undo_request uses).
  // The one exception is the thaw restart: a frozen lot past only its quality estimate (frozen food
  // stays safe; USDA) starts a fresh fridge clock on the thaw day.
  const nowWarning = readsSaferThan(record, next, today);
  const thawRestart = thawing && thawDateGiven && nowWarning && nowWarning.status === 'check' && nowWarning.reason === 'estimate-passed';
  if (nowWarning && !thawRestart) {
    throw new ValidationError('unsafe_edit: "' + name + '" is not safe to use as it is now (' + nowWarning.label + '), and this ' +
      'change would make it read as usable. ' + CHECK_IN_APP, { field: 'ingredientId', code: 'unsafe_edit' });
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

// undo_request of an update_pantry_item (review MF1): the restore is an edit from the CURRENT lot
// (what the request left, which planUndo has checked is still live) back to the restored lot, so it
// must pass the same food-safety rules updatePantryItem applies. Returns null when the restore is
// safe, else the reason it would make the lot read safer than it is. `today` is the household day,
// fixed once per call. The restore is never refused only for leaving the freezer: the restored
// fridge lot keeps its original bought date, which is never later than a thaw day.
export function unsafeRestoreReason(current, restored, today) {
  requireHouseholdDay(today);
  const name = String((restored && restored.name) || (current && current.name) || 'this item');
  const from = effectiveStorage(current);
  const to = effectiveStorage(restored);
  const safetyLot = needsStatedStorage(current, today) || needsStatedStorage(restored, today);

  if (safetyLot && to === 'counter' && from !== 'counter') {
    return '"' + name + '" looks like raw meat, poultry or fish, or a food the bridge cannot classify, and the undo would put it on the counter.';
  }
  // Leaving the fridge (or anywhere but the freezer) for the freezer: freezing does not make a lot
  // past its fridge limit, or with no known bought date, safe again.
  if (safetyLot && to === 'freezer' && from !== 'freezer') {
    const clock = fridgeClock(current, today);
    if (clock && clock.daysLeft == null) return '"' + name + '" has no known bought date, and the undo would move it into the freezer.';
    if (clock && clock.daysLeft < 0) {
      return '"' + name + '" is past its ' + clock.limitDays + '-day fridge safety limit (' + clock.safetyClass + '), and the undo ' +
        'would move it back into the freezer, where it would read as safe.';
    }
    const nowSafety = readBackItem(current, today).safety;
    if (nowSafety.usable !== true) {
      return '"' + name + '" is not safe to use as it is now (' + nowSafety.label + '), and the undo would move it into the freezer.';
    }
  }
  // A fridge-safety lot's bought date never moves later (that would hide used-up fridge time).
  if (safetyLot && restored.purchaseDate !== current.purchaseDate) {
    if (!isCalendarDay(current.purchaseDate) || (isCalendarDay(restored.purchaseDate) && restored.purchaseDate > current.purchaseDate)) {
      return '"' + name + '" would get a later bought date (' + String(restored.purchaseDate) + ' instead of ' +
        String(current.purchaseDate) + '), which would hide fridge time it already used.';
    }
  }
  // A name the shared rules cannot place never moves into the fridge without its limit.
  const unknownFood = unrecognizedSafetyFood(name);
  if (to === 'fridge' && from !== 'fridge' && unknownFood && fridgeRuleFor(restored, today) == null) {
    return '"' + name + '" looks like ' + unknownFood + ' food with no shared fridge safety limit, and the undo would move it into the fridge.';
  }
  // Any other route: a lot that is not usable now never becomes usable by an undo, and a lot with a
  // warning now (expired, unknown, past its estimate) never loses it (a frozen prepared lot thawed a
  // week ago would otherwise get its 90-day freezer life back).
  const now = readsSaferThan(current, restored, today);
  if (now) {
    return '"' + name + '" is not safe to use as it is now (' + now.label + '), and the undo would make it read as usable.';
  }
  return null;
}
