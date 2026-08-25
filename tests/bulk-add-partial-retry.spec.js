const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');
const { waitForAppReady } = require('./app-ready');

/**
 * Bulk Add partial success — finished lines leave, unresolved lines stay.
 *
 * The behaviour this file exists to prevent coming back:
 *
 *   Bulk Add persisted the valid lines, then kept the modal open because a sibling line
 *   had warned, and left the textarea completely untouched. Pressing Add Items again
 *   re-submitted the lines that had already succeeded, which then reported
 *   "already in pantry — skipped". The user could not tell which items had actually
 *   landed and which still needed fixing.
 *
 * Characterisation also found something the retry loop cannot survive: TWO warning paths
 * warned and then added the item anyway.
 *
 *   "Milk 2 L 8/8/2026"          -> warned, AND added as name="Milk 2 L 8/8/2026"
 *                                   with the shared expiry silently substituted
 *   "Eggs, 12, pcs exp:2026-02-31" -> warned, AND added as "Eggs" with the shared
 *                                   expiry standing in for the rejected date
 *
 * Keeping those lines for correction while their items already existed would have
 * produced a junk record plus a second copy on the retry. They are now held back, which
 * is the one behavioural change here beyond control flow: an actionable warning means
 * the line is NOT committed.
 *
 * D-067 date parsing itself is untouched — this file starts after classification.
 */

test.use({ viewport: { width: 1280, height: 1600 } });

async function loadLocalApp(page) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__bulkRetryBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__bulkRetryBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
  });
  await page.goto(pathToFileURL(path.resolve('index.html')).href, { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
}

// Opens the real modal and clears inventory. Shared controls are set so their survival
// across a partial submit can be asserted.
async function openBulk(page, { preload = [], shared = '', storage = '' } = {}) {
  await page.evaluate(({ preload, shared, storage }) => {
    AppState.pantry = preload.map((n, i) => ({
      id: 900100 + i, name: n, category: 'Protein', storage: 'fridge',
      purchaseDate: todayISO(), shelfLifeDays: 3, quantity: null, unit: ''
    }));
    showTab('fridge');
    openBulkAddModal();
    document.getElementById('bulk-add-expiry').value = shared;
    document.getElementById('bulk-add-default-storage').value = storage;
  }, { preload, shared, storage });
}

// Types into the real textarea and presses the real Add Items button.
async function submit(page, text) {
  if (text !== null) await page.fill('#bulk-add-textarea', text);
  await page.click('#bulk-add-modal button:has-text("Add Items")');
  await page.waitForTimeout(200);
  return page.evaluate(() => ({
    pantry: AppState.pantry.map((p) => ({
      name: p.name, quantity: p.quantity, unit: p.unit,
      expiryDate: p.expiryDate === undefined ? null : p.expiryDate
    })),
    textarea: document.getElementById('bulk-add-textarea').value,
    modalOpen: !document.getElementById('bulk-add-modal').classList.contains('hidden'),
    summary: (document.querySelector('.bulk-add-summary') || {}).textContent || '',
    notes: Array.from(document.querySelectorAll('.bulk-add-warn li')).map((li) => li.textContent),
    toast: (document.querySelector('.success-message') || {}).textContent || '',
    sharedExpiry: document.getElementById('bulk-add-expiry').value,
    sharedStorage: document.getElementById('bulk-add-default-storage').value
  }));
}

const AMBIG = 'Milk 2 L 8/8/2026';
const OK1 = 'Eggs 12 pcs Aug 8 2026';
const OK2 = 'Chicken 1 kg Sep 1 2026';

// ── 1-3. The core partial-success behaviour ────────────────────────────────

test('1. two valid lines plus an ambiguous one: valid added, only the ambiguous line remains', async ({ page }) => {
  await loadLocalApp(page);
  await openBulk(page);
  const r = await submit(page, [OK1, AMBIG, OK2].join('\n'));

  expect(r.pantry.map((p) => p.name).sort()).toEqual(['Chicken', 'Eggs']);
  expect(r.modalOpen).toBe(true);
  expect(r.textarea).toBe(AMBIG);            // exactly the unresolved line, nothing else
  // The ambiguous line is NOT in inventory under any name.
  expect(r.pantry.some((p) => p.name.includes('8/8'))).toBe(false);
});

test('2. correcting the remaining line adds only that item and re-processes nothing', async ({ page }) => {
  await loadLocalApp(page);
  await openBulk(page);
  await submit(page, [OK1, AMBIG, OK2].join('\n'));

  // Correct the date IN PLACE, exactly as a user would: take whatever the textarea now
  // holds and fix the one bad date in it. Passing a hand-typed replacement here would
  // paper over the bug, because it would discard the leftover lines instead of
  // resubmitting them — the retry has to run against the real post-submit contents.
  const corrected = (await page.inputValue('#bulk-add-textarea')).replace('8/8/2026', 'Aug 8 2026');
  const r = await submit(page, corrected);

  expect(r.pantry).toHaveLength(3);
  expect(r.pantry.map((p) => p.name).sort()).toEqual(['Chicken', 'Eggs', 'Milk']);
  // The load-bearing assertion. Eggs and Chicken were finished on the first pass, so the
  // retry must have seen ONE line. If the already-successful lines were still sitting in
  // the textarea, this reads "1 item added · 2 already in pantry." instead.
  expect(r.toast).toBe('1 item added.');
  expect(r.notes.join(' ')).not.toContain('already in pantry');
  expect(r.modalOpen).toBe(false);           // everything resolved -> normal close
  // Exactly one record each — the retry created no second copies.
  const names = r.pantry.map((p) => p.name);
  expect(new Set(names).size).toBe(names.length);
});

test('3. the partial summary reports added and needs-attention counts accurately', async ({ page }) => {
  await loadLocalApp(page);
  await openBulk(page);
  const r = await submit(page, [OK1, AMBIG, OK2].join('\n'));
  expect(r.summary).toBe('2 items added · 1 line needs attention.');
});

// ── 4. Duplicate + valid + actionable ──────────────────────────────────────

// D-069 changed WHAT a duplicate line does, not how the retry pass treats it. The
// preloaded Eggs record here has an untracked quantity, so "unknown + 12" has no honest
// sum — the purchase becomes its own record rather than overwriting a real number with
// `null` or being thrown away. Either way the line is finished and leaves the textarea.
test('4. a resolved duplicate is dropped from retry; actionable line stays', async ({ page }) => {
  await loadLocalApp(page);
  await openBulk(page, { preload: ['Eggs'] });
  const r = await submit(page, ['Eggs, 12, pcs', OK2, AMBIG].join('\n'));

  expect(r.pantry.map((p) => p.name).sort()).toEqual(['Chicken', 'Eggs', 'Eggs']);
  // The pre-existing untracked record is untouched; the purchase is now visible too.
  expect(r.pantry.filter((p) => p.name === 'Eggs').map((p) => p.quantity).sort())
    .toEqual([12, null]);
  expect(r.textarea).toBe(AMBIG);            // resolved line gone, actionable line kept
  expect(r.summary).toBe('2 items added · 1 line needs attention.');
});

// ── 5-7. All-success, all-actionable, all-duplicate ────────────────────────

test('5. an all-valid batch still closes the modal and toasts as before', async ({ page }) => {
  await loadLocalApp(page);
  await openBulk(page);
  const r = await submit(page, [OK1, OK2].join('\n'));

  expect(r.pantry).toHaveLength(2);
  expect(r.modalOpen).toBe(false);
  expect(r.toast).toBe('2 items added.');
  expect(r.summary).toBe('');

  // Re-opening resets the form through the existing lifecycle.
  await page.evaluate(() => openBulkAddModal());
  await expect(page.locator('#bulk-add-textarea')).toHaveValue('');
  await expect(page.locator('#bulk-add-expiry')).toHaveValue('');
});

test('6. an all-actionable batch adds nothing and keeps every line', async ({ page }) => {
  await loadLocalApp(page);
  await openBulk(page);
  const lines = [AMBIG, 'Butter 250 g 1/2/2026', 'Eggs, 12, pcs exp:2026-02-31'];
  const r = await submit(page, lines.join('\n'));

  expect(r.pantry).toHaveLength(0);          // inventory untouched
  expect(r.modalOpen).toBe(true);
  expect(r.textarea).toBe(lines.join('\n')); // all preserved, in order
  expect(r.summary).toBe('3 lines need attention.');
});

test('7. an all-duplicate batch resolves every line and does not trap the user', async ({ page }) => {
  await loadLocalApp(page);
  await openBulk(page, { preload: ['Eggs', 'Chicken', 'Milk'] });
  const r = await submit(page, 'Eggs, 12, pcs\nChicken 1 kg\nMilk 2 L');

  // Every preloaded record has an untracked quantity, so none of the three purchases has
  // an honest sum to fold into. Each is kept as its own record — losing them was the
  // dogfooding complaint D-069 exists to fix.
  expect(r.pantry).toHaveLength(6);
  expect(r.pantry.filter((p) => p.quantity !== null).map((p) => p.quantity).sort())
    .toEqual([1, 12, 2]);
  expect(r.modalOpen).toBe(false);           // no pointless retry loop
  expect(r.toast).toBe('3 items added.');
});

// A duplicate line with NO quantity still has nothing to add, so it stays a true skip:
// reported, resolved, and dropped from the retry text without touching the record.
test('7b. a quantity-less duplicate line is still skipped, and leaves stock alone', async ({ page }) => {
  await loadLocalApp(page);
  await openBulk(page, { preload: ['Eggs'] });
  await page.evaluate(() => { AppState.pantry[0].quantity = 6; AppState.pantry[0].unit = 'pcs'; });
  const r = await submit(page, 'Eggs');

  expect(r.pantry).toHaveLength(1);
  expect(r.pantry[0].quantity).toBe(6);      // the known number is not replaced by "unknown"
  expect(r.modalOpen).toBe(false);
  expect(r.toast).toBe('1 already in pantry.');
});

// ── 8-9. Line fidelity and order ───────────────────────────────────────────

test('8. unresolved line text is preserved exactly, not rewritten', async ({ page }) => {
  await loadLocalApp(page);
  await openBulk(page);
  const messy = 'milk   2 L 8/8/2026';       // lower case, odd spacing, original date form
  const r = await submit(page, [OK1, messy].join('\n'));
  expect(r.textarea).toBe(messy);
});

test('9. unresolved line order is preserved', async ({ page }) => {
  await loadLocalApp(page);
  await openBulk(page);
  const a = 'Alpha 1 kg 1/2/2026';
  const b = 'Beta 2 kg 3/4/2026';
  const c = 'Gamma 3 kg 5/6/2026';
  const r = await submit(page, [a, OK1, b, OK2, c].join('\n'));
  expect(r.textarea).toBe([a, b, c].join('\n'));
});

// ── 10-11. Shared controls survive a partial submit ────────────────────────

test('10-11. shared Storage and Expiry are still set after a partial submit', async ({ page }) => {
  await loadLocalApp(page);
  await openBulk(page, { shared: '2026-12-25', storage: 'freezer' });
  const r = await submit(page, [OK1, AMBIG].join('\n'));

  expect(r.modalOpen).toBe(true);
  expect(r.sharedExpiry).toBe('2026-12-25');
  expect(r.sharedStorage).toBe('freezer');
  // And they still apply to the corrected line on the retry pass.
  const r2 = await submit(page, 'Milk 2 L');
  const milk = r2.pantry.find((p) => p.name === 'Milk');
  expect(milk.expiryDate).toBe('2026-12-25');
  expect(await page.evaluate(() =>
    AppState.pantry.find((p) => p.name === 'Milk').storage)).toBe('freezer');
});

// ── 12-15. D-067 parser behaviour is untouched ─────────────────────────────

test('12. exp:YYYY-MM-DD still works and still wins', async ({ page }) => {
  await loadLocalApp(page);
  await openBulk(page, { shared: '2026-12-25' });
  const r = await submit(page, 'Eggs, 12, pcs exp:2026-08-08');
  expect(r.pantry[0]).toMatchObject({ name: 'Eggs', quantity: 12, unit: 'pcs',
                                      expiryDate: '2026-08-08' });
});

test('13. natural trailing-date parsing still works', async ({ page }) => {
  await loadLocalApp(page);
  await openBulk(page);
  const r = await submit(page, 'eggs 12 pcs aug 8 2026\nCarrot 1 kg 8 Sep 2026');
  expect(r.pantry.find((p) => p.name === 'eggs')).toMatchObject({
    quantity: 12, unit: 'pcs', expiryDate: '2026-08-08' });
  expect(r.pantry.find((p) => p.name === 'Carrot').expiryDate).toBe('2026-09-08');
});

test('14. slash dates remain refused', async ({ page }) => {
  await loadLocalApp(page);
  await openBulk(page);
  const r = await submit(page, AMBIG);
  expect(r.pantry).toHaveLength(0);
  expect(r.notes.join(' ')).toContain('ambiguous');
});

test('15. numeric product names remain intact', async ({ page }) => {
  await loadLocalApp(page);
  await openBulk(page);
  const names = ['7 Up', 'Vitamin B12', '12 Grain Bread', 'Heinz 57 Sauce'];
  const r = await submit(page, names.join('\n'));
  expect(r.pantry.map((p) => p.name)).toEqual(names);
  expect(r.modalOpen).toBe(false);
});

// ── 16-17. Persistence and no duplicates from retry ────────────────────────

test('16-17. save/reload shows each record exactly once after a retry cycle', async ({ page }) => {
  await loadLocalApp(page);
  await openBulk(page);
  await submit(page, [OK1, AMBIG, OK2].join('\n'));
  await submit(page, 'Milk 2 L Aug 8 2026');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);

  const names = await page.evaluate(() => AppState.pantry.map((p) => p.name).sort());
  expect(names).toEqual(['Chicken', 'Eggs', 'Milk']);
  expect(new Set(names).size).toBe(3);       // no duplicate records survived the retry
});

// ── Result model is explicit, not text-matched ─────────────────────────────

test('classification is by status, not by warning wording', async ({ page }) => {
  await loadLocalApp(page);
  await openBulk(page, { preload: ['Eggs'] });
  // A duplicate and an actionable line both carry the word "skipped"-ish phrasing in
  // prose; only the structured status decides what stays.
  const r = await submit(page, ['Eggs, 12, pcs', 'Butter, abc, g', OK2].join('\n'));
  expect(r.textarea).toBe('Butter, abc, g');   // only the fixable one
  expect(r.summary).toBe('2 items added · 1 line needs attention.');
});

test('blank input still closes the modal without touching inventory', async ({ page }) => {
  await loadLocalApp(page);
  await openBulk(page);
  const r = await submit(page, '   ');
  expect(r.pantry).toHaveLength(0);
  expect(r.modalOpen).toBe(false);
  expect(r.toast).toBe('');
});

// ── Mobile ─────────────────────────────────────────────────────────────────

test.describe('mobile partial success', () => {
  test.use({ viewport: { width: 390, height: 1400 } });

  test('390px: partial feedback is readable and nothing overflows', async ({ page }) => {
    await loadLocalApp(page);
    await openBulk(page);
    const r = await submit(page, [OK1, AMBIG, OK2].join('\n'));

    expect(r.modalOpen).toBe(true);
    expect(r.textarea).toBe(AMBIG);

    const o = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth
    }));
    expect(o.scrollW).toBeLessThanOrEqual(o.clientW);

    // Summary, textarea and Add Items all visible and inside the viewport.
    for (const sel of ['.bulk-add-summary', '#bulk-add-textarea',
                       '#bulk-add-modal button:has-text("Add Items")']) {
      await expect(page.locator(sel)).toBeVisible();
      const b = await page.locator(sel).boundingBox();
      expect(b.x, sel).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width, sel).toBeLessThanOrEqual(391);
    }
    // The warning text must not push the modal off-screen vertically either.
    const modal = await page.locator('#bulk-add-modal .modal-content').boundingBox();
    expect(modal.y).toBeGreaterThanOrEqual(-1);
    // The textarea keeps a usable height.
    const ta = await page.locator('#bulk-add-textarea').boundingBox();
    expect(ta.height).toBeGreaterThan(60);
  });
});
