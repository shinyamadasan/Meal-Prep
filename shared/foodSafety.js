// Food-safety rules shared by the classic-script app and the conversational Worker
// (PROP-041 P1-1, TASK-091, D-090). One source of truth for "safe to eat": the app loads
// this file with a <script> tag before app.js and keeps thin wrappers with its old global
// names; the Worker loads it by side-effect import. Same pattern as readyFoodContract.js.
//
// Everything here is pure. No function reads the clock: callers pass `today` as the
// household calendar day ('YYYY-MM-DD'). Functions that need a storage location take an
// optional `inferStorage(name, category)` hook. The app passes its own inferStorage()
// (INGREDIENT_DB + PANTRY_KNOWLEDGE + category fallback), which always answers, so app
// verdicts are exactly what they were before the move. Without a hook (the Worker), the
// lot's own `storage` is used, else INGREDIENT_DB's explicit `storage`, else null — and a
// null storage makes pantryDateSignal() `unknown` (never usable) instead of a guess.
//
// Code below is moved from app.js unchanged apart from threading `today`/`inferStorage`
// through; top-level statements are left unindented so the move stays easy to diff.
(function (root) {
'use strict';

var DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// The household calendar day every verdict is computed for. A missing or malformed day
// is a caller bug; failing loudly beats a silently wrong "safe to eat".
function requireToday(today) {
  if (typeof today !== 'string' || !DATE_ONLY.test(today) || stockCalendarDay(today) == null) {
    throw new TypeError('MealPrepFoodSafety: today must be a YYYY-MM-DD calendar day, got ' + String(today));
  }
  return today;
}

// Default storage hook: INGREDIENT_DB's explicit storage for an exact name, else null.
function defaultInferStorage(name) {
  var n = (name || '').toLowerCase().trim();
  var dbEntry = INGREDIENT_DB.find(function(i) { return i.name.toLowerCase() === n; });
  return dbEntry && dbEntry.storage ? dbEntry.storage : null;
}

function storageHook(inferStorage) {
  return typeof inferStorage === 'function' ? inferStorage : defaultInferStorage;
}

// ── Freshness tracking (pantry expiry + cooked-meal shelf life) ───────────────
var FRESHNESS_WARN_DAYS = 2; // warn when this many days or fewer remain

// Rough default shelf life (days) by ingredient category — last-resort fallback only.
// Per-ingredient values in INGREDIENT_DB always take priority via ingredientShelfLife().
function categoryShelfLife(category) {
  switch ((category || '').toLowerCase()) {
    case 'protein': return 3;
    case 'vegetable': return 7;
    case 'fruit': return 5;
    case 'dairy': return 7;
    case 'grain': return 180;
    case 'pantry': return 365;
    default: return 7;
  }
}

// Whole days remaining until (startDate + shelfLifeDays). Negative = expired.
function daysLeftFrom(startDateStr, shelfLifeDays, today) {
  requireToday(today);
  if (!startDateStr || shelfLifeDays == null || isNaN(shelfLifeDays)) return null;
  var start = new Date(startDateStr + 'T00:00:00');
  if (isNaN(start.getTime())) return null;
  var expiry = start.getTime() + Number(shelfLifeDays) * 86400000;
  var todayMs = new Date(today + 'T00:00:00').getTime();
  return Math.round((expiry - todayMs) / 86400000);
}

// Days left for a pantry item. Two modes: by printed expiry date (dateMode
// 'expiry' — for canned/packaged staples), or bought date + shelf life.
function pantryDaysLeft(p, today) {
  if (p.dateMode === 'expiry') return daysLeftFrom(p.expiryDate, 0, today);
  var shelf = (p.shelfLifeDays != null) ? p.shelfLifeDays : categoryShelfLife(p.category);
  return daysLeftFrom(p.purchaseDate, shelf, today);
}

// FDA Refrigerator & Freezer Storage Chart (40°F / 4°C): https://www.fda.gov/media/74435/download
// First matching rule wins. Use the conservative end for whole cuts and opened deli meats.
const FRIDGE_SAFETY_LIMITS = [
  { safetyClass: 'cooked-leftover', days: 4, match: /\b(?:cooked|leftovers?|adobo|curry|stews?(?![ -]+meat)|soups?)\b/i },
  { safetyClass: 'cured-processed', days: 7, match: /\b(?:bacon|smoked links?|hot[ -]?dogs?)\b/i },
  { safetyClass: 'cured-processed', days: 3, match: /\b(?:ham|luncheon(?: meat)?|lunch meat|deli meat|spam)\b/i },
  { safetyClass: 'raw-sausage', days: 2, match: /\b(?:sausages?|longganisa|longanisa|chorizo)\b/i, exclude: /\bsmoked\b/i },
  { safetyClass: 'ground', days: 2, match: /\b(?:ground|minced|giniling|hamburgers?|stew[ -]+meats?)\b/i },
  { safetyClass: 'variety', days: 2, match: /\b(?:liver|kidney|heart|tongue|giblet|tripe|atay|isaw)s?\b/i },
  { safetyClass: 'poultry', days: 2, match: /\b(?:chicken|turkey|duck|manok)s?\b/i },
  { safetyClass: 'seafood', days: 2, match: /\b(?:fish|bangus|tilapia|salmon|tuna|galunggong|shrimp|prawn|hipon|squid|pusit|crab|mussel|clam|scallop|oyster|isda)s?\b/i },
  { safetyClass: 'whole-cut', days: 3, match: /\b(?:beef|pork|lamb|veal|goat|steak|chop|roast|rib|brisket|sirloin|liempo|kasim)s?\b/i }
];
const COOKED_FRIDGE_LIMIT = FRIDGE_SAFETY_LIMITS[0].days;
const FRIDGE_SAFETY_EXCLUSIONS = /\b(?:eggs?|itlog|tofu|tokwa|tempeh|beans?|lentils?|canned|tinned|dried|powder)\b/i;

function pantryFridgeSafety(p, today, inferStorage) {
  requireToday(today);
  var infer = storageHook(inferStorage);
  // Fridge limits only: frozen food is quality-only, and counter food is shelf-stable
  // (canned luncheon meat, instant soup). Condiments and dry goods never take this path.
  if ((p.storage || infer(p.name, p.category)) !== 'fridge') return null;
  if (stockFoodClass(p) !== 'perishable') return null;
  var name = (p.name || '').trim().toLowerCase();
  if (FRIDGE_SAFETY_EXCLUSIONS.test(name)) return null;
  var entry = stockIngredientEntry(name);
  var names = [name, entry?.name || '', ...(entry?.aliases || [])];
  if (names.some(value => FRIDGE_SAFETY_EXCLUSIONS.test(value))) return null;
  var category = (p.category || entry?.category || '').toLowerCase();
  // The lot's wording takes precedence over broad aliases (e.g. Hotdog lists "sausage").
  var rule;
  for (var value of names) {
    rule = FRIDGE_SAFETY_LIMITS.find(candidate =>
      (category === 'protein' || (candidate.safetyClass === 'cooked-leftover' &&
        !['vegetable', 'fruit', 'dairy', 'pantry', 'grain'].includes(category))) &&
      candidate.match.test(value) && !candidate.exclude?.test(name));
    if (rule) break;
  }
  if (!rule) return null;
  var limitDays = Math.min(rule.days, entry?.fridgeDays ?? rule.days);
  var boughtDay = /^\d{4}-\d{2}-\d{2}$/.test(p.purchaseDate) ? stockCalendarDay(p.purchaseDate) : null;
  var daysLeft = boughtDay == null ? null : boughtDay + limitDays - stockCalendarDay(today);
  return { daysLeft, limitDays, safetyClass: rule.safetyClass };
}

function pantryDateSignal(p, today, inferStorage) {
  requireToday(today);
  var infer = storageHook(inferStorage);
  var printed = p.dateMode === 'expiry';
  var bestBefore = printed && p.printedDateKind === 'best-before';
  var daysLeft = pantryDaysLeft(p, today);
  // A malformed printed date must never authorize a deletion.
  if (printed && (!/^\d{4}-\d{2}-\d{2}$/.test(p.expiryDate) || stockCalendarDay(p.expiryDate) == null)) {
    daysLeft = null;
  }
  // Shared default path only: without a storage location the fridge limits cannot be
  // applied, so the verdict is unknown and never usable. The app's own inferStorage()
  // always answers, so the app never reaches this branch.
  var storage = p.storage || infer(p.name, p.category);
  if (!storage) {
    return { kind: 'unknown', daysLeft: daysLeft, printed: printed, bestBefore: bestBefore,
      safety: 'unknown-storage' };
  }
  var fridge = pantryFridgeSafety(p, today, infer);
  if (fridge && (fridge.daysLeft == null || fridge.daysLeft < 0)) {
    var safety = fridge.daysLeft == null ? 'unknown-date' : 'past-limit';
    if (printed && daysLeft < 0) daysLeft = Math.min(daysLeft, fridge.daysLeft ?? Infinity);
    else daysLeft = fridge.daysLeft;
    return { kind: 'expired', daysLeft, printed, bestBefore, safety,
      limitDays: fridge.limitDays, safetyClass: fridge.safetyClass };
  }
  var kind = null;
  if (daysLeft != null) {
    if (daysLeft < 0) {
      if (printed) kind = bestBefore ? 'check' : 'expired';
      // Safety checks are for refrigerated perishables; counter produce past an
      // estimate (onions, bananas) is a quality note on the Fridge card only.
      else if (stockFoodClass(p) === 'perishable' &&
               storage !== 'counter') kind = 'check';
    } else if (daysLeft <= FRESHNESS_WARN_DAYS) kind = 'use-soon';
  }
  var signal = { kind: kind, daysLeft: daysLeft, printed: printed, bestBefore: bestBefore };
  if (fridge) {
    signal.limitDays = fridge.limitDays;
    signal.safetyClass = fridge.safetyClass;
  }
  return signal;
}

function pantryLotAvailable(p, today, inferStorage) {
  if (p.stockLevel === 'empty') return false;
  var signal = pantryDateSignal(p, today, inferStorage);
  if (signal.safety) return false;
  // A printed use-by can end the window sooner for the same fridge safety lot.
  if (signal.kind === 'expired' && signal.safetyClass) return false;
  if (isStaple(p)) return true;
  if (Number.isFinite(p.quantity) && p.quantity <= 0) return false;
  return signal.kind !== 'expired';
}

// Stock health (D-087). The first matching rule wins. Food class is separate
// from the pantry staple flag, which controls how the app tracks quantity.
const STOCK_CLASS_RULES = {
  order: ['cooked-meal', 'frozen', 'fresh-herb', 'condiment', 'dry-goods', 'perishable', 'pantry-staple'],
  herbs: /\b(?:herbs?|basil|parsley|cilantro|coriander leaf|mint|dill|chives|oregano|thyme|rosemary|sage|tarragon)\b/,
  dried: /\b(?:dry|dried|ground|powder(?:ed)?|flakes?)\b/,
  fresh: /\bfresh\b/,
  condiment: /\b(?:sauces?|oils?|vinegars?|spices?|seasonings?|pastes?|dressings?|condiments?|ketchup|catsup|mayonnaise|mayo|mustard|pesto|salsa|salt|peppercorns?|(?:black|white) pepper|paprika|cumin|turmeric|cinnamon|nutmeg|cardamom|allspice|annatto|masala|bay leaves|garlic powder|onion powder|chili flakes|chili powder|curry powder|gochujang|bagoong|miso|tahini|vanilla extract)\b|^cloves?$/,
  dryGoods: /\b(?:canned|tinned|rice|pasta|flours?|oats|oatmeal|quinoa|couscous|lentils|cornstarch)\b/,
  rawCategories: ['protein', 'vegetable', 'fruit', 'dairy'],
  shelfCategories: ['pantry', 'grain']
};

function stockIngredientEntry(name) {
  return INGREDIENT_DB.find(i => i.name.toLowerCase() === name) ||
    INGREDIENT_DB.find(i => (i.aliases || []).some(alias => alias.toLowerCase() === name));
}

function stockFoodClass(record) {
  const rules = STOCK_CLASS_RULES;
  const name = (record.name || '').trim().toLowerCase();
  const entry = stockIngredientEntry(name);
  const dbName = (entry?.name || '').toLowerCase();
  const category = (record.category || entry?.category || '').toLowerCase();
  const herb = rules.herbs.test(name) || rules.herbs.test(dbName);
  const freshHerb = herb && !rules.dried.test(name) &&
    (rules.fresh.test(name) || record.storage === 'fridge' || category === 'vegetable');
  const matches = {
    'cooked-meal': 'cookedDate' in record || 'portionsRemaining' in record || 'fridgeLife' in record,
    frozen: record.storage === 'freezer',
    'fresh-herb': freshHerb,
    condiment: rules.condiment.test(name.replace(/\bin oil\b/g, '')) || rules.condiment.test(dbName) || herb,
    'dry-goods': rules.dryGoods.test(name) || rules.dryGoods.test(dbName),
    perishable: rules.rawCategories.includes(category) ||
      (!rules.shelfCategories.includes(category) && record.storage !== 'counter' && record.staple !== true),
    'pantry-staple': true
  };
  const match = rules.order.find(key => matches[key]);
  if (match === 'fresh-herb') return 'perishable';
  if (match === 'dry-goods') return 'pantry-staple';
  return match;
}

// Compare calendar days without daylight-saving rounding. Stored timestamps
// use the same local calendar as todayISO(); date-only values keep their day.
function stockCalendarDay(value) {
  if (typeof value !== 'string' || !value) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  if (dateOnly && date.toISOString().slice(0, 10) !== value) return null;
  const dayMs = 86400000;
  return (dateOnly ? date.getTime() : Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())) / dayMs;
}

// ── Cooked meal tracking ─────────────────────────────────────────────────────

// Staples (spices, condiments, salt, sugar, oil) are "always stocked" and never
// deducted when cooking. Default = Pantry category; per-item `staple` overrides.
function isStaple(p) {
  if (p.staple === true) return true;
  if (p.staple === false) return false;
  var n = (p.name || '').toLowerCase();
  var dbEntry = INGREDIENT_DB.find(function(i) { return i.name.toLowerCase() === n; });
  if (dbEntry && dbEntry.isStaple != null) return !!dbEntry.isStaple;
  return (p.category || '').toLowerCase() === 'pantry';
}

function cookedShelfLife(m) {
  if (m.storage === 'freezer') return m.freezerLife ?? null;
  return Math.min(m.fridgeLife ?? COOKED_FRIDGE_LIMIT, COOKED_FRIDGE_LIMIT);
}

function cookedDateSignal(meal, today) {
  var daysLeft = daysLeftFrom(meal.cookedDate, cookedShelfLife(meal), today);
  var kind = null;
  if (daysLeft != null) {
    if (daysLeft < 0) kind = meal.storage === 'freezer' ? 'check' : 'expired';
    else if (daysLeft <= FRESHNESS_WARN_DAYS) kind = 'use-soon';
  }
  return { kind: kind, daysLeft: daysLeft };
}

// ── Ingredient Autocomplete Database ──────────────────────────────────────────
// Each entry carries storage location, per-ingredient shelf life, and an
// isStaple flag so inferStorage() / ingredientShelfLife() / isStaple() all
// have correct answers without falling back to coarse category defaults.

const INGREDIENT_DB = [
  // Proteins
  { name: 'Chicken Breast', unit: 'kg', category: 'Protein', price: '₱200/kg', store: 'Wet Market / Supermarket', storage: 'fridge', shelfLifeDays: 2, aliases: ['chicken', 'manok', 'raw chicken', 'chicken fillet'], fridgeDays: 2, freezerDays: 270, trackExpiry: true, priceValue: 200, minStockQty: null },
  { name: 'Chicken Thigh', unit: 'kg', category: 'Protein', price: '₱180/kg', store: 'Wet Market / Supermarket', storage: 'fridge', shelfLifeDays: 2, aliases: ['chicken thigh', 'manok', 'dark meat chicken'], fridgeDays: 2, freezerDays: 270, trackExpiry: true, priceValue: 180, minStockQty: null },
  { name: 'Chicken Leg', unit: 'kg', category: 'Protein', price: '₱160/kg', store: 'Wet Market / Supermarket', storage: 'fridge', shelfLifeDays: 2, aliases: ['chicken leg', 'drumstick', 'chicken drumstick', 'manok'], fridgeDays: 2, freezerDays: 270, trackExpiry: true, priceValue: 160, minStockQty: null },
  { name: 'Ground Chicken', unit: 'kg', category: 'Protein', price: '₱220/kg', store: 'Supermarket', storage: 'fridge', shelfLifeDays: 2, aliases: ['ground chicken', 'minced chicken', 'chicken giniling'], fridgeDays: 2, freezerDays: 90, trackExpiry: true, priceValue: 220, minStockQty: null },
  { name: 'Whole Chicken', unit: 'kg', category: 'Protein', price: '₱160/kg', store: 'Wet Market / Supermarket', storage: 'fridge', shelfLifeDays: 2, aliases: ['whole chicken', 'buong manok', 'manok'], fridgeDays: 2, freezerDays: 270, trackExpiry: true, priceValue: 160, minStockQty: null },
  { name: 'Pork Belly (Liempo)', unit: 'kg', category: 'Protein', price: '₱280/kg', store: 'Wet Market / Supermarket', storage: 'fridge', shelfLifeDays: 3, aliases: ['liempo', 'pork belly', 'baboy', 'pork'], fridgeDays: 3, freezerDays: 180, trackExpiry: true, priceValue: 280, minStockQty: null },
  { name: 'Ground Pork', unit: 'kg', category: 'Protein', price: '₱230/kg', store: 'Wet Market / Supermarket', storage: 'fridge', shelfLifeDays: 2, aliases: ['ground pork', 'minced pork', 'pork giniling', 'giniling na baboy'], fridgeDays: 2, freezerDays: 90, trackExpiry: true, priceValue: 230, minStockQty: null },
  { name: 'Pork Chop', unit: 'kg', category: 'Protein', price: '₱260/kg', store: 'Wet Market / Supermarket', storage: 'fridge', shelfLifeDays: 3, aliases: ['pork chop', 'pork chops', 'baboy'], fridgeDays: 3, freezerDays: 180, trackExpiry: true, priceValue: 260, minStockQty: null },
  { name: 'Pork Ribs', unit: 'kg', category: 'Protein', price: '₱300/kg', store: 'Wet Market / Supermarket', storage: 'fridge', shelfLifeDays: 3, aliases: ['pork ribs', 'ribs', 'baby back ribs', 'baboy'], fridgeDays: 3, freezerDays: 180, trackExpiry: true, priceValue: 300, minStockQty: null },
  { name: 'Pork Shoulder', unit: 'kg', category: 'Protein', price: '₱220/kg', store: 'Wet Market / Supermarket', storage: 'fridge', shelfLifeDays: 3, aliases: ['pork shoulder', 'kasim', 'baboy', 'pork kasim'], fridgeDays: 3, freezerDays: 180, trackExpiry: true, priceValue: 220, minStockQty: null },
  { name: 'Pork Liver', unit: 'kg', category: 'Protein', price: '₱120/kg', store: 'Wet Market', storage: 'fridge', shelfLifeDays: 1, aliases: ['pork liver', 'liver', 'atay', 'atay ng baboy'], fridgeDays: 1, freezerDays: 90, trackExpiry: true, priceValue: 120, minStockQty: null },
  { name: 'Ground Beef', unit: 'kg', category: 'Protein', price: '₱320/kg', store: 'Wet Market / Supermarket', storage: 'fridge', shelfLifeDays: 2, aliases: ['ground beef', 'minced beef', 'beef giniling', 'giniling na baka'], fridgeDays: 2, freezerDays: 90, trackExpiry: true, priceValue: 320, minStockQty: null },
  { name: 'Beef', unit: 'kg', category: 'Protein', price: '₱350/kg', store: 'Wet Market / Supermarket', storage: 'fridge', shelfLifeDays: 3, aliases: ['beef', 'baka', 'karne', 'beef steak'], fridgeDays: 3, freezerDays: 180, trackExpiry: true, priceValue: 350, minStockQty: null },
  { name: 'Beef Brisket', unit: 'kg', category: 'Protein', price: '₱380/kg', store: 'Supermarket', storage: 'fridge', shelfLifeDays: 3, aliases: ['beef brisket', 'brisket', 'baka'], fridgeDays: 3, freezerDays: 180, trackExpiry: true, priceValue: 380, minStockQty: null },
  { name: 'Beef Sirloin', unit: 'kg', category: 'Protein', price: '₱450/kg', store: 'Wet Market / Supermarket', storage: 'fridge', shelfLifeDays: 3, aliases: ['beef sirloin', 'sirloin', 'sirloin steak', 'baka'], fridgeDays: 3, freezerDays: 180, trackExpiry: true, priceValue: 450, minStockQty: null },
  { name: 'Shrimp', unit: 'kg', category: 'Protein', price: '₱350/kg', store: 'Wet Market / Seafood Market', storage: 'fridge', shelfLifeDays: 2, aliases: ['shrimp', 'hipon', 'prawns', 'sugpo'], fridgeDays: 2, freezerDays: 90, trackExpiry: true, priceValue: 350, minStockQty: null },
  { name: 'Bangus (Milkfish)', unit: 'kg', category: 'Protein', price: '₱140/kg', store: 'Wet Market / Supermarket', storage: 'fridge', shelfLifeDays: 2, aliases: ['bangus', 'milkfish', 'isda'], fridgeDays: 2, freezerDays: 180, trackExpiry: true, priceValue: 140, minStockQty: null },
  { name: 'Tilapia', unit: 'kg', category: 'Protein', price: '₱120/kg', store: 'Wet Market', storage: 'fridge', shelfLifeDays: 2, aliases: ['tilapia', 'isda'], fridgeDays: 2, freezerDays: 180, trackExpiry: true, priceValue: 120, minStockQty: null },
  { name: 'Salmon', unit: 'kg', category: 'Protein', price: '₱600/kg', store: 'Supermarket / S&R', storage: 'fridge', shelfLifeDays: 2, aliases: ['salmon', 'salmon fillet', 'isda'], fridgeDays: 2, freezerDays: 90, trackExpiry: true, priceValue: 600, minStockQty: null },
  { name: 'Tuna', unit: 'kg', category: 'Protein', price: '₱200/kg', store: 'Wet Market / Supermarket', storage: 'fridge', shelfLifeDays: 2, aliases: ['tuna', 'fresh tuna', 'isda', 'yellowfin tuna'], fridgeDays: 2, freezerDays: 90, trackExpiry: true, priceValue: 200, minStockQty: null },
  { name: 'Galunggong', unit: 'kg', category: 'Protein', price: '₱90/kg', store: 'Wet Market', storage: 'fridge', shelfLifeDays: 2, aliases: ['galunggong', 'round scad', 'mackerel scad', 'isda'], fridgeDays: 2, freezerDays: 180, trackExpiry: true, priceValue: 90, minStockQty: null },
  { name: 'Squid (Pusit)', unit: 'kg', category: 'Protein', price: '₱200/kg', store: 'Wet Market', storage: 'fridge', shelfLifeDays: 2, aliases: ['pusit', 'squid', 'calamari', 'calamares'], fridgeDays: 2, freezerDays: 90, trackExpiry: true, priceValue: 200, minStockQty: null },
  { name: 'Crab', unit: 'kg', category: 'Protein', price: '₱250/kg', store: 'Wet Market / Seafood Market', storage: 'fridge', shelfLifeDays: 1, aliases: ['crab', 'alimango', 'alimasag', 'blue crab'], fridgeDays: 1, freezerDays: 90, trackExpiry: true, priceValue: 250, minStockQty: null },
  { name: 'Mussels (Tahong)', unit: 'kg', category: 'Protein', price: '₱60/kg', store: 'Wet Market', storage: 'fridge', shelfLifeDays: 1, aliases: ['tahong', 'mussels', 'green mussels'], fridgeDays: 1, freezerDays: 90, trackExpiry: true, priceValue: 60, minStockQty: null },
  { name: 'Clams (Halaan)', unit: 'kg', category: 'Protein', price: '₱80/kg', store: 'Wet Market', storage: 'fridge', shelfLifeDays: 1, aliases: ['halaan', 'clams', 'tulya', 'manila clams'], fridgeDays: 1, freezerDays: 90, trackExpiry: true, priceValue: 80, minStockQty: null },
  { name: 'Eggs', unit: 'pieces', category: 'Protein', price: '₱10/pc', store: 'Grocery / Supermarket', storage: 'fridge', shelfLifeDays: 35, aliases: ['egg', 'itlog', 'eggs', 'chicken egg'], fridgeDays: 35, freezerDays: null, trackExpiry: true, priceValue: 10, minStockQty: 6 },
  { name: 'Tofu (Tokwa)', unit: 'g', category: 'Protein', price: '₱35/block', store: 'Wet Market / Grocery', storage: 'fridge', shelfLifeDays: 5, aliases: ['tokwa', 'tofu', 'bean curd', 'firm tofu'], fridgeDays: 5, freezerDays: 90, trackExpiry: true, priceValue: 35, minStockQty: null },
  { name: 'Longganisa', unit: 'pack', category: 'Protein', price: '₱80/pack', store: 'Supermarket / Grocery', storage: 'fridge', shelfLifeDays: 7, aliases: ['longganisa', 'longanisa', 'Filipino sausage', 'sweet sausage'], fridgeDays: 7, freezerDays: 60, trackExpiry: true, priceValue: 80, minStockQty: null },
  { name: 'Hotdog', unit: 'pack', category: 'Protein', price: '₱60/pack', store: 'Supermarket / Grocery', storage: 'fridge', shelfLifeDays: 7, aliases: ['hotdog', 'hot dog', 'franks', 'sausage'], fridgeDays: 7, freezerDays: 60, trackExpiry: true, priceValue: 60, minStockQty: null },
  { name: 'Bacon', unit: 'g', category: 'Protein', price: '₱250/200g', store: 'Supermarket', storage: 'fridge', shelfLifeDays: 7, aliases: ['bacon', 'bakon', 'crispy bacon', 'streaky bacon'], fridgeDays: 7, freezerDays: 30, trackExpiry: true, priceValue: 250, minStockQty: null },
  { name: 'Ham', unit: 'kg', category: 'Protein', price: '₱300/kg', store: 'Supermarket', storage: 'fridge', shelfLifeDays: 7, aliases: ['ham', 'jamon', 'cooked ham'], fridgeDays: 7, freezerDays: 60, trackExpiry: true, priceValue: 300, minStockQty: null },
  { name: 'Sardines (Canned)', unit: 'can', category: 'Protein', price: '₱30/can', store: 'Any Store', storage: 'counter', shelfLifeDays: 1095, isStaple: true, aliases: ['sardines', 'canned sardines', 'ligo', 'sardinas'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 30, minStockQty: null },
  { name: 'Tuna (Canned)', unit: 'can', category: 'Protein', price: '₱55/can', store: 'Any Store', storage: 'counter', shelfLifeDays: 1095, isStaple: true, aliases: ['canned tuna', 'tuna flakes', 'tuna in oil', 'tuna in water'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 55, minStockQty: null },
  { name: 'Corned Beef (Canned)', unit: 'can', category: 'Protein', price: '₱75/can', store: 'Any Store', storage: 'counter', shelfLifeDays: 1095, isStaple: true, aliases: ['corned beef', 'cornbeef', 'karne norte', 'palm corned beef'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 75, minStockQty: null },

  // Vegetables
  { name: 'Garlic (Bawang)', unit: 'g', category: 'Vegetable', price: '₱80/100g', store: 'Wet Market / Grocery', storage: 'counter', shelfLifeDays: 180, isStaple: true, aliases: ['bawang', 'garlic', 'garlic cloves', 'garlic clove', 'minced garlic'], fridgeDays: 14, freezerDays: 365, trackExpiry: false, priceValue: 80, minStockQty: null },
  { name: 'Onion (Sibuyas)', unit: 'kg', category: 'Vegetable', price: '₱80/kg', store: 'Wet Market / Grocery', storage: 'counter', shelfLifeDays: 60, isStaple: true, aliases: ['sibuyas', 'onion', 'onions', 'white onion', 'yellow onion'], fridgeDays: 60, freezerDays: 365, trackExpiry: false, priceValue: 80, minStockQty: null },
  { name: 'Red Onion', unit: 'kg', category: 'Vegetable', price: '₱90/kg', store: 'Wet Market / Grocery', storage: 'counter', shelfLifeDays: 60, isStaple: true, aliases: ['red onion', 'sibuyas pula', 'bombay onion'], fridgeDays: 60, freezerDays: 365, trackExpiry: false, priceValue: 90, minStockQty: null },
  { name: 'Shallots', unit: 'kg', category: 'Vegetable', price: '₱60/kg', store: 'Wet Market', storage: 'counter', shelfLifeDays: 30, isStaple: true, aliases: ['shallots', 'sibuyas tagalog', 'echalotes', 'eschalots'], fridgeDays: 30, freezerDays: 365, trackExpiry: false, priceValue: 60, minStockQty: null },
  { name: 'Tomato (Kamatis)', unit: 'kg', category: 'Vegetable', price: '₱50/kg', store: 'Wet Market / Grocery', storage: 'counter', shelfLifeDays: 5, aliases: ['kamatis', 'tomato', 'tomatoes', 'fresh tomato'], fridgeDays: 10, freezerDays: 365, trackExpiry: true, priceValue: 50, minStockQty: null },
  { name: 'Potato (Patatas)', unit: 'kg', category: 'Vegetable', price: '₱70/kg', store: 'Wet Market / Supermarket', storage: 'counter', shelfLifeDays: 28, aliases: ['patatas', 'potato', 'potatoes', 'white potato'], fridgeDays: null, freezerDays: 365, trackExpiry: true, priceValue: 70, minStockQty: null },
  { name: 'Sweet Potato (Kamote)', unit: 'kg', category: 'Vegetable', price: '₱50/kg', store: 'Wet Market', storage: 'counter', shelfLifeDays: 21, aliases: ['kamote', 'sweet potato', 'camote', 'yam'], fridgeDays: null, freezerDays: 365, trackExpiry: true, priceValue: 50, minStockQty: null },
  { name: 'Carrot (Karot)', unit: 'kg', category: 'Vegetable', price: '₱60/kg', store: 'Wet Market / Grocery', storage: 'fridge', shelfLifeDays: 21, aliases: ['karot', 'carrot', 'carrots'], fridgeDays: 21, freezerDays: 365, trackExpiry: true, priceValue: 60, minStockQty: null },
  { name: 'Cabbage (Repolyo)', unit: 'kg', category: 'Vegetable', price: '₱40/kg', store: 'Wet Market / Grocery', storage: 'fridge', shelfLifeDays: 14, aliases: ['repolyo', 'cabbage', 'green cabbage'], fridgeDays: 14, freezerDays: 365, trackExpiry: true, priceValue: 40, minStockQty: null },
  { name: 'Kangkong', unit: 'bunches', category: 'Vegetable', price: '₱15/bunch', store: 'Wet Market', storage: 'fridge', shelfLifeDays: 3, aliases: ['kangkong', 'water spinach', 'swamp cabbage', 'morning glory'], fridgeDays: 3, freezerDays: null, trackExpiry: true, priceValue: 15, minStockQty: null },
  { name: 'Pechay', unit: 'bunches', category: 'Vegetable', price: '₱15/bunch', store: 'Wet Market / Grocery', storage: 'fridge', shelfLifeDays: 3, aliases: ['pechay', 'bok choy', 'Chinese cabbage', 'petsay'], fridgeDays: 3, freezerDays: null, trackExpiry: true, priceValue: 15, minStockQty: null },
  { name: 'Spinach', unit: 'g', category: 'Vegetable', price: '₱80/200g', store: 'Supermarket', storage: 'fridge', shelfLifeDays: 5, aliases: ['spinach', 'espinaka', 'baby spinach'], fridgeDays: 5, freezerDays: 365, trackExpiry: true, priceValue: 80, minStockQty: null },
  { name: 'Ampalaya (Bitter Melon)', unit: 'pieces', category: 'Vegetable', price: '₱30/pc', store: 'Wet Market', storage: 'fridge', shelfLifeDays: 7, aliases: ['ampalaya', 'bitter melon', 'bitter gourd', 'amplaya', 'amargoso'], fridgeDays: 7, freezerDays: 365, trackExpiry: true, priceValue: 30, minStockQty: null },
  { name: 'Talong (Eggplant)', unit: 'pieces', category: 'Vegetable', price: '₱20/pc', store: 'Wet Market / Grocery', storage: 'counter', shelfLifeDays: 5, aliases: ['talong', 'eggplant', 'aubergine', 'brinjal'], fridgeDays: 10, freezerDays: 365, trackExpiry: true, priceValue: 20, minStockQty: null },
  { name: 'Sitaw (String Beans)', unit: 'g', category: 'Vegetable', price: '₱40/bundle', store: 'Wet Market', storage: 'fridge', shelfLifeDays: 5, aliases: ['sitaw', 'string beans', 'green beans', 'habichuelas', 'yard long beans'], fridgeDays: 5, freezerDays: 365, trackExpiry: true, priceValue: 40, minStockQty: null },
  { name: 'Okra', unit: 'g', category: 'Vegetable', price: '₱40/250g', store: 'Wet Market / Grocery', storage: 'fridge', shelfLifeDays: 3, aliases: ['okra', 'ladyfinger', 'lady finger', 'ladies fingers'], fridgeDays: 3, freezerDays: 365, trackExpiry: true, priceValue: 40, minStockQty: null },
  { name: 'Malunggay (Moringa)', unit: 'bunches', category: 'Vegetable', price: '₱10/bunch', store: 'Wet Market', storage: 'fridge', shelfLifeDays: 3, aliases: ['malunggay', 'moringa', 'drumstick leaves', 'malungay'], fridgeDays: 3, freezerDays: null, trackExpiry: true, priceValue: 10, minStockQty: null },
  { name: 'Kalabasa (Squash)', unit: 'kg', category: 'Vegetable', price: '₱30/kg', store: 'Wet Market', storage: 'counter', shelfLifeDays: 28, aliases: ['kalabasa', 'squash', 'pumpkin', 'kalabasa squash'], fridgeDays: 90, freezerDays: 365, trackExpiry: true, priceValue: 30, minStockQty: null },
  { name: 'Upo (Bottle Gourd)', unit: 'pieces', category: 'Vegetable', price: '₱20/pc', store: 'Wet Market', storage: 'counter', shelfLifeDays: 7, aliases: ['upo', 'bottle gourd', 'calabash', 'opo squash'], fridgeDays: 14, freezerDays: null, trackExpiry: true, priceValue: 20, minStockQty: null },
  { name: 'Patola (Sponge Gourd)', unit: 'pieces', category: 'Vegetable', price: '₱20/pc', store: 'Wet Market', storage: 'counter', shelfLifeDays: 7, aliases: ['patola', 'sponge gourd', 'luffa', 'ridge gourd'], fridgeDays: 14, freezerDays: null, trackExpiry: true, priceValue: 20, minStockQty: null },
  { name: 'Bell Pepper', unit: 'pieces', category: 'Vegetable', price: '₱30/pc', store: 'Wet Market / Supermarket', storage: 'fridge', shelfLifeDays: 7, aliases: ['bell pepper', 'capsicum', 'kampanilya', 'sweet pepper'], fridgeDays: 7, freezerDays: 365, trackExpiry: true, priceValue: 30, minStockQty: null },
  { name: 'Green Bell Pepper', unit: 'pieces', category: 'Vegetable', price: '₱25/pc', store: 'Wet Market / Grocery', storage: 'fridge', shelfLifeDays: 7, aliases: ['green bell pepper', 'green capsicum', 'green pepper'], fridgeDays: 7, freezerDays: 365, trackExpiry: true, priceValue: 25, minStockQty: null },
  { name: 'Red Bell Pepper', unit: 'pieces', category: 'Vegetable', price: '₱35/pc', store: 'Wet Market / Supermarket', storage: 'fridge', shelfLifeDays: 7, aliases: ['red bell pepper', 'red capsicum', 'red pepper'], fridgeDays: 7, freezerDays: 365, trackExpiry: true, priceValue: 35, minStockQty: null },
  { name: 'Celery (Kintsay)', unit: 'stalks', category: 'Vegetable', price: '₱20/bundle', store: 'Wet Market / Grocery', storage: 'fridge', shelfLifeDays: 14, aliases: ['kintsay', 'celery', 'kinchay', 'celery stalk'], fridgeDays: 14, freezerDays: 365, trackExpiry: true, priceValue: 20, minStockQty: null },
  { name: 'Green Onion (Sibuyas Dahon)', unit: 'stalks', category: 'Vegetable', price: '₱15/bundle', store: 'Wet Market / Grocery', storage: 'fridge', shelfLifeDays: 7, aliases: ['sibuyas dahon', 'green onion', 'spring onion', 'scallion', 'dahon ng sibuyas'], fridgeDays: 7, freezerDays: 180, trackExpiry: true, priceValue: 15, minStockQty: null },
  { name: 'Ginger (Luya)', unit: 'g', category: 'Vegetable', price: '₱60/100g', store: 'Wet Market / Grocery', storage: 'counter', shelfLifeDays: 30, isStaple: true, aliases: ['luya', 'ginger', 'gengibre', 'fresh ginger'], fridgeDays: 30, freezerDays: 180, trackExpiry: false, priceValue: 60, minStockQty: null },
  { name: 'Lemongrass (Tanglad)', unit: 'stalks', category: 'Vegetable', price: '₱10/bundle', store: 'Wet Market', storage: 'fridge', shelfLifeDays: 14, aliases: ['tanglad', 'lemongrass', 'salay', 'lemon grass'], fridgeDays: 14, freezerDays: 90, trackExpiry: true, priceValue: 10, minStockQty: null },
  { name: 'Mushroom', unit: 'g', category: 'Vegetable', price: '₱150/200g', store: 'Supermarket', storage: 'fridge', shelfLifeDays: 7, aliases: ['mushroom', 'kabute', 'button mushroom', 'shiitake'], fridgeDays: 7, freezerDays: 90, trackExpiry: true, priceValue: 150, minStockQty: null },
  { name: 'Corn (Mais)', unit: 'pieces', category: 'Vegetable', price: '₱20/pc', store: 'Wet Market / Grocery', storage: 'fridge', shelfLifeDays: 3, aliases: ['mais', 'corn', 'maize', 'sweet corn', 'corn on the cob'], fridgeDays: 3, freezerDays: 365, trackExpiry: true, priceValue: 20, minStockQty: null },
  { name: 'Cucumber', unit: 'pieces', category: 'Vegetable', price: '₱20/pc', store: 'Wet Market / Grocery', storage: 'fridge', shelfLifeDays: 7, aliases: ['cucumber', 'pipino', 'English cucumber'], fridgeDays: 7, freezerDays: null, trackExpiry: true, priceValue: 20, minStockQty: null },
  { name: 'Lettuce', unit: 'g', category: 'Vegetable', price: '₱50/head', store: 'Wet Market / Supermarket', storage: 'fridge', shelfLifeDays: 7, aliases: ['lettuce', 'litsugas', 'iceberg lettuce', 'romaine'], fridgeDays: 7, freezerDays: null, trackExpiry: true, priceValue: 50, minStockQty: null },
  { name: 'Broccoli', unit: 'g', category: 'Vegetable', price: '₱80/head', store: 'Supermarket', storage: 'fridge', shelfLifeDays: 5, aliases: ['broccoli', 'brokoli', 'brocolli'], fridgeDays: 5, freezerDays: 365, trackExpiry: true, priceValue: 80, minStockQty: null },
  { name: 'Cauliflower', unit: 'g', category: 'Vegetable', price: '₱80/head', store: 'Supermarket', storage: 'fridge', shelfLifeDays: 5, aliases: ['cauliflower', 'coliflor', 'califlower'], fridgeDays: 5, freezerDays: 365, trackExpiry: true, priceValue: 80, minStockQty: null },
  { name: 'Chili (Siling Labuyo)', unit: 'g', category: 'Vegetable', price: '₱30/100g', store: 'Wet Market / Grocery', storage: 'counter', shelfLifeDays: 7, aliases: ['siling labuyo', 'chili', 'sili', 'bird eye chili', 'labuyo', 'hot chili'], fridgeDays: 14, freezerDays: 365, trackExpiry: true, priceValue: 30, minStockQty: null },
  { name: 'Siling Haba (Long Green Chili)', unit: 'g', category: 'Vegetable', price: '₱20/100g', store: 'Wet Market', storage: 'counter', shelfLifeDays: 7, aliases: ['siling haba', 'long chili', 'long green chili', 'sili haba', 'finger chili'], fridgeDays: 14, freezerDays: 365, trackExpiry: true, priceValue: 20, minStockQty: null },
  { name: 'Bean Sprouts (Toge)', unit: 'g', category: 'Vegetable', price: '₱20/200g', store: 'Wet Market / Grocery', storage: 'fridge', shelfLifeDays: 3, aliases: ['toge', 'bean sprouts', 'togue', 'mung bean sprouts'], fridgeDays: 3, freezerDays: null, trackExpiry: true, priceValue: 20, minStockQty: null },
  { name: 'Bok Choy', unit: 'g', category: 'Vegetable', price: '₱40/bundle', store: 'Wet Market / Supermarket', storage: 'fridge', shelfLifeDays: 5, aliases: ['bok choy', 'pechay baguio', 'pak choi', 'Chinese white cabbage'], fridgeDays: 5, freezerDays: null, trackExpiry: true, priceValue: 40, minStockQty: null },
  { name: 'Scallions', unit: 'kg', category: 'Vegetable', price: '₱120/kg', store: 'Wet Market', storage: 'fridge', shelfLifeDays: 7, aliases: ['scallions', 'green onion', 'spring onion', 'dahon ng sibuyas'], fridgeDays: 7, freezerDays: 180, trackExpiry: true, priceValue: 120, minStockQty: null },
  { name: 'Chayote (Sayote)', unit: 'kg', category: 'Vegetable', price: '₱50/kg', store: 'Wet Market', storage: 'counter', shelfLifeDays: 14, aliases: ['sayote', 'chayote', 'vegetable pear', 'mirliton'], fridgeDays: 28, freezerDays: null, trackExpiry: true, priceValue: 50, minStockQty: null },

  // Fruits
  { name: 'Banana (Saging)', unit: 'kg', category: 'Fruit', price: '₱50/kg', store: 'Any Store', storage: 'counter', shelfLifeDays: 5, aliases: ['saging', 'banana', 'bananas', 'lakatan', 'latundan'], fridgeDays: 7, freezerDays: 365, trackExpiry: true, priceValue: 50, minStockQty: null },
  { name: 'Mango (Mangga)', unit: 'kg', category: 'Fruit', price: '₱120/kg', store: 'Wet Market / Grocery', storage: 'counter', shelfLifeDays: 5, aliases: ['mangga', 'mango', 'Philippine mango', 'Carabao mango'], fridgeDays: 14, freezerDays: 365, trackExpiry: true, priceValue: 120, minStockQty: null },
  { name: 'Pineapple (Pinya)', unit: 'pieces', category: 'Fruit', price: '₱50/pc', store: 'Wet Market / Grocery', storage: 'counter', shelfLifeDays: 3, aliases: ['pinya', 'pineapple', 'pineapple chunks'], fridgeDays: 5, freezerDays: 365, trackExpiry: true, priceValue: 50, minStockQty: null },
  { name: 'Calamansi', unit: 'kg', category: 'Fruit', price: '₱80/kg', store: 'Wet Market / Grocery', storage: 'counter', shelfLifeDays: 7, aliases: ['calamansi', 'calamondin', 'Philippine lime', 'kalamansi'], fridgeDays: 14, freezerDays: 90, trackExpiry: true, priceValue: 80, minStockQty: null },
  { name: 'Lemon', unit: 'pieces', category: 'Fruit', price: '₱25/pc', store: 'Supermarket', storage: 'counter', shelfLifeDays: 7, aliases: ['lemon', 'limon', 'lemon juice'], fridgeDays: 21, freezerDays: 90, trackExpiry: true, priceValue: 25, minStockQty: null },
  { name: 'Lime', unit: 'pieces', category: 'Fruit', price: '₱20/pc', store: 'Supermarket', storage: 'counter', shelfLifeDays: 7, aliases: ['lime', 'dayap', 'key lime'], fridgeDays: 21, freezerDays: 90, trackExpiry: true, priceValue: 20, minStockQty: null },
  { name: 'Papaya', unit: 'kg', category: 'Fruit', price: '₱40/kg', store: 'Wet Market / Grocery', storage: 'counter', shelfLifeDays: 3, aliases: ['papaya', 'papaw', 'green papaya'], fridgeDays: 7, freezerDays: 365, trackExpiry: true, priceValue: 40, minStockQty: null },
  { name: 'Coconut (Niyog)', unit: 'pieces', category: 'Fruit', price: '₱30/pc', store: 'Wet Market', storage: 'counter', shelfLifeDays: 14, aliases: ['niyog', 'coconut', 'buko', 'young coconut'], fridgeDays: 30, freezerDays: 90, trackExpiry: true, priceValue: 30, minStockQty: null },
  { name: 'Apple', unit: 'pieces', category: 'Fruit', price: '₱35/pc', store: 'Supermarket / Grocery', storage: 'counter', shelfLifeDays: 7, aliases: ['apple', 'mansanas', 'red apple', 'green apple'], fridgeDays: 42, freezerDays: null, trackExpiry: true, priceValue: 35, minStockQty: null },
  { name: 'Avocado', unit: 'pieces', category: 'Fruit', price: '₱50/pc', store: 'Wet Market / Supermarket', storage: 'counter', shelfLifeDays: 3, aliases: ['avocado', 'abokado', 'avo', 'butter fruit'], fridgeDays: 5, freezerDays: 90, trackExpiry: true, priceValue: 50, minStockQty: null },
  { name: 'Mixed Berries', unit: 'g', category: 'Fruit', price: '₱280/500g', store: 'Supermarket (Frozen)', storage: 'freezer', shelfLifeDays: 365, aliases: ['berries', 'mixed berries', 'frozen berries', 'blueberries', 'strawberries'], fridgeDays: 5, freezerDays: 365, trackExpiry: true, priceValue: 280, minStockQty: null },

  // Grains & Starches
  { name: 'White Rice (Bigas)', unit: 'kg', category: 'Grain', price: '₱55/kg', store: 'Any Store', storage: 'counter', shelfLifeDays: 365, isStaple: true, aliases: ['bigas', 'rice', 'white rice', 'kanin', 'regular rice'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 55, minStockQty: 2 },
  { name: 'Brown Rice', unit: 'kg', category: 'Grain', price: '₱80/kg', store: 'Supermarket / Health Store', storage: 'counter', shelfLifeDays: 180, isStaple: true, aliases: ['brown rice', 'kayumanggi bigas', 'whole grain rice'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 80, minStockQty: null },
  { name: 'Glutinous Rice (Malagkit)', unit: 'kg', category: 'Grain', price: '₱75/kg', store: 'Grocery / Supermarket', storage: 'counter', shelfLifeDays: 365, isStaple: true, aliases: ['malagkit', 'glutinous rice', 'sticky rice', 'sweet rice'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 75, minStockQty: null },
  { name: 'Cornstarch', unit: 'g', category: 'Grain', price: '₱25/pack', store: 'Any Store', storage: 'counter', shelfLifeDays: 730, isStaple: true, aliases: ['cornstarch', 'corn starch', 'gawgaw', 'maizena', 'cornflour'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 25, minStockQty: null },
  { name: 'All-Purpose Flour', unit: 'g', category: 'Grain', price: '₱55/kg', store: 'Any Store', storage: 'counter', shelfLifeDays: 365, isStaple: true, aliases: ['flour', 'all purpose flour', 'harina', 'AP flour', 'plain flour'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 55, minStockQty: null },
  { name: 'Breadcrumbs', unit: 'g', category: 'Grain', price: '₱45/pack', store: 'Supermarket / Grocery', storage: 'counter', shelfLifeDays: 180, isStaple: true, aliases: ['breadcrumbs', 'bread crumbs', 'panko', 'Panko breadcrumbs'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 45, minStockQty: null },
  { name: 'Pasta', unit: 'g', category: 'Grain', price: '₱55/500g', store: 'Supermarket / Grocery', storage: 'counter', shelfLifeDays: 730, isStaple: true, aliases: ['pasta', 'spaghetti', 'penne', 'macaroni', 'noodles'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 55, minStockQty: null },
  { name: 'Bihon Noodles', unit: 'g', category: 'Grain', price: '₱35/pack', store: 'Any Store', storage: 'counter', shelfLifeDays: 365, isStaple: true, aliases: ['bihon', 'rice noodles', 'bihon noodles', 'thin rice noodles'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 35, minStockQty: null },
  { name: 'Canton Noodles', unit: 'g', category: 'Grain', price: '₱30/pack', store: 'Any Store', storage: 'counter', shelfLifeDays: 365, isStaple: true, aliases: ['canton', 'canton noodles', 'egg noodles', 'miki noodles dry'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 30, minStockQty: null },
  { name: 'Sotanghon (Glass Noodles)', unit: 'g', category: 'Grain', price: '₱30/pack', store: 'Any Store', storage: 'counter', shelfLifeDays: 365, isStaple: true, aliases: ['sotanghon', 'glass noodles', 'bean thread noodles', 'cellophane noodles', 'vermicelli'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 30, minStockQty: null },
  { name: 'Miki Noodles', unit: 'g', category: 'Grain', price: '₱20/pack', store: 'Wet Market / Grocery', storage: 'fridge', shelfLifeDays: 3, aliases: ['miki', 'fresh noodles', 'fresh egg noodles', 'miki noodles'], fridgeDays: 3, freezerDays: null, trackExpiry: true, priceValue: 20, minStockQty: null },
  { name: 'Bread (Tinapay)', unit: 'pieces', category: 'Grain', price: '₱60/loaf', store: 'Bakery / Grocery', storage: 'counter', shelfLifeDays: 5, aliases: ['tinapay', 'bread', 'loaf bread', 'white bread', 'loaf'], fridgeDays: 14, freezerDays: 90, trackExpiry: true, priceValue: 60, minStockQty: null },
  { name: 'Pandesal', unit: 'pieces', category: 'Grain', price: '₱4/pc', store: 'Any Bakery', storage: 'counter', shelfLifeDays: 2, aliases: ['pandesal', 'pan de sal', 'bread roll', 'Filipino bread roll'], fridgeDays: 5, freezerDays: 90, trackExpiry: true, priceValue: 4, minStockQty: null },
  { name: 'Rolled Oats', unit: 'g', category: 'Grain', price: '₱180/800g', store: 'Supermarket', storage: 'counter', shelfLifeDays: 365, isStaple: true, aliases: ['oats', 'rolled oats', 'oatmeal', 'quick oats', 'old fashioned oats'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 180, minStockQty: null },
  { name: 'Granola', unit: 'g', category: 'Grain', price: '₱250/500g', store: 'Supermarket', storage: 'counter', shelfLifeDays: 180, aliases: ['granola', 'muesli', 'granola bar'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 250, minStockQty: null },

  // Dairy
  { name: 'Milk (Gatas)', unit: 'ml', category: 'Dairy', price: '₱90/1L', store: 'Supermarket / Grocery', storage: 'fridge', shelfLifeDays: 7, aliases: ['gatas', 'milk', 'fresh milk', 'whole milk', 'dairy milk'], fridgeDays: 7, freezerDays: 90, trackExpiry: true, priceValue: 90, minStockQty: null },
  { name: 'Evaporated Milk', unit: 'ml', category: 'Dairy', price: '₱40/can', store: 'Any Store', storage: 'counter', shelfLifeDays: 730, isStaple: true, aliases: ['evap', 'evaporated milk', 'carnation', 'Alaska evap', 'evap milk'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 40, minStockQty: null },
  { name: 'Condensed Milk', unit: 'ml', category: 'Dairy', price: '₱45/can', store: 'Any Store', storage: 'counter', shelfLifeDays: 730, isStaple: true, aliases: ['condensed milk', 'condensada', 'sweet condensed milk', 'eagle brand'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 45, minStockQty: null },
  { name: 'Cheese', unit: 'g', category: 'Dairy', price: '₱120/165g', store: 'Supermarket / Grocery', storage: 'fridge', shelfLifeDays: 30, aliases: ['cheese', 'keso', 'queso', 'Eden cheese', 'Quickmelt cheese'], fridgeDays: 30, freezerDays: 180, trackExpiry: true, priceValue: 120, minStockQty: null },
  { name: 'Cream', unit: 'ml', category: 'Dairy', price: '₱75/250ml', store: 'Supermarket', storage: 'fridge', shelfLifeDays: 5, aliases: ['cream', 'all purpose cream', 'whipping cream', 'heavy cream', 'nestle cream'], fridgeDays: 5, freezerDays: 90, trackExpiry: true, priceValue: 75, minStockQty: null },
  { name: 'Cream Cheese', unit: 'g', category: 'Dairy', price: '₱150/250g', store: 'Supermarket', storage: 'fridge', shelfLifeDays: 14, aliases: ['cream cheese', 'kesong puti', 'Philadelphia cream cheese', 'soft cheese'], fridgeDays: 14, freezerDays: 90, trackExpiry: true, priceValue: 150, minStockQty: null },
  { name: 'Butter', unit: 'g', category: 'Dairy', price: '₱130/200g', store: 'Supermarket / Grocery', storage: 'fridge', shelfLifeDays: 30, aliases: ['butter', 'mantequilla', 'mantekilya', 'unsalted butter', 'salted butter'], fridgeDays: 30, freezerDays: 365, trackExpiry: true, priceValue: 130, minStockQty: null },
  { name: 'Margarine', unit: 'g', category: 'Dairy', price: '₱80/250g', store: 'Any Store', storage: 'counter', shelfLifeDays: 60, aliases: ['margarine', 'mantekilya', 'butter spread', 'Magnolia margarine'], fridgeDays: 60, freezerDays: null, trackExpiry: false, priceValue: 80, minStockQty: null },
  { name: 'Yogurt', unit: 'ml', category: 'Dairy', price: '₱80/150g', store: 'Supermarket', storage: 'fridge', shelfLifeDays: 14, aliases: ['yogurt', 'yoghurt', 'Greek yogurt', 'plain yogurt'], fridgeDays: 14, freezerDays: 90, trackExpiry: true, priceValue: 80, minStockQty: null },

  // Pantry
  { name: 'Soy Sauce (Toyo)', unit: 'ml', category: 'Pantry', price: '₱25/200ml', store: 'Any Store', storage: 'counter', shelfLifeDays: 730, isStaple: true, aliases: ['toyo', 'soy sauce', 'toyomansi', 'dark soy sauce', 'light soy sauce'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 25, minStockQty: 50 },
  { name: 'Fish Sauce (Patis)', unit: 'ml', category: 'Pantry', price: '₱25/200ml', store: 'Any Store', storage: 'counter', shelfLifeDays: 730, isStaple: true, aliases: ['patis', 'fish sauce', 'fish patis', 'nam pla'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 25, minStockQty: 50 },
  { name: 'Vinegar (Suka)', unit: 'ml', category: 'Pantry', price: '₱20/200ml', store: 'Any Store', storage: 'counter', shelfLifeDays: 1825, isStaple: true, aliases: ['suka', 'vinegar', 'sukang paombong', 'cane vinegar', 'white vinegar', 'coconut vinegar'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 20, minStockQty: null },
  { name: 'Oyster Sauce', unit: 'g', category: 'Pantry', price: '₱50/230g', store: 'Supermarket / Grocery', storage: 'counter', shelfLifeDays: 365, isStaple: true, aliases: ['oyster sauce', 'oyster gravy', 'Lee Kum Kee oyster sauce'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 50, minStockQty: null },
  { name: 'Coconut Milk', unit: 'ml', category: 'Pantry', price: '₱45/400ml', store: 'Any Store', storage: 'counter', shelfLifeDays: 730, isStaple: true, aliases: ['coconut milk', 'gata', 'kakang gata', 'thin coconut milk', 'canned coconut milk'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 45, minStockQty: null },
  { name: 'Coconut Cream', unit: 'ml', category: 'Pantry', price: '₱50/400ml', store: 'Supermarket / Grocery', storage: 'counter', shelfLifeDays: 730, isStaple: true, aliases: ['coconut cream', 'kakang gata', 'thick coconut milk', 'coconut cream canned'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 50, minStockQty: null },
  { name: 'Tomato Paste', unit: 'g', category: 'Pantry', price: '₱30/small can', store: 'Any Store', storage: 'counter', shelfLifeDays: 730, isStaple: true, aliases: ['tomato paste', 'tomato puree', 'tomato concentrate', 'del Monte tomato paste'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 30, minStockQty: null },
  { name: 'Tomato Sauce', unit: 'ml', category: 'Pantry', price: '₱30/250ml', store: 'Any Store', storage: 'counter', shelfLifeDays: 730, isStaple: true, aliases: ['tomato sauce', 'salsa de tomate', 'pasta sauce', 'del Monte tomato sauce'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 30, minStockQty: null },
  { name: 'Cooking Oil', unit: 'ml', category: 'Pantry', price: '₱80/1L', store: 'Any Store', storage: 'counter', shelfLifeDays: 365, isStaple: true, aliases: ['cooking oil', 'vegetable oil', 'mantika', 'palm oil', 'canola oil', 'Baguio oil'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 80, minStockQty: 250 },
  { name: 'Sesame Oil', unit: 'ml', category: 'Pantry', price: '₱120/200ml', store: 'Supermarket / Asian Store', storage: 'counter', shelfLifeDays: 365, aliases: ['sesame oil', 'sesame seed oil', 'toasted sesame oil', 'Chinese sesame oil'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 120, minStockQty: null },
  { name: 'Olive Oil', unit: 'ml', category: 'Pantry', price: '₱350/500ml', store: 'Supermarket', storage: 'counter', shelfLifeDays: 365, isStaple: true, aliases: ['olive oil', 'aceite de oliva', 'extra virgin olive oil', 'EVOO'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 350, minStockQty: null },
  { name: 'Salt', unit: 'g', category: 'Pantry', price: '₱15/pack', store: 'Any Store', storage: 'counter', shelfLifeDays: 36500, isStaple: true, aliases: ['salt', 'asin', 'table salt', 'iodized salt', 'sea salt', 'rock salt'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 15, minStockQty: 100 },
  { name: 'Sugar', unit: 'g', category: 'Pantry', price: '₱65/kg', store: 'Any Store', storage: 'counter', shelfLifeDays: 36500, isStaple: true, aliases: ['sugar', 'asukal', 'white sugar', 'granulated sugar', 'refined sugar'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 65, minStockQty: 200 },
  { name: 'Brown Sugar', unit: 'g', category: 'Pantry', price: '₱70/kg', store: 'Any Store', storage: 'counter', shelfLifeDays: 36500, isStaple: true, aliases: ['brown sugar', 'asukal pula', 'muscovado', 'dark brown sugar'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 70, minStockQty: null },
  { name: 'Honey', unit: 'g', category: 'Pantry', price: '₱180/350g', store: 'Supermarket', storage: 'counter', shelfLifeDays: 36500, isStaple: true, aliases: ['honey', 'pulot', 'natural honey', 'raw honey', 'pure honey'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 180, minStockQty: null },
  { name: 'Black Pepper', unit: 'g', category: 'Pantry', price: '₱20/small pack', store: 'Any Store', storage: 'counter', shelfLifeDays: 730, isStaple: true, aliases: ['black pepper', 'paminta', 'ground pepper', 'ground black pepper', 'freshly ground pepper'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 20, minStockQty: null },
  { name: 'White Pepper', unit: 'g', category: 'Pantry', price: '₱20/small pack', store: 'Grocery / Supermarket', storage: 'counter', shelfLifeDays: 730, isStaple: true, aliases: ['white pepper', 'paminta puti', 'ground white pepper'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 20, minStockQty: null },
  { name: 'Peppercorn', unit: 'g', category: 'Pantry', price: '₱30/pack', store: 'Grocery / Supermarket', storage: 'counter', shelfLifeDays: 1095, isStaple: true, aliases: ['peppercorn', 'whole pepper', 'buo na paminta', 'whole peppercorn', 'black peppercorn'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 30, minStockQty: null },
  { name: 'Bay Leaves', unit: 'pieces', category: 'Pantry', price: '₱15/pack', store: 'Grocery / Supermarket', storage: 'counter', shelfLifeDays: 730, isStaple: true, aliases: ['bay leaves', 'laurel', 'dahon ng laurel', 'bay leaf', 'dried bay leaves'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 15, minStockQty: null },
  { name: 'Chili Flakes', unit: 'g', category: 'Pantry', price: '₱25/pack', store: 'Grocery / Supermarket', storage: 'counter', shelfLifeDays: 730, isStaple: true, aliases: ['chili flakes', 'red pepper flakes', 'dried chili', 'crushed chili', 'chilli flakes'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 25, minStockQty: null },
  { name: 'Paprika', unit: 'g', category: 'Pantry', price: '₱35/pack', store: 'Supermarket', storage: 'counter', shelfLifeDays: 730, isStaple: true, aliases: ['paprika', 'smoked paprika', 'sweet paprika', 'Spanish paprika'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 35, minStockQty: null },
  { name: 'Cumin', unit: 'g', category: 'Pantry', price: '₱35/pack', store: 'Supermarket / Asian Store', storage: 'counter', shelfLifeDays: 730, isStaple: true, aliases: ['cumin', 'comino', 'ground cumin', 'cumin powder', 'jeera'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 35, minStockQty: null },
  { name: 'Turmeric', unit: 'g', category: 'Pantry', price: '₱30/pack', store: 'Supermarket / Asian Store', storage: 'counter', shelfLifeDays: 730, isStaple: true, aliases: ['turmeric', 'luyang dilaw', 'yellow ginger', 'turmeric powder', 'kunyit'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 30, minStockQty: null },
  { name: 'Oregano', unit: 'g', category: 'Pantry', price: '₱25/pack', store: 'Grocery / Supermarket', storage: 'counter', shelfLifeDays: 730, isStaple: true, aliases: ['oregano', 'dried oregano', 'Italian oregano'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 25, minStockQty: null },
  { name: 'Thyme', unit: 'g', category: 'Pantry', price: '₱30/pack', store: 'Supermarket', storage: 'counter', shelfLifeDays: 730, isStaple: true, aliases: ['thyme', 'timo', 'dried thyme'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 30, minStockQty: null },
  { name: 'Basil', unit: 'g', category: 'Pantry', price: '₱30/pack', store: 'Supermarket', storage: 'counter', shelfLifeDays: 730, isStaple: true, aliases: ['basil', 'sweet basil', 'dried basil', 'Italian basil'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 30, minStockQty: null },
  { name: 'Parsley', unit: 'g', category: 'Pantry', price: '₱30/pack', store: 'Supermarket', storage: 'counter', shelfLifeDays: 730, isStaple: true, aliases: ['parsley', 'dried parsley', 'Italian parsley', 'flat leaf parsley'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 30, minStockQty: null },
  { name: 'Garlic Powder', unit: 'g', category: 'Pantry', price: '₱35/pack', store: 'Grocery / Supermarket', storage: 'counter', shelfLifeDays: 730, isStaple: true, aliases: ['garlic powder', 'bawang powder', 'garlic granules'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 35, minStockQty: null },
  { name: 'Onion Powder', unit: 'g', category: 'Pantry', price: '₱35/pack', store: 'Grocery / Supermarket', storage: 'counter', shelfLifeDays: 730, isStaple: true, aliases: ['onion powder', 'sibuyas powder', 'onion granules'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 35, minStockQty: null },
  { name: 'Garam Masala', unit: 'g', category: 'Pantry', price: '₱45/pack', store: 'Supermarket', storage: 'counter', shelfLifeDays: 730, isStaple: true, aliases: ['garam masala', 'Indian spice blend', 'masala'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 45, minStockQty: null },
  { name: 'Dried Herbs', unit: 'g', category: 'Pantry', price: '₱40/pack', store: 'Supermarket', storage: 'counter', shelfLifeDays: 730, isStaple: true, aliases: ['dried herbs', 'mixed herbs', 'Italian seasoning', 'herbs de Provence'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 40, minStockQty: null },
  { name: 'Worcestershire Sauce', unit: 'ml', category: 'Pantry', price: '₱80/bottle', store: 'Supermarket', storage: 'counter', shelfLifeDays: 365, aliases: ['worcestershire', 'worcestershire sauce', 'Lea and Perrins', 'HP sauce'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 80, minStockQty: null },
  { name: 'Ketchup', unit: 'g', category: 'Pantry', price: '₱40/320g', store: 'Any Store', storage: 'counter', shelfLifeDays: 365, aliases: ['ketchup', 'catsup', 'tomato ketchup', 'Jufran ketchup'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 40, minStockQty: null },
  { name: 'Banana Ketchup', unit: 'g', category: 'Pantry', price: '₱35/320g', store: 'Any Store', storage: 'counter', shelfLifeDays: 365, isStaple: true, aliases: ['banana ketchup', 'banana catsup', 'Filipino ketchup', 'Jufran banana ketchup'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 35, minStockQty: null },
  { name: 'Mayonnaise', unit: 'g', category: 'Pantry', price: '₱70/470g', store: 'Supermarket / Grocery', storage: 'fridge', shelfLifeDays: 180, aliases: ['mayo', 'mayonnaise', 'Best Foods mayo', 'Lady\'s Choice'], fridgeDays: 180, freezerDays: null, trackExpiry: true, priceValue: 70, minStockQty: null },
  { name: 'Peanut Butter', unit: 'g', category: 'Pantry', price: '₱120/480g', store: 'Any Store', storage: 'counter', shelfLifeDays: 180, aliases: ['peanut butter', 'peanut spread', 'mantikilyang mani', 'smooth peanut butter', 'crunchy peanut butter'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 120, minStockQty: null },
  { name: 'Hoisin Sauce', unit: 'g', category: 'Pantry', price: '₱90/240g', store: 'Supermarket / Asian Store', storage: 'fridge', shelfLifeDays: 365, aliases: ['hoisin', 'hoisin sauce', 'Chinese barbecue sauce', 'Peking duck sauce'], fridgeDays: 365, freezerDays: null, trackExpiry: true, priceValue: 90, minStockQty: null },
  { name: 'Chili Sauce', unit: 'ml', category: 'Pantry', price: '₱55/bottle', store: 'Supermarket / Asian Store', storage: 'counter', shelfLifeDays: 365, aliases: ['chili sauce', 'sweet chili sauce', 'sriracha', 'hot sauce'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 55, minStockQty: null },
  { name: 'Cooking Wine', unit: 'ml', category: 'Pantry', price: '₱80/bottle', store: 'Supermarket / Asian Store', storage: 'counter', shelfLifeDays: 365, aliases: ['cooking wine', 'Shaoxing wine', 'rice wine', 'mirin', 'Chinese cooking wine'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 80, minStockQty: null },
  { name: 'Beef Broth / Stock', unit: 'ml', category: 'Pantry', price: '₱35/pack', store: 'Supermarket / Grocery', storage: 'counter', shelfLifeDays: 730, isStaple: true, aliases: ['beef broth', 'beef stock', 'sabaw ng baka', 'beef bouillon', 'beef cubes'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 35, minStockQty: null },
  { name: 'Chicken Broth / Stock', unit: 'ml', category: 'Pantry', price: '₱35/pack', store: 'Supermarket / Grocery', storage: 'counter', shelfLifeDays: 730, isStaple: true, aliases: ['chicken broth', 'chicken stock', 'sabaw ng manok', 'chicken bouillon', 'Knorr cubes'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 35, minStockQty: null },
  { name: 'Water', unit: 'ml', category: 'Pantry', price: '₱0', store: 'Any', storage: 'counter', shelfLifeDays: 36500, isStaple: true, aliases: ['water', 'tubig', 'drinking water'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 0, minStockQty: null },
  { name: 'Annatto (Atsuete)', unit: 'g', category: 'Pantry', price: '₱20/pack', store: 'Wet Market / Asian Store', storage: 'counter', shelfLifeDays: 730, aliases: ['atsuete', 'annatto', 'annatto seeds', 'achuete', 'achiote'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 20, minStockQty: null },
  { name: 'Tamarind (Sampalok)', unit: 'g', category: 'Pantry', price: '₱30/100g', store: 'Wet Market / Grocery', storage: 'counter', shelfLifeDays: 30, aliases: ['sampalok', 'tamarind', 'sambag', 'raw tamarind', 'fresh tamarind'], fridgeDays: null, freezerDays: null, trackExpiry: true, priceValue: 30, minStockQty: null },
  { name: 'Tamarind Paste', unit: 'g', category: 'Pantry', price: '₱50/jar', store: 'Supermarket / Asian Store', storage: 'counter', shelfLifeDays: 365, aliases: ['tamarind paste', 'tamarind concentrate', 'sinigang mix'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 50, minStockQty: null },
  { name: 'Bagoong', unit: 'g', category: 'Pantry', price: '₱40/small jar', store: 'Any Store', storage: 'fridge', shelfLifeDays: 365, aliases: ['bagoong', 'fermented shrimp paste', 'bagoong alamang', 'shrimp bagoong'], fridgeDays: 365, freezerDays: null, trackExpiry: true, priceValue: 40, minStockQty: null },
  { name: 'Shrimp Paste', unit: 'g', category: 'Pantry', price: '₱35/small jar', store: 'Wet Market / Grocery', storage: 'fridge', shelfLifeDays: 180, aliases: ['shrimp paste', 'bagoong hipon', 'terasi', 'belacan'], fridgeDays: 180, freezerDays: null, trackExpiry: true, priceValue: 35, minStockQty: null },
  { name: 'Cooking Cream', unit: 'ml', category: 'Pantry', price: '₱75/250ml', store: 'Supermarket', storage: 'fridge', shelfLifeDays: 5, aliases: ['cooking cream', 'heavy cream', 'nestle cream', 'all purpose cream', 'Nestle All Purpose Cream'], fridgeDays: 5, freezerDays: 90, trackExpiry: true, priceValue: 75, minStockQty: null },
  { name: 'Baking Powder', unit: 'g', category: 'Pantry', price: '₱25/pack', store: 'Any Store', storage: 'counter', shelfLifeDays: 365, isStaple: true, aliases: ['baking powder', 'raising agent', 'double acting baking powder'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 25, minStockQty: null },
  { name: 'Baking Soda', unit: 'g', category: 'Pantry', price: '₱20/pack', store: 'Any Store', storage: 'counter', shelfLifeDays: 730, isStaple: true, aliases: ['baking soda', 'bicarbonate of soda', 'sodium bicarbonate', 'bicarb'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 20, minStockQty: null },
  { name: 'Vanilla Extract', unit: 'ml', category: 'Pantry', price: '₱45/bottle', store: 'Supermarket / Grocery', storage: 'counter', shelfLifeDays: 1825, aliases: ['vanilla', 'vanilla extract', 'vanilla essence', 'pure vanilla'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 45, minStockQty: null },
  { name: 'Chia Seeds', unit: 'g', category: 'Pantry', price: '₱150/250g', store: 'Supermarket / Health Store', storage: 'counter', shelfLifeDays: 365, aliases: ['chia seeds', 'chia', 'black chia seeds'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 150, minStockQty: null },
  { name: 'Red Lentils', unit: 'g', category: 'Pantry', price: '₱120/500g', store: 'Supermarket', storage: 'counter', shelfLifeDays: 730, aliases: ['red lentils', 'lentils', 'masoor dal', 'red dal'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 120, minStockQty: null },
  { name: 'Kimchi', unit: 'g', category: 'Pantry', price: '₱200/500g', store: 'Supermarket / Korean Store', storage: 'fridge', shelfLifeDays: 180, aliases: ['kimchi', 'kimchee', 'Korean fermented cabbage', 'kimchi cabbage'], fridgeDays: 180, freezerDays: null, trackExpiry: true, priceValue: 200, minStockQty: null },
  { name: 'Gochujang', unit: 'g', category: 'Pantry', price: '₱250/500g', store: 'Supermarket / Korean Store', storage: 'fridge', shelfLifeDays: 365, aliases: ['gochujang', 'Korean chili paste', 'Korean red pepper paste', 'gochuchang'], fridgeDays: 365, freezerDays: null, trackExpiry: true, priceValue: 250, minStockQty: null },
  { name: 'Mung Beans', unit: 'g', category: 'Grain', price: '₱80/500g', store: 'Palengke / Supermarket', storage: 'counter', shelfLifeDays: 365, aliases: ['mung beans', 'monggo', 'green mung beans', 'munggo', 'mung dal'], fridgeDays: null, freezerDays: null, trackExpiry: false, priceValue: 80, minStockQty: 200 },
];

root.MealPrepFoodSafety = Object.freeze({
  INGREDIENT_DB: INGREDIENT_DB,
  STOCK_CLASS_RULES: STOCK_CLASS_RULES,
  FRIDGE_SAFETY_LIMITS: FRIDGE_SAFETY_LIMITS,
  COOKED_FRIDGE_LIMIT: COOKED_FRIDGE_LIMIT,
  FRIDGE_SAFETY_EXCLUSIONS: FRIDGE_SAFETY_EXCLUSIONS,
  FRESHNESS_WARN_DAYS: FRESHNESS_WARN_DAYS,
  defaultInferStorage: defaultInferStorage,
  categoryShelfLife: categoryShelfLife,
  stockIngredientEntry: stockIngredientEntry,
  stockFoodClass: stockFoodClass,
  stockCalendarDay: stockCalendarDay,
  daysLeftFrom: daysLeftFrom,
  pantryDaysLeft: pantryDaysLeft,
  pantryFridgeSafety: pantryFridgeSafety,
  pantryDateSignal: pantryDateSignal,
  pantryLotAvailable: pantryLotAvailable,
  isStaple: isStaple,
  cookedShelfLife: cookedShelfLife,
  cookedDateSignal: cookedDateSignal
});
})(globalThis);
