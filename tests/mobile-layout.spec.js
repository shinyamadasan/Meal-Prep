const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

// Mobile layout guard: at phone width, no tab should scroll sideways (horizontal
// overflow is the #1 "looks broken on mobile" bug). Runs against the local files
// so it checks the current code, not the deployed site.
test.use({ viewport: { width: 390, height: 844 } }); // iPhone 12-ish

test('no horizontal overflow on any tab (mobile)', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => {
    try { localStorage.setItem('mealPrepHelpSeen', '1'); } catch (e) {}
  });
  await page.goto(pathToFileURL(path.resolve('index.html')).href, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const tabs = ['recipes', 'planner', 'grocery', 'fridge', 'storage', 'hacks', 'nutrition', 'ingredients'];
  const bad = [];
  for (const t of tabs) {
    const btn = page.locator('.tab-btn[data-tab="' + t + '"]');
    if (await btn.count()) { await btn.click(); await page.waitForTimeout(300); }
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - window.innerWidth
    );
    if (overflow > 3) bad.push(t + ' (+' + overflow + 'px)');
  }

  expect(bad, 'Tabs scrolling sideways on mobile: ' + bad.join(', ')).toHaveLength(0);
});
