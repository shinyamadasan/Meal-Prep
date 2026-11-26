const fs = require('node:fs/promises');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { waitForAppReady } = require('./app-ready');

const today = '2026-11-26';
const yesterday = '2026-11-25';
const aged = { purchaseDate: '2026-11-16', shelfLifeDays: 5 };
const printed = { dateMode: 'expiry', expiryDate: yesterday };
const lot = (id, name, fields = {}) => ({
  id, name, category: 'Vegetable', storage: 'fridge', quantity: 100, unit: 'g', staple: false, ...fields
});
const spinach = lot('spinach', 'Spinach', aged);
const chicken = lot('frozen', 'Frozen chicken', {
  category: 'Protein', storage: 'freezer', purchaseDate: '2026-10-17', shelfLifeDays: 2
});
const tuna = lot('tuna', 'Canned tuna', {
  category: 'Protein', storage: 'counter', purchaseDate: '2026-10-27', shelfLifeDays: 2
});
const bestBefore = lot('quality', 'Printed green beans', { ...printed, printedDateKind: 'best-before' });
const useBy = lot('safety', 'Use-by <chard>', { ...printed, printedDateKind: 'use-by' });
const legacy = lot('legacy', 'Legacy leeks', printed);
const carrot = lot('carrot', 'Carrot');
const cooked = { id: 'safety', name: 'Fridge stew', storage: 'fridge', cookedDate: '2026-11-20', fridgeLife: 4 };
const frozen = { id: 'frozen-soup', name: 'Frozen soup', storage: 'freezer', cookedDate: '2026-08-01', freezerLife: 90 };
const recipe = (id, name, ingredient) => ({
  id, name, category: 'Main Dish', baseServings: 2, currentServings: 2,
  basePrepTime: 5, baseCookTime: 10, effort: 'very-low',
  baseIngredients: [ingredient, 'Carrot'].map(name => ({ name, baseQuantity: 100, unit: 'g' }))
});
const spinachRecipe = recipe('r-spinach', 'Spinach carrot skillet', 'Spinach');
const attention = page => page.locator('#dash-attention');
const cookRow = (page, dish) => page.locator('.dash-cook-row').filter({ hasText: dish.name });
const confirmDialog = page => page.locator('.confirm-dialog');
const inventory = page => page.evaluate(() => ({
  pantry: AppState.pantry, cookedMeals: AppState.cookedMeals, deletions: AppState.deletions
}));

async function seed(page, state) {
  return page.evaluate(state => {
    Object.assign(AppState, { pantry: [], cookedMeals: [], recipes: [], groceryList: [], deletions: normalizeDeletions({}) }, state);
    snapshotIdBaseline();
    const before = structuredClone(AppState);
    showTab('dashboard');
    refreshFreshnessAlerts();
    return before;
  }, state);
}

async function openAttention(page) {
  await attention(page).getByRole('button', { name: 'Review' }).click();
}

test.beforeEach(async ({ page, baseURL }) => {
  await page.route('**/*', route => route.request().url().startsWith(baseURL + '/')
    ? route.continue() : route.abort());
  await page.clock.setFixedTime(new Date(2026, 10, 26, 12));
  await page.addInitScript(() => {
    ['mealPrepHelpSeen', 'mealPrepStartDone', 'pantryOnboardingDone']
      .forEach(key => localStorage.setItem(key, '1'));
  });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
});

test('Home and Fridge distinguish printed expiry, checks and aged freezer or pantry stock', async ({ page }) => {
  const pantry = [chicken, tuna, spinach, bestBefore, useBy, legacy, carrot,
    lot('invalid', 'Invalid printed date', { ...printed, expiryDate: '2026-09-31' }),
    lot('stale', 'Olive oil', { storage: 'counter', updatedAt: '2025-11-01' })];
  const groceryList = [chicken, tuna, bestBefore, useBy, legacy].map(p => ({
    id: 'shop-' + p.id, name: p.name, category: p.category, checked: false, custom: true
  }));
  const before = await seed(page, { pantry, cookedMeals: [cooked, frozen], groceryList });
  await expect(attention(page).locator('.dash-attn-summary')).toHaveText('3 expired · 3 to check');
  await openAttention(page);
  await expect(attention(page).locator('.dash-attn-row--expired .dash-attn-name'))
    .toHaveText(['Fridge stew', 'Use-by <chard>', 'Legacy leeks']);
  await expect(attention(page).locator('.dash-attn-row--check .dash-attn-name'))
    .toHaveText(['Frozen soup', 'Spinach', 'Printed green beans']);
  await expect(attention(page).getByText('Best before passed — check it')).toBeVisible();
  await expect(attention(page).getByText('Estimated window passed — check it')).toBeVisible();
  await expect(page.locator('#freshness-alert-banner')).toContainText('3 expired');

  await page.locator('.tab-btn[data-tab="fridge"]').click();
  const fridgeRow = name => page.locator('.pi-row').filter({ hasText: name });
  await expect(fridgeRow(spinach.name)).toContainText('Estimated window passed — check it');
  await expect(fridgeRow(bestBefore.name)).toContainText('Best before passed — check it');
  await expect(fridgeRow(chicken.name).locator('.pi-date')).toContainText('Best by');
  await page.locator('.tab-btn[data-tab="grocery"]').click();
  for (const [p, available] of [[chicken, true], [tuna, true], [bestBefore, true], [useBy, false], [legacy, false]]) {
    await expect(page.locator('#grocery-list .grocery-item').filter({ hasText: p.name }))
      .toHaveAttribute('aria-pressed', String(available));
  }
  expect(await page.evaluate(() => AppState)).toEqual(before);
});

test('Cook Now needs a check only when all matching lots need one, until Still good today', async ({ page }) => {
  const beansRecipe = recipe('r-beans', 'Bean carrot skillet', bestBefore.name);
  const chardRecipe = recipe('r-chard', 'Chard carrot skillet', useBy.name);
  await seed(page, {
    pantry: [spinach, bestBefore, useBy, carrot, lot('new-beans', bestBefore.name)],
    recipes: [spinachRecipe, beansRecipe, chardRecipe]
  });
  const row = cookRow(page, spinachRecipe);
  await expect(row).toContainText('check Spinach first');
  await expect(row).not.toContainText('All ingredients');
  await expect(page.locator('.dash-cook-tier--ready').getByText(spinachRecipe.name)).toHaveCount(0);
  await expect(cookRow(page, beansRecipe)).toContainText('All ingredients ✓');
  await expect(cookRow(page, chardRecipe)).toContainText('Missing 1');
  expect(await page.evaluate(() => getExpirySuggestions().map(s => s.recipe.id))).not.toContain(chardRecipe.id);

  await openAttention(page);
  const checkRow = attention(page).locator('.dash-attn-row--check').filter({ hasText: spinach.name });
  await expect(checkRow.getByRole('button', { name: 'Toss' })).toBeVisible();
  const before = await inventory(page);
  const now = await page.evaluate(() => new Date().toISOString());
  await checkRow.getByRole('button', { name: 'Still good' }).click();
  await expect(checkRow).toHaveCount(0);
  await expect(row).toContainText('All ingredients ✓');
  expect(await inventory(page)).toEqual({
    ...before, pantry: before.pantry.map(p => p.id === spinach.id ? { ...p, keptOn: today, updatedAt: now } : p)
  });
  await attention(page).locator('.dash-attn-row--check').filter({ hasText: bestBefore.name })
    .getByRole('button', { name: 'Toss' }).click();
  const afterToss = await inventory(page);
  expect(afterToss.pantry.map(p => p.id)).toEqual(['spinach', 'safety', 'carrot', 'new-beans']);
  expect(Object.keys(afterToss.deletions.pantry)).toEqual(['quality']);
  await page.clock.setFixedTime(new Date(2026, 10, 27, 12));
  await page.evaluate(() => renderDashboard());
  await expect(checkRow).toBeVisible();
  await expect(row).toContainText('check Spinach first');
  expect(await inventory(page)).toEqual(afterToss);
});

for (const source of ['Home', 'Fridge']) {
  test(`${source} bulk removal confirms the exact named list and tombstones only that list`, async ({ page }) => {
    const extra = Array.from({ length: 8 }, (_, i) => lot('x-' + i, 'Expired lot ' + (i + 1), printed));
    const kept = lot('kept', 'Kept radish', { ...printed, keptOn: today });
    const soon = lot('soon', 'Use soon greens', { ...printed, expiryDate: '2026-11-27' });
    const remainder = [spinach, bestBefore, chicken, tuna, kept, soon];
    await seed(page, { pantry: [...remainder, useBy, legacy, ...extra], cookedMeals: [cooked, frozen] });
    const bulk = source === 'Home' ? attention(page).getByRole('button', { name: /Remove expired/ })
      : page.getByRole('button', { name: 'Clear expired', exact: true });
    if (source === 'Home') await openAttention(page);
    else await page.locator('.tab-btn[data-tab="fridge"]').click();
    const before = await inventory(page);
    await bulk.click();
    const dialog = confirmDialog(page);
    const list = dialog.getByRole('list');
    const named = [...(source === 'Home' ? ['Fridge stew — cooked 2026-11-20'] : []),
      ...[useBy, legacy, ...extra].map(p => p.name + ' — ' + yesterday)];
    await expect(list.getByRole('listitem')).toHaveText(named);
    await expect(list.locator('chard')).toHaveCount(0);
    expect(await list.evaluate(el => el.scrollHeight > el.clientHeight)).toBe(true);
    await expect(dialog).toContainText('Estimated dates and best-before items are not included.');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    expect(await inventory(page)).toEqual(before);

    await bulk.click();
    await dialog.getByRole('button', { name: `Remove ${named.length}`, exact: true }).click();
    const after = await inventory(page);
    expect(after.pantry).toEqual(remainder);
    expect(after.cookedMeals).toEqual(source === 'Home' ? [frozen] : before.cookedMeals);
    expect(Object.keys(after.deletions.pantry)).toEqual([useBy, legacy, ...extra].map(p => p.id));
    expect(Object.keys(after.deletions.cookedMeals || {})).toEqual(source === 'Home' ? [cooked.id] : []);
    await expect(bulk).toBeHidden();
  });
}

test('an inventory change during confirmation cannot delete a lot newly marked best-before', async ({ page }) => {
  await seed(page, { pantry: [useBy, legacy] });
  await openAttention(page);
  await attention(page).getByRole('button', { name: 'Remove expired (2)' }).click();
  await page.evaluate(() => { AppState.pantry[0].printedDateKind = 'best-before'; });
  const before = await inventory(page);
  await confirmDialog(page).getByRole('button', { name: 'Remove 2' }).click();
  expect(await inventory(page)).toEqual(before);
});

test('the printed-date selector round-trips through reload, Firestore payload and JSON export/import', async ({ page }) => {
  await seed(page, { pantry: [legacy] });
  await page.locator('.tab-btn[data-tab="fridge"]').click();
  const addSelect = page.locator('#pantry-printed-date-kind');
  await expect(addSelect.locator('option:checked')).toHaveText('Use by / expiry');
  await page.locator('#pantry-input').fill('Packaged green beans');
  await page.locator('#pantry-expiry').fill(yesterday);
  await addSelect.selectOption({ label: 'Best before' });
  await page.getByRole('button', { name: '+ Add', exact: true }).click();
  await expect(addSelect.locator('option:checked')).toHaveText('Use by / expiry');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
  await page.locator('.tab-btn[data-tab="fridge"]').click();
  await page.locator('.pi-row').filter({ hasText: 'Packaged green beans' }).click();
  const editSelect = page.locator('.pi-expand:not(.hidden)').getByLabel('Printed date type');
  await expect(editSelect).toHaveValue('best-before');
  const payloadPantry = () => page.evaluate(() => JSON.parse(JSON.stringify(buildFirestorePayload().pantry)));
  const saved = await payloadPantry();
  expect(saved[0]).toEqual(legacy);
  expect(saved[1]).toMatchObject({ dateMode: 'expiry', expiryDate: yesterday, printedDateKind: 'best-before' });

  const downloaded = page.waitForEvent('download');
  await page.evaluate(() => exportData());
  const exportFile = await downloaded;
  const exported = JSON.parse(await fs.readFile(await exportFile.path(), 'utf8'));
  expect(exported.pantry).toEqual(saved);
  await editSelect.selectOption({ label: 'Use by / expiry' });
  expect((await payloadPantry())[1].printedDateKind).toBe('use-by');

  await seed(page, {});
  const chooser = page.waitForEvent('filechooser');
  await page.evaluate(() => importData());
  await (await chooser).setFiles({ name: 'synthetic-export.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
  await confirmDialog(page).getByRole('button', { name: 'Import', exact: true }).click();
  const importedAt = await page.evaluate(() => new Date().toISOString());
  await expect.poll(payloadPantry).toEqual(saved.map(p => ({ ...p, updatedAt: importedAt })));
});

for (const [label, width, height] of [['desktop', 1366, 1000], ['390px', 390, 844]]) {
  test(`captures the three TASK-088 views at ${label} with no horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const evidence = path.join(__dirname, '..', 'feature-evidence', 'task-088');
    await seed(page, {
      pantry: [useBy, legacy, spinach, bestBefore, chicken, tuna, carrot], cookedMeals: [cooked, frozen], recipes: [spinachRecipe]
    });
    await openAttention(page);
    await expect(attention(page).getByText('3 to check', { exact: false })).toBeVisible();
    await attention(page).evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(await fits()).toBe(true);
    await attention(page).screenshot({ path: path.join(evidence, `home-attention-${label}.png`), animations: 'disabled' });

    await attention(page).getByRole('button', { name: 'Remove expired (3)' }).click();
    expect(await fits()).toBe(true);
    await confirmDialog(page).screenshot({ path: path.join(evidence, `bulk-confirm-${label}.png`), animations: 'disabled' });
    await confirmDialog(page).getByRole('button', { name: 'Cancel' }).click();

    await page.locator('.tab-btn[data-tab="fridge"]').click();
    const item = page.locator('.pi-item').filter({ has: page.locator('.pi-name').getByText(bestBefore.name, { exact: true }) });
    await item.locator('.pi-row').click();
    await expect(item.getByLabel('Printed date type')).toHaveValue('best-before');
    expect(await fits()).toBe(true);
    await item.screenshot({ path: path.join(evidence, `pantry-date-select-${label}.png`), animations: 'disabled' });
  });
}
