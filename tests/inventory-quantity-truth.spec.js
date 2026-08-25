const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');
const { waitForAppReady } = require('./app-ready');

/**
 * Inventory Quantity Truth — the dogfooding wave. See DECISIONS D-069.
 *
 * Two production complaints:
 *   A. "I change the quantity and it doesn't take." Characterisation cleared the pantry
 *      card's own editor (updatePantryQty) — it persists correctly through every gesture,
 *      locally and on the deployed site. The failing writer was the Price Book's
 *      "Add to pantry" button, which DELETED every same-name record and pushed a fresh
 *      one: setting a quantity also wiped the printed expiry, the date mode, the staple
 *      flag, the stock level and the record's id.
 *   B. "Eggs already in pantry — skipped" after buying 12 more eggs, so the purchase was
 *      not in inventory at all.
 *
 * The rule these tests exist to hold: a purchase tops up existing stock only when the sum
 * is honest. Otherwise it becomes its own record. It is never thrown away.
 */

test.use({ viewport: { width: 1280, height: 1700 } });

async function loadLocalApp(page) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__qtyTruthBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__qtyTruthBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
  });
  await page.goto(pathToFileURL(path.resolve('index.html')).href, { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
}

// Local calendar date N days from today — daysLeftFrom()/todayISO() work in local time.
const DAY_FN = `(d) => {
  const t = new Date();
  t.setDate(t.getDate() + d);
  return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
}`;

async function bulkSubmit(page, text, { shared = '', storage = '' } = {}) {
  await page.evaluate(({ shared, storage }) => {
    showTab('fridge');
    openBulkAddModal();
    document.getElementById('bulk-add-expiry').value = shared;
    document.getElementById('bulk-add-default-storage').value = storage;
  }, { shared, storage });
  await page.fill('#bulk-add-textarea', text);
  await page.click('#bulk-add-modal button:has-text("Add Items")');
  await page.waitForTimeout(200);
  return page.evaluate(() => ({
    pantry: AppState.pantry.map((p) => ({
      name: p.name, quantity: p.quantity, unit: p.unit, storage: p.storage,
      dateMode: p.dateMode === undefined ? null : p.dateMode,
      expiryDate: p.expiryDate === undefined ? null : p.expiryDate
    })),
    textarea: document.getElementById('bulk-add-textarea').value,
    modalOpen: !document.getElementById('bulk-add-modal').classList.contains('hidden'),
    summary: (document.querySelector('.bulk-add-summary') || {}).textContent || '',
    notes: Array.from(document.querySelectorAll('.bulk-add-warn li')).map((li) => li.textContent),
    toast: (document.querySelector('.success-message') || {}).textContent || ''
  }));
}

// ── Scenario A — manual quantity editing ───────────────────────────────────

// 1-7. The whole edit contract in one production-shaped record: change only the quantity,
// through the real expanded card, and nothing else about the item may move.
test('1-7. editing Fish 1 kg → 2 kg changes the quantity and nothing else', async ({ page }) => {
  await loadLocalApp(page);
  const before = await page.evaluate((dayFn) => {
    const day = eval(dayFn);
    AppState.pantry = [{
      id: 'fish_1', name: 'Fish', category: 'Protein',
      purchaseDate: day(-6), shelfLifeDays: 3, storage: 'fridge',
      quantity: 1, unit: 'kg', expiryDate: day(-3), dateMode: 'expiry',
      staple: false, stockLevel: 'ok', suggestDismissed: true
    }];
    saveData();
    showTab('fridge');
    renderPantry();
    return JSON.parse(JSON.stringify(AppState.pantry[0]));
  }, DAY_FN);

  // 2. Collapsed card shows the old value first.
  await expect(page.locator('.pi-qty').first()).toHaveText('1 kg');

  await page.locator('.pi-row').first().click();
  const input = page.locator('input.pt-stock').first();
  await expect(input).toHaveValue('1');
  await input.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('2');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(200);

  // 2. Collapsed card re-renders immediately with the new value.
  await expect(page.locator('.pi-qty').first()).toHaveText('2 kg');

  const after = await page.evaluate(() => JSON.parse(JSON.stringify(AppState.pantry[0])));
  expect(after.quantity).toBe(2);            // 3. AppState holds the number, not a string
  expect(after.id).toBe(before.id);          // 1. same record, same id
  expect(after.name).toBe(before.name);
  expect(after.expiryDate).toBe(before.expiryDate);   // 5. expiry untouched
  expect(after.dateMode).toBe(before.dateMode);
  expect(after.purchaseDate).toBe(before.purchaseDate);
  expect(after.shelfLifeDays).toBe(before.shelfLifeDays);
  expect(after.storage).toBe(before.storage);         // 6. storage untouched
  expect(after.staple).toBe(before.staple);
  expect(after.stockLevel).toBe(before.stockLevel);   // 7. unrelated fields untouched
  expect(after.suggestDismissed).toBe(before.suggestDismissed);
  expect(after.unit).toBe('kg');

  // 4. Survives a real reload.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
  await page.evaluate(() => { showTab('fridge'); renderPantry(); });
  const reloaded = await page.evaluate(() => JSON.parse(JSON.stringify(AppState.pantry[0])));
  expect(reloaded.quantity).toBe(2);
  expect(reloaded.expiryDate).toBe(before.expiryDate);
  expect(reloaded.storage).toBe(before.storage);
  await expect(page.locator('.pi-qty').first()).toHaveText('2 kg');
});

// Blank still means unknown, and an explicit 0 is still stored as 0 — the pre-existing
// contract, restated so a future "helpful" default cannot creep in.
test('blank quantity means unknown; an explicit 0 stays 0', async ({ page }) => {
  await loadLocalApp(page);
  const r = await page.evaluate(() => {
    AppState.pantry = [{ id: 'q_1', name: 'Fish', category: 'Protein', storage: 'fridge',
      purchaseDate: todayISO(), shelfLifeDays: 5, quantity: 1, unit: 'kg', staple: false }];
    updatePantryQty('q_1', '');
    const blank = AppState.pantry[0].quantity;
    updatePantryQty('q_1', '0');
    return { blank: blank, zero: AppState.pantry[0].quantity };
  });
  expect(r.blank).toBeNull();
  expect(r.zero).toBe(0);
});

// 8. Unit editing is deliberately NOT offered on the pantry card — the expanded panel has
// Qty, Where, Date and Staple only. Asserted so "unit persists" cannot be claimed for a
// control that does not exist.
test('8. the card offers no unit editor, so there is no unit edit to lose', async ({ page }) => {
  await loadLocalApp(page);
  await page.evaluate(() => {
    AppState.pantry = [{ id: 'u_1', name: 'Fish', category: 'Protein', storage: 'fridge',
      purchaseDate: todayISO(), shelfLifeDays: 5, quantity: 1, unit: 'kg', staple: false }];
    showTab('fridge'); renderPantry();
  });
  await page.locator('.pi-row').first().click();
  const html = await page.locator('.pi-expand').first().innerHTML();
  expect(html).toContain('pt-stock');
  expect(html).toContain('pt-where');
  expect(html).toContain('pt-date');
  expect(await page.locator('.pi-expand input[type="text"]').count()).toBe(0);
});

// The Price Book path was the writer that actually lost data — a quantity edit there used
// to take the printed expiry with it.
test('setting a quantity from the Price Book keeps the expiry, the id and the staple state',
  async ({ page }) => {
    await loadLocalApp(page);
    const r = await page.evaluate((dayFn) => {
      const day = eval(dayFn);
      AppState.pantry = [{
        id: 'pb_1', name: 'Eggs', category: 'Protein', purchaseDate: day(-2),
        shelfLifeDays: 20, storage: 'fridge', quantity: 6, unit: 'pcs',
        expiryDate: day(3), dateMode: 'expiry', staple: false, stockLevel: 'ok'
      }];
      const tmp = document.createElement('input');
      tmp.id = 'ingqty-77'; tmp.value = '12';
      document.body.appendChild(tmp);
      confirmAddIngredientToPantry('Eggs', 77, 'pcs');
      tmp.remove();
      return { count: AppState.pantry.length, rec: JSON.parse(JSON.stringify(AppState.pantry[0])),
               expected: day(3) };
    }, DAY_FN);

    expect(r.count).toBe(1);                 // no delete-and-recreate
    expect(r.rec.id).toBe('pb_1');           // the record survived
    expect(r.rec.quantity).toBe(12);
    expect(r.rec.expiryDate).toBe(r.expected);
    expect(r.rec.dateMode).toBe('expiry');
    expect(r.rec.shelfLifeDays).toBe(20);    // not recomputed from a blank category
    expect(r.rec.stockLevel).toBe('ok');
    expect(r.rec.staple).toBe(false);
    expect(r.rec.updatedAt).toBeTruthy();    // stamped, so the load-merge LWW sees the edit
  });

// ── Scenario B — safe stock merging ────────────────────────────────────────

// 9, 10, 11, 16. The headline case.
test('9-11,16. Eggs 6 pcs + Bulk Add "Eggs 12 pcs" = 18 pcs, reported as updated stock',
  async ({ page }) => {
    await loadLocalApp(page);
    await page.evaluate(() => {
      AppState.pantry = [{ id: 'e_1', name: 'Eggs', category: 'Protein',
        purchaseDate: todayISO(), shelfLifeDays: 20, storage: 'fridge',
        quantity: 6, unit: 'pcs', staple: false }];
      saveData();
    });
    const r = await bulkSubmit(page, 'Eggs 12 pcs');

    expect(r.pantry).toHaveLength(1);                 // 9. one record, topped up
    expect(r.pantry[0].quantity).toBe(18);            // 16. same-unit numbers add
    expect(r.pantry[0].unit).toBe('pcs');
    expect(r.toast).toBe('1 stock item updated.');    // 10. NOT "already in pantry"
    expect(r.toast).not.toContain('skipped');
    expect(r.toast).not.toContain('already in pantry');
    expect(r.textarea).toBe('');                      // 11. merged line does not come back
    expect(r.modalOpen).toBe(false);

    // 23. and it survives the save/reload round trip.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForAppReady(page);
    expect(await page.evaluate(() => AppState.pantry[0].quantity)).toBe(18);
  });

// 12. The retry textarea is the only thing that can re-submit a line, and a merged line
// leaves it. Pressing Add again with an empty box must not merge a second time.
test('12. re-pressing Add after a merge cannot double-count the purchase', async ({ page }) => {
  await loadLocalApp(page);
  await page.evaluate(() => {
    AppState.pantry = [{ id: 'e_2', name: 'Eggs', category: 'Protein',
      purchaseDate: todayISO(), shelfLifeDays: 20, storage: 'fridge',
      quantity: 6, unit: 'pcs', staple: false }];
  });
  await bulkSubmit(page, 'Eggs 12 pcs');
  expect(await page.evaluate(() => AppState.pantry[0].quantity)).toBe(18);

  // The modal closed with an empty textarea; re-opening and submitting adds nothing.
  await page.evaluate(() => { openBulkAddModal(); confirmBulkAdd(); });
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => ({
    qty: AppState.pantry[0].quantity, count: AppState.pantry.length
  }));
  expect(after.qty).toBe(18);
  expect(after.count).toBe(1);
});

// 13. Expired stock is never revived by a fresh purchase.
test('13. buying more of an expired item makes a new record, not a revived one', async ({ page }) => {
  await loadLocalApp(page);
  await page.evaluate((dayFn) => {
    const day = eval(dayFn);
    AppState.pantry = [{ id: 'e_3', name: 'Eggs', category: 'Protein',
      purchaseDate: day(-30), shelfLifeDays: 5, storage: 'fridge',
      quantity: 6, unit: 'pcs', staple: false }];
  }, DAY_FN);
  const r = await bulkSubmit(page, 'Eggs 12 pcs');

  expect(r.pantry).toHaveLength(2);
  const old = r.pantry.find((p) => p.quantity === 6);
  const fresh = r.pantry.find((p) => p.quantity === 12);
  expect(old).toBeTruthy();                  // the old stock still reads as old stock
  expect(fresh).toBeTruthy();
  expect(r.toast).toBe('1 item added.');
  expect(await page.evaluate(() =>
    pantryDaysLeft(AppState.pantry.find((p) => p.quantity === 6)))).toBeLessThan(0);
});

// 14. Scenario C — two different printed expiry dates never collapse into one date.
test('14. Eggs exp Aug 28 + "Eggs 12 pcs Sep 10 2026" stays two truthful records',
  async ({ page }) => {
    await loadLocalApp(page);
    await page.evaluate(() => {
      AppState.pantry = [{ id: 'e_4', name: 'Eggs', category: 'Protein',
        purchaseDate: todayISO(), shelfLifeDays: 20, storage: 'fridge',
        quantity: 6, unit: 'pcs', expiryDate: '2026-08-28', dateMode: 'expiry', staple: false }];
    });
    const r = await bulkSubmit(page, 'Eggs 12 pcs Sep 10 2026');

    expect(r.pantry).toHaveLength(2);
    const aug = r.pantry.find((p) => p.expiryDate === '2026-08-28');
    const sep = r.pantry.find((p) => p.expiryDate === '2026-09-10');
    expect(aug.quantity).toBe(6);            // neither date moved
    expect(sep.quantity).toBe(12);
    expect(r.pantry.some((p) => p.quantity === 18)).toBe(false);   // no 18-piece lie
    expect(r.toast).toBe('1 item added.');
  });

// The reverse of 14: a printed expiry on the NEW line must not be folded into a
// bought-date record either, because the record has nowhere honest to put it.
test('a printed expiry on the new line is not folded into a bought-date record',
  async ({ page }) => {
    await loadLocalApp(page);
    await page.evaluate(() => {
      AppState.pantry = [{ id: 'e_5', name: 'Eggs', category: 'Protein',
        purchaseDate: todayISO(), shelfLifeDays: 20, storage: 'fridge',
        quantity: 6, unit: 'pcs', staple: false }];
    });
    const r = await bulkSubmit(page, 'Eggs 12 pcs exp:2026-09-10');

    expect(r.pantry).toHaveLength(2);
    expect(r.pantry.find((p) => p.quantity === 6).expiryDate).toBeNull();
    expect(r.pantry.find((p) => p.quantity === 12).expiryDate).toBe('2026-09-10');
  });

// 4. Derived shelf-life records: a merge must never make old food look fresher.
test('4. merging into a bought-date record does not refresh purchaseDate', async ({ page }) => {
  await loadLocalApp(page);
  const r = await page.evaluate((dayFn) => {
    const day = eval(dayFn);
    AppState.pantry = [{ id: 'e_6', name: 'Eggs', category: 'Protein',
      purchaseDate: day(-4), shelfLifeDays: 20, storage: 'fridge',
      quantity: 6, unit: 'pcs', staple: false }];
    const daysLeftBefore = pantryDaysLeft(AppState.pantry[0]);
    document.getElementById('bulk-add-textarea') || openBulkAddModal();
    openBulkAddModal();
    document.getElementById('bulk-add-textarea').value = 'Eggs 12 pcs';
    document.getElementById('bulk-add-expiry').value = '';
    document.getElementById('bulk-add-default-storage').value = '';
    confirmBulkAdd();
    return { purchaseDate: AppState.pantry[0].purchaseDate, expected: day(-4),
             quantity: AppState.pantry[0].quantity,
             daysLeftBefore: daysLeftBefore, daysLeftAfter: pantryDaysLeft(AppState.pantry[0]) };
  }, DAY_FN);

  expect(r.quantity).toBe(18);
  expect(r.purchaseDate).toBe(r.expected);   // NOT today
  expect(r.daysLeftAfter).toBe(r.daysLeftBefore);  // the oldest portion still governs
});

// 15. Unknown quantities never become an invented total.
test('15. unknown + known never fabricates a number', async ({ page }) => {
  await loadLocalApp(page);
  await page.evaluate(() => {
    AppState.pantry = [{ id: 'e_7', name: 'Eggs', category: 'Protein',
      purchaseDate: todayISO(), shelfLifeDays: 20, storage: 'fridge',
      quantity: null, unit: '', staple: false }];
  });
  const r = await bulkSubmit(page, 'Eggs 12 pcs');

  // The untracked record keeps saying "untracked"; the purchase keeps saying 12.
  expect(r.pantry).toHaveLength(2);
  expect(r.pantry.map((p) => p.quantity).sort()).toEqual([12, null]);
  expect(r.pantry.some((p) => p.quantity === 13)).toBe(false);
});

// The mirror case: a duplicate line with no quantity must not turn a real 6 into null.
test('known + unknown never destroys the known number', async ({ page }) => {
  await loadLocalApp(page);
  await page.evaluate(() => {
    AppState.pantry = [{ id: 'e_8', name: 'Eggs', category: 'Protein',
      purchaseDate: todayISO(), shelfLifeDays: 20, storage: 'fridge',
      quantity: 6, unit: 'pcs', staple: false }];
  });
  const r = await bulkSubmit(page, 'Eggs');

  expect(r.pantry).toHaveLength(1);
  expect(r.pantry[0].quantity).toBe(6);
  expect(r.toast).toBe('1 already in pantry.');
});

// 17. Units are added, never converted — this app has no canonical pantry-quantity
// conversion helper, so different units stay separate records.
test('17. 500 g + 1 kg stays two records instead of becoming 501', async ({ page }) => {
  await loadLocalApp(page);
  await page.evaluate(() => {
    AppState.pantry = [{ id: 'c_1', name: 'Chicken', category: 'Protein',
      purchaseDate: todayISO(), shelfLifeDays: 4, storage: 'fridge',
      quantity: 500, unit: 'g', staple: false }];
  });
  const r = await bulkSubmit(page, 'Chicken 1 kg');

  expect(r.pantry).toHaveLength(2);
  expect(r.pantry.map((p) => p.quantity + (p.unit || '')).sort()).toEqual(['1kg', '500g']);
  expect(r.pantry.some((p) => p.quantity === 501)).toBe(false);
});

// Grocery check-off shares the same gate, so the same lie cannot get in through the
// shopping list either.
test('grocery check-off also refuses to add across incompatible units', async ({ page }) => {
  await loadLocalApp(page);
  const r = await page.evaluate(() => {
    AppState.pantry = [{ id: 'c_2', name: 'Chicken', category: 'Protein',
      purchaseDate: todayISO(), shelfLifeDays: 4, storage: 'fridge',
      quantity: 500, unit: 'g', staple: false }];
    AppState.groceryList = [{ id: 950001, name: 'Chicken', category: 'Protein',
      quantity: 1, unit: 'kg', sources: [], checked: false }];
    toggleGroceryItem(950001);
    return AppState.pantry.map((p) => String(p.quantity) + String(p.unit || ''));
  });
  expect(r.sort()).toEqual(['1kg', '500g']);
});

// A blank unit on either side is still compatible — this is what lets an untracked
// staple-ish record adopt the unit of the first quantified purchase (D-057).
test('a blank unit on either side still merges and adopts the unit', async ({ page }) => {
  await loadLocalApp(page);
  const r = await page.evaluate(() => {
    AppState.pantry = [{ id: 'g_1', name: 'Garlic', category: 'Vegetable',
      purchaseDate: todayISO(), shelfLifeDays: 30, storage: 'counter',
      quantity: 2, unit: '', staple: false }];
    AppState.groceryList = [{ id: 950002, name: 'Garlic', category: 'Vegetable',
      quantity: 3, unit: 'pcs', sources: [], checked: false }];
    toggleGroceryItem(950002);
    return { count: AppState.pantry.length, qty: AppState.pantry[0].quantity,
             unit: AppState.pantry[0].unit };
  });
  expect(r.count).toBe(1);
  expect(r.qty).toBe(5);
  expect(r.unit).toBe('pcs');
});

// A bulk-add default storage of "freezer" must not silently relocate fridge stock.
test('an explicit different storage keeps the purchase in its own record', async ({ page }) => {
  await loadLocalApp(page);
  await page.evaluate(() => {
    AppState.pantry = [{ id: 'e_9', name: 'Eggs', category: 'Protein',
      purchaseDate: todayISO(), shelfLifeDays: 20, storage: 'fridge',
      quantity: 6, unit: 'pcs', staple: false }];
  });
  const r = await bulkSubmit(page, 'Eggs 12 pcs', { storage: 'freezer' });

  expect(r.pantry).toHaveLength(2);
  expect(r.pantry.find((p) => p.quantity === 6).storage).toBe('fridge');
  expect(r.pantry.find((p) => p.quantity === 12).storage).toBe('freezer');
});

// The merge target is chosen by mergeability, not by array order: a printed-expiry copy
// sitting in front must not push every future purchase into yet another record.
test('a purchase tops up the mergeable copy even when an unmergeable one sorts first',
  async ({ page }) => {
    await loadLocalApp(page);
    await page.evaluate(() => {
      AppState.pantry = [
        { id: 'e_a', name: 'Eggs', category: 'Protein', purchaseDate: todayISO(),
          shelfLifeDays: 20, storage: 'fridge', quantity: 6, unit: 'pcs',
          expiryDate: '2026-08-28', dateMode: 'expiry', staple: false },
        { id: 'e_b', name: 'Eggs', category: 'Protein', purchaseDate: todayISO(),
          shelfLifeDays: 20, storage: 'fridge', quantity: 12, unit: 'pcs', staple: false }
      ];
    });
    const r = await bulkSubmit(page, 'Eggs 6 pcs');

    expect(r.pantry).toHaveLength(2);        // no third record
    expect(r.pantry.find((p) => p.expiryDate === '2026-08-28').quantity).toBe(6);
    expect(r.pantry.find((p) => p.dateMode === null).quantity).toBe(18);
  });

// Mixed batch: the summary distinguishes updated stock from added items and skipped rows.
test('the summary names each outcome separately', async ({ page }) => {
  await loadLocalApp(page);
  await page.evaluate(() => {
    AppState.pantry = [
      { id: 'm_1', name: 'Eggs', category: 'Protein', purchaseDate: todayISO(),
        shelfLifeDays: 20, storage: 'fridge', quantity: 6, unit: 'pcs', staple: false },
      { id: 'm_2', name: 'Butter', category: 'Dairy', purchaseDate: todayISO(),
        shelfLifeDays: 30, storage: 'fridge', quantity: 1, unit: 'pcs', staple: false }
    ];
  });
  const r = await bulkSubmit(page, 'Eggs 12 pcs\nButter\nMilk 2 L\nSomething 8/8/2026');

  expect(r.summary).toBe('1 item added · 1 stock item updated · 1 already in pantry · 1 line needs attention.');
  expect(r.textarea).toBe('Something 8/8/2026');   // only the fixable line stays
  expect(r.notes.join(' ')).toContain('6 + 12 = 18');
});

// ── No new architecture ────────────────────────────────────────────────────

// D-067's two-digit-year extension only turns TEXT into a canonical date; it must not
// create a second merge path. Each case below runs the identical scenario at both year
// widths and asserts the outcomes are identical.
test('a two-digit trailing year enters the same merge path as its four-digit twin',
  async ({ page }) => {
    await loadLocalApp(page);

    // Safe top-up: same printed expiry on both sides, known quantities, same unit.
    const seed = () => page.evaluate(() => {
      AppState.pantry = [{ id: 'e_2d', name: 'Eggs', category: 'Protein',
        purchaseDate: todayISO(), shelfLifeDays: 20, storage: 'fridge',
        quantity: 6, unit: 'pcs', expiryDate: '2026-08-08', dateMode: 'expiry',
        staple: false }];
      saveData();
    });

    await seed();
    const short = await bulkSubmit(page, 'Eggs 12 pcs Aug 8 26');
    await seed();
    const long = await bulkSubmit(page, 'Eggs 12 pcs Aug 8 2026');

    // The load-bearing assertion: identical records and identical reporting. Whatever
    // D-069 decides, both spellings must decide it the same way.
    expect(short.pantry).toEqual(long.pantry);
    expect(short.toast).toBe(long.toast);

    // And what D-069 decides here is separation, not a top-up: a printed expiry on the
    // purchase line always makes its own record (canMergePurchaseInto refuses any
    // purchase carrying an expiryDate), so the two dates can never be averaged away.
    expect(short.pantry).toHaveLength(2);
    expect(short.pantry.map((p) => p.quantity).sort()).toEqual([12, 6]);
    expect(short.pantry.some((p) => p.quantity === 18)).toBe(false);
    expect(short.toast).toBe('1 item added.');
    // The pre-existing record kept its identity and its number.
    const kept = await page.evaluate(() => AppState.pantry.find((p) => p.id === 'e_2d'));
    expect(kept).toBeTruthy();
    expect(kept.quantity).toBe(6);

    // The merge path itself is untouched by the parser change: against a bought-date
    // record, a two-digit-dated purchase separates and an undated one tops up in place,
    // exactly as the four-digit spelling always has.
    const seedBought = () => page.evaluate(() => {
      AppState.pantry = [{ id: 'e_2d2', name: 'Eggs', category: 'Protein',
        purchaseDate: todayISO(), shelfLifeDays: 20, storage: 'fridge',
        quantity: 6, unit: 'pcs', staple: false }];
    });
    await seedBought();
    const noDate = await bulkSubmit(page, 'Eggs 12 pcs');
    expect(noDate.pantry).toHaveLength(1);
    expect(noDate.pantry[0].quantity).toBe(18);
    expect(noDate.toast).toBe('1 stock item updated.');
    expect(await page.evaluate(() => AppState.pantry[0].id)).toBe('e_2d2');
  });

test('two-digit explicit-expiry separation matches the four-digit behaviour',
  async ({ page }) => {
    await loadLocalApp(page);
    const seed = () => page.evaluate(() => {
      AppState.pantry = [{ id: 'e_2e', name: 'Eggs', category: 'Protein',
        purchaseDate: todayISO(), shelfLifeDays: 20, storage: 'fridge',
        quantity: 6, unit: 'pcs', expiryDate: '2026-08-28', dateMode: 'expiry',
        staple: false }];
    });

    await seed();
    const short = await bulkSubmit(page, 'Eggs 12 pcs Sep 10 26');
    await seed();
    const long = await bulkSubmit(page, 'Eggs 12 pcs Sep 10 2026');

    expect(short.pantry).toEqual(long.pantry);
    expect(short.pantry).toHaveLength(2);               // two dates never collapse into one
    expect(short.pantry.find((p) => p.expiryDate === '2026-08-28').quantity).toBe(6);
    expect(short.pantry.find((p) => p.expiryDate === '2026-09-10').quantity).toBe(12);
    expect(short.pantry.some((p) => p.quantity === 18)).toBe(false);
  });

test('two-digit unit-incompatible and unknown-quantity cases match the four-digit ones',
  async ({ page }) => {
    await loadLocalApp(page);

    // Incompatible units: two honest records, never 501.
    const seedG = () => page.evaluate(() => {
      AppState.pantry = [{ id: 'r_2f', name: 'Rice', category: 'Grains',
        purchaseDate: todayISO(), shelfLifeDays: 300, storage: 'pantry',
        quantity: 500, unit: 'g', staple: false }];
    });
    await seedG();
    const shortUnit = await bulkSubmit(page, 'Rice 1 kg Aug 8 26');
    await seedG();
    const longUnit = await bulkSubmit(page, 'Rice 1 kg Aug 8 2026');
    expect(shortUnit.pantry).toEqual(longUnit.pantry);
    expect(shortUnit.pantry).toHaveLength(2);
    expect(shortUnit.pantry.some((p) => p.quantity === 501)).toBe(false);

    // Unknown existing quantity: the purchase becomes its own record rather than
    // overwriting a real number with "unknown", or being thrown away.
    const seedU = () => page.evaluate(() => {
      AppState.pantry = [{ id: 'e_2g', name: 'Eggs', category: 'Protein',
        purchaseDate: todayISO(), shelfLifeDays: 20, storage: 'fridge',
        quantity: null, unit: '', staple: false }];
    });
    await seedU();
    const shortUnknown = await bulkSubmit(page, 'Eggs 12 pcs Aug 8 26');
    await seedU();
    const longUnknown = await bulkSubmit(page, 'Eggs 12 pcs Aug 8 2026');
    expect(shortUnknown.pantry).toEqual(longUnknown.pantry);
    expect(shortUnknown.pantry).toHaveLength(2);
    expect(shortUnknown.pantry.map((p) => p.quantity).sort()).toEqual([12, null]);
  });

test('no new top-level AppState collection was introduced', async ({ page }) => {
  await loadLocalApp(page);
  const r = await page.evaluate(() => {
    AppState.pantry = [{ id: 'z_1', name: 'Eggs', category: 'Protein', purchaseDate: todayISO(),
      shelfLifeDays: 20, storage: 'fridge', quantity: 6, unit: 'pcs', staple: false }];
    const before = Object.keys(AppState).sort().join(',');
    openBulkAddModal();
    document.getElementById('bulk-add-textarea').value = 'Eggs 12 pcs';
    document.getElementById('bulk-add-expiry').value = '';
    document.getElementById('bulk-add-default-storage').value = '';
    confirmBulkAdd();
    const payloadKeys = Object.keys(buildFirestorePayload()).sort().join(',');
    return { before: before, after: Object.keys(AppState).sort().join(','), payloadKeys: payloadKeys };
  });
  expect(r.after).toBe(r.before);
  expect(r.payloadKeys).not.toContain('lots');
  expect(r.payloadKeys).not.toContain('stockLots');
});

test('the whole quantity-truth loop raises no console or page errors', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(e.message));
  await loadLocalApp(page);
  await page.evaluate(() => {
    AppState.pantry = [{ id: 'x_1', name: 'Eggs', category: 'Protein', purchaseDate: todayISO(),
      shelfLifeDays: 20, storage: 'fridge', quantity: 6, unit: 'pcs', staple: false }];
    saveData(); showTab('fridge'); renderPantry();
  });
  await bulkSubmit(page, 'Eggs 12 pcs\nChicken 1 kg');
  await page.locator('.pi-row').first().click();
  const input = page.locator('input.pt-stock').first();
  await input.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('4');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  // file:// blocks the Firebase CDN in this harness; that network error is the harness.
  expect(errors.filter((e) => !/ERR_FAILED|Failed to load resource|firebasejs/i.test(e))).toEqual([]);
});

// ── Mobile ─────────────────────────────────────────────────────────────────

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('390px: the quantity editor is usable, the new value shows on collapse, nothing overflows',
    async ({ page }) => {
      await loadLocalApp(page);
      await page.evaluate(() => {
        AppState.pantry = [{ id: 'mob_1', name: 'Fish', category: 'Protein',
          purchaseDate: todayISO(), shelfLifeDays: 3, storage: 'fridge',
          quantity: 1, unit: 'kg', expiryDate: '2026-08-10', dateMode: 'expiry', staple: false }];
        saveData(); showTab('fridge'); renderPantry();
      });
      await page.locator('.pi-row').first().click();
      const input = page.locator('input.pt-stock').first();
      const box = await input.boundingBox();
      // The card's number input is ~27px tall at 390px today — small, but this asserts it
      // is a real, tappable control and that D-069 did not shrink it further.
      expect(box.height).toBeGreaterThanOrEqual(24);
      expect(box.width).toBeGreaterThanOrEqual(40);

      await input.click();
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.type('2');
      await page.keyboard.press('Tab');
      await page.waitForTimeout(200);
      await expect(page.locator('.pi-qty').first()).toHaveText('2 kg');

      const o = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth
      }));
      expect(o.scrollW).toBeLessThanOrEqual(o.clientW);
    });

  test('390px: the Bulk Add summary separates updated stock from skipped rows', async ({ page }) => {
    await loadLocalApp(page);
    await page.evaluate(() => {
      AppState.pantry = [
        { id: 'mob_2', name: 'Eggs', category: 'Protein', purchaseDate: todayISO(),
          shelfLifeDays: 20, storage: 'fridge', quantity: 6, unit: 'pcs', staple: false },
        { id: 'mob_3', name: 'Butter', category: 'Dairy', purchaseDate: todayISO(),
          shelfLifeDays: 30, storage: 'fridge', quantity: 1, unit: 'pcs', staple: false }
      ];
    });
    const r = await bulkSubmit(page, 'Eggs 12 pcs\nButter\nSomething 8/8/2026');

    expect(r.modalOpen).toBe(true);
    expect(r.summary).toContain('1 stock item updated');
    expect(r.summary).toContain('1 already in pantry');
    await expect(page.locator('.bulk-add-summary')).toBeVisible();

    const o = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth
    }));
    expect(o.scrollW).toBeLessThanOrEqual(o.clientW);
  });
});
