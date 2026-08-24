const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

/**
 * Cook-method discovery wave.
 *
 * The product rules this file exists to prove:
 *   The quick-filter row is VISIBLE on Cook without any navigation, scrolling
 *     into a panel, or opening a modal.
 *   "Lowest effort" ranks by how much WORK a recipe is, never by total clock
 *     time — unattended cooking is not effort.
 *   Cooking method is a presentation grouping over recipe.equipment: one
 *     "Rice cooker" chip covers rice-cooker AND rice-cooker-steamer, one
 *     "Instant Pot" chip covers instant-pot AND pressure-cooker.
 *   A recipe NEVER appears under a cooking method its metadata does not
 *     support.
 *   Legacy recipes with no metadata at all still render and stay browseable.
 *   Nothing new is persisted.
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

const MAKE = `(o) => Object.assign({
  category: 'Main Dish', baseServings: 2, currentServings: 2,
  basePrepTime: 5, baseCookTime: 10, fridgeLife: 3, freezerLife: 0,
  estimatedCost: 100, instructions: 'Cook it.',
  baseIngredients: [{ name: 'Thing', baseQuantity: 100, unit: 'g', category: 'Protein' }],
  nutritionPerServing: { calories: 300, protein: 20, carbs: 20, fat: 10, fiber: 2, sodium: 300 },
  equipment: [], effort: null, activeTime: null,
  mealBalance: { protein: false, vegetables: false, carb: false }, tags: []
}, o)`;

async function seed(page, recipes) {
  await page.evaluate(({ list, make }) => {
    const M = eval(make);
    AppState.recipes = list.map(M);
    normalizeRecipes(AppState.recipes);
    recipeQuickFilter = '';
    showTab('recipes');
    renderRecipes();
  }, { list: recipes, make: MAKE });
  await page.waitForTimeout(200);
}

async function gotoCook(page) {
  await page.evaluate(() => showTab('recipes'));
  await page.waitForTimeout(300);
}

const chip = (label) => `#recipe-quick-filters .rq-chip:has-text("${label}")`;

async function visibleNames(page) {
  return page.$$eval('#recipes-grid .recipe-title', (els) => els.map((e) => e.textContent.trim()));
}

// ── 1-3, 21. The row is visible on Cook, with the three headline chips ───────

test.describe('Cook exposes the quick filters', () => {
  test.use({ viewport: { width: 1280, height: 1600 } });

  test('shipped default data makes the filter row visible on Cook', async ({ page }) => {
    await loadLocalApp(page);
    await gotoCook(page);

    const row = page.locator('#recipe-quick-filters');
    await expect(row).toBeVisible();

    // Requirements 1, 2, 3 — the three the owner went looking for and could not find.
    await expect(page.locator(chip('Lowest effort'))).toBeVisible();
    await expect(page.locator(chip('Rice cooker')).first()).toBeVisible();
    await expect(page.locator(chip('Oven'))).toBeVisible();
    // And the rest of the cooking-method set.
    await expect(page.locator(chip('Instant Pot'))).toBeVisible();
    await expect(page.locator(chip('No-cook'))).toBeVisible();
    await expect(page.locator(chip('Pan'))).toBeVisible();
    await expect(page.locator(chip('All'))).toBeVisible();
  });

  test('the row sits above the grid and needs no interaction to reach', async ({ page }) => {
    await loadLocalApp(page);
    await gotoCook(page);
    const row = await page.locator('#recipe-quick-filters').boundingBox();
    const grid = await page.locator('#recipes-grid').boundingBox();
    expect(row.y).toBeLessThan(grid.y);
    // Not inside a <details>, modal, or collapsed container.
    const hidden = await page.evaluate(() => {
      let el = document.getElementById('recipe-quick-filters');
      while (el && el !== document.body) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return true;
        if (el.tagName === 'DETAILS' && !el.open) return true;
        el = el.parentElement;
      }
      return false;
    });
    expect(hidden).toBe(false);
  });

  test('All is active by default and reports the whole book', async ({ page }) => {
    await loadLocalApp(page);
    await gotoCook(page);
    const all = page.locator(chip('All'));
    await expect(all).toHaveAttribute('aria-pressed', 'true');
    const total = await page.evaluate(() => AppState.recipes.length);
    await expect(all.locator('.rq-count')).toHaveText(String(total));
  });
});

// ── 4-9, 15. Cooking-method grouping rules ───────────────────────────────────

test.describe('cooking method grouping', () => {
  test.use({ viewport: { width: 1280, height: 1600 } });

  const FLEET = [
    { id: 'rc', name: 'Rice Cooker Chicken', equipment: ['rice-cooker'], effort: 'very-low', activeTime: 5 },
    { id: 'rcs', name: 'Rice Plus Steamed Veg', equipment: ['rice-cooker-steamer'], effort: 'very-low', activeTime: 4 },
    { id: 'ov', name: 'Oven Roast Chicken', equipment: ['oven'], effort: 'low', activeTime: 10 },
    { id: 'ip', name: 'Instant Pot Adobo', equipment: ['instant-pot'], effort: 'low', activeTime: 8 },
    { id: 'pc', name: 'Pressure Cooker Bulalo', equipment: ['pressure-cooker'], effort: 'low', activeTime: 12 },
    { id: 'pn', name: 'Pan Sinangag', equipment: ['pan'], effort: 'normal', activeTime: 20 },
    { id: 'nc', name: 'No Cook Salad', equipment: ['no-cook'], effort: 'assembly', activeTime: 5 },
    { id: 'mw', name: 'Microwave Oatmeal', equipment: ['microwave'], effort: 'very-low', activeTime: 3 }
  ];

  test.beforeEach(async ({ page }) => {
    await loadLocalApp(page);
    await seed(page, FLEET);
  });

  test('4 + 5: Rice cooker matches rice-cooker AND rice-cooker-steamer', async ({ page }) => {
    await page.locator(chip('Rice cooker')).first().click();
    await page.waitForTimeout(200);
    const names = await visibleNames(page);
    expect(names.sort()).toEqual(['Rice Cooker Chicken', 'Rice Plus Steamed Veg']);
  });

  test('6: Oven matches only the oven recipe', async ({ page }) => {
    await page.locator(chip('Oven')).click();
    await page.waitForTimeout(200);
    expect(await visibleNames(page)).toEqual(['Oven Roast Chicken']);
  });

  test('7: Instant Pot grouping covers instant-pot AND pressure-cooker', async ({ page }) => {
    await page.locator(chip('Instant Pot')).click();
    await page.waitForTimeout(200);
    const names = await visibleNames(page);
    expect(names.sort()).toEqual(['Instant Pot Adobo', 'Pressure Cooker Bulalo']);
  });

  test('8: No-cook works', async ({ page }) => {
    await page.locator(chip('No-cook')).click();
    await page.waitForTimeout(200);
    expect(await visibleNames(page)).toEqual(['No Cook Salad']);
  });

  test('9: Pan works', async ({ page }) => {
    await page.locator(chip('Pan')).click();
    await page.waitForTimeout(200);
    expect(await visibleNames(page)).toEqual(['Pan Sinangag']);
  });

  test('the refinement chip still isolates rice-cooker-steamer only', async ({ page }) => {
    await page.locator(chip('Rice + steamer')).click();
    await page.waitForTimeout(200);
    expect(await visibleNames(page)).toEqual(['Rice Plus Steamed Veg']);
  });

  test('15: no recipe appears under a method its metadata does not support', async ({ page }) => {
    const allowed = {
      'Rice cooker': ['rice-cooker', 'rice-cooker-steamer'],
      'Oven': ['oven'],
      'Instant Pot': ['instant-pot', 'pressure-cooker'],
      'No-cook': ['no-cook'],
      'Pan': ['pan'],
      'Rice + steamer': ['rice-cooker-steamer']
    };
    for (const [label, slugs] of Object.entries(allowed)) {
      await page.locator(chip(label)).first().click();
      await page.waitForTimeout(150);
      const shown = await visibleNames(page);
      const bad = await page.evaluate(({ shown, slugs }) => shown.filter((n) => {
        const r = AppState.recipes.find((x) => x.name === n);
        return !r || !r.equipment.some((e) => slugs.includes(e));
      }), { shown, slugs });
      expect(bad, `${label} leaked recipes`).toEqual([]);
      await page.locator(chip(label)).first().click(); // clear
      await page.waitForTimeout(150);
    }
  });

  test('a microwave recipe surfaces under no cooking-method chip', async ({ page }) => {
    for (const label of ['Rice cooker', 'Oven', 'Instant Pot', 'No-cook', 'Pan']) {
      await page.locator(chip(label)).first().click();
      await page.waitForTimeout(150);
      expect(await visibleNames(page)).not.toContain('Microwave Oatmeal');
      await page.locator(chip(label)).first().click();
      await page.waitForTimeout(150);
    }
  });
});

// ── 10. Lowest effort is about WORK, not clock time ──────────────────────────

test.describe('Lowest effort', () => {
  test.use({ viewport: { width: 1280, height: 1600 } });

  test('10: 5 min active + 35 unattended outranks 20 min stood over a pan', async ({ page }) => {
    await loadLocalApp(page);
    await seed(page, [
      // Longest total time in the list, but you walk away from almost all of it.
      { id: 'walkaway', name: 'Walk Away Rice Cooker', equipment: ['rice-cooker'],
        effort: 'very-low', activeTime: 5, basePrepTime: 5, baseCookTime: 35,
        tags: ['minimal-cleanup'] },
      // Half the total time, but every minute of it is hands-on. Both clear the
      // Lowest-effort gate, so this test is about ORDER, not membership.
      { id: 'handson', name: 'Hands On Pan', equipment: ['pan'],
        effort: 'low', activeTime: 20, basePrepTime: 5, baseCookTime: 15 }
    ]);

    await page.locator(chip('Lowest effort')).click();
    await page.waitForTimeout(200);
    const names = await visibleNames(page);

    // Both qualify as low effort...
    expect(names.slice().sort()).toEqual(['Hands On Pan', 'Walk Away Rice Cooker']);
    // ...and the walk-away one is first even though it takes 40 min vs 20 total.
    expect(names[0]).toBe('Walk Away Rice Cooker');

    // Prove the ordering is NOT total time.
    const totals = await page.evaluate((n) => n.map((x) => {
      const r = AppState.recipes.find((y) => y.name === x);
      return recipeTotalMinutes(r);
    }), names);
    expect(totals[0]).toBeGreaterThan(totals[totals.length - 1]);
  });

  test('a normal-effort cook is excluded from Lowest effort', async ({ page }) => {
    await loadLocalApp(page);
    await seed(page, [
      { id: 'easy', name: 'Easy One', effort: 'very-low', activeTime: 4, equipment: ['rice-cooker'] },
      { id: 'hard', name: 'Hard One', effort: 'normal', activeTime: 40, equipment: ['pan'] }
    ]);
    await page.locator(chip('Lowest effort')).click();
    await page.waitForTimeout(200);
    expect(await visibleNames(page)).toEqual(['Easy One']);
  });

  test('ordering falls back through active time, both declared low', async ({ page }) => {
    await loadLocalApp(page);
    await seed(page, [
      { id: 'a', name: 'Low Twenty', effort: 'low', activeTime: 20, equipment: ['pan'] },
      { id: 'b', name: 'Low Three', effort: 'low', activeTime: 3, equipment: ['pan'] }
    ]);
    await page.locator(chip('Lowest effort')).click();
    await page.waitForTimeout(200);
    expect(await visibleNames(page)).toEqual(['Low Three', 'Low Twenty']);
  });

  test('Lowest effort agrees with the Home "Easiest" honesty gate', async ({ page }) => {
    await loadLocalApp(page);
    await seed(page, [{ id: 'x', name: 'Borderline', effort: 'low', activeTime: 12, equipment: ['oven'] }]);
    const agree = await page.evaluate(() => {
      const r = AppState.recipes[0];
      const chipMatch = quickFilterById('lowest-effort').match(r);
      const homeGate = recipeEffortScore(r) <= 2; // the gate in getWhatShouldWeEatSuggestions
      return chipMatch === homeGate;
    });
    expect(agree).toBe(true);
  });
});

// ── 11, 12, 13. Composition with existing filters, and legacy data ───────────

test.describe('composition and legacy data', () => {
  test.use({ viewport: { width: 1280, height: 1600 } });

  test('11: search still works on top of a quick filter', async ({ page }) => {
    await loadLocalApp(page);
    await seed(page, [
      { id: 'o1', name: 'Oven Chicken', equipment: ['oven'], effort: 'low', activeTime: 10 },
      { id: 'o2', name: 'Oven Fish', equipment: ['oven'], effort: 'low', activeTime: 10 },
      { id: 'p1', name: 'Pan Chicken', equipment: ['pan'], effort: 'normal', activeTime: 20 }
    ]);
    await page.locator(chip('Oven')).click();
    await page.waitForTimeout(200);
    expect((await visibleNames(page)).sort()).toEqual(['Oven Chicken', 'Oven Fish']);

    await page.fill('#recipe-search', 'chicken');
    await page.waitForTimeout(400);
    // Narrowed by BOTH — the pan chicken must not come back.
    expect(await visibleNames(page)).toEqual(['Oven Chicken']);
  });

  test('12: clearing the filter returns the normal list', async ({ page }) => {
    await loadLocalApp(page);
    await seed(page, [
      { id: 'o1', name: 'Oven Chicken', equipment: ['oven'], effort: 'low', activeTime: 10 },
      { id: 'p1', name: 'Pan Chicken', equipment: ['pan'], effort: 'normal', activeTime: 20 }
    ]);
    await page.locator(chip('Oven')).click();
    await page.waitForTimeout(200);
    expect(await visibleNames(page)).toHaveLength(1);

    // Via the All chip.
    await page.locator(chip('All')).click();
    await page.waitForTimeout(200);
    expect((await visibleNames(page)).sort()).toEqual(['Oven Chicken', 'Pan Chicken']);

    // And via tapping the active chip again.
    await page.locator(chip('Oven')).click();
    await page.waitForTimeout(200);
    expect(await visibleNames(page)).toHaveLength(1);
    await page.locator(chip('Oven')).click();
    await page.waitForTimeout(200);
    expect((await visibleNames(page)).sort()).toEqual(['Oven Chicken', 'Pan Chicken']);
  });

  test('13: legacy recipes with no metadata still render and stay browseable', async ({ page }) => {
    await loadLocalApp(page);
    await page.evaluate(() => {
      // A pre-metadata recipe: not even the optional keys exist.
      AppState.recipes = [{
        id: 'legacy', name: 'Ancient Recipe', category: 'Main Dish',
        baseServings: 2, currentServings: 2, basePrepTime: 10, baseCookTime: 20,
        fridgeLife: 3, freezerLife: 0, estimatedCost: 100, instructions: 'Old.',
        baseIngredients: [{ name: 'Thing', baseQuantity: 100, unit: 'g', category: 'Protein' }],
        nutritionPerServing: { calories: 300, protein: 20, carbs: 20, fat: 10, fiber: 2, sodium: 300 }
      }];
      normalizeRecipes(AppState.recipes);
      recipeQuickFilter = '';
      showTab('recipes');
      renderRecipes();
    });
    await page.waitForTimeout(300);

    expect(await visibleNames(page)).toEqual(['Ancient Recipe']);
    // It claims no cooking method, so it appears under none of them.
    for (const label of ['Rice cooker', 'Oven', 'Instant Pot', 'No-cook', 'Pan']) {
      await page.locator(chip(label)).first().click();
      await page.waitForTimeout(150);
      expect(await visibleNames(page)).not.toContain('Ancient Recipe');
      await page.locator(chip(label)).first().click();
      await page.waitForTimeout(150);
    }
    // Still there once the filter is cleared.
    expect(await visibleNames(page)).toEqual(['Ancient Recipe']);
  });

  test('an empty primary chip explains how to fill it instead of dead-ending', async ({ page }) => {
    await loadLocalApp(page);
    await seed(page, [{ id: 'p', name: 'Pan Only', equipment: ['pan'], effort: 'normal', activeTime: 20 }]);
    await page.locator(chip('Rice cooker')).first().click();
    await page.waitForTimeout(250);
    const text = await page.locator('#recipes-grid').innerText();
    expect(text).toContain('No rice cooker recipes yet');
    expect(text.toLowerCase()).toContain('cooking method');
  });
});

// ── 14. The backfilled built-in recipes actually reach the filters ───────────

test.describe('built-in recipe metadata', () => {
  test.use({ viewport: { width: 1280, height: 1600 } });

  test('14: every seeded recipe carries a cooking method and effort', async ({ page }) => {
    await loadLocalApp(page);
    const audit = await page.evaluate(() => ({
      total: sampleRecipes.length,
      withEquipment: sampleRecipes.filter((r) => (r.equipment || []).length).length,
      withEffort: sampleRecipes.filter((r) => r.effort).length,
      withActive: sampleRecipes.filter((r) => r.activeTime != null).length,
      withNutrition: sampleRecipes.filter((r) => r.nutritionPerServing.calories > 0).length,
      uniqueIds: new Set(sampleRecipes.map((r) => String(r.id))).size,
      activeNeverExceedsTotal: sampleRecipes.every(
        (r) => r.activeTime <= r.basePrepTime + r.baseCookTime)
    }));
    expect(audit.total).toBe(40);       // 26 original + 14 low-effort starters
    expect(audit.withEquipment).toBe(40);
    expect(audit.withEffort).toBe(40);
    expect(audit.withActive).toBe(40);
    expect(audit.withNutrition).toBe(40);
    expect(audit.uniqueIds).toBe(40);
    expect(audit.activeNeverExceedsTotal).toBe(true);
  });

  test('the original 26 Filipino recipes were not retagged to populate filters', async ({ page }) => {
    await loadLocalApp(page);
    // Ids 1-26 are the pre-existing stovetop book. They were backfilled with
    // truthful `pan` metadata in the previous commit and must not have been
    // quietly re-labelled oven/rice-cooker to make a chip look populated.
    const retagged = await page.evaluate(() => sampleRecipes
      .filter((r) => Number(r.id) <= 26)
      .filter((r) => r.equipment.length !== 1 || r.equipment[0] !== 'pan')
      .map((r) => r.name + ' -> ' + r.equipment.join(',')));
    expect(retagged).toEqual([]);
  });

  test('14: the backfilled recipes appear under Pan and Lowest effort', async ({ page }) => {
    await loadLocalApp(page);
    await gotoCook(page);

    const panCount = Number(await page.locator(chip('Pan')).locator('.rq-count').innerText());
    const effortCount = Number(await page.locator(chip('Lowest effort')).locator('.rq-count').innerText());
    expect(panCount).toBe(26);
    expect(effortCount).toBeGreaterThan(0);

    await page.locator(chip('Lowest effort')).click();
    await page.waitForTimeout(250);
    const names = await visibleNames(page);
    expect(names).toHaveLength(effortCount);
    // Every one of them is genuinely declared easy, not merely quick.
    const allEasy = await page.evaluate((n) => n.every((x) => {
      const r = AppState.recipes.find((y) => y.name === x);
      return recipeEffortScore(r) <= 2;
    }), names);
    expect(allEasy).toBe(true);
  });

  test('10: on the real seeded book, Lowest effort orders by work, not clock', async ({ page }) => {
    await loadLocalApp(page);
    await gotoCook(page);
    await page.locator(chip('Lowest effort')).click();
    await page.waitForTimeout(300);

    const rows = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#recipes-grid .recipe-title')).map((e) => {
        const r = AppState.recipes.find((x) => x.name === e.textContent.trim());
        return { name: r.name, active: r.activeTime, total: recipeTotalMinutes(r),
                 rank: recipeEffortScore(r) };
      }));
    expect(rows.length).toBeGreaterThan(3);

    // Declared effort is the primary key and never goes backwards: an assembly
    // meal outranks a very-low cook outranks a low one.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].rank, `${rows[i].name} after ${rows[i - 1].name}`)
        .toBeGreaterThanOrEqual(rows[i - 1].rank);
    }
    // Inside one effort tier, hands-on minutes never decrease.
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].rank !== rows[i - 1].rank) continue;
      expect(rows[i].active, `${rows[i].name} after ${rows[i - 1].name}`)
        .toBeGreaterThanOrEqual(rows[i - 1].active);
    }
    // And the list is demonstrably NOT ordered by total time: somewhere a
    // longer-overall recipe outranks a shorter one because you walk away from it.
    const beatsOnTotal = rows.some((r, i) => i > 0 && r.total < rows[i - 1].total);
    expect(beatsOnTotal).toBe(true);
  });

  test('no recipe claims an appliance its own instructions do not describe', async ({ page }) => {
    await loadLocalApp(page);
    // A method claim is only honest if the recipe TELLS you how it is cooked in
    // that appliance. This is the guard against padding a filter with recipes
    // that merely "could" be made that way.
    const suspicious = await page.evaluate(() => sampleRecipes.filter((r) => {
      const i = (r.instructions || '').toLowerCase();
      const eq = r.equipment || [];
      if (eq.includes('oven') && !/oven|bake|roast/.test(i)) return true;
      if (eq.some((e) => e.indexOf('rice-cooker') === 0) && !/rice cooker/.test(i)) return true;
      if (eq.includes('instant-pot') && !/instant pot/.test(i)) return true;
      if (eq.includes('pressure-cooker') && !/pressure cooker/.test(i)) return true;
      if (eq.includes('no-cook') && /fry|boil|simmer|saut/.test(i)) return true;
      return false;
    }).map((r) => r.name + ' -> ' + r.equipment.join(',')));
    expect(suspicious).toEqual([]);
  });

  test('a rice-cooker-steamer recipe actually uses the steamer basket', async ({ page }) => {
    await loadLocalApp(page);
    const missing = await page.evaluate(() => sampleRecipes
      .filter((r) => r.equipment.includes('rice-cooker-steamer'))
      .filter((r) => !/steamer/.test((r.instructions || '').toLowerCase()))
      .map((r) => r.name));
    expect(missing).toEqual([]);
  });
});

// ── The starter set: every method chip returns real recipes out of the box ───

test.describe('shipped recipe book populates every cooking method', () => {
  test.use({ viewport: { width: 1280, height: 1600 } });

  // The wave this set exists to close: on the previous commit these four chips
  // were visible, correct, and empty. Each must now return usable recipes with
  // no setup, no import, and no editing.
  const EXPECTED = [
    { label: 'Rice cooker', min: 4, slugs: ['rice-cooker', 'rice-cooker-steamer'] },
    { label: 'Oven', min: 4, slugs: ['oven'] },
    { label: 'Instant Pot', min: 3, slugs: ['instant-pot', 'pressure-cooker'] },
    { label: 'No-cook', min: 3, slugs: ['no-cook'] }
  ];

  for (const { label, min, slugs } of EXPECTED) {
    test(`${label} returns real recipes on a fresh install`, async ({ page }) => {
      await loadLocalApp(page);
      await gotoCook(page);

      const c = page.locator(chip(label)).first();
      // No longer muted — it has content behind it.
      await expect(c).not.toHaveClass(/is-empty/);
      const count = Number(await c.locator('.rq-count').innerText());
      expect(count).toBeGreaterThanOrEqual(min);

      await c.click();
      await page.waitForTimeout(300);
      const names = await visibleNames(page);
      expect(names).toHaveLength(count);

      // Every recipe shown genuinely declares one of this chip's slugs.
      const bad = await page.evaluate(({ names, slugs }) => names.filter((n) => {
        const r = AppState.recipes.find((x) => x.name === n);
        return !r || !r.equipment.some((e) => slugs.includes(e));
      }), { names, slugs });
      expect(bad).toEqual([]);
    });
  }

  test('the Rice + steamer refinement is now populated too', async ({ page }) => {
    await loadLocalApp(page);
    await gotoCook(page);
    const c = page.locator(chip('Rice + steamer'));
    await expect(c).toBeVisible();
    await c.click();
    await page.waitForTimeout(300);
    const names = await visibleNames(page);
    expect(names.length).toBeGreaterThanOrEqual(2);
    const allSteamer = await page.evaluate((n) => n.every((x) =>
      AppState.recipes.find((y) => y.name === x).equipment.includes('rice-cooker-steamer')), names);
    expect(allSteamer).toBe(true);
  });

  test('Lowest effort is a mix of methods, not just the old stovetop book', async ({ page }) => {
    await loadLocalApp(page);
    await gotoCook(page);
    await page.locator(chip('Lowest effort')).click();
    await page.waitForTimeout(300);

    const rows = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#recipes-grid .recipe-title')).map((e) => {
        const r = AppState.recipes.find((x) => x.name === e.textContent.trim());
        return { name: r.name, eq: r.equipment, effort: r.effort, active: r.activeTime,
                 rank: recipeEffortScore(r) };
      }));

    // More than one cooking method is represented.
    const methods = new Set(rows.flatMap((r) => r.eq));
    expect(methods.size).toBeGreaterThan(1);
    expect(methods.has('pan')).toBe(true);

    // The genuinely effortless new recipes sort ABOVE the old stovetop ones —
    // that is the whole point of the ordering.
    const top5 = rows.slice(0, 5);
    expect(top5.some((r) => !r.eq.includes('pan'))).toBe(true);
    expect(top5.every((r) => r.effort === 'assembly' || r.effort === 'very-low')).toBe(true);

    // Declared effort never goes backwards, and inside a tier the hands-on
    // minutes never decrease.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].rank, `${rows[i].name} after ${rows[i - 1].name}`)
        .toBeGreaterThanOrEqual(rows[i - 1].rank);
      if (rows[i].rank === rows[i - 1].rank) {
        expect(rows[i].active, `${rows[i].name} after ${rows[i - 1].name}`)
          .toBeGreaterThanOrEqual(rows[i - 1].active);
      }
    }
  });

  test('the starter set is protein + vegetables + carb where it claims to be', async ({ page }) => {
    await loadLocalApp(page);
    // A mealBalance claim must be supported by an ingredient of that kind.
    const unsupported = await page.evaluate(() => sampleRecipes
      .filter((r) => Number(r.id) > 26)
      .filter((r) => {
        const cats = r.baseIngredients.map((i) => i.category);
        if (r.mealBalance.protein && cats.indexOf('Protein') < 0) return true;
        if (r.mealBalance.vegetables && cats.indexOf('Vegetable') < 0) return true;
        if (r.mealBalance.carb && cats.indexOf('Grain') < 0 &&
            !r.baseIngredients.some((i) => /potato/i.test(i.name))) return true;
        return false;
      }).map((r) => r.name));
    expect(unsupported).toEqual([]);
  });

  test('the starter set is genuinely low-friction: no normal-effort recipe in it', async ({ page }) => {
    await loadLocalApp(page);
    const audit = await page.evaluate(() => {
      const nu = sampleRecipes.filter((r) => Number(r.id) > 26);
      return {
        count: nu.length,
        normalEffort: nu.filter((r) => r.effort === 'normal').map((r) => r.name),
        // One appliance each. rice-cooker-steamer is one device doing two jobs.
        multiAppliance: nu.filter((r) => r.equipment.length > 1).map((r) => r.name),
        maxActive: Math.max(...nu.map((r) => r.activeTime)),
        maxIngredients: Math.max(...nu.map((r) => r.baseIngredients.length))
      };
    });
    expect(audit.count).toBe(14);
    expect(audit.normalEffort).toEqual([]);
    expect(audit.multiAppliance).toEqual([]);
    expect(audit.maxActive).toBeLessThanOrEqual(15);
    // "Avoid complicated foodie recipes with 20 ingredients."
    expect(audit.maxIngredients).toBeLessThanOrEqual(10);
  });
});

// ── 16. The existing Home recommendation got more useful, not redesigned ─────

test.describe('Home "Easiest" after the backfill', () => {
  test.use({ viewport: { width: 1280, height: 1700 } });

  test('16: the seeded book now produces an Easiest pick that explains itself', async ({ page }) => {
    await loadLocalApp(page);
    const picks = await page.evaluate(() => getWhatShouldWeEatSuggestions());
    const easiest = picks.find((p) => p.label === 'Easiest');

    // Before the backfill this pick existed but had an EMPTY reasons array —
    // a recommendation with no stated reason. It must now say why.
    expect(easiest).toBeTruthy();
    expect(easiest.reasons.length).toBeGreaterThan(0);

    // A cooking method and the hands-on cost are the two things that make
    // "easiest" mean something, and both are now available to render.
    const joined = easiest.reasons.join(' · ');
    expect(joined).toMatch(/Rice cooker|Oven|Instant Pot|Pressure cooker|Pan|No cook/);
    expect(joined).toMatch(/min active/);

    // And it is honestly easy, not merely first.
    const honest = await page.evaluate((name) => {
      const r = AppState.recipes.find((x) => x.name === name);
      return recipeEffortScore(r) <= 2;
    }, easiest.name);
    expect(honest).toBe(true);
  });

  test('the Easiest reason chips actually render on Home', async ({ page }) => {
    await loadLocalApp(page);
    await page.evaluate(() => showTab('dashboard'));
    await page.waitForTimeout(500);
    const row = page.locator('.wse-row', { hasText: 'Easiest' });
    await expect(row).toBeVisible();
    const chips = await row.locator('.wse-chip').allInnerTexts();
    expect(chips.length).toBeGreaterThan(0);
    expect(chips.join(' · ')).toMatch(/min active/);
  });

  test('pantry state can surface a starter-set recipe as Easiest', async ({ page }) => {
    await loadLocalApp(page);
    // Stock exactly what the rice-cooker mushroom rice needs. getCookableRecipes()
    // then tiers it as cook-now, and the ranking should land on it — proving the
    // new recipes reach the existing recommendation through the normal path, not
    // just by being alphabetically lucky on an empty pantry.
    const pick = await page.evaluate(() => {
      AppState.pantry = ['Chicken Thigh', 'Mushroom', 'White Rice (Bigas)', 'Water',
        'Soy Sauce (Toyo)', 'Garlic (Bawang)', 'Sesame Oil', 'Green Onion (Sibuyas Dahon)']
        .map((n, i) => ({ id: 'p' + i, name: n, quantity: 1, unit: 'pc', category: 'Pantry' }));
      const picks = getWhatShouldWeEatSuggestions();
      const e = picks.find((p) => p.label === 'Easiest');
      const cand = eatCookCandidates()[0];
      return e ? {
        name: e.name, reasons: e.reasons,
        pantryInformed: cand.pantryInformed, missing: cand.missing
      } : null;
    });

    expect(pick).toBeTruthy();
    expect(pick.name).toBe('Rice Cooker Chicken Mushroom Rice');
    expect(pick.reasons.join(' · ')).toContain('Rice cooker');
    expect(pick.reasons.join(' · ')).toContain('8 min active');
    // It won on the cook-now tier, not despite needing a shop. ("Have everything"
    // is a real reason but falls outside the card's existing 4-chip cap here.)
    expect(pick.pantryInformed).toBe(true);
    expect(pick.missing).toBe(0);
  });

  test('no new Home card was added', async ({ page }) => {
    await loadLocalApp(page);
    await page.evaluate(() => showTab('dashboard'));
    await page.waitForTimeout(500);
    // The wave must not introduce a competing "low effort meals" surface.
    const text = (await page.locator('#dashboard').innerText()).toLowerCase();
    expect(text).not.toContain('low effort meals');
    expect(text).toContain('what should we eat');
  });
});

// ── 19. No new persisted state ───────────────────────────────────────────────

test('19: the quick filter persists nothing', async ({ page }) => {
  await loadLocalApp(page);
  await gotoCook(page);

  const before = await page.evaluate(() => {
    const raw = localStorage.getItem('mealPrepAppData');
    return raw ? Object.keys(JSON.parse(raw)).sort() : [];
  });

  await page.locator(chip('Pan')).click();
  await page.waitForTimeout(300);
  await page.locator(chip('Lowest effort')).click();
  await page.waitForTimeout(300);

  const after = await page.evaluate(() => {
    const raw = localStorage.getItem('mealPrepAppData');
    return raw ? Object.keys(JSON.parse(raw)).sort() : [];
  });
  expect(after).toEqual(before);

  // The chip lives in a module-scoped variable, not on AppState.
  const onState = await page.evaluate(() =>
    Object.keys(AppState).filter((k) => /quickfilter|cookingmethod/i.test(k)));
  expect(onState).toEqual([]);

  // A reload forgets it — it is view state, not a preference.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settled(page);
  expect(await page.evaluate(() => recipeQuickFilter)).toBe('');
});

// ── 20, 21. Mobile ───────────────────────────────────────────────────────────

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('20: no horizontal PAGE overflow with the filter row on screen', async ({ page }) => {
    await loadLocalApp(page);
    await gotoCook(page);
    await expect(page.locator('#recipe-quick-filters')).toBeVisible();

    const overflow = await page.evaluate(() => ({
      docScroll: document.documentElement.scrollWidth,
      docClient: document.documentElement.clientWidth,
      bodyScroll: document.body.scrollWidth,
      bodyClient: document.body.clientWidth
    }));
    expect(overflow.docScroll).toBeLessThanOrEqual(overflow.docClient + 1);
    expect(overflow.bodyScroll).toBeLessThanOrEqual(overflow.bodyClient + 1);
  });

  test('21: the chips are reachable and tappable on a phone viewport', async ({ page }) => {
    await loadLocalApp(page);
    await gotoCook(page);

    const row = page.locator('#recipe-quick-filters');
    // The row scrolls on its own axis rather than the page.
    const scrolls = await row.evaluate((el) => el.scrollWidth > el.clientWidth
      ? ['auto', 'scroll'].indexOf(getComputedStyle(el).overflowX) >= 0
      : true);
    expect(scrolls).toBe(true);

    // Every chip clears a comfortable tap height and stays in the row.
    const boxes = await page.$$eval('#recipe-quick-filters .rq-chip', (els) =>
      els.map((e) => ({ h: e.getBoundingClientRect().height, label: e.textContent.trim() })));
    expect(boxes.length).toBeGreaterThan(5);
    for (const b of boxes) expect(b.h, b.label).toBeGreaterThanOrEqual(32);

    // Tapping through the row works and does not push the page sideways.
    for (const label of ['Lowest effort', 'Rice cooker', 'Oven']) {
      const c = page.locator(chip(label)).first();
      await c.scrollIntoViewIfNeeded();
      await c.click();
      await page.waitForTimeout(200);
      await expect(c).toHaveAttribute('aria-pressed', 'true');
      const ok = await page.evaluate(() =>
        document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
      expect(ok, `page overflowed after tapping ${label}`).toBe(true);
      await c.click();
      await page.waitForTimeout(150);
    }
  });
});

// ── 22. No console errors anywhere in the flow ───────────────────────────────

test('22: no page or console errors while using the filters', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await loadLocalApp(page);
  await gotoCook(page);
  for (const label of ['Lowest effort', 'Rice cooker', 'Oven', 'Instant Pot', 'No-cook', 'Pan', 'All']) {
    await page.locator(chip(label)).first().click();
    await page.waitForTimeout(200);
  }
  await page.fill('#recipe-search', 'chicken');
  await page.waitForTimeout(400);
  await page.fill('#recipe-search', '');
  await page.waitForTimeout(300);

  const real = errors.filter((e) => !/firebase|firestore|net::ERR|Failed to load resource/i.test(e));
  expect(real).toEqual([]);
});
