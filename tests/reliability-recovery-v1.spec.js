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

for (const width of [1280, 390]) {
  test(`imported grocery text stays inert at ${width}px, including category and row fields`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await loadApp(page);
    const markup = '<img src="/missing-recovery" onerror="window.__recoveryMarkup=true">';
    await chooseImport(page, { groceryList: [{ id: 781, name: markup, category: markup, unit: markup,
      quantity: 1, sources: [markup], custom: true }] });
    await acceptIfShown(page);
    await page.evaluate(() => showTab('grocery'));
    await expect(page.locator('.category-header')).toContainText(markup);
    await expect(page.locator('#grocery-list img')).toHaveCount(0);
    expect(await page.evaluate(() => !!window.__recoveryMarkup)).toBe(false);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForRestored(page, () => AppState.groceryList.some(item => item.id === 781));
    await page.evaluate(() => showTab('grocery'));
    await expect(page.locator('#grocery-list img')).toHaveCount(0);
  });
}

test('numeric and string imported grocery ids remain usable and cannot inject handlers', async ({ page }) => {
  await loadApp(page);
  const badId = "');window.__recoveryId=true;//";
  await chooseImport(page, { groceryList: [
    { id: 782, name: 'Numeric item', category: 'Other', quantity: 1, unit: 'pcs', custom: true },
    { id: badId, name: 'String item', category: 'Other', quantity: 1, unit: 'pcs', custom: true }
  ] });
  await acceptIfShown(page);
  await page.evaluate(() => showTab('grocery'));
  await page.locator('.grocery-item').filter({ hasText: 'Numeric item' }).click();
  await page.locator('.grocery-item').filter({ hasText: 'String item' }).click();
  expect(await page.evaluate(() => ({ checked: AppState.groceryList.map(item => item.checked),
    injected: !!window.__recoveryId }))).toEqual({ checked: [true, true], injected: false });
});

for (const [label, malformed] of [
  ['day snacks object', { recipes: [{ ...RECIPE, id: 'new' }], weeklyPlan: { Monday: { breakfast: 'new', snacks: {} } } }],
  ['collection object', { recipes: [{ ...RECIPE, id: 'new' }], pantry: {} }],
  ['null ingredient', { recipes: [{ ...RECIPE, id: 'new', baseIngredients: [null] }] }],
  ['non-text pantry name', { pantry: [{ id: 'invalid', name: {} }] }],
  ['non-text grocery source', { groceryList: [{ id: 783, name: 'Invalid', sources: [{}] }] }],
  ['non-object price map', { recipes: [{ ...RECIPE, id: 'new' }], ingredientPrices: [] }],
  ['review recipe highlights object', { recipes: [{ ...RECIPE, id: 'new', highlights: {} }] }],
  ['review grocery quantity string', { groceryList: [{ id: 783, name: 'Invalid', quantity: '1' }] }],
  ['review missing storage-guide text', { customIngredients: [{ id: 783 }] }],
  ['review nested price list', { recipes: [{ ...RECIPE, id: 'new' }], ingredientPrices: { Carrot: { prices: [] } } }],
  ['review reserved id', { groceryList: [{ id: '__proto__', name: 'Lost item' }] }],
  ['review inherited id', { groceryList: [{ id: 'toString', name: 'Lost item' }] }],
  ['review malformed tombstone', { recipes: [{ ...RECIPE, id: 'new' }], deletions: { pantry: { buy_recovery: {} } } }],
  ['review malformed conflict', { recipes: [{ ...RECIPE, id: 'new' }], mealConsumptionConflicts: [{ id: 'invalid' }] }],
  ['review supplied pantry quantity', { pantry: [{ id: 'buy_bad', name: 'Bad quantity', quantity: '1', unit: 'g' }] }]
]) {
  test(`rejected ${label} import leaves runtime, storage, backup and tombstones unchanged`, async ({ page }) => {
    await loadApp(page);
    await page.evaluate(() => { AppState.deletions = { recipes: { new: '2026-11-01T00:00:00.000Z' } }; saveData(); createBackup('keep'); });
    const before = await dataSnapshot(page);
    await chooseImport(page, malformed);
    await acceptIfShown(page);
    await expect.poll(() => page.evaluate(() => document.body.innerText.includes('Failed to import') ||
      document.body.innerText.includes('Import failed'))).toBe(true);
    expect(await dataSnapshot(page)).toEqual(before);
  });
}

test('review grocery category/unit remain inert in print and price views, including reserved category names', async ({ page }) => {
  await loadApp(page);
  const markup = '<img src="/missing-recovery" onerror="window.__recoveryMarkup=true">';
  await chooseImport(page, { groceryList: [
    { id: 784, name: 'Other item', category: markup, unit: markup, quantity: 1, custom: true },
    { id: 785, name: 'Prototype item', category: '__proto__', unit: 'pcs', quantity: 1, custom: true },
    { id: 786, name: 'Constructor item', category: 'constructor', unit: 'pcs', quantity: 1, custom: true }
  ] });
  await acceptIfShown(page);
  await page.evaluate(() => { showTab('grocery'); switchShopTab('prices'); });
  await expect(page.locator('#grocery-price-panel img')).toHaveCount(0);
  expect((await page.locator('.gpl-cat-label').allTextContents()).sort()).toEqual(['__proto__', 'constructor', markup].sort());
  await page.evaluate(() => { window.print = () => {}; printGroceryList(); });
  await expect(page.locator('#grocery-print-area img')).toHaveCount(0);
  await expect(page.locator('#grocery-print-area')).toContainText(markup);
  expect(await page.evaluate(() => !!window.__recoveryMarkup)).toBe(false);
});

test('review price-input handlers cannot execute imported item or store names', async ({ page }) => {
  await loadApp(page);
  const name = 'Test " autofocus onfocus="window.__recoveryMarkup=true';
  await chooseImport(page, { groceryList: [{ id: 787, name, category: 'Other', quantity: 1, unit: 'pcs', custom: true }], myStores: [name] });
  await acceptIfShown(page);
  await page.evaluate(() => { showTab('grocery'); switchShopTab('prices'); });
  await page.locator('.gpl-price-input').first().focus();
  expect(await page.evaluate(() => !!window.__recoveryMarkup)).toBe(false);
  expect(await page.locator('.gpl-price-input').first().getAttribute('onfocus')).toBe(null);
});

test('review malformed nested prep session backup is rejected atomically', async ({ page }) => {
  await loadApp(page);
  await page.evaluate(() => {
    const data = snapshotData();
    data.prepModeSession = { active: true, recipeUsage: { recovery: '<img onerror=bad>' }, checked: {} };
    localStorage.setItem(BACKUP_KEY, JSON.stringify({ data }));
  });
  const before = await dataSnapshot(page);
  await page.evaluate(() => restoreBackup());
  if (await page.locator('.confirm-ok-btn').count()) await page.locator('.confirm-ok-btn').click();
  expect(await dataSnapshot(page)).toEqual(before);
});

for (const id of ['string-shopping-id', '0);window.__recoveryId=true;//']) {
  test(`review correction dialog treats grocery id ${id} as data`, async ({ page }) => {
    await loadApp(page);
    await chooseImport(page, { groceryList: [{ id, name: 'Recovery carrot', category: 'Vegetable',
      quantity: 1, unit: 'pcs', custom: true }] });
    await acceptIfShown(page);
    await page.evaluate(id => { showTab('grocery'); openNotInKitchenDialog(id); }, id);
    await page.locator('.nik-fix-btn').click();
    expect(await page.evaluate(() => ({ pantry: AppState.pantry.length, executed: !!window.__recoveryId })))
      .toEqual({ pantry: 0, executed: false });
  });
}

test('signed-in clear and restore publish complete backup fields before cloud reload and stale-marker replay', async ({ page }) => {
  await loadApp(page);
  const original = await page.evaluate(() => {
    AppState.prepModeSession = { active: true, recipeUsage: { recovery: 1 }, checked: {} };
    saveData(); return { ...snapshotData(), version: 1 };
  });
  await mockCloud(page, original);
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.evaluate(() => {
    clearLocalStorage(); document.querySelector('.confirm-ok-btn').click();
  })]);
  await waitForRestored(page, () => AppState.recipes.length === 0);
  const cleared = await page.evaluate(() => JSON.parse(sessionStorage.getItem('recoveryCloud')));
  expect(cleared.recipes).toEqual([]);
  await mockCloud(page, cleared);
  await page.evaluate(() => { restoreBackup(); document.querySelector('.confirm-ok-btn').click(); });
  await expect.poll(() => page.evaluate(() => window.__recoveryWrites.length)).toBeGreaterThan(0);
  const restored = await page.evaluate(() => window.__recoveryCloud);
  expect(restored.cookHistory).toHaveLength(1);
  expect(restored.prepModeSession.active).toBe(true);
  expect(restored.mealConsumptions).toEqual([FACT]);
  await page.evaluate(deletions => {
    setupRealtimeListeners();
    const data = { ...window.__recoveryCloud, version: AppState.dataVersion + 10, deletions };
    window.__recoveryListener({ exists: () => true, data: () => data });
  }, cleared.deletions);
  expect(await page.evaluate(() => ({ pantry: AppState.pantry.length, meals: AppState.cookedMeals.length,
    history: AppState.cookHistory.length, session: AppState.prepModeSession.active })))
    .toEqual({ pantry: 1, meals: 1, history: 1, session: true });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForRestored(page, () => AppState.pantry.length === 1 && AppState.prepModeSession?.active === true);
});

test('partial weekly plan in an older backup restores all seven usable days', async ({ page }) => {
  await loadApp(page);
  await page.evaluate(() => {
    const data = JSON.parse(JSON.stringify(snapshotData())); data.weeklyPlan = { Monday: { dinner: 'recovery' } };
    localStorage.setItem(BACKUP_KEY, JSON.stringify({ data }));
    restoreBackup(); document.querySelector('.confirm-ok-btn').click();
  });
  const plan = await page.evaluate(() => AppState.weeklyPlan);
  expect(Object.keys(plan)).toHaveLength(7);
  expect(plan.Monday).toEqual({ breakfast: null, lunch: null, dinner: 'recovery', snacks: [] });
  expect(plan.Tuesday).toEqual({ breakfast: null, lunch: null, dinner: null, snacks: [] });
});

test('a late preparation error rejects the detached candidate without leaking changes', async ({ page }) => {
  await loadApp(page);
  await page.evaluate(() => { window.mergeWeeklyPlan = () => { throw new Error('Synthetic preparation failure'); }; });
  const before = await dataSnapshot(page);
  await chooseImport(page, { recipes: [{ ...RECIPE, id: 'new' }], weeklyPlan: { Monday: { breakfast: 'new' } } });
  await acceptIfShown(page);
  expect(await dataSnapshot(page)).toEqual(before);
});

test('a failed primary local save rejects the import without cloud writes or changed runtime', async ({ page }) => {
  await loadApp(page);
  const cloud = await page.evaluate(() => ({ ...snapshotData(), version: 1 }));
  await mockCloud(page, cloud);
  const before = await dataSnapshot(page);
  await page.evaluate(() => { const set = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) {
    if (key === STORAGE_KEY) throw new DOMException('Synthetic storage full', 'QuotaExceededError');
    return set.call(this, key, value);
  }; });
  await chooseImport(page, { recipes: [{ ...RECIPE, id: 'new' }] });
  await acceptIfShown(page);
  expect((await dataSnapshot(page)).runtime).toEqual(before.runtime);
  expect((await dataSnapshot(page)).stored).toBe(before.stored);
  expect(await page.evaluate(() => window.__recoveryWrites.length)).toBe(0);
});

for (const version of ['1.1', '1.2', '1.3', '1.4', '1.5', '1.6']) {
  test(`legacy ${version} partial export still merges, preserves unknown recipe fields and local duplicates`, async ({ page }) => {
    await loadApp(page);
    await chooseImport(page, { version, recipes: [{ ...RECIPE, name: 'Duplicate loses' },
      { id: 'legacy', name: 'Legacy', baseIngredients: [], futureField: { keep: true } }],
      weeklyPlan: { Monday: { dinner: 'legacy' } } });
    await acceptIfShown(page);
    await expect.poll(() => page.evaluate(() => AppState.recipes.length)).toBe(2);
    expect(await page.evaluate(() => ({ first: AppState.recipes.find(r => r.id === 'recovery').name,
      future: AppState.recipes.find(r => r.id === 'legacy').futureField, dinner: AppState.weeklyPlan.Monday.dinner })))
      .toEqual({ first: RECIPE.name, future: { keep: true }, dinner: 'legacy' });
  });
}

test('backup includes every saved domain field, including cook history and prep session', async ({ page }) => {
  await loadApp(page);
  const result = await page.evaluate(() => {
    AppState.prepModeSession = { active: true, recipeUsage: { recovery: 1 }, checked: {} };
    saveData(); createBackup('complete');
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const backup = JSON.parse(localStorage.getItem(BACKUP_KEY)).data;
    return { missing: Object.keys(stored).filter(key => !['version', 'lastSaved'].includes(key) && !(key in backup)),
      history: backup.cookHistory, session: backup.prepModeSession };
  });
  expect(result.missing).toEqual([]);
  expect(result.history).toHaveLength(1);
  expect(result.session.active).toBe(true);
});

test('clear, reload and restore recover history/session, retain facts and survive cloud reconciliation', async ({ page }) => {
  await loadApp(page);
  await page.evaluate(() => {
    AppState.prepModeSession = { active: true, recipeUsage: { recovery: 1 }, checked: {} };
    saveData(); clearLocalStorage(); document.querySelector('.confirm-ok-btn').click();
  });
  await page.waitForLoadState('domcontentloaded');
  await waitForRestored(page, () => AppState.recipes.length === 0);
  await page.evaluate(() => {
    AppState.deletions.customHacks = { buy_recovery: '2026-11-01T00:00:00.000Z' };
    reconcileMealConsumptions([{ id: 'mc_after_backup', cookedMealId: 'cm_recovery', recipeId: 'recovery',
      mealName: 'Recovery bowls', portionsConsumed: 1, consumedAt: '2026-11-06T01:00:00.000Z' }]);
    restoreBackup(); document.querySelector('.confirm-ok-btn').click();
  });
  expect(await page.evaluate(() => ({ pantry: AppState.pantry.length, history: AppState.cookHistory.length,
    session: AppState.prepModeSession?.active, facts: AppState.mealConsumptions.length,
    tomb: readTombstone('pantry', 'buy_recovery'), unrelated: readTombstone('customHacks', 'buy_recovery') })))
    .toEqual({ pantry: 1, history: 1, session: true, facts: 2, tomb: null, unrelated: '2026-11-01T00:00:00.000Z' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForRestored(page, () => AppState.pantry.length === 1 && AppState.prepModeSession?.active === true);
  const cloud = await page.evaluate(() => ({ ...snapshotData(), version: 10 }));
  await mockCloud(page, cloud);
  expect(await page.evaluate(() => ({ pantry: AppState.pantry.length, facts: AppState.mealConsumptions.length })))
    .toEqual({ pantry: 1, facts: 2 });
});

test('restore clears only restored ids, and stale conflict markers lose while later deletions win', async ({ page }) => {
  await loadApp(page);
  const cloud = await page.evaluate(() => ({ ...snapshotData(), version: 1 }));
  await mockCloud(page, cloud);
  await page.evaluate(() => {
    createBackup('revive');
    AppState.pantry = [];
    AppState.deletions = { pantry: { buy_recovery: '2026-06-01T00:00:00.000Z', unrelated: '2026-06-01T00:00:00.000Z' } };
    window.__recoveryCloud = { ...window.__recoveryCloud, version: 2, pantry: [], deletions: AppState.deletions };
    restoreBackup(); document.querySelector('.confirm-ok-btn').click();
  });
  await expect.poll(() => page.evaluate(() => window.__recoveryWrites.length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.__recoveryCloud.pantry.map(p => p.id))).toEqual(['buy_recovery']);
  expect(await page.evaluate(() => readTombstone('pantry', 'unrelated'))).toBe('2026-06-01T00:00:00.000Z');
  await page.evaluate(() => {
    setupRealtimeListeners();
    const newer = JSON.parse(JSON.stringify(window.__recoveryCloud));
    newer.version += 10;
    newer.deletions.pantry.buy_recovery = new Date(Date.now() + 60000).toISOString();
    window.__recoveryListener({ exists: () => true, data: () => newer });
  });
  expect(await page.evaluate(() => AppState.pantry.length)).toBe(0);
});

test('older backups without history/session keep supported defaults and recover records', async ({ page }) => {
  await loadApp(page);
  await page.evaluate(() => {
    const old = JSON.parse(JSON.stringify(snapshotData())); delete old.cookHistory; delete old.prepModeSession;
    localStorage.setItem(BACKUP_KEY, JSON.stringify({ label: 'legacy', data: old }));
    AppState.cookHistory = []; AppState.prepModeSession = null; AppState.pantry = [];
    restoreBackup(); document.querySelector('.confirm-ok-btn').click();
  });
  expect(await page.evaluate(() => ({ history: AppState.cookHistory, session: AppState.prepModeSession,
    pantry: AppState.pantry.length }))).toEqual({ history: [], session: null, pantry: 1 });
});

test('malformed backup is refused without changing current data', async ({ page }) => {
  await loadApp(page);
  await page.evaluate(() => localStorage.setItem(BACKUP_KEY, JSON.stringify({ label: 'bad', data: { recipes: {} } })));
  const before = await dataSnapshot(page);
  await page.evaluate(() => restoreBackup());
  if (await page.locator('.confirm-ok-btn').count()) await page.locator('.confirm-ok-btn').click();
  expect(await dataSnapshot(page)).toEqual(before);
});

for (const action of ['clear', 'import']) {
  test(`failed backup prevents ${action} from changing user data`, async ({ page }) => {
    await loadApp(page);
    const before = await dataSnapshot(page);
    await page.evaluate(() => { const set = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) {
      if (key === BACKUP_KEY) throw new DOMException('Synthetic backup full', 'QuotaExceededError');
      return set.call(this, key, value);
    }; });
    if (action === 'clear') await page.evaluate(() => clearLocalStorage());
    else await chooseImport(page, { recipes: [{ ...RECIPE, id: 'new' }] });
    await page.locator('.confirm-ok-btn').click();
    expect(await dataSnapshot(page)).toEqual(before);
  });
}
