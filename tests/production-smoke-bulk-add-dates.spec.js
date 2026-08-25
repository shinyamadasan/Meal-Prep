const { test, expect } = require('@playwright/test');

/**
 * Production smoke for Bulk Add date truth (TASK-051, D-067).
 *
 * Runs against the DEPLOYED GitHub Pages build, not the working tree. Firebase is
 * deliberately NOT stubbed — the page loads it for real and stays signed out, the
 * normal first-visit path. Each test gets a fresh isolated context, so nothing
 * persists between tests and nothing touches a real account's cloud data.
 *
 * The production reproduction this exists to keep fixed:
 *
 *   eggs 12 pcs aug 8 2026  ->  name="eggs 12 pcs aug 8 2026", quantity=null,
 *                               unit="", no expiry, "Best by <today+3> · 3d left"
 *
 * The "3d left" came from inferCategory() matching "eggs" inside the string, returning
 * Protein, and categoryShelfLife('Protein') supplying a 3-day fallback. The typed date
 * was never read. Everything below asserts against the shipped bundle.
 */

const APP_URL = 'https://shinyamadasan.github.io/Meal-Prep/';

test.use({ viewport: { width: 1280, height: 1700 } });

async function loadLiveApp(page) {
  // Runs before EVERY navigation, so it must bootstrap once and then leave storage
  // alone — otherwise a page.reload() would wipe the data under test.
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__bulkDateProdBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__bulkDateProdBootstrapped', '1');
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

// Drives the REAL modal inputs and the real confirmBulkAdd() in the deployed bundle.
async function bulkAdd(page, text, { shared = '' } = {}) {
  return page.evaluate(({ text, shared }) => {
    AppState.pantry = [];
    document.getElementById('bulk-add-textarea').value = text;
    document.getElementById('bulk-add-expiry').value = shared;
    document.getElementById('bulk-add-default-storage').value = '';
    document.getElementById('bulk-add-warnings').innerHTML = '';
    confirmBulkAdd();
    return {
      items: AppState.pantry.map((p) => ({
        name: p.name, quantity: p.quantity, unit: p.unit,
        expiryDate: p.expiryDate === undefined ? null : p.expiryDate,
        dateMode: p.dateMode === undefined ? null : p.dateMode,
        shelfLifeDays: p.shelfLifeDays,
        daysLeft: pantryDaysLeft(p),
        chip: (function () {
          const e = pantryExpiryInfo(p);
          return e ? (e.printed ? 'Expires ' : 'Best by ') + formatShortDate(e.date) : null;
        })()
      })),
      warnings: (document.getElementById('bulk-add-warnings').textContent || '').trim()
    };
  }, { text, shared });
}

const only = (r) => { expect(r.items).toHaveLength(1); return r.items[0]; };

// ── 0. The parser is actually in the shipped bundle ────────────────────────

test('the deployed bundle contains the bulk-add date parser', async ({ page }) => {
  await loadLiveApp(page);
  const present = await page.evaluate(() => ({
    parse: typeof parseTrailingDate === 'function',
    ambiguous: typeof looksLikeAmbiguousDate === 'function',
    calendar: typeof isRealCalendarDate === 'function',
    // The TASK-054 short-year helpers must be in the shipped bundle too, or every
    // short-year assertion below would be testing a build that does not have them.
    expandYear: typeof expandYear === 'function',
    plausible: typeof shortYearPlausible === 'function',
    // The helper copy leads with the plain form.
    copyMentionsPlainForm: document.querySelector('#bulk-add-modal .modal-body p')
      .textContent.includes('Aug 8 2026'),
    copyMentionsShortYear: document.querySelector('#bulk-add-modal .modal-body p')
      .textContent.includes('Aug 8 26'),
    copyStillMentionsExp: document.querySelector('#bulk-add-modal .modal-body p')
      .textContent.includes('exp:YYYY-MM-DD')
  }));
  expect(present).toEqual({
    parse: true, ambiguous: true, calendar: true,
    expandYear: true, plausible: true,
    copyMentionsPlainForm: true, copyMentionsShortYear: true, copyStillMentionsExp: true
  });
});

// ── 1. The exact production reproduction ───────────────────────────────────

test('"eggs 12 pcs aug 8 2026" becomes four structured fields on the live site', async ({ page }) => {
  await loadLiveApp(page);
  const it = only(await bulkAdd(page, 'eggs 12 pcs aug 8 2026'));
  expect(it.name).toBe('eggs');
  expect(it.quantity).toBe(12);
  expect(it.unit).toBe('pcs');
  expect(it.expiryDate).toBe('2026-08-08');
  expect(it.dateMode).toBe('expiry');
});

test('the resulting card shows Expires Aug 8 and NOT a category-derived 3d left', async ({ page }) => {
  await loadLiveApp(page);
  await bulkAdd(page, 'eggs 12 pcs aug 8 2026');
  await page.evaluate(() => { showTab('fridge'); renderPantry(); });

  const row = page.locator('.pi-item', { has: page.locator('.pi-name', { hasText: 'eggs' }) })
                  .locator('.pi-row');
  await expect(row.locator('.pi-name')).toHaveText('eggs');
  await expect(row.locator('.pi-qty')).toHaveText('12 pcs');
  await expect(row.locator('.pi-date')).toContainText('Expires Aug 8');
  await expect(row.locator('.pi-date')).toHaveClass(/pi-date--printed/);

  // Aug 8 2026 is in the past for this suite's clock, so the honest relative state is
  // expired. The old behaviour produced "Best by <today+3> · 3d left" instead.
  await expect(row.locator('.pantry-fresh-badge')).toContainText('Expired');
  await expect(row).not.toContainText('3d left');
  await expect(row).not.toContainText('Best by');

  const it = await page.evaluate(() => {
    const p = AppState.pantry.find((x) => x.name === 'eggs');
    return { daysLeft: pantryDaysLeft(p), shelfLifeDays: p.shelfLifeDays };
  });
  expect(it.daysLeft).toBeLessThan(0);
  expect(it.shelfLifeDays).not.toBe(3);      // not the Protein category fallback
});

// ── 2-3. Comma form and full month form ────────────────────────────────────

test('the comma form works on the live site', async ({ page }) => {
  await loadLiveApp(page);
  expect(only(await bulkAdd(page, 'eggs, 12, pcs aug 8 2026')))
    .toMatchObject({ name: 'eggs', quantity: 12, unit: 'pcs',
                     expiryDate: '2026-08-08', dateMode: 'expiry' });
  // The fully-comma-separated form used to discard the date field silently.
  expect(only(await bulkAdd(page, 'eggs, 12, pcs, aug 8 2026')))
    .toMatchObject({ name: 'eggs', quantity: 12, unit: 'pcs', expiryDate: '2026-08-08' });
});

test('the full month form works on the live site', async ({ page }) => {
  await loadLiveApp(page);
  expect(only(await bulkAdd(page, 'eggs 12 pcs august 8 2026')))
    .toMatchObject({ name: 'eggs', quantity: 12, unit: 'pcs', expiryDate: '2026-08-08' });
  expect(only(await bulkAdd(page, 'eggs 12 pcs 8 aug 2026')))
    .toMatchObject({ name: 'eggs', quantity: 12, unit: 'pcs', expiryDate: '2026-08-08' });
});

// ── 4-7. exp:, invalid dates, shared expiry, precedence ────────────────────

test('the documented exp:YYYY-MM-DD syntax still works on the live site', async ({ page }) => {
  await loadLiveApp(page);
  expect(only(await bulkAdd(page, 'Eggs, 12, pcs exp:2026-08-08')))
    .toMatchObject({ name: 'Eggs', quantity: 12, unit: 'pcs',
                     expiryDate: '2026-08-08', dateMode: 'expiry' });
});

test('invalid explicit dates are rejected, not rolled over', async ({ page }) => {
  await loadLiveApp(page);
  // 2026-02-31 used to pass validation and render as "Expires Mar 3".
  //
  // UPDATED for D-068: the date verdict is unchanged — still rejected, never rolled over —
  // but the LINE is now held back instead of being added with the shared expiry silently
  // substituted, because a row that still needs editing cannot also be committed.
  const r = await bulkAdd(page, 'Eggs, 12, pcs exp:2026-02-31');
  expect(r.items).toHaveLength(0);
  expect(r.warnings).toContain('invalid expiry date');
  expect(r.warnings).not.toContain('Mar 3');

  const r2 = await bulkAdd(page, 'Eggs, 12, pcs exp:2026-13-45');
  expect(r2.items).toHaveLength(0);
  expect(r2.warnings).toContain('invalid expiry date');

  // A natural date naming a day the calendar lacks is left in the text, not nudged.
  const r3 = only(await bulkAdd(page, 'Eggs 12 pcs feb 31 2026'));
  expect(r3.expiryDate).toBeNull();
  expect(r3.name).toBe('Eggs 12 pcs feb 31 2026');
});

test('the shared expiry still works, and per-line beats it', async ({ page }) => {
  await loadLiveApp(page);
  // Shared applies when the line carries no date of its own.
  expect(only(await bulkAdd(page, 'Eggs, 12, pcs', { shared: '2026-12-25' })))
    .toMatchObject({ expiryDate: '2026-12-25', dateMode: 'expiry' });
  // A trailing natural date beats the shared field.
  expect(only(await bulkAdd(page, 'eggs 12 pcs aug 8 2026', { shared: '2026-12-25' })))
    .toMatchObject({ expiryDate: '2026-08-08' });
  // exp: beats both, and the trailing date is still stripped out of the name.
  const it = only(await bulkAdd(page, 'Eggs 12 pcs aug 8 2026 exp:2026-09-01',
                                { shared: '2026-12-25' }));
  expect(it.expiryDate).toBe('2026-09-01');
  expect(it.name).toBe('Eggs');
});

// ── 8. Ambiguous slash dates are never guessed ─────────────────────────────

test('an ambiguous slash date is not guessed on the live site', async ({ page }) => {
  await loadLiveApp(page);
  //
  // UPDATED for D-068: still never guessed, but the line is now held back rather than
  // added with the unparsed date sitting inside the name. The user's text survives in the
  // textarea for correction, which is the stronger form of "text untouched".
  const r = await bulkAdd(page, 'Milk 1 L 8/8/2026');
  expect(r.items).toHaveLength(0);
  expect(r.warnings).toContain('ambiguous');
  expect(await page.inputValue('#bulk-add-textarea')).toBe('Milk 1 L 8/8/2026');
});

// ── 9. Numeric product names survive ───────────────────────────────────────

test('numeric product names remain intact on the live site', async ({ page }) => {
  await loadLiveApp(page);
  const names = ['7 Up', 'Vitamin B12', '12 Grain Bread', 'Heinz 57 Sauce',
                 'Formula 1 Protein', 'Omega 3 6 9', 'Vitamin 2000'];
  const r = await bulkAdd(page, names.join('\n'));
  expect(r.items.map((i) => i.name)).toEqual(names);
  r.items.forEach((i, n) => {
    expect(i.expiryDate, names[n]).toBeNull();
    expect(i.quantity, names[n]).toBeNull();
  });
  expect(r.warnings).toBe('');
});

// ── 10. Existing free-text records untouched ───────────────────────────────

test('existing free-text pantry records are not migrated by the deployed build', async ({ page }) => {
  await loadLiveApp(page);
  const out = await page.evaluate(() => {
    AppState.pantry = [{
      id: 991001, name: 'eggs 12 pcs aug 8 2026', category: 'Protein', storage: 'fridge',
      purchaseDate: todayISO(), shelfLifeDays: 3, quantity: null, unit: ''
    }];
    saveData();
    renderPantry();
    const p = AppState.pantry[0];
    return { name: p.name, quantity: p.quantity,
             expiryDate: p.expiryDate, dateMode: p.dateMode };
  });
  expect(out.name).toBe('eggs 12 pcs aug 8 2026');   // untouched
  expect(out.quantity).toBeNull();
  expect(out.expiryDate).toBeUndefined();
  expect(out.dateMode).toBeUndefined();
  await expect(page.locator('.pi-row').first().locator('.pi-name'))
    .toHaveText('eggs 12 pcs aug 8 2026');
});

// ── 13. Short years, against the deployed bundle (D-067 TASK-054 extension) ─
//
// Every short-year assertion below is derived from the DEPLOYED app's own clock rather
// than from a literal, because the expansion is relative to the current year: a
// hard-coded `Aug 8 26 -> 2026-08-08` would start failing in 2037 when 26 leaves the
// plausibility window, and a production gate that rots is worse than no gate. Standing in
// 2026 these evaluate to exactly the reported inputs — `Eggs 12 pcs Aug 8 26`,
// `8 Aug 26`, and the comma form.
//
// Literals ARE used where they cannot rot: `May 5 12` and `May 5 2012` are permanently
// outside/unaffected by the window, and `2026-08-08` is a fixed valid calendar date.

test('short years parse on the live site, in every accepted spelling', async ({ page }) => {
  await loadLiveApp(page);
  const y = await page.evaluate(() => new Date().getFullYear());
  const two = String(y % 100).padStart(2, '0');
  const iso = y + '-08-08';

  // 1. the reported input, 2. day-first, 3. the comma form
  for (const line of [`Eggs 12 pcs Aug 8 ${two}`,
                      `Eggs 12 pcs August 8 ${two}`,
                      `Eggs 12 pcs 8 Aug ${two}`,
                      `Eggs, 12, pcs, Aug 8 ${two}`]) {
    const it = only(await bulkAdd(page, line));
    expect(it.name, line).toBe('Eggs');
    expect(it.quantity, line).toBe(12);
    expect(it.unit, line).toBe('pcs');
    expect(it.expiryDate, line).toBe(iso);
    expect(it.dateMode, line).toBe('expiry');
    // The pre-fix symptom: the whole line became the name and took a category guess.
    expect(it.name, line).not.toMatch(/Aug/i);
  }

  // 4-5. the four-digit twin is byte-for-byte the same record.
  const short = only(await bulkAdd(page, `Eggs 12 pcs Aug 8 ${two}`));
  const long = only(await bulkAdd(page, `Eggs 12 pcs Aug 8 ${y}`));
  expect(short).toEqual(long);
});

test('the short-year window boundary is correct for the deployed runtime year',
  async ({ page }) => {
    await loadLiveApp(page);
    // 9. Derived entirely from the live app's clock, so it states the rule.
    const probe = await page.evaluate(() => {
      const y = new Date().getFullYear();
      const two = (n) => String(n % 100).padStart(2, '0');
      const verdict = (n) => {
        const r = parseTrailingDate('Eggs Aug 8 ' + two(n));
        return r && r.iso ? 'parsed:' + r.iso : (r && r.shortYear ? 'rejected' : 'not-a-date');
      };
      return { year: y,
               below: verdict(y - 2), lower: verdict(y - 1), now: verdict(y),
               plusTen: verdict(y + 10), above: verdict(y + 11) };
    });
    expect(probe.lower).toBe('parsed:' + (probe.year - 1) + '-08-08');
    expect(probe.now).toBe('parsed:' + probe.year + '-08-08');
    expect(probe.plusTen).toBe('parsed:' + (probe.year + 10) + '-08-08');
    expect(probe.below).toBe('rejected');
    expect(probe.above).toBe('rejected');
  });

test('an implausible short year is held back on the live site, not persisted',
  async ({ page }) => {
    await loadLiveApp(page);
    // 6. `12` left the window in 2014 and can never re-enter it, so this literal is safe.
    const line = 'Juice May 5 12';
    const r = await bulkAdd(page, line);
    expect(r.items).toHaveLength(0);
    expect(r.warnings).toContain('outside the expected food-expiry range');
    expect(r.warnings).toContain('four-digit year');
    expect(await page.inputValue('#bulk-add-textarea')).toBe(line);

    // The shared expiry field must not rescue it either.
    const shared = await bulkAdd(page, line, { shared: '2026-12-25' });
    expect(shared.items).toHaveLength(0);
    expect(shared.warnings).toContain('outside the expected food-expiry range');

    // One computed out-of-window year too, so this cannot pass on a stale literal alone.
    const computed = await page.evaluate(() => {
      const y = new Date().getFullYear() - 2;
      return 'Juice May 5 ' + String(y % 100).padStart(2, '0');
    });
    const r2 = await bulkAdd(page, computed);
    expect(r2.items, computed).toHaveLength(0);
    expect(r2.warnings, computed).toContain('outside the expected food-expiry range');
  });

test('a valid exp: overrides an implausible short year on the live site', async ({ page }) => {
  await loadLiveApp(page);
  // 7. The short year is NOT stripped — it was never accepted as a date — and exp: is
  // the only expiry source.
  const it = only(await bulkAdd(page, 'Juice May 5 12 exp:2026-08-08'));
  expect(it.name).toBe('Juice May 5 12');
  expect(it.expiryDate).toBe('2026-08-08');
  expect(it.dateMode).toBe('expiry');
  const clean = await bulkAdd(page, 'Juice May 5 12 exp:2026-08-08');
  expect(clean.warnings).toBe('');

  // 12. An INVALID exp: still fails on its own terms and rescues nothing.
  const bad = await bulkAdd(page, 'Juice May 5 12 exp:2026-02-31');
  expect(bad.items).toHaveLength(0);
  expect(bad.warnings).toContain('invalid expiry date');
  expect(await page.inputValue('#bulk-add-textarea')).toBe('Juice May 5 12 exp:2026-02-31');

  // A PLAUSIBLE short year plus exp: keeps the original D-067 contract: date stripped,
  // exp: wins.
  const two = await page.evaluate(() => String(new Date().getFullYear() % 100).padStart(2, '0'));
  const both = only(await bulkAdd(page, `Eggs 12 pcs Aug 8 ${two} exp:2026-09-01`,
                                  { shared: '2026-12-25' }));
  expect(both.name).toBe('Eggs');
  expect(both.quantity).toBe(12);
  expect(both.expiryDate).toBe('2026-09-01');
});

test('four-digit years are never windowed on the live site', async ({ page }) => {
  await loadLiveApp(page);
  // 8. No general expiry-age restriction: an explicitly typed year is stored as typed.
  const cases = { 'Juice May 5 2012': '2012-05-05', 'Juice 5 May 2012': '2012-05-05',
                  'Juice May 5 1999': '1999-05-05', 'Juice May 5 2099': '2099-05-05',
                  'Juice 2012-05-05': '2012-05-05' };
  for (const line of Object.keys(cases)) {
    const it = only(await bulkAdd(page, line));
    expect(it.expiryDate, line).toBe(cases[line]);
    expect(it.name, line).toBe('Juice');
  }
});

test('short-year slash dates and impossible days are still refused on the live site',
  async ({ page }) => {
    await loadLiveApp(page);
    const two = await page.evaluate(() => String(new Date().getFullYear() % 100).padStart(2, '0'));

    // 10. Day-first vs month-first is not guessed at any year width.
    for (const line of [`Milk 1 L 8/8/${two}`, 'Milk 1 L 8/8/26', 'Milk 1 L 8/8/2026']) {
      const r = await bulkAdd(page, line);
      expect(r.items, line).toHaveLength(0);
      expect(r.warnings, line).toContain('ambiguous');
      expect(await page.inputValue('#bulk-add-textarea'), line).toBe(line);
    }

    // 11. February has no 31st, at either year width, and nothing rolls into March.
    for (const line of [`Eggs 12 pcs Feb 31 ${two}`, `Eggs 12 pcs 31 Feb ${two}`,
                        'Eggs 12 pcs Feb 31 2026']) {
      const it = only(await bulkAdd(page, line));
      expect(it.expiryDate, line).toBeNull();
      expect(it.name, line).toBe(line);          // left alone, never nudged
    }

    // 12. The exp: calendar guard is intact.
    const r = await bulkAdd(page, 'Eggs, 12, pcs exp:2026-02-31');
    expect(r.items).toHaveLength(0);
    expect(r.warnings).toContain('invalid expiry date');
  });

test('numeric and month-word product names survive on the live site', async ({ page }) => {
  await loadLiveApp(page);
  // 13. A two-digit number is never a year on its own: recognition needs the complete
  // grammar, month word AND day AND year.
  const names = ['7 Up', 'Heinz 57 Sauce', 'Formula 26', 'Protein 8 26', 'Vitamin B12',
                 '12 Grain Bread', 'Omega 3 6 9', 'Sauce Aug 26', 'Vitamin May 26',
                 'Vitamin 2000', 'Blend 2026'];
  const r = await bulkAdd(page, names.join('\n'));
  expect(r.items.map((i) => i.name)).toEqual(names);
  r.items.forEach((i, n) => {
    expect(i.expiryDate, names[n]).toBeNull();
    expect(i.dateMode, names[n]).toBeNull();
  });
  expect(r.warnings).toBe('');
});

test.describe('deployed mobile short years', () => {
  test.use({ viewport: { width: 390, height: 1500 } });

  test('live 390px: a short year parses and nothing overflows', async ({ page }) => {
    await loadLiveApp(page);
    // 16. Including the updated help copy, which is the only markup this wave touched.
    const two = await page.evaluate(() => String(new Date().getFullYear() % 100).padStart(2, '0'));
    await page.evaluate(() => { AppState.pantry = []; showTab('fridge'); openBulkAddModal(); });
    await page.fill('#bulk-add-textarea', `eggs 12 pcs aug 8 ${two}`);
    await page.waitForTimeout(300);

    const before = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth }));
    expect(before.scrollW).toBeLessThanOrEqual(before.clientW);
    const box = await page.locator('#bulk-add-modal .modal-content').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(391);

    await page.click('#bulk-add-modal button:has-text("Add Items")');
    await page.waitForTimeout(500);

    const rec = await page.evaluate(() => AppState.pantry.find((p) => p.name === 'eggs'));
    expect(rec).toBeTruthy();
    expect(rec.quantity).toBe(12);
    expect(rec.expiryDate).toBe(await page.evaluate(() => new Date().getFullYear()) + '-08-08');

    const after = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth }));
    expect(after.scrollW).toBeLessThanOrEqual(after.clientW);
  });
});

test('no console or page errors through the deployed short-year flow', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await loadLiveApp(page);
  const two = await page.evaluate(() => String(new Date().getFullYear() % 100).padStart(2, '0'));
  await page.evaluate(() => { AppState.pantry = []; showTab('fridge'); openBulkAddModal(); });
  await page.fill('#bulk-add-textarea', [`Eggs 12 pcs Aug 8 ${two}`,
                                         'Juice May 5 12',
                                         'Juice May 5 12 exp:2026-08-08',
                                         `Butter 250 g Feb 31 ${two}`,
                                         'Formula 26',
                                         'Milk 1 L 8/8/26'].join('\n'));
  await page.click('#bulk-add-modal button:has-text("Add Items")');
  await page.waitForTimeout(700);
  await page.evaluate(() => { showTab('fridge'); renderPantry(); });
  await page.waitForTimeout(400);

  // 17. Same exclusion list the other production smokes use: requestStorageAccess is the
  // real Firebase SDK hitting Chromium storage partitioning in a headless third-party
  // context, and the 403s are App Check / installations behind it. Both are environmental
  // and absent in a normal browser. Nothing app-specific is excluded.
  const real = errors.filter((e) =>
    !/net::ERR|Failed to load resource|favicon|requestStorageAccess|frame-ancestors|google\.com|firebase|firestore|installations|app-check/i.test(e));
  expect(real, 'unexpected errors:\n' + real.join('\n')).toEqual([]);
});

// ── 11. Mobile Bulk Add ────────────────────────────────────────────────────

test.describe('deployed mobile Bulk Add', () => {
  test.use({ viewport: { width: 390, height: 1500 } });

  test('390px: Bulk Add has no horizontal overflow and still parses a date', async ({ page }) => {
    await loadLiveApp(page);
    await page.evaluate(() => { AppState.pantry = []; showTab('fridge'); openBulkAddModal(); });
    await page.fill('#bulk-add-textarea', 'eggs 12 pcs aug 8 2026');
    await page.waitForTimeout(300);

    const o = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth
    }));
    expect(o.scrollW).toBeLessThanOrEqual(o.clientW);

    // The modal itself must fit the viewport, not just the page.
    const box = await page.locator('#bulk-add-modal .modal-content').boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390 + 1);

    await page.click('#bulk-add-modal button:has-text("Add Items")');
    await page.waitForTimeout(500);

    const rec = await page.evaluate(() => AppState.pantry.find((p) => p.name === 'eggs'));
    expect(rec).toBeTruthy();
    expect(rec.quantity).toBe(12);
    expect(rec.expiryDate).toBe('2026-08-08');

    const after = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth
    }));
    expect(after.scrollW).toBeLessThanOrEqual(after.clientW);
  });
});

// ── 12. No console or page errors ──────────────────────────────────────────

test('no console or page errors through the deployed bulk-add flow', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await loadLiveApp(page);
  await page.evaluate(() => { AppState.pantry = []; showTab('fridge'); openBulkAddModal(); });
  await page.fill('#bulk-add-textarea', [
    'eggs 12 pcs aug 8 2026',
    'Milk, 1, L exp:2026-09-01',
    'Coconut cream 200ml',
    '7 Up',
    'Butter 250 g 8/8/2026'
  ].join('\n'));
  await page.click('#bulk-add-modal button:has-text("Add Items")');
  await page.waitForTimeout(600);
  await page.evaluate(() => { closeBulkAddModal(); showTab('dashboard'); });
  await page.waitForTimeout(600);
  await page.evaluate(() => { showTab('fridge'); renderPantry(); refreshFreshnessAlerts(); });
  await page.waitForTimeout(600);
  await page.locator('.pi-row').first().click();
  await page.waitForTimeout(400);

  // Same exclusion list the other production smokes use: requestStorageAccess is the real
  // Firebase SDK hitting Chromium storage partitioning in a headless third-party context,
  // and frame-ancestors/google.com is the App Check reCAPTCHA iframe. Both are
  // environmental and absent in a normal browser. Nothing app-specific is excluded.
  const real = errors.filter((e) =>
    !/net::ERR|Failed to load resource|favicon|requestStorageAccess|frame-ancestors|google\.com|firebase|firestore|installations|app-check/i.test(e));
  expect(real, 'unexpected errors:\n' + real.join('\n')).toEqual([]);
});
