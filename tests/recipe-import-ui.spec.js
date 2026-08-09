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

test('URL import renders a compact transient preview from a mocked Worker response', async ({ page }) => {
  await loadLocalApp(page, {
    ok: true,
    recipe: {
      name: 'Paksiw na Baboy',
      prepTime: 'PT15M',
      cookTime: 'PT1H',
      recipeYield: '4 servings',
      rawIngredients: ['2 lbs pork belly', '1/2 cup vinegar', 'salt to taste'],
      instructions: [{ text: 'Brown pork.' }, { text: 'Simmer with vinegar.' }],
      nutrition: { calories: '824 calories' },
      requestedUrl: 'https://panlasangpinoy.com/paksiw-na-baboy/',
      finalUrl: 'https://panlasangpinoy.com/paksiw-na-baboy/',
      sourceSite: 'panlasangpinoy.com'
    },
    warnings: []
  });

  await page.locator('.tab-btn[data-tab="recipes"]').click();
  const startingRecipeCount = await page.evaluate(() => AppState.recipes.length);
  await page.getByRole('button', { name: /Import Recipe/ }).click();
  await page.locator('#recipe-import-url').fill('https://panlasangpinoy.com/paksiw-na-baboy/');
  await page.locator('#recipe-import-url-btn').click();

  await expect(page.locator('#recipe-import-preview')).toBeVisible();
  await expect(page.locator('#recipe-import-preview')).toContainText('Paksiw na Baboy');
  await expect(page.locator('#recipe-import-preview')).toContainText('panlasangpinoy.com');
  await expect(page.locator('#recipe-import-preview')).toContainText('3');
  await expect(page.locator('#recipe-import-preview')).toContainText('1 ingredient needs quantity/unit review.');
  await expect(page.locator('#recipe-import-preview')).toContainText('salt to taste');
  await expect(page.locator('#recipe-import-preview').getByRole('button', { name: /Review \/ Edit Details/ })).toBeVisible();
  await expect(page.locator('#recipe-import-preview').getByRole('button', { name: /Save Recipe/ })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => AppState.recipes.length)).toBe(startingRecipeCount);
});

test('URL import shows configuration and Worker errors without exposing internals', async ({ page }) => {
  await loadLocalApp(page, { ok: false, errorCode: 'NO_RECIPE_FOUND', message: 'debug detail' });

  await page.locator('.tab-btn[data-tab="recipes"]').click();
  await page.getByRole('button', { name: /Import Recipe/ }).click();
  await page.evaluate(() => { window.RECIPE_IMPORT_ENDPOINT = ''; });
  await page.locator('#recipe-import-url').fill('https://example.com/recipe');
  await page.locator('#recipe-import-url-btn').click();
  await expect(page.locator('#recipe-import-status')).toContainText("Recipe importing isn't configured yet.");

  await page.evaluate(() => { window.RECIPE_IMPORT_ENDPOINT = 'https://worker.test/recipe-import'; });
  await page.locator('#recipe-import-url-btn').click();
  await expect(page.locator('#recipe-import-status')).toContainText("We found the page but couldn't detect structured recipe data.");
  await expect(page.locator('#recipe-import-status')).not.toContainText('debug detail');
});

test('reviewing an imported draft opens the form and saves through the import flow', async ({ page }) => {
  await loadLocalApp(page, {
    ok: true,
    recipe: {
      name: 'Chicken Adobo',
      prepTime: 'PT10M',
      cookTime: 'PT30M',
      recipeYield: '4 servings',
      rawIngredients: ['500 g chicken', '60 ml soy sauce'],
      instructions: [{ text: 'Simmer until tender.' }],
      requestedUrl: 'https://example.com/adobo',
      finalUrl: 'https://example.com/adobo',
      sourceSite: 'example.com'
    },
    warnings: []
  });

  await page.locator('.tab-btn[data-tab="recipes"]').click();
  const startingRecipeCount = await page.evaluate(() => AppState.recipes.length);
  await page.getByRole('button', { name: /Import Recipe/ }).click();
  await page.locator('#recipe-import-url').fill('https://example.com/adobo');
  await page.locator('#recipe-import-url-btn').click();
  await page.locator('#recipe-import-preview').getByRole('button', { name: /Review \/ Edit Details/ }).click();

  await expect(page.locator('#recipe-modal')).toBeVisible();
  await expect(page.locator('#modal-title')).toHaveText('Review Imported Recipe');
  await expect(page.locator('#recipe-submit-btn')).toHaveText('Save Recipe');
  await page.locator('#recipe-name').fill('Chicken Adobo Edited');
  await page.locator('#recipe-submit-btn').click();

  await expect(page.locator('#recipe-modal')).toBeHidden();
  await expect(page.locator('#paste-recipe-modal')).toBeHidden();
  await expect.poll(() => page.evaluate(() => AppState.recipes.length)).toBe(startingRecipeCount + 1);
  const saved = await page.evaluate(() => AppState.recipes.find(r => r.name === 'Chicken Adobo Edited'));
  expect(saved.sourceUrl).toBe('https://example.com/adobo');
});
