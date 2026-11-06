const { test, expect } = require('@playwright/test');
const { waitForAppReady, waitForRestored } = require('./app-ready');

const makeRecipe = (id, name, extra = {}) => ({ id, name, category: 'Main Dish',
  baseServings: 2, currentServings: 2, basePrepTime: 5, baseCookTime: 15,
  fridgeLife: 3, freezerLife: 30, instructions: 'Cook until tender.',
  baseIngredients: [{ name: 'Carrot', baseQuantity: 200, unit: 'g', category: 'Vegetable' }],
  equipment: [], ...extra });
const RECIPES = [
  makeRecipe('air', 'Air Fryer Carrots', { favorite: true, equipment: ['air-fryer'] }),
  makeRecipe('rice', 'Ginger Rice Bowls', { favorite: true, equipment: ['rice-cooker'] }),
  makeRecipe('oven', 'Roasted Vegetables', { favorite: true, equipment: ['oven'] }),
  makeRecipe('plain', 'Everyday Salad', { favorite: false, equipment: ['no-cook'] }),
  makeRecipe('truthy', 'Legacy truthy flag', { favorite: 'true' })
];

async function loadApp(page, recipes = RECIPES) {
  await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:47813/')
    ? route.continue() : route.abort());
  await page.addInitScript(() => {
    if (sessionStorage.getItem('task079Boot')) return;
    sessionStorage.setItem('task079Boot', '1'); localStorage.clear();
    ['mealPrepHelpSeen', 'mealPrepStartDone', 'pantryOnboardingDone'].forEach(k => localStorage.setItem(k, '1'));
  });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
  await page.evaluate(recipes => {
    Object.assign(AppState, { recipes: normalizeRecipes(recipes), pantry: [], cookedMeals: [], groceryList: [],
      plannedBatches: [], flavors: [], preparedFlavors: [], cookHistory: [], prepModeSession: null });
    Object.values(AppState.weeklyPlan).forEach(day => Object.assign(day, { breakfast: null, lunch: null, dinner: null, snacks: [] }));
    recipeQuickFilter = ''; renderRecipes(); saveData(); showTab('dashboard');
  }, recipes);
}

const favoriteCard = (page, name) => page.locator('#home-favorites .home-favorite-card').filter({ hasText: name });
const airChip = page => page.locator('#recipe-quick-filters .rq-chip').filter({ hasText: 'Air Fryer' });

for (const width of [1280, 390]) {
  test(`Home shows every strict favorite with usable mobile cards at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await loadApp(page);
    await expect(page.getByRole('heading', { name: '❤️ My Favorites' })).toBeVisible();
    await expect(page.locator('#home-favorites .home-favorite-card')).toHaveCount(3);
    await expect(favoriteCard(page, 'Air Fryer Carrots').getByRole('button', { name: 'Add to Plan', exact: true })).toBeVisible();
    await expect(page.locator('#home-favorites')).not.toContainText('Legacy truthy flag');
    const bounds = await page.locator('#home-favorites .home-favorite-card').evaluateAll(els => els.map(el => ({ left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right })));
    expect(bounds.every(b => b.left >= 0 && b.right <= width)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 390) expect(new Set(bounds.map(b => Math.round(b.left))).size).toBe(1);
    await page.screenshot({ path: `feature-evidence/task-079/home-${width}.png`, fullPage: true, animations: 'disabled' });
  });

  test(`Air Fryer chip filters explicit tags without relabeling ovens at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await loadApp(page);
    await page.evaluate(() => showTab('recipes'));
    await expect(airChip(page)).toBeVisible();
    await airChip(page).click();
    await expect(page.locator('#recipes-grid .recipe-title')).toHaveText(['Air Fryer Carrots']);
    expect(await page.evaluate(() => AppState.recipes.find(r => r.id === 'oven').equipment)).toEqual(['oven']);
    await page.screenshot({ path: `feature-evidence/task-079/air-fryer-${width}.png`, fullPage: true, animations: 'disabled' });
    await airChip(page).click();
    await expect(page.locator('#recipes-grid .recipe-card')).toHaveCount(5);
  });
}

test('Home empty state remains visible when there are no favorites', async ({ page }) => {
  await loadApp(page, [makeRecipe('plain', 'Everyday Salad')]);
  await expect(page.getByRole('heading', { name: '❤️ My Favorites' })).toBeVisible();
  await expect(page.locator('#home-favorites')).toContainText('Tap the heart');
  await expect(page.locator('#home-favorites .home-favorite-card')).toHaveCount(0);
});

test('Home includes all favorites independently of recipe-list search and method filters', async ({ page }) => {
  const recipes = Array.from({ length: 17 }, (_, i) => makeRecipe('fav' + i, 'Favorite ' + i, { favorite: true }));
  await loadApp(page, recipes);
  await page.evaluate(() => { document.getElementById('recipe-search').value = 'no-match'; setRecipeQuickFilter('oven'); });
  await expect(page.locator('#home-favorites .home-favorite-card')).toHaveCount(17);
});

test('Home opens existing read-only recipe details without changing saved data', async ({ page }) => {
  await loadApp(page);
  const before = await page.evaluate(() => localStorage.getItem(STORAGE_KEY));
  await favoriteCard(page, 'Air Fryer Carrots').getByRole('button', { name: 'View Air Fryer Carrots recipe details' }).click();
  await expect(page.locator('#recipe-modal')).not.toHaveClass(/hidden/);
  await expect(page.locator('#recipe-form')).toHaveClass(/readonly/);
  await expect(page.locator('#recipe-name')).toHaveValue('Air Fryer Carrots');
  await expect(page.locator('#recipe-submit-btn')).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem(STORAGE_KEY))).toBe(before);
});

test('Home reuses Add to Plan, avoids duplicate batches and persists through reload', async ({ page }) => {
  await loadApp(page);
  const inventory = await page.evaluate(() => JSON.stringify({ pantry: AppState.pantry, cooked: AppState.cookedMeals }));
  await favoriteCard(page, 'Air Fryer Carrots').getByRole('button', { name: 'Add to Plan', exact: true }).click();
  await expect.poll(() => page.evaluate(() => AppState.plannedBatches.length)).toBe(1);
  await expect(favoriteCard(page, 'Air Fryer Carrots').getByRole('button', { name: 'Added to Plan' })).toBeDisabled();
  expect(await page.evaluate(() => AppState.plannedBatches[0].recipeId)).toBe('air');
  expect(await page.evaluate(() => JSON.stringify({ pantry: AppState.pantry, cooked: AppState.cookedMeals }))).toBe(inventory);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForRestored(page, () => AppState.plannedBatches.some(b => b.recipeId === 'air'));
  await expect(favoriteCard(page, 'Air Fryer Carrots').getByRole('button', { name: 'Added to Plan' })).toBeDisabled();
  expect(await page.evaluate(() => AppState.plannedBatches.length)).toBe(1);
});

test('Home removal updates existing favorite state and survives reload', async ({ page }) => {
  await loadApp(page);
  await favoriteCard(page, 'Air Fryer Carrots').getByRole('button', { name: 'Remove Air Fryer Carrots from favorites' }).click();
  await expect(favoriteCard(page, 'Air Fryer Carrots')).toHaveCount(0);
  expect(await page.evaluate(() => AppState.recipes.find(r => r.id === 'air').favorite)).toBe(false);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForRestored(page, () => AppState.recipes.some(r => r.id === 'air' && r.favorite === false));
  await expect(page.locator('#home-favorites .home-favorite-card')).toHaveCount(2);
});

test('favoriting in Recipes and picker refreshes Home immediately', async ({ page }) => {
  await loadApp(page, [makeRecipe('plain', 'Everyday Salad')]);
  await page.evaluate(() => showTab('recipes'));
  await page.locator('#recipes-grid .recipe-fav-btn').click();
  await expect(page.locator('#home-favorites .home-favorite-card')).toHaveCount(1);
  await page.evaluate(() => { showTab('planner'); openBatchPickerModal(); });
  await page.locator('#batch-picker-results .recipe-fav-btn').click();
  await expect(page.locator('#home-favorites .home-favorite-card')).toHaveCount(0);
});

test('new Home recipe text and handler arguments stay inert', async ({ page }) => {
  const id = 'fav\'\"&quot;\n\\';
  const name = '<img src="/synthetic-missing" onerror="window.__favoriteXss=true">';
  await loadApp(page, [makeRecipe(id, name, { category: name, favorite: true })]);
  await expect(page.locator('#home-favorites img')).toHaveCount(0);
  await expect(page.locator('#home-favorites')).toContainText(name);
  await page.locator('#home-favorites').getByRole('button', { name: 'Add to Plan', exact: true }).click();
  expect(await page.evaluate(() => AppState.plannedBatches[0].recipeId)).toBe(id);
  await page.locator('#home-favorites .home-favorite-name').click();
  await expect(page.locator('#recipe-name')).toHaveValue(name);
  await page.evaluate(() => closeRecipeModal());
  await page.locator('#home-favorites .recipe-fav-btn').click();
  await expect(page.locator('#home-favorites .home-favorite-card')).toHaveCount(0);
  expect(await page.evaluate(() => !!window.__favoriteXss)).toBe(false);
});

test('Air Fryer normalization preserves multi-equipment tags and legacy defaults', async ({ page }) => {
  await loadApp(page);
  const values = await page.evaluate(() => {
    const multi = normalizeRecipeMeta({ equipment: ['air-fryer', 'oven', 'air-fryer', 'unknown'] });
    const legacy = normalizeRecipeMeta({});
    return { multi: multi.equipment, legacy: legacy.equipment };
  });
  expect(values).toEqual({ multi: ['air-fryer', 'oven'], legacy: [] });
});

test('Air Fryer remains discoverable with zero matches and combines with existing filters', async ({ page }) => {
  await loadApp(page, [makeRecipe('oven', 'Oven Only', { equipment: ['oven'] })]);
  await page.evaluate(() => showTab('recipes'));
  await expect(airChip(page)).toBeVisible();
  await airChip(page).click();
  await expect(page.locator('#recipes-grid')).toContainText('No air fryer recipes yet');
  await expect(page.locator('#recipes-grid')).toContainText('Cooking method');
  await page.evaluate(() => { AppState.recipes.push(normalizeRecipeMeta({ ...AppState.recipes[0], id: 'both', name: 'Both appliances', equipment: ['oven', 'air-fryer'], favorite: true })); renderRecipes(); });
  await expect(page.locator('#recipes-grid .recipe-title')).toHaveText(['Both appliances']);
  await page.locator('#recipe-search').fill('no-match');
  await expect(page.locator('#recipes-grid .recipe-card')).toHaveCount(0);
});

test('Air Fryer can be selected on create, retained on edit and persisted through reload', async ({ page }) => {
  await loadApp(page);
  await page.evaluate(() => openAddRecipeModal());
  const air = page.locator('#recipe-equipment-chips input[value="air-fryer"]');
  await expect(air).toBeVisible();
  await air.check();
  await page.locator('#recipe-name').fill('New air fryer dish');
  await page.locator('#recipe-category').selectOption('Main Dish');
  await page.locator('#prep-time').fill('5');
  await page.locator('#cook-time').fill('15');
  await page.locator('#servings').fill('2');
  await page.locator('#instructions').fill('Air fry until tender.');
  await page.locator('#ingredients-list input[type=text]').fill('Carrot');
  await page.locator('#ingredients-list input[type=number]').fill('200');
  await page.locator('#ingredients-list select').nth(0).selectOption('g');
  await page.locator('#ingredients-list select').nth(1).selectOption('Vegetable');
  await page.locator('#recipe-submit-btn').click();
  const id = await page.evaluate(() => AppState.recipes.find(r => r.name === 'New air fryer dish').id);
  await page.evaluate(id => openEditRecipeModal(id), id);
  await expect(air).toBeChecked();
  await page.locator('#recipe-name').fill('Edited air fryer dish');
  await page.locator('#recipe-equipment-chips input[value="oven"]').check();
  await page.locator('#recipe-submit-btn').click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForRestored(page, id => AppState.recipes.some(r => r.id === id && r.name === 'Edited air fryer dish'), id);
  expect(await page.evaluate(id => AppState.recipes.find(r => r.id === id).equipment, id)).toEqual(['oven', 'air-fryer']);
});

for (const version of ['1.1', '1.6']) {
  test(`JSON ${version} import and export preserve Air Fryer and favorite state`, async ({ page }) => {
    await loadApp(page, [makeRecipe('legacy', 'Legacy recipe')]);
    const data = { version, recipes: [makeRecipe('imported-air', 'Imported Air Fryer', { equipment: ['air-fryer', 'oven'], favorite: true })] };
    const chooser = page.waitForEvent('filechooser');
    await page.evaluate(() => importData());
    await (await chooser).setFiles({ name: 'synthetic-recipes.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
    await page.locator('.confirm-ok-btn').click();
    await expect.poll(() => page.evaluate(() => AppState.recipes.some(r => r.id === 'imported-air'))).toBe(true);
    await expect(favoriteCard(page, 'Imported Air Fryer')).toHaveCount(1);
    const download = page.waitForEvent('download');
    await page.evaluate(() => exportData());
    const file = await (await download).path();
    const exported = JSON.parse(require('fs').readFileSync(file, 'utf8'));
    expect(exported.version).toBe('1.6');
    expect(exported.recipes.find(r => r.id === 'imported-air')).toEqual(expect.objectContaining({ equipment: ['air-fryer', 'oven'], favorite: true }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForRestored(page, () => AppState.recipes.some(r => r.id === 'imported-air'));
    expect(await page.evaluate(() => AppState.recipes.find(r => r.id === 'imported-air').equipment)).toEqual(['air-fryer', 'oven']);
    expect(await page.evaluate(() => AppState.recipes.find(r => r.id === 'legacy').equipment)).toEqual([]);
  });
}


test('review numeric favorite ids reuse details, planning and removal', async ({ page }) => {
  await loadApp(page, [makeRecipe(7901, 'Numeric favorite', { favorite: true })]);
  await favoriteCard(page, 'Numeric favorite').getByRole('button', { name: 'View Numeric favorite recipe details' }).click();
  await expect(page.locator('#recipe-name')).toHaveValue('Numeric favorite');
  await page.locator('#recipe-modal .modal-close').click();
  await favoriteCard(page, 'Numeric favorite').getByRole('button', { name: 'Add to Plan', exact: true }).click();
  expect(await page.evaluate(() => AppState.plannedBatches[0].recipeId)).toBe('7901');
  await favoriteCard(page, 'Numeric favorite').getByRole('button', { name: 'Remove Numeric favorite from favorites' }).click();
  expect(await page.evaluate(() => AppState.recipes[0].favorite)).toBe(false);
});

test('review editing and deleting a favorite refreshes Home immediately', async ({ page }) => {
  await loadApp(page);
  await page.evaluate(() => openEditRecipeModal('air'));
  await page.locator('#recipe-name').fill('Renamed favorite');
  await page.locator('#recipe-submit-btn').click();
  await expect(favoriteCard(page, 'Renamed favorite')).toHaveCount(1);
  await expect(favoriteCard(page, 'Air Fryer Carrots')).toHaveCount(0);
  await page.evaluate(() => deleteRecipe('air'));
  await page.locator('.confirm-ok-btn').click();
  await expect(favoriteCard(page, 'Renamed favorite')).toHaveCount(0);
});

test('review Air Fryer respects favorites and category conjunction', async ({ page }) => {
  await loadApp(page, [
    makeRecipe('a', 'Favorite main air', { equipment: ['air-fryer'], favorite: true }),
    makeRecipe('b', 'Other main air', { equipment: ['air-fryer'], favorite: false }),
    makeRecipe('c', 'Favorite breakfast air', { equipment: ['air-fryer'], favorite: true, category: 'Breakfast' }),
    makeRecipe('d', 'Favorite main oven', { equipment: ['oven'], favorite: true })
  ]);
  await page.evaluate(() => showTab('recipes'));
  await airChip(page).click();
  await page.locator('.favorites-filter-label').click();
  await expect(page.locator('#recipes-grid .recipe-title')).toHaveText(['Favorite main air', 'Favorite breakfast air']);
  await page.locator('#category-filter').selectOption('Main Dish');
  await expect(page.locator('#recipes-grid .recipe-title')).toHaveText(['Favorite main air']);
});

test('review empty recipe library keeps existing hidden-method policy', async ({ page }) => {
  await loadApp(page, []);
  await page.evaluate(() => showTab('recipes'));
  await expect(page.locator('#recipe-quick-filters')).toHaveClass(/hidden/);
  await expect(airChip(page)).toHaveCount(0);
});

test('review pasted equipment metadata preserves explicit Air Fryer', async ({ page }) => {
  await loadApp(page);
  const equipment = await page.evaluate(() => parseRecipeText('Air fryer carrots\nEquipment: Air Fryer, Oven\nIngredients:\n200 g carrot\nInstructions:\nAir fry until tender.').equipment);
  expect(equipment).toEqual(['air-fryer', 'oven']);
});
