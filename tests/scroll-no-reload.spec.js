const { test, expect } = require('@playwright/test');
const { waitForAppReady } = require('./app-ready');

/**
 * Scrolling must never reload the app.
 *
 * setupMobileEnhancements() used to install a hand-rolled pull-to-refresh: any touch that
 * STARTED while window.scrollY === 0 and then travelled 100px downward called
 * location.reload(). The window scroll position says nothing about what the finger is
 * actually scrolling — a modal's own list, the recipe picker, Prep Mode — so an ordinary
 * scroll gesture at the top of the page, or inside any open modal while the page behind
 * it sat at the top, wiped the page and every unsaved field on it.
 *
 * It only ran for a mobile user agent, which is why desktop specs never saw it. These
 * tests boot with a phone UA + touch so the mobile code path is really installed.
 */

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
});

async function loadMobileApp(page) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(() => {
    try {
      if (sessionStorage.getItem('__scrollBootstrapped')) return;
      localStorage.clear();
      sessionStorage.setItem('__scrollBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
  });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
}

// A finger drag from (x, fromY) to (x, toY) on `selector`, in 10 moves — the same event
// sequence a real swipe produces. Synthetic touches do not scroll the page; they only
// exercise the app's own touch handlers, which is exactly what is under test.
async function swipe(page, selector, fromY, toY) {
  await page.evaluate(({ selector, fromY, toY }) => {
    const target = document.querySelector(selector) || document.body;
    const mk = (y) => new Touch({ identifier: 1, target, clientX: 180, clientY: y });
    const fire = (type, y) => {
      const t = mk(y);
      target.dispatchEvent(new TouchEvent(type, {
        bubbles: true, cancelable: true,
        touches: type === 'touchend' ? [] : [t],
        targetTouches: type === 'touchend' ? [] : [t],
        changedTouches: [t]
      }));
    };
    fire('touchstart', fromY);
    for (let i = 1; i <= 10; i++) fire('touchmove', fromY + ((toY - fromY) * i) / 10);
    fire('touchend', toY);
  }, { selector, fromY, toY });
}

test('mobile code path is actually installed for this user agent', async ({ page }) => {
  await loadMobileApp(page);
  // Guards the other tests: without this they could pass by never running mobile code.
  expect(await page.evaluate(() => document.body.classList.contains('mobile-device'))).toBe(true);
});

test('a downward drag at the top of the page does not reload the app or lose typed input', async ({ page }) => {
  await loadMobileApp(page);
  let navigations = 0;
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations++; });

  await page.evaluate(() => {
    window.__noReloadSentinel = 'alive';
    showTab('fridge');
  });
  await page.fill('#pantry-input', 'half-typed item');
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  await swipe(page, '#fridge', 200, 520);
  await page.waitForTimeout(300);

  expect(navigations).toBe(0);
  expect(await page.evaluate(() => window.__noReloadSentinel)).toBe('alive');
  await expect(page.locator('#pantry-input')).toHaveValue('half-typed item');
});

test('scrolling back up inside an open modal does not reload the app', async ({ page }) => {
  await loadMobileApp(page);
  let navigations = 0;
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations++; });

  await page.evaluate(() => {
    window.__noReloadSentinel = 'alive';
    openManualCookedModal();
  });
  await page.fill('#manual-cooked-name', 'Leftover curry');

  await swipe(page, '#manual-cooked-modal .modal-content', 150, 600);
  await page.waitForTimeout(300);

  expect(navigations).toBe(0);
  expect(await page.evaluate(() => window.__noReloadSentinel)).toBe('alive');
  await expect(page.locator('#manual-cooked-name')).toHaveValue('Leftover curry');
});

test('no touch handler in the app can trigger a page reload', async ({ page }) => {
  await loadMobileApp(page);
  // Belt and braces: a long pull from the very top, the exact gesture the old handler
  // treated as "refresh", must be a no-op for app state too.
  const before = await page.evaluate(() => {
    AppState.pantry.push({ id: 'buy_scroll_1', name: 'Unsaved Carrot', category: 'Vegetable' });
    window.__noReloadSentinel = 'alive';
    return AppState.pantry.length;
  });
  await swipe(page, 'body', 10, 700);
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({
    sentinel: window.__noReloadSentinel,
    pantry: AppState.pantry.length
  }));
  expect(after.sentinel).toBe('alive');
  expect(after.pantry).toBe(before);
});
