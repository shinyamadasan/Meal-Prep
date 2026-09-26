const { test, expect } = require('@playwright/test');
const { waitForAppReady, waitForRestored } = require('./app-ready');

/**
 * Meal-prep-first wave: PLAN -> SHOP -> PREP -> FRIDGE.
 *
 * Rules this file proves:
 *   - Buying an ingredient never makes a Fridge meal. Only prep does.
 *   - The user can say "I don't actually have that" and it sticks across reloads,
 *     without destroying other, legitimate stock that merely matched loosely.
 *   - A batch can be planned without a day.
 *   - The AI Prep Brief quotes recipe facts and never invents missing ones.
 */

test.use({ viewport: { width: 1280, height: 1700 } });

async function loadLocalApp(page) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__mealPrepFirstBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__mealPrepFirstBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
  });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
}

// ── Pass 1: Shop corrections ────────────────────────────────────────────────

test('"Not anymore?" is offered only on untouched In-stock rows; tapping the row keeps its D-069 top-up meaning', async ({ page }) => {
  await loadLocalApp(page);
  const r = await page.evaluate(() => {
    AppState.pantry = [{ id: 'p_onion', name: 'Onion', category: 'Vegetable', quantity: 2, unit: 'pcs' }];
    AppState.groceryList = [{ id: 910001, name: 'Onion', category: 'Vegetable', quantity: 3, unit: 'pcs', checked: false }];
    showTab('grocery');
    const offeredBefore = document.querySelectorAll('.grocery-not-have-btn').length;
    toggleGroceryItem(910001); // "bought more" — D-069 tops up the existing record
    return {
      offeredBefore,
      offeredAfter: document.querySelectorAll('.grocery-not-have-btn').length,
      pantry: AppState.pantry.map((p) => ({ id: p.id, qty: p.quantity }))
    };
  });
  expect(r.offeredBefore).toBe(1);
  expect(r.offeredAfter).toBe(0);                        // the user's tap owns the row now
  expect(r.pantry).toEqual([{ id: 'p_onion', qty: 5 }]); // unchanged top-up behavior
});

test('"Not anymore?" removes the stale kitchen record, and it stays gone after reload', async ({ page }) => {
  await loadLocalApp(page);
  await page.evaluate(() => {
    AppState.pantry = [
      { id: 'buy_stale_garlic', name: 'Garlic', category: 'Vegetable', quantity: 1, unit: 'head', staple: false, updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'buy_keep_carrot', name: 'Carrot', category: 'Vegetable', quantity: 4, unit: 'pcs' }
    ];
    AppState.groceryList = [{ id: 910010, name: 'Garlic', category: 'Vegetable', quantity: 2, unit: 'head', checked: false }];
    saveData();
    showTab('grocery');
  });

  await expect(page.locator('.grocery-item .pantry-badge')).toHaveCount(1);
  await page.locator('.grocery-not-have-btn').click();
  await expect(page.locator('.not-in-kitchen-overlay .nik-name')).toHaveText(['Garlic']);
  await page.locator('.not-in-kitchen-overlay .nik-fix-btn').click();
  await expect(page.locator('.not-in-kitchen-overlay')).toHaveCount(0); // nothing left to correct

  const after = await page.evaluate(() => ({
    names: AppState.pantry.map((p) => p.name),
    tomb: !!(AppState.deletions.pantry || {})['buy_stale_garlic'],
    rowChecked: groceryItemChecked(AppState.groceryList[0])
  }));
  expect(after.names).toEqual(['Carrot']);
  expect(after.tomb).toBe(true);
  expect(after.rowChecked).toBe(false);
  await expect(page.locator('.grocery-item .pantry-badge')).toHaveCount(0);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForRestored(page, () => AppState.pantry.some((p) => p.name === 'Carrot'));
  const reloaded = await page.evaluate(() => ({
    names: AppState.pantry.map((p) => p.name),
    garlicInStock: isInPantry('Garlic')
  }));
  expect(reloaded.names).toEqual(['Carrot']);     // legit stock kept, stale one not resurrected
  expect(reloaded.garlicInStock).toBe(false);
});

test('a loose match never deletes unrelated stock: only the tapped record changes', async ({ page }) => {
  await loadLocalApp(page);
  const r = await page.evaluate(() => {
    AppState.pantry = [
      { id: 'buy_rice', name: 'Rice', category: 'Grain', quantity: 2, unit: 'kg', staple: false },
      { id: 'buy_vin', name: 'Rice Vinegar', category: 'Pantry', quantity: 1, unit: 'bottle', staple: false }
    ];
    AppState.groceryList = [{ id: 910020, name: 'Rice Vinegar', category: 'Pantry', quantity: 1, unit: 'bottle', checked: false }];
    const matched = pantryMatchesForShop('Rice Vinegar').map((p) => p.id).sort();
    correctKitchenStock('buy_vin');
    return {
      matched,
      left: AppState.pantry.map((p) => p.id),
      stillClaimsStock: isInPantry('Rice Vinegar') // Rice still loosely matches — shown honestly, not deleted
    };
  });
  expect(r.matched).toEqual(['buy_rice', 'buy_vin']);
  expect(r.left).toEqual(['buy_rice']);
  expect(r.stillClaimsStock).toBe(true);
});

test('a staple the user says is gone is marked empty, not deleted, and stops counting as in stock', async ({ page }) => {
  await loadLocalApp(page);
  const r = await page.evaluate(() => {
    AppState.pantry = [{ id: 'staple_soy', name: 'Soy Sauce', category: 'Pantry', staple: true, stockLevel: 'full' }];
    AppState.groceryList = [{ id: 910030, name: 'Soy Sauce', category: 'Pantry', quantity: 2, unit: 'tbsp', checked: false }];
    const before = isInPantry('Soy Sauce');
    const res = correctKitchenStock('staple_soy');
    return {
      before, res,
      still: AppState.pantry.map((p) => [p.id, p.stockLevel]),
      inStock: isInPantry('Soy Sauce'),
      plannedRowNeeded: !groceryItemChecked(AppState.groceryList.find((g) => g.id === 910030))
    };
  });
  expect(r.before).toBe(true);
  expect(r.res).toBe('empty');
  expect(r.still).toEqual([['staple_soy', 'empty']]); // still a staple, just empty
  expect(r.inStock).toBe(false);
  expect(r.plannedRowNeeded).toBe(true);              // back on the list to buy
});

// ── Pass 1: purchased is not prepared ───────────────────────────────────────

test('buying ingredients never creates a Fridge meal', async ({ page }) => {
  await loadLocalApp(page);
  const r = await page.evaluate(() => {
    AppState.pantry = [];
    AppState.cookedMeals = [];
    AppState.groceryList = [
      { id: 910040, name: 'Chicken Thigh', category: 'Protein', quantity: 1, unit: 'kg', checked: false },
      { id: 910041, name: 'Onion', category: 'Vegetable', quantity: 2, unit: 'pcs', checked: false },
      { id: 910042, name: 'Rice', category: 'Grain', quantity: 1, unit: 'kg', checked: false }
    ];
    [910040, 910041, 910042].forEach((id) => toggleGroceryItem(id));
    renderCookedMeals();
    return {
      pantry: AppState.pantry.length,
      cooked: AppState.cookedMeals.length,
      ready: getReadyFoodSuggestions(10).length,
      fridgeMealsText: document.getElementById('cooked-meals-list').textContent
    };
  });
  expect(r.pantry).toBe(3);        // raw ingredients on hand
  expect(r.cooked).toBe(0);        // not meals
  expect(r.ready).toBe(0);
  expect(r.fridgeMealsText).not.toContain('Chicken Thigh');
});

// ── Pass 2: planning without days ───────────────────────────────────────────

// Two recipes built for these tests: one fully described, one with most metadata
// missing, sharing Onion so the brief's shared-ingredient list has something to find.
function seedRecipes() {
  AppState.recipes.push({
    id: 'r_curry', name: 'Test Chicken Curry', category: 'Main Dish',
    baseServings: 4, currentServings: 4, basePrepTime: 15, baseCookTime: 40,
    activeTime: 20, effort: 'low', equipment: ['pan', 'rice-cooker'], tags: ['batch-friendly'],
    fridgeLife: 4, freezerLife: 60, storageNotes: 'Cool before boxing.',
    baseIngredients: [
      { name: 'Chicken Thigh', baseQuantity: 500, unit: 'g', category: 'Protein' },
      { name: 'Onion', baseQuantity: 2, unit: 'pcs', category: 'Vegetable' },
      { name: 'Curry Paste', baseQuantity: null, unit: '', category: 'Pantry' }
    ],
    instructions: '1. Brown the chicken.\n2. Add onion and paste; simmer 30 minutes at low heat.\n3. Portion into 4 boxes.',
    nutritionPerServing: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0 }
  });
  AppState.recipes.push({
    id: 'r_bare', name: 'Test Bare Salad', category: 'Main Dish',
    baseServings: 2, currentServings: 2,
    baseIngredients: [{ name: 'onion', baseQuantity: 1, unit: 'pcs', category: 'Vegetable' }],
    instructions: '',
    nutritionPerServing: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0 }
  });
  AppState.plannedBatches = [];
  AppState.groceryList = [];
  AppState.cookedMeals = [];
  AppState.pantry = [];
  ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].forEach((d) => {
    AppState.weeklyPlan[d] = { breakfast: null, lunch: null, dinner: null, snacks: [] };
  });
}

async function loadWithRecipes(page) {
  await loadLocalApp(page);
  await page.evaluate(seedRecipes);
}

test('a batch can be planned with no day, shops at its own servings, and survives reload', async ({ page }) => {
  await loadWithRecipes(page);
  const r = await page.evaluate(() => {
    const id = addPlannedBatch('r_curry');
    changePlannedBatchServings(id, 2); // 4 -> 6 servings
    const chicken = AppState.groceryList.find((g) => g.name === 'Chicken Thigh');
    const daysUsed = Object.values(AppState.weeklyPlan).some((d) =>
      d.breakfast || d.lunch || d.dinner || (d.snacks || []).length);
    return {
      batches: AppState.plannedBatches.map((b) => ({ recipeId: b.recipeId, servings: b.servings })),
      daysUsed,
      chickenQty: chicken && chicken.quantity,
      chickenSource: chicken && chicken.sources.join('|')
    };
  });
  expect(r.batches).toEqual([{ recipeId: 'r_curry', servings: 6 }]);
  expect(r.daysUsed).toBe(false);          // no day assignment required
  expect(r.chickenQty).toBe(750);          // 500 g for 4 -> 750 g for 6
  expect(r.chickenSource).toContain('6 servings');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForRestored(page, () => (AppState.plannedBatches || []).length === 1);
  const after = await page.evaluate(() => AppState.plannedBatches.map((b) => [b.recipeId, b.servings]));
  expect(after).toEqual([['r_curry', 6]]);
});

test('Plan tab: "+ Add meals" opens a full recipe picker; a tap adds a batch and it can be removed', async ({ page }) => {
  await loadWithRecipes(page);
  await page.evaluate(() => showTab('planner'));

  // All recipes are discoverable with no query and Low effort off by default.
  await page.click('.batch-plan-header >> text=+ Add meals');
  await expect(page.locator('#batch-picker-modal')).not.toHaveClass(/hidden/);
  await expect(page.locator('#batch-picker-low-effort-chip')).not.toHaveClass(/active/);
  await expect(page.locator('#batch-picker-results .batch-name')).toContainText(['Test Bare Salad']);

  await page.fill('#batch-picker-search', 'Test Chicken');
  await expect(page.locator('#batch-picker-results .batch-name')).toHaveText(['Test Chicken Curry']);
  await page.locator('#batch-picker-results .batch-add-btn').click();
  await expect(page.locator('#batch-picker-results .batch-picker-added')).toHaveText('Added ✓');
  await page.click('#batch-picker-modal .modal-footer >> text=Done');

  await expect(page.locator('#planned-batches-list .batch-name')).toHaveText(['Test Chicken Curry']);
  await expect(page.locator('#planned-batches-list .batch-servings')).toHaveText('4');
  await page.locator('#planned-batches-list .batch-remove-btn').click();
  await expect(page.locator('#planned-batches-list .batch-row')).toHaveCount(0);
  expect(await page.evaluate(() => AppState.plannedBatches.length)).toBe(0);
});

test('Plan tab: adding an already-planned recipe again does not create a duplicate row', async ({ page }) => {
  await loadWithRecipes(page);
  const r = await page.evaluate(() => {
    const first = addPlannedBatch('r_curry');
    const second = addPlannedBatch('r_curry');
    return { first, second, count: AppState.plannedBatches.length };
  });
  expect(r.second).toBe(r.first);
  expect(r.count).toBe(1);
});

test('the low-effort filter uses the existing effort signals; turning it off shows everything', async ({ page }) => {
  await loadWithRecipes(page);
  const r = await page.evaluate(() => {
    AppState.recipes.push({ id: 'r_hard', name: 'Test Hard Roast', baseServings: 4, currentServings: 4,
      effort: 'normal', baseIngredients: [], instructions: '' });
    return {
      lowEffort: getBatchSearchResults('Test', true, 10).map((x) => x.id),
      all: getBatchSearchResults('Test', false, 10).map((x) => x.id)
    };
  });
  expect(r.lowEffort).not.toContain('r_hard');
  expect(r.all).toContain('r_hard');
});

// ── Pass 3: prep -> fridge, and the AI Prep Brief ───────────────────────────

test('prepping a batch is what puts servings in the Fridge', async ({ page }) => {
  await loadWithRecipes(page);
  const r = await page.evaluate(() => {
    const id = addPlannedBatch('r_curry'); // 4 servings
    const cookedBefore = AppState.cookedMeals.length;
    completePlannedBatchNow(id);
    const meal = AppState.cookedMeals[AppState.cookedMeals.length - 1];
    return {
      cookedBefore,
      cookedAfter: AppState.cookedMeals.length,
      meal: meal && { recipeId: meal.recipeId, initial: meal.initialPortions, left: meal.portionsRemaining, storage: meal.storage },
      batchesLeft: AppState.plannedBatches.length,
      readyNames: getReadyFoodSuggestions(10).map((m) => m.name)
    };
  });
  expect(r.cookedBefore).toBe(0);
  expect(r.cookedAfter).toBe(1);
  expect(r.meal).toEqual({ recipeId: 'r_curry', initial: 4, left: 4, storage: 'fridge' });
  expect(r.batchesLeft).toBe(0);
  expect(r.readyNames).toEqual(['Test Chicken Curry']);
});

test('AI Prep Brief quotes source facts, scales amounts, lists shared ingredients, and marks missing data', async ({ page }) => {
  await loadWithRecipes(page);
  const r = await page.evaluate(() => {
    const id = addPlannedBatch('r_curry');
    changePlannedBatchServings(id, 4); // 8 servings = x2
    addPlannedBatch('r_bare');
    const a = getPrepBriefText();
    const b = getPrepBriefText();
    return { text: a, stable: a === b };
  });
  const t = r.text;
  expect(r.stable).toBe(true);
  expect(t).toContain('== 1. Test Chicken Curry — 8 servings');
  expect(t).toContain('amounts below scaled ×2');
  expect(t).toContain('Chicken Thigh — 1000 g');
  expect(t).toContain('Curry Paste — amount not stated');   // null quantity is never invented
  expect(t).toContain('1. Brown the chicken.');
  expect(t).toContain('2. Add onion and paste; simmer 30 minutes at low heat.');
  expect(t).toContain('Prep time: 15 min · Cook time: 40 min · Hands-on time: 20 min');
  expect(t).toContain('Equipment: Pan, Rice cooker');
  expect(t).toContain('Storage notes: Cool before boxing.');

  // The bare recipe: everything missing stays missing.
  const bare = t.slice(t.indexOf('== 2. Test Bare Salad'));
  expect(bare).toContain('Prep time: not stated · Cook time: not stated · Hands-on time: not stated');
  expect(bare).toContain('Equipment: not stated');
  expect(bare).toContain('Effort: not stated');
  expect(bare).toContain('Keeps: fridge not stated · freezer not stated');
  expect(bare).toMatch(/Instructions \(as written in the recipe\):\nnot stated/);
  expect(bare).not.toContain('0 min');

  // Shared ingredient matched case-insensitively across both recipes.
  expect(t).toContain('== Ingredients shared by more than one recipe');
  expect(t).toMatch(/- Onion: Test Chicken Curry \(4 pcs\); Test Bare Salad \(1 pcs\)/);
});

test('Copy AI Prep Brief copies exactly the deterministic brief', async ({ page }) => {
  await loadWithRecipes(page);
  await page.evaluate(() => {
    addPlannedBatch('r_curry');
    window.__copied = null;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (txt) => { window.__copied = txt; return Promise.resolve(); } }
    });
    showTab('prep');
  });
  await expect(page.locator('#prep-batches .batch-name')).toHaveText(['Test Chicken Curry']);
  await page.locator('#copy-prep-brief-btn').click();
  await page.waitForFunction(() => window.__copied !== null);
  const r = await page.evaluate(() => ({
    copied: window.__copied,
    expected: getPrepBriefText(),
    preview: document.getElementById('prep-brief-text').value
  }));
  expect(r.copied).toBe(r.expected);
  expect(r.preview).toBe(r.expected);
  expect(r.copied.startsWith('MEAL PREP BRIEF')).toBe(true);
});

// ── Home: meal-prep first ───────────────────────────────────────────────────

test('Home leads with the Plan -> Shop -> Prep -> Fridge flow; "what to cook" is demoted, not deleted', async ({ page }) => {
  await loadWithRecipes(page);
  const r = await page.evaluate(() => {
    addPlannedBatch('r_curry');
    showTab('dashboard');
    const html = document.getElementById('dashboard').innerHTML;
    const ideas = document.getElementById('dash-ideas');
    return {
      steps: Array.from(document.querySelectorAll('.dash-flow-label')).map((e) => e.textContent),
      planValue: document.querySelector('.dash-flow-value').textContent,
      flowFirst: html.indexOf('dash-card--prepflow') < html.indexOf('dash-ideas'),
      ideasOpen: ideas.open,
      suggestInsideIdeas: !!ideas.querySelector('.dash-card--suggest'),
      nav: Array.from(document.querySelectorAll('.tab-nav > .tab-btn')).map((b) => b.textContent.trim())
    };
  });
  expect(r.steps).toEqual(['Plan', 'Shop', 'Prep', 'Fridge']);
  expect(r.planValue).toBe('1 batch · 4 servings');
  expect(r.flowFirst).toBe(true);
  expect(r.ideasOpen).toBe(false);
  expect(r.suggestInsideIdeas).toBe(true);
  expect(r.nav).toEqual(['Home', 'Plan', 'Shop', 'Prep', 'Fridge', 'Recipes']);
});

test('390px: Plan batches, Prep and the Home flow card do not scroll sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadWithRecipes(page);
  await page.evaluate(() => { addPlannedBatch('r_curry'); addPlannedBatch('r_bare'); });
  const bad = [];
  for (const tab of ['dashboard', 'planner', 'prep']) {
    await page.evaluate((t) => {
      showTab(t);
      const d = document.getElementById('prep-brief-details');
      if (d) d.open = true;
    }, tab);
    await page.waitForTimeout(150);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 3) bad.push(tab + ' (+' + overflow + 'px)');
  }
  expect(bad).toEqual([]);
  const done = await page.locator('#prep-batches .batch-done-btn').first().boundingBox();
  expect(done.x + done.width).toBeLessThanOrEqual(390);
  expect(done.height).toBeGreaterThanOrEqual(30);
});

// ── Review fix: regenerating the Shop list must not wipe checkmarks ─────────
// changePlannedBatchServings() -> afterPlannedBatchesChange() -> generateGroceryList()
// used to rebuild every plan-generated row with checked: false, so tapping +/- on one
// batch silently un-bought everything else. State now carries over by the generator's
// OWN row identity: exact category + exact name.

function seedPlanRecipe() {
  AppState.recipes.push({
    id: 'r_plan', name: 'Test Garlic Rice Plate', category: 'Main Dish',
    baseServings: 2, currentServings: 2,
    baseIngredients: [
      { name: 'Test Garlic Only', baseQuantity: 3, unit: 'cloves', category: 'Vegetable' },
      { name: 'Rice', baseQuantity: 1, unit: 'cup', category: 'Grain' }
    ],
    instructions: '',
    nutritionPerServing: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0 }
  });
  AppState.weeklyPlan.Monday.dinner = 'r_plan';
}

test('REGRESSION: changing an unrelated batch\'s servings keeps a checked weekly-plan row checked (and its undo receipt)', async ({ page }) => {
  await loadWithRecipes(page);
  await page.evaluate(seedPlanRecipe);
  const r = await page.evaluate(() => {
    generateGroceryList();
    const rowA = AppState.groceryList.find((g) => g.name === 'Test Garlic Only');
    toggleGroceryItem(rowA.id);                         // bought
    const createdPantryId = rowA.stocked && rowA.stocked.pantryId;

    const batchId = addPlannedBatch('r_curry');          // independent batch
    changePlannedBatchServings(batchId, 1);              // the new +/- control

    const after = AppState.groceryList.find((g) => g.name === 'Test Garlic Only');
    const kept = { checked: after.checked, userSet: after.userSet, receipt: after.stocked && after.stocked.pantryId };
    toggleGroceryItem(after.id);                         // un-buy after regeneration
    return {
      createdPantryId, kept,
      undoWorked: !AppState.pantry.some((p) => String(p.id) === String(createdPantryId))
    };
  }, null);
  expect(r.kept.checked).toBe(true);
  expect(r.kept.userSet).toBe(true);
  expect(r.kept.receipt).toBe(r.createdPantryId);        // receipt survives, so...
  expect(r.undoWorked).toBe(true);                       // ...unchecking still undoes exactly
});

test('REGRESSION: a checked batch ingredient stays checked when that batch\'s servings change; quantity updates', async ({ page }) => {
  await loadWithRecipes(page);
  const r = await page.evaluate(() => {
    const batchId = addPlannedBatch('r_curry');          // 4 servings -> 500 g chicken
    const row = AppState.groceryList.find((g) => g.name === 'Chicken Thigh');
    const before = row.quantity;
    toggleGroceryItem(row.id);
    changePlannedBatchServings(batchId, 2);              // 6 servings -> 750 g
    const after = AppState.groceryList.find((g) => g.name === 'Chicken Thigh');
    return { before, qty: after.quantity, checked: after.checked };
  });
  expect(r.before).toBe(500);
  expect(r.qty).toBe(750);
  expect(r.checked).toBe(true);
});

test('regeneration: a removed ingredient leaves no ghost row, a new one starts unchecked, custom rows are untouched', async ({ page }) => {
  await loadWithRecipes(page);
  await page.evaluate(seedPlanRecipe);
  const r = await page.evaluate(() => {
    AppState.groceryList.push({ id: 920001, name: 'Paper Towels', category: 'Other', quantity: null, unit: '',
      sources: [], checked: true, userSet: true, custom: true });
    const batchId = addPlannedBatch('r_curry');
    const chicken = AppState.groceryList.find((g) => g.name === 'Chicken Thigh');
    toggleGroceryItem(chicken.id);
    removePlannedBatch(batchId);                         // Chicken Thigh genuinely disappears
    const ghost = AppState.groceryList.some((g) => g.name === 'Chicken Thigh');
    addPlannedBatch('r_bare');                           // brings a genuinely new row: 'onion'
    const onion = AppState.groceryList.find((g) => g.name === 'onion');
    const custom = AppState.groceryList.find((g) => g.id === 920001);
    return {
      ghost,
      onionChecked: onion.checked, onionUserSet: !!onion.userSet, onionReceipt: onion.stocked || null,
      custom: custom && { checked: custom.checked, userSet: custom.userSet, custom: custom.custom }
    };
  });
  expect(r.ghost).toBe(false);
  expect(r.onionChecked).toBe(false);
  expect(r.onionUserSet).toBe(false);
  expect(r.onionReceipt).toBeNull();
  expect(r.custom).toEqual({ checked: true, userSet: true, custom: true });
});

test('regeneration identity is exact: a checked "Rice" never lends its state to "Rice Vinegar"', async ({ page }) => {
  await loadWithRecipes(page);
  await page.evaluate(seedPlanRecipe);
  const r = await page.evaluate(() => {                                    // plan brings 'Rice' (Grain)
    generateGroceryList();
    const rice = AppState.groceryList.find((g) => g.name === 'Rice');
    toggleGroceryItem(rice.id);
    AppState.recipes.push({ id: 'r_vin', name: 'Test Pickle', baseServings: 1, currentServings: 1,
      baseIngredients: [{ name: 'Rice Vinegar', baseQuantity: 2, unit: 'tbsp', category: 'Grain' }],
      instructions: '' });
    addPlannedBatch('r_vin');
    const vin = AppState.groceryList.find((g) => g.name === 'Rice Vinegar');
    const rice2 = AppState.groceryList.find((g) => g.name === 'Rice');
    return { vinChecked: vin.checked, vinUserSet: !!vin.userSet, vinReceipt: vin.stocked || null, riceChecked: rice2.checked };
  });
  expect(r.riceChecked).toBe(true);
  expect(r.vinChecked).toBe(false);
  expect(r.vinUserSet).toBe(false);
  expect(r.vinReceipt).toBeNull();
});

test('Home empty state points to the Fridge, not a tab named Inventory', async ({ page }) => {
  await loadLocalApp(page);
  const text = await page.evaluate(() => {
    AppState.pantry = [];
    showTab('dashboard');
    return document.getElementById('dash-ideas').textContent;
  });
  expect(text).toContain('Add items to Fridge to see what you can make.');
  expect(text).not.toMatch(/\bInventory\b/);
});
