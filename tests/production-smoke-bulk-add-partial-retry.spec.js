const { test, expect } = require('@playwright/test');

/**
 * Production smoke for Bulk Add partial-retry (TASK-052, D-068).
 *
 * Runs against the DEPLOYED GitHub Pages build. Firebase is deliberately NOT stubbed —
 * the page loads it for real and stays signed out, the normal first-visit path. Each test
 * gets a fresh isolated context, so nothing persists between tests and nothing touches a
 * real account's cloud data.
 *
 * Kept separate from production-smoke-bulk-add-dates.spec.js on purpose: that file proves
 * the D-067 parser, this one proves the D-068 control flow around it.
 *
 * The contract under test (statuses extended by D-069):
 *   added     -> committed once, removed from the retry textarea
 *   merged    -> topped up existing stock; resolved, removed, reported as updated stock
 *   skipped   -> already in pantry with nothing to add; resolved, removed, still reported
 *   attention -> NOT committed, stays for correction in original text and order
 *
 * D-069 changed WHAT a duplicate line does, not how the retry pass treats it. openLiveBulk()
 * preloads records with an UNTRACKED quantity, so "unknown + 12" has no honest sum and the
 * purchase becomes its own record rather than being thrown away.
 *
 * Everything drives the real modal inputs and the real Add Items button, so a regression
 * in the shipped control flow shows up here rather than in a reimplementation of it.
 */

const APP_URL = 'https://shinyamadasan.github.io/Meal-Prep/';

test.use({ viewport: { width: 1280, height: 1700 } });

async function loadLiveApp(page) {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__bulkRetryProdBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__bulkRetryProdBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
  });
  await page.goto(APP_URL + '?smoke=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load').catch(() => {});
  await page.waitForFunction(
    'typeof AppState !== "undefined" && Array.isArray(AppState.recipes)',
    null, { timeout: 45000 });
  await page.waitForTimeout(3000);
}

async function openLiveBulk(page, { preload = [], shared = '', storage = '' } = {}) {
  await page.evaluate(({ preload, shared, storage }) => {
    AppState.pantry = preload.map((n, i) => ({
      id: 970500 + i, name: n, category: 'Protein', storage: 'fridge',
      purchaseDate: todayISO(), shelfLifeDays: 3, quantity: null, unit: ''
    }));
    showTab('fridge');
    openBulkAddModal();
    document.getElementById('bulk-add-expiry').value = shared;
    document.getElementById('bulk-add-default-storage').value = storage;
  }, { preload, shared, storage });
}

async function pressAdd(page, text) {
  if (text !== null) await page.fill('#bulk-add-textarea', text);
  await page.click('#bulk-add-modal button:has-text("Add Items")');
  await page.waitForTimeout(400);
  return page.evaluate(() => ({
    pantry: AppState.pantry.map((p) => ({ name: p.name, quantity: p.quantity,
                                          unit: p.unit, expiryDate: p.expiryDate || null })),
    textarea: document.getElementById('bulk-add-textarea').value,
    modalOpen: !document.getElementById('bulk-add-modal').classList.contains('hidden'),
    summary: (document.querySelector('.bulk-add-summary') || {}).textContent || '',
    notes: Array.from(document.querySelectorAll('.bulk-add-warn li')).map((li) => li.textContent),
    toast: (document.querySelector('.success-message') || {}).textContent || '',
    sharedExpiry: document.getElementById('bulk-add-expiry').value,
    sharedStorage: document.getElementById('bulk-add-default-storage').value
  }));
}

const OK1 = 'Eggs 12 pcs Aug 8 2026';
const BAD = 'Milk 2 L 8/8/2026';
const OK2 = 'Chicken 1 kg Sep 1 2026';

// ── 0. The control flow is actually deployed ───────────────────────────────

test('the deployed bundle contains the partial-retry flow', async ({ page }) => {
  await loadLiveApp(page);
  expect(await page.evaluate(() => typeof buildBulkAddSummary === 'function')).toBe(true);
  // Four-argument signature since D-069: added, merged, skipped, attention.
  expect(await page.evaluate(() => buildBulkAddSummary(2, 1, 1, 1)))
    .toBe('2 items added · 1 stock item updated · 1 already in pantry · 1 line needs attention.');
  expect(await page.evaluate(() => typeof canMergePurchaseInto === 'function')).toBe(true);
  expect(await page.evaluate(() => typeof applyPurchaseToStock === 'function')).toBe(true);
});

// ── 1. Partial success ─────────────────────────────────────────────────────

test('live: partial success adds the valid lines and keeps only the unresolved one', async ({ page }) => {
  await loadLiveApp(page);
  await openLiveBulk(page);
  const r = await pressAdd(page, [OK1, BAD, OK2].join('\n'));

  expect(r.pantry.filter((p) => p.name === 'Eggs')).toHaveLength(1);      // exactly once
  expect(r.pantry.filter((p) => p.name === 'Chicken')).toHaveLength(1);   // exactly once
  expect(r.pantry.map((p) => p.name).sort()).toEqual(['Chicken', 'Eggs']);
  expect(r.pantry.some((p) => p.name.includes('8/8'))).toBe(false);       // Milk NOT added
  expect(r.modalOpen).toBe(true);
  expect(r.textarea).toBe(BAD);
  expect(r.summary).toBe('2 items added · 1 line needs attention.');
});

// ── 2. The retry does not reprocess ────────────────────────────────────────

test('live: correcting the remaining line in place processes only that line', async ({ page }) => {
  await loadLiveApp(page);
  await openLiveBulk(page);
  await pressAdd(page, [OK1, BAD, OK2].join('\n'));

  // Corrected in place against the real post-submit contents. A hand-typed replacement
  // would discard the leftovers instead of resubmitting them, and so could not detect a
  // regression here at all.
  const corrected = (await page.inputValue('#bulk-add-textarea')).replace('8/8/2026', 'Aug 8 2026');
  const r = await pressAdd(page, corrected);

  expect(r.pantry).toHaveLength(3);
  expect(r.pantry.map((p) => p.name).sort()).toEqual(['Chicken', 'Eggs', 'Milk']);
  expect(r.pantry.find((p) => p.name === 'Milk')).toMatchObject({
    quantity: 2, unit: 'L', expiryDate: '2026-08-08' });
  // The load-bearing assertion: Eggs and Chicken were finished on pass one, so the retry
  // saw ONE line. Reprocessing them would read "1 item added · 2 already in pantry."
  expect(r.toast).toBe('1 item added.');
  expect(r.notes.join(' ')).not.toContain('already in pantry');
  expect(r.modalOpen).toBe(false);
});

// ── 3. Duplicate + valid + actionable ──────────────────────────────────────

test('live: duplicate + valid + actionable are each classified honestly', async ({ page }) => {
  await loadLiveApp(page);
  await openLiveBulk(page, { preload: ['Eggs'] });
  const r = await pressAdd(page, ['Eggs, 12, pcs', OK2, BAD].join('\n'));

  expect(r.pantry.map((p) => p.name).sort()).toEqual(['Chicken', 'Eggs', 'Eggs']);
  // The pre-existing untracked record is untouched; the purchase is represented too.
  expect(r.pantry.filter((p) => p.name === 'Eggs').map((p) => p.quantity).sort())
    .toEqual([12, null]);
  expect(r.textarea).toBe(BAD);            // duplicate resolved and dropped from the retry
  expect(r.summary).toBe('2 items added · 1 line needs attention.');
});

// ── 4-5. Actionable rows are never persisted; all-invalid keeps everything ─

test('live: actionable rows are never persisted before correction', async ({ page }) => {
  await loadLiveApp(page);
  await openLiveBulk(page, { shared: '2026-12-25' });
  const lines = [BAD, 'Butter 250 g 1/2/2026', 'Eggs, 12, pcs exp:2026-02-31'];
  const r = await pressAdd(page, lines.join('\n'));

  expect(r.pantry).toHaveLength(0);          // nothing committed, not even partially
  expect(r.modalOpen).toBe(true);
  expect(r.textarea).toBe(lines.join('\n')); // all preserved, original text and order
  expect(r.summary).toBe('3 lines need attention.');
});

// ── 6. All-duplicate does not trap the user ────────────────────────────────

test('live: an all-duplicate batch closes with an honest summary', async ({ page }) => {
  await loadLiveApp(page);
  await openLiveBulk(page, { preload: ['Eggs', 'Chicken', 'Milk'] });
  const r = await pressAdd(page, 'Eggs, 12, pcs\nChicken 1 kg\nMilk 2 L');

  // Each preloaded record has an untracked quantity, so none of the three purchases has an
  // honest sum to fold into. Each is kept as its own record — losing them was the complaint.
  expect(r.pantry).toHaveLength(6);
  expect(r.pantry.filter((p) => p.quantity !== null).map((p) => p.quantity).sort())
    .toEqual([1, 12, 2]);
  expect(r.modalOpen).toBe(false);           // no pointless retry loop
  expect(r.toast).toBe('3 items added.');
});

// ── 8. Shared controls survive ─────────────────────────────────────────────

test('live: shared Storage and Expiry survive a partial submit and apply on the retry', async ({ page }) => {
  await loadLiveApp(page);
  await openLiveBulk(page, { shared: '2026-12-25', storage: 'freezer' });
  const r = await pressAdd(page, [OK1, BAD].join('\n'));
  expect(r.modalOpen).toBe(true);
  expect(r.sharedExpiry).toBe('2026-12-25');
  expect(r.sharedStorage).toBe('freezer');

  const r2 = await pressAdd(page, 'Milk 2 L');
  expect(r2.pantry.find((p) => p.name === 'Milk').expiryDate).toBe('2026-12-25');
  expect(await page.evaluate(() =>
    AppState.pantry.find((p) => p.name === 'Milk').storage)).toBe('freezer');
});

// ── 9. Persistence ─────────────────────────────────────────────────────────

test('live: save/reload contains each successfully added item exactly once', async ({ page }) => {
  await loadLiveApp(page);
  await openLiveBulk(page);
  await pressAdd(page, [OK1, BAD, OK2].join('\n'));
  const corrected = (await page.inputValue('#bulk-add-textarea')).replace('8/8/2026', 'Aug 8 2026');
  await pressAdd(page, corrected);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    'typeof AppState !== "undefined" && Array.isArray(AppState.recipes)', null, { timeout: 45000 });
  await page.waitForTimeout(2500);

  const names = await page.evaluate(() => AppState.pantry.map((p) => p.name).sort());
  expect(names).toEqual(['Chicken', 'Eggs', 'Milk']);
  expect(new Set(names).size).toBe(3);       // retry introduced no duplicate records
});

// ── 10. Mobile ─────────────────────────────────────────────────────────────

// ── Short years inside the retry loop (D-067 TASK-054 extension) ───────────
//
// D-068's contract is about STATUS, not about dates, so the short-year extension has to
// slot into it without adding a fifth state: a plausible short year is `added` and
// disappears, an implausible one is `attention` and stays, and one rescued by an explicit
// exp: is `added` like any other resolved line. Short years are built from the deployed
// app's own clock so this gate cannot rot as the calendar advances.

test('live: a plausible short year resolves, an implausible one stays for correction',
  async ({ page }) => {
    await loadLiveApp(page);
    const two = await page.evaluate(() => String(new Date().getFullYear() % 100).padStart(2, '0'));
    const iso = await page.evaluate(() => new Date().getFullYear() + '-08-08');
    const good = `Eggs 12 pcs Aug 8 ${two}`;
    const stale = 'Juice 1 L May 5 12';

    await openLiveBulk(page);
    const r = await pressAdd(page, [good, stale, 'Chicken 1 kg Sep 1 2031'].join('\n'));

    expect(r.pantry.map((p) => p.name).sort()).toEqual(['Chicken', 'Eggs']);
    expect(r.pantry.find((p) => p.name === 'Eggs').expiryDate).toBe(iso);
    // Not added under any name — the date text was not swallowed into one.
    expect(r.pantry.some((p) => p.name.includes('May 5'))).toBe(false);
    expect(r.modalOpen).toBe(true);
    expect(r.textarea).toBe(stale);                 // exact original text, byte for byte
    expect(r.summary).toBe('2 items added · 1 line needs attention.');
    expect(r.notes.join(' ')).toContain('outside the expected food-expiry range');

    // Correcting it finishes the batch and re-processes nothing: the two resolved lines
    // left the textarea on the first pass, so there is no "already in pantry" here.
    const corrected = (await page.inputValue('#bulk-add-textarea'))
      .replace('May 5 12', 'May 5 2012');
    const r2 = await pressAdd(page, corrected);
    expect(r2.pantry).toHaveLength(3);
    expect(r2.pantry.find((p) => p.name === 'Juice').expiryDate).toBe('2012-05-05');
    expect(r2.toast).toBe('1 item added.');
    expect(r2.notes.join(' ')).not.toContain('already in pantry');
    expect(r2.modalOpen).toBe(false);
    const names = r2.pantry.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);  // no duplicate reprocessing
  });

test('live: an exp:-rescued short year is a resolved line and leaves the textarea',
  async ({ page }) => {
    await loadLiveApp(page);
    await openLiveBulk(page);
    const rescued = 'Juice 1 L May 5 12 exp:2026-08-08';
    const stale = 'Nectar 1 L May 5 12';
    const r = await pressAdd(page, [rescued, stale].join('\n'));

    const juice = r.pantry.find((p) => p.name === 'Juice 1 L May 5 12');
    expect(juice).toBeTruthy();                     // name keeps the unrecognised text
    expect(juice.expiryDate).toBe('2026-08-08');    // exp: is the only expiry source
    expect(r.pantry.some((p) => p.name.startsWith('Nectar'))).toBe(false);
    expect(r.textarea).toBe(stale);                 // only the actionable line stays
    expect(r.modalOpen).toBe(true);
  });

test.describe('deployed mobile partial retry', () => {
  test.use({ viewport: { width: 390, height: 1500 } });

  test('live 390px: feedback readable, retry editable, nothing overflows', async ({ page }) => {
    await loadLiveApp(page);
    await openLiveBulk(page);
    const r = await pressAdd(page, [OK1, BAD, OK2].join('\n'));

    expect(r.modalOpen).toBe(true);
    expect(r.textarea).toBe(BAD);
    expect(r.summary).toBe('2 items added · 1 line needs attention.');

    const o = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth
    }));
    expect(o.scrollW).toBeLessThanOrEqual(o.clientW);

    const modal = await page.locator('#bulk-add-modal .modal-content').boundingBox();
    expect(modal.x).toBeGreaterThanOrEqual(0);
    expect(modal.x + modal.width).toBeLessThanOrEqual(391);

    for (const sel of ['.bulk-add-summary', '#bulk-add-textarea',
                       '#bulk-add-modal button:has-text("Add Items")']) {
      await expect(page.locator(sel)).toBeVisible();
      const b = await page.locator(sel).boundingBox();
      expect(b.x, sel).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, sel).toBeLessThanOrEqual(391);
    }
    const ta = await page.locator('#bulk-add-textarea').boundingBox();
    expect(ta.height).toBeGreaterThan(60);

    // The remaining line is genuinely editable on the phone, not just visible.
    await page.fill('#bulk-add-textarea', 'Milk 2 L Aug 8 2026');
    const r2 = await pressAdd(page, null);
    expect(r2.pantry).toHaveLength(3);
    expect(r2.modalOpen).toBe(false);
  });
});

// ── 11. No console or page errors ──────────────────────────────────────────

test('live: no console or page errors through a full partial-retry cycle', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

  await loadLiveApp(page);
  await openLiveBulk(page, { preload: ['Butter'] });
  await pressAdd(page, [OK1, BAD, OK2, 'Butter, 250, g', 'Cheese, abc, g'].join('\n'));
  const corrected = (await page.inputValue('#bulk-add-textarea'))
    .replace('8/8/2026', 'Aug 8 2026').replace('abc', '250');
  await pressAdd(page, corrected);
  await page.evaluate(() => { showTab('dashboard'); });
  await page.waitForTimeout(600);
  await page.evaluate(() => { showTab('fridge'); renderPantry(); refreshFreshnessAlerts(); });
  await page.waitForTimeout(600);

  // Same exclusion list the other production smokes use: Firebase SDK artefacts of a
  // headless third-party context. Nothing app-specific is excluded.
  const real = errors.filter((e) =>
    !/net::ERR|Failed to load resource|favicon|requestStorageAccess|frame-ancestors|google\.com|firebase|firestore|installations|app-check/i.test(e));
  expect(real, 'unexpected errors:\n' + real.join('\n')).toEqual([]);
});
