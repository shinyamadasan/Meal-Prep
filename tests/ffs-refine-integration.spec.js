// FFS-V1 refinement integration: TASK-087 tiers × TASK-088 check signals (Claude merge, 2026-11-26).
const { test, expect } = require('@playwright/test');
const { waitForAppReady } = require('./app-ready');

const aged = { purchaseDate: '2026-11-10', shelfLifeDays: 5 };
const lot = (id, name, fields = {}) => ({
  id, name, category: 'Vegetable', storage: 'fridge', quantity: 1, unit: 'pcs', staple: false, ...fields
});
const recipe = (id, name, lines) => ({
  id, name, category: 'Main Dish', baseServings: 2, currentServings: 2, basePrepTime: 5, baseCookTime: 10,
  effort: 'very-low', baseIngredients: lines.map(n => ({ name: n, baseQuantity: 1, unit: 'pcs' }))
});

test.beforeEach(async ({ page, baseURL }) => {
  await page.route('**/*', route => route.request().url().startsWith(baseURL + '/') ? route.continue() : route.abort());
  await page.clock.setFixedTime(new Date(2026, 10, 26, 12));
  await page.addInitScript(() => {
    ['mealPrepHelpSeen', 'mealPrepStartDone', 'pantryOnboardingDone'].forEach(k => localStorage.setItem(k, '1'));
  });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
});

async function seed(page, state) {
  await page.evaluate(state => {
    Object.assign(AppState, { pantry: [], cookedMeals: [], recipes: [], groceryList: [] }, state);
    showTab('dashboard');
    refreshFreshnessAlerts();
  }, state);
}

test('counter produce past an estimate is not a safety check; fridge produce is', async ({ page }) => {
  await seed(page, {
    pantry: [
      lot('onion', 'Onion', { storage: 'counter', ...aged }),
      lot('spinach', 'Spinach', aged),
      lot('carrot', 'Carrot'),
      lot('egg', 'Eggs', { category: 'Protein' })
    ],
    recipes: [
      recipe('r-onion', 'Onion carrot hash', ['Onion', 'Carrot', 'Eggs']),
      recipe('r-spin', 'Spinach carrot hash', ['Spinach', 'Carrot', 'Eggs'])
    ]
  });
  const result = await page.evaluate(() => ({
    check: collectAttentionItems().check.map(e => e.name),
    tiers: Object.fromEntries(getCookableRecipes().map(c => [c.recipe.id, c.tier + ':' + c.needsCheck.join(',')]))
  }));
  expect(result.check).toEqual(['Spinach']);
  expect(result.tiers).toEqual({ 'r-onion': 'ready:', 'r-spin': 'check:Spinach' });
  await expect(page.locator('.dash-cook-tier--check')).toContainText('check Spinach first');
  await expect(page.locator('.dash-cook-tier--ready')).toContainText('Onion carrot hash');
});

test('alternatives, swaps and checks combine into one tier per recipe', async ({ page }) => {
  await seed(page, {
    pantry: [
      lot('chard', 'Swiss chard', aged),
      lot('kale', 'Kale'),
      lot('jasmine', 'Jasmine Rice', { category: 'Grain', storage: 'counter' }),
      lot('egg', 'Eggs', { category: 'Protein' })
    ],
    recipes: [
      // The fresh alternative satisfies the line, so no check is needed.
      recipe('r-alt', 'Greens bowl', ['Swiss chard or kale', 'Eggs', 'Fresh cilantro, for garnish']),
      // Only the aged lot satisfies the line: check wins over swap.
      recipe('r-both', 'Chard rice', ['Swiss chard', 'Brown rice', 'Eggs']),
      recipe('r-swap', 'Egg rice', ['Brown rice', 'Eggs'])
    ]
  });
  const tiers = await page.evaluate(() => Object.fromEntries(getCookableRecipes().map(c =>
    [c.recipe.id, { tier: c.tier, check: c.needsCheck, swaps: c.swaps.map(s => s.use), optional: c.optionalMissing.length }])));
  expect(tiers['r-alt']).toEqual({ tier: 'ready', check: [], swaps: [], optional: 1 });
  expect(tiers['r-both']).toEqual({ tier: 'check', check: ['Swiss chard'], swaps: ['Jasmine Rice'], optional: 0 });
  expect(tiers['r-swap']).toEqual({ tier: 'swap', check: [], swaps: ['Jasmine Rice'], optional: 0 });

  await page.evaluate(() => { showTab('recipes'); renderCookSuggestions(); });
  await expect(page.locator('.cs-tier--check')).toContainText('Chard rice');
  await expect(page.locator('.cs-tier--swap')).toContainText('Egg rice');
  await expect(page.locator('.cs-tier--ready')).not.toContainText('Chard rice');
});
