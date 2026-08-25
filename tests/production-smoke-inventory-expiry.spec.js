const { test, expect } = require('@playwright/test');

/**
 * Production smoke for inventory expiry truth (TASK-050, D-066).
 *
 * Runs against the DEPLOYED GitHub Pages build, not the working tree. Firebase is
 * deliberately NOT stubbed — the page loads it for real and stays signed out, the
 * normal first-visit path. Each test gets a fresh isolated context, so nothing
 * persists between tests and nothing touches a real account's cloud data.
 *
 * What the shipped bundle has to prove here:
 *   - the manual add form stores name, quantity, unit and an explicit expiry as
 *     four separate fields, and the name holds only the name;
 *   - an explicit expiry renders as an absolute date AND the existing relative
 *     freshness, both derived from the same number;
 *   - a record with no printed date says "Best by", never a fabricated "Expires";
 *   - blanks stay unknown rather than being invented;
 *   - a pre-existing free-text name is left exactly as it was found;
 *   - Kitchen Truth, grocery→pantry and Food Attention are unchanged by all of it.
 */

const APP_URL = 'https://shinyamadasan.github.io/Meal-Prep/';

test.use({ viewport: { width: 1280, height: 1700 } });

async function loadLiveApp(page) {
  // Runs before EVERY navigation, so it must bootstrap once and then leave storage
  // alone — otherwise a page.reload() would wipe the data under test.
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__expiryProdBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__expiryProdBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
  });
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

// Local calendar date N days from today. daysLeftFrom()/todayISO() work in local
// time, so a UTC-derived date silently shifts by a day near midnight.
const OFFSET_FN = `(d) => {
  const t = new Date();
  t.setDate(t.getDate() + d);
  return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
}`;

const offsetIn = (page, d) => page.evaluate(`(${OFFSET_FN})(${d})`);

async function addViaForm(page, { name, qty, unit, expiry }) {
  await page.fill('#pantry-input', name);
  await page.fill('#pantry-qty', qty == null ? '' : String(qty));
  await page.fill('#pantry-unit', unit || '');
  await page.fill('#pantry-expiry', expiry || '');
  await page.click('#pantry-body button:has-text("+ Add")');
  await page.waitForTimeout(300);
}

// ── 0. The wave is actually deployed ────────────────────────────────────────

test('the deployed bundle actually contains the wave', async ({ page }) => {
  await loadLiveApp(page);
  const present = await page.evaluate(() => ({
    expiryInfo: typeof pantryExpiryInfo === 'function',
    shortDate: typeof formatShortDate === 'function',
    daysLeft: typeof pantryDaysLeft === 'function',
    qtyField: !!document.getElementById('pantry-qty'),
    unitField: !!document.getElementById('pantry-unit'),
    expiryField: !!document.getElementById('pantry-expiry'),
    expiryIsDate: (document.getElementById('pantry-expiry') || {}).type === 'date'
  }));
  expect(present).toEqual({
    expiryInfo: true, shortDate: true, daysLeft: true,
    qtyField: true, unitField: true, expiryField: true, expiryIsDate: true
  });
});

// ── 1-2. Manual add stores four fields; explicit expiry renders date + relative ──

test('manual add stores name, quantity, unit and explicit expiry separately', async ({ page }) => {
  await loadLiveApp(page);
  await page.evaluate(() => { AppState.pantry = []; showTab('fridge'); });

  const expiry = await offsetIn(page, 4);
  await addViaForm(page, { name: 'Eggs', qty: 12, unit: 'pcs', expiry });

  const rec = await page.evaluate(() => AppState.pantry.find((p) => p.name === 'Eggs'));
  expect(rec).toBeTruthy();
  expect(rec.name).toBe('Eggs');          // the name is ONLY the name
  expect(rec.quantity).toBe(12);
  expect(rec.unit).toBe('pcs');
  expect(rec.expiryDate).toBe(expiry);
  expect(rec.dateMode).toBe('expiry');
  // The freshness number follows the entered date, not a category default.
  expect(await page.evaluate(() => pantryDaysLeft(AppState.pantry.find((p) => p.name === 'Eggs'))))
    .toBe(4);
});

test('an explicit expiry renders as Expires <date> alongside the relative freshness', async ({ page }) => {
  await loadLiveApp(page);
  await page.evaluate(() => { AppState.pantry = []; showTab('fridge'); });
  await addViaForm(page, { name: 'Eggs', qty: 12, unit: 'pcs', expiry: await offsetIn(page, 2) });

  const row = page.locator('.pi-item', { has: page.locator('.pi-name', { hasText: 'Eggs' }) })
                  .locator('.pi-row');
  await expect(row.locator('.pi-name')).toHaveText('Eggs');
  await expect(row.locator('.pi-date')).toContainText('Expires');        // absolute
  await expect(row.locator('.pi-date')).toHaveClass(/pi-date--printed/);
  await expect(row.locator('.pi-qty')).toHaveText('12 pcs');
  await expect(row.locator('.pantry-fresh-badge')).toContainText('2d left');  // relative kept
});

// ── 3. Derived records say "Best by", not a fabricated "Expires" ────────────

test('a derived shelf-life record says Best by, never a fabricated Expires', async ({ page }) => {
  await loadLiveApp(page);
  await page.evaluate(() => { AppState.pantry = []; showTab('fridge'); });
  await addViaForm(page, { name: 'Chicken Breast', qty: 500, unit: 'g', expiry: '' });

  const rec = await page.evaluate(() =>
    AppState.pantry.find((p) => p.name === 'Chicken Breast'));
  expect(rec.expiryDate).toBeNull();          // nothing invented
  expect(rec.dateMode).toBeUndefined();       // still bought-date mode

  const date = page.locator('.pi-item', { has: page.locator('.pi-name', { hasText: 'Chicken Breast' }) })
                   .locator('.pi-date');
  await expect(date).toContainText('Best by');
  await expect(date).not.toContainText('Expires');
  await expect(date).not.toHaveClass(/pi-date--printed/);
});

// ── 4. An expired printed date shows the date AND the expired state ────────

test('an expired explicit-date item shows the absolute date and the expired state', async ({ page }) => {
  await loadLiveApp(page);
  await page.evaluate(() => { AppState.pantry = []; showTab('fridge'); });
  await addViaForm(page, { name: 'Yogurt', qty: 4, unit: 'cups', expiry: await offsetIn(page, -14) });

  expect(await page.evaluate(() =>
    pantryDaysLeft(AppState.pantry.find((p) => p.name === 'Yogurt')))).toBe(-14);

  const row = page.locator('.pi-item', { has: page.locator('.pi-name', { hasText: 'Yogurt' }) })
                  .locator('.pi-row');
  await expect(row.locator('.pi-date')).toContainText('Expires');
  await expect(row.locator('.pantry-fresh-badge')).toContainText('Expired 14d ago');
  // The original defect: a protein category default asserting life it did not have.
  await expect(row).not.toContainText('3d left');
});

// ── 5. Blanks stay unknown ─────────────────────────────────────────────────

test('blank quantity and blank date stay unknown rather than fabricated', async ({ page }) => {
  await loadLiveApp(page);
  await page.evaluate(() => { AppState.pantry = []; showTab('fridge'); });
  await addViaForm(page, { name: 'Garlic (Bawang)', qty: null, unit: '', expiry: '' });

  const rec = await page.evaluate(() =>
    AppState.pantry.find((p) => p.name === 'Garlic (Bawang)'));
  expect(rec.quantity).toBeNull();          // not 1
  expect(rec.expiryDate).toBeNull();        // not today, not a guess
  expect(rec.dateMode).toBeUndefined();

  // An unknown quantity renders as the em-dash placeholder, not a number.
  const row = page.locator('.pi-item', { has: page.locator('.pi-name', { hasText: 'Garlic (Bawang)' }) });
  const qty = row.locator('.pi-qty');
  if (await qty.count()) await expect(qty).toHaveClass(/pi-qty--empty/);
});

// ── 6. Historical free-text names are left alone ───────────────────────────

test('an old free-text name is rendered untouched and never back-parsed', async ({ page }) => {
  await loadLiveApp(page);
  // Exactly the record the original defect produced, as it would load from storage.
  const result = await page.evaluate(() => {
    AppState.pantry = [{
      id: 980001, name: 'eggs 12pcs august 10 2026', category: 'Protein',
      storage: 'fridge', purchaseDate: todayISO(), shelfLifeDays: 3,
      quantity: null, unit: ''
    }];
    showTab('fridge');
    renderPantry();
    const p = AppState.pantry[0];
    return { name: p.name, quantity: p.quantity, unit: p.unit,
             expiryDate: p.expiryDate, dateMode: p.dateMode };
  });
  // No migration, no parsing, no silent rewrite.
  expect(result.name).toBe('eggs 12pcs august 10 2026');
  expect(result.quantity).toBeNull();
  expect(result.expiryDate).toBeUndefined();
  expect(result.dateMode).toBeUndefined();

  const row = page.locator('.pi-row').first();
  await expect(row.locator('.pi-name')).toHaveText('eggs 12pcs august 10 2026');
  // It still gets an honest derived label rather than a claimed printed date.
  await expect(row.locator('.pi-date')).toContainText('Best by');
});

// ── 7. Kitchen Truth attention classification unchanged ────────────────────

test('Kitchen Truth attention classifications remain consistent', async ({ page }) => {
  await loadLiveApp(page);
  const out = await page.evaluate(async () => {
    const off = (d) => {
      const t = new Date();
      t.setDate(t.getDate() + d);
      return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') +
             '-' + String(t.getDate()).padStart(2, '0');
    };
    AppState.pantry = [
      { id: 981001, name: 'ExpiredPrinted', category: 'Protein', storage: 'fridge',
        dateMode: 'expiry', expiryDate: off(-3), purchaseDate: off(-10), shelfLifeDays: 3 },
      { id: 981002, name: 'UseSoonPrinted', category: 'Protein', storage: 'fridge',
        dateMode: 'expiry', expiryDate: off(1), purchaseDate: off(-1), shelfLifeDays: 3 },
      { id: 981003, name: 'UseTodayPrinted', category: 'Protein', storage: 'fridge',
        dateMode: 'expiry', expiryDate: off(0), purchaseDate: off(-1), shelfLifeDays: 3 },
      { id: 981004, name: 'FreshDerived', category: 'Vegetable', storage: 'fridge',
        purchaseDate: off(0), shelfLifeDays: 7 }
    ];
    AppState.cookedMeals = [];
    const a = collectAttentionItems();
    const alerts = getFreshnessAlerts();
    return {
      expired: a.expired.map((e) => e.name).sort(),
      useSoon: a.useSoon.map((e) => e.name).sort(),
      alertExpired: alerts.expired,
      alertExpiring: alerts.expiring,
      // Days-left = 0 is "Use today", NOT expired — the D-057 boundary.
      todayIsUseSoon: a.useSoon.some((e) => e.name === 'UseTodayPrinted'),
      // Every chip agrees with the badge beside it.
      chipMatchesBadge: AppState.pantry.every((p) => {
        const info = pantryExpiryInfo(p);
        const dl = pantryDaysLeft(p);
        if (!info || dl == null) return info == null && dl == null;
        const days = Math.round(
          (new Date(info.date + 'T00:00:00') - new Date(todayISO() + 'T00:00:00')) / 86400000);
        return days === dl;
      })
    };
  });
  expect(out.expired).toEqual(['ExpiredPrinted']);
  expect(out.useSoon).toEqual(['UseSoonPrinted', 'UseTodayPrinted']);
  expect(out.todayIsUseSoon).toBe(true);
  expect(out.alertExpired).toBe(1);
  expect(out.alertExpiring).toBe(2);
  expect(out.chipMatchesBadge).toBe(true);
});

// ── 8. Grocery → pantry unchanged ──────────────────────────────────────────

test('grocery check-off still transfers to inventory with no further input', async ({ page }) => {
  await loadLiveApp(page);
  const out = await page.evaluate(() => {
    AppState.pantry = [];
    AppState.groceryList = [{
      id: 982001, name: 'Chicken Breast', category: 'Protein',
      quantity: 500, unit: 'g', sources: [], checked: false
    }];
    const before = document.querySelectorAll('.confirm-overlay').length;
    toggleGroceryItem(982001);
    const after = document.querySelectorAll('.confirm-overlay').length;
    const p = AppState.pantry[0];
    const info = pantryExpiryInfo(p);
    return {
      modalsOpened: after - before,
      count: AppState.pantry.length,
      name: p.name, quantity: p.quantity, unit: p.unit,
      purchaseIsToday: p.purchaseDate === todayISO(),
      // A transferred record has no printed date, so it must read as derived.
      derived: !!info && info.printed === false,
      receiptMode: AppState.groceryList[0].stocked.mode
    };
  });
  expect(out.modalsOpened).toBe(0);      // Bought ✓ is still the whole interaction
  expect(out.count).toBe(1);
  expect(out.name).toBe('Chicken Breast');
  expect(out.quantity).toBe(500);
  expect(out.unit).toBe('g');
  expect(out.purchaseIsToday).toBe(true);
  expect(out.derived).toBe(true);
  expect(out.receiptMode).toBe('created');
});

test('a merge still refuses to make old or printed-date food look fresh', async ({ page }) => {
  await loadLiveApp(page);
  const out = await page.evaluate(() => {
    const off = (d) => {
      const t = new Date();
      t.setDate(t.getDate() + d);
      return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') +
             '-' + String(t.getDate()).padStart(2, '0');
    };
    AppState.pantry = [
      { id: 983001, name: 'Printed', category: 'Protein', storage: 'fridge',
        dateMode: 'expiry', expiryDate: off(5), purchaseDate: off(-1), shelfLifeDays: 3 },
      { id: 983002, name: 'OldStock', category: 'Protein', storage: 'fridge',
        purchaseDate: off(-6), shelfLifeDays: 3 }
    ];
    return {
      printedRefused: canMergePurchase(AppState.pantry[0]) === false,
      expiredRefused: canMergePurchase(AppState.pantry[1]) === false
    };
  });
  expect(out).toEqual({ printedRefused: true, expiredRefused: true });
});

// ── 9. Food Attention unchanged ────────────────────────────────────────────

test('Food Attention notification behaviour is intact', async ({ page }) => {
  await loadLiveApp(page);
  const out = await page.evaluate(() => {
    const off = (d) => {
      const t = new Date();
      t.setDate(t.getDate() + d);
      return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') +
             '-' + String(t.getDate()).padStart(2, '0');
    };
    AppState.pantry = [
      { id: 984001, name: 'Milk', category: 'Dairy', storage: 'fridge',
        dateMode: 'expiry', expiryDate: off(-1), purchaseDate: off(-8), shelfLifeDays: 7 }
    ];
    AppState.cookedMeals = [];
    const attention = collectAttentionItems();
    const fresh = findNewAttention(attention, {});
    const note = buildAttentionNotification(fresh);
    const sig = attentionSignature(attention);
    return {
      fnsPresent: typeof maybeNotifyAttention === 'function' &&
                  typeof buildAttentionNotification === 'function',
      title: note && note.title,
      grouped: !!note && Object.keys(sig).length === 1,
      // Repeat pass with the ledger already written must stay silent.
      silentOnRepeat: buildAttentionNotification(findNewAttention(attention, sig)) === null,
      // The ledger is device-local, never part of the synced payload.
      notInPayload: !Object.prototype.hasOwnProperty.call(
        buildFirestorePayload(), 'foodAlerts')
    };
  });
  expect(out.fnsPresent).toBe(true);
  expect(out.title).toContain('Milk');
  expect(out.grouped).toBe(true);
  expect(out.silentOnRepeat).toBe(true);
  expect(out.notInPayload).toBe(true);
});

// ── 10. Mobile add row usable at 390px ─────────────────────────────────────

test.describe('deployed mobile add row', () => {
  test.use({ viewport: { width: 390, height: 1500 } });

  test('390px: add row usable, no horizontal overflow, expiry entry still works', async ({ page }) => {
    await loadLiveApp(page);
    await page.evaluate(() => { AppState.pantry = []; showTab('fridge'); });

    const o = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth
    }));
    expect(o.scrollW).toBeLessThanOrEqual(o.clientW);

    const box = await page.locator('#pantry-input').boundingBox();
    expect(box.width).toBeGreaterThanOrEqual(140);   // was 26px before D-066
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);

    for (const sel of ['#pantry-qty', '#pantry-unit', '#pantry-expiry']) {
      await expect(page.locator(sel)).toBeVisible();
      const b = await page.locator(sel).boundingBox();
      expect(b.x + b.width).toBeLessThanOrEqual(390);
    }
    await expect(page.locator('#pantry-body button:has-text("+ Add")')).toBeVisible();

    // Operable, not merely painted — and the result renders both date forms.
    await addViaForm(page, { name: 'Eggs', qty: 12, unit: 'pcs', expiry: await offsetIn(page, 2) });
    const row = page.locator('.pi-item', { has: page.locator('.pi-name', { hasText: 'Eggs' }) })
                    .locator('.pi-row');
    await expect(row.locator('.pi-date')).toContainText('Expires');
    await expect(row.locator('.pantry-fresh-badge')).toContainText('2d left');

    const after = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth
    }));
    expect(after.scrollW).toBeLessThanOrEqual(after.clientW);
  });
});

// ── 11. No console or page errors through the whole flow ───────────────────

test('no console or page errors through the deployed inventory flow', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await loadLiveApp(page);
  await page.evaluate(() => { AppState.pantry = []; showTab('fridge'); });

  await addViaForm(page, { name: 'Eggs', qty: 12, unit: 'pcs', expiry: await offsetIn(page, 3) });
  await addViaForm(page, { name: 'Chicken Breast', qty: 500, unit: 'g', expiry: '' });
  await addViaForm(page, { name: 'Yogurt', qty: 4, unit: 'cups', expiry: await offsetIn(page, -2) });
  await addViaForm(page, { name: 'Garlic (Bawang)', qty: null, unit: '', expiry: '' });

  await page.evaluate(() => { showTab('dashboard'); });
  await page.waitForTimeout(600);
  await page.evaluate(() => { showTab('fridge'); renderPantry(); refreshFreshnessAlerts(); });
  await page.waitForTimeout(600);

  // Expand a card, which exercises the date/qty/storage edit panel.
  await page.locator('.pi-row').first().click();
  await page.waitForTimeout(400);

  // Same exclusion list the other production smokes use, for the same reason:
  // `requestStorageAccess: Permission denied` comes from the real Firebase SDK hitting
  // Chromium's storage partitioning in a headless third-party context, and
  // `frame-ancestors ... google.com` is the App Check reCAPTCHA challenge iframe. Both
  // are environmental and absent in a normal browser. Nothing app-specific is excluded.
  const real = errors.filter((e) =>
    !/net::ERR|Failed to load resource|favicon|requestStorageAccess|frame-ancestors|google\.com|firebase|firestore|installations|app-check/i.test(e));
  expect(real, 'unexpected errors:\n' + real.join('\n')).toEqual([]);
});
