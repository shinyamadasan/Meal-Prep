const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');
const { waitForAppReady } = require('./app-ready');

/**
 * Bulk Add date truth — the same Kitchen Truth failure D-066 fixed on quick-add.
 *
 * The defect this file exists to prevent coming back:
 *
 *   TASK-050 gave the quick-add path structured quantity/unit/expiry fields, but Bulk
 *   Add kept its older text parser. Typing `eggs 12 pcs aug 8 2026` there stored the
 *   WHOLE STRING as `name` with quantity null, unit '' and no expiry — so the app fell
 *   back to inferCategory() → Protein → a 3-day category shelf life and rendered
 *   "Best by Aug 28 · 3d left" for eggs whose printed date was Aug 8. Invented freshness
 *   again, by a different door.
 *
 *   A second, quieter case: `eggs, 12, pcs, aug 8 2026` parsed name/qty/unit correctly
 *   and then DISCARDED the fourth comma field entirely. The date the user typed vanished
 *   with no warning at all.
 *
 * Bulk Add had NO parser test coverage of any kind before this file — every existing
 * "bulk" spec is about bulk *cleanup* (removeAllExpired), a different feature.
 *
 * The rule under test is deliberately narrow: a trailing month-word (or full ISO) date
 * with a four-digit year is recognised and stripped; anything else is left alone rather
 * than guessed. No second expiry model — everything lands in the D-066 fields and renders
 * through the D-066 renderer.
 */

test.use({ viewport: { width: 1280, height: 1600 } });

async function loadLocalApp(page) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__bulkDateBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__bulkDateBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
  });
  await page.goto(pathToFileURL(path.resolve('index.html')).href, { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
}

// Drives the REAL modal inputs and the real confirmBulkAdd(), not a reimplementation.
async function bulkAdd(page, text, { shared = '', storage = '' } = {}) {
  return page.evaluate(({ text, shared, storage }) => {
    AppState.pantry = [];
    document.getElementById('bulk-add-textarea').value = text;
    document.getElementById('bulk-add-expiry').value = shared;
    document.getElementById('bulk-add-default-storage').value = storage;
    document.getElementById('bulk-add-warnings').innerHTML = '';
    confirmBulkAdd();
    return {
      items: AppState.pantry.map((p) => ({
        name: p.name, quantity: p.quantity, unit: p.unit,
        expiryDate: p.expiryDate === undefined ? null : p.expiryDate,
        dateMode: p.dateMode === undefined ? null : p.dateMode,
        purchaseDate: p.purchaseDate, shelfLifeDays: p.shelfLifeDays,
        daysLeft: pantryDaysLeft(p),
        chip: (function () {
          const e = pantryExpiryInfo(p);
          return e ? (e.printed ? 'Expires ' : 'Best by ') + formatShortDate(e.date) : null;
        })()
      })),
      warnings: (document.getElementById('bulk-add-warnings').textContent || '').trim()
    };
  }, { text, shared, storage });
}

const only = (r) => { expect(r.items).toHaveLength(1); return r.items[0]; };

// ── 1-3. The reported input, in its three spellings ─────────────────────────

test('1. "eggs 12 pcs aug 8 2026" becomes four separate fields', async ({ page }) => {
  await loadLocalApp(page);
  const it = only(await bulkAdd(page, 'eggs 12 pcs aug 8 2026'));
  expect(it.name).toBe('eggs');              // the name is ONLY the name
  expect(it.quantity).toBe(12);
  expect(it.unit).toBe('pcs');
  expect(it.expiryDate).toBe('2026-08-08');
  expect(it.dateMode).toBe('expiry');
  // The exact production symptom must be gone.
  expect(it.name).not.toContain('aug');
  expect(it.chip).toBe('Expires Aug 8');
});

test('2. "eggs, 12, pcs aug 8 2026" works — commas plus a trailing date', async ({ page }) => {
  await loadLocalApp(page);
  const it = only(await bulkAdd(page, 'eggs, 12, pcs aug 8 2026'));
  expect(it).toMatchObject({ name: 'eggs', quantity: 12, unit: 'pcs',
                             expiryDate: '2026-08-08', dateMode: 'expiry' });
});

test('2b. "eggs, 12, pcs, aug 8 2026" no longer silently discards the date', async ({ page }) => {
  await loadLocalApp(page);
  // Before this fix the fourth comma field was dropped on the floor with no warning.
  const it = only(await bulkAdd(page, 'eggs, 12, pcs, aug 8 2026'));
  expect(it).toMatchObject({ name: 'eggs', quantity: 12, unit: 'pcs',
                             expiryDate: '2026-08-08', dateMode: 'expiry' });
});

test('3. the full month form "august 8 2026" works', async ({ page }) => {
  await loadLocalApp(page);
  const it = only(await bulkAdd(page, 'eggs 12 pcs august 8 2026'));
  expect(it).toMatchObject({ name: 'eggs', quantity: 12, unit: 'pcs',
                             expiryDate: '2026-08-08', dateMode: 'expiry' });
});

test('3b. day-first and trailing-ISO forms also work', async ({ page }) => {
  await loadLocalApp(page);
  for (const line of ['eggs 12 pcs 8 aug 2026', 'eggs 12 pcs 2026-08-08',
                      'eggs 12 pcs Aug 8th, 2026', 'eggs 12 pcs Sept. 8 2026']) {
    const it = only(await bulkAdd(page, line));
    expect(it.quantity, line).toBe(12);
    expect(it.unit, line).toBe('pcs');
    expect(it.name, line).toBe('eggs');
    expect(it.dateMode, line).toBe('expiry');
    expect(it.expiryDate, line).toBe(line.includes('Sept') ? '2026-09-08' : '2026-08-08');
  }
});

// ── 4-7. Precedence ────────────────────────────────────────────────────────

test('4. the documented exp:YYYY-MM-DD syntax still works', async ({ page }) => {
  await loadLocalApp(page);
  const it = only(await bulkAdd(page, 'Eggs, 12, pcs exp:2026-08-08'));
  expect(it).toMatchObject({ name: 'Eggs', quantity: 12, unit: 'pcs',
                             expiryDate: '2026-08-08', dateMode: 'expiry' });
});

test('5. exp: outranks both a trailing natural date and the shared field', async ({ page }) => {
  await loadLocalApp(page);
  // exp: wins, AND the trailing natural date is still stripped out of the name.
  const it = only(await bulkAdd(page, 'Eggs 12 pcs aug 8 2026 exp:2026-09-01',
                                { shared: '2026-12-25' }));
  expect(it.expiryDate).toBe('2026-09-01');
  expect(it.name).toBe('Eggs');
  expect(it.quantity).toBe(12);
  expect(it.unit).toBe('pcs');
});

test('6. a trailing natural date outranks the shared expiry field', async ({ page }) => {
  await loadLocalApp(page);
  const it = only(await bulkAdd(page, 'eggs 12 pcs aug 8 2026', { shared: '2026-12-25' }));
  expect(it.expiryDate).toBe('2026-08-08');
  expect(it.dateMode).toBe('expiry');
});

test('7. the shared expiry still applies when a line carries no date', async ({ page }) => {
  await loadLocalApp(page);
  const it = only(await bulkAdd(page, 'Eggs, 12, pcs', { shared: '2026-12-25' }));
  expect(it.expiryDate).toBe('2026-12-25');
  expect(it.dateMode).toBe('expiry');
});

test('8. no date anywhere still means bought-date + shelf-life mode', async ({ page }) => {
  await loadLocalApp(page);
  const it = only(await bulkAdd(page, 'Eggs, 12, pcs'));
  expect(it.expiryDate).toBeNull();
  expect(it.dateMode).toBeNull();          // absent, not 'expiry'
  expect(it.purchaseDate).toBeTruthy();
  expect(it.shelfLifeDays).toBeGreaterThan(0);
  expect(it.chip.startsWith('Best by ')).toBe(true);
});

// ── 9. Invalid and ambiguous dates are never guessed ───────────────────────

test('9. invalid dates are rejected, not rolled over or guessed', async ({ page }) => {
  await loadLocalApp(page);

  // exp:2026-02-31 used to pass `new Date()` and silently store a date that
  // rendered as "Expires Mar 3". February has no 31st.
  //
  // UPDATED by TASK-052: D-067 rejected the date but still added the item, silently
  // substituting the shared expiry for the one the user typed. That made the partial-retry
  // loop unsound — the line had to stay for correction while its record already existed —
  // so an actionable warning now holds the line back entirely. The PARSER verdict here is
  // unchanged: the date is still rejected, never rolled over.
  const rollover = await bulkAdd(page, 'Eggs, 12, pcs exp:2026-02-31');
  expect(rollover.items).toHaveLength(0);
  expect(rollover.warnings).toContain('invalid expiry date');

  const nonsense = await bulkAdd(page, 'Eggs, 12, pcs exp:2026-13-45');
  expect(nonsense.items).toHaveLength(0);
  expect(nonsense.warnings).toContain('invalid expiry date');

  // A natural date naming a day that does not exist is left in the text untouched
  // rather than being nudged to a nearby real day.
  const badNatural = only(await bulkAdd(page, 'Eggs 12 pcs feb 31 2026'));
  expect(badNatural.expiryDate).toBeNull();
  expect(badNatural.name).toBe('Eggs 12 pcs feb 31 2026');

  // A month-shaped word that is not a month is not a date.
  const notAMonth = only(await bulkAdd(page, 'Eggs 12 pcs blah 8 2026'));
  expect(notAMonth.expiryDate).toBeNull();
  expect(notAMonth.name).toBe('Eggs 12 pcs blah 8 2026');
});

test('9b. an all-numeric slash date is refused as ambiguous and reported', async ({ page }) => {
  await loadLocalApp(page);
  // 8/8/2026 is day-first in half the world and month-first in the other half.
  // Guessing wrong moves an expiry by months, so it is not guessed at all.
  //
  // UPDATED by TASK-052: D-067 warned and then added the item anyway, with the unparsed
  // date still sitting inside the name ("Milk 1 L 8/8/2026"). The line is now held back
  // instead, so correcting it produces one clean record rather than a junk one plus a
  // second copy. The parser is untouched — the date is still never guessed.
  const r = await bulkAdd(page, 'Milk 1 L 8/8/2026');
  expect(r.items).toHaveLength(0);
  expect(r.warnings).toContain('ambiguous');
  // The user's original text survives for correction rather than being rewritten.
  expect(await page.inputValue('#bulk-add-textarea')).toBe('Milk 1 L 8/8/2026');
});

// ── 10. Product names containing numbers survive ───────────────────────────

test('10. product names containing numbers are not corrupted', async ({ page }) => {
  await loadLocalApp(page);
  const names = ['7 Up', 'Heinz 57 Sauce', 'Formula 1 Protein', 'Vitamin B12',
                 '12 Grain Bread', 'Coke 2 for 1', 'Omega 3 6 9'];
  const r = await bulkAdd(page, names.join('\n'));
  expect(r.items.map((i) => i.name)).toEqual(names);
  r.items.forEach((i, n) => {
    expect(i.expiryDate, names[n]).toBeNull();
    expect(i.dateMode, names[n]).toBeNull();
    expect(i.quantity, names[n]).toBeNull();   // no number promoted to a quantity
  });
  expect(r.warnings).toBe('');
});

test('10b. a year-like number alone is not treated as a date', async ({ page }) => {
  await loadLocalApp(page);
  // No month word and no ISO shape => not a date, whatever the digits look like.
  for (const line of ['Vitamin 2000', 'Sauce 12 2026', 'Blend 2026']) {
    const it = only(await bulkAdd(page, line));
    expect(it.name, line).toBe(line);
    expect(it.expiryDate, line).toBeNull();
  }
});

// ── 11. Mixed sources across lines ─────────────────────────────────────────

test('11. one submission can mix natural, exp:, shared and no date', async ({ page }) => {
  await loadLocalApp(page);
  const r = await bulkAdd(page, [
    'eggs 12 pcs aug 8 2026',          // natural
    'Milk, 1, L exp:2026-09-01',       // explicit exp:
    'Butter, 250, g',                  // falls back to shared
    '7 Up'                             // no date at all, and a numeric name
  ].join('\n'), { shared: '2026-12-25' });

  expect(r.items).toHaveLength(4);
  const by = Object.fromEntries(r.items.map((i) => [i.name, i]));

  expect(by['eggs']).toMatchObject({ quantity: 12, unit: 'pcs',
                                     expiryDate: '2026-08-08', dateMode: 'expiry' });
  expect(by['Milk']).toMatchObject({ quantity: 1, expiryDate: '2026-09-01', dateMode: 'expiry' });
  expect(by['Butter']).toMatchObject({ quantity: 250, unit: 'g',
                                       expiryDate: '2026-12-25', dateMode: 'expiry' });
  expect(by['7 Up']).toMatchObject({ expiryDate: '2026-12-25', dateMode: 'expiry' });
  expect(r.warnings).toBe('');
});

// ── 12. Persistence ────────────────────────────────────────────────────────

test('12. structured fields survive a save and reload', async ({ page }) => {
  await loadLocalApp(page);
  await bulkAdd(page, 'eggs 12 pcs aug 8 2026');
  await page.evaluate(() => saveData());

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);

  const rec = await page.evaluate(() => AppState.pantry.find((p) => p.name === 'eggs'));
  expect(rec).toBeTruthy();
  expect(rec.quantity).toBe(12);
  expect(rec.unit).toBe('pcs');
  expect(rec.expiryDate).toBe('2026-08-08');
  expect(rec.dateMode).toBe('expiry');
});

// ── 13. It renders through the D-066 model, unchanged ──────────────────────

test('13. the card shows the D-066 absolute date plus the relative badge', async ({ page }) => {
  await loadLocalApp(page);
  // A date two days out, so the relative half is a live "2d left" rather than expired.
  const iso = await page.evaluate(() => {
    const t = new Date(); t.setDate(t.getDate() + 2);
    return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') +
           '-' + String(t.getDate()).padStart(2, '0');
  });
  const monthDay = await page.evaluate((d) => {
    const x = new Date(d + 'T00:00:00');
    return x.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }, iso);

  await bulkAdd(page, `eggs 12 pcs ${monthDay} ${iso.slice(0, 4)}`);
  await page.evaluate(() => { showTab('fridge'); renderPantry(); });

  const row = page.locator('.pi-item', { has: page.locator('.pi-name', { hasText: 'eggs' }) })
                  .locator('.pi-row');
  await expect(row.locator('.pi-name')).toHaveText('eggs');
  await expect(row.locator('.pi-qty')).toHaveText('12 pcs');
  await expect(row.locator('.pi-date')).toContainText('Expires');
  await expect(row.locator('.pi-date')).toHaveClass(/pi-date--printed/);
  await expect(row.locator('.pantry-fresh-badge')).toContainText('2d left');
});

test('13b. the production repro no longer produces a derived 3-day guess', async ({ page }) => {
  await loadLocalApp(page);
  const r = await bulkAdd(page, 'eggs 12 pcs aug 8 2026');
  const it = only(r);
  // Aug 8 2026 is in the past relative to the suite's clock, so the honest result is
  // expired — never the "Best by <today+3> · 3d left" the Protein fallback produced.
  expect(it.chip).toBe('Expires Aug 8');
  expect(it.chip.startsWith('Best by')).toBe(false);
  expect(it.daysLeft).toBeLessThan(0);
  expect(it.shelfLifeDays).not.toBe(3);   // not the Protein category fallback
});

// ── Backward compatibility ─────────────────────────────────────────────────

test('existing free-text records are not migrated or re-parsed', async ({ page }) => {
  await loadLocalApp(page);
  const out = await page.evaluate(() => {
    AppState.pantry = [{
      id: 990001, name: 'eggs 12 pcs aug 8 2026', category: 'Protein', storage: 'fridge',
      purchaseDate: todayISO(), shelfLifeDays: 3, quantity: null, unit: ''
    }];
    saveData();
    renderPantry();
    const p = AppState.pantry[0];
    return { name: p.name, quantity: p.quantity, expiryDate: p.expiryDate, dateMode: p.dateMode };
  });
  expect(out.name).toBe('eggs 12 pcs aug 8 2026');   // untouched
  expect(out.quantity).toBeNull();
  expect(out.expiryDate).toBeUndefined();
  expect(out.dateMode).toBeUndefined();
});

test('the pre-existing no-comma and comma formats are unchanged', async ({ page }) => {
  await loadLocalApp(page);
  expect(only(await bulkAdd(page, 'Coconut cream 200ml')))
    .toMatchObject({ name: 'Coconut cream', quantity: 200, unit: 'ml' });
  expect(only(await bulkAdd(page, 'Soy Sauce, 1, bottle')))
    .toMatchObject({ name: 'Soy Sauce', quantity: 1, unit: 'bottle' });
  expect(only(await bulkAdd(page, 'Garlic'))).toMatchObject({ name: 'Garlic', quantity: null });
});

// ── The date helper in isolation ───────────────────────────────────────────

test('parseTrailingDate accepts only the three documented shapes', async ({ page }) => {
  await loadLocalApp(page);
  const out = await page.evaluate(() => {
    const accept = {
      'Eggs aug 8 2026': '2026-08-08',
      'Eggs August 8 2026': '2026-08-08',
      'Eggs 8 August 2026': '2026-08-08',
      'Eggs, aug 8 2026': '2026-08-08',
      'Eggs Dec 31 2026': '2026-12-31',
      'Eggs 2026-08-08': '2026-08-08',
      'Eggs feb 29 2028': '2028-02-29'          // a real leap day
    };
    const reject = ['7 Up', 'Heinz 57 Sauce', 'Vitamin B12', '12 Grain Bread',
                    'Formula 1 Protein', 'Milk 8/8/2026', 'Eggs feb 30 2026',
                    'Eggs feb 29 2026', 'Eggs aug 8', 'Eggs 8 2026', 'aug 8 2026',
                    'Eggs aug 8 26', 'Eggs blah 8 2026'];
    const bad = [];
    Object.keys(accept).forEach((k) => {
      const r = parseTrailingDate(k);
      if (!r || r.iso !== accept[k]) bad.push({ input: k, got: r, want: accept[k] });
    });
    reject.forEach((k) => {
      const r = parseTrailingDate(k);
      if (r) bad.push({ input: k, got: r, want: null });
    });
    return bad;
  });
  expect(out).toEqual([]);
});
