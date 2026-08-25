const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');
const { waitForAppReady, waitForRestored } = require('./app-ready');

/**
 * Inventory expiry truth — name, quantity/unit and expiry date are three concepts.
 *
 * The defect this file exists to prevent coming back:
 *
 *   The quick-add row collected ONE field, the item name. A user with a carton of
 *   eggs typed everything they knew into it — "eggs 12pcs august 10 2026" — and the
 *   whole string was stored as `name`. quantity stayed null, unit stayed '', and
 *   expiryDate was never set. The card then rendered that string as the item name
 *   next to "3d left", which came from a PROTEIN CATEGORY DEFAULT of 3 days, not
 *   from the date the user had typed. So the badge was not merely ambiguous: it
 *   asserted the eggs were good for three more days when the date on the carton had
 *   already passed. Freshness that is invented rather than derived is worse than no
 *   freshness at all.
 *
 * Two halves are therefore locked down here: the fields exist and are stored
 * separately (data truth), and the card shows the absolute date beside the relative
 * one (display truth) without dropping the relative indicator.
 */

test.use({ viewport: { width: 1280, height: 1600 } });

async function loadLocalApp(page) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  // The bootstrap flag makes the clear run ONCE per browser context rather than on
  // every navigation, so a reload can prove that what was added actually persisted.
  // Playwright gives each test a fresh context, so tests stay isolated either way.
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__expiryDisplayBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__expiryDisplayBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
  });
  await page.goto(pathToFileURL(path.resolve('index.html')).href, { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
}

// Local calendar date N days from today — todayISO()/daysLeftFrom() are local-time.
const localDayOffset = (d) => {
  const t = new Date();
  t.setDate(t.getDate() + d);
  return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') +
         '-' + String(t.getDate()).padStart(2, '0');
};

async function addViaForm(page, { name, qty, unit, expiry }) {
  await page.fill('#pantry-input', name);
  await page.fill('#pantry-qty', qty == null ? '' : String(qty));
  await page.fill('#pantry-unit', unit || '');
  await page.fill('#pantry-expiry', expiry || '');
  await page.click('#pantry-body button:has-text("+ Add")');
}

// ── 1. The add form collects the three concepts separately ──────────────────

test('the quick-add form has its own quantity, unit and expiry fields', async ({ page }) => {
  await loadLocalApp(page);
  await page.evaluate(() => showTab('fridge'));
  await expect(page.locator('#pantry-qty')).toBeVisible();
  await expect(page.locator('#pantry-unit')).toBeVisible();
  await expect(page.locator('#pantry-expiry')).toBeVisible();
  await expect(page.locator('#pantry-expiry')).toHaveAttribute('type', 'date');
});

test('adding an item stores name, quantity, unit and expiry in separate fields', async ({ page }) => {
  await loadLocalApp(page);
  await page.evaluate(() => { AppState.pantry = []; showTab('fridge'); });

  const expiry = localDayOffset(5);
  await addViaForm(page, { name: 'Eggs', qty: 12, unit: 'pcs', expiry });

  const rec = await page.evaluate(() => AppState.pantry[0]);
  expect(rec.name).toBe('Eggs');            // the name is ONLY the name
  expect(rec.quantity).toBe(12);
  expect(rec.unit).toBe('pcs');
  expect(rec.expiryDate).toBe(expiry);
  expect(rec.dateMode).toBe('expiry');

  // And the freshness number now follows the date the user actually entered.
  expect(await page.evaluate(() => pantryDaysLeft(AppState.pantry[0]))).toBe(5);
});

test('the add form is cleared after a successful add', async ({ page }) => {
  await loadLocalApp(page);
  await page.evaluate(() => { AppState.pantry = []; showTab('fridge'); });
  await addViaForm(page, { name: 'Eggs', qty: 12, unit: 'pcs', expiry: localDayOffset(5) });
  await expect(page.locator('#pantry-input')).toHaveValue('');
  await expect(page.locator('#pantry-qty')).toHaveValue('');
  await expect(page.locator('#pantry-unit')).toHaveValue('');
  await expect(page.locator('#pantry-expiry')).toHaveValue('');
});

test('a past printed expiry reads as expired, not as fresh', async ({ page }) => {
  await loadLocalApp(page);
  await page.evaluate(() => { AppState.pantry = []; showTab('fridge'); });

  // The original bug in one assertion: eggs with a date that has already gone by.
  await addViaForm(page, { name: 'Eggs', qty: 12, unit: 'pcs', expiry: localDayOffset(-14) });

  expect(await page.evaluate(() => pantryDaysLeft(AppState.pantry[0]))).toBe(-14);
  const row = page.locator('.pi-row').first();
  await expect(row).toContainText('Expired 14d ago');
  await expect(row).not.toContainText('3d left');
});

// ── 2. The card renders date and relative freshness as separate values ──────

test('a card shows the absolute expiry date next to the relative days-left badge', async ({ page }) => {
  await loadLocalApp(page);
  await page.evaluate(() => { AppState.pantry = []; showTab('fridge'); });
  await addViaForm(page, { name: 'Eggs', qty: 12, unit: 'pcs', expiry: localDayOffset(2) });

  const row = page.locator('.pi-row').first();
  // The name element carries the name and nothing else.
  await expect(row.locator('.pi-name')).toHaveText('Eggs');
  // The date is its own element, labelled, and marked as a printed (user-entered) date.
  const date = row.locator('.pi-date');
  await expect(date).toBeVisible();
  await expect(date).toHaveClass(/pi-date--printed/);
  await expect(date).toContainText('Expires');
  // Quantity + unit are their own element.
  await expect(row.locator('.pi-qty')).toHaveText('12 pcs');
  // And the relative indicator is still there — it was never the problem.
  await expect(row.locator('.pantry-fresh-badge')).toContainText('2d left');
});

test('an item with no printed date shows a derived "Best by", not a fake "Expires"', async ({ page }) => {
  await loadLocalApp(page);
  await page.evaluate(() => { AppState.pantry = []; showTab('fridge'); });
  await addViaForm(page, { name: 'Carrot (Karot)', qty: 500, unit: 'g', expiry: '' });

  const rec = await page.evaluate(() => AppState.pantry[0]);
  expect(rec.expiryDate).toBeNull();
  expect(rec.dateMode).toBeUndefined();

  const date = page.locator('.pi-row').first().locator('.pi-date');
  await expect(date).toContainText('Best by');
  await expect(date).not.toHaveClass(/pi-date--printed/);
});

test('the rendered date and the days-left badge always describe the same day', async ({ page }) => {
  await loadLocalApp(page);
  // The two are separate renderings of one number, so they must never disagree —
  // that agreement is the whole reason pantryExpiryInfo() reads pantryDaysLeft()'s
  // own two branches instead of recomputing an expiry boundary of its own.
  const mismatches = await page.evaluate(() => {
    const offset = (d) => {
      const t = new Date();
      t.setDate(t.getDate() + d);
      return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') +
             '-' + String(t.getDate()).padStart(2, '0');
    };
    const today = new Date(todayISO() + 'T00:00:00').getTime();
    const cases = [];
    for (let d = -400; d <= 400; d += 7) {
      cases.push({ name: 'x', dateMode: 'expiry', expiryDate: offset(d) });
      cases.push({ name: 'x', purchaseDate: offset(-3), shelfLifeDays: d + 3, category: 'Protein' });
    }
    const bad = [];
    cases.forEach((p) => {
      const info = pantryExpiryInfo(p);
      const dl = pantryDaysLeft(p);
      if (info == null || dl == null) {
        if (info != null || dl != null) bad.push({ p: p, info: info, dl: dl });
        return;
      }
      const chipDays = Math.round(
        (new Date(info.date + 'T00:00:00').getTime() - today) / 86400000);
      if (chipDays !== dl) bad.push({ p: p, chipDate: info.date, chipDays: chipDays, dl: dl });
    });
    return bad;
  });
  expect(mismatches).toEqual([]);
});

test('an item that tracks no date at all renders no date chip and no badge', async ({ page }) => {
  await loadLocalApp(page);
  await page.evaluate(() => {
    AppState.pantry = [{
      id: 970001, name: 'Salt', category: 'Pantry', storage: 'counter',
      purchaseDate: null, shelfLifeDays: null, quantity: null, unit: ''
    }];
    showTab('fridge');
    renderPantry();
  });
  const row = page.locator('.pi-row').first();
  await expect(row.locator('.pi-name')).toHaveText('Salt');
  await expect(row.locator('.pi-date')).toHaveCount(0);
  await expect(row.locator('.pantry-fresh-badge')).toHaveCount(0);
});

// ── 3. The add form survives a phone ────────────────────────────────────────
//
// The structured fields above are only worth having if they can actually be used on
// the device this app is dogfooded on. `.pantry-add-row` was `display: flex` with no
// `flex-wrap` and five buttons; `.ing-name-wrap` carries a global `min-width: 0` and
// its input is `width: 100%`, so the name field's min-content contribution was zero
// and it collapsed to 26px at both 320px and 390px — narrower than a single character
// cell. These lock the floor and the wrap, at the two narrowest phone widths that
// matter, without pinning the exact layout the browser chooses.

const PHONE = { width: 390, height: 1400 };

// Wide enough to type an ingredient name into and to hit with a thumb. The bug
// produced 26px, so any honest floor catches it; this one also refuses a merely
// "technically visible" 60px sliver.
const MIN_USABLE_INPUT_PX = 140;

async function boxOf(locator) {
  const b = await locator.boundingBox();
  expect(b, 'element has no layout box').not.toBeNull();
  return b;
}

test.describe('mobile add form', () => {
  test.use({ viewport: PHONE });

  test('390px: the page does not scroll horizontally', async ({ page }) => {
    await loadLocalApp(page);
    await page.evaluate(() => { AppState.pantry = []; showTab('fridge'); });
    const o = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth
    }));
    expect(o.scrollW).toBeLessThanOrEqual(o.clientW);
  });

  test('390px: the item-name input keeps a usable typing width', async ({ page }) => {
    await loadLocalApp(page);
    await page.evaluate(() => { AppState.pantry = []; showTab('fridge'); });
    const box = await boxOf(page.locator('#pantry-input'));
    expect(box.width).toBeGreaterThanOrEqual(MIN_USABLE_INPUT_PX);
    // And it must still fit on screen rather than buying width by overflowing.
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(PHONE.width);
  });

  test('390px: quantity, unit, expiry and Add are all reachable', async ({ page }) => {
    await loadLocalApp(page);
    await page.evaluate(() => { AppState.pantry = []; showTab('fridge'); });

    const addBtn = page.locator('#pantry-body button:has-text("+ Add")');
    for (const loc of [page.locator('#pantry-qty'), page.locator('#pantry-unit'),
                       page.locator('#pantry-expiry'), addBtn]) {
      await expect(loc).toBeVisible();
      const b = await boxOf(loc);
      expect(b.width).toBeGreaterThan(0);
      expect(b.height).toBeGreaterThan(0);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(PHONE.width);   // never clipped off-screen
    }

    // Reachable means operable, not merely painted: these calls assert actionability.
    await page.fill('#pantry-qty', '6');
    await page.fill('#pantry-unit', 'pcs');
    await page.fill('#pantry-expiry', localDayOffset(3));
    await expect(page.locator('#pantry-qty')).toHaveValue('6');
    await expect(page.locator('#pantry-unit')).toHaveValue('pcs');
  });

  test('390px: the fields have not been stacked into an unreadable single column', async ({ page }) => {
    await loadLocalApp(page);
    await page.evaluate(() => { AppState.pantry = []; showTab('fridge'); });
    // Wrapping to a second line is explicitly fine; every control landing on its own
    // line would mean the row was redesigned rather than wrapped.
    const tops = await page.evaluate(() => ['#pantry-input', '#pantry-qty', '#pantry-unit', '#pantry-expiry']
      .map((s) => Math.round(document.querySelector(s).getBoundingClientRect().top)));
    expect(new Set(tops).size).toBeLessThan(4);
  });

  test('390px: an expiry entered on a phone persists and renders as date + freshness', async ({ page }) => {
    await loadLocalApp(page);
    await page.evaluate(() => { AppState.pantry = []; showTab('fridge'); });

    const expiry = localDayOffset(2);
    await addViaForm(page, { name: 'Eggs', qty: 12, unit: 'pcs', expiry });

    // Survives a reload through the normal saveData() path, not just in memory.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForRestored(page, () => AppState.pantry.some((p) => p.name === 'Eggs'));
    await page.evaluate(() => showTab('fridge'));

    const rec = await page.evaluate(() =>
      AppState.pantry.find((p) => p.name === 'Eggs'));
    expect(rec).toBeTruthy();
    expect(rec.quantity).toBe(12);
    expect(rec.unit).toBe('pcs');
    expect(rec.expiryDate).toBe(expiry);
    expect(rec.dateMode).toBe('expiry');

    const row = page.locator('.pi-item', { has: page.locator('.pi-name', { hasText: 'Eggs' }) })
                    .locator('.pi-row');
    await expect(row.locator('.pi-name')).toHaveText('Eggs');
    await expect(row.locator('.pi-date')).toContainText('Expires');       // absolute
    await expect(row.locator('.pi-date')).toHaveClass(/pi-date--printed/);
    await expect(row.locator('.pantry-fresh-badge')).toContainText('2d left');  // relative
    await expect(row.locator('.pi-qty')).toHaveText('12 pcs');
  });
});

// The fix is width-sensitive, so the narrowest phone still in circulation gets the
// same two guarantees. 320px is where an unwrapped row breaks first.
test.describe('narrow phone', () => {
  test.use({ viewport: { width: 320, height: 1400 } });

  test('320px: no horizontal overflow and the name input stays usable', async ({ page }) => {
    await loadLocalApp(page);
    await page.evaluate(() => { AppState.pantry = []; showTab('fridge'); });
    const o = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth
    }));
    expect(o.scrollW).toBeLessThanOrEqual(o.clientW);
    const box = await boxOf(page.locator('#pantry-input'));
    expect(box.width).toBeGreaterThanOrEqual(MIN_USABLE_INPUT_PX);
  });
});
