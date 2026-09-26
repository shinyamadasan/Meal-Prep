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
// Pinned at both 390px (iPhone 12-ish) and 360px (a common smaller Android width —
// verified manually during review, now a regression guard, not just a sanity check).
for (const width of [390, 360]) {
  test(`the 5 primary tabs + More fit without the nav scrolling sideways (${width}px)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
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

    const moreVisible = await page.evaluate(() => {
      const btn = document.querySelector('.tab-more-btn');
      return !!btn && getComputedStyle(btn).display !== 'none';
    });
    expect(moreVisible, 'the "More" button itself must be reachable').toBe(true);

    const nav = await page.evaluate(() => {
      const el = document.querySelector('.tab-nav');
      return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
    });
    expect(nav.scrollWidth, 'tab-nav scrollWidth vs clientWidth').toBeLessThanOrEqual(nav.clientWidth + 1);

    const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(pageOverflow, 'page-level horizontal overflow').toBeLessThanOrEqual(3);

    // Recipes remains reachable via More, even though it is not one of the 5 primary tabs.
    await page.locator('.tab-more-btn').click();
    const recipesLink = page.locator('.tab-more-recipes-link');
    await expect(recipesLink).toBeVisible();
    await recipesLink.click();
    await page.waitForTimeout(300);
    const recipesActive = await page.evaluate(() => document.getElementById('recipes').classList.contains('active'));
    expect(recipesActive, 'Recipes content should be showing after tapping it in More').toBe(true);
  });
}

// Review finding (TASK-063 fix-first): tapping Recipes through More opened the right
// content but gave no VISIBLE indication of the current tab — the hidden primary
// Recipes button received .active, while the visible "More" button did not. Fixed in
// showTab() by counting Recipes as "inside More" only at the same <=768px breakpoint
// where the primary Recipes tab is actually hidden.
test.describe('current-tab indicator when Recipes is reached through More', () => {
  test('mobile: selecting Recipes via More visibly marks More as the active tab', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      try { localStorage.setItem('mealPrepHelpSeen', '1'); } catch (e) {}
      try { localStorage.setItem('pantryOnboardingDone', '1'); } catch (e) {}
    });
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    await page.locator('.tab-more-btn').click();
    await page.locator('.tab-more-recipes-link').click();
    await page.waitForTimeout(300);

    const state = await page.evaluate(() => ({
      recipesContentActive: document.getElementById('recipes').classList.contains('active'),
      moreBtnVisible: getComputedStyle(document.querySelector('.tab-more-btn')).display !== 'none',
      moreBtnActive: document.querySelector('.tab-more-btn').classList.contains('active')
    }));
    expect(state.recipesContentActive, 'Recipes tab content should be showing').toBe(true);
    expect(state.moreBtnVisible, 'the More button must actually be the visible nav element').toBe(true);
    // The regression: this was false — no visible element showed the current tab at all.
    expect(state.moreBtnActive, 'the visible "More" button should show the active/current-tab state').toBe(true);
  });

  test('desktop: Recipes stays a normal primary tab; More is not active for it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.addInitScript(() => {
      try { localStorage.setItem('mealPrepHelpSeen', '1'); } catch (e) {}
      try { localStorage.setItem('pantryOnboardingDone', '1'); } catch (e) {}
    });
    await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);

    const primaryRecipes = page.locator('.tab-btn[data-tab="recipes"]');
    await expect(primaryRecipes).toBeVisible();
    await primaryRecipes.click();
    await page.waitForTimeout(300);

    const state = await page.evaluate(() => ({
      recipesTabActive: document.querySelector('.tab-btn[data-tab="recipes"]').classList.contains('active'),
      moreBtnActive: document.querySelector('.tab-more-btn').classList.contains('active'),
      recipesInMoreMenuVisible: (() => {
        const el = document.querySelector('.tab-more-recipes-link');
        return !!el && getComputedStyle(el).display !== 'none';
      })()
    }));
    expect(state.recipesTabActive, 'the primary desktop Recipes tab should show active').toBe(true);
    expect(state.moreBtnActive, 'More must not appear active just because Recipes is selected on desktop').toBe(false);
    expect(state.recipesInMoreMenuVisible, 'desktop must not show the mobile-only Recipes duplicate in More').toBe(false);
  });
});
