const { test, expect } = require('@playwright/test');

/**
 * Production smoke for the "what should we eat?" wave (TASK-047, D-059).
 *
 * Runs against the DEPLOYED GitHub Pages build, not the working tree. Firebase is
 * deliberately NOT stubbed — the page loads it for real and stays signed out, the
 * normal first-visit path. Each test gets a fresh isolated context, so nothing
 * persists between tests and nothing touches a real account's cloud data.
 *
 * Every assertion here is about the SHIPPED bundle: that Home actually renders the
 * card, that ready food takes the first slot, that expired food never does, that a
 * low-effort cookable recipe can be Easiest, that Something Different appears only
 * when a cook history supports it, that merely displaying a recommendation mutates
 * nothing, and that the pre-existing Home surfaces and Food Attention behaviour are
 * still intact underneath it.
 */

const APP_URL = 'https://shinyamadasan.github.io/Meal-Prep/';

test.use({ viewport: { width: 1280, height: 1700 } });

async function loadLiveApp(page) {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__wseProdBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__wseProdBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
  });
  // Cache-bust so a stale Pages/CDN copy can never make this pass falsely.
  await page.goto(APP_URL + '?smoke=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load').catch(() => {});
  await page.waitForFunction(
    'typeof AppState !== "undefined" && Array.isArray(AppState.recipes)',
    null,
    { timeout: 45000 }
  );
  await page.waitForTimeout(3000);
}

const DAYS_AGO = `(d) => { const t = new Date(); t.setDate(t.getDate() - d);
  return t.getFullYear() + '-' + String(t.getMonth()+1).padStart(2,'0') + '-' + String(t.getDate()).padStart(2,'0'); }`;

const MAKE_RECIPE = `(o) => Object.assign({
  id: o.id, name: o.name, category: 'Dinner', baseServings: 2, currentServings: 2,
  basePrepTime: 5, baseCookTime: 10, fridgeLife: 3, freezerLife: 30,
  baseIngredients: (o.ingredients || ['Chicken', 'Rice']).map((n) => ({
    name: n, baseQuantity: 1, unit: 'pc', category: 'Protein' })),
  instructions: 'Cook it.',
  nutritionPerServing: { calories: 400, protein: 30, carbs: 40, fat: 10, fiber: 2, sodium: 300 },
  equipment: o.equipment || [], effort: o.effort || null,
  activeTime: o.activeTime == null ? null : o.activeTime,
  mealBalance: o.mealBalance || { protein: false, vegetables: false, carb: false },
  tags: o.tags || []
}, o.extra || {})`;

async function live(page, fn) {
  return page.evaluate(({ src, daysSrc, makeSrc }) => {
    const daysAgo = eval(daysSrc);
    const makeRecipe = eval(makeSrc);
    return eval('(' + src + ')')({ daysAgo, makeRecipe });
  }, { src: fn.toString(), daysSrc: DAYS_AGO, makeSrc: MAKE_RECIPE });
}

// ── 1. The shipped bundle actually has the wave in it ───────────────────────

test('the deployed build ships the recommendation engine and renders the card', async ({ page }) => {
  await loadLiveApp(page);

  const present = await page.evaluate(() => ({
    getWhatShouldWeEatSuggestions: typeof getWhatShouldWeEatSuggestions === 'function',
    eatCookCandidates: typeof eatCookCandidates === 'function',
    renderWhatShouldWeEatCard: typeof renderWhatShouldWeEatCard === 'function',
    mealCompletionHint: typeof mealCompletionHint === 'function',
    applianceFriction: typeof applianceFriction === 'function'
  }));
  for (const k of Object.keys(present)) expect(present[k], k).toBe(true);

  const result = await live(page, ({ daysAgo, makeRecipe }) => {
    AppState.recipes = [makeRecipe({ id: 950101, name: 'Smoke Rice Cooker Chicken',
      equipment: ['rice-cooker'], effort: 'very-low', activeTime: 6, tags: ['minimal-cleanup'],
      mealBalance: { protein: true, vegetables: true, carb: true }, ingredients: ['Chicken', 'Rice'] })];
    AppState.pantry = [
      { id: 950001, name: 'Chicken', category: 'Protein', purchaseDate: daysAgo(0), shelfLifeDays: 10 },
      { id: 950002, name: 'Rice', category: 'Grain', purchaseDate: daysAgo(0), shelfLifeDays: 300 }
    ];
    AppState.cookedMeals = [];
    AppState.cookHistory = [];
    renderDashboard();
    return {
      cards: document.querySelectorAll('.dash-card--eat').length,
      header: (document.querySelector('.dash-card--eat .dash-level-header') || {}).textContent || '',
      chips: Array.from(document.querySelectorAll('.dash-card--eat .wse-chip')).map((e) => e.textContent.trim())
    };
  });

  expect(result.cards).toBe(1);
  expect(result.header).toContain('What should we eat?');
  expect(result.chips.length).toBeGreaterThan(0);
  // Reasons, never arithmetic.
  for (const c of result.chips) expect(c).not.toMatch(/score|^-?\d+(\.\d+)?$/i);
});

// ── 2. Ready food takes Eat This First; expired never appears ───────────────

test('ready fridge food occupies Eat This First on the live build', async ({ page }) => {
  await loadLiveApp(page);

  const result = await live(page, ({ daysAgo, makeRecipe }) => {
    AppState.recipes = [makeRecipe({ id: 950201, name: 'Smoke Easy Cook',
      equipment: ['rice-cooker'], effort: 'very-low', activeTime: 5, ingredients: ['Chicken', 'Rice'] })];
    AppState.pantry = [
      { id: 950001, name: 'Chicken', category: 'Protein', purchaseDate: daysAgo(0), shelfLifeDays: 10 },
      { id: 950002, name: 'Rice', category: 'Grain', purchaseDate: daysAgo(0), shelfLifeDays: 300 }
    ];
    AppState.cookedMeals = [{ id: 'smk1', name: 'Smoke Lechon Manok', cookedDate: daysAgo(3),
      storage: 'fridge', fridgeLife: 4, freezerLife: 60, portionsRemaining: 2 }];
    AppState.cookHistory = [];
    renderDashboard();
    const picks = getWhatShouldWeEatSuggestions();
    return {
      firstKey: picks[0].key,
      firstKind: picks[0].kind,
      firstName: picks[0].name,
      firstReasons: picks[0].reasons,
      firstLabel: (document.querySelector('.dash-card--eat .wse-label') || {}).textContent || '',
      firstAction: (document.querySelector('.dash-card--eat .wse-action') || {}).textContent || ''
    };
  });

  expect(result.firstKey).toBe('eat-first');
  expect(result.firstKind).toBe('ready');
  expect(result.firstName).toBe('Smoke Lechon Manok');
  expect(result.firstReasons).toContain('Ready now');
  expect(result.firstReasons).toContain('Use soon');
  expect(result.firstLabel).toContain('Eat this first');
  expect(result.firstAction.trim()).toBe('Used 1');
});

test('expired ready food is never recommended on the live build', async ({ page }) => {
  await loadLiveApp(page);

  const result = await live(page, ({ daysAgo }) => {
    AppState.recipes = [];
    AppState.pantry = [];
    AppState.cookHistory = [];
    AppState.cookedMeals = [{ id: 'smkbad', name: 'Smoke Expired Adobo', cookedDate: daysAgo(25),
      storage: 'fridge', fridgeLife: 4, freezerLife: 60, portionsRemaining: 3 }];
    renderDashboard();
    return {
      picks: getWhatShouldWeEatSuggestions().map((p) => p.name),
      cardHtml: (document.querySelector('.dash-card--eat') || { innerHTML: '' }).innerHTML,
      // Still correctly flagged for disposal — a different job entirely.
      attentionExpired: collectAttentionItems().expired.map((e) => e.name)
    };
  });

  expect(result.picks).toHaveLength(0);
  expect(result.cardHtml).not.toContain('Smoke Expired Adobo');
  expect(result.attentionExpired).toContain('Smoke Expired Adobo');
});

// ── 3. Easiest and Something Different ──────────────────────────────────────

test('a cookable low-effort recipe occupies Easiest on the live build', async ({ page }) => {
  await loadLiveApp(page);

  const result = await live(page, ({ daysAgo, makeRecipe }) => {
    AppState.cookedMeals = [];
    AppState.cookHistory = [];
    AppState.recipes = [
      makeRecipe({ id: 950301, name: 'Smoke Rice Cooker Chicken', equipment: ['rice-cooker'],
        effort: 'very-low', activeTime: 6, tags: ['minimal-cleanup'],
        mealBalance: { protein: true, vegetables: true, carb: true }, ingredients: ['Chicken', 'Rice'] }),
      makeRecipe({ id: 950302, name: 'Smoke Fiddly Pan Thing', equipment: ['pan'],
        effort: 'normal', activeTime: 40, ingredients: ['Chicken', 'Rice'] })
    ];
    AppState.pantry = [
      { id: 950001, name: 'Chicken', category: 'Protein', purchaseDate: daysAgo(0), shelfLifeDays: 10 },
      { id: 950002, name: 'Rice', category: 'Grain', purchaseDate: daysAgo(0), shelfLifeDays: 300 }
    ];
    renderDashboard();
    const easiest = getWhatShouldWeEatSuggestions().find((p) => p.key === 'easiest');
    return {
      name: easiest.name,
      reasons: easiest.reasons,
      action: easiest.action.label,
      labels: Array.from(document.querySelectorAll('.dash-card--eat .wse-label')).map((e) => e.textContent.trim())
    };
  });

  expect(result.name).toBe('Smoke Rice Cooker Chicken');
  expect(result.reasons).toContain('Rice cooker');
  expect(result.reasons).toContain('6 min active');
  expect(result.reasons).toContain('Balanced');
  expect(result.action).toBe('Cook');
  expect(result.labels.join(' ')).toContain('Easiest');
});

test('Something Different appears only when cook history supports it', async ({ page }) => {
  await loadLiveApp(page);

  const result = await live(page, ({ daysAgo, makeRecipe }) => {
    const seed = () => {
      AppState.cookedMeals = [];
      AppState.recipes = [
        makeRecipe({ id: 950401, name: 'Smoke Brand New Easy', equipment: ['no-cook'],
          effort: 'assembly', activeTime: 2, ingredients: ['Chicken', 'Rice'] }),
        makeRecipe({ id: 950402, name: 'Smoke Old Favourite', equipment: ['oven'],
          effort: 'low', activeTime: 10, ingredients: ['Chicken', 'Rice'] })
      ];
      AppState.pantry = [
        { id: 950001, name: 'Chicken', category: 'Protein', purchaseDate: daysAgo(0), shelfLifeDays: 10 },
        { id: 950002, name: 'Rice', category: 'Grain', purchaseDate: daysAgo(0), shelfLifeDays: 300 }
      ];
    };

    seed();
    AppState.cookHistory = [];
    const withoutHistory = getWhatShouldWeEatSuggestions().map((p) => p.key);

    seed();
    AppState.cookHistory = [{ recipeId: 950402, recipeName: 'Smoke Old Favourite',
      date: new Date(Date.now() - 18 * 864e5).toISOString(), servings: 2 }];
    const withHistory = getWhatShouldWeEatSuggestions();

    return {
      withoutHistory: withoutHistory,
      withHistory: withHistory.map((p) => p.key),
      differentName: (withHistory.find((p) => p.key === 'different') || {}).name,
      differentReasons: (withHistory.find((p) => p.key === 'different') || {}).reasons
    };
  });

  // No history → the category is omitted rather than invented.
  expect(result.withoutHistory).not.toContain('different');
  expect(result.withHistory).toContain('different');
  expect(result.differentName).toBe('Smoke Old Favourite');
  expect(result.differentReasons.join(' ')).toContain('Not for 18 days');
});

// ── 4. Reads only, and Used 1 still works ───────────────────────────────────

test('displaying a recommendation mutates nothing on the live build', async ({ page }) => {
  await loadLiveApp(page);

  const result = await live(page, ({ daysAgo, makeRecipe }) => {
    AppState.recipes = [makeRecipe({ id: 950501, name: 'Smoke Recipe', effort: 'low',
      activeTime: 10, ingredients: ['Chicken', 'Rice'] })];
    AppState.pantry = [
      { id: 950001, name: 'Chicken', category: 'Protein', purchaseDate: daysAgo(4), shelfLifeDays: 5 },
      { id: 950002, name: 'Rice', category: 'Grain', purchaseDate: daysAgo(0), shelfLifeDays: 300 }
    ];
    AppState.cookedMeals = [{ id: 'smk9', name: 'Smoke Batch', cookedDate: daysAgo(1),
      storage: 'fridge', fridgeLife: 4, freezerLife: 60, portionsRemaining: 2 }];
    AppState.cookHistory = [];
    AppState.deletions = {};
    localStorage.setItem('mealPrepFoodAlerts', JSON.stringify({ enabled: true, announced: { seeded: 'expired' } }));

    const snap = () => JSON.stringify({
      pantry: AppState.pantry, cooked: AppState.cookedMeals, grocery: AppState.groceryList,
      deletions: AppState.deletions, history: AppState.cookHistory
    });
    const before = snap();
    const alertsBefore = localStorage.getItem('mealPrepFoodAlerts');

    getWhatShouldWeEatSuggestions();
    eatCookCandidates();
    renderWhatShouldWeEatCard();
    renderDashboard();
    renderDashboard();

    return {
      unchanged: before === snap(),
      alertsUnchanged: alertsBefore === localStorage.getItem('mealPrepFoodAlerts'),
      portions: AppState.cookedMeals[0].portionsRemaining,
      // No recommendation-shaped state anywhere.
      appStateLeak: Object.keys(AppState).filter((k) => /recommend|suggestion|ranking|whatShouldWeEat|wse/i.test(k)),
      // '__'-prefixed keys belong to the test harness, not the app.
      lsLeak: Object.keys(localStorage)
        .filter((k) => k.indexOf('__') !== 0)
        .filter((k) => /recommend|suggestion|ranking|whatShouldWeEat|wse/i.test(k))
    };
  });

  expect(result.unchanged).toBe(true);
  expect(result.alertsUnchanged).toBe(true);
  expect(result.portions).toBe(2);
  expect(result.appStateLeak).toEqual([]);
  expect(result.lsLeak).toEqual([]);
});

test('Used 1 still works from the live recommendation card', async ({ page }) => {
  await loadLiveApp(page);

  await live(page, ({ daysAgo }) => {
    AppState.recipes = [];
    AppState.pantry = [];
    AppState.cookHistory = [];
    AppState.cookedMeals = [{ id: 'smkuse', name: 'Smoke Adobo', cookedDate: daysAgo(1),
      storage: 'fridge', fridgeLife: 4, freezerLife: 60, portionsRemaining: 3 }];
    renderDashboard();
  });

  await expect(page.locator('.dash-card--eat .wse-chip')).toContainText(['3 portions']);
  await page.locator('.dash-card--eat .wse-action').first().click();
  await page.waitForTimeout(600);

  const after = await page.evaluate(() => ({
    portions: AppState.cookedMeals[0].portionsRemaining,
    chips: Array.from(document.querySelectorAll('.dash-card--eat .wse-chip')).map((e) => e.textContent.trim())
  }));
  expect(after.portions).toBe(2);
  expect(after.chips).toContain('2 portions');
});

// ── 5. Existing surfaces survive underneath ─────────────────────────────────

test('Ready Food and cook-suggestion surfaces remain intact below the new card', async ({ page }) => {
  await loadLiveApp(page);

  const result = await live(page, ({ daysAgo, makeRecipe }) => {
    AppState.recipes = [
      makeRecipe({ id: 950601, name: 'Smoke RC Chicken', equipment: ['rice-cooker'],
        effort: 'very-low', activeTime: 5, ingredients: ['Chicken', 'Rice'] }),
      makeRecipe({ id: 950602, name: 'Smoke Oven Pork', equipment: ['oven'], effort: 'low',
        activeTime: 10, ingredients: ['Pork', 'Rice'] })
    ];
    AppState.pantry = [
      { id: 950001, name: 'Chicken', category: 'Protein', purchaseDate: daysAgo(0), shelfLifeDays: 10 },
      { id: 950003, name: 'Pork', category: 'Protein', purchaseDate: daysAgo(0), shelfLifeDays: 10 },
      { id: 950002, name: 'Rice', category: 'Grain', purchaseDate: daysAgo(0), shelfLifeDays: 300 }
    ];
    AppState.cookedMeals = [{ id: 'smkr', name: 'Smoke Ready Batch', cookedDate: daysAgo(1),
      storage: 'fridge', fridgeLife: 4, freezerLife: 60, portionsRemaining: 2 }];
    AppState.cookHistory = [{ recipeId: 950602, recipeName: 'Smoke Oven Pork',
      date: new Date(Date.now() - 14 * 864e5).toISOString(), servings: 2 }];
    renderDashboard();
    renderRecipes();
    const html = document.getElementById('dashboard').innerHTML;
    return {
      eatCard: document.querySelectorAll('.dash-card--eat').length,
      readyCard: document.querySelectorAll('.dash-card--ready').length,
      readyRows: document.querySelectorAll('.dash-card--ready .dash-ready-row').length,
      readyUseBtns: document.querySelectorAll('.dash-card--ready .dash-ready-use').length,
      suggestCard: document.querySelectorAll('.dash-card--suggest').length,
      eatBeforeReady: html.indexOf('dash-card--eat') < html.indexOf('dash-card--ready'),
      readyBeforeSuggest: html.indexOf('dash-card--ready') < html.indexOf('dash-card--suggest'),
      quickChips: document.querySelectorAll('#recipe-quick-filters .rq-chip').length
    };
  });

  expect(result.eatCard).toBe(1);
  expect(result.readyCard).toBe(1);
  expect(result.readyRows).toBeGreaterThan(0);
  expect(result.readyUseBtns).toBeGreaterThan(0);
  expect(result.suggestCard).toBe(1);
  expect(result.eatBeforeReady).toBe(true);
  expect(result.readyBeforeSuggest).toBe(true);   // pre-existing order preserved
  expect(result.quickChips).toBeGreaterThan(0);   // equipment filters still there
});

test('Food Attention behaviour is untouched by the recommendation card', async ({ page }) => {
  await loadLiveApp(page);

  const result = await live(page, ({ daysAgo }) => {
    AppState.recipes = [];
    AppState.cookHistory = [];
    AppState.pantry = [
      { id: 950701, name: 'Smoke Expired Chicken', category: 'Protein', purchaseDate: daysAgo(30), shelfLifeDays: 3 },
      { id: 950702, name: 'Smoke Use Soon Veg', category: 'Vegetable', purchaseDate: daysAgo(4), shelfLifeDays: 5 }
    ];
    AppState.cookedMeals = [];
    renderDashboard();
    refreshFreshnessAlerts();
    const a = collectAttentionItems();
    return {
      // The notification machinery from D-058 is present and inert.
      notifyFnPresent: typeof maybeNotifyAttention === 'function',
      alertsOff: loadFoodAlertPrefs().enabled,
      permissionNotRequested: typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
      expired: a.expired.map((e) => e.name),
      useSoon: a.useSoon.map((e) => e.name),
      attentionCard: document.querySelectorAll('.dash-card--warn').length,
      keepBtns: document.querySelectorAll('.dash-keep-btn').length,
      bannerVisible: !document.getElementById('freshness-alert-banner').classList.contains('hidden'),
      settingsRow: !!document.getElementById('settings-food-alerts-row')
    };
  });

  expect(result.notifyFnPresent).toBe(true);
  expect(result.alertsOff).toBe(false);
  expect(result.permissionNotRequested).not.toBe('granted'); // nothing auto-asked
  expect(result.expired).toContain('Smoke Expired Chicken');
  expect(result.useSoon).toContain('Smoke Use Soon Veg');
  expect(result.attentionCard).toBe(1);
  expect(result.keepBtns).toBeGreaterThan(0);
  expect(result.bannerVisible).toBe(true);
  expect(result.settingsRow).toBe(true);
});

// ── 6. Mobile + console health on the live build ────────────────────────────

test('mobile Home has no horizontal overflow and no console errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // Firebase/App Check chatter on a signed-out first visit is expected here.
    if (/Failed to load resource|net::ERR_|firebase|recaptcha|appcheck|permission-denied|requestStorageAccess/i.test(t)) return;
    errors.push('console: ' + t);
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await loadLiveApp(page);

  await live(page, ({ daysAgo, makeRecipe }) => {
    AppState.recipes = [
      makeRecipe({ id: 950801, name: 'Smoke Chicken Mushroom Rice With A Long Name',
        equipment: ['rice-cooker'], effort: 'very-low', activeTime: 6, tags: ['minimal-cleanup'],
        mealBalance: { protein: true, vegetables: true, carb: true }, ingredients: ['Chicken', 'Rice'] }),
      makeRecipe({ id: 950802, name: 'Smoke Oven Pork Adobo Also With A Long Name',
        equipment: ['oven'], effort: 'low', activeTime: 10, tags: ['batch-friendly'],
        ingredients: ['Pork', 'Rice'] })
    ];
    AppState.pantry = [
      { id: 950001, name: 'Chicken', category: 'Protein', purchaseDate: daysAgo(0), shelfLifeDays: 10 },
      { id: 950003, name: 'Pork', category: 'Protein', purchaseDate: daysAgo(0), shelfLifeDays: 10 },
      { id: 950002, name: 'Rice', category: 'Grain', purchaseDate: daysAgo(0), shelfLifeDays: 300 }
    ];
    AppState.cookedMeals = [{ id: 'smkm', name: 'Smoke Lechon Manok', recipeId: 950801,
      cookedDate: daysAgo(3), storage: 'fridge', fridgeLife: 4, freezerLife: 60, portionsRemaining: 2 }];
    AppState.cookHistory = [{ recipeId: 950802, recipeName: 'Smoke Oven Pork Adobo Also With A Long Name',
      date: new Date(Date.now() - 15 * 864e5).toISOString(), servings: 2 }];
    renderDashboard();
  });

  const card = page.locator('.dash-card--eat');
  await expect(card).toBeVisible();
  const box = await card.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);

  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  const actions = page.locator('.dash-card--eat .wse-action');
  const n = await actions.count();
  expect(n).toBe(3);
  for (let i = 0; i < n; i++) {
    const b = await actions.nth(i).boundingBox();
    expect(b.x + b.width).toBeLessThanOrEqual(390);
    expect(b.height).toBeGreaterThanOrEqual(30);
  }

  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});
