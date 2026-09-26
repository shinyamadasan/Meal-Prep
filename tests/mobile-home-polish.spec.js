const { test, expect } = require('@playwright/test');
const { waitForAppReady } = require('./app-ready');

/**
 * Mobile Home Polish wave — Home stays a compact mobile command center even
 * when there is a lot to flag. This file pins the behavior TASK-062 got wrong:
 * expired items no longer force the attention detail open on every render.
 * Keep / Remove / Remove expired / Plan it / use-soon detail are all still
 * there — just behind one explicit action (Review, the global banner's View,
 * or openAttentionView()'s notification/deep-link path) instead of always on.
 */

async function loadLocalApp(page) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
  });
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
}

// Local calendar date N days ago — daysLeftFrom()/todayISO() work in local time.
const LOCAL_DAY_FN = `(d) => {
  const t = new Date();
  t.setDate(t.getDate() - d);
  return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
}`;

async function seedAttention(page) {
  await page.evaluate((dayFnSrc) => {
    const day = eval(dayFnSrc);
    AppState.deletions = {};
    AppState.pantry = [
      { id: 'mhp_exp1', name: 'Old Broccoli', category: 'Vegetable', purchaseDate: day(9), shelfLifeDays: 5, storage: 'fridge' },
      { id: 'mhp_exp2', name: 'Old Milk', category: 'Dairy', purchaseDate: day(10), shelfLifeDays: 5, storage: 'fridge' },
      { id: 'mhp_soon1', name: 'Soon Tofu', category: 'Protein', purchaseDate: day(4), shelfLifeDays: 5, storage: 'fridge' }
    ];
    AppState.cookedMeals = [];
    showTab('dashboard');
    renderDashboard();
  }, LOCAL_DAY_FN);
}

test.describe('Home attention panel — compact by default', () => {
  test.use({ viewport: { width: 1280, height: 1700 } });

  test('attention details are CLOSED by default even when expired items exist', async ({ page }) => {
    await loadLocalApp(page);
    await seedAttention(page);

    const state = await page.evaluate(() => {
      const card = document.getElementById('dash-attention');
      return { present: !!card, open: card ? card.open : null };
    });
    expect(state.present).toBe(true);
    expect(state.open).toBe(false);
    // Present in the DOM (Keep is still findable), but not rendered — native
    // <details> collapse, verified through Playwright's own visibility check
    // rather than offsetParent (which does not reflect this hiding mechanism).
    await expect(page.locator('.dash-keep-btn').first()).not.toBeVisible();
  });

  test('the compact summary shows truthful expired / use-soon counts', async ({ page }) => {
    await loadLocalApp(page);
    await seedAttention(page);

    const summary = await page.locator('#dash-attention .dash-attn-summary').innerText();
    expect(summary).toContain('2 expired');
    expect(summary).toContain('1 use soon');
  });

  test('tapping Review opens the details', async ({ page }) => {
    await loadLocalApp(page);
    await seedAttention(page);

    await page.locator('.dash-attn-review-btn').click();
    const open = await page.evaluate(() => document.getElementById('dash-attention').open);
    expect(open).toBe(true);
  });

  test('Review forces open rather than toggling — a second tap stays open', async ({ page }) => {
    await loadLocalApp(page);
    await seedAttention(page);

    const reviewBtn = page.locator('.dash-attn-review-btn');
    await reviewBtn.click();
    await reviewBtn.click();
    const open = await page.evaluate(() => document.getElementById('dash-attention').open);
    expect(open).toBe(true);
  });

  test("the global banner's View action opens Home's attention details", async ({ page }) => {
    await loadLocalApp(page);
    await seedAttention(page);

    await page.evaluate(() => {
      showTab('planner'); // start somewhere else, so this proves real navigation
      viewFreshnessDetails();
    });
    const state = await page.evaluate(() => ({
      activeTab: document.querySelector('.tab-btn.active').getAttribute('data-tab'),
      open: document.getElementById('dash-attention').open
    }));
    expect(state.activeTab).toBe('dashboard');
    expect(state.open).toBe(true);
  });

  test('openAttentionView() opens the details (notification / deep-link path)', async ({ page }) => {
    await loadLocalApp(page);
    await seedAttention(page);

    await page.evaluate(() => { showTab('planner'); openAttentionView(); });
    const state = await page.evaluate(() => ({
      activeTab: document.querySelector('.tab-btn.active').getAttribute('data-tab'),
      open: document.getElementById('dash-attention').open
    }));
    expect(state.activeTab).toBe('dashboard');
    expect(state.open).toBe(true);
  });

  test('Keep / Remove / Remove expired remain reachable once opened', async ({ page }) => {
    await loadLocalApp(page);
    await seedAttention(page);

    await page.evaluate(() => openAttentionView());
    const card = page.locator('.dash-card--warn');
    await expect(card.locator('.dash-keep-btn').first()).toBeVisible();
    await expect(card.locator('.dash-remove-btn').first()).toBeVisible();
    await expect(card.locator('.dash-remove-all-btn')).toBeVisible();
    await expect(card.locator('.dash-remove-all-btn')).toContainText('Remove expired (2)');
  });

  test('manually opening the card survives the next render (view state preserved)', async ({ page }) => {
    await loadLocalApp(page);
    await seedAttention(page);

    await page.evaluate(() => openAttentionView());
    await page.evaluate(() => renderDashboard()); // e.g. a re-render triggered by an unrelated action
    const open = await page.evaluate(() => document.getElementById('dash-attention').open);
    expect(open).toBe(true);
  });
});

test.describe('Home hierarchy and secondary surfaces', () => {
  test.use({ viewport: { width: 1280, height: 1700 } });

  test('Ready to eat renders above the attention details', async ({ page }) => {
    await loadLocalApp(page);
    await page.evaluate((dayFnSrc) => {
      const day = eval(dayFnSrc);
      AppState.deletions = {};
      AppState.pantry = [
        { id: 'mhp_exp3', name: 'Old Adobo Sauce', category: 'Pantry', purchaseDate: day(9), shelfLifeDays: 5, storage: 'fridge' }
      ];
      AppState.cookedMeals = normalizeCookedMeals([
        { id: 'mhp_cm1', name: 'Ready Lechon Manok', cookedDate: day(0), storage: 'fridge', fridgeLife: 4, freezerLife: 60, portionsRemaining: 2 }
      ]);
      showTab('dashboard');
      renderDashboard();
    }, LOCAL_DAY_FN);

    const order = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('#dashboard .dashboard > *'));
      return nodes.map((n) => n.className);
    });
    const readyIdx = order.findIndex((c) => c.includes('dash-card--ready'));
    const attnIdx = order.findIndex((c) => c.includes('dash-card--warn'));
    expect(readyIdx).toBeGreaterThan(-1);
    expect(attnIdx).toBeGreaterThan(-1);
    expect(readyIdx).toBeLessThan(attnIdx);
  });

  test('Record leftovers / takeout stays a compact, reachable row', async ({ page }) => {
    await loadLocalApp(page);
    await page.evaluate(() => { showTab('dashboard'); renderDashboard(); });

    const btn = page.locator('.dash-leftover-compact');
    await expect(btn).toBeVisible();
    await expect(btn).toContainText('Record leftovers');

    await page.evaluate(() => {
      window.__openedManualCooked = false;
      const orig = window.openManualCookedModal;
      window.openManualCookedModal = function () { window.__openedManualCooked = true; return orig.apply(this, arguments); };
    });
    await btn.click();
    const opened = await page.evaluate(() => window.__openedManualCooked);
    expect(opened).toBe(true);
  });

  test('Need ideas? and Cook History stay collapsed by default', async ({ page }) => {
    await loadLocalApp(page);
    await page.evaluate(() => {
      AppState.cookHistory = [{ recipeName: 'Test Adobo', date: new Date().toISOString(), servings: 2 }];
      showTab('dashboard');
      renderDashboard();
    });

    const state = await page.evaluate(() => ({
      ideasOpen: document.getElementById('dash-ideas') ? document.getElementById('dash-ideas').open : null,
      historyOpen: document.getElementById('dash-history') ? document.getElementById('dash-history').open : null
    }));
    expect(state.ideasOpen).toBe(false);
    expect(state.historyOpen).toBe(false);
  });
});

test.describe('Greeting — no orphaned emoji', () => {
  test.use({ viewport: { width: 390, height: 844 } }); // iPhone 12-ish

  test('the wave emoji is glued to the last word with a non-breaking space', async ({ page }) => {
    await loadLocalApp(page);
    await page.evaluate(() => { showTab('dashboard'); renderDashboard(); });

    const text = await page.locator('.dash-greeting').innerText();
    const nbspIdx = text.indexOf(' ');
    expect(nbspIdx, 'expected a non-breaking space before the emoji').toBeGreaterThan(-1);
    expect(text.slice(nbspIdx + 1)).toBe('👋');
  });
});
