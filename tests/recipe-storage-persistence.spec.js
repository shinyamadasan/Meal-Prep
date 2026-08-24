const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');
const { waitForAppReady } = require('./app-ready');

test.use({ viewport: { width: 1000, height: 1400 } });

async function loadLocalApp(page) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
  });
  await page.goto(pathToFileURL(path.resolve('index.html')).href, { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
}

test('recipe storage life can remain unknown end-to-end', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate(() => {
    const normalized = normalizeRecipes([{
      id: 'unknown-storage',
      name: 'Unknown Storage Recipe',
      fridgeLife: null,
      freezerLife: null,
      baseIngredients: []
    }])[0];
    const legacy = normalizeRecipes([{ id: 'legacy-storage', name: 'Legacy Storage Recipe', baseIngredients: [] }])[0];

    AppState.recipes = [{
      id: 'unknown-storage',
      name: 'Unknown Storage Recipe',
      category: 'Main Dish',
      basePrepTime: 5,
      baseCookTime: 10,
      baseServings: 2,
      currentServings: 2,
      fridgeLife: null,
      freezerLife: null,
      estimatedCost: 0,
      costPerServing: 0,
      storageNotes: '',
      instructions: 'Cook it.',
      baseIngredients: [{ name: 'Pork', baseQuantity: 1, unit: 'kg', category: 'Protein' }]
    }];
    AppState.weeklyPlan = {
      Monday: { breakfast: 'unknown-storage', lunch: null, dinner: null, snacks: [] },
      Tuesday: { breakfast: null, lunch: null, dinner: null, snacks: [] },
      Wednesday: { breakfast: null, lunch: null, dinner: null, snacks: [] },
      Thursday: { breakfast: null, lunch: null, dinner: null, snacks: [] },
      Friday: { breakfast: null, lunch: null, dinner: null, snacks: [] },
      Saturday: { breakfast: null, lunch: null, dinner: null, snacks: [] },
      Sunday: { breakfast: null, lunch: null, dinner: null, snacks: [] }
    };
    AppState.pantry = [];
    AppState.cookedMeals = [];

    showTab('recipes');
    renderRecipes();
    const recipeText = document.getElementById('recipes-grid').textContent;

    openEditRecipeModal('unknown-storage');
    const fridgeFormValue = document.getElementById('fridge-life').value;
    const freezerFormValue = document.getElementById('freezer-life').value;
    closeRecipeModal();

    const unknownExpires = willExpire(AppState.recipes[0], 'Sunday');
    renderStorageAlerts();
    const storageAlertText = document.getElementById('storage-alerts').textContent;

    _doMarkCooked(AppState.recipes[0], null, 1);
    const cooked = AppState.cookedMeals[0];
    const cookedText = document.getElementById('cooked-meals-list').textContent;
    const expiredCookedCount = document.querySelectorAll('#cooked-meals-list .fresh-expired').length;

    return {
      normalizedFridge: normalized.fridgeLife,
      normalizedFreezer: normalized.freezerLife,
      legacyFridge: legacy.fridgeLife,
      legacyFreezer: legacy.freezerLife,
      parseBlank: parseNullableDayValue(''),
      parseNumber: parseNullableDayValue('7'),
      recipeText,
      fridgeFormValue,
      freezerFormValue,
      unknownExpires,
      storageAlertText,
      cookedFridge: cooked.fridgeLife,
      cookedFreezer: cooked.freezerLife,
      cookedText,
      expiredCookedCount
    };
  });

  expect(result.normalizedFridge).toBeNull();
  expect(result.normalizedFreezer).toBeNull();
  expect(result.legacyFridge).toBe(0);
  expect(result.legacyFreezer).toBe(0);
  expect(result.parseBlank).toBeNull();
  expect(result.parseNumber).toBe(7);
  expect(result.recipeText).toContain('Fridge: Unknown');
  expect(result.recipeText).toContain('Freezer: Unknown');
  expect(result.fridgeFormValue).toBe('');
  expect(result.freezerFormValue).toBe('');
  expect(result.unknownExpires).toBe(false);
  expect(result.storageAlertText).not.toContain('only lasts');
  expect(result.cookedFridge).toBeNull();
  expect(result.cookedFreezer).toBeNull();
  expect(result.cookedText).toContain('Fridge Unknown');
  expect(result.cookedText).toContain('Freezer Unknown');
  expect(result.cookedText).not.toContain('Fridge 0d');
  expect(result.expiredCookedCount).toBe(0);
});

test('manual recipe save uses the canonical persist path for add and edit', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate(() => {
    let renderRecipesCount = 0;
    let renderSelectionCount = 0;
    let saveDataCount = 0;
    let savedPhotoId = null;
    let deletedPhotoId = null;

    const originalRenderRecipes = renderRecipes;
    const originalRenderRecipeSelectionGrid = renderRecipeSelectionGrid;
    const originalSaveData = saveData;
    const originalSavePhotoDoc = savePhotoDoc;
    const originalDeletePhotoDoc = deletePhotoDoc;

    renderRecipes = function() { renderRecipesCount++; };
    renderRecipeSelectionGrid = function() { renderSelectionCount++; };
    saveData = function() { saveDataCount++; };
    savePhotoDoc = function(id) { savedPhotoId = id; };
    deletePhotoDoc = function(id) { deletedPhotoId = id; };

    try {
      AppState.recipes = [];
      persistRecipe({
        id: 'r1',
        name: 'Persisted Recipe',
        category: 'Main Dish',
        baseServings: 2,
        currentServings: 2,
        basePrepTime: 1,
        baseCookTime: 2,
        fridgeLife: 3,
        freezerLife: 30,
        instructions: 'Cook.',
        photo: 'data:image/jpeg;base64,AAAA',
        baseIngredients: []
      });

      persistRecipe({
        id: 'r1',
        name: 'Edited Persisted Recipe',
        category: 'Main Dish',
        baseServings: 4,
        currentServings: 4,
        basePrepTime: 1,
        baseCookTime: 2,
        fridgeLife: null,
        freezerLife: null,
        instructions: 'Cook again.',
        photo: null,
        baseIngredients: []
      });

      return {
        recipeCount: AppState.recipes.length,
        recipeName: AppState.recipes[0].name,
        renderRecipesCount,
        renderSelectionCount,
        saveDataCount,
        savedPhotoId,
        deletedPhotoId
      };
    } finally {
      renderRecipes = originalRenderRecipes;
      renderRecipeSelectionGrid = originalRenderRecipeSelectionGrid;
      saveData = originalSaveData;
      savePhotoDoc = originalSavePhotoDoc;
      deletePhotoDoc = originalDeletePhotoDoc;
    }
  });

  expect(result.recipeCount).toBe(1);
  expect(result.recipeName).toBe('Edited Persisted Recipe');
  expect(result.renderRecipesCount).toBe(2);
  expect(result.renderSelectionCount).toBe(2);
  expect(result.saveDataCount).toBe(2);
  expect(result.savedPhotoId).toBe('r1');
  expect(result.deletedPhotoId).toBe('r1');
});
