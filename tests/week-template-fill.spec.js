const { test, expect } = require('@playwright/test');
const { waitForAppReady, waitForRestored } = require('./app-ready');

/**
 * TASK-038 regression: Load Saved Week used to replace the whole week, wiping meals
 * already planned. It must fill only empty slots, skip recipes that no longer exist,
 * and leave everything untouched when the dialog is cancelled or nothing can be filled.
 */

test.use({ viewport: { width: 1200, height: 1500 } });

async function loadLocalApp(page) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__weekFillTestBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__weekFillTestBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
  });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const BASE_RECIPE = {
  category: 'Main Dish',
  basePrepTime: 10,
  baseCookTime: 30,
  baseServings: 4,
  currentServings: 4,
  fridgeLife: 7,
  freezerLife: 30,
  estimatedCost: 200,
  storageNotes: '',
  instructions: 'Cook it.',
  nutritionPerServing: { calories: 400, protein: 30, carbs: 10, fat: 20, fiber: 1, sodium: 800 }
};

function recipe(id, name, ingredient) {
  return Object.assign({}, BASE_RECIPE, {
    id,
    name,
    baseIngredients: [{ name: ingredient, baseQuantity: 500, unit: 'g', category: 'Protein' }]
  });
}

const RECIPES = [
  recipe('r-oats', 'Overnight Oats', 'Rolled Oats'),
  recipe('r-eggs', 'Scrambled Eggs', 'Eggs'),
  recipe('r-soup', 'Lentil Soup', 'Lentils'),
  recipe('r-tofu', 'Crispy Tofu', 'Firm Tofu'),
  recipe('r-apple', 'Apple Slices', 'Apples'),
  recipe('r-nuts', 'Spiced Nuts', 'Cashews'),
  recipe('901', 'Numeric Id Stew', 'Beef Shank')
];

// A full week of empty slots, with `fill` merged over the named days.
function week(fill = {}) {
  const plan = {};
  DAYS.forEach((day) => {
    plan[day] = Object.assign({ breakfast: null, lunch: null, dinner: null, snacks: [] }, fill[day]);
  });
  return plan;
}

async function setupWeek(page, plan, template) {
  await loadLocalApp(page);
  await page.evaluate(({ recipes, plan, template }) => {
    AppState.recipes = normalizeRecipes(JSON.parse(JSON.stringify(recipes)));
    AppState.weeklyPlan = plan;
    localStorage.setItem('mealPrepWeekTemplate', JSON.stringify(template));
    initWeekTemplateButton();
    saveData();
    showTab('planner');
    renderWeeklyPlanner();
    updateWeeklyStats();
    generateGroceryList();
  }, { recipes: RECIPES, plan, template });
}

const currentPlan = (page) => page.evaluate(() => JSON.parse(JSON.stringify(AppState.weeklyPlan)));
const storedDoc = (page) => page.evaluate(() => localStorage.getItem('mealPrepAppData'));
const slot = (page, day, meal) => page.locator(`.meal-slot[data-day="${day}"][data-meal="${meal}"]`);

async function openDialog(page) {
  await page.click('#load-week-template-btn');
  await expect(page.locator('.confirm-overlay')).toBeVisible();
}

async function confirmLoad(page) {
  await openDialog(page);
  await page.locator('.confirm-overlay .confirm-ok-btn').click();
}

test('a partly planned week keeps its meals and gains saved meals in empty slots', async ({ page }) => {
  await setupWeek(
    page,
    week({ Monday: { breakfast: 'r-oats' } }),
    week({ Monday: { breakfast: 'r-eggs', lunch: 'r-soup' }, Tuesday: { dinner: 'r-tofu' } })
  );
  await expect(page.locator('#planned-meals')).toHaveText('1');

  await confirmLoad(page);

  expect(await currentPlan(page)).toEqual(
    week({ Monday: { breakfast: 'r-oats', lunch: 'r-soup' }, Tuesday: { dinner: 'r-tofu' } })
  );
  await expect(page.locator('.success-message')).toHaveText('Filled 2 empty slots from your saved week.');
  await expect(slot(page, 'Monday', 'breakfast')).toContainText('Overnight Oats');
  await expect(slot(page, 'Monday', 'lunch')).toContainText('Lentil Soup');
  await expect(slot(page, 'Tuesday', 'dinner')).toContainText('Crispy Tofu');
  await expect(page.locator('#planned-meals')).toHaveText('3');
});

test('non-empty snacks are preserved and empty snacks count as one filled slot', async ({ page }) => {
  await setupWeek(
    page,
    week({ Monday: { snacks: ['r-apple'] } }),
    week({ Monday: { snacks: ['r-nuts', 'r-soup'] }, Wednesday: { snacks: ['r-nuts', 'r-soup'] } })
  );

  await confirmLoad(page);

  expect(await currentPlan(page)).toEqual(
    week({ Monday: { snacks: ['r-apple'] }, Wednesday: { snacks: ['r-nuts', 'r-soup'] } })
  );
  await expect(page.locator('.success-message')).toHaveText('Filled 1 empty slot from your saved week.');
});

test('a deleted recipe id is skipped and ids are compared as strings', async ({ page }) => {
  await setupWeek(
    page,
    week(),
    week({
      Monday: { dinner: 'r-deleted' },
      Tuesday: { snacks: ['r-deleted', 'r-nuts'] },
      Wednesday: { snacks: ['r-deleted'] },
      Thursday: { lunch: 901 }
    })
  );

  await confirmLoad(page);

  expect(await currentPlan(page)).toEqual(
    week({ Tuesday: { snacks: ['r-nuts'] }, Thursday: { lunch: 901 } })
  );
  await expect(page.locator('.success-message')).toHaveText('Filled 2 empty slots from your saved week.');
  await expect(slot(page, 'Thursday', 'lunch')).toContainText('Numeric Id Stew');
});

test('a saved week missing a day or snacks array keeps the slot shape', async ({ page }) => {
  await setupWeek(page, week(), { Monday: { lunch: 'r-soup' } });

  await confirmLoad(page);

  expect(await currentPlan(page)).toEqual(week({ Monday: { lunch: 'r-soup' } }));
  await expect(page.locator('.success-message')).toHaveText('Filled 1 empty slot from your saved week.');
});

test('a fully planned week is unchanged, not saved, and told there is nothing to fill', async ({ page }) => {
  const full = {};
  DAYS.forEach((day) => {
    full[day] = { breakfast: 'r-oats', lunch: 'r-soup', dinner: 'r-tofu', snacks: ['r-apple'] };
  });
  await setupWeek(page, full, week({ Monday: { breakfast: 'r-eggs', snacks: ['r-nuts'] } }));
  const storedBefore = await storedDoc(page);

  await confirmLoad(page);

  await expect(page.locator('.success-message')).toHaveText(/^Nothing to fill/);
  expect(await currentPlan(page)).toEqual(full);
  expect(await storedDoc(page)).toBe(storedBefore);
});

test('Cancel changes nothing', async ({ page }) => {
  const plan = week({ Monday: { breakfast: 'r-oats' } });
  await setupWeek(page, plan, week({ Monday: { lunch: 'r-soup' } }));
  const storedBefore = await storedDoc(page);

  await openDialog(page);
  await page.locator('.confirm-overlay .confirm-cancel-btn').click();

  await expect(page.locator('.confirm-overlay')).toHaveCount(0);
  expect(await currentPlan(page)).toEqual(plan);
  expect(await storedDoc(page)).toBe(storedBefore);
  await expect(page.locator('.success-message')).toHaveCount(0);
});

test('the filled plan survives a reload through mealPrepAppData', async ({ page }) => {
  await setupWeek(
    page,
    week({ Monday: { breakfast: 'r-oats' } }),
    week({ Monday: { lunch: 'r-soup' }, Friday: { snacks: ['r-nuts'] } })
  );

  await confirmLoad(page);

  const expected = week({
    Monday: { breakfast: 'r-oats', lunch: 'r-soup' },
    Friday: { snacks: ['r-nuts'] }
  });
  expect(JSON.parse(await storedDoc(page)).weeklyPlan).toEqual(expected);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForRestored(page, () => AppState.weeklyPlan.Monday.lunch === 'r-soup');
  expect(await currentPlan(page)).toEqual(expected);
});

test('the dialog says empty slots are filled and no longer says replace', async ({ page }) => {
  await setupWeek(page, week(), week({ Monday: { lunch: 'r-soup' } }));

  await openDialog(page);

  const body = page.locator('.confirm-overlay .confirm-body');
  await expect(body).toContainText('fill the empty slots');
  await expect(body).toContainText('already planned stay unchanged');
  await expect(page.locator('.confirm-overlay')).not.toContainText(/replace/i);
});

test('the grocery list includes a recipe added by the fill', async ({ page }) => {
  await setupWeek(
    page,
    week({ Monday: { breakfast: 'r-oats' } }),
    week({ Tuesday: { dinner: 'r-tofu' } })
  );
  await expect(page.locator('#grocery-list')).not.toContainText('Firm Tofu');

  await confirmLoad(page);

  await expect(page.locator('#grocery-list')).toContainText('Firm Tofu');
  await expect(page.locator('#grocery-list')).toContainText('Rolled Oats');
});
