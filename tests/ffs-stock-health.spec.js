const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { waitForAppReady } = require('./app-ready');

const TODAY = '2026-11-25';
const lot = (name, fields = {}) => ({ id: name, name, quantity: 100, unit: 'g', ...fields });
const meal = (name, fields = {}) => ({
  id: name, name, storage: 'fridge', cookedDate: TODAY, portionsRemaining: 2, ...fields
});
const printed = expiryDate => ({ dateMode: 'expiry', expiryDate });

test.use({ timezoneId: 'America/Phoenix' });

test.beforeEach(async ({ page, baseURL }) => {
  await page.route('**/*', route => route.request().url().startsWith(baseURL + '/')
    ? route.continue() : route.abort());
  await page.clock.setFixedTime(new Date(2026, 10, 25, 12));
  await page.addInitScript(() => {
    ['mealPrepHelpSeen', 'mealPrepStartDone', 'pantryOnboardingDone']
      .forEach(key => localStorage.setItem(key, '1'));
  });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
});

test('classifies raw and cooked stock using storage, ingredients and known aliases', async ({ page }) => {
  const cases = [
    [lot('Soy Sauce'), 'condiment'],
    [lot('Toyo'), 'condiment'],
    [lot('EVOO'), 'condiment'],
    [lot('Rice Vinegar'), 'condiment'],
    [lot('Gochujang', { storage: 'fridge' }), 'condiment'],
    [lot('Garlic Powder'), 'condiment'],
    [lot('Garlic cloves', { category: 'Vegetable' }), 'perishable'],
    [lot('Dried Parsley'), 'condiment'],
    [lot('Rice'), 'pantry-staple'],
    [lot('Pasta'), 'pantry-staple'],
    [lot('Rolled Oats'), 'pantry-staple'],
    [lot('Bread Flour'), 'pantry-staple'],
    [lot('Tuna (Canned)', { category: 'Protein' }), 'pantry-staple'],
    [lot('Tuna in oil', { category: 'Protein' }), 'pantry-staple'],
    [lot('Canned Black Beans', { category: 'Protein' }), 'pantry-staple'],
    [lot('Chicken Breast', { storage: 'freezer' }), 'frozen'],
    [lot('Blueberries', { storage: 'freezer' }), 'frozen'],
    [lot('Spinach'), 'perishable'],
    [lot('Chicken Breast'), 'perishable'],
    [lot('Apple', { storage: 'counter' }), 'perishable'],
    [lot('Bell Pepper'), 'perishable'],
    [lot('Milk'), 'perishable'],
    [lot('Fresh Basil', { storage: 'counter' }), 'perishable'],
    [lot('Parsley', { storage: 'fridge', category: 'Vegetable' }), 'perishable'],
    [meal('Tomato Pasta'), 'cooked-meal'],
    [meal('Chicken Soup', { storage: 'freezer' }), 'cooked-meal']
  ];
  expect(await page.evaluate(records => records.map(stockFoodClass), cases.map(([record]) => record)))
    .toEqual(cases.map(([, expected]) => expected));
});

const byName = async (page, pantry, cookedMeals = []) => page.evaluate(({ pantry, cookedMeals, today }) =>
  Object.fromEntries(stockHealthReport({ pantry, cookedMeals }, today).map(row => [row.name, row])),
{ pantry, cookedMeals, today: TODAY });

test('printed dates, estimated safety and record age are independent', async ({ page }) => {
  const old = { purchaseDate: '2026-11-15', shelfLifeDays: 5 };
  const report = await byName(page, [
    lot('Spinach', { ...old, ...printed('2026-11-24') }),
    lot('Lettuce', { ...old, expiryDate: '2026-11-24', updatedAt: '2026-11-25T08:00:00.000Z' }),
    lot('Cabbage', { ...old, shelfLifeDays: 14 }),
    lot('Milk', { purchaseDate: TODAY, ...printed('2026-11-24') }),
    lot('Carrot', { purchaseDate: TODAY, ...printed(TODAY) }),
    lot('Celery', { purchaseDate: TODAY, ...printed('2026-02-31') }),
    lot('Chicken Breast', { storage: 'freezer', purchaseDate: '2025-11-25', shelfLifeDays: 2 }),
    lot('Soy Sauce', { purchaseDate: '2026-09-26', shelfLifeDays: 2 }),
    lot('Chickpeas', { category: 'Pantry', purchaseDate: '2026-05-28' }),
    lot('Lentils', { category: 'Pantry', purchaseDate: '2026-05-29' }),
    lot('Olive Oil', { purchaseDate: '2025-11-24' }),
    lot('Vinegar', { purchaseDate: '2025-11-25' }),
    lot('Peas', { storage: 'freezer', purchaseDate: '2026-08-27' })
  ], [
    meal('Stew', { cookedDate: '2026-11-20' }),
    meal('Soup', { cookedDate: '2026-11-20', storage: 'freezer' }),
    meal('Chili', { cookedDate: '2026-08-26', storage: 'freezer' }),
    meal('Leftovers', { cookedDate: '2026-11-21' })
  ]);
  const check = 'Past typical safe window — check it';
  const stale = days => `Not updated in ${days} days — still accurate?`;
  const past = 'Past printed date (2026-11-24)';
  const signals = Object.fromEntries(Object.entries(report).map(([name, row]) =>
    [name, [row.expiration, row.safety, row.dataStale]]));
  expect(signals).toEqual({
    Spinach: [past, check, stale(10)], Lettuce: [null, check, null], Cabbage: [null, null, stale(10)],
    Milk: [past, null, null], Carrot: [null, null, null], Celery: [null, null, null],
    'Chicken Breast': [null, null, stale(365)],
    'Soy Sauce': [null, null, null], Chickpeas: [null, null, stale(181)], Lentils: [null, null, null],
    'Olive Oil': [null, null, stale(366)], Vinegar: [null, null, null], Peas: [null, null, null],
    Stew: [null, check, stale(5)], Soup: [null, null, null], Chili: [null, null, stale(91)],
    Leftovers: [null, null, null]
  });
  expect(report['Chicken Breast'].quality).toMatch(/quality/i);
  expect(report.Chili.quality).toMatch(/quality/i);
});

test('consistency issues are specific and reported once across matching lots', async ({ page }) => {
  const report = await byName(page, [
    lot('Carrot', { quantity: 0 }),
    lot('Cabbage', { quantity: -1 }),
    lot('Celery', { quantity: null }),
    lot('Kale', { quantity: null, unit: '' }),
    lot('Pasta', { quantity: 0, staple: true, stockLevel: 'empty' }),
    lot('Salt', { quantity: 0, staple: true, stockLevel: 'full' }),
    lot('Sugar', { quantity: 0, staple: true, stockLevel: 'ok' }),
    lot('Carrots', { quantity: 100, unit: 'kg' }),
    lot('Onion'),
    lot('Red Onion', { unit: 'grams' }),
    lot('Yellow Onion', { unit: ' G ' }),
    lot('Rice'),
    lot('Rice Vinegar'),
    lot('Lemon', { unit: 'bag' }),
    lot('Lemons', { unit: 'jar' })
  ], [meal('Soup', { portionsRemaining: 0 }), meal('Stew', { portionsRemaining: null })]);
  const issues = Object.fromEntries(Object.entries(report).map(([name, row]) => [name, row.consistency])
    .filter(([, messages]) => messages.length));
  expect(issues).toEqual({
    Carrot: [expect.stringMatching(/zero quantity.*empty/i)],
    Cabbage: [expect.stringMatching(/negative quantity/i)],
    Celery: [expect.stringMatching(/unit.*no quantity/i)],
    Pasta: [expect.stringMatching(/empty staple.*restock/i)],
    Salt: [expect.stringMatching(/full.*zero quantity/i)],
    Sugar: [expect.stringMatching(/ok.*zero quantity/i)],
    Carrots: [expect.stringMatching(/different units/i)],
    'Red Onion': [expect.stringMatching(/duplicate/i)],
    'Yellow Onion': [expect.stringMatching(/duplicate/i)],
    Lemons: [expect.stringMatching(/different units/i)],
    Soup: [expect.stringMatching(/no portions remaining/i)]
  });
});

const fridgeFixture = {
  pantry: [
    lot('Spinach', { storage: 'fridge', purchaseDate: '2026-11-15', ...printed('2026-11-24') }),
    lot('Chicken Breast', { storage: 'freezer', purchaseDate: '2025-11-25' }),
    lot('Pasta', { storage: 'counter', staple: true, stockLevel: 'empty', quantity: 0 }),
    lot('Soy Sauce', { storage: 'counter', ...printed('2026-11-20') })
  ],
  cookedMeals: [meal('Pumpkin Soup', { cookedDate: '2026-11-20', portionsRemaining: 0 })]
};

for (const width of [1280, 390]) {
  test(`Fridge stock health is collapsed, readable and read-only at ${width}px`, async ({ page, context }) => {
    await page.setViewportSize({ width, height: 960 });
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const before = await page.evaluate(state => {
      Object.assign(AppState, state);
      showTab('fridge');
      window.stockHealthSaveCalls = 0;
      window.saveData = () => { window.stockHealthSaveCalls++; };
      return JSON.stringify(AppState);
    }, fridgeFixture);

    const details = page.locator('#fridge #stock-health');
    const summary = details.getByText('Stock health', { exact: true });
    await expect(summary).toBeVisible({ timeout: 2000 });
    await expect(details).toHaveJSProperty('open', false);
    await summary.click();
    await expect(details).toHaveJSProperty('open', true);
    await expect(details.getByText('2 past printed dates')).toBeVisible();
    await expect(details.getByText('2 safety estimates')).toBeVisible();
    await expect(details.getByText('3 stale records')).toBeVisible();
    await expect(details.getByText('2 consistency issues')).toBeVisible();
    for (const label of ['Perishable', 'Frozen', 'Pantry staples', 'Condiments', 'Cooked meals']) {
      await expect(details.getByRole('heading', { name: label, exact: true })).toBeVisible();
    }
    await expect(details.getByRole('button')).toHaveCount(1);
    await expect(details.locator('input, select, textarea')).toHaveCount(0);
    const sizes = await details.evaluate(el => ({
      panelOverflow: el.scrollWidth - el.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - innerWidth
    }));
    expect(sizes.panelOverflow).toBeLessThanOrEqual(1);
    expect(sizes.pageOverflow).toBeLessThanOrEqual(1);

    if (process.env.CAPTURE_STOCK_HEALTH === '1') {
      await details.screenshot({ path: path.join(__dirname, '..', 'feature-evidence', 'task-081', `stock-health-${width}.png`) });
    }
    await details.getByRole('button', { name: 'Copy report' }).click();
    await expect(details.getByRole('status')).toHaveText('Report copied.');
    const copied = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
    expect(copied).toContain('Perishable\nSpinach · Fridge');
    expect(copied).toContain('Past printed date (2026-11-24)');
    expect(copied).toContain('Cooked meals\nPumpkin Soup · Fridge');
    await summary.click();
    await expect(details).toHaveJSProperty('open', false);
    expect(await page.evaluate(() => ({ json: JSON.stringify(AppState), saves: window.stockHealthSaveCalls })))
      .toEqual({ json: before, saves: 0 });
  });
}
