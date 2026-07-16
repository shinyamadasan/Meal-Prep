const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

// Exercises real recipe CARDS — the blind spot of the other suites. The live
// site needs Firebase to load recipes (App Check blocks headless), so here we
// block the Firebase scripts, which makes the app fall back to its built-in
// sample recipes (numeric ids 1–11). That's exactly the case where the
// id-comparison bug hid: clicking a sample card silently did nothing.
test.use({ viewport: { width: 1000, height: 1400 } });

async function loadWithSamples(page) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      // Kitchen Setup Wizard auto-opens whenever this is unset (seedPantryIfEmpty()) and
      // covers the whole page, blocking every click below -- same fix TASK-004 applied to
      // mobile-layout.spec.js; this file never got it.
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
  });
  await page.goto(pathToFileURL(path.resolve('index.html')).href, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
}

test('clicking a sample recipe card opens the editor (numeric id)', async ({ page }) => {
  await loadWithSamples(page);
  await page.locator('.tab-btn[data-tab="recipes"]').click(); // recipe cards live in the Recipes tab
  const cards = page.locator('.recipe-card');
  expect(await cards.count()).toBeGreaterThan(0);

  // The LAST card is a sample recipe with a numeric id — the one that failed.
  const last = cards.last();
  await last.locator('.recipe-title').scrollIntoViewIfNeeded();
  await last.locator('.recipe-title').click();

  await expect(page.locator('#recipe-modal')).toBeVisible();
  await expect(page.locator('#modal-title')).toHaveText('Edit Recipe');
});

test('serving +/- works on a sample recipe', async ({ page }) => {
  await loadWithSamples(page);
  await page.locator('.tab-btn[data-tab="recipes"]').click(); // recipe cards live in the Recipes tab
  const card = page.locator('.recipe-card').first();
  const servings = card.locator('.current-servings');
  const before = (await servings.textContent()).trim();
  await card.locator('.serving-btn', { hasText: '+' }).click();
  await page.waitForTimeout(200);
  await expect(servings).not.toHaveText(before); // count actually changed
});
