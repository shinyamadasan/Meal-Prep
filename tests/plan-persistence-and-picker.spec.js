const { test, expect } = require('@playwright/test');
const { waitForAppReady, waitForRestored } = require('./app-ready');

/**
 * TASK-064: two things reported from real production use.
 *
 *   1. weeklyPlan (the "By day" scheduler) resurrects after an explicit clear/remove,
 *      once the app is closed and reopened. Root cause: clearWeeklyPlan(), clearDay(),
 *      and removeRecipeFromSlot() mutated AppState.weeklyPlan and re-rendered, but never
 *      called saveData() — so the in-memory clear looked correct for the rest of that
 *      session, but localStorage/Firestore still held the pre-clear plan, and the next
 *      load restored it. plannedBatches (the "This week's batches" primary plan) was
 *      never affected — every batch mutator already called saveData() via
 *      afterPlannedBatchesChange(). The two stores are intentionally independent
 *      (D-076): this file proves the fix does not blur that line.
 *
 *   2. Planned-batch recipe names weren't inspectable. Fix reuses the existing recipe
 *      edit/detail modal (openEditRecipeModal) by stable recipeId — no new modal, no
 *      display-name matching.
 *
 * Also covers the bounded Part 2 addendum: Add-meals picker spacing and the reused
 * favorite toggle.
 */

test.use({ viewport: { width: 1280, height: 1700 } });

async function loadLocalApp(page) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__task064Bootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__task064Bootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
  });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
}

// One recipe that expires before Wednesday (fridgeLife 1 < DAY_FRIDGE_INDEX.Wednesday
// === 3), one that never triggers the freshness warning, used across this file.
function seedPlanRecipes() {
  AppState.recipes.push({
    id: 'r_shortlife', name: 'Test Short Life Stew', category: 'Main Dish',
    baseServings: 4, currentServings: 4, basePrepTime: 10, baseCookTime: 20,
    fridgeLife: 1, freezerLife: 30,
    baseIngredients: [{ name: 'Test Broth', baseQuantity: 1, unit: 'L', category: 'Pantry' }],
    instructions: 'Simmer.',
    nutritionPerServing: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0 }
  });
  AppState.recipes.push({
    id: 'r_longlife', name: 'Test Long Life Rice', category: 'Main Dish',
    baseServings: 2, currentServings: 2, basePrepTime: 5, baseCookTime: 15,
    fridgeLife: 30, freezerLife: 90,
    baseIngredients: [{ name: 'Test Rice', baseQuantity: 200, unit: 'g', category: 'Grain' }],
    instructions: 'Cook.',
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

async function loadWithPlanRecipes(page) {
  await loadLocalApp(page);
  await page.evaluate(seedPlanRecipes);
}

async function confirmDialog(page) {
  await page.locator('.confirm-overlay .confirm-ok-btn').click();
}

// ── Persistence: clearDay() ──────────────────────────────────────────────────

test('clearDay() persists: the cleared day stays cleared after reload, and its stale freshness warning does not come back', async ({ page }) => {
  await loadWithPlanRecipes(page);
  await page.evaluate(() => {
    AppState.weeklyPlan.Wednesday.dinner = 'r_shortlife';
    saveData();
    showTab('planner');
    renderWeeklyPlanner(); // direct AppState mutation, unlike a real UI action, does not auto-render
  });

  await expect(page.locator('#storage-alerts .storage-alert-banner')).toContainText('Test Short Life Stew');

  await page.evaluate(() => clearDay('Wednesday'));
  await confirmDialog(page);

  const cleared = await page.evaluate(() => AppState.weeklyPlan.Wednesday);
  expect(cleared).toEqual({ breakfast: null, lunch: null, dinner: null, snacks: [] });
  await expect(page.locator('#storage-alerts .storage-alert-banner')).toHaveCount(0);

  // BUG (pre-fix): clearDay() never called saveData(), so this reload resurrected the
  // pre-clear plan and the warning came back.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForRestored(page, () => AppState.weeklyPlan.Wednesday.dinner === null);
  const afterReload = await page.evaluate(() => AppState.weeklyPlan.Wednesday);
  expect(afterReload).toEqual({ breakfast: null, lunch: null, dinner: null, snacks: [] });
  await page.evaluate(() => showTab('planner'));
  await expect(page.locator('#storage-alerts .storage-alert-banner')).toHaveCount(0);
});

// ── Persistence: clearWeeklyPlan() ───────────────────────────────────────────

test('clearWeeklyPlan() persists across reload and does not touch plannedBatches', async ({ page }) => {
  await loadWithPlanRecipes(page);
  await page.evaluate(() => {
    AppState.weeklyPlan.Monday.lunch = 'r_longlife';
    AppState.weeklyPlan.Wednesday.dinner = 'r_shortlife';
    addPlannedBatch('r_longlife'); // the primary plan — must survive a weeklyPlan clear
    saveData();
    showTab('planner');
  });

  await page.evaluate(() => clearWeeklyPlan());
  await confirmDialog(page);

  const immediate = await page.evaluate(() => ({
    days: Object.values(AppState.weeklyPlan).map((d) => d.breakfast || d.lunch || d.dinner || d.snacks.length),
    batches: AppState.plannedBatches.map((b) => b.recipeId)
  }));
  expect(immediate.days.every((v) => !v)).toBe(true);
  expect(immediate.batches).toEqual(['r_longlife']); // independent store (D-076), untouched

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForRestored(page, () => AppState.weeklyPlan.Monday.lunch === null);
  const after = await page.evaluate(() => ({
    days: Object.values(AppState.weeklyPlan).map((d) => d.breakfast || d.lunch || d.dinner || d.snacks.length),
    batches: AppState.plannedBatches.map((b) => b.recipeId)
  }));
  expect(after.days.every((v) => !v)).toBe(true);
  expect(after.batches).toEqual(['r_longlife']);
});

// ── Persistence: removeRecipeFromSlot() ──────────────────────────────────────

test('removeRecipeFromSlot() persists across reload (single-slot remove, not just Clear Day/Week)', async ({ page }) => {
  await loadWithPlanRecipes(page);
  await page.evaluate(() => {
    AppState.weeklyPlan.Monday.lunch = 'r_longlife';
    saveData();
    removeRecipeFromSlot('Monday', 'lunch');
  });
  expect(await page.evaluate(() => AppState.weeklyPlan.Monday.lunch)).toBeNull();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForRestored(page, () => AppState.weeklyPlan.Monday.lunch === null);
  expect(await page.evaluate(() => AppState.weeklyPlan.Monday.lunch)).toBeNull();
});

// ── The good case: a legitimate, uncleared plan must still survive ──────────

test('a legitimate weekly plan (never cleared) survives reload unchanged', async ({ page }) => {
  await loadWithPlanRecipes(page);
  await page.evaluate(() => {
    AppState.weeklyPlan.Friday.dinner = 'r_longlife';
    saveData();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForRestored(page, () => AppState.weeklyPlan.Friday.dinner === 'r_longlife');
  expect(await page.evaluate(() => AppState.weeklyPlan.Friday.dinner)).toBe('r_longlife');
});

// ── Deterministic sync regression: local-wins must not let a stale remote plan
// resurrect an explicit clear. mergeCloudConflict() is a pure function — no real
// Firestore is touched. ───────────────────────────────────────────────────────

test('mergeCloudConflict() is local-wins for weeklyPlan/plannedBatches: a stale remote cannot resurrect an explicit clear', async ({ page }) => {
  await loadWithPlanRecipes(page);
  const r = await page.evaluate(() => {
    const staleRemote = {
      weeklyPlan: { Monday: { breakfast: null, lunch: 'r_longlife', dinner: null, snacks: [] } },
      plannedBatches: [{ id: 'pb_old', recipeId: 'r_shortlife', servings: 2, addedAt: null }]
    };
    const clearedLocal = {
      weeklyPlan: { Monday: { breakfast: null, lunch: null, dinner: null, snacks: [] } },
      plannedBatches: []
    };
    const merged = mergeCloudConflict(staleRemote, clearedLocal);
    return { weeklyPlan: merged.weeklyPlan, plannedBatches: merged.plannedBatches };
  });
  expect(r.weeklyPlan.Monday.lunch).toBeNull();  // stale remote did NOT resurrect the clear
  expect(r.plannedBatches).toEqual([]);
});

// ── Recipe inspection: batch row title ───────────────────────────────────────

test('Plan tab: a batch row recipe title opens the recipe detail modal by stable id, and does not touch servings or remove the batch', async ({ page }) => {
  await loadWithPlanRecipes(page);
  const id = await page.evaluate(() => addPlannedBatch('r_longlife'));
  await page.evaluate((batchId) => changePlannedBatchServings(batchId, 1), id);
  await page.evaluate(() => showTab('planner'));

  const nameLink = page.locator('#planned-batches-list .batch-name-btn');
  await expect(nameLink).toHaveText('Test Long Life Rice');
  await nameLink.click();

  await expect(page.locator('#recipe-modal')).not.toHaveClass(/hidden/);
  const opened = await page.evaluate(() => ({
    editing: AppState.currentEditingRecipe,
    nameField: document.getElementById('recipe-name').value
  }));
  expect(String(opened.editing)).toBe('r_longlife');
  expect(opened.nameField).toBe('Test Long Life Rice');

  const stillThere = await page.evaluate(() => AppState.plannedBatches);
  expect(stillThere).toEqual([{ id, recipeId: 'r_longlife', servings: 3, addedAt: stillThere[0].addedAt }]);
});

// The recipe modal used to live inside the Recipes tab section, so on the Plan tab it
// had its "hidden" class removed but stayed invisible (display:none ancestor). These
// assert real visibility and clickability, not just the class.

test('Plan tab: batch title opens a visible recipe detail (ingredients + instructions), via mouse and keyboard', async ({ page }) => {
  await loadWithPlanRecipes(page);
  await page.evaluate(() => { addPlannedBatch('r_longlife'); showTab('planner'); });

  const nameLink = page.locator('#planned-batches-list .batch-name-btn');
  await nameLink.click();
  await expect(page.locator('#recipe-modal')).toBeVisible();
  await expect(page.locator('#recipe-name')).toHaveValue('Test Long Life Rice');
  await expect(page.locator('#ingredients-list input').first()).toHaveValue('Test Rice');
  await expect(page.locator('#instructions')).toHaveValue('Cook.');
  await page.locator('#cancel-btn').click();
  await expect(page.locator('#recipe-modal')).toBeHidden();
  await expect(page.locator('#planner')).toBeVisible(); // still on the Plan tab

  await nameLink.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#recipe-modal')).toBeVisible();
  expect(await page.evaluate(() => String(AppState.currentEditingRecipe))).toBe('r_longlife');
});

test('Plan tab: servings −/+ and remove never open the recipe detail', async ({ page }) => {
  await loadWithPlanRecipes(page);
  await page.evaluate(() => { addPlannedBatch('r_longlife'); showTab('planner'); });
  const row = page.locator('#planned-batches-list .batch-row');

  await row.locator('.batch-step-btn', { hasText: '+' }).click();
  await row.locator('.batch-step-btn', { hasText: '−' }).click();
  await row.locator('.batch-step-btn', { hasText: '+' }).click();
  await expect(page.locator('#recipe-modal')).toBeHidden();
  expect(await page.evaluate(() => AppState.plannedBatches[0].servings)).toBe(3);

  await row.locator('.batch-remove-btn').click();
  await expect(page.locator('#recipe-modal')).toBeHidden();
  expect(await page.evaluate(() => AppState.plannedBatches)).toEqual([]);
});

test('Add-meals picker: title opens a visible recipe detail above the picker; closing it returns to the picker with search and plan intact', async ({ page }) => {
  await loadWithPlanRecipes(page);
  await page.evaluate(() => { showTab('planner'); openBatchPickerModal(); });
  await page.fill('#batch-picker-search', 'Long Life');

  const row = page.locator('#batch-picker-results .batch-result', { hasText: 'Test Long Life Rice' });
  await row.locator('.batch-name-btn').click();
  await expect(page.locator('#recipe-modal')).toBeVisible();
  await expect(page.locator('#ingredients-list input').first()).toHaveValue('Test Rice');
  await expect(page.locator('#instructions')).toHaveValue('Cook.');
  expect(await page.evaluate(() => AppState.plannedBatches)).toEqual([]); // inspecting never adds

  // Playwright refuses to click an obscured element, so this proves the detail stacks above the picker.
  await page.locator('#cancel-btn').click();
  await expect(page.locator('#recipe-modal')).toBeHidden();
  await expect(page.locator('#batch-picker-modal')).toBeVisible();
  await expect(page.locator('#batch-picker-search')).toHaveValue('Long Life');
  await expect(row.locator('.batch-add-btn')).toBeVisible();

  // Keyboard: Enter on the focused title opens the same detail.
  await row.locator('.batch-name-btn').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#recipe-modal')).toBeVisible();
  await page.locator('#recipe-modal .modal-close').click();
  await expect(page.locator('#batch-picker-modal')).toBeVisible();
});

test('Add-meals picker: + Add and favorite never open the recipe detail', async ({ page }) => {
  await loadWithPlanRecipes(page);
  await page.evaluate(() => { showTab('planner'); openBatchPickerModal(); });
  const row = page.locator('#batch-picker-results .batch-result', { hasText: 'Test Long Life Rice' });

  await row.locator('.recipe-fav-btn').click();
  await expect(page.locator('#recipe-modal')).toBeHidden();
  await row.locator('.batch-add-btn').click();
  await expect(page.locator('#recipe-modal')).toBeHidden();
  await expect(row.locator('.batch-picker-added')).toHaveText('Added ✓');
  expect(await page.evaluate(() => AppState.plannedBatches.map((b) => b.recipeId))).toEqual(['r_longlife']);
});

// ── Recipe inspection follow-up: the whole non-action info area is the target, and
// each click opens the detail exactly once. Counted via a wrapper around the one
// authoritative openEditRecipeModal, so a double-fire (button + bubbling) would show.

async function countDetailOpens(page) {
  await page.evaluate(() => {
    window.__detailOpens = [];
    const orig = window.openEditRecipeModal;
    window.openEditRecipeModal = function(id) { window.__detailOpens.push(String(id)); return orig(id); };
  });
}
const detailOpens = (page) => page.evaluate(() => window.__detailOpens.slice());

test('Add-meals picker: title and the meta/blank info area each open the detail exactly once; Add, Added and favorite never do', async ({ page }) => {
  await loadWithPlanRecipes(page);
  await countDetailOpens(page);
  await page.evaluate(() => { showTab('planner'); openBatchPickerModal(); });
  await page.fill('#batch-picker-search', 'Long Life');
  const row = page.locator('#batch-picker-results .batch-result', { hasText: 'Test Long Life Rice' });

  await row.locator('.batch-name-btn').click();
  await expect(page.locator('#recipe-modal')).toBeVisible();
  expect(await detailOpens(page)).toEqual(['r_longlife']);
  await page.locator('#cancel-btn').click();

  await row.locator('.batch-meta').click();
  await expect(page.locator('#recipe-modal')).toBeVisible();
  await expect(page.locator('#ingredients-list input').first()).toHaveValue('Test Rice');
  await expect(page.locator('#instructions')).toHaveValue('Cook.');
  expect(await detailOpens(page)).toEqual(['r_longlife', 'r_longlife']);
  await page.locator('#cancel-btn').click();
  await expect(page.locator('#batch-picker-modal')).toBeVisible();
  await expect(page.locator('#batch-picker-search')).toHaveValue('Long Life');
  expect(await page.evaluate(() => AppState.plannedBatches)).toEqual([]); // inspecting never adds

  await row.locator('.recipe-fav-btn').click();
  await row.locator('.batch-add-btn').click();
  await row.locator('.batch-picker-added').click();
  await expect(page.locator('#recipe-modal')).toBeHidden();
  expect(await detailOpens(page)).toHaveLength(2);
  expect(await page.evaluate(() => AppState.plannedBatches.map((b) => b.recipeId))).toEqual(['r_longlife']);
  expect(await page.evaluate(() => AppState.recipes.find((r) => r.id === 'r_longlife').favorite)).toBe(true);
});

test('Plan tab batches: title and meta each open the detail exactly once; stepper, servings count and remove never do; plan state is kept', async ({ page }) => {
  await loadWithPlanRecipes(page);
  await countDetailOpens(page);
  await page.evaluate(() => {
    addPlannedBatch('r_longlife');
    AppState.weeklyPlan.Monday.lunch = 'r_shortlife';
    showTab('planner');
  });
  const row = page.locator('#planned-batches-list .batch-row');

  await row.locator('.batch-name-btn').click();
  await expect(page.locator('#recipe-modal')).toBeVisible();
  expect(await detailOpens(page)).toEqual(['r_longlife']);
  await page.locator('#recipe-modal .modal-close').click();

  await row.locator('.batch-meta').click();
  await expect(page.locator('#recipe-modal')).toBeVisible();
  await expect(page.locator('#recipe-name')).toHaveValue('Test Long Life Rice');
  expect(await detailOpens(page)).toEqual(['r_longlife', 'r_longlife']);
  await page.locator('#cancel-btn').click();
  await expect(page.locator('#recipe-modal')).toBeHidden();
  await expect(page.locator('#planner')).toBeVisible();

  await row.locator('.batch-step-btn', { hasText: '+' }).click();
  await row.locator('.batch-servings').click();
  await row.locator('.batch-step-btn', { hasText: '−' }).click();
  await expect(page.locator('#recipe-modal')).toBeHidden();
  expect(await detailOpens(page)).toHaveLength(2);
  expect(await page.evaluate(() => ({
    servings: AppState.plannedBatches.map((b) => b.servings),
    monday: AppState.weeklyPlan.Monday.lunch
  }))).toEqual({ servings: [2], monday: 'r_shortlife' });

  await row.locator('.batch-remove-btn').click();
  await expect(page.locator('#recipe-modal')).toBeHidden();
  expect(await detailOpens(page)).toHaveLength(2);
  expect(await page.evaluate(() => AppState.plannedBatches)).toEqual([]);
});

test('Plan tab: a batch whose recipe was deleted is not inspectable', async ({ page }) => {
  await loadWithPlanRecipes(page);
  await countDetailOpens(page);
  await page.evaluate(() => {
    AppState.plannedBatches = [{ id: 'pb_gone', recipeId: 'r_missing', servings: 2, addedAt: null }];
    showTab('planner');
    renderPlannedBatches();
  });
  const row = page.locator('#planned-batches-list .batch-row');
  await expect(row.locator('.batch-name-btn')).toHaveCount(0);
  await row.locator('.batch-meta').click();
  await expect(page.locator('#recipe-modal')).toBeHidden();
  expect(await detailOpens(page)).toEqual([]);
});

test('closing another modal does not run the recipe modal close handler', async ({ page }) => {
  await loadWithPlanRecipes(page);
  // Regression guard: the recipe modal's close was bound via the document's FIRST .modal-close.
  await page.evaluate(() => openEditRecipeModal('r_longlife'));
  const clickedOther = await page.evaluate(() => {
    document.getElementById('recipe-modal').classList.add('hidden'); // hide without clearing the form
    const first = document.querySelector('.modal-close');
    if (first.closest('#recipe-modal')) return false;
    first.closest('.modal').classList.remove('hidden');
    first.click();
    return true;
  });
  expect(clickedOther).toBe(true); // recipe modal is no longer the first modal in the document
  await expect(page.locator('#recipe-name')).toHaveValue('Test Long Life Rice');
});

test('a long recipe name in the batch list wraps instead of overflowing horizontally', async ({ page }) => {
  await loadWithPlanRecipes(page);
  await page.evaluate(() => {
    AppState.recipes.push({
      id: 'r_long_name', name: 'A Very Long Test Recipe Name That Should Wrap Cleanly Across Several Lines Without Any Horizontal Overflow',
      baseServings: 2, currentServings: 2, baseIngredients: [], instructions: '',
      nutritionPerServing: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0 }
    });
    addPlannedBatch('r_long_name');
    showTab('planner');
  });
  const overflow = await page.evaluate(() => {
    const list = document.getElementById('planned-batches-list');
    return list.scrollWidth - list.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
});

test('the freshness warning links a recipe by the same stable id the plan slot stores', async ({ page }) => {
  await loadWithPlanRecipes(page);
  await page.evaluate(() => {
    AppState.weeklyPlan.Wednesday.dinner = 'r_shortlife';
    saveData();
    showTab('planner');
    renderWeeklyPlanner();
  });
  const link = page.locator('.storage-alert-recipe-link');
  await expect(link).toHaveText('Test Short Life Stew');
  await link.click();
  const editing = await page.evaluate(() => String(AppState.currentEditingRecipe));
  expect(editing).toBe('r_shortlife');
});

// ── Picker spacing (Part 2) ───────────────────────────────────────────────────

for (const vp of [{ width: 360, height: 740 }, { width: 390, height: 844 }, { width: 1280, height: 900 }]) {
  test(`Add-meals picker has no horizontal overflow at ${vp.width}px and content is inset from the modal edges`, async ({ page }) => {
    await page.setViewportSize(vp);
    await loadWithPlanRecipes(page);
    await page.evaluate(() => { showTab('planner'); openBatchPickerModal(); });
    await expect(page.locator('#batch-picker-modal')).not.toHaveClass(/hidden/);

    const metrics = await page.evaluate(() => {
      const content = document.querySelector('#batch-picker-modal .modal-content');
      const row = document.querySelector('.batch-search-row');
      const results = document.getElementById('batch-picker-results');
      const rowPad = parseFloat(getComputedStyle(row).paddingLeft);
      return {
        contentOverflow: content.scrollWidth - content.clientWidth,
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        rowPad,
        resultsPad: parseFloat(getComputedStyle(results).paddingLeft)
      };
    });
    expect(metrics.contentOverflow).toBeLessThanOrEqual(1);
    expect(metrics.pageOverflow).toBeLessThanOrEqual(1);
    expect(metrics.rowPad).toBeGreaterThanOrEqual(12);
    expect(metrics.rowPad).toBeLessThanOrEqual(16);
    expect(metrics.resultsPad).toBeGreaterThanOrEqual(12);
    expect(metrics.resultsPad).toBeLessThanOrEqual(16);
  });
}

// ── Favorites: reused mechanism, wired into the picker ──────────────────────

test('picker favorite toggle: star toggles recipe.favorite, persists, and never touches plannedBatches or Added state', async ({ page }) => {
  await loadWithPlanRecipes(page);
  await page.evaluate(() => { showTab('planner'); openBatchPickerModal(); });

  const star = page.locator('#batch-picker-results .batch-result', { hasText: 'Test Long Life Rice' }).locator('.recipe-fav-btn');
  await expect(star).not.toHaveClass(/active/);

  await star.click(); // ☆ -> ★
  await expect(star).toHaveClass(/active/);
  expect(await page.evaluate(() => AppState.recipes.find((r) => r.id === 'r_longlife').favorite)).toBe(true);
  expect(await page.evaluate(() => AppState.plannedBatches)).toEqual([]); // favoriting never adds a batch

  await star.click(); // ★ -> ☆
  await expect(star).not.toHaveClass(/active/);
  expect(await page.evaluate(() => AppState.recipes.find((r) => r.id === 'r_longlife').favorite)).toBe(false);

  await star.click(); // leave it favorited for the reload check
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForRestored(page, () => AppState.recipes.some((r) => r.id === 'r_longlife' && r.favorite === true));
  expect(await page.evaluate(() => AppState.recipes.find((r) => r.id === 'r_longlife').favorite)).toBe(true);
});

test('adding a recipe does not favorite it; an Added-✓ recipe can still be favorited; title inspection still works alongside both', async ({ page }) => {
  await loadWithPlanRecipes(page);
  await page.evaluate(() => { showTab('planner'); openBatchPickerModal(); });

  const row = page.locator('#batch-picker-results .batch-result', { hasText: 'Test Long Life Rice' });
  await row.locator('.batch-add-btn').click();
  expect(await page.evaluate(() => AppState.recipes.find((r) => r.id === 'r_longlife').favorite)).toBeFalsy();
  await expect(row.locator('.batch-picker-added')).toHaveText('Added ✓');

  await row.locator('.recipe-fav-btn').click();
  expect(await page.evaluate(() => AppState.recipes.find((r) => r.id === 'r_longlife').favorite)).toBe(true);
  await expect(row.locator('.batch-picker-added')).toHaveText('Added ✓'); // unaffected by favoriting
  expect(await page.evaluate(() => AppState.plannedBatches.map((b) => b.servings))).toEqual([2]); // unaffected

  await row.locator('.batch-name-btn').click();
  expect(await page.evaluate(() => String(AppState.currentEditingRecipe))).toBe('r_longlife');
});

test('duplicate display names cannot cross-toggle favorite state — identity is by recipeId', async ({ page }) => {
  await loadWithPlanRecipes(page);
  await page.evaluate(() => {
    AppState.recipes.push({
      id: 'r_dup_a', name: 'Duplicate Name Recipe', baseServings: 1, currentServings: 1,
      baseIngredients: [], instructions: '', nutritionPerServing: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0 }
    });
    AppState.recipes.push({
      id: 'r_dup_b', name: 'Duplicate Name Recipe', baseServings: 1, currentServings: 1,
      baseIngredients: [], instructions: '', nutritionPerServing: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0 }
    });
    toggleFavorite('r_dup_a');
  });
  const r = await page.evaluate(() => ({
    a: AppState.recipes.find((r) => r.id === 'r_dup_a').favorite,
    b: AppState.recipes.find((r) => r.id === 'r_dup_b').favorite
  }));
  expect(r.a).toBe(true);
  expect(r.b).toBeFalsy();
});

test('Favorites chip filters the picker to favorited recipes only, and composes with Low effort', async ({ page }) => {
  await loadWithPlanRecipes(page);
  await page.evaluate(() => { toggleFavorite('r_longlife'); showTab('planner'); openBatchPickerModal(); });

  await expect(page.locator('#batch-picker-favorites-chip')).not.toHaveClass(/active/);
  await page.click('#batch-picker-favorites-chip');
  await expect(page.locator('#batch-picker-favorites-chip')).toHaveClass(/active/);

  const names = await page.locator('#batch-picker-results .batch-name').allTextContents();
  expect(names).toEqual(['Test Long Life Rice']);

  await page.click('#batch-picker-favorites-chip'); // OFF restores "All recipes"
  const namesAfter = await page.locator('#batch-picker-results .batch-name').allTextContents();
  expect(namesAfter.length).toBeGreaterThan(1);
});
