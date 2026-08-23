const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

/**
 * Seed isolation — AppState must never share recipe objects with the
 * sampleRecipes module constant.
 *
 * Why this file exists: `AppState.recipes = [...sampleRecipes]` copied the
 * ARRAY only. Because the app edits recipes in place (toggleFavorite,
 * updateServingSize, normalizeRecipes, the photo cache), a seeded session
 * rewrote the constant as the user worked. The constant is what
 * starterPackCandidates() and patchMissingNutrition() read as pristine
 * reference data, so the contamination leaked back into real recipes.
 *
 * These tests pin the mechanism (identity) AND the consequence (no leak).
 */

const PACK_IDS = Array.from({ length: 14 }, (_, i) => i + 27);

// Firebase aborted = the "Firebase not available, use local storage only"
// fallback, which is one of the two seed entry points.
async function bootNoFirebase(page, pre) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  // addInitScript runs on EVERY navigation, reloads included. Guard the clear so
  // a reload exercises the real restore path instead of silently starting over —
  // without this, a reload test proves nothing.
  await page.addInitScript((extra) => {
    try {
      if (localStorage.getItem('__seedIsoBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__seedIsoBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
      if (extra) Object.keys(extra).forEach((k) => localStorage.setItem(k, extra[k]));
    } catch (e) {}
  }, pre || null);
  await page.goto(pathToFileURL(path.resolve('index.html')).href, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
}

// ── The starter set still arrives ────────────────────────────────────────────

test('a Firebase-unavailable fresh boot still receives the whole starter set', async ({ page }) => {
  await bootNoFirebase(page);
  const state = await page.evaluate(() => ({
    count: AppState.recipes.length,
    ids: AppState.recipes.map((r) => Number(r.id)).sort((a, b) => a - b),
    persisted: JSON.parse(localStorage.getItem('mealPrepAppData')).recipes.length
  }));
  expect(state.count).toBe(40);
  expect(state.ids).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
  expect(state.persisted).toBe(40);
});

// ── Identity ─────────────────────────────────────────────────────────────────

test('no seeded recipe is the same object as its sampleRecipes entry', async ({ page }) => {
  await bootNoFirebase(page);
  const shared = await page.evaluate(() => {
    const bad = [];
    AppState.recipes.forEach((r) => {
      const seed = sampleRecipes.find((s) => String(s.id) === String(r.id));
      if (!seed) return;
      if (r === seed) bad.push('recipe ' + r.id);
      // Nested objects and arrays must be independent too, or an in-place edit
      // to one of them still reaches the constant.
      if (r.baseIngredients === seed.baseIngredients) bad.push('ingredients ' + r.id);
      if (r.nutritionPerServing === seed.nutritionPerServing) bad.push('nutrition ' + r.id);
      if (r.equipment === seed.equipment) bad.push('equipment ' + r.id);
      if (r.mealBalance === seed.mealBalance) bad.push('mealBalance ' + r.id);
      if (r.tags === seed.tags) bad.push('tags ' + r.id);
      r.baseIngredients.forEach((ing, i) => {
        if (ing === seed.baseIngredients[i]) bad.push('ingredient obj ' + r.id + '#' + i);
      });
    });
    return bad;
  });
  expect(shared).toEqual([]);
});

// ── Mutation containment ─────────────────────────────────────────────────────

test('normal recipe interactions do not mutate sampleRecipes', async ({ page }) => {
  await bootNoFirebase(page);

  const result = await page.evaluate(() => {
    const seed = sampleRecipes.find((r) => Number(r.id) === 27);
    const before = JSON.stringify(seed);

    // Every in-place mutation path the audit found.
    toggleFavorite('27');                       // recipe.favorite = !recipe.favorite
    updateServingSize('27', 8);                 // recipe.currentServings = n
    normalizeRecipes(AppState.recipes);         // reassigns equipment/tags/mealBalance
    patchMissingNutrition(AppState.recipes);
    const live = AppState.recipes.find((r) => Number(r.id) === 27);
    live.name = 'Renamed By User';              // a direct field write
    live.baseIngredients[0].name = 'Swapped Ingredient';
    live.nutritionPerServing.calories = 9999;
    live.equipment.push('oven');
    live.tags.push('shortcut');
    live.mealBalance.protein = false;

    return {
      seedUnchanged: JSON.stringify(seed) === before,
      seedName: seed.name,
      seedServings: seed.currentServings,
      seedFavorite: !!seed.favorite,
      seedFirstIngredient: seed.baseIngredients[0].name,
      seedCalories: seed.nutritionPerServing.calories,
      seedEquipment: seed.equipment.slice(),
      seedProtein: seed.mealBalance.protein
    };
  });

  expect(result.seedUnchanged).toBe(true);
  expect(result.seedName).toBe('Rice Cooker Chicken & Rice');
  expect(result.seedServings).toBe(4);
  expect(result.seedFavorite).toBe(false);
  expect(result.seedFirstIngredient).toBe('Chicken Thigh');
  expect(result.seedCalories).toBe(520);
  expect(result.seedEquipment).toEqual(['rice-cooker']);
  expect(result.seedProtein).toBe(true);
});

test('a session-contaminated seed can no longer leak into the starter pack', async ({ page }) => {
  // This is the exploit the fix closes, end to end. Before the fix the pack
  // added recipe 27 pre-scaled to 8 servings and already favourited, carried
  // over from an unrelated edit earlier in the same session.
  await bootNoFirebase(page);

  const added = await page.evaluate(() => {
    // 1. Seeded session: user scales and favourites a starter recipe.
    updateServingSize('27', 8);
    toggleFavorite('27');

    // 2. Something replaces the recipe list with a set that lacks 27-40 —
    //    what a sign-in merge from an older device does.
    AppState.recipes = JSON.parse(JSON.stringify(
      sampleRecipes.filter((r) => Number(r.id) <= 26)));
    localStorage.setItem('mealPrepInitialized', '1');

    // 3. The opt-in pack sources 27-40 from the constant.
    addStarterPackRecipes();
    const r = AppState.recipes.find((x) => Number(x.id) === 27);
    return { currentServings: r.currentServings, baseServings: r.baseServings, favorite: !!r.favorite };
  });

  expect(added.currentServings).toBe(4);   // not 8
  expect(added.baseServings).toBe(4);
  expect(added.favorite).toBe(false);      // not true
});

test('patchMissingNutrition hands out a copy, not the seed object', async ({ page }) => {
  await bootNoFirebase(page);
  const leaked = await page.evaluate(() => {
    const seed = sampleRecipes.find((r) => Number(r.id) === 27);
    const before = seed.nutritionPerServing.calories;
    // A recipe whose nutrition needs restoring from the seed.
    const r = { id: 27, name: 'x', baseIngredients: [], baseServings: 2, currentServings: 2,
      nutritionPerServing: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sodium: 0 } };
    const list = [r];
    patchMissingNutrition(list);
    const aliased = list[0].nutritionPerServing === seed.nutritionPerServing;
    list[0].nutritionPerServing.calories = 1;   // edit the restored recipe
    return { aliased, seedBefore: before, seedAfter: seed.nutritionPerServing.calories };
  });
  expect(leaked.aliased).toBe(false);
  expect(leaked.seedAfter).toBe(leaked.seedBefore);
});

// ── The behaviours the fix must NOT disturb ──────────────────────────────────

test('reload still restores the saved recipes and re-isolates them', async ({ page }) => {
  await bootNoFirebase(page);
  await page.evaluate(() => { toggleFavorite('27'); updateServingSize('5', 6); });
  await page.waitForTimeout(300);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  const after = await page.evaluate(() => {
    const r27 = AppState.recipes.find((x) => Number(x.id) === 27);
    const r5 = AppState.recipes.find((x) => Number(x.id) === 5);
    const seed27 = sampleRecipes.find((x) => Number(x.id) === 27);
    return {
      count: AppState.recipes.length,
      fav27: !!r27.favorite,
      servings5: r5.currentServings,
      stillShared: r27 === seed27,
      seedFav27: !!seed27.favorite
    };
  });
  expect(after.count).toBe(40);
  expect(after.fav27).toBe(true);      // the user's change survived
  expect(after.servings5).toBe(6);
  expect(after.stillShared).toBe(false);
  expect(after.seedFav27).toBe(false); // the constant is clean in the new session
});

test('an existing install with a deliberately empty recipe list stays empty', async ({ page }) => {
  await bootNoFirebase(page, { mealPrepInitialized: '1' });
  await page.evaluate(() => {
    AppState.recipes = [];
    saveData();
  });
  await page.waitForTimeout(300);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  // The first-run gate must not re-seed over the user's deliberate choice.
  expect(await page.evaluate(() => AppState.recipes.length)).toBe(0);
  // The starter pack is still an OFFER, not an action — it has not run itself.
  expect(await page.evaluate(() => starterPackCandidates().length)).toBe(14);
  expect(await page.evaluate(() => AppState.recipes.length)).toBe(0);
});

test('the opt-in pack path is unchanged and still isolates its copies', async ({ page }) => {
  await bootNoFirebase(page, { mealPrepInitialized: '1' });
  await page.evaluate(() => {
    AppState.recipes = JSON.parse(JSON.stringify(
      sampleRecipes.filter((r) => Number(r.id) <= 26)));
    saveData();
    showTab('recipes');
    renderRecipes();
  });
  await page.waitForTimeout(400);

  await page.click('.sp-add');
  await page.waitForTimeout(600);

  const state = await page.evaluate(() => {
    const bad = AppState.recipes.filter((r) =>
      r === sampleRecipes.find((s) => String(s.id) === String(r.id))).map((r) => r.id);
    return { count: AppState.recipes.length, shared: bad };
  });
  expect(state.count).toBe(40);
  expect(state.shared).toEqual([]);
});

test('a fresh first-run boot (Firebase path unavailable) marks itself initialized', async ({ page }) => {
  await bootNoFirebase(page);
  // ensureStarterRecipes() is untouched by this fix: still gated, still marks.
  const flag = await page.evaluate(() => localStorage.getItem('mealPrepInitialized'));
  expect(flag).toBe('1');
  expect(await page.evaluate(() => isFirstRun())).toBe(false);
});
