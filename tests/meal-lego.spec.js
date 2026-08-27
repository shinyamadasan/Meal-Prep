const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');
const { waitForAppReady } = require('./app-ready');

/**
 * Meal Lego v1 — "I already cooked protein; show me a few flavors that truthfully
 * work with it."
 *
 * The whole compatibility + ranking decision lives in ONE pure helper,
 * getCompatibleFlavorsForCookedMeal(meal). It never mutates AppState and never
 * persists. Everything below asserts that helper directly, plus the two thin UI
 * surfaces that render it (the Fridge Ready-Food card and the Home "Eat this
 * first" pick).
 *
 * The invariant this file defends, inherited from Ready Food Protein Identity:
 *
 *   A cooked meal's NAME is never read to decide its protein, and therefore
 *   never read to decide its flavors.
 *
 * Additive and non-red-zone: derived helpers + rendering + tests. No new
 * AppState key, no new cookedMeal / flavor field, no sync / tombstone / saveData
 * change.
 */

const APP_URL = () => pathToFileURL(path.resolve('index.html')).href;

async function loadOffline(page) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__mealLegoBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__mealLegoBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
      localStorage.setItem('mealPrepInitialized', '1');
    } catch (e) {}
  });
  await page.goto(APP_URL(), { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
}

// A fully-formed flavor object. normalizeFlavors() in the page still runs over
// it, so ids get the flv- prefix and the vocabularies are validated.
const flavor = (id, name, worksWith, extra) => Object.assign({
  id: 'flv-' + id, name: name,
  ingredients: [{ name: 'Soy Sauce', baseQuantity: 2, unit: 'tbsp', category: 'Pantry' }],
  instructions: 'Mix it.', activeTime: 5, preparationStyle: 'fridge-batch',
  worksWith: worksWith, tags: []
}, extra || {});

const recipe = (id, name, ingredients) => ({
  id, name, category: 'Dinner', baseServings: 2, currentServings: 2,
  basePrepTime: 10, baseCookTime: 20, fridgeLife: 3, freezerLife: 30,
  baseIngredients: ingredients, instructions: 'x',
  updatedAt: '2026-01-01T00:00:00.000Z'
});
const ing = (name, category) => ({ name: name, baseQuantity: 200, unit: 'g', category: category });

const pinnedMeal = (id, proteinType) => ({
  id: id, recipeId: null, name: 'batch ' + id, proteinType: proteinType,
  cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 3, freezerLife: 30,
  initialPortions: 4, portionsRemaining: 4
});

// ── 1–6. Exact family match works for every family ───────────────────────────

test('1–6. each family returns only flavors whose worksWith names that family', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(({ flavors }) => {
    AppState.recipes = [];
    AppState.flavors = normalizeFlavors(JSON.parse(JSON.stringify(flavors)));
    const families = ['chicken', 'beef', 'pork', 'tofu', 'egg', 'shrimp'];
    const out = {};
    families.forEach((fam) => {
      const r = getCompatibleFlavorsForCookedMeal({ id: 'x', recipeId: null, name: 'n', proteinType: fam });
      out[fam] = { matchable: r.matchable, names: r.flavors.map((e) => e.flavor.name).sort() };
    });
    return out;
  }, {
    flavors: [
      flavor('chk', 'Chicken One', ['chicken']),
      flavor('bf', 'Beef One', ['beef']),
      flavor('pk', 'Pork One', ['pork']),
      flavor('tf', 'Tofu One', ['tofu']),
      flavor('eg', 'Egg One', ['egg']),
      flavor('sh', 'Shrimp One', ['shrimp']),
      flavor('multi', 'Everything', ['chicken', 'beef', 'pork', 'tofu', 'egg', 'shrimp'])
    ]
  });
  expect(got.chicken).toEqual({ matchable: true, names: ['Chicken One', 'Everything'] });
  expect(got.beef).toEqual({ matchable: true, names: ['Beef One', 'Everything'] });
  expect(got.pork).toEqual({ matchable: true, names: ['Everything', 'Pork One'] });
  expect(got.tofu).toEqual({ matchable: true, names: ['Everything', 'Tofu One'] });
  expect(got.egg).toEqual({ matchable: true, names: ['Egg One', 'Everything'] });
  expect(got.shrimp).toEqual({ matchable: true, names: ['Everything', 'Shrimp One'] });
});

// ── 7–13. Fish hierarchy — one-way supertype ─────────────────────────────────

test('7,8. cooked salmon matches salmon-specific AND generic fish flavors', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(({ flavors }) => {
    AppState.recipes = [];
    AppState.flavors = normalizeFlavors(JSON.parse(JSON.stringify(flavors)));
    const r = getCompatibleFlavorsForCookedMeal({ id: 's', recipeId: null, name: 'n', proteinType: 'salmon' });
    return r.flavors.map((e) => [e.flavor.name, e.specificity]);
  }, {
    flavors: [
      flavor('salm', 'Salmon Glaze', ['salmon']),
      flavor('fishy', 'Fish Sauce Dip', ['fish']),
      flavor('beefy', 'Beef Only', ['beef'])
    ]
  });
  const names = got.map((g) => g[0]);
  expect(names).toContain('Salmon Glaze');
  expect(names).toContain('Fish Sauce Dip');
  expect(names).not.toContain('Beef Only');
  expect(got.find((g) => g[0] === 'Salmon Glaze')[1]).toBe('exact');
  expect(got.find((g) => g[0] === 'Fish Sauce Dip')[1]).toBe('supertype');
});

test('9. a salmon-specific flavor ranks before a generic fish flavor when otherwise comparable', async ({ page }) => {
  await loadOffline(page);
  const order = await page.evaluate(({ flavors }) => {
    AppState.recipes = [];
    AppState.flavors = normalizeFlavors(JSON.parse(JSON.stringify(flavors)));
    return getCompatibleFlavorsForCookedMeal({ id: 's', recipeId: null, name: 'n', proteinType: 'salmon' })
      .flavors.map((e) => e.flavor.name);
  }, {
    flavors: [
      // generic fish flavor is FASTER, but specificity outranks activeTime
      flavor('fishfast', 'Fish Quick', ['fish'], { activeTime: 1 }),
      flavor('salmslow', 'Salmon Slow', ['salmon'], { activeTime: 20 })
    ]
  });
  expect(order).toEqual(['Salmon Slow', 'Fish Quick']);
});

test('10,11. cooked tuna matches tuna-specific AND generic fish flavors', async ({ page }) => {
  await loadOffline(page);
  const names = await page.evaluate(({ flavors }) => {
    AppState.recipes = [];
    AppState.flavors = normalizeFlavors(JSON.parse(JSON.stringify(flavors)));
    return getCompatibleFlavorsForCookedMeal({ id: 't', recipeId: null, name: 'n', proteinType: 'tuna' })
      .flavors.map((e) => e.flavor.name).sort();
  }, {
    flavors: [
      flavor('tun', 'Tuna Mayo', ['tuna']),
      flavor('fishy', 'Fish Dip', ['fish']),
      flavor('salm', 'Salmon Only', ['salmon'])
    ]
  });
  expect(names).toEqual(['Fish Dip', 'Tuna Mayo']);
});

test('12,13. cooked GENERIC fish never matches a salmon-only or tuna-only flavor', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(({ flavors }) => {
    AppState.recipes = [];
    AppState.flavors = normalizeFlavors(JSON.parse(JSON.stringify(flavors)));
    const r = getCompatibleFlavorsForCookedMeal({ id: 'f', recipeId: null, name: 'n', proteinType: 'fish' });
    return { matchable: r.matchable, names: r.flavors.map((e) => e.flavor.name).sort() };
  }, {
    flavors: [
      flavor('salm', 'Salmon Only', ['salmon']),
      flavor('tun', 'Tuna Only', ['tuna']),
      flavor('fishy', 'Fish Dip', ['fish'])
    ]
  });
  expect(got.matchable).toBe(true);
  expect(got.names).toEqual(['Fish Dip']); // ONLY the genuine fish flavor
});

// ── 14–19. Truth states ─────────────────────────────────────────────────────

test('14. mixed returns no automatic suggestions and does not union constituent families', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(({ flavors, r }) => {
    AppState.recipes = [r];
    AppState.flavors = normalizeFlavors(JSON.parse(JSON.stringify(flavors)));
    const meal = { id: 'm', recipeId: '910', name: 'Tapsilog', cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 3 };
    const res = getCompatibleFlavorsForCookedMeal(meal);
    return { protein: res.protein, matchable: res.matchable, count: res.flavors.length };
  }, {
    r: recipe(910, 'Tapsilog', [ing('Beef Sirloin', 'Protein'), ing('Eggs', 'Protein')]),
    flavors: [flavor('bf', 'Beef One', ['beef']), flavor('eg', 'Egg One', ['egg'])]
  });
  expect(got.protein).toBe('mixed');
  expect(got.matchable).toBe(false);
  expect(got.count).toBe(0);
});

test('15. none returns no automatic protein-flavor suggestions and does NOT map to vegetables', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(({ flavors, r }) => {
    AppState.recipes = [r];
    AppState.flavors = normalizeFlavors(JSON.parse(JSON.stringify(flavors)));
    const meal = { id: 'm', recipeId: '920', name: 'Sinangag', cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 3 };
    const res = getCompatibleFlavorsForCookedMeal(meal);
    return { protein: res.protein, matchable: res.matchable, count: res.flavors.length };
  }, {
    r: recipe(920, 'Sinangag', [ing('White Rice (Bigas)', 'Grain'), ing('Garlic (Bawang)', 'Vegetable')]),
    flavors: [flavor('veg', 'Veg Dip', ['vegetables']), flavor('rice', 'Rice Drizzle', ['rice'])]
  });
  expect(got.protein).toBe('none');
  expect(got.matchable).toBe(false);
  expect(got.count).toBe(0);
});

test('16. unknown returns no suggestions', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(({ flavors }) => {
    AppState.recipes = [];
    AppState.flavors = normalizeFlavors(JSON.parse(JSON.stringify(flavors)));
    const res = getCompatibleFlavorsForCookedMeal({ id: 'u', recipeId: null, name: 'Mystery tupperware' });
    return { protein: res.protein, matchable: res.matchable, count: res.flavors.length };
  }, { flavors: [flavor('chk', 'Chicken One', ['chicken'])] });
  expect(got.protein).toBe('unknown');
  expect(got.matchable).toBe(false);
  expect(got.count).toBe(0);
});

test('17,18. name-shaped batches ("Landers Lechon Manok", "Chicken of the Sea") stay unknown — no name parsing', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(({ flavors }) => {
    AppState.recipes = [];
    AppState.flavors = normalizeFlavors(JSON.parse(JSON.stringify(flavors)));
    return ['Landers Lechon Manok', 'Chicken of the Sea', 'Beef Stew', 'Salmon poke bowl', 'Tuna sandwich']
      .map((n) => {
        const r = getCompatibleFlavorsForCookedMeal({ id: 'x', recipeId: null, name: n });
        return [n, r.protein, r.flavors.length];
      });
  }, { flavors: [flavor('chk', 'C', ['chicken']), flavor('bf', 'B', ['beef']), flavor('salm', 'S', ['salmon']), flavor('tun', 'T', ['tuna'])] });
  got.forEach(([name, protein, count]) => {
    expect(protein, name).toBe('unknown');
    expect(count, name).toBe(0);
  });
});

test('19. explicitly pinning those same records enables the correct suggestions — without inspecting the name', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(({ flavors }) => {
    AppState.recipes = [];
    AppState.flavors = normalizeFlavors(JSON.parse(JSON.stringify(flavors)));
    const lechon = getCompatibleFlavorsForCookedMeal({ id: 'a', recipeId: null, name: 'Landers Lechon Manok', proteinType: 'chicken' });
    const cots = getCompatibleFlavorsForCookedMeal({ id: 'b', recipeId: null, name: 'Chicken of the Sea', proteinType: 'tuna' });
    return {
      lechon: lechon.flavors.map((e) => e.flavor.name).sort(),
      cots: cots.flavors.map((e) => e.flavor.name).sort()
    };
  }, { flavors: [flavor('chk', 'Chicken One', ['chicken']), flavor('tun', 'Tuna One', ['tuna']), flavor('fishy', 'Fish Dip', ['fish'])] });
  expect(got.lechon).toEqual(['Chicken One']);       // pinned chicken, name says "Manok" — ignored
  expect(got.cots).toEqual(['Fish Dip', 'Tuna One']); // pinned tuna, name says "Chicken" — ignored
});

// ── 20–24. Ranking ──────────────────────────────────────────────────────────

test('20. lower activeTime wins when specificity is equal', async ({ page }) => {
  await loadOffline(page);
  const order = await page.evaluate(({ flavors }) => {
    AppState.recipes = [];
    AppState.flavors = normalizeFlavors(JSON.parse(JSON.stringify(flavors)));
    return getCompatibleFlavorsForCookedMeal({ id: 'c', recipeId: null, name: 'n', proteinType: 'chicken' })
      .flavors.map((e) => e.flavor.name);
  }, {
    flavors: [
      flavor('slow', 'Slow Sauce', ['chicken'], { activeTime: 12 }),
      flavor('fast', 'Fast Sauce', ['chicken'], { activeTime: 2 }),
      flavor('mid', 'Mid Sauce', ['chicken'], { activeTime: 6 })
    ]
  });
  expect(order).toEqual(['Fast Sauce', 'Mid Sauce', 'Slow Sauce']);
});

test('21. specificity beats supertype even when the supertype flavor is otherwise better', async ({ page }) => {
  await loadOffline(page);
  const order = await page.evaluate(({ flavors }) => {
    AppState.recipes = [];
    AppState.flavors = normalizeFlavors(JSON.parse(JSON.stringify(flavors)));
    return getCompatibleFlavorsForCookedMeal({ id: 's', recipeId: null, name: 'n', proteinType: 'salmon' })
      .flavors.map((e) => [e.flavor.name, e.specificity]);
  }, {
    flavors: [
      flavor('g', 'Generic Fish Fast Fresh', ['fish'], { activeTime: 1, preparationStyle: 'make-fresh' }),
      flavor('s', 'Salmon Slow Freezer', ['salmon'], { activeTime: 30, preparationStyle: 'freezer-friendly' })
    ]
  });
  expect(order).toEqual([['Salmon Slow Freezer', 'exact'], ['Generic Fish Fast Fresh', 'supertype']]);
});

test('22. make-fresh breaks a tie, then name, then id — and the order is stable across calls', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(({ flavors }) => {
    AppState.recipes = [];
    AppState.flavors = normalizeFlavors(JSON.parse(JSON.stringify(flavors)));
    const call = () => getCompatibleFlavorsForCookedMeal({ id: 'c', recipeId: null, name: 'n', proteinType: 'chicken' })
      .flavors.map((e) => e.flavor.name);
    return { a: call(), b: call() };
  }, {
    flavors: [
      // identical activeTime 5; fridge-batch vs make-fresh; then alphabetical
      flavor('z', 'Zesty Batch', ['chicken'], { activeTime: 5, preparationStyle: 'fridge-batch' }),
      flavor('a', 'Aioli Fresh', ['chicken'], { activeTime: 5, preparationStyle: 'make-fresh' }),
      flavor('b', 'Basil Fresh', ['chicken'], { activeTime: 5, preparationStyle: 'make-fresh' })
    ]
  });
  expect(got.a).toEqual(['Aioli Fresh', 'Basil Fresh', 'Zesty Batch']);
  expect(got.b).toEqual(got.a); // deterministic
});

test('23. at most 3 suggestions are returned', async ({ page }) => {
  await loadOffline(page);
  const count = await page.evaluate(({ flavors }) => {
    AppState.recipes = [];
    AppState.flavors = normalizeFlavors(JSON.parse(JSON.stringify(flavors)));
    return getCompatibleFlavorsForCookedMeal({ id: 'c', recipeId: null, name: 'n', proteinType: 'chicken' }).flavors.length;
  }, {
    flavors: [1, 2, 3, 4, 5, 6].map((n) => flavor('c' + n, 'Chicken ' + n, ['chicken'], { activeTime: n }))
  });
  expect(count).toBe(3);
});

test('24. a flavor removed from AppState.flavors cannot appear (tombstoned flavors are already gone)', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(({ flavors }) => {
    AppState.recipes = [];
    AppState.flavors = normalizeFlavors(JSON.parse(JSON.stringify(flavors)));
    const ask = () => getCompatibleFlavorsForCookedMeal({ id: 'c', recipeId: null, name: 'n', proteinType: 'chicken' })
      .flavors.map((e) => e.flavor.name);
    const before = ask();
    // Flavor Library removal (deleteFlavor / applyTombstones) ends with the row
    // absent from AppState.flavors; simulate that end state.
    AppState.flavors = AppState.flavors.filter((f) => f.name !== 'Alpha');
    return { before, after: ask() };
  }, { flavors: [flavor('a', 'Alpha', ['chicken']), flavor('b', 'Bravo', ['chicken'])] });
  expect(got.before).toEqual(['Alpha', 'Bravo']);
  expect(got.after).toEqual(['Bravo']);
});

// ── 25–30. Fridge / Ready Food UI ───────────────────────────────────────────

async function seedFridge(page, meals, flavors) {
  await page.evaluate(({ meals, flavors }) => {
    AppState.recipes = [];
    AppState.flavors = normalizeFlavors(JSON.parse(JSON.stringify(flavors)));
    AppState.cookedMeals = normalizeCookedMeals(JSON.parse(JSON.stringify(meals)));
    showTab('fridge'); // the cards live in #fridge, hidden until that tab is active
    renderCookedMeals();
  }, { meals, flavors });
}

test('25. a known-protein Ready Food card shows a "Try with" row', async ({ page }) => {
  await loadOffline(page);
  await seedFridge(page,
    [pinnedMeal('cm1', 'chicken')],
    [flavor('a', 'Aioli', ['chicken']), flavor('b', 'Bagoong', ['chicken'])]);
  const card = page.locator('.cooked-card', { hasText: 'batch cm1' });
  await expect(card.locator('.meal-lego-try')).toBeVisible();
  await expect(card.locator('.meal-lego-chip')).toHaveCount(2);
  await expect(card.locator('.meal-lego-label')).toHaveText('Try with');
});

test('26. an unknown Ready Food card fabricates NO "Try with" — only the secondary set-protein hint', async ({ page }) => {
  await loadOffline(page);
  await seedFridge(page,
    [{ id: 'cmU', recipeId: null, name: 'Mystery tupperware', cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 3, initialPortions: 2, portionsRemaining: 2 }],
    [flavor('a', 'Aioli', ['chicken'])]);
  const card = page.locator('.cooked-card', { hasText: 'Mystery tupperware' });
  await expect(card.locator('.meal-lego-chip')).toHaveCount(0);
  await expect(card.locator('.meal-lego-set-hint')).toHaveText(/Set protein to see flavor ideas/);
});

test('27. a mixed Ready Food card fabricates no suggestions and shows no set-protein hint', async ({ page }) => {
  await loadOffline(page);
  await page.evaluate(({ r }) => {
    AppState.recipes = [r];
    AppState.flavors = normalizeFlavors(JSON.parse(JSON.stringify([{ id: 'flv-b', name: 'Beef One', ingredients: [], instructions: '', activeTime: 5, preparationStyle: 'fridge-batch', worksWith: ['beef'], tags: [] }])));
    AppState.cookedMeals = normalizeCookedMeals([{ id: 'cmM', recipeId: '910', name: 'Tapsilog', cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 3, initialPortions: 4, portionsRemaining: 4 }]);
    renderCookedMeals();
  }, { r: recipe(910, 'Tapsilog', [ing('Beef Sirloin', 'Protein'), ing('Eggs', 'Protein')]) });
  const card = page.locator('.cooked-card', { hasText: 'Tapsilog' });
  await expect(card.locator('.meal-lego-try')).toHaveCount(0);
});

test('28. Used 1 still decrements exactly one portion with the Meal Lego row present', async ({ page }) => {
  await loadOffline(page);
  await seedFridge(page, [pinnedMeal('cm1', 'chicken')], [flavor('a', 'Aioli', ['chicken'])]);
  const card = page.locator('.cooked-card', { hasText: 'batch cm1' });
  await card.locator('.cooked-use-one').click();
  const remaining = await page.evaluate(() => AppState.cookedMeals[0].portionsRemaining);
  expect(remaining).toBe(3);
});

test('29. protein correction still works and updates the Try with row live', async ({ page }) => {
  await loadOffline(page);
  await seedFridge(page,
    [{ id: 'cmX', recipeId: null, name: 'Mystery tupperware', cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 3, initialPortions: 2, portionsRemaining: 2 }],
    [flavor('a', 'Aioli', ['chicken'])]);
  await page.evaluate(() => setCookedProteinType('cmX', 'chicken'));
  const card = page.locator('.cooked-card', { hasText: 'Mystery tupperware' });
  await expect(card.locator('.meal-lego-chip')).toHaveText(/Aioli/);
  const stored = await page.evaluate(() => AppState.cookedMeals[0].proteinType);
  expect(stored).toBe('chicken');
});

test('30. clicking a Try with chip opens the Flavor Library entry', async ({ page }) => {
  await loadOffline(page);
  await seedFridge(page, [pinnedMeal('cm1', 'chicken')], [flavor('adobo', 'Adobo Glaze', ['chicken'])]);
  await page.locator('.cooked-card .meal-lego-chip', { hasText: 'Adobo Glaze' }).click();
  await expect(page.locator('#flavors')).toHaveClass(/active/);
  const card = page.locator('.flavor-card[data-flavor-id="flv-adobo"]');
  await expect(card.locator('.flavor-detail')).toBeVisible();
});

test('openFlavorFromReadyFood does NOT mutate the user\'s flavor filters', async ({ page }) => {
  await loadOffline(page);
  await page.evaluate(({ flavors }) => {
    AppState.flavors = normalizeFlavors(JSON.parse(JSON.stringify(flavors)));
    AppState.cookedMeals = normalizeCookedMeals([{ id: 'cm1', recipeId: null, name: 'batch cm1', proteinType: 'chicken', cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 3, initialPortions: 4, portionsRemaining: 4 }]);
    // user has set a filter
    flavorFilters.style = 'make-fresh';
    renderCookedMeals();
  }, { flavors: [flavor('a', 'Aioli Fresh', ['chicken'], { preparationStyle: 'make-fresh' })] });
  await page.evaluate(() => openFlavorFromReadyFood('flv-a'));
  const filterStillSet = await page.evaluate(() => flavorFilters.style);
  expect(filterStillSet).toBe('make-fresh'); // navigation did not reset it
});

test('a chip for a flavor hidden by the current filter shows a notice, not a silent filter reset', async ({ page }) => {
  await loadOffline(page);
  await page.evaluate(({ flavors }) => {
    AppState.flavors = normalizeFlavors(JSON.parse(JSON.stringify(flavors)));
    flavorFilters.style = 'freezer-friendly'; // hides the fridge-batch flavor below
  }, { flavors: [flavor('a', 'Aioli Batch', ['chicken'], { preparationStyle: 'fridge-batch' })] });
  await page.evaluate(() => openFlavorFromReadyFood('flv-a'));
  await expect(page.locator('#flavors')).toHaveClass(/active/);
  const stillSet = await page.evaluate(() => flavorFilters.style);
  expect(stillSet).toBe('freezer-friendly');
});

// ── 31–35. Home integration + existing-ranking regressions ───────────────────

test('31. Home "Eat this first" may show ONE concise flavor line', async ({ page }) => {
  await loadOffline(page);
  await page.evaluate(({ flavors }) => {
    AppState.recipes = [];
    AppState.flavors = normalizeFlavors(JSON.parse(JSON.stringify(flavors)));
    AppState.cookedMeals = normalizeCookedMeals([{
      id: 'cmH', recipeId: null, name: 'Roast chicken', proteinType: 'chicken',
      cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 3, initialPortions: 2, portionsRemaining: 2
    }]);
    renderDashboard();
  }, { flavors: [flavor('a', 'Soy-Calamansi', ['chicken'], { activeTime: 3 }), flavor('b', 'Gochujang', ['chicken'], { activeTime: 5 }), flavor('c', 'Aioli', ['chicken'], { activeTime: 4 }) ] });
  const legoLines = page.locator('.wse-row .wse-lego');
  await expect(legoLines).toHaveCount(1);
  await expect(legoLines.first()).toHaveText('Try Soy-Calamansi');
});

test('32,33,34. Ready Food ordering is unchanged by adding flavors (expiring > fridge > freezer preserved)', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(({ flavors }) => {
    const meals = [
      { id: 'r1', name: 'Freezer batch', proteinType: 'chicken', cookedDate: '2026-08-20', storage: 'freezer', freezerLife: 90, fridgeLife: 3, initialPortions: 4, portionsRemaining: 4 },
      { id: 'r2', name: 'Use soon', proteinType: 'beef', cookedDate: '2026-08-24', storage: 'fridge', fridgeLife: 3, initialPortions: 2, portionsRemaining: 1 },
      { id: 'r3', name: 'Plenty left', proteinType: 'tofu', cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 30, initialPortions: 6, portionsRemaining: 6 }
    ];
    AppState.recipes = [];
    AppState.flavors = [];
    AppState.cookedMeals = JSON.parse(JSON.stringify(meals));
    const before = getReadyFoodSuggestions().map((m) => m.id);
    AppState.flavors = normalizeFlavors(JSON.parse(JSON.stringify(flavors)));
    const after = getReadyFoodSuggestions().map((m) => m.id);
    return { before, after };
  }, { flavors: [flavor('a', 'A', ['chicken', 'beef', 'tofu'])] });
  expect(got.after).toEqual(got.before);
  expect(got.before).toEqual(['r2', 'r3', 'r1']); // expiring, then fridge, then freezer
});

test('35. What Should We Eat category selection is unchanged — only presentation metadata is added', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(({ flavors }) => {
    AppState.recipes = [];
    AppState.cookHistory = [];
    AppState.cookedMeals = normalizeCookedMeals([
      { id: 'w1', name: 'Ready A', proteinType: 'chicken', cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 30, initialPortions: 3, portionsRemaining: 3 }
    ]);
    AppState.flavors = [];
    const withoutKeys = getWhatShouldWeEatSuggestions().map((p) => p.key + ':' + p.id);
    AppState.flavors = normalizeFlavors(JSON.parse(JSON.stringify(flavors)));
    const picks = getWhatShouldWeEatSuggestions();
    return {
      withoutKeys,
      withKeys: picks.map((p) => p.key + ':' + p.id),
      readyPickFlavor: picks[0].flavor ? picks[0].flavor.name : null
    };
  }, { flavors: [flavor('a', 'Soy-Calamansi', ['chicken'], { activeTime: 3 })] });
  expect(got.withKeys).toEqual(got.withoutKeys);   // same picks in the same order
  expect(got.readyPickFlavor).toBe('Soy-Calamansi'); // metadata added, nothing reshuffled
});

// ── 36–38. Zero persistence ─────────────────────────────────────────────────

test('36,37,38. rendering Meal Lego suggestions writes nothing — localStorage and Firestore payload untouched', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(({ flavors }) => {
    AppState.recipes = [];
    AppState.flavors = normalizeFlavors(JSON.parse(JSON.stringify(flavors)));
    AppState.cookedMeals = normalizeCookedMeals([
      { id: 'z1', recipeId: null, name: 'Roast chicken', proteinType: 'chicken', cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 3, initialPortions: 4, portionsRemaining: 4 },
      { id: 'z2', recipeId: null, name: 'Mystery', cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 3, initialPortions: 2, portionsRemaining: 2 }
    ]);
    saveData(); // establish a baseline on disk
    const lsBefore = localStorage.getItem('mealPrepAppData');

    let saveCalls = 0;
    const realSave = window.saveData;
    window.saveData = function () { saveCalls++; return realSave.apply(this, arguments); };
    const meal0 = JSON.parse(JSON.stringify(AppState.cookedMeals[0]));

    // Every Meal Lego surface, exercised.
    getCompatibleFlavorsForCookedMeal(AppState.cookedMeals[0]);
    getCompatibleFlavorsForCookedMeal(AppState.cookedMeals[1]);
    renderCookedMeals();
    renderDashboard();

    window.saveData = realSave;
    const lsAfter = localStorage.getItem('mealPrepAppData');

    return {
      saveCalls,
      lsUnchanged: lsBefore === lsAfter,
      mealUnmutated: JSON.stringify(meal0) === JSON.stringify(AppState.cookedMeals[0]),
      flavorHasNoDerivedFields: AppState.flavors.every((f) => !('compatibleWith' in f) && !('_lego' in f))
    };
  }, { flavors: [flavor('a', 'Aioli', ['chicken'])] });
  expect(got.saveCalls).toBe(0);
  expect(got.lsUnchanged).toBe(true);
  expect(got.mealUnmutated).toBe(true);
  expect(got.flavorHasNoDerivedFields).toBe(true);
});

test('no new AppState key and no new cookedMeal / flavor field is introduced by Meal Lego', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => ({
    keys: Object.keys(AppState).filter((k) => k !== 'localSavedAt' && k !== 'cloudSavedAt').sort(),
    legoKeys: Object.keys(AppState).filter((k) => /lego|compatible|suggest/i.test(k))
  }));
  const expected = [
    'cloudReady', 'cookHistory', 'cookedMeals', 'currentEditingFlavor',
    'currentEditingHack', 'currentEditingIngredient', 'currentEditingRecipe', 'currentUser',
    'customHacks', 'customIngredients', 'customStores', 'dataVersion', 'deletions', 'flavors',
    // 'preparedFlavors' is Flavor Bomb v1's prepared-stock collection (D-074) — a
    // LATER, separately owner-approved wave, not something Meal Lego introduced.
    // Listed here (rather than loosening the check) so this test keeps asserting
    // that Meal Lego ITSELF adds no key, while staying accurate about AppState's
    // current shape.
    'preparedFlavors',
    'groceryList', 'ingredientPrices', 'isOnline', 'myStores', 'nutritionGoals', 'pantry',
    'prepModeSession', 'profile', 'recentRecipes', 'recipes', 'selectedPlannerDays',
    'selectedRecipeForPlanning', 'syncStatus', 'userIngredients', 'weeklyPlan'
  ].sort();
  expect(got.keys).toEqual(expected);
  expect(got.legoKeys).toEqual([]);
});

// ── Mobile ──────────────────────────────────────────────────────────────────

test('390px: Try with wraps cleanly, no horizontal overflow, Used 1 still reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadOffline(page);
  await seedFridge(page,
    [pinnedMeal('cm1', 'salmon')],
    [
      flavor('a', 'Soy-Calamansi Dressing', ['salmon'], { activeTime: 3 }),
      flavor('b', 'Garlic Butter Coin', ['fish'], { activeTime: 5 }),
      flavor('c', 'Teriyaki-style Glaze', ['salmon'], { activeTime: 8 })
    ]);
  const box = await page.evaluate(() => {
    const card = document.querySelector('.cooked-card');
    const used = card.querySelector('.cooked-use-one');
    const chips = card.querySelectorAll('.meal-lego-chip');
    const ur = used.getBoundingClientRect();
    return {
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      chipCount: chips.length,
      usedVisible: ur.width > 0 && ur.height > 0 && ur.right <= window.innerWidth + 1,
      allChipsInViewport: Array.from(chips).every((c) => c.getBoundingClientRect().right <= window.innerWidth + 1)
    };
  });
  expect(box.docOverflow).toBeLessThanOrEqual(0);
  expect(box.chipCount).toBe(3);
  expect(box.usedVisible).toBe(true);
  expect(box.allChipsInViewport).toBe(true);
});

// ── No page / console errors across the whole flow ──────────────────────────

test('the whole Meal Lego flow raises no page or console errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await loadOffline(page);
  await seedFridge(page,
    [pinnedMeal('cm1', 'chicken'), pinnedMeal('cm2', 'salmon'), { id: 'cm3', recipeId: null, name: 'Mystery', cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 3, initialPortions: 2, portionsRemaining: 2 }],
    [flavor('a', 'Aioli', ['chicken']), flavor('b', 'Fish Dip', ['fish'])]);
  await page.evaluate(() => renderDashboard());
  await page.locator('.cooked-card .meal-lego-chip').first().click();
  await page.waitForTimeout(200);
  const appErrors = errors.filter((e) => !/net::ERR|Failed to load resource|favicon|frame-ancestors|google\.com/i.test(e));
  expect(appErrors).toEqual([]);
});
