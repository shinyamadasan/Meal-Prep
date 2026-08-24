const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');
const { waitForAppReady } = require('./app-ready');

/**
 * Low-effort cooking wave — Phase 2 characterization + metadata normalization.
 *
 * The new recipe fields (equipment, effort, activeTime, mealBalance, tags) are all
 * optional and additive. A recipe saved before they existed must keep loading and
 * rendering exactly as it did, and garbage must never reach the UI.
 */

test.use({ viewport: { width: 1200, height: 1500 } });

async function loadLocalApp(page) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  // Runs before EVERY navigation, so it bootstraps once and then leaves storage
  // alone — otherwise a page.reload() would wipe the data under test.
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__lowfxTestBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__lowfxTestBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
  });
  await page.goto(pathToFileURL(path.resolve('index.html')).href, { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
}

// Exactly the shape a recipe had before this wave — no new fields at all.
const LEGACY_RECIPE = {
  id: 'legacy-1',
  name: 'Legacy Adobo',
  category: 'Main Dish',
  basePrepTime: 10,
  baseCookTime: 25,
  baseServings: 4,
  currentServings: 4,
  fridgeLife: 3,
  freezerLife: 30,
  estimatedCost: 300,
  storageNotes: '',
  instructions: 'Cook it.',
  baseIngredients: [{ name: 'Chicken', baseQuantity: 500, unit: 'g', category: 'Protein' }],
  nutritionPerServing: { calories: 500, protein: 40, carbs: 20, fat: 15, fiber: 2, sodium: 400 }
};

test('a recipe saved without the new metadata still loads, normalizes and renders', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate((legacy) => {
    localStorage.setItem('mealPrepAppData', JSON.stringify({
      recipes: [JSON.parse(JSON.stringify(legacy))],
      weeklyPlan: {},
      groceryList: [],
      version: 2,
      lastSaved: new Date().toISOString()
    }));
    const loaded = loadFromLocalStorage();
    showTab('recipes');
    renderRecipes();

    const r = AppState.recipes[0];
    return {
      loaded,
      equipment: r.equipment,
      effort: r.effort,
      activeTime: r.activeTime,
      mealBalance: r.mealBalance,
      tags: r.tags,
      // Untouched originals.
      name: r.name,
      prep: r.basePrepTime,
      cook: r.baseCookTime,
      // A recipe with no metadata renders no metadata strip at all.
      stripCount: document.querySelectorAll('.recipe-card .recipe-lowfx').length,
      cardCount: document.querySelectorAll('.recipe-card').length,
      effortScore: recipeEffortScore(r),
      activeMinutes: recipeActiveMinutes(r)
    };
  }, LEGACY_RECIPE);

  expect(result.loaded).toBe(true);
  expect(result.equipment).toEqual([]);
  expect(result.effort).toBeNull();
  expect(result.activeTime).toBeNull();
  expect(result.mealBalance).toEqual({ protein: false, vegetables: false, carb: false });
  expect(result.tags).toEqual([]);
  expect(result.name).toBe('Legacy Adobo');
  expect(result.prep).toBe(10);
  expect(result.cook).toBe(25);
  expect(result.cardCount).toBe(1);
  expect(result.stripCount).toBe(0);
  // No activeTime stated -> falls back to total time, so it is NOT mistaken for easy.
  expect(result.activeMinutes).toBe(35);
  expect(result.effortScore).toBe(3);
});

test('metadata normalization keeps valid values, drops garbage, and is idempotent', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate(() => {
    const messy = {
      id: 'messy',
      name: 'Messy',
      baseIngredients: [],
      equipment: ['oven', 'oven', 'teleporter', '', null, 'pan'],
      effort: 'super-easy',
      activeTime: '7',
      mealBalance: { protein: 1, vegetables: 0, carb: 'yes', nonsense: true },
      tags: ['shortcut', 'not-a-tag', 42]
    };
    const once = normalizeRecipes([JSON.parse(JSON.stringify(messy))])[0];
    const twice = normalizeRecipes([JSON.parse(JSON.stringify(once))])[0];

    const edgeCases = {
      activeBlank: normalizeActiveTime(''),
      activeSpaces: normalizeActiveTime('   '),
      activeNull: normalizeActiveTime(null),
      activeZero: normalizeActiveTime(0),
      activeNegative: normalizeActiveTime(-5),
      activeText: normalizeActiveTime('abc'),
      effortValid: normalizeEffort('very-low'),
      effortBogus: normalizeEffort('extreme'),
      effortNull: normalizeEffort(null),
      balanceNull: normalizeMealBalance(null),
      balanceArray: normalizeMealBalance([1, 2]),
      slugsNotArray: normalizeSlugList('oven', EQUIPMENT_BY_ID)
    };

    return { once, idempotent: JSON.stringify(once) === JSON.stringify(twice), edgeCases };
  });

  expect(result.once.equipment).toEqual(['oven', 'pan']);
  expect(result.once.effort).toBeNull();
  expect(result.once.activeTime).toBe(7);
  expect(result.once.mealBalance).toEqual({ protein: true, vegetables: false, carb: true });
  expect(result.once.tags).toEqual(['shortcut']);
  expect(result.idempotent).toBe(true);

  const e = result.edgeCases;
  // Blank must mean "not stated", never 0 — an unfilled field must not claim
  // the recipe needs no attention.
  expect(e.activeBlank).toBeNull();
  expect(e.activeSpaces).toBeNull();
  expect(e.activeNull).toBeNull();
  expect(e.activeZero).toBe(0);
  expect(e.activeNegative).toBeNull();
  expect(e.activeText).toBeNull();
  expect(e.effortValid).toBe('very-low');
  expect(e.effortBogus).toBeNull();
  expect(e.effortNull).toBeNull();
  expect(e.balanceNull).toEqual({ protein: false, vegetables: false, carb: false });
  expect(e.balanceArray).toEqual({ protein: false, vegetables: false, carb: false });
  expect(e.slugsNotArray).toEqual([]);
});

test('the metadata strip renders only what a recipe actually declares', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate(() => {
    AppState.recipes = normalizeRecipes([{
      id: 'rc-1', name: 'Rice Cooker Chicken Rice', category: 'Main Dish',
      basePrepTime: 5, baseCookTime: 40, baseServings: 4, currentServings: 4,
      baseIngredients: [{ name: 'Chicken', baseQuantity: 400, unit: 'g', category: 'Protein' }],
      equipment: ['rice-cooker'], effort: 'very-low', activeTime: 5,
      mealBalance: { protein: true, vegetables: false, carb: true },
      tags: ['batch-friendly', 'minimal-cleanup']
    }]);
    showTab('recipes');
    renderRecipes();
    const strip = document.querySelector('.recipe-card .recipe-lowfx');
    return {
      chips: Array.prototype.slice.call(strip.querySelectorAll('.lowfx-chip')).map((el) => el.textContent.trim()),
      balance: strip.querySelector('.lowfx-balance').textContent.trim()
    };
  });

  expect(result.chips).toEqual([
    '⚡ 5m hands-on', 'Very low', '🍚 Rice cooker', 'Batch-friendly', 'Minimal cleanup'
  ]);
  // Informational only — no grams, no goals, no warnings.
  expect(result.balance).toBe('Protein ✓ · Carb ✓');
});

test('export -> import -> reload preserves the new recipe metadata', async ({ page }) => {
  await loadLocalApp(page);

  const exported = await page.evaluate(() => {
    AppState.recipes = normalizeRecipes([{
      id: 'ip-1', name: 'Instant Pot Pulled Chicken', category: 'Main Dish',
      basePrepTime: 5, baseCookTime: 30, baseServings: 6, currentServings: 6,
      baseIngredients: [{ name: 'Chicken', baseQuantity: 1000, unit: 'g', category: 'Protein' }],
      equipment: ['instant-pot'], effort: 'very-low', activeTime: 5,
      mealBalance: { protein: true, vegetables: false, carb: false },
      tags: ['batch-friendly', 'freezer-friendly']
    }]);

    let captured = null;
    const RealBlob = window.Blob;
    window.Blob = function (parts, opts) {
      if (opts && opts.type === 'application/json') captured = String(parts[0]);
      return new RealBlob(parts, opts);
    };
    const realCreate = URL.createObjectURL;
    const realRevoke = URL.revokeObjectURL;
    URL.createObjectURL = () => 'blob:stub';
    URL.revokeObjectURL = () => {};
    try { exportData(); } finally {
      window.Blob = RealBlob;
      URL.createObjectURL = realCreate;
      URL.revokeObjectURL = realRevoke;
    }
    return captured;
  });

  const parsed = JSON.parse(exported);
  expect(parsed.recipes[0].equipment).toEqual(['instant-pot']);
  expect(parsed.recipes[0].effort).toBe('very-low');
  expect(parsed.recipes[0].activeTime).toBe(5);
  expect(parsed.recipes[0].tags).toEqual(['batch-friendly', 'freezer-friendly']);

  // Save, reload, and confirm the fields survive the localStorage round-trip.
  await page.evaluate(() => saveToLocalStorage());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);

  const after = await page.evaluate(() => {
    const r = AppState.recipes.find((x) => String(x.id) === 'ip-1');
    return {
      equipment: r.equipment, effort: r.effort, activeTime: r.activeTime,
      tags: r.tags, mealBalance: r.mealBalance
    };
  });

  expect(after.equipment).toEqual(['instant-pot']);
  expect(after.effort).toBe('very-low');
  expect(after.activeTime).toBe(5);
  expect(after.tags).toEqual(['batch-friendly', 'freezer-friendly']);
  expect(after.mealBalance).toEqual({ protein: true, vegetables: false, carb: false });
});

test('the low-effort recipe patterns from the brief are all representable', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate(() => {
    AppState.recipes = normalizeRecipes([
      // Fresh rice cooked daily while vegetables steam above it.
      { id: 'p1', name: 'Rice + Steamed Veg', baseIngredients: [], baseServings: 2, currentServings: 2,
        basePrepTime: 3, baseCookTime: 30, activeTime: 3, effort: 'very-low',
        equipment: ['rice-cooker-steamer'], tags: ['cook-fresh', 'minimal-cleanup'],
        mealBalance: { protein: false, vegetables: true, carb: true } },
      // Rice cooker one-pot meal.
      { id: 'p2', name: 'Rice Cooker Mushroom Chicken Rice', baseIngredients: [], baseServings: 4, currentServings: 4,
        basePrepTime: 8, baseCookTime: 45, activeTime: 8, effort: 'low',
        equipment: ['rice-cooker'], tags: ['minimal-cleanup'],
        mealBalance: { protein: true, vegetables: true, carb: true } },
      // Instant Pot batch shredded meat.
      { id: 'p3', name: 'Pressure Cooker Pork Adobo', baseIngredients: [], baseServings: 8, currentServings: 8,
        basePrepTime: 10, baseCookTime: 40, activeTime: 10, effort: 'low',
        equipment: ['instant-pot', 'pressure-cooker'], tags: ['batch-friendly', 'freezer-friendly'],
        mealBalance: { protein: true, vegetables: false, carb: false } },
      // Oven batch: 2 kg chicken, several marinades, serve later with fresh rice.
      { id: 'p4', name: 'Oven Batch Chicken, 3 Sauces', baseIngredients: [], baseServings: 8, currentServings: 8,
        basePrepTime: 15, baseCookTime: 50, activeTime: 15, effort: 'normal',
        equipment: ['oven', 'rice-cooker-steamer'], tags: ['batch-friendly', 'freezer-friendly'],
        mealBalance: { protein: true, vegetables: true, carb: true } },
      // Landers lechon manok shortcut — buy, portion, freeze, reuse.
      { id: 'p5', name: 'Lechon Manok Hack', baseIngredients: [], baseServings: 6, currentServings: 6,
        basePrepTime: 10, baseCookTime: 0, activeTime: 10, effort: 'assembly',
        equipment: ['no-cook'], tags: ['shortcut', 'freezer-friendly', 'minimal-cleanup'],
        mealBalance: { protein: true, vegetables: false, carb: false } }
    ]);

    const byId = (id) => AppState.recipes.find((r) => r.id === id);
    return {
      steamer: byId('p1').equipment,
      onePot: byId('p2').equipment,
      pressure: byId('p3').equipment,
      ovenBatch: byId('p4').equipment,
      shortcut: { equipment: byId('p5').equipment, tags: byId('p5').tags, effort: byId('p5').effort },
      // Multiple equipment values on one recipe are supported.
      multiEquipment: byId('p4').equipment.length,
      // Effort ordering is sane: assembly easiest, normal hardest.
      order: ['p5', 'p1', 'p2', 'p4'].map((id) => recipeEffortScore(byId(id)))
    };
  });

  expect(result.steamer).toEqual(['rice-cooker-steamer']);
  expect(result.onePot).toEqual(['rice-cooker']);
  expect(result.pressure).toEqual(['instant-pot', 'pressure-cooker']);
  expect(result.ovenBatch).toEqual(['oven', 'rice-cooker-steamer']);
  expect(result.multiEquipment).toBe(2);
  expect(result.shortcut.equipment).toEqual(['no-cook']);
  expect(result.shortcut.tags).toEqual(['shortcut', 'freezer-friendly', 'minimal-cleanup']);
  expect(result.shortcut.effort).toBe('assembly');
  expect(result.order).toEqual([0, 1, 2, 3]);
});
