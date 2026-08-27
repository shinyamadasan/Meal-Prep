const { test, expect } = require('@playwright/test');

/**
 * Production smoke for the ready-food-first wave (D-056).
 *
 * Runs against the DEPLOYED GitHub Pages build, not the working tree. Firebase
 * is deliberately NOT stubbed — the page loads it for real and stays signed
 * out, the normal first-visit path. Each test gets a fresh isolated context, so
 * nothing persists between them and nothing touches a real account's cloud data.
 */

const APP_URL = 'https://shinyamadasan.github.io/Meal-Prep/';

test.use({ viewport: { width: 1280, height: 1700 } });

async function loadLiveApp(page) {
  // Runs before EVERY navigation, so it must bootstrap once and then leave
  // storage alone — otherwise a page.reload() would wipe the data under test.
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__readyProdBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__readyProdBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
  });
  // Cache-bust so a stale Pages/CDN copy can never make this pass falsely.
  await page.goto(APP_URL + '?smoke=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load').catch(() => {});
  // AppState is a top-level `const`, so it is NOT a window property — probe it
  // by name from page scope, the way the app's own inline handlers see it.
  await page.waitForFunction(
    'typeof AppState !== "undefined" && Array.isArray(AppState.recipes)',
    null,
    { timeout: 45000 }
  );
  await page.waitForTimeout(3000);
}

// Local calendar date N days ago — daysLeftFrom()/todayISO() work in local time,
// so a UTC-derived date silently shifts by a day near midnight.
const DAY_FN = `(d) => {
  const t = new Date();
  t.setDate(t.getDate() - d);
  return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
}`;

async function seedStoredFood(page) {
  await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    AppState.recipes = normalizeRecipes([{
      id: 'psr-oven', name: 'PS Oven Chicken', category: 'Main Dish',
      basePrepTime: 15, baseCookTime: 50, baseServings: 8, currentServings: 8,
      fridgeLife: 4, freezerLife: 60, estimatedCost: 700, storageNotes: '', instructions: 'Roast.',
      baseIngredients: [{ name: 'Chicken', baseQuantity: 2000, unit: 'g', category: 'Protein' }],
      nutritionPerServing: { calories: 520, protein: 45, carbs: 2, fat: 30, fiber: 0, sodium: 600 },
      equipment: ['oven'], effort: 'normal', activeTime: 15,
      mealBalance: { protein: true, vegetables: false, carb: false }
    }]);
    AppState.pantry = [];
    AppState.cookHistory = [];
    AppState.cookedMeals = normalizeCookedMeals([
      { id: 'ps_freezer', recipeId: 'psr-oven', name: 'PS Freezer Chicken',
        cookedDate: day(1), storage: 'freezer', fridgeLife: 4, freezerLife: 60,
        initialPortions: 5, portionsRemaining: 5 },
      { id: 'ps_fridge', recipeId: null, source: 'leftovers', name: 'PS Fridge Pork',
        cookedDate: day(0), storage: 'fridge', fridgeLife: 6, freezerLife: 60,
        initialPortions: 3, portionsRemaining: 3 },
      { id: 'ps_soon', recipeId: null, source: 'leftovers', name: 'PS Use Soon Sisig',
        cookedDate: day(3), storage: 'fridge', fridgeLife: 4, freezerLife: 60,
        initialPortions: 2, portionsRemaining: 2 },
      // Pre-wave shape: no portion fields at all.
      { id: 'ps_untracked', recipeId: null, source: 'leftovers', name: 'PS Untracked Adobo',
        cookedDate: day(1), storage: 'fridge', fridgeLife: 5, freezerLife: 60 }
    ]);
    showTab('dashboard');
    renderDashboard();
  }, DAY_FN);
}

test('the deployed build serves the ready-food code', async ({ page }) => {
  await loadLiveApp(page);

  const missing = await page.evaluate(() =>
    ['normalizeCookedMeal', 'normalizeCookedMeals', 'portionCountOrNull',
      'cookedMealTracksPortions', 'useCookedPortion', 'finishCookedMeal',
      'getReadyFoodSuggestions', 'readyFoodBucket', 'readyFoodMetaLine',
      'readyFoodBalanceHint', 'renderReadyFoodCard', 'formatPortions']
      .filter((f) => typeof window[f] !== 'function'));

  expect(missing).toEqual([]);

  // The manual-add modal really has the optional Portions input.
  await expect(page.locator('#manual-cooked-portions')).toHaveCount(1);
});

test('a pre-wave cooked meal still loads and renders on the deployed site', async ({ page }) => {
  await loadLiveApp(page);

  const result = await page.evaluate(() => {
    AppState.cookedMeals = normalizeCookedMeals([{
      id: 'ps_old', recipeId: null, source: 'leftovers', name: 'PS Old Record',
      cookedDate: todayISO(), storage: 'fridge', fridgeLife: 3, freezerLife: 90
    }]);
    showTab('fridge');
    renderCookedMeals();
    const m = AppState.cookedMeals[0];
    return {
      initial: m.initialPortions,
      remaining: m.portionsRemaining,
      tracks: cookedMealTracksPortions(m),
      cards: document.querySelectorAll('#cooked-meals-list .cooked-card').length,
      badges: document.querySelectorAll('#cooked-meals-list .cooked-portions').length,
      useOne: document.querySelectorAll('#cooked-meals-list .cooked-use-one').length,
      done: document.querySelectorAll('#cooked-meals-list .cooked-remove').length
    };
  });

  expect(result.initial).toBeNull();
  expect(result.remaining).toBeNull();
  expect(result.tracks).toBe(false);
  expect(result.cards).toBe(1);
  expect(result.badges).toBe(0);
  expect(result.useOne).toBe(0);
  expect(result.done).toBe(1); // the pre-existing action is untouched
});

test('Home ranks ready food and renders it above the cook suggestions', async ({ page }) => {
  await loadLiveApp(page);
  await seedStoredFood(page);

  const result = await page.evaluate(() => {
    const html = document.getElementById('dashboard').innerHTML;
    return {
      order: getReadyFoodSuggestions().map((m) => m.id),
      buckets: getReadyFoodSuggestions().map((m) => readyFoodBucket(m)),
      rows: document.querySelectorAll('.dash-card--ready .dash-ready-row').length,
      header: (document.querySelector('.dash-card--ready .dash-level-header') || {}).textContent || '',
      firstName: (document.querySelector('.dash-card--ready .dash-ready-name') || {}).textContent || '',
      firstMeta: (document.querySelector('.dash-card--ready .dash-ready-meta') || {}).textContent || '',
      readyBeforeCook: html.indexOf('dash-card--ready') >= 0 &&
        (html.indexOf('dash-card--suggest') < 0 || html.indexOf('dash-card--ready') < html.indexOf('dash-card--suggest'))
    };
  });

  // Expiring fridge → fridge → freezer, with the untracked fridge item in bucket 1.
  expect(result.order[0]).toBe('ps_soon');
  expect(result.buckets[0]).toBe(0);
  expect(result.buckets[result.buckets.length - 1]).toBe(2);
  expect(result.header).toContain('Ready to eat');
  expect(result.rows).toBe(3); // capped, not a whole inventory listing
  expect(result.firstName).toContain('PS Use Soon Sisig');
  expect(result.firstMeta).toContain('2 portions');
  expect(result.firstMeta).toContain('fridge');
  expect(result.readyBeforeCook).toBe(true);
});

test('expired food is never offered as something to eat on the deployed site', async ({ page }) => {
  await loadLiveApp(page);

  const result = await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    AppState.recipes = [];
    AppState.pantry = [];
    AppState.cookedMeals = normalizeCookedMeals([
      { id: 'ps_expired', name: 'PS Expired Pork', cookedDate: day(10), storage: 'fridge',
        fridgeLife: 3, freezerLife: 60, initialPortions: 2, portionsRemaining: 2 },
      { id: 'ps_good', name: 'PS Good Chicken', cookedDate: day(0), storage: 'fridge',
        fridgeLife: 5, freezerLife: 60, initialPortions: 2, portionsRemaining: 2 }
    ]);
    return {
      suggested: getReadyFoodSuggestions().map((m) => m.id),
      // …while the existing freshness engine still flags it for disposal.
      expiredAlerts: getFreshnessAlerts().cooked.expired
    };
  }, DAY_FN);

  expect(result.suggested).toEqual(['ps_good']);
  expect(result.expiredAlerts).toBe(1);
});

test('one tap consumes a portion on the deployed site, with no modal', async ({ page }) => {
  await loadLiveApp(page);
  await seedStoredFood(page);

  await expect(page.locator('.dash-card--ready .dash-ready-meta').first()).toContainText('2 portions');
  await page.locator('.dash-card--ready .dash-ready-use').first().click();
  await page.waitForTimeout(600);

  const after = await page.evaluate(() => ({
    remaining: AppState.cookedMeals.find((m) => m.id === 'ps_soon').portionsRemaining,
    initial: AppState.cookedMeals.find((m) => m.id === 'ps_soon').initialPortions,
    overlays: document.querySelectorAll('.modal:not(.hidden), .confirm-overlay').length
  }));
  expect(after.remaining).toBe(1);
  expect(after.initial).toBe(2); // original count preserved
  expect(after.overlays).toBe(0); // one tap really is one tap

  // The last portion finishes the batch through the existing removal path.
  await page.locator('.dash-card--ready .dash-ready-use').first().click();
  await page.waitForTimeout(600);
  const finished = await page.evaluate(() => ({
    stillThere: AppState.cookedMeals.some((m) => m.id === 'ps_soon'),
    anyNegative: AppState.cookedMeals.some((m) => m.portionsRemaining < 0)
  }));
  expect(finished.stillThere).toBe(false);
  expect(finished.anyNegative).toBe(false);
});

test('the Landers workflow works on the deployed site with no special-case code', async ({ page }) => {
  await loadLiveApp(page);

  await page.evaluate(() => {
    AppState.recipes = [];
    AppState.cookedMeals = [];
    showTab('fridge');
    renderCookedMeals();
    openManualCookedModal();
  });
  await page.locator('#manual-cooked-name').fill('Landers Lechon Manok');
  await page.locator('#manual-cooked-portions').fill('6');
  await page.locator('#manual-cooked-storage').selectOption('fridge');
  await page.locator('#manual-cooked-modal .btn--primary').click();
  await page.waitForTimeout(600);

  // Eat two — two taps.
  await page.locator('#cooked-meals-list .cooked-use-one').click();
  await page.waitForTimeout(400);
  await page.locator('#cooked-meals-list .cooked-use-one').click();
  await page.waitForTimeout(400);

  // Freeze the rest through the EXISTING storage toggle.
  await page.evaluate(() => setCookedStorage(AppState.cookedMeals[0].id, 'freezer'));
  await page.waitForTimeout(400);

  const result = await page.evaluate(() => {
    const m = AppState.cookedMeals[0];
    showTab('dashboard');
    renderDashboard();
    return {
      initial: m.initialPortions,
      remaining: m.portionsRemaining,
      storage: m.storage,
      shelfLife: cookedShelfLife(m),
      keys: Object.keys(m).sort(),
      readyName: (document.querySelector('.dash-card--ready .dash-ready-name') || {}).textContent || '',
      readyMeta: (document.querySelector('.dash-card--ready .dash-ready-meta') || {}).textContent || ''
    };
  });

  expect(result.initial).toBe(6);
  expect(result.remaining).toBe(4);
  expect(result.storage).toBe('freezer');
  expect(result.shelfLife).toBe(90); // the manual modal's freezer default
  expect(result.readyName).toContain('Landers Lechon Manok');
  expect(result.readyMeta).toContain('4 portions');
  expect(result.readyMeta).toContain('freezer');
  // Nothing Landers-specific reached the data model.
  expect(result.keys).toEqual([
    'cookedDate', 'freezerLife', 'fridgeLife', 'id', 'initialPortions', 'name',
    'portionsRemaining', 'recipeId', 'source', 'storage', 'updatedAt'
  ]);
});

test('portion data round-trips through the deployed storage paths', async ({ page }) => {
  await loadLiveApp(page);

  const wire = await page.evaluate(() => {
    AppState.cookedMeals = normalizeCookedMeals([{
      id: 'ps_rt', recipeId: null, source: 'leftovers', name: 'PS Round Trip',
      cookedDate: todayISO(), storage: 'freezer', fridgeLife: 3, freezerLife: 60,
      initialPortions: 6, portionsRemaining: 4
    }]);
    saveToLocalStorage();
    const payload = JSON.parse(JSON.stringify(buildFirestorePayload()));
    const stored = JSON.parse(localStorage.getItem('mealPrepAppData'));
    return { firestore: payload.cookedMeals[0], local: stored.cookedMeals[0] };
  });

  expect(wire.firestore).toMatchObject({ initialPortions: 6, portionsRemaining: 4 });
  expect(wire.local).toMatchObject({ initialPortions: 6, portionsRemaining: 4 });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    'typeof AppState !== "undefined" && Array.isArray(AppState.cookedMeals)',
    null, { timeout: 45000 }
  );
  await page.waitForTimeout(2500);

  const after = await page.evaluate(() => {
    const m = (AppState.cookedMeals || []).find((x) => x.id === 'ps_rt');
    return m && { initial: m.initialPortions, remaining: m.portionsRemaining, storage: m.storage };
  });
  expect(after).toMatchObject({ initial: 6, remaining: 4, storage: 'freezer' });
});

test('no NaN and no runtime errors anywhere on the deployed site', async ({ page }) => {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await loadLiveApp(page);
  await seedStoredFood(page);

  const dirty = await page.evaluate(() => {
    const tabs = ['dashboard', 'recipes', 'planner', 'grocery', 'fridge', 'storage', 'nutrition', 'ingredients', 'hacks'];
    const bad = [];
    tabs.forEach((t) => {
      try { showTab(t); } catch (e) { bad.push(t + ':threw'); }
      if (/NaN/.test(document.body.innerText)) bad.push(t);
    });
    return bad;
  });

  expect(dirty).toEqual([]);
  expect(pageErrors).toEqual([]);
  // `requestStorageAccess: Permission denied` comes from the real Firebase SDK
  // hitting Chromium's storage partitioning in a headless third-party context.
  // Environmental, not app code, and absent in a normal browser.
  // Same family, added 2026-08-23: `Framing 'https://www.google.com/' violates ...
  // frame-ancestors` is the App Check reCAPTCHA challenge iframe, named by URL rather
  // than by "recaptcha", so the older list missed it. Intermittent in CI.
  const appErrors = consoleErrors.filter(
    (e) => !/net::ERR|Failed to load resource|favicon|requestStorageAccess|frame-ancestors|google\.com/i.test(e)
  );
  expect(appErrors).toEqual([]);
});

// ── Protein identity correction / pinning (hardening wave, c742f17) ──────────
//
// Appended to the EXISTING ready-food production smoke rather than started as a
// second file: it is the same deployed surface, the same fixture bootstrap and the
// same cooked-meals record. The invariant these prove live is the one the whole
// feature exists for — a cooked meal's NAME is never read to infer its protein —
// plus the correction path that is new in this wave.

// A recipe whose protein is derivable from structured ingredients, plus four batches
// covering every state the correction control has to render: recipe-derived,
// manual-unknown with a chicken-shaped name, manual-unknown with a tuna-shaped brand
// name, and an already-pinned batch.
async function seedProteinFood(page) {
  await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    AppState.recipes = normalizeRecipes([{
      id: 'psp-adobo', name: 'PS Chicken Adobo', category: 'Main Dish',
      basePrepTime: 10, baseCookTime: 40, baseServings: 6, currentServings: 6,
      fridgeLife: 4, freezerLife: 60, estimatedCost: 500, storageNotes: '', instructions: 'Simmer.',
      baseIngredients: [
        { name: 'Chicken Thigh', baseQuantity: 1000, unit: 'g', category: 'Protein' },
        { name: 'Garlic (Bawang)', baseQuantity: 30, unit: 'g', category: 'Vegetable' }
      ],
      nutritionPerServing: { calories: 400, protein: 35, carbs: 4, fat: 24, fiber: 0, sodium: 700 },
      equipment: ['stove'], effort: 'normal', activeTime: 10,
      mealBalance: { protein: true, vegetables: false, carb: false }
    }]);
    AppState.pantry = [];
    AppState.cookHistory = [];
    AppState.cookedMeals = normalizeCookedMeals([
      { id: 'psp_derived', recipeId: 'psp-adobo', name: 'PS Chicken Adobo',
        cookedDate: day(0), storage: 'fridge', fridgeLife: 4, freezerLife: 60,
        initialPortions: 4, portionsRemaining: 4 },
      { id: 'psp_lechon', recipeId: null, source: 'takeout', name: 'Landers Lechon Manok',
        cookedDate: day(0), storage: 'fridge', fridgeLife: 3, freezerLife: 60,
        initialPortions: 2, portionsRemaining: 2 },
      { id: 'psp_sea', recipeId: null, source: 'leftovers', name: 'Chicken of the Sea',
        cookedDate: day(0), storage: 'fridge', fridgeLife: 3, freezerLife: 60 },
      { id: 'psp_pinned', recipeId: null, source: 'leftovers', name: 'Beef Stew',
        proteinType: 'beef', cookedDate: day(0), storage: 'fridge', fridgeLife: 5, freezerLife: 60 }
    ]);
    showTab('fridge');
    renderCookedMeals();
  }, DAY_FN);
}

test('the deployed build serves the protein correction code and UI', async ({ page }) => {
  await loadLiveApp(page);

  const missing = await page.evaluate(() =>
    ['setCookedProteinType', 'derivedCookedProteinType', 'cookedProteinAutoLabel',
      'cookedProteinOptionsHtml', 'populateManualCookedProteinSelect',
      'getCookedMealProteinType', 'recipeProteinType', 'isCookedProteinChoice',
      'proteinFamilyForIngredientName', 'flavorsForProteinType']
      .filter((f) => typeof window[f] !== 'function'));
  expect(missing).toEqual([]);

  const vocab = await page.evaluate(() => ({
    ids: COOKED_PROTEIN_IDS.slice(),
    choices: COOKED_PROTEIN_CHOICE_IDS.slice(),
    // The add-form options are GENERATED at boot on the deployed build — index.html
    // must ship the selector empty, with no hand-written <option> markup left in it.
    formValues: Array.from(document.querySelectorAll('#manual-cooked-protein option')).map((o) => o.value),
    formLabels: Array.from(document.querySelectorAll('#manual-cooked-protein option')).map((o) => o.textContent.trim())
  }));
  expect(vocab.ids).toEqual(
    ['chicken', 'pork', 'beef', 'fish', 'salmon', 'tuna', 'shrimp', 'egg', 'tofu']);
  expect(vocab.choices).toEqual(vocab.ids.concat(['none']));
  expect(vocab.formValues).toEqual([''].concat(vocab.choices));
  expect(vocab.formLabels[0]).toBe('Unknown');
  // mixed / unknown are never offered and never stored.
  expect(vocab.formValues).not.toContain('mixed');
  expect(vocab.formValues).not.toContain('unknown');
});

test('live 7,8: Landers Lechon Manok and Chicken of the Sea stay unknown when unpinned', async ({ page }) => {
  await loadLiveApp(page);
  await seedProteinFood(page);

  const got = await page.evaluate(() => {
    const pick = (id) => AppState.cookedMeals.find((m) => m.id === id);
    return {
      lechon: getCookedMealProteinType(pick('psp_lechon')),
      sea: getCookedMealProteinType(pick('psp_sea')),
      lechonStored: 'proteinType' in pick('psp_lechon'),
      seaStored: 'proteinType' in pick('psp_sea'),
      // Rendering the control must not classify anything by itself.
      autoLabels: [pick('psp_lechon'), pick('psp_sea')].map(cookedProteinAutoLabel),
      // A third trap name, evaluated without ever being stored.
      beefStew: getCookedMealProteinType({ id: 'x', recipeId: null, name: 'Beef Stew' })
    };
  });

  expect(got.lechon).toBe('unknown');   // "manok" is chicken in Filipino — still unknown
  expect(got.sea).toBe('unknown');      // brand name; it is actually tuna — still unknown
  expect(got.beefStew).toBe('unknown');
  expect(got.lechonStored).toBe(false); // nothing invented onto the record
  expect(got.seaStored).toBe(false);
  expect(got.autoLabels).toEqual(['Unknown', 'Unknown']);
});

test('live 1,2: an unknown batch is corrected to Chicken, then Chicken to Beef, through the real control', async ({ page }) => {
  await loadLiveApp(page);
  await seedProteinFood(page);

  // Drive the deployed <select>, not the function behind it.
  const sel = page.locator('#cooked-meals-list .cooked-card', { hasText: 'Landers Lechon Manok' })
    .locator('.cooked-protein-field select');
  await expect(sel).toHaveCount(1);

  await sel.selectOption('chicken');
  let got = await page.evaluate(() => {
    const m = AppState.cookedMeals.find((x) => x.id === 'psp_lechon');
    return { stored: m.proteinType, resolved: getCookedMealProteinType(m),
             name: m.name, portions: m.portionsRemaining, id: m.id,
             count: AppState.cookedMeals.length };
  });
  expect(got.stored).toBe('chicken');
  expect(got.resolved).toBe('chicken');
  // Corrected IN PLACE: same record, same id, name and portions intact.
  expect(got.id).toBe('psp_lechon');
  expect(got.name).toBe('Landers Lechon Manok');
  expect(got.portions).toBe(2);
  expect(got.count).toBe(4);

  await page.locator('#cooked-meals-list .cooked-card', { hasText: 'Landers Lechon Manok' })
    .locator('.cooked-protein-field select').selectOption('beef');
  got = await page.evaluate(() => {
    const m = AppState.cookedMeals.find((x) => x.id === 'psp_lechon');
    return { stored: m.proteinType, resolved: getCookedMealProteinType(m) };
  });
  expect(got.stored).toBe('beef');
  expect(got.resolved).toBe('beef');
});

test('live 3,4: a recipe-derived Chicken can be pinned, and an explicit value beats derivation', async ({ page }) => {
  await loadLiveApp(page);
  await seedProteinFood(page);

  const card = page.locator('#cooked-meals-list .cooked-card', { hasText: 'PS Chicken Adobo' });
  const sel = card.locator('.cooked-protein-field select');

  // Unpinned, the empty option NAMES the derived answer rather than showing a blank.
  const before = await page.evaluate(() => {
    const m = AppState.cookedMeals.find((x) => x.id === 'psp_derived');
    return { resolved: getCookedMealProteinType(m), derived: derivedCookedProteinType(m),
             stored: 'proteinType' in m, autoLabel: cookedProteinAutoLabel(m) };
  });
  expect(before.resolved).toBe('chicken');
  expect(before.derived).toBe('chicken');
  expect(before.stored).toBe(false);
  expect(before.autoLabel).toBe('Auto · Chicken');
  expect(await sel.inputValue()).toBe('');

  // 3. Pin it to what it already says.
  await sel.selectOption('chicken');
  const pinned = await page.evaluate(() => {
    const m = AppState.cookedMeals.find((x) => x.id === 'psp_derived');
    return { stored: m.proteinType, resolved: getCookedMealProteinType(m) };
  });
  expect(pinned.stored).toBe('chicken');
  expect(pinned.resolved).toBe('chicken');

  // 4. Override to something the recipe disagrees with — explicit wins.
  await card.locator('.cooked-protein-field select').selectOption('beef');
  const overridden = await page.evaluate(() => {
    const m = AppState.cookedMeals.find((x) => x.id === 'psp_derived');
    return { stored: m.proteinType, resolved: getCookedMealProteinType(m),
             derived: derivedCookedProteinType(m),
             recipeSays: recipeProteinType(AppState.recipes.find((r) => String(r.id) === 'psp-adobo')) };
  });
  expect(overridden.recipeSays).toBe('chicken');
  expect(overridden.derived).toBe('chicken'); // the recipe is unchanged
  expect(overridden.stored).toBe('beef');
  expect(overridden.resolved).toBe('beef');   // and the user's answer wins
});

test('live 5: Auto removes proteinType and returns to derivation, or to unknown', async ({ page }) => {
  await loadLiveApp(page);
  await seedProteinFood(page);

  // Recipe-backed: clearing returns it to the recipe's answer.
  const derivedCard = page.locator('#cooked-meals-list .cooked-card', { hasText: 'PS Chicken Adobo' })
    .locator('.cooked-protein-field select');
  await derivedCard.selectOption('beef');
  await page.locator('#cooked-meals-list .cooked-card', { hasText: 'PS Chicken Adobo' })
    .locator('.cooked-protein-field select').selectOption('');
  const backToDerived = await page.evaluate(() => {
    const m = AppState.cookedMeals.find((x) => x.id === 'psp_derived');
    return { hasField: 'proteinType' in m, resolved: getCookedMealProteinType(m),
             serialisedUnknown: JSON.stringify(m).indexOf('unknown') >= 0 };
  });
  expect(backToDerived.hasField).toBe(false);        // absence IS unknown; nothing stored
  expect(backToDerived.serialisedUnknown).toBe(false);
  expect(backToDerived.resolved).toBe('chicken');

  // Manual: clearing an existing pin returns it to unknown — NOT to its name.
  await page.locator('#cooked-meals-list .cooked-card', { hasText: 'Beef Stew' })
    .locator('.cooked-protein-field select').selectOption('');
  const backToUnknown = await page.evaluate(() => {
    const m = AppState.cookedMeals.find((x) => x.id === 'psp_pinned');
    return { hasField: 'proteinType' in m, resolved: getCookedMealProteinType(m), name: m.name };
  });
  expect(backToUnknown.name).toBe('Beef Stew');
  expect(backToUnknown.hasField).toBe(false);
  expect(backToUnknown.resolved).toBe('unknown');
});

test('live 6: invalid values are rejected and never clear a valid pin', async ({ page }) => {
  await loadLiveApp(page);
  await seedProteinFood(page);

  const got = await page.evaluate(() => {
    const read = () => {
      const m = AppState.cookedMeals.find((x) => x.id === 'psp_pinned');
      return 'proteinType' in m ? m.proteinType : 'ABSENT';
    };
    const attempts = {};
    // Neither a vocabulary id nor the blank option: ignored outright.
    ['mixed', 'unknown', 'unicorn', 'Chicken', ' chicken', 'rice', 'vegetables']
      .forEach((v) => { setCookedProteinType('psp_pinned', v); attempts[v] = read(); });
    [1, 0, true, ['chicken'], { id: 'chicken' }, null, undefined]
      .forEach((v, i) => { setCookedProteinType('psp_pinned', v); attempts['nonstring' + i] = read(); });

    // ...and a value that arrived from storage rather than the UI is dropped by
    // normalization rather than coerced.
    const persisted = [
      { id: 'v_arr', proteinType: ['chicken'] },
      { id: 'v_obj', proteinType: { toString: function() { return 'chicken'; } } },
      { id: 'v_num', proteinType: 3 },
      { id: 'v_mixed', proteinType: 'mixed' },
      { id: 'v_unknown', proteinType: 'unknown' },
      { id: 'v_ok', proteinType: 'chicken' }
    ];
    normalizeCookedMeals(persisted);
    return {
      attempts: attempts,
      persisted: persisted.map((m) => [m.id, 'proteinType' in m ? m.proteinType : 'DROPPED'])
    };
  });

  // Every rejected value left the existing pin exactly as it was.
  Object.entries(got.attempts).forEach(([k, v]) => expect(v, k).toBe('beef'));
  expect(got.persisted).toEqual([
    ['v_arr', 'DROPPED'], ['v_obj', 'DROPPED'], ['v_num', 'DROPPED'],
    ['v_mixed', 'DROPPED'], ['v_unknown', 'DROPPED'], ['v_ok', 'chicken']
  ]);
});

test('live 9: ingredient matching is exact — no substring inference on the deployed build', async ({ page }) => {
  await loadLiveApp(page);

  const got = await page.evaluate(() => ({
    // Names CONTAINING a curated ingredient name must not match it.
    containing: ['Chicken Thigh Marinade', 'Beef Bouillon Cube', 'Tuna-flavoured cat food',
      'Vegan Chicken Breast Substitute', 'Eggsalad', 'Salmon-coloured icing']
      .map((n) => [n, proteinFamilyForIngredientName(n)]),
    // The curated names themselves still match, case- and space-insensitively.
    exact: ['Chicken Thigh', 'chicken thigh', '  Chicken Thigh  ', 'BEEF BRISKET']
      .map((n) => proteinFamilyForIngredientName(n)),
    // Category normalization: an imported ' Protein ' still reads as the category,
    // while category TEXT that merely resembles it does not.
    categoryPadded: recipeProteinType({ id: 1, name: 'x', baseIngredients: [
      { name: 'Longganisa', baseQuantity: 1, unit: 'pc', category: ' Protein ' }] }),
    categoryUpper: recipeProteinType({ id: 1, name: 'x', baseIngredients: [
      { name: 'Longganisa', baseQuantity: 1, unit: 'pc', category: 'PROTEIN' }] }),
    categoryLookalike: recipeProteinType({ id: 1, name: 'x', baseIngredients: [
      { name: 'Longganisa', baseQuantity: 1, unit: 'pc', category: 'Protein-rich' }] })
  }));

  got.containing.forEach(([n, fam]) => expect(fam, n).toBeNull());
  expect(got.exact).toEqual(['chicken', 'chicken', 'chicken', 'beef']);
  expect(got.categoryPadded).toBe('unknown');   // unidentifiable declared protein
  expect(got.categoryUpper).toBe('unknown');
  expect(got.categoryLookalike).toBe('none');   // not read as the protein category
});

test('live 11: Used 1, Done, storage and cooked-date controls still work beside the new control', async ({ page }) => {
  await loadLiveApp(page);
  await seedProteinFood(page);

  const card = page.locator('#cooked-meals-list .cooked-card', { hasText: 'PS Chicken Adobo' });
  await card.locator('.cooked-protein-field select').selectOption('chicken');

  // Used 1 — decrements exactly one portion, correction rides along untouched.
  await card.locator('.cooked-use-one').click();
  let got = await page.evaluate(() => {
    const m = AppState.cookedMeals.find((x) => x.id === 'psp_derived');
    return { remaining: m.portionsRemaining, initial: m.initialPortions, protein: m.proteinType };
  });
  expect(got.remaining).toBe(3);
  expect(got.initial).toBe(4);
  expect(got.protein).toBe('chicken');

  // Storage toggle — still moves the batch, and the pin survives.
  await page.locator('#cooked-meals-list .cooked-card', { hasText: 'PS Chicken Adobo' })
    .locator('.cooked-storage-toggle button', { hasText: 'Freezer' }).click();
  got = await page.evaluate(() => {
    const m = AppState.cookedMeals.find((x) => x.id === 'psp_derived');
    return { storage: m.storage, protein: m.proteinType };
  });
  expect(got.storage).toBe('freezer');
  expect(got.protein).toBe('chicken');

  // Cooked-date input — still editable.
  await page.locator('#cooked-meals-list .cooked-card', { hasText: 'PS Chicken Adobo' })
    .locator('.cooked-field input[type="date"]').fill('2026-08-01');
  got = await page.evaluate(() => {
    const m = AppState.cookedMeals.find((x) => x.id === 'psp_derived');
    return { date: m.cookedDate, protein: m.proteinType };
  });
  expect(got.date).toBe('2026-08-01');
  expect(got.protein).toBe('chicken');

  // Done — removes the batch through the pre-existing path.
  await page.locator('#cooked-meals-list .cooked-card', { hasText: 'Chicken of the Sea' })
    .locator('.cooked-remove').click();
  const remaining = await page.evaluate(() => AppState.cookedMeals.map((m) => m.id));
  expect(remaining).not.toContain('psp_sea');
  expect(remaining).toContain('psp_derived');
});

test('a correction survives a reload on the deployed build', async ({ page }) => {
  await loadLiveApp(page);
  await seedProteinFood(page);

  await page.locator('#cooked-meals-list .cooked-card', { hasText: 'Landers Lechon Manok' })
    .locator('.cooked-protein-field select').selectOption('chicken');
  await page.locator('#cooked-meals-list .cooked-card', { hasText: 'Beef Stew' })
    .locator('.cooked-protein-field select').selectOption('');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    'typeof AppState !== "undefined" && Array.isArray(AppState.cookedMeals) && AppState.cookedMeals.some((m) => m.id === "psp_lechon")',
    null, { timeout: 45000 });

  const got = await page.evaluate(() => {
    const pick = (id) => AppState.cookedMeals.find((m) => m.id === id);
    return {
      corrected: pick('psp_lechon').proteinType,
      correctedResolved: getCookedMealProteinType(pick('psp_lechon')),
      clearedHasField: 'proteinType' in pick('psp_pinned'),
      clearedResolved: getCookedMealProteinType(pick('psp_pinned'))
    };
  });
  expect(got.corrected).toBe('chicken');
  expect(got.correctedResolved).toBe('chicken');
  expect(got.clearedHasField).toBe(false);   // the clear persisted; it did not come back
  expect(got.clearedResolved).toBe('unknown');
});

test('live 10,12: mobile 390px has no horizontal overflow and no page or console errors', async ({ page }) => {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.setViewportSize({ width: 390, height: 844 });
  await loadLiveApp(page);
  await seedProteinFood(page);

  // Exercise the control at phone width, including the longest label the empty
  // option can carry.
  await page.locator('#cooked-meals-list .cooked-card', { hasText: 'Landers Lechon Manok' })
    .locator('.cooked-protein-field select').selectOption('chicken');
  await page.locator('#cooked-meals-list .cooked-card', { hasText: 'Landers Lechon Manok' })
    .locator('.cooked-protein-field select').selectOption('');
  await page.evaluate(() => openManualCookedModal());
  await page.selectOption('#manual-cooked-protein', 'tofu');
  await page.evaluate(() => closeManualCookedModal());

  const layout = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('#cooked-meals-list .cooked-card'));
    return {
      controls: document.querySelectorAll('#cooked-meals-list .cooked-protein-field select').length,
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      listOverflow: (() => {
        const l = document.getElementById('cooked-meals-list');
        return l.scrollWidth - l.clientWidth;
      })(),
      escaped: cards.filter((c) => {
        const sel = c.querySelector('.cooked-protein-field select');
        return sel && Math.ceil(sel.getBoundingClientRect().right) > Math.ceil(c.getBoundingClientRect().right);
      }).length
    };
  });

  expect(layout.controls).toBe(4);
  expect(layout.docOverflow).toBeLessThanOrEqual(0);
  expect(layout.listOverflow).toBeLessThanOrEqual(0);
  expect(layout.escaped).toBe(0);

  expect(pageErrors).toEqual([]);
  // Same environmental filter the rest of this file uses: the real Firebase SDK in a
  // headless third-party context produces storage-partitioning and App Check iframe
  // errors that are not app code.
  const appErrors = consoleErrors.filter(
    (e) => !/net::ERR|Failed to load resource|favicon|requestStorageAccess|frame-ancestors|google\.com/i.test(e)
  );
  expect(appErrors).toEqual([]);
});
