const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');
const { waitForAppReady } = require('./app-ready');

/**
 * Cook-path depletion tombstones.
 *
 * deductIngredientsForRecipe() removes a pantry record once cooking empties it.
 * Those removals used to ride on the generic vanish-diff in recordLocalDeletions(),
 * which deliberately IGNORES more than MASS_DELETE_GUARD (5) simultaneous
 * disappearances as a suspected load race. A cook that emptied six or more tracked
 * items therefore dropped them locally with no tombstone, and the next merge from
 * another device resurrected the food.
 *
 * The fix reuses the Kitchen Truth pattern: write an explicit tombstone for every
 * depleted id, then remove, then re-baseline — before the caller's saveData().
 */

test.use({ viewport: { width: 1280, height: 1700 } });

async function loadLocalApp(page) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__cookTombstoneBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__cookTombstoneBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
  });
  await page.goto(pathToFileURL(path.resolve('index.html')).href, { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
}

// A pantry record the cook path will actually deduct from: tracked quantity in
// grams, explicitly non-staple so neither category nor INGREDIENT_DB can exempt it.
const PANTRY_FN = `(id, name, qty) => ({
  id: id, name: name, category: 'Vegetable', staple: false,
  quantity: qty, unit: 'g', storage: 'fridge',
  purchaseDate: todayISO(), shelfLifeDays: 30,
  updatedAt: new Date().toISOString()
})`;

// 1:1 serving scale, so baseQuantity grams == grams deducted.
const RECIPE_FN = `(id, ingredients) => ({
  id: id, name: 'Test Dish ' + id, category: 'Main Dish',
  baseServings: 1, currentServings: 1,
  fridgeLife: 4, freezerLife: 60,
  instructions: '',
  nutritionPerServing: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0 },
  baseIngredients: ingredients.map((i) => ({ name: i[0], baseQuantity: i[1], unit: 'g' }))
})`;

// ── 1. A single depletion tombstones ────────────────────────────────────────

test('cooking that empties one pantry item writes a tombstone for it', async ({ page }) => {
  await loadLocalApp(page);

  const after = await page.evaluate(([pantryFnSrc, recipeFnSrc]) => {
    const mkPantry = eval(pantryFnSrc);
    const mkRecipe = eval(recipeFnSrc);
    AppState.deletions = {};
    AppState.cookedMeals = [];
    AppState.pantry = [mkPantry('p_solo', 'Zucchini', 100)];
    snapshotIdBaseline();

    const recipe = mkRecipe('r_solo', [['Zucchini', 100]]);
    const sum = deductIngredientsForRecipe(recipe, 1);

    return {
      pantryIds: AppState.pantry.map((p) => p.id),
      tombstones: Object.keys(AppState.deletions),
      outOfStock: sum.outOfStock
    };
  }, [PANTRY_FN, RECIPE_FN]);

  expect(after.pantryIds).toEqual([]);
  expect(after.tombstones).toEqual(['p_solo']);
  expect(after.outOfStock).toEqual(['Zucchini']);
});

// ── 2 & 3. Past MASS_DELETE_GUARD, without the vanish-diff ──────────────────

test('cooking that empties six pantry items tombstones every removed id', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate(([pantryFnSrc, recipeFnSrc]) => {
    const mkPantry = eval(pantryFnSrc);
    const mkRecipe = eval(recipeFnSrc);
    const names = ['Zucchini', 'Kale', 'Okra', 'Tofu', 'Squid', 'Papaya'];

    // CONTROL ARM: the same six ids vanishing with no explicit tombstone. This is
    // exactly what the old cook path produced, and the guard swallows it.
    AppState.deletions = {};
    AppState.cookedMeals = [];
    AppState.pantry = names.map((n, i) => mkPantry('ctl_' + i, n, 100));
    snapshotIdBaseline();
    AppState.pantry = [];
    recordLocalDeletions();
    const guardSwallowed = Object.keys(AppState.deletions).length;

    // REAL ARM: the same six items, depleted through the cook path.
    AppState.deletions = {};
    AppState.pantry = names.map((n, i) => mkPantry('p_' + i, n, 100));
    snapshotIdBaseline();
    const recipe = mkRecipe('r_six', names.map((n) => [n, 100]));
    const sum = deductIngredientsForRecipe(recipe, 1);

    return {
      guardSwallowed: guardSwallowed,
      guardThreshold: MASS_DELETE_GUARD,
      pantryIds: AppState.pantry.map((p) => p.id),
      tombstones: Object.keys(AppState.deletions).sort(),
      outOfStock: sum.outOfStock.slice().sort()
    };
  }, [PANTRY_FN, RECIPE_FN]);

  // Six > 5, so the vanish-diff refuses to record anything on its own.
  expect(result.guardThreshold).toBe(5);
  expect(result.guardSwallowed).toBe(0);

  // The cook path records them anyway — it never depended on the diff.
  expect(result.pantryIds).toEqual([]);
  expect(result.tombstones).toEqual(['p_0', 'p_1', 'p_2', 'p_3', 'p_4', 'p_5']);
  expect(result.outOfStock).toEqual(['Kale', 'Okra', 'Papaya', 'Squid', 'Tofu', 'Zucchini']);
});

test('eight simultaneous depletions still tombstone one-for-one', async ({ page }) => {
  await loadLocalApp(page);

  const after = await page.evaluate(([pantryFnSrc, recipeFnSrc]) => {
    const mkPantry = eval(pantryFnSrc);
    const mkRecipe = eval(recipeFnSrc);
    const names = ['Zucchini', 'Kale', 'Okra', 'Tofu', 'Squid', 'Papaya', 'Mango', 'Eggplant'];
    AppState.deletions = {};
    AppState.cookedMeals = [];
    AppState.pantry = names.map((n, i) => mkPantry('p8_' + i, n, 50));
    snapshotIdBaseline();
    deductIngredientsForRecipe(mkRecipe('r_eight', names.map((n) => [n, 50])), 1);
    return {
      pantryCount: AppState.pantry.length,
      tombstoneCount: Object.keys(AppState.deletions).length,
      allPrefixed: Object.keys(AppState.deletions).every((k) => k.indexOf('p8_') === 0)
    };
  }, [PANTRY_FN, RECIPE_FN]);

  expect(after.pantryCount).toBe(0);
  expect(after.tombstoneCount).toBe(8);
  expect(after.allPrefixed).toBe(true);
});

// ── 4 & 8. Partial depletion is untouched ───────────────────────────────────

test('partially depleted items stay in the pantry with no tombstone and correct quantities', async ({ page }) => {
  await loadLocalApp(page);

  const after = await page.evaluate(([pantryFnSrc, recipeFnSrc]) => {
    const mkPantry = eval(pantryFnSrc);
    const mkRecipe = eval(recipeFnSrc);
    AppState.deletions = {};
    AppState.cookedMeals = [];
    AppState.pantry = [
      mkPantry('p_partial', 'Zucchini', 500),
      mkPantry('p_partial2', 'Kale', 250),
      mkPantry('p_empty', 'Okra', 100)
    ];
    snapshotIdBaseline();
    const sum = deductIngredientsForRecipe(
      mkRecipe('r_mixed', [['Zucchini', 100], ['Kale', 25], ['Okra', 100]]), 1
    );
    const byId = {};
    AppState.pantry.forEach((p) => { byId[p.id] = p.quantity; });
    return {
      pantryIds: AppState.pantry.map((p) => p.id).sort(),
      quantities: byId,
      tombstones: Object.keys(AppState.deletions),
      outOfStock: sum.outOfStock
    };
  }, [PANTRY_FN, RECIPE_FN]);

  expect(after.pantryIds).toEqual(['p_partial', 'p_partial2']);
  expect(after.quantities.p_partial).toBe(400);
  expect(after.quantities.p_partial2).toBe(225);
  expect(after.tombstones).toEqual(['p_empty']);   // only the emptied one
  expect(after.outOfStock).toEqual(['Okra']);
});

test('a multiplier scales the deduction and only tombstones what it actually empties', async ({ page }) => {
  await loadLocalApp(page);

  const after = await page.evaluate(([pantryFnSrc, recipeFnSrc]) => {
    const mkPantry = eval(pantryFnSrc);
    const mkRecipe = eval(recipeFnSrc);
    AppState.deletions = {};
    AppState.pantry = [
      mkPantry('p_x2a', 'Zucchini', 200),   // 2 × 100 → exactly empty
      mkPantry('p_x2b', 'Kale', 300)        // 2 × 100 → 100 left
    ];
    snapshotIdBaseline();
    deductIngredientsForRecipe(mkRecipe('r_x2', [['Zucchini', 100], ['Kale', 100]]), 2);
    return {
      pantryIds: AppState.pantry.map((p) => p.id),
      kale: AppState.pantry[0] ? AppState.pantry[0].quantity : null,
      tombstones: Object.keys(AppState.deletions)
    };
  }, [PANTRY_FN, RECIPE_FN]);

  expect(after.pantryIds).toEqual(['p_x2b']);
  expect(after.kale).toBe(100);
  expect(after.tombstones).toEqual(['p_x2a']);
});

// ── 5. Unknown quantity is still never invented, never removed ──────────────

test('untracked-quantity pantry items are neither deducted nor tombstoned', async ({ page }) => {
  await loadLocalApp(page);

  const after = await page.evaluate(([pantryFnSrc, recipeFnSrc]) => {
    const mkPantry = eval(pantryFnSrc);
    const mkRecipe = eval(recipeFnSrc);
    AppState.deletions = {};
    AppState.pantry = [
      mkPantry('p_unknown', 'Zucchini', null),
      mkPantry('p_known', 'Kale', 100)
    ];
    snapshotIdBaseline();
    const sum = deductIngredientsForRecipe(
      mkRecipe('r_unknown', [['Zucchini', 100], ['Kale', 100]]), 1
    );
    const unknown = AppState.pantry.find((p) => p.id === 'p_unknown');
    return {
      pantryIds: AppState.pantry.map((p) => p.id),
      unknownQty: unknown ? unknown.quantity : 'MISSING',
      tombstones: Object.keys(AppState.deletions),
      deducted: sum.deducted.length
    };
  }, [PANTRY_FN, RECIPE_FN]);

  expect(after.pantryIds).toEqual(['p_unknown']);   // untracked item survives
  expect(after.unknownQty).toBe(null);              // quantity never invented
  expect(after.tombstones).toEqual(['p_known']);
  expect(after.deducted).toBe(1);                   // only the tracked one deducted
});

// ── 6. Insufficient inventory still warns, then clamps at zero ──────────────

test('insufficient inventory still raises the warning dialog before cooking', async ({ page }) => {
  await loadLocalApp(page);

  const missing = await page.evaluate(([pantryFnSrc, recipeFnSrc]) => {
    const mkPantry = eval(pantryFnSrc);
    const mkRecipe = eval(recipeFnSrc);
    AppState.deletions = {};
    AppState.cookedMeals = [];
    AppState.pantry = [mkPantry('p_short', 'Zucchini', 40)];   // recipe wants 100
    snapshotIdBaseline();
    const recipe = mkRecipe('r_short', [['Zucchini', 100]]);
    AppState.recipes = [recipe];
    markRecipeCooked('r_short', null);
    return checkMissingIngredients(recipe, 1);
  }, [PANTRY_FN, RECIPE_FN]);

  expect(missing).toEqual(['Zucchini']);

  await page.locator('.confirm-ok-btn').click();          // "Continue" on the portions dialog
  await page.waitForTimeout(250);
  await expect(page.locator('.confirm-title')).toHaveText('Not enough ingredients?');

  await page.locator('.confirm-ok-btn').click();          // "Yes, mark as cooked anyway"
  await page.waitForTimeout(400);

  const after = await page.evaluate(() => ({
    pantryIds: AppState.pantry.map((p) => p.id),
    tombstones: Object.keys(AppState.deletions),
    cookedCount: AppState.cookedMeals.length
  }));

  expect(after.pantryIds).toEqual([]);           // clamped to 0 → removed, as before
  expect(after.tombstones).toEqual(['p_short']); // …but now it syncs as a delete
  expect(after.cookedCount).toBe(1);
});

// ── 7, 9 & 10. Full cook: batch, persistence, cloud payload ─────────────────

test('a full cook still creates the batch, and every depleted id reaches storage and the cloud payload', async ({ page }) => {
  await loadLocalApp(page);

  const after = await page.evaluate(([pantryFnSrc, recipeFnSrc]) => {
    const mkPantry = eval(pantryFnSrc);
    const mkRecipe = eval(recipeFnSrc);
    const names = ['Zucchini', 'Kale', 'Okra', 'Tofu', 'Squid', 'Papaya'];
    AppState.deletions = {};
    AppState.cookedMeals = [];
    AppState.cookHistory = [];
    AppState.pantry = names.map((n, i) => mkPantry('cook_' + i, n, 100));
    AppState.pantry.push(mkPantry('cook_keep', 'Eggplant', 500));
    snapshotIdBaseline();

    const recipe = mkRecipe('r_full', names.map((n) => [n, 100]).concat([['Eggplant', 100]]));
    _doMarkCooked(recipe, null, 1, 3);

    const stored = JSON.parse(localStorage.getItem('mealPrepAppData'));
    const payload = buildFirestorePayload();
    return {
      cookedMeals: AppState.cookedMeals.map((m) => ({ name: m.name, portions: m.portionsRemaining })),
      cookHistoryCount: AppState.cookHistory.length,
      pantryIds: AppState.pantry.map((p) => p.id),
      keepQty: AppState.pantry[0].quantity,
      tombstones: Object.keys(AppState.deletions).sort(),
      storedPantryIds: stored.pantry.map((p) => p.id),
      storedTombstones: Object.keys(stored.deletions).sort(),
      payloadTombstones: Object.keys(payload.deletions).sort(),
      payloadPantryIds: payload.pantry.map((p) => p.id)
    };
  }, [PANTRY_FN, RECIPE_FN]);

  const expected = ['cook_0', 'cook_1', 'cook_2', 'cook_3', 'cook_4', 'cook_5'];

  // 7 — the cooked batch is still created, with its portion count.
  expect(after.cookedMeals).toEqual([{ name: 'Test Dish r_full', portions: 3 }]);
  expect(after.cookHistoryCount).toBe(1);

  // 8 — survivors keep the right quantity.
  expect(after.pantryIds).toEqual(['cook_keep']);
  expect(after.keepQty).toBe(400);

  // 10 — the cloud payload carries every tombstone.
  expect(after.tombstones).toEqual(expected);
  expect(after.payloadTombstones).toEqual(expected);
  expect(after.payloadPantryIds).toEqual(['cook_keep']);

  // 9 — and so does what was written to localStorage.
  expect(after.storedPantryIds).toEqual(['cook_keep']);
  expect(after.storedTombstones).toEqual(expected);

  // 9 (cont.) — reload and the removals hold; nothing is resurrected.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);

  const reloaded = await page.evaluate(() => ({
    pantryIds: AppState.pantry.map((p) => p.id),
    tombstones: Object.keys(AppState.deletions).sort(),
    cookedCount: AppState.cookedMeals.length
  }));

  expect(reloaded.pantryIds).toEqual(['cook_keep']);
  expect(reloaded.tombstones).toEqual(expected);
  expect(reloaded.cookedCount).toBe(1);
});

// ── Resurrection: the actual bug, end to end ────────────────────────────────

test('a depleted item cannot be resurrected by a stale remote copy', async ({ page }) => {
  await loadLocalApp(page);

  const after = await page.evaluate(([pantryFnSrc, recipeFnSrc]) => {
    const mkPantry = eval(pantryFnSrc);
    const mkRecipe = eval(recipeFnSrc);
    const names = ['Zucchini', 'Kale', 'Okra', 'Tofu', 'Squid', 'Papaya'];
    AppState.deletions = {};
    AppState.pantry = names.map((n, i) => mkPantry('res_' + i, n, 100));
    snapshotIdBaseline();

    // Another device's copy, captured BEFORE the cook — every item still stocked.
    const remote = JSON.parse(JSON.stringify(AppState.pantry));

    deductIngredientsForRecipe(mkRecipe('r_res', names.map((n) => [n, 100])), 1);

    // Simulate the merge: the remote rows come back, then tombstones are applied.
    AppState.pantry = unionById(AppState.pantry, remote);
    const beforeTombstones = AppState.pantry.length;
    applyTombstones();
    return { beforeTombstones: beforeTombstones, afterTombstones: AppState.pantry.length };
  }, [PANTRY_FN, RECIPE_FN]);

  expect(after.beforeTombstones).toBe(6);   // the merge really does bring them back
  expect(after.afterTombstones).toBe(0);    // …and the tombstones kill them again
});
