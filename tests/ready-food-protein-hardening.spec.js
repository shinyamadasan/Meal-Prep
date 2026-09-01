const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');
const { waitForAppReady, waitForRestored } = require('./app-ready');

/**
 * Ready Food Protein Identity — HARDENING wave.
 *
 * The identity contract itself already shipped and is defended by
 * ready-food-protein-identity.spec.js. This file covers only what the hardening
 * wave changed, plus the characterization it had to pin down first:
 *
 *   1. An EXISTING batch can be corrected or pinned in place, without recreating it.
 *   2. Clearing the selection REMOVES the explicit field rather than storing
 *      'unknown', so precedence stays: explicit -> recipe-derived -> unknown.
 *   3. Recipe-edit temporal truth: an unpinned recipe-backed batch follows its
 *      recipe (characterized, deliberately unchanged); a pinned one does not.
 *   4. The cooked-protein vocabulary cannot silently gain, lose, or reorder a value.
 *   5. Ingredient CATEGORY is whitespace/case-normalised; ingredient NAMES are not.
 *   6. A stored proteinType is accepted only as a primitive string in the vocabulary.
 *
 * The rule the whole feature exists to protect is unchanged and re-proved here for
 * the new correction path specifically:
 *
 *   A cooked meal's NAME is never read to determine its protein.
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
      if (localStorage.getItem('__hardeningBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__hardeningBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
      localStorage.setItem('mealPrepInitialized', '1');
    } catch (e) {}
  });
  await page.goto(APP_URL(), { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
}

// Firestore mock installed BEFORE load, so initApp() takes the real signed-in branch
// and the actual loadFromFirestore / saveToFirestore code runs. Copied in shape from
// ready-food-protein-identity.spec.js on purpose — the two files must exercise the
// same persistence path, not two similar-looking ones.
async function loadSignedIn(page, { cloudDoc = null } = {}) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__hardeningCloudBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__hardeningCloudBootstrapped', '1');
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

const batch = (over) => Object.assign({
  id: 'cm_1', recipeId: null, name: 'Mystery tupperware', cookedDate: '2026-08-25',
  storage: 'fridge', fridgeLife: 3, freezerLife: 30, initialPortions: 4, portionsRemaining: 4
}, over || {});

// ── 1-2. Correcting an existing batch, no recreation ─────────────────────────

test('1. an existing manual batch saved as Unknown can be changed to Chicken in place', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate((m) => {
    AppState.recipes = [];
    AppState.cookedMeals = [m];
    const before = {
      resolved: getCookedMealProteinType(AppState.cookedMeals[0]),
      hasField: 'proteinType' in AppState.cookedMeals[0]
    };
    setCookedProteinType('cm_1', 'chicken');
    const rec = AppState.cookedMeals[0];
    return {
      before: before,
      after: getCookedMealProteinType(rec),
      stored: rec.proteinType,
      // The SAME record, not a replacement: identity, creation-time fields and the
      // portion count all survive. Recreating the batch would have lost these.
      sameRecord: AppState.cookedMeals.length === 1 && rec.id === 'cm_1',
      name: rec.name,
      portions: rec.portionsRemaining,
      cookedDate: rec.cookedDate
    };
  }, batch({ name: 'Landers Lechon Manok' }));

  expect(got.before.resolved).toBe('unknown');
  expect(got.before.hasField).toBe(false);
  expect(got.after).toBe('chicken');
  expect(got.stored).toBe('chicken');
  expect(got.sameRecord).toBe(true);
  expect(got.name).toBe('Landers Lechon Manok'); // untouched, and still never read
  expect(got.portions).toBe(4);
  expect(got.cookedDate).toBe('2026-08-25');
});

test('2. a wrong explicit choice can be corrected — Chicken to Beef', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate((m) => {
    AppState.recipes = [];
    AppState.cookedMeals = [m];
    setCookedProteinType('cm_1', 'beef');
    return {
      stored: AppState.cookedMeals[0].proteinType,
      resolved: getCookedMealProteinType(AppState.cookedMeals[0])
    };
  }, batch({ proteinType: 'chicken' }));
  expect(got.stored).toBe('beef');
  expect(got.resolved).toBe('beef');
});

test('11. a legacy pre-wave batch is classified without recreating it', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => {
    AppState.recipes = [];
    // Exactly the pre-wave shape: no proteinType, no portion fields at all.
    AppState.cookedMeals = [{
      id: 'cm_legacy', recipeId: null, name: 'Old tupperware',
      cookedDate: '2026-08-20', storage: 'fridge', fridgeLife: 3, freezerLife: 30
    }];
    const beforeKeys = Object.keys(AppState.cookedMeals[0]).slice();
    setCookedProteinType('cm_legacy', 'pork');
    const rec = AppState.cookedMeals[0];
    return {
      beforeHadProtein: beforeKeys.indexOf('proteinType') >= 0,
      resolved: getCookedMealProteinType(rec),
      id: rec.id,
      // Still untracked for portions — classifying must not invent a portion count.
      tracksPortions: cookedMealTracksPortions(rec)
    };
  });
  expect(got.beforeHadProtein).toBe(false);
  expect(got.resolved).toBe('pork');
  expect(got.id).toBe('cm_legacy');
  expect(got.tracksPortions).toBe(false);
});

test('a correction stamps updatedAt so it wins last-write-wins against an older cloud copy', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate((m) => {
    AppState.recipes = [];
    AppState.cookedMeals = [m];
    const before = AppState.cookedMeals[0].updatedAt;
    setCookedProteinType('cm_1', 'tofu');
    return { before: before, after: AppState.cookedMeals[0].updatedAt };
  }, batch({ updatedAt: '2020-01-01T00:00:00.000Z' }));
  expect(got.before).toBe('2020-01-01T00:00:00.000Z');
  expect(new Date(got.after).getTime()).toBeGreaterThan(new Date(got.before).getTime());
});

test('correcting an id that does not exist is a no-op, not a new record', async ({ page }) => {
  await loadOffline(page);
  const count = await page.evaluate((m) => {
    AppState.cookedMeals = [m];
    setCookedProteinType('cm_does_not_exist', 'beef');
    return { n: AppState.cookedMeals.length, stored: AppState.cookedMeals[0].proteinType };
  }, batch({}));
  expect(count.n).toBe(1);
  expect(count.stored).toBeUndefined();
});

// ── 9, 14. Auto / Unknown semantics ──────────────────────────────────────────

test('9,14. clearing the selection REMOVES the field rather than persisting "unknown"', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate((m) => {
    AppState.recipes = [];
    AppState.cookedMeals = [m];
    setCookedProteinType('cm_1', '');
    const rec = AppState.cookedMeals[0];
    return {
      hasField: 'proteinType' in rec,
      resolved: getCookedMealProteinType(rec),
      // and nothing 'unknown'-shaped got written anywhere on the record
      serialised: JSON.stringify(rec).indexOf('unknown') >= 0
    };
  }, batch({ proteinType: 'chicken' }));
  expect(got.hasField).toBe(false);   // absence IS the representation of unknown
  expect(got.resolved).toBe('unknown');
  expect(got.serialised).toBe(false);
});

test('9. clearing a recipe-backed batch returns it to recipe-derived identity', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => {
    AppState.recipes = [{
      id: 950, name: 'Chicken Adobo', category: 'Dinner', baseServings: 2, currentServings: 2,
      basePrepTime: 10, baseCookTime: 20, fridgeLife: 3, freezerLife: 30, instructions: 'x',
      baseIngredients: [{ name: 'Chicken Thigh', baseQuantity: 200, unit: 'g', category: 'Protein' }]
    }];
    AppState.cookedMeals = [{
      id: 'cm_1', recipeId: '950', name: 'Adobo batch', proteinType: 'beef',
      cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 3, freezerLife: 30
    }];
    const pinned = getCookedMealProteinType(AppState.cookedMeals[0]);
    setCookedProteinType('cm_1', '');
    return {
      pinned: pinned,
      cleared: getCookedMealProteinType(AppState.cookedMeals[0]),
      hasField: 'proteinType' in AppState.cookedMeals[0]
    };
  });
  expect(got.pinned).toBe('beef');      // the override was in force
  expect(got.hasField).toBe(false);     // and is now gone, not set to 'unknown'
  expect(got.cleared).toBe('chicken');  // so the recipe answers again
});

test('the Auto option names the derived answer instead of pretending it is unknown', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => {
    const mk = (id, ings) => ({
      id: id, name: 'r' + id, category: 'Dinner', baseServings: 2, currentServings: 2,
      basePrepTime: 5, baseCookTime: 5, fridgeLife: 3, freezerLife: 30, instructions: 'x',
      baseIngredients: ings.map((x) => ({ name: x[0], baseQuantity: 1, unit: 'g', category: x[1] }))
    });
    AppState.recipes = [
      mk(960, [['Chicken Thigh', 'Protein']]),
      mk(961, [['Beef Sirloin', 'Protein'], ['Eggs', 'Protein']]),   // mixed
      mk(962, [['Cabbage (Repolyo)', 'Vegetable']]),                 // none
      mk(963, [['Longganisa', 'Protein']])                           // unidentifiable -> unknown
    ];
    const at = (recipeId) => cookedProteinAutoLabel({ id: 'x', recipeId: recipeId, name: 'Beef Stew' });
    return {
      chicken: at('960'),
      mixed: at('961'),
      none: at('962'),
      unidentifiable: at('963'),
      dangling: at('999999'),                                     // recipe deleted
      manual: cookedProteinAutoLabel({ id: 'x', recipeId: null, name: 'Beef Stew' })
    };
  });
  expect(got.chicken).toBe('Auto · Chicken');
  expect(got.mixed).toBe('Auto · Mixed');
  expect(got.none).toBe('Auto · No protein');
  // Nothing to derive: the honest label is plain Unknown, and the NAME "Beef Stew"
  // is not consulted in any of these cases.
  expect(got.unidentifiable).toBe('Unknown');
  expect(got.dangling).toBe('Unknown');
  expect(got.manual).toBe('Unknown');
});

// ── 6, 7, 8, 10. Recipe-edit temporal truth ──────────────────────────────────

test('CHARACTERIZATION: an UNPINNED recipe-backed batch follows a later recipe edit', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => {
    AppState.recipes = [{
      id: 970, name: 'House special', category: 'Dinner', baseServings: 2, currentServings: 2,
      basePrepTime: 10, baseCookTime: 20, fridgeLife: 3, freezerLife: 30, instructions: 'x',
      baseIngredients: [{ name: 'Chicken Thigh', baseQuantity: 200, unit: 'g', category: 'Protein' }]
    }];
    AppState.cookedMeals = [{
      id: 'cm_1', recipeId: '970', name: 'House special batch',
      cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 3, freezerLife: 30
    }];
    const beforeEdit = getCookedMealProteinType(AppState.cookedMeals[0]);
    AppState.recipes[0].baseIngredients = [
      { name: 'Beef Brisket', baseQuantity: 200, unit: 'g', category: 'Protein' }
    ];
    return {
      beforeEdit: beforeEdit,
      afterEdit: getCookedMealProteinType(AppState.cookedMeals[0]),
      stored: AppState.cookedMeals[0].proteinType
    };
  });
  // This is the CURRENT, DELIBERATE behaviour, pinned so a future change to it is a
  // decision rather than an accident. Derived identity is read live and never copied
  // onto the batch, so editing the recipe retroactively changes what last week's
  // leftovers report. The correction control is the user's remedy — see the next test.
  expect(got.beforeEdit).toBe('chicken');
  expect(got.afterEdit).toBe('beef');
  expect(got.stored).toBeUndefined(); // nothing was silently snapshotted
});

test('6,8. pinning a recipe-derived Chicken freezes it against a later recipe edit', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => {
    AppState.recipes = [{
      id: 971, name: 'House special', category: 'Dinner', baseServings: 2, currentServings: 2,
      basePrepTime: 10, baseCookTime: 20, fridgeLife: 3, freezerLife: 30, instructions: 'x',
      baseIngredients: [{ name: 'Chicken Thigh', baseQuantity: 200, unit: 'g', category: 'Protein' }]
    }];
    AppState.cookedMeals = [{
      id: 'cm_1', recipeId: '971', name: 'House special batch',
      cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 3, freezerLife: 30
    }];
    const derived = getCookedMealProteinType(AppState.cookedMeals[0]);
    setCookedProteinType('cm_1', 'chicken');            // pin what it already says
    const pinned = getCookedMealProteinType(AppState.cookedMeals[0]);
    AppState.recipes[0].baseIngredients = [
      { name: 'Beef Brisket', baseQuantity: 200, unit: 'g', category: 'Protein' }
    ];
    return {
      derived: derived,
      pinned: pinned,
      stored: AppState.cookedMeals[0].proteinType,
      afterRecipeEdit: getCookedMealProteinType(AppState.cookedMeals[0]),
      recipeNowSays: recipeProteinType(AppState.recipes[0])
    };
  });
  expect(got.derived).toBe('chicken');
  expect(got.pinned).toBe('chicken');
  expect(got.stored).toBe('chicken');       // now explicit, not derived
  expect(got.recipeNowSays).toBe('beef');   // the recipe genuinely changed
  expect(got.afterRecipeEdit).toBe('chicken'); // the historical batch did not
});

test('7. a recipe-derived Chicken can be explicitly overridden to Beef', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => {
    AppState.recipes = [{
      id: 972, name: 'Adobo', category: 'Dinner', baseServings: 2, currentServings: 2,
      basePrepTime: 10, baseCookTime: 20, fridgeLife: 3, freezerLife: 30, instructions: 'x',
      baseIngredients: [{ name: 'Chicken Thigh', baseQuantity: 200, unit: 'g', category: 'Protein' }]
    }];
    AppState.cookedMeals = [{
      id: 'cm_1', recipeId: '972', name: 'Adobo batch',
      cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 3, freezerLife: 30
    }];
    setCookedProteinType('cm_1', 'beef');
    return {
      resolved: getCookedMealProteinType(AppState.cookedMeals[0]),
      recipeStillSays: recipeProteinType(AppState.recipes[0])
    };
  });
  expect(got.recipeStillSays).toBe('chicken');
  expect(got.resolved).toBe('beef'); // explicit wins over derivation, permanently
});

test('10. a dangling recipeId with no explicit value stays unknown after a correction is cleared', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => {
    AppState.recipes = []; // recipe deleted after the batch was cooked
    AppState.cookedMeals = [{
      id: 'cm_1', recipeId: '99999', name: 'Chicken Inasal leftovers',
      cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 3, freezerLife: 30
    }];
    const start = getCookedMealProteinType(AppState.cookedMeals[0]);
    setCookedProteinType('cm_1', 'chicken');
    const pinned = getCookedMealProteinType(AppState.cookedMeals[0]);
    setCookedProteinType('cm_1', '');
    return { start: start, pinned: pinned, cleared: getCookedMealProteinType(AppState.cookedMeals[0]) };
  });
  expect(got.start).toBe('unknown');
  expect(got.pinned).toBe('chicken');
  expect(got.cleared).toBe('unknown'); // NOT the name, which says "Chicken Inasal"
});

// ── 18. The name is still never parsed, including through the new path ───────

test('18. correction never reads the name — three trap names stay unknown until chosen', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => {
    AppState.recipes = [];
    const names = ['Landers Lechon Manok', 'Chicken of the Sea', 'Beef Stew'];
    AppState.cookedMeals = names.map((n, i) => ({
      id: 'cm_' + i, recipeId: null, name: n,
      cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 3, freezerLife: 30
    }));

    // Rendering the correction control must not classify anything by itself.
    renderCookedMeals();
    const afterRender = AppState.cookedMeals.map((m) => [m.name, getCookedMealProteinType(m)]);
    const anyStored = AppState.cookedMeals.some((m) => 'proteinType' in m);
    const autoLabels = AppState.cookedMeals.map((m) => cookedProteinAutoLabel(m));

    // Only an explicit user action changes it, and only for the one batch acted on.
    setCookedProteinType('cm_1', 'tuna');
    const afterChoice = AppState.cookedMeals.map((m) => [m.name, getCookedMealProteinType(m)]);
    return { afterRender: afterRender, anyStored: anyStored, autoLabels: autoLabels, afterChoice: afterChoice };
  });

  expect(got.afterRender).toEqual([
    ['Landers Lechon Manok', 'unknown'],
    ['Chicken of the Sea', 'unknown'],
    ['Beef Stew', 'unknown']
  ]);
  expect(got.anyStored).toBe(false);
  expect(got.autoLabels).toEqual(['Unknown', 'Unknown', 'Unknown']);
  expect(got.afterChoice).toEqual([
    ['Landers Lechon Manok', 'unknown'],
    ['Chicken of the Sea', 'tuna'],   // the user said so; the name says chicken
    ['Beef Stew', 'unknown']
  ]);
});

test('17. exact ingredient matching still holds — no substring inference crept in', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => ({
    // Names that CONTAIN a curated ingredient name but are not it.
    containing: [
      'Chicken Thigh Marinade', 'Beef Bouillon Cube', 'Tuna-flavoured cat food',
      'Salmon-coloured icing', 'Vegan Chicken Breast Substitute', 'Eggsalad'
    ].map((n) => [n, proteinFamilyForIngredientName(n)]),
    // The curated names themselves still match, case- and space-insensitively.
    exact: [
      'Chicken Thigh', 'chicken thigh', '  Chicken Thigh  ', 'BEEF BRISKET'
    ].map((n) => [n, proteinFamilyForIngredientName(n)]),
    junk: [null, undefined, 123, {}, []].map((v) => proteinFamilyForIngredientName(v))
  }));
  got.containing.forEach(([n, fam]) => expect(fam, n).toBeNull());
  expect(got.exact).toEqual([
    ['Chicken Thigh', 'chicken'], ['chicken thigh', 'chicken'],
    ['  Chicken Thigh  ', 'chicken'], ['BEEF BRISKET', 'beef']
  ]);
  got.junk.forEach((fam) => expect(fam).toBeNull());
});

// ── 16. Category normalisation ───────────────────────────────────────────────

test('16. an imported Protein category is read through whitespace and case', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => {
    // 'Longganisa' is deliberately unmapped, so a recipe declaring it as a Protein
    // must resolve unknown. That only happens if the CATEGORY string is recognised —
    // which makes this the sharpest probe for category normalisation.
    const forCategory = (cat) => recipeProteinType({
      id: 1, name: 'Imported dish',
      baseIngredients: [
        { name: 'Longganisa', baseQuantity: 1, unit: 'pc', category: cat },
        { name: 'Garlic (Bawang)', baseQuantity: 1, unit: 'g', category: 'Vegetable' }
      ]
    });
    return {
      canonical: forCategory('Protein'),
      padded: forCategory(' Protein '),
      lower: forCategory('protein'),
      upper: forCategory('PROTEIN'),
      tabbed: forCategory('\tProtein\n'),
      // NOT normalised into 'protein' — these are different categories, and reading
      // them as protein would be inference from category TEXT, not normalisation.
      proteins: forCategory('Proteins'),
      proteinRich: forCategory('Protein-rich'),
      vegetable: forCategory('Vegetable'),
      missing: forCategory(undefined)
    };
  });
  expect(got.canonical).toBe('unknown');
  expect(got.padded).toBe('unknown');
  expect(got.lower).toBe('unknown');
  expect(got.upper).toBe('unknown');
  expect(got.tabbed).toBe('unknown');
  // The unmapped ingredient is no longer seen as a declared protein, so the recipe
  // reads as meatless. That is the honest read of a category we do not know.
  expect(got.proteins).toBe('none');
  expect(got.proteinRich).toBe('none');
  expect(got.vegetable).toBe('none');
  expect(got.missing).toBe('none');
});

test('16. category normalisation does not change any IDENTIFIABLE recipe outcome', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => {
    const mk = (cat) => recipeProteinType({
      id: 1, name: 'x',
      baseIngredients: [{ name: 'Chicken Thigh', baseQuantity: 1, unit: 'g', category: cat }]
    });
    // A name we CAN identify wins regardless of category spelling — the family comes
    // from the exact name table, and the category only ever gates the unknown branch.
    return [' Protein ', 'protein', 'PROTEIN', 'Vegetable', '', null].map(mk);
  });
  expect(got).toEqual(['chicken', 'chicken', 'chicken', 'chicken', 'chicken', 'chicken']);
});

// ── 12, 13, 15. Stored value validation ──────────────────────────────────────

test('12. non-string persisted proteinType values are dropped, never coerced', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => {
    const meals = [
      { id: 'num', proteinType: 1 },
      { id: 'zero', proteinType: 0 },
      { id: 'bool', proteinType: true },
      { id: 'arr', proteinType: ['chicken'] },              // stringifies to 'chicken'
      { id: 'obj', proteinType: { id: 'chicken' } },
      { id: 'toStr', proteinType: { toString: function() { return 'chicken'; } } },
      { id: 'strObj', proteinType: new String('chicken') }, // typeof 'object'
      { id: 'nested', proteinType: [['beef']] },
      { id: 'empty', proteinType: '' },
      { id: 'space', proteinType: ' chicken' },
      { id: 'case', proteinType: 'Chicken' },               // vocabulary is lowercase ids
      { id: 'random', proteinType: 'unicorn' },
      { id: 'ok', proteinType: 'chicken' }
    ];
    normalizeCookedMeals(meals);
    return meals.map((m) => [m.id, 'proteinType' in m ? m.proteinType : 'DROPPED']);
  });
  expect(got).toEqual([
    ['num', 'DROPPED'], ['zero', 'DROPPED'], ['bool', 'DROPPED'],
    ['arr', 'DROPPED'], ['obj', 'DROPPED'], ['toStr', 'DROPPED'], ['strObj', 'DROPPED'],
    ['nested', 'DROPPED'], ['empty', 'DROPPED'], ['space', 'DROPPED'], ['case', 'DROPPED'],
    ['random', 'DROPPED'], ['ok', 'chicken']
  ]);
});

test('a dropped non-string value resolves unknown rather than the coerced lookalike', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => {
    AppState.recipes = [];
    const m = { id: 'cm_1', recipeId: null, name: 'Beef Stew', proteinType: ['chicken'] };
    return {
      beforeNormalise: getCookedMealProteinType(m), // must not read as 'chicken'
      afterNormalise: (normalizeCookedMeal(m), getCookedMealProteinType(m))
    };
  });
  expect(got.beforeNormalise).toBe('unknown');
  expect(got.afterNormalise).toBe('unknown');
});

test('13. mixed is not accepted as an explicit selection, from the UI or from storage', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => {
    AppState.recipes = [];
    AppState.cookedMeals = [{
      id: 'cm_1', recipeId: null, name: 'Tapsilog leftovers', proteinType: 'chicken',
      cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 3, freezerLife: 30
    }];
    setCookedProteinType('cm_1', 'mixed');   // rejected outright
    const afterAttempt = AppState.cookedMeals[0].proteinType;
    const persisted = [{ id: 'p', proteinType: 'mixed' }];
    normalizeCookedMeals(persisted);
    return {
      afterAttempt: afterAttempt,
      persisted: 'proteinType' in persisted[0],
      inChoices: COOKED_PROTEIN_CHOICE_IDS.indexOf('mixed') >= 0,
      offeredInUi: Array.from(
        document.querySelectorAll('#manual-cooked-protein option')
      ).map((o) => o.value).indexOf('mixed') >= 0
    };
  });
  // A rejected value must not clear the pin the user already made.
  expect(got.afterAttempt).toBe('chicken');
  expect(got.persisted).toBe(false);
  expect(got.inChoices).toBe(false);
  expect(got.offeredInUi).toBe(false);
});

test('14. "unknown" is likewise never a stored value or an offered option', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => {
    AppState.recipes = [];
    AppState.cookedMeals = [{ id: 'cm_1', recipeId: null, name: 'x', proteinType: 'beef' }];
    setCookedProteinType('cm_1', 'unknown');
    const persisted = [{ id: 'p', proteinType: 'unknown' }];
    normalizeCookedMeals(persisted);
    return {
      afterAttempt: AppState.cookedMeals[0].proteinType,
      persisted: 'proteinType' in persisted[0],
      inChoices: COOKED_PROTEIN_CHOICE_IDS.indexOf('unknown') >= 0,
      offeredInUi: Array.from(
        document.querySelectorAll('#manual-cooked-protein option')
      ).map((o) => o.value).indexOf('unknown') >= 0
    };
  });
  expect(got.afterAttempt).toBe('beef');
  expect(got.persisted).toBe(false);
  expect(got.inChoices).toBe(false);
  expect(got.offeredInUi).toBe(false);
});

test('15. none IS a valid explicit meatless selection and survives a correction', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => {
    AppState.recipes = [];
    AppState.cookedMeals = [{ id: 'cm_1', recipeId: null, name: 'Veg curry', proteinType: 'chicken' }];
    setCookedProteinType('cm_1', 'none');
    return {
      stored: AppState.cookedMeals[0].proteinType,
      resolved: getCookedMealProteinType(AppState.cookedMeals[0]),
      inChoices: COOKED_PROTEIN_CHOICE_IDS.indexOf('none') >= 0,
      // 'none' is an ANSWER, but not a family — it must not join to any flavor.
      flavorJoin: flavorsForProteinType('none').length
    };
  });
  expect(got.stored).toBe('none');
  expect(got.resolved).toBe('none');
  expect(got.inChoices).toBe(true);
  expect(got.flavorJoin).toBe(0);
});

// ── 19. Vocabulary drift ─────────────────────────────────────────────────────

test('19. the cooked-protein vocabulary is pinned exactly and cannot drift silently', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => ({
    cooked: COOKED_PROTEIN_IDS.slice(),
    choices: COOKED_PROTEIN_CHOICE_IDS.slice(),
    flavor: FLAVOR_PROTEINS.map((p) => p.id),
    labels: COOKED_PROTEIN_CHOICES.map((c) => c.label),
    none: COOKED_PROTEIN_NONE, mixed: COOKED_PROTEIN_MIXED, unknown: COOKED_PROTEIN_UNKNOWN
  }));

  // (a) The exact set, pinned. Adding, removing or reordering a cooked protein id is
  //     a product decision about what Meal Lego can join on, so it must fail here
  //     first. The subset check below cannot catch a NEW id that happens to be a
  //     legal flavor target — 'vegetables' and 'rice' are exactly that hazard.
  expect(got.cooked).toEqual(
    ['chicken', 'pork', 'beef', 'fish', 'salmon', 'tuna', 'shrimp', 'egg', 'tofu']);

  // (b) Every selectable cooked protein is valid Flavor Library compatibility
  //     vocabulary, so the Meal Lego join stays a direct lookup.
  expect(got.cooked.filter((id) => got.flavor.indexOf(id) < 0)).toEqual([]);

  // (c) ...but the reverse is NOT required. Compatibility targets are deliberately
  //     not protein identities: "what protein is this?" is never answered "rice".
  expect(got.flavor.filter((id) => got.cooked.indexOf(id) < 0)).toEqual(['vegetables', 'rice']);

  // (d) The persisted vocabulary is the families plus 'none' — and nothing else.
  expect(got.choices).toEqual(got.cooked.concat(['none']));

  // (e) none / mixed / unknown are intentionally outside the family list; mixed and
  //     unknown are additionally outside the PERSISTED list.
  [got.none, got.mixed, got.unknown].forEach((v) => expect(got.cooked).not.toContain(v));
  expect(got.choices).toContain(got.none);
  expect(got.choices).not.toContain(got.mixed);
  expect(got.choices).not.toContain(got.unknown);

  // (f) Labels come from FLAVOR_PROTEINS, so a relabel there cannot leave the two
  //     surfaces disagreeing.
  expect(got.labels).toEqual(
    ['Chicken', 'Pork', 'Beef', 'Fish', 'Salmon', 'Tuna', 'Shrimp', 'Egg', 'Tofu',
     'No protein (meatless)']);
});

test('19. the add-form selector is generated from the vocabulary, not written out twice', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => {
    const opts = Array.from(document.querySelectorAll('#manual-cooked-protein option'));
    return {
      values: opts.map((o) => o.value),
      labels: opts.map((o) => o.textContent.trim()),
      codeIds: COOKED_PROTEIN_CHOICE_IDS.slice(),
      codeLabels: COOKED_PROTEIN_CHOICES.map((c) => c.label),
      // index.html must carry no option markup of its own any more.
      inlineOptionsInMarkup: document.getElementById('manual-cooked-protein')
        .getAttribute('data-static-options')
    };
  });
  expect(got.values).toEqual([''].concat(got.codeIds));
  expect(got.labels).toEqual(['Unknown'].concat(got.codeLabels));
  expect(got.inlineOptionsInMarkup).toBeNull();
});

test('19. the card selector offers exactly the same vocabulary as the add form', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => {
    AppState.recipes = [];
    AppState.cookedMeals = [{
      id: 'cm_1', recipeId: null, name: 'Beef Stew', proteinType: 'tofu',
      cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 3, freezerLife: 30
    }];
    renderCookedMeals();
    const sel = document.querySelector('#cooked-meals-list .cooked-protein-field select');
    const opts = Array.from(sel.options);
    return {
      values: opts.map((o) => o.value),
      selected: sel.value,
      addFormValues: Array.from(document.querySelectorAll('#manual-cooked-protein option')).map((o) => o.value)
    };
  });
  expect(got.values).toEqual(got.addFormValues);
  expect(got.selected).toBe('tofu'); // reflects what is actually stored
});

// ── 25. The correction control on a phone ────────────────────────────────────

test('25. the correction control adds no horizontal overflow at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await loadOffline(page);
  const got = await page.evaluate(() => {
    AppState.recipes = [{
      id: 980, name: 'Veg curry', category: 'Dinner', baseServings: 2, currentServings: 2,
      basePrepTime: 5, baseCookTime: 5, fridgeLife: 3, freezerLife: 30, instructions: 'x',
      baseIngredients: [{ name: 'Cabbage (Repolyo)', baseQuantity: 1, unit: 'g', category: 'Vegetable' }]
    }];
    // Longest realistic label ("Auto · No protein") on a long-named tracked batch.
    AppState.cookedMeals = [{
      id: 'cm_1', recipeId: '980', name: 'Leftover vegetable curry with rice and egg',
      cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 3, freezerLife: 30,
      initialPortions: 6, portionsRemaining: 6
    }];
    renderCookedMeals();
    const card = document.querySelector('#cooked-meals-list .cooked-card');
    const sel = card.querySelector('.cooked-protein-field select');
    return {
      autoLabel: sel.options[0].textContent.trim(),
      cardRight: Math.ceil(card.getBoundingClientRect().right),
      selRight: Math.ceil(sel.getBoundingClientRect().right),
      docScrollW: document.documentElement.scrollWidth,
      docClientW: document.documentElement.clientWidth,
      listScrollW: document.getElementById('cooked-meals-list').scrollWidth,
      listClientW: document.getElementById('cooked-meals-list').clientWidth
    };
  });
  expect(got.autoLabel).toBe('Auto · No protein');
  expect(got.docScrollW).toBeLessThanOrEqual(got.docClientW);
  expect(got.listScrollW).toBeLessThanOrEqual(got.listClientW);
  expect(got.selRight).toBeLessThanOrEqual(got.cardRight);
});

// ── Persistence (existing generic cookedMeals paths only) ────────────────────

test('3. a correction survives save + reload', async ({ page }) => {
  await loadOffline(page);
  await page.evaluate(() => {
    AppState.recipes = [];
    AppState.cookedMeals = [{
      id: 'cm_fix', recipeId: null, name: 'Landers Lechon Manok',
      cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 3, freezerLife: 30,
      initialPortions: 4, portionsRemaining: 4
    }];
    saveData();
    setCookedProteinType('cm_fix', 'chicken'); // saveData() runs inside
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForRestored(page, () => AppState.cookedMeals.some((m) => m.id === 'cm_fix'));
  const got = await page.evaluate(() => {
    const m = AppState.cookedMeals.find((x) => x.id === 'cm_fix');
    return { stored: m.proteinType, resolved: getCookedMealProteinType(m) };
  });
  expect(got.stored).toBe('chicken');
  expect(got.resolved).toBe('chicken');
});

test('3. clearing a correction survives save + reload as an ABSENT field', async ({ page }) => {
  await loadOffline(page);
  await page.evaluate(() => {
    AppState.recipes = [];
    AppState.cookedMeals = [{
      id: 'cm_clear', recipeId: null, name: 'Beef Stew', proteinType: 'beef',
      cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 3, freezerLife: 30
    }];
    saveData();
    setCookedProteinType('cm_clear', '');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForRestored(page, () => AppState.cookedMeals.some((m) => m.id === 'cm_clear'));
  const got = await page.evaluate(() => {
    const m = AppState.cookedMeals.find((x) => x.id === 'cm_clear');
    return { hasField: 'proteinType' in m, resolved: getCookedMealProteinType(m) };
  });
  expect(got.hasField).toBe(false);   // the clear PERSISTED; it did not come back
  expect(got.resolved).toBe('unknown');
});

test('4. a correction reaches the Firestore payload and a cloud load restores it', async ({ page }) => {
  await loadSignedIn(page, { cloudDoc: {
    version: 3,
    recipes: [], pantry: [], customIngredients: [], customHacks: [], flavors: [], userIngredients: [],
    cookedMeals: [{
      id: 'cm_cloudfix', recipeId: null, name: 'Chicken of the Sea',
      cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 3, freezerLife: 30
    }],
    deletions: {}
  } });

  const before = await page.evaluate(() =>
    getCookedMealProteinType(AppState.cookedMeals.find((x) => x.id === 'cm_cloudfix')));
  expect(before).toBe('unknown');

  const got = await page.evaluate(async () => {
    setCookedProteinType('cm_cloudfix', 'tuna');
    await new Promise((r) => setTimeout(r, 400)); // let the cloud write settle
    const payload = buildFirestorePayload();
    const written = window.__writes[window.__writes.length - 1] || {};
    const pick = (doc) => ((doc.cookedMeals || []).find((x) => x.id === 'cm_cloudfix') || {}).proteinType;
    return { payload: pick(payload), written: pick(written) };
  });
  expect(got.payload).toBe('tuna');
  expect(got.written).toBe('tuna');
});

test('4. a cloud copy carrying an invalid proteinType loads as unknown, not coerced', async ({ page }) => {
  await loadSignedIn(page, { cloudDoc: {
    version: 3,
    recipes: [], pantry: [], customIngredients: [], customHacks: [], flavors: [], userIngredients: [],
    cookedMeals: [{
      id: 'cm_bad', recipeId: null, name: 'Beef Stew', proteinType: ['chicken'],
      cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 3, freezerLife: 30
    }],
    deletions: {}
  } });
  const got = await page.evaluate(() => {
    const m = AppState.cookedMeals.find((x) => x.id === 'cm_bad');
    return { hasField: 'proteinType' in m, resolved: getCookedMealProteinType(m) };
  });
  expect(got.hasField).toBe(false);
  expect(got.resolved).toBe('unknown');
});

test('4. the sign-in union merge keeps a corrected batch', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => {
    // unionByIdLWW(cloudArr, localArr) is exactly what loadUserData() runs over
    // cookedMeals at sign-in, followed by normalizeCookedMeals().
    const cloud = [{ id: 'cm_u', name: 'Beef Stew', updatedAt: '2026-08-20T10:00:00.000Z' }];
    const local = [{ id: 'cm_u', name: 'Beef Stew', proteinType: 'tuna', updatedAt: '2026-08-26T10:00:00.000Z' }];
    const merged = normalizeCookedMeals(unionByIdLWW(cloud, local, { localWins: 0 }));

    // ...and the reverse: a stale local copy must not undo a newer cloud correction.
    const cloud2 = [{ id: 'cm_v', name: 'Beef Stew', proteinType: 'beef', updatedAt: '2026-08-26T10:00:00.000Z' }];
    const local2 = [{ id: 'cm_v', name: 'Beef Stew', updatedAt: '2026-08-20T10:00:00.000Z' }];
    const merged2 = normalizeCookedMeals(unionByIdLWW(cloud2, local2, { localWins: 0 }));

    return {
      n: merged.length, stored: merged[0].proteinType,
      n2: merged2.length, stored2: merged2[0].proteinType
    };
  });
  expect(got.n).toBe(1);
  expect(got.stored).toBe('tuna');  // the newer local correction wins LWW
  expect(got.n2).toBe(1);
  expect(got.stored2).toBe('beef'); // the newer cloud correction wins LWW
});

test('5. export / import round-trips a correction and drops an invalid one', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => {
    AppState.recipes = [];
    AppState.cookedMeals = [
      { id: 'cm_good', recipeId: null, name: 'Landers Lechon Manok', cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 3, freezerLife: 30 },
      { id: 'cm_bad', recipeId: null, name: 'Beef Stew', proteinType: { id: 'beef' }, cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 3, freezerLife: 30 }
    ];
    setCookedProteinType('cm_good', 'chicken');

    const exported = JSON.parse(JSON.stringify({ cookedMeals: AppState.cookedMeals }));
    const snapshot = JSON.parse(JSON.stringify(snapshotData()));
    AppState.cookedMeals = [];
    AppState.cookedMeals = normalizeCookedMeals(unionById(AppState.cookedMeals, exported.cookedMeals));
    const find = (id) => AppState.cookedMeals.find((m) => m.id === id);
    return {
      exported: exported.cookedMeals[0].proteinType,
      snapshot: (snapshot.cookedMeals.find((m) => m.id === 'cm_good') || {}).proteinType,
      importedGood: find('cm_good').proteinType,
      importedBadHasField: 'proteinType' in find('cm_bad'),
      resolvedBad: getCookedMealProteinType(find('cm_bad'))
    };
  });
  expect(got.exported).toBe('chicken');
  expect(got.snapshot).toBe('chicken');
  expect(got.importedGood).toBe('chicken');
  expect(got.importedBadHasField).toBe(false);
  expect(got.resolvedBad).toBe('unknown');
});

// ── 20-24. Nothing else moved ────────────────────────────────────────────────

test('24. no new top-level AppState key and no TOMBSTONE_KEYS change', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => {
    setCookedProteinType('nope', 'chicken'); // even a no-op correction adds nothing
    return {
      keys: Object.keys(AppState).filter((k) => k !== 'localSavedAt' && k !== 'cloudSavedAt').sort(),
      proteinKeys: Object.keys(AppState).filter((k) => /protein/i.test(k)),
      tombstoneKeys: TOMBSTONE_KEYS.slice()
    };
  });
  expect(got.keys).toEqual([
    'cloudReady', 'cookHistory', 'cookedMeals', 'currentEditingFlavor',
    'currentEditingHack', 'currentEditingIngredient', 'currentEditingRecipe', 'currentUser',
    'customHacks', 'customIngredients', 'customStores', 'dataVersion', 'deletions', 'flavors',
    // 'preparedFlavors' is Flavor Bomb v1's prepared-stock collection (D-074), a
    // LATER, separately owner-approved wave — not something this protein-identity
    // correction introduces. Listed here rather than loosening the check.
    'preparedFlavors',
    // 'inventoryVerifiedAt' is a single scalar timestamp (D-075), a LATER,
    // separately owner-approved wave — not something this protein-identity
    // correction introduces.
    'inventoryVerifiedAt',
    // 'mealConsumptions' is the append-only consumption fact log (Life Ledger
    // adapter work), a LATER, separately owner-approved wave — not something
    // this protein-identity correction introduces.
    'mealConsumptions',
    'groceryList', 'ingredientPrices', 'isOnline', 'myStores', 'nutritionGoals', 'pantry',
    'prepModeSession', 'profile', 'recentRecipes', 'recipes', 'selectedPlannerDays',
    'selectedRecipeForPlanning', 'syncStatus', 'userIngredients', 'weeklyPlan'
  ].sort());
  expect(got.proteinKeys).toEqual([]);
  expect(got.tombstoneKeys).toEqual([
    'recipes', 'pantry', 'customIngredients', 'customHacks', 'flavors', 'preparedFlavors', 'cookedMeals', 'userIngredients'
  ]);
});

test('20,21. Ready Food and What Should We Eat ranking are unchanged by corrections', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => {
    const build = () => ([
      { id: 'r1', name: 'Freezer batch', cookedDate: '2026-08-20', storage: 'freezer', freezerLife: 90, fridgeLife: 3, initialPortions: 4, portionsRemaining: 4 },
      { id: 'r2', name: 'Use soon', cookedDate: '2026-08-24', storage: 'fridge', fridgeLife: 3, initialPortions: 2, portionsRemaining: 1 },
      { id: 'r3', name: 'Plenty left', cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 30, initialPortions: 6, portionsRemaining: 6 }
    ]);
    AppState.recipes = [];
    AppState.cookedMeals = build();
    // Both surfaces rank through getReadyFoodSuggestions(); What Should We Eat has no
    // second ranker, so ordering AND the rendered names are both pinned here.
    const readyBefore = getReadyFoodSuggestions().map((m) => m.id);
    const metaBefore = getReadyFoodSuggestions().map((m) => readyFoodMetaLine(m));

    ['chicken', 'beef', 'none'].forEach((p, i) => setCookedProteinType('r' + (i + 1), p));

    const readyAfter = getReadyFoodSuggestions().map((m) => m.id);
    const metaAfter = getReadyFoodSuggestions().map((m) => readyFoodMetaLine(m));
    return { readyBefore, readyAfter, metaBefore, metaAfter };
  });
  expect(got.readyBefore).toEqual(['r2', 'r3', 'r1']);
  expect(got.readyAfter).toEqual(got.readyBefore);
  expect(got.metaAfter).toEqual(got.metaBefore);
});

test('23. Used 1 still decrements exactly one portion on a corrected batch', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => {
    AppState.recipes = [];
    AppState.cookedMeals = [{
      id: 'cm_1', recipeId: null, name: 'Beef Stew', cookedDate: '2026-08-25',
      storage: 'fridge', fridgeLife: 30, freezerLife: 90, initialPortions: 4, portionsRemaining: 4
    }];
    setCookedProteinType('cm_1', 'beef');
    useCookedPortion('cm_1');
    const m = AppState.cookedMeals.find((x) => x.id === 'cm_1');
    return { remaining: m.portionsRemaining, initial: m.initialPortions, protein: m.proteinType };
  });
  expect(got.remaining).toBe(3);
  expect(got.initial).toBe(4);
  expect(got.protein).toBe('beef'); // and the correction rode along untouched
});

test('22. Flavor Library CRUD is unchanged', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(() => {
    AppState.flavors = [];
    const before = AppState.flavors.length;
    AppState.flavors.push({
      id: 'fl_1', name: 'Garlic soy glaze', worksWith: ['chicken', 'pork', 'vegetables'],
      tags: [], updatedAt: new Date().toISOString()
    });
    const joinedChicken = flavorsForProteinType('chicken').map((f) => f.id);
    const joinedVeg = flavorsForProteinType('vegetables').map((f) => f.id);
    AppState.flavors = AppState.flavors.filter((f) => f.id !== 'fl_1');
    return { before: before, joinedChicken: joinedChicken, joinedVeg: joinedVeg, after: AppState.flavors.length };
  });
  expect(got.before).toBe(0);
  expect(got.joinedChicken).toEqual(['fl_1']);
  // 'vegetables' is a legal worksWith target but NOT a cooked protein identity, so the
  // cooked-side join refuses it. That asymmetry is the point of the vocabulary split.
  expect(got.joinedVeg).toEqual([]);
  expect(got.after).toBe(0);
});

test('26. correcting, clearing and re-correcting raises no page or console errors', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await loadOffline(page);
  await page.evaluate(() => {
    AppState.recipes = [{
      id: 990, name: 'Adobo', category: 'Dinner', baseServings: 2, currentServings: 2,
      basePrepTime: 5, baseCookTime: 5, fridgeLife: 3, freezerLife: 30, instructions: 'x',
      baseIngredients: [{ name: 'Chicken Thigh', baseQuantity: 1, unit: 'g', category: ' Protein ' }]
    }];
    AppState.cookedMeals = [
      { id: 'cm_a', recipeId: '990', name: 'Adobo batch', cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 3, freezerLife: 30, initialPortions: 3, portionsRemaining: 3 },
      { id: 'cm_b', recipeId: null, name: 'Chicken of the Sea', cookedDate: '2026-08-25', storage: 'freezer', fridgeLife: 3, freezerLife: 90 }
    ];
    showTab('fridge'); // the cards live on the Fridge tab, and must be visible to click
    renderCookedMeals();
  });

  // Drive the real control, not the function behind it.
  const selects = page.locator('#cooked-meals-list .cooked-protein-field select');
  await expect(selects).toHaveCount(2);
  await selects.first().selectOption('beef');
  await selects.first().selectOption('');
  await selects.nth(1).selectOption('tuna');
  await page.evaluate(() => openManualCookedModal());
  await page.selectOption('#manual-cooked-protein', 'tofu');
  await page.evaluate(() => closeManualCookedModal());

  const state = await page.evaluate(() => AppState.cookedMeals.map(
    (m) => [m.id, 'proteinType' in m ? m.proteinType : 'ABSENT', getCookedMealProteinType(m)]));
  expect(state).toEqual([
    ['cm_a', 'ABSENT', 'chicken'],  // cleared -> derived again, via the ' Protein ' category
    ['cm_b', 'tuna', 'tuna']
  ]);
  // Same filter the identity spec uses: the harness deliberately aborts every
  // firebasejs request, so those network errors are the test setup, not the app.
  const appErrors = errors.filter(
    (e) => !/net::ERR|Failed to load resource|favicon|requestStorageAccess|frame-ancestors|google\.com/i.test(e)
  );
  expect(appErrors).toEqual([]);
});

// ── 27. P2-1: a derived family with no FLAVOR_PROTEINS label ─────────────────
//
// cookedProteinAutoLabel() used to end in an unguarded FLAVOR_PROTEIN_BY_ID[derived]
// .label. Every derived family is a FLAVOR_PROTEINS id TODAY, so it could not fire —
// but the function is called from inside renderCookedMeals()'s card builder, so the
// first batch deriving to an unlabelled family would throw mid-build and leave the
// WHOLE Fridge list blank, unrelated batches included.
//
// This manufactures exactly that mismatch the way a future edit would: a new
// PROTEIN_FAMILY_BY_INGREDIENT entry pointing at a family FLAVOR_PROTEINS has no id
// for. The mismatch is asserted to be real first, so this cannot quietly stop testing
// anything if the vocabularies change.
test('27. a derived family with no FLAVOR_PROTEINS label degrades to Unknown and leaves the Fridge list usable', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await loadOffline(page);
  const got = await page.evaluate(() => {
    // Switch to the Fridge tab FIRST, while there is nothing to render. showTab('fridge')
    // calls renderCookedMeals() itself, so doing this after the batches exist would move
    // the throw out of the try/catch below and turn a precise assertion into an opaque
    // evaluate failure.
    showTab('fridge');

    // The future change, simulated: a legitimately-derivable family with no label.
    // 'constructor' is the same hole reached through an Object.prototype key, which a
    // truthiness check alone would have rendered as 'Auto · undefined'.
    PROTEIN_FAMILY_BY_INGREDIENT['lamb shoulder'] = 'lamb';
    PROTEIN_FAMILY_BY_INGREDIENT['mystery meat'] = 'constructor';

    const mk = (id, ingName) => ({
      id: id, name: 'r' + id, category: 'Dinner', baseServings: 2, currentServings: 2,
      basePrepTime: 5, baseCookTime: 5, fridgeLife: 3, freezerLife: 30, instructions: 'x',
      baseIngredients: [{ name: ingName, baseQuantity: 1, unit: 'g', category: 'Protein' }]
    });
    AppState.recipes = [
      mk(1000, 'Lamb Shoulder'), mk(1001, 'Mystery Meat'), mk(1002, 'Chicken Thigh')
    ];
    const batch = (id, recipeId, name) => ({
      id: id, recipeId: recipeId, name: name, cookedDate: '2026-08-25',
      storage: 'fridge', fridgeLife: 3, freezerLife: 30
    });
    AppState.cookedMeals = [
      batch('cm_lamb', '1000', 'Lamb batch'),
      batch('cm_proto', '1001', 'Mystery batch'),
      batch('cm_ok', '1002', 'Adobo batch')          // the innocent bystander
    ];

    let threw = null;
    try { renderCookedMeals(); } catch (e) { threw = String(e && e.message || e); }

    const cards = Array.from(document.querySelectorAll('#cooked-meals-list .cooked-card'));
    return {
      // (a) The mismatch this test depends on is genuinely present.
      mismatch: {
        lambIsDerivable: Object.values(PROTEIN_FAMILY_BY_INGREDIENT).indexOf('lamb') >= 0,
        lambHasNoLabel: !Object.prototype.hasOwnProperty.call(FLAVOR_PROTEIN_BY_ID, 'lamb')
      },
      // (b) Rendering completed.
      threw: threw,
      cardCount: cards.length,
      // (c) Per-card: name -> the blank option's label (what cookedProteinAutoLabel returned).
      autoLabels: cards.map((c) => [
        c.querySelector('.cooked-name').textContent.trim(),
        c.querySelector('.cooked-protein-field select option').textContent.trim()
      ]),
      // (d) Derivation itself is UNCHANGED — only the label degrades. The batch is not
      //     silently reclassified as chicken, none, or anything else.
      derived: AppState.cookedMeals.map((m) => [m.id, derivedCookedProteinType(m)]),
      resolved: AppState.cookedMeals.map((m) => [m.id, getCookedMealProteinType(m)]),
      // (e) Nothing was stored on any record as a side effect of rendering.
      anyStored: AppState.cookedMeals.some((m) => 'proteinType' in m),
      // (f) The vocabulary was NOT broadened to make the label fit.
      choices: COOKED_PROTEIN_CHOICE_IDS.slice(),
      lambSelectable: isCookedProteinChoice('lamb'),
      lambFlavorJoin: flavorsForProteinType('lamb').length,
      // Guarded so a THROWN render still returns assertable data: renderCookedMeals()
      // assigns list.innerHTML last, so a mid-build throw leaves the list showing the
      // previous content and cards[] empty. The assertions below must name that, not
      // die reading a property of undefined.
      optionValues: cards.length
        ? Array.from(cards[0].querySelectorAll('.cooked-protein-field select option')).map((o) => o.value)
        : [],
      listText: document.getElementById('cooked-meals-list').textContent.trim().slice(0, 40)
    };
  });

  expect(got.mismatch).toEqual({ lambIsDerivable: true, lambHasNoLabel: true });
  expect(got.threw).toBeNull();
  expect(got.cardCount).toBe(3);                       // NOT blanked
  expect(got.listText).not.toContain('No stored meals yet');   // and not stuck on the empty state
  expect(got.autoLabels).toEqual([
    ['Lamb batch', 'Unknown'],                         // no label -> the existing non-answer
    ['Mystery batch', 'Unknown'],                      // NOT 'Auto · undefined'
    ['Adobo batch', 'Auto · Chicken']                  // unaffected neighbour still derives
  ]);
  expect(got.derived).toEqual([
    ['cm_lamb', 'lamb'], ['cm_proto', 'constructor'], ['cm_ok', 'chicken']
  ]);
  expect(got.resolved).toEqual([
    ['cm_lamb', 'lamb'], ['cm_proto', 'constructor'], ['cm_ok', 'chicken']
  ]);
  expect(got.anyStored).toBe(false);
  expect(got.choices).toEqual(
    ['chicken', 'pork', 'beef', 'fish', 'salmon', 'tuna', 'shrimp', 'egg', 'tofu', 'none']);
  expect(got.lambSelectable).toBe(false);
  expect(got.lambFlavorJoin).toBe(0);
  expect(got.optionValues).toEqual([''].concat(got.choices));

  // The card is still a working control, not just a rendered one: the user can correct
  // the batch they can no longer see a derived name for.
  const selects = page.locator('#cooked-meals-list .cooked-protein-field select');
  await expect(selects).toHaveCount(3);
  await selects.first().selectOption('beef');
  const after = await page.evaluate(() => {
    const m = AppState.cookedMeals.find((x) => x.id === 'cm_lamb');
    return {
      stored: m.proteinType,
      resolved: getCookedMealProteinType(m),
      label: document.querySelector('#cooked-meals-list .cooked-card .cooked-protein-field select option').textContent.trim(),
      cardCount: document.querySelectorAll('#cooked-meals-list .cooked-card').length
    };
  });
  expect(after.stored).toBe('beef');
  expect(after.resolved).toBe('beef');   // the pin wins over the unlabelled derivation
  expect(after.label).toBe('Unknown');   // clearing it would still fall back honestly
  expect(after.cardCount).toBe(3);

  const appErrors = errors.filter(
    (e) => !/net::ERR|Failed to load resource|favicon|requestStorageAccess|frame-ancestors|google\.com/i.test(e)
  );
  expect(appErrors).toEqual([]);
});

// ═══════════════════════════════════════════════════════════════════════════════
// P3-2 · Whole-object LWW: a newer local UNPIN beats a stale cloud explicit pin
// ═══════════════════════════════════════════════════════════════════════════════
//
// The identity contract Meal Lego consumes is cross-device. The union test above
// ("4. the sign-in union merge keeps a corrected batch") covers newer-local-PIN
// and newer-cloud-PIN. The case most likely to surprise a future edit — and the
// one Meal Lego leans on once pins matter across devices — is newer-local-UNPIN
// (proteinType deleted via Auto) racing a stale cloud copy that still carries a
// pin.
//
// A prior independent review drove this through the real sign-in path and found
// the PRODUCT LOGIC already correct: unionByIdLWW() replaces the losing record as
// a WHOLE object rather than field-merging it, so a newer local object that has
// deleted proteinType does not inherit the older cloud object's pin. These tests
// pin that invariant so it cannot silently regress when Meal Lego begins
// consuming protein identity. They add COVERAGE ONLY — no product source changes.
//
// Real path exercised (no hand-written merge function):
//   loadFromFirestore()  ->  AppState.cookedMeals = cloud copy (normalizeCookedMeals)
//   loadUserData()       ->  unionByIdLWW(cloud, localStorage copy) + normalizeCookedMeals()
//   saveData()           ->  reconciled superset written back to the cloud mock

// Same Firestore mock as loadSignedIn(), plus a seeded localStorage document so
// loadUserData()'s real sign-in union runs over cookedMeals. Kept separate from
// loadSignedIn() rather than parameterising it, so the specs already using that
// helper are untouched.
async function loadSignedInWithLocal(page, { cloudDoc, localDoc }) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript((local) => {
    try {
      if (localStorage.getItem('__unpinLwwBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__unpinLwwBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
      localStorage.setItem('mealPrepInitialized', '1');
      localStorage.setItem('mealPrepAppData', JSON.stringify(local));
    } catch (e) {}
  }, localDoc);
  await page.addInitScript((cloud) => {
    const st = { doc: JSON.parse(JSON.stringify(cloud)) };
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

const P3_OLD = '2026-08-25T08:00:00.000Z';
const P3_NEW = '2026-08-26T09:00:00.000Z';

// One cloud doc / one local doc carry BOTH directions, so a single merge run
// proves this is genuinely last-write-wins and not "unpin always wins":
//   cm-unpin : cloud pins chicken (older) · local has NO pin  (newer)  -> local wins, stays unpinned
//   cm-pin   : cloud pins beef    (newer)  · local has NO pin  (older) -> cloud wins, stays pinned
const P3_CLOUD_DOC = {
  version: 3,
  recipes: [], pantry: [], customIngredients: [], customHacks: [], flavors: [],
  userIngredients: [], groceryList: [],
  cookedMeals: [
    batch({ id: 'cm-unpin', name: 'Chicken of the Sea', proteinType: 'chicken', updatedAt: P3_OLD }),
    batch({ id: 'cm-pin', name: 'Beef Stew', proteinType: 'beef', updatedAt: P3_NEW })
  ],
  deletions: {},
  lastSaved: P3_OLD
};
const P3_LOCAL_DOC = {
  recipes: [], pantry: [], customIngredients: [], customHacks: [], flavors: [],
  userIngredients: [], groceryList: [],
  cookedMeals: [
    // proteinType absent — the exact shape setCookedProteinType(id, '') leaves behind
    // (proven by the "setup proof" test below).
    batch({ id: 'cm-unpin', name: 'Chicken of the Sea', updatedAt: P3_NEW }),
    batch({ id: 'cm-pin', name: 'Beef Stew', updatedAt: P3_OLD })
  ],
  deletions: {}
};

test('P3-2 A: a newer local unpin beats a stale cloud pin through the real sign-in merge', async ({ page }) => {
  await loadSignedInWithLocal(page, { cloudDoc: P3_CLOUD_DOC, localDoc: P3_LOCAL_DOC });
  const got = await page.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 400)); // let the reconciled cloud write settle
    const m = AppState.cookedMeals.find((x) => x.id === 'cm-unpin');
    const lastWrite = window.__writes[window.__writes.length - 1] || {};
    const written = (lastWrite.cookedMeals || []).find((x) => x.id === 'cm-unpin');
    return {
      hasField: 'proteinType' in m,
      resolved: getCookedMealProteinType(m),
      updatedAt: m.updatedAt,
      wroteBack: window.__writes.length > 0,
      writtenExists: !!written,
      writtenHasField: written ? 'proteinType' in written : true
    };
  });
  expect(got.hasField).toBe(false);        // the whole newer local object won; the pin was not merged back in
  expect(got.resolved).toBe('unknown');    // no explicit pin, no recipe -> unknown, the unpinned object's normal behaviour
  expect(got.updatedAt).toBe(P3_NEW);      // it really is the newer record that survived, not the cloud one
  expect(got.wroteBack).toBe(true);        // the reconciled superset was pushed up
  expect(got.writtenExists).toBe(true);    // the record is still IN the reconciled payload — not dropped, so the next assertion means something
  expect(got.writtenHasField).toBe(false); // and that merged cloud write does NOT restore the stale "chicken" pin
});

test('P3-2 B (reverse): a newer cloud pin beats a stale local unpin — proves the test is about LWW, not "unpin wins"', async ({ page }) => {
  await loadSignedInWithLocal(page, { cloudDoc: P3_CLOUD_DOC, localDoc: P3_LOCAL_DOC });
  const got = await page.evaluate(() => {
    const m = AppState.cookedMeals.find((x) => x.id === 'cm-pin');
    return { stored: m.proteinType, resolved: getCookedMealProteinType(m), updatedAt: m.updatedAt };
  });
  expect(got.stored).toBe('beef');   // the newer cloud object won whole; the stale local unpin did not clear it
  expect(got.resolved).toBe('beef');
  expect(got.updatedAt).toBe(P3_NEW);
});

test('P3-2 setup proof: setCookedProteinType(id, "") deletes the field and restamps — it never persists "unknown"', async ({ page }) => {
  await loadOffline(page);
  const got = await page.evaluate(async () => {
    AppState.recipes = [];
    AppState.cookedMeals = [{
      id: 'cm_auto', recipeId: null, name: 'Chicken of the Sea', proteinType: 'chicken',
      cookedDate: '2026-08-25', storage: 'fridge', fridgeLife: 3, freezerLife: 30,
      initialPortions: 4, portionsRemaining: 4, updatedAt: '2026-01-01T00:00:00.000Z'
    }];
    saveData();
    setCookedProteinType('cm_auto', '');       // the real Auto / unpin control path
    await new Promise((r) => setTimeout(r, 50));
    const m = AppState.cookedMeals[0];
    const raw = localStorage.getItem('mealPrepAppData') || '';
    const savedMeal = ((JSON.parse(raw).cookedMeals) || [])[0] || {};
    return {
      hasField: 'proteinType' in m,
      resolved: getCookedMealProteinType(m),
      restamped: m.updatedAt !== '2026-01-01T00:00:00.000Z',
      savedHasField: 'proteinType' in savedMeal,
      rawHasUnknownString: /"proteinType"\s*:\s*"unknown"/.test(raw)
    };
  });
  expect(got.hasField).toBe(false);       // the property is DELETED, not set to a string
  expect(got.resolved).toBe('unknown');
  expect(got.restamped).toBe(true);       // stampUpdated() ran -> the unpinned object is the NEWER one in an LWW race
  expect(got.savedHasField).toBe(false);  // saveData() persisted the absence
  expect(got.rawHasUnknownString).toBe(false); // no second representation of "we don't know" was written
});
