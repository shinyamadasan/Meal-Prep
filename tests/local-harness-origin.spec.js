const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { waitForRestored } = require('./app-ready');
const { PROD_SPECS } = require('../playwright.config.js');

/**
 * The local suite's origin contract (TASK-061, D-077).
 *
 * Chromium can drop a fresh context's ENTIRE file:// localStorage across that context's
 * first reload (~3 in 1000 under 16 workers, measured; 0 in 1500+ for the same probe over
 * http). Every save-then-reload spec was therefore a coin flip on CI, and the failure
 * surfaced as a restore wait timing out in whichever spec lost the flip.
 *
 * A ~0.3% browser race cannot be made to fail on demand inside one test, so the
 * deterministic protection is the contract itself: the local project is served over http,
 * and no local spec may navigate to file:// again. The behavioural tests pin what the
 * reload specs rely on — a save made just before a context's FIRST reload is exactly what
 * the next document restores, and nothing leaks between tests.
 */

const SELF = path.basename(__filename);
const localSpecs = () => fs.readdirSync(__dirname)
  .filter((f) => f.endsWith('.spec.js') && f !== SELF && !PROD_SPECS.includes(f));

test('no local spec loads the app from file://', () => {
  const offenders = localSpecs().filter((f) =>
    /pathToFileURL\s*\(|['"`]file:\/\//.test(fs.readFileSync(path.join(__dirname, f), 'utf8')));
  expect(offenders,
    'These local specs navigate to file://, where Chromium can drop a fresh context\'s ' +
    'localStorage across its first reload. Use page.goto(\'/index.html\') (baseURL).'
  ).toEqual([]);
});

async function boot(page) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(() => {
    if (localStorage.getItem('__originBootstrapped')) { window.__restoredBoot = true; return; }
    window.__restoredBoot = false;
    window.__storageAtFirstBoot = localStorage.length;
    localStorage.setItem('__originBootstrapped', '1');
    localStorage.setItem('mealPrepHelpSeen', '1');
    localStorage.setItem('mealPrepStartDone', '1');
    localStorage.setItem('pantryOnboardingDone', '1');
  });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof saveData === 'function' &&
    document.getElementById('dashboard') && document.getElementById('dashboard').children.length > 0);
}

test('the local project serves the app over http with no service worker', async ({ page }) => {
  await boot(page);
  expect(page.url()).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/index\.html$/);
  expect(await page.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller)))
    .toBe(false);
});

test('a fresh test starts with empty storage — nothing leaks between tests', async ({ page }) => {
  await boot(page);
  expect(await page.evaluate(() => window.__storageAtFirstBoot)).toBe(0);
});

test('the last of several rapid saves is exactly what the first reload restores', async ({ page }) => {
  await boot(page);
  // Three mutations back to back, reload with no pause: the timing every CI failure had.
  await page.evaluate(() => {
    ['v1', 'v2', 'v3'].forEach((v) => {
      AppState.pantry = [{ id: 'origin_probe', name: 'Origin probe ' + v, quantity: 1, unit: 'pcs' }];
      saveData();
    });
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForRestored(page, () => AppState.pantry.some((p) => p.id === 'origin_probe'));

  const after = await page.evaluate(() => ({
    restoredBoot: window.__restoredBoot,
    probe: AppState.pantry.filter((p) => p.id === 'origin_probe').map((p) => p.name)
  }));
  // restoredBoot=false would mean the whole store vanished and the app re-seeded.
  expect(after).toEqual({ restoredBoot: true, probe: ['Origin probe v3'] });
});
