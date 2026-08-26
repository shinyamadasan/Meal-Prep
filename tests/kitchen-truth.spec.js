const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');
const { waitForAppReady, waitForRestored } = require('./app-ready');

/**
 * Kitchen Truth wave — inventory truth with minimum maintenance.
 *
 * The product rules this file exists to prove:
 *   Bought ✓ is the whole interaction — no modal, no quantity, no date.
 *   A merge must never make old food look fresh.
 *   "Use soon" is never removed in bulk. Only "expired" is.
 */

test.use({ viewport: { width: 1280, height: 1700 } });

async function loadLocalApp(page) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__kitchenTruthBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__kitchenTruthBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
  });
  await page.goto(pathToFileURL(path.resolve('index.html')).href, { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
}

// Local calendar date N days ago — daysLeftFrom()/todayISO() work in local time.
const LOCAL_DAY_FN = `(d) => {
  const t = new Date();
  t.setDate(t.getDate() - d);
  return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
}`;

// ── 1. Grocery check-off → inventory ────────────────────────────────────────

test('checking a grocery item transfers it to inventory with no further input', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate(() => {
    AppState.pantry = [];
    AppState.groceryList = [{
      id: 900001, name: 'Chicken Breast', category: 'Protein',
      quantity: 500, unit: 'g', sources: [], checked: false
    }];

    const modalsBefore = document.querySelectorAll('.confirm-overlay').length;
    toggleGroceryItem(900001);
    const modalsAfter = document.querySelectorAll('.confirm-overlay').length;

    const p = AppState.pantry[0];
    return {
      modalsOpened: modalsAfter - modalsBefore,
      pantryCount: AppState.pantry.length,
      name: p.name,
      quantity: p.quantity,
      unit: p.unit,
      category: p.category,
      storage: p.storage,
      purchaseDate: p.purchaseDate,
      today: todayISO(),
      shelfLifeDays: p.shelfLifeDays,
      hasUpdatedAt: !!p.updatedAt,
      daysLeft: pantryDaysLeft(p),
      receiptMode: AppState.groceryList[0].stocked.mode
    };
  });

  expect(result.modalsOpened).toBe(0);              // no confirmation modal per item
  expect(result.pantryCount).toBe(1);
  expect(result.name).toBe('Chicken Breast');
  expect(result.quantity).toBe(500);                // quantity carried across
  expect(result.unit).toBe('g');
  expect(result.category).toBe('Protein');
  expect(result.storage).toBeTruthy();              // storage inferred, never blank
  expect(result.purchaseDate).toBe(result.today);
  expect(result.shelfLifeDays).toBeGreaterThan(0);  // shelf life inferred
  expect(result.hasUpdatedAt).toBe(true);           // LWW-mergeable
  expect(result.daysLeft).toBeGreaterThanOrEqual(0);
  expect(result.receiptMode).toBe('created');
});

test('storage location is inferred per item, not defaulted to one bucket', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate(() => {
    AppState.pantry = [];
    AppState.groceryList = [
      { id: 900010, name: 'Chicken Breast', category: 'Protein', quantity: 1, unit: 'kg', checked: false },
      { id: 900011, name: 'Rice', category: 'Grain', quantity: 2, unit: 'kg', checked: false }
    ];
    toggleGroceryItem(900010);
    toggleGroceryItem(900011);
    const byName = {};
    AppState.pantry.forEach((p) => { byName[p.name] = p.storage; });
    return byName;
  });

  expect(result['Chicken Breast']).toBe('fridge');
  expect(result['Rice']).toBe('counter');
});

test('an unknown quantity stays unknown — the app never invents a number', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate(() => {
    AppState.pantry = [];
    AppState.groceryList = [
      { id: 900020, name: 'Broccoli', category: 'Vegetable', quantity: null, unit: '', checked: false }
    ];
    toggleGroceryItem(900020);
    const p = AppState.pantry[0];
    return { quantity: p.quantity, name: p.name, tracked: p.shelfLifeDays != null };
  });

  expect(result.name).toBe('Broccoli');
  expect(result.quantity).toBeNull();   // not 0, not 1 — unknown
  expect(result.tracked).toBe(true);    // freshness still tracked
});

test('unchecking a mis-tapped item undoes the transfer exactly', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate(() => {
    AppState.pantry = [];
    AppState.deletions = {};
    AppState.groceryList = [
      { id: 900030, name: 'Broccoli', category: 'Vegetable', quantity: 2, unit: 'pcs', checked: false }
    ];
    toggleGroceryItem(900030);
    const afterCheck = AppState.pantry.length;
    const createdId = AppState.pantry[0].id;
    toggleGroceryItem(900030);
    return {
      afterCheck: afterCheck,
      afterUncheck: AppState.pantry.length,
      tombstoned: !!((AppState.deletions.pantry || {})[String(createdId)]),
      receiptCleared: AppState.groceryList[0].stocked === undefined,
      renderedChecked: groceryItemChecked(AppState.groceryList[0])
    };
  });

  expect(result.afterCheck).toBe(1);
  expect(result.afterUncheck).toBe(0);
  expect(result.tombstoned).toBe(true);      // delete syncs; no resurrection
  expect(result.receiptCleared).toBe(true);
  expect(result.renderedChecked).toBe(false); // the row visibly unchecks again
});

// ── 2. Merge with existing inventory ────────────────────────────────────────

test('buying more of something you already have updates the existing record', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    AppState.pantry = [{
      id: 'p_chicken', name: 'Chicken Breast', category: 'Protein',
      purchaseDate: day(1), shelfLifeDays: 4, storage: 'fridge',
      quantity: 300, unit: 'g'
    }];
    AppState.groceryList = [
      { id: 900040, name: 'chicken breast', category: 'Protein', quantity: 500, unit: 'g', checked: false }
    ];
    toggleGroceryItem(900040);
    const p = AppState.pantry[0];
    return {
      count: AppState.pantry.length,
      quantity: p.quantity,
      purchaseDate: p.purchaseDate,
      olderDate: day(1),
      mode: AppState.groceryList[0].stocked.mode
    };
  }, LOCAL_DAY_FN);

  expect(result.count).toBe(1);            // one record, not "Chicken, Chicken, Chicken"
  expect(result.quantity).toBe(800);       // 300 + 500
  expect(result.mode).toBe('merge');
  // The older portion still governs freshness — a merge must not refresh the date.
  expect(result.purchaseDate).toBe(result.olderDate);
});

test('a merge never revives expired stock — it stays a separate record', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    AppState.pantry = [{
      id: 'p_old_fish', name: 'Salmon', category: 'Protein',
      purchaseDate: day(10), shelfLifeDays: 2, storage: 'fridge',
      quantity: 200, unit: 'g'
    }];
    const oldDaysLeft = pantryDaysLeft(AppState.pantry[0]);
    AppState.groceryList = [
      { id: 900050, name: 'Salmon', category: 'Protein', quantity: 400, unit: 'g', checked: false }
    ];
    toggleGroceryItem(900050);
    const fresh = AppState.pantry.find((p) => p.id !== 'p_old_fish');
    const old = AppState.pantry.find((p) => p.id === 'p_old_fish');
    return {
      count: AppState.pantry.length,
      oldDaysLeft: oldDaysLeft,
      oldStillExpired: pantryDaysLeft(old) < 0,
      oldQty: old.quantity,
      freshDaysLeft: pantryDaysLeft(fresh),
      mode: AppState.groceryList[0].stocked.mode
    };
  }, LOCAL_DAY_FN);

  expect(result.oldDaysLeft).toBeLessThan(0);
  expect(result.count).toBe(2);              // separate records — no lot tracking, but no lying
  expect(result.oldStillExpired).toBe(true); // the rotten one is still flagged
  expect(result.oldQty).toBe(200);           // untouched
  expect(result.freshDaysLeft).toBeGreaterThanOrEqual(0);
  expect(result.mode).toBe('created');
});

test('a printed-expiry record is never merged into', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    AppState.pantry = [{
      id: 'p_milk', name: 'Milk', category: 'Dairy', storage: 'fridge',
      dateMode: 'expiry', expiryDate: day(-5), quantity: 1, unit: 'L'
    }];
    AppState.groceryList = [
      { id: 900060, name: 'Milk', category: 'Dairy', quantity: 1, unit: 'L', checked: false }
    ];
    toggleGroceryItem(900060);
    const original = AppState.pantry.find((p) => p.id === 'p_milk');
    return {
      count: AppState.pantry.length,
      originalExpiry: original.expiryDate,
      originalQty: original.quantity,
      mode: AppState.groceryList[0].stocked.mode
    };
  }, LOCAL_DAY_FN);

  expect(result.count).toBe(2);        // the printed date belongs to one carton
  expect(result.originalQty).toBe(1);  // untouched
  expect(result.mode).toBe('created');
});

test('an unknown quantity on either side leaves the merged record unknown', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate(() => {
    AppState.pantry = [{
      id: 'p_garlic', name: 'Garlic', category: 'Vegetable',
      purchaseDate: todayISO(), shelfLifeDays: 30, storage: 'counter',
      quantity: null, unit: ''
    }];
    AppState.groceryList = [
      { id: 900070, name: 'Garlic', category: 'Vegetable', quantity: 3, unit: 'pcs', checked: false }
    ];
    toggleGroceryItem(900070);
    return { count: AppState.pantry.length, quantity: AppState.pantry[0].quantity };
  });

  expect(result.count).toBe(1);
  expect(result.quantity).toBeNull();  // "some garlic", not a fabricated 3
});

test('fuzzy name matches are not merged — Chicken stays out of Chicken Breast', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate(() => {
    AppState.pantry = [{
      id: 'p_cb', name: 'Chicken Breast', category: 'Protein',
      purchaseDate: todayISO(), shelfLifeDays: 4, storage: 'fridge', quantity: 300, unit: 'g'
    }];
    AppState.groceryList = [
      { id: 900080, name: 'Chicken', category: 'Protein', quantity: 1, unit: 'kg', checked: false }
    ];
    toggleGroceryItem(900080);
    return {
      count: AppState.pantry.length,
      breastQty: AppState.pantry.find((p) => p.id === 'p_cb').quantity
    };
  });

  expect(result.count).toBe(2);
  expect(result.breastQty).toBe(300);  // the maintained record is untouched
});

// ── 3. Fast inventory states (reuse stockLevel — no parallel status system) ──

test('buying a low staple restores it to full and clears the auto shopping row', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate(() => {
    AppState.pantry = [{
      id: 'p_soy', name: 'Soy Sauce', category: 'Pantry', storage: 'counter',
      staple: true, stockLevel: 'low', quantity: null, unit: ''
    }];
    AppState.groceryList = [];
    syncStapleToGrocery(AppState.pantry[0]);
    const autoRow = AppState.groceryList.find((g) => g.fromStaple && g.name === 'Soy Sauce');
    const before = AppState.pantry[0].stockLevel;

    toggleGroceryItem(autoRow.id);

    return {
      before: before,
      after: AppState.pantry[0].stockLevel,
      pantryCount: AppState.pantry.length,
      stillListed: AppState.groceryList.some((g) => g.fromStaple && g.name === 'Soy Sauce')
    };
  });

  expect(result.before).toBe('low');
  expect(result.after).toBe('full');     // reuses stockLevel; no new status system
  expect(result.pantryCount).toBe(1);    // no duplicate staple record
  expect(result.stillListed).toBe(false);
});

test('Have / Low / Gone stays a one-tap cycle on the existing stockLevel field', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate(() => {
    AppState.pantry = [{
      id: 'p_salt', name: 'Salt', category: 'Pantry', storage: 'counter',
      staple: true, stockLevel: 'full', quantity: null, unit: ''
    }];
    AppState.groceryList = [];
    const seen = [AppState.pantry[0].stockLevel];
    for (let i = 0; i < 4; i++) {
      cycleStapleLevel('p_salt');
      seen.push(AppState.pantry[0].stockLevel);
    }
    return { seen: seen, listedWhenLow: AppState.groceryList.some((g) => g.fromStaple && g.name === 'Salt') };
  });

  expect(result.seen).toEqual(['full', 'ok', 'low', 'empty', 'full']);
  expect(result.listedWhenLow).toBe(false); // back at 'full' after the full cycle
});

// ── 4. Needs Attention ──────────────────────────────────────────────────────

test('Needs Attention separates expired from use-soon across pantry and cooked food', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    AppState.pantry = [
      { id: 'p_exp', name: 'Old Broccoli', category: 'Vegetable', purchaseDate: day(9), shelfLifeDays: 5, storage: 'fridge' },
      { id: 'p_soon', name: 'Soon Tofu', category: 'Protein', purchaseDate: day(4), shelfLifeDays: 5, storage: 'fridge' },
      { id: 'p_fine', name: 'Fresh Carrot', category: 'Vegetable', purchaseDate: day(0), shelfLifeDays: 20, storage: 'fridge' },
      { id: 'p_low', name: 'Fish Sauce', category: 'Pantry', storage: 'counter', staple: true, stockLevel: 'low' }
    ];
    AppState.cookedMeals = normalizeCookedMeals([
      { id: 'cm_exp', name: 'Old Adobo', cookedDate: day(9), storage: 'fridge', fridgeLife: 4, freezerLife: 60 },
      { id: 'cm_soon', name: 'Soon Sinigang', cookedDate: day(3), storage: 'fridge', fridgeLife: 4, freezerLife: 60 }
    ]);
    const a = collectAttentionItems();
    return {
      expired: a.expired.map((e) => e.name),
      expiredKinds: a.expired.map((e) => e.kind),
      useSoon: a.useSoon.map((e) => e.name),
      low: a.low.map((p) => p.name)
    };
  }, LOCAL_DAY_FN);

  expect(result.expired.sort()).toEqual(['Old Adobo', 'Old Broccoli']);
  expect(result.expiredKinds.sort()).toEqual(['cooked', 'pantry']);
  expect(result.useSoon.sort()).toEqual(['Soon Sinigang', 'Soon Tofu']);
  expect(result.low).toEqual(['Fish Sauce']);
  expect(result.expired).not.toContain('Fresh Carrot');
  expect(result.useSoon).not.toContain('Fresh Carrot');
});

test('Home renders the attention card with per-row Keep / Remove and a bulk action', async ({ page }) => {
  await loadLocalApp(page);

  await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    AppState.pantry = [
      { id: 'p_exp1', name: 'Old Broccoli', category: 'Vegetable', purchaseDate: day(9), shelfLifeDays: 5, storage: 'fridge' },
      { id: 'p_soon1', name: 'Soon Tofu', category: 'Protein', purchaseDate: day(4), shelfLifeDays: 5, storage: 'fridge' }
    ];
    AppState.cookedMeals = [];
    showTab('dashboard');
    renderDashboard();
  }, LOCAL_DAY_FN);

  const card = page.locator('.dash-card--warn');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Expired');
  await expect(card).toContainText('Old Broccoli');
  await expect(card).toContainText('Use soon');
  await expect(card).toContainText('Soon Tofu');
  await expect(card.locator('.dash-keep-btn')).toHaveCount(1);
  await expect(card.locator('.dash-remove-btn')).toHaveCount(1);
  await expect(card.locator('.dash-remove-all-btn')).toContainText('Remove expired (1)');

  // "Use soon" carries no destructive control.
  const soonBlock = card.locator('.dash-l1-block', { hasText: 'Use soon' });
  await expect(soonBlock.locator('.dash-remove-btn')).toHaveCount(0);
});

// ── 5. Expired cleanup ──────────────────────────────────────────────────────

test('one tap removes a single expired item and tombstones it', async ({ page }) => {
  await loadLocalApp(page);

  await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    AppState.deletions = {};
    AppState.pantry = [
      { id: 'p_gone', name: 'Old Broccoli', category: 'Vegetable', purchaseDate: day(9), shelfLifeDays: 5, storage: 'fridge' }
    ];
    AppState.cookedMeals = [];
    showTab('dashboard');
    renderDashboard();
  }, LOCAL_DAY_FN);

  await page.locator('.dash-card--warn .dash-remove-btn').first().click();
  await page.waitForTimeout(300);

  const after = await page.evaluate(() => ({
    pantryCount: AppState.pantry.length,
    tombstoned: !!((AppState.deletions.pantry || {})['p_gone']),
    persisted: JSON.parse(localStorage.getItem('mealPrepAppData')).pantry.length
  }));

  expect(after.pantryCount).toBe(0);
  expect(after.tombstoned).toBe(true);
  expect(after.persisted).toBe(0);
});

test('bulk cleanup removes every expired record and nothing else', async ({ page }) => {
  await loadLocalApp(page);

  const before = await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    AppState.deletions = {};
    // Eight expired items: deliberately more than MASS_DELETE_GUARD (5), to prove
    // the explicit tombstones are what carry the delete, not the vanish-diff.
    AppState.pantry = [];
    for (let i = 0; i < 6; i++) {
      AppState.pantry.push({
        id: 'p_exp_' + i, name: 'Expired ' + i, category: 'Vegetable',
        purchaseDate: day(20), shelfLifeDays: 3, storage: 'fridge'
      });
    }
    AppState.pantry.push({ id: 'p_soon', name: 'Soon Tofu', category: 'Protein', purchaseDate: day(4), shelfLifeDays: 5, storage: 'fridge' });
    AppState.pantry.push({ id: 'p_fine', name: 'Fresh Carrot', category: 'Vegetable', purchaseDate: day(0), shelfLifeDays: 20, storage: 'fridge' });
    AppState.pantry.push({ id: 'p_untracked', name: 'Mystery Jar', category: 'Pantry', storage: 'counter', purchaseDate: null, shelfLifeDays: null });
    AppState.cookedMeals = normalizeCookedMeals([
      { id: 'cm_exp', name: 'Old Adobo', cookedDate: day(20), storage: 'fridge', fridgeLife: 4, freezerLife: 60 },
      { id: 'cm_soon', name: 'Soon Sinigang', cookedDate: day(3), storage: 'fridge', fridgeLife: 4, freezerLife: 60 }
    ]);
    showTab('dashboard');
    renderDashboard();
    return { expiredCount: collectAttentionItems().expired.length };
  }, LOCAL_DAY_FN);

  expect(before.expiredCount).toBe(7); // 6 pantry + 1 cooked

  await page.locator('.dash-remove-all-btn').click();
  await page.waitForTimeout(200);
  await page.locator('.confirm-ok-btn').click();
  await page.waitForTimeout(400);

  const after = await page.evaluate(() => ({
    pantry: AppState.pantry.map((p) => p.id).sort(),
    cooked: (AppState.cookedMeals || []).map((m) => m.id),
    tombstones: Object.keys(AppState.deletions.pantry || {})
      .concat(Object.keys(AppState.deletions.cookedMeals || {})).sort(),
    persistedPantry: JSON.parse(localStorage.getItem('mealPrepAppData')).pantry.map((p) => p.id).sort()
  }));

  // Survivors: use-soon, fresh, untracked, and the use-soon cooked meal.
  expect(after.pantry).toEqual(['p_fine', 'p_soon', 'p_untracked']);
  expect(after.cooked).toEqual(['cm_soon']);
  expect(after.persistedPantry).toEqual(['p_fine', 'p_soon', 'p_untracked']);
  // Every removed id carries an explicit tombstone, so no device can resurrect it.
  expect(after.tombstones).toEqual(
    ['cm_exp', 'p_exp_0', 'p_exp_1', 'p_exp_2', 'p_exp_3', 'p_exp_4', 'p_exp_5'].sort()
  );
});

test('use-soon food is never removed in bulk, even at the boundary', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    AppState.deletions = {};
    AppState.pantry = [
      // Exactly 0 days left — "Use today", the closest thing to expired that isn't.
      { id: 'p_today', name: 'Today Tofu', category: 'Protein', purchaseDate: day(5), shelfLifeDays: 5, storage: 'fridge' },
      { id: 'p_expired', name: 'Yesterday Tofu', category: 'Protein', purchaseDate: day(6), shelfLifeDays: 5, storage: 'fridge' }
    ];
    AppState.cookedMeals = [];
    const a = collectAttentionItems();
    return {
      todayDaysLeft: pantryDaysLeft(AppState.pantry[0]),
      expired: a.expired.map((e) => e.id),
      useSoon: a.useSoon.map((e) => e.id)
    };
  }, LOCAL_DAY_FN);

  expect(result.todayDaysLeft).toBe(0);
  expect(result.expired).toEqual(['p_expired']);
  expect(result.useSoon).toEqual(['p_today']);   // 0 days left is NOT expired
});

test('Keep quiets an expired item for the day without touching its dates', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    AppState.deletions = {};
    AppState.pantry = [
      { id: 'p_keep', name: 'Old Broccoli', category: 'Vegetable', purchaseDate: day(9), shelfLifeDays: 5, storage: 'fridge' }
    ];
    AppState.cookedMeals = [];
    const beforeDate = AppState.pantry[0].purchaseDate;
    const beforeShelf = AppState.pantry[0].shelfLifeDays;
    const beforeDaysLeft = pantryDaysLeft(AppState.pantry[0]);

    keepAttentionItem('pantry', 'p_keep');

    const p = AppState.pantry[0];
    return {
      stillPresent: AppState.pantry.length === 1,
      dateUnchanged: p.purchaseDate === beforeDate,
      shelfUnchanged: p.shelfLifeDays === beforeShelf,
      daysLeftUnchanged: pantryDaysLeft(p) === beforeDaysLeft,
      stillExpiredOnCard: pantryDaysLeft(p) < 0,
      attentionExpired: collectAttentionItems().expired.length,
      bulkCandidates: getExpiredPantryItems().length,
      bannerExpired: getFreshnessAlerts().expired,
      keptOn: p.keptOn,
      today: todayISO()
    };
  }, LOCAL_DAY_FN);

  expect(result.stillPresent).toBe(true);
  expect(result.dateUnchanged).toBe(true);       // no invented expiry
  expect(result.shelfUnchanged).toBe(true);
  expect(result.daysLeftUnchanged).toBe(true);
  expect(result.stillExpiredOnCard).toBe(true);  // Inventory still tells the truth
  expect(result.attentionExpired).toBe(0);       // but it stops nagging today
  expect(result.bulkCandidates).toBe(0);         // and bulk cleanup leaves it alone
  expect(result.bannerExpired).toBe(0);
  expect(result.keptOn).toBe(result.today);
});

test('Keep is a one-day acknowledgement — the item is actionable again tomorrow', async ({ page }) => {
  await loadLocalApp(page);

  // ── Day N: two expired records, one pantry and one cooked, both kept today ──
  const dayN = await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    AppState.deletions = {};
    AppState.pantry = [
      { id: 'p_keep', name: 'Old Broccoli', category: 'Vegetable', purchaseDate: day(9), shelfLifeDays: 5, storage: 'fridge' }
    ];
    AppState.cookedMeals = normalizeCookedMeals([
      { id: 'cm_keep', name: 'Old Adobo', cookedDate: day(9), storage: 'fridge', fridgeLife: 4, freezerLife: 60 }
    ]);
    const beforeKeep = collectAttentionItems().expired.map((e) => e.id).sort();

    keepAttentionItem('pantry', 'p_keep');
    keepAttentionItem('cooked', 'cm_keep');

    return {
      beforeKeep: beforeKeep,
      today: todayISO(),
      keptOnPantry: AppState.pantry[0].keptOn,
      keptOnCooked: AppState.cookedMeals[0].keptOn,
      // All three suppression surfaces, on the day of the tap.
      attention: collectAttentionItems().expired.length,
      bulkCandidates: getExpiredPantryItems().length,
      bannerExpired: getFreshnessAlerts().expired,
      // The underlying truth is untouched.
      purchaseDate: AppState.pantry[0].purchaseDate,
      shelfLifeDays: AppState.pantry[0].shelfLifeDays,
      daysLeft: pantryDaysLeft(AppState.pantry[0])
    };
  }, LOCAL_DAY_FN);

  expect(dayN.beforeKeep).toEqual(['cm_keep', 'p_keep']);  // both were actionable
  expect(dayN.keptOnPantry).toBe(dayN.today);
  expect(dayN.keptOnCooked).toBe(dayN.today);
  expect(dayN.attention).toBe(0);        // suppressed from Home
  expect(dayN.bulkCandidates).toBe(0);   // and from bulk-expired removal
  expect(dayN.bannerExpired).toBe(0);    // and from the freshness alert
  expect(dayN.daysLeft).toBeLessThan(0); // Inventory still knows it is expired

  // Home shows nothing to act on right now.
  await page.evaluate(() => { showTab('dashboard'); renderDashboard(); });
  await expect(page.locator('.dash-remove-all-btn')).toHaveCount(0);

  // ── Advance the wall clock to tomorrow ────────────────────────────────────
  // Nothing else changes: the records are not touched, not removed, and their
  // dates are not edited. Only the calendar moves.
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 30, 0, 0);
  await page.clock.setFixedTime(tomorrow);

  const dayN1 = await page.evaluate(() => ({
    today: todayISO(),
    keptOnPantry: AppState.pantry[0].keptOn,
    keptOnCooked: AppState.cookedMeals[0].keptOn,
    attention: collectAttentionItems().expired.map((e) => e.id).sort(),
    bulkCandidates: getExpiredPantryItems().map((x) => String(x.id)),
    bannerExpired: getFreshnessAlerts().expired,
    stillExpired: pantryDaysLeft(AppState.pantry[0]) < 0,
    pantryCount: AppState.pantry.length,
    cookedCount: AppState.cookedMeals.length
  }));

  expect(dayN1.today).not.toBe(dayN.today);          // the clock really moved
  expect(dayN1.keptOnPantry).toBe(dayN.today);       // the record was NOT rewritten
  expect(dayN1.keptOnCooked).toBe(dayN.today);
  expect(dayN1.pantryCount).toBe(1);                 // nothing was auto-removed
  expect(dayN1.cookedCount).toBe(1);
  expect(dayN1.stillExpired).toBe(true);

  // Suppression has lapsed on all three surfaces.
  expect(dayN1.attention).toEqual(['cm_keep', 'p_keep']);
  expect(dayN1.bulkCandidates).toEqual(['p_keep']);
  expect(dayN1.bannerExpired).toBe(2);

  // And Home offers the actions again.
  await page.evaluate(() => { showTab('dashboard'); renderDashboard(); });
  const card = page.locator('.dash-card--warn');
  await expect(card).toContainText('Old Broccoli');
  await expect(card).toContainText('Old Adobo');
  await expect(card.locator('.dash-remove-btn')).toHaveCount(2);
  await expect(card.locator('.dash-remove-all-btn')).toContainText('Remove expired (2)');
});

test('Keep can be tapped again the next day, and re-suppresses for that day only', async ({ page }) => {
  await loadLocalApp(page);

  const setup = await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    AppState.deletions = {};
    AppState.cookedMeals = [];
    AppState.pantry = [
      // keptOn already carries YESTERDAY's date — the state a kept item is in
      // when the user opens the app the following morning.
      { id: 'p_again', name: 'Old Broccoli', category: 'Vegetable', purchaseDate: day(9),
        shelfLifeDays: 5, storage: 'fridge', keptOn: day(1) }
    ];
    return {
      yesterday: day(1),
      today: todayISO(),
      actionableOnOpen: collectAttentionItems().expired.map((e) => e.id)
    };
  }, LOCAL_DAY_FN);

  expect(setup.yesterday).not.toBe(setup.today);
  expect(setup.actionableOnOpen).toEqual(['p_again']);   // yesterday's Keep does not carry over

  await page.evaluate(() => { showTab('dashboard'); renderDashboard(); });
  await page.locator('.dash-card--warn .dash-keep-btn').first().click();
  await page.waitForTimeout(300);

  const after = await page.evaluate(() => ({
    keptOn: AppState.pantry[0].keptOn,
    today: todayISO(),
    attention: collectAttentionItems().expired.length,
    bulkCandidates: getExpiredPantryItems().length,
    persistedKeptOn: JSON.parse(localStorage.getItem('mealPrepAppData')).pantry[0].keptOn
  }));

  expect(after.keptOn).toBe(after.today);         // refreshed to today, not left at yesterday
  expect(after.attention).toBe(0);
  expect(after.bulkCandidates).toBe(0);
  expect(after.persistedKeptOn).toBe(after.today); // and it survives a reload
});

test('the Inventory tab Clear-expired button now matches what the badges say', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    // A bought-date item with no printed expiryDate — the common case, which the
    // old expiryDate-only scan could never see.
    AppState.pantry = [
      { id: 'p_bought', name: 'Old Broccoli', category: 'Vegetable', purchaseDate: day(9), shelfLifeDays: 5, storage: 'fridge' }
    ];
    AppState.cookedMeals = [];
    showTab('fridge');
    renderPantry();
    const btn = document.getElementById('pantry-clear-expired');
    return {
      daysLeft: pantryDaysLeft(AppState.pantry[0]),
      matched: getExpiredPantryItems().length,
      buttonVisible: !btn.classList.contains('hidden')
    };
  }, LOCAL_DAY_FN);

  expect(result.daysLeft).toBeLessThan(0);
  expect(result.matched).toBe(1);
  expect(result.buttonVisible).toBe(true);
});

// ── 6. Persistence / compatibility ──────────────────────────────────────────

test('a grocery transfer survives a localStorage round-trip and reload', async ({ page }) => {
  await loadLocalApp(page);

  await page.evaluate(() => {
    AppState.pantry = [];
    AppState.groceryList = [
      { id: 900090, name: 'Chicken Breast', category: 'Protein', quantity: 500, unit: 'g', checked: false }
    ];
    toggleGroceryItem(900090);
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  // The two things this test is about, and nothing wider: the transferred pantry record
  // and the checked-off grocery row, both back out of storage. waitForAppReady alone only
  // proves the dashboard painted, which happens before the restore when init is async.
  await waitForRestored(page, () =>
    AppState.pantry.some((x) => x.name === 'Chicken Breast') &&
    (AppState.groceryList.find((x) => x.id === 900090) || {}).checked === true);

  const after = await page.evaluate(() => {
    const p = AppState.pantry.find((x) => x.name === 'Chicken Breast');
    const g = AppState.groceryList.find((x) => x.id === 900090);
    return {
      pantryHas: !!p,
      quantity: p ? p.quantity : null,
      storage: p ? p.storage : null,
      groceryChecked: g ? g.checked : null,       // check-off now persists
      renderedChecked: g ? groceryItemChecked(g) : null
    };
  });

  expect(after.pantryHas).toBe(true);
  expect(after.quantity).toBe(500);
  expect(after.storage).toBe('fridge');
  expect(after.groceryChecked).toBe(true);
  expect(after.renderedChecked).toBe(true);
});

test('old saved data without the new fields still loads and classifies', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    // A pre-wave record: no keptOn, no updatedAt, no stockLevel, no dateMode.
    const legacy = {
      recipes: [], weeklyPlan: {}, groceryList: [{ id: 5, name: 'Rice', category: 'Grain', checked: true }],
      pantry: [{ id: 1, name: 'Old Broccoli', category: 'Vegetable', purchaseDate: day(9), shelfLifeDays: 5 }],
      cookedMeals: [{ id: 2, name: 'Old Adobo', cookedDate: day(9), storage: 'fridge', fridgeLife: 4 }],
      customIngredients: [], customHacks: [], userIngredients: []
    };
    localStorage.setItem('mealPrepAppData', JSON.stringify(legacy));
    loadFromLocalStorage();
    const a = collectAttentionItems();
    return {
      pantryLoaded: AppState.pantry.length,
      cookedLoaded: (AppState.cookedMeals || []).length,
      expired: a.expired.map((e) => e.name).sort(),
      keptDefaults: AppState.pantry.every((p) => p.keptOn === undefined),
      legacyGroceryChecked: groceryItemChecked(AppState.groceryList[0])
    };
  }, LOCAL_DAY_FN);

  expect(result.pantryLoaded).toBe(1);
  expect(result.cookedLoaded).toBe(1);
  expect(result.expired).toEqual(['Old Adobo', 'Old Broccoli']);
  expect(result.keptDefaults).toBe(true);
  expect(result.legacyGroceryChecked).toBe(true);  // legacy checked rows still read as checked
});

test('export and the Firestore payload carry the new fields without new collections', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate(() => {
    AppState.pantry = [];
    AppState.cookedMeals = [];
    AppState.groceryList = [
      { id: 900100, name: 'Chicken Breast', category: 'Protein', quantity: 500, unit: 'g', checked: false }
    ];
    toggleGroceryItem(900100);
    keepAttentionItem('pantry', AppState.pantry[0].id);

    const payload = buildFirestorePayload();
    const known = [
      'recipes', 'weeklyPlan', 'groceryList', 'nutritionGoals', 'customIngredients',
      'customHacks', 'pantry', 'userIngredients', 'ingredientPrices', 'myStores',
      'customStores', 'cookedMeals', 'cookHistory', 'recentRecipes', 'prepModeSession',
      'deletions', 'lastUpdated', 'lastSaved',
      // 'flavors' is the Flavor Library collection (D-070) — a DELIBERATE, owner-
      // approved new top-level collection, which is why it is listed rather than
      // the check being loosened. The guard still fails on any key nobody decided
      // on, which is the whole point of it.
      'flavors'
    ];
    return {
      unexpectedTopLevelKeys: Object.keys(payload).filter((k) => known.indexOf(k) < 0),
      pantryHasKeptOn: payload.pantry[0].keptOn === todayISO(),
      groceryHasReceipt: !!payload.groceryList[0].stocked,
      pantryIsArray: Array.isArray(payload.pantry)
    };
  });

  expect(result.unexpectedTopLevelKeys).toEqual([]);  // no new AppState collection
  expect(result.pantryHasKeptOn).toBe(true);
  expect(result.groceryHasReceipt).toBe(true);
  expect(result.pantryIsArray).toBe(true);
});

// ── 7. Wave 1 / Wave 2 behaviour must be unchanged ──────────────────────────

test('Ready Food First and low-effort suggestions still work after the wave', async ({ page }) => {
  await loadLocalApp(page);

  const result = await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    AppState.cookedMeals = normalizeCookedMeals([
      { id: 'm_ready', name: 'Ready Lechon Manok', cookedDate: day(0), storage: 'fridge',
        fridgeLife: 4, freezerLife: 60, initialPortions: 3, portionsRemaining: 3 }
    ]);
    const ready = getReadyFoodSuggestions(3);
    const beforePortions = AppState.cookedMeals[0].portionsRemaining;
    useCookedPortion('m_ready');
    return {
      readyCount: ready.length,
      readyName: ready[0].name,
      beforePortions: beforePortions,
      afterPortions: AppState.cookedMeals[0].portionsRemaining,
      cookSuggestionsRun: Array.isArray(getCookSuggestions())
    };
  }, LOCAL_DAY_FN);

  expect(result.readyCount).toBe(1);
  expect(result.readyName).toBe('Ready Lechon Manok');
  expect(result.beforePortions).toBe(3);
  expect(result.afterPortions).toBe(2);   // one-tap "Used 1" unchanged
  expect(result.cookSuggestionsRun).toBe(true);
});

test('Home still renders Ready to eat above the cook suggestions', async ({ page }) => {
  await loadLocalApp(page);

  await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    AppState.cookedMeals = normalizeCookedMeals([
      { id: 'm_ready2', name: 'Ready Lechon Manok', cookedDate: day(0), storage: 'fridge',
        fridgeLife: 4, freezerLife: 60, initialPortions: 3, portionsRemaining: 3 }
    ]);
    showTab('dashboard');
    renderDashboard();
  }, LOCAL_DAY_FN);

  await expect(page.locator('.dash-card--ready')).toContainText('Ready to eat');
  await expect(page.locator('.dash-card--ready')).toContainText('Ready Lechon Manok');
});

// ── 8. Mobile + console hygiene ─────────────────────────────────────────────

test('mobile: expired cleanup is reachable and tappable on a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadLocalApp(page);

  await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    AppState.deletions = {};
    AppState.pantry = [
      { id: 'p_m1', name: 'Old Broccoli', category: 'Vegetable', purchaseDate: day(9), shelfLifeDays: 5, storage: 'fridge' },
      { id: 'p_m2', name: 'Old Tofu', category: 'Protein', purchaseDate: day(9), shelfLifeDays: 5, storage: 'fridge' }
    ];
    AppState.cookedMeals = [];
    showTab('dashboard');
    renderDashboard();
  }, LOCAL_DAY_FN);

  // Every control that DELETES must be a real tap target, not a text link. The
  // bulk button is included deliberately: it inherits .dash-l1-cta, which is
  // padding-0, and shipped at 12px tall until this assertion caught it.
  const destructive = page.locator('.dash-card--warn .dash-remove-btn, .dash-card--warn .dash-remove-all-btn, .dash-card--warn .dash-keep-btn');
  const count = await destructive.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const b = destructive.nth(i);
    await expect(b).toBeVisible();
    const bb = await b.boundingBox();
    expect(bb.height, 'control ' + i + ' height').toBeGreaterThanOrEqual(30);
    expect(bb.width, 'control ' + i + ' width').toBeGreaterThanOrEqual(44);
    expect(bb.x, 'control ' + i + ' left edge').toBeGreaterThanOrEqual(0);
    expect(bb.x + bb.width, 'control ' + i + ' right edge').toBeLessThanOrEqual(390);
  }

  const removeBtn = page.locator('.dash-card--warn .dash-remove-btn').first();

  // The page itself must not scroll sideways on a phone.
  const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflows).toBe(false);

  await removeBtn.click();
  await page.waitForTimeout(300);
  const remaining = await page.evaluate(() => AppState.pantry.length);
  expect(remaining).toBe(1);
});

test('the whole grocery → attention → cleanup loop runs with no console errors', async ({ page }) => {
  const errors = [];
  // The Firebase CDN is deliberately aborted by loadLocalApp(), which the browser
  // reports as ERR_FAILED. Only application-level errors count here.
  const isRouteAbort = (t) => /net::ERR_FAILED|Failed to load resource/.test(t);
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !isRouteAbort(msg.text())) errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(String(err)));

  await loadLocalApp(page);

  await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    AppState.deletions = {};
    AppState.pantry = [
      { id: 'p_e1', name: 'Old Broccoli', category: 'Vegetable', purchaseDate: day(9), shelfLifeDays: 5, storage: 'fridge' }
    ];
    AppState.cookedMeals = [];
    AppState.groceryList = [
      { id: 900110, name: 'Chicken Breast', category: 'Protein', quantity: 500, unit: 'g', checked: false }
    ];
  }, LOCAL_DAY_FN);

  await page.evaluate(() => { showTab('grocery'); renderGroceryList(); });
  await page.locator('#grocery-list .grocery-item').first().click();
  await page.waitForTimeout(300);

  await page.evaluate(() => { showTab('fridge'); renderPantry(); renderCookedMeals(); });
  await page.waitForTimeout(200);

  await page.evaluate(() => { showTab('dashboard'); renderDashboard(); });
  await page.locator('.dash-card--warn .dash-keep-btn').first().click();
  await page.waitForTimeout(300);

  const state = await page.evaluate(() => ({
    pantryCount: AppState.pantry.length,
    attentionExpired: collectAttentionItems().expired.length
  }));

  expect(state.pantryCount).toBe(2);       // the purchase landed
  expect(state.attentionExpired).toBe(0);  // and Keep quieted the expired one
  expect(errors).toEqual([]);
});
