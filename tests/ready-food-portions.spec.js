const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');
const { waitForRestored } = require('./app-ready');

/**
 * Ready-food wave — portion tracking on cookedMeals.
 *
 * Two optional additive fields (`initialPortions`, `portionsRemaining`) on the
 * EXISTING cookedMeals[] objects. Both null = an untracked batch, which must
 * behave exactly as it did before this wave.
 */

test.use({ viewport: { width: 1200, height: 1500 } });

async function loadLocalApp(page) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__readyFoodBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__readyFoodBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
  });
  await page.goto(pathToFileURL(path.resolve('index.html')).href, { waitUntil: 'domcontentloaded' });
  // Condition, not clock. See AI_OS_NOTES 2026-08-23.
  await page.waitForFunction(
    () => typeof AppState !== 'undefined' && Array.isArray(AppState.cookedMeals) &&
          typeof saveData === 'function' && typeof renderCookedMeals === 'function',
    null, { timeout: 30000 });
  await page.waitForTimeout(300);
}

// Exactly the shape a cooked meal had before this wave — no portion fields.
const LEGACY_MEAL = {
  id: 'cm_legacy_1',
  recipeId: null,
  source: 'leftovers',
  name: 'Legacy Leftover Pork',
  cookedDate: '2026-08-20',
  storage: 'fridge',
  fridgeLife: 3,
  freezerLife: 90
};

test('a cooked meal saved without portion fields still loads and renders', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate((legacy) => {
    localStorage.setItem('mealPrepAppData', JSON.stringify({
      recipes: [], weeklyPlan: {}, groceryList: [],
      cookedMeals: [JSON.parse(JSON.stringify(legacy))],
      version: 2, lastSaved: new Date().toISOString()
    }));
    const loaded = loadFromLocalStorage();
    showTab('fridge');
    renderCookedMeals();

    const m = AppState.cookedMeals[0];
    return {
      loaded,
      initialPortions: m.initialPortions,
      portionsRemaining: m.portionsRemaining,
      tracks: cookedMealTracksPortions(m),
      name: m.name,
      storage: m.storage,
      fridgeLife: m.fridgeLife,
      cards: document.querySelectorAll('#cooked-meals-list .cooked-card').length,
      // An untracked batch shows no portion badge and no Used-1 button…
      portionBadges: document.querySelectorAll('#cooked-meals-list .cooked-portions').length,
      useOneButtons: document.querySelectorAll('#cooked-meals-list .cooked-use-one').length,
      // …but the pre-existing Done button is untouched.
      doneButtons: document.querySelectorAll('#cooked-meals-list .cooked-remove').length
    };
  }, LEGACY_MEAL);

  expect(result.loaded).toBe(true);
  expect(result.initialPortions).toBeNull();
  expect(result.portionsRemaining).toBeNull();
  expect(result.tracks).toBe(false);
  expect(result.name).toBe('Legacy Leftover Pork');
  expect(result.storage).toBe('fridge');
  expect(result.fridgeLife).toBe(3);
  expect(result.cards).toBe(1);
  expect(result.portionBadges).toBe(0);
  expect(result.useOneButtons).toBe(0);
  expect(result.doneButtons).toBe(1);
});

test('portion normalization is idempotent and repairs incoherent pairs', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate(() => {
    const cases = {
      blank: normalizeCookedMeal({ id: 'a' }),
      zeroRemaining: normalizeCookedMeal({ id: 'b', initialPortions: 4, portionsRemaining: 0 }),
      onlyRemaining: normalizeCookedMeal({ id: 'c', portionsRemaining: 3 }),
      onlyInitial: normalizeCookedMeal({ id: 'd', initialPortions: 5 }),
      // Remaining above initial must RAISE initial, never delete food.
      remainingOverInitial: normalizeCookedMeal({ id: 'e', initialPortions: 2, portionsRemaining: 6 }),
      fractional: normalizeCookedMeal({ id: 'f', initialPortions: 4.7, portionsRemaining: 2.9 }),
      negative: normalizeCookedMeal({ id: 'g', initialPortions: -3, portionsRemaining: -1 }),
      strings: normalizeCookedMeal({ id: 'h', initialPortions: '6', portionsRemaining: '4' }),
      garbage: normalizeCookedMeal({ id: 'i', initialPortions: 'abc', portionsRemaining: {} }),
      huge: normalizeCookedMeal({ id: 'j', initialPortions: 5000, portionsRemaining: 5000 }),
      emptyString: normalizeCookedMeal({ id: 'k', initialPortions: '', portionsRemaining: '' })
    };

    // Idempotency across the whole list.
    const list = Object.keys(cases).map((k) => JSON.parse(JSON.stringify(cases[k])));
    const once = JSON.stringify(normalizeCookedMeals(list));
    const twice = JSON.stringify(normalizeCookedMeals(JSON.parse(once)));

    return {
      cases,
      idempotent: once === twice,
      nonArray: normalizeCookedMeals(null),
      nullMeal: normalizeCookedMeal(null)
    };
  });

  const c = result.cases;
  expect(c.blank).toMatchObject({ initialPortions: null, portionsRemaining: null });
  expect(c.zeroRemaining).toMatchObject({ initialPortions: 4, portionsRemaining: 0 });
  expect(c.onlyRemaining).toMatchObject({ initialPortions: 3, portionsRemaining: 3 });
  expect(c.onlyInitial).toMatchObject({ initialPortions: 5, portionsRemaining: 5 });
  expect(c.remainingOverInitial).toMatchObject({ initialPortions: 6, portionsRemaining: 6 });
  expect(c.fractional).toMatchObject({ initialPortions: 4, portionsRemaining: 2 });
  expect(c.negative).toMatchObject({ initialPortions: null, portionsRemaining: null });
  expect(c.strings).toMatchObject({ initialPortions: 6, portionsRemaining: 4 });
  expect(c.garbage).toMatchObject({ initialPortions: null, portionsRemaining: null });
  expect(c.huge).toMatchObject({ initialPortions: 99, portionsRemaining: 99 });
  expect(c.emptyString).toMatchObject({ initialPortions: null, portionsRemaining: null });
  expect(result.idempotent).toBe(true);
  expect(result.nonArray).toEqual([]);
  expect(result.nullMeal).toBeNull();
});

test('Used 1 decrements by one tap and never goes negative', async ({ page }) => {
  await loadLocalApp(page);

  const setup = await page.evaluate(() => {
    AppState.recipes = [];
    AppState.cookedMeals = normalizeCookedMeals([{
      id: 'cm_batch', recipeId: null, source: 'leftovers', name: 'Batch Chicken',
      cookedDate: todayISO(), storage: 'fridge', fridgeLife: 4, freezerLife: 60,
      initialPortions: 3, portionsRemaining: 3
    }]);
    showTab('fridge');
    renderCookedMeals();
    return {
      badge: document.querySelector('#cooked-meals-list .cooked-portions').textContent.trim(),
      buttons: document.querySelectorAll('#cooked-meals-list .cooked-use-one').length
    };
  });
  expect(setup.badge).toBe('3 portions');
  expect(setup.buttons).toBe(1);

  // One tap on the real button — no modal, no fields.
  await page.locator('#cooked-meals-list .cooked-use-one').click();
  await page.waitForTimeout(400);
  let state = await page.evaluate(() => ({
    remaining: AppState.cookedMeals[0].portionsRemaining,
    initial: AppState.cookedMeals[0].initialPortions,
    badge: document.querySelector('#cooked-meals-list .cooked-portions').textContent.trim(),
    modals: document.querySelectorAll('.modal:not(.hidden), .confirm-overlay').length
  }));
  expect(state.remaining).toBe(2);
  expect(state.initial).toBe(3); // the original count is preserved
  expect(state.badge).toBe('2 portions');
  expect(state.modals).toBe(0); // one tap really is one tap

  await page.locator('#cooked-meals-list .cooked-use-one').click();
  await page.waitForTimeout(400);
  state = await page.evaluate(() => ({
    remaining: AppState.cookedMeals[0].portionsRemaining,
    badge: document.querySelector('#cooked-meals-list .cooked-portions').textContent.trim()
  }));
  expect(state.remaining).toBe(1);
  expect(state.badge).toBe('1 portion'); // singular

  // The last portion finishes the batch through the existing removal path.
  await page.locator('#cooked-meals-list .cooked-use-one').click();
  await page.waitForTimeout(400);
  const finished = await page.evaluate(() => ({
    count: AppState.cookedMeals.length,
    cards: document.querySelectorAll('#cooked-meals-list .cooked-card').length
  }));
  expect(finished.count).toBe(0);
  expect(finished.cards).toBe(0);
});

test('portions can never be driven negative, even by repeated calls', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate(() => {
    AppState.cookedMeals = normalizeCookedMeals([{
      id: 'cm_one', recipeId: null, name: 'One Portion Left',
      cookedDate: todayISO(), storage: 'fridge', fridgeLife: 3, freezerLife: 30,
      initialPortions: 1, portionsRemaining: 1
    }]);
    useCookedPortion('cm_one');           // finishes it
    useCookedPortion('cm_one');           // gone — must be a no-op
    useCookedPortion('does-not-exist');   // unknown id — must not throw
    return {
      count: AppState.cookedMeals.length,
      anyNegative: (AppState.cookedMeals || []).some((m) => m.portionsRemaining < 0)
    };
  });

  expect(result.count).toBe(0);
  expect(result.anyNegative).toBe(false);
});

test('Used 1 on an untracked batch finishes it instead of counting', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate((legacy) => {
    AppState.cookedMeals = normalizeCookedMeals([JSON.parse(JSON.stringify(legacy))]);
    useCookedPortion('cm_legacy_1');
    return { count: AppState.cookedMeals.length };
  }, LEGACY_MEAL);

  expect(result.count).toBe(0);
});

test('marking a recipe cooked stores the portion count from the dialog', async ({ page }) => {
  await loadLocalApp(page);

  await page.evaluate(() => {
    AppState.recipes = normalizeRecipes([{
      id: 'rf-1', name: 'Oven Chicken', category: 'Main Dish',
      basePrepTime: 10, baseCookTime: 40, baseServings: 6, currentServings: 6,
      fridgeLife: 4, freezerLife: 60, estimatedCost: 500, storageNotes: '', instructions: 'Roast.',
      baseIngredients: [{ name: 'Chicken', baseQuantity: 1500, unit: 'g', category: 'Protein' }],
      nutritionPerServing: { calories: 500, protein: 45, carbs: 2, fat: 30, fiber: 0, sodium: 500 },
      mealBalance: { protein: true, vegetables: false, carb: false }
    }]);
    AppState.cookedMeals = [];
    AppState.pantry = [];
    showTab('recipes');
    renderRecipes();
    markRecipeCooked('rf-1', null);
  });

  // The dialog defaults the portion count from the recipe's own servings.
  const defaulted = await page.locator('#cook-portion-count').inputValue();
  expect(defaulted).toBe('6');

  // Changing the batch multiplier updates the suggestion…
  await page.locator('#cook-portion-multiplier').fill('2');
  await page.waitForTimeout(200);
  expect(await page.locator('#cook-portion-count').inputValue()).toBe('12');

  // …until the user types their own number, which then wins.
  await page.locator('#cook-portion-count').fill('8');
  await page.locator('#cook-portion-multiplier').fill('3');
  await page.waitForTimeout(200);
  expect(await page.locator('#cook-portion-count').inputValue()).toBe('8');

  await page.locator('.confirm-ok-btn').click();
  await page.waitForTimeout(400);
  if (await page.locator('.confirm-ok-btn').count()) {
    await page.locator('.confirm-ok-btn').click();
    await page.waitForTimeout(400);
  }

  const stored = await page.evaluate(() => {
    const m = AppState.cookedMeals[0];
    return m && { name: m.name, initial: m.initialPortions, remaining: m.portionsRemaining, storage: m.storage };
  });
  expect(stored).toMatchObject({
    name: 'Oven Chicken', initial: 8, remaining: 8, storage: 'fridge'
  });
});

test('a blank portion field keeps the pre-wave untracked behaviour', async ({ page }) => {
  await loadLocalApp(page);

  await page.evaluate(() => {
    AppState.recipes = normalizeRecipes([{
      id: 'rf-2', name: 'Untracked Stew', category: 'Main Dish',
      basePrepTime: 5, baseCookTime: 20, baseServings: 4, currentServings: 4,
      fridgeLife: 3, freezerLife: 30, estimatedCost: 200, storageNotes: '', instructions: 'Stew.',
      baseIngredients: [{ name: 'Beef', baseQuantity: 500, unit: 'g', category: 'Protein' }],
      nutritionPerServing: { calories: 400, protein: 30, carbs: 10, fat: 25, fiber: 1, sodium: 400 }
    }]);
    AppState.cookedMeals = [];
    AppState.pantry = [];
    showTab('recipes');
    renderRecipes();
    markRecipeCooked('rf-2', null);
  });

  await page.locator('#cook-portion-count').fill('');
  await page.locator('.confirm-ok-btn').click();
  await page.waitForTimeout(400);
  if (await page.locator('.confirm-ok-btn').count()) {
    await page.locator('.confirm-ok-btn').click();
    await page.waitForTimeout(400);
  }

  const stored = await page.evaluate(() => {
    const m = AppState.cookedMeals[0];
    return m && { initial: m.initialPortions, remaining: m.portionsRemaining, tracks: cookedMealTracksPortions(m) };
  });
  expect(stored).toMatchObject({ initial: null, remaining: null, tracks: false });
});

test('portion data survives save, reload, export and the Firestore payload', async ({ page }) => {
  await loadLocalApp(page);

  const exported = await page.evaluate(() => {
    AppState.cookedMeals = normalizeCookedMeals([{
      id: 'cm_rt', recipeId: null, source: 'leftovers', name: 'Round Trip Chicken',
      cookedDate: todayISO(), storage: 'freezer', fridgeLife: 3, freezerLife: 60,
      initialPortions: 6, portionsRemaining: 4
    }]);
    saveToLocalStorage();

    // Firestore payload is the same JSON round-trip saveToFirestore() performs.
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
    return { wire: wire.cookedMeals[0], exported: captured };
  });

  expect(exported.wire).toMatchObject({ initialPortions: 6, portionsRemaining: 4 });
  expect(JSON.parse(exported.exported).cookedMeals[0]).toMatchObject({
    initialPortions: 6, portionsRemaining: 4
  });

  // Real reload from localStorage.
  await page.reload({ waitUntil: 'domcontentloaded' });
  // Wait for the RESTORED batch, not for a fixed delay: mid-init the list is empty and the
  // test would read undefined. Narrowed from "any cooked meal" to THIS one, and moved onto
  // the shared helper so there is one restore-wait idiom in the suite rather than several.
  await waitForRestored(page, () =>
    (AppState.cookedMeals || []).some((m) => m.id === 'cm_rt'));

  const after = await page.evaluate(() => {
    const m = AppState.cookedMeals.find((x) => x.id === 'cm_rt');
    return { initial: m.initialPortions, remaining: m.portionsRemaining, storage: m.storage };
  });
  expect(after).toMatchObject({ initial: 6, remaining: 4, storage: 'freezer' });
});

test('the fridge/freezer freshness behaviour is unchanged by portions', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate(() => {
    // Must be a LOCAL calendar date — daysLeftFrom()/todayISO() work in local
    // time, so a UTC-derived date silently shifts by a day near midnight.
    const day = (d) => {
      const t = new Date();
      t.setDate(t.getDate() - d);
      return t.getFullYear() + '-' +
        String(t.getMonth() + 1).padStart(2, '0') + '-' +
        String(t.getDate()).padStart(2, '0');
    };
    AppState.pantry = [];
    AppState.cookedMeals = normalizeCookedMeals([
      { id: 'f1', name: 'Old Fridge Food', cookedDate: day(5), storage: 'fridge',
        fridgeLife: 3, freezerLife: 60, initialPortions: 2, portionsRemaining: 2 },
      { id: 'f2', name: 'Fresh Fridge Food', cookedDate: day(0), storage: 'fridge',
        fridgeLife: 4, freezerLife: 60 }
    ]);
    return {
      alerts: getFreshnessAlerts(),
      // The shelf-life helpers behave identically whether portions exist or not.
      expiredDaysLeft: daysLeftFrom('f1' && AppState.cookedMeals[0].cookedDate, cookedShelfLife(AppState.cookedMeals[0])),
      freshDaysLeft: daysLeftFrom(AppState.cookedMeals[1].cookedDate, cookedShelfLife(AppState.cookedMeals[1]))
    };
  });

  expect(result.expiredDaysLeft).toBe(-2);
  expect(result.freshDaysLeft).toBe(4);
  expect(result.alerts.cooked.expired).toBe(1);
  expect(result.alerts.expired).toBe(1);
});
