const { test, expect } = require('@playwright/test');

/**
 * Production smoke for the ready-food-first wave (D-056).
 *
 * Runs against the DEPLOYED GitHub Pages build, not the working tree. Firebase
 * is deliberately NOT stubbed — the page loads it for real and stays signed
 * out, the normal first-visit path. Each test gets a fresh isolated context, so
 * nothing persists between them and nothing touches a real account's cloud data.
 */

const APP_URL = 'https://shinyamadasan.github.io/Meal-Prep/';

test.use({ viewport: { width: 1280, height: 1700 } });

async function loadLiveApp(page) {
  // Runs before EVERY navigation, so it must bootstrap once and then leave
  // storage alone — otherwise a page.reload() would wipe the data under test.
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__readyProdBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__readyProdBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
  });
  // Cache-bust so a stale Pages/CDN copy can never make this pass falsely.
  await page.goto(APP_URL + '?smoke=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load').catch(() => {});
  // AppState is a top-level `const`, so it is NOT a window property — probe it
  // by name from page scope, the way the app's own inline handlers see it.
  await page.waitForFunction(
    'typeof AppState !== "undefined" && Array.isArray(AppState.recipes)',
    null,
    { timeout: 45000 }
  );
  await page.waitForTimeout(3000);
}

// Local calendar date N days ago — daysLeftFrom()/todayISO() work in local time,
// so a UTC-derived date silently shifts by a day near midnight.
const DAY_FN = `(d) => {
  const t = new Date();
  t.setDate(t.getDate() - d);
  return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
}`;

async function seedStoredFood(page) {
  await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    AppState.recipes = normalizeRecipes([{
      id: 'psr-oven', name: 'PS Oven Chicken', category: 'Main Dish',
      basePrepTime: 15, baseCookTime: 50, baseServings: 8, currentServings: 8,
      fridgeLife: 4, freezerLife: 60, estimatedCost: 700, storageNotes: '', instructions: 'Roast.',
      baseIngredients: [{ name: 'Chicken', baseQuantity: 2000, unit: 'g', category: 'Protein' }],
      nutritionPerServing: { calories: 520, protein: 45, carbs: 2, fat: 30, fiber: 0, sodium: 600 },
      equipment: ['oven'], effort: 'normal', activeTime: 15,
      mealBalance: { protein: true, vegetables: false, carb: false }
    }]);
    AppState.pantry = [];
    AppState.cookHistory = [];
    AppState.cookedMeals = normalizeCookedMeals([
      { id: 'ps_freezer', recipeId: 'psr-oven', name: 'PS Freezer Chicken',
        cookedDate: day(1), storage: 'freezer', fridgeLife: 4, freezerLife: 60,
        initialPortions: 5, portionsRemaining: 5 },
      { id: 'ps_fridge', recipeId: null, source: 'leftovers', name: 'PS Fridge Pork',
        cookedDate: day(0), storage: 'fridge', fridgeLife: 6, freezerLife: 60,
        initialPortions: 3, portionsRemaining: 3 },
      { id: 'ps_soon', recipeId: null, source: 'leftovers', name: 'PS Use Soon Sisig',
        cookedDate: day(3), storage: 'fridge', fridgeLife: 4, freezerLife: 60,
        initialPortions: 2, portionsRemaining: 2 },
      // Pre-wave shape: no portion fields at all.
      { id: 'ps_untracked', recipeId: null, source: 'leftovers', name: 'PS Untracked Adobo',
        cookedDate: day(1), storage: 'fridge', fridgeLife: 5, freezerLife: 60 }
    ]);
    showTab('dashboard');
    renderDashboard();
  }, DAY_FN);
}

test('the deployed build serves the ready-food code', async ({ page }) => {
  await loadLiveApp(page);

  const missing = await page.evaluate(() =>
    ['normalizeCookedMeal', 'normalizeCookedMeals', 'portionCountOrNull',
      'cookedMealTracksPortions', 'useCookedPortion', 'finishCookedMeal',
      'getReadyFoodSuggestions', 'readyFoodBucket', 'readyFoodMetaLine',
      'readyFoodBalanceHint', 'renderReadyFoodCard', 'formatPortions']
      .filter((f) => typeof window[f] !== 'function'));

  expect(missing).toEqual([]);

  // The manual-add modal really has the optional Portions input.
  await expect(page.locator('#manual-cooked-portions')).toHaveCount(1);
});

test('a pre-wave cooked meal still loads and renders on the deployed site', async ({ page }) => {
  await loadLiveApp(page);

  const result = await page.evaluate(() => {
    AppState.cookedMeals = normalizeCookedMeals([{
      id: 'ps_old', recipeId: null, source: 'leftovers', name: 'PS Old Record',
      cookedDate: todayISO(), storage: 'fridge', fridgeLife: 3, freezerLife: 90
    }]);
    showTab('fridge');
    renderCookedMeals();
    const m = AppState.cookedMeals[0];
    return {
      initial: m.initialPortions,
      remaining: m.portionsRemaining,
      tracks: cookedMealTracksPortions(m),
      cards: document.querySelectorAll('#cooked-meals-list .cooked-card').length,
      badges: document.querySelectorAll('#cooked-meals-list .cooked-portions').length,
      useOne: document.querySelectorAll('#cooked-meals-list .cooked-use-one').length,
      done: document.querySelectorAll('#cooked-meals-list .cooked-remove').length
    };
  });

  expect(result.initial).toBeNull();
  expect(result.remaining).toBeNull();
  expect(result.tracks).toBe(false);
  expect(result.cards).toBe(1);
  expect(result.badges).toBe(0);
  expect(result.useOne).toBe(0);
  expect(result.done).toBe(1); // the pre-existing action is untouched
});

test('Home ranks ready food and renders it above the cook suggestions', async ({ page }) => {
  await loadLiveApp(page);
  await seedStoredFood(page);

  const result = await page.evaluate(() => {
    const html = document.getElementById('dashboard').innerHTML;
    return {
      order: getReadyFoodSuggestions().map((m) => m.id),
      buckets: getReadyFoodSuggestions().map((m) => readyFoodBucket(m)),
      rows: document.querySelectorAll('.dash-card--ready .dash-ready-row').length,
      header: (document.querySelector('.dash-card--ready .dash-level-header') || {}).textContent || '',
      firstName: (document.querySelector('.dash-card--ready .dash-ready-name') || {}).textContent || '',
      firstMeta: (document.querySelector('.dash-card--ready .dash-ready-meta') || {}).textContent || '',
      readyBeforeCook: html.indexOf('dash-card--ready') >= 0 &&
        (html.indexOf('dash-card--suggest') < 0 || html.indexOf('dash-card--ready') < html.indexOf('dash-card--suggest'))
    };
  });

  // Expiring fridge → fridge → freezer, with the untracked fridge item in bucket 1.
  expect(result.order[0]).toBe('ps_soon');
  expect(result.buckets[0]).toBe(0);
  expect(result.buckets[result.buckets.length - 1]).toBe(2);
  expect(result.header).toContain('Ready to eat');
  expect(result.rows).toBe(3); // capped, not a whole inventory listing
  expect(result.firstName).toContain('PS Use Soon Sisig');
  expect(result.firstMeta).toContain('2 portions');
  expect(result.firstMeta).toContain('fridge');
  expect(result.readyBeforeCook).toBe(true);
});

test('expired food is never offered as something to eat on the deployed site', async ({ page }) => {
  await loadLiveApp(page);

  const result = await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    AppState.recipes = [];
    AppState.pantry = [];
    AppState.cookedMeals = normalizeCookedMeals([
      { id: 'ps_expired', name: 'PS Expired Pork', cookedDate: day(10), storage: 'fridge',
        fridgeLife: 3, freezerLife: 60, initialPortions: 2, portionsRemaining: 2 },
      { id: 'ps_good', name: 'PS Good Chicken', cookedDate: day(0), storage: 'fridge',
        fridgeLife: 5, freezerLife: 60, initialPortions: 2, portionsRemaining: 2 }
    ]);
    return {
      suggested: getReadyFoodSuggestions().map((m) => m.id),
      // …while the existing freshness engine still flags it for disposal.
      expiredAlerts: getFreshnessAlerts().cooked.expired
    };
  }, DAY_FN);

  expect(result.suggested).toEqual(['ps_good']);
  expect(result.expiredAlerts).toBe(1);
});

test('one tap consumes a portion on the deployed site, with no modal', async ({ page }) => {
  await loadLiveApp(page);
  await seedStoredFood(page);

  await expect(page.locator('.dash-card--ready .dash-ready-meta').first()).toContainText('2 portions');
  await page.locator('.dash-card--ready .dash-ready-use').first().click();
  await page.waitForTimeout(600);

  const after = await page.evaluate(() => ({
    remaining: AppState.cookedMeals.find((m) => m.id === 'ps_soon').portionsRemaining,
    initial: AppState.cookedMeals.find((m) => m.id === 'ps_soon').initialPortions,
    overlays: document.querySelectorAll('.modal:not(.hidden), .confirm-overlay').length
  }));
  expect(after.remaining).toBe(1);
  expect(after.initial).toBe(2); // original count preserved
  expect(after.overlays).toBe(0); // one tap really is one tap

  // The last portion finishes the batch through the existing removal path.
  await page.locator('.dash-card--ready .dash-ready-use').first().click();
  await page.waitForTimeout(600);
  const finished = await page.evaluate(() => ({
    stillThere: AppState.cookedMeals.some((m) => m.id === 'ps_soon'),
    anyNegative: AppState.cookedMeals.some((m) => m.portionsRemaining < 0)
  }));
  expect(finished.stillThere).toBe(false);
  expect(finished.anyNegative).toBe(false);
});

test('the Landers workflow works on the deployed site with no special-case code', async ({ page }) => {
  await loadLiveApp(page);

  await page.evaluate(() => {
    AppState.recipes = [];
    AppState.cookedMeals = [];
    showTab('fridge');
    renderCookedMeals();
    openManualCookedModal();
  });
  await page.locator('#manual-cooked-name').fill('Landers Lechon Manok');
  await page.locator('#manual-cooked-portions').fill('6');
  await page.locator('#manual-cooked-storage').selectOption('fridge');
  await page.locator('#manual-cooked-modal .btn--primary').click();
  await page.waitForTimeout(600);

  // Eat two — two taps.
  await page.locator('#cooked-meals-list .cooked-use-one').click();
  await page.waitForTimeout(400);
  await page.locator('#cooked-meals-list .cooked-use-one').click();
  await page.waitForTimeout(400);

  // Freeze the rest through the EXISTING storage toggle.
  await page.evaluate(() => setCookedStorage(AppState.cookedMeals[0].id, 'freezer'));
  await page.waitForTimeout(400);

  const result = await page.evaluate(() => {
    const m = AppState.cookedMeals[0];
    showTab('dashboard');
    renderDashboard();
    return {
      initial: m.initialPortions,
      remaining: m.portionsRemaining,
      storage: m.storage,
      shelfLife: cookedShelfLife(m),
      keys: Object.keys(m).sort(),
      readyName: (document.querySelector('.dash-card--ready .dash-ready-name') || {}).textContent || '',
      readyMeta: (document.querySelector('.dash-card--ready .dash-ready-meta') || {}).textContent || ''
    };
  });

  expect(result.initial).toBe(6);
  expect(result.remaining).toBe(4);
  expect(result.storage).toBe('freezer');
  expect(result.shelfLife).toBe(90); // the manual modal's freezer default
  expect(result.readyName).toContain('Landers Lechon Manok');
  expect(result.readyMeta).toContain('4 portions');
  expect(result.readyMeta).toContain('freezer');
  // Nothing Landers-specific reached the data model.
  expect(result.keys).toEqual([
    'cookedDate', 'freezerLife', 'fridgeLife', 'id', 'initialPortions', 'name',
    'portionsRemaining', 'recipeId', 'source', 'storage', 'updatedAt'
  ]);
});

test('portion data round-trips through the deployed storage paths', async ({ page }) => {
  await loadLiveApp(page);

  const wire = await page.evaluate(() => {
    AppState.cookedMeals = normalizeCookedMeals([{
      id: 'ps_rt', recipeId: null, source: 'leftovers', name: 'PS Round Trip',
      cookedDate: todayISO(), storage: 'freezer', fridgeLife: 3, freezerLife: 60,
      initialPortions: 6, portionsRemaining: 4
    }]);
    saveToLocalStorage();
    const payload = JSON.parse(JSON.stringify(buildFirestorePayload()));
    const stored = JSON.parse(localStorage.getItem('mealPrepAppData'));
    return { firestore: payload.cookedMeals[0], local: stored.cookedMeals[0] };
  });

  expect(wire.firestore).toMatchObject({ initialPortions: 6, portionsRemaining: 4 });
  expect(wire.local).toMatchObject({ initialPortions: 6, portionsRemaining: 4 });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    'typeof AppState !== "undefined" && Array.isArray(AppState.cookedMeals)',
    null, { timeout: 45000 }
  );
  await page.waitForTimeout(2500);

  const after = await page.evaluate(() => {
    const m = (AppState.cookedMeals || []).find((x) => x.id === 'ps_rt');
    return m && { initial: m.initialPortions, remaining: m.portionsRemaining, storage: m.storage };
  });
  expect(after).toMatchObject({ initial: 6, remaining: 4, storage: 'freezer' });
});

test('no NaN and no runtime errors anywhere on the deployed site', async ({ page }) => {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await loadLiveApp(page);
  await seedStoredFood(page);

  const dirty = await page.evaluate(() => {
    const tabs = ['dashboard', 'recipes', 'planner', 'grocery', 'fridge', 'storage', 'nutrition', 'ingredients', 'hacks'];
    const bad = [];
    tabs.forEach((t) => {
      try { showTab(t); } catch (e) { bad.push(t + ':threw'); }
      if (/NaN/.test(document.body.innerText)) bad.push(t);
    });
    return bad;
  });

  expect(dirty).toEqual([]);
  expect(pageErrors).toEqual([]);
  // `requestStorageAccess: Permission denied` comes from the real Firebase SDK
  // hitting Chromium's storage partitioning in a headless third-party context.
  // Environmental, not app code, and absent in a normal browser.
  // Same family, added 2026-08-23: `Framing 'https://www.google.com/' violates ...
  // frame-ancestors` is the App Check reCAPTCHA challenge iframe, named by URL rather
  // than by "recaptcha", so the older list missed it. Intermittent in CI.
  const appErrors = consoleErrors.filter(
    (e) => !/net::ERR|Failed to load resource|favicon|requestStorageAccess|frame-ancestors|google\.com/i.test(e)
  );
  expect(appErrors).toEqual([]);
});
