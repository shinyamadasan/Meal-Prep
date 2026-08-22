const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

/**
 * Ready-food wave — Home "Ready to eat" ranking, and the real-world
 * Landers lechon manok workflow end to end.
 *
 * The product rule this file exists to prove:
 *   ready food  →  easiest thing to cook  →  other suggestions
 */

test.use({ viewport: { width: 1280, height: 1700 } });

async function loadLocalApp(page) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__readyHomeBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__readyHomeBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
  });
  await page.goto(pathToFileURL(path.resolve('index.html')).href, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
}

// Local calendar date N days ago — daysLeftFrom()/todayISO() work in local time.
const LOCAL_DAY_FN = `(d) => {
  const t = new Date();
  t.setDate(t.getDate() - d);
  return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
}`;

test('ready food ranks expiring fridge food ahead of fridge, and fridge ahead of freezer', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    AppState.recipes = [];
    AppState.cookedMeals = normalizeCookedMeals([
      // Freezer — keeps, so it should sort last.
      { id: 'm_freezer', name: 'Freezer Beef', cookedDate: day(2), storage: 'freezer',
        fridgeLife: 3, freezerLife: 60, initialPortions: 5, portionsRemaining: 5 },
      // Fridge, plenty of time left.
      { id: 'm_fridge', name: 'Fridge Pork', cookedDate: day(0), storage: 'fridge',
        fridgeLife: 6, freezerLife: 60, initialPortions: 3, portionsRemaining: 3 },
      // Fridge, expiring within the warn window — must come first.
      { id: 'm_soon', name: 'Use Soon Chicken', cookedDate: day(3), storage: 'fridge',
        fridgeLife: 4, freezerLife: 60, initialPortions: 2, portionsRemaining: 2 }
    ]);

    const ranked = getReadyFoodSuggestions();
    return {
      order: ranked.map((m) => m.id),
      buckets: ranked.map((m) => readyFoodBucket(m)),
      metaSoon: readyFoodMetaLine(ranked[0]),
      metaFreezer: readyFoodMetaLine(ranked[2])
    };
  }, LOCAL_DAY_FN);

  expect(result.order).toEqual(['m_soon', 'm_fridge', 'm_freezer']);
  expect(result.buckets).toEqual([0, 1, 2]);
  expect(result.metaSoon).toContain('2 portions');
  expect(result.metaSoon).toContain('fridge');
  expect(result.metaSoon).toContain('use soon');
  expect(result.metaFreezer).toContain('freezer');
});

test('expired food is never suggested as something to eat', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    AppState.recipes = [];
    AppState.cookedMeals = normalizeCookedMeals([
      { id: 'm_expired', name: 'Expired Pork', cookedDate: day(9), storage: 'fridge',
        fridgeLife: 3, freezerLife: 60, initialPortions: 2, portionsRemaining: 2 },
      { id: 'm_ok', name: 'Good Chicken', cookedDate: day(0), storage: 'fridge',
        fridgeLife: 5, freezerLife: 60, initialPortions: 2, portionsRemaining: 2 }
    ]);
    return {
      ids: getReadyFoodSuggestions().map((m) => m.id),
      // …but the existing freshness engine still flags it for disposal.
      expiredAlerts: getFreshnessAlerts().cooked.expired
    };
  }, LOCAL_DAY_FN);

  expect(result.ids).toEqual(['m_ok']);
  expect(result.expiredAlerts).toBe(1);
});

test('Home shows ready food ABOVE the cook suggestions, and keeps both', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    AppState.recipes = normalizeRecipes([{
      id: 'quick', name: 'Rice Cooker Chicken', category: 'Main Dish',
      basePrepTime: 5, baseCookTime: 40, baseServings: 4, currentServings: 4,
      fridgeLife: 4, freezerLife: 60, estimatedCost: 300, storageNotes: '', instructions: 'Cook.',
      baseIngredients: [{ name: 'Chicken', baseQuantity: 800, unit: 'g', category: 'Protein' }],
      nutritionPerServing: { calories: 500, protein: 40, carbs: 30, fat: 20, fiber: 1, sodium: 500 },
      equipment: ['rice-cooker'], effort: 'very-low', activeTime: 5
    }]);
    AppState.pantry = [
      { id: 'p1', name: 'Chicken', category: 'Protein', purchaseDate: day(0), shelfLifeDays: 5 }
    ];
    AppState.cookHistory = [];
    AppState.cookedMeals = normalizeCookedMeals([
      { id: 'm_ready', name: 'Lechon Manok', cookedDate: day(1), storage: 'fridge',
        fridgeLife: 3, freezerLife: 30, initialPortions: 2, portionsRemaining: 2 }
    ]);

    showTab('dashboard');
    renderDashboard();

    const html = document.getElementById('dashboard').innerHTML;
    return {
      readyCards: document.querySelectorAll('.dash-card--ready').length,
      suggestCards: document.querySelectorAll('.dash-card--suggest').length,
      readyIndex: html.indexOf('dash-card--ready'),
      suggestIndex: html.indexOf('dash-card--suggest'),
      readyHeader: (document.querySelector('.dash-card--ready .dash-level-header') || {}).textContent || '',
      readyRows: document.querySelectorAll('.dash-card--ready .dash-ready-row').length,
      useButtons: document.querySelectorAll('.dash-card--ready .dash-ready-use').length
    };
  }, LOCAL_DAY_FN);

  expect(result.readyCards).toBe(1);
  // The pre-existing low-effort cook suggestions are still there…
  expect(result.suggestCards).toBe(1);
  // …but ready food is rendered first.
  expect(result.readyIndex).toBeGreaterThanOrEqual(0);
  expect(result.readyIndex).toBeLessThan(result.suggestIndex);
  expect(result.readyHeader).toContain('Ready to eat');
  expect(result.readyRows).toBe(1);
  expect(result.useButtons).toBe(1);
});

test('the ready card is omitted entirely when there is no ready food', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate(() => {
    AppState.cookedMeals = [];
    showTab('dashboard');
    renderDashboard();
    return {
      html: renderReadyFoodCard(),
      cards: document.querySelectorAll('.dash-card--ready').length
    };
  });

  expect(result.html).toBe('');
  expect(result.cards).toBe(0);
});

test('the ready card caps at 3 items rather than listing the whole fridge', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    AppState.recipes = [];
    AppState.cookedMeals = normalizeCookedMeals(
      Array.from({ length: 8 }, (_, i) => ({
        id: 'm' + i, name: 'Batch ' + i, cookedDate: day(0), storage: 'fridge',
        fridgeLife: 5, freezerLife: 60, initialPortions: 2, portionsRemaining: 2
      }))
    );
    showTab('dashboard');
    renderDashboard();
    return {
      stored: AppState.cookedMeals.length,
      rows: document.querySelectorAll('.dash-card--ready .dash-ready-row').length,
      allAvailable: getReadyFoodSuggestions().length
    };
  }, LOCAL_DAY_FN);

  expect(result.stored).toBe(8);
  expect(result.allAvailable).toBe(8);
  expect(result.rows).toBe(3);
});

test('ready food reuses the recipe mealBalance as a side-dish hint', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    AppState.recipes = normalizeRecipes([
      { id: 'r_protein', name: 'Oven Chicken', baseIngredients: [], baseServings: 4, currentServings: 4,
        basePrepTime: 10, baseCookTime: 40,
        mealBalance: { protein: true, vegetables: false, carb: false } },
      { id: 'r_complete', name: 'Full Bowl', baseIngredients: [], baseServings: 4, currentServings: 4,
        basePrepTime: 10, baseCookTime: 20,
        mealBalance: { protein: true, vegetables: true, carb: true } },
      { id: 'r_veg', name: 'Veg Only', baseIngredients: [], baseServings: 4, currentServings: 4,
        basePrepTime: 5, baseCookTime: 10,
        mealBalance: { protein: false, vegetables: true, carb: false } }
    ]);
    AppState.cookedMeals = normalizeCookedMeals([
      { id: 'c1', recipeId: 'r_protein', name: 'Oven Chicken', cookedDate: day(0), storage: 'fridge', fridgeLife: 4, freezerLife: 60, initialPortions: 2, portionsRemaining: 2 },
      { id: 'c2', recipeId: 'r_complete', name: 'Full Bowl', cookedDate: day(0), storage: 'fridge', fridgeLife: 4, freezerLife: 60, initialPortions: 2, portionsRemaining: 2 },
      { id: 'c3', recipeId: 'r_veg', name: 'Veg Only', cookedDate: day(0), storage: 'fridge', fridgeLife: 4, freezerLife: 60, initialPortions: 2, portionsRemaining: 2 },
      { id: 'c4', recipeId: null, name: 'Manual Leftovers', cookedDate: day(0), storage: 'fridge', fridgeLife: 4, freezerLife: 60, initialPortions: 2, portionsRemaining: 2 }
    ]);
    const byId = (id) => AppState.cookedMeals.find((m) => m.id === id);
    return {
      proteinOnly: readyFoodBalanceHint(byId('c1')),
      complete: readyFoodBalanceHint(byId('c2')),
      vegOnly: readyFoodBalanceHint(byId('c3')),
      manual: readyFoodBalanceHint(byId('c4'))
    };
  }, LOCAL_DAY_FN);

  expect(result.proteinOnly).toBe('add veg + rice');
  expect(result.complete).toBe('');   // already balanced — nothing to nudge
  expect(result.vegOnly).toBe('');    // no protein, so a side hint is meaningless
  expect(result.manual).toBe('');     // manual food has no recipe to read
});

test('one tap from Home consumes a portion without opening anything', async ({ page }) => {
  await loadLocalApp(page);

  await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    AppState.recipes = [];
    AppState.cookedMeals = normalizeCookedMeals([{
      id: 'm_home', name: 'Home Chicken', cookedDate: day(0), storage: 'fridge',
      fridgeLife: 4, freezerLife: 60, initialPortions: 3, portionsRemaining: 3
    }]);
    showTab('dashboard');
    renderDashboard();
  }, LOCAL_DAY_FN);

  await expect(page.locator('.dash-card--ready .dash-ready-meta')).toContainText('3 portions');
  await page.locator('.dash-card--ready .dash-ready-use').click();
  await page.waitForTimeout(500);

  const after = await page.evaluate(() => ({
    remaining: AppState.cookedMeals[0].portionsRemaining,
    openOverlays: document.querySelectorAll('.modal:not(.hidden), .confirm-overlay').length
  }));
  expect(after.remaining).toBe(2);
  expect(after.openOverlays).toBe(0);
  await expect(page.locator('.dash-card--ready .dash-ready-meta')).toContainText('2 portions');
});

// ── The real-world scenario the wave exists for ─────────────────────────────

test('the Landers lechon manok workflow works with no special-case code', async ({ page }) => {
  await loadLocalApp(page);

  // 1-4. Buy 2 chickens, eat some, portion the rest, add the remainder via the
  //      ordinary manual cooked-food flow — 6 portions, fridge.
  await page.evaluate(() => {
    AppState.recipes = [];
    AppState.cookedMeals = [];
    showTab('fridge');
    renderCookedMeals();
    openManualCookedModal();
  });
  await page.locator('#manual-cooked-name').fill('Landers Lechon Manok');
  await page.locator('#manual-cooked-source').selectOption('leftovers');
  await page.locator('#manual-cooked-portions').fill('6');
  await page.locator('#manual-cooked-storage').selectOption('fridge');
  await page.locator('#manual-cooked-fridge-life').fill('3');
  await page.locator('#manual-cooked-freezer-life').fill('60');
  await page.locator('#manual-cooked-modal .btn--primary').click();
  await page.waitForTimeout(500);

  let state = await page.evaluate(() => {
    const m = AppState.cookedMeals[0];
    return { name: m.name, initial: m.initialPortions, remaining: m.portionsRemaining, storage: m.storage, id: m.id };
  });
  expect(state).toMatchObject({
    name: 'Landers Lechon Manok', initial: 6, remaining: 6, storage: 'fridge'
  });

  // 5. Eat two portions — two taps, nothing else.
  await page.locator('#cooked-meals-list .cooked-use-one').click();
  await page.waitForTimeout(350);
  await page.locator('#cooked-meals-list .cooked-use-one').click();
  await page.waitForTimeout(350);

  state = await page.evaluate(() => ({
    remaining: AppState.cookedMeals[0].portionsRemaining,
    initial: AppState.cookedMeals[0].initialPortions,
    badge: document.querySelector('#cooked-meals-list .cooked-portions').textContent.trim()
  }));
  expect(state.remaining).toBe(4);
  expect(state.initial).toBe(6);
  expect(state.badge).toBe('4 portions');

  // 6. Move the rest to the freezer using the EXISTING storage toggle.
  await page.evaluate(() => setCookedStorage(AppState.cookedMeals[0].id, 'freezer'));
  await page.waitForTimeout(300);
  state = await page.evaluate(() => ({
    storage: AppState.cookedMeals[0].storage,
    remaining: AppState.cookedMeals[0].portionsRemaining,
    // Freezer life now drives freshness, exactly as before this wave.
    shelfLife: cookedShelfLife(AppState.cookedMeals[0])
  }));
  expect(state.storage).toBe('freezer');
  expect(state.remaining).toBe(4);
  expect(state.shelfLife).toBe(60);

  // 7-8. The app remembers ready chicken exists, and Home offers it before it
  //      suggests cooking another chicken recipe.
  const home = await page.evaluate(() => {
    AppState.recipes = normalizeRecipes([{
      id: 'another-chicken', name: 'Another Chicken Recipe', category: 'Main Dish',
      basePrepTime: 5, baseCookTime: 30, baseServings: 4, currentServings: 4,
      fridgeLife: 4, freezerLife: 60, estimatedCost: 300, storageNotes: '', instructions: 'Cook.',
      baseIngredients: [{ name: 'Chicken', baseQuantity: 800, unit: 'g', category: 'Protein' }],
      nutritionPerServing: { calories: 500, protein: 40, carbs: 20, fat: 25, fiber: 0, sodium: 500 },
      equipment: ['rice-cooker'], effort: 'very-low', activeTime: 5
    }]);
    showTab('dashboard');
    renderDashboard();
    const html = document.getElementById('dashboard').innerHTML;
    return {
      readyName: (document.querySelector('.dash-card--ready .dash-ready-name') || {}).textContent || '',
      readyMeta: (document.querySelector('.dash-card--ready .dash-ready-meta') || {}).textContent || '',
      readyBeforeCook: html.indexOf('dash-card--ready') < html.indexOf('dash-card--suggest'),
      cookSuggestionStillThere: document.querySelectorAll('.dash-card--suggest').length
    };
  });

  expect(home.readyName).toContain('Landers Lechon Manok');
  expect(home.readyMeta).toContain('4 portions');
  expect(home.readyMeta).toContain('freezer');
  expect(home.readyBeforeCook).toBe(true);
  expect(home.cookSuggestionStillThere).toBe(1);

  // Nothing Landers-specific ended up in the data model.
  const shape = await page.evaluate(() => Object.keys(AppState.cookedMeals[0]).sort());
  expect(shape).toEqual([
    'cookedDate', 'freezerLife', 'fridgeLife', 'id', 'initialPortions', 'name',
    'portionsRemaining', 'recipeId', 'source', 'storage', 'updatedAt'
  ]);
});

test('the portions cooking hack ships with the defaults', async ({ page }) => {
  await loadLocalApp(page);

  const titles = await page.evaluate(() => {
    AppState.customHacks = defaultCookingHacks.map((h) => Object.assign({}, h));
    showTab('hacks');
    renderCookingHacks();
    return Array.prototype.slice
      .call(document.querySelectorAll('#cooking-hacks .hack-item-title'))
      .map((el) => el.textContent.trim());
  });

  expect(titles).toContain('Count Portions When You Store It');
  expect(titles).toContain('Two Lechon Manok Hack');
  expect(titles.length).toBe(14);
});
