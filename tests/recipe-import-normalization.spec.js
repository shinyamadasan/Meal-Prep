const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

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
  await page.waitForTimeout(500);
}

test('duration parsing keeps unknown invalid values as null', async ({ page }) => {
  await loadLocalApp(page);
  const result = await page.evaluate(() => ({
    m15: parseIsoDurationMinutes('PT15M'),
    h1: parseIsoDurationMinutes('PT1H'),
    h1m10: parseIsoDurationMinutes('PT1H10M'),
    m90: parseIsoDurationMinutes('PT90M'),
    d0h1m30: parseIsoDurationMinutes('P0DT1H30M'),
    missing: parseIsoDurationMinutes(null),
    invalid: parseIsoDurationMinutes('about an hour')
  }));

  expect(result).toEqual({
    m15: 15,
    h1: 60,
    h1m10: 70,
    m90: 90,
    d0h1m30: 90,
    missing: null,
    invalid: null
  });
});

test('yield parsing preserves text and only derives clear meal servings', async ({ page }) => {
  await loadLocalApp(page);
  const result = await page.evaluate(() => ({
    servings: parseRecipeYield('4 servings'),
    serves: parseRecipeYield('Serves 6'),
    number: parseRecipeYield('4'),
    array: parseRecipeYield(['4 servings']),
    liveArray: parseRecipeYield(['4', '4 people']),
    cookies: parseRecipeYield('Makes 12 cookies'),
    missing: parseRecipeYield(null)
  }));

  expect(result.servings).toEqual({ servings: 4, yieldText: '4 servings' });
  expect(result.serves).toEqual({ servings: 6, yieldText: 'Serves 6' });
  expect(result.number).toEqual({ servings: 4, yieldText: '4' });
  expect(result.array).toEqual({ servings: 4, yieldText: '4 servings' });
  expect(result.liveArray).toEqual({ servings: 4, yieldText: '4, 4 people' });
  expect(result.cookies).toEqual({ servings: null, yieldText: 'Makes 12 cookies' });
  expect(result.missing).toEqual({ servings: null, yieldText: '' });
});

test('ingredient normalization preserves raw lines and avoids fabricated quantity/unit', async ({ page }) => {
  await loadLocalApp(page);
  const result = await page.evaluate(() => [
    normalizeImportedIngredient('2 lbs pork belly, cut into cubes'),
    normalizeImportedIngredient('1/2 cup vinegar'),
    normalizeImportedIngredient('½ cup soy sauce'),
    normalizeImportedIngredient('1 1/2 tbsp sugar'),
    normalizeImportedIngredient('1½ tbsp sugar'),
    normalizeImportedIngredient('3 cloves garlic'),
    normalizeImportedIngredient('salt to taste'),
    normalizeImportedIngredient('oil for frying'),
    normalizeImportedIngredient('a pinch of something mysterious')
  ]);

  expect(result[0]).toMatchObject({ raw: '2 lbs pork belly, cut into cubes', quantity: 2, unit: 'lbs', needsReview: false });
  expect(result[1]).toMatchObject({ raw: '1/2 cup vinegar', quantity: 0.5, unit: 'cups', needsReview: false });
  expect(result[2]).toMatchObject({ raw: '½ cup soy sauce', quantity: 0.5, unit: 'cups', needsReview: false });
  expect(result[3]).toMatchObject({ raw: '1 1/2 tbsp sugar', quantity: 1.5, unit: 'tbsp', needsReview: false });
  expect(result[4]).toMatchObject({ raw: '1½ tbsp sugar', quantity: 1.5, unit: 'tbsp', needsReview: false });
  expect(result[5]).toMatchObject({ raw: '3 cloves garlic', quantity: 3, unit: 'cloves', needsReview: false });
  for (const index of [6, 7, 8]) {
    expect(result[index].raw).toBeTruthy();
    expect(result[index].quantity).toBeNull();
    expect(result[index].unit).toBe('');
    expect(result[index].needsReview).toBe(true);
  }
});

test('instructions normalize section-aware S2 output into textarea-compatible text', async ({ page }) => {
  await loadLocalApp(page);
  const result = await page.evaluate(() => {
    const text = normalizeImportedInstructions([
      { text: 'Brown the pork.' },
      { section: 'Sauce', text: 'Add vinegar.' },
      { text: '   ' },
      'Simmer until tender.'
    ]);
    return { text, steps: parseInstructionSteps(text) };
  });

  expect(result.text).toBe('Brown the pork.\nSauce: Add vinegar.\nSimmer until tender.');
  expect(result.steps).toEqual(['Brown the pork.', 'Sauce: Add vinegar.', 'Simmer until tender.']);
});

test('nutrition normalization parses source strings without inventing missing values', async ({ page }) => {
  await loadLocalApp(page);
  const result = await page.evaluate(() => ({
    full: normalizeImportedNutrition({
      calories: '824 calories',
      proteinContent: '25 g',
      carbohydrateContent: '10g',
      fatContent: '55 g',
      fiberContent: '2 g',
      sodiumContent: '1,200 mg'
    }),
    partial: normalizeImportedNutrition({ calories: '100 calories' }),
    missing: normalizeImportedNutrition(null)
  }));

  expect(result.full).toEqual({ calories: 824, protein: 25, carbs: 10, fat: 55, fiber: 2, sodium: 1200 });
  expect(result.partial).toEqual({ calories: 100 });
  expect(result.missing).toBeNull();
});

test('representative Paksiw source normalizes into a transient draft', async ({ page }) => {
  await loadLocalApp(page);
  const draft = await page.evaluate(() => normalizeRecipeImportDraft({
    name: 'Paksiw na Baboy',
    description: 'Pork belly cooked in vinegar.',
    prepTime: 'PT15M',
    cookTime: 'PT1H',
    totalTime: 'PT1H15M',
    recipeYield: '4 servings',
    rawIngredients: [
      '2 lbs pork belly, cut into cubes',
      '1/2 cup vinegar',
      '½ cup soy sauce',
      '1 1/2 tbsp sugar',
      '3 cloves garlic',
      '1 piece onion',
      '2 pieces bay leaves',
      '1 tsp peppercorn',
      '1 cup water',
      'salt to taste'
    ],
    instructions: [
      { text: 'Brown the pork.' },
      { text: 'Add vinegar and simmer.' }
    ],
    nutrition: { calories: '824 calories', proteinContent: '25 g' },
    image: 'https://example.com/paksiw.jpg',
    requestedUrl: 'https://panlasangpinoy.com/paksiw-na-baboy/',
    finalUrl: 'https://panlasangpinoy.com/paksiw-na-baboy/',
    sourceSite: 'panlasangpinoy.com'
  }, ['Multiple Recipe objects found; selected the most complete one.']));

  expect(draft.name).toBe('Paksiw na Baboy');
  expect(draft.description).toBe('Pork belly cooked in vinegar.');
  expect(draft.category).toBe('Main Dish');
  expect(draft.basePrepTime).toBe(15);
  expect(draft.baseCookTime).toBe(60);
  expect(draft.totalTime).toBe(75);
  expect(draft.baseServings).toBe(4);
  expect(draft.yieldText).toBe('4 servings');
  expect(draft.fridgeLife).toBeNull();
  expect(draft.freezerLife).toBeNull();
  expect(draft.ingredients).toHaveLength(10);
  expect(draft.ingredients[0]).toMatchObject({ raw: '2 lbs pork belly, cut into cubes', quantity: 2, unit: 'lbs' });
  expect(draft.ingredients[9]).toMatchObject({ raw: 'salt to taste', quantity: null, unit: '', needsReview: true });
  expect(draft.instructions).toBe('Brown the pork.\nAdd vinegar and simmer.');
  expect(draft.nutritionPerServing).toEqual({ calories: 824, protein: 25 });
  expect(draft.imageUrl).toBe('https://example.com/paksiw.jpg');
  expect(draft.sourceUrl).toBe('https://panlasangpinoy.com/paksiw-na-baboy/');
  expect(draft.requestedUrl).toBe('https://panlasangpinoy.com/paksiw-na-baboy/');
  expect(draft.sourceSite).toBe('panlasangpinoy.com');
  expect(draft.importedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(draft.warnings).toHaveLength(1);
  expect(draft.status.canSaveDirectly).toBe(false);
  expect(draft.status.needsReview).toBe(true);
});

test('partial and malformed source objects stay safe and reviewable', async ({ page }) => {
  await loadLocalApp(page);
  const result = await page.evaluate(() => ({
    partial: normalizeRecipeImportDraft({
      name: 'Simple Recipe',
      rawIngredients: ['1 cup rice'],
      instructions: [{ text: 'Cook rice.' }]
    }),
    malformed: normalizeRecipeImportDraft(null)
  }));

  expect(result.partial.baseServings).toBeNull();
  expect(result.partial.basePrepTime).toBeNull();
  expect(result.partial.baseCookTime).toBeNull();
  expect(result.partial.totalTime).toBeNull();
  expect(result.partial.nutritionPerServing).toBeNull();
  expect(result.partial.imageUrl).toBe('');
  expect(result.partial.errors.map(e => e.code)).toContain('MISSING_SERVINGS');
  expect(result.partial.status.canSaveDirectly).toBe(false);

  expect(result.malformed.name).toBe('');
  expect(result.malformed.ingredients).toEqual([]);
  expect(result.malformed.instructions).toBe('');
  expect(result.malformed.errors.map(e => e.code)).toEqual(
    expect.arrayContaining(['MISSING_NAME', 'MISSING_SERVINGS', 'NO_VALID_INGREDIENTS', 'MISSING_INSTRUCTIONS'])
  );
});
