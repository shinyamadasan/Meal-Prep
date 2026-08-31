const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');
const { waitForAppReady } = require('./app-ready');

/**
 * Prepared Flavors mirrored into My Fridge (D-075, small UX wave).
 *
 * My Fridge should answer "what ready/prepared food do I physically have?" without
 * a tab switch to the Flavor Library. renderFridgePreparedFlavors() is a SECOND
 * render target for the SAME AppState.preparedFlavors collection — no new state,
 * no second Used-1 implementation (it reuses useOnePreparedFlavor() and the
 * existing preparedFlavorCardHtml() renderer verbatim). See prepared-flavors.spec.js
 * for the underlying collection's own persistence/tombstone coverage — this file
 * only covers the additional Fridge rendering surface.
 */

const APP_URL = () => pathToFileURL(path.resolve('index.html')).href;

const SOY_ID = 'flv-soy-calamansi';
const SOY_NAME = 'Soy-Calamansi';
const CURRY_ID = 'flv-curry-coconut';
const CURRY_NAME = 'Curry-Coconut';

function makeFlavor(over) {
  return Object.assign({
    id: SOY_ID,
    name: SOY_NAME,
    ingredients: [{ name: 'Soy Sauce', baseQuantity: 4, unit: 'tbsp', category: 'Pantry' }],
    instructions: 'Mix it.',
    activeTime: 5,
    preparationStyle: 'freezer-friendly',
    worksWith: ['chicken'],
    tags: [],
    updatedAt: '2026-08-01T00:00:00.000Z'
  }, over || {});
}

function makePrepared(over) {
  return Object.assign({
    id: 'pfl-test-one',
    flavorId: SOY_ID,
    portionsInitial: 8,
    portionsRemaining: 8,
    storage: 'freezer',
    preparedAt: '2026-08-20',
    expiresAt: null,
    updatedAt: '2026-08-20T00:00:00.000Z'
  }, over || {});
}

function bootstrapStorage() {
  return (doc) => {
    try {
      if (localStorage.getItem('__fridgePreparedFlavorSpecBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__fridgePreparedFlavorSpecBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
      localStorage.setItem('mealPrepInitialized', '1');
      if (doc) localStorage.setItem('mealPrepAppData', JSON.stringify(doc));
    } catch (e) {}
  };
}

async function loadOffline(page, localDoc) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(bootstrapStorage(), localDoc || null);
  await page.goto(APP_URL(), { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
}

async function openFridgeTab(page) {
  await page.evaluate(() => showTab('fridge'));
  await expect(page.locator('#fridge')).toHaveClass(/active/);
}

// ───────────────────────────────────────────────────────────────────────────
// Rendering: same collection, no duplication
// ───────────────────────────────────────────────────────────────────────────

test('1. existing cooked food still renders in Fridge', async ({ page }) => {
  await loadOffline(page, {
    flavors: [],
    cookedMeals: [{ id: 'cm_1', name: 'Cooked Chicken', cookedDate: '2026-08-25', storage: 'fridge', portionsRemaining: 4, initialPortions: 4 }],
    version: 1
  });
  await openFridgeTab(page);
  await expect(page.locator('#cooked-meals-list')).toContainText('Cooked Chicken');
});

test('2. prepared flavor stock renders in Fridge', async ({ page }) => {
  await loadOffline(page, { flavors: [makeFlavor()], preparedFlavors: [makePrepared()], version: 1 });
  await openFridgeTab(page);
  await expect(page.locator('#fridge-prepared-flavors-list')).toContainText(SOY_NAME);
});

test('3+4. Fridge reads the SAME preparedFlavors record — rendering creates no duplicate', async ({ page }) => {
  await loadOffline(page, { flavors: [makeFlavor()], preparedFlavors: [makePrepared()], version: 1 });
  const before = await page.evaluate(() => AppState.preparedFlavors.length);
  await openFridgeTab(page);
  await page.evaluate(() => showTab('flavors')); // render the Flavor Library surface too
  await page.evaluate(() => showTab('fridge'));  // and back — rendering both surfaces repeatedly
  const after = await page.evaluate(() => AppState.preparedFlavors.length);
  expect(before).toBe(1);
  expect(after).toBe(1);
  const ids = await page.evaluate(() => AppState.preparedFlavors.map((p) => p.id));
  expect(ids).toEqual(['pfl-test-one']);
});

test('5. Fridge prepared flavor shows storage', async ({ page }) => {
  await loadOffline(page, { flavors: [makeFlavor()], preparedFlavors: [makePrepared({ storage: 'fridge' })], version: 1 });
  await openFridgeTab(page);
  await expect(page.locator('#fridge-prepared-flavors-list .prepared-flavor-card')).toContainText('Fridge');
});

test('6. portions remaining show correctly', async ({ page }) => {
  await loadOffline(page, { flavors: [makeFlavor()], preparedFlavors: [makePrepared({ portionsInitial: 5, portionsRemaining: 5 })], version: 1 });
  await openFridgeTab(page);
  await expect(page.locator('#fridge-prepared-flavors-list .prepared-flavor-card')).toContainText('5');
});

// ───────────────────────────────────────────────────────────────────────────
// Used 1 — the SAME canonical mutator, both surfaces observe it
// ───────────────────────────────────────────────────────────────────────────

test('7. Used 1 from Fridge decrements the canonical preparedFlavor', async ({ page }) => {
  await loadOffline(page, { flavors: [makeFlavor()], preparedFlavors: [makePrepared({ portionsInitial: 8, portionsRemaining: 8 })], version: 1 });
  await openFridgeTab(page);
  await page.click('#fridge-prepared-flavors-list .prepared-flavor-use');
  await page.waitForFunction(() => AppState.preparedFlavors[0].portionsRemaining === 7);
  const remaining = await page.evaluate(() => AppState.preparedFlavors[0].portionsRemaining);
  expect(remaining).toBe(7);
});

test('8. Flavor Library sees the same decremented count after a Fridge Used 1', async ({ page }) => {
  await loadOffline(page, { flavors: [makeFlavor()], preparedFlavors: [makePrepared({ portionsInitial: 8, portionsRemaining: 8 })], version: 1 });
  await openFridgeTab(page);
  await page.click('#fridge-prepared-flavors-list .prepared-flavor-use');
  await page.waitForFunction(() => AppState.preparedFlavors[0].portionsRemaining === 7);
  await page.evaluate(() => showTab('flavors'));
  await expect(page.locator('#prepared-flavors-list .prepared-flavor-card')).toContainText('7');
});

test('9. zero portions follows existing Flavor Bomb removal/tombstone semantics', async ({ page }) => {
  await loadOffline(page, { flavors: [makeFlavor()], preparedFlavors: [makePrepared({ portionsInitial: 1, portionsRemaining: 1 })], version: 1 });
  await openFridgeTab(page);
  await page.click('#fridge-prepared-flavors-list .prepared-flavor-use');
  await page.waitForFunction(() => AppState.preparedFlavors.length === 0);
  const tomb = await page.evaluate(() => readTombstone('preparedFlavors', 'pfl-test-one'));
  expect(tomb).not.toBeNull();
  // The Fridge section itself must fold away once the last batch is gone.
  await expect(page.locator('#fridge-prepared-flavors-section')).toHaveClass(/hidden/);
});

test('10. freezer prepared flavor displays as freezer', async ({ page }) => {
  await loadOffline(page, { flavors: [makeFlavor()], preparedFlavors: [makePrepared({ storage: 'freezer' })], version: 1 });
  await openFridgeTab(page);
  await expect(page.locator('#fridge-prepared-flavors-list .prepared-flavor-card')).toContainText('Freezer');
});

test('11. a deleted/orphaned flavor gracefully retains existing fallback behavior', async ({ page }) => {
  await loadOffline(page, { flavors: [makeFlavor()], preparedFlavors: [makePrepared()], version: 1 });
  await page.evaluate((flavorId) => { AppState.flavors = AppState.flavors.filter((f) => f.id !== flavorId); }, SOY_ID);
  await openFridgeTab(page);
  await expect(page.locator('#fridge-prepared-flavors-list')).toContainText('Unknown flavor');
});

// ───────────────────────────────────────────────────────────────────────────
// Empty state
// ───────────────────────────────────────────────────────────────────────────

test('12. no prepared flavors -> compact/omitted empty state (section hidden, no giant card)', async ({ page }) => {
  await loadOffline(page, { flavors: [makeFlavor()], preparedFlavors: [], version: 1 });
  await openFridgeTab(page);
  await expect(page.locator('#fridge-prepared-flavors-section')).toHaveClass(/hidden/);
  const text = await page.locator('#fridge-prepared-flavors-list').innerHTML();
  expect(text.trim()).toBe('');
});

// ───────────────────────────────────────────────────────────────────────────
// Sorting: fridge before freezer, then use-soon first
// ───────────────────────────────────────────────────────────────────────────

test('sorting: fridge items list before freezer items', async ({ page }) => {
  await loadOffline(page, {
    flavors: [makeFlavor(), makeFlavor({ id: CURRY_ID, name: CURRY_NAME })],
    preparedFlavors: [
      makePrepared({ id: 'pfl-freezer-one', flavorId: SOY_ID, storage: 'freezer' }),
      makePrepared({ id: 'pfl-fridge-one', flavorId: CURRY_ID, storage: 'fridge' })
    ],
    version: 1
  });
  await openFridgeTab(page);
  const order = await page.evaluate(() => Array.from(document.querySelectorAll('#fridge-prepared-flavors-list .prepared-flavor-name')).map((el) => el.textContent));
  expect(order).toEqual([CURRY_NAME, SOY_NAME]);
});

test('sorting: within the same storage, earlier expiry lists first', async ({ page }) => {
  await loadOffline(page, {
    flavors: [makeFlavor(), makeFlavor({ id: CURRY_ID, name: CURRY_NAME })],
    preparedFlavors: [
      makePrepared({ id: 'pfl-later', flavorId: SOY_ID, storage: 'fridge', expiresAt: '2026-12-01' }),
      makePrepared({ id: 'pfl-sooner', flavorId: CURRY_ID, storage: 'fridge', expiresAt: '2026-09-01' })
    ],
    version: 1
  });
  await openFridgeTab(page);
  const order = await page.evaluate(() => Array.from(document.querySelectorAll('#fridge-prepared-flavors-list .prepared-flavor-name')).map((el) => el.textContent));
  expect(order).toEqual([CURRY_NAME, SOY_NAME]);
});

// ───────────────────────────────────────────────────────────────────────────
// Mobile / no overflow
// ───────────────────────────────────────────────────────────────────────────

test('13. mobile Fridge has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await loadOffline(page, {
    flavors: [makeFlavor()],
    preparedFlavors: [makePrepared()],
    cookedMeals: [{ id: 'cm_1', name: 'Cooked Chicken', cookedDate: '2026-08-25', storage: 'fridge', portionsRemaining: 4, initialPortions: 4 }],
    version: 1
  });
  await openFridgeTab(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});

// ───────────────────────────────────────────────────────────────────────────
// Regression: existing surfaces unchanged
// ───────────────────────────────────────────────────────────────────────────

test('14. existing cookedMeal Used 1 remains unchanged', async ({ page }) => {
  await loadOffline(page, {
    cookedMeals: [{ id: 'cm_1', name: 'Cooked Chicken', cookedDate: '2026-08-25', storage: 'fridge', portionsRemaining: 4, initialPortions: 4 }],
    version: 1
  });
  await openFridgeTab(page);
  await page.click('.cooked-use-one');
  await page.waitForFunction(() => AppState.cookedMeals[0].portionsRemaining === 3);
  const remaining = await page.evaluate(() => AppState.cookedMeals[0].portionsRemaining);
  expect(remaining).toBe(3);
});

test('15. Flavor Library prepared-stock UI remains unchanged (same card markup, same container)', async ({ page }) => {
  await loadOffline(page, { flavors: [makeFlavor()], preparedFlavors: [makePrepared()], version: 1 });
  await page.evaluate(() => showTab('flavors'));
  await expect(page.locator('#prepared-flavors-section')).not.toHaveClass(/hidden/);
  await expect(page.locator('#prepared-flavors-list .prepared-flavor-card')).toHaveCount(1);
});

test('16. Meal Lego compatibility/ranking output is unchanged by the Fridge mirror rendering', async ({ page }) => {
  await loadOffline(page, {
    flavors: [makeFlavor()],
    cookedMeals: [{ id: 'cm_1', name: 'Cooked Chicken', cookedDate: '2026-08-25', storage: 'fridge', proteinType: 'chicken' }],
    preparedFlavors: [makePrepared()],
    version: 1
  });
  const before = await page.evaluate(() => JSON.stringify(getCompatibleFlavorsForCookedMeal(AppState.cookedMeals[0])));
  await openFridgeTab(page);
  const after = await page.evaluate(() => JSON.stringify(getCompatibleFlavorsForCookedMeal(AppState.cookedMeals[0])));
  expect(after).toBe(before);
});

test('no console/page errors rendering Fridge with both cooked meals and prepared flavors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await loadOffline(page, {
    flavors: [makeFlavor()],
    preparedFlavors: [makePrepared()],
    cookedMeals: [{ id: 'cm_1', name: 'Cooked Chicken', cookedDate: '2026-08-25', storage: 'fridge', portionsRemaining: 4, initialPortions: 4 }],
    version: 1
  });
  await openFridgeTab(page);
  await page.click('#fridge-prepared-flavors-list .prepared-flavor-use');
  await page.waitForTimeout(200);
  const appErrors = errors.filter((e) => !/net::ERR|Failed to load resource|favicon|frame-ancestors|google\.com/i.test(e));
  expect(appErrors).toEqual([]);
});
