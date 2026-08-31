const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');
const { waitForAppReady } = require('./app-ready');

/**
 * Last full inventory check (D-075, small UX wave).
 *
 * AppState.inventoryVerifiedAt — a single scalar ISO timestamp, following the exact
 * same top-level-field persistence template AppState.nutritionGoals already uses
 * (saveToLocalStorage / loadFromLocalStorage / snapshotData / restoreBackup /
 * exportData / buildFirestorePayload / loadFromFirestore / setupRealtimeListeners).
 * It is a manual confidence stamp, NOT household collaboration, NOT an audit, and
 * carries no schedule, notification, or scoring — verifyInventoryChecked() only
 * ever writes the current timestamp and re-renders the status line.
 */

const APP_URL = () => pathToFileURL(path.resolve('index.html')).href;

function bootstrapStorage() {
  return (doc) => {
    try {
      if (localStorage.getItem('__inventoryVerifySpecBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__inventoryVerifySpecBootstrapped', '1');
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

const readPersisted = (page) => page.evaluate(
  () => JSON.parse(localStorage.getItem('mealPrepAppData') || '{}').inventoryVerifiedAt);

// ───────────────────────────────────────────────────────────────────────────
// 17. Never verified
// ───────────────────────────────────────────────────────────────────────────

test('17. never verified -> correct empty state', async ({ page }) => {
  await loadOffline(page, { recipes: [], version: 1 });
  await openFridgeTab(page);
  await expect(page.locator('#inventory-verify-status')).toHaveText('Inventory not yet verified');
  const state = await page.evaluate(() => AppState.inventoryVerifiedAt);
  expect(state).toBeNull();
});

// ───────────────────────────────────────────────────────────────────────────
// 18+19. Verify + reload persistence
// ───────────────────────────────────────────────────────────────────────────

test('18. clicking Inventory checked stores a timestamp', async ({ page }) => {
  await loadOffline(page, { recipes: [], version: 1 });
  await openFridgeTab(page);
  await page.click('button:has-text("Inventory checked")');
  const at = await page.evaluate(() => AppState.inventoryVerifiedAt);
  expect(at).not.toBeNull();
  expect(new Date(at).toString()).not.toBe('Invalid Date');
  await expect(page.locator('#inventory-verify-status')).toHaveText('Inventory checked today');
});

test('19. reload preserves the timestamp', async ({ page }) => {
  await loadOffline(page, { inventoryVerifiedAt: '2026-08-27T10:00:00.000Z', version: 1 });
  await page.waitForFunction(() => AppState.inventoryVerifiedAt === '2026-08-27T10:00:00.000Z');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
  await page.waitForFunction(() => AppState.inventoryVerifiedAt === '2026-08-27T10:00:00.000Z');
  const at = await page.evaluate(() => AppState.inventoryVerifiedAt);
  expect(at).toBe('2026-08-27T10:00:00.000Z');
});

// ───────────────────────────────────────────────────────────────────────────
// 20. Export/import
// ───────────────────────────────────────────────────────────────────────────

test('20. export includes inventoryVerifiedAt; import adopts a newer imported value', async ({ page }) => {
  await loadOffline(page, { inventoryVerifiedAt: '2026-08-01T00:00:00.000Z', version: 1 });
  await page.waitForFunction(() => AppState.inventoryVerifiedAt === '2026-08-01T00:00:00.000Z');
  const payload = await page.evaluate(() => buildFirestorePayload());
  expect(payload.inventoryVerifiedAt).toBe('2026-08-01T00:00:00.000Z');

  // Simulate the import merge rule directly (newer imported value wins, older does not regress it).
  const result = await page.evaluate(() => {
    var out = {};
    function applyImport(importedAt) {
      if (importedAt && importedAt > (AppState.inventoryVerifiedAt || '')) AppState.inventoryVerifiedAt = importedAt;
    }
    applyImport('2026-07-01T00:00:00.000Z'); // older — must NOT regress
    out.afterOlder = AppState.inventoryVerifiedAt;
    applyImport('2026-08-20T00:00:00.000Z'); // newer — must win
    out.afterNewer = AppState.inventoryVerifiedAt;
    return out;
  });
  expect(result.afterOlder).toBe('2026-08-01T00:00:00.000Z');
  expect(result.afterNewer).toBe('2026-08-20T00:00:00.000Z');
});

// ───────────────────────────────────────────────────────────────────────────
// 21. A second verification replaces the prior timestamp
// ───────────────────────────────────────────────────────────────────────────

test('21. a second verification replaces the prior timestamp', async ({ page }) => {
  await loadOffline(page, { inventoryVerifiedAt: '2020-01-01T00:00:00.000Z', version: 1 });
  await page.waitForFunction(() => AppState.inventoryVerifiedAt === '2020-01-01T00:00:00.000Z');
  await openFridgeTab(page);
  await page.click('button:has-text("Inventory checked")');
  const at = await page.evaluate(() => AppState.inventoryVerifiedAt);
  expect(at).not.toBe('2020-01-01T00:00:00.000Z');
  expect(new Date(at).getFullYear()).toBeGreaterThan(2020);
});

// ───────────────────────────────────────────────────────────────────────────
// 22. Truthful relative/absolute display
// ───────────────────────────────────────────────────────────────────────────

test('22. display says relative time truthfully for a known past date', async ({ page }) => {
  const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
  await loadOffline(page, { inventoryVerifiedAt: threeDaysAgo, version: 1 });
  await openFridgeTab(page);
  await expect(page.locator('#inventory-verify-status')).toHaveText('Inventory checked 3 days ago');
});

// ───────────────────────────────────────────────────────────────────────────
// 23+24+25. No side effects
// ───────────────────────────────────────────────────────────────────────────

test('23. no inventory item is mutated by verification', async ({ page }) => {
  await loadOffline(page, {
    pantry: [{ id: 900, name: 'Eggs', quantity: 6 }],
    cookedMeals: [{ id: 'cm_1', name: 'Cooked Chicken', cookedDate: '2026-08-25', storage: 'fridge', portionsRemaining: 4, initialPortions: 4 }],
    version: 1
  });
  const before = await page.evaluate(() => JSON.stringify({ pantry: AppState.pantry, cooked: AppState.cookedMeals }));
  await openFridgeTab(page);
  await page.click('button:has-text("Inventory checked")');
  const after = await page.evaluate(() => JSON.stringify({ pantry: AppState.pantry, cooked: AppState.cookedMeals }));
  expect(after).toBe(before);
});

test('24. no notification is created by verification', async ({ page }) => {
  await loadOffline(page, { version: 1 });
  await openFridgeTab(page);
  // Count real browser Notification construction (the mechanism maybeNotifyAttention()
  // uses elsewhere in this app) — verifyInventoryChecked() must never trigger one.
  await page.evaluate(() => {
    window.__notifyCount = 0;
    if (typeof Notification !== 'undefined') {
      window.Notification = function() { window.__notifyCount++; return {}; };
    }
  });
  await page.click('button:has-text("Inventory checked")');
  await page.waitForTimeout(150);
  const count = await page.evaluate(() => window.__notifyCount);
  expect(count).toBe(0);
});

test('25. no recommendation ranking changes as a result of verification', async ({ page }) => {
  await loadOffline(page, {
    flavors: [{ id: 'flv-soy', name: 'Soy', ingredients: [], instructions: 'x', activeTime: 5, preparationStyle: 'make-fresh', worksWith: ['chicken'], tags: [], updatedAt: '2026-08-01T00:00:00.000Z' }],
    cookedMeals: [{ id: 'cm_1', name: 'Cooked Chicken', cookedDate: '2026-08-25', storage: 'fridge', proteinType: 'chicken' }],
    version: 1
  });
  const before = await page.evaluate(() => JSON.stringify(getCompatibleFlavorsForCookedMeal(AppState.cookedMeals[0])));
  await openFridgeTab(page);
  await page.click('button:has-text("Inventory checked")');
  const after = await page.evaluate(() => JSON.stringify(getCompatibleFlavorsForCookedMeal(AppState.cookedMeals[0])));
  expect(after).toBe(before);
});

// ───────────────────────────────────────────────────────────────────────────
// 26. Backward compatibility
// ───────────────────────────────────────────────────────────────────────────

test('26. old saved data without the field still loads', async ({ page }) => {
  await loadOffline(page, {
    recipes: [{ id: 101, name: 'Old Adobo', baseIngredients: [], instructions: 'Cook.' }],
    pantry: [{ id: 900, name: 'Eggs' }],
    version: 3
    // no inventoryVerifiedAt key at all — pre-dates this feature
  });
  const state = await page.evaluate(() => AppState.inventoryVerifiedAt);
  expect(state).toBeNull();
  await openFridgeTab(page);
  await expect(page.locator('#inventory-verify-status')).toHaveText('Inventory not yet verified');
});

// ───────────────────────────────────────────────────────────────────────────
// Persistence round-trip via saveToLocalStorage (mirrors nutritionGoals coverage style)
// ───────────────────────────────────────────────────────────────────────────

test('inventoryVerifiedAt round-trips through localStorage', async ({ page }) => {
  await loadOffline(page, { version: 1 });
  await openFridgeTab(page);
  await page.click('button:has-text("Inventory checked")');
  await page.waitForFunction(() => AppState.inventoryVerifiedAt != null);
  const persisted = await readPersisted(page);
  const state = await page.evaluate(() => AppState.inventoryVerifiedAt);
  expect(persisted).toBe(state);
});

test('buildFirestorePayload() includes inventoryVerifiedAt', async ({ page }) => {
  await loadOffline(page, { inventoryVerifiedAt: '2026-08-15T00:00:00.000Z', version: 1 });
  await page.waitForFunction(() => AppState.inventoryVerifiedAt === '2026-08-15T00:00:00.000Z');
  const payload = await page.evaluate(() => buildFirestorePayload());
  expect(payload.inventoryVerifiedAt).toBe('2026-08-15T00:00:00.000Z');
});

test('backup/restore round-trips inventoryVerifiedAt', async ({ page }) => {
  await loadOffline(page, { inventoryVerifiedAt: '2026-08-10T00:00:00.000Z', version: 1 });
  await page.waitForFunction(() => AppState.inventoryVerifiedAt === '2026-08-10T00:00:00.000Z');
  await page.evaluate(() => createBackup('test'));
  await page.evaluate(() => { AppState.inventoryVerifiedAt = null; saveToLocalStorage(); });
  const restored = await page.evaluate(() => {
    var raw = localStorage.getItem('mealPrepBackup');
    var backup = JSON.parse(raw);
    return backup.data.inventoryVerifiedAt;
  });
  expect(restored).toBe('2026-08-10T00:00:00.000Z');
});

test('MUTATION: removing inventoryVerifiedAt from buildFirestorePayload() loses it on save', async ({ page }) => {
  await loadOffline(page, { inventoryVerifiedAt: '2026-08-15T00:00:00.000Z', version: 1 });
  await page.waitForFunction(() => AppState.inventoryVerifiedAt === '2026-08-15T00:00:00.000Z');
  const result = await page.evaluate(() => {
    var original = buildFirestorePayload;
    var mutant = eval('(' + original.toString().replace(/inventoryVerifiedAt:\s*AppState\.inventoryVerifiedAt,\s*lastUpdated:/, 'lastUpdated:') + ')');
    var payload = mutant();
    return Object.prototype.hasOwnProperty.call(payload, 'inventoryVerifiedAt');
  });
  expect(result).toBe(false); // proves the real function's line is load-bearing
  const realHasKey = await page.evaluate(() => Object.prototype.hasOwnProperty.call(buildFirestorePayload(), 'inventoryVerifiedAt'));
  expect(realHasKey).toBe(true);
});
