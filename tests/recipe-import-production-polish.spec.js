const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const APP_FILE = pathToFileURL(path.resolve('index.html')).href;

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
  await page.goto(APP_FILE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
}

function recipeFixture(overrides = {}) {
  return Object.assign({
    id: 'polish-recipe',
    name: 'Production Polish Recipe',
    category: 'Main Dish',
    basePrepTime: 10,
    baseCookTime: 20,
    baseServings: 4,
    currentServings: 4,
    fridgeLife: null,
    freezerLife: null,
    estimatedCost: 0,
    costPerServing: 0,
    storageNotes: '',
    instructions: 'Cook.',
    photo: null,
    baseIngredients: [{ name: 'pork belly', baseQuantity: 1, unit: 'kg', category: 'Protein' }],
    sourceUrl: 'https://panlasangpinoy.com/paksiw-na-baboy',
    sourceSite: 'panlasangpinoy.com',
    importedAt: '2026-08-09T00:00:00.000Z'
  }, overrides);
}

async function renderSingleRecipe(page, recipe) {
  await page.evaluate((nextRecipe) => {
    AppState.recipes = [nextRecipe];
    showTab('recipes');
    renderRecipes();
  }, recipe);
}

test('imported recipe cards render missing nutrition as unavailable, not NaN or zero', async ({ page }) => {
  await loadLocalApp(page);
  await renderSingleRecipe(page, recipeFixture({
    name: 'Partial Nutrition Recipe',
    nutritionPerServing: { calories: 1274, protein: 24, carbs: 21, fat: 121 }
  }));

  const values = await page.locator('.recipe-card', { hasText: 'Partial Nutrition Recipe' })
    .locator('.nutrition-value-number')
    .allTextContents();

  expect(values).toEqual(['1274', '24g', '21g', '121g', '—', '—']);
  expect(values.join(' ')).not.toContain('NaN');
  expect(values).not.toContain('0g');
  expect(values).not.toContain('0mg');

  const savedRaw = await page.evaluate(() => {
    saveData();
    return localStorage.getItem('mealPrepAppData');
  });
  const reloadPage = await page.context().newPage();
  await reloadPage.route('**/firebasejs/**', (r) => r.abort());
  await reloadPage.addInitScript((raw) => {
    localStorage.setItem('mealPrepHelpSeen', '1');
    localStorage.setItem('mealPrepStartDone', '1');
    localStorage.setItem('pantryOnboardingDone', '1');
    localStorage.setItem('mealPrepAppData', raw);
  }, savedRaw);
  await reloadPage.goto(APP_FILE, { waitUntil: 'domcontentloaded' });
  await reloadPage.waitForFunction(() => AppState.recipes.some(r => r.name === 'Partial Nutrition Recipe'));
  const reloadedValues = await reloadPage.locator('.recipe-card', { hasText: 'Partial Nutrition Recipe' })
    .locator('.nutrition-value-number')
    .allTextContents();
  expect(reloadedValues).toEqual(['1274', '24g', '21g', '121g', '—', '—']);
  expect(reloadedValues.join(' ')).not.toContain('NaN');
  await reloadPage.close();
});

test('recipe-card instructions render newline-delimited imported directions as ordered escaped steps', async ({ page }) => {
  const dialogs = [];
  page.on('dialog', async dialog => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });
  await loadLocalApp(page);
  await renderSingleRecipe(page, recipeFixture({
    name: 'Step Recipe',
    instructions: [
      'Brown pork.',
      'Add vinegar.',
      '<img src=x onerror=alert(1)>',
      'Simmer until tender.',
      'Season sauce.',
      'Rest briefly.',
      'Skim fat.',
      'Serve hot.'
    ].join('\n')
  }));

  const card = page.locator('.recipe-card', { hasText: 'Step Recipe' });
  await card.getByRole('button', { name: /Instructions/ }).click();
  const steps = card.locator('.recipe-instruction-list li');

  await expect(steps).toHaveCount(8);
  await expect(steps.nth(0)).toHaveText('Brown pork.');
  await expect(steps.nth(2)).toHaveText('<img src=x onerror=alert(1)>');
  await expect(steps.nth(7)).toHaveText('Serve hot.');
  await expect(card.locator('.recipe-instructions img')).toHaveCount(0);
  expect(dialogs).toEqual([]);
});

test('existing numbered directions do not duplicate numbering in cards or Prep Mode', async ({ page }) => {
  await loadLocalApp(page);
  await renderSingleRecipe(page, recipeFixture({
    instructions: '1. Sear pork\n2. Add garlic\n3. Serve with rice'
  }));

  const card = page.locator('.recipe-card', { hasText: 'Production Polish Recipe' });
  await card.getByRole('button', { name: /Instructions/ }).click();
  await expect(card.locator('.recipe-instruction-list li')).toHaveText([
    'Sear pork',
    'Add garlic',
    'Serve with rice'
  ]);

  const prepSteps = await page.evaluate(() => {
    AppState.weeklyPlan.Monday.lunch = 'polish-recipe';
    openPrepMode();
    return Array.from(document.querySelectorAll('#prep-mode-body .prep-check-row span')).map(el => el.textContent.trim());
  });
  expect(prepSteps).toContain('Sear pork');
  expect(prepSteps).toContain('Add garlic');
  expect(prepSteps).toContain('Serve with rice');
  expect(prepSteps).not.toContain('1. Sear pork');
});

test('single-paragraph instructions remain one readable card step', async ({ page }) => {
  await loadLocalApp(page);
  await renderSingleRecipe(page, recipeFixture({
    name: 'Single Paragraph Recipe',
    instructions: 'Simmer everything together until tender.'
  }));

  const card = page.locator('.recipe-card', { hasText: 'Single Paragraph Recipe' });
  await card.getByRole('button', { name: /Instructions/ }).click();
  await expect(card.locator('.recipe-instruction-list li')).toHaveCount(1);
  await expect(card.locator('.recipe-instruction-list li')).toHaveText('Simmer everything together until tender.');
});
