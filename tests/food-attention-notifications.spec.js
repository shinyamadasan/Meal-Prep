const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

/**
 * Food Attention Notifications wave.
 *
 * The product rules this file exists to prove:
 *   The browser is never asked for permission until the user taps Enable.
 *   A denial changes nothing else about the app.
 *   Notifications CONSUME Kitchen Truth (D-057) — they never re-derive expiry.
 *   Expired food is offered for review, never for eating.
 *   Many attention items produce ONE grouped notification.
 *   Unchanged food never announces twice; genuinely new food announces once.
 */

test.use({ viewport: { width: 1280, height: 1700 } });

// Replaces the real Notification API with a recorder, installed before app.js
// runs so nothing the app does at load can slip past it.
const NOTIFICATION_STUB = () => {
  window.__notifications = [];
  window.__permissionRequests = 0;
  var perm = window.__initialPermission || 'default';
  function FakeNotification(title, opts) {
    window.__notifications.push({
      title: title,
      body: (opts && opts.body) || '',
      tag: (opts && opts.tag) || ''
    });
    this.close = function () {};
  }
  Object.defineProperty(FakeNotification, 'permission', { get: function () { return perm; } });
  FakeNotification.requestPermission = function () {
    window.__permissionRequests++;
    perm = window.__permissionAnswer || 'granted';
    return Promise.resolve(perm);
  };
  window.__setPermission = function (p) { perm = p; };
  Object.defineProperty(window, 'Notification', {
    value: FakeNotification, writable: true, configurable: true
  });
};

async function loadLocalApp(page, opts) {
  opts = opts || {};
  await page.route('**/firebasejs/**', (r) => r.abort());
  // Config FIRST: NOTIFICATION_STUB reads __initialPermission when it installs.
  await page.addInitScript((o) => {
    // Window-level stub config is re-applied on every load; storage is seeded ONCE
    // so a reload sees what the previous page actually persisted.
    if (o.initialPermission) window.__initialPermission = o.initialPermission;
    if (o.permissionAnswer) window.__permissionAnswer = o.permissionAnswer;
    try {
      if (localStorage.getItem('__attnBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__attnBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
      if (o.alertPrefs) localStorage.setItem('mealPrepFoodAlerts', JSON.stringify(o.alertPrefs));
      if (o.savedData) localStorage.setItem('mealPrepAppData', JSON.stringify(o.savedData));
    } catch (e) {}
  }, opts);
  await page.addInitScript(NOTIFICATION_STUB);
  await page.goto(pathToFileURL(path.resolve('index.html')).href, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
}

// Local calendar date N days ago — daysLeftFrom()/todayISO() work in local time.
const LOCAL_DAY_FN = `(d) => {
  const t = new Date();
  t.setDate(t.getDate() - d);
  return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
}`;

// Puts the kitchen into a known state, opts the user in, and runs one pass.
async function runAttentionPass(page, setup) {
  return page.evaluate(async ({ setupSrc, dayFnSrc }) => {
    const daysAgo = eval(dayFnSrc);
    eval('(' + setupSrc + ')')(daysAgo);
    window.__notifications.length = 0;
    await maybeNotifyAttention();
    return window.__notifications.slice();
  }, { setupSrc: setup.toString(), dayFnSrc: LOCAL_DAY_FN });
}

// ── 1. Permission is only ever requested by a deliberate tap ────────────────

test('nothing asks for notification permission on page load', async ({ page }) => {
  await loadLocalApp(page);
  expect(await page.evaluate(() => window.__permissionRequests)).toBe(0);
  expect(await page.evaluate(() => Notification.permission)).toBe('default');
  expect(await page.evaluate(() => loadFoodAlertPrefs().enabled)).toBe(false);
});

test('permission is requested only when the user taps the Settings row', async ({ page }) => {
  await loadLocalApp(page);

  await page.evaluate(() => openSettingsModal());
  expect(await page.evaluate(() => window.__permissionRequests)).toBe(0);
  await expect(page.locator('#settings-food-alerts-state')).toHaveText('Off');

  await page.click('#settings-food-alerts-row');
  await page.waitForTimeout(300);

  expect(await page.evaluate(() => window.__permissionRequests)).toBe(1);
  expect(await page.evaluate(() => loadFoodAlertPrefs().enabled)).toBe(true);
  await expect(page.locator('#settings-food-alerts-state')).toHaveText('On');
});

test('turning alerts back off does not re-prompt and stops notifying', async ({ page }) => {
  await loadLocalApp(page);
  await page.evaluate(() => openSettingsModal());
  await page.click('#settings-food-alerts-row');
  await page.waitForTimeout(200);
  await page.click('#settings-food-alerts-row');
  await page.waitForTimeout(200);

  expect(await page.evaluate(() => window.__permissionRequests)).toBe(1);
  expect(await page.evaluate(() => loadFoodAlertPrefs().enabled)).toBe(false);
  await expect(page.locator('#settings-food-alerts-state')).toHaveText('Off');

  const fired = await runAttentionPass(page, (daysAgo) => {
    AppState.pantry = [{ id: 1, name: 'Chicken Breast', category: 'Protein', purchaseDate: daysAgo(20), shelfLifeDays: 3 }];
    AppState.cookedMeals = [];
  });
  expect(fired).toHaveLength(0);
});

// ── 2. A denial breaks nothing ──────────────────────────────────────────────

test('a denied permission leaves the app fully working', async ({ page }) => {
  await loadLocalApp(page, { permissionAnswer: 'denied' });

  await page.evaluate(() => openSettingsModal());
  await page.click('#settings-food-alerts-row');
  await page.waitForTimeout(300);

  expect(await page.evaluate(() => loadFoodAlertPrefs().enabled)).toBe(false);
  await expect(page.locator('#settings-food-alerts-state')).toHaveText('Blocked in browser settings');
  await expect(page.locator('#settings-food-alerts-row')).toBeDisabled();

  // The rest of the app still renders and the attention machinery still works.
  const state = await page.evaluate(async (dayFnSrc) => {
    const daysAgo = eval(dayFnSrc);
    AppState.pantry = [{ id: 1, name: 'Chicken Breast', category: 'Protein', purchaseDate: daysAgo(20), shelfLifeDays: 3 }];
    AppState.cookedMeals = [];
    closeSettingsModal();
    renderDashboard();
    refreshFreshnessAlerts();
    const fired = await maybeNotifyAttention();
    return {
      fired: fired,
      expiredCount: collectAttentionItems().expired.length,
      bannerVisible: !document.getElementById('freshness-alert-banner').classList.contains('hidden'),
      attentionCardOnScreen: !!document.querySelector('.dash-card--warn'),
      keepButtons: document.querySelectorAll('.dash-keep-btn').length
    };
  }, LOCAL_DAY_FN);

  expect(state.fired).toBeNull();
  expect(state.expiredCount).toBe(1);
  expect(state.bannerVisible).toBe(true);
  expect(state.attentionCardOnScreen).toBe(true);
  expect(state.keepButtons).toBe(1);
});

test('a browser with no Notification API at all does not break the app', async ({ page }) => {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
    // iOS Safari in a normal tab looks exactly like this.
    delete window.Notification;
  });
  await page.goto(pathToFileURL(path.resolve('index.html')).href, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const result = await page.evaluate(async () => {
    openSettingsModal();
    const enabled = await toggleFoodAlerts();
    const fired = await maybeNotifyAttention();
    return {
      supported: notificationsSupported(),
      permission: notificationPermission(),
      enabled: enabled,
      fired: fired,
      stateText: document.getElementById('settings-food-alerts-state').textContent,
      disabled: document.getElementById('settings-food-alerts-row').disabled,
      dashboardRendered: !!document.getElementById('dashboard')
    };
  });

  expect(result.supported).toBe(false);
  expect(result.permission).toBe('unsupported');
  expect(result.enabled).toBe(false);
  expect(result.fired).toBeNull();
  expect(result.stateText).toBe('Not supported on this browser');
  expect(result.disabled).toBe(true);
  expect(result.dashboardRendered).toBe(true);
});

// ── 3. Classification comes from Kitchen Truth, not a second system ─────────

test('expired and use-soon come from the existing pantryDaysLeft boundaries', async ({ page }) => {
  await loadLocalApp(page, { initialPermission: 'granted', alertPrefs: { enabled: true, announced: {} } });

  const result = await page.evaluate((dayFnSrc) => {
    const daysAgo = eval(dayFnSrc);
    // shelfLifeDays 3, bought N days ago → daysLeft = 3 - N.
    AppState.pantry = [
      { id: 1, name: 'Expired Item', category: 'Protein', purchaseDate: daysAgo(5), shelfLifeDays: 3 },  // -2
      { id: 2, name: 'Today Item', category: 'Protein', purchaseDate: daysAgo(3), shelfLifeDays: 3 },    //  0
      { id: 3, name: 'Boundary Item', category: 'Protein', purchaseDate: daysAgo(1), shelfLifeDays: 3 }, // +2 == WARN
      { id: 4, name: 'Fresh Item', category: 'Protein', purchaseDate: daysAgo(0), shelfLifeDays: 3 }     // +3 > WARN
    ];
    AppState.cookedMeals = [];
    const a = collectAttentionItems();
    return {
      warnDays: FRESHNESS_WARN_DAYS,
      daysLeft: AppState.pantry.map((p) => pantryDaysLeft(p)),
      expired: a.expired.map((e) => e.name),
      useSoon: a.useSoon.map((e) => e.name)
    };
  }, LOCAL_DAY_FN);

  expect(result.warnDays).toBe(2);
  expect(result.daysLeft).toEqual([-2, 0, 2, 3]);
  expect(result.expired).toEqual(['Expired Item']);
  expect(result.useSoon).toEqual(['Today Item', 'Boundary Item']);
  // "Fresh Item" is in neither bucket — the notification layer added no boundary.
});

test('the notification layer defines no expiry rules of its own', async ({ page }) => {
  await loadLocalApp(page, { initialPermission: 'granted', alertPrefs: { enabled: true, announced: {} } });

  // Force collectAttentionItems() to lie, and prove the notification follows it.
  const notes = await page.evaluate(async () => {
    const real = window.collectAttentionItems;
    window.collectAttentionItems = () => ({
      expired: [],
      useSoon: [{ kind: 'pantry', id: 'X', name: 'Only Truth', daysLeft: 1 }],
      low: []
    });
    window.__notifications.length = 0;
    await maybeNotifyAttention();
    window.collectAttentionItems = real;
    return window.__notifications.slice();
  });

  expect(notes).toHaveLength(1);
  expect(notes[0].title).toBe('Food needs attention');
  expect(notes[0].body).toBe('Only Truth should be used soon.');
});

// ── 4. Expired food is never suggested for eating ───────────────────────────

test('expired copy asks the user to review, never to eat', async ({ page }) => {
  await loadLocalApp(page, { initialPermission: 'granted', alertPrefs: { enabled: true, announced: {} } });

  const notes = await runAttentionPass(page, (daysAgo) => {
    AppState.pantry = [
      { id: 1, name: 'Chicken Breast', category: 'Protein', purchaseDate: daysAgo(10), shelfLifeDays: 3 },
      { id: 2, name: 'Old Milk', category: 'Dairy', purchaseDate: daysAgo(20), shelfLifeDays: 5 }
    ];
    AppState.cookedMeals = [];
  });

  expect(notes).toHaveLength(1);
  const text = (notes[0].title + ' ' + notes[0].body).toLowerCase();
  expect(text).toContain('review');
  for (const word of ['use soon', 'used soon', 'eat', 'cook', 'consume', 'use it', 'use them']) {
    expect(text).not.toContain(word);
  }
});

test('a mixed kitchen only ever offers the use-soon items for using', async ({ page }) => {
  await loadLocalApp(page, { initialPermission: 'granted', alertPrefs: { enabled: true, announced: {} } });

  const notes = await runAttentionPass(page, (daysAgo) => {
    AppState.pantry = [
      { id: 1, name: 'Rotten Fish', category: 'Protein', purchaseDate: daysAgo(30), shelfLifeDays: 2 },
      { id: 2, name: 'Broccoli', category: 'Vegetable', purchaseDate: daysAgo(4), shelfLifeDays: 5 } // +1
    ];
    AppState.cookedMeals = [];
  });

  expect(notes).toHaveLength(1);
  expect(notes[0].title).toBe('Rotten Fish expired');
  expect(notes[0].body).toBe('Open Meal Prep to review it. Broccoli should be used soon.');
  // The expired item's name never appears next to "used soon".
  expect(notes[0].body).not.toContain('Rotten Fish');
});

// ── 5. One grouped notification, never one per ingredient ───────────────────

test('several attention items produce exactly one grouped notification', async ({ page }) => {
  await loadLocalApp(page, { initialPermission: 'granted', alertPrefs: { enabled: true, announced: {} } });

  const notes = await runAttentionPass(page, (daysAgo) => {
    AppState.pantry = [
      { id: 1, name: 'Chicken', category: 'Protein', purchaseDate: daysAgo(10), shelfLifeDays: 2 },
      { id: 2, name: 'Pork', category: 'Protein', purchaseDate: daysAgo(10), shelfLifeDays: 2 },
      { id: 3, name: 'Fish', category: 'Protein', purchaseDate: daysAgo(10), shelfLifeDays: 2 },
      { id: 4, name: 'Broccoli', category: 'Vegetable', purchaseDate: daysAgo(4), shelfLifeDays: 5 },
      { id: 5, name: 'Carrots', category: 'Vegetable', purchaseDate: daysAgo(4), shelfLifeDays: 5 }
    ];
    AppState.cookedMeals = [];
  });

  expect(notes).toHaveLength(1);
  expect(notes[0].title).toBe('3 foods expired');
  expect(notes[0].body).toBe('Open Meal Prep to review them. Broccoli and Carrots should be used soon.');
  expect(notes[0].tag).toBe('meal-prep-attention'); // replaces, never stacks
});

test('a long use-soon list is summarised rather than listed item by item', async ({ page }) => {
  await loadLocalApp(page, { initialPermission: 'granted', alertPrefs: { enabled: true, announced: {} } });

  const notes = await runAttentionPass(page, (daysAgo) => {
    AppState.pantry = ['A Item', 'B Item', 'C Item', 'D Item'].map((n, i) => ({
      id: 10 + i, name: n, category: 'Vegetable', purchaseDate: daysAgo(4), shelfLifeDays: 5
    }));
    AppState.cookedMeals = [];
  });

  expect(notes).toHaveLength(1);
  expect(notes[0].title).toBe('Food needs attention');
  expect(notes[0].body).toBe('A Item, B Item and 2 more should be used soon.');
});

// ── 6. Deduplication ────────────────────────────────────────────────────────

test('unchanged food does not notify again on later opens', async ({ page }) => {
  await loadLocalApp(page, { initialPermission: 'granted', alertPrefs: { enabled: true, announced: {} } });

  const result = await page.evaluate(async (dayFnSrc) => {
    const daysAgo = eval(dayFnSrc);
    AppState.pantry = [
      { id: 1, name: 'Chicken', category: 'Protein', purchaseDate: daysAgo(10), shelfLifeDays: 2 },
      { id: 2, name: 'Broccoli', category: 'Vegetable', purchaseDate: daysAgo(4), shelfLifeDays: 5 }
    ];
    AppState.cookedMeals = [];

    window.__notifications.length = 0;
    await maybeNotifyAttention();
    const first = window.__notifications.length;

    // Three more "opens"/resumes with the exact same kitchen.
    await maybeNotifyAttention();
    await maybeNotifyAttention();
    await maybeNotifyAttention();

    return { first: first, total: window.__notifications.length, ledger: loadFoodAlertPrefs().announced };
  }, LOCAL_DAY_FN);

  expect(result.first).toBe(1);
  expect(result.total).toBe(1);
  expect(result.ledger).toEqual({ 'pantry:1': 'expired', 'pantry:2': 'use-soon' });
});

test('the dedup ledger survives a reload', async ({ page }) => {
  const savedData = {
    pantry: [{ id: 1, name: 'Chicken', category: 'Protein', purchaseDate: '2000-01-01', shelfLifeDays: 2 }],
    cookedMeals: [], recipes: [], groceryList: []
  };
  await loadLocalApp(page, {
    initialPermission: 'granted',
    alertPrefs: { enabled: true, announced: {} },
    savedData: savedData
  });
  // First open announced it.
  expect(await page.evaluate(() => window.__notifications.length)).toBe(1);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  // Second open: same unchanged food, silence.
  expect(await page.evaluate(() => window.__notifications.length)).toBe(0);
  expect(await page.evaluate(() => loadFoodAlertPrefs().announced['pantry:1'])).toBe('expired');
});

// ── 7. Genuinely new food still gets through ────────────────────────────────

test('a newly use-soon item and a newly expired item each notify once', async ({ page }) => {
  await loadLocalApp(page, { initialPermission: 'granted', alertPrefs: { enabled: true, announced: {} } });

  const result = await page.evaluate(async (dayFnSrc) => {
    const daysAgo = eval(dayFnSrc);
    const out = {};
    AppState.cookedMeals = [];

    // Day 1: one item with 1 day left.
    AppState.pantry = [{ id: 1, name: 'Broccoli', category: 'Vegetable', purchaseDate: daysAgo(4), shelfLifeDays: 5 }];
    window.__notifications.length = 0;
    await maybeNotifyAttention();
    out.firstRun = window.__notifications.slice();

    // Same item, unchanged.
    window.__notifications.length = 0;
    await maybeNotifyAttention();
    out.repeat = window.__notifications.slice();

    // A brand-new use-soon item joins it.
    AppState.pantry.push({ id: 2, name: 'Carrots', category: 'Vegetable', purchaseDate: daysAgo(4), shelfLifeDays: 5 });
    window.__notifications.length = 0;
    await maybeNotifyAttention();
    out.newUseSoon = window.__notifications.slice();

    // Broccoli now crosses into expired — genuinely new news about known food.
    AppState.pantry[0].purchaseDate = daysAgo(10);
    window.__notifications.length = 0;
    await maybeNotifyAttention();
    out.crossedToExpired = window.__notifications.slice();

    // ...and stays quiet afterwards.
    window.__notifications.length = 0;
    await maybeNotifyAttention();
    out.afterExpired = window.__notifications.slice();

    return out;
  }, LOCAL_DAY_FN);

  expect(result.firstRun).toHaveLength(1);
  expect(result.firstRun[0].body).toBe('Broccoli should be used soon.');

  expect(result.repeat).toHaveLength(0);

  expect(result.newUseSoon).toHaveLength(1);
  expect(result.newUseSoon[0].body).toBe('Carrots should be used soon.');

  expect(result.crossedToExpired).toHaveLength(1);
  expect(result.crossedToExpired[0].title).toBe('Broccoli expired');

  expect(result.afterExpired).toHaveLength(0);
});

test('food removed and later re-added can notify again', async ({ page }) => {
  await loadLocalApp(page, { initialPermission: 'granted', alertPrefs: { enabled: true, announced: {} } });

  const result = await page.evaluate(async (dayFnSrc) => {
    const daysAgo = eval(dayFnSrc);
    const item = { id: 1, name: 'Chicken', category: 'Protein', purchaseDate: daysAgo(10), shelfLifeDays: 2 };
    AppState.cookedMeals = [];

    AppState.pantry = [item];
    window.__notifications.length = 0;
    await maybeNotifyAttention();
    const first = window.__notifications.length;

    AppState.pantry = [];
    await maybeNotifyAttention();
    const ledgerAfterRemoval = loadFoodAlertPrefs().announced;

    AppState.pantry = [item];
    window.__notifications.length = 0;
    await maybeNotifyAttention();
    return { first: first, ledgerAfterRemoval: ledgerAfterRemoval, again: window.__notifications.length };
  }, LOCAL_DAY_FN);

  expect(result.first).toBe(1);
  expect(result.ledgerAfterRemoval).toEqual({});
  expect(result.again).toBe(1);
});

// ── 8. Keep suppression (D-057) ─────────────────────────────────────────────

test('food kept today is never announced', async ({ page }) => {
  await loadLocalApp(page, { initialPermission: 'granted', alertPrefs: { enabled: true, announced: {} } });

  const result = await page.evaluate(async (dayFnSrc) => {
    const daysAgo = eval(dayFnSrc);
    AppState.pantry = [{ id: 1, name: 'Parmesan', category: 'Dairy', purchaseDate: daysAgo(30), shelfLifeDays: 5 }];
    AppState.cookedMeals = [];

    // Keep it before it was ever announced.
    keepAttentionItem('pantry', 1);
    window.__notifications.length = 0;
    await maybeNotifyAttention();

    return {
      keptToday: isKeptToday(AppState.pantry[0]),
      stillExpiredOnCard: pantryDaysLeft(AppState.pantry[0]) < 0,
      inAttentionList: collectAttentionItems().expired.length,
      notes: window.__notifications.slice(),
      ledger: loadFoodAlertPrefs().announced
    };
  }, LOCAL_DAY_FN);

  expect(result.keptToday).toBe(true);
  expect(result.stillExpiredOnCard).toBe(true); // Inventory still tells the truth
  expect(result.inAttentionList).toBe(0);
  expect(result.notes).toHaveLength(0);
  expect(result.ledger).toEqual({});
});

test('tapping Keep after an alert stops the next alert', async ({ page }) => {
  await loadLocalApp(page, { initialPermission: 'granted', alertPrefs: { enabled: true, announced: {} } });

  const result = await page.evaluate(async (dayFnSrc) => {
    const daysAgo = eval(dayFnSrc);
    AppState.pantry = [{ id: 1, name: 'Parmesan', category: 'Dairy', purchaseDate: daysAgo(30), shelfLifeDays: 5 }];
    AppState.cookedMeals = [];

    window.__notifications.length = 0;
    await maybeNotifyAttention();
    const first = window.__notifications.length;

    keepAttentionItem('pantry', 1);
    window.__notifications.length = 0;
    await maybeNotifyAttention();
    return { first: first, afterKeep: window.__notifications.length, ledger: loadFoodAlertPrefs().announced };
  }, LOCAL_DAY_FN);

  expect(result.first).toBe(1);
  expect(result.afterKeep).toBe(0);
  expect(result.ledger).toEqual({});
});

// ── 9. Cooked Ready Food is included ────────────────────────────────────────

test('cooked meals in the fridge use their own shelf life and share the alert', async ({ page }) => {
  await loadLocalApp(page, { initialPermission: 'granted', alertPrefs: { enabled: true, announced: {} } });

  const result = await page.evaluate(async (dayFnSrc) => {
    const daysAgo = eval(dayFnSrc);
    AppState.pantry = [];
    AppState.cookedMeals = [
      { id: 'c1', name: 'Adobo', cookedDate: daysAgo(6), storage: 'fridge', fridgeLife: 4, freezerLife: 90 },  // -2
      { id: 'c2', name: 'Sinigang', cookedDate: daysAgo(3), storage: 'fridge', fridgeLife: 4, freezerLife: 90 }, // +1
      { id: 'c3', name: 'Frozen Batch', cookedDate: daysAgo(6), storage: 'freezer', fridgeLife: 4, freezerLife: 90 } // +84
    ];
    const a = collectAttentionItems();
    window.__notifications.length = 0;
    await maybeNotifyAttention();
    return {
      daysLeft: AppState.cookedMeals.map((m) => daysLeftFrom(m.cookedDate, cookedShelfLife(m))),
      expired: a.expired.map((e) => e.kind + ':' + e.name),
      useSoon: a.useSoon.map((e) => e.kind + ':' + e.name),
      notes: window.__notifications.slice()
    };
  }, LOCAL_DAY_FN);

  expect(result.daysLeft).toEqual([-2, 1, 84]);
  expect(result.expired).toEqual(['cooked:Adobo']);
  expect(result.useSoon).toEqual(['cooked:Sinigang']);
  // The freezer batch is correctly absent.
  expect(result.notes).toHaveLength(1);
  expect(result.notes[0].title).toBe('Adobo expired');
  expect(result.notes[0].body).toBe('Open Meal Prep to review it. Sinigang should be used soon.');
});

test('pantry and cooked food are grouped into a single notification', async ({ page }) => {
  await loadLocalApp(page, { initialPermission: 'granted', alertPrefs: { enabled: true, announced: {} } });

  const notes = await runAttentionPass(page, (daysAgo) => {
    AppState.pantry = [{ id: 1, name: 'Chicken', category: 'Protein', purchaseDate: daysAgo(10), shelfLifeDays: 2 }];
    AppState.cookedMeals = [{ id: 'c1', name: 'Adobo', cookedDate: daysAgo(6), storage: 'fridge', fridgeLife: 4, freezerLife: 90 }];
  });

  expect(notes).toHaveLength(1);
  expect(notes[0].title).toBe('2 foods expired');
  // Ledger keys are namespaced by kind, so a pantry id can never mask a cooked id.
  const ledger = await page.evaluate(() => loadFoodAlertPrefs().announced);
  expect(ledger).toEqual({ 'pantry:1': 'expired', 'cooked:c1': 'expired' });
});

test('a cooked meal with no shelf life is never announced', async ({ page }) => {
  await loadLocalApp(page, { initialPermission: 'granted', alertPrefs: { enabled: true, announced: {} } });

  const notes = await runAttentionPass(page, (daysAgo) => {
    AppState.pantry = [];
    AppState.cookedMeals = [
      { id: 'c9', name: 'Mystery Leftovers', cookedDate: daysAgo(30), storage: 'fridge', fridgeLife: null, freezerLife: null }
    ];
  });
  expect(notes).toHaveLength(0);
});

// ── 10. Open / resume triggers and the route back to Needs Attention ────────

test('opening the app with newly expired food raises the alert', async ({ page }) => {
  await loadLocalApp(page, {
    initialPermission: 'granted',
    alertPrefs: { enabled: true, announced: {} },
    savedData: {
      pantry: [{ id: 1, name: 'Chicken Breast', category: 'Protein', purchaseDate: '2000-01-01', shelfLifeDays: 3 }],
      cookedMeals: [], recipes: [], groceryList: []
    }
  });

  const notes = await page.evaluate(() => window.__notifications.slice());
  expect(notes).toHaveLength(1);
  expect(notes[0].title).toBe('Chicken Breast expired');
});

test('a notification lands the user on the Needs Attention card', async ({ page }) => {
  await loadLocalApp(page, { initialPermission: 'granted', alertPrefs: { enabled: true, announced: {} } });

  const result = await page.evaluate((dayFnSrc) => {
    const daysAgo = eval(dayFnSrc);
    AppState.pantry = [{ id: 1, name: 'Chicken', category: 'Protein', purchaseDate: daysAgo(10), shelfLifeDays: 2 }];
    AppState.cookedMeals = [];
    renderDashboard();
    showTab('grocery');
    openAttentionView();
    const card = document.querySelector('.dash-card--warn');
    return {
      activeTab: document.querySelector('.tab-btn.active').getAttribute('data-tab'),
      cardPresent: !!card,
      keepButtons: document.querySelectorAll('.dash-keep-btn').length,
      removeButtons: document.querySelectorAll('.dash-remove-btn').length
    };
  }, LOCAL_DAY_FN);

  expect(result.activeTab).toBe('dashboard');
  expect(result.cardPresent).toBe(true);
  expect(result.keepButtons).toBe(1);
  expect(result.removeButtons).toBe(1);
});

test('returning to the foreground runs an attention pass', async ({ page }) => {
  await loadLocalApp(page, { initialPermission: 'granted', alertPrefs: { enabled: true, announced: {} } });

  const notes = await page.evaluate(async (dayFnSrc) => {
    const daysAgo = eval(dayFnSrc);
    AppState.pantry = [{ id: 1, name: 'Chicken', category: 'Protein', purchaseDate: daysAgo(10), shelfLifeDays: 2 }];
    AppState.cookedMeals = [];
    window.__notifications.length = 0;
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 200));
    return window.__notifications.slice();
  }, LOCAL_DAY_FN);

  expect(notes).toHaveLength(1);
  expect(notes[0].title).toBe('Chicken expired');
});

// ── 11. Old saved data ──────────────────────────────────────────────────────

test('a saved file from before this wave loads and behaves', async ({ page }) => {
  await loadLocalApp(page, {
    // No mealPrepFoodAlerts key at all, and legacy records with no updatedAt/keptOn.
    savedData: {
      recipes: [{ id: 1, name: 'Old Recipe', ingredients: [], instructions: 'Cook it.' }],
      pantry: [
        { id: 1, name: 'Legacy Chicken', category: 'Protein', purchaseDate: '2000-01-01' },
        { id: 2, name: 'Legacy Rice', category: 'Grain', purchaseDate: '2000-01-01' }
      ],
      cookedMeals: [{ id: 'c1', name: 'Legacy Adobo', cookedDate: '2000-01-01', storage: 'fridge', fridgeLife: 4 }],
      groceryList: []
    }
  });

  const result = await page.evaluate(async () => {
    return {
      prefs: loadFoodAlertPrefs(),
      pantryCount: AppState.pantry.length,
      recipeCount: AppState.recipes.length,
      attentionExpired: collectAttentionItems().expired.length,
      fired: await maybeNotifyAttention(),
      notes: window.__notifications.length,
      dashboardCard: !!document.querySelector('.dash-card--warn'),
      settingsState: (openSettingsModal(), document.getElementById('settings-food-alerts-state').textContent)
    };
  });

  expect(result.prefs).toEqual({ enabled: false, announced: {} });
  expect(result.pantryCount).toBe(2);
  expect(result.recipeCount).toBe(1);
  expect(result.attentionExpired).toBeGreaterThan(0);
  expect(result.fired).toBeNull();
  expect(result.notes).toBe(0);
  expect(result.dashboardCard).toBe(true);
  expect(result.settingsState).toBe('Off');
});

test('a corrupt alert-prefs value falls back to off instead of throwing', async ({ page }) => {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(NOTIFICATION_STUB);
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
      localStorage.setItem('mealPrepFoodAlerts', '{not json');
    } catch (e) {}
  });
  await page.goto(pathToFileURL(path.resolve('index.html')).href, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  expect(await page.evaluate(() => loadFoodAlertPrefs())).toEqual({ enabled: false, announced: {} });
  expect(await page.evaluate(() => !!document.getElementById('dashboard'))).toBe(true);
});

// ── 12. No new synced top-level state ───────────────────────────────────────

test('notification bookkeeping stays out of AppState and out of the synced payload', async ({ page }) => {
  await loadLocalApp(page, { initialPermission: 'granted', alertPrefs: { enabled: true, announced: {} } });

  const result = await page.evaluate(async (dayFnSrc) => {
    const daysAgo = eval(dayFnSrc);
    AppState.pantry = [{ id: 1, name: 'Chicken', category: 'Protein', purchaseDate: daysAgo(10), shelfLifeDays: 2 }];
    AppState.cookedMeals = [];
    await maybeNotifyAttention();
    saveToLocalStorage();
    const persisted = JSON.parse(localStorage.getItem('mealPrepAppData'));
    const appStateKeys = Object.keys(AppState);
    return {
      appStateLeak: appStateKeys.filter((k) => /alert|notif|announce/i.test(k)),
      persistedLeak: Object.keys(persisted).filter((k) => /alert|notif|announce/i.test(k)),
      ledgerLivesInItsOwnKey: !!localStorage.getItem('mealPrepFoodAlerts')
    };
  }, LOCAL_DAY_FN);

  expect(result.appStateLeak).toEqual([]);
  expect(result.persistedLeak).toEqual([]);
  expect(result.ledgerLivesInItsOwnKey).toBe(true);
});

// ── 13. Mobile layout / settings remain usable ──────────────────────────────

test('the notifications row is reachable and readable on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadLocalApp(page);

  await page.evaluate(() => openSettingsModal());
  const row = page.locator('#settings-food-alerts-row');
  await expect(row).toBeVisible();

  const box = await row.boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(40); // comfortable tap target
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);

  await expect(page.locator('#settings-food-alerts-state')).toBeVisible();
  await expect(page.locator('.settings-row-note')).toBeVisible();

  // No horizontal overflow introduced anywhere on the page.
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  // And it still works from a phone-sized tap.
  await row.click();
  await page.waitForTimeout(300);
  await expect(page.locator('#settings-food-alerts-state')).toHaveText('On');
});
