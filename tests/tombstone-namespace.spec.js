const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');
const { waitForAppReady, waitForRestored } = require('./app-ready');

const APP_URL = () => pathToFileURL(path.resolve('index.html')).href;
const OLD = '2026-01-01T00:00:00.000Z';
const TOMB = '2026-06-01T00:00:00.000Z';
const TOMBSTONE_COLLECTIONS = ['recipes', 'pantry', 'customIngredients', 'customHacks', 'flavors', 'cookedMeals', 'userIngredients'];

function bootstrapStorage(doc) {
  return (saved) => {
    try {
      if (localStorage.getItem('__tombstoneNamespaceBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__tombstoneNamespaceBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
      localStorage.setItem('mealPrepInitialized', '1');
      if (saved) localStorage.setItem('mealPrepAppData', JSON.stringify(saved));
    } catch (e) {}
  };
}

async function loadLocalApp(page, localDoc) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(bootstrapStorage(), localDoc || null);
  await page.goto(APP_URL(), { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
}

async function loadSignedIn(page, { cloudDoc = null, localDoc = null } = {}) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(bootstrapStorage(), localDoc);
  await page.addInitScript((initialCloud) => {
    const state = { doc: initialCloud ? JSON.parse(JSON.stringify(initialCloud)) : null };
    let snapshotCb = null;
    const snapOf = () => ({
      exists: () => state.doc !== null,
      data: () => JSON.parse(JSON.stringify(state.doc))
    });
    const write = (data) => {
      state.doc = JSON.parse(JSON.stringify(data));
      window.__writes.push(JSON.parse(JSON.stringify(data)));
    };
    window.__writes = [];
    window.__cloud = state;
    window.__pushSnapshot = (data) => {
      state.doc = JSON.parse(JSON.stringify(data));
      if (snapshotCb) snapshotCb(snapOf());
    };
    window.__setCloudSilently = (data) => { state.doc = JSON.parse(JSON.stringify(data)); };
    const user = { uid: 'test-uid', email: 'test@example.com', emailVerified: true, reload: async () => {} };
    window.firebase = {
      db: {},
      auth: { currentUser: user },
      doc: () => ({ __ref: 'users/test-uid' }),
      collection: () => ({ __ref: 'photos' }),
      getDoc: async () => snapOf(),
      getDocs: async () => ({ forEach: () => {} }),
      setDoc: async (_ref, data) => write(data),
      deleteDoc: async () => {},
      runTransaction: async (_db, fn) => fn({
        get: async () => snapOf(),
        set: (_ref, data) => write(data)
      }),
      onSnapshot: (_ref, cb) => { snapshotCb = cb; return () => {}; },
      onAuthStateChanged: (_auth, cb) => { setTimeout(() => cb(user), 0); return () => {}; },
      signOut: async () => {},
      query: () => ({}), where: () => ({}), orderBy: () => ({}),
      signInWithEmailAndPassword: async () => ({ user }),
      createUserWithEmailAndPassword: async () => ({ user }),
      sendEmailVerification: async () => {},
      sendPasswordResetEmail: async () => {}
    };
  }, cloudDoc);
  await page.goto(APP_URL(), { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
  await page.waitForFunction(() => AppState.cloudReady === true, null, { timeout: 30000 });
}

function collidingDoc() {
  return {
    recipes: [{ id: 5, name: 'Recipe Five', baseIngredients: [], updatedAt: OLD }],
    customHacks: [{ id: 5, title: 'Hack Five', category: 'Storage', description: 'x', updatedAt: OLD }],
    pantry: [{ id: 5, name: 'Pantry Five', updatedAt: OLD }],
    customIngredients: [{ id: 5, name: 'Ingredient Five', updatedAt: OLD }],
    cookedMeals: [{ id: 5, name: 'Cooked Five', cookedDate: '2026-01-01', updatedAt: OLD }],
    userIngredients: [{ id: 5, name: 'User Ingredient Five', updatedAt: OLD }],
    flavors: [{ id: 'flv-5', name: 'Flavor Five', updatedAt: OLD }]
  };
}

function deletionDoc(collection, id, when = TOMB) {
  return { deletions: { [collection]: { [String(id)]: when } } };
}

function transientEmptyDoc() {
  return {
    recipes: Array.from({ length: 40 }, (_, i) => ({ id: String(i + 1), name: 'Recipe ' + i, baseIngredients: [] })),
    pantry: Array.from({ length: 30 }, (_, i) => ({ id: 'p_guard_' + i, name: 'Pantry ' + i })),
    customHacks: Array.from({ length: 14 }, (_, i) => ({ id: String(i + 1), title: 'Hack ' + i, category: 'Storage' })),
    customIngredients: Array.from({ length: 8 }, (_, i) => ({ id: 'ing_guard_' + i, name: 'Ingredient ' + i })),
    flavors: Array.from({ length: 3 }, (_, i) => ({ id: 'flv-guard-' + i, name: 'Flavor ' + i })),
    cookedMeals: Array.from({ length: 2 }, (_, i) => ({ id: 'cm_guard_' + i, name: 'Cooked ' + i, cookedDate: '2026-01-01' })),
    userIngredients: [{ id: 'ui_guard_0', name: 'User Ingredient' }]
  };
}

async function loadFixture(page) {
  await loadLocalApp(page);
  await page.evaluate((doc) => {
    Object.assign(AppState, doc);
    AppState.deletions = {};
    snapshotIdBaseline();
  }, collidingDoc());
}

const counts = (page) => page.evaluate(() => ({
  recipes: AppState.recipes.map((x) => String(x.id)),
  customHacks: AppState.customHacks.map((x) => String(x.id)),
  pantry: AppState.pantry.map((x) => String(x.id)),
  customIngredients: AppState.customIngredients.map((x) => String(x.id)),
  cookedMeals: AppState.cookedMeals.map((x) => String(x.id)),
  userIngredients: AppState.userIngredients.map((x) => String(x.id)),
  flavors: AppState.flavors.map((x) => String(x.id)),
  deletions: AppState.deletions
}));

test('BASE REPRO: old flat tombstones delete every collection sharing id 5', async ({ page }) => {
  await loadLocalApp(page);
  const result = await page.evaluate((doc) => {
    const originalApply = applyTombstones;
    applyTombstones = eval('(' + originalApply.toString()
      .replace('var dels = ensureDeletions();', 'var dels = AppState.deletions || {};')
      .replace('var bucket = dels[key] || {};', 'var bucket = dels;') + ')');
    Object.assign(AppState, doc);
    AppState.deletions = { '5': '2026-06-01T00:00:00.000Z' };
    try {
      applyTombstones();
      return {
        recipes: AppState.recipes.length,
        customHacks: AppState.customHacks.length,
        pantry: AppState.pantry.length,
        customIngredients: AppState.customIngredients.length,
        cookedMeals: AppState.cookedMeals.length,
        userIngredients: AppState.userIngredients.length,
        flavors: AppState.flavors.map((f) => f.id)
      };
    } finally {
      applyTombstones = originalApply;
    }
  }, collidingDoc());
  expect(result).toEqual({
    recipes: 0, customHacks: 0, pantry: 0, customIngredients: 0,
    cookedMeals: 0, userIngredients: 0, flavors: ['flv-5']
  });
});

test('a recipes tombstone for id 5 deletes only recipe 5', async ({ page }) => {
  await loadFixture(page);
  const result = await page.evaluate((d) => {
    AppState.deletions = d.deletions;
    applyTombstones();
    return {
      recipes: AppState.recipes.length,
      customHacks: AppState.customHacks.length,
      pantry: AppState.pantry.length,
      customIngredients: AppState.customIngredients.length,
      cookedMeals: AppState.cookedMeals.length,
      userIngredients: AppState.userIngredients.length,
      flavors: AppState.flavors.map((f) => f.id)
    };
  }, deletionDoc('recipes', 5));
  expect(result).toEqual({
    recipes: 0, customHacks: 1, pantry: 1, customIngredients: 1,
    cookedMeals: 1, userIngredients: 1, flavors: ['flv-5']
  });
});

test('pantry and hack tombstones stay in their own collection', async ({ page }) => {
  await loadFixture(page);
  const result = await page.evaluate(() => {
    writeTombstone('pantry', 5, TOMB);
    writeTombstone('customHacks', 7, TOMB);
    AppState.customHacks.push({ id: 7, title: 'Hack Seven', category: 'Storage', updatedAt: OLD });
    AppState.recipes.push({ id: 7, name: 'Recipe Seven', baseIngredients: [], updatedAt: OLD });
    applyTombstones();
    return {
      recipes: AppState.recipes.map((x) => String(x.id)).sort(),
      customHacks: AppState.customHacks.map((x) => String(x.id)).sort(),
      pantry: AppState.pantry.map((x) => String(x.id))
    };
  });
  expect(result).toEqual({ recipes: ['5', '7'], customHacks: ['5'], pantry: [] });
});

test('flavor, cooked meal and user ingredient prefixes remain isolated', async ({ page }) => {
  await loadLocalApp(page);
  const result = await page.evaluate(() => {
    AppState.flavors = [{ id: 'flv-5', name: 'Flavor', updatedAt: OLD }];
    AppState.cookedMeals = [{ id: 'cm_5', name: 'Cooked', cookedDate: '2026-01-01', updatedAt: OLD }];
    AppState.userIngredients = [{ id: 'ui_5', name: 'User Ingredient', updatedAt: OLD }];
    AppState.pantry = [{ id: 'cm_5', name: 'Pantry with cooked prefix', updatedAt: OLD }];
    AppState.deletions = {
      flavors: { 'flv-5': TOMB },
      cookedMeals: { 'cm_5': TOMB },
      userIngredients: { 'ui_5': TOMB }
    };
    applyTombstones();
    return {
      flavors: AppState.flavors.length,
      cookedMeals: AppState.cookedMeals.length,
      userIngredients: AppState.userIngredients.length,
      pantry: AppState.pantry.map((x) => x.id)
    };
  });
  expect(result).toEqual({ flavors: 0, cookedMeals: 0, userIngredients: 0, pantry: ['cm_5'] });
});

test('generic vanish-diff records collection identity and keeps MASS_DELETE_GUARD', async ({ page }) => {
  await loadLocalApp(page);
  const result = await page.evaluate(() => {
    AppState.recipes = [{ id: 5, name: 'Recipe', baseIngredients: [], updatedAt: OLD }];
    AppState.customHacks = [{ id: 5, title: 'Hack', category: 'Storage', updatedAt: OLD }];
    snapshotIdBaseline();
    AppState.recipes = [];
    recordLocalDeletions();

    AppState.pantry = [0, 1, 2, 3, 4, 5].map((i) => ({ id: 'p_guard_' + i, name: 'P' + i }));
    snapshotIdBaseline();
    AppState.pantry = [];
    recordLocalDeletions();

    return AppState.deletions;
  });
  expect(Object.keys(result.recipes)).toEqual(['5']);
  expect(result.customHacks || {}).toEqual({});
  expect(result.pantry || {}).toEqual({});
});

test('multi-collection transient empty trips the aggregate MASS_DELETE_GUARD before small buckets write', async ({ page }) => {
  await loadLocalApp(page);
  const result = await page.evaluate((doc) => {
    AppState.deletions = {};
    Object.assign(AppState, doc);
    snapshotIdBaseline();
    TOMBSTONE_KEYS.forEach((key) => { AppState[key] = []; });
    recordLocalDeletions();
    const afterEmpty = normalizeDeletions(AppState.deletions);

    Object.assign(AppState, doc);
    recordLocalDeletions();
    const afterRepopulate = normalizeDeletions(AppState.deletions);

    return { afterEmpty, afterRepopulate };
  }, transientEmptyDoc());

  TOMBSTONE_COLLECTIONS.forEach((key) => {
    expect(result.afterEmpty[key], key).toEqual({});
    expect(result.afterRepopulate[key], key).toEqual({});
  });
});

test('legitimate disappearances below the aggregate guard still write collection-specific tombstones', async ({ page }) => {
  await loadLocalApp(page);
  const result = await page.evaluate(() => {
    AppState.deletions = {};
    AppState.recipes = [{ id: 'r_small', name: 'Recipe', baseIngredients: [] }];
    AppState.flavors = [{ id: 'flv-small', name: 'Flavor' }];
    AppState.userIngredients = [{ id: 'ui_small', name: 'User Ingredient' }];
    snapshotIdBaseline();

    AppState.recipes = [];
    AppState.flavors = [];
    AppState.userIngredients = [];
    recordLocalDeletions();
    return normalizeDeletions(AppState.deletions);
  });

  expect(Object.keys(result.recipes)).toEqual(['r_small']);
  expect(Object.keys(result.flavors)).toEqual(['flv-small']);
  expect(Object.keys(result.userIngredients)).toEqual(['ui_small']);
  expect(result.pantry).toEqual({});
  expect(result.cookedMeals).toEqual({});
});

test('explicit tombstone writers record their own collections', async ({ page }) => {
  await loadLocalApp(page);
  const result = await page.evaluate(() => {
    AppState.deletions = {};

    AppState.pantry = [{ id: 'sel_1', name: 'Selected', updatedAt: OLD }];
    pantrySelectedIds = new Set(['sel_1']);
    deleteSelectedPantryItems();

    AppState.pantry = [{ id: 'unstock_1', name: 'Unstock', updatedAt: OLD }];
    unstockPurchasedGroceryItem({ mode: 'created', pantryId: 'unstock_1' });

    AppState.pantry = [{ id: 'clear_exp', name: 'Expired Clear', purchaseDate: '2026-01-01', shelfLifeDays: 1, updatedAt: OLD }];
    AppState.cookedMeals = [{ id: 'clear_exp', name: 'Same Id Cooked', cookedDate: '2026-08-01', fridgeLife: 30, storage: 'fridge', updatedAt: OLD }];
    clearExpiredPantryItems();
    document.querySelector('.confirm-ok-btn').click();

    AppState.pantry = [{ id: 'cook_1', name: 'Zucchini', quantity: 100, unit: 'g', staple: false, updatedAt: OLD }];
    deductIngredientsForRecipe({
      id: 'r', name: 'R', baseServings: 1, currentServings: 1,
      baseIngredients: [{ name: 'Zucchini', baseQuantity: 100, unit: 'g' }]
    }, 1);

    AppState.pantry = [{ id: 'att_p', name: 'Old Pantry', purchaseDate: '2026-01-01', shelfLifeDays: 1, updatedAt: OLD }];
    removeAttentionItem('pantry', 'att_p');
    AppState.cookedMeals = [{ id: 'att_c', name: 'Old Cooked', cookedDate: '2026-01-01', fridgeLife: 1, storage: 'fridge', updatedAt: OLD }];
    removeAttentionItem('cooked', 'att_c');

    return AppState.deletions;
  });
  expect(Object.keys(result.pantry).sort()).toEqual(['att_p', 'clear_exp', 'cook_1', 'sel_1', 'unstock_1']);
  expect(Object.keys(result.cookedMeals)).toEqual(['att_c']);
  expect(result.recipes || {}).toEqual({});
});

test('expired cleanup writers are collection-aware even with shared ids', async ({ page }) => {
  await loadLocalApp(page);
  const result = await page.evaluate(() => {
    AppState.deletions = {};
    AppState.pantry = [{ id: 'same', name: 'Expired Pantry', purchaseDate: '2026-01-01', shelfLifeDays: 1, updatedAt: OLD }];
    AppState.cookedMeals = [{ id: 'same', name: 'Expired Cooked', cookedDate: '2026-01-01', fridgeLife: 1, storage: 'fridge', updatedAt: OLD }];
    removeAllExpired();
    document.querySelector('.confirm-ok-btn').click();
    return {
      pantry: AppState.pantry.length,
      cookedMeals: AppState.cookedMeals.length,
      deletions: AppState.deletions
    };
  });
  expect(result.pantry).toBe(0);
  expect(result.cookedMeals).toBe(0);
  expect(Object.keys(result.deletions.pantry)).toEqual(['same']);
  expect(Object.keys(result.deletions.cookedMeals)).toEqual(['same']);
});

test('LWW and purge horizon are unchanged', async ({ page }) => {
  await loadLocalApp(page);
  const result = await page.evaluate(() => {
    AppState.recipes = [
      { id: 'newer', name: 'Newer Item', baseIngredients: [], updatedAt: '2026-08-20T00:00:00.000Z' },
      { id: 'older', name: 'Older Item', baseIngredients: [], updatedAt: '2026-08-01T00:00:00.000Z' },
      { id: 'legacy', name: 'Legacy Item', baseIngredients: [] }
    ];
    AppState.deletions = {
      recipes: {
        newer: '2026-08-10T00:00:00.000Z',
        older: '2026-08-10T00:00:00.000Z',
        legacy: '2026-08-10T00:00:00.000Z',
        ancient: '2025-01-01T00:00:00.000Z'
      }
    };
    applyTombstones();
    purgeOldTombstones();
    return { ids: AppState.recipes.map((r) => r.id), deletions: AppState.deletions.recipes };
  });
  expect(result.ids).toEqual(['newer']);
  expect(result.deletions).toEqual({
    newer: '2026-08-10T00:00:00.000Z',
    older: '2026-08-10T00:00:00.000Z',
    legacy: '2026-08-10T00:00:00.000Z'
  });
});

test('legacy flat payloads migrate only exclusive prefixes and drop ambiguous ids', async ({ page }) => {
  await loadLocalApp(page);
  const warnings = [];
  page.on('console', (msg) => { if (msg.type() === 'warning') warnings.push(msg.text()); });
  const result = await page.evaluate(() => {
    AppState.deletions = {
      '5': TOMB,
      'flv-5': TOMB,
      'cm_5': TOMB,
      'ui_5': TOMB,
      'buy_5': TOMB,
      'ib_5': TOMB,
      'staple_5': TOMB
    };
    return normalizeDeletions(AppState.deletions);
  });
  expect(result.recipes).toEqual({});
  expect(result.flavors).toEqual({ 'flv-5': TOMB });
  expect(result.cookedMeals).toEqual({ 'cm_5': TOMB });
  expect(result.userIngredients).toEqual({ 'ui_5': TOMB });
  expect(Object.keys(result.pantry).sort()).toEqual(['buy_5', 'ib_5', 'staple_5']);
  expect(warnings.some((w) => /Dropped 1 ambiguous legacy deletion/.test(w))).toBe(true);
});

test('ambiguous legacy numeric tombstones no longer globally delete live records', async ({ page }) => {
  await loadFixture(page);
  const result = await page.evaluate(() => {
    AppState.deletions = { '5': TOMB };
    applyTombstones();
    return countsForTest();
  });
  expect(result).toEqual({
    recipes: ['5'], customHacks: ['5'], pantry: ['5'], customIngredients: ['5'],
    cookedMeals: ['5'], userIngredients: ['5'], flavors: ['flv-5']
  });
});

test('localStorage round-trips namespaced tombstones', async ({ page }) => {
  await loadLocalApp(page);
  await page.evaluate(() => {
    AppState.recipes = [{ id: 5, name: 'Recipe', baseIngredients: [], updatedAt: OLD }];
    AppState.customHacks = [{ id: 5, title: 'Hack', updatedAt: OLD }];
    writeTombstone('recipes', 5, TOMB);
    saveData();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForRestored(page, () =>
    AppState.deletions.recipes &&
    AppState.deletions.recipes['5'] &&
    AppState.recipes.some((r) => String(r.id) === '5'));
  const result = await counts(page);
  expect(result.recipes).toEqual(['5']);
  expect(result.customHacks).toContain('5');
  expect(result.deletions.recipes).toEqual({ '5': TOMB });
});

test('Firestore payload and load round-trip namespaced tombstones', async ({ page }) => {
  await loadSignedIn(page, {
    cloudDoc: Object.assign({ version: 4, lastSaved: '2026-08-01T00:00:00.000Z' }, collidingDoc(), deletionDoc('recipes', 5))
  });
  await page.waitForFunction(() => AppState.customHacks.some((h) => String(h.id) === '5'));
  const result = await page.evaluate(() => ({
    recipes: AppState.recipes.map((r) => String(r.id)),
    hacks: AppState.customHacks.map((h) => String(h.id)),
    payload: buildFirestorePayload().deletions
  }));
  expect(result.recipes).toEqual([]);
  expect(result.hacks).toContain('5');
  expect(result.payload.recipes).toEqual({ '5': TOMB });
});

test('sign-in union applies local recipe deletion without deleting same-id hack', async ({ page }) => {
  await loadSignedIn(page, {
    cloudDoc: Object.assign({ version: 2, lastSaved: '2026-08-01T00:00:00.000Z' }, collidingDoc()),
    localDoc: Object.assign({ version: 1 }, deletionDoc('recipes', 5))
  });
  await page.waitForFunction(() => AppState.customHacks.some((h) => String(h.id) === '5'));
  const result = await counts(page);
  expect(result.recipes).toEqual([]);
  expect(result.customHacks).toContain('5');
});

test('concurrent cloud merge filters only the tombstoned collection', async ({ page }) => {
  await loadSignedIn(page, {
    cloudDoc: { version: 1, lastSaved: '2026-08-01T00:00:00.000Z', recipes: [], customHacks: [] }
  });
  await page.evaluate((doc) => {
    Object.assign(AppState, doc);
    AppState.deletions = { recipes: { '5': TOMB } };
    window.__setCloudSilently(Object.assign({ version: 99, lastSaved: '2026-08-02T00:00:00.000Z' }, doc));
    saveData();
  }, collidingDoc());
  await page.waitForFunction(() => window.__writes.length > 0);
  const last = await page.evaluate(() => window.__writes[window.__writes.length - 1]);
  expect((last.recipes || []).map((r) => String(r.id))).toEqual([]);
  expect((last.customHacks || []).map((h) => String(h.id))).toEqual(['5']);
  expect(last.deletions.recipes).toEqual({ '5': TOMB });
});

test('realtime remote deletion applies only to its collection', async ({ page }) => {
  await loadSignedIn(page, {
    cloudDoc: Object.assign({ version: 1, lastSaved: '2026-08-01T00:00:00.000Z' }, collidingDoc())
  });
  await page.evaluate(({ doc, del }) => {
    window.__pushSnapshot(Object.assign({ version: 50, lastSaved: '2026-08-02T00:00:00.000Z' }, doc, del));
  }, { doc: collidingDoc(), del: deletionDoc('recipes', 5) });
  await page.waitForFunction(() => AppState.recipes.length === 0 && AppState.customHacks.some((h) => String(h.id) === '5'));
  const result = await counts(page);
  expect(result.recipes).toEqual([]);
  expect(result.customHacks).toEqual(['5']);
});

test('import clears only the imported collection tombstone', async ({ page }) => {
  await loadLocalApp(page);
  await page.evaluate(() => {
    AppState.deletions = { recipes: { '5': TOMB }, customHacks: { '5': TOMB } };
  });
  const chooserPromise = page.waitForEvent('filechooser');
  await page.evaluate(() => importData());
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'import.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ recipes: [{ id: 5, name: 'Imported', baseIngredients: [] }] }))
  });
  await page.click('.confirm-ok-btn');
  await page.waitForFunction(() => AppState.recipes.some((r) => String(r.id) === '5'));
  const result = await page.evaluate(() => AppState.deletions);
  expect(result.recipes).toEqual({});
  expect(result.customHacks).toEqual({ '5': TOMB });
});

test('backup restore keeps current deletion semantics unchanged', async ({ page }) => {
  await loadLocalApp(page);
  const result = await page.evaluate(() => {
    AppState.deletions = { recipes: { old: OLD } };
    createBackup('test');
    AppState.deletions = { recipes: { current: TOMB } };
    const backup = JSON.parse(localStorage.getItem('mealPrepBackup'));
    const captured = backup.data.deletions;
    // restoreBackup() still does not assign d.deletions; this task keeps that product contract.
    return { captured, current: AppState.deletions };
  });
  expect(result.captured.recipes).toEqual({ old: OLD });
  expect(result.current.recipes).toEqual({ current: TOMB });
});

test('MUTATION: collapsing namespaces recreates collateral deletion', async ({ page }) => {
  await loadFixture(page);
  const result = await page.evaluate((doc) => {
    Object.assign(AppState, doc);
    AppState.deletions = { recipes: { '5': TOMB } };
    applyTombstones();
    const isolated = {
      recipes: AppState.recipes.length,
      customHacks: AppState.customHacks.length,
      pantry: AppState.pantry.length
    };

    Object.assign(AppState, doc);
    AppState.deletions = { recipes: { '5': TOMB } };
    const originalApply = applyTombstones;
    applyTombstones = eval('(' + originalApply.toString()
      .replace('var bucket = dels[key] || {};', 'var bucket = {}; TOMBSTONE_KEYS.forEach(function(k) { Object.assign(bucket, dels[k] || {}); });') + ')');
    try {
      applyTombstones();
      return {
        isolated,
        mutant: {
          recipes: AppState.recipes.length,
          customHacks: AppState.customHacks.length,
          pantry: AppState.pantry.length
        }
      };
    } finally {
      applyTombstones = originalApply;
    }
  }, collidingDoc());
  expect(result.isolated).toEqual({ recipes: 0, customHacks: 1, pantry: 1 });
  expect(result.mutant).toEqual({ recipes: 0, customHacks: 0, pantry: 0 });
});

test('MUTATION: bypassing the aggregate MASS_DELETE_GUARD writes phantom small-collection tombstones', async ({ page }) => {
  await loadLocalApp(page);
  const result = await page.evaluate((doc) => {
    AppState.deletions = {};
    Object.assign(AppState, doc);
    snapshotIdBaseline();
    TOMBSTONE_KEYS.forEach((key) => { AppState[key] = []; });

    const originalRecord = recordLocalDeletions;
    recordLocalDeletions = eval('(' + originalRecord.toString()
      .replace('if (totalVanished > MASS_DELETE_GUARD) {', 'if (false && totalVanished > MASS_DELETE_GUARD) {') + ')');
    try {
      recordLocalDeletions();
      return normalizeDeletions(AppState.deletions);
    } finally {
      recordLocalDeletions = originalRecord;
    }
  }, transientEmptyDoc());

  expect(Object.keys(result.flavors).sort()).toEqual(['flv-guard-0', 'flv-guard-1', 'flv-guard-2']);
  expect(Object.keys(result.cookedMeals).sort()).toEqual(['cm_guard_0', 'cm_guard_1']);
  expect(Object.keys(result.userIngredients)).toEqual(['ui_guard_0']);
});

test('clear all data tombstones every collection in its own namespace', async ({ page }) => {
  await loadFixture(page);
  await page.evaluate(() => {
    clearLocalStorage();
    document.querySelector('.confirm-ok-btn').click();
  });
  await waitForRestored(page, () => AppState.deletions.recipes && AppState.deletions.recipes['5']);
  const result = await page.evaluate(() => AppState.deletions);
  expect(Object.keys(result.recipes)).toEqual(['5']);
  expect(Object.keys(result.customHacks)).toEqual(['5']);
  expect(Object.keys(result.pantry)).toEqual(['5']);
  expect(Object.keys(result.customIngredients)).toEqual(['5']);
  expect(Object.keys(result.cookedMeals)).toEqual(['5']);
  expect(Object.keys(result.userIngredients)).toEqual(['5']);
  expect(Object.keys(result.flavors)).toEqual(['flv-5']);
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.TOMB = '2026-06-01T00:00:00.000Z';
    window.OLD = '2026-01-01T00:00:00.000Z';
    window.countsForTest = () => ({
      recipes: AppState.recipes.map((x) => String(x.id)),
      customHacks: AppState.customHacks.map((x) => String(x.id)),
      pantry: AppState.pantry.map((x) => String(x.id)),
      customIngredients: AppState.customIngredients.map((x) => String(x.id)),
      cookedMeals: AppState.cookedMeals.map((x) => String(x.id)),
      userIngredients: AppState.userIngredients.map((x) => String(x.id)),
      flavors: AppState.flavors.map((x) => String(x.id))
    });
  });
});
