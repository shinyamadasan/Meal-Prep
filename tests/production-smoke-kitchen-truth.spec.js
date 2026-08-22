const { test, expect } = require('@playwright/test');

/**
 * Production smoke for the kitchen-truth wave (D-057).
 *
 * Runs against the DEPLOYED GitHub Pages build, not the working tree. Firebase
 * is deliberately NOT stubbed — the page loads it for real and stays signed
 * out, the normal first-visit path. Each test gets a fresh isolated context, so
 * nothing persists between them and nothing touches a real account's cloud data.
 *
 * Every assertion here is about the SHIPPED bundle: that the transfer exists,
 * that a merge cannot make old food look fresh, and that bulk cleanup writes
 * real tombstones and never touches "use soon".
 */

const APP_URL = 'https://shinyamadasan.github.io/Meal-Prep/';

test.use({ viewport: { width: 1280, height: 1700 } });

async function loadLiveApp(page) {
  // Runs before EVERY navigation, so it must bootstrap once and then leave
  // storage alone — otherwise a page.reload() would wipe the data under test.
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__kitchenProdBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__kitchenProdBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
  });
  // Cache-bust so a stale Pages/CDN copy can never make this pass falsely.
  await page.goto(APP_URL + '?smoke=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load').catch(() => {});
  // AppState is a top-level `const`, so it is NOT a window property — probe it
  // by name from page scope, the way the app's own inline handlers see it.
  await page.waitForFunction(
    'typeof AppState !== "undefined" && Array.isArray(AppState.recipes)',
    null,
    { timeout: 45000 }
  );
  await page.waitForTimeout(3000);
}

// Local calendar date N days ago — daysLeftFrom()/todayISO() work in local time,
// so a UTC-derived date silently shifts by a day near midnight.
const DAY_FN = `(d) => {
  const t = new Date();
  t.setDate(t.getDate() - d);
  return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
}`;

test('the deployed bundle actually contains the wave', async ({ page }) => {
  await loadLiveApp(page);

  const present = await page.evaluate(() => ({
    stock: typeof stockPurchasedGroceryItem === 'function',
    unstock: typeof unstockPurchasedGroceryItem === 'function',
    exactName: typeof findPantryByExactName === 'function',
    canMerge: typeof canMergePurchase === 'function',
    collect: typeof collectAttentionItems === 'function',
    keep: typeof keepAttentionItem === 'function',
    removeOne: typeof removeAttentionItem === 'function',
    removeAll: typeof removeAllExpired === 'function',
    keptToday: typeof isKeptToday === 'function',
    checkedHelper: typeof groceryItemChecked === 'function',
    // Wave 1 / Wave 2 must still be there.
    readyFood: typeof getReadyFoodSuggestions === 'function',
    usePortion: typeof useCookedPortion === 'function',
    cookSuggestions: typeof getCookSuggestions === 'function'
  }));

  Object.entries(present).forEach(([name, ok]) => {
    expect(ok, `${name} missing from the deployed bundle`).toBe(true);
  });
});

test('live: checking a grocery item writes inventory with no further input', async ({ page }) => {
  await loadLiveApp(page);

  const result = await page.evaluate(() => {
    AppState.pantry = [];
    AppState.groceryList = [{
      id: 910001, name: 'Chicken Breast', category: 'Protein',
      quantity: 500, unit: 'g', sources: [], checked: false
    }];
    const before = document.querySelectorAll('.confirm-overlay').length;
    toggleGroceryItem(910001);
    const after = document.querySelectorAll('.confirm-overlay').length;
    const p = AppState.pantry[0];
    return {
      modalsOpened: after - before,
      count: AppState.pantry.length,
      name: p.name,
      quantity: p.quantity,
      storage: p.storage,
      purchaseDate: p.purchaseDate,
      today: todayISO(),
      shelfLifeDays: p.shelfLifeDays,
      daysLeft: pantryDaysLeft(p)
    };
  });

  expect(result.modalsOpened).toBe(0);
  expect(result.count).toBe(1);
  expect(result.quantity).toBe(500);
  expect(result.storage).toBe('fridge');
  expect(result.purchaseDate).toBe(result.today);
  expect(result.shelfLifeDays).toBeGreaterThan(0);
  expect(result.daysLeft).toBeGreaterThanOrEqual(0);
});

test('live: the transfer survives a real reload', async ({ page }) => {
  await loadLiveApp(page);

  await page.evaluate(() => {
    AppState.pantry = [];
    AppState.groceryList = [{
      id: 910010, name: 'Eggs', category: 'Protein',
      quantity: 12, unit: 'pcs', sources: [], checked: false
    }];
    toggleGroceryItem(910010);
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction('typeof AppState !== "undefined" && Array.isArray(AppState.pantry)', null, { timeout: 45000 });
  await page.waitForTimeout(3000);

  const after = await page.evaluate(() => {
    const p = (AppState.pantry || []).find((x) => x.name === 'Eggs');
    const g = (AppState.groceryList || []).find((x) => x.id === 910010);
    return {
      pantryHas: !!p,
      quantity: p ? p.quantity : null,
      groceryChecked: g ? !!g.checked : null
    };
  });

  expect(after.pantryHas).toBe(true);
  expect(after.quantity).toBe(12);
  expect(after.groceryChecked).toBe(true);   // check-off persists; it never used to
});

test('live: a merge adds quantity but never refreshes the date', async ({ page }) => {
  await loadLiveApp(page);

  const result = await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    AppState.pantry = [{
      id: 'prod_chicken', name: 'Chicken Breast', category: 'Protein',
      purchaseDate: day(1), shelfLifeDays: 4, storage: 'fridge', quantity: 300, unit: 'g'
    }];
    AppState.groceryList = [{
      id: 910020, name: 'chicken breast', category: 'Protein',
      quantity: 500, unit: 'g', sources: [], checked: false
    }];
    toggleGroceryItem(910020);
    const p = AppState.pantry[0];
    return {
      count: AppState.pantry.length,
      quantity: p.quantity,
      purchaseDate: p.purchaseDate,
      olderDate: day(1),
      today: todayISO()
    };
  }, DAY_FN);

  expect(result.count).toBe(1);                      // merged, not duplicated
  expect(result.quantity).toBe(800);
  expect(result.purchaseDate).toBe(result.olderDate);
  expect(result.purchaseDate).not.toBe(result.today); // old food did NOT become fresh
});

test('live: an expired record is never merged into', async ({ page }) => {
  await loadLiveApp(page);

  const result = await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    AppState.pantry = [{
      id: 'prod_old', name: 'Salmon', category: 'Protein',
      purchaseDate: day(10), shelfLifeDays: 2, storage: 'fridge', quantity: 200, unit: 'g'
    }];
    AppState.groceryList = [{
      id: 910030, name: 'Salmon', category: 'Protein',
      quantity: 400, unit: 'g', sources: [], checked: false
    }];
    toggleGroceryItem(910030);
    const old = AppState.pantry.find((p) => p.id === 'prod_old');
    return {
      count: AppState.pantry.length,
      oldQty: old.quantity,
      oldStillExpired: pantryDaysLeft(old) < 0
    };
  }, DAY_FN);

  expect(result.count).toBe(2);              // separate records
  expect(result.oldQty).toBe(200);           // untouched
  expect(result.oldStillExpired).toBe(true);
});

test('live: Home shows Needs Attention with Keep / Remove and bulk cleanup', async ({ page }) => {
  await loadLiveApp(page);

  await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    AppState.pantry = [
      { id: 'prod_e1', name: 'Old Broccoli', category: 'Vegetable', purchaseDate: day(9), shelfLifeDays: 5, storage: 'fridge' },
      { id: 'prod_s1', name: 'Soon Tofu', category: 'Protein', purchaseDate: day(4), shelfLifeDays: 5, storage: 'fridge' }
    ];
    AppState.cookedMeals = [];
    showTab('dashboard');
    renderDashboard();
  }, DAY_FN);

  const card = page.locator('.dash-card--warn');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Expired');
  await expect(card).toContainText('Old Broccoli');
  await expect(card).toContainText('Use soon');
  await expect(card).toContainText('Soon Tofu');
  await expect(card.locator('.dash-keep-btn')).toHaveCount(1);
  await expect(card.locator('.dash-remove-btn')).toHaveCount(1);
  await expect(card.locator('.dash-remove-all-btn')).toContainText('Remove expired (1)');

  // The destructive control is a real tap target in production, not a text link.
  const box = await card.locator('.dash-remove-all-btn').boundingBox();
  expect(box.height).toBeGreaterThanOrEqual(30);
});

test('live: one-tap removal tombstones the record', async ({ page }) => {
  await loadLiveApp(page);

  await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    AppState.deletions = {};
    AppState.pantry = [
      { id: 'prod_gone', name: 'Old Broccoli', category: 'Vegetable', purchaseDate: day(9), shelfLifeDays: 5, storage: 'fridge' }
    ];
    AppState.cookedMeals = [];
    showTab('dashboard');
    renderDashboard();
  }, DAY_FN);

  await page.locator('.dash-card--warn .dash-remove-btn').first().click();
  await page.waitForTimeout(600);

  const after = await page.evaluate(() => ({
    pantryCount: AppState.pantry.length,
    tombstoned: !!AppState.deletions['prod_gone'],
    persisted: JSON.parse(localStorage.getItem('mealPrepAppData')).pantry.length
  }));

  expect(after.pantryCount).toBe(0);
  expect(after.tombstoned).toBe(true);
  expect(after.persisted).toBe(0);
});

test('live: bulk cleanup crosses MASS_DELETE_GUARD, tombstones every id, and spares use-soon', async ({ page }) => {
  await loadLiveApp(page);

  const before = await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    AppState.deletions = {};
    AppState.pantry = [];
    // Six expired — deliberately more than MASS_DELETE_GUARD (5), so the delete
    // can only sync if the EXPLICIT tombstones are being written.
    for (let i = 0; i < 6; i++) {
      AppState.pantry.push({
        id: 'prod_exp_' + i, name: 'Expired ' + i, category: 'Vegetable',
        purchaseDate: day(20), shelfLifeDays: 3, storage: 'fridge'
      });
    }
    AppState.pantry.push({ id: 'prod_soon', name: 'Soon Tofu', category: 'Protein', purchaseDate: day(4), shelfLifeDays: 5, storage: 'fridge' });
    AppState.pantry.push({ id: 'prod_fine', name: 'Fresh Carrot', category: 'Vegetable', purchaseDate: day(0), shelfLifeDays: 20, storage: 'fridge' });
    AppState.cookedMeals = normalizeCookedMeals([
      { id: 'prod_cm_exp', name: 'Old Adobo', cookedDate: day(20), storage: 'fridge', fridgeLife: 4, freezerLife: 60 },
      { id: 'prod_cm_soon', name: 'Soon Sinigang', cookedDate: day(3), storage: 'fridge', fridgeLife: 4, freezerLife: 60 }
    ]);
    showTab('dashboard');
    renderDashboard();
    return { expired: collectAttentionItems().expired.length };
  }, DAY_FN);

  expect(before.expired).toBe(7);   // 6 pantry + 1 cooked

  await page.locator('.dash-remove-all-btn').click();
  await page.waitForTimeout(400);
  await page.locator('.confirm-ok-btn').click();
  await page.waitForTimeout(800);

  const after = await page.evaluate(() => ({
    pantry: AppState.pantry.map((p) => String(p.id)).sort(),
    cooked: (AppState.cookedMeals || []).map((m) => String(m.id)),
    tombstones: Object.keys(AppState.deletions).sort(),
    persisted: JSON.parse(localStorage.getItem('mealPrepAppData')).pantry.map((p) => String(p.id)).sort()
  }));

  expect(after.pantry).toEqual(['prod_fine', 'prod_soon']);
  expect(after.cooked).toEqual(['prod_cm_soon']);       // use-soon cooked food spared
  expect(after.persisted).toEqual(['prod_fine', 'prod_soon']);
  expect(after.tombstones).toEqual(
    ['prod_cm_exp', 'prod_exp_0', 'prod_exp_1', 'prod_exp_2', 'prod_exp_3', 'prod_exp_4', 'prod_exp_5'].sort()
  );
});

test('live: Keep invents no date and lapses the next day', async ({ page }) => {
  await loadLiveApp(page);

  const dayN = await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    AppState.deletions = {};
    AppState.pantry = [
      { id: 'prod_keep', name: 'Old Broccoli', category: 'Vegetable', purchaseDate: day(9), shelfLifeDays: 5, storage: 'fridge' }
    ];
    AppState.cookedMeals = [];
    const beforeDate = AppState.pantry[0].purchaseDate;
    keepAttentionItem('pantry', 'prod_keep');
    const p = AppState.pantry[0];
    return {
      dateUnchanged: p.purchaseDate === beforeDate,
      stillExpired: pantryDaysLeft(p) < 0,
      attention: collectAttentionItems().expired.length,
      bulk: getExpiredPantryItems().length,
      banner: getFreshnessAlerts().expired,
      keptOn: p.keptOn,
      today: todayISO()
    };
  }, DAY_FN);

  expect(dayN.dateUnchanged).toBe(true);   // no invented expiry
  expect(dayN.stillExpired).toBe(true);    // Inventory still tells the truth
  expect(dayN.attention).toBe(0);
  expect(dayN.bulk).toBe(0);
  expect(dayN.banner).toBe(0);
  expect(dayN.keptOn).toBe(dayN.today);

  // Move the wall clock to tomorrow. Nothing else changes.
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 30, 0, 0);
  await page.clock.setFixedTime(tomorrow);

  const dayN1 = await page.evaluate(() => ({
    today: todayISO(),
    keptOn: AppState.pantry[0].keptOn,
    attention: collectAttentionItems().expired.map((e) => String(e.id)),
    bulk: getExpiredPantryItems().length,
    banner: getFreshnessAlerts().expired,
    pantryCount: AppState.pantry.length
  }));

  expect(dayN1.today).not.toBe(dayN.today);
  expect(dayN1.keptOn).toBe(dayN.today);        // record not rewritten
  expect(dayN1.pantryCount).toBe(1);            // nothing auto-removed
  expect(dayN1.attention).toEqual(['prod_keep']);
  expect(dayN1.bulk).toBe(1);
  expect(dayN1.banner).toBe(1);
});

test('live: Ready Food First and low-effort suggestions still work', async ({ page }) => {
  await loadLiveApp(page);

  const result = await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    AppState.cookedMeals = normalizeCookedMeals([
      { id: 'prod_ready', name: 'Ready Lechon Manok', cookedDate: day(0), storage: 'fridge',
        fridgeLife: 4, freezerLife: 60, initialPortions: 3, portionsRemaining: 3 }
    ]);
    const ready = getReadyFoodSuggestions(3);
    useCookedPortion('prod_ready');
    return {
      readyCount: ready.length,
      readyName: ready[0].name,
      afterPortions: AppState.cookedMeals[0].portionsRemaining,
      cookSuggestionsRun: Array.isArray(getCookSuggestions())
    };
  }, DAY_FN);

  expect(result.readyCount).toBe(1);
  expect(result.readyName).toBe('Ready Lechon Manok');
  expect(result.afterPortions).toBe(2);       // one-tap Used 1 unchanged
  expect(result.cookSuggestionsRun).toBe(true);
});

test('live: the full loop runs with no application console errors', async ({ page }) => {
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await loadLiveApp(page);

  await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    AppState.deletions = {};
    AppState.pantry = [
      { id: 'prod_l1', name: 'Old Broccoli', category: 'Vegetable', purchaseDate: day(9), shelfLifeDays: 5, storage: 'fridge' }
    ];
    AppState.cookedMeals = [];
    AppState.groceryList = [
      { id: 910040, name: 'Chicken Breast', category: 'Protein', quantity: 500, unit: 'g', sources: [], checked: false }
    ];
    showTab('grocery');
    renderGroceryList();
  }, DAY_FN);

  await page.locator('#grocery-list .grocery-item').first().click();
  await page.waitForTimeout(500);
  await page.evaluate(() => { showTab('fridge'); renderPantry(); renderCookedMeals(); });
  await page.waitForTimeout(400);
  await page.evaluate(() => { showTab('dashboard'); renderDashboard(); });
  await page.locator('.dash-card--warn .dash-keep-btn').first().click();
  await page.waitForTimeout(500);

  const state = await page.evaluate(() => ({
    pantryCount: AppState.pantry.length,
    attentionExpired: collectAttentionItems().expired.length
  }));

  expect(state.pantryCount).toBe(2);
  expect(state.attentionExpired).toBe(0);

  expect(pageErrors).toEqual([]);
  // Same exclusion list the other two production smokes use.
  // `requestStorageAccess: Permission denied` comes from the real Firebase SDK
  // hitting Chromium's storage partitioning in a headless third-party context.
  // Environmental, not app code, and absent in a normal browser.
  const appErrors = consoleErrors.filter(
    (e) => !/net::ERR|Failed to load resource|favicon|requestStorageAccess/i.test(e)
  );
  expect(appErrors).toEqual([]);
});
