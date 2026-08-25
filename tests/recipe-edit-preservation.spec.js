const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');
const { waitForRestored } = require('./app-ready');

/**
 * Regression: editing a recipe must not silently drop properties the form
 * doesn't own.
 *
 * saveRecipe() used to rebuild the whole recipe object from the form and copy
 * across only sourceUrl / sourceSite / importedAt, so an unrelated edit (renaming
 * a recipe, fixing a typo in the instructions) quietly destroyed `favorite`,
 * `highlights`, `updatedAt`, the nutrition fields with no inputs (fiber, sodium),
 * and every low-effort metadata field.
 */

test.use({ viewport: { width: 1200, height: 1500 } });

async function loadLocalApp(page) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__editPreserveBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__editPreserveBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
  });
  await page.goto(pathToFileURL(path.resolve('index.html')).href, { waitUntil: 'domcontentloaded' });
  // Condition, not clock. See AI_OS_NOTES 2026-08-23.
  await page.waitForFunction(
    () => typeof AppState !== 'undefined' && Array.isArray(AppState.recipes) &&
          typeof saveToLocalStorage === 'function' && typeof renderRecipes === 'function',
    null, { timeout: 30000 });
  await page.waitForTimeout(300);
}

// A recipe carrying every category of property the form does NOT own.
const RICH_RECIPE = {
  id: 'rich-1',
  name: 'Imported Pork Adobo',
  category: 'Main Dish',
  basePrepTime: 10,
  baseCookTime: 40,
  baseServings: 4,
  currentServings: 4,
  fridgeLife: 4,
  freezerLife: 60,
  estimatedCost: 500,
  costPerServing: 125,
  storageNotes: 'Keep covered.',
  instructions: 'Simmer until tender.',
  photo: null,
  baseIngredients: [
    { name: 'Pork', baseQuantity: 800, unit: 'g', category: 'Protein' },
    { name: 'Soy Sauce', baseQuantity: 80, unit: 'ml', category: 'Pantry' }
  ],
  nutritionPerServing: { calories: 560, protein: 40, carbs: 8, fat: 38, fiber: 3, sodium: 950 },

  // ── none of the following has a form input ──
  favorite: true,
  highlights: ['Family favourite', 'Better next day'],
  sourceUrl: 'https://panlasangpinoy.com/pork-adobo',
  sourceSite: 'panlasangpinoy.com',
  importedAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-02T00:00:00.000Z',

  // ── low-effort metadata (has form inputs, must survive too) ──
  equipment: ['instant-pot', 'pressure-cooker'],
  effort: 'low',
  activeTime: 10,
  mealBalance: { protein: true, vegetables: false, carb: false },
  tags: ['batch-friendly', 'freezer-friendly']
};

// Opens the edit form, changes ONLY the name, and saves.
async function renameViaForm(page, recipeId, newName) {
  await page.evaluate((id) => {
    showTab('recipes');
    renderRecipes();
    openEditRecipeModal(id);
  }, recipeId);
  await page.locator('#recipe-name').fill(newName);
  await page.locator('#recipe-submit-btn').click();
  await page.waitForTimeout(600);
}

test('an unrelated edit preserves favorite, highlights, provenance and metadata', async ({ page }) => {
  await loadLocalApp(page);
  await page.evaluate((recipe) => {
    AppState.recipes = normalizeRecipes([JSON.parse(JSON.stringify(recipe))]);
    showTab('recipes');
    renderRecipes();
  }, RICH_RECIPE);

  await renameViaForm(page, 'rich-1', 'Renamed Pork Adobo');

  const after = await page.evaluate(() => {
    const r = AppState.recipes.find((x) => String(x.id) === 'rich-1');
    return {
      count: AppState.recipes.length,
      name: r.name,
      favorite: r.favorite,
      highlights: r.highlights,
      sourceUrl: r.sourceUrl,
      sourceSite: r.sourceSite,
      importedAt: r.importedAt,
      updatedAt: r.updatedAt,
      equipment: r.equipment,
      effort: r.effort,
      activeTime: r.activeTime,
      mealBalance: r.mealBalance,
      tags: r.tags,
      nutrition: r.nutritionPerServing,
      // The edit itself still applied, and form-owned fields are untouched.
      instructions: r.instructions,
      cookTime: r.baseCookTime,
      ingredients: r.baseIngredients.map((i) => i.name)
    };
  });

  expect(after.count).toBe(1);
  expect(after.name).toBe('Renamed Pork Adobo');

  // Properties with no form input — previously destroyed by any edit.
  expect(after.favorite).toBe(true);
  expect(after.highlights).toEqual(['Family favourite', 'Better next day']);
  expect(after.sourceUrl).toBe('https://panlasangpinoy.com/pork-adobo');
  expect(after.sourceSite).toBe('panlasangpinoy.com');
  expect(after.importedAt).toBe('2026-08-01T00:00:00.000Z');
  // updatedAt drives tombstone last-write-wins; losing it made a stale tombstone win.
  expect(after.updatedAt).toBe('2026-08-02T00:00:00.000Z');

  // Low-effort metadata round-trips through the form.
  expect(after.equipment).toEqual(['instant-pot', 'pressure-cooker']);
  expect(after.effort).toBe('low');
  expect(after.activeTime).toBe(10);
  expect(after.mealBalance).toEqual({ protein: true, vegetables: false, carb: false });
  expect(after.tags).toEqual(['batch-friendly', 'freezer-friendly']);

  // Fiber and sodium have no inputs, so an edit must not zero them.
  expect(after.nutrition).toEqual({ calories: 560, protein: 40, carbs: 8, fat: 38, fiber: 3, sodium: 950 });

  // And the rest of the form's own fields are unchanged by a rename.
  expect(after.instructions).toBe('Simmer until tender.');
  expect(after.cookTime).toBe(40);
  expect(after.ingredients).toEqual(['Pork', 'Soy Sauce']);
});

test('preserved properties survive a save and reload', async ({ page }) => {
  await loadLocalApp(page);
  await page.evaluate((recipe) => {
    AppState.recipes = normalizeRecipes([JSON.parse(JSON.stringify(recipe))]);
    saveToLocalStorage();
    showTab('recipes');
    renderRecipes();
  }, RICH_RECIPE);

  await renameViaForm(page, 'rich-1', 'Reloaded Adobo');

  await page.reload({ waitUntil: 'domcontentloaded' });
  // Wait for the RESTORED recipe specifically. A fixed wait could read mid-init, when the
  // list is empty or freshly re-seeded, and report the edit as lost. Identity only — the
  // rename is the behaviour under test, so a lost edit stays a readable diff below.
  await waitForRestored(page, () =>
    AppState.recipes.some((x) => String(x.id) === 'rich-1'));

  const after = await page.evaluate(() => {
    const r = AppState.recipes.find((x) => String(x.id) === 'rich-1');
    return {
      name: r.name, favorite: r.favorite, highlights: r.highlights,
      sourceUrl: r.sourceUrl, importedAt: r.importedAt,
      equipment: r.equipment, tags: r.tags, effort: r.effort,
      fiber: r.nutritionPerServing.fiber, sodium: r.nutritionPerServing.sodium
    };
  });

  expect(after.name).toBe('Reloaded Adobo');
  expect(after.favorite).toBe(true);
  expect(after.highlights).toEqual(['Family favourite', 'Better next day']);
  expect(after.sourceUrl).toBe('https://panlasangpinoy.com/pork-adobo');
  expect(after.importedAt).toBe('2026-08-01T00:00:00.000Z');
  expect(after.equipment).toEqual(['instant-pot', 'pressure-cooker']);
  expect(after.tags).toEqual(['batch-friendly', 'freezer-friendly']);
  expect(after.effort).toBe('low');
  expect(after.fiber).toBe(3);
  expect(after.sodium).toBe(950);
});

test('the form stays authoritative for the fields it does own', async ({ page }) => {
  await loadLocalApp(page);
  await page.evaluate((recipe) => {
    AppState.recipes = normalizeRecipes([JSON.parse(JSON.stringify(recipe))]);
    showTab('recipes');
    renderRecipes();
    openEditRecipeModal('rich-1');
  }, RICH_RECIPE);

  // Change form-owned fields, including CLEARING optional ones.
  await page.locator('#recipe-name').fill('Rewritten Adobo');
  await page.locator('#cook-time').fill('0');
  await page.locator('#fridge-life').fill('');
  await page.locator('#instructions').fill('No longer simmered.');
  await page.locator('#recipe-effort').selectOption('assembly');
  await page.locator('#recipe-active-time').fill('');
  await page.evaluate(() => {
    document.querySelectorAll('#recipe-equipment-chips input:checked').forEach((i) => { i.checked = false; });
    document.querySelector('#recipe-equipment-chips input[value="no-cook"]').checked = true;
    document.getElementById('balance-vegetables').checked = true;
  });
  await page.locator('#recipe-submit-btn').click();
  await page.waitForTimeout(600);

  const after = await page.evaluate(() => {
    const r = AppState.recipes.find((x) => String(x.id) === 'rich-1');
    return {
      name: r.name, cookTime: r.baseCookTime, fridgeLife: r.fridgeLife,
      instructions: r.instructions, effort: r.effort, activeTime: r.activeTime,
      equipment: r.equipment, mealBalance: r.mealBalance,
      favorite: r.favorite, highlights: r.highlights
    };
  });

  // Overwrites and clears both land — preservation must not make the form read-only.
  expect(after.name).toBe('Rewritten Adobo');
  expect(after.cookTime).toBe(0);
  expect(after.fridgeLife).toBeNull();
  expect(after.instructions).toBe('No longer simmered.');
  expect(after.effort).toBe('assembly');
  expect(after.activeTime).toBeNull(); // cleared, not left at the old 10
  expect(after.equipment).toEqual(['no-cook']);
  expect(after.mealBalance).toEqual({ protein: true, vegetables: true, carb: false });
  // …while the unowned properties still ride along.
  expect(after.favorite).toBe(true);
  expect(after.highlights).toEqual(['Family favourite', 'Better next day']);
});

test('clearing every nutrition input still clears the recipe nutrition', async ({ page }) => {
  await loadLocalApp(page);
  await page.evaluate((recipe) => {
    AppState.recipes = normalizeRecipes([JSON.parse(JSON.stringify(recipe))]);
    showTab('recipes');
    renderRecipes();
    openEditRecipeModal('rich-1');
  }, RICH_RECIPE);

  for (const id of ['nutrition-calories', 'nutrition-protein', 'nutrition-carbs', 'nutrition-fat']) {
    await page.locator('#' + id).fill('');
  }
  await page.locator('#recipe-submit-btn').click();
  await page.waitForTimeout(600);

  const after = await page.evaluate(() => {
    const r = AppState.recipes.find((x) => String(x.id) === 'rich-1');
    return { nutrition: r.nutritionPerServing, favorite: r.favorite };
  });

  // Unchanged behaviour: emptying all four is a deliberate clear, not a no-op.
  expect(after.nutrition).toBeUndefined();
  // Preservation of unowned properties is unaffected by that path.
  expect(after.favorite).toBe(true);
});

test('adding a brand-new recipe is unaffected by the preservation path', async ({ page }) => {
  await loadLocalApp(page);
  await page.evaluate(() => {
    AppState.recipes = [];
    showTab('recipes');
    renderRecipes();
    openAddRecipeModal();
  });

  await page.locator('#recipe-name').fill('Fresh New Recipe');
  await page.locator('#recipe-category').selectOption('Main Dish');
  await page.locator('#prep-time').fill('5');
  await page.locator('#cook-time').fill('10');
  await page.locator('#servings').fill('2');
  await page.locator('#instructions').fill('Cook briefly.');
  const ing = page.locator('.ingredient-item').first();
  await ing.locator('input[type="text"]').fill('Egg');
  await ing.locator('input[type="number"]').fill('2');
  await ing.locator('select').nth(0).selectOption('pieces');
  await ing.locator('select').nth(1).selectOption('Protein');
  await page.locator('#recipe-submit-btn').click();
  await page.waitForTimeout(600);

  const created = await page.evaluate(() => {
    const r = AppState.recipes.find((x) => x.name === 'Fresh New Recipe');
    return r && {
      favorite: r.favorite, highlights: r.highlights, sourceUrl: r.sourceUrl,
      cookTime: r.baseCookTime, count: AppState.recipes.length
    };
  });

  expect(created).toBeTruthy();
  expect(created.count).toBe(1);
  expect(created.cookTime).toBe(10);
  // A new recipe inherits nothing — there is no existing object to merge from.
  expect(created.favorite).toBeUndefined();
  expect(created.highlights).toBeUndefined();
  expect(created.sourceUrl).toBeUndefined();
});
