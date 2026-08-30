const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');
const { waitForAppReady, waitForRestored } = require('./app-ready');

/**
 * TASK-058 follow-up, corrective pass after adversarial review (P1-A/P1-B/P1-C).
 *
 * P1-A: the repair now derives every corrected value at RUN TIME from each
 * recipe's own CURRENT stored instructions via the real parseRecipeText() —
 * TARGET_RECIPES holds only {name, id} identity, never a repair value.
 *
 * P1-B: equipment/effort/tags are protected by GENERAL conflict detection
 * (empty current -> apply derived; non-empty and differing -> preserve +
 * report; matching -> no-op) that applies uniformly to all 5 targets, not a
 * per-recipe-name special case. Instructions are only ever replaced when the
 * current text still shows a provable pollution signature.
 *
 * P1-C: calculateScaledQuantity() now returns null (not 0) for an explicit
 * unresolved baseQuantity, and its consumers (grocery aggregation, costing,
 * nutrition) were updated to treat that null as "no info", never NaN or a
 * fabricated number.
 */

const WEEKLY_PLAN_EMPTY = {
  Monday: { breakfast: null, lunch: null, dinner: null, snacks: [] },
  Tuesday: { breakfast: null, lunch: null, dinner: null, snacks: [] },
  Wednesday: { breakfast: null, lunch: null, dinner: null, snacks: [] },
  Thursday: { breakfast: null, lunch: null, dinner: null, snacks: [] },
  Friday: { breakfast: null, lunch: null, dinner: null, snacks: [] },
  Saturday: { breakfast: null, lunch: null, dinner: null, snacks: [] },
  Sunday: { breakfast: null, lunch: null, dinner: null, snacks: [] }
};

function baseRecipeShape(overrides) {
  return Object.assign({
    category: 'Main Dish', basePrepTime: 15, baseCookTime: 30, baseServings: 4, currentServings: 4,
    fridgeLife: 3, freezerLife: 30, estimatedCost: 0, costPerServing: 0, storageNotes: '', photo: null,
    equipment: [], tags: [], effort: null, activeTime: null,
    mealBalance: { protein: false, vegetables: false, carb: false },
    nutritionPerServing: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0 },
    updatedAt: '2026-08-30T04:15:58.534Z'
  }, overrides);
}

function buildSeed(recipes, extra) {
  return Object.assign({
    recipes,
    weeklyPlan: JSON.parse(JSON.stringify(WEEKLY_PLAN_EMPTY)),
    groceryList: [], nutritionGoals: {}, customIngredients: [], customHacks: [],
    flavors: [], preparedFlavors: [], pantry: [], userIngredients: [], ingredientPrices: {},
    myStores: [], customStores: [],
    cookedMeals: [{ id: 'cm_test_1', recipeId: 1, name: 'Sinangag leftovers', cookedDate: '2026-08-20', portionsRemaining: 1, initialPortions: 1, fridgeLife: 2, freezerLife: 30, storage: 'fridge', updatedAt: '2026-08-20T00:00:00.000Z' }],
    cookHistory: [{ recipeId: '1788063044644', cookedAt: '2026-08-28T00:00:00.000Z' }],
    recentRecipes: ['1788063044644', '1'],
    prepModeSession: null, deletions: {}, version: 1, lastSaved: new Date().toISOString()
  }, extra);
}

const SINANGAG_CONTROL = baseRecipeShape({
  id: 1, name: 'Sinangag', category: 'Breakfast', baseServings: 2, currentServings: 2,
  basePrepTime: 5, baseCookTime: 10, fridgeLife: 2, freezerLife: 30,
  instructions: 'Crush and fry garlic in oil until golden. Add day-old rice, break clumps, season with salt. Stir-fry until heated through. Top with green onion.',
  baseIngredients: [
    { category: 'Grain', baseQuantity: 2, unit: 'cups cooked', name: 'White Rice (Bigas)' },
    { category: 'Vegetable', name: 'Garlic (Bawang)', baseQuantity: 6, unit: 'cloves' }
  ],
  nutritionPerServing: { calories: 290, protein: 5, sodium: 290, fat: 7, fiber: 1, carbs: 52 }
});

// The 5 real target recipes' genuine polluted state (byte-exact source text,
// mojibake included — that encoding issue is separate and out of scope).
function realTargets() {
  return [
    baseRecipeShape({
      id: '1788062745911', name: 'Buffalo Ranch Chicken',
      instructions: 'Add chicken, buffalo sauce, ranch, optional cream cheese, garlic powder, salt, and pepper to a freezer-safe bag. Mix well.\nFreeze.\nWhen ready to cook, thaw overnight in the refrigerator.\nCook in a crockpot on LOW for 5â€“6 hours for shredded chicken, or bake at 400Â°F (205Â°C) for 25â€“30 minutes.\nTop with green onion.\nServe over rice, in wraps, or with roasted potatoes.\nEquipment:\nSlow cooker, Oven\nEffort:\nVery low\nTags:\nFreezer-friendly, Batch-friendly',
      baseIngredients: [
        { name: '2â€“3 lb chicken breasts or tenders', baseQuantity: 1, unit: 'pieces', category: 'Protein' },
        { name: 'buffalo sauce', baseQuantity: 0.75, unit: 'cups', category: 'Pantry' },
        { name: 'ranch', baseQuantity: 0.25, unit: 'cups', category: 'Pantry' },
        { name: 'cream cheese', baseQuantity: 1, unit: 'tbsp', category: 'Dairy' },
        { name: 'garlic powder', baseQuantity: 1, unit: 'tsp', category: 'Vegetable' },
        { name: 'Salt', baseQuantity: 1, unit: 'pieces', category: 'Pantry' },
        { name: 'Black pepper', baseQuantity: 1, unit: 'pieces', category: 'Pantry' },
        { name: 'Green onion', baseQuantity: 1, unit: 'pieces', category: 'Vegetable' }
      ],
      // Manually corrected by the user after import: effort/tags already match
      // the parser's derived output; equipment does not. A real conflict.
      equipment: ['instant-pot', 'oven'], tags: ['batch-friendly', 'freezer-friendly'], effort: 'very-low',
      mealBalance: { protein: true, vegetables: false, carb: true }
    }),
    baseRecipeShape({
      id: 1788062988950, name: 'Honey Mustard Chicken',
      instructions: 'Add chicken, honey, Dijon mustard, olive oil, garlic powder, onion powder, salt, pepper, and herbs to a freezer-safe bag. Mix well.\nFreeze.\nWhen ready to cook, thaw overnight in the refrigerator.\nBake at 400Â°F (205Â°C) for 25â€“30 minutes or air fry at 375Â°F (190Â°C) for 15â€“18 minutes.\nServe with potatoes or green beans.\nEquipment:\nOven, Air fryer\nEffort:\nVery low\nTags:\nFreezer-friendly, Batch-friendly, Minimal-cleanup',
      baseIngredients: [
        { name: '2â€“3 lb chicken breasts or tenders', baseQuantity: 1, unit: 'pieces', category: 'Protein' },
        { name: 'honey', baseQuantity: 0.5, unit: 'cups', category: 'Pantry' },
        { name: 'Dijon mustard', baseQuantity: 0.33, unit: 'cups', category: 'Pantry' },
        { name: 'olive oil', baseQuantity: 1, unit: 'tbsp', category: 'Pantry' },
        { name: 'garlic powder', baseQuantity: 1, unit: 'tsp', category: 'Vegetable' },
        { name: 'onion powder', baseQuantity: 1, unit: 'tsp', category: 'Vegetable' },
        { name: 'Salt', baseQuantity: 1, unit: 'pieces', category: 'Pantry' },
        { name: 'Black pepper', baseQuantity: 1, unit: 'pieces', category: 'Pantry' },
        { name: 'Parsley or thyme', baseQuantity: 1, unit: 'pieces', category: 'Pantry' }
      ]
    }),
    baseRecipeShape({
      id: 1788063014896, name: 'Pineapple Teriyaki Chicken',
      instructions: 'Add chicken, teriyaki sauce, pineapple juice, soy sauce, garlic, ginger, and pineapple chunks to a freezer-safe bag. Mix well.\nFreeze.\nWhen ready to cook, thaw overnight in the refrigerator.\nCook in a crockpot on LOW for 5â€“6 hours, or bake at 400Â°F (205Â°C) for 25â€“30 minutes.\nGarnish with green onion and sesame seeds.\nServe over rice with broccoli.\nEquipment:\nSlow cooker, Oven\nEffort:\nVery low\nTags:\nFreezer-friendly, Batch-friendly, Minimal-cleanup',
      baseIngredients: [
        { name: '2â€“3 lb chicken breasts or thighs', baseQuantity: 1, unit: 'pieces', category: 'Protein' },
        { name: 'teriyaki sauce', baseQuantity: 1, unit: 'cups', category: 'Pantry' },
        { name: 'pineapple juice', baseQuantity: 0.5, unit: 'cups', category: 'Fruit' },
        { name: 'soy sauce', baseQuantity: 1, unit: 'tbsp', category: 'Pantry' },
        { name: 'garlic', baseQuantity: 2, unit: 'cloves', category: 'Vegetable' },
        { name: 'ginger', baseQuantity: 1, unit: 'tsp', category: 'Vegetable' },
        { name: 'Pineapple chunks', baseQuantity: 1, unit: 'pieces', category: 'Fruit' },
        { name: 'Green onion', baseQuantity: 1, unit: 'pieces', category: 'Vegetable' },
        { name: 'Sesame seeds', baseQuantity: 1, unit: 'pieces', category: 'Pantry' }
      ]
    }),
    baseRecipeShape({
      id: 1788063044644, name: 'Honey Garlic Chicken',
      instructions: 'Add chicken, honey, soy sauce, garlic, olive oil, and green onions to a freezer-safe bag. Mix well to coat the chicken.\nFreeze.\nWhen ready to cook, thaw overnight in the refrigerator.\nCook in a crockpot on LOW for 4â€“6 hours, or cook on the stovetop until the chicken is fully cooked.\nServe with rice and vegetables.\nEquipment:\nSlow cooker, Pan\nEffort:\nVery low\nTags:\nFreezer-friendly, Batch-friendly, Minimal-cleanup',
      baseIngredients: [
        { name: '1â€“1.5 lb chicken', baseQuantity: 1, unit: 'pieces', category: 'Protein' },
        { name: 'honey', baseQuantity: 0.25, unit: 'cups', category: 'Pantry' },
        { name: 'soy sauce', baseQuantity: 0.25, unit: 'cups', category: 'Pantry' },
        { name: '3â€“4 cloves garlic', baseQuantity: 1, unit: 'pieces', category: 'Vegetable' },
        { name: '1â€“2 tbsp olive oil', baseQuantity: 1, unit: 'pieces', category: 'Pantry' },
        { name: '1â€“2 green onions', baseQuantity: 1, unit: 'pieces', category: 'Vegetable' }
      ]
    }),
    baseRecipeShape({
      id: 1788063069099, name: 'Lemon Chicken',
      instructions: 'Add chicken, olive oil, lemon juice, garlic, Italian seasoning, salt, pepper, and lemon slices to a freezer-safe bag. Mix well to coat the chicken.\nFreeze.\nWhen ready to cook, thaw overnight in the refrigerator.\nBake at 375Â°F (190Â°C) or cook on the stovetop until the chicken is fully cooked.\nServe with rice, potatoes, or vegetables.\nEquipment:\nOven, Pan\nEffort:\nVery low\nTags:\nFreezer-friendly, Batch-friendly, Minimal-cleanup',
      baseIngredients: [
        { name: '1â€“1.5 lb chicken', baseQuantity: 1, unit: 'pieces', category: 'Protein' },
        { name: 'olive oil', baseQuantity: 0.25, unit: 'cups', category: 'Pantry' },
        { name: 'Juice of 1â€“2 lemons', baseQuantity: 1, unit: 'pieces', category: 'Fruit' },
        { name: '2â€“3 cloves garlic', baseQuantity: 1, unit: 'pieces', category: 'Vegetable' },
        { name: 'Italian seasoning', baseQuantity: 1, unit: 'tsp', category: 'Pantry' },
        { name: 'Salt', baseQuantity: 1, unit: 'pieces', category: 'Pantry' },
        { name: 'Black pepper', baseQuantity: 1, unit: 'pieces', category: 'Pantry' },
        { name: '1â€“2 lemon slices', baseQuantity: 1, unit: 'pieces', category: 'Fruit' }
      ]
    })
  ];
}

async function loadLocalApp(page, seed) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript((s) => {
    try {
      if (localStorage.getItem('__repairTestBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('mealPrepAppData', JSON.stringify(s));
      localStorage.setItem('__repairTestBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
  }, seed);
  await page.goto(pathToFileURL(path.resolve('index.html')).href, { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
}

const TARGET_NAMES = ['Buffalo Ranch Chicken', 'Honey Mustard Chicken', 'Pineapple Teriyaki Chicken', 'Honey Garlic Chicken', 'Lemon Chicken'];

// ── Phase 9: full happy-path proof against the real 5-recipe shape ──────────

test('repairs the 5 matched recipes: instructions cleaned, provable range quantities fixed, ids/counts/unrelated data untouched', async ({ page }) => {
  const seed = buildSeed([SINANGAG_CONTROL, ...realTargets()]);
  await loadLocalApp(page, seed);

  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (msg) => { if (msg.type() === 'error' && !/net::ERR_FAILED/.test(msg.text())) consoleErrors.push(msg.text()); });

  const before = await page.evaluate(() => ({
    recipeCount: AppState.recipes.length,
    control: JSON.parse(JSON.stringify(AppState.recipes.find((r) => r.id === 1))),
    weeklyPlan: JSON.parse(JSON.stringify(AppState.weeklyPlan)),
    cookedMeals: JSON.parse(JSON.stringify(AppState.cookedMeals)),
    cookHistory: JSON.parse(JSON.stringify(AppState.cookHistory))
  }));

  const report = await page.evaluate(() => oneTimeRepairEightPastedChickenRecipes());

  // Exactly these 5 records were targeted; none skipped as missing/ambiguous.
  expect(report.repaired.map((r) => r.name).sort()).toEqual([...TARGET_NAMES].sort());
  expect(report.skipped).toEqual([]);
  // The 3 absent titles were never in scope and remain absent.
  const stillAbsent = await page.evaluate(() => ['Greek Style Chicken', 'Basil Balsamic Chicken', 'Pesto Mozzarella Chicken'].map((n) => AppState.recipes.some((r) => r.name === n)));
  expect(stillAbsent).toEqual([false, false, false]);

  const after = await page.evaluate((names) => {
    const out = { recipeCount: AppState.recipes.length, targets: {} };
    names.forEach((n) => {
      const matches = AppState.recipes.filter((r) => r.name === n);
      out.targets[n] = { count: matches.length, recipe: matches[0] };
    });
    out.control = AppState.recipes.find((r) => r.id === 1);
    out.weeklyPlan = AppState.weeklyPlan;
    out.cookedMeals = AppState.cookedMeals;
    out.cookHistory = AppState.cookHistory;
    return out;
  }, TARGET_NAMES);

  expect(after.recipeCount).toBe(before.recipeCount);
  expect(after.control).toEqual(before.control); // Sinangag byte-identical
  expect(after.weeklyPlan).toEqual(before.weeklyPlan);
  expect(after.cookedMeals).toEqual(before.cookedMeals);
  expect(after.cookHistory).toEqual(before.cookHistory);

  for (const name of TARGET_NAMES) {
    const t = after.targets[name];
    expect(t.count).toBe(1);
    expect(t.recipe.instructions).not.toMatch(/Equipment:|Effort:|Tags:/);
  }

  // ids preserved, including Buffalo Ranch Chicken's string id.
  expect(after.targets['Buffalo Ranch Chicken'].recipe.id).toBe('1788062745911');
  expect(typeof after.targets['Buffalo Ranch Chicken'].recipe.id).toBe('string');
  expect(after.targets['Honey Mustard Chicken'].recipe.id).toBe(1788062988950);
  expect(after.targets['Pineapple Teriyaki Chicken'].recipe.id).toBe(1788063014896);
  expect(after.targets['Honey Garlic Chicken'].recipe.id).toBe(1788063044644);
  expect(after.targets['Lemon Chicken'].recipe.id).toBe(1788063069099);

  // Buffalo Ranch's genuine conflict is preserved, general logic (not name-special-cased).
  const branch = after.targets['Buffalo Ranch Chicken'].recipe;
  expect(branch.equipment).toEqual(['instant-pot', 'oven']);
  expect(branch.mealBalance).toEqual({ protein: true, vegetables: false, carb: true });
  expect(branch.fridgeLife).toBe(3);

  // Where there was no conflict, derived equipment/effort/tags were applied.
  expect(after.targets['Honey Garlic Chicken'].recipe.equipment).toEqual(['pan']);
  expect(after.targets['Lemon Chicken'].recipe.equipment).toEqual(['oven', 'pan']);
  expect(after.targets['Honey Mustard Chicken'].recipe.effort).toBe('very-low');

  // Ingredient proof: only textually-provable ranges are fixed; bare-word
  // "1 piece"-shaped ingredients are left exactly as stored (ambiguous, not
  // repaired — see P1-A/Phase 4).
  const honeyGarlic = after.targets['Honey Garlic Chicken'].recipe.baseIngredients;
  expect(honeyGarlic.every((i) => !(i.baseQuantity === 1 && i.unit === 'pieces'))).toBe(true); // all 4 were range-provable
  const branchIngredients = after.targets['Buffalo Ranch Chicken'].recipe.baseIngredients;
  const salt = branchIngredients.find((i) => i.name === 'Salt');
  expect(salt.baseQuantity).toBe(1); // left untouched — ambiguous, not provably corrupt
  expect(salt.unit).toBe('pieces');
  const branchChicken = branchIngredients.find((i) => /chicken/.test(i.name));
  expect(branchChicken.baseQuantity).toBeNull(); // range-provable, repaired

  expect(consoleErrors).toEqual([]);
});

test('running the repair twice produces zero additional mutation (idempotent)', async ({ page }) => {
  const seed = buildSeed([SINANGAG_CONTROL, ...realTargets()]);
  await loadLocalApp(page, seed);

  await page.evaluate(() => oneTimeRepairEightPastedChickenRecipes());
  await page.waitForTimeout(200);
  const snapshot1 = await page.evaluate(() => JSON.parse(JSON.stringify(AppState.recipes)));

  const report2 = await page.evaluate(() => oneTimeRepairEightPastedChickenRecipes());
  await page.waitForTimeout(200);
  const snapshot2 = await page.evaluate(() => JSON.parse(JSON.stringify(AppState.recipes)));

  expect(report2.repaired).toEqual([]);
  expect(snapshot2).toEqual(snapshot1);
});

test('the repair survives a save/reload round trip, including unresolved (null) ingredient quantities', async ({ page }) => {
  const seed = buildSeed([SINANGAG_CONTROL, ...realTargets()]);
  await loadLocalApp(page, seed);

  await page.evaluate(() => oneTimeRepairEightPastedChickenRecipes());
  await page.waitForTimeout(200);
  const beforeReload = await page.evaluate(() => AppState.recipes.find((r) => r.name === 'Lemon Chicken'));

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForRestored(page, () => AppState.recipes.some((r) => r.name === 'Lemon Chicken'));

  const afterReload = await page.evaluate(() => AppState.recipes.find((r) => r.name === 'Lemon Chicken'));
  expect(afterReload).toEqual(beforeReload);
  const chicken = afterReload.baseIngredients.find((i) => /chicken$/.test(i.name) && i.unit === '');
  expect(chicken.baseQuantity).toBeNull();
});

test('the repair survives an export -> import round trip', async ({ page }) => {
  const seed = buildSeed([SINANGAG_CONTROL, ...realTargets()]);
  await loadLocalApp(page, seed);
  await page.evaluate(() => oneTimeRepairEightPastedChickenRecipes());
  await page.waitForTimeout(200);

  const exportedPayload = await page.evaluate(() => new Promise((resolve) => {
    const orig = URL.createObjectURL;
    URL.createObjectURL = function (blob) {
      blob.text().then((text) => resolve(JSON.parse(text)));
      return orig.call(URL, blob);
    };
    exportData();
  }));

  const merged = await page.evaluate((payload) => {
    const real = AppState.recipes;
    AppState.recipes = [];
    AppState.recipes = unionById(AppState.recipes, payload.recipes || []);
    const lemon = AppState.recipes.find((r) => r.name === 'Lemon Chicken');
    const chicken = lemon.baseIngredients.find((i) => /chicken$/.test(i.name) && i.unit === '');
    const out = { instructionsClean: !/Equipment:/.test(lemon.instructions), equipment: lemon.equipment, chickenQtyIsNull: chicken.baseQuantity === null };
    AppState.recipes = real;
    return out;
  }, exportedPayload);

  expect(merged.instructionsClean).toBe(true);
  expect(merged.equipment).toEqual(['oven', 'pan']);
  expect(merged.chickenQtyIsNull).toBe(true);
});

test('ambiguous title matching stops safely instead of guessing', async ({ page }) => {
  const targets = realTargets();
  const lemon = targets.find((r) => r.name === 'Lemon Chicken');
  const dup = JSON.parse(JSON.stringify(lemon));
  dup.id = 'zz-duplicate-lemon-chicken';
  const seed = buildSeed([SINANGAG_CONTROL, ...targets, dup]);

  await loadLocalApp(page, seed);
  const report = await page.evaluate(() => oneTimeRepairEightPastedChickenRecipes());

  const skippedNames = report.skipped.map((s) => s.name);
  expect(skippedNames).toContain('Lemon Chicken');

  const copies = await page.evaluate(() => AppState.recipes.filter((r) => r.name === 'Lemon Chicken'));
  expect(copies.length).toBe(2);
  copies.forEach((r) => expect(r.instructions).toMatch(/Equipment:/));

  const repairedNames = report.repaired.map((r) => r.name).sort();
  expect(repairedNames).toEqual(['Buffalo Ranch Chicken', 'Honey Garlic Chicken', 'Honey Mustard Chicken', 'Pineapple Teriyaki Chicken']);
});

// ── Phase 7: general conflict-protection tests (A-F) ────────────────────────
// Deliberately spread across different target identities, not just Buffalo
// Ranch, to prove the protection is general logic, not a per-name special case.

test('7A: polluted recipe with empty metadata is safely repaired', async ({ page }) => {
  const seed = buildSeed([realTargets().find((r) => r.name === 'Honey Garlic Chicken')]);
  await loadLocalApp(page, seed);
  const report = await page.evaluate(() => oneTimeRepairEightPastedChickenRecipes());
  expect(report.repaired.length).toBe(1);
  expect(report.conflicts).toEqual([]);
  const recipe = await page.evaluate(() => AppState.recipes.find((r) => r.name === 'Honey Garlic Chicken'));
  expect(recipe.instructions).not.toMatch(/Equipment:/);
  expect(recipe.equipment).toEqual(['pan']);
  expect(recipe.effort).toBe('very-low');
});

test('7B: polluted recipe with a manually-changed equipment preserves it', async ({ page }) => {
  const target = JSON.parse(JSON.stringify(realTargets().find((r) => r.name === 'Honey Mustard Chicken')));
  target.equipment = ['microwave']; // manual edit, differs from derived ['oven']
  const seed = buildSeed([target]);
  await loadLocalApp(page, seed);
  const report = await page.evaluate(() => oneTimeRepairEightPastedChickenRecipes());
  const recipe = await page.evaluate(() => AppState.recipes.find((r) => r.name === 'Honey Mustard Chicken'));
  expect(recipe.equipment).toEqual(['microwave']); // preserved, not overwritten
  expect(recipe.instructions).not.toMatch(/Equipment:/); // instructions still safely repaired
  expect(report.conflicts.some((c) => c.name === 'Honey Mustard Chicken' && c.conflicts.some((f) => f.field === 'equipment'))).toBe(true);
});

test('7C: polluted recipe with a manually-changed effort preserves it', async ({ page }) => {
  const target = JSON.parse(JSON.stringify(realTargets().find((r) => r.name === 'Pineapple Teriyaki Chicken')));
  target.effort = 'low'; // manual edit, differs from derived 'very-low'
  const seed = buildSeed([target]);
  await loadLocalApp(page, seed);
  const report = await page.evaluate(() => oneTimeRepairEightPastedChickenRecipes());
  const recipe = await page.evaluate(() => AppState.recipes.find((r) => r.name === 'Pineapple Teriyaki Chicken'));
  expect(recipe.effort).toBe('low');
  expect(recipe.instructions).not.toMatch(/Equipment:/);
  expect(report.conflicts.some((c) => c.name === 'Pineapple Teriyaki Chicken' && c.conflicts.some((f) => f.field === 'effort'))).toBe(true);
});

test('7D: polluted recipe with manually-changed tags preserves them', async ({ page }) => {
  const target = JSON.parse(JSON.stringify(realTargets().find((r) => r.name === 'Lemon Chicken')));
  target.tags = ['shortcut']; // manual edit, differs from derived set
  const seed = buildSeed([target]);
  await loadLocalApp(page, seed);
  const report = await page.evaluate(() => oneTimeRepairEightPastedChickenRecipes());
  const recipe = await page.evaluate(() => AppState.recipes.find((r) => r.name === 'Lemon Chicken'));
  expect(recipe.tags).toEqual(['shortcut']);
  expect(recipe.instructions).not.toMatch(/Equipment:/);
  expect(report.conflicts.some((c) => c.name === 'Lemon Chicken' && c.conflicts.some((f) => f.field === 'tags'))).toBe(true);
});

test('7E: instructions that no longer show the known pollution signature are preserved, repair skips', async ({ page }) => {
  const target = JSON.parse(JSON.stringify(realTargets().find((r) => r.name === 'Buffalo Ranch Chicken')));
  // Manually rewritten — no recognizable Equipment:/Effort:/Tags: heading left.
  target.instructions = 'This recipe has been rewritten to use only the oven, per a note from the cook.';
  target.equipment = ['oven']; // already set some other way
  // Ingredient repair is a separate, independent proof (Tier 1 stands on its
  // own regardless of the instructions gate — see 7A-D and Phase 4). Use only
  // bare-word ambiguous ingredients here so this test isolates the
  // instructions/metadata decision specifically.
  target.baseIngredients = [{ name: 'Salt', baseQuantity: 1, unit: 'pieces', category: 'Pantry' }];
  const seed = buildSeed([target]);
  await loadLocalApp(page, seed);
  const report = await page.evaluate(() => oneTimeRepairEightPastedChickenRecipes());
  const recipe = await page.evaluate(() => AppState.recipes.find((r) => r.name === 'Buffalo Ranch Chicken'));
  expect(recipe.instructions).toBe('This recipe has been rewritten to use only the oven, per a note from the cook.');
  expect(recipe.equipment).toEqual(['oven']); // untouched, never compared/derived without the pollution signature
  expect(recipe.baseIngredients[0]).toEqual({ name: 'Salt', baseQuantity: 1, unit: 'pieces', category: 'Pantry' }); // ambiguous, untouched
  expect(report.skipped.some((s) => s.name === 'Buffalo Ranch Chicken')).toBe(true);
  expect(report.repaired).toEqual([]);
});

test('7F: run twice on a manual-edit fixture — second run makes no further change', async ({ page }) => {
  const target = JSON.parse(JSON.stringify(realTargets().find((r) => r.name === 'Honey Mustard Chicken')));
  target.equipment = ['microwave'];
  const seed = buildSeed([target]);
  await loadLocalApp(page, seed);
  await page.evaluate(() => oneTimeRepairEightPastedChickenRecipes());
  await page.waitForTimeout(150);
  const snap1 = await page.evaluate(() => JSON.parse(JSON.stringify(AppState.recipes)));
  const report2 = await page.evaluate(() => oneTimeRepairEightPastedChickenRecipes());
  await page.waitForTimeout(150);
  const snap2 = await page.evaluate(() => JSON.parse(JSON.stringify(AppState.recipes)));
  expect(report2.repaired).toEqual([]);
  expect(snap2).toEqual(snap1);
});

// ── Phase 8: downstream null-quantity propagation tests ─────────────────────

test('8.1/8.2/8.3: normalizeRecipes preserves null, preserves real 0, defaults only a truly-missing field', async ({ page }) => {
  const seed = buildSeed([
    baseRecipeShape({ id: 'null-test', name: 'Null Test', baseIngredients: [{ name: 'unresolved', baseQuantity: null, unit: '', category: 'Protein' }], instructions: 'x' }),
    baseRecipeShape({ id: 'zero-test', name: 'Zero Test', baseIngredients: [{ name: 'garnish', baseQuantity: 0, unit: 'g', category: 'Pantry' }], instructions: 'x' }),
    baseRecipeShape({ id: 'missing-test', name: 'Missing Test', baseIngredients: [{ name: 'legacy', unit: 'g', category: 'Pantry' }], instructions: 'x' })
  ]);
  await loadLocalApp(page, seed);
  const result = await page.evaluate(() => ({
    unresolved: AppState.recipes.find((r) => r.id === 'null-test').baseIngredients[0].baseQuantity,
    zero: AppState.recipes.find((r) => r.id === 'zero-test').baseIngredients[0].baseQuantity,
    missing: AppState.recipes.find((r) => r.id === 'missing-test').baseIngredients[0].baseQuantity
  }));
  expect(result.unresolved).toBeNull();
  expect(result.zero).toBe(0);
  expect(result.missing).toBe(0); // pre-existing legacy default, unchanged
});

test('8.4: calculateScaledQuantity never turns null into 0, and preserves real 0/number/legacy-missing behavior', async ({ page }) => {
  const seed = buildSeed([SINANGAG_CONTROL]);
  await loadLocalApp(page, seed);
  const result = await page.evaluate(() => {
    const recipe = { baseServings: 2, currentServings: 4 };
    return {
      forNull: calculateScaledQuantity(recipe, { baseQuantity: null }),
      forZero: calculateScaledQuantity(recipe, { baseQuantity: 0 }),
      forNumber: calculateScaledQuantity(recipe, { baseQuantity: 2 }),
      forMissing: calculateScaledQuantity(recipe, {})
    };
  });
  expect(result.forNull).toBeNull();
  expect(result.forZero).toBe(0);
  expect(result.forNumber).toBe(4); // 2 * (4/2)
  expect(Number.isNaN(result.forMissing)).toBe(true); // legacy behavior, unchanged
});

test('8.5: grocery generation never fabricates a numeric quantity for an unresolved ingredient', async ({ page }) => {
  const seed = buildSeed([
    baseRecipeShape({
      id: 'grocery-test', name: 'Grocery Test',
      baseIngredients: [
        { name: 'unresolved range item', baseQuantity: null, unit: '', category: 'Protein' },
        { name: 'known amount', baseQuantity: 200, unit: 'g', category: 'Pantry' }
      ],
      instructions: 'x'
    })
  ], { weeklyPlan: Object.assign(JSON.parse(JSON.stringify(WEEKLY_PLAN_EMPTY)), { Monday: { breakfast: null, lunch: null, dinner: 'grocery-test', snacks: [] } }) });
  await loadLocalApp(page, seed);
  await page.evaluate(() => generateGroceryList());
  const items = await page.evaluate(() => AppState.groceryList.map((i) => ({ name: i.name, quantity: i.quantity })));
  const unresolvedItem = items.find((i) => i.name === 'unresolved range item');
  const knownItem = items.find((i) => i.name === 'known amount');
  expect(unresolvedItem).toBeTruthy();
  expect(unresolvedItem.quantity).toBeFalsy(); // never a fabricated 1 or any other positive number
  expect(knownItem.quantity).toBeGreaterThan(0); // a real quantity is unaffected
});

test('8.6: recipe cost never becomes NaN because of an unresolved ingredient', async ({ page }) => {
  const seed = buildSeed([
    baseRecipeShape({
      id: 'cost-test', name: 'Cost Test', estimatedCost: 0,
      baseIngredients: [
        { name: 'unresolved', baseQuantity: null, unit: '', category: 'Protein' },
        { name: 'priced item', baseQuantity: 2, unit: 'pieces', category: 'Pantry', pricePerUnit: 10 }
      ],
      instructions: 'x'
    })
  ]);
  await loadLocalApp(page, seed);
  const cost = await page.evaluate(() => calculateRecipeCost(AppState.recipes.find((r) => r.id === 'cost-test')));
  expect(Number.isNaN(cost)).toBe(false);
  expect(Number.isFinite(cost)).toBe(true);
});

test('8.7: nutrition calculation never fabricates a contribution from an unresolved quantity', async ({ page }) => {
  const seed = buildSeed([
    baseRecipeShape({
      id: 'nutrition-test', name: 'Nutrition Test',
      nutritionPerServing: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0 },
      baseIngredients: [{ name: 'chicken', baseQuantity: null, unit: '', category: 'Protein' }],
      instructions: 'x'
    })
  ]);
  await loadLocalApp(page, seed);
  const nutrition = await page.evaluate(() => calculateRecipeNutrition(AppState.recipes.find((r) => r.id === 'nutrition-test')));
  expect(nutrition.calories).toBe(0);
  expect(Number.isNaN(nutrition.calories)).toBe(false);
});

test('8.8: recipe detail renders an unresolved quantity as blank without crashing, and a real 0 still shows', async ({ page }) => {
  const seed = buildSeed([
    baseRecipeShape({
      id: 'render-test', name: 'Render Test',
      baseIngredients: [
        { name: 'unresolved range item', baseQuantity: null, unit: '', category: 'Protein' },
        { name: 'zero item', baseQuantity: 0, unit: 'g', category: 'Pantry' },
        { name: 'real item', baseQuantity: 3, unit: 'pieces', category: 'Pantry' }
      ],
      instructions: 'x'
    })
  ]);
  await loadLocalApp(page, seed);
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  const html = await page.evaluate(() => buildDetailIngList(AppState.recipes.find((r) => r.id === 'render-test'), 4));
  expect(consoleErrors).toEqual([]);
  expect(html).toContain('unresolved range item');
  expect(html).not.toMatch(/undefined|NaN/);
  expect(html).toMatch(/>\s*0\s*g\s*zero item/); // a real 0 still renders as "0", not blank
  expect(html).toMatch(/>\s*3\s*pieces\s*real item/);
});

test('8.9/8.10: save/reload and export/import both preserve an unresolved (null) quantity outside the named-recipe repair too', async ({ page }) => {
  const seed = buildSeed([
    baseRecipeShape({ id: 'persist-test', name: 'Persist Test', baseIngredients: [{ name: 'unresolved', baseQuantity: null, unit: '', category: 'Protein' }], instructions: 'x' })
  ]);
  await loadLocalApp(page, seed);
  await page.evaluate(() => saveData());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForRestored(page, () => AppState.recipes.some((r) => r.id === 'persist-test'));
  const afterReload = await page.evaluate(() => AppState.recipes.find((r) => r.id === 'persist-test').baseIngredients[0].baseQuantity);
  expect(afterReload).toBeNull();

  const exportedPayload = await page.evaluate(() => new Promise((resolve) => {
    const orig = URL.createObjectURL;
    URL.createObjectURL = function (blob) { blob.text().then((text) => resolve(JSON.parse(text))); return orig.call(URL, blob); };
    exportData();
  }));
  const imported = exportedPayload.recipes.find((r) => r.id === 'persist-test');
  expect(imported.baseIngredients[0].baseQuantity).toBeNull();
});
