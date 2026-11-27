// TASK-092 (PROP-041 P1-2, audit C1/C3, D-091): get_inventory and get_ready_food carry a safety
// verdict computed only with the shared food-safety rules on the household calendar day, and the
// read-tool descriptions tell chat never to suggest unusable food.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { routeRequest } from '../src/index.js';
import { MCP_ISSUER, MCP_RESOURCE, MCP_SCOPE } from '../src/mcpAuth.js';
import { testEnv } from './support/fixtures.js';
import { listReadyFoodWithSafety } from '../src/operations/readyFood.js';
import '../../../tests/fixtures/food-safety-parity-eval.js';

const FoodSafety = globalThis.MealPrepFoodSafety;
const { resolve } = globalThis.FoodSafetyParity;
const safetyFixture = JSON.parse(readFileSync(new URL('../../../tests/fixtures/food-safety-parity.json', import.meta.url), 'utf8'));
const readyFixture = JSON.parse(readFileSync(new URL('../../../tests/fixtures/ready-food-parity.json', import.meta.url), 'utf8'));

const NOW = 1_800_000_000;
const STATUSES = ['ok', 'use-soon', 'check', 'expired', 'unknown'];

function mcpRequest(body) {
  return new Request('https://localhost/mcp', {
    method: 'POST',
    headers: {
      Host: 'localhost',
      Accept: 'application/json, text/event-stream',
      Authorization: 'Bearer oauth-test-token',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
}

async function responseMessage(response) {
  const text = await response.text();
  if ((response.headers.get('Content-Type') || '').includes('text/event-stream')) {
    const dataLine = text.split(/\r?\n/).find((line) => line.startsWith('data: '));
    assert.ok(dataLine, 'SSE response must contain a data frame');
    return JSON.parse(dataLine.slice(6));
  }
  return JSON.parse(text);
}

function toolCall(id, name) {
  return { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: {} } };
}

function validContext() {
  return {
    auth: {
      token: 'not-a-real-token',
      audience: MCP_RESOURCE,
      expiresAt: NOW + 300,
      scope: [MCP_SCOPE],
      userId: 'test-owner-subject',
      clientId: 'https://chatgpt.com/oauth/client.json'
    },
    props: { ownerSubject: 'test-owner-subject', issuer: MCP_ISSUER, resource: MCP_RESOURCE, notBefore: NOW - 1 }
  };
}

// `instant` is the injected clock; the household day comes from HOUSEHOLD_TIME_ZONE.
async function callRead(tool, doc, instant, env = testEnv()) {
  const calls = { token: 0, read: 0, write: 0, fetch: 0 };
  const deps = {
    nowSeconds: NOW,
    now: () => new Date(instant),
    getFirestoreAccessToken: async () => { calls.token += 1; return 'fake-firestore-token'; },
    getUserDocument: async () => { calls.read += 1; return doc; },
    patchUserDocument: async () => { calls.write += 1; throw new Error('write path reached'); },
    fetchImpl: async () => { calls.fetch += 1; throw new Error('external fetch reached'); }
  };
  const response = await routeRequest(mcpRequest(toolCall(1, tool)), env, deps, validContext());
  return { message: await responseMessage(response), calls };
}

function manilaNoon(day) {
  return Date.parse(day + 'T12:00:00+08:00');
}

function resolveRecord(record, today) {
  const out = {};
  for (const key of Object.keys(record)) out[key] = resolve(record[key], today);
  return out;
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function statusFromKind(kind) {
  return kind == null ? 'ok' : kind;
}

function validCookedDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && FoodSafety.stockCalendarDay(value) != null;
}

function assertSafetyShape(safety, label) {
  assert.deepEqual(Object.keys(safety).sort(), ['daysLeft', 'label', 'reason', 'status', 'usable'], label);
  assert.ok(STATUSES.includes(safety.status), label);
  assert.equal(typeof safety.reason, 'string', label);
  assert.ok(safety.label.length > 0, label);
  assert.equal(typeof safety.usable, 'boolean', label);
  if (safety.status === 'expired' || safety.status === 'unknown') assert.equal(safety.usable, false, label);
}

const pantryCases = safetyFixture.cases.filter((c) => c.kind === 'pantry');
const cookedCases = safetyFixture.cases.filter((c) => c.kind === 'cooked').concat(readyFixture.cases);

for (const today of safetyFixture.todays) {
  test(`get_inventory safety equals the shared verdict for every parity-fixture pantry case (today = ${today})`, async () => {
    const pantry = pantryCases.map((c) => Object.assign({ id: c.id }, resolveRecord(c.record, today)));
    const { message, calls } = await callRead('get_inventory', { revision: 5, pantry, cookedMeals: [] }, manilaNoon(today));
    assert.equal(message.result.isError, undefined, JSON.stringify(message.result.content));
    const items = message.result.structuredContent.items;
    assert.equal(items.length, pantryCases.length);
    pantryCases.forEach((testCase, i) => {
      const item = items[i];
      const label = `${testCase.id} @ ${today}`;
      const record = pantry[i];
      const signal = FoodSafety.pantryDateSignal(record, today);
      const available = FoodSafety.pantryLotAvailable(record, today);
      // The live shared verdict is the frozen fixture verdict for the default storage path.
      const frozen = (testCase.expectedDefault || testCase.expected)[today];
      assert.deepEqual(JSON.parse(JSON.stringify(signal)), frozen.signal, label);
      assert.equal(available, frozen.available, label);

      // Days left never run past a fridge safety limit (shared pantryFridgeSafety); that can only
      // turn ok into use-soon, never change usable.
      const fridge = FoodSafety.pantryFridgeSafety(record, today);
      let kind = signal.kind;
      let daysLeft = finiteOrNull(signal.daysLeft);
      if (!['expired', 'unknown'].includes(kind) && fridge && Number.isFinite(fridge.daysLeft) &&
          (daysLeft == null || fridge.daysLeft < daysLeft)) {
        daysLeft = fridge.daysLeft;
        if (kind == null && daysLeft <= FoodSafety.FRESHNESS_WARN_DAYS) kind = 'use-soon';
      }
      // Past its estimate (no printed date): the app shows "Estimated window passed" -> check.
      if (kind == null && daysLeft != null && daysLeft < 0 && !signal.printed) kind = 'check';
      assert.equal(item.ingredientId, testCase.id, label);
      assertSafetyShape(item.safety, label);
      assert.equal(item.safety.status, statusFromKind(kind), label);
      assert.equal(item.safety.daysLeft, daysLeft, label);
      if (fridge && Number.isFinite(fridge.daysLeft) && item.safety.status !== 'expired') {
        assert.ok(item.safety.daysLeft <= fridge.daysLeft, label);
      }
      assert.equal(item.safety.usable, available && !['expired', 'unknown'].includes(signal.kind), label);
      for (const field of ['category', 'purchaseDate', 'expiryDate', 'dateMode', 'printedDateKind', 'storage', 'stockLevel']) {
        assert.equal(item[field], typeof record[field] === 'string' ? record[field] : null, `${label} ${field}`);
      }
    });
    assert.deepEqual(calls, { token: 1, read: 1, write: 0, fetch: 0 });
  });

  test(`get_ready_food safety equals the shared cooked-meal verdict for every parity-fixture case (today = ${today})`, async () => {
    const cookedMeals = cookedCases.map((c) => Object.assign({ id: c.id }, resolveRecord(c.record, today)));
    // G1 fixed: a batch the read schema cannot carry is served as unknown / invalid-record
    // (asserted in the G1 test below), so the read never fails for one odd record.
    const { message, calls } = await callRead('get_ready_food', { revision: 6, pantry: [], cookedMeals }, manilaNoon(today));
    assert.equal(message.result.isError, undefined, JSON.stringify(message.result.content));
    const toolItems = message.result.structuredContent.items;
    assert.equal(toolItems.length, cookedMeals.length);
    const direct = listReadyFoodWithSafety(cookedMeals, today);
    assert.deepEqual(toolItems, direct);
    const items = direct;
    cookedCases.forEach((testCase, i) => {
      const item = items[i];
      const label = `${testCase.id} @ ${today}`;
      const meal = cookedMeals[i];
      const signal = FoodSafety.cookedDateSignal(meal, today);
      const available = FoodSafety.cookedMealAvailable(meal, today);
      if (testCase.kind === 'readyFood') {
        // The live shared verdict is the app's frozen getReadyFoodSuggestions() verdict.
        assert.equal(available, testCase.expected[today].available, label);
        assert.deepEqual(signal, testCase.expected[today].signal, label);
      } else {
        assert.deepEqual(signal, testCase.expected[today].signal, label);
      }
      assert.equal(item.cookedMealId, testCase.id, label);
      assertSafetyShape(item.safety, label);
      // A batch the read schema cannot carry (G1): unknown / invalid-record, never usable.
      const pr = meal.portionsRemaining;
      if (pr != null && !(Number.isInteger(pr) && pr >= 0 && pr <= 99)) {
        assert.deepEqual(item.safety, { status: 'unknown', reason: 'invalid-record', label: 'Record could not be read - check it in the app before eating', daysLeft: null, usable: false }, label);
        assert.equal(item.servingsRemaining, null, label);
        return;
      }
      const unknown = !validCookedDay(meal.cookedDate) || (signal.daysLeft == null && meal.storage !== 'freezer');
      assert.equal(item.safety.status, unknown ? 'unknown' : statusFromKind(signal.kind), label);
      assert.equal(item.safety.daysLeft, finiteOrNull(signal.daysLeft), label);
      assert.equal(item.safety.usable, available && !unknown && signal.kind !== 'expired', label);
    });
    assert.deepEqual(calls, { token: 1, read: 1, write: 0, fetch: 0 });
  });
}

test('Manila midnight boundary: raw chicken at its 2-day limit becomes expired at 16:00 UTC, not at UTC midnight', async () => {
  const doc = {
    revision: 9,
    pantry: [{ id: 'chicken-1', name: 'Chicken Breast', category: 'Protein', storage: 'fridge', purchaseDate: '2026-11-24', quantity: 1, unit: 'kg' }],
    cookedMeals: [{ id: 'adobo-1', name: 'Chicken Adobo', storage: 'fridge', cookedDate: '2026-11-22', fridgeLife: null, portionsRemaining: 2 }]
  };
  const before = await callRead('get_inventory', doc, Date.parse('2026-11-26T15:59:59Z'));
  assert.deepEqual(before.message.result.structuredContent.items[0].safety,
    { status: 'use-soon', reason: 'use-soon', label: 'Use today', daysLeft: 0, usable: true });
  const after = await callRead('get_inventory', doc, Date.parse('2026-11-26T16:00:00Z'));
  assert.deepEqual(after.message.result.structuredContent.items[0].safety, {
    status: 'expired',
    reason: 'past-safety-limit',
    label: 'Past safe fridge time - do not use (poultry, 2-day limit)',
    daysLeft: -1,
    usable: false
  });
  // Still 2026-11-26 in UTC: a UTC day would have called this chicken usable.
  assert.equal(new Date(Date.parse('2026-11-26T16:00:00Z')).toISOString().slice(0, 10), '2026-11-26');

  const mealBefore = await callRead('get_ready_food', doc, Date.parse('2026-11-26T15:59:59Z'));
  assert.equal(mealBefore.message.result.structuredContent.items[0].safety.usable, true);
  assert.equal(mealBefore.message.result.structuredContent.items[0].safety.daysLeft, 0);
  const mealAfter = await callRead('get_ready_food', doc, Date.parse('2026-11-26T16:00:00Z'));
  assert.deepEqual(mealAfter.message.result.structuredContent.items[0].safety, {
    status: 'expired',
    reason: 'past-safety-limit',
    label: 'Past safe fridge time - do not eat (4-day limit)',
    daysLeft: -1,
    usable: false
  });
});

test('an invalid or missing HOUSEHOLD_TIME_ZONE fails the read closed before any Firestore access', async () => {
  const doc = { revision: 1, pantry: [{ id: 'p1', name: 'Rice', staple: true, storage: 'counter' }], cookedMeals: [] };
  for (const env of [testEnv({ HOUSEHOLD_TIME_ZONE: 'Mars/Olympus_Mons' }), testEnv({ HOUSEHOLD_TIME_ZONE: '' }), testEnv({ HOUSEHOLD_TIME_ZONE: undefined })]) {
    for (const tool of ['get_inventory', 'get_ready_food']) {
      const { message, calls } = await callRead(tool, doc, manilaNoon('2026-11-26'), env);
      assert.equal(message.result.isError, true, tool);
      assert.equal(message.result.structuredContent, undefined, tool);
      assert.match(message.result.content[0].text, /could not be read/);
      assert.deepEqual(calls, { token: 0, read: 0, write: 0, fetch: 0 }, tool);
    }
  }
});

test('D-091: expired or unknown is never usable, even where the app keeps it available', async () => {
  const today = '2026-11-26';
  const pantry = [
    // A staple past its printed use-by: the app still lists it (TASK-091 finding F2).
    { id: 'soy', name: 'Soy Sauce', staple: true, storage: 'counter', dateMode: 'expiry', expiryDate: '2026-11-20', quantity: 1, unit: 'bottle' },
    // No storage and no INGREDIENT_DB storage for this exact name: unknown on the shared default path.
    { id: 'mystery', name: 'Mystery Meat', category: 'Protein', purchaseDate: today, quantity: 1, unit: 'kg' },
    // Fridge poultry with no bought date.
    { id: 'nodate', name: 'Chicken Thigh', category: 'Protein', storage: 'fridge', quantity: 1, unit: 'kg' },
    // Best-before passed: check, still usable after a look.
    { id: 'oats', name: 'Rolled Oats', category: 'Grain', storage: 'counter', dateMode: 'expiry', printedDateKind: 'best-before', expiryDate: '2026-11-20', quantity: 1, unit: 'bag' },
    // In date, but an empty staple.
    { id: 'salt', name: 'Salt', staple: true, stockLevel: 'empty', storage: 'counter' },
    // A record the shared rules cannot read (non-string category): unknown, and the rest still load.
    { id: 'bad', name: 'Chicken Breast', category: 5, storage: 'fridge', purchaseDate: today, quantity: 1, unit: 'kg' }
  ];
  assert.equal(FoodSafety.pantryLotAvailable(pantry[0], today), true);
  const { message } = await callRead('get_inventory', { revision: 3, pantry, cookedMeals: [] }, manilaNoon(today));
  const byId = Object.fromEntries(message.result.structuredContent.items.map((item) => [item.ingredientId, item]));
  assert.deepEqual(byId.soy.safety, { status: 'expired', reason: 'printed-date-passed', label: 'Use-by date passed 6d ago - do not use', daysLeft: -6, usable: false });
  assert.equal(byId.soy.dateMode, 'expiry');
  assert.equal(byId.soy.expiryDate, '2026-11-20');
  assert.equal(byId.soy.printedDateKind, null);
  assert.deepEqual(byId.mystery.safety, { status: 'unknown', reason: 'unknown-storage', label: 'Storage location not recorded - set it in the app before use', daysLeft: 3, usable: false });
  assert.equal(byId.mystery.storage, null);
  assert.deepEqual(byId.nodate.safety, { status: 'expired', reason: 'no-bought-date', label: 'No bought date - add it before use', daysLeft: null, usable: false });
  assert.deepEqual(byId.oats.safety, { status: 'check', reason: 'best-before-passed', label: 'Best before passed — check it', daysLeft: -6, usable: true });
  assert.equal(byId.oats.printedDateKind, 'best-before');
  assert.deepEqual(byId.salt.safety, { status: 'ok', reason: 'out-of-stock', label: 'Out of stock', daysLeft: null, usable: false });
  assert.deepEqual(byId.bad.safety, { status: 'unknown', reason: 'unreadable-record', label: 'Record could not be checked - check it in the app before use', daysLeft: null, usable: false });
  assert.equal(byId.bad.category, null);
});

test('ready food: unknown cooked date is never usable; frozen without a quality window stays usable', async () => {
  const today = '2026-11-26';
  const cookedMeals = [
    { id: 'nodate', name: 'Sinigang', storage: 'fridge', portionsRemaining: 2 },
    { id: 'rollover', name: 'Sinigang', storage: 'fridge', cookedDate: '2026-02-30', portionsRemaining: 2 },
    { id: 'frozen', name: 'Beef Stew', storage: 'freezer', cookedDate: '2026-01-10', freezerLife: null, portionsRemaining: 2 },
    { id: 'frozen-old', name: 'Beef Stew', storage: 'freezer', cookedDate: '2026-01-10', freezerLife: 90, portionsRemaining: 2 },
    { id: 'empty', name: 'Adobo', storage: 'fridge', cookedDate: today, portionsRemaining: 0 },
    { id: 'fresh', name: 'Adobo', storage: 'fridge', cookedDate: '2026-11-25', fridgeLife: 3, freezerLife: 90, portionsRemaining: 3 }
  ];
  const { message } = await callRead('get_ready_food', { revision: 4, pantry: [], cookedMeals }, manilaNoon(today));
  const byId = Object.fromEntries(message.result.structuredContent.items.map((item) => [item.cookedMealId, item]));
  assert.deepEqual(byId.nodate.safety, { status: 'unknown', reason: 'unknown-cooked-date', label: 'No valid cooked date - check it in the app before eating', daysLeft: null, usable: false });
  assert.equal(byId.rollover.safety.status, 'unknown');
  assert.equal(byId.rollover.safety.usable, false);
  assert.deepEqual(byId.frozen.safety, { status: 'ok', reason: 'no-quality-window', label: 'Frozen - no quality date recorded', daysLeft: null, usable: true });
  assert.deepEqual(byId['frozen-old'].safety, { status: 'check', reason: 'freezer-window-passed', label: 'Freezer quality window passed — check it', daysLeft: -230, usable: false });
  assert.deepEqual(byId.empty.safety, { status: 'ok', reason: 'no-portions-left', label: 'No portions left', daysLeft: 4, usable: false });
  assert.deepEqual(byId.fresh.safety, { status: 'use-soon', reason: 'use-soon', label: 'Use soon - 2d left', daysLeft: 2, usable: true });
});

test('review fix: counter and freezer lots past their estimate are check, never ok / in-date', async () => {
  const today = '2026-11-26';
  const pantry = [
    { id: 'onion', name: 'Onion', category: 'Vegetable', storage: 'counter', purchaseDate: '2026-09-01', dateMode: 'purchase', shelfLifeDays: 30, quantity: 1, unit: 'kg' },
    { id: 'thigh', name: 'Chicken Thigh', category: 'Protein', storage: 'freezer', purchaseDate: '2026-01-01', dateMode: 'purchase', shelfLifeDays: 90, quantity: 1, unit: 'kg' }
  ];
  const { message } = await callRead('get_inventory', { revision: 3, pantry, cookedMeals: [] }, manilaNoon(today));
  for (const item of message.result.structuredContent.items) {
    const signal = FoodSafety.pantryDateSignal(pantry.find((p) => p.id === item.ingredientId), today);
    assert.ok(signal.daysLeft < 0, item.ingredientId);
    assert.deepEqual(item.safety, { status: 'check', reason: 'estimate-passed', label: 'Estimated window passed — check it', daysLeft: signal.daysLeft, usable: true }, item.ingredientId);
  }
});

test('review fix G1: one unreadable ready-food batch is unknown and the rest still load', async () => {
  const today = '2026-11-26';
  const good = { id: 'good', name: 'Sinigang', storage: 'fridge', cookedDate: today, fridgeLife: 4, portionsRemaining: 2 };
  const bad = [
    { id: 'half', portionsRemaining: 0.5 },
    { id: 'text', portionsRemaining: '2' },
    { id: 'blank', portionsRemaining: '' },
    { id: 'bool', portionsRemaining: true },
    { id: 'neg', portionsRemaining: -1 },
    { id: 'big', portionsRemaining: 1000 },
    { id: 'counter', storage: 'counter' },
    { id: 'src', source: 'mystery' },
    { id: 'numname', name: 7 }
  ].map((o) => Object.assign({ name: 'Adobo', storage: 'fridge', cookedDate: today, fridgeLife: 4, portionsRemaining: 2 }, o));
  const { message } = await callRead('get_ready_food', { revision: 4, pantry: [], cookedMeals: [good].concat(bad) }, manilaNoon(today));
  assert.equal(message.result.isError, undefined, JSON.stringify(message.result.content));
  const byId = Object.fromEntries(message.result.structuredContent.items.map((item) => [item.cookedMealId, item]));
  assert.equal(byId.good.safety.usable, true);
  assert.equal(byId.good.servingsRemaining, 2);
  for (const b of bad) {
    const item = byId[b.id];
    assert.deepEqual(item.safety, { status: 'unknown', reason: 'invalid-record', label: 'Record could not be read - check it in the app before eating', daysLeft: null, usable: false }, b.id);
    assert.equal(item.servingsRemaining, null, b.id);
    assert.equal(item.trackedPortions, false, b.id);
  }
});

test('review fix S1: an absurd stored shelf life is unknown and does not fail get_inventory', async () => {
  const today = '2026-11-26';
  const pantry = [
    { id: 'huge', name: 'Rice', category: 'Grain', storage: 'counter', purchaseDate: today, dateMode: 'purchase', shelfLifeDays: 1e20, quantity: 1, unit: 'kg' },
    { id: 'fine', name: 'Rice', category: 'Grain', storage: 'counter', purchaseDate: today, dateMode: 'purchase', shelfLifeDays: 365, quantity: 1, unit: 'kg' }
  ];
  const { message } = await callRead('get_inventory', { revision: 3, pantry, cookedMeals: [] }, manilaNoon(today));
  assert.equal(message.result.isError, undefined, JSON.stringify(message.result.content));
  const byId = Object.fromEntries(message.result.structuredContent.items.map((item) => [item.ingredientId, item]));
  assert.equal(byId.huge.safety.status, 'unknown');
  assert.equal(byId.huge.safety.usable, false);
  assert.equal(byId.fine.safety.usable, true);
});

test('read-tool descriptions forbid suggesting unusable food; record_ready_food no longer claims unknown freshness', async () => {
  const response = await routeRequest(mcpRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }), testEnv(), { nowSeconds: NOW }, validContext());
  const tools = Object.fromEntries((await responseMessage(response)).result.tools.map((tool) => [tool.name, tool]));
  for (const name of ['get_inventory', 'get_ready_food']) {
    const { description, outputSchema } = tools[name];
    assert.match(description, /NEVER suggest[^.]*usable:false/, name);
    assert.match(description, /"unknown"[^.]*NOT usable/, name);
    assert.match(description, /"check" means the user must look at it before using it/, name);
    assert.match(description, /"expired" is never usable/, name);
    const item = outputSchema.properties.items.items;
    assert.equal(item.additionalProperties, false, name);
    const safety = item.properties.safety;
    assert.equal(safety.additionalProperties, false, name);
    assert.deepEqual(safety.required.slice().sort(), ['daysLeft', 'label', 'reason', 'status', 'usable']);
    assert.deepEqual(safety.properties.status.enum, STATUSES);
  }
  assert.deepEqual(Object.keys(tools.get_inventory.outputSchema.properties.items.items.properties).sort(), [
    'category', 'dateMode', 'expiryDate', 'inStock', 'ingredientId', 'name', 'printedDateKind', 'purchaseDate',
    'quantity', 'safety', 'staple', 'stockLevel', 'storage', 'unit', 'updatedAt'
  ]);
  // Write-tool results keep their existing item shape (no read-only safety fields).
  for (const name of ['mark_out_of_stock', 'mark_in_stock', 'set_inventory_quantity', 'consume_stock', 'add_stock']) {
    const item = tools[name].outputSchema.properties.item;
    const props = (item.anyOf ? item.anyOf.find((s) => s.properties) : item).properties;
    assert.equal(props.safety, undefined, name);
    assert.equal(props.purchaseDate, undefined, name);
  }
  for (const name of ['record_ready_food', 'consume_ready_food']) {
    const item = tools[name].outputSchema.properties.item;
    const props = (item.anyOf ? item.anyOf.find((s) => s.properties) : item).properties;
    assert.equal(props.safety, undefined, name);
  }
  const record = tools.record_ready_food.description;
  assert.doesNotMatch(record, /keep freshness unknown/i);
  assert.match(record, /freshness is NOT unknown/);
  assert.match(record, /4-day fridge safety limit from cookedDate/);
  assert.match(record, /3 fridge days, 90 freezer days/);
});
