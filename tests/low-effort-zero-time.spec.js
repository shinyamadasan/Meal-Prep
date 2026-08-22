const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

/**
 * Regression: a legitimate 0-minute cook (or prep) time must never render NaN.
 *
 * The old pattern `recipe.baseCookTime || recipe.cookTime` turned a real 0 into
 * undefined, and every calculation downstream produced NaN — so a no-cook recipe
 * showed "NaN min" on its card, in the planner slot, and in the week stats.
 */

test.use({ viewport: { width: 1200, height: 1500 } });

async function loadLocalApp(page) {
  await page.route('**/firebasejs/**', (r) => r.abort());
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
  await page.waitForTimeout(2500);
}

// A genuinely no-cook recipe: assembled, never heated.
const NO_COOK = {
  id: 'nocook-1',
  name: 'Lechon Manok Rice Bowl',
  category: 'Main Dish',
  basePrepTime: 10,
  baseCookTime: 0,
  baseServings: 2,
  currentServings: 2,
  fridgeLife: 2,
  freezerLife: 30,
  estimatedCost: 200,
  storageNotes: '',
  instructions: 'Shred the chicken over rice.',
  baseIngredients: [{ name: 'Roast Chicken', baseQuantity: 300, unit: 'g', category: 'Protein' }],
  nutritionPerServing: { calories: 450, protein: 35, carbs: 40, fat: 15, fiber: 1, sodium: 500 }
};

// The other half of the same bug: zero PREP time.
const ZERO_PREP = Object.assign({}, NO_COOK, {
  id: 'noprep-1', name: 'Reheat Leftovers', basePrepTime: 0, baseCookTime: 5
});

test('the time helpers keep a real zero instead of falling through to undefined', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate(() => ({
    zeroCook: recipeCookMinutes({ baseCookTime: 0, cookTime: 45 }),
    zeroPrep: recipePrepMinutes({ basePrepTime: 0, prepTime: 20 }),
    // Only a genuinely ABSENT base field falls back to the legacy one.
    legacyCook: recipeCookMinutes({ cookTime: 45 }),
    legacyPrep: recipePrepMinutes({ prepTime: 20 }),
    bothMissing: recipeCookMinutes({}),
    nullRecipe: recipeCookMinutes(null),
    garbage: recipeCookMinutes({ baseCookTime: 'abc', cookTime: 'xyz' }),
    total: recipeTotalMinutes({ basePrepTime: 10, baseCookTime: 0 })
  }));

  expect(result.zeroCook).toBe(0);
  expect(result.zeroPrep).toBe(0);
  expect(result.legacyCook).toBe(45);
  expect(result.legacyPrep).toBe(20);
  expect(result.bothMissing).toBe(0);
  expect(result.nullRecipe).toBe(0);
  expect(result.garbage).toBe(0);
  expect(result.total).toBe(10);
});

test('a zero cook-time recipe shows 0m everywhere, never NaN', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate(({ noCook, zeroPrep }) => {
    AppState.recipes = normalizeRecipes([
      JSON.parse(JSON.stringify(noCook)),
      JSON.parse(JSON.stringify(zeroPrep))
    ]);

    // Plan both so the planner slot and the week stats are exercised too.
    AppState.weeklyPlan.Monday.dinner = 'nocook-1';
    AppState.weeklyPlan.Tuesday.dinner = 'noprep-1';

    showTab('recipes');
    renderRecipes();
    renderWeeklyPlanner();
    updateWeeklyStats();
    renderRecipeSelectionGrid();

    const cardText = Array.prototype.slice
      .call(document.querySelectorAll('.recipe-card .prep-time-info'))
      .map((el) => el.textContent.replace(/\s+/g, ' ').trim());

    const plannerText = Array.prototype.slice
      .call(document.querySelectorAll('#meal-planner .recipe-meta'))
      .map((el) => el.textContent.replace(/\s+/g, ' ').trim());

    return {
      cardText,
      plannerText,
      prepStat: document.getElementById('total-prep-time').textContent,
      cookStat: document.getElementById('total-cook-time').textContent,
      // The whole rendered page must contain no NaN at all.
      pageHasNaN: /NaN/.test(document.body.innerText)
    };
  }, { noCook: NO_COOK, zeroPrep: ZERO_PREP });

  expect(result.cardText.join(' | ')).toContain('Cook: 0m');
  expect(result.cardText.join(' | ')).toContain('Prep: 0m');
  expect(result.cardText.join(' ')).not.toContain('NaN');
  expect(result.plannerText.join(' ')).not.toContain('NaN');
  // 10 min prep (no-cook) + 0 min prep (leftovers) = 10; 0 + 5 = 5.
  expect(result.prepStat).toBe('10 min');
  expect(result.cookStat).toBe('5 min');
  expect(result.pageHasNaN).toBe(false);
});

test('the edit form loads a zero cook time as 0, not "undefined"', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate((noCook) => {
    AppState.recipes = normalizeRecipes([JSON.parse(JSON.stringify(noCook))]);
    openEditRecipeModal('nocook-1');
    return {
      prep: document.getElementById('prep-time').value,
      cook: document.getElementById('cook-time').value
    };
  }, NO_COOK);

  expect(result.cook).toBe('0');
  expect(result.prep).toBe('10');
});

test('a scaled zero cook-time recipe still shows 0m in its base annotation', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate((noCook) => {
    AppState.recipes = normalizeRecipes([JSON.parse(JSON.stringify(noCook))]);
    updateServingSize('nocook-1', 4); // scale away from base so the annotation renders
    showTab('recipes');
    renderRecipes();
    return Array.prototype.slice
      .call(document.querySelectorAll('.recipe-card .time-per-serving'))
      .map((el) => el.textContent.trim());
  }, NO_COOK);

  expect(result).toEqual(['(10m base)', '(0m base)']);
});
