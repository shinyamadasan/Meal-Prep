const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

/**
 * Low-effort cooking wave — discovery (quick filters), Home suggestions,
 * cook-history variety, the recipe editor round-trip, and the cooking hacks.
 */

test.use({ viewport: { width: 1280, height: 1600 } });

async function loadLocalApp(page) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__lowfxTestBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__lowfxTestBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
  });
  await page.goto(pathToFileURL(path.resolve('index.html')).href, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
}

const RECIPES = [
  { id: 'r-steam', name: 'Rice + Steamed Veg', category: 'Main Dish',
    basePrepTime: 3, baseCookTime: 30, baseServings: 2, currentServings: 2,
    fridgeLife: 2, freezerLife: 0, estimatedCost: 80, instructions: 'Steam.',
    baseIngredients: [
      { name: 'Rice', baseQuantity: 200, unit: 'g', category: 'Grain' },
      { name: 'Broccoli', baseQuantity: 200, unit: 'g', category: 'Vegetable' }
    ],
    nutritionPerServing: { calories: 300, protein: 8, carbs: 60, fat: 2, fiber: 5, sodium: 30 },
    equipment: ['rice-cooker-steamer'], effort: 'very-low', activeTime: 3,
    mealBalance: { protein: false, vegetables: true, carb: true },
    tags: ['cook-fresh', 'minimal-cleanup'] },

  { id: 'r-oven', name: 'Oven Batch Chicken', category: 'Main Dish',
    basePrepTime: 15, baseCookTime: 50, baseServings: 8, currentServings: 8,
    fridgeLife: 4, freezerLife: 60, estimatedCost: 700, instructions: 'Roast.',
    baseIngredients: [
      { name: 'Chicken', baseQuantity: 2000, unit: 'g', category: 'Protein' },
      { name: 'Salt', baseQuantity: 10, unit: 'g', category: 'Pantry' }
    ],
    nutritionPerServing: { calories: 520, protein: 45, carbs: 2, fat: 30, fiber: 0, sodium: 600 },
    equipment: ['oven'], effort: 'normal', activeTime: 15,
    mealBalance: { protein: true, vegetables: false, carb: false },
    tags: ['batch-friendly', 'freezer-friendly'] },

  { id: 'r-hack', name: 'Lechon Manok Hack', category: 'Main Dish',
    basePrepTime: 10, baseCookTime: 0, baseServings: 6, currentServings: 6,
    fridgeLife: 3, freezerLife: 30, estimatedCost: 500, instructions: 'Shred and freeze.',
    baseIngredients: [
      { name: 'Roast Chicken', baseQuantity: 1200, unit: 'g', category: 'Protein' },
      { name: 'Rice', baseQuantity: 300, unit: 'g', category: 'Grain' }
    ],
    nutritionPerServing: { calories: 480, protein: 38, carbs: 35, fat: 20, fiber: 1, sodium: 550 },
    equipment: ['no-cook'], effort: 'assembly', activeTime: 10,
    mealBalance: { protein: true, vegetables: false, carb: true },
    tags: ['shortcut', 'freezer-friendly'] },

  { id: 'r-pot', name: 'Pressure Cooker Pork Adobo', category: 'Main Dish',
    basePrepTime: 10, baseCookTime: 40, baseServings: 8, currentServings: 8,
    fridgeLife: 4, freezerLife: 60, estimatedCost: 600, instructions: 'Pressure cook.',
    baseIngredients: [
      { name: 'Pork', baseQuantity: 1500, unit: 'g', category: 'Protein' },
      { name: 'Soy Sauce', baseQuantity: 100, unit: 'ml', category: 'Pantry' }
    ],
    nutritionPerServing: { calories: 560, protein: 40, carbs: 5, fat: 40, fiber: 0, sodium: 900 },
    equipment: ['instant-pot', 'pressure-cooker'], effort: 'low', activeTime: 10,
    mealBalance: { protein: true, vegetables: false, carb: false },
    tags: ['batch-friendly', 'freezer-friendly'] },

  // Deliberately carries NO new metadata — a pre-wave recipe.
  { id: 'r-legacy', name: 'Legacy Sinigang', category: 'Main Dish',
    basePrepTime: 20, baseCookTime: 40, baseServings: 4, currentServings: 4,
    fridgeLife: 3, freezerLife: 30, estimatedCost: 400, instructions: 'Simmer.',
    baseIngredients: [
      { name: 'Pork', baseQuantity: 500, unit: 'g', category: 'Protein' },
      { name: 'Kangkong', baseQuantity: 200, unit: 'g', category: 'Vegetable' }
    ],
    nutritionPerServing: { calories: 400, protein: 30, carbs: 15, fat: 22, fiber: 3, sodium: 800 } }
];

async function seed(page) {
  await page.evaluate((recipes) => {
    AppState.recipes = normalizeRecipes(JSON.parse(JSON.stringify(recipes)));
    AppState.pantry = [];
    AppState.cookHistory = [];
    AppState.cookedMeals = [];
    AppState.groceryList = [];
    showTab('recipes');
    renderRecipes();
  }, RECIPES);
}

const chipNames = async (page) =>
  page.$$eval('#recipe-quick-filters .rq-chip', (els) =>
    els.map((el) => el.textContent.replace(/\s+/g, ' ').trim()));

const shownRecipes = async (page) =>
  page.$$eval('#recipes-grid .recipe-title', (els) => els.map((el) => el.textContent.trim()));

// ── Discovery ───────────────────────────────────────────────────────────────

test('quick filters surface low-effort recipes and every cooking method', async ({ page }) => {
  await loadLocalApp(page);
  await seed(page);

  const chips = await chipNames(page);
  const row = chips.join(' | ');
  expect(row).toContain('All');
  expect(row).toContain('⚡ Lowest effort');
  expect(row).toContain('🍚 Rice cooker');
  expect(row).toContain('♨️ Rice + steamer');
  expect(row).toContain('⏲️ Instant Pot');
  expect(row).toContain('🔥 Oven');
  expect(row).toContain('🥗 No-cook');
  expect(row).toContain('🍱 Batch-friendly');
  // Pan is a PRIMARY cooking method, so it stays on the row even though nothing
  // in this fixture uses one — a method you cannot see is a method you cannot
  // discover. It is rendered muted and reports a count of zero.
  expect(row).toContain('🍳 Pan');
  const panEmpty = await page.locator('.rq-chip', { hasText: 'Pan' }).first()
    .evaluate((el) => el.classList.contains('is-empty') &&
      el.querySelector('.rq-count').textContent === '0');
  expect(panEmpty).toBe(true);

  await expect(page.locator('#recipes-grid .recipe-card')).toHaveCount(5);

  // Lowest effort = assembly + very-low + low, matching the Home "Easiest" gate,
  // and ordered easiest-first.
  await page.locator('.rq-chip', { hasText: 'Lowest effort' }).click();
  expect(await shownRecipes(page)).toEqual([
    'Lechon Manok Hack',           // assembly
    'Rice + Steamed Veg',          // very-low
    'Pressure Cooker Pork Adobo'   // low
  ]);
  // The 60-minute legacy recipe with no metadata is not smuggled in.
  expect(await shownRecipes(page)).not.toContain('Legacy Sinigang');

  // Rice cooker covers both the plain cooker and the steamer variant.
  await page.locator('.rq-chip', { hasText: 'Rice cooker' }).first().click();
  expect(await shownRecipes(page)).toEqual(['Rice + Steamed Veg']);

  await page.locator('.rq-chip', { hasText: 'Instant Pot' }).click();
  expect(await shownRecipes(page)).toEqual(['Pressure Cooker Pork Adobo']);

  await page.locator('.rq-chip', { hasText: 'No-cook' }).click();
  expect(await shownRecipes(page)).toEqual(['Lechon Manok Hack']);

  await page.locator('.rq-chip', { hasText: 'Batch-friendly' }).click();
  expect((await shownRecipes(page)).sort()).toEqual(['Oven Batch Chicken', 'Pressure Cooker Pork Adobo']);

  // Tapping the active chip again clears it...
  await page.locator('.rq-chip', { hasText: 'Batch-friendly' }).click();
  await expect(page.locator('#recipes-grid .recipe-card')).toHaveCount(5);

  // ...and so does the explicit All chip.
  await page.locator('.rq-chip', { hasText: 'Oven' }).click();
  await expect(page.locator('#recipes-grid .recipe-card')).toHaveCount(1);
  await page.locator('.rq-chip', { hasText: 'All' }).click();
  await expect(page.locator('#recipes-grid .recipe-card')).toHaveCount(5);
});

test('quick filters stack with the existing search, category and favourites filters', async ({ page }) => {
  await loadLocalApp(page);
  await seed(page);

  // Existing search alone still works.
  await page.locator('#recipe-search').fill('adobo');
  expect(await shownRecipes(page)).toEqual(['Pressure Cooker Pork Adobo']);

  // Search + a chip that excludes the match -> empty, proving they AND together.
  await page.locator('.rq-chip', { hasText: 'Oven' }).click();
  await expect(page.locator('#recipes-grid .recipe-card')).toHaveCount(0);

  await page.locator('#recipe-search').fill('');
  expect(await shownRecipes(page)).toEqual(['Oven Batch Chicken']);

  // Existing prep-time filter still applies on top.
  await page.locator('.rq-chip', { hasText: 'Oven' }).click(); // clear
  // Rice + Steamed Veg is 33 min total, Lechon Manok Hack is 10 — both under 45,
  // while the oven / pressure-cooker / legacy recipes are not.
  await page.locator('#preptime-filter').selectOption('45');
  const quick = await shownRecipes(page);
  expect(quick.sort()).toEqual(['Lechon Manok Hack', 'Rice + Steamed Veg']);

  // And favourites still filter independently.
  await page.locator('#preptime-filter').selectOption('');
  await page.evaluate(() => {
    toggleFavorite('r-oven');
    document.getElementById('favorites-filter').checked = true; // visually hidden behind its label
    filterRecipes();
  });
  expect(await shownRecipes(page)).toEqual(['Oven Batch Chicken']);
});

// ── Home suggestions ────────────────────────────────────────────────────────

test('Home suggests easiest / use-soon / something-different from existing data', async ({ page }) => {
  await loadLocalApp(page);
  await seed(page);

  const result = await page.evaluate(() => {
    // Pantry dates are plain YYYY-MM-DD (daysLeftFrom appends its own time part).
    const day = (daysAgo) => new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10);
    const iso = (daysAgo) => new Date(Date.now() - daysAgo * 864e5).toISOString();

    // Pantry: enough overlap for getCookableRecipes(), with broccoli about to expire.
    AppState.pantry = [
      { id: 'p1', name: 'Rice', category: 'Grain', purchaseDate: day(1), shelfLifeDays: 200 },
      { id: 'p2', name: 'Broccoli', category: 'Vegetable', dateMode: 'expiry', expiryDate: day(-1) },
      { id: 'p3', name: 'Pork', category: 'Protein', purchaseDate: day(0), shelfLifeDays: 30 },
      { id: 'p4', name: 'Soy Sauce', category: 'Pantry', purchaseDate: day(30), shelfLifeDays: 400 },
      { id: 'p5', name: 'Kangkong', category: 'Vegetable', purchaseDate: day(0), shelfLifeDays: 20 },
      { id: 'p6', name: 'Roast Chicken', category: 'Protein', purchaseDate: day(0), shelfLifeDays: 30 }
    ];
    // Cooked the shortcut yesterday, so it should not be "something different".
    AppState.cookHistory = [
      { recipeId: 'r-hack', recipeName: 'Lechon Manok Hack', date: iso(1), servings: 6 }
    ];

    showTab('home');
    renderDashboard();

    const suggestions = getCookSuggestions();
    return {
      keys: suggestions.map((s) => s.key),
      names: suggestions.map((s) => s.recipe.name),
      whys: suggestions.map((s) => s.why),
      cardRows: document.querySelectorAll('.dash-card--suggest .dash-sugg-row').length,
      cardHeader: (document.querySelector('.dash-card--suggest .dash-level-header') || {}).textContent
    };
  });

  // Up to three, each a different recipe, each with a real reason.
  expect(result.keys.length).toBeGreaterThan(0);
  expect(result.keys.length).toBeLessThanOrEqual(3);
  expect(new Set(result.names).size).toBe(result.names.length);
  expect(result.keys).toContain('easiest');
  expect(result.keys).toContain('use-soon');
  // Broccoli expires tomorrow -> the steamed-veg recipe is the use-soon pick.
  expect(result.names[result.keys.indexOf('use-soon')]).toBe('Rice + Steamed Veg');
  expect(result.whys[result.keys.indexOf('use-soon')]).toContain('Broccoli');
  expect(result.cardRows).toBe(result.keys.length);
  expect(result.cardHeader).toContain('What should I cook?');
});

test('a category with nothing behind it is omitted rather than invented', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate(() => {
    // No recipes at all -> no suggestions whatsoever.
    AppState.recipes = [];
    AppState.pantry = [];
    AppState.cookHistory = [];
    const empty = getCookSuggestions();

    // Recipes, but nothing expiring and no cook history: only "easiest" is
    // supportable — there is nothing to use up and nothing to differ from.
    AppState.recipes = normalizeRecipes([{
      id: 'only', name: 'Only Recipe', baseIngredients: [], baseServings: 2, currentServings: 2,
      basePrepTime: 2, baseCookTime: 3, activeTime: 2, effort: 'very-low'
    }]);
    const noHistory = getCookSuggestions();

    // A single high-effort recipe: not even "easiest" is honest.
    AppState.recipes = normalizeRecipes([{
      id: 'hard', name: 'All Day Braise', baseIngredients: [], baseServings: 4, currentServings: 4,
      basePrepTime: 45, baseCookTime: 180, activeTime: 60, effort: 'normal'
    }]);
    const noEasy = getCookSuggestions();

    return {
      empty: empty.length,
      noHistoryKeys: noHistory.map((s) => s.key),
      noEasyKeys: noEasy.map((s) => s.key),
      // With no suggestions the card renders nothing at all, not an empty shell.
      cardHtml: renderCookSuggestionCard()
    };
  });

  expect(result.empty).toBe(0);
  expect(result.noHistoryKeys).toEqual(['easiest']);
  expect(result.noEasyKeys).toEqual([]);
  expect(result.cardHtml).toBe('');
});

test('recent cook history nudges variety without blocking anything', async ({ page }) => {
  await loadLocalApp(page);
  await seed(page);

  const result = await page.evaluate(() => {
    const iso = (daysAgo) => new Date(Date.now() - daysAgo * 864e5).toISOString();
    AppState.cookHistory = [
      { recipeId: 'r-hack', recipeName: 'Lechon Manok Hack', date: iso(1), servings: 6 },
      { recipeId: 'r-steam', recipeName: 'Rice + Steamed Veg', date: iso(4), servings: 2 },
      { recipeId: 'r-oven', recipeName: 'Oven Batch Chicken', date: iso(20), servings: 8 }
    ];

    return {
      penalties: {
        yesterday: varietyPenalty('r-hack'),
        thisWeek: varietyPenalty('r-steam'),
        longAgo: varietyPenalty('r-oven'),
        never: varietyPenalty('r-pot')
      },
      days: {
        hack: daysSinceCooked('r-hack'),
        never: daysSinceCooked('r-pot')
      },
      // Nothing is removed from the recipe list by cook history.
      stillListed: AppState.recipes.map((r) => r.id),
      visibleCards: document.querySelectorAll('#recipes-grid .recipe-card').length
    };
  });

  expect(result.penalties.yesterday).toBe(2);   // biggest penalty
  expect(result.penalties.thisWeek).toBe(1);
  expect(result.penalties.longAgo).toBe(-1);    // small boost
  expect(result.penalties.never).toBe(0);       // neutral, not "exciting"
  expect(result.days.hack).toBe(1);
  expect(result.days.never).toBeNull();
  // The user can still pick anything — variety only re-orders suggestions.
  expect(result.stillListed).toHaveLength(5);
  expect(result.visibleCards).toBe(5);
});

// ── Recipe editor ───────────────────────────────────────────────────────────

test('the recipe editor saves and reloads the new metadata', async ({ page }) => {
  await loadLocalApp(page);
  await page.evaluate(() => { AppState.recipes = []; showTab('recipes'); renderRecipes(); });

  await page.evaluate(() => openAddRecipeModal());
  await page.locator('#recipe-name').fill('Rice Cooker Beef Bowl');
  await page.locator('#recipe-category').selectOption('Main Dish');
  await page.locator('#prep-time').fill('8');
  await page.locator('#cook-time').fill('45');
  await page.locator('#servings').fill('4');
  await page.locator('#instructions').fill('Rinse rice, add beef, press cook.');

  // New metadata controls.
  await page.locator('#recipe-effort').selectOption('low');
  await page.locator('#recipe-active-time').fill('8');
  await page.locator('#balance-protein').check();
  await page.locator('#balance-carb').check();
  await page.locator('#recipe-equipment-chips input[value="rice-cooker"]').check();
  await page.locator('#recipe-equipment-chips input[value="rice-cooker-steamer"]').check();
  await page.locator('#recipe-tag-chips input[value="minimal-cleanup"]').check();

  // One ingredient is required by the existing form.
  const ing = page.locator('.ingredient-item').first();
  await ing.locator('input[type="text"]').fill('Ground Beef');
  await ing.locator('input[type="number"]').fill('500');
  await ing.locator('select').nth(0).selectOption('g');
  await ing.locator('select').nth(1).selectOption('Protein');

  await page.locator('#recipe-submit-btn').click();
  await page.waitForTimeout(600);

  const saved = await page.evaluate(() => {
    const r = AppState.recipes.find((x) => x.name === 'Rice Cooker Beef Bowl');
    return r && {
      equipment: r.equipment, effort: r.effort, activeTime: r.activeTime,
      mealBalance: r.mealBalance, tags: r.tags
    };
  });

  expect(saved).toBeTruthy();
  expect(saved.equipment).toEqual(['rice-cooker', 'rice-cooker-steamer']);
  expect(saved.effort).toBe('low');
  expect(saved.activeTime).toBe(8);
  expect(saved.mealBalance).toEqual({ protein: true, vegetables: false, carb: true });
  expect(saved.tags).toEqual(['minimal-cleanup']);

  // Reopening for edit must show exactly what was saved…
  const recipeId = await page.evaluate(() =>
    String(AppState.recipes.find((x) => x.name === 'Rice Cooker Beef Bowl').id));
  await page.evaluate((id) => openEditRecipeModal(id), recipeId);

  const reopened = await page.evaluate(() => ({
    effort: document.getElementById('recipe-effort').value,
    active: document.getElementById('recipe-active-time').value,
    protein: document.getElementById('balance-protein').checked,
    veg: document.getElementById('balance-vegetables').checked,
    carb: document.getElementById('balance-carb').checked,
    equipment: Array.prototype.slice
      .call(document.querySelectorAll('#recipe-equipment-chips input:checked')).map((i) => i.value),
    tags: Array.prototype.slice
      .call(document.querySelectorAll('#recipe-tag-chips input:checked')).map((i) => i.value)
  }));

  expect(reopened.effort).toBe('low');
  expect(reopened.active).toBe('8');
  expect(reopened.protein).toBe(true);
  expect(reopened.veg).toBe(false);
  expect(reopened.carb).toBe(true);
  expect(reopened.equipment).toEqual(['rice-cooker', 'rice-cooker-steamer']);
  expect(reopened.tags).toEqual(['minimal-cleanup']);

  // …and a brand-new recipe form must start blank, not inherit the last one.
  await page.evaluate(() => { closeRecipeModal(); openAddRecipeModal(); });
  const blank = await page.evaluate(() => ({
    effort: document.getElementById('recipe-effort').value,
    active: document.getElementById('recipe-active-time').value,
    checked: document.querySelectorAll('#recipe-equipment-chips input:checked').length +
      document.querySelectorAll('#recipe-tag-chips input:checked').length,
    protein: document.getElementById('balance-protein').checked
  }));
  expect(blank.effort).toBe('');
  expect(blank.active).toBe('');
  expect(blank.checked).toBe(0);
  expect(blank.protein).toBe(false);
});

// ── Cooking hacks ───────────────────────────────────────────────────────────

test('the low-effort cooking hacks exist and backfill onto an older install', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate(() => {
    const titles = (list) => list.map((h) => h.title);

    // Simulate a device seeded before these hacks existed: only the original six.
    AppState.customHacks = defaultCookingHacks.slice(0, 6).map((h) => Object.assign({}, h));
    const before = titles(AppState.customHacks);
    seedNewDefaultHacks();
    const after = titles(AppState.customHacks);

    // Running it again must not duplicate anything.
    seedNewDefaultHacks();
    const afterTwice = titles(AppState.customHacks);

    // A hack the user edited keeps their wording — backfill never overwrites.
    AppState.customHacks.find((h) => h.id === 7).description = 'My own words';
    seedNewDefaultHacks();
    const edited = AppState.customHacks.find((h) => h.id === 7).description;

    // A device that deleted every hack is left alone entirely.
    AppState.customHacks = [];
    seedNewDefaultHacks();
    const emptied = AppState.customHacks.length;

    return { before, after, afterTwice, edited, emptied, defaults: titles(defaultCookingHacks) };
  });

  // The backfill adds every default the device is missing, whatever the current
  // count is — asserted against defaultCookingHacks rather than a frozen number,
  // so adding a hack in a later wave doesn't break this test.
  expect(result.before).toHaveLength(6);
  expect(result.after).toHaveLength(result.defaults.length);
  expect(result.afterTwice).toHaveLength(result.defaults.length);
  expect(result.edited).toBe('My own words');
  expect(result.emptied).toBe(0);

  const joined = result.defaults.join(' | ');
  expect(joined).toContain('Two Lechon Manok Hack');
  expect(joined).toContain('Rice and Steamed Veg in One Pot');
  expect(joined).toContain('Oven Chicken, Three Sauces');
  expect(joined).toContain('Freeze the Protein, Cook Rice Fresh');
  expect(joined).toContain('Frozen Vegetables Skip the Chopping');
  expect(joined).toContain('Pressure-Cooker Batch Meat');
  expect(joined).toContain('Make Sauces Separately');
  // Boiling eggs in a batch was already covered before this wave.
  expect(joined).toContain('Egg Prep Strategy');
});

test('the hacks render on the Hacks tab', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate(() => {
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
  expect(result.titles).toContain('Pressure-Cooker Batch Meat');
  // Every default renders — count taken from the source of truth, not frozen.
  expect(result.titles.length).toBe(result.defaultCount);
});

// ── Existing flow ───────────────────────────────────────────────────────────

test('the Plan -> Shop -> Cook flow and grocery scaling are unchanged', async ({ page }) => {
  await loadLocalApp(page);
  await seed(page);

  // PLAN — the weekly-plan slot shape is untouched by this wave (still a bare id).
  const planned = await page.evaluate(() => {
    AppState.selectedMealSlot = { day: 'Monday', meal: 'dinner' };
    AppState.selectedPlannerDays = ['Monday'];
    selectRecipeForPlanning('r-oven');
    return {
      slot: AppState.weeklyPlan.Monday.dinner,
      slotIsBareId: typeof AppState.weeklyPlan.Monday.dinner === 'string',
      plannerCards: document.querySelectorAll('#meal-planner .meal-slot.has-recipe').length,
      plannedMeals: document.getElementById('planned-meals').textContent
    };
  });
  expect(planned.slot).toBe('r-oven');
  expect(planned.slotIsBareId).toBe(true);
  expect(planned.plannerCards).toBeGreaterThan(0);
  expect(planned.plannedMeals).toBe('1');

  // SHOP — unchanged scaling: 2000g chicken at the recipe's own 8 servings.
  const shop = await page.evaluate(() => {
    generateGroceryList();
    renderGroceryList();
    const chicken = AppState.groceryList.find((i) => i.name === 'Chicken');
    return { qty: chicken && chicken.quantity, source: chicken && chicken.sources[0] };
  });
  expect(shop.qty).toBeCloseTo(2000, 5);
  expect(shop.source).toContain('8 servings');

  // COOK — unchanged bookkeeping.
  await page.evaluate(() => markRecipeCooked('r-oven', null));
  await page.locator('.confirm-ok-btn').click();
  await page.waitForTimeout(400);
  if (await page.locator('.confirm-ok-btn').count()) {
    await page.locator('.confirm-ok-btn').click();
    await page.waitForTimeout(400);
  }

  const cooked = await page.evaluate(() => ({
    cookedMeals: AppState.cookedMeals.length,
    history: AppState.cookHistory.length,
    slot: AppState.weeklyPlan.Monday.dinner
  }));
  expect(cooked.cookedMeals).toBeGreaterThan(0);
  expect(cooked.history).toBeGreaterThan(0);
  expect(cooked.slot).toBe('r-oven');
});
