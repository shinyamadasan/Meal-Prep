// Server-side equivalents of the pantry-mutating UI functions in app.js — reimplemented against
// decoded Firestore field values, never against the app's in-browser AppState. Every function
// here is pure: it takes the current `pantry` array + the `pantry` tombstone bucket and returns
// a NEW array/bucket plus the response item, so index.js can diff "did anything actually change"
// cleanly for the `unchanged:true` cases the contract requires.
//
// CLASSIFICATION (TASK-097, PROP-041 P2-0a): staple vs non-staple is the app's own answer,
// MealPrepFoodSafety.isStaple from shared/foodSafety.js (stored flag -> exact-name INGREDIENT_DB
// isStaple -> category 'Pantry' -> non-staple). Before TASK-097 the bridge had no INGREDIENT_DB and
// refused every record it could not resolve as `ambiguous`; the shared core removes that gap. A
// record the shared rule cannot read (not an object, or a name/category that is not text) is
// `invalid`: reads flag it as invalid-record and every write refuses it, never guessing.
import { InsufficientStockError, NotFoundError, ValidationError } from '../errors.js';
import { convertQuantity, INVENTORY_UNITS } from './quantity.js';
// Shared food-safety rules (TASK-091, D-090): defines globalThis.MealPrepFoodSafety, the same rules
// the app uses. The get_inventory safety verdict (TASK-092), add_stock's merge gate (TASK-094) and
// the staple classification (TASK-097) all read it.
import '../../../../shared/foodSafety.js';

const FoodSafety = globalThis.MealPrepFoodSafety;

const MAX_UNIT_LENGTH = 40;
const MAX_STOCK_QUANTITY = Number.MAX_SAFE_INTEGER;

// 'staple' | 'non-staple' | 'invalid'. Delegates to the shared rule; anything it cannot read throws
// there (a stored map or number as name/category, a getter that throws) and is 'invalid' here.
// Exported for the parity test (test/mcp-staple-parity.node.js).
export function classifyStaple(p) {
  if (p == null || typeof p !== 'object' || Array.isArray(p)) return 'invalid';
  try {
    return FoodSafety.isStaple(p) === true ? 'staple' : 'non-staple';
  } catch {
    return 'invalid';
  }
}

function isStapleRecord(p) {
  return classifyStaple(p) === 'staple';
}

// How chat tracks a lot (TASK-097): 'level' = staple (stockLevel full/ok/low/empty); 'quantity' =
// non-staple with a finite quantity (any sign; the app treats <= 0 as not available) and a unit;
// 'presence' = non-staple recorded without a usable amount (being listed is all it says).
// null = the record cannot be classified.
function trackingOf(p, classification) {
  if (classification === 'staple') return 'level';
  if (classification !== 'non-staple') return null;
  const counted = typeof p.quantity === 'number' && Number.isFinite(p.quantity) &&
    typeof p.unit === 'string' && p.unit.trim() !== '';
  return counted ? 'quantity' : 'presence';
}

// Every write gates on this: a record get_inventory flags invalid-record (tracking null) is refused,
// never guessed or changed — the same gate as the read (readableLot + classification), so no write
// can change a record chat was told not to touch, or save and then fail output validation
// (TASK-097 review M1).
function requireClassified(record, ingredientId) {
  const classification = classifyStaple(record);
  if (classification === 'invalid' || !readableLot(record)) {
    throw new ValidationError(
      'invalid_record: ingredientId "' + ingredientId + '" could not be read safely (a stored field such as its ' +
      'name, category, quantity, unit, storage or stock level is not in the form the app writes), so it cannot be ' +
      'changed from chat. Ask the user to check it in the app.',
      { field: 'ingredientId', code: 'invalid_record' }
    );
  }
  return classification;
}

// Quantity tools (set_inventory_quantity, consume_stock, add_stock) only change counted lots.
function requireQuantityTracked(record, ingredientId, classification) {
  if (classification === 'non-staple' && trackingOf(record, classification) === 'presence') {
    throw new ValidationError(
      'presence_only: ingredientId "' + ingredientId + '" is recorded without an amount (no usable quantity and ' +
      'unit), so its amount cannot be changed from chat. Do not guess an amount: ask the user how much they ' +
      'have, and tell them the amount can be recorded in the app.',
      { field: 'ingredientId', code: 'presence_only', tracking: 'presence' }
    );
  }
}

function findPantryIndex(pantry, ingredientId) {
  // Same safe id rule as the reads (readableId): a stored id that is not text or a finite number
  // (a map, array, boolean) can never match and is never passed to String(), which can throw.
  return pantry.findIndex((p) => p && readableId(p.id) && String(p.id) === String(ingredientId));
}

function toInventoryItem(p) {
  return {
    ingredientId: String(p.id),
    name: p.name != null ? p.name : null,
    quantity: p.quantity != null ? p.quantity : null,
    unit: p.unit != null ? p.unit : null,
    inStock: isStapleRecord(p) ? p.stockLevel !== 'empty' : true,
    staple: isStapleRecord(p),
    stockLevel: p.stockLevel != null ? p.stockLevel : null,
    storage: p.storage != null ? p.storage : null,
    updatedAt: p.updatedAt != null ? p.updatedAt : null
  };
}

export function listInventory(pantry) {
  return (pantry || []).map(toInventoryItem);
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// A real YYYY-MM-DD calendar day by the shared calendar rule (no rollover: 2026-02-30 is not one).
export function isCalendarDay(value) {
  return typeof value === 'string' && DATE_ONLY.test(value) && FoodSafety.stockCalendarDay(value) != null;
}

export function requireHouseholdDay(today) {
  if (!isCalendarDay(today)) {
    throw new TypeError('A YYYY-MM-DD household day is required for safety verdicts.');
  }
  return today;
}

function textOrNull(value) {
  return typeof value === 'string' ? value : null;
}

export function useSoonLabel(daysLeft) {
  return daysLeft === 0 ? 'Use today' : 'Use soon - ' + daysLeft + 'd left';
}

// Chat's safety verdict for one pantry lot (TASK-092, D-091), computed ONLY from the shared rules
// on the household day, with the shared default storage path (no PANTRY_KNOWLEDGE): a lot with no
// storage that INGREDIENT_DB cannot place is `unknown`. `usable` is the app's pantryLotAvailable()
// verdict, except that an `expired` or `unknown` lot is never usable (stricter than the app for a
// staple past its printed use-by, TASK-091 finding F2). Labels reuse the app's own wording.
export function pantrySafety(p, today) {
  requireHouseholdDay(today);
  let signal;
  let available;
  let fridge;
  try {
    signal = FoodSafety.pantryDateSignal(p, today);
    available = FoodSafety.pantryLotAvailable(p, today);
    fridge = FoodSafety.pantryFridgeSafety(p, today);
  } catch {
    // A record the shared rules cannot read is unknown, never usable; it must not hide the rest.
    return { status: 'unknown', reason: 'unreadable-record', label: 'Record could not be checked - check it in the app before use', daysLeft: null, usable: false };
  }
  // An absurd stored shelf life (1e20, +/-Infinity, NaN) gives a day count the schema cannot carry
  // or that would read as "no date"; that lot alone is unknown, never ok and never a failed read.
  if (signal.daysLeft != null && !Number.isSafeInteger(signal.daysLeft)) {
    return { status: 'unknown', reason: 'unreadable-record', label: 'Record could not be checked - check it in the app before use', daysLeft: null, usable: false };
  }
  let daysLeft = signal.daysLeft == null ? null : signal.daysLeft;
  let kind = signal.kind;
  // Within a fridge safety limit the app shows the shelf-life estimate, which can outlast the
  // limit (raw chicken: 3-day protein estimate, 2-day poultry limit). Chat gets the sooner day, so
  // "days left" never runs past the safety limit; this can only make the answer stricter.
  if (kind !== 'expired' && kind !== 'unknown' && fridge && Number.isFinite(fridge.daysLeft) &&
      (daysLeft == null || fridge.daysLeft < daysLeft)) {
    daysLeft = fridge.daysLeft;
    if (kind == null && daysLeft <= FoodSafety.FRESHNESS_WARN_DAYS) kind = 'use-soon';
  }
  // The app's Fridge list shows any lot past its shelf-life estimate (no printed date) as
  // "Estimated window passed" in check styling, wherever it is stored (counter, freezer,
  // non-perishables). Chat must not call it in-date. Availability is unchanged (quality only).
  if (kind == null && daysLeft != null && daysLeft < 0 && !signal.printed) kind = 'check';
  let status;
  let reason;
  let label;
  if (kind === 'unknown') {
    status = 'unknown';
    reason = 'unknown-storage';
    label = 'Storage location not recorded - set it in the app before use';
  } else if (kind === 'expired') {
    status = 'expired';
    if (signal.safety === 'unknown-date') {
      reason = 'no-bought-date';
      label = 'No bought date - add it before use';
    } else if (signal.safety === 'past-limit') {
      reason = 'past-safety-limit';
      label = 'Past safe fridge time - do not use (' + signal.safetyClass + ', ' + signal.limitDays + '-day limit)';
    } else {
      reason = 'printed-date-passed';
      label = 'Use-by date passed' + (daysLeft != null ? ' ' + Math.abs(daysLeft) + 'd ago' : '') + ' - do not use';
    }
  } else if (kind === 'check') {
    status = 'check';
    reason = signal.bestBefore ? 'best-before-passed' : 'estimate-passed';
    label = signal.bestBefore ? 'Best before passed — check it' : 'Estimated window passed — check it';
  } else if (kind === 'use-soon') {
    status = 'use-soon';
    reason = 'use-soon';
    label = useSoonLabel(daysLeft);
  } else {
    status = 'ok';
    reason = daysLeft == null ? 'no-date' : 'in-date';
    label = daysLeft == null ? 'No date recorded' : daysLeft + 'd left';
  }
  const usable = available === true && status !== 'expired' && status !== 'unknown';
  if (!usable && status === 'check') {
    // Past its estimate AND out of stock: keep the app's warning wording, add the stock state.
    label = label + ' (out of stock)';
  } else if (!usable && status !== 'expired' && status !== 'unknown') {
    // The date allows it; the app's availability rule does not (empty staple, no quantity left).
    reason = 'out-of-stock';
    label = 'Out of stock';
  }
  return { status, reason, label, daysLeft, usable };
}

// get_inventory's item (TASK-092): the existing read item plus the stored date/category fields
// (null when absent or not a string) and the safety verdict. Write results keep toInventoryItem().
//
// One stored lot the read schema cannot carry (non-text name/unit/storage/updatedAt, a quantity
// that is not a finite number, a stockLevel outside full/ok/low/empty) must not fail the whole
// read (re-review must-fix 2): that lot alone is unknown / invalid-record and not usable, with
// schema-safe fields. A null or non-object entry is not a record and is skipped. Write results
// keep toInventoryItem() unchanged.
const READ_STOCK_LEVELS = ['full', 'ok', 'low', 'empty'];

function textOrNullField(value) {
  return value == null || typeof value === 'string';
}

// An id is read only when it is text or a finite number (String() on a stored map can throw).
export function readableId(value) {
  return typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));
}

// The app keeps only object records with an id (unionById); chat sees the same set.
export function isStoredRecord(entry) {
  return entry != null && typeof entry === 'object' && !Array.isArray(entry) && entry.id != null;
}

function readableLot(p) {
  return readableId(p.id) && textOrNullField(p.name) && textOrNullField(p.unit) && textOrNullField(p.storage) &&
    textOrNullField(p.updatedAt) &&
    (p.quantity == null || (typeof p.quantity === 'number' && Number.isFinite(p.quantity))) &&
    (p.stockLevel == null || READ_STOCK_LEVELS.includes(p.stockLevel));
}

export function listInventoryWithSafety(pantry, today) {
  requireHouseholdDay(today);
  return (pantry || []).filter(isStoredRecord).map((p, index) => {
    const dates = {
      category: textOrNull(p.category),
      purchaseDate: textOrNull(p.purchaseDate),
      expiryDate: textOrNull(p.expiryDate),
      dateMode: textOrNull(p.dateMode),
      printedDateKind: textOrNull(p.printedDateKind)
    };
    const classification = classifyStaple(p);
    if (readableLot(p) && classification !== 'invalid') {
      return Object.assign(toInventoryItem(p), { tracking: trackingOf(p, classification) }, dates, { safety: pantrySafety(p, today) });
    }
    return Object.assign({
      // An unreadable id gets a placeholder no write tool will match.
      ingredientId: readableId(p.id) ? String(p.id) : 'unreadable-id-' + index,
      name: textOrNull(p.name),
      quantity: typeof p.quantity === 'number' && Number.isFinite(p.quantity) ? p.quantity : null,
      unit: textOrNull(p.unit),
      inStock: false,
      staple: isStapleRecord(p),
      stockLevel: READ_STOCK_LEVELS.includes(p.stockLevel) ? p.stockLevel : null,
      storage: textOrNull(p.storage),
      updatedAt: textOrNull(p.updatedAt),
      // Unreadable: never guessed (TASK-097).
      tracking: null
    }, dates, {
      safety: { status: 'unknown', reason: 'invalid-record', label: 'Record could not be read - check it in the app before use', daysLeft: null, usable: false }
    });
  });
}

function validateQuantity(quantity) {
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity < 0) {
    throw new ValidationError('quantity must be a finite number >= 0.', { field: 'quantity' });
  }
}

function validateUnit(unit) {
  if (unit == null) return;
  if (typeof unit !== 'string' || !unit.trim() || unit.length > MAX_UNIT_LENGTH) {
    throw new ValidationError('unit must be a non-empty string of ' + MAX_UNIT_LENGTH + ' characters or fewer.', { field: 'unit' });
  }
}

function decimalFromNumber(quantity) {
  const [mantissa, exponentText] = quantity.toString().toLowerCase().split('e');
  const exponent = exponentText == null ? 0 : Number(exponentText);
  const [whole, fraction = ''] = mantissa.split('.');
  const negative = whole.startsWith('-');
  const digits = (whole.replace('-', '') + fraction).replace(/^0+/, '') || '0';
  let coefficient = BigInt(digits) * (negative ? -1n : 1n);
  let scale = fraction.length - exponent;
  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale);
    scale = 0;
  }
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  return { coefficient, scale };
}

function convertedDecimal(quantity, expectedUnit, storedUnit) {
  const decimal = decimalFromNumber(quantity);
  if ((expectedUnit === 'kg' && storedUnit === 'g') || (expectedUnit === 'L' && storedUnit === 'ml')) {
    decimal.coefficient *= 1000n;
  } else if ((expectedUnit === 'g' && storedUnit === 'kg') || (expectedUnit === 'ml' && storedUnit === 'L')) {
    decimal.scale += 3;
  }
  while (decimal.scale > 0 && decimal.coefficient % 10n === 0n) {
    decimal.coefficient /= 10n;
    decimal.scale -= 1;
  }
  return decimal;
}

function addDecimals(left, right) {
  const scale = Math.max(left.scale, right.scale);
  const sum = {
    coefficient: left.coefficient * 10n ** BigInt(scale - left.scale) + right.coefficient * 10n ** BigInt(scale - right.scale),
    scale
  };
  while (sum.scale > 0 && sum.coefficient % 10n === 0n) {
    sum.coefficient /= 10n;
    sum.scale -= 1;
  }
  return sum;
}

function decimalToString(decimal) {
  const negative = decimal.coefficient < 0n;
  const digits = String(negative ? -decimal.coefficient : decimal.coefficient);
  const value = decimal.scale === 0
    ? digits
    : digits.padStart(decimal.scale + 1, '0').slice(0, -decimal.scale) + '.' + digits.padStart(decimal.scale + 1, '0').slice(-decimal.scale);
  return negative ? '-' + value : value;
}

function sameDecimal(left, right) {
  return left.coefficient === right.coefficient && left.scale === right.scale;
}

// Absolute set on an existing record only — idempotent by construction (D-082 / TASK-065:
// repeating the same value under a fresh expectedRevision reproduces the same state; repeating
// under the SAME stale expectedRevision is rejected upstream as a revision conflict, not
// re-applied).
export function setQuantity(pantry, { ingredientId, quantity, unit }) {
  validateQuantity(quantity);
  validateUnit(unit);
  const index = findPantryIndex(pantry, ingredientId);
  if (index === -1) throw new NotFoundError('No pantry record with ingredientId "' + ingredientId + '".');

  const next = pantry.slice();
  const updated = Object.assign({}, next[index], { quantity, updatedAt: new Date().toISOString() });
  if (unit != null) updated.unit = unit;
  next[index] = updated;
  return { pantry: next, item: toInventoryItem(updated), unchanged: false };
}

// Conversational (MCP) narrowing of setQuantity(): an absolute count for an EXISTING, non-staple
// row, in the row's EXISTING unit. It adds only the guards the chat surface needs and then
// delegates to the unchanged setQuantity() — no `unit` is passed, so the stored unit can never be
// relabelled (500 g -> 500 kg). Zero is refused here, not translated: "none left" is
// markOutOfStock(). Staples are modelled by stockLevel, not by a count, so they are refused; an
// unreadable row is refused (TASK-097).
// TASK-098 (PROP-041 P2-0b, D1): a presence-only row (no amount recorded) becomes a counted row
// ONLY when the call also gives `unit` ("we have 200 g of paprika"): a supported inventory unit,
// equal to expectedUnit, and equal to the row's stored unit if it has one (never a relabel). Without
// `unit` a presence row is refused as presence_only, as before. `unit` on a counted or staple row is
// refused: counted rows keep the expectedUnit rule, staples are tracked by level.
export function setCountedQuantity(pantry, { ingredientId, quantity, expectedUnit, unit }, today) {
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
    throw new ValidationError('quantity must be a finite number > 0. For none left, use mark_out_of_stock.', { field: 'quantity' });
  }
  if (unit !== undefined && (typeof unit !== 'string' || !INVENTORY_UNITS.includes(unit))) {
    throw new ValidationError('unsupported_unit: unit must be one of ' + INVENTORY_UNITS.join(', ') + '.', { field: 'unit', code: 'unsupported_unit' });
  }
  const index = findPantryIndex(pantry, ingredientId);
  if (index === -1) throw new NotFoundError('No pantry record with ingredientId "' + ingredientId + '".');

  const classification = requireClassified(pantry[index], ingredientId);
  if (classification === 'staple') {
    throw new ValidationError('ingredientId "' + ingredientId + '" is a staple tracked by stock level, not by count' +
      (unit !== undefined ? ', so no unit can be recorded for it' : '') +
      '; use set_stock_level, mark_in_stock or mark_out_of_stock.', { field: unit !== undefined ? 'unit' : 'ingredientId' });
  }
  if (unit !== undefined) return recordPresenceQuantity(pantry, index, { ingredientId, quantity, expectedUnit, unit }, classification, today);
  if (trackingOf(pantry[index], classification) === 'presence') {
    throw new ValidationError(
      'presence_only: ingredientId "' + ingredientId + '" is recorded without an amount (no usable quantity and ' +
      'unit). Do not guess an amount: ask the user how much they have. Only when the user states an amount and ' +
      'unit, call again with that quantity and with both unit and expectedUnit set to the unit they said.',
      { field: 'ingredientId', code: 'presence_only', tracking: 'presence' }
    );
  }
  requireQuantityTracked(pantry[index], ingredientId, classification);
  // expectedUnit is an immutable PRECONDITION: exact equality with the stored unit, no trimming,
  // case folding or conversion (g != kg, ml != L, pieces != cans). It is never forwarded, so it
  // cannot relabel the row or be persisted.
  const storedUnit = pantry[index].unit;
  if (typeof storedUnit !== 'string' || !storedUnit.trim()) {
    throw new ValidationError('unit_mismatch: ingredientId "' + ingredientId + '" has no stored unit, so a count cannot be set safely. Re-read get_inventory and clarify with the user.', { field: 'expectedUnit' });
  }
  if (typeof expectedUnit !== 'string' || expectedUnit !== storedUnit) {
    throw new ValidationError('unit_mismatch: the stored unit for ingredientId "' + ingredientId + '" is "' + storedUnit + '", not the asserted unit. Re-read get_inventory and state the quantity in the stored unit, or clarify with the user.', { field: 'expectedUnit', storedUnit });
  }
  return setQuantity(pantry, { ingredientId, quantity });
}

// TASK-098: the presence-only half of setCountedQuantity() (`unit` given). Records quantity + unit
// through the unchanged setQuantity(); every other stored field is kept.
function recordPresenceQuantity(pantry, index, { ingredientId, quantity, expectedUnit, unit }, classification, today) {
  requireHouseholdDay(today);
  const record = pantry[index];
  if (trackingOf(record, classification) !== 'presence') {
    throw new ValidationError(
      'unit_not_allowed: ingredientId "' + ingredientId + '" already has a recorded quantity and unit ("' + record.unit +
      '"), so its unit cannot be set. Leave unit out and pass the stored unit as expectedUnit.',
      { field: 'unit', code: 'unit_not_allowed', storedUnit: record.unit }
    );
  }
  if (expectedUnit !== unit) {
    throw new ValidationError('unit_mismatch: unit and expectedUnit must both be the unit the user said ("' + unit + '").', { field: 'expectedUnit' });
  }
  const storedUnit = typeof record.unit === 'string' && record.unit.trim() !== '' ? record.unit : null;
  if (storedUnit !== null && storedUnit !== unit) {
    throw new ValidationError(
      'unit_mismatch: ingredientId "' + ingredientId + '" is recorded in "' + storedUnit + '", not "' + unit + '". ' +
      'State the amount in "' + storedUnit + '" or clarify with the user; the unit is never relabelled.',
      { field: 'unit', storedUnit }
    );
  }
  const r = setQuantity(pantry, { ingredientId, quantity, unit });
  // Review should-fix 2: a non-staple left with stockLevel 'empty' (e.g. once a staple) reads
  // "Out of stock" in get_inventory and the app (pantryLotAvailable) even with a quantity. Recording
  // the user's amount drops that stray level, but only when the shared rule then reads the lot as
  // available; otherwise refuse rather than leave a counted item that still reads out of stock.
  // Other stray levels change no read and are kept. Undo restores the record exactly.
  if (record.stockLevel === 'empty') {
    const updated = Object.assign({}, r.pantry[index]);
    delete updated.stockLevel;
    let available = false;
    try { available = FoodSafety.pantryLotAvailable(updated, today) === true; } catch { available = false; }
    if (!available) {
      throw new ValidationError(
        'stale_stock_level: ingredientId "' + ingredientId + '" is marked out of stock, and the app would still ' +
        'not count it as available with this amount (check its dates and storage). Nothing was changed. Ask the ' +
        'user to check the item in the app.',
        { field: 'ingredientId', code: 'stale_stock_level' }
      );
    }
    r.pantry[index] = updated;
    r.item = toInventoryItem(updated);
  }
  return r;
}

// set_stock_level (TASK-098, PROP-041 P2-3 + P2-0b, D1): set one staple's stockLevel to
// full / ok / low / empty. `empty` keeps the record (staples are never removed). The same level is
// a no-op (`unchanged`, record-only commit, TASK-093). `makeStaple: true` turns a presence-only item
// into a staple (`staple: true`, `stockLevel: level`) — only on the user's explicit words; it is
// refused on a counted item (it keeps its count), and a presence item without it is presence_only.
// mark_in_stock / mark_out_of_stock stay as they are (compatible aliases for full / empty).
export const STOCK_LEVELS = Object.freeze(['full', 'ok', 'low', 'empty']);

export function setStockLevel(pantry, { ingredientId, level, makeStaple }, today) {
  if (!STOCK_LEVELS.includes(level)) {
    throw new ValidationError('level must be one of ' + STOCK_LEVELS.join(', ') + '.', { field: 'level' });
  }
  if (makeStaple !== undefined && makeStaple !== true) {
    throw new ValidationError('makeStaple may only be true (leave it out otherwise).', { field: 'makeStaple' });
  }
  requireHouseholdDay(today);
  const index = findPantryIndex(pantry, ingredientId);
  if (index === -1) throw new NotFoundError('No pantry record with ingredientId "' + ingredientId + '".');

  const record = pantry[index];
  const classification = requireClassified(record, ingredientId);
  const tracking = trackingOf(record, classification);
  if (tracking === 'quantity') {
    throw new ValidationError(
      'quantity_tracked: ingredientId "' + ingredientId + '" is counted (' + record.quantity + ' ' + record.unit + '), ' +
      (makeStaple ? 'so it cannot be made a staple from chat: it keeps its count. ' : 'not a staple, so it has no stock level. ') +
      'Use set_inventory_quantity, consume_stock or add_stock, or mark_out_of_stock when none is left.',
      { field: makeStaple ? 'makeStaple' : 'ingredientId', code: 'quantity_tracked', tracking }
    );
  }
  if (tracking === 'presence' && makeStaple !== true) {
    throw new ValidationError(
      'presence_only: ingredientId "' + ingredientId + '" is recorded without an amount and is not a staple, so it ' +
      'has no stock level. Only if the user says it is a staple, call again with makeStaple: true. If the user ' +
      'states an amount instead, use set_inventory_quantity with unit. Never decide this yourself.',
      { field: 'makeStaple', code: 'presence_only', tracking }
    );
  }
  const converted = tracking === 'presence';
  // A converted item was not a staple, so it had no level (a stale stored stockLevel is not one).
  const previousLevel = !converted && record.stockLevel != null ? record.stockLevel : null;
  if (!converted && record.stockLevel === level) {
    return { pantry, item: toInventoryItem(record), previousLevel, level, converted: false, unchanged: true };
  }
  const updated = Object.assign({}, record, { stockLevel: level, updatedAt: new Date().toISOString() });
  if (converted) {
    updated.staple = true;
    // Review should-fix 3: a stray non-positive count on a presence item would read as "full with
    // zero quantity" in the app's stock health; the user has just said they have it. Undo restores it.
    if (typeof updated.quantity === 'number' && updated.quantity <= 0) delete updated.quantity;
  }
  // The app must read the result as a staple (stored flag first); anything else fails closed.
  if (classifyStaple(updated) !== 'staple') {
    throw new ValidationError('invalid_record: ingredientId "' + ingredientId + '" could not be made a staple safely. Ask the user to check it in the app.', { field: 'ingredientId', code: 'invalid_record' });
  }
  if (converted) requireSafeConversion(record, updated, ingredientId, today);
  // Review MF-2 (app parity: syncStapleToGrocery / cycleStapleLevel / setBrowserItemLevel / the
  // restock path): a staple back at full or ok is suggested again the next time it drops.
  if (level === 'full' || level === 'ok') delete updated.suggestDismissed;
  const next = pantry.slice();
  next[index] = updated;
  return { pantry: next, item: toInventoryItem(updated), previousLevel, level, converted, unchanged: false };
}

// Review MF-1 (food safety): the shared stockFoodClass() reads a staple as `pantry-staple`, so a
// conversion could switch off pantryFridgeSafety() and turn an unsafe fridge lot (a leftover with
// no bought date, or past its fridge limit) into a usable one. A conversion is allowed only when
// the item is usable before it AND the converted record gets the same verdict (status, reason,
// usable, daysLeft) from the same pantrySafety() reads use, for the household day. "Before" is read
// without the fields the conversion replaces (stockLevel, a stray count <= 0): those only say "out
// of stock", which the user has just corrected; they never change a date or safety rule.
function requireSafeConversion(record, updated, ingredientId, today) {
  const base = Object.assign({}, record);
  delete base.stockLevel;
  if (typeof base.quantity === 'number' && base.quantity <= 0) delete base.quantity;
  const before = pantrySafety(base, today);
  const after = pantrySafety(updated, today);
  const same = before.status === after.status && before.reason === after.reason &&
    before.usable === after.usable && before.daysLeft === after.daysLeft;
  if (!before.usable || !same) {
    throw new ValidationError(
      'unsafe_conversion: ingredientId "' + ingredientId + '" cannot be made a staple from chat: ' +
      (!before.usable ? 'its safety check says it is not usable now (' + before.label + ')' :
        'making it a staple would change its safety check (' + before.label + ' -> ' + after.label + ')') +
      '. Keep the item as it is and ask the user to check it in the app.',
      { field: 'makeStaple', code: 'unsafe_conversion', safety: before }
    );
  }
}

// Mirrors correctKitchenStock(): staple -> stockLevel 'empty'; non-staple -> removed with an
// explicit tombstone (D-071) written here directly, since the bridge has no client-side
// recordLocalDeletions() diff pass to write it for us. Already-out / already-removed is a
// deterministic no-op success (chaos test #4), not an error.
export function markOutOfStock(pantry, deletionsPantry, { ingredientId }) {
  const index = findPantryIndex(pantry, ingredientId);

  if (index === -1) {
    if (deletionsPantry && deletionsPantry[String(ingredientId)]) {
      return { pantry, deletionsPantry, item: null, unchanged: true, removed: true };
    }
    throw new NotFoundError('No pantry record with ingredientId "' + ingredientId + '".');
  }

  const record = pantry[index];
  const classification = requireClassified(record, ingredientId);

  if (classification === 'staple') {
    if (record.stockLevel === 'empty') {
      return { pantry, deletionsPantry, item: toInventoryItem(record), unchanged: true, removed: false };
    }
    const next = pantry.slice();
    const updated = Object.assign({}, record, { stockLevel: 'empty', updatedAt: new Date().toISOString() });
    next[index] = updated;
    return { pantry: next, deletionsPantry, item: toInventoryItem(updated), unchanged: false, removed: false };
  }

  const nextPantry = pantry.filter((_, i) => i !== index);
  const nextDeletions = Object.assign({}, deletionsPantry, { [String(ingredientId)]: new Date().toISOString() });
  return { pantry: nextPantry, deletionsPantry: nextDeletions, item: null, unchanged: false, removed: true };
}

// Staples only — non-staple presence already means "in stock", so targeting one is a validation
// error, not a silent no-op (TASK-065 is explicit about this).
export function markInStock(pantry, { ingredientId }) {
  const index = findPantryIndex(pantry, ingredientId);
  if (index === -1) throw new NotFoundError('No pantry record with ingredientId "' + ingredientId + '".');

  const record = pantry[index];
  if (requireClassified(record, ingredientId) !== 'staple') {
    throw new ValidationError('ingredientId "' + ingredientId + '" is not a staple; its presence already means in stock.', { field: 'ingredientId' });
  }
  if (record.stockLevel === 'full') {
    return { pantry, item: toInventoryItem(record), unchanged: true };
  }
  const next = pantry.slice();
  const updated = Object.assign({}, record, { stockLevel: 'full', updatedAt: new Date().toISOString() });
  next[index] = updated;
  return { pantry: next, item: toInventoryItem(updated), unchanged: false };
}

// Apply a conversational delta to an existing, counted (tracking 'quantity') non-staple row. Exact-zero paths use
// markOutOfStock() so they retain the canonical removal/tombstone or staple-empty behavior.
export function consumeStock(pantry, deletionsPantry, { ingredientId, quantity, expectedUnit }) {
  if (typeof ingredientId !== 'string' || !ingredientId.trim()) {
    throw new ValidationError('ingredientId must be a non-blank string.', { field: 'ingredientId' });
  }
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
    throw new ValidationError('quantity must be a finite number > 0.', { field: 'quantity' });
  }
  if (typeof expectedUnit !== 'string' || !expectedUnit.trim()) {
    throw new ValidationError('expectedUnit must be a non-blank string.', { field: 'expectedUnit' });
  }

  const index = findPantryIndex(pantry, ingredientId);
  if (index === -1) throw new NotFoundError('No pantry record with ingredientId "' + ingredientId + '".');

  const record = pantry[index];
  const classification = requireClassified(record, ingredientId);
  requireQuantityTracked(record, ingredientId, classification);

  if (typeof record.quantity !== 'number' || !Number.isFinite(record.quantity) || record.quantity < 0) {
    throw new ValidationError('The stored quantity is missing or invalid; re-read inventory and clarify before consuming.', { field: 'quantity' });
  }
  const storedUnit = record.unit;
  if (typeof storedUnit !== 'string' || !storedUnit.trim()) {
    throw new ValidationError('The stored unit is missing; re-read inventory and clarify before consuming.', { field: 'expectedUnit' });
  }
  const amount = convertQuantity(quantity, expectedUnit, storedUnit);
  if (amount > record.quantity || (classification === 'staple' && record.stockLevel === 'empty')) {
    throw new InsufficientStockError(classification === 'staple' && record.stockLevel === 'empty' ? 0 : record.quantity);
  }

  if (classification === 'staple') {
    if (amount !== record.quantity) {
      throw new ValidationError(
        'Staple quantities are stock-level tracked; only an exact depletion can mark the staple empty. Partial staple consumption is unsupported.',
        { field: 'quantity' }
      );
    }
    return Object.assign(markOutOfStock(pantry, deletionsPantry, { ingredientId }), { unchanged: false });
  }

  if (amount === record.quantity) {
    return markOutOfStock(pantry, deletionsPantry, { ingredientId });
  }

  const next = pantry.slice();
  const updated = Object.assign({}, record, {
    quantity: record.quantity - amount,
    updatedAt: new Date().toISOString()
  });
  next[index] = updated;
  return {
    pantry: next,
    deletionsPantry,
    item: toInventoryItem(updated),
    unchanged: false,
    removed: false
  };
}

const SEPARATE_PURCHASE = 'record the new purchase separately in the app.';

// add_stock's bought-date input (TASK-094): optional, a real YYYY-MM-DD calendar day, never after
// the household day. Checked before any Firestore access (mcp.js precheck) and again here.
export function validateBoughtDate(boughtDate, today) {
  requireHouseholdDay(today);
  if (boughtDate === undefined) return;
  if (!isCalendarDay(boughtDate)) {
    throw new ValidationError('boughtDate must be a real calendar day in YYYY-MM-DD form.', { field: 'boughtDate' });
  }
  if (boughtDate > today) {
    throw new ValidationError('boughtDate ' + boughtDate + ' is after today (' + today + ' in the household time zone); a purchase cannot be in the future. Ask the user when it was bought.', { field: 'boughtDate' });
  }
}

// May new stock join this lot? (TASK-094, PROP-041 P1-4, owner decision 4.) Decided ONLY by the
// shared verdict for the household day (pantrySafety / shared/foodSafety.js), never by a bridge
// default: new food must never inherit an older or unsafe lot's clock, and no bought date is
// invented. A lot whose only problem is that it is out of stock (reason `out-of-stock`: an empty
// staple, a zero count) is still a merge target: refilling it is what add_stock is for, and its
// dates passed the same verdict. Returns the stated-back lot facts for the success result.
const STORED_STORAGE = ['fridge', 'freezer', 'counter'];

function requireMergeableLot(record, boughtDate, today) {
  // The same record gate as get_inventory (readableLot), plus the app's exact storage values: a lot
  // chat's own read calls invalid-record, or whose storage is not exactly fridge / freezer /
  // counter (e.g. {} or 'Fridge', which the shared rules would read as "not fridge" and skip the
  // poultry/meat limits), is refused, never merged (TASK-094 review must-fix 1, should-fix 1).
  if (!readableLot(record) || (record.storage != null && record.storage !== '' && !STORED_STORAGE.includes(record.storage))) {
    throw new ValidationError('This lot\'s stored details (such as its storage location) cannot be checked; ' + SEPARATE_PURCHASE, { field: 'storage' });
  }
  if (record.dateMode === 'expiry') {
    throw new ValidationError('This lot has a printed date, so new stock cannot share it; ' + SEPARATE_PURCHASE, { field: 'dateMode' });
  }
  const verdict = pantrySafety(record, today);
  // Allow-list, so any other or future status fails closed. Today an ok/use-soon lot that is not
  // usable is always `out-of-stock`; the second clause keeps it that way if new reasons appear.
  const mergeable = (verdict.status === 'ok' || verdict.status === 'use-soon') &&
    (verdict.usable || verdict.reason === 'out-of-stock');
  if (!mergeable) {
    throw new ValidationError('This lot cannot take new stock safely (' + verdict.label + '); ' + SEPARATE_PURCHASE, { field: 'ingredientId', safety: verdict.status });
  }
  const fridge = FoodSafety.pantryFridgeSafety(record, today);
  // Only a real calendar day is stated back or compared (review should-fix 3).
  const lotBought = isCalendarDay(record.purchaseDate) ? record.purchaseDate : null;
  if (fridge) {
    // Raw meat, poultry, seafood, ground, variety, sausage or cooked food in the fridge: its clock
    // is the bought day, so the new purchase must be from that same day.
    if (boughtDate === undefined) {
      throw new ValidationError(
        'needs_bought_date: this lot is ' + fridge.safetyClass + ' food with a ' + fridge.limitDays + '-day fridge limit counted from its bought date (' + lotBought + '). ' +
        'Ask the user what day they bought the new stock and send it as boughtDate. Use today only if they said "today" or "just bought"; never guess.',
        { field: 'boughtDate', code: 'needs_bought_date' }
      );
    }
    if (boughtDate !== lotBought) {
      throw new ValidationError('This lot was bought on ' + lotBought + ' and the new stock on ' + boughtDate + '; they must not share one safety clock. ' + SEPARATE_PURCHASE, { field: 'boughtDate' });
    }
  } else if (boughtDate !== undefined && lotBought && boughtDate < lotBought) {
    // Older stock must not run on a newer lot's clock (review should-fix 2). Newer stock joining an
    // older lot keeps the older date, which only brings warnings sooner.
    throw new ValidationError('The new stock was bought on ' + boughtDate + ', before this lot (' + lotBought + '); it must not take the newer date. ' + SEPARATE_PURCHASE, { field: 'boughtDate' });
  }
  let storage = STORED_STORAGE.includes(record.storage) ? record.storage : null;
  let storageSource = storage ? 'recorded' : null;
  if (!storage) {
    try { storage = textOrNull(FoodSafety.defaultInferStorage(record.name)); } catch { storage = null; }
    if (storage) storageSource = 'inferred';
  }
  return { boughtDate: lotBought, storage, storageSource };
}

// Apply a conversational purchase delta to an existing row only. Preserve the old lot's
// freshness/storage metadata; reject resurrection and any lot the shared verdict for the household
// day `today` does not allow new stock to join (requireMergeableLot).
export function addStock(pantry, deletionsPantry, { ingredientId, quantity, expectedUnit, boughtDate }, today) {
  validateBoughtDate(boughtDate, today);
  if (typeof ingredientId !== 'string' || !ingredientId.trim()) {
    throw new ValidationError('ingredientId must be a non-blank string.', { field: 'ingredientId' });
  }
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) {
    throw new ValidationError('quantity must be a finite number > 0.', { field: 'quantity' });
  }
  if (typeof expectedUnit !== 'string' || !expectedUnit.trim()) {
    throw new ValidationError('expectedUnit must be a non-blank string.', { field: 'expectedUnit' });
  }

  const id = String(ingredientId);
  const index = findPantryIndex(pantry, ingredientId);
  if (index === -1 || (deletionsPantry && Object.hasOwn(deletionsPantry, id))) {
    throw new NotFoundError('No active pantry record with ingredientId "' + ingredientId + '"; add or restore it in the app first.');
  }

  const record = pantry[index];
  const classification = requireClassified(record, ingredientId);
  requireQuantityTracked(record, ingredientId, classification);
  if (classification === 'staple' && (typeof record.quantity !== 'number' || !Number.isFinite(record.quantity))) {
    throw new ValidationError('This staple has no counted quantity; use set_stock_level or mark_in_stock instead.', { field: 'quantity' });
  }
  if (typeof record.quantity !== 'number' || !Number.isFinite(record.quantity) || record.quantity < 0) {
    throw new ValidationError('The stored quantity is missing or invalid; clarify the amount in the app before adding stock.', { field: 'quantity' });
  }
  if (typeof record.unit !== 'string' || !record.unit.trim()) {
    throw new ValidationError('The stored unit is missing; re-read inventory and clarify before adding stock.', { field: 'expectedUnit' });
  }
  const lot = requireMergeableLot(record, boughtDate, today);
  const amount = convertQuantity(quantity, expectedUnit, record.unit);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ValidationError('The resulting stock quantity is outside the safely representable range.', { field: 'quantity' });
  }
  const intendedTotal = addDecimals(decimalFromNumber(record.quantity), convertedDecimal(quantity, expectedUnit, record.unit));
  const exactTotal = Number(decimalToString(intendedTotal));
  if (!Number.isFinite(exactTotal) || exactTotal > MAX_STOCK_QUANTITY) {
    throw new ValidationError('The resulting stock quantity is outside the safely representable range.', { field: 'quantity' });
  }
  if (exactTotal <= record.quantity || !sameDecimal(decimalFromNumber(exactTotal), intendedTotal)) {
    throw new ValidationError('The requested increment cannot be represented without losing quantity.', { field: 'quantity' });
  }

  const next = pantry.slice();
  const updated = Object.assign({}, record, {
    quantity: exactTotal,
    updatedAt: new Date().toISOString()
  });
  if (classification === 'staple') {
    updated.stockLevel = 'full';
    delete updated.suggestDismissed;
  }
  next[index] = updated;
  return { pantry: next, item: toInventoryItem(updated), lot, unchanged: false };
}
