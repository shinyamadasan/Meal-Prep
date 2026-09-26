const { test, expect } = require('@playwright/test');

// Mobile layout guard: at phone width, no tab should scroll sideways (horizontal
// overflow is the #1 "looks broken on mobile" bug). Runs against the local files
// so it checks the current code, not the deployed site.
test.use({ viewport: { width: 390, height: 844 } }); // iPhone 12-ish

test('no horizontal overflow on any tab (mobile)', async ({ page }) => {
  test.setTimeout(60000);
  await page.addInitScript(() => {
    try { localStorage.setItem('mealPrepHelpSeen', '1'); } catch (e) {}
    try { localStorage.setItem('pantryOnboardingDone', '1'); } catch (e) {}
  });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    document.querySelectorAll('.modal:not(.hidden)').forEach((m) => m.classList.add('hidden'));
    document.body.style.overflow = '';
  });

  const tabs = ['recipes', 'planner', 'grocery', 'fridge', 'hacks', 'nutrition', 'ingredients'];
  const bad = [];
  for (const t of tabs) {
    // Recipes moved behind "More" at phone width (mobile home polish wave) so the
    // primary Home/Plan/Shop/Prep/Fridge row fits without horizontal scrolling.
    const inMore = ['nutrition', 'ingredients', 'hacks', 'recipes'].includes(t);
    if (inMore) await page.locator('.tab-more-btn').click();
    const btn = t === 'recipes'
      ? page.locator('.tab-more-recipes-link') // no data-tab — see index.html
      : page.locator((inMore ? '.tab-more-menu ' : '') + '.tab-btn[data-tab="' + t + '"]');
    if (await btn.count()) { await btn.click(); await page.waitForTimeout(300); }
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - window.innerWidth
    );
    if (overflow > 3) bad.push(t + ' (+' + overflow + 'px)');
  }

  expect(bad, 'Tabs scrolling sideways on mobile: ' + bad.join(', ')).toHaveLength(0);
});

// Mobile home polish: Home/Plan/Shop/Prep/Fridge + "More" must fit in the primary
// nav row itself at phone width — not just avoid page-level overflow. Recipes was
// moved into the "More" menu (tests/mobile-layout.spec.js above) to make room.
test('the 5 primary tabs + More fit without the nav scrolling sideways (mobile)', async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem('mealPrepHelpSeen', '1'); } catch (e) {}
    try { localStorage.setItem('pantryOnboardingDone', '1'); } catch (e) {}
  });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  const primaryTabs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.tab-nav > .tab-btn[data-tab]'))
      .filter((b) => getComputedStyle(b).display !== 'none')
      .map((b) => b.dataset.tab)
  );
  expect(primaryTabs).toEqual(['dashboard', 'planner', 'grocery', 'prep', 'fridge']);

  const nav = await page.evaluate(() => {
    const el = document.querySelector('.tab-nav');
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
  expect(nav.scrollWidth, 'tab-nav scrollWidth vs clientWidth').toBeLessThanOrEqual(nav.clientWidth + 1);
});
