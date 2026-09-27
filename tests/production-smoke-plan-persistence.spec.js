const { test, expect } = require('@playwright/test');

/**
 * Production smoke for TASK-064 (D-080/D-081): the weeklyPlan clear/remove
 * persistence fix, recipe inspection from the Plan tab and Add-meals picker,
 * and the picker's spacing + reused favorite toggle.
 *
 * Runs against the DEPLOYED GitHub Pages build, not the working tree. Firebase
 * is deliberately NOT stubbed — the page loads it for real and stays signed
 * out, the normal first-visit path. Each test gets a fresh isolated context, so
 * nothing persists between them and nothing touches a real account's cloud data.
 */

const APP_URL = 'https://shinyamadasan.github.io/Meal-Prep/';

test.use({ viewport: { width: 1280, height: 1700 } });

async function loadLiveApp(page) {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__planProdBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__planProdBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
  });
  await page.goto(APP_URL + '?smoke=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load').catch(() => {});
  await page.waitForFunction(
    'typeof AppState !== "undefined" && Array.isArray(AppState.recipes) && typeof saveData === "function"',
    null,
    { timeout: 45000 }
  );
  await page.waitForTimeout(3000);
}

async function seedPlanRecipes(page) {
  await page.evaluate(() => {
    AppState.recipes.push({
      id: 'psp_shortlife', name: 'PSP Short Life Stew', category: 'Main Dish',
      baseServings: 4, currentServings: 4, basePrepTime: 10, baseCookTime: 20,
      fridgeLife: 1, freezerLife: 30,
      baseIngredients: [{ name: 'PSP Broth', baseQuantity: 1, unit: 'L', category: 'Pantry' }],
      instructions: 'Simmer.',
      nutritionPerServing: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0 }
    });
    AppState.recipes.push({
      id: 'psp_longlife', name: 'PSP Long Life Rice', category: 'Main Dish',
      baseServings: 2, currentServings: 2, basePrepTime: 5, baseCookTime: 15,
      fridgeLife: 30, freezerLife: 90,
      baseIngredients: [{ name: 'PSP Rice', baseQuantity: 200, unit: 'g', category: 'Grain' }],
      instructions: 'Cook.',
      nutritionPerServing: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0 }
    });
    AppState.plannedBatches = [];
    ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].forEach((d) => {
      AppState.weeklyPlan[d] = { breakfast: null, lunch: null, dinner: null, snacks: [] };
    });
  });
}

async function confirmDialog(page) {
  await page.locator('.confirm-overlay .confirm-ok-btn').click();
}

test('live: clearDay() persists across reload and the stale freshness warning does not return', async ({ page }) => {
  await loadLiveApp(page);
  await seedPlanRecipes(page);
  await page.evaluate(() => {
    AppState.weeklyPlan.Wednesday.dinner = 'psp_shortlife';
    saveData();
    showTab('planner');
    renderWeeklyPlanner();
  });
  await expect(page.locator('#storage-alerts .storage-alert-banner')).toContainText('PSP Short Life Stew');

  await page.evaluate(() => clearDay('Wednesday'));
  await confirmDialog(page);
  await expect(page.locator('#storage-alerts .storage-alert-banner')).toHaveCount(0);

  await page.reload({ waitUntil: 'domcontentloaded' });
  // Wait for unambiguous evidence the real localStorage restore actually ran, not just
  // that a field reads null — Wednesday.dinner is ALSO null in the freshly-initialized
  // default state before restore, so checking it alone can pass on a stale pre-restore
  // read. The seeded recipe id can only exist post-restore, so it is a true completion
  // signal (same trap and fix as the other two persistence tests in this file below).
  await page.waitForFunction(
    'typeof AppState !== "undefined" && Array.isArray(AppState.recipes) && AppState.recipes.some((r) => r.id === "psp_shortlife")',
    null, { timeout: 45000 }
  );
  expect(await page.evaluate(() => AppState.weeklyPlan.Wednesday.dinner)).toBeNull();
  await page.evaluate(() => showTab('planner'));
  await expect(page.locator('#storage-alerts .storage-alert-banner')).toHaveCount(0);
});

test('live: clearWeeklyPlan() persists across reload and does not touch plannedBatches', async ({ page }) => {
  await loadLiveApp(page);
  await seedPlanRecipes(page);
  await page.evaluate(() => {
    AppState.weeklyPlan.Monday.lunch = 'psp_longlife';
    addPlannedBatch('psp_longlife');
    saveData();
    showTab('planner');
  });

  await page.evaluate(() => clearWeeklyPlan());
  await confirmDialog(page);

  await page.reload({ waitUntil: 'domcontentloaded' });
  // See the clearDay() test above: wait for the seeded recipe (unambiguous post-restore
  // evidence), not a field whose pre-restore default happens to equal its cleared value.
  await page.waitForFunction(
    'typeof AppState !== "undefined" && Array.isArray(AppState.recipes) && AppState.recipes.some((r) => r.id === "psp_longlife")',
    null, { timeout: 45000 }
  );
  const after = await page.evaluate(() => ({
    anyDay: Object.values(AppState.weeklyPlan).some((d) => d.breakfast || d.lunch || d.dinner || d.snacks.length),
    batches: AppState.plannedBatches.map((b) => b.recipeId)
  }));
  expect(after.anyDay).toBe(false);
  expect(after.batches).toEqual(['psp_longlife']); // independent store (D-076), untouched by the clear
});

test('live: removeRecipeFromSlot() persists across reload, and a legitimate uncleared plan still survives it', async ({ page }) => {
  await loadLiveApp(page);
  await seedPlanRecipes(page);
  await page.evaluate(() => {
    AppState.weeklyPlan.Monday.lunch = 'psp_longlife';
    AppState.weeklyPlan.Friday.dinner = 'psp_longlife'; // legitimate, never cleared
    saveData();
    removeRecipeFromSlot('Monday', 'lunch');
  });
  expect(await page.evaluate(() => AppState.weeklyPlan.Monday.lunch)).toBeNull();

  await page.reload({ waitUntil: 'domcontentloaded' });
  // Same fix as the two tests above: wait for the seeded recipe, not a field whose
  // pre-restore default happens to equal its cleared value.
  await page.waitForFunction(
    'typeof AppState !== "undefined" && Array.isArray(AppState.recipes) && AppState.recipes.some((r) => r.id === "psp_longlife")',
    null, { timeout: 45000 }
  );
  const after = await page.evaluate(() => ({
    monday: AppState.weeklyPlan.Monday.lunch,
    friday: AppState.weeklyPlan.Friday.dinner
  }));
  expect(after.monday).toBeNull();
  expect(after.friday).toBe('psp_longlife'); // the good case: an uncleared assignment is not collateral damage
});

test('live: batch recipe title opens the existing recipe detail modal by stable id, without mutating servings or removing the batch', async ({ page }) => {
  await loadLiveApp(page);
  await seedPlanRecipes(page);
  const id = await page.evaluate(() => addPlannedBatch('psp_longlife'));
  await page.evaluate(() => showTab('planner'));

  const nameBtn = page.locator('#planned-batches-list .batch-name-btn');
  await expect(nameBtn).toHaveText('PSP Long Life Rice');
  await nameBtn.click();
  await expect(page.locator('#recipe-modal')).not.toHaveClass(/hidden/);
  expect(await page.evaluate(() => String(AppState.currentEditingRecipe))).toBe('psp_longlife');

  const stillThere = await page.evaluate((batchId) => AppState.plannedBatches.find((b) => b.id === batchId), id);
  expect(stillThere.recipeId).toBe('psp_longlife');
  expect(stillThere.servings).toBe(2); // unchanged by opening the detail view
});

test('live: the freshness warning links a recipe by the same stable id the plan slot stores', async ({ page }) => {
  await loadLiveApp(page);
  await seedPlanRecipes(page);
  await page.evaluate(() => {
    AppState.weeklyPlan.Wednesday.dinner = 'psp_shortlife';
    saveData();
    showTab('planner');
    renderWeeklyPlanner();
  });
  const link = page.locator('.storage-alert-recipe-link');
  await expect(link).toHaveText('PSP Short Life Stew');
  await link.click();
  expect(await page.evaluate(() => String(AppState.currentEditingRecipe))).toBe('psp_shortlife');
});

for (const vp of [{ width: 360, height: 740 }, { width: 390, height: 844 }]) {
  test(`live: Add-meals picker has no horizontal overflow at ${vp.width}px and content is inset from the modal edges`, async ({ page }) => {
    await page.setViewportSize(vp);
    await loadLiveApp(page);
    await seedPlanRecipes(page);
    await page.evaluate(() => { showTab('planner'); openBatchPickerModal(); });
    await expect(page.locator('#batch-picker-modal')).not.toHaveClass(/hidden/);

    const metrics = await page.evaluate(() => {
      const content = document.querySelector('#batch-picker-modal .modal-content');
      const row = document.querySelector('.batch-search-row');
      const rowPad = parseFloat(getComputedStyle(row).paddingLeft);
      return {
        contentOverflow: content.scrollWidth - content.clientWidth,
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        rowPad
      };
    });
    expect(metrics.contentOverflow).toBeLessThanOrEqual(1);
    expect(metrics.pageOverflow).toBeLessThanOrEqual(1);
    expect(metrics.rowPad).toBeGreaterThanOrEqual(12);
  });
}

test('live: picker favorite toggle is independent of Add/Added state, Low effort and Favorites default off, All recipes is the default view', async ({ page }) => {
  await loadLiveApp(page);
  await seedPlanRecipes(page);
  await page.evaluate(() => { showTab('planner'); openBatchPickerModal(); });

  await expect(page.locator('#batch-picker-low-effort-chip')).not.toHaveClass(/active/);
  await expect(page.locator('#batch-picker-favorites-chip')).not.toHaveClass(/active/);
  const defaultCount = await page.locator('#batch-picker-results .batch-name-btn').count();
  expect(defaultCount).toBeGreaterThan(1); // "All recipes" is the default, not a filtered view

  const row = page.locator('#batch-picker-results .batch-result', { hasText: 'PSP Long Life Rice' });
  const star = row.locator('.recipe-fav-btn');
  await row.locator('.batch-add-btn').click();
  await expect(row.locator('.batch-picker-added')).toHaveText('Added ✓');

  await star.click(); // favoriting an already-added recipe must not disturb its Added state
  await expect(star).toHaveClass(/active/);
  await expect(row.locator('.batch-picker-added')).toHaveText('Added ✓');
  expect(await page.evaluate(() => AppState.plannedBatches.length)).toBe(1); // still exactly one batch
});
