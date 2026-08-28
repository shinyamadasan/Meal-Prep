const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');
const { waitForAppReady, waitForRestored } = require('./app-ready');

/**
 * Ready Food Protein Identity — groundwork for Meal Lego, NOT Meal Lego.
 *
 * Cooked food gains a truthful protein identity so it can later be paired with
 * Flavor Library entries. Nothing recommends anything yet, and the Home UI is
 * deliberately unchanged.
 *
 * The invariant this file exists to defend:
 *
 *   A cooked meal's NAME is never read to determine its protein.
 *
 * "Landers Lechon Manok" is a product name. "Chicken of the Sea" is tuna. Any
 * substring reading of either is wrong in a way the user cannot see or correct,
 * so identity comes only from (1) what the user explicitly said or (2) structured
 * recipe ingredients. Unknown is a first-class answer, and most of the coverage
 * below is about REFUSING to answer rather than answering.
 *
 * Additive and non-red-zone: one optional field on the existing cookedMeals[]
 * objects, which already round-trip through every persistence path, so no sync,
 * tombstone or TOMBSTONE_KEYS change is involved.
 */

const APP_URL = () => pathToFileURL(path.resolve('index.html')).href;

// Fixture cookedDates in this file sit near 2026-08-24/25 and the ranking
// assertion (the r1/r2/r3 Ready Food order) depends on those dates still being
// fresh/expiring relative to "today" — e.g. fridgeLife 3 on a 2026-08-24 batch
// means "expires 2026-08-27". Left to the real wall clock, the fixture silently
// expires once the calendar rolls past that window (it did, in CI, on 2026-08-28
// UTC). Pinning the page clock to the fixtures' own era makes that relationship
// explicit and immune to the machine's real current date.
const FIXED_CLOCK = '2026-08-27T12:00:00';

async function loadOffline(page, { fixedTime = FIXED_CLOCK } = {}) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  if (fixedTime) await page.clock.setFixedTime(new Date(fixedTime));
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__proteinBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__proteinBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
      localStorage.setItem('mealPrepInitialized', '1');
    } catch (e) {}
  });
  await page.goto(APP_URL(), { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
}

// Installs a Firestore mock BEFORE load so initApp() takes the real signed-in
// branch — the actual loadFromFirestore / saveToFirestore code runs, not a
// re-implementation of it.
async function loadSignedIn(page, { cloudDoc = null } = {}) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__proteinCloudBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__proteinCloudBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
      localStorage.setItem('mealPrepInitialized', '1');
    } catch (e) {}
  });
  await page.addInitScript((cloud) => {
    const st = { doc: cloud ? JSON.parse(JSON.stringify(cloud)) : null };
    const snap = () => ({ exists: () => st.doc !== null, data: () => JSON.parse(JSON.stringify(st.doc)) });
    const write = (d) => { st.doc = JSON.parse(JSON.stringify(d)); window.__writes.push(JSON.parse(JSON.stringify(d))); };
    window.__writes = [];
    const user = { uid: 'u', email: 'a@b.c', emailVerified: true, reload: async () => {} };
    window.firebase = {
      db: {}, auth: { currentUser: user }, doc: () => ({}), collection: () => ({}),
      getDoc: async () => snap(), getDocs: async () => ({ forEach: () => {} }),
      setDoc: async (_r, d) => write(d), deleteDoc: async () => {},
      runTransaction: async (_db, fn) => fn({ get: async () => snap(), set: (_r, d) => write(d) }),
      onSnapshot: () => () => {},
      onAuthStateChanged: (_a, f) => { setTimeout(() => f(user), 0); return () => {}; },
      signOut: async () => {}, query: () => ({}), where: () => ({}), orderBy: () => ({}),
      signInWithEmailAndPassword: async () => ({ user }),
      createUserWithEmailAndPassword: async () => ({ user }),
      sendEmailVerification: async () => {}, sendPasswordResetEmail: async () => {}
    };
  }, cloudDoc);
  await page.goto(APP_URL(), { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
  await page.waitForFunction(() => AppState.cloudReady === true, null, { timeout: 30000 });
}

const recipe = (id, name, ingredients) => ({
  id, name, category: 'Dinner', baseServings: 2, currentServings: 2,
  basePrepTime: 10, baseCookTime: 20, fridgeLife: 3, freezerLife: 30,
  baseIngredients: ingredients, instructions: 'x',
  updatedAt: '2026-01-01T00:00:00.000Z'
});
const ing = (name, category) => ({ name: name, baseQuantity: 200, unit: 'g', category: category });

const mealFromRecipe = (id, recipeId, name) => ({
  id: id, recipeId: String(recipeId), name: name, cookedDate: '2026-08-25',
  storage: 'fridge', fridgeLife: 3, freezerLife: 30,
  initialPortions: 4, portionsRemaining: 4
});

// ── The core rule: names are never parsed ────────────────────────────────────

test('3+4. a manual meal named "Landers Lechon Manok" stays unknown — the name is never read', async ({ page }) => {
  await loadOffline(page);
  const result = await page.evaluate(() => {
    AppState.recipes = [];
    AppState.cookedMeals = [{
      id: 'cm_lechon', recipeId: null, name: 'Landers Lechon Manok',
      cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 3, freezerLife: 30
    }];
    return {
      type: getCookedMealProteinType(AppState.cookedMeals[0]),
      stored: AppState.cookedMeals[0].proteinType === undefined
    };
  });
  expect(result.type).toBe('unknown');
  expect(result.stored).toBe(true); // nothing invented onto the record
});

test('3. names that LOOK like a protein are never parsed — chaos set stays unknown', async ({ page }) => {
  await loadOffline(page);
  const results = await page.evaluate(() => {
    AppState.recipes = [];
    const names = [
      'Landers Lechon Manok',      // manok = chicken in Filipino
      'Chicken of the Sea',        // brand name; it is tuna
      'Chicken Inasal',
      'Beef Stew',
      'Shredded chicken',
      'Salmon poke bowl',
      'Tuna sandwich',
      'Egg sandwich',
      'Tofu sisig',
      'Jollibee Chickenjoy',
      'Pork sinigang leftovers',
      'Mystery tupperware'
    ];
    return names.map((n) => [n, getCookedMealProteinType({ id: 'x', recipeId: null, name: n })]);
  });
  // EVERY one is unknown. Not one name yields a protein.
  results.forEach(([name, type]) => expect(type, name).toBe('unknown'));
});

test('5. the same "Landers Lechon Manok" explicitly marked Chicken resolves chicken', async ({ page }) => {
  await loadOffline(page);
  const type = await page.evaluate(() => getCookedMealProteinType({
    id: 'cm_lechon', recipeId: null, name: 'Landers Lechon Manok', proteinType: 'chicken'
  }));
  expect(type).toBe('chicken');
});

test('3. an explicit value always beats the name, even a contradictory one', async ({ page }) => {
  await loadOffline(page);
  const type = await page.evaluate(() => getCookedMealProteinType({
    id: 'x', recipeId: null, name: 'Chicken of the Sea', proteinType: 'tuna'
  }));
  expect(type).toBe('tuna'); // the user is right; the name is irrelevant
});

// ── Deterministic recipe derivation ──────────────────────────────────────────

test('6,7,8,9. single-protein recipes resolve their family from structured ingredients', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(({ recipes, meals }) => {
    AppState.recipes = recipes;
    return meals.map((m) => [m.name, getCookedMealProteinType(m)]);
  }, {
    recipes: [
      recipe(901, 'Chicken Adobo', [ing('Chicken Thigh', 'Protein'), ing('Garlic (Bawang)', 'Vegetable')]),
      recipe(902, 'Beef Caldereta', [ing('Beef Brisket', 'Protein'), ing('Potato (Patatas)', 'Vegetable')]),
      recipe(903, 'Pork Sinigang', [ing('Pork Belly (Liempo)', 'Protein')]),
      recipe(904, 'Grilled Salmon', [ing('Salmon', 'Protein')]),
      recipe(905, 'Fried Bangus', [ing('Bangus (Milkfish)', 'Protein')]),
      recipe(906, 'Tuna Pasta', [ing('Tuna (Canned)', 'Protein')]),
      recipe(907, 'Garlic Shrimp', [ing('Shrimp', 'Protein')]),
      recipe(908, 'Tortang Talong', [ing('Eggs', 'Protein')]),
      recipe(909, 'Tofu Sisig', [ing('Tofu (Tokwa)', 'Protein')])
    ],
    meals: [901, 902, 903, 904, 905, 906, 907, 908, 909].map(
      (id, i) => mealFromRecipe('cm_' + id, id, 'batch ' + i))
  });
  expect(got.map((g) => g[1])).toEqual([
    'chicken', 'beef', 'pork',
    'salmon',            // 9. salmon keeps its OWN id — FLAVOR_PROTEINS has one
    'fish',              //    finfish with no specific id fall back to 'fish'
    'tuna', 'shrimp', 'egg', 'tofu'
  ]);
});

test('10. a recipe with two distinct protein families resolves mixed, not a favourite', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(({ recipes, meals }) => {
    AppState.recipes = recipes;
    return meals.map((m) => getCookedMealProteinType(m));
  }, {
    recipes: [
      recipe(910, 'Tapsilog', [ing('Beef Sirloin', 'Protein'), ing('Eggs', 'Protein')]),
      recipe(911, 'Surf and Turf', [ing('Beef', 'Protein'), ing('Shrimp', 'Protein')]),
      // Two cuts of the SAME family is still one family, not mixed.
      recipe(912, 'Pork Two Ways', [ing('Pork Belly (Liempo)', 'Protein'), ing('Ground Pork', 'Protein')])
    ],
    meals: [910, 911, 912].map((id) => mealFromRecipe('cm_' + id, id, 'b' + id))
  });
  expect(got).toEqual(['mixed', 'mixed', 'pork']);
});

test('11. a meatless recipe resolves none — it does not fabricate a protein', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(({ recipes, meals }) => {
    AppState.recipes = recipes;
    return meals.map((m) => getCookedMealProteinType(m));
  }, {
    recipes: [
      recipe(920, 'Sinangag', [ing('White Rice (Bigas)', 'Grain'), ing('Garlic (Bawang)', 'Vegetable')]),
      // An empty ingredient list is NOT evidence of meatlessness — we know nothing.
      recipe(921, 'Empty', [])
    ],
    meals: [920, 921].map((id) => mealFromRecipe('cm_' + id, id, 'b' + id))
  });
  expect(got).toEqual(['none', 'unknown']);
});

test('12. an unidentifiable Protein ingredient forces unknown for the whole recipe', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(({ recipes, meals }) => {
    AppState.recipes = recipes;
    return meals.map((m) => getCookedMealProteinType(m));
  }, {
    recipes: [
      // Declared Protein, not in the curated table -> we read it and could not name it.
      recipe(930, 'Mystery Meat', [ing('Alien Protein 9000', 'Protein')]),
      // Even next to something we DO recognise: partial knowledge is not knowledge.
      recipe(931, 'Chicken + Mystery', [ing('Chicken Breast', 'Protein'), ing('Alien Protein 9000', 'Protein')]),
      // Processed sausages are deliberately unmapped — sold in pork, chicken and beef.
      recipe(932, 'Longsilog', [ing('Longganisa', 'Protein'), ing('Eggs', 'Protein')]),
      recipe(933, 'Menudo', [ing('Pork Shoulder (Kasim)', 'Protein'), ing('Hotdog', 'Protein')])
    ],
    meals: [930, 931, 932, 933].map((id) => mealFromRecipe('cm_' + id, id, 'b' + id))
  });
  expect(got).toEqual(['unknown', 'unknown', 'unknown', 'unknown']);
});

test('no substring matching: a name CONTAINING a known ingredient does not match it', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(({ recipes, meals }) => {
    AppState.recipes = recipes;
    return meals.map((m) => getCookedMealProteinType(m));
  }, {
    recipes: [
      // Contains the exact string "Beef" but is not the ingredient "Beef".
      recipe(940, 'Not Beef', [ing('Beef-flavoured Seasoning', 'Protein')]),
      recipe(941, 'Chicken Of The Sea', [ing('Chicken of the Sea Tuna', 'Protein')])
    ],
    meals: [940, 941].map((id) => mealFromRecipe('cm_' + id, id, 'b' + id))
  });
  expect(got).toEqual(['unknown', 'unknown']);
});

test('a dangling recipeId (recipe deleted after cooking) falls back to unknown', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => {
    AppState.recipes = [];
    return getCookedMealProteinType({ id: 'cm_x', recipeId: '999', name: 'Adobo leftovers' });
  });
  expect(got).toBe('unknown');
});

test('an explicit value survives the recipe being edited to a different protein', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(({ r }) => {
    AppState.recipes = [r];
    const meal = { id: 'cm_p', recipeId: '950', name: 'batch', proteinType: 'chicken' };
    const before = getCookedMealProteinType(meal);
    AppState.recipes[0].baseIngredients = [{ name: 'Beef', baseQuantity: 1, unit: 'kg', category: 'Protein' }];
    const derivedNow = recipeProteinType(AppState.recipes[0]);
    return { before: before, after: getCookedMealProteinType(meal), derivedNow: derivedNow };
  }, { r: recipe(950, 'Adobo', [ing('Chicken Thigh', 'Protein')]) });
  // Derivation follows the recipe; the explicit pin does not move.
  expect(got.derivedNow).toBe('beef');
  expect(got.before).toBe('chicken');
  expect(got.after).toBe('chicken');
});

// ── Manual add UI ────────────────────────────────────────────────────────────

test('1. manual add can explicitly select Chicken, and it is stored', async ({ page }) => {
  await loadOffline(page);
  await page.evaluate(() => { AppState.cookedMeals = []; openManualCookedModal(); });
  await page.fill('#manual-cooked-name', 'Landers Lechon Manok');
  await page.selectOption('#manual-cooked-protein', 'chicken');
  await page.click('#manual-cooked-modal .btn--primary');
  const got = await page.evaluate(() => {
    const m = AppState.cookedMeals[AppState.cookedMeals.length - 1];
    return { name: m.name, stored: m.proteinType, resolved: getCookedMealProteinType(m) };
  });
  expect(got.name).toBe('Landers Lechon Manok');
  expect(got.stored).toBe('chicken');
  expect(got.resolved).toBe('chicken');
});

test('2. manual add defaults to Unknown and stores no field at all', async ({ page }) => {
  await loadOffline(page);
  await page.evaluate(() => { AppState.cookedMeals = []; openManualCookedModal(); });
  const defaultValue = await page.inputValue('#manual-cooked-protein');
  await page.fill('#manual-cooked-name', 'Mystery tupperware');
  await page.click('#manual-cooked-modal .btn--primary');
  const got = await page.evaluate(() => {
    const m = AppState.cookedMeals[AppState.cookedMeals.length - 1];
    return { hasField: Object.prototype.hasOwnProperty.call(m, 'proteinType'), resolved: getCookedMealProteinType(m) };
  });
  expect(defaultValue).toBe('');       // Unknown is the default selection
  expect(got.hasField).toBe(false);    // absent, not null — old records look identical
  expect(got.resolved).toBe('unknown');
});

test('the selector resets to Unknown on every open — a previous choice never carries over', async ({ page }) => {
  await loadOffline(page);
  await page.evaluate(() => { AppState.cookedMeals = []; openManualCookedModal(); });
  await page.fill('#manual-cooked-name', 'First');
  await page.selectOption('#manual-cooked-protein', 'beef');
  await page.click('#manual-cooked-modal .btn--primary');
  await page.evaluate(() => openManualCookedModal());
  expect(await page.inputValue('#manual-cooked-protein')).toBe('');
});

test('"No protein (meatless)" is selectable and is distinct from unknown', async ({ page }) => {
  await loadOffline(page);
  await page.evaluate(() => { AppState.cookedMeals = []; openManualCookedModal(); });
  await page.fill('#manual-cooked-name', 'Veg curry');
  await page.selectOption('#manual-cooked-protein', 'none');
  await page.click('#manual-cooked-modal .btn--primary');
  const got = await page.evaluate(() => {
    const m = AppState.cookedMeals[AppState.cookedMeals.length - 1];
    return { stored: m.proteinType, resolved: getCookedMealProteinType(m) };
  });
  expect(got.stored).toBe('none');
  expect(got.resolved).toBe('none'); // an answer, not an absence
});

test('the HTML selector and the code vocabulary cannot drift apart', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => {
    const opts = Array.from(document.querySelectorAll('#manual-cooked-protein option'));
    return {
      optionValues: opts.map((o) => o.value).filter((v) => v !== ''),
      optionLabels: opts.filter((o) => o.value !== '').map((o) => o.textContent.trim()),
      codeIds: COOKED_PROTEIN_CHOICE_IDS,
      codeLabels: COOKED_PROTEIN_CHOICES.map((c) => c.label),
      blankIsFirst: opts[0].value === '' && /unknown/i.test(opts[0].textContent)
    };
  });
  expect(got.optionValues).toEqual(got.codeIds);
  expect(got.optionLabels).toEqual(got.codeLabels);
  expect(got.blankIsFirst).toBe(true);
});

test('24. the manual add modal stays usable on a phone with no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadOffline(page);
  await page.evaluate(() => openManualCookedModal());
  const box = await page.evaluate(() => {
    const el = document.getElementById('manual-cooked-protein');
    const r = el.getBoundingClientRect();
    return {
      visible: r.width > 0 && r.height > 0,
      height: r.height,
      withinViewport: r.right <= window.innerWidth + 1,
      docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  });
  expect(box.visible).toBe(true);
  expect(box.withinViewport).toBe(true);
  expect(box.height).toBeGreaterThanOrEqual(32); // still a comfortable tap target
  expect(box.docOverflow).toBeLessThanOrEqual(0);
});

// ── Flavor Library groundwork (helper level only — no UI) ────────────────────

test('18. a flavor worksWith list joins deterministically to a known cooked-food protein', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => {
    AppState.flavors = normalizeFlavors(JSON.parse(JSON.stringify(defaultFlavors)));
    AppState.recipes = [];
    const chickenBatch = { id: 'cm_a', recipeId: null, name: 'Landers Lechon Manok', proteinType: 'chicken' };
    const type = getCookedMealProteinType(chickenBatch);
    return { type: type, names: flavorsForProteinType(type).map((f) => f.name).sort() };
  });
  expect(got.type).toBe('chicken');
  // The two the wave brief calls out, proven by the join rather than by hand.
  expect(got.names).toContain('Soy-Calamansi');
  expect(got.names).toContain('Garlic Yogurt');
  expect(got.names.length).toBeGreaterThan(2);
});

test('19. unknown / mixed / none cooked food returns NO flavors rather than a guess', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => {
    AppState.flavors = normalizeFlavors(JSON.parse(JSON.stringify(defaultFlavors)));
    return {
      unknown: flavorsForProteinType('unknown').length,
      mixed: flavorsForProteinType('mixed').length,
      none: flavorsForProteinType('none').length,
      nullish: flavorsForProteinType(null).length,
      chicken: flavorsForProteinType('chicken').length
    };
  });
  expect(got.unknown).toBe(0);
  expect(got.mixed).toBe(0);
  expect(got.none).toBe(0);
  expect(got.nullish).toBe(0);
  expect(got.chicken).toBeGreaterThan(0); // the join genuinely works
});

test('the cooked-food vocabulary is a subset of the flavor worksWith vocabulary', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => ({
    cooked: COOKED_PROTEIN_IDS,
    flavor: FLAVOR_PROTEINS.map((p) => p.id),
    missing: COOKED_PROTEIN_IDS.filter((id) => !FLAVOR_PROTEIN_BY_ID[id])
  }));
  expect(got.missing).toEqual([]); // no forked vocabulary, so the join needs no translation
});

// ── Persistence (generic cookedMeals paths — nothing sync-shaped was touched) ─

test('20. no new top-level AppState collection was introduced', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => ({
    // localSavedAt / cloudSavedAt are stamped by whichever save path ran, so they
    // are excluded rather than pinned — they are not collections and vary by auth.
    keys: Object.keys(AppState).filter((k) => k !== 'localSavedAt' && k !== 'cloudSavedAt').sort(),
    proteinKeys: Object.keys(AppState).filter((k) => /protein/i.test(k)),
    tombstoneKeys: TOMBSTONE_KEYS.slice()
  }));
  // The complete AppState surface, pinned. This wave must add NOTHING to it —
  // the protein identity lives inside existing cookedMeals[] objects.
  const expected = [
    'cloudReady', 'cookHistory', 'cookedMeals', 'currentEditingFlavor',
    'currentEditingHack', 'currentEditingIngredient', 'currentEditingRecipe', 'currentUser',
    'customHacks', 'customIngredients', 'customStores', 'dataVersion', 'deletions', 'flavors',
    // 'preparedFlavors' is Flavor Bomb v1's prepared-stock collection (D-074), a
    // LATER, separately owner-approved wave — not something this protein-identity
    // wave introduces. Listed here rather than loosening the check.
    'preparedFlavors',
    'groceryList', 'ingredientPrices', 'isOnline', 'myStores', 'nutritionGoals', 'pantry',
    'prepModeSession', 'profile', 'recentRecipes', 'recipes', 'selectedPlannerDays',
    'selectedRecipeForPlanning', 'syncStatus', 'userIngredients', 'weeklyPlan'
  ].sort();
  expect(got.keys).toEqual(expected);
  expect(got.proteinKeys).toEqual([]); // identity lives INSIDE cookedMeals[], not beside it
  // Untouched: this wave is additive metadata, not deletion or sync work.
  expect(got.tombstoneKeys).toEqual([
    'recipes', 'pantry', 'customIngredients', 'customHacks', 'flavors', 'preparedFlavors', 'cookedMeals', 'userIngredients'
  ]);
});

test('21. save + reload preserves an explicit classification', async ({ page }) => {
  await loadOffline(page);
  await page.evaluate(() => {
    AppState.cookedMeals = [{
      id: 'cm_persist', recipeId: null, name: 'Landers Lechon Manok', proteinType: 'chicken',
      cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 3, freezerLife: 30,
      initialPortions: 4, portionsRemaining: 4
    }];
    saveData();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForRestored(page, () => AppState.cookedMeals.some((m) => m.id === 'cm_persist'));
  const got = await page.evaluate(() => {
    const m = AppState.cookedMeals.find((x) => x.id === 'cm_persist');
    return { stored: m.proteinType, resolved: getCookedMealProteinType(m) };
  });
  expect(got.stored).toBe('chicken');
  expect(got.resolved).toBe('chicken');
});

test('22. the Firestore payload carries it, and a cloud load restores it', async ({ page }) => {
  await loadSignedIn(page, { cloudDoc: {
    version: 3,
    recipes: [], pantry: [], customIngredients: [], customHacks: [], flavors: [], userIngredients: [],
    cookedMeals: [{
      id: 'cm_cloud', recipeId: null, name: 'Chicken of the Sea', proteinType: 'tuna',
      cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 3, freezerLife: 30
    }],
    deletions: {}
  } });
  const loaded = await page.evaluate(() => {
    const m = AppState.cookedMeals.find((x) => x.id === 'cm_cloud');
    return { stored: m.proteinType, resolved: getCookedMealProteinType(m) };
  });
  expect(loaded.stored).toBe('tuna');
  expect(loaded.resolved).toBe('tuna');

  const payload = await page.evaluate(() => {
    const p = buildFirestorePayload();
    const m = (p.cookedMeals || []).find((x) => x.id === 'cm_cloud');
    return m ? m.proteinType : null;
  });
  expect(payload).toBe('tuna');
});

test('23. export and import round-trip the field through the generic cookedMeals flows', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => {
    AppState.cookedMeals = [{
      id: 'cm_exp', recipeId: null, name: 'Beef stew', proteinType: 'beef',
      cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 3, freezerLife: 30
    }];
    // exportData() builds this object literally; snapshotData() feeds backups.
    const exported = JSON.parse(JSON.stringify({ cookedMeals: AppState.cookedMeals }));
    const snapshot = JSON.parse(JSON.stringify(snapshotData()));

    // Import path: unionById + normalizeCookedMeals, exactly as importData() runs it.
    AppState.cookedMeals = [];
    AppState.cookedMeals = normalizeCookedMeals(unionById(AppState.cookedMeals, exported.cookedMeals));
    return {
      exported: exported.cookedMeals[0].proteinType,
      snapshot: (snapshot.cookedMeals[0] || {}).proteinType,
      imported: AppState.cookedMeals[0].proteinType,
      resolved: getCookedMealProteinType(AppState.cookedMeals[0])
    };
  });
  expect(got.exported).toBe('beef');
  expect(got.snapshot).toBe('beef');
  expect(got.imported).toBe('beef');
  expect(got.resolved).toBe('beef');
});

test('13. cooked meals saved before this wave load untouched and read unknown', async ({ page }) => {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      ['mealPrepHelpSeen', 'mealPrepStartDone', 'pantryOnboardingDone', 'mealPrepInitialized']
        .forEach((k) => localStorage.setItem(k, '1'));
      localStorage.setItem('mealPrepAppData', JSON.stringify({
        recipes: [],
        cookedMeals: [
          { id: 'cm_legacy1', recipeId: null, name: 'Landers Lechon Manok', cookedDate: '2026-08-20', storage: 'fridge', fridgeLife: 3 },
          { id: 'cm_legacy2', recipeId: '901', name: 'Adobo', cookedDate: '2026-08-20', storage: 'fridge', fridgeLife: 3 }
        ]
      }));
    } catch (e) {}
  });
  await page.goto(APP_URL(), { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
  const got = await page.evaluate(() => {
    const m = AppState.cookedMeals;
    return {
      count: m.length,
      names: m.map((x) => x.name),
      fields: m.map((x) => Object.prototype.hasOwnProperty.call(x, 'proteinType')),
      types: m.map(getCookedMealProteinType)
    };
  });
  expect(got.count).toBe(2);
  expect(got.names).toEqual(['Landers Lechon Manok', 'Adobo']);
  expect(got.fields).toEqual([false, false]); // no record was rewritten
  expect(got.types).toEqual(['unknown', 'unknown']);
});

test('a legacy recipe-backed batch resolves once its recipe is present', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(({ r }) => {
    AppState.recipes = [r];
    const legacy = { id: 'cm_legacy', recipeId: '960', name: 'Adobo', cookedDate: '2026-08-20', storage: 'fridge', fridgeLife: 3 };
    return { resolved: getCookedMealProteinType(legacy), stillNoField: legacy.proteinType === undefined };
  }, { r: recipe(960, 'Chicken Adobo', [ing('Chicken Thigh', 'Protein')]) });
  expect(got.resolved).toBe('chicken');
  expect(got.stillNoField).toBe(true); // derived, never written back
});

test('an unrecognised stored value is dropped rather than trusted', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => {
    const meals = [
      { id: 'a', name: 'x', proteinType: 'unicorn' },
      { id: 'b', name: 'y', proteinType: 'mixed' },    // never a STORED value
      { id: 'c', name: 'z', proteinType: 'unknown' },  // absence, not a value
      { id: 'd', name: 'w', proteinType: 'chicken' }
    ];
    normalizeCookedMeals(meals);
    return meals.map((m) => [m.id, m.proteinType === undefined ? 'DROPPED' : m.proteinType]);
  });
  expect(got).toEqual([['a', 'DROPPED'], ['b', 'DROPPED'], ['c', 'DROPPED'], ['d', 'chicken']]);
});

// ── Nothing else moved ───────────────────────────────────────────────────────

test('14. Ready Food ranking is unchanged by the presence of protein data', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => {
    const build = (withProtein) => ([
      { id: 'r1', name: 'Freezer batch', cookedDate: '2026-08-20', storage: 'freezer', freezerLife: 90, fridgeLife: 3, initialPortions: 4, portionsRemaining: 4 },
      { id: 'r2', name: 'Use soon', cookedDate: '2026-08-24', storage: 'fridge', fridgeLife: 3, initialPortions: 2, portionsRemaining: 1 },
      { id: 'r3', name: 'Plenty left', cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 30, initialPortions: 6, portionsRemaining: 6 }
    ].map((m, i) => withProtein ? Object.assign({}, m, { proteinType: ['chicken', 'beef', 'tofu'][i] }) : m));

    AppState.recipes = [];
    AppState.cookedMeals = build(false);
    const without = getReadyFoodSuggestions().map((m) => m.id);
    AppState.cookedMeals = build(true);
    const withP = getReadyFoodSuggestions().map((m) => m.id);
    return { without: without, withP: withP };
  });
  expect(got.withP).toEqual(got.without);
  expect(got.without.length).toBe(3);
});

test('15. What Should We Eat ranking is unchanged', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => {
    const meals = [
      { id: 'w1', name: 'Ready A', cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 30, initialPortions: 3, portionsRemaining: 3 },
      { id: 'w2', name: 'Ready B', cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 20, initialPortions: 2, portionsRemaining: 2 }
    ];
    AppState.cookedMeals = JSON.parse(JSON.stringify(meals));
    renderDashboard();
    const before = document.getElementById('dashboard').innerHTML;
    AppState.cookedMeals = meals.map((m, i) => Object.assign({}, m, { proteinType: ['chicken', 'beef'][i] }));
    renderDashboard();
    return { same: document.getElementById('dashboard').innerHTML === before };
  });
  expect(got.same).toBe(true); // Home renders identically — no "Try with" leaked in
});

test('16. Used 1 still decrements exactly one portion', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => {
    AppState.cookedMeals = [{
      id: 'cm_use', recipeId: null, name: 'Adobo', proteinType: 'chicken',
      cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 30,
      initialPortions: 4, portionsRemaining: 4
    }];
    useCookedPortion('cm_use');
    const m = AppState.cookedMeals[0];
    return { remaining: m.portionsRemaining, initial: m.initialPortions, protein: m.proteinType };
  });
  expect(got.remaining).toBe(3);
  expect(got.initial).toBe(4);
  expect(got.protein).toBe('chicken'); // untouched by the portion path
});

test('17. Flavor Library CRUD is unchanged', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => {
    AppState.flavors = [];
    addStarterFlavors();
    const seeded = AppState.flavors.length;
    const ids = AppState.flavors.map((f) => f.id);
    const first = AppState.flavors[0];
    const worksWith = (first.worksWith || []).slice();
    AppState.flavors = AppState.flavors.filter((f) => f.id !== first.id);
    return { seeded: seeded, afterDelete: AppState.flavors.length, prefixed: ids.every((i) => i.indexOf('flv-') === 0), worksWith: worksWith };
  });
  expect(got.seeded).toBe(10);
  expect(got.afterDelete).toBe(9);
  expect(got.prefixed).toBe(true);
  expect(got.worksWith.length).toBeGreaterThan(0);
});

test('25. the whole protein-identity flow raises no page or console errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await loadOffline(page);
  await page.evaluate(() => { AppState.cookedMeals = []; openManualCookedModal(); });
  await page.fill('#manual-cooked-name', 'Landers Lechon Manok');
  await page.selectOption('#manual-cooked-protein', 'chicken');
  await page.fill('#manual-cooked-portions', '6');
  await page.click('#manual-cooked-modal .btn--primary');
  await page.evaluate(() => {
    AppState.flavors = normalizeFlavors(JSON.parse(JSON.stringify(defaultFlavors)));
    AppState.cookedMeals.forEach(getCookedMealProteinType);
    flavorsForProteinType(getCookedMealProteinType(AppState.cookedMeals[0]));
    renderCookedMeals();
    renderDashboard();
    saveData();
  });
  await page.waitForTimeout(300);
  const appErrors = errors.filter(
    (e) => !/net::ERR|Failed to load resource|favicon|requestStorageAccess|frame-ancestors|google\.com/i.test(e)
  );
  expect(appErrors).toEqual([]);
});
