const { test, expect } = require('@playwright/test');

/**
 * Production smoke for the low-effort cooking wave (D-055).
 *
 * Runs against the DEPLOYED GitHub Pages build, not the working tree, so it
 * verifies what users actually get. Firebase is deliberately NOT stubbed — the
 * page loads it for real and stays signed out, which is the normal first-visit
 * path. Each test gets a fresh isolated browser context, so nothing persists
 * between them and nothing touches a real account's cloud data.
 */

const APP_URL = 'https://shinyamadasan.github.io/Meal-Prep/';

test.use({ viewport: { width: 1280, height: 1700 } });

async function loadLiveApp(page) {
  await page.addInitScript(() => {
    try {
      localStorage.clear();
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

const FIXTURES = [
  { id: 'ps-steam', name: 'PS Rice + Steamed Veg', category: 'Main Dish',
    basePrepTime: 3, baseCookTime: 30, baseServings: 2, currentServings: 2,
    fridgeLife: 2, freezerLife: 0, estimatedCost: 80, storageNotes: '', instructions: 'Steam it.',
    baseIngredients: [
      { name: 'Rice', baseQuantity: 200, unit: 'g', category: 'Grain' },
      { name: 'Broccoli', baseQuantity: 200, unit: 'g', category: 'Vegetable' }
    ],
    nutritionPerServing: { calories: 300, protein: 8, carbs: 60, fat: 2, fiber: 5, sodium: 30 },
    equipment: ['rice-cooker-steamer'], effort: 'very-low', activeTime: 3,
    mealBalance: { protein: false, vegetables: true, carb: true },
    tags: ['cook-fresh', 'minimal-cleanup'] },

  { id: 'ps-hack', name: 'PS Lechon Manok Hack', category: 'Main Dish',
    basePrepTime: 10, baseCookTime: 0, baseServings: 6, currentServings: 6,
    fridgeLife: 3, freezerLife: 30, estimatedCost: 500, storageNotes: '', instructions: 'Shred and freeze.',
    baseIngredients: [
      { name: 'Roast Chicken', baseQuantity: 1200, unit: 'g', category: 'Protein' },
      { name: 'Rice', baseQuantity: 300, unit: 'g', category: 'Grain' }
    ],
    nutritionPerServing: { calories: 480, protein: 38, carbs: 35, fat: 20, fiber: 1, sodium: 550 },
    equipment: ['no-cook'], effort: 'assembly', activeTime: 10,
    mealBalance: { protein: true, vegetables: false, carb: true },
    tags: ['shortcut', 'freezer-friendly'] },

  { id: 'ps-pot', name: 'PS Pressure Cooker Adobo', category: 'Main Dish',
    basePrepTime: 10, baseCookTime: 40, baseServings: 8, currentServings: 8,
    fridgeLife: 4, freezerLife: 60, estimatedCost: 600, storageNotes: '', instructions: 'Pressure cook.',
    baseIngredients: [
      { name: 'Pork', baseQuantity: 1500, unit: 'g', category: 'Protein' },
      { name: 'Soy Sauce', baseQuantity: 100, unit: 'ml', category: 'Pantry' }
    ],
    nutritionPerServing: { calories: 560, protein: 40, carbs: 5, fat: 40, fiber: 4, sodium: 900 },
    equipment: ['instant-pot', 'pressure-cooker'], effort: 'low', activeTime: 10,
    mealBalance: { protein: true, vegetables: false, carb: false },
    tags: ['batch-friendly', 'freezer-friendly'],
    favorite: true, highlights: ['Better next day'],
    sourceUrl: 'https://panlasangpinoy.com/pork-adobo',
    sourceSite: 'panlasangpinoy.com',
    importedAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z' },

  // Carries no wave metadata at all — proves old recipes still render.
  { id: 'ps-legacy', name: 'PS Legacy Sinigang', category: 'Main Dish',
    basePrepTime: 20, baseCookTime: 40, baseServings: 4, currentServings: 4,
    fridgeLife: 3, freezerLife: 30, estimatedCost: 400, storageNotes: '', instructions: 'Simmer.',
    baseIngredients: [
      { name: 'Pork', baseQuantity: 500, unit: 'g', category: 'Protein' },
      { name: 'Kangkong', baseQuantity: 200, unit: 'g', category: 'Vegetable' }
    ],
    nutritionPerServing: { calories: 400, protein: 30, carbs: 15, fat: 22, fiber: 3, sodium: 800 } }
];

async function seedLive(page) {
  await page.evaluate((recipes) => {
    const day = (d) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
    const iso = (d) => new Date(Date.now() - d * 864e5).toISOString();
    AppState.recipes = normalizeRecipes(JSON.parse(JSON.stringify(recipes)));
    AppState.pantry = [
      { id: 'q1', name: 'Rice', category: 'Grain', purchaseDate: day(1), shelfLifeDays: 200 },
      { id: 'q2', name: 'Broccoli', category: 'Vegetable', dateMode: 'expiry', expiryDate: day(-1) },
      { id: 'q3', name: 'Pork', category: 'Protein', purchaseDate: day(0), shelfLifeDays: 30 },
      { id: 'q4', name: 'Soy Sauce', category: 'Pantry', purchaseDate: day(30), shelfLifeDays: 400 },
      { id: 'q5', name: 'Kangkong', category: 'Vegetable', purchaseDate: day(0), shelfLifeDays: 20 },
      { id: 'q6', name: 'Roast Chicken', category: 'Protein', purchaseDate: day(0), shelfLifeDays: 30 }
    ];
    AppState.cookHistory = [
      { recipeId: 'ps-hack', recipeName: 'PS Lechon Manok Hack', date: iso(1), servings: 6 },
      { recipeId: 'ps-pot', recipeName: 'PS Pressure Cooker Adobo', date: iso(9), servings: 8 }
    ];
    showTab('recipes');
    renderRecipes();
  }, FIXTURES);
}

test('the deployed build serves the low-effort wave code', async ({ page }) => {
  await loadLiveApp(page);

  const present = await page.evaluate(() => ({
    equipmentVocab: typeof RECIPE_EQUIPMENT !== 'undefined' && RECIPE_EQUIPMENT.map((e) => e.id),
    effortVocab: typeof RECIPE_EFFORTS !== 'undefined' && RECIPE_EFFORTS.map((e) => e.id),
    tagVocab: typeof RECIPE_TAGS !== 'undefined' && RECIPE_TAGS.map((t) => t.id),
    fns: ['normalizeRecipeMeta', 'recipeCookMinutes', 'recipePrepMinutes', 'recipeEffortScore',
      'renderRecipeQuickFilters', 'setRecipeQuickFilter', 'getCookSuggestions',
      'getExpirySuggestions', 'seedNewDefaultHacks', 'varietyPenalty', 'daysSinceCooked']
      .filter((f) => typeof window[f] !== 'function') // top-level function decls DO land on window
  }));

  expect(present.fns).toEqual([]); // every new function is live
  expect(present.equipmentVocab).toEqual([
    'rice-cooker', 'rice-cooker-steamer', 'instant-pot', 'pressure-cooker',
    'oven', 'pan', 'egg-boiler', 'microwave', 'no-cook'
  ]);
  expect(present.effortVocab).toEqual(['assembly', 'very-low', 'low', 'normal']);
  expect(present.tagVocab).toEqual([
    'batch-friendly', 'minimal-cleanup', 'cook-fresh', 'freezer-friendly', 'shortcut'
  ]);
});

test('low-effort quick filters work on the deployed site', async ({ page }) => {
  await loadLiveApp(page);
  await seedLive(page);

  const shown = () => page.$$eval('#recipes-grid .recipe-title', (els) => els.map((e) => e.textContent.trim()));

  await expect(page.locator('#recipe-quick-filters .rq-chip').first()).toBeVisible();
  await expect(page.locator('#recipes-grid .recipe-card')).toHaveCount(4);

  // Lowest effort is recipeEffortScore() <= 2 (assembly + very-low + low), the same
  // gate Home's "Easiest" pick uses, ordered easiest-first. The legacy recipe with no
  // metadata (60 min total) still does not qualify. See DECISIONS D-060.
  await page.locator('.rq-chip', { hasText: 'Lowest effort' }).click();
  expect(await shown()).toEqual([
    'PS Lechon Manok Hack',        // assembly
    'PS Rice + Steamed Veg',       // very-low
    'PS Pressure Cooker Adobo'     // low
  ]);

  await page.locator('.rq-chip', { hasText: 'Instant Pot' }).click();
  expect(await shown()).toEqual(['PS Pressure Cooker Adobo']);

  await page.locator('.rq-chip', { hasText: 'No-cook' }).click();
  expect(await shown()).toEqual(['PS Lechon Manok Hack']);

  // Clearing restores the full list; the pre-existing search still works.
  await page.locator('.rq-chip', { hasText: 'No-cook' }).click();
  await expect(page.locator('#recipes-grid .recipe-card')).toHaveCount(4);
  await page.locator('#recipe-search').fill('sinigang');
  expect(await shown()).toEqual(['PS Legacy Sinigang']);

  // A recipe with no wave metadata renders no metadata strip.
  const legacyStrip = await page.locator('#recipes-grid .recipe-card .recipe-lowfx').count();
  expect(legacyStrip).toBe(0);
});

test('Home cook suggestions render on the deployed site', async ({ page }) => {
  await loadLiveApp(page);
  await seedLive(page);

  const result = await page.evaluate(() => {
    showTab('dashboard');
    renderDashboard();
    const suggestions = getCookSuggestions();
    return {
      keys: suggestions.map((s) => s.key),
      names: suggestions.map((s) => s.recipe.name),
      whys: suggestions.map((s) => s.why),
      rows: document.querySelectorAll('.dash-card--suggest .dash-sugg-row').length,
      header: (document.querySelector('.dash-card--suggest .dash-level-header') || {}).textContent || ''
    };
  });

  expect(result.header).toContain('What should I cook?');
  expect(result.keys.length).toBeGreaterThan(0);
  expect(result.keys.length).toBeLessThanOrEqual(3);
  expect(result.rows).toBe(result.keys.length);
  expect(new Set(result.names).size).toBe(result.names.length); // no repeats
  expect(result.keys).toContain('use-soon');
  expect(result.names[result.keys.indexOf('use-soon')]).toBe('PS Rice + Steamed Veg');
  expect(result.whys[result.keys.indexOf('use-soon')]).toContain('Broccoli');
  // Fixed display order, whichever category claimed a recipe first.
  expect(result.keys).toEqual([...result.keys].sort(
    (a, b) => ({ easiest: 0, 'use-soon': 1, different: 2 }[a] - { easiest: 0, 'use-soon': 1, different: 2 }[b])
  ));
});

test('the new cooking hacks ship with the deployed build', async ({ page }) => {
  await loadLiveApp(page);

  const result = await page.evaluate(() => {
    // The real seeded defaults, straight from the deployed bundle.
    AppState.customHacks = defaultCookingHacks.map((h) => Object.assign({}, h));
    showTab('hacks');
    renderCookingHacks();
    return {
      titles: Array.prototype.slice
        .call(document.querySelectorAll('#cooking-hacks .hack-item-title'))
        .map((el) => el.textContent.trim()),
      defaultCount: defaultCookingHacks.length
    };
  });

  expect(result.titles).toContain('Two Lechon Manok Hack');
  expect(result.titles).toContain('Rice and Steamed Veg in One Pot');
  expect(result.titles).toContain('Oven Chicken, Three Sauces');
  expect(result.titles).toContain('Freeze the Protein, Cook Rice Fresh');
  expect(result.titles).toContain('Frozen Vegetables Skip the Chopping');
  expect(result.titles).toContain('Pressure-Cooker Batch Meat');
  expect(result.titles).toContain('Make Sauces Separately');
  // The originals are still there — the additions did not replace them.
  expect(result.titles).toContain('Egg Prep Strategy');
  // Every default renders — count read from the deployed source of truth, not
  // frozen, so a later wave adding a hack doesn't break this smoke.
  expect(result.titles.length).toBe(result.defaultCount);
});

test('recipe edit preservation holds on the deployed site', async ({ page }) => {
  await loadLiveApp(page);
  await seedLive(page);

  // Rename only — nothing else touched.
  await page.evaluate(() => openEditRecipeModal('ps-pot'));
  await page.locator('#recipe-name').fill('PS Pressure Cooker Adobo (renamed)');
  await page.locator('#recipe-submit-btn').click();
  await page.waitForTimeout(800);

  const after = await page.evaluate(() => {
    const r = AppState.recipes.find((x) => String(x.id) === 'ps-pot');
    return {
      name: r.name,
      favorite: r.favorite,
      highlights: r.highlights,
      sourceUrl: r.sourceUrl,
      sourceSite: r.sourceSite,
      importedAt: r.importedAt,
      updatedAt: r.updatedAt,
      equipment: r.equipment,
      effort: r.effort,
      activeTime: r.activeTime,
      tags: r.tags,
      mealBalance: r.mealBalance,
      nutrition: r.nutritionPerServing,
      cookTime: r.baseCookTime
    };
  });

  expect(after.name).toBe('PS Pressure Cooker Adobo (renamed)');
  // Properties the form does not own — all previously destroyed by any edit.
  expect(after.favorite).toBe(true);
  expect(after.highlights).toEqual(['Better next day']);
  expect(after.sourceUrl).toBe('https://panlasangpinoy.com/pork-adobo');
  expect(after.sourceSite).toBe('panlasangpinoy.com');
  expect(after.importedAt).toBe('2026-08-01T00:00:00.000Z');
  expect(after.updatedAt).toBe('2026-08-02T00:00:00.000Z');
  // Fiber and sodium have no inputs and must not be zeroed.
  expect(after.nutrition.fiber).toBe(4);
  expect(after.nutrition.sodium).toBe(900);
  // Wave metadata round-trips through the form.
  expect(after.equipment).toEqual(['instant-pot', 'pressure-cooker']);
  expect(after.effort).toBe('low');
  expect(after.activeTime).toBe(10);
  expect(after.tags).toEqual(['batch-friendly', 'freezer-friendly']);
  expect(after.mealBalance).toEqual({ protein: true, vegetables: false, carb: false });
  expect(after.cookTime).toBe(40);
});

test('no NaN and no runtime errors anywhere on the deployed site', async ({ page }) => {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await loadLiveApp(page);

  // First with the REAL seeded sample recipes the deployed app ships with.
  const seededNaN = await page.evaluate(() => {
    const tabs = ['dashboard', 'recipes', 'planner', 'grocery', 'fridge', 'storage', 'nutrition', 'ingredients', 'hacks'];
    const dirty = [];
    tabs.forEach((t) => {
      try { showTab(t); } catch (e) { dirty.push(t + ':threw'); }
      if (/NaN/.test(document.body.innerText)) dirty.push(t);
    });
    return dirty;
  });
  expect(seededNaN).toEqual([]);

  // Then with a zero-cook-time recipe planned — the exact shape that used to
  // render "NaN min" on the card, in the planner slot and in the week stats.
  const zeroCookNaN = await page.evaluate(() => {
    AppState.recipes = normalizeRecipes([{
      id: 'ps-nocook', name: 'PS No-Cook Bowl', category: 'Main Dish',
      basePrepTime: 10, baseCookTime: 0, baseServings: 2, currentServings: 2,
      fridgeLife: 2, freezerLife: 30, estimatedCost: 200, storageNotes: '', instructions: 'Assemble.',
      baseIngredients: [{ name: 'Roast Chicken', baseQuantity: 300, unit: 'g', category: 'Protein' }],
      nutritionPerServing: { calories: 450, protein: 35, carbs: 40, fat: 15, fiber: 1, sodium: 500 },
      equipment: ['no-cook'], effort: 'assembly', activeTime: 10
    }, {
      id: 'ps-zeroprep', name: 'PS Reheat', category: 'Main Dish',
      basePrepTime: 0, baseCookTime: 5, baseServings: 2, currentServings: 2,
      fridgeLife: 2, freezerLife: 30, estimatedCost: 100, storageNotes: '', instructions: 'Reheat.',
      baseIngredients: [{ name: 'Rice', baseQuantity: 200, unit: 'g', category: 'Grain' }],
      nutritionPerServing: { calories: 200, protein: 4, carbs: 44, fat: 1, fiber: 1, sodium: 5 }
    }]);
    AppState.weeklyPlan.Monday.dinner = 'ps-nocook';
    AppState.weeklyPlan.Tuesday.dinner = 'ps-zeroprep';
    showTab('recipes'); renderRecipes();
    showTab('planner'); renderWeeklyPlanner(); updateWeeklyStats(); generateGroceryList();

    const tabs = ['dashboard', 'recipes', 'planner', 'grocery', 'nutrition'];
    const dirty = [];
    tabs.forEach((t) => { showTab(t); if (/NaN/.test(document.body.innerText)) dirty.push(t); });
    return {
      dirty,
      prepStat: document.getElementById('total-prep-time').textContent,
      cookStat: document.getElementById('total-cook-time').textContent
    };
  });

  expect(zeroCookNaN.dirty).toEqual([]);
  expect(zeroCookNaN.prepStat).toBe('10 min'); // 10 + 0
  expect(zeroCookNaN.cookStat).toBe('5 min');  // 0 + 5

  expect(pageErrors).toEqual([]);
  // `requestStorageAccess: Permission denied` comes from the real Firebase SDK
  // hitting Chromium's storage partitioning in a headless third-party context.
  // It is environmental, not app code, and does not occur in a normal browser.
  // Same family, added 2026-08-23: `Framing 'https://www.google.com/' violates ...
  // frame-ancestors` is the App Check reCAPTCHA challenge iframe, named by URL rather
  // than by "recaptcha", so the older list missed it. Intermittent in CI.
  const appErrors = consoleErrors.filter(
    (e) => !/net::ERR|Failed to load resource|favicon|requestStorageAccess|frame-ancestors|google\.com/i.test(e)
  );
  expect(appErrors).toEqual([]);
});
