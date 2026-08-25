const { test, expect } = require('@playwright/test');

/**
 * Production smoke for Inventory Quantity Truth (D-069).
 *
 * Runs against the DEPLOYED GitHub Pages build. Firebase is deliberately NOT stubbed — the
 * page loads it for real and stays signed out, the normal first-visit path. Each test gets a
 * fresh isolated context, so nothing persists between tests and nothing touches a real
 * account's cloud data.
 *
 * What this file proves is shipped, not merely merged:
 *   A. A Price Book quantity edit changes the QUANTITY. It used to delete every same-name
 *      record and rebuild one, taking the id, printed expiry, date mode, staple flag, stock
 *      level and shelf life with it.
 *   B. Buying more of something tops up existing stock and is reported as updated stock,
 *      never as "already in pantry — skipped" with the purchase discarded.
 *   C. Two different printed expiry dates never collapse into one record.
 *   D. An untracked existing quantity never becomes an invented total, and the purchase
 *      stays represented.
 *   E. Units are added, never converted: 500 g + 1 kg is not 501.
 *   F. All of it is usable at 390px with no overflow and no console errors.
 *
 * Everything drives real functions and real modal inputs on the live bundle, so a deploy
 * that silently shipped the old behaviour fails here rather than passing on local code.
 */

const APP_URL = 'https://shinyamadasan.github.io/Meal-Prep/';

test.use({ viewport: { width: 1280, height: 1700 } });

async function loadLiveApp(page) {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__qtyTruthProdBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__qtyTruthProdBootstrapped', '1');
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

async function pressBulkAdd(page, text, { storage = '' } = {}) {
  await page.evaluate(({ storage }) => {
    showTab('fridge');
    openBulkAddModal();
    document.getElementById('bulk-add-expiry').value = '';
    document.getElementById('bulk-add-default-storage').value = storage;
  }, { storage });
  await page.fill('#bulk-add-textarea', text);
  await page.click('#bulk-add-modal button:has-text("Add Items")');
  await page.waitForTimeout(400);
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

// ── 0. The merge machinery is actually deployed ────────────────────────────

test('the deployed bundle contains the D-069 merge helpers', async ({ page }) => {
  await loadLiveApp(page);
  const present = await page.evaluate(() => ({
    canMergePurchaseInto: typeof canMergePurchaseInto === 'function',
    findMergeableStock: typeof findMergeableStock === 'function',
    applyPurchaseToStock: typeof applyPurchaseToStock === 'function',
    unitsMergeable: typeof unitsMergeable === 'function',
    canMergePurchase: typeof canMergePurchase === 'function'
  }));
  expect(present).toEqual({
    canMergePurchaseInto: true, findMergeableStock: true, applyPurchaseToStock: true,
    unitsMergeable: true, canMergePurchase: true
  });
  // The unit gate is live: same unit or a blank merges, different units never do.
  expect(await page.evaluate(() => [
    unitsMergeable('pcs', 'pcs'), unitsMergeable('', 'pcs'), unitsMergeable('g', 'kg')
  ])).toEqual([true, true, false]);
});

// ── A. Price Book edit-in-place ────────────────────────────────────────────

test('A. live: a Price Book quantity edit keeps the id, expiry and every other field',
  async ({ page }) => {
    await loadLiveApp(page);
    const r = await page.evaluate(() => {
      AppState.pantry = [{
        id: 'prod_fish_1', name: 'Fish', category: 'Protein',
        purchaseDate: '2026-08-08', shelfLifeDays: 30, storage: 'freezer',
        quantity: 1, unit: 'kg', expiryDate: '2026-12-10', dateMode: 'expiry',
        staple: false, stockLevel: 'ok'
      }];
      saveData();
      const before = JSON.parse(JSON.stringify(AppState.pantry[0]));
      // The real Price Book flow reads its quantity out of #ingqty-<idx>.
      const tmp = document.createElement('input');
      tmp.id = 'ingqty-4242'; tmp.value = '2';
      document.body.appendChild(tmp);
      confirmAddIngredientToPantry('Fish', 4242, 'kg');
      tmp.remove();
      return { before: before, after: JSON.parse(JSON.stringify(AppState.pantry[0])),
               count: AppState.pantry.length };
    });

    expect(r.count).toBe(1);                        // not deleted and rebuilt
    expect(r.after.id).toBe('prod_fish_1');         // same pantry id
    expect(r.after.quantity).toBe(2);               // new quantity took effect
    expect(r.after.expiryDate).toBe('2026-12-10');  // expiry unchanged
    expect(r.after.dateMode).toBe('expiry');        // date mode unchanged
    expect(r.after.storage).toBe('freezer');        // storage unchanged
    expect(r.after.staple).toBe(false);             // staple unchanged
    expect(r.after.stockLevel).toBe('ok');          // stock level unchanged
    expect(r.after.shelfLifeDays).toBe(30);         // not recomputed from a blank category
    expect(r.after.purchaseDate).toBe('2026-08-08');
    expect(r.after.name).toBe('Fish');

    // Reload preserves it — through the real deployed save path.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      'typeof AppState !== "undefined" && Array.isArray(AppState.recipes)', null, { timeout: 45000 });
    await page.waitForTimeout(2000);
    const reloaded = await page.evaluate(() => {
      const p = AppState.pantry.find((x) => String(x.id) === 'prod_fish_1');
      return p ? { id: p.id, quantity: p.quantity, expiryDate: p.expiryDate,
                   dateMode: p.dateMode, storage: p.storage, stockLevel: p.stockLevel } : null;
    });
    expect(reloaded).toEqual({ id: 'prod_fish_1', quantity: 2, expiryDate: '2026-12-10',
                               dateMode: 'expiry', storage: 'freezer', stockLevel: 'ok' });
  });

// ── B. Safe Bulk Add merge ─────────────────────────────────────────────────

test('B. live: Eggs 6 pcs + "Eggs 12 pcs" = 18 pcs, reported as updated stock',
  async ({ page }) => {
    await loadLiveApp(page);
    await page.evaluate(() => {
      AppState.pantry = [{ id: 'prod_eggs_1', name: 'Eggs', category: 'Protein',
        purchaseDate: todayISO(), shelfLifeDays: 20, storage: 'fridge',
        quantity: 6, unit: 'pcs', staple: false }];
      saveData();
    });
    const r = await pressBulkAdd(page, 'Eggs 12 pcs');

    expect(r.pantry).toHaveLength(1);                     // one record, topped up
    expect(r.pantry[0].quantity).toBe(18);
    expect(r.pantry[0].unit).toBe('pcs');
    expect(r.toast).toBe('1 stock item updated.');        // reported as updated stock
    expect(r.toast).not.toContain('skipped');
    expect(r.toast).not.toContain('already in pantry');
    expect(r.textarea).toBe('');                          // merged line left the retry box
    expect(r.modalOpen).toBe(false);

    // The record kept its identity through the merge.
    expect(await page.evaluate(() => String(AppState.pantry[0].id))).toBe('prod_eggs_1');

    // Reload preserves 18 pcs.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      'typeof AppState !== "undefined" && Array.isArray(AppState.recipes)', null, { timeout: 45000 });
    await page.waitForTimeout(2000);
    expect(await page.evaluate(() => {
      const p = AppState.pantry.find((x) => x.name === 'Eggs');
      return p ? p.quantity : null;
    })).toBe(18);
  });

// ── C. Explicit-expiry separation ──────────────────────────────────────────

test('C. live: Eggs exp Aug 28 + "Eggs 12 pcs Sep 10 2026" stays two truthful records',
  async ({ page }) => {
    await loadLiveApp(page);
    await page.evaluate(() => {
      AppState.pantry = [{ id: 'prod_eggs_2', name: 'Eggs', category: 'Protein',
        purchaseDate: todayISO(), shelfLifeDays: 20, storage: 'fridge',
        quantity: 6, unit: 'pcs', expiryDate: '2026-08-28', dateMode: 'expiry', staple: false }];
      saveData();
    });
    const r = await pressBulkAdd(page, 'Eggs 12 pcs Sep 10 2026');

    expect(r.pantry).toHaveLength(2);
    const aug = r.pantry.find((p) => p.expiryDate === '2026-08-28');
    const sep = r.pantry.find((p) => p.expiryDate === '2026-09-10');
    expect(aug).toBeTruthy();
    expect(sep).toBeTruthy();
    expect(aug.quantity).toBe(6);                          // neither date moved
    expect(sep.quantity).toBe(12);
    expect(r.pantry.some((p) => p.quantity === 18)).toBe(false);   // no 18-piece record
    expect(r.toast).toBe('1 item added.');
  });

// ── D. Unknown quantity ────────────────────────────────────────────────────

test('D. live: an untracked existing quantity never becomes an invented total',
  async ({ page }) => {
    await loadLiveApp(page);
    await page.evaluate(() => {
      AppState.pantry = [{ id: 'prod_eggs_3', name: 'Eggs', category: 'Protein',
        purchaseDate: todayISO(), shelfLifeDays: 20, storage: 'fridge',
        quantity: null, unit: '', staple: false }];
      saveData();
    });
    const r = await pressBulkAdd(page, 'Eggs 12 pcs');

    expect(r.pantry).toHaveLength(2);
    expect(r.pantry.map((p) => p.quantity).sort()).toEqual([12, null]);
    expect(r.pantry.some((p) => p.quantity === 13)).toBe(false);   // nothing fabricated
    // The purchase is still represented as a real number.
    expect(r.pantry.find((p) => p.quantity === 12).unit).toBe('pcs');
  });

// The mirror: a duplicate line with no quantity must not turn a real 6 into "unknown".
test('D2. live: a quantity-less duplicate line leaves the known number alone', async ({ page }) => {
  await loadLiveApp(page);
  await page.evaluate(() => {
    AppState.pantry = [{ id: 'prod_eggs_4', name: 'Eggs', category: 'Protein',
      purchaseDate: todayISO(), shelfLifeDays: 20, storage: 'fridge',
      quantity: 6, unit: 'pcs', staple: false }];
    saveData();
  });
  const r = await pressBulkAdd(page, 'Eggs');

  expect(r.pantry).toHaveLength(1);
  expect(r.pantry[0].quantity).toBe(6);
  expect(r.toast).toBe('1 already in pantry.');
});

// ── E. Unit safety ─────────────────────────────────────────────────────────

test('E. live: 500 g + 1 kg stays two records instead of becoming 501', async ({ page }) => {
  await loadLiveApp(page);
  await page.evaluate(() => {
    AppState.pantry = [{ id: 'prod_chicken_1', name: 'Chicken', category: 'Protein',
      purchaseDate: todayISO(), shelfLifeDays: 4, storage: 'fridge',
      quantity: 500, unit: 'g', staple: false }];
    saveData();
  });
  const r = await pressBulkAdd(page, 'Chicken 1 kg');

  expect(r.pantry).toHaveLength(2);
  expect(r.pantry.map((p) => String(p.quantity) + String(p.unit || '')).sort())
    .toEqual(['1kg', '500g']);
  expect(r.pantry.some((p) => p.quantity === 501)).toBe(false);
});

// Grocery check-off shares the same gate on the deployed build.
test('E2. live: grocery check-off also refuses to add across incompatible units',
  async ({ page }) => {
    await loadLiveApp(page);
    const r = await page.evaluate(() => {
      AppState.pantry = [{ id: 'prod_chicken_2', name: 'Chicken', category: 'Protein',
        purchaseDate: todayISO(), shelfLifeDays: 4, storage: 'fridge',
        quantity: 500, unit: 'g', staple: false }];
      AppState.groceryList = [{ id: 970901, name: 'Chicken', category: 'Protein',
        quantity: 1, unit: 'kg', sources: [], checked: false }];
      toggleGroceryItem(970901);
      return AppState.pantry.map((p) => String(p.quantity) + String(p.unit || ''));
    });
    expect(r.sort()).toEqual(['1kg', '500g']);
  });

// ── The mixed summary the user actually reads ──────────────────────────────

test('live: the summary names added, updated, skipped and actionable separately',
  async ({ page }) => {
    await loadLiveApp(page);
    await page.evaluate(() => {
      AppState.pantry = [
        { id: 'prod_mix_1', name: 'Eggs', category: 'Protein', purchaseDate: todayISO(),
          shelfLifeDays: 20, storage: 'fridge', quantity: 6, unit: 'pcs', staple: false },
        { id: 'prod_mix_2', name: 'Butter', category: 'Dairy', purchaseDate: todayISO(),
          shelfLifeDays: 30, storage: 'fridge', quantity: 1, unit: 'pcs', staple: false }
      ];
      saveData();
    });
    const r = await pressBulkAdd(page, 'Eggs 12 pcs\nButter\nMilk 2 L\nSomething 8/8/2026');

    expect(r.summary).toBe(
      '1 item added · 1 stock item updated · 1 already in pantry · 1 line needs attention.');
    expect(r.textarea).toBe('Something 8/8/2026');   // only the fixable line stays
    expect(r.notes.join(' ')).toContain('6 + 12 = 18');
  });

// ── F. Mobile ──────────────────────────────────────────────────────────────

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('F. live 390px: quantity controls are usable, feedback is visible, nothing overflows',
    async ({ page }) => {
      const pageErrors = [];
      const consoleErrors = [];
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
      page.on('pageerror', (e) => pageErrors.push(e.message));

      await loadLiveApp(page);
      await page.evaluate(() => {
        AppState.pantry = [{ id: 'prod_mob_1', name: 'Fish', category: 'Protein',
          purchaseDate: '2026-08-08', shelfLifeDays: 3, storage: 'fridge',
          quantity: 1, unit: 'kg', expiryDate: '2026-08-10', dateMode: 'expiry', staple: false }];
        saveData(); showTab('fridge'); renderPantry();
      });
      await page.locator('.pi-row').first().click();
      await page.waitForTimeout(300);

      const input = page.locator('input.pt-stock').first();
      await expect(input).toBeVisible();
      const box = await input.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(24);   // a real, tappable control
      expect(box.width).toBeGreaterThanOrEqual(40);

      await input.click();
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.type('2');
      await page.keyboard.press('Tab');
      await page.waitForTimeout(300);
      await expect(page.locator('.pi-qty').first()).toHaveText('2 kg');
      expect(await page.evaluate(() => AppState.pantry[0].expiryDate)).toBe('2026-08-10');

      // Bulk Add feedback is readable on the same viewport.
      await page.evaluate(() => {
        AppState.pantry = [
          { id: 'prod_mob_2', name: 'Eggs', category: 'Protein', purchaseDate: todayISO(),
            shelfLifeDays: 20, storage: 'fridge', quantity: 6, unit: 'pcs', staple: false },
          { id: 'prod_mob_3', name: 'Butter', category: 'Dairy', purchaseDate: todayISO(),
            shelfLifeDays: 30, storage: 'fridge', quantity: 1, unit: 'pcs', staple: false }
        ];
      });
      const r = await pressBulkAdd(page, 'Eggs 12 pcs\nButter\nSomething 8/8/2026');
      expect(r.modalOpen).toBe(true);
      expect(r.summary).toContain('1 stock item updated');
      expect(r.summary).toContain('1 already in pantry');
      await expect(page.locator('.bulk-add-summary')).toBeVisible();

      const o = await page.evaluate(() => ({
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth
      }));
      expect(o.scrollW).toBeLessThanOrEqual(o.clientW);   // no horizontal overflow

      // Page errors are never acceptable.
      expect(pageErrors).toEqual([]);
      // Same environmental exclusion list the other production smokes use: the real
      // Firebase SDK hits Chromium storage partitioning and the App Check reCAPTCHA
      // frame in a headless third-party context. Environmental, not app code.
      const appErrors = consoleErrors.filter(
        (e) => !/net::ERR|Failed to load resource|favicon|requestStorageAccess|frame-ancestors|google\.com/i.test(e)
      );
      expect(appErrors).toEqual([]);
    });
});
