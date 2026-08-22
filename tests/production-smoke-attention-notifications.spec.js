const { test, expect } = require('@playwright/test');

/**
 * Production smoke for the food attention notifications wave (TASK-046, D-058).
 *
 * Runs against the DEPLOYED GitHub Pages build over real HTTPS, so the service
 * worker actually registers — which is the whole point. Firebase is deliberately
 * NOT stubbed; the page loads it for real and stays signed out, the normal
 * first-visit path. Each test gets a fresh isolated context.
 *
 * HEADED vs HEADLESS. Headless Chromium hard-denies the Notifications permission
 * no matter what grantPermissions() says, so the tests that need a genuinely
 * granted permission SKIP with an explicit reason rather than passing vacuously.
 * Run them for real with:
 *
 *     npm run test:smoke:notifications        (== playwright test <this file> --headed)
 *
 * The tests that assert on the deployed bytes, the manifest, the service-worker
 * registration and the no-permission-on-load rule run everywhere, CI included.
 *
 * This whole file is the largest practical substitute for a real Android device,
 * which was not reachable from the build environment. What it still cannot cover
 * is listed in REVIEW.md TASK-046 as an owner/manual item.
 */

const ORIGIN = 'https://shinyamadasan.github.io';
const APP_URL = ORIGIN + '/Meal-Prep/';

test.use({ viewport: { width: 390, height: 844 } });

// Records every notification the page raises, and by WHICH path — the service
// worker's showNotification (what Android Chrome requires) or the page-side
// Notification constructor (which Android Chrome forbids).
const SPY = () => {
  window.__swNotifications = [];
  window.__ctorNotifications = [];
  window.__permissionRequests = 0;
  window.__appBadge = [];

  const realShow = ServiceWorkerRegistration.prototype.showNotification;
  ServiceWorkerRegistration.prototype.showNotification = function (title, opts) {
    window.__swNotifications.push({ title: title, body: (opts || {}).body, tag: (opts || {}).tag });
    try { return realShow.call(this, title, opts); } catch (e) { return Promise.resolve(); }
  };

  const RealNotification = window.Notification;
  function SpiedNotification(title, opts) {
    window.__ctorNotifications.push({ title: title, body: (opts || {}).body });
    return new RealNotification(title, opts);
  }
  SpiedNotification.requestPermission = function () {
    window.__permissionRequests++;
    return RealNotification.requestPermission.apply(RealNotification, arguments);
  };
  Object.defineProperty(SpiedNotification, 'permission', { get: () => RealNotification.permission });
  Object.defineProperty(window, 'Notification', {
    value: SpiedNotification, writable: true, configurable: true
  });

  if (navigator.setAppBadge) {
    const realBadge = navigator.setAppBadge.bind(navigator);
    navigator.setAppBadge = function (n) { window.__appBadge.push(n); return realBadge(n); };
  }
  if (navigator.clearAppBadge) {
    const realClear = navigator.clearAppBadge.bind(navigator);
    navigator.clearAppBadge = function () { window.__appBadge.push(0); return realClear(); };
  }
};

async function loadLiveApp(page, opts) {
  opts = opts || {};
  await page.addInitScript((o) => {
    try {
      if (localStorage.getItem('__attnProdBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__attnProdBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
      if (o.alertPrefs) localStorage.setItem('mealPrepFoodAlerts', JSON.stringify(o.alertPrefs));
    } catch (e) {}
  }, opts);
  await page.addInitScript(SPY);
  // Cache-bust so a stale Pages/CDN copy can never make this pass falsely.
  await page.goto(APP_URL + '?smoke=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load').catch(() => {});
  await page.waitForFunction(
    'typeof AppState !== "undefined" && Array.isArray(AppState.recipes)',
    null,
    { timeout: 45000 }
  );
  await page.waitForTimeout(3000);
}

async function waitForServiceWorker(page) {
  return page.evaluate(() =>
    navigator.serviceWorker.ready.then((r) => ({
      scope: r.scope,
      script: (r.active && r.active.scriptURL) || null,
      canShowNotification: typeof r.showNotification === 'function'
    }))
  );
}

// Grants at the browser level and reports whether it actually took. Headless
// Chromium refuses, so callers skip rather than assert against a fake pass.
async function tryGrantNotifications(page, context) {
  await context.grantPermissions(['notifications'], { origin: ORIGIN });
  return (await page.evaluate(() => Notification.permission)) === 'granted';
}

const SKIP_REASON =
  'headless Chromium hard-denies the Notifications permission; run `npm run test:smoke:notifications` (--headed) for real coverage';

const DAYS_AGO = `(d) => { const t = new Date(); t.setDate(t.getDate() - d);
  return t.getFullYear() + '-' + String(t.getMonth()+1).padStart(2,'0') + '-' + String(t.getDate()).padStart(2,'0'); }`;

// ══ Always run, CI included ═════════════════════════════════════════════════

// ── 1. The shipped bundle is the one under test ─────────────────────────────

test('the deployed build ships the notification wave and no push infrastructure', async ({ page }) => {
  await loadLiveApp(page);

  const present = await page.evaluate(() => ({
    maybeNotifyAttention: typeof maybeNotifyAttention === 'function',
    buildAttentionNotification: typeof buildAttentionNotification === 'function',
    toggleFoodAlerts: typeof toggleFoodAlerts === 'function',
    openAttentionView: typeof openAttentionView === 'function',
    updateAppAttentionBadge: typeof updateAppAttentionBadge === 'function',
    collectAttentionItems: typeof collectAttentionItems === 'function',
    settingsRow: !!document.getElementById('settings-food-alerts-row')
  }));
  for (const k of Object.keys(present)) expect(present[k], k).toBe(true);

  // The honest-scope guarantee, asserted against the deployed source itself.
  const sw = await (await page.request.get(APP_URL + 'sw.js?cb=' + Date.now())).text();
  expect(sw).toContain('notificationclick');
  expect(sw).not.toMatch(/addEventListener\(\s*['"]push['"]/);
  expect(sw).not.toMatch(/periodicsync/);
  expect(sw).not.toMatch(/pushManager/);

  const html = await (await page.request.get(APP_URL + 'index.html?cb=' + Date.now())).text();
  expect(html).not.toMatch(/firebase-messaging|getMessaging|vapid/i);
});

// ── 2. PWA installability + the service worker actually registers ───────────

test('the PWA manifest and a controlling service worker are both live', async ({ page }) => {
  await loadLiveApp(page);

  const manifest = await (await page.request.get(APP_URL + 'manifest.json?cb=' + Date.now())).json();
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe('/Meal-Prep/');
  expect(manifest.scope).toBe('/Meal-Prep/');
  expect(manifest.name).toBeTruthy();
  expect(manifest.icons.length).toBeGreaterThan(0);
  expect(await page.locator('link[rel="manifest"]').count()).toBe(1);

  const reg = await waitForServiceWorker(page);
  expect(reg.script).toContain('/Meal-Prep/sw.js');
  expect(reg.scope).toBe(APP_URL);
  expect(reg.canShowNotification).toBe(true);

  // Served over a secure origin — the precondition for both install and notifications.
  expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
});

// ── 3. Nothing asks for permission on load ──────────────────────────────────
// True regardless of what the browser's permission state happens to be.

test('the live build asks for no notification permission on load', async ({ page }) => {
  await loadLiveApp(page);

  expect(await page.evaluate(() => window.__permissionRequests)).toBe(0);
  expect(await page.evaluate(() => loadFoodAlertPrefs().enabled)).toBe(false);
  expect(await page.evaluate(() => window.__swNotifications.length)).toBe(0);

  await page.evaluate(() => openSettingsModal());
  // 'Off' when the permission is still askable, 'Blocked…' where the browser
  // pre-denies (headless). Either way the app asked for nothing.
  const state = await page.locator('#settings-food-alerts-state').innerText();
  expect(['Off', 'Blocked in browser settings']).toContain(state);
  expect(await page.evaluate(() => window.__permissionRequests)).toBe(0);
});

// ── 4. The tap path leads to Needs Attention ────────────────────────────────

test('the notification tap path lands on the Needs Attention card', async ({ page }) => {
  await loadLiveApp(page);

  // The deployed worker focuses the client and posts this exact message.
  const sw = await (await page.request.get(APP_URL + 'sw.js?cb=' + Date.now())).text();
  expect(sw).toContain("postMessage({ type: 'show-attention' })");
  expect(sw).toContain('c.focus()');
  expect(sw).toContain('openWindow');

  const result = await page.evaluate(async (fn) => {
    const daysAgo = eval(fn);
    AppState.pantry = [{ id: 900301, name: 'Chicken Breast', category: 'Protein', purchaseDate: daysAgo(10), shelfLifeDays: 2 }];
    AppState.cookedMeals = [];
    renderDashboard();
    showTab('grocery');

    // Exactly what sw.js posts on notificationclick.
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'show-attention' } }));
    openAttentionView();
    await new Promise((r) => setTimeout(r, 300));

    return {
      activeTab: document.querySelector('.tab-btn.active').getAttribute('data-tab'),
      cardPresent: !!document.querySelector('.dash-card--warn'),
      keepButtons: document.querySelectorAll('.dash-keep-btn').length,
      removeButtons: document.querySelectorAll('.dash-remove-btn').length
    };
  }, DAYS_AGO);

  expect(result.activeTab).toBe('dashboard');
  expect(result.cardPresent).toBe(true);
  expect(result.keepButtons).toBeGreaterThan(0);   // Keep / Remove are reachable
  expect(result.removeButtons).toBeGreaterThan(0);
});

// ── 5. App badge ────────────────────────────────────────────────────────────

test('the app badge reflects outstanding attention items where supported', async ({ page }) => {
  await loadLiveApp(page);

  const result = await page.evaluate(async (fn) => {
    const daysAgo = eval(fn);
    AppState.pantry = [
      { id: 900401, name: 'Chicken', category: 'Protein', purchaseDate: daysAgo(10), shelfLifeDays: 2 },
      { id: 900402, name: 'Broccoli', category: 'Vegetable', purchaseDate: daysAgo(4), shelfLifeDays: 5 }
    ];
    AppState.cookedMeals = [];
    window.__appBadge.length = 0;
    refreshFreshnessAlerts();
    await new Promise((r) => setTimeout(r, 200));
    const alerts = getFreshnessAlerts();
    const withFood = window.__appBadge.slice();

    AppState.pantry = [];
    window.__appBadge.length = 0;
    refreshFreshnessAlerts();
    await new Promise((r) => setTimeout(r, 200));

    return {
      supported: typeof navigator.setAppBadge === 'function',
      expected: alerts.expired + alerts.expiring,
      withFood: withFood,
      whenEmpty: window.__appBadge.slice()
    };
  }, DAYS_AGO);

  expect(result.expected).toBe(2);
  if (result.supported) {
    expect(result.withFood).toEqual([2]);   // badge set to the outstanding count
    expect(result.whenEmpty).toEqual([0]);  // and cleared when nothing is outstanding
  } else {
    // Feature-detected away without throwing — the documented degradation.
    expect(result.withFood).toEqual([]);
  }
});

// ══ Need a genuinely granted permission — headed only ═══════════════════════

// ── 6. Permission is requested only by a deliberate tap ─────────────────────

test('permission is requested only when the user taps, on the live build', async ({ page, context }) => {
  await loadLiveApp(page);
  test.skip(!(await tryGrantNotifications(page, context)), SKIP_REASON);

  // Granted at browser level, but the app has still asked for nothing.
  expect(await page.evaluate(() => window.__permissionRequests)).toBe(0);
  expect(await page.evaluate(() => loadFoodAlertPrefs().enabled)).toBe(false);

  await page.evaluate(() => { openSettingsModal(); renderFoodAlertSetting(); });
  await expect(page.locator('#settings-food-alerts-state')).toHaveText('Off');

  await page.click('#settings-food-alerts-row');
  await page.waitForTimeout(600);

  expect(await page.evaluate(() => window.__permissionRequests)).toBe(1);
  expect(await page.evaluate(() => Notification.permission)).toBe('granted');
  expect(await page.evaluate(() => loadFoodAlertPrefs().enabled)).toBe(true);
  await expect(page.locator('#settings-food-alerts-state')).toHaveText('On');
});

// ── 7. One grouped notification, via the service-worker path ────────────────

test('an eligible attention state fires ONE grouped notification through the service worker', async ({ page, context }) => {
  await loadLiveApp(page, { alertPrefs: { enabled: true, announced: {} } });
  test.skip(!(await tryGrantNotifications(page, context)), SKIP_REASON);
  await waitForServiceWorker(page);

  const result = await page.evaluate(async (fn) => {
    const daysAgo = eval(fn);
    AppState.pantry = [
      { id: 900101, name: 'Chicken Breast', category: 'Protein', purchaseDate: daysAgo(10), shelfLifeDays: 2 },
      { id: 900102, name: 'Milk', category: 'Dairy', purchaseDate: daysAgo(12), shelfLifeDays: 5 },
      { id: 900103, name: 'Broccoli', category: 'Vegetable', purchaseDate: daysAgo(4), shelfLifeDays: 5 },
      { id: 900104, name: 'Carrots', category: 'Vegetable', purchaseDate: daysAgo(4), shelfLifeDays: 5 }
    ];
    AppState.cookedMeals = [
      { id: 'p900201', name: 'Chicken Adobo', cookedDate: daysAgo(6), storage: 'fridge', fridgeLife: 4, freezerLife: 90 }
    ];
    window.__swNotifications.length = 0;
    window.__ctorNotifications.length = 0;
    await maybeNotifyAttention();
    await new Promise((r) => setTimeout(r, 400));
    return {
      sw: window.__swNotifications.slice(),
      ctor: window.__ctorNotifications.slice(),
      permission: Notification.permission,
      expired: collectAttentionItems().expired.length,
      useSoon: collectAttentionItems().useSoon.length
    };
  }, DAYS_AGO);

  expect(result.permission).toBe('granted');
  expect(result.expired).toBe(3);   // 2 pantry + 1 cooked
  expect(result.useSoon).toBe(2);

  // ONE notification for five items — grouped, never per ingredient.
  expect(result.sw).toHaveLength(1);
  // And raised via the SW, which is what Android Chrome requires.
  expect(result.ctor).toHaveLength(0);

  expect(result.sw[0].title).toBe('3 foods expired');
  expect(result.sw[0].tag).toBe('meal-prep-attention');
  expect(result.sw[0].body).toBe('Open Meal Prep to review them. Broccoli and Carrots should be used soon.');

  // Never tells the user to eat expired food.
  const text = (result.sw[0].title + ' ' + result.sw[0].body).toLowerCase();
  expect(text).toContain('review');
  for (const w of ['eat', 'consume', 'cook it', 'use it', 'use them']) expect(text).not.toContain(w);
});

// ── 8. Unchanged food never repeats, on the live build ──────────────────────

test('unchanged food does not notify again, across passes and across a reload', async ({ page, context }) => {
  await loadLiveApp(page, { alertPrefs: { enabled: true, announced: {} } });
  test.skip(!(await tryGrantNotifications(page, context)), SKIP_REASON);
  await waitForServiceWorker(page);

  const first = await page.evaluate(async (fn) => {
    const daysAgo = eval(fn);
    AppState.pantry = [{ id: 900501, name: 'Chicken', category: 'Protein', purchaseDate: daysAgo(10), shelfLifeDays: 2 }];
    AppState.cookedMeals = [];
    saveToLocalStorage();
    window.__swNotifications.length = 0;
    await maybeNotifyAttention();
    const one = window.__swNotifications.length;
    await maybeNotifyAttention();
    await maybeNotifyAttention();
    return { one: one, total: window.__swNotifications.length, ledger: loadFoodAlertPrefs().announced };
  }, DAYS_AGO);

  expect(first.one).toBe(1);
  expect(first.total).toBe(1);
  expect(first.ledger).toEqual({ 'pantry:900501': 'expired' });

  // Reload: same unchanged food, silence.
  await page.goto(APP_URL + '?smoke=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction('typeof AppState !== "undefined"', null, { timeout: 45000 });
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => window.__swNotifications.length)).toBe(0);

  // A genuinely new item still gets through.
  const after = await page.evaluate(async (fn) => {
    const daysAgo = eval(fn);
    AppState.pantry.push({ id: 900502, name: 'Milk', category: 'Dairy', purchaseDate: daysAgo(20), shelfLifeDays: 5 });
    window.__swNotifications.length = 0;
    await maybeNotifyAttention();
    return window.__swNotifications.slice();
  }, DAYS_AGO);
  expect(after).toHaveLength(1);
  expect(after[0].title).toBe('Milk expired');
});

// ── 9. The app never implies background push exists ─────────────────────────

test('closing and reopening produces nothing, and the UI says so plainly', async ({ page, context }) => {
  await loadLiveApp(page, { alertPrefs: { enabled: true, announced: {} } });

  // The Settings copy states the limitation in the product surface, not just the
  // docs. This half holds regardless of permission state.
  await page.evaluate(() => openSettingsModal());
  const note = await page.locator('.settings-row-note').first().innerText();
  expect(note.toLowerCase()).toContain('no notification server');
  expect(note.toLowerCase()).toContain('while it is closed');
  await page.evaluate(() => closeSettingsModal());

  test.skip(!(await tryGrantNotifications(page, context)), SKIP_REASON);

  // Seed food, then simulate the app being backgrounded and closed.
  await page.evaluate(async (fn) => {
    const daysAgo = eval(fn);
    AppState.pantry = [{ id: 900601, name: 'Chicken', category: 'Protein', purchaseDate: daysAgo(10), shelfLifeDays: 2 }];
    AppState.cookedMeals = [];
    saveToLocalStorage();
    await maybeNotifyAttention();       // the open-time alert
  }, DAYS_AGO);

  await page.close();
  // Wait off-page: the app really is gone, so nothing in it can be doing the waiting.
  await new Promise((r) => setTimeout(r, 2500));

  // A brand-new page in the same context: nothing arrived while the app was closed,
  // and the previously-announced item stays silent on reopen.
  const page2 = await context.newPage();
  await page2.addInitScript(SPY);
  await page2.goto(APP_URL + '?smoke=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await page2.waitForFunction('typeof AppState !== "undefined"', null, { timeout: 45000 });
  await page2.waitForTimeout(3000);

  expect(await page2.evaluate(() => window.__swNotifications.length)).toBe(0);
  expect(await page2.evaluate(() => window.__ctorNotifications.length)).toBe(0);

  // Nothing in the running app ever subscribed to a push service.
  const subscription = await page2.evaluate(() =>
    navigator.serviceWorker.ready
      .then((r) => (r.pushManager ? r.pushManager.getSubscription() : null))
      .catch(() => null)
  );
  expect(subscription).toBeNull();
});
