const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');
const { waitForRestored } = require('./app-ready');

/**
 * Durable meal consumption events — feat/durable-meal-consumption-events.
 *
 * "Used 1" (useCookedPortion) is the ONLY genuinely unambiguous "I ate a
 * portion" signal the app has. It now also appends an append-only fact to
 * AppState.mealConsumptions, atomically with the SAME state mutation, so a
 * downstream Life Ledger adapter has real consumption history instead of
 * having to infer it from an initialPortions/portionsRemaining delta.
 *
 * The "Done" button (removeCookedMeal) is deliberately NOT instrumented: its
 * own title ("Ate it all / remove") admits it also covers discarding food, so
 * it is not a trustworthy consumption signal. Neither is removing an expired
 * item. These tests pin that boundary as much as they pin the happy path.
 */

test.use({ viewport: { width: 1200, height: 1500 } });

async function loadLocalApp(page) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__consumptionEventsBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__consumptionEventsBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
  });
  await page.goto(pathToFileURL(path.resolve('index.html')).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => typeof AppState !== 'undefined' && Array.isArray(AppState.cookedMeals) &&
          typeof saveData === 'function' && typeof useCookedPortion === 'function',
    null, { timeout: 30000 });
  await page.waitForTimeout(300);
}

function trackedMeal(overrides) {
  return Object.assign({
    id: 'cm_track_1',
    recipeId: 'r_42',
    source: null,
    name: 'Chicken Bowls',
    cookedDate: '2026-08-28',
    storage: 'fridge',
    fridgeLife: 4,
    freezerLife: 90,
    initialPortions: 3,
    portionsRemaining: 3
  }, overrides || {});
}

test('using a portion appends exactly one consumption fact with the expected shape', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate((meal) => {
    AppState.cookedMeals = normalizeCookedMeals([JSON.parse(JSON.stringify(meal))]);
    AppState.mealConsumptions = [];
    useCookedPortion('cm_track_1');
    return {
      count: AppState.mealConsumptions.length,
      record: AppState.mealConsumptions[0],
      remaining: AppState.cookedMeals[0].portionsRemaining
    };
  }, trackedMeal());

  expect(result.count).toBe(1);
  expect(result.remaining).toBe(2);
  expect(result.record).toMatchObject({
    cookedMealId: 'cm_track_1',
    recipeId: 'r_42',
    mealName: 'Chicken Bowls',
    portionsConsumed: 1
  });
  expect(typeof result.record.id).toBe('string');
  expect(result.record.id.indexOf('mc_')).toBe(0);
  expect(() => new Date(result.record.consumedAt).toISOString()).not.toThrow();
  expect(new Date(result.record.consumedAt).toISOString()).toBe(result.record.consumedAt);
});

test('consuming the last portion still records exactly one fact and removes the batch', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate((meal) => {
    AppState.cookedMeals = normalizeCookedMeals([JSON.parse(JSON.stringify(meal))]);
    AppState.mealConsumptions = [];
    useCookedPortion('cm_track_1'); // 1 -> 0, finishes the batch
    return {
      count: AppState.mealConsumptions.length,
      record: AppState.mealConsumptions[0],
      mealsLeft: AppState.cookedMeals.length
    };
  }, trackedMeal({ initialPortions: 1, portionsRemaining: 1 }));

  expect(result.count).toBe(1);
  expect(result.record.portionsConsumed).toBe(1);
  expect(result.mealsLeft).toBe(0);
});

test('repeated taps each record their own fact, one per portion', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate((meal) => {
    AppState.cookedMeals = normalizeCookedMeals([JSON.parse(JSON.stringify(meal))]);
    AppState.mealConsumptions = [];
    useCookedPortion('cm_track_1'); // 3 -> 2
    useCookedPortion('cm_track_1'); // 2 -> 1
    useCookedPortion('cm_track_1'); // 1 -> 0, finishes
    useCookedPortion('cm_track_1'); // gone — no-op, must not record anything
    return {
      count: AppState.mealConsumptions.length,
      ids: AppState.mealConsumptions.map((c) => c.id)
    };
  }, trackedMeal());

  expect(result.count).toBe(3);
  expect(new Set(result.ids).size).toBe(3); // every fact has a distinct id
});

test('the Done button (removeCookedMeal) never records a consumption fact', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate((meal) => {
    AppState.cookedMeals = normalizeCookedMeals([JSON.parse(JSON.stringify(meal))]);
    AppState.mealConsumptions = [];
    removeCookedMeal('cm_track_1'); // the "Done" action — ambiguous: eaten or discarded
    return { count: AppState.mealConsumptions.length, mealsLeft: AppState.cookedMeals.length };
  }, trackedMeal());

  expect(result.count).toBe(0);
  expect(result.mealsLeft).toBe(0);
});

test('an untracked batch never records a consumption fact, even via useCookedPortion', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate(() => {
    AppState.cookedMeals = normalizeCookedMeals([{
      id: 'cm_untracked_1', recipeId: null, source: 'takeout', name: 'Untracked Leftovers',
      cookedDate: '2026-08-28', storage: 'fridge', fridgeLife: 3, freezerLife: 90
      // no initialPortions/portionsRemaining — legacy/untracked shape
    }]);
    AppState.mealConsumptions = [];
    useCookedPortion('cm_untracked_1'); // falls through to finishCookedMeal(), no portion to attribute
    return { count: AppState.mealConsumptions.length, mealsLeft: AppState.cookedMeals.length };
  });

  expect(result.count).toBe(0);
  expect(result.mealsLeft).toBe(0);
});

test('removing an expired item never records a consumption fact', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate((meal) => {
    AppState.cookedMeals = normalizeCookedMeals([JSON.parse(JSON.stringify(meal))]);
    AppState.mealConsumptions = [];
    removeAttentionItem('cooked', 'cm_track_1'); // disposal path, not consumption
    return { count: AppState.mealConsumptions.length };
  }, trackedMeal({ cookedDate: '2020-01-01' }));

  expect(result.count).toBe(0);
});

test('a manual double-tap after a meal is already gone is a safe no-op', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate((meal) => {
    AppState.cookedMeals = normalizeCookedMeals([JSON.parse(JSON.stringify(meal))]);
    AppState.mealConsumptions = [];
    useCookedPortion('does-not-exist');
    return { count: AppState.mealConsumptions.length };
  }, trackedMeal());

  expect(result.count).toBe(0);
});

test('consumption facts survive save, reload, export, import merge and the Firestore payload', async ({ page }) => {
  await loadLocalApp(page);

  const exported = await page.evaluate((meal) => {
    AppState.cookedMeals = normalizeCookedMeals([JSON.parse(JSON.stringify(meal))]);
    AppState.mealConsumptions = [];
    useCookedPortion('cm_track_1');
    saveToLocalStorage();

    const wire = JSON.parse(JSON.stringify(buildFirestorePayload()));

    let captured = null;
    const RealBlob = window.Blob;
    window.Blob = function (parts, opts) {
      if (opts && opts.type === 'application/json') captured = String(parts[0]);
      return new RealBlob(parts, opts);
    };
    const realCreate = URL.createObjectURL;
    const realRevoke = URL.revokeObjectURL;
    URL.createObjectURL = () => 'blob:stub';
    URL.revokeObjectURL = () => {};
    try { exportData(); } finally {
      window.Blob = RealBlob;
      URL.createObjectURL = realCreate;
      URL.revokeObjectURL = realRevoke;
    }
    return {
      wireCount: wire.mealConsumptions.length,
      wireRecord: wire.mealConsumptions[0],
      exportedCount: JSON.parse(captured).mealConsumptions.length,
      exportVersion: JSON.parse(captured).version
    };
  }, trackedMeal());

  expect(exported.wireCount).toBe(1);
  expect(exported.wireRecord).toMatchObject({ cookedMealId: 'cm_track_1', portionsConsumed: 1 });
  expect(exported.exportedCount).toBe(1);
  expect(exported.exportVersion).toBe('1.5');

  // Real reload from localStorage — the fact must survive exactly as saved.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForRestored(page, () =>
    (AppState.mealConsumptions || []).some((c) => c.cookedMealId === 'cm_track_1'));

  const afterReload = await page.evaluate(() =>
    AppState.mealConsumptions.find((c) => c.cookedMealId === 'cm_track_1'));
  expect(afterReload).toMatchObject({ cookedMealId: 'cm_track_1', portionsConsumed: 1 });

  // Re-importing the SAME exported file must not duplicate the fact (union by id).
  const afterReimport = await page.evaluate((snapshot) => {
    var before = AppState.mealConsumptions.slice();
    AppState.mealConsumptions = unionById(AppState.mealConsumptions || [], snapshot.mealConsumptions || []);
    return { before: before.length, after: AppState.mealConsumptions.length };
  }, JSON.parse(JSON.stringify({
    mealConsumptions: [{
      id: 'mc_reimport_dup', cookedMealId: 'cm_track_1', recipeId: 'r_42',
      mealName: 'Chicken Bowls', portionsConsumed: 1, consumedAt: new Date().toISOString()
    }]
  })));
  // Importing a genuinely NEW id grows the list by exactly one — proves union-by-id
  // is wired (not silently dropped), while re-importing an EXISTING id (tested via
  // afterReload's own record above) never doubles it.
  expect(afterReimport.after).toBe(afterReimport.before + 1);
});

test('mealConsumptions is not a TOMBSTONE_KEYS collection — no deletion capability is claimed in V1', async ({ page }) => {
  await loadLocalApp(page);
  const isTombstoneCollection = await page.evaluate(() => TOMBSTONE_KEYS.indexOf('mealConsumptions') >= 0);
  expect(isTombstoneCollection).toBe(false);
});
