const { test, expect } = require('@playwright/test');

/**
 * Production smoke for the cooking-method discovery wave (D-060..D-064).
 *
 * Runs against the DEPLOYED GitHub Pages build, not the working tree. Firebase is
 * deliberately NOT stubbed — the page loads it for real and stays signed out, the
 * normal first-visit path. Each test gets a fresh isolated context, so nothing
 * persists between tests and nothing touches a real account's cloud data.
 *
 * This is the wave whose whole failure mode was "the tests pass but the product
 * doesn't", so every assertion here is about the SHIPPED bundle behaving for a
 * real visitor: the filter row is visible, each cooking method returns actual
 * recipes, the opt-in starter pack appears for an existing install and adds
 * without overwriting or duplicating, a deleted starter recipe stays deleted,
 * Home still produces an explainable Easiest pick, and the seed constant cannot
 * be mutated through ordinary use.
 */

const APP_URL = 'https://shinyamadasan.github.io/Meal-Prep/';

test.use({ viewport: { width: 1280, height: 1700 } });

async function loadLiveApp(page) {
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__cmProdBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__cmProdBootstrapped', '1');
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

async function cook(page) {
  await page.evaluate(() => showTab('recipes'));
  await page.waitForTimeout(600);
}

const chip = (label) => `#recipe-quick-filters .rq-chip:has-text("${label}")`;

const names = (page) =>
  page.$$eval('#recipes-grid .recipe-title', (els) => els.map((e) => e.textContent.trim()));

/** Turn the live install into a pre-wave one: only the original 26 recipes. */
async function makeExistingInstall(page, opts) {
  await page.evaluate((o) => {
    localStorage.setItem('mealPrepInitialized', '1');
    AppState.recipes = JSON.parse(JSON.stringify(
      sampleRecipes.filter((r) => Number(r.id) <= 26)));
    (o.extraRecipes || []).forEach((r) => AppState.recipes.push(r));
    AppState.deletions = AppState.deletions || {};
    (o.deleted || []).forEach((id) => {
      writeTombstone('recipes', id, new Date().toISOString());
    });
    saveData();
    showTab('recipes');
    renderRecipes();
  }, opts || {});
  await page.waitForTimeout(600);
}

// ── The shipped bundle is the reviewed one ───────────────────────────────────

test('the deployed build serves the cooking-method discovery code', async ({ page }) => {
  await loadLiveApp(page);
  const present = await page.evaluate(() => ({
    familyMap: typeof APPLIANCE_FAMILY !== 'undefined',
    packIds: typeof STARTER_PACK_IDS !== 'undefined' && STARTER_PACK_IDS.length,
    candidates: typeof starterPackCandidates === 'function',
    addPack: typeof addStarterPackRecipes === 'function',
    cloneSeed: typeof cloneSeedRecipes === 'function',
    renderPrompt: typeof renderStarterPackPrompt === 'function',
    recipeCount: sampleRecipes.length
  }));
  expect(present.familyMap).toBe(true);
  expect(present.packIds).toBe(14);
  expect(present.candidates).toBe(true);
  expect(present.addPack).toBe(true);
  expect(present.cloneSeed).toBe(true);
  expect(present.renderPrompt).toBe(true);
  expect(present.recipeCount).toBe(40);
});

// ── Cook visibly exposes every filter ────────────────────────────────────────

test('Cook visibly shows Lowest effort, Rice cooker, Oven, Instant Pot, No-cook and Pan',
  async ({ page }) => {
    await loadLiveApp(page);
    await cook(page);

    await expect(page.locator('#recipe-quick-filters')).toBeVisible();
    for (const label of ['All', 'Lowest effort', 'Rice cooker', 'Oven',
                         'Instant Pot', 'No-cook', 'Pan']) {
      await expect(page.locator(chip(label)).first(), label).toBeVisible();
    }

    // Nothing hidden behind navigation, a modal, or a collapsed container.
    const buried = await page.evaluate(() => {
      let el = document.getElementById('recipe-quick-filters');
      while (el && el !== document.body) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return true;
        if (el.tagName === 'DETAILS' && !el.open) return true;
        el = el.parentElement;
      }
      return false;
    });
    expect(buried).toBe(false);
  });

// ── Each cooking method returns real recipes ─────────────────────────────────

const METHODS = [
  { label: 'Rice cooker', count: 4, slugs: ['rice-cooker', 'rice-cooker-steamer'] },
  { label: 'Oven', count: 4, slugs: ['oven'] },
  { label: 'Instant Pot', count: 3, slugs: ['instant-pot', 'pressure-cooker'] },
  { label: 'No-cook', count: 3, slugs: ['no-cook'] }
];

for (const m of METHODS) {
  test(`${m.label} returns actual recipes on the deployed site`, async ({ page }) => {
    await loadLiveApp(page);
    await cook(page);

    const c = page.locator(chip(m.label)).first();
    await expect(c).not.toHaveClass(/is-empty/);
    expect(Number(await c.locator('.rq-count').innerText())).toBe(m.count);

    await c.click();
    await page.waitForTimeout(400);
    const shown = await names(page);
    expect(shown).toHaveLength(m.count);

    // Nothing shown that does not declare one of this chip's slugs.
    const bad = await page.evaluate(({ shown, slugs }) => shown.filter((n) => {
      const r = AppState.recipes.find((x) => x.name === n);
      return !r || !r.equipment.some((e) => slugs.includes(e));
    }), { shown, slugs: m.slugs });
    expect(bad).toEqual([]);
  });
}

test('Lowest effort orders genuinely low-work options first', async ({ page }) => {
  await loadLiveApp(page);
  await cook(page);
  await page.locator(chip('Lowest effort')).click();
  await page.waitForTimeout(400);

  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#recipes-grid .recipe-title')).map((e) => {
      const r = AppState.recipes.find((x) => x.name === e.textContent.trim());
      return { name: r.name, rank: recipeEffortScore(r), active: r.activeTime,
               total: recipeTotalMinutes(r) };
    }));
  expect(rows.length).toBeGreaterThan(3);

  // Effort rank never goes backwards; inside a tier hands-on minutes never drop.
  for (let i = 1; i < rows.length; i++) {
    expect(rows[i].rank, rows[i].name).toBeGreaterThanOrEqual(rows[i - 1].rank);
    if (rows[i].rank === rows[i - 1].rank) {
      expect(rows[i].active, rows[i].name).toBeGreaterThanOrEqual(rows[i - 1].active);
    }
  }
  // And it is demonstrably NOT ordered by total clock time.
  expect(rows.some((r, i) => i > 0 && r.total < rows[i - 1].total)).toBe(true);
});

// ── The opt-in starter pack, end to end on the live build ────────────────────

test('an existing install sees the starter-pack prompt and Add populates it', async ({ page }) => {
  await loadLiveApp(page);

  const mine = {
    id: 'prod-own-1', name: 'My Own Prod Recipe', category: 'Main Dish',
    baseServings: 2, currentServings: 2, basePrepTime: 5, baseCookTime: 5,
    fridgeLife: 2, freezerLife: 0, instructions: 'Mine.',
    baseIngredients: [{ name: 'Thing', baseQuantity: 1, unit: 'g', category: 'Protein' }],
    nutritionPerServing: { calories: 100, protein: 5, carbs: 5, fat: 5, fiber: 0, sodium: 10 }
  };
  await makeExistingInstall(page, { extraRecipes: [mine] });

  // The prompt is offered, inline and non-blocking.
  const prompt = page.locator('#starter-pack-prompt');
  await expect(prompt).toBeVisible();
  await expect(prompt).toContainText('Low-effort starter recipes');
  await expect(page.locator('.sp-add')).toBeVisible();
  expect(await page.evaluate(() =>
    document.getElementById('starter-pack-prompt').closest('.modal') !== null)).toBe(false);

  const mineBefore = await page.evaluate(() =>
    JSON.stringify(AppState.recipes.find((r) => r.id === 'prod-own-1')));

  await page.click('.sp-add');
  await page.waitForTimeout(1200);

  const after = await page.evaluate(() => ({
    total: AppState.recipes.length,
    ids: AppState.recipes.map((r) => String(r.id)),
    mine: JSON.stringify(AppState.recipes.find((r) => r.id === 'prod-own-1')),
    stored: JSON.parse(localStorage.getItem('mealPrepAppData')).recipes.length
  }));

  expect(after.total).toBe(41);                    // 26 + 1 own + 14
  expect(after.mine).toBe(mineBefore);             // untouched
  for (let id = 27; id <= 40; id++) expect(after.ids).toContain(String(id));
  expect(after.stored).toBe(41);                   // persisted through saveData()

  // The four filters are now populated on the live build.
  const counts = await page.evaluate(() => {
    const by = {};
    document.querySelectorAll('#recipe-quick-filters .rq-chip').forEach((c) => {
      const label = c.textContent.replace(/\d+$/, '').replace(/^[^\w]+/, '').trim();
      by[label] = Number(c.querySelector('.rq-count').textContent);
    });
    return by;
  });
  expect(counts['Rice cooker']).toBe(4);
  expect(counts['Oven']).toBe(4);
  expect(counts['Instant Pot']).toBe(3);
  expect(counts['No-cook']).toBe(3);
});

test('repeated Add and a reload do not duplicate the starter recipes', async ({ page }) => {
  await loadLiveApp(page);
  await makeExistingInstall(page, {});

  await page.click('.sp-add');
  await page.waitForTimeout(1000);

  // Drive the handler directly — the guard must live in the function.
  await page.evaluate(() => { addStarterPackRecipes(); addStarterPackRecipes(); });
  await page.evaluate(() => addStarterPackRecipes());
  await page.waitForTimeout(600);

  const before = await page.evaluate(() => AppState.recipes.map((r) => String(r.id)));
  expect(before).toHaveLength(40);
  expect(new Set(before).size).toBe(40);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    'typeof AppState !== "undefined" && Array.isArray(AppState.recipes)', null, { timeout: 45000 });
  await page.waitForTimeout(3000);

  const afterReload = await page.evaluate(() => AppState.recipes.map((r) => String(r.id)));
  expect(afterReload).toHaveLength(40);
  expect(new Set(afterReload).size).toBe(40);

  // Nothing left to offer, so the prompt is gone.
  await cook(page);
  expect(await page.evaluate(() => starterPackCandidates().length)).toBe(0);
  expect(await page.evaluate(() =>
    document.getElementById('starter-pack-prompt').classList.contains('hidden'))).toBe(true);
});

test('a tombstoned starter recipe is not re-added on the deployed site', async ({ page }) => {
  await loadLiveApp(page);
  await makeExistingInstall(page, { deleted: [29, 34, 39] });

  const offered = await page.evaluate(() => starterPackCandidates().map((r) => Number(r.id)));
  expect(offered).toHaveLength(11);
  expect(offered).not.toContain(29);
  expect(offered).not.toContain(34);
  expect(offered).not.toContain(39);

  await page.click('.sp-add');
  await page.waitForTimeout(1000);

  const ids = await page.evaluate(() => AppState.recipes.map((r) => String(r.id)));
  expect(ids).toHaveLength(37);
  expect(ids).not.toContain('29');
  expect(ids).not.toContain('34');
  expect(ids).not.toContain('39');

  // The tombstone map is read, never rewritten.
  expect(await page.evaluate(() => Object.keys(AppState.deletions.recipes || {}).sort()))
    .toEqual(['29', '34', '39']);
});

// ── Home ─────────────────────────────────────────────────────────────────────

test('Home produces a meaningful Easiest recommendation with reason chips', async ({ page }) => {
  await loadLiveApp(page);
  await page.evaluate(() => showTab('dashboard'));
  await page.waitForTimeout(800);

  const pick = await page.evaluate(() => {
    const p = getWhatShouldWeEatSuggestions().find((x) => x.label === 'Easiest');
    return p ? { name: p.name, reasons: p.reasons } : null;
  });
  expect(pick).toBeTruthy();
  expect(pick.reasons.length).toBeGreaterThan(0);
  expect(pick.reasons.join(' · ')).toMatch(/Rice cooker|Oven|Instant Pot|Pressure cooker|Pan|No cook/);
  expect(pick.reasons.join(' · ')).toMatch(/min active/);

  // It renders, with chips, and is honestly easy.
  const row = page.locator('.wse-row', { hasText: 'Easiest' });
  await expect(row).toBeVisible();
  expect((await row.locator('.wse-chip').allInnerTexts()).length).toBeGreaterThan(0);
  expect(await page.evaluate((n) =>
    recipeEffortScore(AppState.recipes.find((r) => r.name === n)) <= 2, pick.name)).toBe(true);

  // No competing "low effort meals" card was added.
  const home = (await page.locator('#dashboard').innerText()).toLowerCase();
  expect(home).toContain('what should we eat');
  expect(home).not.toContain('low effort meals');
});

test('existing What Should We Eat behaviour is intact on the deployed site', async ({ page }) => {
  await loadLiveApp(page);

  const result = await page.evaluate(() => {
    const daysAgo = (d) => { const t = new Date(); t.setDate(t.getDate() - d);
      return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' +
             String(t.getDate()).padStart(2, '0'); };
    // Ready food must still outrank cooking, and expired food must never appear.
    AppState.cookedMeals = [
      { id: 'ok', name: 'Ready Adobo Batch', cookedDate: daysAgo(1), storage: 'fridge',
        fridgeLife: 4, freezerLife: 60, portionsRemaining: 2 },
      { id: 'bad', name: 'Very Expired Batch', cookedDate: daysAgo(30), storage: 'fridge',
        fridgeLife: 4, freezerLife: 60, portionsRemaining: 3 }
    ];
    AppState.cookHistory = [];
    const picks = getWhatShouldWeEatSuggestions();
    return { first: picks[0], all: picks.map((p) => p.name), keys: picks.map((p) => p.key) };
  });

  expect(result.keys[0]).toBe('eat-first');
  expect(result.first.name).toBe('Ready Adobo Batch');
  expect(result.first.reasons).toContain('Ready now');
  expect(result.all).not.toContain('Very Expired Batch');
});

// ── Seed isolation on the shipped bundle ─────────────────────────────────────

test('a fresh install does not share recipe objects with the seed constant', async ({ page }) => {
  await loadLiveApp(page);

  const result = await page.evaluate(() => {
    const shared = AppState.recipes.filter((r) =>
      r === sampleRecipes.find((s) => String(s.id) === String(r.id))).map((r) => r.id);

    const seed = sampleRecipes.find((r) => Number(r.id) === 27);
    const before = JSON.stringify(seed);
    toggleFavorite('27');
    updateServingSize('27', 8);
    normalizeRecipes(AppState.recipes);
    const live = AppState.recipes.find((r) => Number(r.id) === 27);
    live.name = 'Mutated In Production Smoke';
    live.baseIngredients[0].name = 'Mutated Ingredient';
    live.nutritionPerServing.calories = 9999;

    return { shared, seedUnchanged: JSON.stringify(seed) === before, seedName: seed.name };
  });

  expect(result.shared).toEqual([]);
  expect(result.seedUnchanged).toBe(true);
  expect(result.seedName).toBe('Rice Cooker Chicken & Rice');
});

// ── Mobile and errors ────────────────────────────────────────────────────────

test('no horizontal overflow on a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadLiveApp(page);
  await cook(page);
  await expect(page.locator('#recipe-quick-filters')).toBeVisible();

  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    body: document.body.scrollWidth <= document.body.clientWidth + 1
  }));
  expect(overflow.doc).toBe(true);
  expect(overflow.body).toBe(true);

  // Tapping through the row keeps it that way.
  for (const label of ['Lowest effort', 'Rice cooker', 'Oven']) {
    const c = page.locator(chip(label)).first();
    await c.scrollIntoViewIfNeeded();
    await c.click();
    await page.waitForTimeout(300);
    expect(await page.evaluate(() =>
      document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1),
    `overflow after ${label}`).toBe(true);
    await c.click();
    await page.waitForTimeout(200);
  }
});

test('no page or console errors through the deployed flow', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await loadLiveApp(page);
  await cook(page);
  for (const label of ['Lowest effort', 'Rice cooker', 'Oven', 'Instant Pot',
                       'No-cook', 'Pan', 'All']) {
    await page.locator(chip(label)).first().click();
    await page.waitForTimeout(300);
  }
  await makeExistingInstall(page, {});
  await page.click('.sp-add');
  await page.waitForTimeout(1000);
  await page.evaluate(() => showTab('dashboard'));
  await page.waitForTimeout(600);

  // `requestStorageAccess: Permission denied` comes from the real Firebase SDK
  // hitting Chromium's storage partitioning in a headless third-party context.
  // It is environmental, not app code, and does not occur in a normal browser.
  // Same filter every other production smoke in this repo uses.
  const real = errors.filter((e) =>
    !/net::ERR|Failed to load resource|favicon|requestStorageAccess|firebase|firestore|installations|app-check/i.test(e));
  expect(real).toEqual([]);
});
