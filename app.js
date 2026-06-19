// Global state management
const AppState = {
  recipes: [],
  weeklyPlan: {
    Monday: { breakfast: null, lunch: null, dinner: null, snacks: [] },
    Tuesday: { breakfast: null, lunch: null, dinner: null, snacks: [] },
    Wednesday: { breakfast: null, lunch: null, dinner: null, snacks: [] },
    Thursday: { breakfast: null, lunch: null, dinner: null, snacks: [] },
    Friday: { breakfast: null, lunch: null, dinner: null, snacks: [] },
    Saturday: { breakfast: null, lunch: null, dinner: null, snacks: [] },
    Sunday: { breakfast: null, lunch: null, dinner: null, snacks: [] }
  },
  groceryList: [],
  currentEditingRecipe: null,
  selectedRecipeForPlanning: null,
  nutritionGoals: {
    calories: 2000,
    protein: 150,
    carbs: 250,
    fat: 67,
    fiber: 25,
    sodium: 2300
  },
  currentEditingIngredient: null,
  currentEditingHack: null,
  customIngredients: [],
  customHacks: [],
  pantry: [],
  userIngredients: [],
  ingredientPrices: {},
  myStores: [],
  customStores: [],
  cookedMeals: [],
  recentRecipes: [],          // recipe ids, most-recently planned first (device-local)
  selectedPlannerDays: [],    // transient: days the picker will assign to
  dataVersion: 0,             // cloud-doc version we last loaded (optimistic concurrency)
  syncStatus: 'idle',         // 'saving' | 'synced' | 'local' — drives the header badge
  profile: null,              // { displayName } — public identity for the community feed
  currentUser: null,
  isOnline: navigator.onLine
};

// Header badge showing whether data made it to the cloud. Hidden when logged out
// (data is local-only by design then).
function updateSyncIndicator() {
  var el = document.getElementById('sync-status');
  if (!el) return;
  if (!AppState.currentUser) { el.className = 'sync-status hidden'; return; }
  if (!AppState.isOnline) { el.textContent = '⚠ Offline'; el.className = 'sync-status sync-offline'; return; }
  if (AppState.syncStatus === 'saving') { el.textContent = '⏳ Saving…'; el.className = 'sync-status sync-saving'; }
  else if (AppState.syncStatus === 'local') { el.textContent = '⚠ Saved on this device'; el.className = 'sync-status sync-local'; }
  else { el.textContent = '✓ Synced'; el.className = 'sync-status sync-synced'; }
}

// Track a recipe as recently used (front of the list, deduped, capped).
function recordRecentRecipe(recipeId) {
  var id = String(recipeId);
  AppState.recentRecipes = [id].concat(
    (AppState.recentRecipes || []).filter(function(x) { return String(x) !== id; })
  ).slice(0, 8);
}

// ── Freshness tracking (pantry expiry + cooked-meal shelf life) ───────────────
var FRESHNESS_WARN_DAYS = 2; // warn when this many days or fewer remain

function todayISO() {
  var d = new Date();
  var m = String(d.getMonth() + 1).padStart(2, '0');
  var day = String(d.getDate()).padStart(2, '0');
  return d.getFullYear() + '-' + m + '-' + day;
}

// Rough default shelf life (days) by ingredient category — editable per item.
function categoryShelfLife(category) {
  switch ((category || '').toLowerCase()) {
    case 'protein': return 3;
    case 'vegetable': return 7;
    case 'fruit': return 7;
    case 'dairy': return 7;
    case 'grain': return 180;
    case 'pantry': return 365;
    default: return 7;
  }
}

// Best-effort category for a free-typed ingredient name, via INGREDIENT_DB.
function inferCategory(name) {
  var n = (name || '').toLowerCase();
  var exact = INGREDIENT_DB.find(function (i) { return i.name.toLowerCase() === n; });
  if (exact) return exact.category;
  var loose = INGREDIENT_DB.find(function (i) {
    var x = i.name.toLowerCase();
    return x.includes(n) || n.includes(x);
  });
  return loose ? loose.category : '';
}

// Best-effort default storage location ('fridge' | 'freezer' | 'counter') for an
// ingredient, from the storage-guide data when known, else by category. Storage-
// guide locations list the PRIMARY spot first (e.g. "Fridge / Freezer",
// "Counter / Freezer"), so we pick whichever keyword appears earliest.
function inferStorage(name, category) {
  var k = (typeof lookupPantryKnowledge === 'function') ? lookupPantryKnowledge(name) : null;
  if (k && k.location) {
    var loc = k.location.toLowerCase();
    function pos(words) {
      var best = Infinity;
      words.forEach(function(w) { var i = loc.indexOf(w); if (i >= 0 && i < best) best = i; });
      return best;
    }
    var idx = {
      counter: pos(['counter', 'pantry', 'cabinet', 'shelf', 'cupboard']),
      fridge: /not\s+fridge/.test(loc) ? Infinity : pos(['fridge', 'refriger']),
      freezer: pos(['freezer'])
    };
    var best = null, bestPos = Infinity;
    ['counter', 'fridge', 'freezer'].forEach(function(key) {
      if (idx[key] < bestPos) { bestPos = idx[key]; best = key; }
    });
    if (best) return best;
  }
  var c = (category || '').toLowerCase();
  if (c === 'pantry' || c === 'grain') return 'counter';
  return 'fridge';
}

// Whole days remaining until (startDate + shelfLifeDays). Negative = expired.
function daysLeftFrom(startDateStr, shelfLifeDays) {
  if (!startDateStr || shelfLifeDays == null || isNaN(shelfLifeDays)) return null;
  var start = new Date(startDateStr + 'T00:00:00');
  if (isNaN(start.getTime())) return null;
  var expiry = start.getTime() + Number(shelfLifeDays) * 86400000;
  var today = new Date(todayISO() + 'T00:00:00').getTime();
  return Math.round((expiry - today) / 86400000);
}

// Days left for a pantry item. Two modes: by printed expiry date (dateMode
// 'expiry' — for canned/packaged staples), or bought date + shelf life.
function pantryDaysLeft(p) {
  if (p.dateMode === 'expiry') return daysLeftFrom(p.expiryDate, 0);
  var shelf = (p.shelfLifeDays != null) ? p.shelfLifeDays : categoryShelfLife(p.category);
  return daysLeftFrom(p.purchaseDate, shelf);
}

// Visual status from days remaining. Threshold is FRESHNESS_WARN_DAYS.
function freshnessStatus(daysLeft) {
  if (daysLeft == null) return { cls: '', icon: '', label: '' };
  if (daysLeft < 0) return { cls: 'fresh-expired', icon: '<span class="fresh-dot"></span>', label: 'Expired ' + Math.abs(daysLeft) + 'd ago' };
  if (daysLeft === 0) return { cls: 'fresh-warn', icon: '<span class="fresh-dot"></span>', label: 'Use today!' };
  if (daysLeft <= FRESHNESS_WARN_DAYS) return { cls: 'fresh-warn', icon: '<span class="fresh-dot"></span>', label: daysLeft + 'd left' };
  return { cls: 'fresh-ok', icon: '<span class="fresh-dot"></span>', label: daysLeft + 'd left' };
}

// Local Storage Management
// ── Icon system (Lucide SVG) ─────────────────────────────────────────────────
// Inline SVG icons replace emoji. They inherit text color (currentColor) and
// scale with font-size, so they look crisp and match the theme in light/dark.
var ICON_PATHS = {
  'chef-hat': '<path d="M17 21a1 1 0 0 0 1-1v-5.35c0-.457.316-.844.727-1.041a4 4 0 0 0-2.134-7.589 5 5 0 0 0-9.186 0 4 4 0 0 0-2.134 7.588c.411.198.727.585.727 1.041V20a1 1 0 0 0 1 1Z"/><path d="M6 17h12"/>',
  'clock': '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  'flame': '<path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"/>',
  'refrigerator': '<path d="M5 6a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6Z"/><path d="M5 10h14"/><path d="M15 7v6"/>',
  'snowflake': '<path d="m10 20-1.25-2.5L6 18"/><path d="M10 4 8.75 6.5 6 6"/><path d="m14 20 1.25-2.5L18 18"/><path d="m14 4 1.25 2.5L18 6"/><path d="m17 21-3-6h-4"/><path d="m17 3-3 6 1.5 3"/><path d="M2 12h6.5L10 9"/><path d="m20 10-1.5 2 1.5 2"/><path d="M22 12h-6.5L14 15"/><path d="m4 10 1.5 2L4 14"/><path d="m7 21 3-6-1.5-3"/><path d="m7 3 3 6h4"/>',
  'triangle-alert': '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /> <path d="M12 9v4" /> <path d="M12 17h.01" />',
  'archive': '<rect width="20" height="5" x="2" y="3" rx="1" /> <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" /> <path d="M10 12h4" />',
  'clipboard-list': '<rect width="8" height="4" x="8" y="2" rx="1" ry="1" /> <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" /> <path d="M12 11h4" /> <path d="M12 16h4" /> <path d="M8 11h.01" /> <path d="M8 16h.01" />',
  'copy': '<rect width="14" height="14" x="8" y="8" rx="2" ry="2" /> <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />',
  'square-pen': '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /> <path d="M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z" />',
  'search': '<path d="m21 21-4.34-4.34" /> <circle cx="11" cy="11" r="8" />',
  'globe': '<circle cx="12" cy="12" r="10" /> <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" /> <path d="M2 12h20" />',
  'shopping-cart': '<circle cx="8" cy="21" r="1" /> <circle cx="19" cy="21" r="1" /> <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />',
  'download': '<path d="M12 15V3" /> <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /> <path d="m7 10 5 5 5-5" />',
  'upload': '<path d="M12 3v12" /> <path d="m17 8-5-5-5 5" /> <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />',
  'undo-2': '<path d="M9 14 4 9l5-5" /> <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />',
  'trash-2': '<path d="M10 11v6" /> <path d="M14 11v6" /> <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" /> <path d="M3 6h18" /> <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />',
  'salad': '<path d="M7 21h10" /> <path d="M12 21a9 9 0 0 0 9-9H3a9 9 0 0 0 9 9Z" /> <path d="M11.38 12a2.4 2.4 0 0 1-.4-4.77 2.4 2.4 0 0 1 3.2-2.77 2.4 2.4 0 0 1 3.47-.63 2.4 2.4 0 0 1 3.37 3.37 2.4 2.4 0 0 1-1.1 3.7 2.51 2.51 0 0 1 .03 1.1" /> <path d="m13 12 4-4" /> <path d="M10.9 7.25A3.99 3.99 0 0 0 4 10c0 .73.2 1.41.54 2" />',
  'piggy-bank': '<path d="M11 17h3v2a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3a3.16 3.16 0 0 0 2-2h1a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1h-1a5 5 0 0 0-2-4V3a4 4 0 0 0-3.2 1.6l-.3.4H11a6 6 0 0 0-6 6v1a5 5 0 0 0 2 4v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1z" /> <path d="M16 10h.01" /> <path d="M2 8v1a2 2 0 0 0 2 2h1" />',
  'package': '<path d="M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z" /> <path d="M12 22V12" /> <polyline points="3.29 7 12 12 20.71 7" /> <path d="m7.5 4.27 9 5.15" />',
  'timer': '<line x1="10" x2="14" y1="2" y2="2" /> <line x1="12" x2="15" y1="14" y2="11" /> <circle cx="12" cy="14" r="8" />',
  'hourglass': '<path d="M5 22h14" /> <path d="M5 2h14" /> <path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" /> <path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />',
  'utensils': '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" /> <path d="M7 2v20" /> <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" />',
  'house': '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" /> <path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />',
  'mail': '<path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7" /> <rect x="2" y="4" width="20" height="16" rx="2" />',
  'save': '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" /> <path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" /> <path d="M7 3v4a1 1 0 0 0 1 1h7" />',
  'printer': '<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /> <path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6" /> <rect x="6" y="14" width="12" height="8" rx="1" />',
  'users': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /> <path d="M16 3.128a4 4 0 0 1 0 7.744" /> <path d="M22 21v-2a4 4 0 0 0-3-3.87" /> <circle cx="9" cy="7" r="4" />',
  'star': '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" />',
  'leaf': '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" /> <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />',
  'book-open': '<path d="M12 7v14" /> <path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z" />',
  'map-pin': '<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0" /> <circle cx="12" cy="10" r="3" />',
  'check': '<path d="M20 6 9 17l-5-5" />',
  'x': '<path d="M18 6 6 18" /> <path d="m6 6 12 12" />',
  'lightbulb': '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" /> <path d="M9 18h6" /> <path d="M10 22h4" />',
  'calendar-days': '<path d="M8 2v4" /> <path d="M16 2v4" /> <rect width="18" height="18" x="3" y="4" rx="2" /> <path d="M3 10h18" /> <path d="M8 14h.01" /> <path d="M12 14h.01" /> <path d="M16 14h.01" /> <path d="M8 18h.01" /> <path d="M12 18h.01" /> <path d="M16 18h.01" />',
  'soup': '<path d="M12 21a9 9 0 0 0 9-9H3a9 9 0 0 0 9 9Z" /> <path d="M7 21h10" /> <path d="M19.5 12 22 6" /> <path d="M16.25 3c.27.1.8.53.75 1.36-.06.83-.93 1.2-1 2.02-.05.78.34 1.24.73 1.62" /> <path d="M11.25 3c.27.1.8.53.74 1.36-.05.83-.93 1.2-.98 2.02-.06.78.33 1.24.72 1.62" /> <path d="M6.25 3c.27.1.8.53.75 1.36-.06.83-.93 1.2-1 2.02-.05.78.34 1.24.74 1.62" />',
  'beef': '<path d="M16.4 13.7A6.5 6.5 0 1 0 6.28 6.6c-1.1 3.13-.78 3.9-3.18 6.08A3 3 0 0 0 5 18c4 0 8.4-1.8 11.4-4.3" /> <path d="m18.5 6 2.19 4.5a6.48 6.48 0 0 1-2.29 7.2C15.4 20.2 11 22 7 22a3 3 0 0 1-2.68-1.66L2.4 16.5" /> <circle cx="12.5" cy="8.5" r="2.5" />',
  'fish': '<path d="M6.5 12c.94-3.46 4.94-6 8.5-6 3.56 0 6.06 2.54 7 6-.94 3.47-3.44 6-7 6s-7.56-2.53-8.5-6Z" /> <path d="M18 12v.5" /> <path d="M16 17.93a9.77 9.77 0 0 1 0-11.86" /> <path d="M7 10.67C7 8 5.58 5.97 2.73 5.5c-1 1.5-1 5 .23 6.5-1.24 1.5-1.24 5-.23 6.5C5.58 18.03 7 16 7 13.33" /> <path d="M10.46 7.26C10.2 5.88 9.17 4.24 8 3h5.8a2 2 0 0 1 1.98 1.67l.23 1.4" /> <path d="m16.01 17.93-.23 1.4A2 2 0 0 1 13.8 21H9.5a5.96 5.96 0 0 0 1.49-3.98" />',
  'carrot': '<path d="M2.27 21.7s9.87-3.5 12.73-6.36a4.5 4.5 0 0 0-6.36-6.37C5.77 11.84 2.27 21.7 2.27 21.7zM8.64 14l-2.05-2.04M15.34 15l-2.46-2.46" /> <path d="M22 9s-1.33-2-3.5-2C16.86 7 15 9 15 9s1.33 2 3.5 2S22 9 22 9z" /> <path d="M15 2s-2 1.33-2 3.5S15 9 15 9s2-1.84 2-3.5C17 3.33 15 2 15 2z" />',
  'wheat': '<path d="M2 22 16 8" /> <path d="M3.47 12.53 5 11l1.53 1.53a3.5 3.5 0 0 1 0 4.94L5 19l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z" /> <path d="M7.47 8.53 9 7l1.53 1.53a3.5 3.5 0 0 1 0 4.94L9 15l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z" /> <path d="M11.47 4.53 13 3l1.53 1.53a3.5 3.5 0 0 1 0 4.94L13 11l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z" /> <path d="M20 2h2v2a4 4 0 0 1-4 4h-2V6a4 4 0 0 1 4-4Z" /> <path d="M11.47 17.47 13 19l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L5 19l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z" /> <path d="M15.47 13.47 17 15l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L9 15l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z" /> <path d="M19.47 9.47 21 11l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L13 11l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z" />',
  'milk': '<path d="M8 2h8" /> <path d="M9 2v2.789a4 4 0 0 1-.672 2.219l-.656.984A4 4 0 0 0 7 10.212V20a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-9.789a4 4 0 0 0-.672-2.219l-.656-.984A4 4 0 0 1 15 4.788V2" /> <path d="M7 15a6.472 6.472 0 0 1 5 0 6.47 6.47 0 0 0 5 0" />',
  'egg': '<path d="M12 2C8 2 4 8 4 14a8 8 0 0 0 16 0c0-6-4-12-8-12" />',
  'banana': '<path d="M4 13c3.5-2 8-2 10 2a5.5 5.5 0 0 1 8 5" /> <path d="M5.15 17.89c5.52-1.52 8.65-6.89 7-12C11.55 4 11.5 2 13 2c3.22 0 5 5.5 5 8 0 6.5-4.2 12-10.49 12C5.11 22 2 22 2 20c0-1.5 1.14-1.55 3.15-2.11Z" />',
  'drumstick': '<path d="M15.4 15.63a7.875 6 135 1 1 6.23-6.23 4.5 3.43 135 0 0-6.23 6.23" /> <path d="m8.29 12.71-2.6 2.6a2.5 2.5 0 1 0-1.65 4.65A2.5 2.5 0 1 0 8.7 18.3l2.59-2.59" />',
  'citrus': '<path d="M21.66 17.67a1.08 1.08 0 0 1-.04 1.6A12 12 0 0 1 4.73 2.38a1.1 1.1 0 0 1 1.61-.04z" /> <path d="M19.65 15.66A8 8 0 0 1 8.35 4.34" /> <path d="m14 10-5.5 5.5" /> <path d="M14 17.85V10H6.15" />',
};
function icon(name) {
  var p = ICON_PATHS[name];
  if (!p) return '';
  return '<svg class="lc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
}
// Replaces <span data-icon="name"> placeholders in static HTML with real SVGs.
function hydrateIcons() {
  document.querySelectorAll('[data-icon]').forEach(function(el) {
    if (el.dataset.iconDone) return;
    el.innerHTML = icon(el.dataset.icon);
    el.dataset.iconDone = '1';
  });
}
window.icon = icon;
window.hydrateIcons = hydrateIcons;

// Friendly, instructive empty-state block (icon + title + hint).
function emptyState(iconName, title, text) {
  return '<div class="empty-state">' +
    '<div class="empty-state-icon">' + icon(iconName) + '</div>' +
    '<div class="empty-state-title">' + title + '</div>' +
    '<div class="empty-state-text">' + text + '</div>' +
    '</div>';
}

const STORAGE_KEY = 'mealPrepAppData';

function saveToLocalStorage() {
  try {
    const dataToSave = {
      recipes: AppState.recipes,
      weeklyPlan: AppState.weeklyPlan,
      groceryList: AppState.groceryList,
      nutritionGoals: AppState.nutritionGoals,
      customIngredients: AppState.customIngredients,
      customHacks: AppState.customHacks,
      pantry: AppState.pantry,
      userIngredients: AppState.userIngredients,
      ingredientPrices: AppState.ingredientPrices,
      myStores: AppState.myStores,
      customStores: AppState.customStores,
      cookedMeals: AppState.cookedMeals,
      recentRecipes: AppState.recentRecipes,
      version: AppState.dataVersion,
      lastSaved: new Date().toISOString()
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dataToSave));
    console.log('Data saved to local storage');
  } catch (error) {
    console.error('Error saving to local storage:', error);
    showErrorMessage('Failed to save data. Please check your browser storage settings.');
  }
}

function loadFromLocalStorage() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const data = JSON.parse(saved);
      AppState.recipes = data.recipes || [];
      patchMissingNutrition(AppState.recipes);
      AppState.weeklyPlan = data.weeklyPlan || {
        Monday: { breakfast: null, lunch: null, dinner: null, snacks: [] },
        Tuesday: { breakfast: null, lunch: null, dinner: null, snacks: [] },
        Wednesday: { breakfast: null, lunch: null, dinner: null, snacks: [] },
        Thursday: { breakfast: null, lunch: null, dinner: null, snacks: [] },
        Friday: { breakfast: null, lunch: null, dinner: null, snacks: [] },
        Saturday: { breakfast: null, lunch: null, dinner: null, snacks: [] },
        Sunday: { breakfast: null, lunch: null, dinner: null, snacks: [] }
      };
      AppState.groceryList = data.groceryList || [];
      AppState.nutritionGoals = data.nutritionGoals || {
        calories: 2000,
        protein: 150,
        carbs: 250,
        fat: 67,
        fiber: 25,
        sodium: 2300
      };
      AppState.customIngredients = data.customIngredients || [];
      AppState.customHacks = data.customHacks || [];
      AppState.pantry = data.pantry || [];
      AppState.userIngredients = data.userIngredients || [];
      AppState.ingredientPrices = data.ingredientPrices || {};
      AppState.myStores = data.myStores || [];
      AppState.customStores = data.customStores || [];
      AppState.cookedMeals = data.cookedMeals || [];
      AppState.recentRecipes = data.recentRecipes || [];
      AppState.dataVersion = data.version || 0;
      cacheInlinePhotos(); // localStorage keeps photos inline; cache them

      console.log('Data loaded from local storage');
      return true;
    }
  } catch (error) {
    console.error('Error loading from local storage:', error);
    showErrorMessage('Failed to load saved data. Starting with fresh data.');
  }
  return false;
}

// Patches nutrition data into sample recipes that were saved before nutrition was added.
// Returns true if anything was patched (caller should re-save to Firebase).
// Defensively fills in any structural fields that old saved recipes may be
// missing, so newer code never crashes on data saved by an earlier version.
// Only fills ABSENT fields — never overwrites values the user already has.
function normalizeRecipes(recipes) {
  if (!Array.isArray(recipes)) return [];
  recipes.forEach(function(recipe) {
    if (recipe.name == null) recipe.name = 'Untitled Recipe';
    if (!Array.isArray(recipe.baseIngredients)) recipe.baseIngredients = [];
    if (recipe.baseServings == null) recipe.baseServings = recipe.currentServings || 1;
    if (recipe.currentServings == null) recipe.currentServings = recipe.baseServings;
    if (!recipe.nutritionPerServing || typeof recipe.nutritionPerServing !== 'object') {
      recipe.nutritionPerServing = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0 };
    }
    if (recipe.category == null) recipe.category = 'Main Dish';
    if (recipe.instructions == null) recipe.instructions = '';
    if (recipe.fridgeLife == null) recipe.fridgeLife = 0;
    if (recipe.freezerLife == null) recipe.freezerLife = 0;
    recipe.baseIngredients.forEach(function(ing) {
      if (ing.unit == null) ing.unit = 'g';
      if (ing.baseQuantity == null) ing.baseQuantity = 0;
      if (ing.category == null) ing.category = '';
    });
  });
  return recipes;
}

function patchMissingNutrition(recipes) {
  normalizeRecipes(recipes);
  var patched = false;
  recipes.forEach(function(recipe) {
    if (!recipe.nutritionPerServing || recipe.nutritionPerServing.calories === 0) {
      // Use loose string comparison — Firestore may store numeric IDs as strings
      var source = sampleRecipes.find(function(s) { return String(s.id) === String(recipe.id); });
      if (source && source.nutritionPerServing) {
        recipe.nutritionPerServing = source.nutritionPerServing;
        patched = true;
      }
    }
  });
  return patched;
}

// ── Backup / Restore safety net ──────────────────────────────────────────────
// Destructive actions (Clear All Data, Import-replace) snapshot the current data
// first, so it can be restored with one click from the "Restore Backup" button.
var BACKUP_KEY = 'mealPrepBackup';

function snapshotData() {
  return {
    recipes: AppState.recipes,
    weeklyPlan: AppState.weeklyPlan,
    groceryList: AppState.groceryList,
    nutritionGoals: AppState.nutritionGoals,
    customIngredients: AppState.customIngredients,
    customHacks: AppState.customHacks,
    pantry: AppState.pantry,
    userIngredients: AppState.userIngredients,
    ingredientPrices: AppState.ingredientPrices,
    myStores: AppState.myStores,
    customStores: AppState.customStores,
    cookedMeals: AppState.cookedMeals,
    recentRecipes: AppState.recentRecipes
  };
}

function createBackup(label) {
  try {
    var backup = { label: label || 'backup', at: new Date().toISOString(), data: snapshotData() };
    localStorage.setItem(BACKUP_KEY, JSON.stringify(backup));
  } catch (e) { console.error('Backup failed:', e); }
}

function restoreBackup() {
  var raw;
  try { raw = localStorage.getItem(BACKUP_KEY); } catch (e) { raw = null; }
  if (!raw) {
    showErrorMessage('No backup yet. One is saved automatically before you Clear or Import data.');
    return;
  }
  var backup;
  try { backup = JSON.parse(raw); } catch (e) { showErrorMessage('Backup is corrupted and cannot be restored.'); return; }
  var when = backup.at ? new Date(backup.at).toLocaleString() : 'an earlier time';
  if (!confirm('Restore your data from the backup taken ' + when + ' (before "' + (backup.label || 'change') + '")?\n\nThis replaces your current data.')) return;

  var d = backup.data || {};
  AppState.recipes = d.recipes || [];
  patchMissingNutrition(AppState.recipes);
  AppState.weeklyPlan = d.weeklyPlan || AppState.weeklyPlan;
  AppState.groceryList = d.groceryList || [];
  AppState.nutritionGoals = d.nutritionGoals || AppState.nutritionGoals;
  AppState.customIngredients = d.customIngredients || [];
  AppState.customHacks = d.customHacks || [];
  AppState.pantry = d.pantry || [];
  AppState.userIngredients = d.userIngredients || [];
  AppState.ingredientPrices = d.ingredientPrices || {};
  AppState.myStores = d.myStores || [];
  AppState.customStores = d.customStores || [];
  AppState.cookedMeals = d.cookedMeals || [];
  AppState.recentRecipes = d.recentRecipes || [];
  cacheInlinePhotos();
  saveData();

  renderRecipes();
  renderWeeklyPlanner();
  renderStorageGuide();
  renderCookingHacks();
  renderCookedMeals();
  renderPantry();
  renderIngredientsTab();
  updateNutritionGoalsDisplay();
  updateFreshnessBadges();
  renderFreshnessBanner();
  showSuccessMessage('Data restored from backup (' + when + ').');
}

async function clearLocalStorage() {
  if (!confirm('Clear ALL saved data and reset to defaults?\n\nA backup is saved first — you can undo this with the "Restore Backup" button.')) return;

  createBackup('Clear All Data');

  // Wipe localStorage (the backup key is kept)
  localStorage.removeItem(STORAGE_KEY);

  // Delete the entire Firestore document so it can't sync old data back on reload
  if (AppState.currentUser && window.firebase && window.firebase.db) {
    try {
      const ref = window.firebase.doc(window.firebase.db, 'users', AppState.currentUser.uid);
      await window.firebase.deleteDoc(ref);
    } catch (e) {
      console.error('Firebase clear failed:', e);
      // Still reload — localStorage is gone, fresh defaults will load
    }
  }

  location.reload();
}

function showErrorMessage(message) {
  const existingMessage = document.querySelector('.error-message');
  if (existingMessage) {
    existingMessage.remove();
  }
  
  const messageEl = document.createElement('div');
  messageEl.className = 'error-message';
  messageEl.textContent = message;
  document.body.appendChild(messageEl);
  
  setTimeout(() => messageEl.classList.add('show'), 100);
  setTimeout(() => {
    messageEl.classList.remove('show');
    setTimeout(() => messageEl.remove(), 300);
  }, 5000);
}

// Updated cooking hacks data with realistic Philippine context
const defaultCookingHacks = [
  {
    id: 1,
    category: "Batch Cooking",
    title: "Rice and Kamote Prep",
    description: "Cook brown rice + kamote in bulk → refrigerate. Reheat portions throughout the week.",
    timeSaved: "15-20 minutes per meal",
    costSavings: ""
  },
  {
    id: 2,
    category: "Storage",
    title: "Egg Prep Strategy",
    description: "Hard-boil a dozen eggs at once. They last 7 days refrigerated and make instant protein.",
    timeSaved: "10 minutes daily",
    costSavings: ""
  },
  {
    id: 3,
    category: "Equipment",
    title: "One-Pan Veggie Method",
    description: "Use 1 pan for sautéing all veggie dishes. Clean once, cook multiple vegetables.",
    timeSaved: "10-15 minutes cleanup",
    costSavings: ""
  },
  {
    id: 4,
    category: "Budget",
    title: "Bone-In Cuts",
    description: "Chicken thighs and legs are cheaper than breast and more flavorful for stews.",
    timeSaved: "",
    costSavings: "₱50-100 per kilo"
  },
  {
    id: 5,
    category: "Storage",
    title: "2-Hour Safety Rule", 
    description: "Refrigerate cooked food within 2 hours (1 hour if very hot) to prevent spoilage.",
    timeSaved: "",
    costSavings: ""
  },
  {
    id: 6,
    category: "Budget",
    title: "Seasonal Vegetables",
    description: "Buy whatever vegetables are in season and abundant at the market.",
    timeSaved: "",
    costSavings: "₱200-300 per week"
  }
];

// Enhanced storage guide data with corrected Philippine pricing and nutrition
const defaultStorageData = [
  {
    id: 1,
    name: "Chicken thighs",
    category: "Protein",
    fridgeLife: 2,
    freezerLife: 270,
    pricePerUnit: 190,
    unit: "per kg",
    storageMethod: "Refrigerate in original packaging or airtight container",
    storageTips: "Store on bottom shelf. Use within 2 days or freeze immediately.",
    calories: 209,
    protein: 26,
    carbs: 0,
    fat: 11,
    fiber: 0,
    sodium: 82
  },
  {
    name: "Salmon fillet", 
    category: "Protein",
    fridgeLife: 2,
    freezerLife: 180,
    storageMethod: "Wrap in plastic wrap, store in coldest part of fridge",
    storageTips: "Best used within 24 hours. Pat dry before cooking."
  },
  {
    id: 3,
    name: "Eggs",
    category: "Protein",
    fridgeLife: 35,
    freezerLife: 365,
    pricePerUnit: 7,
    unit: "per piece",
    storageMethod: "Keep in original carton in main body of fridge",
    storageTips: "Don't store in door. Can freeze beaten eggs in ice cube trays.",
    calories: 70,
    protein: 6,
    carbs: 0.6,
    fat: 5,
    fiber: 0,
    sodium: 70
  },
  {
    name: "Greek yogurt",
    category: "Dairy",
    fridgeLife: 14,
    freezerLife: 60,
    storageMethod: "Keep sealed, store in main body of fridge",
    storageTips: "Stir if separated. Freezing changes texture but good for smoothies."
  },
  {
    name: "Tofu",
    category: "Protein",
    fridgeLife: 7,
    freezerLife: 180,
    storageMethod: "Keep in water, change water daily if opened",
    storageTips: "Freeze to change texture for better absorption of flavors."
  },
  {
    name: "Red lentils",
    category: "Protein",
    fridgeLife: 1825,
    freezerLife: 1825,
    storageMethod: "Store in airtight container in cool, dry place",
    storageTips: "Can last years if stored properly. Check for bugs before use."
  },
  {
    name: "Broccoli",
    category: "Vegetable",
    fridgeLife: 7,
    freezerLife: 365,
    storageMethod: "Store unwashed in perforated plastic bag",
    storageTips: "Blanch 3 minutes before freezing. Don't wash until ready to use."
  },
  {
    name: "Carrots",
    category: "Vegetable",
    fridgeLife: 21,
    freezerLife: 365,
    storageMethod: "Remove green tops, store in crisper drawer",
    storageTips: "Keep away from apples. Can freeze without blanching if sliced."
  },
  {
    name: "Onion",
    category: "Vegetable",
    fridgeLife: 60,
    freezerLife: 365,
    storageMethod: "Store whole in cool, dry, well-ventilated area",
    storageTips: "Don't refrigerate whole onions. Can freeze chopped onions for cooking."
  },
  {
    name: "Garlic cloves",
    category: "Vegetable",
    fridgeLife: 90,
    freezerLife: 365,
    storageMethod: "Store whole bulbs in cool, dry place with good air circulation",
    storageTips: "Don't refrigerate whole bulbs. Can freeze peeled cloves in oil."
  },
  {
    name: "Fresh ginger",
    category: "Vegetable",
    fridgeLife: 21,
    freezerLife: 180,
    storageMethod: "Store unpeeled in crisper drawer",
    storageTips: "Can grate frozen ginger directly into dishes. Peel with spoon edge."
  },
  {
    name: "Scallions",
    category: "Vegetable",
    fridgeLife: 7,
    freezerLife: 365,
    storageMethod: "Wrap in damp paper towel, store in plastic bag",
    storageTips: "Can regrow in water. Freeze chopped for cooking use only."
  },
  {
    name: "Soy sauce",
    category: "Pantry",
    fridgeLife: 1095,
    freezerLife: 1095,
    storageMethod: "Store in cool, dark place or refrigerate after opening",
    storageTips: "Quality best for 3 years. Won't spoil but may lose flavor over time."
  },
  {
    name: "White vinegar",
    category: "Pantry",
    fridgeLife: 1825,
    freezerLife: 1825,
    storageMethod: "Store in cool, dark place",
    storageTips: "Never spoils due to acidity. May develop sediment but still safe."
  },
  {
    name: "Sesame oil",
    category: "Pantry",
    fridgeLife: 730,
    freezerLife: 730,
    storageMethod: "Refrigerate after opening",
    storageTips: "Goes rancid quickly. Buy small bottles and refrigerate."
  },
  {
    name: "Bay leaves",
    category: "Pantry",
    fridgeLife: 1095,
    freezerLife: 1095,
    storageMethod: "Store in airtight container in cool, dark place",
    storageTips: "Whole leaves last longer than crushed. Replace yearly for best flavor."
  },
  {
    name: "Mixed berries",
    category: "Fruit",
    fridgeLife: 5,
    freezerLife: 365,
    storageMethod: "Don't wash until ready to eat, store in breathable container",
    storageTips: "Remove any moldy berries immediately. Freeze on tray first, then bag."
  },
  {
    name: "Granola",
    category: "Pantry",
    fridgeLife: 180,
    freezerLife: 365,
    storageMethod: "Store in airtight container in cool, dry place",
    storageTips: "Refrigerate in humid climates. Can freeze to extend life."
  },
  {
    name: "Honey",
    category: "Pantry",
    fridgeLife: 1825,
    freezerLife: 1825,
    storageMethod: "Store at room temperature in tightly sealed container",
    storageTips: "Never spoils. Crystallization is normal - warm to reliquefy."
  },
  {
    name: "Rolled oats",
    category: "Grain",
    fridgeLife: 730,
    freezerLife: 730,
    storageMethod: "Store in airtight container in cool, dry place",
    storageTips: "Can refrigerate or freeze to extend life. Check for rancid smell."
  },
  {
    name: "Milk",
    category: "Dairy",
    fridgeLife: 7,
    freezerLife: 90,
    storageMethod: "Keep in main body of fridge at 40°F or below",
    storageTips: "Don't store in door. Freezing changes texture but good for cooking."
  },
  {
    name: "Chia seeds",
    category: "Pantry",
    fridgeLife: 1460,
    freezerLife: 1460,
    pricePerUnit: 80,
    unit: "per 100g",
    storageMethod: "Store in airtight container in cool, dry place",
    storageTips: "Can refrigerate to extend life. High in omega-3s, keep sealed."
  },
  {
    name: "Sayote",
    category: "Vegetable",
    fridgeLife: 14,
    freezerLife: 365,
    pricePerUnit: 25,
    unit: "per kilo",
    storageMethod: "Store in cool, dry place or crisper drawer",
    storageTips: "Can be stored at room temperature for a week. Refrigerate for longer storage."
  },
  {
    name: "Pechay",
    category: "Vegetable",
    fridgeLife: 5,
    freezerLife: 365,
    pricePerUnit: 15,
    unit: "per bundle",
    storageMethod: "Wrap in damp paper towel, store in plastic bag",
    storageTips: "Very perishable. Use within 3-5 days. Blanch before freezing."
  },
  {
    name: "Malunggay",
    category: "Vegetable",
    fridgeLife: 3,
    freezerLife: 365,
    pricePerUnit: 10,
    unit: "per bundle",
    storageMethod: "Store like herbs - in water or wrapped in damp paper towel",
    storageTips: "Extremely perishable. Freeze leaves for longer storage."
  },
  {
    name: "Kangkong",
    category: "Vegetable",
    fridgeLife: 3,
    freezerLife: 365,
    pricePerUnit: 12,
    unit: "per bundle",
    storageMethod: "Store cut stems in water, refrigerate leaves",
    storageTips: "Use quickly. Can regrow stems in water."
  },
  {
    name: "Kalabasa",
    category: "Vegetable",
    fridgeLife: 30,
    freezerLife: 365,
    pricePerUnit: 40,
    unit: "per kilo",
    storageMethod: "Store whole in cool, dry place. Cut pieces in fridge.",
    storageTips: "Whole squash lasts weeks. Once cut, use within a week."
  },
  {
    name: "Fish sauce",
    category: "Pantry",
    fridgeLife: 1095,
    freezerLife: 1095,
    pricePerUnit: 25,
    unit: "per 200ml bottle",
    storageMethod: "Store in cool, dark place or refrigerate",
    storageTips: "Very long shelf life. Quality best for 2-3 years."
  },
  {
    name: "Coconut milk",
    category: "Pantry",
    fridgeLife: 5,
    freezerLife: 180,
    pricePerUnit: 45,
    unit: "per 400ml can",
    storageMethod: "Refrigerate after opening, freeze in ice cube trays",
    storageTips: "Separation is normal - stir before use."
  },
  {
    name: "Calamansi",
    category: "Fruit",
    fridgeLife: 14,
    freezerLife: 180,
    pricePerUnit: 20,
    unit: "per kilo",
    storageMethod: "Store in crisper drawer",
    storageTips: "Juice and freeze in ice trays for longer use."
  },
  {
    name: "Gochujang",
    category: "Pantry",
    fridgeLife: 365,
    freezerLife: 365,
    pricePerUnit: 120,
    unit: "per 500g container",
    storageMethod: "Refrigerate after opening",
    storageTips: "Long shelf life. A little goes a long way for flavor."
  },
  {
    name: "Kimchi",
    category: "Vegetable",
    fridgeLife: 30,
    freezerLife: 180,
    pricePerUnit: 180,
    unit: "per 500g jar",
    storageMethod: "Keep refrigerated in original brine",
    storageTips: "Gets more sour over time. Use older kimchi for cooking."
  },
  {
    name: "Curry powder",
    category: "Pantry",
    fridgeLife: 1095,
    freezerLife: 1095,
    pricePerUnit: 35,
    unit: "per 50g packet",
    storageMethod: "Store in airtight container in cool, dark place",
    storageTips: "Whole spices last longer than ground. Toast before using for better flavor."
  },
  {
    name: "Garam masala",
    category: "Pantry",
    fridgeLife: 730,
    freezerLife: 730,
    pricePerUnit: 45,
    unit: "per 50g packet",
    storageMethod: "Store in airtight container away from light",
    storageTips: "Loses potency over time. Buy in small quantities."
  },
  {
    name: "Tomato puree",
    category: "Pantry",
    fridgeLife: 5,
    freezerLife: 180,
    pricePerUnit: 25,
    unit: "per 200g can",
    storageMethod: "Refrigerate after opening",
    storageTips: "Freeze leftover portions in ice cube trays for easy use."
  },
  {
    name: "Greek yogurt",
    category: "Dairy",
    fridgeLife: 14,
    freezerLife: 60,
    pricePerUnit: 35,
    unit: "per 200g container",
    storageMethod: "Keep sealed, store in main body of fridge",
    storageTips: "Stir if separated. Freezing changes texture but good for smoothies."
  },
  {
    name: "Banana",
    category: "Fruit",
    fridgeLife: 7,
    freezerLife: 180,
    storageMethod: "Store at room temperature, refrigerate when ripe",
    storageTips: "Peel darkens in fridge but fruit is fine. Freeze peeled for smoothies."
  },
  {
    name: "Peanut butter",
    category: "Pantry",
    fridgeLife: 270,
    freezerLife: 365,
    storageMethod: "Store in cool, dry place or refrigerate after opening",
    storageTips: "Natural PB should be refrigerated. Stir before use if separated."
  },
  {
    name: "Vegetable broth",
    category: "Pantry",
    fridgeLife: 5,
    freezerLife: 180,
    storageMethod: "Refrigerate opened cartons, freeze in ice cube trays",
    storageTips: "Use within 5 days of opening. Freeze portions for easy use."
  },
  {
    id: 2,
    name: "White fish fillet",
    category: "Protein", 
    fridgeLife: 1,
    freezerLife: 180,
    pricePerUnit: 300,
    unit: "per kg",
    storageMethod: "Store on ice in coldest part of fridge",
    storageTips: "Use within 24 hours for best quality. Should smell like ocean, not fishy.",
    calories: 128,
    protein: 26,
    carbs: 0,
    fat: 3,
    fiber: 0,
    sodium: 78
  },
  {
    id: 15,
    name: "Brown rice", 
    category: "Grain",
    fridgeLife: 180,
    freezerLife: 365,
    pricePerUnit: 60,
    unit: "per kg",
    storageMethod: "Store in airtight container in cool, dry place",
    storageTips: "Shorter shelf life than white rice due to oils. Can refrigerate or freeze.",
    calories: 123,
    protein: 2.6,
    carbs: 23,
    fat: 1,
    fiber: 2,
    sodium: 5
  },
  {
    name: "Quinoa",
    category: "Grain",
    fridgeLife: 730,
    freezerLife: 1095,
    storageMethod: "Store in airtight container in cool, dry place",
    storageTips: "Rinse before cooking to remove bitter coating. Very long shelf life."
  }
];

// Sample recipe data with corrected pricing and nutrition data
const sampleRecipes = [
  {
    id: 1,
    name: "Instant Pot Chicken Adobo",
    basePrepTime: 10,
    baseCookTime: 20,
    baseServings: 4,
    currentServings: 4,
    category: "Main Dish",
    fridgeLife: 4,
    freezerLife: 90,
    storageNotes: "Store in shallow containers. Reheat thoroughly.",
    baseIngredients: [
      { name: "Chicken thighs", baseQuantity: 2, unit: "lbs", category: "Protein" },
      { name: "Soy sauce", baseQuantity: 0.5, unit: "cup", category: "Pantry" },
      { name: "White vinegar", baseQuantity: 0.25, unit: "cup", category: "Pantry" },
      { name: "Garlic cloves", baseQuantity: 6, unit: "pieces", category: "Vegetable" },
      { name: "Bay leaves", baseQuantity: 3, unit: "pieces", category: "Pantry" }
    ],
    instructions: "Add all ingredients to Instant Pot. Pressure cook high 8 minutes, quick release. Remove chicken, reduce sauce on sauté mode. Serve over rice.",
    nutritionPerServing: { calories: 285, protein: 28, carbs: 4, fat: 17, fiber: 0, sodium: 890 }
  },
  {
    id: 2,
    name: "Greek Yogurt Parfait",
    basePrepTime: 5,
    baseCookTime: 0,
    baseServings: 1,
    currentServings: 1,
    category: "Breakfast",
    fridgeLife: 2,
    freezerLife: 30,
    storageNotes: "Best fresh. Granola gets soggy if stored assembled.",
    baseIngredients: [
      { name: "Greek yogurt", baseQuantity: 1, unit: "cup", category: "Dairy" },
      { name: "Mixed berries", baseQuantity: 0.5, unit: "cup", category: "Fruit" },
      { name: "Granola", baseQuantity: 0.25, unit: "cup", category: "Pantry" },
      { name: "Honey", baseQuantity: 1, unit: "tbsp", category: "Pantry" }
    ],
    instructions: "Layer yogurt, berries, and granola in a jar. Drizzle with honey. Add granola just before eating to maintain crunch.",
    nutritionPerServing: { calories: 380, protein: 20, carbs: 52, fat: 8, fiber: 4, sodium: 65 }
  },
  {
    id: 3,
    name: "Steamed Fish with Ginger",
    basePrepTime: 15,
    baseCookTime: 8,
    baseServings: 2,
    currentServings: 2,
    category: "Main Dish",
    fridgeLife: 2,
    freezerLife: 60,
    storageNotes: "Best consumed fresh. Do not reheat in microwave.",
    baseIngredients: [
      { name: "White fish fillet", baseQuantity: 1, unit: "lb", category: "Protein" },
      { name: "Fresh ginger", baseQuantity: 2, unit: "inches", category: "Vegetable" },
      { name: "Scallions", baseQuantity: 3, unit: "stalks", category: "Vegetable" },
      { name: "Soy sauce", baseQuantity: 2, unit: "tbsp", category: "Pantry" },
      { name: "Sesame oil", baseQuantity: 1, unit: "tsp", category: "Pantry" }
    ],
    instructions: "Slice ginger and place under fish. Steam 8 minutes. Top with scallions, soy sauce, and hot sesame oil.",
    nutritionPerServing: { calories: 240, protein: 48, carbs: 2, fat: 4, fiber: 0, sodium: 540 }
  },
  {
    id: 4,
    name: "Overnight Oats",
    basePrepTime: 5,
    baseCookTime: 0,
    baseServings: 1,
    currentServings: 1,
    category: "Breakfast",
    fridgeLife: 4,
    freezerLife: 30,
    storageNotes: "Perfect make-ahead meal. Gets better after overnight rest.",
    baseIngredients: [
      { name: "Rolled oats", baseQuantity: 0.5, unit: "cup", category: "Grain" },
      { name: "Milk", baseQuantity: 0.5, unit: "cup", category: "Dairy" },
      { name: "Chia seeds", baseQuantity: 1, unit: "tbsp", category: "Pantry" },
      { name: "Banana", baseQuantity: 0.5, unit: "piece", category: "Fruit" },
      { name: "Peanut butter", baseQuantity: 1, unit: "tbsp", category: "Pantry" }
    ],
    instructions: "Mix oats, milk, and chia seeds in jar. Add sliced banana and peanut butter. Refrigerate overnight. Stir before eating.",
    nutritionPerServing: { calories: 420, protein: 15, carbs: 54, fat: 16, fiber: 6, sodium: 95 }
  },
  {
    id: 5,
    name: "Lentil Vegetable Soup",
    basePrepTime: 15,
    baseCookTime: 25,
    baseServings: 6,
    currentServings: 6,
    category: "Main Dish",
    fridgeLife: 5,
    freezerLife: 120,
    storageNotes: "Freezes excellently. May need extra liquid when reheating.",
    baseIngredients: [
      { name: "Red lentils", baseQuantity: 1, unit: "cup", category: "Protein" },
      { name: "Vegetable broth", baseQuantity: 4, unit: "cups", category: "Pantry" },
      { name: "Carrots", baseQuantity: 2, unit: "pieces", category: "Vegetable" },
      { name: "Celery stalks", baseQuantity: 2, unit: "pieces", category: "Vegetable" },
      { name: "Onion", baseQuantity: 1, unit: "piece", category: "Vegetable" },
      { name: "Garlic cloves", baseQuantity: 3, unit: "pieces", category: "Vegetable" }
    ],
    instructions: "Sauté vegetables until soft. Add lentils and broth. Simmer 20 minutes until lentils are tender. Season to taste.",
    nutritionPerServing: { calories: 145, protein: 9, carbs: 23, fat: 1, fiber: 6, sodium: 310 }
  },
  {
    id: 6,
    name: "Chicken Tinola (Instant Pot)",
    basePrepTime: 10,
    baseCookTime: 10,
    baseServings: 3,
    currentServings: 3,
    category: "Main Dish",
    cookingMethod: ["Instant Pot", "Slow Cook"],
    fridgeLife: 4,
    freezerLife: 90,
    estimatedCost: 180,
    costPerServing: 60,
    storageNotes: "Great leftover dish. Flavors improve overnight.",
    highlights: ["Comforting", "Light and gingery", "Budget-friendly", "Healing"],
    baseIngredients: [
      { name: "Chicken (bone-in pieces)", baseQuantity: 500, unit: "g", category: "Protein", pricePerUnit: 160 },
      { name: "Fresh ginger", baseQuantity: 1, unit: "thumb-sized piece", category: "Vegetable", pricePerUnit: 5 },
      { name: "Onion", baseQuantity: 1, unit: "small", category: "Vegetable", pricePerUnit: 8 },
      { name: "Sayote", baseQuantity: 2, unit: "cups sliced", category: "Vegetable", pricePerUnit: 15 },
      { name: "Water or chicken broth", baseQuantity: 2, unit: "cups", category: "Pantry", pricePerUnit: 5 },
      { name: "Fish sauce", baseQuantity: 1, unit: "tbsp", category: "Pantry", pricePerUnit: 2 },
      { name: "Pechay or malunggay", baseQuantity: 1, unit: "handful", category: "Vegetable", pricePerUnit: 10 }
    ],
    instructions: "Pressure Cook Method: 1. Add chicken, ginger, onion, sayote, water, fish sauce, salt/pepper 2. Set Pressure Cook: 10 minutes 3. Quick release 4. Stir in pechay or malunggay (let sit 2 mins to soften). Slow Cook Method: 1. Dump all ingredients except greens 2. Set Slow Cook: 6 hours (LOW) 3. Add greens in last 30 minutes",
    nutritionPerServing: { calories: 180, protein: 20, carbs: 4, fat: 8, fiber: 1, sodium: 420 }
  },
  {
    id: 7,
    name: "Garlic Herb Chicken",
    basePrepTime: 5,
    baseCookTime: 12,
    baseServings: 3,
    currentServings: 3,
    category: "Main Dish",
    cookingMethod: ["Instant Pot", "Slow Cook"],
    fridgeLife: 4,
    freezerLife: 120,
    estimatedCost: 220,
    costPerServing: 73,
    storageNotes: "Reheat in pan for crispy skin.",
    highlights: ["Versatile", "Bold flavor", "Great with rice/kamote", "No sauce needed"],
    baseIngredients: [
      { name: "Chicken thighs", baseQuantity: 500, unit: "g", category: "Protein", pricePerUnit: 180 },
      { name: "Garlic cloves", baseQuantity: 6, unit: "pieces", category: "Vegetable", pricePerUnit: 10 },
      { name: "Dried herbs", baseQuantity: 1, unit: "tsp", category: "Pantry", pricePerUnit: 5 },
      { name: "Salt", baseQuantity: 1, unit: "tsp", category: "Pantry", pricePerUnit: 1 },
      { name: "Black pepper", baseQuantity: 0.5, unit: "tsp", category: "Pantry", pricePerUnit: 2 },
      { name: "Olive oil", baseQuantity: 1, unit: "tbsp", category: "Pantry", pricePerUnit: 8 },
      { name: "Water or broth", baseQuantity: 2, unit: "tbsp", category: "Pantry", pricePerUnit: 2 }
    ],
    instructions: "Pressure Cook Method: 1. Dump all ingredients in pot 2. Set Pressure Cook: 12 minutes 3. Natural or quick release 4. Optional: Air-fry or pan-sear after for crispy skin. Slow Cook Method: 1. Dump everything in 2. Set Slow Cook: 4-5 hours (LOW)",
    nutritionPerServing: { calories: 335, protein: 26, carbs: 2, fat: 24, fiber: 0, sodium: 380 }
  },
  {
    id: 8,
    name: "Pork/Chicken Ginataan",
    basePrepTime: 10,
    baseCookTime: 12,
    baseServings: 4,
    currentServings: 4,
    category: "Main Dish",
    cookingMethod: ["Instant Pot", "Slow Cook"],
    fridgeLife: 4,
    freezerLife: 60,
    estimatedCost: 280,
    costPerServing: 70,
    storageNotes: "Thaw gently due to coconut milk. May separate when reheated.",
    highlights: ["Creamy and rich", "Comforting", "Amazing with rice"],
    baseIngredients: [
      { name: "Pork cubes or chicken", baseQuantity: 500, unit: "g", category: "Protein", pricePerUnit: 200 },
      { name: "Kalabasa", baseQuantity: 1, unit: "cup cubed", category: "Vegetable", pricePerUnit: 20 },
      { name: "Sitaw", baseQuantity: 1, unit: "cup cut", category: "Vegetable", pricePerUnit: 15 },
      { name: "Onion", baseQuantity: 1, unit: "small sliced", category: "Vegetable", pricePerUnit: 8 },
      { name: "Fresh ginger", baseQuantity: 1, unit: "thumb-sized", category: "Vegetable", pricePerUnit: 5 },
      { name: "Coconut milk", baseQuantity: 400, unit: "ml can", category: "Pantry", pricePerUnit: 45 },
      { name: "Fish sauce", baseQuantity: 2, unit: "tbsp", category: "Pantry", pricePerUnit: 4 }
    ],
    instructions: "Pressure Cook Method: 1. Add meat, onion, ginger, kalabasa, coconut milk, fish sauce 2. Set Pressure Cook: 10-12 minutes 3. Quick release 4. Stir in sitaw → cover 2-3 minutes to soften. Slow Cook Method: 1. Add everything except sitaw 2. Set Slow Cook: 6 hours (LOW) 3. Add sitaw during last 30-45 mins",
    nutritionPerServing: { calories: 380, protein: 22, carbs: 7, fat: 24, fiber: 2, sodium: 480 }
  },
  {
    id: 9,
    name: "Kimchi-jjigae",
    basePrepTime: 5,
    baseCookTime: 15,
    baseServings: 2,
    currentServings: 2,
    category: "Main Dish",
    cookingMethod: ["Instant Pot", "Slow Cook"],
    fridgeLife: 5,
    freezerLife: 90,
    estimatedCost: 180,
    costPerServing: 90,
    storageNotes: "Flavors improve over time. Great leftover dish.",
    highlights: ["Korean comfort food", "Spicy and tangy", "Probiotic benefits"],
    baseIngredients: [
      { name: "Pork cubes", baseQuantity: 0.5, unit: "cup", category: "Protein", pricePerUnit: 80 },
      { name: "Onion", baseQuantity: 0.5, unit: "cup", category: "Vegetable", pricePerUnit: 8 },
      { name: "Green onion", baseQuantity: 0.25, unit: "cup", category: "Vegetable", pricePerUnit: 10 },
      { name: "Aged kimchi", baseQuantity: 0.5, unit: "cup", category: "Vegetable", pricePerUnit: 40 },
      { name: "Water", baseQuantity: 2, unit: "cups", category: "Pantry", pricePerUnit: 2 },
      { name: "Tofu", baseQuantity: 0.5, unit: "cup", category: "Protein", pricePerUnit: 25 },
      { name: "Gochujang", baseQuantity: 1, unit: "tbsp", category: "Pantry", pricePerUnit: 15 },
      { name: "Fish sauce", baseQuantity: 1, unit: "tsp", category: "Pantry", pricePerUnit: 2 }
    ],
    instructions: "Add all ingredients to pot. Pressure cook 15 minutes or slow cook 3-4 hours.",
    nutritionPerServing: { calories: 215, protein: 15, carbs: 8, fat: 13, fiber: 2, sodium: 720 }
  },
  {
    id: 10,
    name: "Masala Butter Chicken",
    basePrepTime: 10,
    baseCookTime: 240,
    baseServings: 4,
    currentServings: 4,
    category: "Main Dish",
    cookingMethod: ["Slow Cook"],
    fridgeLife: 5,
    freezerLife: 120,
    estimatedCost: 350,
    costPerServing: 88,
    storageNotes: "Freezes excellently. Rich and creamy sauce.",
    highlights: ["Rich Indian curry", "Set and forget", "Restaurant quality"],
    baseIngredients: [
      { name: "Chicken breast cubes", baseQuantity: 2, unit: "pieces", category: "Protein", pricePerUnit: 200 },
      { name: "Curry powder", baseQuantity: 1, unit: "tbsp", category: "Pantry", pricePerUnit: 8 },
      { name: "Garam masala", baseQuantity: 1, unit: "tbsp", category: "Pantry", pricePerUnit: 10 },
      { name: "Chili powder", baseQuantity: 1, unit: "tbsp", category: "Pantry", pricePerUnit: 5 },
      { name: "Onion", baseQuantity: 1, unit: "piece", category: "Vegetable", pricePerUnit: 8 },
      { name: "Garlic cloves", baseQuantity: 4, unit: "pieces", category: "Vegetable", pricePerUnit: 5 },
      { name: "Tomato puree", baseQuantity: 100, unit: "g", category: "Pantry", pricePerUnit: 25 },
      { name: "Greek yogurt", baseQuantity: 200, unit: "g", category: "Dairy", pricePerUnit: 35 },
      { name: "Coconut milk", baseQuantity: 400, unit: "ml", category: "Pantry", pricePerUnit: 45 },
      { name: "Butter", baseQuantity: 100, unit: "g", category: "Dairy", pricePerUnit: 25 }
    ],
    instructions: "Mix everything and slow cook for 4 hours. Season with salt and pepper before serving.",
    nutritionPerServing: { calories: 520, protein: 42, carbs: 7, fat: 34, fiber: 1, sodium: 560 }
  },
  {
    id: 11,
    name: "Slow Cooker Beef and Broccoli",
    basePrepTime: 15,
    baseCookTime: 270,
    baseServings: 6,
    currentServings: 6,
    category: "Main Dish",
    cookingMethod: ["Slow Cook"],
    fridgeLife: 4,
    freezerLife: 90,
    estimatedCost: 420,
    costPerServing: 70,
    storageNotes: "Beef stays tender. Add fresh broccoli when reheating.",
    highlights: ["American-Chinese favorite", "Tender beef", "Family-sized portions"],
    baseIngredients: [
      { name: "Sirloin steak", baseQuantity: 905, unit: "g", category: "Protein", pricePerUnit: 250 },
      { name: "Beef broth", baseQuantity: 240, unit: "ml", category: "Pantry", pricePerUnit: 25 },
      { name: "Low sodium soy sauce", baseQuantity: 120, unit: "ml", category: "Pantry", pricePerUnit: 30 },
      { name: "Brown sugar", baseQuantity: 55, unit: "g", category: "Pantry", pricePerUnit: 15 },
      { name: "Sesame oil", baseQuantity: 1, unit: "tbsp", category: "Pantry", pricePerUnit: 20 },
      { name: "Garlic cloves", baseQuantity: 4, unit: "pieces", category: "Vegetable", pricePerUnit: 5 },
      { name: "Cornstarch", baseQuantity: 4, unit: "tbsp", category: "Pantry", pricePerUnit: 10 },
      { name: "Broccoli", baseQuantity: 1, unit: "head", category: "Vegetable", pricePerUnit: 50 },
      { name: "White rice", baseQuantity: 2, unit: "cups", category: "Grain", pricePerUnit: 15 }
    ],
    instructions: "1. In crockpot, whisk together beef broth, soy sauce, sesame oil, minced garlic, and brown sugar. 2. Place slices of beef in liquid and toss to coat. 3. Cook on low heat for 4 hours. 4. After 4 hours, whisk together cornstarch and water. Pour into crock pot, add broccoli and stir. 5. Cook 30 minutes to cook broccoli and thicken sauce. 6. Serve with warm white rice.",
    nutritionPerServing: { calories: 490, protein: 40, carbs: 32, fat: 15, fiber: 3, sodium: 680 }
  }
];

// Utility functions for serving size calculations
function formatQuantity(quantity) {
  if (quantity === Math.floor(quantity)) {
    return quantity.toString();
  }
  
  // Handle common fractions
  if (Math.abs(quantity - 0.25) < 0.01) return '1/4';
  if (Math.abs(quantity - 0.33) < 0.01) return '1/3';
  if (Math.abs(quantity - 0.5) < 0.01) return '1/2';
  if (Math.abs(quantity - 0.67) < 0.01) return '2/3';
  if (Math.abs(quantity - 0.75) < 0.01) return '3/4';
  
  // Round to 2 decimal places for other decimals
  return parseFloat(quantity.toFixed(2)).toString();
}

function calculateScaledQuantity(recipe, ingredient) {
  const scale = recipe.currentServings / recipe.baseServings;
  return ingredient.baseQuantity * scale;
}

function getStorageIndicatorClass(fridgeLife) {
  if (fridgeLife <= 3) return 'fresh';
  if (fridgeLife <= 7) return 'use-soon';
  return 'freeze-now';
}

// Initialize app
function openHelpModal() {
  var m = document.getElementById('help-modal');
  if (m) { hydrateIcons(); m.classList.remove('hidden'); }
}
function closeHelpModal() {
  var m = document.getElementById('help-modal');
  if (m) m.classList.add('hidden');
}
window.openHelpModal = openHelpModal;
window.closeHelpModal = closeHelpModal;

function initApp() {
  hydrateIcons(); // turn static data-icon placeholders into SVGs

  // First-run: show the How-to-Use guide once.
  try {
    if (!localStorage.getItem('mealPrepHelpSeen')) {
      localStorage.setItem('mealPrepHelpSeen', '1');
      setTimeout(openHelpModal, 600);
    }
  } catch (e) { /* ignore storage errors */ }

  // Set up Firebase auth state listener
  if (window.firebase) {
    window.firebase.onAuthStateChanged(window.firebase.auth, (user) => {
      AppState.currentUser = user;
      updateAuthUI();
      
      if (user) {
        // User is signed in
        loadUserData();
        setupRealtimeListeners();
      } else {
        // User is signed out
        loadFromLocalStorage();
        seedPantryIfEmpty();
        renderRecipes();
        renderWeeklyPlanner();
        renderStorageGuide();
        renderCookingHacks();
        renderCookedMeals();
        renderPantry();
        updateNutritionGoalsDisplay();
        updateFreshnessBadges();
        renderFreshnessBanner();
        initWeekTemplateButton();
        updateThemeToggleIcon();
      }
    });
  } else {
    // Firebase not available, use local storage only
    const hasLoadedData = loadFromLocalStorage();
    
    // If no saved data, use defaults
    if (!hasLoadedData) {
      AppState.recipes = [...sampleRecipes];
      AppState.customIngredients = [...defaultStorageData];
      AppState.customHacks = [...defaultCookingHacks];
      // Save the default data
      saveToLocalStorage();
    }
    
    seedPantryIfEmpty();

    // Initialize nutrition goals display
    updateNutritionGoalsDisplay();

    // Render initial views
    renderRecipes();
    renderWeeklyPlanner();
    renderStorageGuide();
    renderCookingHacks();
    renderPantry();
    renderCookedMeals();
    updateFreshnessBadges();
    renderFreshnessBanner();
  }

  initWeekTemplateButton();
  updateThemeToggleIcon();

  // Attach ingredient autocomplete to pantry input
  var pantryInput = document.getElementById('pantry-input');
  if (pantryInput) attachIngredientAutocomplete(pantryInput);

  // ...and to the custom grocery-item modal, filling its unit/category on pick.
  var customItemInput = document.getElementById('custom-item-name');
  if (customItemInput) attachIngredientAutocomplete(customItemInput, function(data) {
    var unitEl = document.getElementById('custom-item-unit');
    var catEl = document.getElementById('custom-item-category');
    if (unitEl && data.unit) unitEl.value = data.unit;
    if (catEl && data.cat) {
      for (var o of catEl.options) { if (o.value === data.cat) { o.selected = true; break; } }
    }
  });

  // Setup event listeners
  setupEventListeners();
  
  // Set up authentication form handlers
  setupAuthFormHandlers();
  
  // Set up online/offline listeners
  setupOnlineOfflineListeners();
  
  // Setup modal event listeners
  setupModalEventListeners();
  
  // Show initial tab
  showTab('recipes');
  
  // Setup auto-save (save every 30 seconds if there are changes)
  setInterval(() => {
    saveData();
  }, 30000);
}

// Event listeners
function setupEventListeners() {
  // Tab navigation
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const tabId = e.currentTarget.dataset.tab;
      if (!tabId) return; // e.g. the "More" toggle button has no data-tab
      showTab(tabId);
    });
  });

  // "More" overflow menu (Price Book, Cooking Hacks)
  const moreBtn = document.querySelector('.tab-more-btn');
  const moreMenu = document.querySelector('.tab-more-menu');
  if (moreBtn && moreMenu) {
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const nowHidden = moreMenu.classList.toggle('hidden');
      moreBtn.setAttribute('aria-expanded', String(!nowHidden));
      if (!nowHidden) {
        // Position as a fixed dropdown so the nav's overflow can't clip it.
        const r = moreBtn.getBoundingClientRect();
        moreMenu.style.top = (r.bottom + 4) + 'px';
        moreMenu.style.right = (window.innerWidth - r.right) + 'px';
      }
    });
    document.addEventListener('click', (e) => {
      if (!moreMenu.contains(e.target) && e.target !== moreBtn) {
        moreMenu.classList.add('hidden');
        moreBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }
  
  // Accessibility: give icon-only "×" close buttons a screen-reader label
  document.querySelectorAll('.modal-close').forEach(b => {
    if (!b.getAttribute('aria-label')) b.setAttribute('aria-label', 'Close');
  });

  // Recipe management
  document.getElementById('add-recipe-btn').addEventListener('click', openAddRecipeModal);
  document.getElementById('recipe-form').addEventListener('submit', saveRecipe);
  document.getElementById('cancel-btn').addEventListener('click', closeRecipeModal);
  document.querySelector('.modal-close').addEventListener('click', closeRecipeModal);
  document.getElementById('add-ingredient-btn').addEventListener('click', addIngredientField);
  
  // Storage guide search and filter
  document.getElementById('storage-search').addEventListener('input', filterStorageGuide);
  document.getElementById('storage-category-filter').addEventListener('change', filterStorageGuide);
  
  // Cooking hacks filter
  document.getElementById('hack-category-filter').addEventListener('change', filterCookingHacks);
  
  // Nutrition tab
  document.getElementById('set-nutrition-goals').addEventListener('click', openNutritionGoalsModal);
  document.getElementById('nutrition-goals-form').addEventListener('submit', saveNutritionGoals);
  document.getElementById('cancel-goals-btn').addEventListener('click', closeNutritionGoalsModal);
  document.getElementById('filter-recipes-nutrition').addEventListener('click', filterRecipesByNutrition);
  
  // Storage guide CRUD
  document.getElementById('add-ingredient-storage').addEventListener('click', openAddIngredientModal);
  document.getElementById('import-from-recipes').addEventListener('click', importIngredientsFromRecipes);
  document.getElementById('ingredient-form').addEventListener('submit', saveIngredient);
  document.getElementById('cancel-ingredient-btn').addEventListener('click', closeIngredientModal);
  
  // Cooking hacks CRUD
  document.getElementById('add-cooking-hack').addEventListener('click', openAddHackModal);
  document.getElementById('hack-form').addEventListener('submit', saveHack);
  document.getElementById('cancel-hack-btn').addEventListener('click', closeHackModal);
  
  // Modal close handlers
  document.getElementById('nutrition-goals-modal').addEventListener('click', (e) => {
    if (e.target.id === 'nutrition-goals-modal') closeNutritionGoalsModal();
  });
  document.getElementById('ingredient-modal').addEventListener('click', (e) => {
    if (e.target.id === 'ingredient-modal') closeIngredientModal();
  });
  document.getElementById('hack-modal').addEventListener('click', (e) => {
    if (e.target.id === 'hack-modal') closeHackModal();
  });
  
  // Additional modal close buttons
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const modal = e.target.closest('.modal');
      if (modal) modal.classList.add('hidden');
    });
  });
  
  // Search and filter
  document.getElementById('recipe-search').addEventListener('input', filterRecipes);
  document.getElementById('category-filter').addEventListener('change', filterRecipes);
  document.getElementById('preptime-filter').addEventListener('change', filterRecipes);
  
  // Weekly planner
  document.getElementById('clear-week').addEventListener('click', clearWeeklyPlan);
  
  // Grocery list
  document.getElementById('clear-grocery').addEventListener('click', clearGroceryList);
  document.getElementById('add-custom-item').addEventListener('click', addCustomGroceryItem);

  // Pantry input: Enter key adds item
  document.getElementById('pantry-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addToPantry();
  });
  
  // Custom item modal: Enter key submits, click outside closes
  document.getElementById('custom-item-modal').addEventListener('click', (e) => {
    if (e.target.id === 'custom-item-modal') closeCustomItemModal();
  });
  document.getElementById('custom-item-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmCustomGroceryItem();
  });

  // Modal click outside to close
  document.getElementById('recipe-modal').addEventListener('click', (e) => {
    if (e.target.id === 'recipe-modal') {
      closeRecipeModal();
    }
  });
}

function setupModalEventListeners() {
  // Recipe search in modal
  document.getElementById('recipe-modal-search').addEventListener('input', renderRecipeSelectionGrid);
  
  // Recipe selection modal close
  document.getElementById('recipe-selection-modal').addEventListener('click', (e) => {
    if (e.target.id === 'recipe-selection-modal') {
      closeRecipeSelectionModal();
    }
  });
  
  // Modal close button
  document.querySelector('#recipe-selection-modal .modal-close').addEventListener('click', closeRecipeSelectionModal);
}

function closeRecipeSelectionModal() {
  document.getElementById('recipe-selection-modal').classList.add('hidden');
  AppState.selectedMealSlot = null;
}

// Paste the copied day's meals into a target day, then exit copy mode.
function pasteDayInto(day) {
  if (!AppState.dayToCopy) return;
  AppState.weeklyPlan[day] = JSON.parse(JSON.stringify(AppState.dayToCopy.plan));
  AppState.dayToCopy = null;
  renderWeeklyPlanner();
  updateWeeklyStats();
  saveData();
  generateGroceryList();
  showSuccessMessage('Meals pasted to ' + day + '!');
}

function cancelCopyDay() {
  AppState.dayToCopy = null;
  renderWeeklyPlanner();
}

// Tab management
function showTab(tabId) {
  // Update tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });

  // Reflect "More" section state + close its menu after navigating
  const moreBtn = document.querySelector('.tab-more-btn');
  const moreMenu = document.querySelector('.tab-more-menu');
  if (moreBtn) moreBtn.classList.toggle('active', tabId === 'ingredients' || tabId === 'hacks');
  if (moreMenu) {
    moreMenu.classList.add('hidden');
    if (moreBtn) moreBtn.setAttribute('aria-expanded', 'false');
  }

  // Update tab content
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === tabId);
  });
  
  // Special handling for different tabs
  if (tabId === 'planner') {
    updateWeeklyStats();
  } else if (tabId === 'grocery') {
    updateGrocerySummary();
    updateBudgetDisplay();
    renderGroceryList();
  } else if (tabId === 'fridge') {
    renderCookedMeals();
    renderPantry();
  } else if (tabId === 'hacks') {
    renderCookingHacks();
  } else if (tabId === 'nutrition') {
    renderNutritionTab();
  } else if (tabId === 'ingredients') {
    renderIngredientsTab();
  } else if (tabId === 'recipes') {
    renderGettingStarted();
  }
}

// Recipe management functions
function openAddRecipeModal() {
  AppState.currentEditingRecipe = null;
  document.getElementById('modal-title').textContent = 'Add New Recipe';
  clearRecipeForm();
  addIngredientField(); // Add one ingredient field by default
  document.getElementById('recipe-modal').classList.remove('hidden');
}

function updateServingSize(recipeId, newServings) {
  const recipe = AppState.recipes.find(r => String(r.id) === String(recipeId));
  if (!recipe || newServings < 1) return;
  
  recipe.currentServings = newServings;
  renderRecipes();
  renderRecipeSelectionGrid();
  updateWeeklyStats();
}

function resetServingSize(recipeId) {
  const recipe = AppState.recipes.find(r => String(r.id) === String(recipeId));
  if (!recipe) return;
  
  recipe.currentServings = recipe.baseServings;
  renderRecipes();
  renderRecipeSelectionGrid();
  updateWeeklyStats();
}

function openEditRecipeModal(recipeId) {
  const recipe = AppState.recipes.find(r => String(r.id) === String(recipeId));
  if (!recipe) return;
  
  AppState.currentEditingRecipe = recipeId;
  document.getElementById('modal-title').textContent = 'Edit Recipe';
  
  // Populate form with recipe data
  document.getElementById('recipe-name').value = recipe.name;
  document.getElementById('recipe-category').value = recipe.category;
  document.getElementById('prep-time').value = recipe.basePrepTime || recipe.prepTime;
  document.getElementById('cook-time').value = recipe.baseCookTime || recipe.cookTime;
  document.getElementById('servings').value = recipe.baseServings || recipe.servings;
  document.getElementById('fridge-life').value = recipe.fridgeLife;
  document.getElementById('freezer-life').value = recipe.freezerLife;
  document.getElementById('estimated-cost').value = recipe.estimatedCost || '';
  const np = recipe.nutritionPerServing || {};
  document.getElementById('nutrition-calories').value = np.calories || '';
  document.getElementById('nutrition-protein').value  = np.protein  || '';
  document.getElementById('nutrition-carbs').value    = np.carbs    || '';
  document.getElementById('nutrition-fat').value      = np.fat      || '';
  document.getElementById('storage-notes').value = recipe.storageNotes;
  document.getElementById('instructions').value = recipe.instructions;
  
  // Handle existing photo
  if (recipe.photo) {
    currentRecipePhoto = recipe.photo;
    showPhotoPreview(recipe.photo);
  } else {
    removePhoto();
  }
  
  // Clear and populate ingredients
  const ingredientsList = document.getElementById('ingredients-list');
  ingredientsList.innerHTML = '';
  const ingredients = recipe.baseIngredients || recipe.ingredients;
  ingredients.forEach(ingredient => {
    addIngredientField({
      name: ingredient.name,
      quantity: ingredient.baseQuantity || ingredient.quantity,
      unit: ingredient.unit,
      category: ingredient.category
    });
  });
  
  document.getElementById('recipe-modal').classList.remove('hidden');
}

function closeRecipeModal() {
  document.getElementById('recipe-modal').classList.add('hidden');
  clearRecipeForm();
}

function clearRecipeForm() {
  document.getElementById('recipe-form').reset();
  document.getElementById('ingredients-list').innerHTML = '';
}

function addIngredientField(ingredient = null) {
  const ingredientsList = document.getElementById('ingredients-list');
  const ingredientDiv = document.createElement('div');
  ingredientDiv.className = 'ingredient-item';

  const units = ['g','kg','ml','L','cups','cup','tbsp','tsp','pieces','cloves','can','pack','stalks','bunches','lbs','oz','inches'];
  const cats  = ['Protein','Vegetable','Fruit','Grain','Dairy','Pantry'];

  const unitOpts = units.map(u => `<option value="${u}" ${ingredient?.unit === u ? 'selected' : ''}>${u}</option>`).join('');
  const catOpts  = cats.map(c =>  `<option value="${c}" ${ingredient?.category === c ? 'selected' : ''}>${c}</option>`).join('');

  ingredientDiv.innerHTML = `
    <div class="ing-name-wrap">
      <input type="text" class="form-control" placeholder="Type to search ingredient…" value="${ingredient?.name || ''}" required>
      <div class="ing-suggestions hidden"></div>
    </div>
    <input type="number" class="form-control" placeholder="Qty" step="0.01" min="0" value="${ingredient?.quantity || ''}" required>
    <select class="form-control" required>
      <option value="">Unit</option>${unitOpts}
    </select>
    <select class="form-control" required>
      <option value="">Category</option>${catOpts}
    </select>
    <button type="button" class="remove-ingredient" onclick="removeIngredientField(this)">×</button>
  `;

  ingredientsList.appendChild(ingredientDiv);
  attachIngredientAutocomplete(ingredientDiv.querySelector('.ing-name-wrap input'));
}

function removeIngredientField(button) {
  button.closest('.ingredient-item').remove();
}

function saveRecipe(e) {
  e.preventDefault();
  
  const formData = new FormData(e.target);
  const ingredientItems = document.querySelectorAll('.ingredient-item');
  
  const ingredients = [];
  ingredientItems.forEach(item => {
    const inputs = item.querySelectorAll('input, select');
    const ingredient = {
      name: inputs[0].value,
      quantity: parseFloat(inputs[1].value),
      unit: inputs[2].value,
      category: inputs[3].value
    };
    if (ingredient.name && ingredient.quantity && ingredient.unit && ingredient.category) {
      ingredients.push(ingredient);
    }
  });
  
  if (ingredients.length === 0) {
    alert('Please add at least one ingredient.');
    return;
  }
  
  // Helper function to safely get element value
  const getElementValue = (id, defaultValue = '') => {
    const element = document.getElementById(id);
    return element ? element.value : defaultValue;
  };

  const getElementValueAsNumber = (id, defaultValue = 0) => {
    const element = document.getElementById(id);
    return element ? parseFloat(element.value) || defaultValue : defaultValue;
  };

  const recipe = {
    id: AppState.currentEditingRecipe || Date.now(),
    name: getElementValue('recipe-name'),
    category: getElementValue('recipe-category'),
    basePrepTime: parseInt(getElementValue('prep-time')) || 0,
    baseCookTime: parseInt(getElementValue('cook-time')) || 0,
    baseServings: parseInt(getElementValue('servings')) || 1,
    currentServings: parseInt(getElementValue('servings')) || 1,
    fridgeLife: parseInt(getElementValue('fridge-life')) || 3,
    freezerLife: parseInt(getElementValue('freezer-life')) || 30,
    estimatedCost: getElementValueAsNumber('estimated-cost', 0),
    costPerServing: getElementValueAsNumber('estimated-cost', 0) / (parseInt(getElementValue('servings')) || 1),
    storageNotes: getElementValue('storage-notes'),
    instructions: getElementValue('instructions'),
    photo: currentRecipePhoto,
    baseIngredients: ingredients.map(ing => ({
      name: ing.name,
      baseQuantity: ing.quantity,
      unit: ing.unit,
      category: ing.category
    }))
  };

  const nutCal  = getElementValueAsNumber('nutrition-calories', 0);
  const nutPro  = getElementValueAsNumber('nutrition-protein', 0);
  const nutCarb = getElementValueAsNumber('nutrition-carbs', 0);
  const nutFat  = getElementValueAsNumber('nutrition-fat', 0);
  if (nutCal || nutPro || nutCarb || nutFat) {
    recipe.nutritionPerServing = { calories: nutCal, protein: nutPro, carbs: nutCarb, fat: nutFat, fiber: 0, sodium: 0 };
  }
  
  if (AppState.currentEditingRecipe) {
    // Update existing recipe
    const index = AppState.recipes.findIndex(r => r.id === AppState.currentEditingRecipe);
    AppState.recipes[index] = recipe;
  } else {
    // Add new recipe
    AppState.recipes.push(recipe);
  }
  
  renderRecipes();
  renderRecipeSelectionGrid();
  closeRecipeModal();
  saveData();

  // Persist the photo to its own doc (or remove it if the photo was cleared).
  if (recipe.photo) savePhotoDoc(recipe.id, recipe.photo);
  else deletePhotoDoc(recipe.id);
}

function deleteRecipe(recipeId) {
  if (confirm('Are you sure you want to delete this recipe?')) {
    AppState.recipes = AppState.recipes.filter(r => r.id !== recipeId);
    deletePhotoDoc(recipeId);

    // Remove from weekly plan if assigned
    Object.keys(AppState.weeklyPlan).forEach(day => {
      Object.keys(AppState.weeklyPlan[day]).forEach(meal => {
        if (Array.isArray(AppState.weeklyPlan[day][meal])) {
          AppState.weeklyPlan[day][meal] = AppState.weeklyPlan[day][meal].filter(id => id !== recipeId);
        } else if (AppState.weeklyPlan[day][meal] === recipeId) {
          AppState.weeklyPlan[day][meal] = null;
        }
      });
    });
    
    renderRecipes();
    renderWeeklyPlanner();
    renderRecipeSelectionGrid();
    updateWeeklyStats();
    saveData();
  }
}

// Click anywhere on a recipe card to edit it — except on interactive controls
// (serving steppers, quick-serve buttons, Cooked/Edit/Delete).
function handleRecipeCardClick(e, id) {
  if (e.target.closest('button, input, select, a, .serving-controls')) return;
  openEditRecipeModal(id);
}
window.handleRecipeCardClick = handleRecipeCardClick;

// Generic "click card to edit" — runs editFn(id) unless an inner control was clicked.
function handleCardEdit(e, editFn, id) {
  if (e.target.closest('button, input, select, a')) return;
  if (typeof editFn === 'function') editFn(id);
}
window.handleCardEdit = handleCardEdit;

// Count meals currently placed in the weekly plan (proxy for "started").
function plannedMealCount() {
  var n = 0;
  var plan = AppState.weeklyPlan || {};
  Object.keys(plan).forEach(function(day) {
    var d = plan[day] || {};
    ['breakfast', 'lunch', 'dinner'].forEach(function(m) { if (d[m]) n++; });
    if (Array.isArray(d.snacks)) n += d.snacks.length;
  });
  return n;
}

// "Start here" card on the My Recipes tab: a tiny, self-updating checklist that
// walks a first-time user through the core loop (plan a meal -> grocery list).
// It retires itself once the loop is completed or the user dismisses it.
function renderGettingStarted() {
  var el = document.getElementById('getting-started');
  if (!el) return;

  if (localStorage.getItem('mealPrepStartDone')) {
    el.innerHTML = '';
    el.classList.add('hidden');
    return;
  }

  var hasPlan = plannedMealCount() > 0;
  var hasGrocery = (AppState.groceryList || []).length > 0;

  // Completed the loop — retire the card for good.
  if (hasGrocery) {
    localStorage.setItem('mealPrepStartDone', '1');
    el.innerHTML = '';
    el.classList.add('hidden');
    return;
  }

  el.classList.remove('hidden');
  el.innerHTML =
    '<div class="gs-card">' +
    '<button class="gs-dismiss" onclick="dismissGettingStarted()" aria-label="Dismiss">×</button>' +
    '<div class="gs-title">👋 New here? Two steps to your first grocery list:</div>' +
    '<div class="gs-step ' + (hasPlan ? 'done' : '') + '">' +
    '<span class="gs-num">' + (hasPlan ? '✓' : '1') + '</span>' +
    '<div class="gs-body"><div class="gs-step-title">Plan a meal</div>' +
    '<div class="gs-step-sub">Open the Weekly Planner, tap a day, and add a recipe.</div></div>' +
    (hasPlan ? '' : '<button class="btn btn--primary btn--sm" onclick="goToTab(\'planner\')">Open Planner →</button>') +
    '</div>' +
    '<div class="gs-step">' +
    '<span class="gs-num">2</span>' +
    '<div class="gs-body"><div class="gs-step-title">Get your grocery list</div>' +
    '<div class="gs-step-sub">It builds automatically from your plan — with prices.</div></div>' +
    '<button class="btn btn--secondary btn--sm" onclick="goToTab(\'grocery\')">View List →</button>' +
    '</div>' +
    '</div>';
}

function dismissGettingStarted() {
  localStorage.setItem('mealPrepStartDone', '1');
  renderGettingStarted();
}

function renderRecipes() {
  renderGettingStarted();
  const recipesGrid = document.getElementById('recipes-grid');
  const searchTerm = document.getElementById('recipe-search').value.toLowerCase();
  const categoryFilter = document.getElementById('category-filter').value;
  const preptimeFilter = document.getElementById('preptime-filter').value;

  let filteredRecipes = AppState.recipes.filter(recipe => {
    const matchesSearch = recipe.name.toLowerCase().includes(searchTerm) ||
                         (recipe.instructions || '').toLowerCase().includes(searchTerm);
    const matchesCategory = !categoryFilter || recipe.category === categoryFilter;
    const totalTime = (recipe.basePrepTime || 0) + (recipe.baseCookTime || 0);
    const matchesTime = !preptimeFilter ||
      (preptimeFilter === '999' ? totalTime >= 60 : totalTime < parseInt(preptimeFilter));
    return matchesSearch && matchesCategory && matchesTime;
  });
  
  if (filteredRecipes.length === 0) {
    recipesGrid.innerHTML = AppState.recipes.length > 0
      ? emptyState('search', 'No recipes match', 'Try a different search term or filter.')
      : emptyState('square-pen', 'No recipes yet', 'Tap <b>Add New Recipe</b> to create your first — or <b>Paste Recipe</b> to add one from text you copied.');
    return;
  }

  recipesGrid.innerHTML = filteredRecipes.map(recipe => {
    const totalPrepTime = (recipe.basePrepTime || recipe.prepTime) * recipe.currentServings / recipe.baseServings;
    const totalCookTime = (recipe.baseCookTime || recipe.cookTime) * recipe.currentServings / recipe.baseServings;
    const isScaled = recipe.currentServings !== recipe.baseServings;
    const totalCost = calculateRecipeCost(recipe);
    const costPerServing = totalCost / recipe.currentServings;
    const nutrition = calculateRecipeNutrition(recipe);
    const nutritionPerServing = {
      calories: Math.round(nutrition.calories / recipe.currentServings),
      protein: Math.round(nutrition.protein / recipe.currentServings),
      carbs: Math.round(nutrition.carbs / recipe.currentServings),
      fat: Math.round(nutrition.fat / recipe.currentServings),
      fiber: Math.round(nutrition.fiber / recipe.currentServings),
      sodium: Math.round(nutrition.sodium / recipe.currentServings)
    };
    
    return `
    <div class="recipe-card" onclick="handleRecipeCardClick(event, '${recipe.id}')" title="Click to edit">
      ${recipe.photo ? `
        <div class="recipe-photo">
          <img src="${recipe.photo}" alt="${recipe.name}" class="recipe-image">
        </div>
      ` : `
        <div class="recipe-photo recipe-photo--ph cat-${catSlug(recipe.category)}">
          <span class="recipe-ph-icon">${getCategoryIcon(recipe.category)}</span>
        </div>
      `}
      <div class="recipe-card-header">
        <h3 class="recipe-title">${recipe.name}</h3>
        <span class="recipe-category">${recipe.category}</span>
      </div>
      
      <!-- Serving Size Controls -->
      <div class="serving-controls">
        <button class="serving-btn" onclick="updateServingSize('${recipe.id}', ${recipe.currentServings - 1})"
                ${recipe.currentServings <= 1 ? 'disabled' : ''}>−</button>
        <div class="serving-info">
          <div class="current-servings">${recipe.currentServings} servings</div>
          <div class="base-servings">Base: ${recipe.baseServings}</div>
        </div>
        <button class="serving-btn" onclick="updateServingSize('${recipe.id}', ${recipe.currentServings + 1})">+</button>
        <div class="quick-servings">
          ${[1, 2, 4, 6, 8].map(size => `
            <button class="quick-serving-btn ${recipe.currentServings === size ? 'active' : ''}"
                    onclick="updateServingSize('${recipe.id}', ${size})">${size}</button>
          `).join('')}
        </div>
        ${isScaled ? `<button class="reset-servings" onclick="resetServingSize('${recipe.id}')">Reset</button>` : ''}
      </div>
      
      <div class="prep-time-info">
        <div class="time-item">
          ${icon('clock')}
          <span>Prep: ${Math.round(totalPrepTime)}m</span>
          ${isScaled ? `<span class="time-per-serving">(${recipe.basePrepTime || recipe.prepTime}m base)</span>` : ''}
        </div>
        <div class="time-item">
          ${icon('flame')}
          <span>Cook: ${Math.round(totalCookTime)}m</span>
          ${isScaled ? `<span class="time-per-serving">(${recipe.baseCookTime || recipe.cookTime}m base)</span>` : ''}
        </div>
      </div>

      <div class="recipe-storage">
        <div class="storage-info">${icon('refrigerator')} Fridge: ${recipe.fridgeLife} days</div>
        <div class="storage-info">${icon('snowflake')} Freezer: ${recipe.freezerLife} days</div>
      </div>
      
      <!-- Nutrition Information -->
      <div class="recipe-nutrition">
        <div class="recipe-nutrition-title">Nutrition per serving:</div>
        <div class="nutrition-grid">
          <div class="nutrition-value">
            <span class="nutrition-value-number">${nutritionPerServing.calories}</span>
            <span class="nutrition-value-label">cal</span>
          </div>
          <div class="nutrition-value">
            <span class="nutrition-value-number">${nutritionPerServing.protein}g</span>
            <span class="nutrition-value-label">protein</span>
          </div>
          <div class="nutrition-value">
            <span class="nutrition-value-number">${nutritionPerServing.carbs}g</span>
            <span class="nutrition-value-label">carbs</span>
          </div>
          <div class="nutrition-value">
            <span class="nutrition-value-number">${nutritionPerServing.fat}g</span>
            <span class="nutrition-value-label">fat</span>
          </div>
          <div class="nutrition-value">
            <span class="nutrition-value-number">${nutritionPerServing.fiber}g</span>
            <span class="nutrition-value-label">fiber</span>
          </div>
          <div class="nutrition-value">
            <span class="nutrition-value-number">${nutritionPerServing.sodium}mg</span>
            <span class="nutrition-value-label">sodium</span>
          </div>
        </div>
      </div>
      
      <!-- Cost Information -->
      ${totalCost > 0 ? `
      <div class="recipe-cost-info">
        <div class="recipe-total-cost">Total: ₱${formatQuantity(totalCost)}</div>
        <div class="recipe-cost-per-serving">₱${formatQuantity(costPerServing)} per serving</div>
      </div>
      ` : ''}
      
      <!-- Highlights -->
      ${recipe.highlights ? `
      <div class="recipe-highlights">
        ${recipe.highlights.map(highlight => `<span class="highlight-tag">${highlight}</span>`).join('')}
      </div>
      ` : ''}
      
      <!-- Scaled Ingredients -->
      <div class="recipe-ingredients">
        <h4>Ingredients:</h4>
        <ul>
          ${(recipe.baseIngredients || recipe.ingredients || []).map(ingredient => {
            const scaledQty = calculateScaledQuantity(recipe, ingredient);
            const baseQty = ingredient.baseQuantity || ingredient.quantity;
            
            return `
              <li class="ingredient-quantity">
                ${isScaled ? `
                  <span class="quantity-original">${formatQuantity(baseQty)} ${ingredient.unit}</span>
                  <span class="quantity-scaled">${formatQuantity(scaledQty)} ${ingredient.unit} ${ingredient.name}</span>
                ` : `
                  <span>${formatQuantity(baseQty)} ${ingredient.unit} ${ingredient.name}</span>
                `}
              </li>
            `;
          }).join('')}
        </ul>
      </div>
      
      <p><strong>Instructions:</strong> ${recipe.instructions}</p>
      
      <div class="recipe-actions">
        <button class="btn btn--primary btn--sm" onclick="markRecipeCooked('${recipe.id}')" title="Track this in your fridge/freezer">✓ Cooked</button>
        <button class="btn btn--outline btn--sm" onclick="openEditRecipeModal('${recipe.id}')">Edit</button>
        <button class="btn btn--outline btn--sm" onclick="deleteRecipe('${recipe.id}')">Delete</button>
      </div>
    </div>
  `;
  }).join('');
}

function filterRecipes() {
  renderRecipes();
}

// Weekly planner functions
// Days in fridge assuming Sunday batch cook (Monday = 1 day stored, ..., Sunday = 7)
const DAY_FRIDGE_INDEX = { Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6, Sunday: 7 };

// ── Mobile day navigator ──────────────────────────────────────────────────────
const PLANNER_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const _todayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date().getDay()];
let mobilePlannerDay = Math.max(PLANNER_DAYS.indexOf(_todayName), 0);

function prevPlannerDay() {
  mobilePlannerDay = (mobilePlannerDay + 6) % 7;
  updateMobileDayNav();
}
function nextPlannerDay() {
  mobilePlannerDay = (mobilePlannerDay + 1) % 7;
  updateMobileDayNav();
}
function updateMobileDayNav() {
  const label = document.getElementById('mobile-day-label');
  if (label) label.textContent = PLANNER_DAYS[mobilePlannerDay];
  document.querySelectorAll('.day-column').forEach((col, i) => {
    col.classList.toggle('mobile-active', i === mobilePlannerDay);
  });
}

function willExpire(recipe, day) {
  const fridgeLife = recipe.fridgeLife || recipe.fridgeLife === 0 ? recipe.fridgeLife : 999;
  return fridgeLife < DAY_FRIDGE_INDEX[day];
}

function renderWeeklyPlanner() {
  const plannerGrid = document.getElementById('meal-planner');
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const meals = ['breakfast', 'lunch', 'dinner', 'snacks'];

  plannerGrid.innerHTML = days.map((day, i) => `
    <div class="day-column${i === mobilePlannerDay ? ' mobile-active' : ''}">
      <div class="day-header">
        <span class="day-name">${day}</span>
        <div class="day-actions">
          ${AppState.dayToCopy
            ? (AppState.dayToCopy.from === day
                ? `<button class="day-action-btn" onclick="cancelCopyDay()">Cancel</button>`
                : `<button class="day-action-btn day-action-paste" onclick="pasteDayInto('${day}')">Paste</button>`)
            : `<button class="day-action-btn" onclick="copyDay('${day}')">Copy</button>`}
          <button class="day-action-btn" onclick="clearDay('${day}')">Clear</button>
        </div>
      </div>
      ${meals.map(meal => {
        const mealData = AppState.weeklyPlan[day][meal];
        const hasRecipe = meal === 'snacks' ? mealData.length > 0 : mealData !== null;

        if (hasRecipe) {
          const recipeId = meal === 'snacks' ? mealData[0] : mealData;
          const recipe = AppState.recipes.find(r => String(r.id) === String(recipeId));
          if (recipe) {
            const totalTime = Math.round(((recipe.basePrepTime || recipe.prepTime) + (recipe.baseCookTime || recipe.cookTime)) * recipe.currentServings / recipe.baseServings);
            const expired = willExpire(recipe, day);
            return `
              <div class="meal-slot has-recipe${expired ? ' expiry-warning' : ''}"
                   data-day="${day}"
                   data-meal="${meal}"
                   onclick="openRecipeSelectionModal('${day}', '${meal}')">
                <button class="remove-recipe" onclick="event.stopPropagation(); removeRecipeFromSlot('${day}', '${meal}')">×</button>
                <div class="meal-slot-label">${meal.charAt(0).toUpperCase() + meal.slice(1)}</div>
                <div class="meal-slot-content">
                  <div class="recipe-details">
                    <div class="recipe-name">${recipe.name}${expired ? ' <span class="expiry-badge" title="May expire before this day">' + icon('triangle-alert') + '</span>' : ''}</div>
                    <div class="recipe-meta">${recipe.currentServings} servings • ${totalTime}m</div>
                  </div>
                  <button class="slot-cooked-btn" onclick="event.stopPropagation(); markRecipeCooked('${recipe.id}')" title="I cooked this — add to My Fridge and deduct ingredients">✓ Cooked</button>
                </div>
              </div>`;
          }
        }

        return `
          <div class="meal-slot"
               data-day="${day}"
               data-meal="${meal}"
               onclick="openRecipeSelectionModal('${day}', '${meal}')">
            <div class="meal-slot-label">${meal.charAt(0).toUpperCase() + meal.slice(1)}</div>
            <div class="meal-slot-content">
              <div class="meal-slot-empty">+ Tap to add a recipe</div>
            </div>
          </div>`;
      }).join('')}
    </div>
  `).join('');

  updateMobileDayNav();
  renderStorageAlerts();
}

function renderStorageAlerts() {
  const el = document.getElementById('storage-alerts');
  if (!el) return;

  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const issues = [];

  days.forEach(day => {
    const plan = AppState.weeklyPlan[day];
    const check = id => {
      const recipe = AppState.recipes.find(r => String(r.id) === String(id));
      if (recipe && willExpire(recipe, day)) {
        issues.push(`<strong>${recipe.name}</strong> on ${day} (fridge life: ${recipe.fridgeLife}d, stored ${DAY_FRIDGE_INDEX[day]}d by then)`);
      }
    };
    ['breakfast', 'lunch', 'dinner'].forEach(meal => { if (plan[meal]) check(plan[meal]); });
    (plan.snacks || []).forEach(check);
  });

  if (issues.length === 0) {
    el.innerHTML = '';
    return;
  }

  el.innerHTML = `
    <div class="storage-alert-banner">
      <strong>${icon('triangle-alert')} Storage Alert</strong> — ${issues.length} meal${issues.length > 1 ? 's' : ''} may expire before their planned day (assuming Sunday batch cook):
      <ul class="storage-alert-list">${issues.map(i => `<li>${i}</li>`).join('')}</ul>
    </div>`;
}

function removeRecipeFromSlot(day, meal) {
  if (meal === 'snacks') {
    AppState.weeklyPlan[day][meal] = [];
  } else {
    AppState.weeklyPlan[day][meal] = null;
  }
  
  renderWeeklyPlanner();
  updateWeeklyStats();
  generateGroceryList();
  showSuccessMessage('Recipe removed!');
}

function copyDay(day) {
  AppState.dayToCopy = { from: day, plan: JSON.parse(JSON.stringify(AppState.weeklyPlan[day])) };
  renderWeeklyPlanner(); // re-render so each other day shows a "Paste" button
  showSuccessMessage('Copied ' + day + ' — tap "Paste" on another day.');
}

function clearDay(day) {
  if (confirm(`Are you sure you want to clear all meals for ${day}?`)) {
    AppState.weeklyPlan[day] = { breakfast: null, lunch: null, dinner: null, snacks: [] };
    renderWeeklyPlanner();
    updateWeeklyStats();
    generateGroceryList();
    showSuccessMessage(`${day} cleared!`);
  }
}

function showSuccessMessage(message) {
  const existingMessage = document.querySelector('.success-message');
  if (existingMessage) {
    existingMessage.remove();
  }
  
  const messageEl = document.createElement('div');
  messageEl.className = 'success-message';
  messageEl.textContent = message;
  document.body.appendChild(messageEl);
  
  setTimeout(() => messageEl.classList.add('show'), 100);
  setTimeout(() => {
    messageEl.classList.remove('show');
    setTimeout(() => messageEl.remove(), 300);
  }, 3000);
}

function openRecipeSelectionModal(day, meal) {
  AppState.selectedMealSlot = { day, meal };
  AppState.selectedPlannerDays = [day]; // default: just the day you clicked

  const modal = document.getElementById('recipe-selection-modal');
  const title = document.getElementById('recipe-selection-title');
  const search = document.getElementById('recipe-modal-search');

  title.textContent = `Add to ${meal.charAt(0).toUpperCase() + meal.slice(1)}`;
  if (search) search.value = '';

  renderPlannerDayPicker();
  renderRecipeSelectionGrid();
  modal.classList.remove('hidden');
  if (search) setTimeout(function() { search.focus(); }, 50);
}

// Day chips in the picker: pick which days this recipe will be added to.
function renderPlannerDayPicker() {
  var el = document.getElementById('recipe-selection-days');
  if (!el) return;
  var sel = AppState.selectedPlannerDays || [];
  var allOn = sel.length === PLANNER_DAYS.length;
  var html = '<span class="planner-day-picker-label">Add to:</span>';
  PLANNER_DAYS.forEach(function(d) {
    var on = sel.indexOf(d) >= 0;
    html += '<button type="button" class="planner-day-chip' + (on ? ' active' : '') +
            '" onclick="togglePlannerDay(\'' + d + '\')">' + d.slice(0, 3) + '</button>';
  });
  html += '<button type="button" class="planner-day-chip planner-day-all' + (allOn ? ' active' : '') +
          '" onclick="toggleAllPlannerDays()">All week</button>';
  el.innerHTML = html;
}

function togglePlannerDay(day) {
  var sel = AppState.selectedPlannerDays || [];
  var i = sel.indexOf(day);
  if (i >= 0) {
    if (sel.length > 1) sel.splice(i, 1); // keep at least one day selected
  } else {
    sel.push(day);
  }
  AppState.selectedPlannerDays = sel;
  renderPlannerDayPicker();
}

function toggleAllPlannerDays() {
  var sel = AppState.selectedPlannerDays || [];
  if (sel.length === PLANNER_DAYS.length) {
    AppState.selectedPlannerDays = [AppState.selectedMealSlot.day];
  } else {
    AppState.selectedPlannerDays = PLANNER_DAYS.slice();
  }
  renderPlannerDayPicker();
}

function recipeSelectionCard(recipe) {
  const totalTime = Math.round(((recipe.basePrepTime || recipe.prepTime) + (recipe.baseCookTime || recipe.cookTime)) * recipe.currentServings / recipe.baseServings);
  const costPerServing = calculateRecipeCost(recipe) / recipe.currentServings;
  return `
    <div class="recipe-selection-card" onclick="selectRecipeForPlanning('${recipe.id}')">
      <div class="recipe-icon">${getCategoryIcon(recipe.category)}</div>
      <div class="recipe-title">${recipe.name}</div>
      <div class="recipe-meta">${recipe.category}</div>
      <div class="recipe-stats">
        <span>${recipe.currentServings} servings</span>
        <span>${totalTime}m</span>
        ${costPerServing > 0 ? `<span>₱${formatQuantity(costPerServing)}</span>` : ''}
      </div>
    </div>`;
}

function renderRecipeSelectionGrid() {
  const grid = document.getElementById('recipe-selection-grid');
  const searchTerm = document.getElementById('recipe-modal-search').value.toLowerCase();

  const filtered = AppState.recipes.filter(recipe =>
    recipe.name.toLowerCase().includes(searchTerm) ||
    recipe.category.toLowerCase().includes(searchTerm)
  );

  let html = '';

  // Recently-used recipes pinned at the top for one-tap adding (only when not searching).
  if (!searchTerm) {
    const recents = (AppState.recentRecipes || [])
      .map(id => AppState.recipes.find(r => String(r.id) === String(id)))
      .filter(Boolean)
      .slice(0, 6);
    if (recents.length) {
      html += '<div class="recipe-selection-group-label">' + icon('star') + ' Recent</div>';
      html += recents.map(recipeSelectionCard).join('');
      html += '<div class="recipe-selection-group-label">All recipes</div>';
    }
  }

  if (filtered.length === 0 && !html) {
    grid.innerHTML = '<p style="text-align: center; color: var(--color-text-secondary);">No recipes found. Try a different search term.</p>';
    return;
  }

  html += filtered.map(recipeSelectionCard).join('');
  grid.innerHTML = html;
}

function getCategoryIcon(category) {
  const icons = {
    'Breakfast': '🥞',
    'Main Dish': '🍽️',
    'Snack': '🥜',
    'Dessert': '🍰',
    'Soup': '🍲',
    'Salad': '🥗'
  };
  return icons[category] || '🍴';
}

// Category → CSS-safe slug for the colored recipe-cover gradients.
function catSlug(category) {
  return String(category || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function selectRecipeForPlanning(recipeId) {
  if (!AppState.selectedMealSlot) {
    showSuccessMessage('Please select a meal slot first.');
    return;
  }

  const { day, meal } = AppState.selectedMealSlot;
  const recipe = AppState.recipes.find(r => String(r.id) === String(recipeId));
  const days = (AppState.selectedPlannerDays && AppState.selectedPlannerDays.length)
    ? AppState.selectedPlannerDays : [day];

  // Assign to every selected day for this meal.
  days.forEach(function(d) {
    if (meal === 'snacks') {
      if (!AppState.weeklyPlan[d][meal].includes(recipeId)) {
        AppState.weeklyPlan[d][meal].push(recipeId);
      }
    } else {
      AppState.weeklyPlan[d][meal] = recipeId;
    }
  });

  recordRecentRecipe(recipeId);

  document.getElementById('recipe-selection-modal').classList.add('hidden');
  renderWeeklyPlanner();
  updateWeeklyStats();
  saveData();
  generateGroceryList();

  const where = days.length === 1 ? days[0]
    : (days.length === 7 ? 'every day' : days.length + ' days');
  showSuccessMessage(`${recipe ? recipe.name : 'Recipe'} added to ${meal} (${where})!`);

  AppState.selectedMealSlot = null;
  AppState.selectedPlannerDays = [];
}

function getRecipeName(recipeId) {
  const recipe = AppState.recipes.find(r => String(r.id) === String(recipeId));
  return recipe ? recipe.name : 'Unknown Recipe';
}

function clearWeeklyPlan() {
  if (confirm('Are you sure you want to clear the entire weekly plan?')) {
    Object.keys(AppState.weeklyPlan).forEach(day => {
      AppState.weeklyPlan[day] = { breakfast: null, lunch: null, dinner: null, snacks: [] };
    });
    renderWeeklyPlanner();
    updateWeeklyStats();
    generateGroceryList();
  }
}

function updateWeeklyStats() {
  let totalPrepTime = 0;
  let totalCookTime = 0;
  let plannedMeals = 0;
  
  Object.keys(AppState.weeklyPlan).forEach(day => {
    Object.keys(AppState.weeklyPlan[day]).forEach(meal => {
      const mealData = AppState.weeklyPlan[day][meal];
      
      if (meal === 'snacks') {
        mealData.forEach(recipeId => {
          const recipe = AppState.recipes.find(r => String(r.id) === String(recipeId));
          if (recipe) {
            const scale = recipe.currentServings / recipe.baseServings;
            totalPrepTime += (recipe.basePrepTime || recipe.prepTime) * scale;
            totalCookTime += (recipe.baseCookTime || recipe.cookTime) * scale;
            plannedMeals++;
          }
        });
      } else if (mealData) {
        const recipe = AppState.recipes.find(r => String(r.id) === String(mealData));
        if (recipe) {
          const scale = recipe.currentServings / recipe.baseServings;
          totalPrepTime += (recipe.basePrepTime || recipe.prepTime) * scale;
          totalCookTime += (recipe.baseCookTime || recipe.cookTime) * scale;
          plannedMeals++;
        }
      }
    });
  });
  
  document.getElementById('total-prep-time').textContent = `${Math.round(totalPrepTime)} min`;
  document.getElementById('total-cook-time').textContent = `${Math.round(totalCookTime)} min`;
  document.getElementById('planned-meals').textContent = plannedMeals;
}

// Grocery list functions
function generateGroceryList() {
  const ingredients = {};
  
  // Collect all ingredients from planned meals
  Object.keys(AppState.weeklyPlan).forEach(day => {
    Object.keys(AppState.weeklyPlan[day]).forEach(meal => {
      const mealData = AppState.weeklyPlan[day][meal];
      
      if (meal === 'snacks') {
        mealData.forEach(recipeId => {
          addRecipeIngredients(recipeId, ingredients);
        });
      } else if (mealData) {
        addRecipeIngredients(mealData, ingredients);
      }
    });
  });
  
  // Convert to grocery list format. Keep manually-added custom items — only the
  // meal-plan-generated items are rebuilt from the weekly plan.
  AppState.groceryList = AppState.groceryList.filter(item => item.custom);
  Object.keys(ingredients).forEach(category => {
    Object.keys(ingredients[category]).forEach(name => {
      const item = ingredients[category][name];
      AppState.groceryList.push({
        id: Date.now() + Math.random(),
        category,
        name,
        quantity: item.quantity,
        unit: item.unit,
        sources: item.sources || [],
        checked: false
      });
    });
  });
  
  renderGroceryList();
}

function addRecipeIngredients(recipeId, ingredients) {
  const recipe = AppState.recipes.find(r => String(r.id) === String(recipeId));
  if (!recipe) return;
  
  const recipeIngredients = recipe.baseIngredients || recipe.ingredients;
  recipeIngredients.forEach(ingredient => {
    const category = ingredient.category;
    const name = ingredient.name;
    const scaledQty = calculateScaledQuantity(recipe, ingredient);
    
    if (!ingredients[category]) {
      ingredients[category] = {};
    }
    
    if (!ingredients[category][name]) {
      ingredients[category][name] = {
        quantity: 0,
        unit: ingredient.unit,
        sources: []
      };
    }
    
    ingredients[category][name].quantity += scaledQty;
    ingredients[category][name].sources.push(`${recipe.name} (${recipe.currentServings} servings)`);
  });
}

// Collapses repeated source strings into "Name ×N" so an ingredient used on
// several days reads "Pork Ginataan (4 servings) ×4" instead of repeating it.
function summarizeSources(sources) {
  var counts = {};
  (sources || []).forEach(function(s) { counts[s] = (counts[s] || 0) + 1; });
  return Object.keys(counts).map(function(s) {
    return counts[s] > 1 ? s + ' ×' + counts[s] : s;
  }).join(', ');
}

function renderGroceryList() {
  const groceryListEl = document.getElementById('grocery-list');

  // The summary (meal count + cost) reflects the weekly plan, so hide it when
  // the list itself is empty/cleared — otherwise stale numbers linger.
  const summaryEl = document.querySelector('.grocery-summary');
  const isEmpty = AppState.groceryList.length === 0;
  if (summaryEl) summaryEl.style.display = isEmpty ? 'none' : '';

  if (isEmpty) {
    groceryListEl.innerHTML = emptyState('shopping-cart', 'Your grocery list is empty', 'Plan meals in the <b>Weekly Planner</b> — your shopping list builds itself from what you planned.');
    return;
  }
  
  // Group by category
  const categories = {};
  AppState.groceryList.forEach(item => {
    if (!categories[item.category]) {
      categories[item.category] = [];
    }
    categories[item.category].push(item);
  });

  // Within each category, sink checked / already-in-stock items to the bottom so
  // what you still need to buy stays on top.
  const groceryDone = item => item.checked || (!item.fromStaple && isInPantry(item.name));
  Object.keys(categories).forEach(cat => {
    categories[cat].sort((a, b) => (groceryDone(a) ? 1 : 0) - (groceryDone(b) ? 1 : 0));
  });

  groceryListEl.innerHTML = Object.keys(categories).map(category => {
    const categoryTotal = categories[category].reduce((total, item) => total + groceryItemCost(item), 0);

    return `
    <div class="grocery-category">
      <h3 class="category-header">${category}${categoryTotal > 0 ? ` <span class="category-total">≈ ₱${formatQuantity(categoryTotal)}</span>` : ''}</h3>
      ${categories[category].map(item => {
        // Show an exact line total when we can price it; otherwise fall back to
        // the market reference price (e.g. "₱200/kg") so there's always a price.
        const cost = groceryItemCost(item);
        const priced = findIngredientPrice(item.name);
        let priceHtml = '';
        if (cost > 0) priceHtml = `<div class="ingredient-price">≈ ₱${formatQuantity(cost)}</div>`;
        else if (priced && priced.priceLabel) priceHtml = `<div class="ingredient-price ingredient-price--ref">${priced.priceLabel}</div>`;

        // "Running low" staples are in the pantry by definition — don't let the
        // in-stock check hide them; the whole point is that you need to rebuy.
        const inPantry = item.fromStaple ? false : isInPantry(item.name);
        const isChecked = item.checked || inPantry;
        return `
        <div class="grocery-item ${isChecked ? 'checked' : ''} ${inPantry ? 'in-pantry' : ''}" role="button" tabindex="0" aria-pressed="${isChecked}" aria-label="${escapeHtml(item.name)}" onclick="toggleGroceryItem(${item.id})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleGroceryItem(${item.id})}">
          <input type="checkbox" class="grocery-checkbox" tabindex="-1" aria-hidden="true"
                 ${isChecked ? 'checked' : ''}>
          <div class="grocery-item-info">
            <div class="grocery-item-name">
              ${item.quantity ? formatQuantity(item.quantity) + ' ' + item.unit + ' ' : ''}${item.name}
              ${inPantry ? '<span class="pantry-badge">' + icon('house') + ' In stock</span>' : ''}
            </div>
            ${item.sources && item.sources.length > 0 ? `
              <div class="grocery-item-source">From: ${summarizeSources(item.sources)}</div>
            ` : ''}
            ${priceHtml}
          </div>
        </div>
        `;
      }).join('')}
    </div>
    `;
  }).join('');
  
  updateBudgetDisplay();
}

function toggleGroceryItem(itemId) {
  const item = AppState.groceryList.find(i => i.id === itemId);
  if (item) {
    item.checked = !item.checked;
    renderGroceryList();
  }
}

function clearGroceryList() {
  if (confirm('Are you sure you want to clear the grocery list?')) {
    AppState.groceryList = [];
    renderGroceryList();
  }
}

function addCustomGroceryItem() {
  document.getElementById('custom-item-name').value = '';
  document.getElementById('custom-item-qty').value = '1';
  document.getElementById('custom-item-unit').value = '';
  document.getElementById('custom-item-category').value = 'Other';
  document.getElementById('custom-item-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('custom-item-name').focus(), 50);
}

function closeCustomItemModal() {
  document.getElementById('custom-item-modal').classList.add('hidden');
}

function confirmCustomGroceryItem() {
  const name = document.getElementById('custom-item-name').value.trim();
  if (!name) { document.getElementById('custom-item-name').focus(); return; }

  const quantity = parseFloat(document.getElementById('custom-item-qty').value);
  if (isNaN(quantity) || quantity <= 0) return;

  const unit = document.getElementById('custom-item-unit').value.trim() || 'pcs';
  const category = document.getElementById('custom-item-category').value;

  AppState.groceryList.push({
    id: Date.now() + Math.random(),
    category,
    name,
    quantity,
    unit,
    checked: false,
    custom: true   // manually added — must survive grocery-list regeneration
  });

  saveData();
  closeCustomItemModal();
  renderGroceryList();
}

function updateGrocerySummary() {
  const plannedMealsCount = Object.keys(AppState.weeklyPlan).reduce((count, day) => {
    return count + Object.keys(AppState.weeklyPlan[day]).reduce((dayCount, meal) => {
      const mealData = AppState.weeklyPlan[day][meal];
      if (meal === 'snacks') {
        return dayCount + mealData.length;
      } else {
        return dayCount + (mealData ? 1 : 0);
      }
    }, 0);
  }, 0);
  
  document.getElementById('selected-meals-count').textContent = plannedMealsCount;
}

// Storage guide functions
function renderStorageGuide() {
  const storageGuideEl = document.getElementById('storage-guide');
  const searchTerm = document.getElementById('storage-search').value.toLowerCase();
  const categoryFilter = document.getElementById('storage-category-filter').value;
  
  let filteredIngredients = AppState.customIngredients.filter(ingredient => {
    const matchesSearch = ingredient.name.toLowerCase().includes(searchTerm) || 
                         ingredient.storageMethod.toLowerCase().includes(searchTerm) ||
                         ingredient.storageTips.toLowerCase().includes(searchTerm);
    const matchesCategory = !categoryFilter || ingredient.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });
  
  storageGuideEl.innerHTML = filteredIngredients.map(ingredient => {
    const indicatorClass = getStorageIndicatorClass(ingredient.fridgeLife);
    
    return `
      <div class="storage-ingredient-card" onclick="handleCardEdit(event, openEditIngredientModal, ${ingredient.id})" title="Click to edit">
        <div class="ingredient-header">
          <h4 class="ingredient-name">${ingredient.name}</h4>
          <span class="storage-indicator ${indicatorClass}"></span>
        </div>
        
        <!-- Pricing Information -->
        ${ingredient.pricePerUnit ? `
        <div class="ingredient-pricing">
          <strong>Price:</strong> ₱${ingredient.pricePerUnit} ${ingredient.unit}
        </div>
        ` : ''}
        
        <!-- Nutrition Information -->
        ${ingredient.calories ? `
        <div class="ingredient-nutrition">
          <strong>Nutrition (per 100g):</strong>
          <div class="ingredient-nutrition-grid">
            <div class="ingredient-nutrition-item">
              <span class="ingredient-nutrition-value">${ingredient.calories}</span>
              <span class="ingredient-nutrition-label">cal</span>
            </div>
            <div class="ingredient-nutrition-item">
              <span class="ingredient-nutrition-value">${ingredient.protein}g</span>
              <span class="ingredient-nutrition-label">protein</span>
            </div>
            <div class="ingredient-nutrition-item">
              <span class="ingredient-nutrition-value">${ingredient.carbs}g</span>
              <span class="ingredient-nutrition-label">carbs</span>
            </div>
            <div class="ingredient-nutrition-item">
              <span class="ingredient-nutrition-value">${ingredient.fat}g</span>
              <span class="ingredient-nutrition-label">fat</span>
            </div>
            <div class="ingredient-nutrition-item">
              <span class="ingredient-nutrition-value">${ingredient.fiber}g</span>
              <span class="ingredient-nutrition-label">fiber</span>
            </div>
            <div class="ingredient-nutrition-item">
              <span class="ingredient-nutrition-value">${ingredient.sodium}mg</span>
              <span class="ingredient-nutrition-label">sodium</span>
            </div>
          </div>
        </div>
        ` : ''}
        
        <div class="storage-duration">
          <div class="duration-item">
            ${icon('refrigerator')} Fridge: ${ingredient.fridgeLife} day${ingredient.fridgeLife !== 1 ? 's' : ''}
          </div>
          <div class="duration-item">
            ${icon('snowflake')} Freezer: ${ingredient.freezerLife} day${ingredient.freezerLife !== 1 ? 's' : ''}
          </div>
        </div>
        
        <div class="storage-method">
          <strong>Storage:</strong> ${ingredient.storageMethod}
        </div>
        
        <div class="storage-tips">
          <strong>Tips:</strong> ${ingredient.storageTips}
        </div>
        
        <div class="storage-actions">
          <button class="btn btn--outline btn--sm edit-ingredient-btn" onclick="openEditIngredientModal(${ingredient.id})">Edit</button>
          <button class="btn btn--sm delete-ingredient-btn" onclick="deleteIngredient(${ingredient.id})">Delete</button>
        </div>
      </div>
    `;
  }).join('');
  
  if (filteredIngredients.length === 0) {
    storageGuideEl.innerHTML = AppState.customIngredients.length > 0
      ? '<p style="text-align:center;color:var(--color-text-secondary);">No ingredients match your search.</p>'
      : emptyState('book-open', 'No storage tips yet', 'Tap <b>Import from Recipes</b> to pull in the ingredients you use, or <b>Add Ingredient</b> to add storage notes manually.');
  }
}

function filterStorageGuide() {
  renderStorageGuide();
}

// Cooking hacks functions
function renderCookingHacks() {
  const hacksContainer = document.getElementById('cooking-hacks');
  const categoryFilter = document.getElementById('hack-category-filter').value;
  
  let filteredHacks = AppState.customHacks;
  if (categoryFilter) {
    filteredHacks = AppState.customHacks.filter(hack => hack.category === categoryFilter);
  }
  
  // Group by category
  const categories = {};
  filteredHacks.forEach(hack => {
    if (!categories[hack.category]) {
      categories[hack.category] = [];
    }
    categories[hack.category].push(hack);
  });
  
  hacksContainer.innerHTML = Object.keys(categories).map(category => {
    const hacks = categories[category];
    
    return `
      <div class="hack-category">
        <h3 class="hack-category-title">${getHackIcon(category)} ${category}</h3>
        <div class="hack-tips">
          ${hacks.map(hack => `
            <div class="hack-item" onclick="handleCardEdit(event, openEditHackModal, ${hack.id})" title="Click to edit">
              <div class="hack-item-header">
                <h4 class="hack-item-title">${hack.title}</h4>
                <div class="hack-actions">
                  <button class="hack-edit-btn" onclick="openEditHackModal(${hack.id})">Edit</button>
                  <button class="hack-delete-btn" onclick="deleteHack(${hack.id})">Delete</button>
                </div>
              </div>
              <div class="hack-item-content">${hack.description}</div>
              <div class="hack-benefits">
                ${hack.timeSaved ? `<div class="hack-benefit">${icon('timer')} Saves: ${hack.timeSaved}</div>` : ''}
                ${hack.costSavings ? `<div class="hack-benefit">${icon('piggy-bank')} Saves: ${hack.costSavings}</div>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }).join('');
  
  if (Object.keys(categories).length === 0) {
    hacksContainer.innerHTML = '<p>No cooking hacks found. Add your first hack!</p>';
  }
}

function getHackIcon(category) {
  const icons = {
    'Batch Cooking': '🍱',
    'Storage': '🏪',
    'Budget': '💰',
    'Equipment': '⚡',
    'Time-Saving': '⏱️',
    'Safety': '🛡️'
  };
  return icons[category] || '📝';
}

function filterCookingHacks() {
  renderCookingHacks();
}

// Cost calculation functions
function calculateRecipeCost(recipe) {
  if (recipe.estimatedCost) {
    return recipe.estimatedCost * recipe.currentServings / recipe.baseServings;
  }
  
  if (!recipe.baseIngredients) return 0;
  
  return recipe.baseIngredients.reduce((total, ingredient) => {
    const scaledQty = calculateScaledQuantity(recipe, ingredient);
    const price = ingredient.pricePerUnit || 0;
    return total + (price * scaledQty / (ingredient.baseQuantity || ingredient.quantity));
  }, 0);
}

function calculateGroceryTotal() {
  return AppState.groceryList.reduce((total, item) => total + groceryItemCost(item), 0);
}

function findIngredientPrice(name) {
  // 0. Your own store prices (Ingredients tab) win over every estimate.
  const userPrice = findUserStorePrice(name);
  if (userPrice) return userPrice;

  // First check custom ingredients data
  const storageItem = AppState.customIngredients.find(item =>
    item.name.toLowerCase().includes(name.toLowerCase()) || 
    name.toLowerCase().includes(item.name.toLowerCase())
  );
  if (storageItem && storageItem.pricePerUnit) {
    return storageItem;
  }
  
  // Then check recipe ingredients for pricing
  for (const recipe of AppState.recipes) {
    if (recipe.baseIngredients) {
      const ingredient = recipe.baseIngredients.find(ing =>
        ing.name.toLowerCase().includes(name.toLowerCase()) ||
        name.toLowerCase().includes(ing.name.toLowerCase())
      );
      if (ingredient && ingredient.pricePerUnit) {
        return ingredient;
      }
    }
  }

  // Finally, the built-in ingredient database (prices stored as "₱200/kg").
  const q = priceNameKey(name);
  const dbItem = q && INGREDIENT_DB.find(it => ingredientNameMatches(q, it.name));
  if (dbItem) {
    const parsed = parseDbPrice(dbItem.price);
    if (parsed) {
      return { name: dbItem.name, pricePerUnit: parsed.amount, unit: parsed.unit, priceLabel: dbItem.price };
    }
  }

  return null;
}

// Your own per-store prices from the Ingredients tab. These OVERRIDE the built-in
// estimates — we average the stores you filled in for that ingredient.
function findUserStorePrice(name) {
  const up = AppState.ingredientPrices || {};
  const q = priceNameKey(name);
  if (!q) return null;
  const matchKey = Object.keys(up).find(k => ingredientNameMatches(q, k));
  if (!matchKey) return null;
  const entry = up[matchKey] || {};
  const vals = Object.values(entry.prices || {})
    .map(v => parseFloat(v)).filter(v => !isNaN(v) && v > 0);
  if (!vals.length) return null;
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const unit = String(entry.unit || '').toLowerCase();
  return {
    name: matchKey,
    pricePerUnit: avg,
    unit: unit,
    priceLabel: '₱' + Math.round(avg) + (unit ? '/' + unit : '') + ' (your price)',
    userPrice: true
  };
}

// Normalized key for price matching: keep the words inside "(...)" (so the
// Filipino name in "Chayote (Sayote)" is still matchable), drop punctuation.
function priceNameKey(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[()]/g, ' ')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Do a query key and a candidate name refer to the same ingredient? Exact,
// substring, or shared significant word (singularized so Carrots ~ Carrot).
function ingredientNameMatches(queryKey, candidateName) {
  const n = priceNameKey(candidateName);
  if (!queryKey || !n) return false;
  if (n === queryKey || n.includes(queryKey) || queryKey.includes(n)) return true;
  const singular = w => (w.length > 3 && w.endsWith('s')) ? w.slice(0, -1) : w;
  const qWords = queryKey.split(' ').map(singular);
  const nWords = n.split(' ').map(singular);
  return qWords.some(w => w.length >= 4 && nWords.includes(w));
}

// Parse a DB price string like "₱200/kg" or "₱80/100g" into { amount, unit }.
function parseDbPrice(str) {
  if (!str) return null;
  const m = String(str).match(/([\d.,]+)\s*\/\s*(.+)/);
  if (!m) return null;
  const amount = parseFloat(m[1].replace(/,/g, ''));
  if (isNaN(amount)) return null;
  return { amount: amount, unit: m[2].trim().toLowerCase() };
}

// How many price-units fit in one item-unit (mass/volume aware). Returns null
// when the units can't be converted (e.g. "piece" vs "kg") so we don't guess.
function unitConvertFactor(itemUnit, priceUnit) {
  if (itemUnit === priceUnit) return 1;
  const MASS = { g: 1, gram: 1, grams: 1, kg: 1000, kilo: 1000, kilos: 1000 };
  const VOL = { ml: 1, l: 1000, liter: 1000, litre: 1000, liters: 1000 };
  if (MASS[itemUnit] && MASS[priceUnit]) return MASS[itemUnit] / MASS[priceUnit];
  if (VOL[itemUnit] && VOL[priceUnit]) return VOL[itemUnit] / VOL[priceUnit];
  return null;
}

// Estimated cost of a grocery line, or 0 when it can't be priced reliably
// (unknown ingredient, no quantity, or incompatible units).
function groceryItemCost(item) {
  if (!item || !item.quantity) return 0;
  const ing = findIngredientPrice(item.name);
  if (!ing || !ing.pricePerUnit) return 0;
  const itemUnit = String(item.unit || ing.unit || '').toLowerCase();
  const priceUnit = String(ing.unit || '').toLowerCase();
  const factor = unitConvertFactor(itemUnit, priceUnit);
  if (factor == null) return 0;
  return ing.pricePerUnit * item.quantity * factor;
}

function getUnitConversion(fromUnit, toUnit) {
  // Simple unit conversion - in practice this would be more comprehensive
  if (fromUnit === toUnit) return 1;
  
  const conversions = {
    'cup': 240,
    'tbsp': 15,
    'tsp': 5,
    'ml': 1,
    'g': 1,
    'kg': 1000,
    'kilo': 1000
  };
  
  const fromFactor = conversions[fromUnit.toLowerCase()] || 1;
  const toFactor = conversions[toUnit.toLowerCase()] || 1;
  
  return fromFactor / toFactor;
}

// Budget display removed - only keep individual item pricing
function updateBudgetDisplay() {
  renderWeeklyCostSummary();
}

function renderWeeklyCostSummary() {
  const el = document.getElementById('weekly-cost-summary');
  if (!el) return;

  let totalCost = 0;
  let mealCount = 0;

  Object.values(AppState.weeklyPlan).forEach(day => {
    ['breakfast', 'lunch', 'dinner'].forEach(meal => {
      if (day[meal]) {
        const recipe = AppState.recipes.find(r => String(r.id) === String(day[meal]));
        if (recipe) { totalCost += calculateRecipeCost(recipe); mealCount++; }
      }
    });
    (day.snacks || []).forEach(id => {
      const recipe = AppState.recipes.find(r => String(r.id) === String(id));
      if (recipe) { totalCost += calculateRecipeCost(recipe); mealCount++; }
    });
  });

  if (totalCost === 0) { el.innerHTML = ''; return; }

  const perMeal = mealCount > 0 ? totalCost / mealCount : 0;

  el.innerHTML = `
    <div class="cost-summary-bar">
      <div class="cost-summary-card">
        <span class="cost-summary-label">Week Total</span>
        <span class="cost-summary-value">₱${Math.round(totalCost).toLocaleString()}</span>
      </div>
      <div class="cost-summary-card">
        <span class="cost-summary-label">Avg per Meal</span>
        <span class="cost-summary-value">₱${Math.round(perMeal).toLocaleString()}</span>
      </div>
      <div class="cost-summary-card">
        <span class="cost-summary-label">Meals Planned</span>
        <span class="cost-summary-value">${mealCount}</span>
      </div>
    </div>`;
}

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', initApp);

// Nutrition tracking functions
function calculateRecipeNutrition(recipe) {
  if (recipe.nutritionPerServing && recipe.nutritionPerServing.calories > 0) {
    // If recipe already has nutrition data, scale it
    const scale = recipe.currentServings / recipe.baseServings;
    return {
      calories: recipe.nutritionPerServing.calories * recipe.currentServings,
      protein: recipe.nutritionPerServing.protein * recipe.currentServings,
      carbs: recipe.nutritionPerServing.carbs * recipe.currentServings,
      fat: recipe.nutritionPerServing.fat * recipe.currentServings,
      fiber: recipe.nutritionPerServing.fiber * recipe.currentServings,
      sodium: recipe.nutritionPerServing.sodium * recipe.currentServings
    };
  }
  
  // Calculate from ingredients
  const ingredients = recipe.baseIngredients || recipe.ingredients || [];
  return ingredients.reduce((total, ingredient) => {
    const scaledQty = calculateScaledQuantity(recipe, ingredient);
    
    // Find nutrition data for this ingredient
    const nutritionData = findIngredientNutrition(ingredient.name);
    if (nutritionData) {
      const factor = toGrams(scaledQty, ingredient.unit) / 100; // Nutrition data is per 100g
      total.calories += (nutritionData.calories || 0) * factor;
      total.protein += (nutritionData.protein || 0) * factor;
      total.carbs += (nutritionData.carbs || 0) * factor;
      total.fat += (nutritionData.fat || 0) * factor;
      total.fiber += (nutritionData.fiber || 0) * factor;
      total.sodium += (nutritionData.sodium || 0) * factor;
    }
    
    return total;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0 });
}

function toGrams(quantity, unit) {
  var u = (unit || 'g').toLowerCase().trim();
  var factors = {
    'g': 1, 'kg': 1000, 'ml': 1, 'l': 1000,
    'tbsp': 15, 'tsp': 5, 'cup': 240, 'cups': 240,
    'oz': 28.35, 'lbs': 453.6, 'lb': 453.6,
    'pieces': 100, 'piece': 100, 'cloves': 5,
    'can': 400, 'pack': 200, 'stalks': 50, 'bunches': 150, 'bunch': 150,
    'inches': 25, 'slices': 30, 'slice': 30, 'heads': 200, 'head': 200
  };
  return quantity * (factors[u] !== undefined ? factors[u] : 1);
}

function normalizeIngredientName(name) {
  return name.toLowerCase()
    .replace(/\([^)]*\)/g, '')        // strip "(bone-in pieces)", "(optional)", etc.
    .replace(/\s+or\s+.*/i, '')       // strip "or sayote", "or chicken broth"
    .replace(/\b(bone-in|boneless|fresh|dried|sliced|diced|chopped|minced|small|medium|large|thumb-sized|instant|whole|raw|cooked)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findIngredientNutrition(name) {
  var n = name.toLowerCase().trim();
  var normalized = normalizeIngredientName(name);

  function matchTerm(iname, term) {
    return iname.includes(term) || term.includes(iname);
  }

  // 1. User's own custom ingredients (most specific)
  var userIng = (AppState.userIngredients || []).find(function(ing) {
    var iname = ing.name.toLowerCase();
    return matchTerm(iname, n) || matchTerm(iname, normalized);
  });
  if (userIng && userIng.calories != null) return userIng;

  // 2. Storage guide custom ingredients (legacy, rarely has nutrition)
  var custom = AppState.customIngredients.find(function(ing) {
    var iname = ing.name.toLowerCase();
    return matchTerm(iname, n) || matchTerm(iname, normalized);
  });
  if (custom && custom.calories) return custom;

  // 3. Built-in LOCAL_NUTRITION_DB (try original, normalized, first keyword)
  function searchDB(term) {
    if (!term) return null;
    return LOCAL_NUTRITION_DB.find(function(item) {
      var iname = item.name.toLowerCase();
      return iname.includes(term) || term.includes(iname);
    }) || null;
  }
  return searchDB(n)
    || searchDB(normalized)
    || searchDB(normalized.split(/\s+/)[0])
    || null;
}

function openNutritionGoalsModal() {
  // Populate form with current goals
  document.getElementById('goal-calories').value = AppState.nutritionGoals.calories;
  document.getElementById('goal-protein').value = AppState.nutritionGoals.protein;
  document.getElementById('goal-carbs').value = AppState.nutritionGoals.carbs;
  document.getElementById('goal-fat').value = AppState.nutritionGoals.fat;
  document.getElementById('goal-fiber').value = AppState.nutritionGoals.fiber;
  document.getElementById('goal-sodium').value = AppState.nutritionGoals.sodium;
  
  document.getElementById('nutrition-goals-modal').classList.remove('hidden');
}

function closeNutritionGoalsModal() {
  document.getElementById('nutrition-goals-modal').classList.add('hidden');
}

function saveNutritionGoals(e) {
  e.preventDefault();
  
  AppState.nutritionGoals = {
    calories: parseInt(document.getElementById('goal-calories').value),
    protein: parseInt(document.getElementById('goal-protein').value),
    carbs: parseInt(document.getElementById('goal-carbs').value),
    fat: parseInt(document.getElementById('goal-fat').value),
    fiber: parseInt(document.getElementById('goal-fiber').value),
    sodium: parseInt(document.getElementById('goal-sodium').value)
  };
  
  updateNutritionGoalsDisplay();
  closeNutritionGoalsModal();
  saveData();
}

function updateNutritionGoalsDisplay() {
  document.getElementById('daily-calories-goal').textContent = AppState.nutritionGoals.calories;
  document.getElementById('daily-protein-goal').textContent = AppState.nutritionGoals.protein;
  document.getElementById('daily-carbs-goal').textContent = AppState.nutritionGoals.carbs;
  document.getElementById('daily-fat-goal').textContent = AppState.nutritionGoals.fat;
}

function renderNutritionTab() {
  renderWeeklyNutritionChart();
  renderDailyNutritionBreakdown();
  filterRecipesByNutrition();
}

function openMissingNutritionHelp() {
  alert('To add nutrition to a recipe:\n1. Click "📊 Set Nutrition" on any recipe card, OR go to My Recipes and click Edit.\n2. In the recipe form, use the "🔍 Look up nutrition data" search box (USDA Food Database).\n3. Search for your main ingredient, click a result to fill in the values, then save the recipe.');
}

function calculateDayNutrition(dayPlan) {
  const totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  const addRecipe = id => {
    const recipe = AppState.recipes.find(r => String(r.id) === String(id));
    if (!recipe) return;
    const n = calculateRecipeNutrition(recipe);
    totals.calories += n.calories;
    totals.protein  += n.protein;
    totals.carbs    += n.carbs;
    totals.fat      += n.fat;
  };
  ['breakfast', 'lunch', 'dinner'].forEach(meal => { if (dayPlan[meal]) addRecipe(dayPlan[meal]); });
  (dayPlan.snacks || []).forEach(addRecipe);
  return totals;
}

function renderDailyNutritionBreakdown() {
  const el = document.getElementById('daily-nutrition-breakdown');
  if (!el) return;

  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const goalCal = AppState.nutritionGoals.calories || 2000;

  const rows = days.map(day => {
    const n = calculateDayNutrition(AppState.weeklyPlan[day]);
    const isEmpty = n.calories === 0 && n.protein === 0;
    const pct = Math.min(Math.round((n.calories / goalCal) * 100), 100);
    const over = n.calories > goalCal * 1.15;
    const low  = n.calories < goalCal * 0.5 && !isEmpty;
    const barColor = over ? '#e74c3c' : low ? '#f39c12' : '#21808D';

    return `
      <div class="day-nutrition-row">
        <div class="day-nutrition-label">${day.slice(0, 3)}</div>
        <div class="day-nutrition-bar-wrap">
          <div class="day-nutrition-bar" style="width:${isEmpty ? 0 : pct}%;background:${barColor};"></div>
        </div>
        ${isEmpty
          ? '<div class="day-nutrition-stats empty">No meals planned</div>'
          : `<div class="day-nutrition-stats">
               <span>${Math.round(n.calories)} kcal</span>
               <span>${Math.round(n.protein)}g protein</span>
               <span>${Math.round(n.carbs)}g carbs</span>
               <span>${Math.round(n.fat)}g fat</span>
             </div>`
        }
      </div>`;
  }).join('');

  el.innerHTML = `
    <div class="day-nutrition-goal-note">Goal: ${goalCal} kcal / day</div>
    ${rows}`;
}

function renderWeeklyNutritionChart() {
  const ctx = document.getElementById('nutrition-chart').getContext('2d');
  
  // Calculate weekly nutrition from planned meals
  const weeklyNutrition = calculateWeeklyNutrition();
  
  if (window.nutritionChart) {
    window.nutritionChart.destroy();
  }
  
  window.nutritionChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Calories', 'Protein (g)', 'Carbs (g)', 'Fat (g)', 'Fiber (g)', 'Sodium (mg)'],
      datasets: [{
        label: 'Weekly Average',
        data: [
          weeklyNutrition.calories / 7,
          weeklyNutrition.protein / 7,
          weeklyNutrition.carbs / 7,
          weeklyNutrition.fat / 7,
          weeklyNutrition.fiber / 7,
          weeklyNutrition.sodium / 7
        ],
        backgroundColor: '#1FB8CD',
        borderColor: '#1FB8CD',
        borderWidth: 1
      }, {
        label: 'Daily Goals',
        data: [
          AppState.nutritionGoals.calories,
          AppState.nutritionGoals.protein,
          AppState.nutritionGoals.carbs,
          AppState.nutritionGoals.fat,
          AppState.nutritionGoals.fiber,
          AppState.nutritionGoals.sodium
        ],
        backgroundColor: '#FFC185',
        borderColor: '#FFC185',
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true
        }
      },
      plugins: {
        legend: {
          display: true
        }
      }
    }
  });
}

function calculateWeeklyNutrition() {
  const weeklyTotal = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0 };
  
  Object.keys(AppState.weeklyPlan).forEach(day => {
    Object.keys(AppState.weeklyPlan[day]).forEach(meal => {
      const mealData = AppState.weeklyPlan[day][meal];
      
      if (meal === 'snacks') {
        mealData.forEach(recipeId => {
          const recipe = AppState.recipes.find(r => String(r.id) === String(recipeId));
          if (recipe) {
            const nutrition = calculateRecipeNutrition(recipe);
            weeklyTotal.calories += nutrition.calories;
            weeklyTotal.protein += nutrition.protein;
            weeklyTotal.carbs += nutrition.carbs;
            weeklyTotal.fat += nutrition.fat;
            weeklyTotal.fiber += nutrition.fiber;
            weeklyTotal.sodium += nutrition.sodium;
          }
        });
      } else if (mealData) {
        const recipe = AppState.recipes.find(r => String(r.id) === String(mealData));
        if (recipe) {
          const nutrition = calculateRecipeNutrition(recipe);
          weeklyTotal.calories += nutrition.calories;
          weeklyTotal.protein += nutrition.protein;
          weeklyTotal.carbs += nutrition.carbs;
          weeklyTotal.fat += nutrition.fat;
          weeklyTotal.fiber += nutrition.fiber;
          weeklyTotal.sodium += nutrition.sodium;
        }
      }
    });
  });
  
  return weeklyTotal;
}

function filterRecipesByNutrition() {
  const filterType = document.getElementById('nutrition-filter-type').value;
  const resultsContainer = document.getElementById('nutrition-filtered-recipes');
  
  let filteredRecipes = AppState.recipes;
  
  if (filterType) {
    filteredRecipes = AppState.recipes.filter(recipe => {
      const nutrition = calculateRecipeNutrition(recipe);
      const perServing = {
        calories: nutrition.calories / recipe.currentServings,
        protein: nutrition.protein / recipe.currentServings,
        carbs: nutrition.carbs / recipe.currentServings,
        fat: nutrition.fat / recipe.currentServings,
        fiber: nutrition.fiber / recipe.currentServings
      };
      
      switch (filterType) {
        case 'high-protein':
          return perServing.protein > 25;
        case 'low-carb':
          return perServing.carbs < 15;
        case 'low-calorie':
          return perServing.calories < 300;
        case 'high-fiber':
          return perServing.fiber > 5;
        default:
          return true;
      }
    });
  }
  
  const missingCount = filteredRecipes.filter(r => !r.nutritionPerServing || r.nutritionPerServing.calories === 0).length;
  const bulkBtn = missingCount > 0
    ? `<div class="nutrition-bulk-action"><span>${missingCount} recipe${missingCount > 1 ? 's' : ''} missing nutrition data.</span> <button class="btn btn--secondary btn--sm" onclick="openMissingNutritionHelp()">How to add nutrition?</button></div>`
    : '';

  resultsContainer.innerHTML = bulkBtn + filteredRecipes.map(recipe => {
    const nutrition = calculateRecipeNutrition(recipe);
    const perServing = {
      calories: Math.round(nutrition.calories / recipe.currentServings),
      protein: Math.round(nutrition.protein / recipe.currentServings),
      carbs: Math.round(nutrition.carbs / recipe.currentServings),
      fat: Math.round(nutrition.fat / recipe.currentServings),
      fiber: Math.round(nutrition.fiber / recipe.currentServings)
    };
    const hasNutrition = perServing.calories > 0;

    return `
      <div class="recipe-card nutr-recipe-card">
        <div class="nutr-card-top">
          <h4 class="nutr-card-name">${recipe.name}</h4>
          <span class="nutr-card-servings">${recipe.currentServings} serving${recipe.currentServings !== 1 ? 's' : ''}</span>
        </div>
        ${hasNutrition ? `
        <div class="nutr-macros">
          <div class="nutr-macro nutr-cal">
            <span class="nutr-macro-val">${perServing.calories}</span>
            <span class="nutr-macro-lbl">kcal</span>
          </div>
          <div class="nutr-macro">
            <span class="nutr-macro-val">${perServing.protein}g</span>
            <span class="nutr-macro-lbl">protein</span>
          </div>
          <div class="nutr-macro">
            <span class="nutr-macro-val">${perServing.carbs}g</span>
            <span class="nutr-macro-lbl">carbs</span>
          </div>
          <div class="nutr-macro">
            <span class="nutr-macro-val">${perServing.fat}g</span>
            <span class="nutr-macro-lbl">fat</span>
          </div>
          ${perServing.fiber > 0 ? `<div class="nutr-macro"><span class="nutr-macro-val">${perServing.fiber}g</span><span class="nutr-macro-lbl">fiber</span></div>` : ''}
        </div>` : `
        <p class="nutrition-missing-note">No nutrition data yet.
          <button class="btn-link" onclick="openEditRecipeModal('${recipe.id}')">Add in recipe editor →</button>
        </p>`}
        <div class="nutr-card-actions">
          <button class="btn btn--primary btn--sm" onclick="addRecipeToPlanFromNutrition('${recipe.id}')">+ Add to Plan</button>
          ${!hasNutrition ? `<button class="btn btn--outline btn--sm" onclick="openEditRecipeModal('${recipe.id}')">Set Nutrition</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

// Ingredient CRUD functions
function openAddIngredientModal() {
  AppState.currentEditingIngredient = null;
  document.getElementById('ingredient-modal-title').textContent = 'Add New Ingredient';
  clearIngredientForm();
  document.getElementById('ingredient-modal').classList.remove('hidden');
}

function openEditIngredientModal(ingredientId) {
  const ingredient = AppState.customIngredients.find(i => i.id === ingredientId);
  if (!ingredient) return;
  
  AppState.currentEditingIngredient = ingredientId;
  document.getElementById('ingredient-modal-title').textContent = 'Edit Ingredient';
  
  // Populate form
  document.getElementById('ingredient-name').value = ingredient.name;
  document.getElementById('ingredient-category').value = ingredient.category;
  document.getElementById('ingredient-price').value = ingredient.pricePerUnit || '';
  document.getElementById('ingredient-unit').value = ingredient.unit || '';
  document.getElementById('ingredient-fridge-life').value = ingredient.fridgeLife;
  document.getElementById('ingredient-freezer-life').value = ingredient.freezerLife;
  document.getElementById('ingredient-storage-method').value = ingredient.storageMethod;
  document.getElementById('ingredient-storage-tips').value = ingredient.storageTips || '';
  document.getElementById('ingredient-calories').value = ingredient.calories || '';
  document.getElementById('ingredient-protein').value = ingredient.protein || '';
  document.getElementById('ingredient-carbs').value = ingredient.carbs || '';
  document.getElementById('ingredient-fat').value = ingredient.fat || '';
  document.getElementById('ingredient-fiber').value = ingredient.fiber || '';
  document.getElementById('ingredient-sodium').value = ingredient.sodium || '';
  
  document.getElementById('ingredient-modal').classList.remove('hidden');
}

function closeIngredientModal() {
  document.getElementById('ingredient-modal').classList.add('hidden');
  clearIngredientForm();
}

function clearIngredientForm() {
  document.getElementById('ingredient-form').reset();
}

function saveIngredient(e) {
  e.preventDefault();
  
  const ingredient = {
    id: AppState.currentEditingIngredient || Date.now(),
    name: document.getElementById('ingredient-name').value,
    category: document.getElementById('ingredient-category').value,
    pricePerUnit: parseFloat(document.getElementById('ingredient-price').value) || 0,
    unit: document.getElementById('ingredient-unit').value,
    fridgeLife: parseInt(document.getElementById('ingredient-fridge-life').value),
    freezerLife: parseInt(document.getElementById('ingredient-freezer-life').value),
    storageMethod: document.getElementById('ingredient-storage-method').value,
    storageTips: document.getElementById('ingredient-storage-tips').value,
    calories: parseFloat(document.getElementById('ingredient-calories').value) || 0,
    protein: parseFloat(document.getElementById('ingredient-protein').value) || 0,
    carbs: parseFloat(document.getElementById('ingredient-carbs').value) || 0,
    fat: parseFloat(document.getElementById('ingredient-fat').value) || 0,
    fiber: parseFloat(document.getElementById('ingredient-fiber').value) || 0,
    sodium: parseFloat(document.getElementById('ingredient-sodium').value) || 0
  };
  
  if (AppState.currentEditingIngredient) {
    // Update existing ingredient
    const index = AppState.customIngredients.findIndex(i => i.id === AppState.currentEditingIngredient);
    AppState.customIngredients[index] = ingredient;
  } else {
    // Add new ingredient
    AppState.customIngredients.push(ingredient);
  }
  
  renderStorageGuide();
  closeIngredientModal();
  saveData();
}

function deleteIngredient(ingredientId) {
  if (confirm('Are you sure you want to delete this ingredient?')) {
    AppState.customIngredients = AppState.customIngredients.filter(i => i.id !== ingredientId);
    renderStorageGuide();
    saveData();
  }
}

function importIngredientsFromRecipes() {
  const newIngredients = [];
  
  AppState.recipes.forEach(recipe => {
    const ingredients = recipe.baseIngredients || recipe.ingredients || [];
    ingredients.forEach(ingredient => {
      // Check if ingredient already exists
      const exists = AppState.customIngredients.find(i => 
        i.name.toLowerCase() === ingredient.name.toLowerCase()
      );
      
      if (!exists) {
        newIngredients.push({
          id: Date.now() + Math.random(),
          name: ingredient.name,
          category: ingredient.category,
          pricePerUnit: 0,
          unit: 'per 100g',
          fridgeLife: 7,
          freezerLife: 90,
          storageMethod: 'Store properly in refrigerator',
          storageTips: 'Check regularly for freshness',
          calories: 0,
          protein: 0,
          carbs: 0,
          fat: 0,
          fiber: 0,
          sodium: 0
        });
      }
    });
  });
  
  AppState.customIngredients.push(...newIngredients);
  renderStorageGuide();
  alert(`Imported ${newIngredients.length} new ingredients from recipes.`);
}

// Cooking Hack CRUD functions
function openAddHackModal() {
  AppState.currentEditingHack = null;
  document.getElementById('hack-modal-title').textContent = 'Add New Cooking Hack';
  clearHackForm();
  document.getElementById('hack-modal').classList.remove('hidden');
}

function openEditHackModal(hackId) {
  const hack = AppState.customHacks.find(h => h.id === hackId);
  if (!hack) return;
  
  AppState.currentEditingHack = hackId;
  document.getElementById('hack-modal-title').textContent = 'Edit Cooking Hack';
  
  // Populate form
  document.getElementById('hack-title').value = hack.title;
  document.getElementById('hack-category').value = hack.category;
  document.getElementById('hack-description').value = hack.description;
  document.getElementById('hack-time-saved').value = hack.timeSaved || '';
  document.getElementById('hack-cost-savings').value = hack.costSavings || '';
  
  document.getElementById('hack-modal').classList.remove('hidden');
}

function closeHackModal() {
  document.getElementById('hack-modal').classList.add('hidden');
  clearHackForm();
}

function clearHackForm() {
  document.getElementById('hack-form').reset();
}

function saveHack(e) {
  e.preventDefault();
  
  const hack = {
    id: AppState.currentEditingHack || Date.now(),
    title: document.getElementById('hack-title').value,
    category: document.getElementById('hack-category').value,
    description: document.getElementById('hack-description').value,
    timeSaved: document.getElementById('hack-time-saved').value,
    costSavings: document.getElementById('hack-cost-savings').value
  };
  
  if (AppState.currentEditingHack) {
    // Update existing hack
    const index = AppState.customHacks.findIndex(h => h.id === AppState.currentEditingHack);
    AppState.customHacks[index] = hack;
  } else {
    // Add new hack
    AppState.customHacks.push(hack);
  }
  
  renderCookingHacks();
  closeHackModal();
  saveData();
}

function deleteHack(hackId) {
  if (confirm('Are you sure you want to delete this cooking hack?')) {
    AppState.customHacks = AppState.customHacks.filter(h => h.id !== hackId);
    renderCookingHacks();
    saveData();
  }
}

// Opens the recipe selection modal pre-filtered so the user can pick a day/meal
function addRecipeToPlanFromNutrition(recipeId) {
  // Switch to planner tab so context is clear, then open meal slot picker
  const days = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const meals = ['breakfast','lunch','dinner','snacks'];
  const dayOpts = days.map(d => `<option value="${d}">${d}</option>`).join('');
  const mealOpts = meals.map(m => `<option value="${m}">${m.charAt(0).toUpperCase()+m.slice(1)}</option>`).join('');

  const existing = document.getElementById('quick-plan-picker');
  if (existing) existing.remove();

  const picker = document.createElement('div');
  picker.id = 'quick-plan-picker';
  picker.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--color-surface);border:1px solid var(--color-border);border-radius:12px;padding:1.5rem;z-index:9999;box-shadow:0 8px 32px rgba(0,0,0,0.2);min-width:280px;';
  picker.innerHTML = `
    <h3 style="margin:0 0 1rem">Add to Weekly Plan</h3>
    <label style="display:block;margin-bottom:.5rem">Day
      <select id="qpp-day" style="display:block;width:100%;margin-top:.25rem;padding:.5rem;border:1px solid var(--color-border);border-radius:6px;background:var(--color-surface);">${dayOpts}</select>
    </label>
    <label style="display:block;margin-bottom:1rem">Meal
      <select id="qpp-meal" style="display:block;width:100%;margin-top:.25rem;padding:.5rem;border:1px solid var(--color-border);border-radius:6px;background:var(--color-surface);">${mealOpts}</select>
    </label>
    <div style="display:flex;gap:.5rem;justify-content:flex-end">
      <button onclick="document.getElementById('quick-plan-picker').remove()" style="padding:.5rem 1rem;border:1px solid var(--color-border);border-radius:6px;background:none;cursor:pointer;">Cancel</button>
      <button onclick="confirmQuickPlan('${recipeId}')" style="padding:.5rem 1rem;border:none;border-radius:6px;background:var(--color-primary);color:#fff;cursor:pointer;">Add</button>
    </div>
  `;
  document.body.appendChild(picker);
}

function confirmQuickPlan(recipeId) {
  const day  = document.getElementById('qpp-day').value;
  const meal = document.getElementById('qpp-meal').value;
  AppState.selectedMealSlot = { day, meal };
  selectRecipeForPlanning(recipeId);
  document.getElementById('quick-plan-picker').remove();
}

// Global functions for onclick handlers
window.updateServingSize = updateServingSize;
window.resetServingSize = resetServingSize;
window.openEditRecipeModal = openEditRecipeModal;
window.deleteRecipe = deleteRecipe;
window.openRecipeSelectionModal = openRecipeSelectionModal;
window.selectRecipeForPlanning = selectRecipeForPlanning;
window.togglePlannerDay = togglePlannerDay;
window.toggleAllPlannerDays = toggleAllPlannerDays;
window.addRecipeToPlanFromNutrition = addRecipeToPlanFromNutrition;
window.confirmQuickPlan = confirmQuickPlan;
window.removeRecipeFromSlot = removeRecipeFromSlot;
window.copyDay = copyDay;
window.clearDay = clearDay;
window.pasteDayInto = pasteDayInto;
window.cancelCopyDay = cancelCopyDay;
window.toggleGroceryItem = toggleGroceryItem;
window.removeIngredientField = removeIngredientField;
window.filterCookingHacks = filterCookingHacks;
window.calculateRecipeCost = calculateRecipeCost;
window.openEditIngredientModal = openEditIngredientModal;
window.deleteIngredient = deleteIngredient;
window.openEditHackModal = openEditHackModal;
window.deleteHack = deleteHack;
window.filterRecipesByNutrition = filterRecipesByNutrition;
window.openMissingNutritionHelp = openMissingNutritionHelp;
window.searchUSDAFallback = searchUSDAFallback;
window.getCategoryIcon = getCategoryIcon;
window.showSuccessMessage = showSuccessMessage;
window.clearLocalStorage = clearLocalStorage;
// These were missing — caused dark mode, pantry, auth, and export buttons to silently do nothing
window.toggleDarkMode = toggleDarkMode;
window.addToPantry = addToPantry;
window.quickAddPantry = quickAddPantry;
window.togglePantrySection = togglePantrySection;
window.togglePantryCard = togglePantryCard;
window.removeFromPantry = removeFromPantry;
window.updatePantryDate = updatePantryDate;
window.updatePantryShelf = updatePantryShelf;
window.updatePantryQty = updatePantryQty;
window.setPantryStorage = setPantryStorage;
window.togglePantryStaple = togglePantryStaple;
window.cycleStapleLevel = cycleStapleLevel;
window.togglePantryGuide = togglePantryGuide;
window.togglePantryDateMode = togglePantryDateMode;
window.markRecipeCooked = markRecipeCooked;
window.setCookedStorage = setCookedStorage;
window.updateCookedDate = updateCookedDate;
window.removeCookedMeal = removeCookedMeal;
window.renderCookedMeals = renderCookedMeals;
window.dismissFreshnessBanner = dismissFreshnessBanner;
window.goToFreshnessTab = goToFreshnessTab;
window.goToTab = function (t) { showTab(t); };
window.dismissGettingStarted = dismissGettingStarted;
window.renderIngredientsTab = renderIngredientsTab;
window.openAddUserIngredientModal = openAddUserIngredientModal;
window.openEditUserIngredientModal = openEditUserIngredientModal;
window.closeUserIngredientModal = closeUserIngredientModal;
window.saveUserIngredient = saveUserIngredient;
window.deleteUserIngredient = deleteUserIngredient;
window.filterIngredientCatalog = filterIngredientCatalog;
window.addMyStore = addMyStore;
window.removeMyStore = removeMyStore;
window.saveIngredientUnit = saveIngredientUnit;
window.saveIngredientStorePrice = saveIngredientStorePrice;
window.showPantryAddRow = showPantryAddRow;
window.confirmAddIngredientToPantry = confirmAddIngredientToPantry;
window.removeIngredientFromPantry = removeIngredientFromPantry;
window.searchNutritionDB = searchNutritionDB;
window.applyNutritionResult = applyNutritionResult;
window.exportData = exportData;
window.importData = importData;
window.openLoginModal = openLoginModal;
window.closeLoginModal = closeLoginModal;
window.openSignupModal = openSignupModal;
window.closeSignupModal = closeSignupModal;
window.signOut = signOut;
window.resendVerification = resendVerification;
window.recheckVerification = recheckVerification;
window.saveUsername = saveUsername;
window.openUsernameModal = openUsernameModal;
window.closeUsernameModal = closeUsernameModal;
window.importFromCSV = importFromCSV;
window.saveWeekAsTemplate = saveWeekAsTemplate;
window.loadWeekTemplate = loadWeekTemplate;
window.openPrepMode = openPrepMode;
window.closePrepMode = closePrepMode;
window.prevPlannerDay = prevPlannerDay;
window.nextPlannerDay = nextPlannerDay;
window.printGroceryList = printGroceryList;
window.copyGroceryList = copyGroceryList;
window.openSharedRecipesModal = openSharedRecipesModal;
window.closeSharedRecipesModal = closeSharedRecipesModal;
window.shareRecipe = shareRecipe;
window.openFamilySharingModal = openFamilySharingModal;
window.closeFamilySharingModal = closeFamilySharingModal;
window.inviteFamilyMember = inviteFamilyMember;
window.exportAllData = exportAllData;
window.openDeleteAccountModal = openDeleteAccountModal;
window.closeDeleteAccountModal = closeDeleteAccountModal;
window.deleteAccount = deleteAccount;
window.removePhoto = removePhoto;
window.closeCustomItemModal = closeCustomItemModal;
window.confirmCustomGroceryItem = confirmCustomGroceryItem;
window.openPasteRecipeModal = openPasteRecipeModal;
window.closePasteRecipeModal = closePasteRecipeModal;
window.parseAndImportRecipe = parseAndImportRecipe;
window.closeCSVPreviewModal = closeCSVPreviewModal;
window.downloadCSVTemplate = downloadCSVTemplate;
window.confirmCSVImport = confirmCSVImport;
window.openNutritionGoalsModal = openNutritionGoalsModal;
window.closeNutritionGoalsModal = closeNutritionGoalsModal;
window.saveNutritionGoals = saveNutritionGoals;

// Export/Import functionality
function exportData() {
  try {
    const dataToExport = {
      recipes: AppState.recipes,
      weeklyPlan: AppState.weeklyPlan,
      groceryList: AppState.groceryList,
      nutritionGoals: AppState.nutritionGoals,
      customIngredients: AppState.customIngredients,
      customHacks: AppState.customHacks,
      pantry: AppState.pantry,
      userIngredients: AppState.userIngredients,
      ingredientPrices: AppState.ingredientPrices,
      myStores: AppState.myStores,
      customStores: AppState.customStores,
      cookedMeals: AppState.cookedMeals,
      recentRecipes: AppState.recentRecipes,
      exportedAt: new Date().toISOString(),
      version: '1.1'
    };
    
    const dataStr = JSON.stringify(dataToExport, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `meal-prep-data-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    showSuccessMessage('Data exported successfully!');
  } catch (error) {
    console.error('Error exporting data:', error);
    showErrorMessage('Failed to export data. Please try again.');
  }
}

function unionStrings(a, b) {
  var out = (a || []).slice();
  (b || []).forEach(function(s) { if (out.indexOf(s) < 0) out.push(s); });
  return out;
}

// Fill only EMPTY plan slots from an imported plan — never overwrite a meal you
// already planned. Snacks are unioned.
function mergeWeeklyPlan(imported) {
  ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].forEach(function(day) {
    if (!imported[day]) return;
    if (!AppState.weeklyPlan[day]) AppState.weeklyPlan[day] = { breakfast: null, lunch: null, dinner: null, snacks: [] };
    ['breakfast', 'lunch', 'dinner'].forEach(function(meal) {
      if (!AppState.weeklyPlan[day][meal] && imported[day][meal]) AppState.weeklyPlan[day][meal] = imported[day][meal];
    });
    var cur = AppState.weeklyPlan[day].snacks || [];
    (imported[day].snacks || []).forEach(function(id) { if (cur.indexOf(id) < 0) cur.push(id); });
    AppState.weeklyPlan[day].snacks = cur;
  });
}

function importData() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = function(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const importedData = JSON.parse(e.target.result);
        
        // Accept any meal-prep export that has at least one known field.
        var KNOWN = ['recipes', 'weeklyPlan', 'pantry', 'customIngredients', 'customHacks', 'userIngredients', 'groceryList', 'cookedMeals'];
        if (!importedData || typeof importedData !== 'object' || !KNOWN.some(function(k) { return importedData[k]; })) {
          throw new Error('Invalid data format');
        }

        var newRecipeCount = (importedData.recipes || []).filter(function(r) {
          return r && r.id != null && !AppState.recipes.some(function(x) { return String(x.id) === String(r.id); });
        }).length;

        if (confirm('Add the recipes and data from this file to your collection?\n\nNothing is removed — imported items are merged into what you already have.')) {
          // Snapshot current data first so this can be undone via "Restore Backup".
          createBackup('Import');

          // MERGE, don't replace — union list-type data by id (existing items
          // win on a collision, so re-importing your own backup is a no-op).
          AppState.recipes = unionById(AppState.recipes, importedData.recipes || []);
          patchMissingNutrition(AppState.recipes);
          AppState.customIngredients = unionById(AppState.customIngredients, importedData.customIngredients || []);
          AppState.customHacks = unionById(AppState.customHacks, importedData.customHacks || []);
          AppState.pantry = unionById(AppState.pantry, importedData.pantry || []);
          AppState.userIngredients = unionById(AppState.userIngredients, importedData.userIngredients || []);
          AppState.cookedMeals = unionById(AppState.cookedMeals, importedData.cookedMeals || []);
          AppState.groceryList = unionById(AppState.groceryList, importedData.groceryList || []);

          // Plan: fill empty slots only (never wipe a planned meal).
          if (importedData.weeklyPlan) mergeWeeklyPlan(importedData.weeklyPlan);

          // Maps + store lists: combine; current values win on conflicts.
          AppState.ingredientPrices = Object.assign({}, importedData.ingredientPrices || {}, AppState.ingredientPrices);
          AppState.myStores = unionStrings(AppState.myStores, importedData.myStores || []);
          AppState.customStores = unionStrings(AppState.customStores, importedData.customStores || []);
          cacheInlinePhotos();

          saveData();

          // Refresh every view
          renderRecipes();
          renderWeeklyPlanner();
          renderStorageGuide();
          renderCookingHacks();
          renderCookedMeals();
          renderPantry();
          renderIngredientsTab();
          updateNutritionGoalsDisplay();
          updateFreshnessBadges();
          renderFreshnessBanner();

          showSuccessMessage(newRecipeCount > 0
            ? 'Imported! Added ' + newRecipeCount + ' new recipe' + (newRecipeCount === 1 ? '' : 's') + ' to your collection. 🎉'
            : 'Imported and merged into your data.');
        }
      } catch (error) {
        console.error('Error importing data:', error);
        showErrorMessage('Failed to import data. Please check the file format.');
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

// "⋯ Data" dropdown menu (declutters the My Recipes header).
function toggleDataMenu(e) {
  if (e) e.stopPropagation();
  var panel = document.getElementById('data-menu-panel');
  if (panel) panel.classList.toggle('hidden');
}
// Any click that reaches the document closes the menu. The toggle button calls
// stopPropagation, so opening it doesn't immediately re-close.
document.addEventListener('click', function () {
  var panel = document.getElementById('data-menu-panel');
  if (panel) panel.classList.add('hidden');
});

window.exportData = exportData;
window.importData = importData;
window.restoreBackup = restoreBackup;
window.toggleDataMenu = toggleDataMenu;
window.handlePhotoUpload = handlePhotoUpload;
window.removePhoto = removePhoto;

// Firebase Authentication
function openLoginModal() {
  document.getElementById('login-modal').classList.remove('hidden');
}

function closeLoginModal() {
  document.getElementById('login-modal').classList.add('hidden');
  document.getElementById('login-form').reset();
}

function openSignupModal() {
  document.getElementById('signup-modal').classList.remove('hidden');
}

function closeSignupModal() {
  document.getElementById('signup-modal').classList.add('hidden');
  document.getElementById('signup-form').reset();
}

async function signIn(email, password) {
  try {
    const userCredential = await window.firebase.signInWithEmailAndPassword(window.firebase.auth, email, password);
    AppState.currentUser = userCredential.user;
    showSuccessMessage('Signed in successfully!');
    closeLoginModal();
    loadUserData();
  } catch (error) {
    console.error('Sign in error:', error);
    showErrorMessage('Failed to sign in: ' + error.message);
  }
}

async function signUp(email, password) {
  try {
    const userCredential = await window.firebase.createUserWithEmailAndPassword(window.firebase.auth, email, password);
    AppState.currentUser = userCredential.user;
    // Send a verification link so we can trust the email (needed for sharing).
    if (window.firebase.sendEmailVerification) {
      try { await window.firebase.sendEmailVerification(userCredential.user); }
      catch (e) { console.error('Verification email failed:', e); }
    }
    showSuccessMessage('Account created! We emailed a verification link to ' + email + ' — verify it to enable recipe sharing.');
    closeSignupModal();
    // Initialize user data
    await initializeUserData();
  } catch (error) {
    console.error('Sign up error:', error);
    showErrorMessage('Failed to create account: ' + error.message);
  }
}

async function signOut() {
  try {
    await window.firebase.signOut(window.firebase.auth);
    AppState.currentUser = null;
    showSuccessMessage('Signed out successfully!');
    // Clear UI and load local data
    updateAuthUI();
    loadFromLocalStorage();
    renderRecipes();
    renderWeeklyPlanner();
    renderStorageGuide();
    renderCookingHacks();
  } catch (error) {
    console.error('Sign out error:', error);
    showErrorMessage('Failed to sign out: ' + error.message);
  }
}

function updateAuthUI() {
  const userInfo = document.getElementById('user-info');
  const authButtons = document.getElementById('auth-buttons');
  const userEmail = document.getElementById('user-email');
  const sharedRecipesBtn = document.getElementById('shared-recipes-btn');
  const familySharingBtn = document.getElementById('family-sharing-btn');
  
  if (AppState.currentUser) {
    userEmail.textContent = AppState.currentUser.email;
    userInfo.classList.remove('hidden');
    authButtons.classList.add('hidden');
    // Sharing relies on a trusted email identity → only show once verified.
    var verified = AppState.currentUser.emailVerified;
    if (sharedRecipesBtn) sharedRecipesBtn.style.display = verified ? 'inline-block' : 'none';
    if (familySharingBtn) familySharingBtn.style.display = verified ? 'inline-block' : 'none';
  } else {
    userInfo.classList.add('hidden');
    authButtons.classList.remove('hidden');
    if (sharedRecipesBtn) sharedRecipesBtn.style.display = 'none';
    if (familySharingBtn) familySharingBtn.style.display = 'none';
  }
  renderVerificationBanner();
  updateSyncIndicator();
}

// Shows a banner while signed in with an unverified email. Core app stays
// usable; only sharing is gated (here + in the Firestore rules).
function renderVerificationBanner() {
  var existing = document.getElementById('email-verify-banner');
  var user = AppState.currentUser;
  var needsBanner = !!user && user.emailVerified === false;
  if (!needsBanner) { if (existing) existing.remove(); return; }
  if (existing) return;
  var banner = document.createElement('div');
  banner.id = 'email-verify-banner';
  banner.className = 'email-verify-banner';
  banner.innerHTML =
    '<span>' + icon('mail') + ' Verify your email (' + escapeHtml(user.email) + ') to enable recipe sharing.</span>' +
    '<span class="evb-actions">' +
    '<button type="button" onclick="resendVerification()">Resend email</button>' +
    '<button type="button" onclick="recheckVerification()">I\'ve verified</button>' +
    '</span>';
  var app = document.querySelector('.app') || document.body;
  app.insertBefore(banner, app.firstChild);
}

async function resendVerification() {
  if (!AppState.currentUser || !window.firebase || !window.firebase.sendEmailVerification) return;
  try {
    await window.firebase.sendEmailVerification(AppState.currentUser);
    showSuccessMessage('Verification email sent to ' + AppState.currentUser.email + '. Check your inbox and spam folder.');
  } catch (e) {
    console.error('Resend verification failed:', e);
    showErrorMessage('Could not send verification email: ' + e.message);
  }
}

async function recheckVerification() {
  if (!AppState.currentUser) return;
  try {
    await AppState.currentUser.reload();
    AppState.currentUser = window.firebase.auth.currentUser || AppState.currentUser;
    updateAuthUI();
    if (AppState.currentUser.emailVerified) showSuccessMessage('Email verified — sharing is now enabled! 🎉');
    else showErrorMessage('Not verified yet. Click the link in your email, then try again.');
  } catch (e) {
    console.error('Recheck verification failed:', e);
  }
}

// Firestore Data Management

// Builds the cloud payload from AppState. Photos are stripped (they live in the
// photos subcollection). Returns a plain object WITHOUT a version field.
function buildFirestorePayload() {
  return {
    recipes: AppState.recipes.map(function(r) {
      if (!r.photo) return r;
      var copy = Object.assign({}, r);
      delete copy.photo;
      return copy;
    }),
    weeklyPlan: AppState.weeklyPlan,
    groceryList: AppState.groceryList,
    nutritionGoals: AppState.nutritionGoals,
    customIngredients: AppState.customIngredients,
    customHacks: AppState.customHacks,
    pantry: AppState.pantry,
    userIngredients: AppState.userIngredients,
    ingredientPrices: AppState.ingredientPrices,
    myStores: AppState.myStores,
    customStores: AppState.customStores,
    cookedMeals: AppState.cookedMeals,
    recentRecipes: AppState.recentRecipes,
    lastUpdated: new Date().toISOString()
  };
}

// Union two arrays of {id} items, preferring the local copy on id collisions and
// KEEPING items that exist only remotely (e.g. added on another device).
function unionById(localArr, remoteArr) {
  var map = {};
  (remoteArr || []).forEach(function(it) { if (it && it.id != null) map[String(it.id)] = it; });
  (localArr || []).forEach(function(it) { if (it && it.id != null) map[String(it.id)] = it; });
  return Object.keys(map).map(function(k) { return map[k]; });
}

// When the cloud changed since we loaded (another device wrote first), merge
// instead of clobbering: union list-type fields by id so nothing added
// elsewhere is lost; scalar/object fields keep the local (being-saved) copy.
function mergeCloudConflict(remote, local) {
  var out = Object.assign({}, local);
  ['recipes', 'pantry', 'cookedMeals', 'userIngredients', 'groceryList', 'customIngredients', 'customHacks'].forEach(function(key) {
    out[key] = unionById(local[key] || [], remote[key] || []);
  });
  return out;
}

async function saveToFirestore() {
  if (!AppState.currentUser || !window.firebase) return;
  if (!AppState.isOnline) { AppState.syncStatus = 'local'; updateSyncIndicator(); return; }
  AppState.syncStatus = 'saving'; updateSyncIndicator();

  const userDocRef = window.firebase.doc(window.firebase.db, 'users', AppState.currentUser.uid);

  try {
    // Fallback if the transaction API isn't loaded (e.g. an old cached HTML):
    // plain write, no concurrency guard, but data still saves.
    if (!window.firebase.runTransaction) {
      var payload = buildFirestorePayload();
      payload.version = (AppState.dataVersion || 0) + 1;
      await window.firebase.setDoc(userDocRef, JSON.parse(JSON.stringify(payload)), { merge: true });
      AppState.dataVersion = payload.version;
      AppState.syncStatus = 'synced'; updateSyncIndicator();
      return;
    }

    // Optimistic concurrency: read the cloud version inside a transaction. If it
    // advanced past what we loaded, another device wrote first → merge so we
    // don't silently overwrite their changes. Firestore auto-retries on contention.
    await window.firebase.runTransaction(window.firebase.db, async function(tx) {
      const snap = await tx.get(userDocRef);
      let payload = buildFirestorePayload();

      if (snap.exists()) {
        const remote = snap.data();
        const remoteVersion = remote.version || 0;
        if (remoteVersion > (AppState.dataVersion || 0)) {
          payload = mergeCloudConflict(remote, payload);
          console.warn('Concurrent edit detected (cloud v' + remoteVersion + ') — merged, no data lost');
        }
        payload.version = remoteVersion + 1;
      } else {
        payload.version = 1;
      }

      // Firestore rejects `undefined`; round-trip strips undefined + functions.
      tx.set(userDocRef, JSON.parse(JSON.stringify(payload)));
      AppState.dataVersion = payload.version;
    });
    console.log('Data saved to Firestore (v' + AppState.dataVersion + ')');
    AppState.syncStatus = 'synced'; updateSyncIndicator();
  } catch (error) {
    console.error('Error saving to Firestore:', error);
    showErrorMessage('Failed to sync data to cloud. Changes saved locally.');
    AppState.syncStatus = 'local'; updateSyncIndicator();
  }
}

// Returns 'loaded' (cloud data applied), 'empty' (no cloud doc yet), or
// 'error' (offline / read failed). The caller seeds the cloud only on 'empty'.
async function loadFromFirestore() {
  if (!AppState.currentUser || !AppState.isOnline) return 'error';

  try {
    const userDocRef = window.firebase.doc(window.firebase.db, 'users', AppState.currentUser.uid);
    const docSnap = await window.firebase.getDoc(userDocRef);
    
    if (docSnap.exists()) {
      const data = docSnap.data();
      AppState.dataVersion = data.version || 0;
      AppState.recipes = data.recipes || [];
      const didPatch = patchMissingNutrition(AppState.recipes);
      AppState.weeklyPlan = data.weeklyPlan || {
        Monday: { breakfast: null, lunch: null, dinner: null, snacks: [] },
        Tuesday: { breakfast: null, lunch: null, dinner: null, snacks: [] },
        Wednesday: { breakfast: null, lunch: null, dinner: null, snacks: [] },
        Thursday: { breakfast: null, lunch: null, dinner: null, snacks: [] },
        Friday: { breakfast: null, lunch: null, dinner: null, snacks: [] },
        Saturday: { breakfast: null, lunch: null, dinner: null, snacks: [] },
        Sunday: { breakfast: null, lunch: null, dinner: null, snacks: [] }
      };
      AppState.groceryList = data.groceryList || [];
      AppState.nutritionGoals = data.nutritionGoals || {
        calories: 2000,
        protein: 150,
        carbs: 250,
        fat: 67,
        fiber: 25,
        sodium: 2300
      };
      AppState.customIngredients = data.customIngredients || [];
      AppState.customHacks = data.customHacks || [];
      AppState.pantry = data.pantry || [];
      AppState.userIngredients = data.userIngredients || [];
      AppState.ingredientPrices = data.ingredientPrices || {};
      AppState.myStores = data.myStores || [];
      AppState.customStores = data.customStores || [];
      AppState.cookedMeals = data.cookedMeals || [];
      AppState.recentRecipes = data.recentRecipes || [];

      // Photos: legacy data may have them inline in this doc; new photos live in
      // the photos subcollection. Cache both, attach to recipes, and migrate any
      // legacy inline photos out so the main doc shrinks below the 1 MiB limit.
      const inlinePhotoIds = [];
      AppState.recipes.forEach(function(r) {
        if (r.photo && typeof r.photo === 'string') {
          recipePhotoCache[String(r.id)] = r.photo;
          inlinePhotoIds.push(String(r.id));
        }
      });
      const foundPhotoDocs = await loadPhotoDocsIntoCache();
      inlinePhotoIds.forEach(function(id) {
        if (!foundPhotoDocs[id]) savePhotoDoc(id, recipePhotoCache[id]); // migrate
      });
      attachPhotosFromCache();
      const migratedAnyPhoto = inlinePhotoIds.some(function(id) { return !foundPhotoDocs[id]; });

      // If we patched nutrition or migrated inline photos, re-save the main doc
      // (now photo-stripped) so Firebase stops sending stale/oversized data.
      if (didPatch || migratedAnyPhoto) { setTimeout(saveToFirestore, 800); }

      console.log('Data loaded from Firestore');
      return 'loaded';
    }
    return 'empty'; // signed in, but no data saved to the cloud yet
  } catch (error) {
    console.error('Error loading from Firestore:', error);
    showErrorMessage('Failed to load cloud data. Using local data.');
  }
  return 'error';
}

async function initializeUserData() {
  // Save current local data to Firestore for new users
  await saveToFirestore();
  loadUserData();
}

async function loadUserData() {
  // Try to load from Firestore first, fallback to local storage
  const status = await loadFromFirestore();
  if (status !== 'loaded') {
    loadFromLocalStorage();
    // First sign-in on an account that has no cloud data yet → push this
    // device's local data up so it reaches your other devices. Only on a
    // confirmed-empty doc (not a transient error) to avoid overwriting good data.
    if (status === 'empty') saveToFirestore();
  }

  seedPantryIfEmpty(); // first-time: pre-fill common staples to set stock on

  // Update UI
  renderRecipes();
  renderWeeklyPlanner();
  renderStorageGuide();
  renderCookingHacks();
  renderCookedMeals();
  renderPantry();
  updateNutritionGoalsDisplay();
  updateFreshnessBadges();
  renderFreshnessBanner();
  loadProfile(); // load (or prompt for) the community display name
}

// ── Community profile / username ─────────────────────────────────────────────
// Public identity for the shared feed. Stored at /profiles/{uid} so other users
// can see a display name instead of an email.
async function loadProfile() {
  if (!AppState.currentUser || !AppState.isOnline || !window.firebase) return;
  try {
    var ref = window.firebase.doc(window.firebase.db, 'profiles', AppState.currentUser.uid);
    var snap = await window.firebase.getDoc(ref);
    if (snap.exists() && snap.data().displayName) {
      AppState.profile = { displayName: snap.data().displayName };
    } else {
      AppState.profile = null;
    }
  } catch (e) {
    console.error('Profile load failed:', e);
  }
}

async function saveUsername() {
  var input = document.getElementById('username-input');
  var name = (input ? input.value : '').trim();
  if (name.length < 2) { showErrorMessage('Please enter a name of at least 2 characters.'); return; }
  if (name.length > 30) name = name.slice(0, 30);
  name = name.replace(/[<>]/g, ''); // keep it safe for the public feed
  try {
    var ref = window.firebase.doc(window.firebase.db, 'profiles', AppState.currentUser.uid);
    await window.firebase.setDoc(ref, { displayName: name, updatedAt: new Date().toISOString() }, { merge: true });
    AppState.profile = { displayName: name };
    closeUsernameModal();
    showSuccessMessage('You\'re set up as "' + name + '" 🎉');
  } catch (e) {
    console.error('Username save failed:', e);
    showErrorMessage('Could not save your name: ' + e.message);
  }
}

function openUsernameModal() {
  if (!AppState.currentUser) { showErrorMessage('Sign in first to set a display name.'); return; }
  var input = document.getElementById('username-input');
  if (input) input.value = (AppState.profile && AppState.profile.displayName) || '';
  var modal = document.getElementById('username-modal');
  if (modal) modal.classList.remove('hidden');
  setTimeout(function () { if (input) input.focus(); }, 50);
}

function closeUsernameModal() {
  var modal = document.getElementById('username-modal');
  if (modal) modal.classList.add('hidden');
}

// Returns the user's display name, or prompts them to pick one. Used before
// posting to the community feed so we never share as a raw email.
function requireUsername() {
  if (AppState.profile && AppState.profile.displayName) return AppState.profile.displayName;
  openUsernameModal();
  return null;
}

// Enhanced save function that saves to both local storage and Firestore
function saveData() {
  saveToLocalStorage();
  saveToFirestore();
  updateFreshnessBadges();
}

// Setup real-time listeners
function setupRealtimeListeners() {
  if (!AppState.currentUser || !AppState.isOnline) return;
  
  const userDocRef = window.firebase.doc(window.firebase.db, 'users', AppState.currentUser.uid);
  
  window.firebase.onSnapshot(userDocRef, (doc) => {
    if (doc.exists() && AppState.currentUser) {
      const data = doc.data();
      // Apply only when the cloud VERSION advanced — i.e. a real change from
      // another device/tab. Our own writes bump dataVersion before the echo
      // arrives, so they're skipped. (Comparing recipe contents was unreliable
      // because local recipes are normalized/photo-attached and would look
      // "different" forever, causing constant re-syncs.)
      var remoteVersion = data.version || 0;
      if (remoteVersion > AppState.dataVersion) {
        AppState.dataVersion = remoteVersion;
        AppState.recipes = data.recipes || [];
        patchMissingNutrition(AppState.recipes);
        attachPhotosFromCache();
        // Pull any photos added on another device, then re-render.
        loadPhotoDocsIntoCache().then(function() { attachPhotosFromCache(); renderRecipes(); });
        AppState.weeklyPlan = data.weeklyPlan || AppState.weeklyPlan;
        AppState.groceryList = data.groceryList || [];
        AppState.nutritionGoals = data.nutritionGoals || AppState.nutritionGoals;
        AppState.customIngredients = data.customIngredients || [];
        AppState.customHacks = data.customHacks || [];
        AppState.pantry = data.pantry || [];
        AppState.userIngredients = data.userIngredients || [];
        AppState.ingredientPrices = data.ingredientPrices || {};
        AppState.myStores = data.myStores || [];
        AppState.customStores = data.customStores || [];
        AppState.cookedMeals = data.cookedMeals || [];
        AppState.recentRecipes = data.recentRecipes || [];

        // Update UI
        renderRecipes();
        renderWeeklyPlanner();
        renderStorageGuide();
        renderCookingHacks();
        renderCookedMeals();
        renderPantry();
        renderIngredientsTab();
        updateNutritionGoalsDisplay();
        updateFreshnessBadges();
        renderFreshnessBanner();
        // Silent — the ✓ Synced badge already conveys sync status.
      }
    }
  });
}

// Global functions for authentication
window.openLoginModal = openLoginModal;
window.closeLoginModal = closeLoginModal;
window.openSignupModal = openSignupModal;
window.closeSignupModal = closeSignupModal;
window.signOut = signOut;

// Shared Recipes Functions
function openSharedRecipesModal() {
  if (!AppState.currentUser) {
    showErrorMessage('Please sign in to access shared recipes');
    return;
  }
  
  document.getElementById('shared-recipes-modal').classList.remove('hidden');
  renderCommunityIdentity();
  populateShareRecipeSelect();
  loadSharedRecipes();
}

function renderCommunityIdentity() {
  var el = document.getElementById('community-identity');
  if (!el) return;
  var name = AppState.profile && AppState.profile.displayName;
  el.innerHTML = name
    ? 'Posting as <strong>' + escapeHtml(name) + '</strong> · <button class="btn-link" onclick="openUsernameModal()">change</button>'
    : '<button class="btn-link" onclick="openUsernameModal()">Set a display name</button> to post a recipe.';
}

function closeSharedRecipesModal() {
  document.getElementById('shared-recipes-modal').classList.add('hidden');
}

function populateShareRecipeSelect() {
  const select = document.getElementById('share-recipe-select');
  select.innerHTML = '<option value="">Select a recipe to share...</option>';
  
  AppState.recipes.forEach(recipe => {
    const option = document.createElement('option');
    option.value = recipe.id;
    option.textContent = recipe.name;
    select.appendChild(option);
  });
}

async function shareRecipe() {
  const recipeId = document.getElementById('share-recipe-select').value;
  if (!recipeId) {
    showErrorMessage('Please select a recipe to share');
    return;
  }
  
  const recipe = AppState.recipes.find(r => String(r.id) === String(recipeId));
  if (!recipe) {
    showErrorMessage('Recipe not found');
    return;
  }
  
  try {
    const sharedRecipe = {
      ...recipe,
      sharedBy: AppState.currentUser.email,
      sharedAt: new Date().toISOString(),
      originalId: recipe.id
    };
    
    // Remove the original ID to avoid conflicts
    delete sharedRecipe.id;
    
    await window.firebase.addDoc(window.firebase.collection(window.firebase.db, 'sharedRecipes'), JSON.parse(JSON.stringify(sharedRecipe)));
    showSuccessMessage('Recipe shared successfully!');
    loadSharedRecipes();
  } catch (error) {
    console.error('Error sharing recipe:', error);
    showErrorMessage('Failed to share recipe: ' + error.message);
  }
}

async function loadSharedRecipes() {
  try {
    const sharedRecipesRef = window.firebase.collection(window.firebase.db, 'sharedRecipes');
    const q = window.firebase.query(sharedRecipesRef, window.firebase.orderBy('sharedAt', 'desc'));
    const querySnapshot = await window.firebase.getDocs(q);
    
    const sharedRecipesList = document.getElementById('shared-recipes-list');
    sharedRecipesList.innerHTML = '';
    
    if (querySnapshot.empty) {
      sharedRecipesList.innerHTML = '<p style="text-align: center; color: var(--color-text-secondary);">No shared recipes available</p>';
      return;
    }
    
    querySnapshot.forEach((doc) => {
      const recipe = doc.data();
      const recipeItem = document.createElement('div');
      recipeItem.className = 'shared-recipe-item';
      recipeItem.innerHTML = `
        <div class="shared-recipe-info">
          <h4>${escapeHtml(recipe.name)}</h4>
          <p>by ${escapeHtml(recipe.authorName || 'A meal prepper')} • ${escapeHtml(recipe.category || '')} • ${Number(recipe.servings) || 0} servings</p>
        </div>
        <button class="btn btn--primary btn--sm" onclick="importSharedRecipe('${doc.id}')">Save</button>
      `;
      sharedRecipesList.appendChild(recipeItem);
    });
  } catch (error) {
    console.error('Error loading shared recipes:', error);
    showErrorMessage('Failed to load shared recipes: ' + error.message);
  }
}

// Recursively remove HTML tag delimiters from every string in a value. Applied
// to shared recipes on import so a malicious payload in ANY field (name,
// instructions, ingredient names, etc.) can't persist into our own recipes,
// which are rendered via innerHTML in many places.
function stripTagsDeep(value) {
  if (typeof value === 'string') return value.replace(/[<>]/g, '');
  if (Array.isArray(value)) return value.map(stripTagsDeep);
  if (value && typeof value === 'object') {
    var out = {};
    Object.keys(value).forEach(function(k) { out[k] = stripTagsDeep(value[k]); });
    return out;
  }
  return value;
}

async function importSharedRecipe(sharedRecipeId) {
  try {
    const docRef = window.firebase.doc(window.firebase.db, 'sharedRecipes', sharedRecipeId);
    const docSnap = await window.firebase.getDoc(docRef);
    
    if (docSnap.exists()) {
      const sharedRecipe = docSnap.data();
      
      // Create a new recipe with a unique ID
      const newRecipe = {
        ...sharedRecipe,
        id: generateId(),
        name: sharedRecipe.name + ' (Saved)'
      };

      // Strip community/shared-specific fields — this is now your own recipe.
      delete newRecipe.sharedAt;
      delete newRecipe.originalId;
      delete newRecipe.authorId;
      delete newRecipe.authorName;
      delete newRecipe.sharedBy;
      delete newRecipe.privacy;
      delete newRecipe.familyGroupId;

      // Sanitize all fields before storing — this recipe came from another user.
      AppState.recipes.push(stripTagsDeep(newRecipe));
      saveData();
      renderRecipes();
      showSuccessMessage('Saved to your recipes! 🎉');
      closeSharedRecipesModal();
    }
  } catch (error) {
    console.error('Error importing shared recipe:', error);
    showErrorMessage('Failed to import recipe: ' + error.message);
  }
}

// Global functions for shared recipes
window.openSharedRecipesModal = openSharedRecipesModal;
window.closeSharedRecipesModal = closeSharedRecipesModal;
window.shareRecipe = shareRecipe;
window.importSharedRecipe = importSharedRecipe;

// Family Sharing Functions
function openFamilySharingModal() {
  if (!AppState.currentUser) {
    showErrorMessage('Please sign in to access family sharing');
    return;
  }
  
  document.getElementById('family-sharing-modal').classList.remove('hidden');
  loadFamilyMembers();
}

function closeFamilySharingModal() {
  document.getElementById('family-sharing-modal').classList.add('hidden');
}

async function inviteFamilyMember() {
  const email = document.getElementById('family-email').value.trim();
  if (!email) {
    showErrorMessage('Please enter an email address');
    return;
  }
  
  if (email === AppState.currentUser.email) {
    showErrorMessage('You cannot invite yourself');
    return;
  }
  
  try {
    const invitation = {
      fromUser: AppState.currentUser.email,
      toEmail: email,
      status: 'pending',
      createdAt: new Date().toISOString(),
      familyGroupId: AppState.currentUser.uid
    };
    
    await window.firebase.addDoc(window.firebase.collection(window.firebase.db, 'familyInvitations'), invitation);
    showSuccessMessage('Invitation sent successfully!');
    document.getElementById('family-email').value = '';
    loadFamilyMembers();
  } catch (error) {
    console.error('Error sending invitation:', error);
    showErrorMessage('Failed to send invitation: ' + error.message);
  }
}

async function loadFamilyMembers() {
  try {
    const invitationsRef = window.firebase.collection(window.firebase.db, 'familyInvitations');
    const q = window.firebase.query(invitationsRef, 
      window.firebase.where('familyGroupId', '==', AppState.currentUser.uid));
    const querySnapshot = await window.firebase.getDocs(q);
    
    const familyMembersList = document.getElementById('family-members-list');
    familyMembersList.innerHTML = '';
    
    if (querySnapshot.empty) {
      familyMembersList.innerHTML = '<p style="text-align: center; color: var(--color-text-secondary);">No family members yet</p>';
      return;
    }
    
    querySnapshot.forEach((doc) => {
      const invitation = doc.data();
      const memberItem = document.createElement('div');
      memberItem.className = 'family-member-item';
      memberItem.innerHTML = `
        <div class="family-member-info">
          <h4>${invitation.toEmail}</h4>
          <p>Invited ${new Date(invitation.createdAt).toLocaleDateString()}</p>
        </div>
        <div class="member-status ${invitation.status}">${invitation.status}</div>
      `;
      familyMembersList.appendChild(memberItem);
    });
  } catch (error) {
    console.error('Error loading family members:', error);
    showErrorMessage('Failed to load family members: ' + error.message);
  }
}

// Enhanced share recipe function with privacy options
async function shareRecipe() {
  const recipeId = document.getElementById('share-recipe-select').value;
  if (!recipeId) {
    showErrorMessage('Please select a recipe to share');
    return;
  }
  
  const recipe = AppState.recipes.find(r => String(r.id) === String(recipeId));
  if (!recipe) {
    showErrorMessage('Recipe not found');
    return;
  }

  // Post to the community feed AS a display name, never the raw email.
  const authorName = requireUsername();
  if (!authorName) return; // username modal opened; they can share again after

  try {
    const sharedRecipe = {
      ...recipe,
      authorId: AppState.currentUser.uid,
      authorName: authorName,
      sharedAt: new Date().toISOString(),
      originalId: recipe.id
    };

    // Don't leak the email or the local recipe id into the public feed.
    delete sharedRecipe.id;
    delete sharedRecipe.sharedBy;

    await window.firebase.addDoc(window.firebase.collection(window.firebase.db, 'sharedRecipes'), JSON.parse(JSON.stringify(sharedRecipe)));
    showSuccessMessage('Recipe shared to the community! 🎉');
    loadSharedRecipes();
  } catch (error) {
    console.error('Error sharing recipe:', error);
    showErrorMessage('Failed to share recipe: ' + error.message);
  }
}

// Load shared recipes the user is allowed to see: all public recipes plus
// their OWN family recipes. Uses two separate queries that the Firestore
// security rules can verify, then merges them. A single
// where('privacy','in',['public','family']) query would be rejected by the
// secure rules because it could return other users' family recipes.
async function loadSharedRecipes() {
  try {
    const fb = window.firebase;
    const ref = fb.collection(fb.db, 'sharedRecipes');
    // Everyone's shared recipes are public — one "newest first" query, which
    // needs no composite index (a single orderBy uses the automatic index).
    const snap = await fb.getDocs(fb.query(ref, fb.orderBy('sharedAt', 'desc')));

    const sharedRecipesList = document.getElementById('shared-recipes-list');
    sharedRecipesList.innerHTML = '';

    if (snap.empty) {
      sharedRecipesList.innerHTML = '<p style="text-align: center; color: var(--color-text-secondary);">No shared recipes yet — be the first to share one!</p>';
      return;
    }

    snap.forEach((doc) => {
      const recipe = doc.data();
      const recipeItem = document.createElement('div');
      recipeItem.className = 'shared-recipe-item';
      recipeItem.innerHTML = `
        <div class="shared-recipe-info">
          <h4>${escapeHtml(recipe.name)}</h4>
          <p>by ${escapeHtml(recipe.authorName || 'A meal prepper')} • ${escapeHtml(recipe.category || '')} • ${Number(recipe.servings) || 0} servings</p>
        </div>
        <button class="btn btn--primary btn--sm" onclick="importSharedRecipe('${doc.id}')">Save</button>
      `;
      sharedRecipesList.appendChild(recipeItem);
    });
  } catch (error) {
    console.error('Error loading shared recipes:', error);
    showErrorMessage('Failed to load shared recipes: ' + error.message);
  }
}

// Data Export Functions
async function exportAllData() {
  try {
    const allData = {
      user: {
        email: AppState.currentUser.email,
        uid: AppState.currentUser.uid,
        exportDate: new Date().toISOString()
      },
      recipes: AppState.recipes,
      weeklyPlan: AppState.weeklyPlan,
      groceryList: AppState.groceryList,
      nutritionGoals: AppState.nutritionGoals,
      customIngredients: AppState.customIngredients,
      customHacks: AppState.customHacks
    };
    
    const dataStr = JSON.stringify(allData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `meal-prep-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    showSuccessMessage('All data exported successfully!');
  } catch (error) {
    console.error('Error exporting data:', error);
    showErrorMessage('Failed to export data: ' + error.message);
  }
}

// Account Deletion Functions
function openDeleteAccountModal() {
  document.getElementById('delete-account-modal').classList.remove('hidden');
  
  // Enable/disable delete button based on confirmation text
  const confirmationInput = document.getElementById('delete-confirmation');
  const deleteBtn = document.getElementById('delete-account-btn');
  
  confirmationInput.addEventListener('input', () => {
    deleteBtn.disabled = confirmationInput.value !== 'DELETE';
  });
}

function closeDeleteAccountModal() {
  document.getElementById('delete-account-modal').classList.add('hidden');
  document.getElementById('delete-confirmation').value = '';
  document.getElementById('delete-account-btn').disabled = true;
}

async function deleteAccount() {
  const confirmation = document.getElementById('delete-confirmation').value;
  if (confirmation !== 'DELETE') {
    showErrorMessage('Please type "DELETE" to confirm');
    return;
  }
  
  try {
    // Delete user data from Firestore
    const userDocRef = window.firebase.doc(window.firebase.db, 'users', AppState.currentUser.uid);
    await window.firebase.deleteDoc(userDocRef);
    
    // Delete family invitations
    const invitationsRef = window.firebase.collection(window.firebase.db, 'familyInvitations');
    const q = window.firebase.query(invitationsRef, 
      window.firebase.where('familyGroupId', '==', AppState.currentUser.uid));
    const querySnapshot = await window.firebase.getDocs(q);
    
    const deletePromises = querySnapshot.docs.map(doc => 
      window.firebase.deleteDoc(doc.ref)
    );
    await Promise.all(deletePromises);
    
    // Delete user's shared recipes
    const sharedRecipesRef = window.firebase.collection(window.firebase.db, 'sharedRecipes');
    const sharedQ = window.firebase.query(sharedRecipesRef, 
      window.firebase.where('sharedBy', '==', AppState.currentUser.email));
    const sharedQuerySnapshot = await window.firebase.getDocs(sharedQ);
    
    const deleteSharedPromises = sharedQuerySnapshot.docs.map(doc => 
      window.firebase.deleteDoc(doc.ref)
    );
    await Promise.all(deleteSharedPromises);
    
    // Delete the user account
    await AppState.currentUser.delete();
    
    showSuccessMessage('Account deleted successfully');
    closeDeleteAccountModal();
    
    // Clear local data and redirect to sign in
    AppState.currentUser = null;
    updateAuthUI();
    clearLocalStorage();
    renderRecipes();
    renderWeeklyPlanner();
    renderStorageGuide();
    renderCookingHacks();
    
  } catch (error) {
    console.error('Error deleting account:', error);
    showErrorMessage('Failed to delete account: ' + error.message);
  }
}

// Global functions for new security features
window.openFamilySharingModal = openFamilySharingModal;
window.closeFamilySharingModal = closeFamilySharingModal;
window.inviteFamilyMember = inviteFamilyMember;
window.exportAllData = exportAllData;
window.openDeleteAccountModal = openDeleteAccountModal;
window.closeDeleteAccountModal = closeDeleteAccountModal;
window.deleteAccount = deleteAccount;

// Setup authentication form handlers
function setupAuthFormHandlers() {
  // Login form
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    await signIn(email, password);
  });
  
  // Signup form
  document.getElementById('signup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    const confirmPassword = document.getElementById('signup-confirm-password').value;
    
    if (password !== confirmPassword) {
      showErrorMessage('Passwords do not match');
      return;
    }
    
    await signUp(email, password);
  });
}

// Setup online/offline listeners
function setupOnlineOfflineListeners() {
  window.addEventListener('online', () => {
    AppState.isOnline = true;
    showSuccessMessage('Back online! Syncing data...');
    updateSyncIndicator();
    if (AppState.currentUser) {
      saveToFirestore();
      setupRealtimeListeners();
    }
  });

  window.addEventListener('offline', () => {
    AppState.isOnline = false;
    showErrorMessage('You are offline. Changes will be saved locally.');
    updateSyncIndicator();
  });
}

// Mobile Enhancement Functions
function setupMobileEnhancements() {
  // Add touch feedback to meal slots
  const mealSlots = document.querySelectorAll('.meal-slot');
  mealSlots.forEach(slot => {
    slot.addEventListener('touchstart', function() {
      this.classList.add('touch-active');
    });
    
    slot.addEventListener('touchend', function() {
      setTimeout(() => {
        this.classList.remove('touch-active');
      }, 150);
    });
  });
  
  // Add haptic feedback for supported devices
  function addHapticFeedback() {
    if ('vibrate' in navigator) {
      navigator.vibrate(50);
    }
  }
  
  // Add haptic feedback to important actions
  const importantButtons = document.querySelectorAll('.btn--primary, .meal-slot, .grocery-checkbox');
  importantButtons.forEach(button => {
    button.addEventListener('click', addHapticFeedback);
  });
  
  // Improve scroll behavior for mobile
  document.body.style.webkitOverflowScrolling = 'touch';
  
  // Add pull-to-refresh functionality
  let startY = 0;
  let currentY = 0;
  let isPulling = false;
  
  document.addEventListener('touchstart', function(e) {
    if (window.scrollY === 0) {
      startY = e.touches[0].clientY;
      isPulling = true;
    }
  });
  
  document.addEventListener('touchmove', function(e) {
    if (isPulling) {
      currentY = e.touches[0].clientY;
      const pullDistance = currentY - startY;
      
      if (pullDistance > 100) {
        // Trigger refresh
        location.reload();
        isPulling = false;
      }
    }
  });
  
  document.addEventListener('touchend', function() {
    isPulling = false;
  });
}

// Initialize mobile enhancements when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
  // Check if device is mobile
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  
  if (isMobile) {
    setupMobileEnhancements();
    document.body.classList.add('mobile-device');
  }
});

// Recipe Photo Management
let currentRecipePhoto = null;

// Photos are NOT stored in the main user document (that would blow Firestore's
// 1 MiB doc limit and break ALL of a user's data). Instead each recipe's photo
// lives in its own doc at users/{uid}/photos/{recipeId}. This cache holds the
// data URLs in memory so rendering/editing code can keep using recipe.photo.
var recipePhotoCache = {}; // { recipeIdString: dataUrl }

// Shrink an image (max dimension + JPEG quality) so each photo doc stays well
// under 1 MiB and storage/bandwidth stay small. Resolves to a data URL.
function compressImage(dataUrl, maxDim, quality) {
  return new Promise(function(resolve) {
    var img = new Image();
    img.onload = function() {
      var w = img.width, h = img.height;
      if (w > maxDim || h > maxDim) {
        if (w >= h) { h = Math.round(h * maxDim / w); w = maxDim; }
        else { w = Math.round(w * maxDim / h); h = maxDim; }
      }
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      try { resolve(canvas.toDataURL('image/jpeg', quality)); }
      catch (e) { resolve(dataUrl); }
    };
    img.onerror = function() { resolve(dataUrl); };
    img.src = dataUrl;
  });
}

// Re-attach cached photos to AppState.recipes (after a load or a snapshot that
// replaced the recipes array with photo-less copies from the main doc).
function attachPhotosFromCache() {
  (AppState.recipes || []).forEach(function(r) {
    var k = String(r.id);
    if (recipePhotoCache[k]) r.photo = recipePhotoCache[k];
  });
}

// Seed the cache from any inline photos already on recipes (localStorage/legacy).
function cacheInlinePhotos() {
  (AppState.recipes || []).forEach(function(r) {
    if (r.photo && typeof r.photo === 'string') recipePhotoCache[String(r.id)] = r.photo;
  });
}

function savePhotoDoc(recipeId, dataUrl) {
  recipePhotoCache[String(recipeId)] = dataUrl;
  if (!AppState.currentUser || !AppState.isOnline || !window.firebase) return;
  try {
    var ref = window.firebase.doc(window.firebase.db, 'users', AppState.currentUser.uid, 'photos', String(recipeId));
    window.firebase.setDoc(ref, { data: dataUrl }).catch(function(e) { console.error('Photo save failed:', e); });
  } catch (e) { console.error('Photo save failed:', e); }
}

function deletePhotoDoc(recipeId) {
  delete recipePhotoCache[String(recipeId)];
  if (!AppState.currentUser || !AppState.isOnline || !window.firebase) return;
  try {
    var ref = window.firebase.doc(window.firebase.db, 'users', AppState.currentUser.uid, 'photos', String(recipeId));
    window.firebase.deleteDoc(ref).catch(function(e) { console.error('Photo delete failed:', e); });
  } catch (e) { console.error('Photo delete failed:', e); }
}

// Loads all of the user's photo docs into the cache. Returns a set of ids found.
async function loadPhotoDocsIntoCache() {
  var found = {};
  if (!AppState.currentUser || !AppState.isOnline || !window.firebase) return found;
  try {
    var snap = await window.firebase.getDocs(
      window.firebase.collection(window.firebase.db, 'users', AppState.currentUser.uid, 'photos')
    );
    snap.forEach(function(d) {
      var data = d.data();
      if (data && data.data) { recipePhotoCache[d.id] = data.data; found[d.id] = true; }
    });
  } catch (e) { console.error('Photo load failed:', e); }
  return found;
}

function handlePhotoUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  // Validate file type
  if (!file.type.startsWith('image/')) {
    showErrorMessage('Please select a valid image file.');
    return;
  }

  // Accept larger originals now — we compress before storing.
  if (file.size > 15 * 1024 * 1024) {
    showErrorMessage('Image file is too large. Please select an image smaller than 15MB.');
    return;
  }

  const reader = new FileReader();
  reader.onload = function(e) {
    // Compress to ~1000px / JPEG 0.7 so the stored photo stays well under 1 MiB.
    compressImage(e.target.result, 1000, 0.7).then(function(compressed) {
      currentRecipePhoto = compressed;
      showPhotoPreview(compressed);
    });
  };
  reader.readAsDataURL(file);
}

function showPhotoPreview(imageSrc) {
  const preview = document.getElementById('photo-preview');
  const previewImage = document.getElementById('preview-image');
  
  previewImage.src = imageSrc;
  preview.style.display = 'block';
}

function removePhoto() {
  currentRecipePhoto = null;
  document.getElementById('recipe-photo').value = '';
  document.getElementById('photo-preview').style.display = 'none';
}

function clearRecipeForm() {
  document.getElementById('recipe-form').reset();
  document.getElementById('ingredients-list').innerHTML = '';
  removePhoto();
  AppState.currentEditingRecipe = null;
}

// ── Dark Mode ─────────────────────────────────────────────────────────────────

function toggleDarkMode() {
  const current = document.documentElement.getAttribute('data-color-scheme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-color-scheme', next);
  localStorage.setItem('colorScheme', next);
  updateThemeToggleIcon();
}

function updateThemeToggleIcon() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  const isDark = document.documentElement.getAttribute('data-color-scheme') === 'dark';
  btn.textContent = isDark ? '☀️' : '🌙';
  btn.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
}

// ── Grocery List — Print & Copy ───────────────────────────────────────────────

function getGroceryByCategory() {
  const categories = {};
  AppState.groceryList.forEach(item => {
    if (!categories[item.category]) categories[item.category] = [];
    categories[item.category].push(item);
  });
  return categories;
}

function printGroceryList() {
  if (AppState.groceryList.length === 0) {
    showErrorMessage('Your grocery list is empty — generate it from the Weekly Planner first.');
    return;
  }

  const categories = getGroceryByCategory();
  const date = new Date().toLocaleDateString('en-PH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const rows = Object.keys(categories).map(cat =>
    '<h3>' + cat + '</h3>' +
    categories[cat].map(item =>
      '<div class="gp-item"><span class="gp-box"></span><span>' +
      (item.quantity ? formatQuantity(item.quantity) + ' ' + (item.unit || '') + ' ' : '') +
      '<strong>' + escapeHtml(item.name) + '</strong></span></div>'
    ).join('')
  ).join('');

  // Print the MAIN window (reliable on mobile — iframe/popup printing is flaky on
  // iOS Safari). We drop a print-only area into the page; @media print hides
  // everything else and shows just this.
  let area = document.getElementById('grocery-print-area');
  if (!area) {
    area = document.createElement('div');
    area.id = 'grocery-print-area';
    document.body.appendChild(area);
  }
  area.innerHTML = '<h1>🛒 Grocery List</h1><p class="gp-date">' + date + '</p>' + rows;

  document.body.classList.add('printing-grocery');
  const cleanup = function () {
    document.body.classList.remove('printing-grocery');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  setTimeout(cleanup, 60000); // safety net if afterprint never fires
  setTimeout(function () { window.print(); }, 80);
}

function copyGroceryList() {
  if (AppState.groceryList.length === 0) {
    showErrorMessage('Your grocery list is empty — generate it from the Weekly Planner first.');
    return;
  }

  const categories = getGroceryByCategory();
  const date = new Date().toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });

  const lines = [`🛒 Grocery List — ${date}`, ''];
  Object.keys(categories).forEach(cat => {
    lines.push(cat.toUpperCase());
    categories[cat].forEach(item => {
      lines.push(`• ${formatQuantity(item.quantity)} ${item.unit} ${item.name}`);
    });
    lines.push('');
  });

  copyTextToClipboard(lines.join('\n'),
    () => showSuccessMessage('Grocery list copied! Paste it into WhatsApp or Notes.'),
    () => showErrorMessage('Could not copy — try selecting and copying the list manually.'));
}

// Clipboard with a fallback: navigator.clipboard isn't available in every mobile
// browser/context, so fall back to a hidden textarea + execCommand.
function copyTextToClipboard(text, onOk, onErr) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(onOk, () => fallbackCopyText(text, onOk, onErr));
  } else {
    fallbackCopyText(text, onOk, onErr);
  }
}

function fallbackCopyText(text, onOk, onErr) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    ok ? onOk() : onErr();
  } catch (e) {
    onErr();
  }
}

// ── Cook Day / Prep Mode ──────────────────────────────────────────────────────

let prepCheckState = {};

function openPrepMode() {
  const recipeUsage = {};
  Object.values(AppState.weeklyPlan).forEach(day => {
    ['breakfast', 'lunch', 'dinner'].forEach(meal => {
      if (day[meal]) recipeUsage[day[meal]] = (recipeUsage[day[meal]] || 0) + 1;
    });
    (day.snacks || []).forEach(id => {
      recipeUsage[id] = (recipeUsage[id] || 0) + 1;
    });
  });

  const ids = Object.keys(recipeUsage);
  if (ids.length === 0) {
    showErrorMessage('Your week is empty — add some meals to the planner first.');
    return;
  }

  prepCheckState = {};
  const recipes = ids.map(id => AppState.recipes.find(r => String(r.id) === String(id))).filter(Boolean);

  const cards = recipes.map(recipe => {
    const count = recipeUsage[recipe.id];
    const ingredients = recipe.baseIngredients || recipe.ingredients || [];
    const steps = parseInstructionSteps(recipe.instructions || '');

    const ingHTML = ingredients.map((ing, i) => {
      const key = `${recipe.id}-ing-${i}`;
      prepCheckState[key] = false;
      const qty = ing.baseQuantity || ing.quantity || '';
      return `
        <label class="prep-check-row" onclick="togglePrepCheck('${key}')">
          <input type="checkbox" id="chk-${key}" onchange="togglePrepCheck('${key}')">
          <span>${ing.name}${qty ? ' — ' + qty + ' ' + (ing.unit || '') : ''}</span>
        </label>`;
    }).join('');

    const stepsHTML = steps.map((step, i) => {
      const key = `${recipe.id}-step-${i}`;
      prepCheckState[key] = false;
      return `
        <label class="prep-check-row" onclick="togglePrepCheck('${key}')">
          <input type="checkbox" id="chk-${key}" onchange="togglePrepCheck('${key}')">
          <span>${step}</span>
        </label>`;
    }).join('');

    return `
      <div class="prep-recipe-card">
        <div class="prep-recipe-header">
          <strong>${recipe.name}</strong>
          <span class="prep-usage-badge">×${count} this week</span>
        </div>
        ${ingHTML ? `<p class="prep-section-label">Ingredients</p>${ingHTML}` : ''}
        ${stepsHTML ? `<p class="prep-section-label">Steps</p>${stepsHTML}` : ''}
      </div>`;
  }).join('');

  document.getElementById('prep-mode-body').innerHTML = cards;
  updatePrepProgress();
  document.getElementById('prep-mode-modal').classList.remove('hidden');
}

function parseInstructionSteps(text) {
  if (!text) return [];
  // Split on newlines first
  let lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  // If single long line with numbered steps inline, split on "1.", "2." etc.
  if (lines.length === 1 && /\d+\./.test(lines[0])) {
    lines = lines[0].split(/(?=\d+\.)/).map(l => l.trim()).filter(Boolean);
  }
  return lines;
}

function togglePrepCheck(key) {
  prepCheckState[key] = !prepCheckState[key];
  const chk = document.getElementById('chk-' + key);
  if (chk) chk.checked = prepCheckState[key];
  const label = chk ? chk.closest('label') : null;
  if (label) label.style.opacity = prepCheckState[key] ? '0.45' : '1';
  updatePrepProgress();
}

function updatePrepProgress() {
  const keys = Object.keys(prepCheckState);
  const done = keys.filter(k => prepCheckState[k]).length;
  const pct = keys.length ? Math.round((done / keys.length) * 100) : 0;
  document.getElementById('prep-progress-bar').style.width = pct + '%';
  document.getElementById('prep-progress-label').textContent = `${done} / ${keys.length} done`;
}

function closePrepMode() {
  document.getElementById('prep-mode-modal').classList.add('hidden');
  prepCheckState = {};
}

// ── CSV Import ────────────────────────────────────────────────────────────────

let csvParsedRecipes = [];

function importFromCSV() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv';
  input.onchange = function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(ev) {
      try {
        const recipes = parseCSVToRecipes(ev.target.result);
        if (recipes.length === 0) {
          showErrorMessage('No valid recipes found in the CSV. Make sure the file has a header row and at least one recipe row.');
          return;
        }
        openCSVPreviewModal(recipes);
      } catch (err) {
        showErrorMessage('Failed to parse CSV: ' + err.message);
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

function parseCSVRow(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseCSVToRecipes(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('CSV must have a header row and at least one recipe.');

  const headers = parseCSVRow(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, '_'));
  const recipes = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVRow(lines[i]);
    if (fields.every(f => !f)) continue;

    const row = {};
    headers.forEach((h, idx) => { row[h] = fields[idx] || ''; });

    const name = (row.name || row.recipe_name || '').trim();
    if (!name) continue;

    const servings = parseInt(row.servings) || 1;
    const cost = parseFloat(row.cost || row.estimated_cost) || 0;

    const baseIngredients = (row.ingredients || '').split('|').map(part => {
      const [ingName, qty, unit, cat] = part.split(':');
      return {
        name: (ingName || '').trim(),
        baseQuantity: parseFloat(qty) || 1,
        unit: (unit || 'piece').trim(),
        category: (cat || 'Other').trim()
      };
    }).filter(ing => ing.name);

    recipes.push({
      id: Date.now() + i,
      name,
      category: (row.category || 'Main Dish').trim(),
      basePrepTime: parseInt(row.prep_time) || 0,
      baseCookTime: parseInt(row.cook_time) || 0,
      baseServings: servings,
      currentServings: servings,
      fridgeLife: parseInt(row.fridge_life) || 3,
      freezerLife: parseInt(row.freezer_life) || 30,
      estimatedCost: cost,
      costPerServing: cost / servings,
      storageNotes: (row.storage_notes || '').trim(),
      instructions: (row.instructions || '').trim(),
      photo: null,
      baseIngredients
    });
  }

  return recipes;
}

function openCSVPreviewModal(recipes) {
  csvParsedRecipes = recipes;

  const rows = recipes.map(r => `
    <tr style="border-bottom:1px solid var(--border-color,#e0e0e0);">
      <td style="padding:0.5rem 0.75rem;">${r.name}</td>
      <td style="padding:0.5rem 0.75rem;">${r.category}</td>
      <td style="padding:0.5rem 0.75rem;">${r.baseServings}</td>
      <td style="padding:0.5rem 0.75rem;">${r.baseIngredients.length} item${r.baseIngredients.length !== 1 ? 's' : ''}</td>
    </tr>`).join('');

  document.getElementById('csv-preview-body').innerHTML = `
    <p style="margin-bottom:1rem;">Found <strong>${recipes.length}</strong> recipe${recipes.length !== 1 ? 's' : ''} — these will be added to your existing recipes.</p>
    <div style="max-height:300px;overflow-y:auto;border:1px solid var(--border-color,#e0e0e0);border-radius:8px;">
      <table style="width:100%;border-collapse:collapse;font-size:0.875rem;">
        <thead>
          <tr style="background:var(--surface-secondary,#f5f5f5);position:sticky;top:0;">
            <th style="padding:0.5rem 0.75rem;text-align:left;border-bottom:1px solid var(--border-color,#e0e0e0);">Name</th>
            <th style="padding:0.5rem 0.75rem;text-align:left;border-bottom:1px solid var(--border-color,#e0e0e0);">Category</th>
            <th style="padding:0.5rem 0.75rem;text-align:left;border-bottom:1px solid var(--border-color,#e0e0e0);">Servings</th>
            <th style="padding:0.5rem 0.75rem;text-align:left;border-bottom:1px solid var(--border-color,#e0e0e0);">Ingredients</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;

  document.getElementById('confirm-csv-import-btn').textContent = `Import ${recipes.length} Recipe${recipes.length !== 1 ? 's' : ''}`;
  document.getElementById('csv-preview-modal').classList.remove('hidden');
}

function closeCSVPreviewModal() {
  document.getElementById('csv-preview-modal').classList.add('hidden');
  csvParsedRecipes = [];
}

function confirmCSVImport() {
  if (!csvParsedRecipes.length) return;
  AppState.recipes.push(...csvParsedRecipes);
  saveData();
  renderRecipes();
  closeCSVPreviewModal();
  showSuccessMessage(`${csvParsedRecipes.length} recipe${csvParsedRecipes.length !== 1 ? 's' : ''} imported successfully!`);
}

// ── Week Template ─────────────────────────────────────────────────────────────

const WEEK_TEMPLATE_KEY = 'mealPrepWeekTemplate';

function saveWeekAsTemplate() {
  const hasAnything = Object.values(AppState.weeklyPlan).some(day =>
    day.breakfast || day.lunch || day.dinner || day.snacks.length > 0
  );
  if (!hasAnything) {
    showErrorMessage('Your week is empty — add some meals before saving.');
    return;
  }
  localStorage.setItem(WEEK_TEMPLATE_KEY, JSON.stringify(AppState.weeklyPlan));
  document.getElementById('load-week-template-btn').disabled = false;
  showSuccessMessage('Week saved! Use "Load Saved Week" next week to restore it.');
}

function loadWeekTemplate() {
  const saved = localStorage.getItem(WEEK_TEMPLATE_KEY);
  if (!saved) return;
  if (!confirm('This will replace your current week\'s plan with the saved one. Continue?')) return;
  AppState.weeklyPlan = JSON.parse(saved);
  saveData();
  renderWeeklyPlanner();
  generateGroceryList();
  showSuccessMessage('Saved week loaded successfully!');
}

function initWeekTemplateButton() {
  if (localStorage.getItem(WEEK_TEMPLATE_KEY)) {
    const btn = document.getElementById('load-week-template-btn');
    if (btn) btn.disabled = false;
  }
}

function downloadCSVTemplate() {
  const header = 'name,category,prep_time,cook_time,servings,fridge_life,freezer_life,cost,storage_notes,instructions,ingredients';
  const example = '"Chicken Adobo","Main Dish",10,30,4,3,30,200,"Keep refrigerated","1. Brown chicken. 2. Add soy sauce and vinegar. 3. Simmer 20 mins.","chicken:500:g:Protein|soy sauce:60:ml:Condiment|garlic:4:cloves:Vegetable"';
  const blob = new Blob([header + '\n' + example], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'recipe-import-template.csv';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
// â”€â”€ Paste Recipe Import â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function openPasteRecipeModal() {
  document.getElementById('paste-recipe-text').value = '';
  document.getElementById('paste-recipe-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('paste-recipe-text').focus(), 50);
}

function closePasteRecipeModal() {
  document.getElementById('paste-recipe-modal').classList.add('hidden');
}

function parseAndImportRecipe() {
  const text = document.getElementById('paste-recipe-text').value.trim();
  if (!text) return;

  const parsed = parseRecipeText(text);

  closePasteRecipeModal();
  AppState.currentEditingRecipe = null;
  document.getElementById('modal-title').textContent = 'Add New Recipe';
  clearRecipeForm();
  removePhoto();
  document.getElementById('recipe-modal').classList.remove('hidden');

  document.getElementById('recipe-name').value = parsed.name;
  document.getElementById('recipe-category').value = parsed.category;
  document.getElementById('prep-time').value = parsed.prepTime || 15;
  document.getElementById('cook-time').value = parsed.cookTime || 30;
  document.getElementById('servings').value = parsed.servings || 4;
  document.getElementById('fridge-life').value = 3;
  document.getElementById('freezer-life').value = 30;
  document.getElementById('instructions').value = parsed.instructions;

  const ingredientsList = document.getElementById('ingredients-list');
  ingredientsList.innerHTML = '';
  if (parsed.ingredients.length > 0) {
    parsed.ingredients.forEach(ing => addIngredientField(ing));
  } else {
    addIngredientField();
  }
}

function parseRecipeText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  let name = '';
  for (const line of lines) {
    const clean = line.replace(/[*_#]+/g, '').trim();
    if (clean.length > 3 && !/^(ingredients?|instructions?|directions?|method|notes?|tips?|print|jump|servings?|serves?|prep|cook|total|yield|calories|nutrition)/i.test(clean)) {
      name = clean;
      break;
    }
  }

  let servings = 4;
  const servMatch = text.match(/\b(?:serves?|makes?|yields?|servings?)[:\s]+(\d+)/i) ||
                    text.match(/(\d+)\s+(?:serving|portion|yield)s?\b/i);
  if (servMatch) servings = parseInt(servMatch[1]);

  function extractMins(re) {
    const m = text.match(re);
    if (!m) return 0;
    return /hr|hour/i.test(m[2]) ? parseInt(m[1]) * 60 : parseInt(m[1]);
  }
  const prepTime = extractMins(/prep(?:aration)?\s*(?:time)?[:\s]+(\d+)\s*(hr|hour|min)/i) || 15;
  const cookTime = extractMins(/cook(?:ing)?\s*(?:time)?[:\s]+(\d+)\s*(hr|hour|min)/i) || 30;

  let mode = 'none';
  const ingredientLines = [];
  const instructionLines = [];

  for (const line of lines) {
    if (/^ingredients?[:\s]*$/i.test(line)) { mode = 'ingredients'; continue; }
    if (/^(?:instructions?|directions?|method|how to make|steps?|procedure)[:\s]*$/i.test(line)) { mode = 'instructions'; continue; }

    if (mode === 'ingredients') {
      if (/^[A-Z][A-Z\s]{3,}[:\s]*$/.test(line) && line.length < 35) {
        if (/^(?:instructions?|directions?|method|how to|steps?)/i.test(line)) mode = 'instructions';
        continue;
      }
      const clean = line.replace(/^[-*]\s*/, '').replace(/^\d+\.\s*/, '').trim();
      if (clean) ingredientLines.push(clean);
    } else if (mode === 'instructions') {
      if (/^[A-Z][A-Z\s]{3,}[:\s]*$/.test(line) && line.length < 35) continue;
      const clean = line.replace(/^[-*]\s*/, '').trim();
      if (clean) instructionLines.push(clean);
    }
  }

  if (ingredientLines.length === 0) {
    for (const line of lines) {
      if (/^[\d]/.test(line) && /\d+\s+\w/.test(line)) {
        ingredientLines.push(line.replace(/^[-*]\s*/, '').trim());
      }
    }
  }
  if (instructionLines.length === 0) {
    for (const line of lines) {
      if (/^\d+[.)]\s/.test(line)) instructionLines.push(line);
    }
  }

  const ingredients = ingredientLines.map(parseIngredientLine).filter(Boolean);
  const instructions = instructionLines.join('\n');
  const category = guessRecipeCategory(name);

  return { name, servings, prepTime, cookTime, category, ingredients, instructions };
}

function parseFraction(str) {
  str = str.trim();
  const mixed = str.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return parseInt(mixed[1]) + parseInt(mixed[2]) / parseInt(mixed[3]);
  const frac = str.match(/^(\d+)\/(\d+)$/);
  if (frac) return parseInt(frac[1]) / parseInt(frac[2]);
  return parseFloat(str) || 1;
}

function normalizeUnit(raw) {
  if (!raw) return 'pieces';
  const u = raw.toLowerCase().replace(/\.$/, '');
  if (/^cups?$/.test(u)) return 'cups';
  if (/^(tbsp|tablespoons?)$/.test(u)) return 'tbsp';
  if (/^(tsp|teaspoons?)$/.test(u)) return 'tsp';
  if (/^(lbs?|pounds?)$/.test(u)) return 'lbs';
  if (/^(oz|ounces?)$/.test(u)) return 'oz';
  if (/^(g|grams?)$/.test(u)) return 'g';
  if (/^(kg|kilos?|kilograms?)$/.test(u)) return 'kg';
  if (/^(ml|milliliters?)$/.test(u)) return 'ml';
  if (/^(l|liters?|litres?)$/.test(u)) return 'L';
  if (/^(stalks?|stems?)$/.test(u)) return 'stalks';
  if (/^cloves?$/.test(u)) return 'cloves';
  if (/^cans?$/.test(u)) return 'can';
  if (/^(packs?|packets?)$/.test(u)) return 'pack';
  if (/^bunches?$/.test(u)) return 'bunches';
  return 'pieces';
}

function guessIngredientCategory(name) {
  const n = name.toLowerCase();
  if (/chicken|pork|beef|fish|tilapia|bangus|milkfish|shrimp|prawn|squid|crab|tuna|salmon|egg|tofu|meat|liver|sardine|galunggong|baboy|manok|baka/.test(n)) return 'Protein';
  if (/garlic|onion|ginger|tomato|potato|carrot|bell pepper|celery|cabbage|kangkong|sitaw|okra|eggplant|ampalaya|pechay|mushroom|broccoli|leek|chili|spinach|bok choy|kalabasa|squash|sibuyas|kamatis|kintsay/.test(n)) return 'Vegetable';
  if (/milk|cream|cheese|butter|yogurt|condensed|evaporated/.test(n)) return 'Dairy';
  if (/rice|flour|bread|pasta|noodles|corn|oats|pancit|bihon|sotanghon|canton|miki|wheat/.test(n)) return 'Grain';
  if (/banana|mango|calamansi|lemon|lime|apple|orange|pineapple|coconut|avocado|papaya|jackfruit|langka/.test(n)) return 'Fruit';
  return 'Pantry';
}

function guessRecipeCategory(name) {
  const n = name.toLowerCase();
  if (/breakfast|oatmeal|toast|pancake|tapsilog|longsilog|tocilog/.test(n)) return 'Breakfast';
  if (/salad|dip|side/.test(n)) return 'Snack';
  if (/cake|cookie|brownie|pudding|leche flan|maja|kalamay|polvoron|pie|dessert/.test(n)) return 'Dessert';
  return 'Main Dish';
}

function parseIngredientLine(line) {
  line = line.replace(/Â¼/g,'1/4').replace(/Â½/g,'1/2').replace(/Â¾/g,'3/4')
             .replace(/â…“/g,'1/3').replace(/â…”/g,'2/3').replace(/â…›/g,'1/8');

  const units = 'cups?|tbsp|tablespoons?|tsp|teaspoons?|lbs?|pounds?|oz|ounces?|grams?|g|kg|kilos?|kilograms?|ml|milliliters?|L|liters?|litres?|stalks?|stems?|cloves?|cans?|packs?|packets?|bunches?|pieces?|pcs|slices?|heads?|inches?|whole';
  const re = new RegExp('^(\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?)\\s+(' + units + ')\\.?\\s+(.+)', 'i');

  const m1 = line.match(re);
  if (m1) {
    const ingName = m1[3].replace(/[,;(].*/, '').trim();
    return { quantity: parseFraction(m1[1]), unit: normalizeUnit(m1[2]), name: ingName, category: guessIngredientCategory(ingName) };
  }

  const m2 = line.match(/^(\d+(?:\.\d+)?|\d+\/\d+|\d+\s+\d+\/\d+)\s+(.+)/);
  if (m2) {
    const ingName = m2[2].replace(/[,;(].*/, '').trim();
    return { quantity: parseFraction(m2[1]), unit: 'pieces', name: ingName, category: guessIngredientCategory(ingName) };
  }

  if (line.length > 1 && line.length < 80) {
    const ingName = line.replace(/[,;(].*/, '').trim();
    return { quantity: 1, unit: 'pieces', name: ingName, category: guessIngredientCategory(ingName) };
  }

  return null;
}

// â”€â”€ Pantry Tracker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function isInPantry(name) {
  const n = name.toLowerCase();
  return AppState.pantry.some(p => {
    const pn = p.name.toLowerCase();
    return n.includes(pn) || pn.includes(n);
  });
}

// Common household staples for one-tap pantry adding (PH context).
var COMMON_PANTRY_STAPLES = ['Rice', 'Garlic', 'Onion', 'Cooking Oil', 'Soy Sauce', 'Fish Sauce', 'Vinegar', 'Salt', 'Sugar', 'Black Pepper', 'Eggs', 'Ginger'];

function renderPantryQuickAdd() {
  var el = document.getElementById('pantry-quick-add');
  if (!el) return;
  var have = {};
  (AppState.pantry || []).forEach(function(p) { have[p.name.toLowerCase()] = true; });
  var chips = COMMON_PANTRY_STAPLES.filter(function(n) { return !have[n.toLowerCase()]; });
  el.innerHTML = chips.length === 0 ? '' :
    '<span class="pantry-quick-label">Quick add:</span>' +
    chips.map(function(n) {
      return '<button class="pantry-quick-chip" onclick="quickAddPantry(\'' + escJ(n) + '\')">+ ' + escapeHtml(n) + '</button>';
    }).join('');
}

function quickAddPantry(name) {
  if (AppState.pantry.some(function(p) { return p.name.toLowerCase() === name.toLowerCase(); })) return;
  var category = inferCategory(name);
  AppState.pantry.push({
    id: Date.now() + Math.random(),
    name: name,
    category: category,
    purchaseDate: todayISO(),
    shelfLifeDays: categoryShelfLife(category)
  });
  saveData();
  renderPantry();
}

function renderPantry() {
  const list = document.getElementById('pantry-list');
  const count = document.getElementById('pantry-count');
  renderPantryQuickAdd();
  if (!list) return;

  const n = AppState.pantry.length;
  count.textContent = n > 0 ? '(' + n + ' item' + (n !== 1 ? 's' : '') + ')' : '';

  if (n === 0) {
    list.innerHTML = emptyState('package', 'Your pantry is empty', 'Add ingredients you already have at home — cooking a recipe then deducts from your stock and tracks freshness.');
    return;
  }

  // Summary banner: expired / expiring soon (freshness) + running-low staples (stock)
  var expiredCount = 0, expiringCount = 0, lowCount = 0;
  AppState.pantry.forEach(function(p) {
    if (isStaple(p) && p.stockLevel === 'low') lowCount++;
    var dl = pantryDaysLeft(p);
    if (dl == null) return;
    if (dl < 0) expiredCount++;
    else if (dl <= FRESHNESS_WARN_DAYS) expiringCount++;
  });
  var banner = '';
  if (expiredCount || expiringCount || lowCount) {
    var parts = [];
    if (expiredCount) parts.push('<span class="fresh-dot fdot-red"></span> ' + expiredCount + ' expired');
    if (expiringCount) parts.push('<span class="fresh-dot fdot-amber"></span> ' + expiringCount + ' expiring soon');
    if (lowCount) parts.push('<span class="fresh-dot fdot-amber"></span> ' + lowCount + ' running low');
    banner = '<div class="pantry-fresh-summary ' + (expiredCount ? 'fresh-expired' : 'fresh-warn') + '">' +
             parts.join(' • ') + '</div>';
  }

  function effStorage(p) { return p.storage || inferStorage(p.name, p.category); }
  var WHERE = [['fridge', 'Fridge'], ['freezer', 'Freezer'], ['counter', 'Counter']];

  // Build one item's table rows: the main row, plus a collapsed storage-guide
  // detail row that expands inline (so you never have to leave the tab).
  function buildRows(p) {
    var fs = freshnessStatus(pantryDaysLeft(p));
    var staple = isStaple(p);
    var k = lookupPantryKnowledge(p.name) || genericStorageGuide(p);
    var safeId = String(p.id).replace(/[^a-zA-Z0-9_-]/g, '_');
    var expiryMode = p.dateMode === 'expiry';
    var dateVal = expiryMode ? (p.expiryDate || '') : (p.purchaseDate || '');
    var where = WHERE.map(function(w) {
      return '<option value="' + w[0] + '"' + (effStorage(p) === w[0] ? ' selected' : '') + '>' + w[1] + '</option>';
    }).join('');

    // Staples: a Low/OK/Full level (counting salt makes no sense).
    // Countable items: a numeric stock + unit.
    var stockCell;
    if (staple) {
      var lvl = p.stockLevel || 'ok';
      var lblMap = { full: 'Full', ok: 'OK', low: 'Low' };
      stockCell = '<button class="pt-level pt-level--' + lvl + '" onclick="cycleStapleLevel(\'' + p.id + '\')" title="Tap to change: Full → OK → Low">' + lblMap[lvl] + '</button>';
    } else {
      stockCell = '<input class="pt-stock" type="number" min="0" step="0.01" placeholder="—" value="' + (p.quantity != null ? p.quantity : '') + '" onchange="updatePantryQty(\'' + p.id + '\', this.value)">' + (p.unit ? ' <span class="pt-unit">' + escapeHtml(p.unit) + '</span>' : '');
    }

    var guideBtn = k ? ' <button class="pt-guide-btn" onclick="togglePantryGuide(\'' + safeId + '\')" title="Storage guide">' + icon('book-open') + '</button>' : '';

    var main = '<tr>' +
      '<td class="pt-name">' + escapeHtml(p.name) + guideBtn + '</td>' +
      '<td data-label="Stock">' + stockCell + '</td>' +
      '<td data-label="Where"><select class="pt-where" onchange="setPantryStorage(\'' + p.id + '\', this.value)">' + where + '</select></td>' +
      '<td class="pt-datecell" data-label="Date"><input class="pt-date" type="date" value="' + dateVal + '" onchange="updatePantryDate(\'' + p.id + '\', this.value)">' +
        '<button class="pt-datemode" onclick="togglePantryDateMode(\'' + p.id + '\')" title="Switch between bought date (uses shelf life) and a printed expiry date">' + (expiryMode ? 'expires' : 'bought') + '</button></td>' +
      '<td data-label="Status">' + (fs.label ? '<span class="pantry-fresh-badge ' + fs.cls + '">' + fs.icon + ' ' + fs.label + '</span>' : '<span class="pt-muted">—</span>') + '</td>' +
      '<td class="pt-center" data-label="Staple"><input type="checkbox" ' + (staple ? 'checked' : '') + ' onchange="togglePantryStaple(\'' + p.id + '\', this.checked)" title="Staple — tracked as Low/OK/Full, never deducted when cooking"></td>' +
      '<td class="pt-center pt-remove-cell"><button class="pantry-remove" onclick="removeFromPantry(\'' + p.id + '\')" title="Remove">×</button></td>' +
      '</tr>';

    var detail = '';
    if (k) {
      var d = '<div class="pantry-detail-row"><b>' + icon('package') + ' How to store:</b> ' + k.store + '</div>' +
              '<div class="pantry-detail-row"><b>' + icon('triangle-alert') + ' Signs it\'s bad:</b> ' + k.spoilage + '</div>' +
              '<div class="pantry-detail-row"><b>' + icon('search') + ' Freshness guide:</b> ' + k.freshness + '</div>' +
              (k.tip ? '<div class="pantry-detail-row pantry-tip">' + k.tip + '</div>' : '');
      detail = '<tr class="pt-detail hidden" id="ptdetail-' + safeId + '"><td colspan="7">' + d + '</td></tr>';
    }
    return main + detail;
  }

  var THEAD = '<thead><tr><th>Item</th><th>Stock</th><th>Where</th><th>Date</th><th>Status</th>' +
              '<th title="Staples are never deducted when you cook">Staple</th><th></th></tr></thead>';
  var groups = [
    { key: 'fridge', label: icon('refrigerator') + ' In the Fridge' },
    { key: 'freezer', label: icon('snowflake') + ' In the Freezer' },
    { key: 'counter', label: icon('archive') + ' Counter / Pantry' }
  ];

  var html = banner;
  groups.forEach(function(g) {
    var items = AppState.pantry.filter(function(p) { return effStorage(p) === g.key; })
      .sort(function(a, b) { return a.name.localeCompare(b.name); });
    if (items.length === 0) return;
    html += '<div class="fridge-subsection-title">' + g.label +
            ' <span class="fridge-subsection-count">(' + items.length + ')</span></div>';
    html += '<div class="pantry-table-wrap"><table class="pantry-table">' + THEAD +
            '<tbody>' + items.map(buildRows).join('') + '</tbody></table></div>';
  });
  list.innerHTML = html;
}

function setPantryStorage(id, storage) {
  var p = AppState.pantry.find(function(x) { return String(x.id) === String(id); });
  if (!p) return;
  p.storage = storage;
  saveData();
  renderPantry();
}

function togglePantryStaple(id, checked) {
  var p = AppState.pantry.find(function(x) { return String(x.id) === String(id); });
  if (!p) return;
  p.staple = !!checked;
  syncStapleToGrocery(p);   // un-stapling clears any auto "running low" entry
  saveData();
  renderPantry();
  renderGroceryList();
}

// Keep the grocery list in sync with a staple's level: a "low" staple shows up
// as a shopping item; raising it back to OK/Full removes that auto entry.
function syncStapleToGrocery(p) {
  AppState.groceryList = AppState.groceryList.filter(function(it) {
    return !(it.fromStaple && it.name.toLowerCase() === p.name.toLowerCase());
  });
  if (isStaple(p) && p.stockLevel === 'low') {
    AppState.groceryList.push({
      id: Date.now() + Math.random(),
      name: p.name,
      category: p.category || 'Pantry',
      quantity: null,
      unit: p.unit || '',
      sources: ['Running low'],
      checked: false,
      custom: true,
      fromStaple: true
    });
  }
}

// Tap-to-cycle a staple's stock level: Full → OK → Low → Full.
function cycleStapleLevel(id) {
  var p = AppState.pantry.find(function(x) { return String(x.id) === String(id); });
  if (!p) return;
  var order = ['full', 'ok', 'low'];
  p.stockLevel = order[(order.indexOf(p.stockLevel || 'ok') + 1) % order.length];
  syncStapleToGrocery(p);
  saveData();
  renderPantry();
  renderGroceryList();
}


// Persist edits to a pantry item's purchase date / shelf life, then re-render.
function updatePantryDate(id, value) {
  var p = AppState.pantry.find(function(x) { return String(x.id) === String(id); });
  if (!p) return;
  if (p.dateMode === 'expiry') {
    p.expiryDate = value || null;
  } else {
    p.purchaseDate = value || null;
    if (p.shelfLifeDays == null) p.shelfLifeDays = categoryShelfLife(p.category);
  }
  saveData();
  renderPantry();
}

// Flip an item between "bought date + shelf life" and a printed "expiry date".
function togglePantryDateMode(id) {
  var p = AppState.pantry.find(function(x) { return String(x.id) === String(id); });
  if (!p) return;
  p.dateMode = (p.dateMode === 'expiry') ? 'bought' : 'expiry';
  saveData();
  renderPantry();
}

function updatePantryShelf(id, value) {
  var p = AppState.pantry.find(function(x) { return String(x.id) === String(id); });
  if (!p) return;
  var days = parseInt(value, 10);
  p.shelfLifeDays = isNaN(days) ? null : days;
  saveData();
  renderPantry();
}

function updatePantryQty(id, value) {
  var p = AppState.pantry.find(function(x) { return String(x.id) === String(id); });
  if (!p) return;
  var q = parseFloat(value);
  p.quantity = isNaN(q) ? null : q;
  saveData();
  renderPantry();
}

// Expand/collapse an item's inline storage-guide row (no tab-switching needed).
function togglePantryGuide(safeId) {
  var el = document.getElementById('ptdetail-' + safeId);
  if (el) el.classList.toggle('hidden');
}

// Seed an empty pantry with common household staples once, so a new user just
// sets the stock they have instead of typing each item. Deterministic ids mean
// two devices seeding won't create duplicates (the cloud merge dedupes by id).
function seedPantryIfEmpty() {
  try { if (localStorage.getItem('mealPrepPantrySeeded')) return; } catch (e) {}
  if ((AppState.pantry || []).length > 0) {
    try { localStorage.setItem('mealPrepPantrySeeded', '1'); } catch (e) {}
    return;
  }
  COMMON_PANTRY_STAPLES.forEach(function(name) {
    var category = inferCategory(name);
    AppState.pantry.push({
      id: 'staple_' + name.toLowerCase().replace(/\s+/g, '_'),
      name: name,
      category: category,
      purchaseDate: null,
      shelfLifeDays: categoryShelfLife(category),
      quantity: null
    });
  });
  try { localStorage.setItem('mealPrepPantrySeeded', '1'); } catch (e) {}
  saveData();
}

// ── Cooked meal tracking ─────────────────────────────────────────────────────

// Staples (spices, condiments, salt, sugar, oil) are "always stocked" and never
// deducted when cooking. Default = Pantry category; per-item `staple` overrides.
function isStaple(p) {
  if (p.staple === true) return true;
  if (p.staple === false) return false;
  return (p.category || '').toLowerCase() === 'pantry';
}

// Fuzzy-match a recipe ingredient name to a pantry item (same matching style as
// findIngredientNutrition).
function findPantryMatch(ingredientName) {
  var n = (ingredientName || '').toLowerCase().trim();
  var norm = normalizeIngredientName(ingredientName);
  function m(pn, term) { return term && (pn.includes(term) || term.includes(pn)); }
  return AppState.pantry.find(function(p) {
    var pn = p.name.toLowerCase();
    return m(pn, n) || m(pn, norm);
  }) || null;
}

function capList(arr, max) {
  if (arr.length <= max) return arr.join(', ');
  return arr.slice(0, max).join(', ') + ' +' + (arr.length - max) + ' more';
}

// Subtract a cooked recipe's ingredients from the pantry. Skips staples, items
// not in the pantry, and tracked items with no quantity set. Reconciles units
// through the gram-bridge so kg/g/ml/pieces all line up. Returns a summary.
function deductIngredientsForRecipe(recipe) {
  var ingredients = recipe.baseIngredients || recipe.ingredients || [];
  var deducted = [], outOfStock = [];
  ingredients.forEach(function(ing) {
    var p = findPantryMatch(ing.name);
    if (!p) return;                                   // not in pantry
    if (isStaple(p)) return;                           // staple — never deducted
    if (p.quantity == null || isNaN(p.quantity)) return; // tracked but no quantity
    var scaledQty = calculateScaledQuantity(recipe, ing);
    if (!scaledQty || isNaN(scaledQty)) return;
    var gramsUsed = toGrams(scaledQty, ing.unit);
    var gramsPerPantryUnit = toGrams(1, p.unit) || 1;
    var used = gramsUsed / gramsPerPantryUnit;        // in the pantry item's unit
    if (used <= 0) return;
    p.quantity = parseFloat(Math.max(0, p.quantity - used).toFixed(2));
    deducted.push('−' + formatQuantity(used) + ' ' + (p.unit || '') + ' ' + p.name);
    if (p.quantity <= 0) outOfStock.push(p.name);
  });
  return { deducted: deducted, outOfStock: outOfStock };
}

// Mark a recipe as cooked today → create a tracked batch (defaults to fridge)
// AND deduct its ingredients from the pantry. Snapshots the recipe's
// fridge/freezer life so later recipe edits don't retroactively change batches.
function markRecipeCooked(recipeId) {
  var recipe = AppState.recipes.find(function(r) { return String(r.id) === String(recipeId); });
  if (!recipe) { showErrorMessage('Recipe not found'); return; }
  AppState.cookedMeals = AppState.cookedMeals || [];
  AppState.cookedMeals.push({
    id: 'cm_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    recipeId: String(recipe.id),
    name: recipe.name,
    cookedDate: todayISO(),
    storage: 'fridge',
    fridgeLife: recipe.fridgeLife || 0,
    freezerLife: recipe.freezerLife || 0
  });

  var sum = deductIngredientsForRecipe(recipe);

  saveData();
  renderCookedMeals();
  renderPantry();

  var msg = 'Added "' + recipe.name + '" to 🧊 My Fridge.';
  if (sum.deducted.length) msg += ' Deducted: ' + capList(sum.deducted, 4) + '.';
  else msg += ' (No tracked pantry items to deduct.)';
  if (sum.outOfStock.length) msg += ' ⚠️ Now out: ' + capList(sum.outOfStock, 4) + '.';
  showSuccessMessage(msg);
}

function cookedShelfLife(m) {
  return m.storage === 'freezer' ? (m.freezerLife || 0) : (m.fridgeLife || 0);
}

function setCookedStorage(id, storage) {
  var m = (AppState.cookedMeals || []).find(function(x) { return String(x.id) === String(id); });
  if (!m) return;
  m.storage = storage;
  saveData();
  renderCookedMeals();
}

function updateCookedDate(id, value) {
  var m = (AppState.cookedMeals || []).find(function(x) { return String(x.id) === String(id); });
  if (!m) return;
  m.cookedDate = value || todayISO();
  saveData();
  renderCookedMeals();
}

function removeCookedMeal(id) {
  AppState.cookedMeals = (AppState.cookedMeals || []).filter(function(x) { return String(x.id) !== String(id); });
  saveData();
  renderCookedMeals();
}

function renderCookedMeals() {
  var list = document.getElementById('cooked-meals-list');
  if (!list) return;
  var section = document.getElementById('cooked-meals-section');
  var meals = AppState.cookedMeals || [];

  if (meals.length === 0) {
    if (section) section.classList.add('hidden');
    list.innerHTML = '';
    return;
  }
  if (section) section.classList.remove('hidden');

  function buildCookedCard(m) {
    var dl = daysLeftFrom(m.cookedDate, cookedShelfLife(m));
    var fs = freshnessStatus(dl);
    var h = '<div class="cooked-card ' + fs.cls + '">';
    h += '<div class="cooked-card-main">';
    h += '<span class="cooked-name">' + icon('utensils') + ' ' + escapeHtml(m.name) + '</span>';
    if (fs.label) h += '<span class="cooked-badge">' + fs.icon + ' ' + fs.label + '</span>';
    h += '</div>';
    h += '<div class="cooked-card-meta">';
    h += '<label class="cooked-field" title="Date cooked">' + icon('chef-hat') + ' <input type="date" value="' + (m.cookedDate || '') + '" onchange="updateCookedDate(\'' + m.id + '\', this.value)"></label>';
    h += '<div class="cooked-storage-toggle">';
    h += '<button class="' + (m.storage === 'fridge' ? 'active' : '') + '" onclick="setCookedStorage(\'' + m.id + '\', \'fridge\')">' + icon('refrigerator') + ' Fridge ' + (m.fridgeLife || 0) + 'd</button>';
    h += '<button class="' + (m.storage === 'freezer' ? 'active' : '') + '" onclick="setCookedStorage(\'' + m.id + '\', \'freezer\')">' + icon('snowflake') + ' Freezer ' + (m.freezerLife || 0) + 'd</button>';
    h += '</div>';
    h += '<button class="cooked-remove" onclick="removeCookedMeal(\'' + m.id + '\')" title="Ate it / remove">' + icon('check') + ' Done</button>';
    h += '</div>';
    h += '</div>';
    return h;
  }

  var groups = [
    { key: 'fridge', label: icon('refrigerator') + ' In the Fridge' },
    { key: 'freezer', label: icon('snowflake') + ' In the Freezer' }
  ];
  var html = '';
  groups.forEach(function(g) {
    var items = meals.filter(function(m) { return (m.storage || 'fridge') === g.key; });
    if (items.length === 0) return;
    items.sort(function(a, b) {
      var da = daysLeftFrom(a.cookedDate, cookedShelfLife(a));
      var db = daysLeftFrom(b.cookedDate, cookedShelfLife(b));
      if (da == null) return 1;
      if (db == null) return -1;
      return da - db;
    });
    html += '<div class="fridge-subsection-title">' + g.label +
            ' <span class="fridge-subsection-count">(' + items.length + ')</span></div>';
    items.forEach(function(m) { html += buildCookedCard(m); });
  });
  list.innerHTML = html;
}

// ── Freshness alerts (app-open banner + Fridge tab badge) ────────────────────

// Counts of items needing attention across pantry + cooked meals.
function getFreshnessAlerts() {
  var pantry = { expired: 0, expiring: 0 };
  AppState.pantry.forEach(function(p) {
    var shelf = (p.shelfLifeDays != null) ? p.shelfLifeDays : categoryShelfLife(p.category);
    var dl = daysLeftFrom(p.purchaseDate, shelf);
    if (dl == null) return;
    if (dl < 0) pantry.expired++;
    else if (dl <= FRESHNESS_WARN_DAYS) pantry.expiring++;
  });
  var cooked = { expired: 0, expiring: 0 };
  (AppState.cookedMeals || []).forEach(function(m) {
    var dl = daysLeftFrom(m.cookedDate, cookedShelfLife(m));
    if (dl == null) return;
    if (dl < 0) cooked.expired++;
    else if (dl <= FRESHNESS_WARN_DAYS) cooked.expiring++;
  });
  return {
    pantry: pantry,
    cooked: cooked,
    expired: pantry.expired + cooked.expired,
    expiring: pantry.expiring + cooked.expiring
  };
}

var _freshnessBannerDismissed = false;

// On-open banner: appears above all tabs when something needs attention.
function renderFreshnessBanner() {
  var el = document.getElementById('freshness-alert-banner');
  if (!el) return;
  var a = getFreshnessAlerts();
  if (_freshnessBannerDismissed || (a.expired + a.expiring) === 0) {
    el.classList.add('hidden');
    return;
  }
  var parts = [];
  if (a.expired) parts.push('<span class="fresh-dot fdot-red"></span> ' + a.expired + ' expired');
  if (a.expiring) parts.push('<span class="fresh-dot fdot-amber"></span> ' + a.expiring + ' expiring soon');
  el.className = 'freshness-banner ' + (a.expired ? 'fresh-expired' : 'fresh-warn');
  el.innerHTML =
    '<span class="freshness-banner-text">' + icon('triangle-alert') + ' ' + parts.join(' · ') + '</span>' +
    '<span class="freshness-banner-actions">' +
      '<button class="freshness-banner-view" onclick="goToFreshnessTab()">View</button>' +
      '<button class="freshness-banner-close" onclick="dismissFreshnessBanner()" title="Dismiss">×</button>' +
    '</span>';
}

function dismissFreshnessBanner() {
  _freshnessBannerDismissed = true;
  var el = document.getElementById('freshness-alert-banner');
  if (el) el.classList.add('hidden');
}

function goToFreshnessTab() {
  dismissFreshnessBanner();
  showTab('fridge');
}

// Small count badge on the My Fridge tab.
function updateFreshnessBadges() {
  var a = getFreshnessAlerts();
  var count = a.expired + a.expiring;
  var btn = document.querySelector('.tab-btn[data-tab="fridge"]');
  if (!btn) return;
  var badge = btn.querySelector('.tab-badge');
  if (count <= 0) { if (badge) badge.remove(); return; }
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'tab-badge';
    btn.appendChild(badge);
  }
  badge.textContent = count;
  badge.classList.toggle('tab-badge--expired', a.expired > 0);
}

function togglePantryCard(safeId) {
  var detail = document.getElementById('pdetail-' + safeId);
  var btn = detail ? detail.parentElement.querySelector('.pantry-info-btn') : null;
  if (!detail) return;
  var hidden = detail.classList.toggle('hidden');
  if (btn) btn.textContent = hidden ? 'ℹ️ Guide' : '▲ Hide';
}

function togglePantrySection() {
  const body = document.getElementById('pantry-body');
  const icon = document.getElementById('pantry-toggle-icon');
  const isHidden = body.classList.toggle('hidden');
  icon.textContent = isHidden ? '▶' : '▼';
}

function addToPantry() {
  const input = document.getElementById('pantry-input');
  const name = input.value.trim();
  if (!name) { input.focus(); return; }

  // Avoid duplicates (case-insensitive)
  if (AppState.pantry.some(p => p.name.toLowerCase() === name.toLowerCase())) {
    input.value = '';
    input.focus();
    return;
  }

  var category = inferCategory(name);
  var whereSel = document.getElementById('pantry-add-where');
  var storage = (whereSel && whereSel.value) ? whereSel.value : inferStorage(name, category);
  AppState.pantry.push({
    id: Date.now() + Math.random(),
    name: name,
    category: category,
    purchaseDate: todayISO(),
    shelfLifeDays: categoryShelfLife(category),
    storage: storage
  });
  input.value = '';
  input.focus();

  saveData();
  renderPantry();
  renderGroceryList(); // refresh badges
}

function removeFromPantry(id) {
  AppState.pantry = AppState.pantry.filter(p => String(p.id) !== String(id));
  saveData();
  renderPantry();
  renderGroceryList();
}


// ── Ingredient Catalog (Ingredients Tab) ─────────────────────────────────────

const INGREDIENT_UNITS = ['g','kg','ml','L','cups','cup','tbsp','tsp','pieces','cloves','can','pack','stalks','bunches','lbs','oz','slices'];
const DEFAULT_MY_STORES = ['Wet Market / Palengke', 'SM Supermarket', 'Puregold'];

function escJ(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getCatEmoji(cat) {
  return icon({ Protein: 'beef', Vegetable: 'carrot', Fruit: 'citrus', Grain: 'wheat', Dairy: 'milk', Pantry: 'archive' }[cat] || 'utensils');
}

function getMyStores() {
  var s = AppState.myStores;
  return (s && s.length) ? s : DEFAULT_MY_STORES.slice();
}

function renderIngredientsTab() {
  var list = document.getElementById('ingredients-catalog');
  if (!list) return;

  var myStores = getMyStores();
  var prices = AppState.ingredientPrices || {};

  // ── Stores management bar ──
  var storesHtml = '<div class="ingcat-stores-bar">';
  storesHtml += '<span class="ingcat-stores-label">My Stores:</span>';
  storesHtml += '<div class="ingcat-stores-tags">';
  myStores.forEach(function(s) {
    storesHtml += '<span class="ingcat-store-tag">' + escapeHtml(s) +
      '<button class="ingcat-store-remove" onclick="removeMyStore(\'' + escJ(s) + '\')" title="Remove store">×</button></span>';
  });
  storesHtml += '</div>';
  storesHtml += '<button class="btn btn--sm btn--outline" onclick="addMyStore()">+ Add Store</button>';
  storesHtml += '</div>';

  // ── Search bar ──
  var searchHtml = '<div class="ingcat-search-bar"><input type="text" id="ingcat-search" class="form-control" placeholder="Search ingredients..." oninput="filterIngredientCatalog(this.value)"></div>';

  // ── Column headers ──
  var colHeaderHtml = '<div class="ingcat-header-row">';
  colHeaderHtml += '<div class="ingcat-col-name">Ingredient</div>';
  colHeaderHtml += '<div class="ingcat-col-unit">Unit</div>';
  myStores.forEach(function(s) {
    colHeaderHtml += '<div class="ingcat-col-store">' + escapeHtml(s) + '</div>';
  });
  colHeaderHtml += '<div class="ingcat-col-pantry">Pantry</div>';
  colHeaderHtml += '</div>';

  // ── Ingredient rows grouped by category ──
  var groups = {};
  INGREDIENT_DB.forEach(function(item) {
    if (!groups[item.category]) groups[item.category] = [];
    groups[item.category].push(item);
  });

  var rowsHtml = '';
  var itemIdx = 0;

  Object.keys(groups).forEach(function(cat) {
    rowsHtml += '<div class="ingcat-section" data-cat="' + cat + '">';
    rowsHtml += '<div class="ingcat-cat-header">' + getCatEmoji(cat) + ' ' + cat + '</div>';

    groups[cat].forEach(function(item) {
      var idx = itemIdx++;
      var override = prices[item.name] || {};
      var unit = override.unit || item.unit;
      var storePrices = override.prices || {};
      var pantryEntry = AppState.pantry.find(function(p) {
        return p.name.toLowerCase() === item.name.toLowerCase();
      });

      rowsHtml += '<div class="ingcat-row" data-name="' + escapeHtml(item.name) + '">';

      // Name
      rowsHtml += '<div class="ingcat-col-name"><span class="ingcat-item-name">' + item.name + '</span></div>';

      // Unit selector
      rowsHtml += '<div class="ingcat-col-unit"><select class="ingcat-unit-select" onchange="saveIngredientUnit(\'' + escJ(item.name) + '\', this.value)">';
      INGREDIENT_UNITS.forEach(function(u) {
        rowsHtml += '<option value="' + u + '"' + (unit === u ? ' selected' : '') + '>' + u + '</option>';
      });
      rowsHtml += '</select></div>';

      // Price per store
      myStores.forEach(function(s) {
        var p = storePrices[s] || '';
        rowsHtml += '<div class="ingcat-col-store" data-store="' + escapeHtml(s) + '">';
        rowsHtml += '<input class="ingcat-price-input" value="' + escapeHtml(p) + '" placeholder="e.g. ₱150"';
        rowsHtml += ' onblur="saveIngredientStorePrice(\'' + escJ(item.name) + '\',\'' + escJ(s) + '\',this.value)">';
        rowsHtml += '</div>';
      });

      // Pantry
      rowsHtml += '<div class="ingcat-col-pantry" id="ingpantry-' + idx + '">';
      if (pantryEntry) {
        var qtyStr = pantryEntry.quantity ? pantryEntry.quantity + ' ' + (pantryEntry.unit || '') : '';
        rowsHtml += '<span class="ingcat-in-pantry">' + icon('check') + (qtyStr ? ' ' + qtyStr : '') + '</span>';
        rowsHtml += '<button class="btn btn--xs btn--outline" onclick="removeIngredientFromPantry(\'' + escJ(String(pantryEntry.id)) + '\')">Remove</button>';
      } else {
        rowsHtml += '<button class="btn btn--xs btn--primary" onclick="showPantryAddRow(' + idx + ',\'' + escJ(item.name) + '\',\'' + escJ(unit) + '\')">+ Pantry</button>';
      }
      rowsHtml += '</div>';

      rowsHtml += '</div>'; // ingcat-row
    });

    rowsHtml += '</div>'; // ingcat-section
  });

  // ── My Custom Ingredients section ──
  var userIngs = AppState.userIngredients || [];
  var userSection = '';
  if (userIngs.length > 0) {
    userSection += '<div class="ingcat-table ingcat-custom-section">';
    userSection += '<div class="ingcat-header-row">';
    userSection += '<div class="ingcat-col-name">My Ingredients <span class="ingcat-custom-badge">custom</span></div>';
    userSection += '<div class="ingcat-col-unit">Unit</div>';
    myStores.forEach(function(s) { userSection += '<div class="ingcat-col-store">' + escapeHtml(s) + '</div>'; });
    userSection += '<div class="ingcat-col-pantry">Pantry</div>';
    userSection += '<div class="ingcat-col-actions"></div>';
    userSection += '</div>';

    userIngs.forEach(function(item, idx) {
      var uIdx = 'u' + idx;
      var override = prices[item.name] || {};
      var unit = override.unit || item.unit;
      var storePrices = override.prices || {};
      var pantryEntry = AppState.pantry.find(function(p) { return p.name.toLowerCase() === item.name.toLowerCase(); });

      userSection += '<div class="ingcat-row" data-name="' + escapeHtml(item.name) + '">';
      userSection += '<div class="ingcat-col-name"><span class="ingcat-item-name">' + escapeHtml(item.name) + '</span></div>';
      userSection += '<div class="ingcat-col-unit"><select class="ingcat-unit-select" onchange="saveIngredientUnit(\'' + escJ(item.name) + '\',this.value)">';
      INGREDIENT_UNITS.forEach(function(u) { userSection += '<option value="' + u + '"' + (unit === u ? ' selected' : '') + '>' + u + '</option>'; });
      userSection += '</select></div>';
      myStores.forEach(function(s) {
        var p = storePrices[s] || '';
        userSection += '<div class="ingcat-col-store" data-store="' + escapeHtml(s) + '"><input class="ingcat-price-input" value="' + escapeHtml(p) + '" placeholder="e.g. ₱55" onblur="saveIngredientStorePrice(\'' + escJ(item.name) + '\',\'' + escJ(s) + '\',this.value)"></div>';
      });
      userSection += '<div class="ingcat-col-pantry" id="ingpantry-' + uIdx + '">';
      if (pantryEntry) {
        var qtyStr = pantryEntry.quantity ? pantryEntry.quantity + ' ' + (pantryEntry.unit || '') : '';
        userSection += '<span class="ingcat-in-pantry">' + icon('check') + (qtyStr ? ' ' + qtyStr : '') + '</span>';
        userSection += '<button class="btn btn--xs btn--outline" onclick="removeIngredientFromPantry(\'' + escJ(String(pantryEntry.id)) + '\')">Remove</button>';
      } else {
        userSection += '<button class="btn btn--xs btn--primary" onclick="showPantryAddRow(\'' + uIdx + '\',\'' + escJ(item.name) + '\',\'' + escJ(unit) + '\')">+ Pantry</button>';
      }
      userSection += '</div>';
      userSection += '<div class="ingcat-col-actions">';
      userSection += '<button class="btn btn--xs btn--outline" onclick="openEditUserIngredientModal(\'' + escJ(item.id) + '\')">Edit</button>';
      userSection += '<button class="btn btn--xs btn--outline ingcat-delete-btn" onclick="deleteUserIngredient(\'' + escJ(item.id) + '\')">Delete</button>';
      userSection += '</div>';
      userSection += '</div>';
    });
    userSection += '</div>';
  }

  var addBtnHtml = '<button class="btn btn--primary ingcat-add-btn" onclick="openAddUserIngredientModal()">+ Add My Ingredient</button>';

  list.innerHTML = storesHtml + searchHtml + addBtnHtml + userSection +
    '<div class="ingcat-table">' + colHeaderHtml + rowsHtml + '</div>';
}

function filterIngredientCatalog(query) {
  var q = query.toLowerCase().trim();
  document.querySelectorAll('.ingcat-row').forEach(function(row) {
    var name = (row.dataset.name || '').toLowerCase();
    row.style.display = (!q || name.includes(q)) ? '' : 'none';
  });
  document.querySelectorAll('.ingcat-section').forEach(function(section) {
    var visible = Array.from(section.querySelectorAll('.ingcat-row')).some(function(r) { return r.style.display !== 'none'; });
    section.style.display = visible ? '' : 'none';
  });
}

function addMyStore() {
  var name = prompt('Store name:');
  if (!name || !name.trim()) return;
  name = name.trim();
  var stores = getMyStores();
  if (!stores.includes(name)) {
    AppState.myStores = stores.concat([name]);
    saveData();
    renderIngredientsTab();
  }
}

function removeMyStore(store) {
  AppState.myStores = getMyStores().filter(function(s) { return s !== store; });
  saveData();
  renderIngredientsTab();
}

function saveIngredientUnit(name, unit) {
  var current = AppState.ingredientPrices[name] || {};
  AppState.ingredientPrices[name] = Object.assign({}, current, { unit: unit });
  saveData();
}

function saveIngredientStorePrice(name, store, price) {
  var current = AppState.ingredientPrices[name] || {};
  var storePrices = Object.assign({}, current.prices || {});
  storePrices[store] = price;
  AppState.ingredientPrices[name] = Object.assign({}, current, { prices: storePrices });
  saveData();
}

function showPantryAddRow(idx, name, unit) {
  var col = document.getElementById('ingpantry-' + idx);
  if (!col) return;
  col.innerHTML =
    '<input type="number" id="ingqty-' + idx + '" class="ingcat-qty-input" placeholder="Qty" min="0.1" step="any">' +
    '<span class="ingcat-qty-unit">' + unit + '</span>' +
    '<button class="btn btn--xs btn--primary" onclick="confirmAddIngredientToPantry(\'' + escJ(name) + '\',' + idx + ',\'' + escJ(unit) + '\')">Add</button>' +
    '<button class="btn btn--xs btn--outline" onclick="renderIngredientsTab()">' + icon('x') + '</button>';
  var input = document.getElementById('ingqty-' + idx);
  if (input) input.focus();
}

function confirmAddIngredientToPantry(name, idx, unit) {
  var qtyInput = document.getElementById('ingqty-' + idx);
  var qty = qtyInput ? parseFloat(qtyInput.value) : null;
  var dbItem = INGREDIENT_DB.find(function(i) { return i.name === name; });
  var category = dbItem ? dbItem.category : '';

  AppState.pantry = AppState.pantry.filter(function(p) {
    return p.name.toLowerCase() !== name.toLowerCase();
  });
  AppState.pantry.push({
    id: Date.now() + Math.random(),
    name: name,
    quantity: qty || null,
    unit: unit,
    category: category,
    purchaseDate: todayISO(),
    shelfLifeDays: categoryShelfLife(category),
    storage: inferStorage(name, category)
  });
  saveData();
  renderIngredientsTab();
  renderPantry();
}

function removeIngredientFromPantry(id) {
  AppState.pantry = AppState.pantry.filter(function(p) { return String(p.id) !== String(id); });
  saveData();
  renderPantry();
  renderIngredientsTab();
}

// ── Custom (User) Ingredient CRUD ────────────────────────────────────────────

var _editingUserIngredientId = null;

function openAddUserIngredientModal() {
  _editingUserIngredientId = null;
  document.getElementById('user-ingredient-modal-title').textContent = 'Add Custom Ingredient';
  ['ui-name','ui-calories','ui-protein','ui-carbs','ui-fat','ui-fiber','ui-sodium'].forEach(function(id) {
    document.getElementById(id).value = '';
  });
  document.getElementById('ui-unit').value = 'g';
  document.getElementById('ui-category').value = 'Protein';
  document.getElementById('user-ingredient-modal').classList.remove('hidden');
}

function openEditUserIngredientModal(id) {
  var ing = (AppState.userIngredients || []).find(function(i) { return i.id === id; });
  if (!ing) return;
  _editingUserIngredientId = id;
  document.getElementById('user-ingredient-modal-title').textContent = 'Edit Ingredient';
  document.getElementById('ui-name').value = ing.name || '';
  document.getElementById('ui-unit').value = ing.unit || 'g';
  document.getElementById('ui-category').value = ing.category || 'Protein';
  document.getElementById('ui-calories').value = ing.calories || '';
  document.getElementById('ui-protein').value = ing.protein || '';
  document.getElementById('ui-carbs').value = ing.carbs || '';
  document.getElementById('ui-fat').value = ing.fat || '';
  document.getElementById('ui-fiber').value = ing.fiber || '';
  document.getElementById('ui-sodium').value = ing.sodium || '';
  document.getElementById('user-ingredient-modal').classList.remove('hidden');
}

function closeUserIngredientModal() {
  document.getElementById('user-ingredient-modal').classList.add('hidden');
}

function saveUserIngredient() {
  var name = document.getElementById('ui-name').value.trim();
  if (!name) { alert('Name is required.'); return; }

  var ingredient = {
    id: _editingUserIngredientId || ('ui_' + Date.now()),
    name: name,
    unit: document.getElementById('ui-unit').value,
    category: document.getElementById('ui-category').value,
    calories: parseFloat(document.getElementById('ui-calories').value) || 0,
    protein:  parseFloat(document.getElementById('ui-protein').value)  || 0,
    carbs:    parseFloat(document.getElementById('ui-carbs').value)    || 0,
    fat:      parseFloat(document.getElementById('ui-fat').value)      || 0,
    fiber:    parseFloat(document.getElementById('ui-fiber').value)    || 0,
    sodium:   parseFloat(document.getElementById('ui-sodium').value)   || 0
  };

  if (_editingUserIngredientId) {
    AppState.userIngredients = (AppState.userIngredients || []).map(function(i) {
      return i.id === _editingUserIngredientId ? ingredient : i;
    });
  } else {
    AppState.userIngredients = (AppState.userIngredients || []).concat([ingredient]);
  }

  saveData();
  closeUserIngredientModal();
  renderIngredientsTab();
}

function deleteUserIngredient(id) {
  if (!confirm('Remove this custom ingredient?')) return;
  AppState.userIngredients = (AppState.userIngredients || []).filter(function(i) { return i.id !== id; });
  saveData();
  renderIngredientsTab();
}

// ── Pantry Knowledge Base ─────────────────────────────────────────────

const PANTRY_KNOWLEDGE = [
  {
    names: ['potato', 'potatoes', 'patatas'],
    icon: '🥔',
    location: 'Counter / Pantry',
    locationIcon: '🗄️',
    lasts: '2–5 weeks',
    store: 'Cool, dark, dry place with good airflow. Never in the fridge — cold turns starch into sugar and makes them gritty.',
    spoilage: 'Soft or mushy spots, green patches (toxic — cut away generously), foul smell, or shriveled skin.',
    freshness: '🟢 New: firm, smooth, no sprouts. 🟡 OK: small sprouts (remove before cooking). 🔴 Old: shriveled, large sprouts, green tint.',
    tip: '⚠️ Store away from onions — they release gases that make each other rot faster.'
  },
  {
    names: ['sweet potato', 'kamote', 'camote'],
    icon: '🍠',
    location: 'Counter / Pantry',
    locationIcon: '🗄️',
    lasts: '3–5 weeks',
    store: 'Cool, dry, dark place. Fridge makes them hard in the center.',
    spoilage: 'Soft spots, black or white mold, shriveling, unpleasant smell.',
    freshness: '🟢 New: firm, smooth skin, no soft spots. 🟡 OK: small blemishes (cut away). 🔴 Old: very soft, mushy ends.',
    tip: 'Keep at room temp if using within a month. Do not refrigerate uncooked.'
  },
  {
    names: ['onion', 'onions', 'sibuyas', 'red onion', 'white onion'],
    icon: '🧅',
    location: 'Pantry (cool & dry)',
    locationIcon: '🗄️',
    lasts: '1–3 months (whole)',
    store: 'Cool, dry, well-ventilated area. Open basket or mesh bag. Keep away from potatoes.',
    spoilage: 'Mold (fuzzy or dark spots), very soft, slimy layers, foul smell.',
    freshness: '🟢 New: firm, dry papery skin, no soft spots. 🟡 OK: outer skin peeling but inner is firm. 🔴 Old: very soft, sprouting (still edible but use fast).',
    tip: '⚠️ Never mix with potatoes. Once cut, wrap tightly and refrigerate — use within 7–10 days.'
  },
  {
    names: ['garlic', 'bawang', 'garlic clove', 'garlic cloves'],
    icon: '🧄',
    location: 'Counter / Pantry',
    locationIcon: '🗄️',
    lasts: '3–6 months (whole bulb)',
    store: 'Open container at room temp. Good airflow is key. Don\'t seal in a bag.',
    spoilage: 'Mold on cloves, brown/mushy interior, very shriveled, strong sour smell.',
    freshness: '🟢 New: firm, tight skin, white inside. 🟡 OK: slightly soft but white inside, green sprout (still fine). 🔴 Old: mushy, yellow/brown flesh.',
    tip: 'Peeled garlic goes in the fridge (1–2 weeks). Minced garlic in oil must be refrigerated and used within 1 week.'
  },
  {
    names: ['tomato', 'tomatoes', 'kamatis'],
    icon: '🍅',
    location: 'Counter (not fridge)',
    locationIcon: '🍃',
    lasts: '4–7 days at counter',
    store: 'Room temperature, stem side down, away from direct sunlight. Fridge kills the flavor and texture.',
    spoilage: 'Mold, very soft/mushy, split skin with liquid seeping, sour fermented smell.',
    freshness: '🟢 New: firm, bright color, fresh smell. 🟡 OK: slightly soft but no mold. 🔴 Old: very soft, wrinkled, discolored.',
    tip: 'Refrigerate only if fully ripe and you need to extend by 2–3 days. Let it come back to room temp before eating.'
  },
  {
    names: ['egg', 'eggs', 'itlog'],
    icon: '🥚',
    location: 'Fridge',
    locationIcon: '🧊',
    lasts: '3–5 weeks',
    store: 'Main body of fridge (NOT the door — temperature fluctuates). Keep in original carton.',
    spoilage: 'Float test: fill bowl with water — fresh eggs sink flat, old eggs stand upright, bad eggs float. Cracked shell = use immediately or discard.',
    freshness: '🟢 New: sinks flat on its side. 🟡 OK: sinks but stands upright. 🔴 Bad: floats (discard) or smells sulfurous when cracked.',
    tip: 'The float test is reliable. Eggs rarely go "bad" before the date if refrigerated — they just get less fresh (whites get watery).'
  },
  {
    names: ['chicken', 'chicken breast', 'chicken thigh', 'manok', 'raw chicken'],
    icon: '🍗',
    location: 'Fridge / Freezer',
    locationIcon: '🧊',
    lasts: '1–2 days (fridge) • 9 months (freezer)',
    store: 'Bottom shelf of fridge in sealed container to avoid cross-contamination. Freeze if not using within 2 days.',
    spoilage: 'Slimy or sticky texture, gray/green color, sour or ammonia smell — discard immediately.',
    freshness: '🟢 New: pink, firm, mild smell. 🟡 OK: still pink but slightly tacky (rinse and cook same day). 🔴 Old: gray, slimy, strong smell.',
    tip: 'Thaw in the fridge overnight, not on the counter. Never refreeze thawed raw chicken.'
  },
  {
    names: ['pork', 'baboy', 'pork belly', 'pork chop', 'liempo'],
    icon: '🥩',
    location: 'Fridge / Freezer',
    locationIcon: '🧊',
    lasts: '3–5 days (fridge) • 6 months (freezer)',
    store: 'Sealed container, bottom shelf. Keep away from cooked food.',
    spoilage: 'Slimy texture, dull gray-brown (not pink), sour or off smell.',
    freshness: '🟢 New: pink-red, firm, fresh smell. 🟡 OK: slightly darker but firm. 🔴 Old: brown-gray, soft, off smell.',
    tip: 'Cooked pork lasts 3–4 days in fridge. Vacuum-sealed pork can last up to 2 weeks unopened.'
  },
  {
    names: ['beef', 'baka', 'ground beef', 'beef steak', 'karne'],
    icon: '🥩',
    location: 'Fridge / Freezer',
    locationIcon: '🧊',
    lasts: '3–5 days (fridge) • 4–12 months (freezer)',
    store: 'Sealed container, bottom shelf. Keep original packaging if using within 2 days.',
    spoilage: 'Brown-gray color throughout (not just surface), slimy texture, sour smell.',
    freshness: '🟢 New: bright red (surface may be darker underneath — normal). 🟡 OK: slightly brown on surface but red inside. 🔴 Old: brown throughout, off smell.',
    tip: 'Brown surface on beef is just oxidation — it\'s safe if it smells fine. Cut it open: if red inside, it\'s good.'
  },
  {
    names: ['fish', 'isda', 'tilapia', 'bangus', 'milkfish', 'galunggong', 'tuna', 'salmon', 'raw fish'],
    icon: '🐟',
    location: 'Fridge / Freezer',
    locationIcon: '🧊',
    lasts: '1–2 days (fridge) • 3–6 months (freezer)',
    store: 'Coldest part of fridge, in a covered container or on ice. Freeze if not cooking today.',
    spoilage: 'Strong "fishy" ammonia smell (fresh fish smells like the sea), milky eyes, soft/mushy flesh, brown gills.',
    freshness: '🟢 New: clear eyes, red gills, firm flesh, mild sea smell. 🟡 OK: slightly cloudy eyes but firm. 🔴 Old: cloudy/sunken eyes, gray gills, strong odor.',
    tip: 'Fish is the most perishable protein. When in doubt, throw it out.'
  },
  {
    names: ['carrot', 'carrots', 'karot'],
    icon: '🥕',
    location: 'Fridge (crisper)',
    locationIcon: '🧊',
    lasts: '3–4 weeks',
    store: 'Remove green tops (they drain moisture), store in perforated bag in crisper drawer.',
    spoilage: 'Slimy, black mold spots, very rubbery or mushy, sour smell.',
    freshness: '🟢 New: bright orange, very firm, fresh smell. 🟡 OK: slightly limp but no mold (can refresh in ice water). 🔴 Old: very soft, discolored ends, slimy.',
    tip: 'Slightly limp carrots can be revived! Soak in cold water for 30 minutes.'
  },
  {
    names: ['rice', 'bigas', 'white rice', 'brown rice'],
    icon: '🍚',
    location: 'Pantry (airtight)',
    locationIcon: '🗄️',
    lasts: 'White rice: 1–2 years • Brown rice: 6 months',
    store: 'Airtight container in cool, dry, dark place. Keep away from moisture.',
    spoilage: 'Bugs/weevils, clumping from moisture, musty or rancid smell (brown rice goes rancid faster).',
    freshness: '🟢 New: dry, separate grains, no smell. 🟡 OK: slight clumping (dry it out). 🔴 Old/Bad: bugs, strong odor, oily texture (brown rice).',
    tip: 'Store cooked rice in fridge within 1 hour. Never leave cooked rice at room temp — bacteria grow fast.'
  },
  {
    names: ['bread', 'tinapay', 'loaf', 'pandesal'],
    icon: '🍞',
    location: 'Counter / Freezer',
    locationIcon: '🍃',
    lasts: '3–5 days counter • 3 months frozen',
    store: 'Room temp in bread bag or box if using within days. Freeze for longer (toast from frozen).',
    spoilage: 'Visible mold (even a small spot = discard the whole loaf), sour smell, very hard/dry.',
    freshness: '🟢 New: soft, fresh smell. 🟡 OK: slightly stiff but no mold (toast it). 🔴 Old: mold visible anywhere.',
    tip: '⚠️ Don\'t refrigerate bread — it actually goes stale faster in the fridge. Freeze instead.'
  },
  {
    names: ['banana', 'saging', 'lakatan', 'latundan'],
    icon: '🍌',
    location: 'Counter',
    locationIcon: '🍃',
    lasts: '5–7 days at counter',
    store: 'Room temperature, hang if possible. Keep away from other fruits (releases ethylene gas).',
    spoilage: 'Completely black and liquid inside, mold on skin, fermented smell.',
    freshness: '🟢 New: firm, yellow with green tips. 🟡 OK: all yellow or spots — sweetest stage. 🔴 Too ripe: fully black outside (still fine for baking/smoothies). 🔴 Bad: mold, liquid.',
    tip: 'Separate from the bunch to slow ripening. Refrigerate ripe bananas — skin turns black but flesh stays good for 1–2 weeks.'
  },
  {
    names: ['cabbage', 'repolyo', 'napa cabbage', 'pechay baguio'],
    icon: '🥬',
    location: 'Fridge (crisper)',
    locationIcon: '🧊',
    lasts: '1–2 months (whole) • 1–2 weeks (cut)',
    store: 'Whole, unwashed in crisper. Wrap cut cabbage tightly in plastic.',
    spoilage: 'Slimy outer leaves, strong sulfur smell, black/brown spots throughout.',
    freshness: '🟢 New: tight, heavy for its size, crisp outer leaves. 🟡 OK: remove wilted outer leaves — inner is still fine. 🔴 Old: slimy, smells strongly.',
    tip: 'Remove outer leaves as needed. The inner leaves stay fresh much longer.'
  },
  {
    names: ['butter', 'margarine'],
    icon: '🧈',
    location: 'Fridge',
    locationIcon: '🧊',
    lasts: '1 month (counter if salted) • 3 months (fridge) • 1 year (freezer)',
    store: 'Covered container to prevent odor absorption. Can keep salted butter at counter temp in a butter dish for up to 2 weeks.',
    spoilage: 'Yellow discoloration, rancid sour smell, off taste.',
    freshness: '🟢 New: pale yellow, fresh cream smell. 🟡 OK: slightly darker edges (trim if needed). 🔴 Old: rancid smell, very yellow, oily surface.',
    tip: 'Unsalted butter spoils faster than salted. Always smell before using.'
  },
  {
    names: ['milk', 'gatas'],
    icon: '🥛',
    location: 'Fridge',
    locationIcon: '🧊',
    lasts: '5–7 days after opening',
    store: 'Back of fridge (coldest part), not the door. Keep tightly sealed.',
    spoilage: 'Curdled (chunky texture), sour smell, yellow tint.',
    freshness: '🟢 New: white, mild smell. 🟡 OK: slightly sour smell but not curdled (use for baking). 🔴 Old: chunky, sour, discolored.',
    tip: 'Smell test is reliable. Unopened milk can last a week past the date if properly refrigerated.'
  },
  {
    names: ['lemon', 'lime', 'calamansi', 'dayap'],
    icon: '🍋',
    location: 'Counter or Fridge',
    locationIcon: '🍃',
    lasts: '1 week counter • 3–4 weeks fridge',
    store: 'Room temp if using soon. Refrigerate in a bag for longer storage.',
    spoilage: 'Mold (white or green fuzz), very soft/mushy, dried out with no juice, sour fermented smell.',
    freshness: '🟢 New: firm, heavy for size, bright color. 🟡 OK: slightly soft but no mold. 🔴 Old: very light (dried out), mold, hollow feeling.',
    tip: 'Microwave for 10–15 seconds before juicing — you\'ll get 50% more juice.'
  },
  {
    names: ['cooking oil', 'vegetable oil', 'palm oil', 'coconut oil', 'olive oil'],
    icon: '🫙',
    location: 'Pantry (cool & dark)',
    locationIcon: '🗄️',
    lasts: '1–2 years unopened • 6 months opened',
    store: 'Sealed, away from heat and direct light. Don\'t store near the stove.',
    spoilage: 'Rancid smell (like crayons or old paint), very dark color, cloudy (for clear oils).',
    freshness: '🟢 New: clear, neutral smell. 🟡 OK: mild smell (use fast). 🔴 Old: rancid — smells off, tastes bitter.',
    tip: 'Used frying oil should be filtered and stored in a sealed container in the fridge. Discard after 8–10 uses.'
  },
  {
    names: ['soy sauce', 'toyo'],
    icon: '🫙',
    location: 'Pantry or Fridge',
    locationIcon: '🗄️',
    lasts: '2–3 years unopened • 1 year opened',
    store: 'Pantry if using frequently. Fridge after opening for best quality.',
    spoilage: 'Mold growth on surface, very cloudy, off smell. Soy sauce rarely goes "bad" but quality degrades.',
    freshness: '🟢 New: deep brown, savory smell. 🟡 OK: slightly lighter in color. 🔴 Old: mold or very off smell.',
    tip: 'A dark sediment at the bottom is normal and safe.'
  },
  {
    names: ['fish sauce', 'patis'],
    icon: '🫙',
    location: 'Pantry',
    locationIcon: '🗄️',
    lasts: '3–4 years',
    store: 'Cool, dark place. Does not need refrigeration.',
    spoilage: 'Mold on surface, color turns very dark/black, extremely strong rotting smell (beyond the usual pungent smell).',
    freshness: '🟢 New: amber/golden brown. 🟡 OK: darker but clear. 🔴 Old: very dark, mold, off smell.',
    tip: 'High salt content means it rarely spoils. Crystallization around the lid is normal.'
  },
  {
    names: ['vinegar', 'suka'],
    icon: '🫙',
    location: 'Pantry',
    locationIcon: '🗄️',
    lasts: 'Indefinitely',
    store: 'Room temperature, tightly sealed, away from light.',
    spoilage: 'Practically never spoils. A "mother" (dark floating strand) may develop but is harmless.',
    freshness: 'Check that the seal is tight and there\'s no debris.',
    tip: 'Vinegar is self-preserving. No expiry to worry about.'
  },
  {
    names: ['salt', 'asin', 'table salt', 'sea salt'],
    icon: '🧂',
    location: 'Pantry (airtight)',
    locationIcon: '🗄️',
    lasts: 'Indefinite',
    store: 'Cool, dry place in a sealed container. Humidity makes it clump but never spoils it.',
    spoilage: 'Doesn\'t spoil — salt is a preservative itself. Only issue is hard clumps from moisture.',
    freshness: '🟢 Always good. Clumped salt can be broken up and used normally.',
    tip: 'Drop a few grains of rice in the shaker to absorb moisture and stop clumping.'
  },
  {
    names: ['sugar', 'asukal', 'white sugar', 'brown sugar'],
    icon: '🍬',
    location: 'Pantry (airtight)',
    locationIcon: '🗄️',
    lasts: 'Indefinite',
    store: 'Airtight container, cool and dry. Humidity hardens it into a block.',
    spoilage: 'Doesn\'t spoil. Can harden or attract ants if left unsealed.',
    freshness: '🟢 Always usable. Hardened sugar can be softened, not thrown out.',
    tip: 'Keep a slice of bread in brown sugar to keep it soft.'
  },
  {
    names: ['black pepper', 'pepper', 'peppercorn', 'paminta', 'ground pepper'],
    icon: '⚫',
    location: 'Pantry (cool & dark)',
    locationIcon: '🗄️',
    lasts: 'Whole: 3–4 yrs · Ground: ~1 yr',
    store: 'Airtight, away from heat and light. Whole peppercorns keep far longer than pre-ground.',
    spoilage: 'Doesn\'t rot, but slowly loses aroma and bite.',
    freshness: '🟢 Fresh: strong sharp smell. 🟡 OK: mild. 🔴 Old: little to no aroma.',
    tip: 'Grind whole peppercorns fresh — far more flavor than the pre-ground tin.'
  },
  {
    names: ['ginger', 'luya'],
    icon: '🫚',
    location: 'Counter or Fridge',
    locationIcon: '🗄️',
    lasts: 'Counter: ~1 wk · Fridge: 3–4 wks',
    store: 'Unpeeled root in a paper bag in the crisper, or on the counter if using within days. Freezes for months.',
    spoilage: 'Soft, wrinkled, shriveled, or moldy spots.',
    freshness: '🟢 Fresh: firm, smooth, taut skin. 🟡 OK: slightly wrinkled. 🔴 Old: soft, shriveled, mold.',
    tip: 'Freeze it whole and grate from frozen — no peeling, no waste.'
  },
  {
    names: ['bell pepper', 'capsicum', 'atsal', 'sweet pepper'],
    icon: '🫑',
    location: 'Fridge (crisper)',
    locationIcon: '🧊',
    lasts: '1–2 weeks',
    store: 'Whole and unwashed in the crisper. Wash only right before using.',
    spoilage: 'Wrinkled skin, soft sunken spots, mold near the stem, or a slimy inside.',
    freshness: '🟢 Fresh: firm, glossy, taut. 🟡 OK: slight wrinkling. 🔴 Old: soft, wrinkled, moldy.',
    tip: 'Red and yellow peppers spoil faster than green — use them first.'
  },
  {
    names: ['green onion', 'scallion', 'scallions', 'spring onion', 'sibuyas dahon'],
    icon: '🌿',
    location: 'Fridge',
    locationIcon: '🧊',
    lasts: '1–2 weeks',
    store: 'Wrap in a damp paper towel in the crisper, or stand roots-down in a glass with a little water.',
    spoilage: 'Slimy or yellowing tops, mushy white bases.',
    freshness: '🟢 Fresh: crisp, bright green. 🟡 OK: slightly limp. 🔴 Old: slimy, yellow.',
    tip: 'Regrow them — put the white root ends in water on the windowsill.'
  },
  {
    names: ['cheese', 'keso', 'cheddar'],
    icon: '🧀',
    location: 'Fridge',
    locationIcon: '🧊',
    lasts: 'Hard: 3–4 wks · Soft: 1–2 wks',
    store: 'Wrap in wax or parchment paper (not plastic) so it can breathe.',
    spoilage: 'Unexpected mold on soft cheese, ammonia smell, slimy surface, or off taste.',
    freshness: '🟢 Fresh: clean smell, even color. 🟡 OK: dry edges (trim). 🔴 Old: fuzzy mold, sour ammonia smell.',
    tip: 'On hard cheese you can cut away a mold spot (an inch around) and use the rest.'
  },
  {
    names: ['flour', 'all-purpose flour', 'harina', 'bread flour'],
    icon: '🌾',
    location: 'Pantry (airtight)',
    locationIcon: '🗄️',
    lasts: 'White: ~1 yr · Whole wheat: ~3 mo',
    store: 'Airtight container in a cool, dry spot. Whole-wheat goes rancid faster from its oils.',
    spoilage: 'Musty or sour smell, clumping, or tiny bugs (weevils) and webbing.',
    freshness: '🟢 Fresh: neutral smell, fine powder. 🔴 Old: sour/musty smell, bugs.',
    tip: 'Freeze new flour for a few days to kill any weevil eggs, then store airtight.'
  },
  {
    names: ['eggplant', 'talong', 'aubergine'],
    icon: '🍆',
    location: 'Fridge (crisper)',
    locationIcon: '🧊',
    lasts: '5–7 days',
    store: 'Whole and uncut in the crisper. Use within a week — it dislikes long cold storage.',
    spoilage: 'Soft, wrinkled skin, brown mushy spots, or spongy hollow flesh.',
    freshness: '🟢 Fresh: firm, glossy, springs back. 🟡 OK: slight give. 🔴 Old: wrinkled, soft, brown.',
    tip: 'Cut eggplant browns fast — cook soon after slicing or soak in salted water.'
  },
  {
    names: ['cucumber', 'pipino'],
    icon: '🥒',
    location: 'Fridge (crisper)',
    locationIcon: '🧊',
    lasts: '~1 week',
    store: 'In the crisper, wrapped in a paper towel to absorb moisture.',
    spoilage: 'Soft mushy ends, wrinkled skin, or a slimy film.',
    freshness: '🟢 Fresh: firm, dark green. 🟡 OK: soft ends (trim). 🔴 Old: mushy, wrinkled, slimy.',
    tip: 'Keep away from bananas and tomatoes — their ethylene gas makes cucumbers go soft fast.'
  }
];

function lookupPantryKnowledge(name) {
  const n = name.toLowerCase().trim();
  return PANTRY_KNOWLEDGE.find(k =>
    k.names.some(kn => n.includes(kn) || kn.includes(n))
  ) || null;
}

// Code-generated fallback guide by category, so EVERY item gets sensible storage
// advice even when it isn't in the hand-written PANTRY_KNOWLEDGE list. Specific
// entries above always win; this just fills the long tail for free.
function genericStorageGuide(p) {
  const cat = String(p.category || inferCategory(p.name) || '').toLowerCase();
  const byCat = {
    protein: {
      store: 'Keep cold in the coldest part of the fridge; freeze if not using within a day or two.',
      spoilage: 'Slimy or sticky surface, gray/green tint, or a sour, "off" smell.',
      freshness: '🟢 Fresh: firm, normal color, clean smell. 🔴 Off: slimy, dull, sour-smelling.'
    },
    vegetable: {
      store: 'Crisper drawer of the fridge; keep most vegetables unwashed until you use them.',
      spoilage: 'Wilting, sliminess, dark mushy spots, or mold.',
      freshness: '🟢 Fresh: firm, vivid color. 🟡 OK: slightly limp. 🔴 Old: mushy, slimy, moldy.'
    },
    fruit: {
      store: 'Ripen on the counter, then move to the fridge to slow it down.',
      spoilage: 'Soft mushy spots, mold, leaking juice, or a fermented smell.',
      freshness: '🟢 Fresh: firm, fragrant. 🟡 OK: very ripe — eat soon. 🔴 Old: mushy, moldy.'
    },
    dairy: {
      store: 'Keep cold in the main body of the fridge (not the door — it\'s warmer).',
      spoilage: 'Sour smell, mold, curdling, or a bloated container.',
      freshness: '🟢 Fresh: clean smell, smooth. 🔴 Off: sour, lumpy, or moldy.'
    },
    grain: {
      store: 'Cool, dry place in an airtight container.',
      spoilage: 'Musty smell, clumping, or tiny bugs (weevils).',
      freshness: '🟢 Fresh: dry, neutral smell. 🔴 Old: musty smell or bugs.'
    }
  };
  const g = byCat[cat] || {
    store: 'Cool, dry place in a sealed container, away from heat and light.',
    spoilage: 'Off smell, change in color or texture, moisture, or bugs.',
    freshness: '🟢 Good: normal look and smell. 🔴 Toss it if it looks or smells off.'
  };
  const days = categoryShelfLife(p.category);
  return {
    store: g.store,
    spoilage: g.spoilage,
    freshness: g.freshness,
    tip: days ? 'Rough shelf life: about ' + days + ' day' + (days === 1 ? '' : 's') + ' when fresh — always trust what you see and smell.' : '',
    generic: true
  };
}



// ── Local Nutrition Database (per 100g unless noted) ──────────────────────────

const LOCAL_NUTRITION_DB = [
  // Proteins
  { name: 'Chicken Breast', calories: 165, protein: 31, carbs: 0, fat: 3.6, fiber: 0, sodium: 74 },
  { name: 'Chicken Thigh', calories: 209, protein: 26, carbs: 0, fat: 11, fiber: 0, sodium: 84 },
  { name: 'Chicken Leg', calories: 184, protein: 22, carbs: 0, fat: 10, fiber: 0, sodium: 79 },
  { name: 'Whole Chicken', calories: 215, protein: 18, carbs: 0, fat: 15, fiber: 0, sodium: 70 },
  { name: 'Ground Chicken', calories: 170, protein: 21, carbs: 0, fat: 9, fiber: 0, sodium: 80 },
  { name: 'Pork Belly', calories: 518, protein: 9, carbs: 0, fat: 53, fiber: 0, sodium: 39 },
  { name: 'Ground Pork', calories: 297, protein: 17, carbs: 0, fat: 25, fiber: 0, sodium: 63 },
  { name: 'Pork Chop', calories: 231, protein: 25, carbs: 0, fat: 14, fiber: 0, sodium: 62 },
  { name: 'Pork Shoulder', calories: 215, protein: 19, carbs: 0, fat: 15, fiber: 0, sodium: 60 },
  { name: 'Pork Liver', calories: 134, protein: 21, carbs: 3.8, fat: 3.7, fiber: 0, sodium: 87 },
  { name: 'Ground Beef', calories: 254, protein: 17, carbs: 0, fat: 20, fiber: 0, sodium: 75 },
  { name: 'Beef', calories: 250, protein: 26, carbs: 0, fat: 17, fiber: 0, sodium: 55 },
  { name: 'Beef Brisket', calories: 292, protein: 18, carbs: 0, fat: 24, fiber: 0, sodium: 66 },
  { name: 'Sirloin Steak', calories: 207, protein: 26, carbs: 0, fat: 11, fiber: 0, sodium: 59 },
  { name: 'Shrimp', calories: 99, protein: 24, carbs: 0, fat: 0.3, fiber: 0, sodium: 111 },
  { name: 'Bangus', calories: 148, protein: 20, carbs: 0, fat: 7, fiber: 0, sodium: 78 },
  { name: 'Tilapia', calories: 96, protein: 20, carbs: 0, fat: 2, fiber: 0, sodium: 56 },
  { name: 'Salmon', calories: 208, protein: 20, carbs: 0, fat: 13, fiber: 0, sodium: 59 },
  { name: 'Tuna', calories: 144, protein: 23, carbs: 0, fat: 5, fiber: 0, sodium: 47 },
  { name: 'Tuna Canned', calories: 116, protein: 25, carbs: 0, fat: 1, fiber: 0, sodium: 368 },
  { name: 'Sardines', calories: 208, protein: 25, carbs: 0, fat: 11, fiber: 0, sodium: 307 },
  { name: 'Galunggong', calories: 121, protein: 20, carbs: 0, fat: 4, fiber: 0, sodium: 68 },
  { name: 'Squid', calories: 92, protein: 16, carbs: 3, fat: 1.4, fiber: 0, sodium: 44 },
  { name: 'Mussels', calories: 86, protein: 12, carbs: 4, fat: 2.2, fiber: 0, sodium: 286 },
  { name: 'Eggs', calories: 155, protein: 13, carbs: 1.1, fat: 11, fiber: 0, sodium: 124 },
  { name: 'Tofu', calories: 76, protein: 8, carbs: 1.9, fat: 4.8, fiber: 0.3, sodium: 7 },
  { name: 'Longganisa', calories: 290, protein: 12, carbs: 8, fat: 24, fiber: 0, sodium: 520 },
  { name: 'Bacon', calories: 541, protein: 37, carbs: 1.4, fat: 42, fiber: 0, sodium: 1717 },
  { name: 'Corned Beef', calories: 251, protein: 15, carbs: 1, fat: 20, fiber: 0, sodium: 973 },
  // Vegetables
  { name: 'Garlic', calories: 149, protein: 6.4, carbs: 33, fat: 0.5, fiber: 2.1, sodium: 17 },
  { name: 'Onion', calories: 40, protein: 1.1, carbs: 9.3, fat: 0.1, fiber: 1.7, sodium: 4 },
  { name: 'Tomato', calories: 18, protein: 0.9, carbs: 3.9, fat: 0.2, fiber: 1.2, sodium: 5 },
  { name: 'Potato', calories: 77, protein: 2, carbs: 17, fat: 0.1, fiber: 2.2, sodium: 6 },
  { name: 'Sweet Potato', calories: 86, protein: 1.6, carbs: 20, fat: 0.1, fiber: 3, sodium: 55 },
  { name: 'Carrot', calories: 41, protein: 0.9, carbs: 10, fat: 0.2, fiber: 2.8, sodium: 69 },
  { name: 'Cabbage', calories: 25, protein: 1.3, carbs: 5.8, fat: 0.1, fiber: 2.5, sodium: 18 },
  { name: 'Kangkong', calories: 19, protein: 2.6, carbs: 2.1, fat: 0.2, fiber: 2, sodium: 113 },
  { name: 'Pechay', calories: 13, protein: 1.5, carbs: 2.2, fat: 0.2, fiber: 1, sodium: 65 },
  { name: 'Spinach', calories: 23, protein: 2.9, carbs: 3.6, fat: 0.4, fiber: 2.2, sodium: 79 },
  { name: 'Ampalaya', calories: 17, protein: 1, carbs: 3.7, fat: 0.2, fiber: 2.8, sodium: 5 },
  { name: 'Eggplant', calories: 25, protein: 1, carbs: 5.9, fat: 0.2, fiber: 3, sodium: 2 },
  { name: 'Sitaw', calories: 47, protein: 2.6, carbs: 10, fat: 0.3, fiber: 3.7, sodium: 6 },
  { name: 'Okra', calories: 33, protein: 1.9, carbs: 7, fat: 0.2, fiber: 3.2, sodium: 7 },
  { name: 'Kalabasa', calories: 26, protein: 1, carbs: 6.5, fat: 0.1, fiber: 0.5, sodium: 1 },
  { name: 'Malunggay', calories: 64, protein: 9.4, carbs: 8.3, fat: 1.4, fiber: 2, sodium: 9 },
  { name: 'Bell Pepper', calories: 31, protein: 1, carbs: 6, fat: 0.3, fiber: 2.1, sodium: 4 },
  { name: 'Broccoli', calories: 34, protein: 2.8, carbs: 7, fat: 0.4, fiber: 2.6, sodium: 33 },
  { name: 'Mushroom', calories: 22, protein: 3.1, carbs: 3.3, fat: 0.3, fiber: 1, sodium: 5 },
  { name: 'Corn', calories: 86, protein: 3.3, carbs: 19, fat: 1.4, fiber: 2.7, sodium: 15 },
  { name: 'Ginger', calories: 80, protein: 1.8, carbs: 18, fat: 0.8, fiber: 2, sodium: 13 },
  { name: 'Bok Choy', calories: 13, protein: 1.5, carbs: 2.2, fat: 0.2, fiber: 1, sodium: 65 },
  { name: 'Celery', calories: 16, protein: 0.7, carbs: 3, fat: 0.2, fiber: 1.6, sodium: 80 },
  { name: 'Cauliflower', calories: 25, protein: 1.9, carbs: 5, fat: 0.3, fiber: 2, sodium: 30 },
  { name: 'Bean Sprouts', calories: 30, protein: 3, carbs: 5.9, fat: 0.2, fiber: 1.8, sodium: 6 },
  // Fruits
  { name: 'Banana', calories: 89, protein: 1.1, carbs: 23, fat: 0.3, fiber: 2.6, sodium: 1 },
  { name: 'Mango', calories: 60, protein: 0.8, carbs: 15, fat: 0.4, fiber: 1.6, sodium: 1 },
  { name: 'Pineapple', calories: 50, protein: 0.5, carbs: 13, fat: 0.1, fiber: 1.4, sodium: 1 },
  { name: 'Avocado', calories: 160, protein: 2, carbs: 9, fat: 15, fiber: 6.7, sodium: 7 },
  { name: 'Papaya', calories: 43, protein: 0.5, carbs: 11, fat: 0.3, fiber: 1.7, sodium: 8 },
  { name: 'Coconut Meat', calories: 354, protein: 3.3, carbs: 15, fat: 33, fiber: 9, sodium: 20 },
  // Grains & Starches
  { name: 'White Rice (cooked)', calories: 130, protein: 2.7, carbs: 28, fat: 0.3, fiber: 0.4, sodium: 1 },
  { name: 'Brown Rice (cooked)', calories: 123, protein: 2.7, carbs: 26, fat: 1, fiber: 1.8, sodium: 5 },
  { name: 'Pasta (cooked)', calories: 158, protein: 5.8, carbs: 31, fat: 0.9, fiber: 1.8, sodium: 1 },
  { name: 'All-Purpose Flour', calories: 364, protein: 10, carbs: 76, fat: 1, fiber: 2.7, sodium: 2 },
  { name: 'Cornstarch', calories: 381, protein: 0.3, carbs: 91, fat: 0.1, fiber: 0.9, sodium: 9 },
  { name: 'Pandesal', calories: 270, protein: 8, carbs: 50, fat: 4, fiber: 1.5, sodium: 400 },
  { name: 'Bread', calories: 265, protein: 9, carbs: 49, fat: 3.2, fiber: 2.7, sodium: 491 },
  // Dairy
  { name: 'Milk', calories: 61, protein: 3.2, carbs: 4.8, fat: 3.3, fiber: 0, sodium: 43 },
  { name: 'Evaporated Milk', calories: 134, protein: 6.8, carbs: 10, fat: 7.6, fiber: 0, sodium: 106 },
  { name: 'Condensed Milk', calories: 321, protein: 7.9, carbs: 54, fat: 8.7, fiber: 0, sodium: 127 },
  { name: 'Butter', calories: 717, protein: 0.9, carbs: 0.1, fat: 81, fiber: 0, sodium: 576 },
  { name: 'Cheese', calories: 402, protein: 25, carbs: 1.3, fat: 33, fiber: 0, sodium: 621 },
  { name: 'Cream Cheese', calories: 342, protein: 6, carbs: 4.1, fat: 34, fiber: 0, sodium: 321 },
  { name: 'Cream', calories: 340, protein: 2.8, carbs: 2.8, fat: 36, fiber: 0, sodium: 38 },
  { name: 'Yogurt', calories: 59, protein: 3.5, carbs: 3.6, fat: 3.3, fiber: 0, sodium: 36 },
  { name: 'Greek Yogurt', calories: 97, protein: 9, carbs: 3.6, fat: 5, fiber: 0, sodium: 36 },
  { name: 'Coconut Milk', calories: 230, protein: 2.3, carbs: 6, fat: 24, fiber: 0, sodium: 15 },
  { name: 'Coconut Cream', calories: 330, protein: 3.6, carbs: 7, fat: 35, fiber: 0, sodium: 17 },
  // Pantry
  { name: 'Cooking Oil', calories: 884, protein: 0, carbs: 0, fat: 100, fiber: 0, sodium: 0 },
  { name: 'Olive Oil', calories: 884, protein: 0, carbs: 0, fat: 100, fiber: 0, sodium: 2 },
  { name: 'Sesame Oil', calories: 884, protein: 0, carbs: 0, fat: 100, fiber: 0, sodium: 0 },
  { name: 'Soy Sauce', calories: 53, protein: 8.1, carbs: 5, fat: 0.1, fiber: 0.8, sodium: 5493 },
  { name: 'Fish Sauce', calories: 35, protein: 5, carbs: 3.6, fat: 0, fiber: 0, sodium: 5670 },
  { name: 'Oyster Sauce', calories: 51, protein: 0.9, carbs: 10.8, fat: 0.2, fiber: 0, sodium: 2733 },
  { name: 'Vinegar', calories: 18, protein: 0, carbs: 0.6, fat: 0, fiber: 0, sodium: 2 },
  { name: 'Tomato Sauce', calories: 29, protein: 1.6, carbs: 6.2, fat: 0.3, fiber: 1.5, sodium: 397 },
  { name: 'Tomato Paste', calories: 82, protein: 4.3, carbs: 19, fat: 0.5, fiber: 4.3, sodium: 59 },
  { name: 'Sugar', calories: 387, protein: 0, carbs: 100, fat: 0, fiber: 0, sodium: 1 },
  { name: 'Brown Sugar', calories: 380, protein: 0, carbs: 98, fat: 0, fiber: 0, sodium: 28 },
  { name: 'Salt', calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 38758 },
  { name: 'Mayonnaise', calories: 680, protein: 1, carbs: 5, fat: 75, fiber: 0, sodium: 635 },
  { name: 'Ketchup', calories: 112, protein: 1.3, carbs: 28, fat: 0.1, fiber: 0.3, sodium: 1040 },
  { name: 'Hoisin Sauce', calories: 220, protein: 3.5, carbs: 46, fat: 2.3, fiber: 1.8, sodium: 1750 },
  { name: 'Bagoong', calories: 130, protein: 20, carbs: 2, fat: 4, fiber: 0, sodium: 4200 },
  { name: 'Lentils (cooked)', calories: 116, protein: 9, carbs: 20, fat: 0.4, fiber: 7.9, sodium: 2 },
  { name: 'Chickpeas (cooked)', calories: 164, protein: 8.9, carbs: 27, fat: 2.6, fiber: 7.6, sodium: 7 },
  { name: 'Kimchi', calories: 15, protein: 1.1, carbs: 2.4, fat: 0.5, fiber: 1.6, sodium: 498 },
  { name: 'Gochujang', calories: 175, protein: 5, carbs: 35, fat: 2, fiber: 1.5, sodium: 1490 },
  { name: 'Tamarind', calories: 239, protein: 2.8, carbs: 63, fat: 0.6, fiber: 5.1, sodium: 28 },
];

function searchLocalNutrition(query) {
  var q = query.toLowerCase();
  return LOCAL_NUTRITION_DB.filter(function(item) {
    return item.name.toLowerCase().includes(q);
  }).slice(0, 8);
}

// ── Nutrition Search (local DB first, USDA as fallback) ────────────────────────

// USDA FoodData Central API key. 'DEMO_KEY' is rate-limited to ~30 requests/hour
// per IP and WILL fail for real users. Get a free key (instant) at:
// https://fdc.nal.usda.gov/api-key-signup.html and paste it below.
const USDA_KEY = 'DEMO_KEY';
const USDA_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';

async function searchNutritionDB() {
  const input = document.getElementById('nutrition-db-query');
  const query = input ? input.value.trim() : '';
  if (!query) return;

  const resultsEl = document.getElementById('nutrition-db-results');
  resultsEl.classList.remove('hidden');

  const localResults = searchLocalNutrition(query);
  if (localResults.length > 0) {
    renderLocalNutritionResults(localResults, query);
    return;
  }

  resultsEl.innerHTML = '<div class="nutrition-db-loading">Not in local DB. Searching USDA…</div>';

  try {
    const params = new URLSearchParams({
      query: query,
      pageSize: '10',
      dataType: 'Survey (FNDDS),Foundation,SR Legacy',
      api_key: USDA_KEY
    });
    const res = await fetch(USDA_URL + '?' + params.toString());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    if (!data.foods || data.foods.length === 0) {
      resultsEl.innerHTML = '<div class="nutrition-db-empty">No results. Try a simpler term (e.g. "chicken" not "chicken adobo").</div>';
      return;
    }

    renderUSDANutritionResults(data.foods);
  } catch (e) {
    resultsEl.innerHTML = '<div class="nutrition-db-error">USDA search failed. Check your connection.</div>';
  }
}

function renderLocalNutritionResults(items, query) {
  var resultsEl = document.getElementById('nutrition-db-results');
  var html = '<div class="nutrition-db-source">' + icon('package') + ' Local database (instant)</div>';

  items.forEach(function(item) {
    html += '<div class="nutrition-db-item" onclick="applyNutritionResult(' + item.calories + ',' + item.protein + ',' + item.carbs + ',' + item.fat + ')">';
    html += '<div class="nutrition-db-item-name">' + item.name + '</div>';
    html += '<div class="nutrition-db-item-values">';
    html += '<span class="nv-cal">' + item.calories + ' kcal</span>';
    html += '<span>P ' + item.protein + 'g</span>';
    html += '<span>C ' + item.carbs + 'g</span>';
    html += '<span>F ' + item.fat + 'g</span>';
    html += '<span class="nutrition-db-per">per 100g</span>';
    html += '</div></div>';
  });

  html += '<div class="nutrition-db-usda-link"><button class="btn-link" onclick="searchUSDAFallback()">Not what you need? Search USDA online →</button></div>';
  resultsEl.innerHTML = html;
}

async function searchUSDAFallback() {
  const input = document.getElementById('nutrition-db-query');
  const query = input ? input.value.trim() : '';
  if (!query) return;

  const resultsEl = document.getElementById('nutrition-db-results');
  resultsEl.innerHTML = '<div class="nutrition-db-loading">Searching USDA…</div>';

  try {
    const params = new URLSearchParams({
      query: query,
      pageSize: '10',
      dataType: 'Survey (FNDDS),Foundation,SR Legacy',
      api_key: USDA_KEY
    });
    const res = await fetch(USDA_URL + '?' + params.toString());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (!data.foods || data.foods.length === 0) {
      resultsEl.innerHTML = '<div class="nutrition-db-empty">No USDA results either. Try a different search term.</div>';
      return;
    }
    renderUSDANutritionResults(data.foods);
  } catch (e) {
    resultsEl.innerHTML = '<div class="nutrition-db-error">USDA search failed. Check your connection.</div>';
  }
}

function getNutrientVal(nutrients, id) {
  var n = nutrients.find(function(x) { return x.nutrientId === id; });
  return n ? Math.round(n.value) : 0;
}

function renderUSDANutritionResults(foods) {
  var resultsEl = document.getElementById('nutrition-db-results');
  var html = '<div class="nutrition-db-source">📡 USDA FoodData Central</div>';

  foods.forEach(function(food) {
    var cal  = getNutrientVal(food.foodNutrients, 1008);
    var pro  = getNutrientVal(food.foodNutrients, 1003);
    var carb = getNutrientVal(food.foodNutrients, 1005);
    var fat  = getNutrientVal(food.foodNutrients, 1004);

    var per = food.servingSize
      ? 'per ' + food.servingSize + (food.servingSizeUnit || 'g')
      : 'per 100g';

    var name = food.description
      .toLowerCase()
      .replace(/\b\w/g, function(c) { return c.toUpperCase(); });

    var brand = food.brandOwner ? ' <span class="nutrition-db-brand">(' + food.brandOwner + ')</span>' : '';

    html += '<div class="nutrition-db-item" onclick="applyNutritionResult(' + cal + ',' + pro + ',' + carb + ',' + fat + ')">';
    html += '<div class="nutrition-db-item-name">' + name + brand + '</div>';
    html += '<div class="nutrition-db-item-values">';
    html += '<span class="nv-cal">' + cal + ' kcal</span>';
    html += '<span>P ' + pro + 'g</span>';
    html += '<span>C ' + carb + 'g</span>';
    html += '<span>F ' + fat + 'g</span>';
    html += '<span class="nutrition-db-per">' + per + '</span>';
    html += '</div></div>';
  });

  resultsEl.innerHTML = html;
}

function renderNutritionDBResults(foods) {
  renderUSDANutritionResults(foods);
}

function applyNutritionResult(cal, pro, carb, fat) {
  document.getElementById('nutrition-calories').value = cal || '';
  document.getElementById('nutrition-protein').value  = pro  || '';
  document.getElementById('nutrition-carbs').value    = carb || '';
  document.getElementById('nutrition-fat').value      = fat  || '';

  var resultsEl = document.getElementById('nutrition-db-results');
  var queryEl   = document.getElementById('nutrition-db-query');
  if (resultsEl) resultsEl.classList.add('hidden');
  if (queryEl)   queryEl.value = '';
}



// ── Ingredient Autocomplete Database ──────────────────────────────────────────

const INGREDIENT_DB = [
  // Proteins — bought by the kilo at wet market / supermarket
  { name: 'Chicken Breast', unit: 'kg', category: 'Protein', price: '₱200/kg', store: 'Wet Market / Supermarket' },
  { name: 'Chicken Thigh', unit: 'kg', category: 'Protein', price: '₱180/kg', store: 'Wet Market / Supermarket' },
  { name: 'Chicken Leg', unit: 'kg', category: 'Protein', price: '₱160/kg', store: 'Wet Market / Supermarket' },
  { name: 'Ground Chicken', unit: 'kg', category: 'Protein', price: '₱220/kg', store: 'Supermarket' },
  { name: 'Whole Chicken', unit: 'kg', category: 'Protein', price: '₱160/kg', store: 'Wet Market / Supermarket' },
  { name: 'Pork Belly (Liempo)', unit: 'kg', category: 'Protein', price: '₱280/kg', store: 'Wet Market / Supermarket' },
  { name: 'Ground Pork', unit: 'kg', category: 'Protein', price: '₱230/kg', store: 'Wet Market / Supermarket' },
  { name: 'Pork Chop', unit: 'kg', category: 'Protein', price: '₱260/kg', store: 'Wet Market / Supermarket' },
  { name: 'Pork Ribs', unit: 'kg', category: 'Protein', price: '₱300/kg', store: 'Wet Market / Supermarket' },
  { name: 'Pork Shoulder', unit: 'kg', category: 'Protein', price: '₱220/kg', store: 'Wet Market / Supermarket' },
  { name: 'Pork Liver', unit: 'kg', category: 'Protein', price: '₱120/kg', store: 'Wet Market' },
  { name: 'Ground Beef', unit: 'kg', category: 'Protein', price: '₱320/kg', store: 'Wet Market / Supermarket' },
  { name: 'Beef', unit: 'kg', category: 'Protein', price: '₱350/kg', store: 'Wet Market / Supermarket' },
  { name: 'Beef Brisket', unit: 'kg', category: 'Protein', price: '₱380/kg', store: 'Supermarket' },
  { name: 'Shrimp', unit: 'kg', category: 'Protein', price: '₱350/kg', store: 'Wet Market / Seafood Market' },
  { name: 'Bangus (Milkfish)', unit: 'kg', category: 'Protein', price: '₱140/kg', store: 'Wet Market / Supermarket' },
  { name: 'Tilapia', unit: 'kg', category: 'Protein', price: '₱120/kg', store: 'Wet Market' },
  { name: 'Salmon', unit: 'kg', category: 'Protein', price: '₱600/kg', store: 'Supermarket / S&R' },
  { name: 'Tuna', unit: 'kg', category: 'Protein', price: '₱200/kg', store: 'Wet Market / Supermarket' },
  { name: 'Galunggong', unit: 'kg', category: 'Protein', price: '₱90/kg', store: 'Wet Market' },
  { name: 'Squid (Pusit)', unit: 'kg', category: 'Protein', price: '₱200/kg', store: 'Wet Market' },
  { name: 'Crab', unit: 'kg', category: 'Protein', price: '₱250/kg', store: 'Wet Market / Seafood Market' },
  { name: 'Mussels (Tahong)', unit: 'kg', category: 'Protein', price: '₱60/kg', store: 'Wet Market' },
  { name: 'Clams (Halaan)', unit: 'kg', category: 'Protein', price: '₱80/kg', store: 'Wet Market' },
  { name: 'Eggs', unit: 'pieces', category: 'Protein', price: '₱10/pc', store: 'Grocery / Supermarket' },
  { name: 'Tofu (Tokwa)', unit: 'g', category: 'Protein', price: '₱35/block', store: 'Wet Market / Grocery' },
  { name: 'Longganisa', unit: 'pack', category: 'Protein', price: '₱80/pack', store: 'Supermarket / Grocery' },
  { name: 'Hotdog', unit: 'pack', category: 'Protein', price: '₱60/pack', store: 'Supermarket / Grocery' },
  { name: 'Bacon', unit: 'g', category: 'Protein', price: '₱250/200g', store: 'Supermarket' },
  { name: 'Ham', unit: 'kg', category: 'Protein', price: '₱300/kg', store: 'Supermarket' },
  { name: 'Sardines (Canned)', unit: 'can', category: 'Protein', price: '₱30/can', store: 'Any Store' },
  { name: 'Tuna (Canned)', unit: 'can', category: 'Protein', price: '₱55/can', store: 'Any Store' },
  { name: 'Corned Beef (Canned)', unit: 'can', category: 'Protein', price: '₱75/can', store: 'Any Store' },

  // Vegetables
  { name: 'Garlic (Bawang)', unit: 'g', category: 'Vegetable', price: '₱80/100g', store: 'Wet Market / Grocery' },
  { name: 'Onion (Sibuyas)', unit: 'kg', category: 'Vegetable', price: '₱80/kg', store: 'Wet Market / Grocery' },
  { name: 'Red Onion', unit: 'kg', category: 'Vegetable', price: '₱90/kg', store: 'Wet Market / Grocery' },
  { name: 'Shallots', unit: 'kg', category: 'Vegetable', price: '₱60/kg', store: 'Wet Market' },
  { name: 'Tomato (Kamatis)', unit: 'kg', category: 'Vegetable', price: '₱50/kg', store: 'Wet Market / Grocery' },
  { name: 'Potato (Patatas)', unit: 'kg', category: 'Vegetable', price: '₱70/kg', store: 'Wet Market / Supermarket' },
  { name: 'Sweet Potato (Kamote)', unit: 'kg', category: 'Vegetable', price: '₱50/kg', store: 'Wet Market' },
  { name: 'Carrot (Karot)', unit: 'kg', category: 'Vegetable', price: '₱60/kg', store: 'Wet Market / Grocery' },
  { name: 'Cabbage (Repolyo)', unit: 'kg', category: 'Vegetable', price: '₱40/kg', store: 'Wet Market / Grocery' },
  { name: 'Kangkong', unit: 'bunches', category: 'Vegetable', price: '₱15/bunch', store: 'Wet Market' },
  { name: 'Pechay', unit: 'bunches', category: 'Vegetable', price: '₱15/bunch', store: 'Wet Market / Grocery' },
  { name: 'Spinach', unit: 'g', category: 'Vegetable', price: '₱80/200g', store: 'Supermarket' },
  { name: 'Ampalaya (Bitter Melon)', unit: 'pieces', category: 'Vegetable', price: '₱30/pc', store: 'Wet Market' },
  { name: 'Talong (Eggplant)', unit: 'pieces', category: 'Vegetable', price: '₱20/pc', store: 'Wet Market / Grocery' },
  { name: 'Sitaw (String Beans)', unit: 'g', category: 'Vegetable', price: '₱40/bundle', store: 'Wet Market' },
  { name: 'Okra', unit: 'g', category: 'Vegetable', price: '₱40/250g', store: 'Wet Market / Grocery' },
  { name: 'Malunggay (Moringa)', unit: 'bunches', category: 'Vegetable', price: '₱10/bunch', store: 'Wet Market' },
  { name: 'Kalabasa (Squash)', unit: 'kg', category: 'Vegetable', price: '₱30/kg', store: 'Wet Market' },
  { name: 'Upo (Bottle Gourd)', unit: 'pieces', category: 'Vegetable', price: '₱20/pc', store: 'Wet Market' },
  { name: 'Patola (Sponge Gourd)', unit: 'pieces', category: 'Vegetable', price: '₱20/pc', store: 'Wet Market' },
  { name: 'Bell Pepper', unit: 'pieces', category: 'Vegetable', price: '₱30/pc', store: 'Wet Market / Supermarket' },
  { name: 'Green Bell Pepper', unit: 'pieces', category: 'Vegetable', price: '₱25/pc', store: 'Wet Market / Grocery' },
  { name: 'Red Bell Pepper', unit: 'pieces', category: 'Vegetable', price: '₱35/pc', store: 'Wet Market / Supermarket' },
  { name: 'Celery (Kintsay)', unit: 'stalks', category: 'Vegetable', price: '₱20/bundle', store: 'Wet Market / Grocery' },
  { name: 'Green Onion (Sibuyas Dahon)', unit: 'stalks', category: 'Vegetable', price: '₱15/bundle', store: 'Wet Market / Grocery' },
  { name: 'Ginger (Luya)', unit: 'g', category: 'Vegetable', price: '₱60/100g', store: 'Wet Market / Grocery' },
  { name: 'Lemongrass (Tanglad)', unit: 'stalks', category: 'Vegetable', price: '₱10/bundle', store: 'Wet Market' },
  { name: 'Mushroom', unit: 'g', category: 'Vegetable', price: '₱150/200g', store: 'Supermarket' },
  { name: 'Corn (Mais)', unit: 'pieces', category: 'Vegetable', price: '₱20/pc', store: 'Wet Market / Grocery' },
  { name: 'Cucumber', unit: 'pieces', category: 'Vegetable', price: '₱20/pc', store: 'Wet Market / Grocery' },
  { name: 'Lettuce', unit: 'g', category: 'Vegetable', price: '₱50/head', store: 'Wet Market / Supermarket' },
  { name: 'Broccoli', unit: 'g', category: 'Vegetable', price: '₱80/head', store: 'Supermarket' },
  { name: 'Cauliflower', unit: 'g', category: 'Vegetable', price: '₱80/head', store: 'Supermarket' },
  { name: 'Chili (Siling Labuyo)', unit: 'g', category: 'Vegetable', price: '₱30/100g', store: 'Wet Market / Grocery' },
  { name: 'Siling Haba (Long Green Chili)', unit: 'g', category: 'Vegetable', price: '₱20/100g', store: 'Wet Market' },
  { name: 'Bean Sprouts (Toge)', unit: 'g', category: 'Vegetable', price: '₱20/200g', store: 'Wet Market / Grocery' },
  { name: 'Bok Choy', unit: 'g', category: 'Vegetable', price: '₱40/bundle', store: 'Wet Market / Supermarket' },

  // Fruits
  { name: 'Banana (Saging)', unit: 'kg', category: 'Fruit', price: '₱50/kg', store: 'Any Store' },
  { name: 'Mango (Mangga)', unit: 'kg', category: 'Fruit', price: '₱120/kg', store: 'Wet Market / Grocery' },
  { name: 'Pineapple (Pinya)', unit: 'pieces', category: 'Fruit', price: '₱50/pc', store: 'Wet Market / Grocery' },
  { name: 'Calamansi', unit: 'kg', category: 'Fruit', price: '₱80/kg', store: 'Wet Market / Grocery' },
  { name: 'Lemon', unit: 'pieces', category: 'Fruit', price: '₱25/pc', store: 'Supermarket' },
  { name: 'Lime', unit: 'pieces', category: 'Fruit', price: '₱20/pc', store: 'Supermarket' },
  { name: 'Papaya', unit: 'kg', category: 'Fruit', price: '₱40/kg', store: 'Wet Market / Grocery' },
  { name: 'Coconut (Niyog)', unit: 'pieces', category: 'Fruit', price: '₱30/pc', store: 'Wet Market' },
  { name: 'Apple', unit: 'pieces', category: 'Fruit', price: '₱35/pc', store: 'Supermarket / Grocery' },
  { name: 'Avocado', unit: 'pieces', category: 'Fruit', price: '₱50/pc', store: 'Wet Market / Supermarket' },

  // Grains & Starches — rice by kg, dry goods by g
  { name: 'White Rice (Bigas)', unit: 'kg', category: 'Grain', price: '₱55/kg', store: 'Any Store' },
  { name: 'Brown Rice', unit: 'kg', category: 'Grain', price: '₱80/kg', store: 'Supermarket / Health Store' },
  { name: 'Glutinous Rice (Malagkit)', unit: 'kg', category: 'Grain', price: '₱75/kg', store: 'Grocery / Supermarket' },
  { name: 'Cornstarch', unit: 'g', category: 'Grain', price: '₱25/pack', store: 'Any Store' },
  { name: 'All-Purpose Flour', unit: 'g', category: 'Grain', price: '₱55/kg', store: 'Any Store' },
  { name: 'Breadcrumbs', unit: 'g', category: 'Grain', price: '₱45/pack', store: 'Supermarket / Grocery' },
  { name: 'Pasta', unit: 'g', category: 'Grain', price: '₱55/500g', store: 'Supermarket / Grocery' },
  { name: 'Bihon Noodles', unit: 'g', category: 'Grain', price: '₱35/pack', store: 'Any Store' },
  { name: 'Canton Noodles', unit: 'g', category: 'Grain', price: '₱30/pack', store: 'Any Store' },
  { name: 'Sotanghon (Glass Noodles)', unit: 'g', category: 'Grain', price: '₱30/pack', store: 'Any Store' },
  { name: 'Miki Noodles', unit: 'g', category: 'Grain', price: '₱20/pack', store: 'Wet Market / Grocery' },
  { name: 'Bread (Tinapay)', unit: 'pieces', category: 'Grain', price: '₱60/loaf', store: 'Bakery / Grocery' },
  { name: 'Pandesal', unit: 'pieces', category: 'Grain', price: '₱4/pc', store: 'Any Bakery' },

  // Dairy
  { name: 'Milk (Gatas)', unit: 'ml', category: 'Dairy', price: '₱90/1L', store: 'Supermarket / Grocery' },
  { name: 'Evaporated Milk', unit: 'ml', category: 'Dairy', price: '₱40/can', store: 'Any Store' },
  { name: 'Condensed Milk', unit: 'ml', category: 'Dairy', price: '₱45/can', store: 'Any Store' },
  { name: 'Cheese', unit: 'g', category: 'Dairy', price: '₱120/165g', store: 'Supermarket / Grocery' },
  { name: 'Cream', unit: 'ml', category: 'Dairy', price: '₱75/250ml', store: 'Supermarket' },
  { name: 'Cream Cheese', unit: 'g', category: 'Dairy', price: '₱150/250g', store: 'Supermarket' },
  { name: 'Butter', unit: 'g', category: 'Dairy', price: '₱130/200g', store: 'Supermarket / Grocery' },
  { name: 'Margarine', unit: 'g', category: 'Dairy', price: '₱80/250g', store: 'Any Store' },
  { name: 'Yogurt', unit: 'ml', category: 'Dairy', price: '₱80/150g', store: 'Supermarket' },

  // Pantry — liquid condiments in ml, thick sauces/pastes/spices in g
  { name: 'Soy Sauce (Toyo)', unit: 'ml', category: 'Pantry', price: '₱25/200ml', store: 'Any Store' },
  { name: 'Fish Sauce (Patis)', unit: 'ml', category: 'Pantry', price: '₱25/200ml', store: 'Any Store' },
  { name: 'Vinegar (Suka)', unit: 'ml', category: 'Pantry', price: '₱20/200ml', store: 'Any Store' },
  { name: 'Oyster Sauce', unit: 'g', category: 'Pantry', price: '₱50/230g', store: 'Supermarket / Grocery' },
  { name: 'Coconut Milk', unit: 'ml', category: 'Pantry', price: '₱45/400ml', store: 'Any Store' },
  { name: 'Coconut Cream', unit: 'ml', category: 'Pantry', price: '₱50/400ml', store: 'Supermarket / Grocery' },
  { name: 'Tomato Paste', unit: 'g', category: 'Pantry', price: '₱30/small can', store: 'Any Store' },
  { name: 'Tomato Sauce', unit: 'ml', category: 'Pantry', price: '₱30/250ml', store: 'Any Store' },
  { name: 'Cooking Oil', unit: 'ml', category: 'Pantry', price: '₱80/1L', store: 'Any Store' },
  { name: 'Sesame Oil', unit: 'ml', category: 'Pantry', price: '₱120/200ml', store: 'Supermarket / Asian Store' },
  { name: 'Salt', unit: 'g', category: 'Pantry', price: '₱15/pack', store: 'Any Store' },
  { name: 'Black Pepper', unit: 'g', category: 'Pantry', price: '₱20/small pack', store: 'Any Store' },
  { name: 'White Pepper', unit: 'g', category: 'Pantry', price: '₱20/small pack', store: 'Grocery / Supermarket' },
  { name: 'Sugar', unit: 'g', category: 'Pantry', price: '₱65/kg', store: 'Any Store' },
  { name: 'Brown Sugar', unit: 'g', category: 'Pantry', price: '₱70/kg', store: 'Any Store' },
  { name: 'Peppercorn', unit: 'g', category: 'Pantry', price: '₱30/pack', store: 'Grocery / Supermarket' },
  { name: 'Bay Leaves', unit: 'pieces', category: 'Pantry', price: '₱15/pack', store: 'Grocery / Supermarket' },
  { name: 'Chili Flakes', unit: 'g', category: 'Pantry', price: '₱25/pack', store: 'Grocery / Supermarket' },
  { name: 'Paprika', unit: 'g', category: 'Pantry', price: '₱35/pack', store: 'Supermarket' },
  { name: 'Cumin', unit: 'g', category: 'Pantry', price: '₱35/pack', store: 'Supermarket / Asian Store' },
  { name: 'Turmeric', unit: 'g', category: 'Pantry', price: '₱30/pack', store: 'Supermarket / Asian Store' },
  { name: 'Oregano', unit: 'g', category: 'Pantry', price: '₱25/pack', store: 'Grocery / Supermarket' },
  { name: 'Thyme', unit: 'g', category: 'Pantry', price: '₱30/pack', store: 'Supermarket' },
  { name: 'Basil', unit: 'g', category: 'Pantry', price: '₱30/pack', store: 'Supermarket' },
  { name: 'Parsley', unit: 'g', category: 'Pantry', price: '₱30/pack', store: 'Supermarket' },
  { name: 'Garlic Powder', unit: 'g', category: 'Pantry', price: '₱35/pack', store: 'Grocery / Supermarket' },
  { name: 'Onion Powder', unit: 'g', category: 'Pantry', price: '₱35/pack', store: 'Grocery / Supermarket' },
  { name: 'Worcestershire Sauce', unit: 'ml', category: 'Pantry', price: '₱80/bottle', store: 'Supermarket' },
  { name: 'Ketchup', unit: 'g', category: 'Pantry', price: '₱40/320g', store: 'Any Store' },
  { name: 'Banana Ketchup', unit: 'g', category: 'Pantry', price: '₱35/320g', store: 'Any Store' },
  { name: 'Mayonnaise', unit: 'g', category: 'Pantry', price: '₱70/470g', store: 'Supermarket / Grocery' },
  { name: 'Hoisin Sauce', unit: 'g', category: 'Pantry', price: '₱90/240g', store: 'Supermarket / Asian Store' },
  { name: 'Chili Sauce', unit: 'ml', category: 'Pantry', price: '₱55/bottle', store: 'Supermarket / Asian Store' },
  { name: 'Cooking Wine', unit: 'ml', category: 'Pantry', price: '₱80/bottle', store: 'Supermarket / Asian Store' },
  { name: 'Beef Broth / Stock', unit: 'ml', category: 'Pantry', price: '₱35/pack', store: 'Supermarket / Grocery' },
  { name: 'Chicken Broth / Stock', unit: 'ml', category: 'Pantry', price: '₱35/pack', store: 'Supermarket / Grocery' },
  { name: 'Water', unit: 'ml', category: 'Pantry', price: '₱0', store: 'Any' },
  { name: 'Annatto (Atsuete)', unit: 'g', category: 'Pantry', price: '₱20/pack', store: 'Wet Market / Asian Store' },
  { name: 'Tamarind (Sampalok)', unit: 'g', category: 'Pantry', price: '₱30/100g', store: 'Wet Market / Grocery' },
  { name: 'Tamarind Paste', unit: 'g', category: 'Pantry', price: '₱50/jar', store: 'Supermarket / Asian Store' },
  { name: 'Bagoong', unit: 'g', category: 'Pantry', price: '₱40/small jar', store: 'Any Store' },
  { name: 'Shrimp Paste', unit: 'g', category: 'Pantry', price: '₱35/small jar', store: 'Wet Market / Grocery' },
  { name: 'Cooking Cream', unit: 'ml', category: 'Pantry', price: '₱75/250ml', store: 'Supermarket' },
  { name: 'Baking Powder', unit: 'g', category: 'Pantry', price: '₱25/pack', store: 'Any Store' },
  { name: 'Baking Soda', unit: 'g', category: 'Pantry', price: '₱20/pack', store: 'Any Store' },
  { name: 'Vanilla Extract', unit: 'ml', category: 'Pantry', price: '₱45/bottle', store: 'Supermarket / Grocery' },

  // Added for fuller recipe coverage (estimated PH prices)
  { name: 'Beef Sirloin', unit: 'kg', category: 'Protein', price: '₱450/kg', store: 'Wet Market / Supermarket' },
  { name: 'Olive Oil', unit: 'ml', category: 'Pantry', price: '₱350/500ml', store: 'Supermarket' },
  { name: 'Honey', unit: 'g', category: 'Pantry', price: '₱180/350g', store: 'Supermarket' },
  { name: 'Rolled Oats', unit: 'g', category: 'Grain', price: '₱180/800g', store: 'Supermarket' },
  { name: 'Granola', unit: 'g', category: 'Grain', price: '₱250/500g', store: 'Supermarket' },
  { name: 'Chia Seeds', unit: 'g', category: 'Pantry', price: '₱150/250g', store: 'Supermarket / Health Store' },
  { name: 'Red Lentils', unit: 'g', category: 'Pantry', price: '₱120/500g', store: 'Supermarket' },
  { name: 'Mixed Berries', unit: 'g', category: 'Fruit', price: '₱280/500g', store: 'Supermarket (Frozen)' },
  { name: 'Scallions', unit: 'kg', category: 'Vegetable', price: '₱120/kg', store: 'Wet Market' },
  { name: 'Chayote (Sayote)', unit: 'kg', category: 'Vegetable', price: '₱50/kg', store: 'Wet Market' },
  { name: 'Kimchi', unit: 'g', category: 'Pantry', price: '₱200/500g', store: 'Supermarket / Korean Store' },
  { name: 'Gochujang', unit: 'g', category: 'Pantry', price: '₱250/500g', store: 'Supermarket / Korean Store' },
  { name: 'Garam Masala', unit: 'g', category: 'Pantry', price: '₱45/pack', store: 'Supermarket' },
  { name: 'Dried Herbs', unit: 'g', category: 'Pantry', price: '₱40/pack', store: 'Supermarket' },
];

function filterIngredients(query) {
  var q = query.toLowerCase();
  var userMatches = (AppState.userIngredients || [])
    .filter(function(i) { return i.name.toLowerCase().includes(q); })
    .map(function(i) { return { name: i.name, unit: i.unit, category: i.category, price: '', store: '', isCustom: true }; });
  var dbMatches = INGREDIENT_DB.filter(function(i) { return i.name.toLowerCase().includes(q); });
  return userMatches.concat(dbMatches).slice(0, 10);
}

// Unified ingredient lookup — the app's single answer for "what do we know about
// this ingredient?", merging the separate price / nutrition / storage databases.
// Each field is null when unknown, so callers can fall back gracefully.
function getIngredientInfo(name) {
  var priced = findIngredientPrice(name);
  var nutrition = findIngredientNutrition(name);
  var storage = lookupPantryKnowledge(name);
  return {
    name: name,
    priceLabel: priced ? (priced.priceLabel || ('₱' + priced.pricePerUnit + (priced.unit ? '/' + priced.unit : ''))) : null,
    nutrition: (nutrition && nutrition.calories != null) ? nutrition : null,
    storage: storage // hand-written PK entry, or null (use genericStorageGuide for the long tail)
  };
}

function attachIngredientAutocomplete(nameInput, onSelect) {
  var wrap = nameInput.parentElement;

  nameInput.addEventListener('input', function() {
    var q = this.value.trim();
    var suggestBox = wrap.querySelector('.ing-suggestions');
    if (!q || q.length < 1) { suggestBox.classList.add('hidden'); return; }

    var matches = filterIngredients(q);
    if (matches.length === 0) { suggestBox.classList.add('hidden'); return; }

    suggestBox.innerHTML = matches.map(function(item) {
      var priceStore = (item.price ? item.price : '') + (item.store ? ' &nbsp;📍 ' + item.store : '');
      // Surface the merged nutrition + storage so all three show at a glance.
      var info = getIngredientInfo(item.name);
      var extra = [];
      if (info.nutrition) extra.push('🔥 ' + Math.round(info.nutrition.calories) + ' cal/100g');
      if (info.storage) extra.push(info.storage.locationIcon + ' ' + info.storage.location + (info.storage.lasts ? ' · ' + info.storage.lasts : ''));
      return '<div class="ing-suggestion-item" data-name="' + item.name +
        '" data-unit="' + item.unit + '" data-cat="' + item.category + '">' +
        '<div class="ing-sug-main">' +
        '<span class="ing-sug-name">' + item.name + '</span>' +
        '<span class="ing-sug-unit">' + item.unit + ' &bull; ' + item.category + '</span>' +
        '</div>' +
        (priceStore ? '<div class="ing-sug-price">' + priceStore + '</div>' : '') +
        (extra.length ? '<div class="ing-sug-info">' + extra.join(' &nbsp; ') + '</div>' : '') +
        '</div>';
    }).join('');
    suggestBox.classList.remove('hidden');

    suggestBox.querySelectorAll('.ing-suggestion-item').forEach(function(el) {
      el.addEventListener('mousedown', function(e) {
        e.preventDefault(); // prevent blur before click
        nameInput.value = el.dataset.name;
        suggestBox.classList.add('hidden');

        // Custom contexts (e.g. the grocery custom-item modal) handle their own
        // field filling via onSelect. Otherwise use the recipe-row layout.
        if (typeof onSelect === 'function') { onSelect(el.dataset); return; }

        var row = nameInput.closest('.ingredient-item');
        if (!row) return; // e.g. the pantry box infers unit/category itself
        var selects = row.querySelectorAll('select');
        if (selects[0]) for (var o of selects[0].options) {
          if (o.value === el.dataset.unit) { o.selected = true; break; }
        }
        if (selects[1]) for (var o2 of selects[1].options) {
          if (o2.value === el.dataset.cat) { o2.selected = true; break; }
        }
        var qtyInput = row.querySelector('input[type="number"]');
        if (qtyInput) qtyInput.focus();
      });
    });
  });

  nameInput.addEventListener('blur', function() {
    var suggestBox = wrap.querySelector('.ing-suggestions');
    setTimeout(function() { suggestBox.classList.add('hidden'); }, 150);
  });

  nameInput.addEventListener('keydown', function(e) {
    var suggestBox = wrap.querySelector('.ing-suggestions');
    if (e.key === 'Escape') suggestBox.classList.add('hidden');
  });
}

