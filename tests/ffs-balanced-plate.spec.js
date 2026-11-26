const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { waitForAppReady } = require('./app-ready');

const mealRecipe = {
  id: 'main', name: 'Chicken Adobo Leftovers', category: 'Main Dish', favorite: true,
  baseServings: 2, currentServings: 2, basePrepTime: 5, baseCookTime: 10,
  mealBalance: { protein: true }, baseIngredients: [], instructions: 'Warm and serve.'
};
const lot = (name, fields = {}) => ({
  id: name, name, category: 'Vegetable', storage: 'fridge', quantity: 1, unit: 'pcs', staple: false, ...fields
});
const rice = lot('Jasmine Rice', { category: 'Grain', storage: 'counter' });

test.beforeEach(async ({ page, baseURL }) => {
  await page.route('**/*', route => route.request().url().startsWith(baseURL + '/') ? route.continue() : route.abort());
  await page.clock.setFixedTime(new Date(2026, 10, 26, 12));
  await page.addInitScript(() => {
    ['mealPrepHelpSeen', 'mealPrepStartDone', 'pantryOnboardingDone'].forEach(key => localStorage.setItem(key, '1'));
  });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
});

async function seed(page, pantry, recipe = mealRecipe, sides = []) {
  return page.evaluate(({ pantry, recipe, sides }) => {
    Object.assign(AppState, {
      pantry, recipes: [recipe, ...sides],
      cookedMeals: [{
        id: 'batch', recipeId: recipe.id, name: recipe.name, cookedDate: '2026-11-25',
        storage: 'fridge', fridgeLife: 3, initialPortions: 2, portionsRemaining: 1
      }]
    });
    const before = structuredClone(AppState);
    renderDashboard();
    return before;
  }, { pantry, recipe, sides });
}

async function openDetails(page) {
  await page.getByRole('button', { name: `View ${mealRecipe.name} recipe details` }).click();
  return page.getByRole('dialog', { name: 'Recipe Details' });
}

async function expectSingleLine(hint) {
  expect(await hint.evaluate(el => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getClientRects().length === 1 && el.scrollWidth === el.clientWidth &&
      document.documentElement.scrollWidth <= window.innerWidth;
  })).toBe(true);
}

for (const [label, width, height] of [['desktop', 1366, 1000], ['390px', 390, 844]]) {
  test(`Ready to eat and recipe details share a single optional line at ${label}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const before = await seed(page, [lot('Broccoli'), lot('Spinach'), rice]);
    const suggestion = 'Optional: add a veg — Broccoli or Spinach';
    const ready = page.locator('.dash-card--ready');
    const readyHint = ready.getByText(suggestion, { exact: true });
    await expect(readyHint).toBeVisible();
    await expectSingleLine(readyHint);
    await expect(ready.getByRole('button', { name: 'Use 1' })).toBeEnabled();

    const evidence = path.join(__dirname, '..', 'feature-evidence', 'task-083');
    await ready.screenshot({ path: path.join(evidence, `ready-to-eat-${label}.png`), animations: 'disabled' });

    const modal = await openDetails(page);
    const modalHint = modal.getByText(suggestion, { exact: true });
    await expect(modalHint).toBeVisible();
    await expectSingleLine(modalHint);
    expect(await page.evaluate(() => structuredClone(AppState))).toEqual(before);

    // Frame the balance controls inside the scrollable details dialog on both viewports.
    await modalHint.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await modal.locator('.modal-content').screenshot({
      path: path.join(evidence, `recipe-details-${label}.png`), animations: 'disabled'
    });
  });
}

test('Ready to eat skips unavailable lots and checks, then falls back to an available carb', async ({ page }) => {
  const spinach = lot('Spinach', { purchaseDate: '2026-11-15', shelfLifeDays: 3 });
  await seed(page, [
    lot('Broccoli', { quantity: 0, staple: true }),
    lot('Kale', { stockLevel: 'empty' }),
    lot('Carrot', { staple: true, dateMode: 'expiry', expiryDate: '2026-11-25' }),
    lot('Apple', { dateMode: 'expiry', printedDateKind: 'best-before', expiryDate: '2026-11-25' }),
    spinach, rice
  ]);
  const ready = page.locator('.dash-card--ready');
  await expect(ready.getByText('Optional: add a carb — Jasmine Rice', { exact: true })).toBeVisible();
  const modal = await openDetails(page);
  await expect(modal.getByText('Optional: add a carb — Jasmine Rice', { exact: true })).toBeVisible();
  await modal.getByRole('button', { name: 'Close' }).last().click();

  await seed(page, [{ ...spinach, keptOn: '2026-11-26' }, rice]);
  await expect(ready.getByText('Optional: add a veg — Spinach', { exact: true })).toBeVisible();
});

test('only meals with declared missing parts receive a suggestion or a generic fallback', async ({ page }) => {
  const ready = page.locator('.dash-card--ready');
  await seed(page, []);
  await expect(ready.getByText('add veg + rice', { exact: true })).toBeVisible();
  const modal = await openDetails(page);
  await expect(modal.getByText(/^Optional: add/)).toHaveCount(0);
  await modal.getByRole('button', { name: 'Close' }).last().click();

  for (const fields of [
    { mealBalance: { protein: true, vegetables: true, carb: true } },
    { mealBalance: undefined },
    { mealBalance: { protein: false, vegetables: false, carb: false } },
    { category: 'Sauce & Side' },
    { category: 'Snack' }
  ]) {
    await seed(page, [lot('Broccoli'), rice], { ...mealRecipe, ...fields });
    await expect(ready.getByText(/Optional: add|add veg \+ rice/)).toHaveCount(0);
    await openDetails(page);
    await expect(modal.getByText(/^Optional: add/)).toHaveCount(0);
    await modal.getByRole('button', { name: 'Close' }).last().click();
  }
});

test('ranks stock by versatility, deduplicates matching names, and caps each part at two', async ({ page }) => {
  const broccoliRecipe = {
    ...mealRecipe, id: 'uses-broccoli', name: 'Broccoli Bowl', favorite: false, equipment: ['oven'],
    baseIngredients: [{ name: 'Broccoli', baseQuantity: 1, unit: 'pcs' }]
  };
  await seed(page, [lot('Apple'), lot('Spinach'), lot('Broccoli'), lot('Frozen Broccoli'), rice], mealRecipe, [broccoliRecipe]);
  await expect(page.locator('.dash-card--ready').getByText('Optional: add a veg — Broccoli or Apple', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => balancedPlateAdditions(AppState.recipes[0], AppState))).toEqual([
    { part: 'vegetables', options: ['Broccoli', 'Apple'] },
    { part: 'carb', options: ['Jasmine Rice'] }
  ]);
});

test('quick book recipes fill spare slots after stock, using ingredients available without a check', async ({ page }) => {
  const side = (name, ingredient, fields) => ({
    ...mealRecipe, id: name, name, category: 'Sauce & Side', favorite: false, mealBalance: { vegetables: true },
    baseIngredients: [{ name: ingredient, baseQuantity: 1, unit: 'pcs' }], ...fields
  });
  const slaw = side('Simple Slaw', 'Greek Yogurt or Tofu', { effort: 'very-low' });
  const sides = [
    side('Aged Greens', 'Spinach', { effort: 'very-low' }),
    side('Baked Greens', 'Broccoli', { effort: 'normal' }),
    side('Broccoli', 'Broccoli', { effort: 'assembly' }),
    side('Chopped Broccoli', 'Broccoli', { equipment: ['no-cook'] }),
    side('Missing Greens', 'Kale', { effort: 'assembly' }),
    slaw
  ];
  const ready = page.locator('.dash-card--ready');
  const uncheckedSpinach = lot('Spinach', { purchaseDate: '2026-11-15', shelfLifeDays: 3 });
  await seed(page, [lot('Broccoli'), uncheckedSpinach, rice], mealRecipe, sides);
  await expect(ready.getByText('Optional: add a veg — Broccoli', { exact: true })).toBeVisible();

  await seed(page, [lot('Broccoli'), lot('Tofu', { category: 'Protein' }), uncheckedSpinach, rice], mealRecipe, sides);
  await expect(ready.getByText('Optional: add a veg — Broccoli or Simple Slaw', { exact: true })).toBeVisible();

  const noCookSlaw = { ...slaw, effort: 'normal', equipment: ['no-cook'] };
  await seed(page, [lot('Tofu', { category: 'Protein' }), rice], mealRecipe, [noCookSlaw]);
  await expect(ready.getByText('Optional: add a veg — Simple Slaw', { exact: true })).toBeVisible();
});

test('a vegetable-only meal can get a named protein addition before a carb', async ({ page }) => {
  const ready = page.locator('.dash-card--ready');
  await seed(page, [rice, lot('Tofu', { category: 'Protein' })], { ...mealRecipe, mealBalance: { vegetables: true } });
  const suggestion = 'Optional: add a protein — Tofu';
  await expect(ready.getByText(suggestion, { exact: true })).toBeVisible();
  const modal = await openDetails(page);
  await expect(modal.getByText(suggestion, { exact: true })).toBeVisible();
});
