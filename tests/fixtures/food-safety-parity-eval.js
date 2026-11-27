// Runs one tests/fixtures/food-safety-parity.json case against a food-safety API.
// Loaded unchanged by the browser parity spec (page.addScriptTag) and by the Worker's Node
// parity test (side-effect import), so both sides evaluate the cases with the same code.
//
// Dates in a case are either literal strings (kept as-is, including malformed ones) or
// "@<offset>" = the case's `today` shifted by <offset> calendar days, so one case means the
// same thing for every `today` in the fixture (including month-end and leap-day).
(function (root) {
  'use strict';

  function shiftDay(today, offset) {
    var date = new Date(today + 'T00:00:00Z');
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  }

  function resolve(value, today) {
    if (typeof value !== 'string' || !/^@[+-]?\d+$/.test(value)) return value;
    return shiftDay(today, Number(value.slice(1)));
  }

  function resolveRecord(record, today) {
    var out = {};
    Object.keys(record).forEach(function (key) { out[key] = resolve(record[key], today); });
    return out;
  }

  // JSON round trip: drops undefined keys and turns NaN into null on both sides alike.
  function plain(value) {
    return JSON.parse(JSON.stringify(value === undefined ? null : value));
  }

  // `api` exposes the shared signatures: (record, today, inferStorage) etc.
  function evaluateCase(api, testCase, today, inferStorage) {
    switch (testCase.kind) {
      case 'pantry': {
        var p = resolveRecord(testCase.record, today);
        return plain({
          foodClass: api.stockFoodClass(p),
          staple: api.isStaple(p),
          daysLeft: api.pantryDaysLeft(p, today),
          fridge: api.pantryFridgeSafety(p, today, inferStorage),
          signal: api.pantryDateSignal(p, today, inferStorage),
          available: api.pantryLotAvailable(p, today, inferStorage)
        });
      }
      case 'cooked': {
        var meal = resolveRecord(testCase.record, today);
        return plain({
          foodClass: api.stockFoodClass(meal),
          shelfLife: api.cookedShelfLife(meal),
          signal: api.cookedDateSignal(meal, today)
        });
      }
      case 'calendar':
        return plain({ day: api.stockCalendarDay(resolve(testCase.value, today)) });
      case 'categoryShelfLife':
        return plain({ days: api.categoryShelfLife(testCase.category) });
      case 'daysLeftFrom':
        return plain({ daysLeft: api.daysLeftFrom(resolve(testCase.start, today), testCase.shelfLifeDays, today) });
      default:
        throw new Error('Unknown food-safety parity case kind: ' + testCase.kind);
    }
  }

  root.FoodSafetyParity = Object.freeze({ resolve: resolve, evaluateCase: evaluateCase });
})(globalThis);
