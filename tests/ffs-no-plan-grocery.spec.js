const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { waitForAppReady, waitForRestored } = require('./app-ready');

const lot = (name, fields = {}) => ({
  id: name, name, category: 'Fruit', storage: 'counter', quantity: 100, unit: 'g', staple: false, ...fields
});

const row = (name, fields = {}) => ({
  id: name, name, category: 'Pantry', checked: false, custom: true, ...fields
});

const recipe = (id, ingredient, equipment, effort) => ({
  id, name: 'Synthetic recipe ' + id, baseServings: 2, currentServings: 2, equipment, effort,
  baseIngredients: [{ name: ingredient, category: 'Protein', baseQuantity: 2, unit: 'pcs' }]
});

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

async function shop(page, state = {}) {
  await page.evaluate(fixture => {
    Object.assign(AppState, {
      recipes: [], pantry: [], groceryList: [], plannedBatches: [], ...fixture
    });
  }, state);
  await page.locator('.tab-btn[data-tab="grocery"]').click();
  return page.locator('#no-plan-grocery');
}

function role(card, label) {
  return card.getByRole('listitem').filter({ hasText: new RegExp('^' + label + ' ') });
}

test('Shop counts only distinct available stock and unchecked uncovered rows with an empty plan', async ({ page }) => {
  const card = await shop(page, {
    pantry: [
      lot('Eggs'), lot('Egg', { quantity: null }),
      lot('Chicken Breast', { quantity: 0 }),
      lot('Tofu', { stockLevel: 'empty' }),
      lot('Yogurt', { dateMode: 'expiry', expiryDate: '2026-11-24' }),
      lot('Banana'), lot('Apple'), lot('Blueberries')
    ],
    groceryList: [
      row('Eggs'), row('Chicken'), row('Tofu', { checked: true, userSet: true }),
      row('Brown Rice'), row('Brown Rice', { id: 'second-brown-rice' })
    ]
  });

  await expect(card).toHaveJSProperty('open', false, { timeout: 2000 });
  await card.locator('summary').click();
  const proteins = role(card, 'Proteins');
  await expect(proteins).toContainText('Proteins 2/4');
  await expect(proteins).toContainText('needs plant-based');
  await expect(proteins.getByRole('button', { name: /egg|chicken breast|tofu/i })).toHaveCount(0);
  await expect(role(card, 'Starches')).toContainText('Starches 1/3');
  await expect(role(card, 'Fruits')).toContainText('Fruits 3/3 ✓');
  await expect(role(card, 'Fruits').getByRole('button')).toHaveCount(0);
  await expect(card.getByText(/So Easy So Good/)).toBeVisible();
});

test('Shop puts rule-filling options ahead of versatile ingredients in short roles', async ({ page }) => {
  const methods = ['pan', 'oven', 'air-fryer'];
  const recipes = Array.from({ length: 5 }, (_, i) => recipe(String(i), 'Egg', [methods[i % methods.length]]));
  const card = await shop(page, {
    recipes, pantry: [lot('Chicken Breast'), lot('Pandesal')], groceryList: [row('Pasta')]
  });
  await card.locator('summary').click();

  const proteins = role(card, 'Proteins');
  await expect(proteins).toContainText('needs low-prep · needs plant-based');
  await expect(proteins.getByRole('button').first()).toHaveText('Canned Black Beans');
  const starches = role(card, 'Starches');
  await expect(starches).toContainText('Starches 2/3 · needs whole grain');
  await expect(starches.getByRole('button').first()).toHaveText('Whole-Grain Bread');
  const scores = await page.evaluate(() => ['Eggs', 'Quail Eggs'].map(name => ingredientVersatility(name)));
  expect(scores).toEqual([8, 0]);
});

test('Fill the gaps counts a frozen chicken thigh past its estimate and leaves it off the suggestions', async ({ page }) => {
  const card = await shop(page, {
    pantry: [
      lot('Chicken Thigh', { category: 'Protein', storage: 'freezer', purchaseDate: '2026-10-16', shelfLifeDays: 2 }),
      lot('Canned Black Beans', { category: 'Protein' })
    ],
    recipes: [recipe('thigh', 'Chicken Thigh', ['oven'])]
  });
  await card.locator('summary').click();
  const proteins = role(card, 'Proteins');
  await expect.soft(proteins).toContainText('Proteins 2/4');
  await expect(proteins.getByRole('button', { name: 'Chicken Thigh', exact: true })).toHaveCount(0);
});

test('Shop classifies stock aliases, grocery forms and dairy by their food role', async ({ page }) => {
  const card = await shop(page, {
    pantry: [
      lot('Tuna in water'), lot('Greek Yogurt'), lot('Cottage Cheese'), lot('Monggo'),
      lot('Frozen Broccoli'), lot('Roasted Chickpeas'), lot('Soy Sauce'), lot('Lemon Sparkling Water'), lot('Honey')
    ],
    groceryList: [row('Cheddar Cheese'), row('Milk (Gatas)'), row('Coconut Milk')]
  });
  await card.locator('summary').click();
  await expect(role(card, 'Proteins')).toContainText('Proteins 4/4 ✓ · ✓ low-prep · ✓ plant-based');
  await expect(role(card, 'Veggies')).toContainText('Veggies 1/4');
  await expect(role(card, 'Snacks')).toContainText('Snacks 2/3');
  await expect(role(card, 'Flavor enhancers')).toContainText('Flavor enhancers 2/3');
  await expect(role(card, 'Beverages')).toContainText('Beverages 2/1–2 ✓');
});

test('a chip adds one existing grocery row, refreshes the gap and retains the duplicate message', async ({ page }) => {
  const card = await shop(page, { pantry: [lot('Banana'), lot('Apple')] });
  const before = await page.evaluate(() => JSON.parse(JSON.stringify(AppState)));
  await card.locator('summary').click();
  const fruit = role(card, 'Fruits');
  await expect(fruit).toContainText('Fruits 2/3');
  expect(await fruit.getByRole('button').count()).toBeGreaterThanOrEqual(2);
  expect(await page.evaluate(() => JSON.parse(JSON.stringify(AppState)))).toEqual(before);

  const chip = fruit.getByRole('button', { name: 'Frozen Blueberries', exact: true });
  // Keep the original action to simulate a second click before the shopper sees the re-render.
  await chip.evaluate(button => { window.repeatedNoPlanClick = button.onclick; });
  await chip.click();
  await expect(card).toHaveJSProperty('open', true);
  await expect(fruit).toContainText('Fruits 3/3 ✓');
  await expect(fruit.getByRole('button')).toHaveCount(0);
  await expect(page.locator('#grocery-list .grocery-item')).toHaveCount(1);
  await page.evaluate(() => window.repeatedNoPlanClick());
  await expect(page.locator('.success-message')).toHaveText('Frozen Blueberries is already on your grocery list.');
  const after = await page.evaluate(() => JSON.parse(JSON.stringify(AppState)));
  expect(after.groceryList).toEqual([{
    id: expect.any(Number), name: 'Frozen Blueberries', quantity: null, unit: '',
    sources: [], category: 'Fruit', checked: false, custom: true
  }]);
  // The existing save path updates this local write result alongside the grocery list.
  expect(after).toEqual({ ...before, groceryList: after.groceryList, lastLocalSaveSucceeded: true });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForRestored(page, () => AppState.groceryList.some(item => item.name === 'Frozen Blueberries'));
  await page.locator('.tab-btn[data-tab="grocery"]').click();
  await expect(page.locator('#grocery-list .grocery-item')).toHaveCount(1);
  await expect(card).toHaveJSProperty('open', false);
});

test('chips use the Shop role category when there is no ingredient DB entry', async ({ page }) => {
  const card = await shop(page);
  await card.locator('summary').click();

  await role(card, 'Snacks').getByRole('button', { name: 'Pretzels', exact: true }).click();
  await role(card, 'Beverages').getByRole('button', { name: 'Milk (Gatas)', exact: true }).click();

  const groupFor = name => page.locator('#grocery-list .grocery-category')
    .filter({ has: page.getByRole('button', { name, exact: true }) });
  await expect(groupFor('Pretzels').getByRole('heading')).toHaveText(/^Pantry\b/);
  await expect(groupFor('Milk (Gatas)').getByRole('heading')).toHaveText(/^Dairy\b/);
});

test('a full starch role offers up to two whole grains and clears the rule when one is added', async ({ page }) => {
  const card = await shop(page, {
    pantry: [lot('Pandesal'), lot('White Rice')],
    groceryList: [row('Sweet Potato (Kamote)'), row('Pasta')]
  });
  await card.locator('summary').click();
  const starches = role(card, 'Starches');
  await expect(starches).toContainText('Starches 4/3 ✓ · needs whole grain');
  const chips = starches.getByRole('button');
  await expect(chips).toHaveText(['Whole-Grain Bread', 'Microwave Quinoa']);

  await chips.first().click();
  await expect(starches).toContainText('Starches 5/3 ✓ · ✓ whole grain');
  await expect(starches).not.toContainText('needs whole grain');
  await expect(chips).toHaveCount(0);
  await expect(page.locator('#grocery-list .grocery-category')
    .filter({ has: page.getByRole('button', { name: 'Whole-Grain Bread', exact: true }) })
    .getByRole('heading')).toHaveText(/^Grain\b/);
});

test('chips skip near-twins in stock or on the list while keeping distinct milk', async ({ page }) => {
  const card = await shop(page, {
    recipes: [recipe('cheese', 'Cottage Cheese', ['assembly'])],
    pantry: [lot('Cheddar Cheese'), lot('Evaporated Milk'), lot('Canned Black Beans')],
    groceryList: [row('Greek Yogurt'), row('Frozen Blueberries')]
  });
  await card.locator('summary').click();
  await expect(role(card, 'Proteins').getByRole('button', { name: /cheese|yogurt/i })).toHaveCount(0);
  await expect(role(card, 'Snacks').getByRole('button', { name: /cheese/i })).toHaveCount(0);
  await expect(role(card, 'Fruits').getByRole('button', { name: /berries/i })).toHaveCount(0);
  await expect(role(card, 'Beverages')).toContainText('Beverages 0/1–2');
  await expect(role(card, 'Beverages').getByRole('button', { name: 'Milk (Gatas)', exact: true })).toBeVisible();
});

test('chips de-duplicate near-twins and ignore checked rows when filtering swaps', async ({ page }) => {
  const card = await shop(page, {
    recipes: [
      recipe('blueberries', 'Frozen Blueberries', ['assembly']),
      recipe('yogurt', 'Greek Yogurt', ['assembly'])
    ],
    groceryList: [row('Vanilla Yogurt', { checked: true, userSet: true })]
  });
  await card.locator('summary').click();
  const fruit = role(card, 'Fruits');
  await expect(fruit.getByRole('button', { name: 'Frozen Blueberries', exact: true })).toBeVisible();
  await expect(fruit.getByRole('button', { name: 'Mixed Berries', exact: true })).toHaveCount(0);
  await expect(role(card, 'Proteins').getByRole('button', { name: 'Greek Yogurt', exact: true })).toBeVisible();
});

test('Different ideas advances four ranked suggestions, wraps, and resets on reload', async ({ page }) => {
  const card = await shop(page);
  const before = await page.evaluate(() => JSON.parse(JSON.stringify(AppState)));
  await expect(card).toHaveJSProperty('open', false);
  await card.locator('summary').click();
  const control = card.getByRole('button', { name: '↻ Different ideas', exact: true });
  const fruit = role(card, 'Fruits').getByRole('button');
  const first = ['Frozen Blueberries', 'Banana (Saging)', 'Apple', 'Mango (Mangga)'];
  const next = ['Pineapple (Pinya)', 'Papaya', 'Grapes', 'Orange'];

  await expect(fruit).toHaveText(first);
  await control.click();
  await expect(control).toBeFocused();
  await expect(fruit).toHaveText(next);
  await control.click();
  await expect(fruit).toHaveText(first);
  await control.click();
  await expect(fruit).toHaveText(next);
  expect(await page.evaluate(() => JSON.parse(JSON.stringify(AppState)))).toEqual(before);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
  await shop(page);
  await expect(card).toHaveJSProperty('open', false);
  await card.locator('summary').click();
  await expect(fruit).toHaveText(first);
});

test('plan-driven Shop keeps its scaled rows and hides the card on Price List', async ({ page }) => {
  const card = await shop(page, {
    recipes: [recipe('eggs', 'Eggs', ['stovetop']), recipe('shrimp', 'Shrimp', ['stovetop'])],
    plannedBatches: [{ id: 'eggs-batch', recipeId: 'eggs', servings: 6 }],
    weeklyPlan: { Monday: { dinner: 'shrimp', snacks: [] } }
  });
  const generated = await page.evaluate(() => {
    generateGroceryList();
    return structuredClone(AppState.groceryList).map(({ name, quantity, sources }) => ({ name, quantity, sources }));
  });
  expect(generated).toEqual([
    { name: 'Shrimp', quantity: 2, sources: ['Synthetic recipe shrimp (2 servings)'] },
    { name: 'Eggs', quantity: 6, sources: ['Synthetic recipe eggs (6 servings)'] }
  ]);
  await card.locator('summary').click();
  await expect(role(card, 'Proteins')).toContainText('Proteins 2/4');
  await page.getByRole('button', { name: 'Price List' }).click();
  await expect(card).toBeHidden();
  await page.getByRole('button', { name: 'Shop List' }).click();
  await expect(card).toBeVisible();
  await expect(role(card, 'Proteins')).toContainText('Proteins 2/4');
  await expect(page.locator('#grocery-list .grocery-item')).toHaveCount(2);
});

for (const width of [390, 1280]) {
  test(`Shop card wraps its chips and performs read-only renders at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 930 });
    const card = await shop(page, {
      pantry: [lot('Eggs'), lot('Chicken Breast'), lot('Greek Yogurt'), lot('Baby Carrots'),
        lot('Banana'), lot('Apple'), lot('Blueberries'), lot('Soy Sauce')],
      groceryList: [row('Pandesal'), row('Pasta'), row('White Rice'), row('Frozen Broccoli')]
    });
    const before = await page.evaluate(() => JSON.parse(JSON.stringify(AppState)));
    await expect(card.locator('summary')).toHaveText('No plan? Fill the gaps');
    await expect(card).toHaveJSProperty('open', false);
    await card.locator('summary').click();
    await expect(role(card, 'Proteins')).toContainText('Proteins 3/4 · ✓ low-prep · needs plant-based');
    await expect(role(card, 'Starches')).toContainText('Starches 3/3 ✓ · needs whole grain');
    await expect(card.getByRole('button', { name: '↻ Different ideas', exact: true })).toBeVisible();
    await expect(card.getByRole('listitem')).toHaveCount(7);
    for (const label of ['Proteins', 'Veggies', 'Starches', 'Snacks', 'Flavor enhancers', 'Beverages']) {
      const chips = await role(card, label).getByRole('button').count();
      expect(chips).toBeGreaterThanOrEqual(2);
      expect(chips).toBeLessThanOrEqual(4);
    }
    const overflow = await card.evaluate(el =>
      Math.max(el.scrollWidth - el.clientWidth, document.documentElement.scrollWidth - innerWidth));
    expect(overflow).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => JSON.parse(JSON.stringify(AppState)))).toEqual(before);
    const screenshotTasks = [
      ['CAPTURE_NO_PLAN_GROCERY', 'task-082'],
      ['CAPTURE_TASK_089', 'task-089']
    ];
    for (const [flag, task] of screenshotTasks) {
      if (process.env[flag] !== '1') continue;
      await page.screenshot({
        fullPage: true,
        path: path.join(__dirname, '..', 'feature-evidence', task, `fill-the-gaps-${width}.png`)
      });
    }
  });
}
