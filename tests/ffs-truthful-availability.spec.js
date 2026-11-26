const { test, expect } = require('@playwright/test');
const { waitForAppReady } = require('./app-ready');

const recipe = (id, name, ingredients) => ({
  id, name, category: 'Main Dish', baseServings: 2, currentServings: 2,
  basePrepTime: 5, baseCookTime: 10, instructions: 'Cook until tender.',
  baseIngredients: ingredients.map(name => ({ name, baseQuantity: 100, unit: 'g' }))
});

const lot = (name, fields = {}) => ({
  id: name, name, category: 'Vegetable', quantity: 100, unit: 'g', staple: false, ...fields
});

const printedDate = expiryDate => ({ dateMode: 'expiry', expiryDate });
const yesterday = printedDate('2026-11-24');
const today = printedDate('2026-11-25');
const inThreeDays = printedDate('2026-11-28');
const inFourDays = printedDate('2026-11-29');

test.beforeEach(async ({ page, baseURL }) => {
  await page.route('**/*', route => route.request().url().startsWith(baseURL + '/')
    ? route.continue() : route.abort());
  await page.clock.setFixedTime(new Date(2026, 10, 25, 12));
  await page.addInitScript(() => {
    ['mealPrepHelpSeen', 'mealPrepStartDone', 'pantryOnboardingDone']
      .forEach(key => localStorage.setItem(key, '1'));
  });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
});

test('ingredient names match exact names, whole words with the same head noun, and direct DB aliases', async ({ page }) => {
  const cases = [
    ['Rice', 'Rice Vinegar', false],
    ['Rice', 'Rice Noodles', false],
    ['Egg', 'Eggplant', false],
    ['Corn', 'Cornstarch', false],
    ['Garlic', 'Garlic Powder', false],
    ['Garlic powder', 'Garlic cloves, minced', false],
    ['Rice vinegar', 'Steamed rice, for serving', false],
    ['Black Pepper', 'Bell Pepper', false],
    ['Chicken Thigh', 'Chicken Leg', false],
    ['', '', false],
    ['Jasmine Rice', 'Rice', true],
    ['Eggs', 'Egg', true],
    ['Red Onion', 'Onion', true],
    ['Chicken', 'Chicken Breast', true],
    ['  Fresh Carrots  ', 'Carrot', true],
    ['Brown Jasmine Rice', 'Brown Rice', true],
    ['Garlic cloves, minced', 'Garlic', true],
    ['Boneless, skinless chicken thighs', 'Chicken Thigh', true],
    ['Albacore tuna packed in water (5-oz cans), drained', 'Tuna', true],
    ['Red bell pepper, thinly sliced', 'Bell Pepper', true],
    ['Fresh ginger, peeled and grated', 'Ginger', true],
    ['Canned black beans, drained and rinsed', 'Black Beans', true],
    ['Dried red lentils, rinsed', 'Red Lentils', true],
    ['Tomatoes', 'Cherry tomatoes, halved', true],
    ['Reduced-sodium soy sauce', 'Soy Sauce', true],
    ['Red (sweet, mild) onion', 'Red Onion', true],
    ['Basil leaves', 'Basil', true],
    ['Cloves', 'Clove', true]
  ];
  const matches = await page.evaluate(pairs => pairs.map(([a, b]) =>
    [ingredientNamesMatch(a, b), ingredientNamesMatch(b, a)]), cases);
  expect(matches).toEqual(cases.map(([, , expected]) => [expected, expected]));
});

test('availability handles empty, depleted, expired, untracked and staple lots', async ({ page }) => {
  const cases = [
    [lot('Carrot', { quantity: 0 }), false],
    [lot('Carrot', { quantity: -5 }), false],
    [lot('Carrot', { stockLevel: 'empty' }), false],
    [lot('Carrot', yesterday), false],
    [lot('Carrot', { ...today, quantity: null }), true],
    [lot('Carrot', inThreeDays), true],
    [lot('Carrot', printedDate('')), true],
    [lot('Carrot', printedDate('2026-02-31')), true],
    [lot('Carrot', { quantity: null }), true],
    [lot('Soy Sauce', { ...yesterday, quantity: 0, staple: true, stockLevel: 'low' }), true],
    [lot('Soy Sauce', { staple: true, stockLevel: 'empty' }), false]
  ];
  const available = await page.evaluate(lots => lots.map(pantryLotAvailable), cases.map(([p]) => p));
  expect(available).toEqual(cases.map(([, expected]) => expected));
});

test('Home and Cook put a recipe using a 40-day-old frozen chicken thigh in the ready tier', async ({ page }) => {
  const pantry = [
    lot('Chicken Thigh', { category: 'Protein', storage: 'freezer', purchaseDate: '2026-10-16', shelfLifeDays: 2 }),
    lot('Carrot')
  ];
  const recipes = [recipe('chicken', 'Chicken thigh and carrot', ['Chicken Thigh', 'Carrot'])];
  await page.evaluate(state => {
    Object.assign(AppState, state);
    showTab('dashboard');
    renderCookSuggestions();
  }, { pantry, recipes });

  await expect(page.locator('.dash-cook-tier--ready .dash-cook-name')).toHaveText('Chicken thigh and carrot');
  await expect(page.locator('.cs-tier--ready .cs-name')).toHaveText('Chicken thigh and carrot');
});

test('Shop counts 30-day-old canned tuna as in stock', async ({ page }) => {
  const pantry = [
    lot('Canned tuna', { category: 'Protein', storage: 'counter', purchaseDate: '2026-10-26' })
  ];
  const groceryList = [{ id: 1, name: 'Canned tuna', category: 'Protein', checked: false }];
  await page.evaluate(state => Object.assign(AppState, state), { pantry, groceryList });
  await page.locator('.tab-btn[data-tab="grocery"]').click();

  const tuna = page.locator('#grocery-list .grocery-item').filter({ hasText: 'Canned tuna' });
  await expect(tuna).toHaveAttribute('aria-pressed', 'true');
  await expect(tuna.locator('.pantry-badge')).toBeVisible();
});

test('Spinach past its estimate stays in stock and keeps its safety warnings on read-only renders', async ({ page }) => {
  const pantry = [
    lot('Spinach', { storage: 'fridge', purchaseDate: '2026-11-15', shelfLifeDays: 5 })
  ];
  const groceryList = [{ id: 1, name: 'Spinach', category: 'Vegetable', checked: false }];
  const before = await page.evaluate(state => {
    Object.assign(AppState, state);
    const snapshot = structuredClone(AppState);
    showTab('dashboard');
    return snapshot;
  }, { pantry, groceryList });
  await page.locator('#dash-attention .dash-attn-review-btn').click();
  const attention = page.locator('#dash-attention .dash-attn-row--check').filter({ hasText: 'Spinach' });
  await expect(attention).toContainText('Estimated window passed — check it');

  await page.locator('.tab-btn[data-tab="grocery"]').click();
  const spinach = page.locator('#grocery-list .grocery-item').filter({ hasText: 'Spinach' });
  await expect.soft(spinach).toHaveAttribute('aria-pressed', 'true');

  await page.locator('.tab-btn[data-tab="fridge"]').click();
  const fridgeRow = page.locator('#pantry-list .pi-row').filter({ hasText: 'Spinach' });
  await expect(fridgeRow.locator('.pantry-fresh-badge')).toHaveText('Estimated window passed — check it');
  await expect(fridgeRow.locator('.pi-date')).toHaveAttribute('title', /^Estimated: bought .* \+ 5-day shelf life$/);
  const health = page.locator('#stock-health');
  await health.locator('summary').click();
  await expect(health.getByText('1 safety estimate', { exact: true })).toBeVisible();
  await expect(health.locator('.stock-health-group li').filter({ has: page.getByText('Spinach', { exact: true }) }))
    .toContainText('Past typical safe window');
  expect(await page.evaluate(() => structuredClone(AppState))).toEqual(before);
});

test('Shop auto-ticks available matching lots and honors manual check states', async ({ page }) => {
  const pantry = [
    lot('Zucchini', { quantity: 0 }),
    lot('Cabbage', yesterday),
    lot('Celery', { stockLevel: 'empty' }),
    lot('Rice'),
    lot('Radish', yesterday),
    lot('Ginger')
  ];
  const cases = [
    { name: 'Zucchini', inStock: false, ticked: false },
    { name: 'Cabbage', inStock: false, ticked: false },
    { name: 'Celery', inStock: false, ticked: false },
    { name: 'Rice Vinegar', inStock: false, ticked: false },
    { name: 'Rice', inStock: true, ticked: true },
    { name: 'Radish', userSet: true, checked: true, inStock: false, ticked: true },
    { name: 'Ginger', userSet: true, checked: false, inStock: false, ticked: false }
  ];
  const groceryList = cases.map(({ name, checked = false, userSet = false }, id) =>
    ({ id, name, checked, userSet, category: 'Vegetable' }));
  await page.evaluate(state => Object.assign(AppState, state), { pantry, groceryList });
  await page.locator('.tab-btn[data-tab="grocery"]').click();

  const rows = await page.locator('#grocery-list .grocery-item').evaluateAll(items =>
    Object.fromEntries(items.map(row => [row.getAttribute('aria-label'), {
      ticked: row.getAttribute('aria-pressed') === 'true',
      inStock: Boolean(row.querySelector('.pantry-badge'))
    }])));
  expect(rows).toEqual(Object.fromEntries(cases.map(({ name, inStock, ticked }) =>
    [name, { inStock, ticked }])));
});

test('use-soon recipe suggestions require available lots due today through three days out', async ({ page }) => {
  const pantry = [
    lot('Chicken Breast', yesterday),
    lot('Rice', today),
    lot('Red Onion', inThreeDays),
    lot('Carrot', inFourDays),
    lot('Cabbage', { ...today, quantity: 0 }),
    lot('Celery', { ...today, stockLevel: 'empty' })
  ];
  const recipes = [
    recipe('chicken', 'Chicken soup', ['Chicken Breast', 'Carrot']),
    recipe('rice', 'Steamed rice', ['Jasmine Rice']),
    recipe('onion', 'Roasted onions', ['Onion']),
    recipe('carrot', 'Carrot salad', ['Carrot']),
    recipe('cabbage', 'Cabbage rolls', ['Cabbage']),
    recipe('celery', 'Celery sticks', ['Celery']),
    recipe('vinegar', 'Vinegar dressing', ['Rice Vinegar'])
  ];
  const suggestions = await page.evaluate(state => {
    Object.assign(AppState, state);
    return getExpirySuggestions().map(({ recipe, ingredient }) => [recipe.id, ingredient]);
  }, { pantry, recipes });
  expect(suggestions).toEqual([['rice', 'Jasmine Rice'], ['onion', 'Onion']]);
});

test('Home and Cook tiers leave eggplant and expired chicken missing when only eggs and carrot are available', async ({ page }) => {
  const pantry = [lot('Eggs'), lot('Carrot'), lot('Chicken Breast', yesterday)];
  const recipes = [
    recipe('eggplant', 'Eggplant and carrot', ['Eggplant', 'Carrot']),
    recipe('chicken', 'Chicken and carrot', ['Chicken Breast', 'Carrot']),
    recipe('eggs', 'Eggs and carrot', ['Egg', 'Carrot'])
  ];
  const tiers = await page.evaluate(state => {
    Object.assign(AppState, state);
    showTab('dashboard');
    renderCookSuggestions();
    const missing = () => getCookableRecipes().map(({ recipe, missingIngredients }) =>
      [recipe.id, missingIngredients]);
    const withEggs = missing();
    AppState.pantry[0].name = 'Egg';
    return { withEggs, withEgg: missing() };
  }, { pantry, recipes });
  const expected = [['eggs', []], ['eggplant', ['Eggplant']], ['chicken', ['Chicken Breast']]];
  expect(tiers).toEqual({ withEggs: expected, withEgg: expected });
  await expect(page.locator('.dash-cook-tier--ready .dash-cook-name')).toHaveText(['Eggs and carrot']);
  await expect(page.locator('.dash-cook-tier--one .dash-cook-name')).toHaveText(['Eggplant and carrot', 'Chicken and carrot']);
  await expect(page.locator('.cs-tier--ready .cs-name')).toHaveText(['Eggs and carrot']);
  await expect(page.locator('.cs-tier--one .cs-name')).toHaveText(['Eggplant and carrot', 'Chicken and carrot']);
});

test('Home Attention and Fridge display expired stock, and rendering Home, Shop and Fridge preserves records', async ({ page }) => {
  const initial = {
    pantry: [lot('Chicken Breast', yesterday), lot('Carrot', { ...today, quantity: 0 }), lot('Onion')],
    groceryList: [{ id: 'onion', name: 'Onion', category: 'Vegetable', checked: false }],
    cookedMeals: [{ id: 'meal', name: 'Synthetic soup', cookedDate: '2026-11-24',
      storage: 'fridge', fridgeLife: 4, portionsRemaining: 2 }],
    recipes: [recipe('soup', 'Synthetic soup', ['Chicken Breast', 'Onion'])]
  };
  const result = await page.evaluate(state => {
    Object.assign(AppState, state);
    const snapshot = () => structuredClone({
      pantry: AppState.pantry, groceryList: AppState.groceryList, cookedMeals: AppState.cookedMeals
    });
    const before = snapshot();
    showTab('dashboard');
    const attention = document.querySelector('#dash-attention .dash-attn-row--expired').textContent;
    showTab('grocery');
    showTab('fridge');
    return { before, after: snapshot(), attention };
  }, initial);
  expect(result.attention).toContain('Chicken Breast');
  await expect(page.locator('#pantry-list').getByText('Chicken Breast', { exact: true })).toBeVisible();
  expect(result.after).toEqual(result.before);
});
