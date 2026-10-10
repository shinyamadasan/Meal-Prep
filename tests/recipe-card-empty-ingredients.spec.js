const { test, expect } = require('@playwright/test');
const { waitForAppReady } = require('./app-ready');

/**
 * Regression: a recipe with no ingredients used to render a blank list under
 * "Ingredients:" on its card. It must show a clear empty-state message instead,
 * while recipes with ingredients keep rendering them exactly as before.
 */

test.use({ viewport: { width: 1200, height: 1500 } });

async function loadLocalApp(page) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__emptyIngTestBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__emptyIngTestBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
  });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
}

const WITH_INGREDIENTS = {
  id: 'ing-full-1',
  name: 'Chicken Adobo',
  category: 'Main Dish',
  basePrepTime: 10,
  baseCookTime: 30,
  baseServings: 4,
  currentServings: 4,
  fridgeLife: 3,
  freezerLife: 30,
  estimatedCost: 200,
  storageNotes: '',
  instructions: 'Brown chicken. Simmer.',
  baseIngredients: [
    { name: 'Chicken', baseQuantity: 500, unit: 'g', category: 'Protein' },
    { name: 'Soy Sauce', baseQuantity: 60, unit: 'ml', category: 'Condiment' }
  ],
  nutritionPerServing: { calories: 400, protein: 30, carbs: 10, fat: 20, fiber: 1, sodium: 800 }
};

const NO_INGREDIENTS = Object.assign({}, WITH_INGREDIENTS, {
  id: 'ing-empty-1', name: 'Mystery Stew', baseIngredients: []
});

function cardItems(page, name) {
  return page.locator('.recipe-card', { hasText: name }).locator('.detail-inglist li');
}

test('a recipe without ingredients shows an empty-state message, not a blank list', async ({ page }) => {
  await loadLocalApp(page);
  await page.evaluate((recipes) => {
    AppState.recipes = normalizeRecipes(JSON.parse(JSON.stringify(recipes)));
    showTab('recipes');
    renderRecipes();
  }, [WITH_INGREDIENTS, NO_INGREDIENTS]);

  const empty = cardItems(page, 'Mystery Stew');
  await expect(empty).toHaveCount(1);
  await expect(empty).toHaveClass(/ingredient-list-empty/);
  await expect(empty).toHaveText('No ingredients listed yet. Edit this recipe to add them.');

  // Rescaling re-renders the list; the empty state must survive it.
  await page.locator('.recipe-card', { hasText: 'Mystery Stew' }).locator('.detail-scaler-btn').last().click();
  await expect(empty).toHaveCount(1);
  await expect(empty).toHaveText('No ingredients listed yet. Edit this recipe to add them.');
});

test('a recipe with ingredients still lists them and shows no empty-state message', async ({ page }) => {
  await loadLocalApp(page);
  await page.evaluate((recipes) => {
    AppState.recipes = normalizeRecipes(JSON.parse(JSON.stringify(recipes)));
    showTab('recipes');
    renderRecipes();
  }, [WITH_INGREDIENTS, NO_INGREDIENTS]);

  const items = cardItems(page, 'Chicken Adobo');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toHaveText(/500\s+g\s+Chicken/);
  await expect(items.nth(1)).toHaveText(/60\s+ml\s+Soy Sauce/);
  await expect(page.locator('.recipe-card', { hasText: 'Chicken Adobo' }).locator('.ingredient-list-empty')).toHaveCount(0);
});
