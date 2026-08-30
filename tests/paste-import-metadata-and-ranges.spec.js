const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');
const { waitForAppReady, waitForRestored } = require('./app-ready');

/**
 * Paste-recipe importer repair.
 *
 * parseRecipeText() (the deterministic "paste" importer, distinct from the URL
 * importer's normalizeRecipeImportDraft() path) had two bugs:
 *
 *   1. It had no concept of the Equipment:/Effort:/Active Time:/Tags:/Meal
 *      Balance: sections the recipe model already supports, so those headings
 *      and their values fell through into the Instructions list as bogus steps.
 *   2. parseIngredientLine()'s final fallback fabricated quantity=1/unit=pieces
 *      for ANY line without a clean leading number — including ranges like
 *      "1-1.5 lb chicken" that DO start with a digit but aren't a single parsed
 *      amount. That poisoned nutrition math with a false, confident quantity.
 *
 * These tests exercise the deterministic parser directly (page.evaluate against
 * the global functions app.js defines) and the paste -> form -> save -> reload
 * UI path end to end.
 */

async function loadLocalApp(page) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  // Runs before EVERY navigation, so it must only clear storage on first boot —
  // otherwise a page.reload() in the middle of a test wipes the data it just saved.
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__pasteImportTestBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__pasteImportTestBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
  });
  await page.goto(pathToFileURL(path.resolve('index.html')).href, { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
}

const LEMON_CHICKEN = `Lemon Chicken

Ingredients:
1–1.5 lb chicken
1/4 cup olive oil
Juice of 1–2 lemons
2–3 cloves garlic
1 tsp Italian seasoning
Salt
Black pepper
1–2 lemon slices

Instructions:
Add chicken, olive oil, lemon juice, garlic, Italian seasoning, salt, pepper, and lemon slices to a freezer-safe bag.
Freeze.
Thaw overnight in the refrigerator.
Bake at 375°F (190°C) or cook on the stovetop until fully cooked.
Serve with rice, potatoes, or vegetables.

Equipment:
Oven, Pan

Effort:
Very low

Tags:
Freezer-friendly, Batch-friendly, Minimal-cleanup`;

// ── Metadata section parsing (tests 1,2,3,4,5,6,7,8,9,10,11,12) ──────────────

test('Lemon Chicken paste: metadata maps to fields, never pollutes instructions', async ({ page }) => {
  await loadLocalApp(page);
  const parsed = await page.evaluate((text) => parseRecipeText(text), LEMON_CHICKEN);

  // 1/2 Equipment populates equipment[] and never appears in instructions.
  expect(parsed.equipment).toEqual(['oven', 'pan']);
  expect(parsed.instructions).not.toMatch(/Equipment/i);
  expect(parsed.instructions).not.toMatch(/^Oven, Pan$/m);

  // 3/4 Effort populates effort and never appears in instructions.
  expect(parsed.effort).toBe('very-low');
  expect(parsed.instructions).not.toMatch(/Effort/i);
  expect(parsed.instructions).not.toMatch(/^Very low$/m);

  // 5/6 Tags populates tags[] and never appears in instructions.
  expect(parsed.tags).toEqual(['freezer-friendly', 'batch-friendly', 'minimal-cleanup']);
  expect(parsed.instructions).not.toMatch(/Tags/i);
  expect(parsed.instructions).not.toMatch(/Freezer-friendly/);

  // Instructions are exactly the five real cooking steps, nothing else.
  expect(parsed.instructions.split('\n')).toEqual([
    'Add chicken, olive oil, lemon juice, garlic, Italian seasoning, salt, pepper, and lemon slices to a freezer-safe bag.',
    'Freeze.',
    'Thaw overnight in the refrigerator.',
    'Bake at 375°F (190°C) or cook on the stovetop until fully cooked.',
    'Serve with rice, potatoes, or vegetables.'
  ]);
});

test('7/8: multiple equipment values normalize; unknown equipment is dropped, never invented', async ({ page }) => {
  await loadLocalApp(page);
  const result = await page.evaluate(() => ({
    multi: parseRecipeText('Title\n\nIngredients:\n1 cup rice\n\nInstructions:\nCook.\n\nEquipment:\nRice cooker + steamer, Instant Pot, Egg boiler').equipment,
    unknown: parseRecipeText('Title\n\nIngredients:\n1 cup rice\n\nInstructions:\nCook.\n\nEquipment:\nAir fryer, Oven, Sous vide machine').equipment
  }));

  expect(result.multi).toEqual(['rice-cooker-steamer', 'instant-pot', 'egg-boiler']);
  // "Air fryer" and "Sous vide machine" are not in RECIPE_EQUIPMENT — dropped
  // silently rather than becoming a made-up enum value; "Oven" still comes through.
  expect(result.unknown).toEqual(['oven']);
});

test('9/10: effort text normalizes case/spacing variants; unrecognized effort stays unset', async ({ page }) => {
  await loadLocalApp(page);
  const result = await page.evaluate(() => ({
    a: parseRecipeText('T\n\nIngredients:\n1 cup rice\n\nInstructions:\nCook.\n\nEffort:\nVery low').effort,
    b: parseRecipeText('T\n\nIngredients:\n1 cup rice\n\nInstructions:\nCook.\n\nEffort:\nVery-low').effort,
    c: parseRecipeText('T\n\nIngredients:\n1 cup rice\n\nInstructions:\nCook.\n\nEffort:\nvery low').effort,
    d: parseRecipeText('T\n\nIngredients:\n1 cup rice\n\nInstructions:\nCook.\n\nEffort:\nVERY LOW').effort,
    unknown: parseRecipeText('T\n\nIngredients:\n1 cup rice\n\nInstructions:\nCook.\n\nEffort:\nSuper hard').effort,
    absent: parseRecipeText('T\n\nIngredients:\n1 cup rice\n\nInstructions:\nCook.').effort
  }));

  expect(result.a).toBe('very-low');
  expect(result.b).toBe('very-low');
  expect(result.c).toBe('very-low');
  expect(result.d).toBe('very-low');
  expect(result.unknown).toBeNull();
  expect(result.absent).toBeNull();
});

test('11: Active Time parses simple minute forms', async ({ page }) => {
  await loadLocalApp(page);
  const result = await page.evaluate(() => ({
    bare: parseRecipeText('T\n\nIngredients:\n1 cup rice\n\nInstructions:\nCook.\n\nActive Time:\n10').activeTime,
    min: parseRecipeText('T\n\nIngredients:\n1 cup rice\n\nInstructions:\nCook.\n\nActive Time:\n10 min').activeTime,
    minutes: parseRecipeText('T\n\nIngredients:\n1 cup rice\n\nInstructions:\nCook.\n\nActive Time:\n10 minutes').activeTime,
    absent: parseRecipeText('T\n\nIngredients:\n1 cup rice\n\nInstructions:\nCook.').activeTime
  }));

  expect(result.bare).toBe(10);
  expect(result.min).toBe(10);
  expect(result.minutes).toBe(10);
  expect(result.absent).toBeNull();
});

test('12: metadata heading matching is case-insensitive', async ({ page }) => {
  await loadLocalApp(page);
  const parsed = await page.evaluate(() => parseRecipeText(
    'T\n\nIngredients:\n1 cup rice\n\nInstructions:\nCook.\n\nEQUIPMENT:\nOven\n\neffort:\nLow\n\nTAGS:\nShortcut'
  ));
  expect(parsed.equipment).toEqual(['oven']);
  expect(parsed.effort).toBe('low');
  expect(parsed.tags).toEqual(['shortcut']);
});

test('13: ordinary instruction prose mentioning equipment/effort words is not misclassified', async ({ page }) => {
  await loadLocalApp(page);
  const parsed = await page.evaluate(() => parseRecipeText(
    'Title\n\nIngredients:\n1 cup rice\n2 eggs\n\nInstructions:\nUse a pan to fry the eggs.\nEffort is minimal here.\nTag the leftovers before freezing.'
  ));
  expect(parsed.equipment).toEqual([]);
  expect(parsed.effort).toBeNull();
  expect(parsed.tags).toEqual([]);
  expect(parsed.instructions.split('\n')).toEqual([
    'Use a pan to fry the eggs.',
    'Effort is minimal here.',
    'Tag the leftovers before freezing.'
  ]);
});

// ── Ingredient range safety (tests 14,15,16,17,18) ───────────────────────────

test('14: normal integer/decimal ingredient quantities still parse exactly as before', async ({ page }) => {
  await loadLocalApp(page);
  const result = await page.evaluate(() => [
    parseIngredientLine('2 lbs pork belly'),
    parseIngredientLine('1/2 cup vinegar'),
    parseIngredientLine('1.5 cups flour'),
    parseIngredientLine('3 cloves garlic'),
    parseIngredientLine('2 eggs')
  ]);

  expect(result[0]).toMatchObject({ quantity: 2, unit: 'lbs', name: 'pork belly' });
  expect(result[1]).toMatchObject({ quantity: 0.5, unit: 'cups', name: 'vinegar' });
  expect(result[2]).toMatchObject({ quantity: 1.5, unit: 'cups', name: 'flour' });
  expect(result[3]).toMatchObject({ quantity: 3, unit: 'cloves', name: 'garlic' });
  expect(result[4]).toMatchObject({ quantity: 2, unit: 'pieces', name: 'eggs' });
});

test('15/16/17/18: unparseable amounts stay honest instead of fabricating 1 piece', async ({ page }) => {
  await loadLocalApp(page);
  const result = await page.evaluate(() => [
    parseIngredientLine('1–1.5 lb chicken'),
    parseIngredientLine('1-1.5 lb chicken'),
    parseIngredientLine('2–3 cloves garlic'),
    parseIngredientLine('1–2 lemons'),
    parseIngredientLine('Juice of 1–2 lemons'),
    parseIngredientLine('Salt'),
    parseIngredientLine('Black pepper'),
    parseIngredientLine('Pineapple chunks'),
    parseIngredientLine('Green onion + sesame seeds')
  ]);

  result.forEach((r) => {
    expect(r).not.toBeNull();
    expect(r.quantity).toBeNull();
    expect(r.unit).toBe('');
  });

  expect(result[0].name).toBe('1–1.5 lb chicken');
  expect(result[1].name).toBe('1-1.5 lb chicken');
  expect(result[2].name).toBe('2–3 cloves garlic');
  expect(result[4].name).toBe('Juice of 1–2 lemons');
  expect(result[5].name).toBe('Salt');
  expect(result[6].name).toBe('Black pepper');
});

test('range-shaped ingredients also stay honest through the URL-import safety net', async ({ page }) => {
  await loadLocalApp(page);
  const result = await page.evaluate(() => [
    normalizeImportedIngredient('1–1.5 lb chicken'),
    normalizeImportedIngredient('2–3 cloves garlic')
  ]);
  result.forEach((r) => {
    expect(r.quantity).toBeNull();
    expect(r.needsReview).toBe(true);
  });
});

test('full Lemon Chicken paste never fabricates a false quantity/unit for any range ingredient', async ({ page }) => {
  await loadLocalApp(page);
  const parsed = await page.evaluate((text) => parseRecipeText(text), LEMON_CHICKEN);

  const byName = (needle) => parsed.ingredients.find((i) => i.name.includes(needle));
  expect(byName('1–1.5 lb chicken')).toMatchObject({ quantity: null, unit: '' });
  expect(byName('Juice of')).toMatchObject({ quantity: null, unit: '' });
  expect(byName('2–3 cloves garlic')).toMatchObject({ quantity: null, unit: '' });
  expect(byName('Salt')).toMatchObject({ quantity: null, unit: '' });
  expect(byName('Black pepper')).toMatchObject({ quantity: null, unit: '' });
  expect(byName('lemon slices')).toMatchObject({ quantity: null, unit: '' });
  // Deterministic ones are unaffected.
  expect(byName('olive oil')).toMatchObject({ quantity: 0.25, unit: 'cups' });
  expect(byName('Italian seasoning')).toMatchObject({ quantity: 1, unit: 'tsp' });
});

// ── UI wiring: paste -> form -> save -> reload (19, 20, 23) ──────────────────

test('paste import fills the form metadata controls, saves, and survives reload', async ({ page }) => {
  await loadLocalApp(page);
  // Resource-load failures from the intentionally-aborted **/firebasejs/** route
  // (see loadLocalApp above) are expected test-harness noise, not app errors.
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/net::ERR_FAILED/.test(msg.text())) consoleErrors.push(msg.text());
  });

  await page.locator('.tab-btn[data-tab="recipes"]').click();
  await page.evaluate(() => openPasteRecipeModal());
  await page.locator('#paste-recipe-text').fill(LEMON_CHICKEN);
  await page.locator('#parse-btn').click();
  await page.locator('.pf-proceed-btn').click();

  await expect(page.locator('#recipe-modal')).toBeVisible();
  await expect(page.locator('#instructions')).not.toHaveValue(/Equipment/i);
  await expect(page.locator('#instructions')).not.toHaveValue(/Tags/i);

  // Equipment/effort/tags controls reflect the parsed metadata (test 1,3,5 at the UI layer).
  const uiState = await page.evaluate(() => ({
    equipment: Array.prototype.slice.call(document.querySelectorAll('#recipe-equipment-chips input:checked')).map((el) => el.value),
    tags: Array.prototype.slice.call(document.querySelectorAll('#recipe-tag-chips input:checked')).map((el) => el.value),
    effort: document.getElementById('recipe-effort').value
  }));
  expect(uiState.equipment.sort()).toEqual(['oven', 'pan']);
  expect(uiState.tags.sort()).toEqual(['batch-friendly', 'freezer-friendly', 'minimal-cleanup']);
  expect(uiState.effort).toBe('very-low');

  // Ingredients needing review render with blank (not fabricated) qty/unit.
  const firstIngredientInputs = await page.locator('.ingredient-item').first().locator('input, select').all();
  expect(await firstIngredientInputs[0].inputValue()).toBe('1–1.5 lb chicken');
  expect(await firstIngredientInputs[1].inputValue()).toBe('');
  expect(await firstIngredientInputs[2].inputValue()).toBe('');

  // Fill in the reviewed chicken quantity with a real value...
  await page.locator('.ingredient-item').nth(0).locator('input').nth(1).fill('1.25');
  await page.locator('.ingredient-item').nth(0).locator('select').nth(0).selectOption('lbs');
  await page.locator('.ingredient-item').nth(0).locator('select').nth(1).selectOption('Protein');
  await page.locator('#servings').fill('4');

  // ...and give every other needs-review row (garlic, lemon juice, salt, etc.) a
  // placeholder value so the form's native `required` validation on each ingredient
  // row doesn't block the submit — this test is about metadata persistence, not
  // about re-deriving correct amounts for every ambiguous line.
  await page.evaluate(() => {
    document.querySelectorAll('.ingredient-item').forEach((item) => {
      const fields = item.querySelectorAll('input, select');
      const qty = fields[1];
      const unit = fields[2];
      const cat = fields[3];
      if (!qty.value) qty.value = '1';
      if (!unit.value && unit.options.length > 1) unit.value = unit.options[1].value;
      if (!cat.value && cat.options.length > 1) cat.value = cat.options[1].value;
    });
  });

  await page.locator('#recipe-submit-btn').click();
  await expect(page.locator('#recipe-modal')).toBeHidden();

  const saved = await page.evaluate(() => AppState.recipes.find((r) => r.name === 'Lemon Chicken'));
  expect(saved).toBeTruthy();
  expect(saved.equipment.sort()).toEqual(['oven', 'pan']);
  expect(saved.tags.sort()).toEqual(['batch-friendly', 'freezer-friendly', 'minimal-cleanup']);
  expect(saved.effort).toBe('very-low');
  expect(saved.instructions).not.toMatch(/Equipment/i);

  // 23: equipment/low-effort filtering sees the imported metadata correctly.
  const scoring = await page.evaluate((id) => {
    const r = AppState.recipes.find((x) => String(x.id) === String(id));
    return { effortScore: recipeEffortScore(r), usesOven: (r.equipment || []).indexOf('oven') >= 0 };
  }, saved.id);
  expect(scoring.effortScore).toBe(1); // very-low
  expect(scoring.usesOven).toBe(true);

  // 19/20: reload and confirm the recipe (with metadata) survived localStorage.
  await page.evaluate(() => saveToLocalStorage());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForRestored(page, () => AppState.recipes.some((r) => r.name === 'Lemon Chicken'));
  const afterReload = await page.evaluate(() => {
    const r = AppState.recipes.find((x) => x.name === 'Lemon Chicken');
    return { equipment: r.equipment, tags: r.tags, effort: r.effort, instructions: r.instructions };
  });
  expect(afterReload.equipment.sort()).toEqual(['oven', 'pan']);
  expect(afterReload.tags.sort()).toEqual(['batch-friendly', 'freezer-friendly', 'minimal-cleanup']);
  expect(afterReload.effort).toBe('very-low');
  expect(afterReload.instructions).not.toMatch(/Equipment/i);

  // 24: no console/page errors across the whole flow.
  expect(consoleErrors).toEqual([]);
});

// ── Export/import round-trip for imported metadata (20) ──────────────────────

test('20: paste-imported metadata survives export -> import round-trip', async ({ page }) => {
  await loadLocalApp(page);
  const exported = await page.evaluate((text) => {
    const parsed = parseRecipeText(text);
    AppState.recipes.push(Object.assign({
      id: 'zz-lemon-chicken',
      category: parsed.category,
      basePrepTime: parsed.prepTime,
      baseCookTime: parsed.cookTime,
      baseServings: parsed.servings,
      currentServings: parsed.servings,
      baseIngredients: [{ name: 'Chicken', baseQuantity: 500, unit: 'g', category: 'Protein' }],
      instructions: parsed.instructions
    }, {
      name: parsed.name,
      equipment: parsed.equipment,
      effort: parsed.effort,
      activeTime: parsed.activeTime,
      tags: parsed.tags,
      mealBalance: parsed.mealBalance
    }));

    let captured = null;
    const RealBlob = window.Blob;
    window.Blob = function (parts, opts) {
      if (opts && opts.type === 'application/json') captured = String(parts[0]);
      return new RealBlob(parts, opts);
    };
    const realCreate = URL.createObjectURL;
    const realRevoke = URL.revokeObjectURL;
    URL.createObjectURL = () => 'blob:stub';
    URL.revokeObjectURL = () => {};
    try { exportData(); } finally {
      window.Blob = RealBlob;
      URL.createObjectURL = realCreate;
      URL.revokeObjectURL = realRevoke;
    }
    return captured;
  }, LEMON_CHICKEN);

  const parsedExport = JSON.parse(exported);
  const rec = parsedExport.recipes.find((r) => r.id === 'zz-lemon-chicken');
  expect(rec.equipment).toEqual(['oven', 'pan']);
  expect(rec.effort).toBe('very-low');
  expect(rec.tags).toEqual(['freezer-friendly', 'batch-friendly', 'minimal-cleanup']);
});
