const { test, expect } = require('@playwright/test');

/**
 * Production smoke for the cook-path depletion tombstones (TASK-045, D-057 addendum).
 *
 * Runs against the DEPLOYED GitHub Pages build, not the working tree. Firebase is
 * deliberately NOT stubbed — the page loads it for real and stays signed out, the
 * normal first-visit path. Each test gets a fresh isolated context, so nothing
 * persists between tests and nothing touches a real account's cloud data.
 *
 * Every assertion here is about the SHIPPED bundle: that cooking which empties more
 * than MASS_DELETE_GUARD tracked pantry items writes a real tombstone for every one
 * of them, that a partially depleted item is left alone, and that a stale remote copy
 * can no longer resurrect the food.
 */

const APP_URL = 'https://shinyamadasan.github.io/Meal-Prep/';

test.use({ viewport: { width: 1280, height: 1700 } });

async function loadLiveApp(page) {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__cookProdBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__cookProdBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
  });
  // Cache-bust so a stale Pages/CDN copy can never make this pass falsely.
  await page.goto(APP_URL + '?smoke=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load').catch(() => {});
  // AppState is a top-level `const`, so it is NOT a window property — probe it by
  // name from page scope, the way the app's own inline handlers see it.
  await page.waitForFunction(
    'typeof AppState !== "undefined" && Array.isArray(AppState.recipes)',
    null,
    { timeout: 45000 }
  );
  await page.waitForTimeout(3000);
}

const PANTRY_FN = `(id, name, qty) => ({
  id: id, name: name, category: 'Vegetable', staple: false,
  quantity: qty, unit: 'g', storage: 'fridge',
  purchaseDate: todayISO(), shelfLifeDays: 30,
  updatedAt: new Date().toISOString()
})`;

const RECIPE_FN = `(id, ingredients) => ({
  id: id, name: 'Smoke Dish ' + id, category: 'Main Dish',
  baseServings: 1, currentServings: 1,
  fridgeLife: 4, freezerLife: 60,
  instructions: '',
  nutritionPerServing: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0 },
  baseIngredients: ingredients.map((i) => ({ name: i[0], baseQuantity: i[1], unit: 'g' }))
})`;

const NAMES = ['Zucchini', 'Kale', 'Okra', 'Tofu', 'Squid', 'Papaya'];

test('the deployed bundle contains the cook path and the tombstone machinery it now uses', async ({ page }) => {
  await loadLiveApp(page);

  const present = await page.evaluate(() => ({
    deduct: typeof deductIngredientsForRecipe === 'function',
    doMarkCooked: typeof _doMarkCooked === 'function',
    markCooked: typeof markRecipeCooked === 'function',
    checkMissing: typeof checkMissingIngredients === 'function',
    snapshot: typeof snapshotIdBaseline === 'function',
    recordDeletions: typeof recordLocalDeletions === 'function',
    applyTomb: typeof applyTombstones === 'function',
    unionById: typeof unionById === 'function',
    guardIsFive: typeof MASS_DELETE_GUARD !== 'undefined' && MASS_DELETE_GUARD === 5,
    // The wave this builds on must still be there.
    removeAll: typeof removeAllExpired === 'function',
    collect: typeof collectAttentionItems === 'function'
  }));

  Object.entries(present).forEach(([name, ok]) => {
    expect(ok, `${name} missing from the deployed bundle`).toBe(true);
  });
});

test('live: cooking that empties six pantry items crosses MASS_DELETE_GUARD and tombstones every id', async ({ page }) => {
  await loadLiveApp(page);

  const result = await page.evaluate(([pantryFnSrc, recipeFnSrc, names]) => {
    const mkPantry = eval(pantryFnSrc);
    const mkRecipe = eval(recipeFnSrc);

    // CONTROL ARM: the same six ids vanishing with no explicit tombstone — what the
    // old cook path produced. The guard swallows it, in the shipped bundle too.
    AppState.deletions = {};
    AppState.cookedMeals = [];
    AppState.pantry = names.map((n, i) => mkPantry('sctl_' + i, n, 100));
    snapshotIdBaseline();
    AppState.pantry = [];
    recordLocalDeletions();
    const guardSwallowed = Object.keys(AppState.deletions).length;

    // REAL ARM: the same six items, emptied through the deployed cook path.
    AppState.deletions = {};
    AppState.pantry = names.map((n, i) => mkPantry('sp_' + i, n, 100));
    snapshotIdBaseline();
    deductIngredientsForRecipe(mkRecipe('sr_six', names.map((n) => [n, 100])), 1);

    return {
      guardSwallowed: guardSwallowed,
      pantryIds: AppState.pantry.map((p) => p.id),
      tombstones: Object.keys(AppState.deletions).sort()
    };
  }, [PANTRY_FN, RECIPE_FN, NAMES]);

  expect(result.guardSwallowed).toBe(0);   // six > 5 — the vanish-diff records nothing
  expect(result.pantryIds).toEqual([]);
  expect(result.tombstones).toEqual(['sp_0', 'sp_1', 'sp_2', 'sp_3', 'sp_4', 'sp_5']);
});

test('live: a full cook keeps partial stock, creates the batch, and lands every tombstone in storage and the cloud payload', async ({ page }) => {
  await loadLiveApp(page);

  const after = await page.evaluate(([pantryFnSrc, recipeFnSrc, names]) => {
    const mkPantry = eval(pantryFnSrc);
    const mkRecipe = eval(recipeFnSrc);
    AppState.deletions = {};
    AppState.cookedMeals = [];
    AppState.cookHistory = [];
    AppState.pantry = names.map((n, i) => mkPantry('sck_' + i, n, 100));
    AppState.pantry.push(mkPantry('sck_keep', 'Eggplant', 500));
    snapshotIdBaseline();

    const recipe = mkRecipe('sr_full', names.map((n) => [n, 100]).concat([['Eggplant', 100]]));
    _doMarkCooked(recipe, null, 1, 3);

    const stored = JSON.parse(localStorage.getItem('mealPrepAppData'));
    const payload = buildFirestorePayload();
    return {
      cookedCount: AppState.cookedMeals.length,
      portions: AppState.cookedMeals[0].portionsRemaining,
      pantryIds: AppState.pantry.map((p) => p.id),
      keepQty: AppState.pantry[0].quantity,
      tombstones: Object.keys(AppState.deletions).sort(),
      storedPantryIds: stored.pantry.map((p) => p.id),
      storedTombstones: Object.keys(stored.deletions).sort(),
      payloadTombstones: Object.keys(payload.deletions).sort()
    };
  }, [PANTRY_FN, RECIPE_FN, NAMES]);

  const expected = ['sck_0', 'sck_1', 'sck_2', 'sck_3', 'sck_4', 'sck_5'];

  expect(after.cookedCount).toBe(1);          // the batch still gets created
  expect(after.portions).toBe(3);
  expect(after.pantryIds).toEqual(['sck_keep']);
  expect(after.keepQty).toBe(400);            // partial stock kept, quantity correct
  expect(after.tombstones).toEqual(expected);
  expect(after.storedPantryIds).toEqual(['sck_keep']);
  expect(after.storedTombstones).toEqual(expected);
  expect(after.payloadTombstones).toEqual(expected);
});

test('live: a stale remote copy can no longer resurrect food the cook emptied', async ({ page }) => {
  await loadLiveApp(page);

  const after = await page.evaluate(([pantryFnSrc, recipeFnSrc, names]) => {
    const mkPantry = eval(pantryFnSrc);
    const mkRecipe = eval(recipeFnSrc);
    AppState.deletions = {};
    AppState.pantry = names.map((n, i) => mkPantry('sres_' + i, n, 100));
    snapshotIdBaseline();

    // Another device's copy, captured BEFORE the cook — every item still stocked.
    const remote = JSON.parse(JSON.stringify(AppState.pantry));

    deductIngredientsForRecipe(mkRecipe('sr_res', names.map((n) => [n, 100])), 1);

    AppState.pantry = unionById(AppState.pantry, remote);
    const merged = AppState.pantry.length;
    applyTombstones();
    return { merged: merged, survivors: AppState.pantry.length };
  }, [PANTRY_FN, RECIPE_FN, NAMES]);

  expect(after.merged).toBe(6);      // the merge really does bring them back
  expect(after.survivors).toBe(0);   // …and the shipped tombstones kill them again
});
