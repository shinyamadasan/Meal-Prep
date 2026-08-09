const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

async function loadLocalApp(page, workerEnvelope) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript((envelope) => {
    try {
      localStorage.clear();
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
    window.RECIPE_IMPORT_ENDPOINT = 'https://worker.test/recipe-import';
    window.fetch = async (url, options) => {
      if (url === window.RECIPE_IMPORT_ENDPOINT) {
        window.__lastRecipeImportRequest = JSON.parse(options.body);
        return new Response(JSON.stringify(envelope), {
          status: envelope.ok === false ? 422 : 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      throw new Error('Unexpected fetch: ' + url);
    };
  }, workerEnvelope);
  await page.goto(pathToFileURL(path.resolve('index.html')).href, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
}

const cleanEnvelope = {
  ok: true,
  recipe: {
    name: 'Paksiw na Baboy',
    prepTime: 'PT15M',
    cookTime: 'PT1H',
    recipeYield: '4 servings',
    rawIngredients: ['2 lbs pork belly', '1/2 cup vinegar', '3 cloves garlic'],
    instructions: [{ text: 'Brown pork.' }, { text: 'Simmer with vinegar.' }],
    nutrition: { calories: '824 calories', proteinContent: '25 g' },
    image: 'https://example.com/paksiw.jpg',
    requestedUrl: 'https://panlasangpinoy.com/paksiw-na-baboy/',
    finalUrl: 'https://panlasangpinoy.com/paksiw-na-baboy/',
    sourceSite: 'panlasangpinoy.com'
  },
  warnings: []
};

test('clean URL import saves a canonical recipe with provenance and no transient draft fields', async ({ page }) => {
  await loadLocalApp(page, cleanEnvelope);
  await page.locator('.tab-btn[data-tab="recipes"]').click();
  const startingRecipeCount = await page.evaluate(() => AppState.recipes.length);

  await page.getByRole('button', { name: /Import Recipe/ }).click();
  await page.locator('#recipe-import-url').fill('https://panlasangpinoy.com/paksiw-na-baboy/');
  await page.locator('#recipe-import-url-btn').click();
  await expect(page.locator('#recipe-import-preview')).toContainText('Ready to save');
  await page.locator('#recipe-import-preview').getByRole('button', { name: 'Save Recipe' }).click();

  await expect(page.locator('#paste-recipe-modal')).toBeHidden();
  await expect(page.locator('#recipes-grid')).toContainText('Paksiw na Baboy');
  const saved = await page.evaluate(() => AppState.recipes.find(r => r.name === 'Paksiw na Baboy'));
  expect(await page.evaluate(() => AppState.recipes.length)).toBe(startingRecipeCount + 1);
  expect(saved).toMatchObject({
    category: 'Main Dish',
    basePrepTime: 15,
    baseCookTime: 60,
    baseServings: 4,
    currentServings: 4,
    fridgeLife: null,
    freezerLife: null,
    estimatedCost: 0,
    costPerServing: 0,
    sourceUrl: 'https://panlasangpinoy.com/paksiw-na-baboy',
    sourceSite: 'panlasangpinoy.com'
  });
  expect(saved.baseIngredients).toHaveLength(3);
  expect(saved.baseIngredients[0]).toEqual({ name: 'pork belly', baseQuantity: 2, unit: 'lbs', category: 'Protein' });
  expect(saved.nutritionPerServing).toMatchObject({ calories: 824, protein: 25 });
  expect(saved.importedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  for (const key of ['warnings', 'errors', 'status', 'yieldText', 'totalTime', 'requestedUrl', 'imageUrl']) {
    expect(saved).not.toHaveProperty(key);
  }
});

test('review save requires corrected servings and ingredients before persisting', async ({ page }) => {
  await loadLocalApp(page, {
    ok: true,
    recipe: {
      name: 'Simple Soup',
      prepTime: 'PT5M',
      cookTime: 'PT20M',
      recipeYield: 'Makes one pot',
      rawIngredients: ['salt to taste'],
      instructions: [{ text: 'Simmer.' }],
      requestedUrl: 'https://example.com/simple-soup/',
      finalUrl: 'https://example.com/simple-soup/',
      sourceSite: 'example.com'
    },
    warnings: []
  });
  await page.locator('.tab-btn[data-tab="recipes"]').click();
  const startingRecipeCount = await page.evaluate(() => AppState.recipes.length);
  await page.getByRole('button', { name: /Import Recipe/ }).click();
  await page.locator('#recipe-import-url').fill('https://example.com/simple-soup/');
  await page.locator('#recipe-import-url-btn').click();

  await expect(page.locator('#recipe-import-preview')).toContainText('Cannot save yet');
  await expect(page.locator('#recipe-import-preview').getByRole('button', { name: 'Save Recipe' })).toHaveCount(0);
  await page.locator('#recipe-import-preview').getByRole('button', { name: /Review \/ Edit Details/ }).click();
  await page.locator('#servings').fill('3');
  const ingredient = page.locator('.ingredient-item').first();
  await ingredient.locator('input').nth(1).fill('1');
  await ingredient.locator('select').nth(0).selectOption('tsp');
  await ingredient.locator('select').nth(1).selectOption('Pantry');
  await page.locator('#recipe-submit-btn').click();

  const saved = await page.evaluate(() => AppState.recipes.find(r => r.name === 'Simple Soup'));
  expect(saved.baseServings).toBe(3);
  expect(saved.currentServings).toBe(3);
  expect(saved.baseIngredients[0]).toEqual({ name: 'salt to taste', baseQuantity: 1, unit: 'tsp', category: 'Pantry' });
  expect(saved.sourceUrl).toBe('https://example.com/simple-soup');
  expect(await page.evaluate(() => AppState.recipes.length)).toBe(startingRecipeCount + 1);
});

test('duplicate source URL warns before save and import-anyway persists only after explicit choice', async ({ page }) => {
  await loadLocalApp(page, cleanEnvelope);
  await page.evaluate(() => {
    persistRecipe({
      id: 12345,
      name: 'Existing Paksiw',
      category: 'Main Dish',
      basePrepTime: 1,
      baseCookTime: 1,
      baseServings: 4,
      currentServings: 4,
      fridgeLife: null,
      freezerLife: null,
      estimatedCost: 0,
      costPerServing: 0,
      storageNotes: '',
      instructions: 'Cook.',
      photo: null,
      baseIngredients: [{ name: 'pork', baseQuantity: 1, unit: 'g', category: 'Protein' }],
      sourceUrl: 'https://panlasangpinoy.com/paksiw-na-baboy',
      sourceSite: 'panlasangpinoy.com',
      importedAt: '2026-01-01T00:00:00.000Z'
    });
  });
  const startingRecipeCount = await page.evaluate(() => AppState.recipes.length);

  await page.locator('.tab-btn[data-tab="recipes"]').click();
  await page.getByRole('button', { name: /Import Recipe/ }).click();
  await page.locator('#recipe-import-url').fill('https://panlasangpinoy.com/paksiw-na-baboy/');
  await page.locator('#recipe-import-url-btn').click();
  await page.locator('#recipe-import-preview').getByRole('button', { name: 'Save Recipe' }).click();
  await expect(page.locator('#recipe-import-status')).toContainText('already be in your library');
  expect(await page.evaluate(() => AppState.recipes.length)).toBe(startingRecipeCount);

  await page.locator('#recipe-import-status').getByRole('button', { name: 'Cancel' }).click();
  expect(await page.evaluate(() => AppState.recipes.length)).toBe(startingRecipeCount);
  await page.locator('#recipe-import-preview').getByRole('button', { name: 'Save Recipe' }).click();
  await page.locator('#recipe-import-status').getByRole('button', { name: 'Import Anyway' }).click();
  expect(await page.evaluate(() => AppState.recipes.length)).toBe(startingRecipeCount + 1);
});

test('normal editing an imported recipe preserves provenance while manual recipes stay untagged', async ({ page }) => {
  await loadLocalApp(page, cleanEnvelope);
  await page.locator('.tab-btn[data-tab="recipes"]').click();
  await page.getByRole('button', { name: /Import Recipe/ }).click();
  await page.locator('#recipe-import-url').fill('https://panlasangpinoy.com/paksiw-na-baboy/');
  await page.locator('#recipe-import-url-btn').click();
  await page.locator('#recipe-import-preview').getByRole('button', { name: 'Save Recipe' }).click();
  const beforeEdit = await page.evaluate(() => {
    const recipe = AppState.recipes.find(r => r.name === 'Paksiw na Baboy');
    return { id: recipe.id, sourceUrl: recipe.sourceUrl, sourceSite: recipe.sourceSite, importedAt: recipe.importedAt };
  });

  await page.evaluate((id) => openEditRecipeModal(id), beforeEdit.id);
  await expect(page.locator('#recipe-modal')).toBeVisible();
  await page.locator('#recipe-name').fill('Imported Edit Target Updated');
  await page.locator('#recipe-submit-btn').click();
  const edited = await page.evaluate((id) => AppState.recipes.find(r => String(r.id) === String(id)), beforeEdit.id);
  expect(edited.sourceUrl).toBe(beforeEdit.sourceUrl);
  expect(edited.sourceSite).toBe(beforeEdit.sourceSite);
  expect(edited.importedAt).toBe(beforeEdit.importedAt);

  await page.locator('#add-recipe-btn').click();
  await page.locator('#recipe-name').fill('Manual Untagged');
  await page.locator('#recipe-category').selectOption('Main Dish');
  await page.locator('#prep-time').fill('5');
  await page.locator('#cook-time').fill('10');
  await page.locator('#servings').fill('2');
  await page.locator('#instructions').fill('Cook manually.');
  const ingredient = page.locator('.ingredient-item').first();
  await ingredient.locator('input').nth(0).fill('rice');
  await ingredient.locator('input').nth(1).fill('100');
  await ingredient.locator('select').nth(0).selectOption('g');
  await ingredient.locator('select').nth(1).selectOption('Grain');
  await page.locator('#recipe-submit-btn').click();
  const manual = await page.evaluate(() => AppState.recipes.find(r => r.name === 'Manual Untagged'));
  expect(manual).not.toHaveProperty('sourceUrl');
  expect(manual).not.toHaveProperty('sourceSite');
  expect(manual).not.toHaveProperty('importedAt');
});
