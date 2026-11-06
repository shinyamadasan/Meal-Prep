const { test, expect } = require('@playwright/test');
const { waitForAppReady, waitForRestored } = require('./app-ready');

const OLD = '2026-01-01T00:00:00.000Z';
const FACT = { id: 'mc_recovery', cookedMealId: 'cm_recovery', recipeId: 'recovery',
  mealName: 'Recovery bowls', portionsConsumed: 1, consumedAt: OLD };
const RECIPE = { id: 'recovery', name: 'Recovery bowls', baseServings: 4, currentServings: 4,
  category: 'Main Dish', basePrepTime: 5, baseCookTime: 10, baseIngredients: [],
  instructions: 'Synthetic recipe.', fridgeLife: 3, freezerLife: 90, updatedAt: OLD };

async function loadApp(page) {
  await page.route('**/*', route => route.request().url().startsWith('http://127.0.0.1:47813/')
    ? route.continue() : route.abort());
  await page.addInitScript(() => {
    if (sessionStorage.getItem('recoveryBoot')) return;
    sessionStorage.setItem('recoveryBoot', '1');
    localStorage.clear();
    ['mealPrepHelpSeen', 'mealPrepStartDone', 'pantryOnboardingDone'].forEach(key => localStorage.setItem(key, '1'));
  });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
  await page.evaluate(({ recipe, fact }) => {
    Object.assign(AppState, {
      recipes: [recipe], pantry: [{ id: 'buy_recovery', name: 'Recovery carrot', category: 'Vegetable',
        quantity: 3, unit: 'pcs', staple: false, updatedAt: recipe.updatedAt }],
      groceryList: [], flavors: [], preparedFlavors: [], customIngredients: [], customHacks: [],
      userIngredients: [], ingredientPrices: {}, myStores: [], customStores: [], plannedBatches: [],
      cookedMeals: [{ id: 'cm_recovery', recipeId: recipe.id, name: recipe.name, cookedDate: '2026-11-06',
        storage: 'fridge', fridgeLife: 3, freezerLife: 90, initialPortions: 4, portionsRemaining: 3, updatedAt: recipe.updatedAt }],
      mealConsumptions: [fact], mealConsumptionConflicts: [], cookHistory: [{ recipeId: recipe.id,
        recipeName: recipe.name, date: recipe.updatedAt, servings: 4 }], recentRecipes: [recipe.id],
      prepModeSession: null, deletions: {}, inventoryVerifiedAt: null
    });
    Object.values(AppState.weeklyPlan).forEach(day => Object.assign(day, { breakfast: null, lunch: null, dinner: null, snacks: [] }));
    snapshotIdBaseline();
    saveData();
  }, { recipe: RECIPE, fact: FACT });
}

async function chooseImport(page, data) {
  const choose = page.waitForEvent('filechooser');
  await page.evaluate(() => importData());
  await (await choose).setFiles({ name: 'synthetic-recovery.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(data)) });
}

async function acceptIfShown(page) {
  await page.waitForFunction(() => document.querySelector('.confirm-ok-btn') || document.body.innerText.includes('Failed to import'));
  if (await page.locator('.confirm-ok-btn').count()) await page.locator('.confirm-ok-btn').click();
}

async function dataSnapshot(page) {
  return page.evaluate(() => ({ runtime: JSON.parse(JSON.stringify(snapshotData())),
    stored: localStorage.getItem(STORAGE_KEY), backup: localStorage.getItem(BACKUP_KEY) }));
}

async function mockCloud(page, data) {
  await page.evaluate(async cloud => {
    const clone = value => JSON.parse(JSON.stringify(value));
    window.__recoveryCloud = clone(cloud);
    window.__recoveryWrites = [];
    window.__recoveryReads = 0;
    window.firebase = { db: {}, doc: () => ({}), collection: () => ({}),
      getDocs: async () => ({ forEach() {} }),
      getDoc: async () => { window.__recoveryReads++; return { exists: () => true, data: () => clone(window.__recoveryCloud) }; },
      onSnapshot: (_ref, cb) => { window.__recoveryListener = cb; return () => {}; },
      runTransaction: async (_db, action) => {
        let pending;
        await action({ get: async () => ({ exists: () => true, data: () => clone(window.__recoveryCloud) }),
          set: (_ref, payload) => { pending = clone(payload); } });
        if (pending) {
          window.__recoveryCloud = pending; window.__recoveryWrites.push(pending);
          sessionStorage.setItem('recoveryCloud', JSON.stringify(pending));
        }
      }
    };
    AppState.currentUser = { uid: 'synthetic-recovery' };
    AppState.cloudReady = false;
    await loadUserData(); // establishes cloudReady only after the actual mocked cloud read
  }, data);
  await expect.poll(() => page.evaluate(() => AppState.cloudReady)).toBe(true);
}


const MARKUP = '<img src="/hardening-missing" onerror="window.__hardeningXss=true">';
const BAD_ID = "x');window.__hardeningXss=true;//\" onpointerover=\"window.__hardeningXss=true";

async function importHardening(page, data) {
  await chooseImport(page, data);
  await acceptIfShown(page);
  await expect.poll(() => page.evaluate(data => Object.keys(data).filter(k => Array.isArray(data[k])).every(k => data[k].every(item => AppState[k].some(x => x.id === item.id))), data)).toBe(true);
}

async function assertInert(page, selector) {
  await expect(page.locator(selector).locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => !!window.__hardeningXss)).toBe(false);
}

for (const width of [1280, 390]) {
  for (const collection of ['recipes', 'customIngredients', 'customHacks']) {
    test(`${collection} imported markup is inert at ${width}px and after reload`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await loadApp(page);
      const item = collection === 'recipes' ? { ...RECIPE, id: 'hardening', name: MARKUP, category: MARKUP,
        currentServings: MARKUP, baseServings: MARKUP, fridgeLife: MARKUP, freezerLife: MARKUP }
        : collection === 'customIngredients' ? { id: 'hardening', name: MARKUP, category: 'Vegetable',
          storageMethod: MARKUP, storageTips: MARKUP, pricePerUnit: MARKUP, unit: MARKUP,
          calories: MARKUP, protein: MARKUP, carbs: MARKUP, fat: MARKUP, fiber: MARKUP, sodium: MARKUP,
          fridgeLife: MARKUP, freezerLife: MARKUP }
        : { id: 'hardening', category: MARKUP, title: MARKUP, description: MARKUP, timeSaved: MARKUP, costSavings: MARKUP };
      await importHardening(page, { [collection]: [item] });
      const selector = collection === 'recipes' ? '#recipes-grid' : collection === 'customIngredients' ? '#storage-guide' : '#cooking-hacks';
      await assertInert(page, selector);
      await expect(page.locator(selector)).toContainText(MARKUP);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitForRestored(page, collection => AppState[collection].some(x => x.id === 'hardening'), collection);
      await assertInert(page, selector);
      const { updatedAt, ...content } = item; // existing nutrition normalization may stamp updatedAt on reload
      expect(await page.evaluate(({ collection }) => AppState[collection].find(x => x.id === 'hardening'), { collection })).toEqual(expect.objectContaining(content));
    });
  }
}

for (const [collection, card, button, modal, input] of [
  ['customIngredients', '.storage-ingredient-card', '.edit-ingredient-btn', '#ingredient-modal', '#ingredient-name'],
  ['customHacks', '.hack-item', '.hack-edit-btn', '#hack-modal', '#hack-title']
]) {
  for (const id of [7801, BAD_ID]) {
    test(`${collection} ${typeof id} id edits the correct record without execution`, async ({ page }) => {
      await loadApp(page);
      const item = collection === 'customIngredients' ? { id, name: 'Hardening ingredient', category: 'Vegetable',
        storageMethod: 'Fridge', storageTips: 'Covered', fridgeLife: 3, freezerLife: 90 }
        : { id, title: 'Hardening hack', category: 'Storage', description: 'Use a lid.' };
      await importHardening(page, { [collection]: [item] });
      await page.locator(card).last().locator(button).evaluate(el => el.click());
      await expect(page.locator(modal)).not.toHaveClass(/hidden/);
      await expect(page.locator(input)).toHaveValue(collection === 'customIngredients' ? item.name : item.title);
      expect(await page.evaluate(() => !!window.__hardeningXss)).toBe(false);
    });
  }
}

for (const category of ['constructor', '__proto__']) {
  test(`hack category ${category} stays usable`, async ({ page }) => {
    await loadApp(page);
    await importHardening(page, { customHacks: [{ id: 'hardening', title: 'Safe title', category, description: 'Synthetic note' }] });
    await expect(page.locator('#cooking-hacks')).toContainText(category);
    await expect(page.locator('.hack-item')).toHaveCount(1);
  });
}

for (const surface of ['card', 'planner', 'selection', 'nutrition', 'quick-plan', 'prep', 'batch', 'home']) {
  test(`imported recipe id stays literal in ${surface} handlers`, async ({ page }) => {
    await loadApp(page);
    await importHardening(page, { recipes: [{ ...RECIPE, id: BAD_ID, name: 'Hardening recipe',
      baseIngredients: [{ name: 'Carrot', quantity: 1, unit: 'g' }] }], weeklyPlan: { Monday: { dinner: BAD_ID } } });
    const result = await page.evaluate(({ id, surface }) => {
      const click = selector => { const el = document.querySelector(selector); if (!el) throw new Error('Missing ' + selector); el.click(); };
      if (surface === 'card') { renderRecipes(); [...document.querySelectorAll('#recipes-grid .recipe-card')].find(el => el.dataset.recipeId === id).querySelector('.recipe-fav-btn').click(); return AppState.recipes.find(r => r.id === id).favorite; }
      if (surface === 'planner') { renderWeeklyPlanner(); window.markRecipeCooked = value => { window.__hardeningArg = value; }; click('.slot-cooked-btn'); }
      if (surface === 'selection') { renderRecipeSelectionGrid(); window.selectRecipeForPlanning = value => { window.__hardeningArg = value; }; [...document.querySelectorAll('.recipe-selection-card')].find(el => el.textContent.includes('Hardening recipe')).click(); }
      if (surface === 'nutrition') { filterRecipesByNutrition(); window.addRecipeToPlanFromNutrition = value => { window.__hardeningArg = value; }; [...document.querySelectorAll('#nutrition-filtered-recipes .nutr-recipe-card')].find(el => el.textContent.includes('Hardening recipe')).querySelector('.btn--primary').click(); }
      if (surface === 'quick-plan') { addRecipeToPlanFromNutrition(id); window.confirmQuickPlan = value => { window.__hardeningArg = value; }; click('#quick-plan-picker button:last-child'); }
      if (surface === 'prep') { openPrepMode(); click('#prep-mode-body .prep-check-row'); return !!AppState.prepModeSession.checked[id + '-ing-0']; }
      if (surface === 'batch') { renderBatchPickerResults(); window.addPlannedBatch = value => { window.__hardeningArg = value; }; [...document.querySelectorAll('.batch-result')].find(el => el.textContent.includes('Hardening recipe')).querySelector('.batch-add-btn').click(); }
      if (surface === 'home') { window.getCookSuggestions = () => [{ recipe: AppState.recipes.find(r => r.id === id), icon: '', label: 'Synthetic', why: 'Test' }]; document.getElementById('dashboard').innerHTML = renderCookSuggestionCard(); window.openRecipeFromHome = value => { window.__hardeningArg = value; }; click('.dash-sugg-item'); }
      return window.__hardeningArg;
    }, { id: BAD_ID, surface });
    expect(result).toBe(['card', 'prep'].includes(surface) ? true : BAD_ID);
    expect(await page.evaluate(() => !!window.__hardeningXss)).toBe(false);
  });
}

test('planned recipe text stays inert in Plan, picker, alerts and Nutrition', async ({ page }) => {
  await loadApp(page);
  await importHardening(page, { recipes: [{ ...RECIPE, id: 'hardening', name: MARKUP, category: MARKUP, fridgeLife: 0 }],
    weeklyPlan: { Sunday: { dinner: 'hardening' } } });
  await page.evaluate(() => { renderWeeklyPlanner(); renderRecipeSelectionGrid(); renderStorageAlerts(); filterRecipesByNutrition(); });
  for (const selector of ['#meal-planner', '#recipe-selection-grid', '#storage-alerts', '#nutrition-filtered-recipes']) await assertInert(page, selector);
});

test('editing imported nested ingredient values cannot break input attributes', async ({ page }) => {
  await loadApp(page);
  const name = '\"><img src="/hardening-missing" onerror="window.__hardeningXss=true">';
  await importHardening(page, { recipes: [{ ...RECIPE, id: 'hardening', baseIngredients: [{ name, quantity: name, unit: 'g' }] }] });
  await page.evaluate(() => openEditRecipeModal('hardening'));
  await assertInert(page, '#ingredients-list');
  await expect(page.locator('#ingredients-list input[type=text]')).toHaveValue(name);
});

test('cook suggestion with backslash and quote searches literally', async ({ page }) => {
  await loadApp(page);
  const name = "\\';window.__hardeningXss=true;//";
  await importHardening(page, { recipes: [{ ...RECIPE, id: 'hardening', name }] });
  await page.evaluate(() => { window.getCookableRecipes = () => [{ recipe: AppState.recipes.find(r => r.id === 'hardening'), missing: 0 }]; renderCookSuggestions(); document.querySelector('.cs-card').click(); });
  await expect(page.locator('#recipe-search')).toHaveValue(name);
  expect(await page.evaluate(() => !!window.__hardeningXss)).toBe(false);
});

test('CSV recipe preview renders imported text inertly', async ({ page }) => {
  await loadApp(page);
  await page.evaluate(markup => openCSVPreviewModal([{ ...AppState.recipes[0], name: markup, category: markup }]), MARKUP);
  await assertInert(page, '#csv-preview-body');
  await expect(page.locator('#csv-preview-body')).toContainText(MARKUP);
});

for (const state of ['signed-out', 'offline', 'unread-cloud']) {
  test(`restore refuses ${state} before mutation and retains backup`, async ({ page }) => {
    await loadApp(page);
    await page.evaluate(state => {
      createBackup('retained recovery'); AppState.cookHistory = []; AppState.prepModeSession = null; saveData();
      if (state !== 'signed-out') AppState.currentUser = { uid: 'synthetic-recovery' };
      AppState.isOnline = state !== 'offline'; AppState.cloudReady = state !== 'unread-cloud';
    }, state);
    const before = await dataSnapshot(page);
    await page.evaluate(() => { restoreBackup(); document.querySelector('.confirm-ok-btn')?.click(); });
    expect(await dataSnapshot(page)).toEqual(before);
    await expect(page.locator('body')).toContainText('Restore requires');
  });
}

test('restore rechecks eligibility after confirmation opens', async ({ page }) => {
  await loadApp(page);
  await mockCloud(page, await page.evaluate(() => ({ ...snapshotData(), version: 1 })));
  await page.evaluate(() => { createBackup('retained recovery'); AppState.cookHistory = []; saveData(); restoreBackup(); AppState.isOnline = false; });
  const before = await dataSnapshot(page);
  await page.locator('.confirm-ok-btn').click();
  expect(await dataSnapshot(page)).toEqual(before);
  await expect(page.locator('body')).toContainText('Restore requires');
});

test('failed restore cloud confirmation retains backup and warns about sign-in loss', async ({ page }) => {
  await loadApp(page);
  await mockCloud(page, await page.evaluate(() => ({ ...snapshotData(), version: 1 })));
  const backup = await page.evaluate(() => { createBackup('retry'); AppState.cookHistory = [];
    window.firebase.runTransaction = async () => { throw new Error('Synthetic connection lost'); };
    restoreBackup(); document.querySelector('.confirm-ok-btn').click(); return localStorage.getItem(BACKUP_KEY); });
  await expect(page.locator('body')).toContainText('Restore is saved only on this device');
  expect(await page.evaluate(() => localStorage.getItem(BACKUP_KEY))).toBe(backup);
  expect(await page.evaluate(() => window.__recoveryWrites)).toEqual([]);
  expect(await page.evaluate(() => AppState.cookHistory.length)).toBe(1);
});

test('restore refuses an account change while confirmation is open', async ({ page }) => {
  await loadApp(page);
  await mockCloud(page, await page.evaluate(() => ({ ...snapshotData(), version: 1 })));
  await page.evaluate(() => { createBackup('retained recovery'); AppState.cookHistory = []; saveData(); restoreBackup(); AppState.currentUser = { uid: 'another-synthetic-account' }; });
  const before = await dataSnapshot(page);
  await page.locator('.confirm-ok-btn').click();
  expect(await dataSnapshot(page)).toEqual(before);
  await expect(page.locator('body')).toContainText('Restore requires');
});

test('offline backup survives stale-cloud sign-in and eligible restore survives cloud reload', async ({ page }) => {
  await loadApp(page);
  const backup = await page.evaluate(() => {
    AppState.prepModeSession = { active: true, recipeUsage: { recovery: 1 }, checked: {} };
    createBackup('offline retry'); AppState.cookHistory = []; AppState.prepModeSession = null;
    AppState.isOnline = false; saveData(); restoreBackup(); document.querySelector('.confirm-ok-btn')?.click();
    return localStorage.getItem(BACKUP_KEY);
  });
  expect(await page.evaluate(() => AppState.cookHistory)).toEqual([]);
  await page.evaluate(() => { AppState.isOnline = true; });
  const stale = await page.evaluate(() => ({ ...snapshotData(), cookHistory: [], prepModeSession: null, version: 1 }));
  await mockCloud(page, stale);
  expect(await page.evaluate(() => localStorage.getItem(BACKUP_KEY))).toBe(backup);
  await page.evaluate(() => { restoreBackup(); document.querySelector('.confirm-ok-btn').click(); });
  await expect.poll(() => page.evaluate(() => window.__recoveryWrites.length)).toBeGreaterThan(0);
  const restored = await page.evaluate(() => window.__recoveryCloud);
  expect(restored.cookHistory).toHaveLength(1);
  expect(restored.prepModeSession.active).toBe(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForRestored(page, () => AppState.prepModeSession?.active === true);
  await mockCloud(page, restored);
  expect(await page.evaluate(() => ({ history: AppState.cookHistory.length, session: AppState.prepModeSession?.active }))).toEqual({ history: 1, session: true });
});

for (const [label, id] of [['entity', 'x&#39;);window.__hardeningXss=true;//&quot;'], ['multiline', "line\r\n'\\\u2028\u2029end".replace(/\\r/g, '\r').replace(/\\n/g, '\n')]]) {
  test(`review ${label} recipe id survives card and prep handlers literally`, async ({ page }) => {
    await loadApp(page);
    await importHardening(page, { recipes: [{ ...RECIPE, id, name: 'Review payload', baseIngredients: [{ name: 'Carrot', quantity: 1, unit: 'g' }] }], weeklyPlan: { Monday: { dinner: id } } });
    await page.evaluate(id => [...document.querySelectorAll('#recipes-grid .recipe-card')].find(el => el.dataset.recipeId === id).querySelector('.recipe-fav-btn').click(), id);
    expect(await page.evaluate(id => AppState.recipes.find(r => r.id === id).favorite, id)).toBe(true);
    expect(await page.evaluate(id => [...document.querySelectorAll('#recipes-grid .recipe-card')].some(el => el.getAttribute('data-recipe-id') === id), id)).toBe(true);
    await page.evaluate(() => { openPrepMode(); document.querySelector('#prep-mode-body .prep-check-row').click(); });
    expect(await page.evaluate(id => AppState.prepModeSession.checked[id + '-ing-0'], id)).toBe(true);
    expect(await page.evaluate(() => !!window.__hardeningXss)).toBe(false);
  });
}

for (const surface of ['storage-alert', 'what-to-eat', 'home-buy', 'expiry-plan']) {
  test(`review ${surface} imported handler arguments stay literal`, async ({ page }) => {
    await loadApp(page);
    const missing = 'Missing\" onpointerover=\"window.__hardeningXss=true\\\'thing';
    await importHardening(page, { recipes: [{ ...RECIPE, id: BAD_ID, name: 'Review payload', fridgeLife: 0,
      baseIngredients: [{ name: missing, quantity: 1, unit: 'g' }] }], weeklyPlan: { Sunday: { dinner: BAD_ID } } });
    const result = await page.evaluate(({ id, missing, surface }) => {
      if (surface === 'storage-alert') {
        renderStorageAlerts(); window.openEditRecipeModal = value => { window.__hardeningArg = value; };
        document.querySelector('.storage-alert-recipe-link').click();
      }
      if (surface === 'what-to-eat') {
        window.getWhatShouldWeEatSuggestions = () => [{ id, kind: 'recipe', reasons: [], label: 'Synthetic', name: 'Recipe', action: { type: 'cook', label: 'Cook' } }];
        document.getElementById('dashboard').innerHTML = renderWhatShouldWeEatCard();
        window.openRecipeFromHome = value => { window.__hardeningArg = value; };
        document.querySelector('.wse-action').click();
      }
      if (surface === 'home-buy') {
        window.getCookableRecipes = () => [{ recipe: AppState.recipes.find(r => r.id === id), missing: 1, total: 1, missingIngredients: [missing] }];
        renderDashboard(); window.buyMissingIngredient = value => { window.__hardeningArg = value; };
        document.querySelector('.dash-buy-it-btn').click();
      }
      if (surface === 'expiry-plan') {
        window.getExpirySuggestions = () => [{ recipe: AppState.recipes.find(r => r.id === id), ingredient: 'Carrot' }];
        renderDashboard(); window.planRecipeForToday = value => { window.__hardeningArg = value; };
        document.querySelector('.dash-l1-block .dash-inline-btn[onclick^="planRecipeForToday"]').click();
      }
      return window.__hardeningArg;
    }, { id: BAD_ID, missing, surface });
    expect(result).toBe(surface === 'home-buy' ? missing : BAD_ID);
    expect(await page.evaluate(() => !!window.__hardeningXss)).toBe(false);
  });
}
