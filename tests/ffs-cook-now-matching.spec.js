const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { waitForAppReady } = require('./app-ready');

const recipe = (id, name, ingredients) => ({
  id, name, category: 'Main Dish', baseServings: 2, currentServings: 2,
  basePrepTime: 3, baseCookTime: 8, effortLevel: 'low', instructions: 'Cook until tender.',
  baseIngredients: ingredients.map(ing => ({
    baseQuantity: 100, unit: 'g', ...(typeof ing === 'string' ? { name: ing } : ing)
  }))
});
const lot = (name, fields = {}) => ({
  id: name, name, category: 'Pantry', quantity: 100, unit: 'g', staple: false, ...fields
});

const pantry = [
  lot('Carrot'), lot('Jasmine Rice'), lot('Sunflower Oil'), lot('Chicken Thigh'),
  lot('Chives'), lot('Paprika', { dateMode: 'expiry', expiryDate: '2026-11-25' })
];
const recipes = [
  recipe('ready', 'Golden Carrot Skillet', [
    'Carrot', 'Grapeseed or sunflower oil', 'Mushroom broth or water',
    'Mint, torn, for garnish', 'Lime, for squeezing', 'Sesame seeds (optional)',
    'Chives, for garnish', 'Cold water, plus more as needed'
  ]),
  recipe('swap', 'Carrot and Brown Rice', ['Carrot', 'Brown rice']),
  recipe('spice', 'Caraway Carrots', ['Carrot', 'Caraway']),
  recipe('expired', 'Paprika Carrots', ['Carrot', 'Paprika']),
  recipe('two', 'Leek and Fennel Rice', ['White rice', 'Leek', 'Fennel']),
  recipe('short', 'Quick Carrot', ['Carrot', 'Mint, for garnish', 'Water']),
  recipe('no-have', 'Rice and Tarragon', ['Brown rice', 'Tarragon'])
];

test.beforeEach(async ({ page, baseURL }) => {
  await page.route('**/*', route => route.request().url().startsWith(baseURL + '/')
    ? route.continue() : route.abort());
  await page.clock.setFixedTime(new Date(2026, 10, 26, 12));
  await page.addInitScript(() => {
    ['mealPrepHelpSeen', 'mealPrepStartDone', 'pantryOnboardingDone']
      .forEach(key => localStorage.setItem(key, '1'));
  });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
});

test('classifies serving, garnish, optional and water lines while keeping seasonings required', async ({ page }) => {
  const lines = [
    { name: 'Warm flatbread, for serving' },
    { name: 'Mint leaves, torn, for garnish' },
    { name: 'Lemon wedges to serve' },
    { name: 'Molasses for drizzling' },
    { name: 'Lime, for squeezing' },
    { name: 'Semolina, for coating' },
    { name: 'Crackers, for dipping' },
    { name: 'Chives, day of serving garnish' },
    { name: 'Toasted pepitas (optional)' },
    { name: 'Chives, optional' },
    { name: 'Lemon wedges to serve', optional: true },
    { name: 'Hot water, plus more as needed' },
    { name: 'Ice water' },
    { name: 'Water' },
    { name: 'Flaky salt' },
    { name: 'White pepper' },
    { name: 'Mushroom broth or water' },
    { name: 'Water or mushroom broth' }
  ];
  expect(await page.evaluate(lines => lines.map(ing => ingredientLineRole(ing)), lines)).toEqual([
    'serving', 'serving', 'serving', 'serving', 'serving', 'serving', 'serving', 'serving',
    'optional', 'optional', 'optional', 'water', 'water', 'water',
    'required', 'required', 'required', 'required'
  ]);
});

test('resolves shared nouns, comma lists and full-name alternatives before prep notes', async ({ page }) => {
  const cases = [
    ['Grapeseed or sunflower oil, divided', ['grapeseed oil', 'sunflower oil']],
    ['Vegetable or turkey stock', ['vegetable stock', 'turkey stock']],
    ['Boneless, skinless chicken tenders or thighs', ['chicken tenders', 'chicken thighs']],
    ['Firm or smoked tofu (drained)', ['firm tofu', 'smoked tofu']],
    ['Farfalle, fusilli, extra wide noodles, or cavatappi, cooked', ['farfalle', 'fusilli', 'extra wide noodles', 'cavatappi']],
    ['Skyr yogurt or fresh ricotta', ['skyr yogurt', 'fresh ricotta']],
    ['Mushroom broth or water', ['mushroom broth', 'water']],
    ['Water or mushroom broth', ['water', 'mushroom broth']],
    ['Mint, chopped or torn', ['Mint, chopped or torn']],
    ['Red cabbage, shredded', ['Red cabbage, shredded']]
  ];
  const alternatives = await page.evaluate(cases => cases.map(([name]) => ingredientAlternatives(name)), cases);
  expect(alternatives.map(names => names.slice().sort())).toEqual(
    cases.map(([, names]) => names.slice().sort())
  );
  const result = await page.evaluate(state => {
    Object.assign(AppState, state);
    return getCookableRecipes().map(({ tier, matched }) => ({ tier, matched }));
  }, {
    pantry,
    recipes: [recipe('alternatives', 'Chicken and Carrots', [
      'Carrot', 'Grapeseed or sunflower oil', 'Boneless, skinless chicken tenders or thighs'
    ])]
  });
  expect(result).toEqual([{ tier: 'ready', matched: 3 }]);
});

test('strips trailing quantity notes before splitting ingredient alternatives', async ({ page }) => {
  const cases = [
    ['Sriracha, or more to taste', ['sriracha']],
    ['Garlic powder, or more to taste', ['garlic powder']],
    ['Fresh lemon juice, or more to taste', ['lemon juice']],
    ['Paprika or more if needed', ['paprika']],
    ['Ground cumin or as needed', ['ground cumin']],
    ['Caraway, or more', ['caraway']],
    ['Cinnamon or to taste', ['cinnamon']],
    ['Chives, plus more for topping', ['chives']],
    ['Canola or avocado oil, or more if needed', ['canola oil', 'avocado oil']]
  ];
  const alternatives = await page.evaluate(cases => cases.map(([name]) => ingredientAlternatives(name)), cases);
  for (const [index, [name, expected]] of cases.entries()) {
    expect.soft(alternatives[index], name).toEqual(expected);
  }
});

test('stocked ingredients with quantity notes count as have in Cook Now', async ({ page }) => {
  const result = await page.evaluate(state => {
    Object.assign(AppState, state);
    return getCookableRecipes().map(({ tier, matched }) => ({ tier, matched }));
  }, {
    pantry: [lot('Carrot'), lot('Sriracha', { staple: true }), lot('Garlic powder'), lot('Lemon juice')],
    recipes: [recipe('quantity-notes', 'Pepper and Lemon Carrots', [
      'Carrot', 'Sriracha, or more to taste', 'Garlic powder, or more to taste', 'Fresh lemon juice, or more to taste'
    ])]
  });
  expect(result).toEqual([{ tier: 'ready', matched: 4 }]);
});

test('matches generic rice descriptors and direct aliases while protecting ingredient identity', async ({ page }) => {
  const cases = [
    ['White rice', 'Jasmine Rice', true],
    ['Steamed white rice', 'Jasmine Rice', true],
    ['Leftover cooked short-grain white rice', 'Jasmine Rice', true],
    ['Day-old plain medium-grain rice', 'Jasmine Rice', true],
    ['Plain rice (short-, medium-, or long-grain)', 'Jasmine Rice', true],
    ['short-, medium-, or long-grain rice', 'Jasmine Rice', true],
    ['Brown rice', 'Jasmine Rice', false],
    ['Wild rice', 'Jasmine Rice', false],
    ['Rice vinegar', 'Jasmine Rice', false],
    ['Rice Vinegar', 'Rice', false],
    ['Rice noodles', 'Jasmine Rice', false],
    ['Rice flour', 'Jasmine Rice', false],
    ['Evaporated milk', 'Milk', false],
    ['Coconut milk', 'Milk', false],
    ['Almond milk', 'Milk', false],
    ['Condensed milk', 'Milk', false],
    ['Powdered milk', 'Milk', false],
    ['Oat milk', 'Milk', false],
    ['Soy milk', 'Milk', false],
    ['Soy sauce', 'Sauce', false],
    ['Sour cream', 'Cream', false],
    ['Cream cheese', 'Cheese', false],
    ['Peanut butter', 'Butter', false],
    ['Sweetened cream', 'Cream', false],
    ['Evaporated milk', 'Evap', true],
    ['Reduced-sodium soy sauce', 'Soy Sauce', true]
  ];
  const matches = await page.evaluate(cases => cases.map(([a, b]) =>
    [ingredientNamesMatch(a, b), ingredientNamesMatch(b, a)]), cases);
  expect(matches).toEqual(cases.map(([, , expected]) => [expected, expected]));
});

test('matches toasted sesame oil with its alias and keeps sesame oil distinct from generic oil', async ({ page }) => {
  const cases = [
    ['Sesame Oil', 'toasted sesame oil', true],
    ['Oil', 'Sesame Oil', false]
  ];
  const matches = await page.evaluate(cases => cases.map(([a, b]) =>
    [ingredientNamesMatch(a, b), ingredientNamesMatch(b, a)]), cases);
  for (const [index, [a, b, expected]] of cases.entries()) {
    expect.soft(matches[index], `${a} / ${b}`).toEqual([expected, expected]);
  }
});

test('allows same-head variety swaps and rejects matches, different heads and identity modifiers', async ({ page }) => {
  const cases = [
    ['Brown rice', 'Jasmine Rice', true],
    ['Wild rice', 'Jasmine Rice', true],
    ['Cheddar cheese', 'Parmesan cheese', true],
    ['Red onion', 'White onion', true],
    ['Green bell pepper', 'Red Bell Pepper', true],
    ['Canola oil', 'Olive oil', true],
    ['Black pepper', 'Red Bell Pepper', false],
    ['Cayenne pepper', 'Red Bell Pepper', false],
    ['Garlic powder', 'Chili powder', false],
    ['Oyster sauce', 'Chili garlic sauce', false],
    ['Glutinous Rice (Malagkit)', 'Jasmine Rice', false],
    ['Malagkit rice', 'Jasmine Rice', false],
    ['Sticky rice', 'Jasmine Rice', false],
    ['Sushi rice', 'Jasmine Rice', false],
    ['Sesame Oil', 'Canola oil', false],
    ['Toasted walnut oil', 'Olive oil', false],
    ['Chili oil', 'Olive oil', false],
    ['Ground cumin', 'Smoked cumin', false],
    ['Red onion', 'Onion', false],
    ['Rice vinegar', 'Jasmine Rice', false],
    ['Evaporated milk', 'Milk', false],
    ['Coconut milk', 'Almond milk', false],
    ['Cream cheese', 'Parmesan cheese', false],
    ['Sweetened milk', 'Reduced fat milk', false]
  ];
  const swaps = await page.evaluate(cases => cases.map(([a, b]) =>
    [ingredientSwapMatch(a, b), ingredientSwapMatch(b, a)]), cases);
  for (const [index, [a, b, expected]] of cases.entries()) {
    expect.soft(swaps[index], `${a} / ${b}`).toEqual([expected, expected]);
  }
});

test('reports required availability, swaps and missing optional lines without counting expired stock', async ({ page }) => {
  const result = await page.evaluate(state => {
    Object.assign(AppState, state);
    return Object.fromEntries(getCookableRecipes().map(({ recipe, ...availability }) => [recipe.id, availability]));
  }, { pantry, recipes });
  expect(result).toEqual({
    ready: {
      tier: 'ready', missing: 0, matched: 3, total: 8, requiredTotal: 3, missingIngredients: [],
      swaps: [], optionalMissing: ['Mint, torn, for garnish', 'Lime, for squeezing', 'Sesame seeds (optional)']
    },
    swap: {
      tier: 'swap', missing: 0, matched: 1, total: 2, requiredTotal: 2, missingIngredients: [],
      swaps: [{ need: 'Brown rice', use: 'Jasmine Rice' }], optionalMissing: []
    },
    spice: {
      tier: 'buy', missing: 1, matched: 1, total: 2, requiredTotal: 2, missingIngredients: ['Caraway'],
      swaps: [], optionalMissing: []
    },
    expired: {
      tier: 'buy', missing: 1, matched: 1, total: 2, requiredTotal: 2, missingIngredients: ['Paprika'],
      swaps: [], optionalMissing: []
    },
    two: {
      tier: 'buy', missing: 2, matched: 1, total: 3, requiredTotal: 3, missingIngredients: ['Leek', 'Fennel'],
      swaps: [], optionalMissing: []
    }
  });
});

test('Recipes tab badges ready, swap and buy recipes in their own tiers', async ({ page }) => {
  await page.evaluate(state => {
    Object.assign(AppState, state);
    renderRecipes();
  }, { pantry, recipes });
  await page.locator('.tab-btn[data-tab="recipes"]').click();
  const suggestions = page.locator('#cook-suggestions');
  await expect(suggestions.locator('.cs-tier-label')).toHaveText([
    'Can cook now', 'Cook with a swap', 'Missing 1 ingredient', 'Missing 2 ingredients'
  ]);
  const tiers = [
    ['Can cook now', 'Golden Carrot Skillet', 'All ingredients ✓'],
    ['Cook with a swap', 'Carrot and Brown Rice', 'Swap'],
    ['Missing 1 ingredient', 'Caraway Carrots', 'Missing 1'],
    ['Missing 2 ingredients', 'Leek and Fennel Rice', 'Missing 2']
  ];
  for (const [label, name, badge] of tiers) {
    const tier = suggestions.locator('.cs-tier').filter({ has: page.getByText(label, { exact: true }) });
    await expect(tier.getByRole('button', { name: `${name} ${badge}`, exact: true })).toBeVisible();
  }
});

test('eat picker tells cooks what to swap, buy or use from stock', async ({ page }) => {
  const picker = page.locator('.dash-card--eat');
  const cases = [
    ['ready', pantry, 'Have everything'],
    ['swap', pantry, 'Swap: use Jasmine Rice'],
    ['spice', pantry, 'Missing 1'],
    ['ready', [], null]
  ];
  for (const [id, stock, reason] of cases) {
    const selectedRecipe = recipes.find(r => r.id === id);
    await page.evaluate(({ stock, selectedRecipe }) => {
      Object.assign(AppState, { pantry: stock, recipes: [selectedRecipe] });
      renderDashboard();
    }, { stock, selectedRecipe });
    await expect(picker.locator('.wse-name')).toHaveText(selectedRecipe.name);
    const stockReasons = picker.locator('.wse-chip').filter({ hasText: /^(Have everything|Swap:|Missing)/ });
    if (reason) await expect.soft(stockReasons, id).toHaveText(reason);
    else await expect.soft(stockReasons, 'empty pantry').toHaveCount(0);
  }
});

for (const width of [1280, 390]) {
  test(`Home shows ready, swap and buy tiers at ${width}px and rendering preserves state`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await page.evaluate(state => {
      Object.assign(AppState, state);
      const before = structuredClone(AppState);
      renderDashboard();
      return { before, after: structuredClone(AppState), suggestions: getCookSuggestions().length };
    }, { pantry, recipes });
    expect(state.after).toEqual(state.before);
    expect(state.suggestions).toBeGreaterThan(0);

    await page.locator('#dash-ideas > summary').click();
    const cook = page.locator('.dash-l2-pane').filter({ hasText: 'Cook this' });
    await expect(cook.locator('.dash-cook-tier-label')).toHaveText([
      'Can cook now', 'Cook with a swap', 'Missing 1 ingredient', 'Missing 2 ingredients'
    ]);
    const ready = cook.locator('.dash-cook-tier--ready');
    await expect(ready).toContainText('Golden Carrot Skillet');
    await expect(ready).toContainText('All ingredients ✓');
    const optionalNote = ready.getByText('+ optional: Mint, Lime', { exact: true });
    const swapNote = cook.getByText('use Jasmine Rice for Brown rice', { exact: true });
    for (const note of [optionalNote, swapNote]) {
      await expect(note).toBeVisible();
      expect.soft(await note.getAttribute('style')).toBeNull();
    }
    await expect(cook.getByRole('button', { name: 'Buy Caraway' })).toBeVisible();
    await expect(page.locator('.dash-card--eat .wse-name').first()).toBeVisible();
    expect(await cook.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);

    if (process.env.MEAL_PREP_TASK_087_EVIDENCE === '1') {
      await cook.screenshot({ path: path.join(__dirname, '..', 'feature-evidence', 'task-087', `cook-now-${width}.png`) });
    }

    await page.evaluate(() => {
      showTab('recipes');
      renderCookSuggestions();
    });
    await expect(page.locator('#cook-suggestions .cs-name').filter({ hasText: 'Golden Carrot Skillet' })).toBeVisible();
    await expect(page.locator('#cook-suggestions .cs-name').filter({ hasText: 'Carrot and Brown Rice' })).toBeVisible();
  });
}
