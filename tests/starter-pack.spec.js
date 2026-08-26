const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');
const { waitForRestored } = require('./app-ready');

/**
 * Low-effort starter pack — opt-in, additive delivery for EXISTING installs.
 *
 * The product rules this file exists to prove:
 *   The first-run gate is not weakened. Nothing is ever added automatically.
 *   Only genuinely absent starter recipes are added.
 *   A user's own recipes, and their edits to a starter recipe already present,
 *     are never touched — presence on an id is a permanent skip, not a merge.
 *   A starter recipe the user DELETED is not resurrected: AppState.deletions
 *     is the existing synced tombstone map and it is honoured.
 *   Tapping twice, or reloading, never duplicates anything.
 *   The prompt retires itself once nothing is eligible.
 *   No new top-level state, persisted or otherwise.
 */

const ORIGINAL_IDS = Array.from({ length: 26 }, (_, i) => i + 1);
const PACK_IDS = Array.from({ length: 14 }, (_, i) => i + 27);

async function boot(page) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  // addInitScript runs again on reload; guard the clear so a reload exercises
  // the real restore path rather than starting from a blank slate.
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__harnessBooted')) return;
      localStorage.clear();
      localStorage.setItem('__harnessBooted', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
  });
  await page.goto(pathToFileURL(path.resolve('index.html')).href, { waitUntil: 'domcontentloaded' });
  await settled(page);
}

/**
 * Wait for init to ACTUALLY finish rather than for a fixed number of milliseconds.
 * A fixed wait fires mid-initialisation on a slow runner, and the test then reads or
 * mutates state that init subsequently overwrites. Condition, not clock.
 */
async function settled(page) {
  await page.waitForFunction(
    () => typeof AppState !== 'undefined' && Array.isArray(AppState.recipes) &&
          AppState.recipes.length > 0 && typeof saveData === 'function',
    null, { timeout: 30000 });
  await page.waitForTimeout(300);
}

/**
 * Put the app into the state a real pre-D-061 install is in: the original 26
 * recipes saved to storage, the first-run flag already burned, and whatever
 * extra recipes / edits / deletions the scenario needs.
 */
async function existingInstall(page, opts) {
  await boot(page);
  await page.evaluate((o) => {
    localStorage.setItem('mealPrepInitialized', '1');   // not a first run any more
    AppState.recipes = JSON.parse(JSON.stringify(
      sampleRecipes.filter((r) => Number(r.id) <= 26)));
    (o.extraRecipes || []).forEach((r) => AppState.recipes.push(r));
    (o.alsoPresent || []).forEach((id) => {
      const src = sampleRecipes.find((s) => Number(s.id) === id);
      AppState.recipes.push(JSON.parse(JSON.stringify(src)));
    });
    if (o.edit) {
      const r = AppState.recipes.find((x) => Number(x.id) === o.edit.id);
      Object.assign(r, o.edit.changes);
    }
    AppState.deletions = AppState.deletions || {};
    (o.deleted || []).forEach((id) => {
      writeTombstone('recipes', id, new Date().toISOString());
    });
    saveData();
    showTab('recipes');
    renderRecipes();
  }, opts || {});
  await page.waitForTimeout(400);
}

const ids = (page) => page.evaluate(() =>
  AppState.recipes.map((r) => String(r.id)).sort((a, b) => Number(a) - Number(b)));

const promptText = (page) => page.evaluate(() => {
  const el = document.getElementById('starter-pack-prompt');
  return el.classList.contains('hidden') ? null : el.innerText.replace(/\s+/g, ' ').trim();
});

// ── The prompt ───────────────────────────────────────────────────────────────

test('an existing 26-recipe install is offered the whole pack', async ({ page }) => {
  await existingInstall(page, {});

  expect(await page.evaluate(() => starterPackCandidates().length)).toBe(14);
  const text = await promptText(page);
  expect(text).toContain('Low-effort starter recipes');
  expect(text).toContain('Rice cooker, oven, Instant Pot and no-cook ideas are available.');
  await expect(page.locator('.sp-add')).toBeVisible();

  // Non-blocking: it is inline in the Cook page, not a modal over it.
  const blocking = await page.evaluate(() => {
    const el = document.getElementById('starter-pack-prompt');
    return el.closest('.modal') !== null || getComputedStyle(el).position === 'fixed';
  });
  expect(blocking).toBe(false);
});

test('a partial install is offered only what it is missing, with a count', async ({ page }) => {
  // Already has 4 of the pack.
  await existingInstall(page, { alsoPresent: [27, 28, 31, 38] });

  expect(await page.evaluate(() => starterPackCandidates().length)).toBe(10);
  expect(await promptText(page)).toContain('10 low-effort starter recipes available.');

  await page.click('.sp-add');
  await page.waitForTimeout(500);
  expect(await ids(page)).toEqual(ORIGINAL_IDS.concat(PACK_IDS).map(String));
});

test('the prompt is absent on a fresh install, which seeds through the first-run path', async ({ page }) => {
  await boot(page);   // no mealPrepInitialized → the existing ensureStarterRecipes() path
  await page.evaluate(() => showTab('recipes'));
  await page.waitForTimeout(400);

  expect(await ids(page)).toEqual(ORIGINAL_IDS.concat(PACK_IDS).map(String));
  expect(await page.evaluate(() => starterPackCandidates().length)).toBe(0);
  expect(await promptText(page)).toBeNull();
});

test('the prompt retires itself once nothing is eligible', async ({ page }) => {
  await existingInstall(page, {});
  expect(await promptText(page)).toContain('Low-effort starter recipes');

  await page.click('.sp-add');
  await page.waitForTimeout(500);

  // Immediately after: a confirmation, no button.
  expect(await promptText(page)).toContain('14 recipes added');
  await expect(page.locator('.sp-add')).toHaveCount(0);

  // And on the next render it is gone entirely.
  await page.evaluate(() => renderRecipes());
  await page.waitForTimeout(300);
  expect(await promptText(page)).toBeNull();
});

// ── Adding ───────────────────────────────────────────────────────────────────

test('adding brings the install to the full 40 and populates every method filter',
  async ({ page }) => {
    await existingInstall(page, {});
    await page.click('.sp-add');
    await page.waitForTimeout(600);

    expect(await ids(page)).toEqual(ORIGINAL_IDS.concat(PACK_IDS).map(String));

    const counts = await page.evaluate(() => {
      const by = {};
      document.querySelectorAll('#recipe-quick-filters .rq-chip').forEach((c) => {
        by[c.textContent.replace(/\d+$/, '').replace(/^[^\w]+/, '').trim()] =
          Number(c.querySelector('.rq-count').textContent);
      });
      return by;
    });
    expect(counts['Rice cooker']).toBe(4);
    expect(counts['Oven']).toBe(4);
    expect(counts['Instant Pot']).toBe(3);
    expect(counts['No-cook']).toBe(3);
    expect(counts['Rice + steamer']).toBe(2);

    // And they actually return those recipes.
    for (const [label, n] of [['Rice cooker', 4], ['Oven', 4], ['Instant Pot', 3], ['No-cook', 3]]) {
      await page.locator(`#recipe-quick-filters .rq-chip:has-text("${label}")`).first().click();
      await page.waitForTimeout(200);
      await expect(page.locator('#recipes-grid .recipe-card')).toHaveCount(n);
      await page.locator(`#recipe-quick-filters .rq-chip:has-text("${label}")`).first().click();
      await page.waitForTimeout(150);
    }
  });

test('the added recipes persist through the normal save path', async ({ page }) => {
  await existingInstall(page, {});
  await page.click('.sp-add');
  await page.waitForTimeout(600);

  // saveData() writes localStorage synchronously; the pack must be in the payload.
  const stored = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('mealPrepAppData'));
    return d.recipes.map((r) => String(r.id)).sort((a, b) => Number(a) - Number(b));
  });
  expect(stored).toEqual(ORIGINAL_IDS.concat(PACK_IDS).map(String));

  // Every added recipe carries updatedAt — what tombstone LWW and the
  // local-vs-cloud merge both read.
  const unstamped = await page.evaluate((pack) => AppState.recipes
    .filter((r) => pack.includes(Number(r.id)))
    .filter((r) => !r.updatedAt).map((r) => r.id), PACK_IDS);
  expect(unstamped).toEqual([]);

  // Survives a reload with no duplication.
  await page.reload({ waitUntil: 'domcontentloaded' });
  // settled() fires on ANY non-empty recipe list; the restored document is only proven
  // once every id the previous page saved is back. The assertion still owns the exact
  // set and the no-duplication claim.
  await waitForRestored(page, (want) =>
    want.every((id) => AppState.recipes.some((r) => String(r.id) === id)),
    ORIGINAL_IDS.concat(PACK_IDS).map(String));
  expect(await ids(page)).toEqual(ORIGINAL_IDS.concat(PACK_IDS).map(String));
  expect(await promptText(page)).toBeNull();
});

// ── Not touching what is already there ───────────────────────────────────────

test("a user's own recipes are untouched", async ({ page }) => {
  const mine = {
    id: 'my-own-1', name: 'My Secret Adobo', category: 'Main Dish',
    baseServings: 2, currentServings: 2, basePrepTime: 5, baseCookTime: 5,
    fridgeLife: 2, freezerLife: 0, instructions: 'Mine.',
    baseIngredients: [{ name: 'Thing', baseQuantity: 1, unit: 'g', category: 'Protein' }],
    nutritionPerServing: { calories: 100, protein: 5, carbs: 5, fat: 5, fiber: 0, sodium: 10 }
  };
  await existingInstall(page, { extraRecipes: [mine] });

  const before = await page.evaluate(() =>
    JSON.stringify(AppState.recipes.find((r) => r.id === 'my-own-1')));
  await page.click('.sp-add');
  await page.waitForTimeout(600);
  const after = await page.evaluate(() =>
    JSON.stringify(AppState.recipes.find((r) => r.id === 'my-own-1')));

  expect(after).toBe(before);
  expect(await page.evaluate(() => AppState.recipes.length)).toBe(41); // 26 + 1 + 14
});

test('an edited starter recipe already present is never overwritten', async ({ page }) => {
  await existingInstall(page, {
    alsoPresent: [31],
    edit: { id: 31, changes: { name: 'My Renamed Oven Chicken', baseServings: 9,
                               instructions: 'My own way.', effort: 'normal' } }
  });

  expect(await page.evaluate(() => starterPackCandidates().map((r) => r.id)))
    .not.toContain(31);

  await page.click('.sp-add');
  await page.waitForTimeout(600);

  const r31 = await page.evaluate(() =>
    AppState.recipes.filter((r) => Number(r.id) === 31));
  expect(r31).toHaveLength(1);                       // not duplicated
  expect(r31[0].name).toBe('My Renamed Oven Chicken'); // not reverted
  expect(r31[0].baseServings).toBe(9);
  expect(r31[0].instructions).toBe('My own way.');
  expect(r31[0].effort).toBe('normal');
});

// ── Deletion intent ──────────────────────────────────────────────────────────

test('a deleted starter recipe is not resurrected', async ({ page }) => {
  // AppState.deletions is the existing synced tombstone map; `recipes` is one of
  // the TOMBSTONE_KEYS, so this is exactly what a real delete leaves behind.
  await existingInstall(page, { deleted: [29, 34, 39] });

  const offered = await page.evaluate(() => starterPackCandidates().map((r) => Number(r.id)));
  expect(offered).not.toContain(29);
  expect(offered).not.toContain(34);
  expect(offered).not.toContain(39);
  expect(offered).toHaveLength(11);
  expect(await promptText(page)).toContain('11 low-effort starter recipes available.');

  await page.click('.sp-add');
  await page.waitForTimeout(600);

  const have = await ids(page);
  expect(have).not.toContain('29');
  expect(have).not.toContain('34');
  expect(have).not.toContain('39');
  expect(have).toHaveLength(37); // 26 + 11

  // The tombstones themselves are left exactly as they were — the pack reads
  // them, never writes them.
  const dels = await page.evaluate(() => Object.keys(AppState.deletions.recipes || {}).sort());
  expect(dels).toEqual(['29', '34', '39']);
});

test('deleting a starter recipe after adding it keeps it gone on the next offer', async ({ page }) => {
  await existingInstall(page, {});
  await page.click('.sp-add');
  await page.waitForTimeout(600);
  expect(await promptText(page)).toContain('14 recipes added');

  // Now delete one the way the app does, then re-render.
  await page.evaluate(() => {
    AppState.recipes = AppState.recipes.filter((r) => Number(r.id) !== 35);
    writeTombstone('recipes', '35', new Date().toISOString());
    saveData();
    renderRecipes();
  });
  await page.waitForTimeout(400);

  // It is missing, but it was deleted on purpose — so nothing is offered.
  expect(await page.evaluate(() => starterPackCandidates().length)).toBe(0);
  expect(await promptText(page)).toBeNull();
});

// ── Duplicate protection ─────────────────────────────────────────────────────

test('tapping Add repeatedly never duplicates', async ({ page }) => {
  await existingInstall(page, {});
  await page.click('.sp-add');
  await page.waitForTimeout(500);

  // The button is gone, so drive the handler directly — the guard must be in the
  // function, not only in the UI.
  await page.evaluate(() => { addStarterPackRecipes(); addStarterPackRecipes(); });
  await page.evaluate(() => addStarterPackRecipes());
  await page.waitForTimeout(400);

  const all = await ids(page);
  expect(all).toEqual(ORIGINAL_IDS.concat(PACK_IDS).map(String));
  expect(new Set(all).size).toBe(all.length);
});

test('the added copies are independent of the sampleRecipes constant', async ({ page }) => {
  await existingInstall(page, {});
  await page.click('.sp-add');
  await page.waitForTimeout(500);

  const leaked = await page.evaluate(() => {
    const added = AppState.recipes.find((r) => Number(r.id) === 27);
    added.name = 'Mutated By User';
    added.baseIngredients[0].name = 'Mutated Ingredient';
    const seed = sampleRecipes.find((r) => Number(r.id) === 27);
    return { seedName: seed.name, seedIng: seed.baseIngredients[0].name };
  });
  expect(leaked.seedName).toBe('Rice Cooker Chicken & Rice');
  expect(leaked.seedIng).toBe('Chicken Thigh');
});

// ── No new state ─────────────────────────────────────────────────────────────

test('the starter pack introduces no new top-level state', async ({ page }) => {
  await existingInstall(page, {});

  const before = await page.evaluate(() => ({
    appState: Object.keys(AppState).sort(),
    persisted: Object.keys(JSON.parse(localStorage.getItem('mealPrepAppData'))).sort(),
    storageKeys: Object.keys(localStorage).sort()
  }));

  await page.click('.sp-add');
  await page.waitForTimeout(600);

  const after = await page.evaluate(() => ({
    appState: Object.keys(AppState).sort(),
    persisted: Object.keys(JSON.parse(localStorage.getItem('mealPrepAppData'))).sort(),
    storageKeys: Object.keys(localStorage).sort()
  }));

  expect(after.appState).toEqual(before.appState);
  expect(after.persisted).toEqual(before.persisted);
  expect(after.storageKeys).toEqual(before.storageKeys);

  // Nothing pack-shaped on AppState, and no "pack seen/dismissed" flag anywhere.
  expect(after.appState.filter((k) => /starter|pack/i.test(k))).toEqual([]);
  expect(after.storageKeys.filter((k) => /starter|pack/i.test(k))).toEqual([]);
});

test('no console errors through the whole opt-in flow', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await existingInstall(page, {});
  await page.click('.sp-add');
  await page.waitForTimeout(600);
  await page.evaluate(() => renderRecipes());
  await page.waitForTimeout(300);

  const real = errors.filter((e) => !/firebase|firestore|net::ERR|Failed to load resource/i.test(e));
  expect(real).toEqual([]);
});

// ── Mobile ───────────────────────────────────────────────────────────────────

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the prompt is usable on a phone and causes no page overflow', async ({ page }) => {
    await existingInstall(page, {});
    await expect(page.locator('.sp-card')).toBeVisible();

    const box = await page.locator('.sp-add').boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(32);

    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
      body: document.body.scrollWidth <= document.body.clientWidth + 1
    }));
    expect(overflow.doc).toBe(true);
    expect(overflow.body).toBe(true);

    await page.click('.sp-add');
    await page.waitForTimeout(600);
    expect(await ids(page)).toHaveLength(40);
  });
});

// ── Appliance-family friction regression ─────────────────────────────────────

test('instant-pot + pressure-cooker is one appliance, not two', async ({ page }) => {
  await boot(page);

  const f = await page.evaluate(() => {
    const mk = (eq) => ({ equipment: eq });
    return {
      instantPotOnly: applianceFriction(mk(['instant-pot'])),
      pressureOnly: applianceFriction(mk(['pressure-cooker'])),
      bothLabels: applianceFriction(mk(['instant-pot', 'pressure-cooker'])),
      riceCookerOnly: applianceFriction(mk(['rice-cooker'])),
      steamerOnly: applianceFriction(mk(['rice-cooker-steamer'])),
      riceBothLabels: applianceFriction(mk(['rice-cooker', 'rice-cooker-steamer'])),
      // Genuinely two different appliances still pays the juggling penalty.
      panPlusOven: applianceFriction(mk(['pan', 'oven'])),
      pressurePlusOven: applianceFriction(mk(['pressure-cooker', 'oven'])),
      steamerPlusOven: applianceFriction(mk(['rice-cooker-steamer', 'oven'])),
      unstated: applianceFriction(mk([]))
    };
  });

  // The fix: two names for one pot must not cost more than one name for it.
  expect(f.bothLabels).toBe(f.instantPotOnly);
  expect(f.bothLabels).toBe(2);
  expect(f.pressureOnly).toBe(2);

  // The existing rice-cooker family treatment is unchanged.
  expect(f.riceCookerOnly).toBe(2);
  expect(f.steamerOnly).toBe(2);
  expect(f.riceBothLabels).toBe(2);

  // Two real appliances still cost extra: min(pan 4, oven 3) = 3, +1 = 4.
  expect(f.panPlusOven).toBe(4);
  // min(instant-pot 2, oven 3) = 2, +1 = 3.
  expect(f.pressurePlusOven).toBe(3);
  // min(rice-cooker 2, oven 3) = 2, +1 = 3.
  expect(f.steamerPlusOven).toBe(3);

  expect(f.unstated).toBe(2); // neutral, unchanged
});

test('the friction fix changes ranking only for the equivalent-label case', async ({ page }) => {
  await boot(page);
  // A recipe declaring both Instant Pot labels must now tie with one declaring
  // just one of them, all else equal — previously it lost by a point.
  const parts = await page.evaluate(() => {
    const base = {
      category: 'Main Dish', baseServings: 2, currentServings: 2,
      basePrepTime: 5, baseCookTime: 10, fridgeLife: 3, freezerLife: 0,
      instructions: 'x', effort: 'low', activeTime: 10,
      mealBalance: { protein: true, vegetables: true, carb: true }, tags: [],
      baseIngredients: [{ name: 'Thing', baseQuantity: 1, unit: 'g', category: 'Protein' }],
      nutritionPerServing: { calories: 100, protein: 5, carbs: 5, fat: 5, fiber: 0, sodium: 10 }
    };
    AppState.pantry = [];
    AppState.cookHistory = [];
    AppState.cookedMeals = [];
    AppState.recipes = normalizeRecipes([
      Object.assign({ id: 'one', name: 'One Label', equipment: ['instant-pot'] }, base),
      Object.assign({ id: 'two', name: 'Two Labels', equipment: ['instant-pot', 'pressure-cooker'] }, base)
    ]);
    const by = {};
    eatCookCandidates().forEach((c) => { by[c.recipe.name] = c.parts.appliance; });
    return by;
  });
  expect(parts['Two Labels']).toBe(parts['One Label']);
});
