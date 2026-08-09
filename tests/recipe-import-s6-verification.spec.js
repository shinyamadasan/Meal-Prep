const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const APP_FILE = pathToFileURL(path.resolve('index.html')).href;

const cleanEnvelope = {
  ok: true,
  recipe: {
    name: 'Paksiw na Baboy',
    prepTime: 'PT15M',
    cookTime: 'PT1H',
    recipeYield: '4 servings',
    rawIngredients: ['2 lbs pork belly', '1 cup vinegar', '3 cloves garlic'],
    instructions: [{ text: 'Brown pork.' }, { text: 'Simmer with vinegar.' }],
    nutrition: { calories: '824 calories', proteinContent: '25 g', carbohydrateContent: '10 g', fatContent: '55 g' },
    requestedUrl: 'https://panlasangpinoy.com/paksiw-na-baboy/',
    finalUrl: 'https://panlasangpinoy.com/paksiw-na-baboy/',
    sourceSite: 'panlasangpinoy.com'
  },
  warnings: []
};

async function loadLocalApp(page, envelope = cleanEnvelope, options = {}) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(({ envelope, clearStorage }) => {
    if (clearStorage) {
      try {
        localStorage.clear();
        localStorage.setItem('mealPrepHelpSeen', '1');
        localStorage.setItem('mealPrepStartDone', '1');
        localStorage.setItem('pantryOnboardingDone', '1');
      } catch (e) {}
    }
    window.RECIPE_IMPORT_ENDPOINT = 'https://worker.test/recipe-import';
    window.fetch = async (url, requestOptions) => {
      if (url === window.RECIPE_IMPORT_ENDPOINT) {
        window.__recipeImportPostCount = (window.__recipeImportPostCount || 0) + 1;
        return new Response(JSON.stringify(envelope), {
          status: envelope.ok === false ? 422 : 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      throw new Error('Unexpected fetch: ' + url);
    };
  }, { envelope, clearStorage: options.clearStorage !== false });
  await page.goto(APP_FILE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
}

async function importAndSave(page, url = 'https://panlasangpinoy.com/paksiw-na-baboy/') {
  await page.locator('.tab-btn[data-tab="recipes"]').click();
  await page.getByRole('button', { name: /Import Recipe/ }).click();
  await page.locator('#recipe-import-url').fill(url);
  await page.locator('#recipe-import-url-btn').click();
  await expect(page.locator('#recipe-import-preview')).toContainText('Ready to save');
  await page.locator('#recipe-import-preview').getByRole('button', { name: 'Save Recipe' }).click();
  await expect(page.locator('#paste-recipe-modal')).toBeHidden();
}

test('imported recipe persists across reload with provenance and no transient modal state', async ({ page }) => {
  await loadLocalApp(page);
  await importAndSave(page);
  const before = await page.evaluate(() => AppState.recipes.find(r => r.name === 'Paksiw na Baboy'));
  expect(before.sourceUrl).toBe('https://panlasangpinoy.com/paksiw-na-baboy');
  expect(before.fridgeLife).toBeNull();
  expect(before.freezerLife).toBeNull();
  const savedRaw = await page.evaluate(() => localStorage.getItem('mealPrepAppData'));
  expect(savedRaw).toContain('Paksiw na Baboy');

  const reloadPage = await page.context().newPage();
  await reloadPage.route('**/firebasejs/**', (r) => r.abort());
  await reloadPage.addInitScript((raw) => {
    localStorage.setItem('mealPrepHelpSeen', '1');
    localStorage.setItem('mealPrepStartDone', '1');
    localStorage.setItem('pantryOnboardingDone', '1');
    localStorage.setItem('mealPrepAppData', raw);
    window.RECIPE_IMPORT_ENDPOINT = 'https://worker.test/recipe-import';
  }, savedRaw);
  await reloadPage.goto(APP_FILE, { waitUntil: 'domcontentloaded' });
  await reloadPage.waitForFunction(() => AppState.recipes.some(r => r.name === 'Paksiw na Baboy'));
  const after = await reloadPage.evaluate(() => AppState.recipes.find(r => r.name === 'Paksiw na Baboy'));
  expect(after.sourceUrl).toBe(before.sourceUrl);
  expect(after.importedAt).toBe(before.importedAt);
  await reloadPage.evaluate(() => openRecipeImportModal());
  await expect(reloadPage.locator('#recipe-import-url')).toHaveValue('');
  await expect(reloadPage.locator('#recipe-import-preview')).toBeHidden();
  await reloadPage.close();
});

test('imported recipe uses normal serving scaling, grocery, nutrition, cooked, and prep paths', async ({ page }) => {
  await loadLocalApp(page);
  await importAndSave(page);
  const recipeId = await page.evaluate(() => AppState.recipes.find(r => r.name === 'Paksiw na Baboy').id);

  await page.locator('.recipe-card', { hasText: 'Paksiw na Baboy' }).getByRole('button', { name: '+' }).first().click();
  await page.locator('.recipe-card', { hasText: 'Paksiw na Baboy' }).getByRole('button', { name: '+' }).first().click();
  const scaled = await page.evaluate((id) => {
    const recipe = AppState.recipes.find(r => String(r.id) === String(id));
    const pork = recipe.baseIngredients.find(ing => ing.name === 'pork belly');
    AppState.weeklyPlan.Monday.lunch = recipe.id;
    generateGroceryList();
    const grocery = AppState.groceryList.find(item => item.name === 'pork belly');
    const nutrition = calculateRecipeNutrition(recipe);
    openPrepMode();
    _doMarkCooked(recipe, null);
    const cooked = AppState.cookedMeals.find(m => String(m.recipeId) === String(recipe.id));
    return {
      currentServings: recipe.currentServings,
      scaledPork: calculateScaledQuantity(recipe, pork),
      groceryQty: grocery && grocery.quantity,
      nutritionCalories: nutrition.calories,
      prepVisible: !document.getElementById('prep-mode-modal').classList.contains('hidden'),
      cooked,
      history: AppState.cookHistory.find(h => String(h.recipeId) === String(recipe.id))
    };
  }, recipeId);

  expect(scaled.currentServings).toBe(6);
  expect(scaled.scaledPork).toBe(3);
  expect(scaled.groceryQty).toBe(3);
  expect(scaled.nutritionCalories).toBe(824 * 6);
  expect(scaled.prepVisible).toBe(true);
  expect(scaled.cooked.name).toBe('Paksiw na Baboy');
  expect(scaled.cooked.fridgeLife).toBeNull();
  expect(scaled.cooked.freezerLife).toBeNull();
  expect(scaled.history.recipeName).toBe('Paksiw na Baboy');
});

test('modal switching/reset and double save keep transient state out of persistence', async ({ page }) => {
  await loadLocalApp(page);
  await page.locator('.tab-btn[data-tab="recipes"]').click();
  const startingCount = await page.evaluate(() => AppState.recipes.length);
  await page.getByRole('button', { name: /Import Recipe/ }).click();
  await page.locator('#recipe-import-url').fill('not a url');
  await page.locator('#recipe-import-url-btn').click();
  await expect(page.locator('#recipe-import-status')).toContainText('Enter a valid recipe URL.');
  await page.getByRole('button', { name: 'Paste Text' }).click();
  await expect(page.locator('#recipe-import-status')).toBeHidden();
  await page.getByRole('button', { name: 'From URL' }).click();
  await page.locator('#recipe-import-url').fill('https://panlasangpinoy.com/paksiw-na-baboy/');
  await page.locator('#recipe-import-url-btn').click();
  await expect(page.locator('#recipe-import-preview')).toContainText('Paksiw na Baboy');
  await page.locator('#paste-recipe-modal').getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: /Import Recipe/ }).click();
  await expect(page.locator('#recipe-import-url')).toHaveValue('');
  await expect(page.locator('#recipe-import-preview')).toBeHidden();

  await page.locator('#recipe-import-url').fill('https://panlasangpinoy.com/paksiw-na-baboy/');
  await page.locator('#recipe-import-url-btn').click();
  await expect(page.locator('#recipe-import-preview')).toContainText('Ready to save');
  await page.locator('#recipe-import-preview').getByRole('button', { name: 'Save Recipe' }).dblclick();
  await expect.poll(() => page.evaluate(() => AppState.recipes.length)).toBe(startingCount + 1);
  const savedState = await page.evaluate(() => JSON.stringify(AppState));
  expect(savedState).not.toContain('currentRecipeImportDraft');
  expect(savedState).not.toContain('importDuplicateOverride');
});

test('import preview and saved recipe render imported markup as inert text', async ({ page }) => {
  const dialogs = [];
  page.on('dialog', async dialog => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  await loadLocalApp(page, {
    ok: true,
    recipe: {
      name: '<script>alert(1)</script>',
      prepTime: 'PT1M',
      cookTime: 'PT2M',
      recipeYield: '2 servings',
      rawIngredients: ['1 cup <img src=x onerror=alert(2)>'],
      instructions: [{ text: '<img src=x onerror=alert(3)>' }],
      requestedUrl: 'https://example.com/xss',
      finalUrl: 'https://example.com/xss',
      sourceSite: '<img src=x onerror=alert(4)>'
    },
    warnings: ['<img src=x onerror=alert(5)>']
  });

  await page.locator('.tab-btn[data-tab="recipes"]').click();
  await page.getByRole('button', { name: /Import Recipe/ }).click();
  await page.locator('#recipe-import-url').fill('https://example.com/xss');
  await page.locator('#recipe-import-url-btn').click();
  await expect(page.locator('#recipe-import-preview')).toContainText('<script>alert(1)</script>');
  expect(await page.locator('#recipe-import-preview img').count()).toBe(0);
  await page.locator('#recipe-import-preview').getByRole('button', { name: 'Save Recipe' }).click();
  await expect(page.locator('#recipes-grid')).toContainText('<script>alert(1)</script>');
  expect(await page.locator('#recipes-grid img[src="x"]').count()).toBe(0);
  expect(dialogs).toEqual([]);
});
