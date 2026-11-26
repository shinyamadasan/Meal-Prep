const { test, expect } = require('@playwright/test');
const { waitForAppReady } = require('./app-ready');

const today = '2026-11-26';
const lot = (id, name, fields = {}) => ({
  id, name, category: 'Protein', storage: 'fridge', quantity: 1, unit: 'pcs',
  shelfLifeDays: 10, staple: false, ...fields
});
const ingredient = (name, baseQuantity = 1, unit = 'pack', category = 'Pantry') => ({ name, baseQuantity, unit, category });
const recipe = (id, name, ...baseIngredients) => ({
  id, name, category: 'Main Dish', baseServings: 2, currentServings: 2,
  basePrepTime: 5, baseCookTime: 10, effort: 'very-low', baseIngredients
});
const row = (name, quantity = null, unit = '', fields = {}) => ({
  id: 'manual-' + name, name, quantity, unit, category: 'Other', checked: false, custom: true, ...fields
});
const carrot = lot('carrot', 'Carrot', { category: 'Vegetable' });
const blueberry = ingredient('Blueberries', 1, 'pack', 'Fruit');
const attention = page => page.locator('#dash-attention');
const groceryRows = page => page.locator('#grocery-list .grocery-item');
const pantryRow = (page, name) => page.locator('.pi-row').filter({ hasText: name });
const shop = page => page.locator('.tab-btn[data-tab="grocery"]').click();

test.beforeEach(async ({ page, baseURL }) => {
  await page.route('**/*', route => route.request().url().startsWith(baseURL + '/') ? route.continue() : route.abort());
  await page.clock.setFixedTime(new Date(2026, 10, 26, 12));
  await page.addInitScript(() => {
    ['mealPrepHelpSeen', 'mealPrepStartDone', 'pantryOnboardingDone'].forEach(key => localStorage.setItem(key, '1'));
  });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
});

async function seed(page, state) {
  await page.evaluate(state => {
    Object.assign(AppState, {
      pantry: [], cookedMeals: [], recipes: [], groceryList: [], plannedBatches: [], weeklyPlan: {},
      deletions: normalizeDeletions({})
    }, state);
    snapshotIdBaseline();
    showTab('dashboard');
    refreshFreshnessAlerts();
  }, state);
}

async function addManual(page, name, quantity, unit) {
  await page.locator('#add-custom-item').click();
  const modal = page.locator('#custom-item-modal');
  await modal.locator('#custom-item-name').fill(name);
  await modal.locator('#custom-item-qty').fill(String(quantity));
  await modal.locator('#custom-item-unit').fill(unit);
  await modal.getByRole('button', { name: 'Add to List' }).click();
}

test('fridge safety blocks Cook Now before and after Keep, including for a staple', async ({ page }) => {
  const chicken = lot('chicken', 'Chicken Breast', { purchaseDate: '2026-11-23' });
  await seed(page, {
    pantry: [chicken, carrot],
    recipes: [recipe('skillet', 'Carrot skillet', ingredient(chicken.name), ingredient(carrot.name))]
  });
  await page.locator('#dash-ideas > summary').click();
  const cookRow = page.locator('.dash-cook-row').filter({ hasText: 'Carrot skillet' });
  await expect(cookRow).toContainText('Missing 1');
  await expect(cookRow.getByRole('button', { name: 'Buy Chicken Breast' })).toBeVisible();
  await attention(page).getByRole('button', { name: 'Review' }).click();
  const expiredRow = attention(page).locator('.dash-attn-row--expired');
  await expect(expiredRow).toContainText('Past safe fridge time - do not use (poultry, 2-day limit)');
  await expect(attention(page).getByRole('button', { name: /Remove expired/ })).toHaveCount(0);
  await expiredRow.getByRole('button', { name: 'Keep' }).click();
  await expect(expiredRow).toHaveCount(0);
  await expect(cookRow).toContainText('Missing 1');
  expect(await page.evaluate(() => {
    const chicken = AppState.pantry[0];
    return {
      keptOn: chicken.keptOn,
      available: pantryLotAvailable({ ...chicken, staple: true, stockLevel: 'full', keptOn: todayISO() }),
      missing: getCookableRecipes()[0].missingIngredients,
      suggested: getExpirySuggestions().some(suggestion => suggestion.ingredient === chicken.name)
    };
  })).toEqual({ keptOn: today, available: false, missing: ['Chicken Breast'], suggested: false });
});

test('ordered safety rules honor food-specific boundaries, aliases, shorter DB limits and the printed date', async ({ page }) => {
  const cases = [
    ['Ground Pork', '2026-11-23', 'ground', 2, 'past-limit'],
    ['Hamburger', '2026-11-23', 'ground', 2, 'past-limit'],
    ['Beef stew meat', '2026-11-23', 'ground', 2, 'past-limit'],
    ['Bangus', '2026-11-23', 'seafood', 2, 'past-limit'],
    ['Alimasag', '2026-11-24', 'seafood', 1, 'past-limit'],
    ['Liver', '2026-11-24', 'variety', 1, 'past-limit'],
    ['Pork chop', '2026-11-23', 'whole-cut', 3, null],
    ['Pork chop', '2026-11-22', 'whole-cut', 3, 'past-limit'],
    ['Sausage', '2026-11-23', 'raw-sausage', 2, 'past-limit'],
    ['Longganisa', '2026-11-23', 'raw-sausage', 2, 'past-limit'],
    ['Smoked links', '2026-11-18', 'cured-processed', 7, 'past-limit'],
    ['Bacon', '2026-11-19', 'cured-processed', 7, null],
    ['Hot dogs', '2026-11-18', 'cured-processed', 7, 'past-limit'],
    ['Ham', '2026-11-22', 'cured-processed', 3, 'past-limit'],
    ['Chicken adobo', '2026-11-21', 'cooked-leftover', 4, 'past-limit'],
    ['Duck', '2026-11-23', 'poultry', 2, 'past-limit', { storage: 'counter' }]
  ];
  const pantry = cases.map(([name, purchaseDate, , , , fields], i) => lot(String(i), name, { purchaseDate, ...fields }));
  const results = await page.evaluate(pantry => pantry.map(p => {
    const signal = pantryDateSignal(p);
    return [signal.safetyClass, signal.limitDays, signal.safety ?? null, pantryLotAvailable(p), signal.kind];
  }), pantry);
  expect(results).toEqual(cases.map(([, , safetyClass, limit, safety]) =>
    [safetyClass, limit, safety, !safety, safety ? 'expired' : null]));

  const printed = { dateMode: 'expiry', expiryDate: '2026-11-25', purchaseDate: today, staple: true };
  expect(await page.evaluate(p => ({ signal: pantryDateSignal(p), available: pantryLotAvailable(p) }),
    lot('printed', 'Chicken Breast', printed))).toMatchObject({ signal: { kind: 'expired', daysLeft: -1 }, available: false });
  expect(await page.evaluate(p => pantryDateSignal(p), lot('printed-late', 'Chicken Breast', {
    ...printed, expiryDate: '2026-12-01', purchaseDate: '2026-11-23'
  }))).toMatchObject({ safety: 'past-limit', kind: 'expired', daysLeft: -1 });
});

test('unknown bought dates block use until corrected, and thawing preserves the bought date', async ({ page }) => {
  await seed(page, { pantry: [lot('chicken', 'Chicken Breast')] });
  await page.locator('.tab-btn[data-tab="fridge"]').click();
  const chicken = pantryRow(page, 'Chicken Breast');
  await expect(chicken).toContainText('No bought date - add it before use');
  expect(await page.evaluate(() => pantryLotAvailable(AppState.pantry[0]))).toBe(false);
  await chicken.click();
  const panel = page.locator('#piexp-chicken');
  await expect(panel).toContainText('Frozen until recently? Set its bought date to the day it went in the fridge.');
  await panel.locator('.pt-date').fill(today);
  expect(await page.evaluate(() => pantryLotAvailable(AppState.pantry[0]))).toBe(true);
  expect(await page.evaluate(() => pantryDateSignal({ ...AppState.pantry[0], purchaseDate: '2026-11-31' }).safety)).toBe('unknown-date');

  const thawed = await page.evaluate(() => {
    const p = AppState.pantry[0];
    p.purchaseDate = '2026-05-10';
    p.storage = 'freezer';
    const frozenSignal = pantryDateSignal(p);
    setPantryStorage(p.id, 'fridge');
    return { frozenSignal, purchaseDate: p.purchaseDate, thawedSignal: pantryDateSignal(p) };
  });
  expect(thawed.frozenSignal.kind).toBeNull();
  expect(thawed.purchaseDate).toBe('2026-05-10');
  expect(thawed.thawedSignal.safety).toBe('past-limit');
});

test('freezer, eggs, plant proteins, preserved foods and produce retain their date signals', async ({ page }) => {
  const aged = { purchaseDate: '2026-05-10' };
  const pantry = [
    lot('frozen', 'Frozen Chicken', { ...aged, storage: 'freezer' }),
    lot('egg', 'Eggs', { purchaseDate: '2026-10-17', shelfLifeDays: 35 }),
    lot('tofu', 'Tofu', aged),
    lot('tuna', 'Canned Tuna', { ...aged, storage: 'counter' }),
    lot('beans', 'Canned Beans', { ...aged, storage: 'counter' }),
    lot('spinach', 'Spinach', { ...aged, category: 'Vegetable' }),
    lot('dried', 'Dried Fish', { ...aged, storage: 'counter' }),
    lot('powder', 'Chicken Powder', { ...aged, storage: 'counter' })
  ];
  expect(await page.evaluate(pantry => pantry.map(p => {
    const signal = pantryDateSignal(p);
    return [signal.kind, signal.safety ?? null, pantryLotAvailable(p)];
  }), pantry)).toEqual([null, 'check', 'check', null, null, 'check', null, null].map(kind => [kind, null, true]));
});

test('safety lots stay out of bulk removal and an individual Remove tombstones only that lot', async ({ page }) => {
  await seed(page, { pantry: [
    lot('past', 'Chicken Breast', { purchaseDate: '2026-11-23', updatedAt: today }),
    lot('unknown', 'Ground Pork', { dateMode: 'expiry', expiryDate: '2026-11-25' }),
    lot('printed', 'Printed carrots', { category: 'Vegetable', dateMode: 'expiry', expiryDate: '2026-11-25' })
  ] });
  const sets = await page.evaluate(() => {
    const [past, unknown] = AppState.pantry;
    const before = pantryDateSignal(past);
    stampUpdated(past);
    confirmExpiredRemoval('Invalid selection', [attentionEntry('pantry', unknown)], () => {});
    togglePantrySelectMode();
    togglePantrySelected(past.id);
    deleteSelectedPantryItems();
    exitPantrySelectMode();
    return { before, after: pantryDateSignal(past), bulk: getExpiredPantryItems().map(p => p.id),
      ids: AppState.pantry.map(p => p.id), dialog: !!document.querySelector('.confirm-expired-list') };
  });
  expect(sets.before).toMatchObject({ safety: 'past-limit', daysLeft: -1 });
  expect(sets.after).toEqual(sets.before);
  expect(sets.bulk).toEqual(['printed']);
  expect(sets.ids).toEqual(['past', 'unknown', 'printed']);
  expect(sets.dialog).toBe(false);

  await attention(page).getByRole('button', { name: 'Review' }).click();
  await attention(page).getByRole('button', { name: 'Remove expired (1)' }).click();
  const dialog = page.locator('.confirm-dialog');
  await expect(dialog.getByRole('listitem')).toHaveText('Printed carrots — 2026-11-25');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await page.locator('.tab-btn[data-tab="fridge"]').click();
  await page.getByRole('button', { name: 'Clear expired', exact: true }).click();
  await expect(dialog.getByRole('listitem')).toHaveText('Printed carrots — 2026-11-25');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await pantryRow(page, 'Chicken Breast').click();
  await page.locator('#piexp-past').getByRole('button', { name: 'Remove', exact: true }).click();
  expect(await page.evaluate(() => ({ ids: AppState.pantry.map(p => p.id), deleted: Object.keys(AppState.deletions.pantry) })))
    .toEqual({ ids: ['unknown', 'printed'], deleted: ['past'] });
});

test('cooked fridge batches use the four-day cap and default while freezer signals are unchanged', async ({ page }) => {
  const meal = (id, fields = {}) => ({ id, name: 'Batch ' + id, storage: 'fridge', cookedDate: '2026-11-21', ...fields });
  await seed(page, { cookedMeals: [meal('long', { fridgeLife: 7 }), meal('missing'),
    meal('freezer', { storage: 'freezer', fridgeLife: 7, freezerLife: 90 }),
    meal('freezer-old', { storage: 'freezer', freezerLife: 3 }),
    meal('freezer-unknown', { storage: 'freezer' })] });
  expect(await page.evaluate(() => ({
    signals: AppState.cookedMeals.map(cookedDateSignal), ready: getReadyFoodSuggestions().map(meal => meal.id)
  }))).toEqual({ signals: [
    { kind: 'expired', daysLeft: -1 }, { kind: 'expired', daysLeft: -1 }, { kind: null, daysLeft: 85 },
    { kind: 'check', daysLeft: -2 }, { kind: null, daysLeft: null }
  ], ready: ['freezer', 'freezer-unknown'] });
});

test('a null manual amount absorbs the plan once and round-trips through plan saves', async ({ page }) => {
  await seed(page, {
    groceryList: [row('Frozen Blueberries')], recipes: [recipe('berries', 'Berry bowl', blueberry)]
  });
  const states = await page.evaluate(() => {
    addPlannedBatch('berries');
    const initial = structuredClone(AppState.groceryList);
    for (let i = 0; i < 3; i++) generateGroceryList();
    return { initial, final: AppState.groceryList, saved: JSON.parse(localStorage.getItem('mealPrepAppData')).groceryList,
      cloud: buildFirestorePayload().groceryList };
  });
  expect(states.initial).toEqual([row('Frozen Blueberries', null, '', {
    plannedNeed: { quantity: 1, unit: 'pack', sources: ['Berry bowl (2 servings)'] }
  })]);
  expect(states.final).toEqual(states.initial);
  expect(states.saved).toEqual(states.initial);
  expect(states.cloud).toEqual(states.initial);
  await shop(page);
  await expect(groceryRows(page)).toHaveCount(1);
  await expect(groceryRows(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(groceryRows(page)).toContainText('1 pack Frozen Blueberries');
  await expect(groceryRows(page).locator('.grocery-item-source')).toContainText('Added by you, Berry bowl (2 servings)');
  await page.evaluate(() => { AppState.plannedBatches = []; generateGroceryList(); });
  expect(await page.evaluate(() => AppState.groceryList)).toEqual([row('Frozen Blueberries')]);
});

test('manual additions merge compatible amounts and the merged purchase reaches the pantry once', async ({ page }) => {
  await seed(page, {
    pantry: [lot('berries', 'Blueberries', { category: 'Fruit', quantity: 4, unit: 'cup' })],
    recipes: [recipe('bowl', 'Berry bowl', ingredient('Blueberries', 1, 'cup', 'Fruit'))]
  });
  await page.evaluate(() => addPlannedBatch('bowl'));
  await shop(page);
  await addManual(page, 'Blueberries', 2, 'cup');
  await expect(page.locator('.success-message')).toContainText('merged');
  await expect(groceryRows(page)).toHaveCount(1);
  await expect(groceryRows(page)).toContainText('3 cup Blueberries');
  await page.evaluate(() => generateGroceryList());
  await expect(groceryRows(page)).toContainText('3 cup Blueberries');
  await groceryRows(page).click();
  expect(await page.evaluate(() => ({
    quantity: AppState.pantry[0].quantity, count: AppState.pantry.length,
    checked: AppState.groceryList[0].checked, receipt: AppState.groceryList[0].stocked
  }))).toEqual({ quantity: 7, count: 1, checked: true, receipt: { mode: 'merge', pantryId: 'berries', prevQty: 4 } });
  await groceryRows(page).click();
  expect(await page.evaluate(() => AppState.pantry[0].quantity)).toBe(4);
});

test('different units stay separate with visible notes and checked custom rows stay separate', async ({ page }) => {
  const base = recipe('bowl', 'Berry bowl', ingredient('Blueberries', 1, 'cup', 'Fruit'));
  await seed(page, { groceryList: [row('Frozen Blueberries', 200, 'g')], recipes: [base] });
  await page.evaluate(() => addPlannedBatch('bowl'));
  await shop(page);
  await expect(groceryRows(page)).toHaveCount(2);
  await expect(groceryRows(page).filter({ hasText: '200 g Frozen Blueberries' }))
    .toContainText('Also on your list as Blueberries (1 cup) - check the amount');
  await expect(groceryRows(page).filter({ hasText: '1 cup Blueberries' }))
    .toContainText('Also on your list as Frozen Blueberries (200 g) - check the amount');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const note of await page.getByText('Also on your list as', { exact: false }).all()) await expect(note).toBeVisible();

  await seed(page, { recipes: [base, recipe('smoothie', 'Berry smoothie', ingredient('Blueberries', 150, 'g', 'Fruit'))],
    groceryList: [row('Frozen Blueberries', 2, 'cup', { checked: true })] });
  const results = await page.evaluate(() => {
    addPlannedBatch('bowl');
    addPlannedBatch('smoothie');
    const cup = AppState.groceryList.find(item => !item.custom && item.unit === 'cup');
    cup.checked = true;
    cup.userSet = true;
    generateGroceryList();
    return AppState.groceryList.map(item => [item.quantity, item.unit, item.checked, item.plannedNeed ?? null]);
  });
  expect(results).toEqual([[2, 'cup', true, null], [1, 'cup', true, null], [150, 'g', false, null]]);
});

test('Cook Now and Fill the gaps consolidate with plans and retain ingredient identity guards', async ({ page }) => {
  await seed(page, { pantry: [carrot], recipes: [recipe('soup', 'Carrot soup', ingredient('Bay Leaves'), ingredient('Carrot'))] });
  await page.locator('#dash-ideas > summary').click();
  await page.getByRole('button', { name: 'Buy Bay Leaves' }).click();
  await page.evaluate(() => addPlannedBatch('soup'));
  await shop(page);
  const bay = page.getByRole('button', { name: 'Bay Leaves', exact: true });
  await expect(bay).toHaveCount(1);
  await expect(bay).toContainText('Cook Now, Carrot soup (2 servings)');

  await seed(page, { recipes: [recipe('berries', 'Berry bowl', blueberry)],
    groceryList: [row('Rice'), row('Milk')] });
  await shop(page);
  await page.locator('#no-plan-grocery summary').click();
  const chip = page.locator('#no-plan-grocery').getByRole('button', { name: 'Frozen Blueberries', exact: true });
  await chip.evaluate(button => { window.clickGapsChip = button.onclick; });
  await page.evaluate(() => {
    addPlannedBatch('berries');
    window.clickGapsChip();
  });
  await expect(page.locator('.success-message')).toHaveText('Frozen Blueberries is already on your grocery list.');
  await addManual(page, 'Rice vinegar', 1, 'cup');
  await addManual(page, 'Evaporated milk', 1, 'can');
  expect(await page.evaluate(() => AppState.groceryList.map(item => item.name).sort()))
    .toEqual(['Blueberries', 'Evaporated milk', 'Milk', 'Rice', 'Rice vinegar']);
});

test('Low, Empty, dismissed and manually listed staples reconcile without Shop-open saves', async ({ page }) => {
  const staple = (id, name, stockLevel, fields = {}) => lot(id, name, {
    category: 'Pantry', storage: 'counter', staple: true, stockLevel, quantity: null, ...fields
  });
  await seed(page, {
    pantry: [staple('salt', 'Salt', 'low'), staple('oil', 'Oil', 'empty'), staple('more-salt', 'Salt', 'full'),
      staple('soy', 'Soy Sauce', 'low', { suggestDismissed: true }),
      staple('fish-sauce', 'Fish Sauce (Patis)', 'low'),
      staple('pepper', 'Pepper', 'empty', { suggestDismissed: true })],
    groceryList: [row('Patis')]
  });
  const results = await page.evaluate(() => {
    const first = checkAndReplenishLowStock();
    const stable = structuredClone(AppState.groceryList);
    const second = checkAndReplenishLowStock();
    let saves = 0;
    const original = saveData;
    saveData = () => { saves++; };
    try {
      showTab('grocery');
      showTab('grocery');
    } finally {
      saveData = original;
    }
    return { first, second, saves, stable: JSON.stringify(stable) === JSON.stringify(AppState.groceryList),
      names: AppState.groceryList.map(item => [item.name, item.sources?.[0] ?? null]) };
  });
  expect(results).toEqual({ first: true, second: false, saves: 0, stable: true,
    names: [['Patis', null], ['Salt', 'Running low'], ['Oil', 'Out']] });
  await expect(groceryRows(page).filter({ hasText: 'Oil' })).toContainText('From: Out');
  await expect(groceryRows(page).filter({ hasText: 'Patis' })).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => {
    AppState.pantry[0].stockLevel = 'empty';
    const changed = checkAndReplenishLowStock();
    return [changed, checkAndReplenishLowStock(), AppState.groceryList.find(item => item.name === 'Salt').sources[0]];
  })).toEqual([true, false, 'Out']);
});
