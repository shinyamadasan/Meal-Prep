const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');
const { waitForAppReady, waitForRestored } = require('./app-ready');

/**
 * TASK-058 follow-up: one-time repair of 5 named recipes pasted through
 * parseRecipeText() BEFORE the TASK-058 fix (100d4b4) landed. Their
 * instructions still carried leaked "Equipment:/Effort:/Tags:" heading text,
 * and several ingredients were fabricated quantity:1/unit:'pieces' for range
 * inputs like "2-3 lb chicken breasts". This is deliberately NOT a generic
 * migration framework — oneTimeRepairEightPastedChickenRecipes() targets
 * exactly these 5 ids/names and nothing else. 3 further titles named in the
 * original request (Greek Style, Basil Balsamic, Pesto Mozzarella Chicken)
 * were confirmed absent from the user's real data and are intentionally out
 * of scope for this repair.
 *
 * The fixture below reproduces the real corrupted shape byte-for-byte
 * (mojibake included — that's a separate, pre-existing encoding issue this
 * repair does not touch) so this test exercises the actual repair, not a
 * simplified stand-in.
 */

function buildSeed() {
  return {
    recipes: [
      // Control: unrelated recipe, must be byte-identical after repair.
      {
        id: 1, name: 'Sinangag', category: 'Breakfast', baseServings: 2, currentServings: 2,
        basePrepTime: 5, baseCookTime: 10, fridgeLife: 2, freezerLife: 30,
        instructions: 'Crush and fry garlic in oil until golden. Add day-old rice, break clumps, season with salt. Stir-fry until heated through. Top with green onion.',
        baseIngredients: [
          { category: 'Grain', baseQuantity: 2, unit: 'cups cooked', name: 'White Rice (Bigas)' },
          { category: 'Vegetable', name: 'Garlic (Bawang)', baseQuantity: 6, unit: 'cloves' }
        ],
        activeTime: null, tags: [], equipment: [], effort: null,
        mealBalance: { protein: false, vegetables: false, carb: false },
        nutritionPerServing: { calories: 290, protein: 5, sodium: 290, fat: 7, fiber: 1, carbs: 52 },
        updatedAt: '2026-08-25T06:37:26.918Z'
      },
      {
        id: '1788062745911',
        name: 'Buffalo Ranch Chicken',
        category: 'Main Dish', basePrepTime: 15, baseCookTime: 30, baseServings: 4, currentServings: 4,
        fridgeLife: 3, freezerLife: 30, estimatedCost: 0, costPerServing: 0, storageNotes: '', photo: null,
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
        // Manually corrected by the user after import — effort/tags already match
        // what the parser would derive; equipment does not (a genuine conflict,
        // per the repair's own rule, must be left untouched).
        equipment: ['instant-pot', 'oven'], tags: ['batch-friendly', 'freezer-friendly'], effort: 'very-low',
        activeTime: null, mealBalance: { protein: true, vegetables: false, carb: true },
        nutritionPerServing: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0 },
        updatedAt: '2026-08-30T04:15:58.534Z'
      },
      {
        id: 1788062988950,
        name: 'Honey Mustard Chicken',
        category: 'Main Dish', basePrepTime: 15, baseCookTime: 30, baseServings: 4, currentServings: 4,
        fridgeLife: 3, freezerLife: 30, estimatedCost: 0, costPerServing: 0, storageNotes: '', photo: null,
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
        ],
        equipment: [], tags: [], effort: null, activeTime: null,
        mealBalance: { protein: false, vegetables: false, carb: false },
        nutritionPerServing: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0 },
        updatedAt: '2026-08-30T04:15:58.534Z'
      },
      {
        id: 1788063014896,
        name: 'Pineapple Teriyaki Chicken',
        category: 'Main Dish', basePrepTime: 15, baseCookTime: 30, baseServings: 4, currentServings: 4,
        fridgeLife: 3, freezerLife: 30, estimatedCost: 0, costPerServing: 0, storageNotes: '', photo: null,
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
        ],
        equipment: [], tags: [], effort: null, activeTime: null,
        mealBalance: { protein: false, vegetables: false, carb: false },
        nutritionPerServing: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0 },
        updatedAt: '2026-08-30T04:15:58.534Z'
      },
      {
        id: 1788063044644,
        name: 'Honey Garlic Chicken',
        category: 'Main Dish', basePrepTime: 15, baseCookTime: 30, baseServings: 4, currentServings: 4,
        fridgeLife: 3, freezerLife: 30, estimatedCost: 0, costPerServing: 0, storageNotes: '', photo: null,
        instructions: 'Add chicken, honey, soy sauce, garlic, olive oil, and green onions to a freezer-safe bag. Mix well to coat the chicken.\nFreeze.\nWhen ready to cook, thaw overnight in the refrigerator.\nCook in a crockpot on LOW for 4â€“6 hours, or cook on the stovetop until the chicken is fully cooked.\nServe with rice and vegetables.\nEquipment:\nSlow cooker, Pan\nEffort:\nVery low\nTags:\nFreezer-friendly, Batch-friendly, Minimal-cleanup',
        baseIngredients: [
          { name: '1â€“1.5 lb chicken', baseQuantity: 1, unit: 'pieces', category: 'Protein' },
          { name: 'honey', baseQuantity: 0.25, unit: 'cups', category: 'Pantry' },
          { name: 'soy sauce', baseQuantity: 0.25, unit: 'cups', category: 'Pantry' },
          { name: '3â€“4 cloves garlic', baseQuantity: 1, unit: 'pieces', category: 'Vegetable' },
          { name: '1â€“2 tbsp olive oil', baseQuantity: 1, unit: 'pieces', category: 'Pantry' },
          { name: '1â€“2 green onions', baseQuantity: 1, unit: 'pieces', category: 'Vegetable' }
        ],
        equipment: [], tags: [], effort: null, activeTime: null,
        mealBalance: { protein: false, vegetables: false, carb: false },
        nutritionPerServing: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0 },
        updatedAt: '2026-08-30T04:15:58.534Z'
      },
      {
        id: 1788063069099,
        name: 'Lemon Chicken',
        category: 'Main Dish', basePrepTime: 15, baseCookTime: 30, baseServings: 4, currentServings: 4,
        fridgeLife: 3, freezerLife: 30, estimatedCost: 0, costPerServing: 0, storageNotes: '', photo: null,
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
        ],
        equipment: [], tags: [], effort: null, activeTime: null,
        mealBalance: { protein: false, vegetables: false, carb: false },
        nutritionPerServing: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0 },
        updatedAt: '2026-08-30T04:15:58.534Z'
      }
    ],
    weeklyPlan: {
      Monday: { breakfast: null, lunch: null, dinner: 1, snacks: [] },
      Tuesday: { breakfast: null, lunch: null, dinner: null, snacks: [] },
      Wednesday: { breakfast: null, lunch: null, dinner: null, snacks: [] },
      Thursday: { breakfast: null, lunch: null, dinner: null, snacks: [] },
      Friday: { breakfast: null, lunch: null, dinner: null, snacks: [] },
      Saturday: { breakfast: null, lunch: null, dinner: null, snacks: [] },
      Sunday: { breakfast: null, lunch: null, dinner: '1788063069099', snacks: [] }
    },
    groceryList: [], nutritionGoals: {}, customIngredients: [], customHacks: [],
    flavors: [], preparedFlavors: [], pantry: [], userIngredients: [], ingredientPrices: {},
    myStores: [], customStores: [],
    cookedMeals: [{ id: 'cm_test_1', recipeId: 1, name: 'Sinangag leftovers', cookedDate: '2026-08-20', portionsRemaining: 1, initialPortions: 1, fridgeLife: 2, freezerLife: 30, storage: 'fridge', updatedAt: '2026-08-20T00:00:00.000Z' }],
    cookHistory: [{ recipeId: '1788063044644', cookedAt: '2026-08-28T00:00:00.000Z' }],
    recentRecipes: ['1788063044644', '1'],
    prepModeSession: null, deletions: {}, version: 1, lastSaved: new Date().toISOString()
  };
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

test('repairs exactly the 5 matched recipes: instructions cleaned, fabricated quantities fixed, ids/counts/unrelated data untouched', async ({ page }) => {
  const seed = buildSeed();
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

  // 1: exactly these 5 records were targeted (nothing skipped as ambiguous/missing).
  expect(report.skipped).toEqual([]);
  expect(report.repaired.map((r) => r.name).sort()).toEqual([...TARGET_NAMES].sort());

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

  // 8: record count unchanged.
  expect(after.recipeCount).toBe(before.recipeCount);
  // 7: unrelated recipe (Sinangag) byte-identical.
  expect(after.control).toEqual(before.control);
  // planner/cookHistory references untouched.
  expect(after.weeklyPlan).toEqual(before.weeklyPlan);
  expect(after.cookedMeals).toEqual(before.cookedMeals);
  expect(after.cookHistory).toEqual(before.cookHistory);

  for (const name of TARGET_NAMES) {
    const t = after.targets[name];
    expect(t.count).toBe(1); // exactly one record
    expect(t.recipe.instructions).not.toMatch(/Equipment:|Effort:|Tags:/); // 4: metadata pollution removed
    const fabricated = t.recipe.baseIngredients.filter((i) => i.baseQuantity === 1 && i.unit === 'pieces' &&
      /[–-]\d|^Salt$|^Black pepper$|^Green onion$|^Pineapple chunks$|^Sesame seeds$|^Parsley or thyme$|Juice of/.test(i.name));
    expect(fabricated).toEqual([]); // 5: no fabricated range/bare-word quantities remain
  }

  // 3: ids preserved (including Buffalo Ranch Chicken's string id).
  expect(after.targets['Buffalo Ranch Chicken'].recipe.id).toBe('1788062745911');
  expect(after.targets['Honey Mustard Chicken'].recipe.id).toBe(1788062988950);
  expect(after.targets['Pineapple Teriyaki Chicken'].recipe.id).toBe(1788063014896);
  expect(after.targets['Honey Garlic Chicken'].recipe.id).toBe(1788063044644);
  expect(after.targets['Lemon Chicken'].recipe.id).toBe(1788063069099);

  // 6: unrelated/manually-edited fields preserved — Buffalo Ranch's conflicting
  // equipment and its unrelated mealBalance must be left exactly as they were.
  const branch = after.targets['Buffalo Ranch Chicken'].recipe;
  expect(branch.equipment).toEqual(['instant-pot', 'oven']);
  expect(branch.mealBalance).toEqual({ protein: true, vegetables: false, carb: true });
  expect(branch.fridgeLife).toBe(seed.recipes[1].fridgeLife);
  expect(branch.estimatedCost).toBe(seed.recipes[1].estimatedCost);

  // Newly-derived equipment applied where there was no conflict.
  expect(after.targets['Honey Garlic Chicken'].recipe.equipment).toEqual(['pan']);
  expect(after.targets['Lemon Chicken'].recipe.equipment).toEqual(['oven', 'pan']);
  expect(after.targets['Honey Mustard Chicken'].recipe.effort).toBe('very-low');

  expect(consoleErrors).toEqual([]);
});

test('the repair survives a save/reload round trip, including unresolved (null) ingredient quantities', async ({ page }) => {
  const seed = buildSeed();
  await loadLocalApp(page, seed);

  await page.evaluate(() => oneTimeRepairEightPastedChickenRecipes());
  await page.waitForTimeout(200);
  const beforeReload = await page.evaluate(() => AppState.recipes.find((r) => r.name === 'Lemon Chicken'));

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForRestored(page, () => AppState.recipes.some((r) => r.name === 'Lemon Chicken'));

  const afterReload = await page.evaluate(() => AppState.recipes.find((r) => r.name === 'Lemon Chicken'));
  expect(afterReload).toEqual(beforeReload);

  const chicken = afterReload.baseIngredients.find((i) => /chicken$/.test(i.name) && i.unit === '');
  expect(chicken).toBeTruthy();
  expect(chicken.baseQuantity).toBeNull(); // normalizeRecipes() must not coerce this to 0
});

test('the repair survives an export -> import round trip', async ({ page }) => {
  const seed = buildSeed();
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
    AppState.recipes = []; // simulate merging into a fresh install
    AppState.recipes = unionById(AppState.recipes, payload.recipes || []);
    const lemon = AppState.recipes.find((r) => r.name === 'Lemon Chicken');
    const out = { instructionsClean: lemon ? !/Equipment:/.test(lemon.instructions) : null, equipment: lemon ? lemon.equipment : null };
    AppState.recipes = real;
    return out;
  }, exportedPayload);

  expect(merged.instructionsClean).toBe(true);
  expect(merged.equipment).toEqual(['oven', 'pan']);
});

test('ambiguous title matching stops safely instead of guessing', async ({ page }) => {
  const seed = buildSeed();
  // Duplicate one target name so the exact-name match is no longer unambiguous.
  const dup = JSON.parse(JSON.stringify(seed.recipes.find((r) => r.name === 'Lemon Chicken')));
  dup.id = 'zz-duplicate-lemon-chicken';
  seed.recipes.push(dup);

  await loadLocalApp(page, seed);
  const report = await page.evaluate(() => oneTimeRepairEightPastedChickenRecipes());

  const skippedNames = report.skipped.map((s) => s.name);
  expect(skippedNames).toContain('Lemon Chicken');

  // Neither copy was mutated.
  const copies = await page.evaluate(() => AppState.recipes.filter((r) => r.name === 'Lemon Chicken'));
  expect(copies.length).toBe(2);
  copies.forEach((r) => expect(r.instructions).toMatch(/Equipment:/));

  // The other 4 unambiguous recipes still got repaired normally.
  const repairedNames = report.repaired.map((r) => r.name).sort();
  expect(repairedNames).toEqual(['Buffalo Ranch Chicken', 'Honey Garlic Chicken', 'Honey Mustard Chicken', 'Pineapple Teriyaki Chicken']);
});
