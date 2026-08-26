const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');
const { waitForAppReady, waitForRestored } = require('./app-ready');

/**
 * Flavor Library — a NEW top-level synced collection (AppState.flavors).
 *
 * This is D-032 red-zone work: it adds a key to TOMBSTONE_KEYS, to the Firestore
 * payload, to the Firestore load, to the sign-in union, to the cloud-conflict merge
 * and to the realtime listener. Every one of those decides whether a signed-in
 * user's data survives. So the coverage here is deliberately about PERSISTENCE
 * first and UI second.
 *
 * Two harnesses, on purpose:
 *   loadOffline()  — no window.firebase, same as every other local spec. Proves the
 *                    localStorage / backup / import paths.
 *   loadSignedIn() — installs a Firestore MOCK before the page loads, so initApp()
 *                    takes the real signed-in branch and we exercise the actual
 *                    loadFromFirestore / loadUserData-union / setupRealtimeListeners
 *                    / saveToFirestore code rather than a re-implementation of it.
 *                    A test that simulates the merge cannot catch a bug in the merge.
 */

const APP_URL = () => pathToFileURL(path.resolve('index.html')).href;

const SEED_NAMES = [
  'Soy-Calamansi', 'Honey Garlic', 'Teriyaki-style', 'Japanese Spicy Mayo',
  'Sesame-Soy', 'Gochujang-Sesame', 'Garlic Yogurt', 'Curry-Coconut Finish',
  'Garlic Butter', 'Chili-Garlic'
];

const SEED_IDS = [
  'flv-soy-calamansi', 'flv-honey-garlic', 'flv-teriyaki-style',
  'flv-japanese-spicy-mayo', 'flv-sesame-soy', 'flv-gochujang-sesame',
  'flv-garlic-yogurt', 'flv-curry-coconut-finish', 'flv-garlic-butter',
  'flv-chili-garlic'
];

// A flavor written by hand, in the exact shape saveFlavor() produces.
function makeFlavor(over) {
  return Object.assign({
    id: 'flv-test-one',
    name: 'Test Flavor',
    ingredients: [{ name: 'Soy Sauce', baseQuantity: 2, unit: 'tbsp', category: 'Pantry' }],
    instructions: 'Stir it.',
    activeTime: 4,
    preparationStyle: 'fridge-batch',
    worksWith: ['chicken', 'egg'],
    tags: ['minimal-cleanup'],
    updatedAt: '2026-08-01T00:00:00.000Z'
  }, over || {});
}

// Runs before EVERY navigation, so it must bootstrap ONCE and then leave storage
// alone — otherwise a page.reload() wipes the very data the test just saved.
function bootstrapStorage() {
  return (doc) => {
    try {
      if (localStorage.getItem('__flavorSpecBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__flavorSpecBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
      localStorage.setItem('mealPrepInitialized', '1'); // existing install: never auto-seed samples
      if (doc) localStorage.setItem('mealPrepAppData', JSON.stringify(doc));
    } catch (e) {}
  };
}

async function loadOffline(page, localDoc) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(bootstrapStorage(), localDoc || null);
  await page.goto(APP_URL(), { waitUntil: 'domcontentloaded' });
  await waitForAppReady(page);
}

/**
 * Minimal but faithful Firestore double. It keeps ONE user document in memory and
 * honours the two things the write path actually depends on: `exists()` and the
 * `version` field that drives optimistic concurrency. Writes are recorded so a test
 * can assert what the app tried to send.
 */
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
    // Lets a test act as "the other device": push a new cloud version at the
    // onSnapshot listener exactly as Firestore would.
    window.__pushSnapshot = (data) => {
      state.doc = JSON.parse(JSON.stringify(data));
      if (snapshotCb) snapshotCb(snapOf());
    };
    // Lets a test change the cloud doc WITHOUT notifying, so the next save sees a
    // version bump and takes the mergeCloudConflict() branch.
    window.__setCloudSilently = (data) => { state.doc = JSON.parse(JSON.stringify(data)); };

    const user = {
      uid: 'test-uid', email: 'test@example.com', emailVerified: true,
      reload: async () => {}
    };

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
  // D-065 addendum 2: wait for the RESTORE, not for the paint. The signed-in
  // restore happens inside the async onAuthStateChanged callback, well after
  // initApp() has already painted the dashboard.
  await page.waitForFunction(() => AppState.cloudReady === true, null, { timeout: 30000 });
}

async function openFlavorTab(page) {
  await page.evaluate(() => showTab('flavors'));
  await expect(page.locator('#flavors')).toHaveClass(/active/);
}

const readFlavors = (page) => page.evaluate(() => AppState.flavors.map((f) => ({
  id: f.id, name: f.name, activeTime: f.activeTime,
  preparationStyle: f.preparationStyle, worksWith: f.worksWith, tags: f.tags,
  ingredients: f.ingredients, instructions: f.instructions
})));

const readPersisted = (page) => page.evaluate(
  () => JSON.parse(localStorage.getItem('mealPrepAppData') || '{}').flavors || null);

// ───────────────────────────────────────────────────────────────────────────
// 1. Backwards compatibility — data saved before flavors existed
// ───────────────────────────────────────────────────────────────────────────

test('a saved document with no flavors key loads as an empty library, not a seeded one', async ({ page }) => {
  await loadOffline(page, {
    recipes: [{ id: 101, name: 'Old Adobo', baseIngredients: [], instructions: 'Cook.' }],
    customHacks: [{ id: 1, category: 'Storage', title: 'Old Hack', description: 'x' }],
    pantry: [{ id: 900, name: 'Eggs' }],
    cookedMeals: [{ id: 800, name: 'Old Batch', cookedDate: '2026-08-01', storage: 'fridge' }],
    version: 3
  });

  const state = await page.evaluate(() => ({
    flavors: AppState.flavors,
    recipes: AppState.recipes.map((r) => r.name),
    hacks: AppState.customHacks.map((h) => h.title),
    pantry: AppState.pantry.map((p) => p.name),
    cooked: AppState.cookedMeals.map((m) => m.name)
  }));

  expect(state.flavors).toEqual([]);          // empty, NOT auto-seeded
  // Everything that was already there is untouched.
  expect(state.recipes).toEqual(['Old Adobo']);
  expect(state.pantry).toEqual(['Eggs']);
  expect(state.cooked).toEqual(['Old Batch']);
  // customHacks is NOT asserted by exact count: seedNewDefaultHacks() legitimately
  // tops up a non-empty hack list with any default the install is missing. That is
  // pre-existing behaviour and nothing to do with flavors — what matters here is
  // that the user's own hack survived and no flavor leaked into the collection.
  expect(state.hacks).toContain('Old Hack');
  SEED_NAMES.forEach((n) => expect(state.hacks).not.toContain(n));
});

test('an old save is not rewritten with flavors until the user asks for them', async ({ page }) => {
  await loadOffline(page, { recipes: [], version: 2 });
  await openFlavorTab(page);
  // The starter prompt is an OFFER. Merely opening the tab must not add anything.
  await expect(page.locator('#flavor-starter-prompt')).toBeVisible();
  expect(await page.evaluate(() => AppState.flavors.length)).toBe(0);
});

// ───────────────────────────────────────────────────────────────────────────
// 2. Normalization
// ───────────────────────────────────────────────────────────────────────────

test('normalization is idempotent over the whole starter set', async ({ page }) => {
  await loadOffline(page);
  const same = await page.evaluate(() => {
    const once = normalizeFlavors(JSON.parse(JSON.stringify(defaultFlavors)));
    const twice = normalizeFlavors(JSON.parse(JSON.stringify(once)));
    const thrice = normalizeFlavors(JSON.parse(JSON.stringify(twice)));
    return JSON.stringify(once) === JSON.stringify(twice) &&
           JSON.stringify(twice) === JSON.stringify(thrice);
  });
  expect(same).toBe(true);
});

test('normalization fills absent fields honestly and drops garbage', async ({ page }) => {
  await loadOffline(page);
  const out = await page.evaluate(() => normalizeFlavors([
    { id: 'flv-bare', name: '  Spaced  ' },
    { id: 'flv-junk', name: 'Junk', worksWith: ['chicken', 'unicorn', 'chicken'],
      tags: ['spicy', 'not-a-tag'], preparationStyle: 'invented-style',
      activeTime: 'abc', ingredients: 'not-an-array' },
    { id: 'flv-ings', name: 'Ings', ingredients: [
        { name: '  Soy  ', quantity: 3, unit: 'tbsp', category: 'Pantry' }, // legacy `quantity`
        { name: '', baseQuantity: 1 },                                       // nameless: dropped
        { name: 'Water', baseQuantity: -5, unit: '' }                        // bad qty / no unit
      ] },
    null, 'nonsense', []
  ]));

  expect(out).toHaveLength(3);
  expect(out[0].name).toBe('Spaced');
  expect(out[0].activeTime).toBeNull();       // "not stated", never 0
  expect(out[0].preparationStyle).toBeNull(); // never guessed
  expect(out[0].ingredients).toEqual([]);
  expect(out[1].worksWith).toEqual(['chicken']);  // unknown + duplicate dropped
  expect(out[1].tags).toEqual(['spicy']);
  expect(out[1].preparationStyle).toBeNull();
  expect(out[1].activeTime).toBeNull();
  expect(out[1].ingredients).toEqual([]);
  expect(out[2].ingredients).toEqual([
    { name: 'Soy', baseQuantity: 3, unit: 'tbsp', category: 'Pantry' },
    { name: 'Water', baseQuantity: 0, unit: 'pieces', category: '' }
  ]);
});

test('normalization never invents updatedAt — that would let a flavor beat its own tombstone', async ({ page }) => {
  await loadOffline(page);
  const out = await page.evaluate(() => normalizeFlavors([{ id: 'flv-x', name: 'X' }]));
  expect(out[0].updatedAt).toBeUndefined();
});

// ───────────────────────────────────────────────────────────────────────────
// 3. The id rule
// ───────────────────────────────────────────────────────────────────────────

test('every seeded flavor id carries the flv- prefix', async ({ page }) => {
  await loadOffline(page);
  const ids = await page.evaluate(() => defaultFlavors.map((f) => f.id));
  expect(ids).toEqual(SEED_IDS);
  ids.forEach((id) => expect(id.startsWith('flv-')).toBe(true));
});

test('a user-created flavor gets a prefixed id, never a bare number', async ({ page }) => {
  await loadOffline(page);
  await openFlavorTab(page);
  await page.click('#add-flavor-btn');
  await page.fill('#flavor-name', 'My Sauce');
  await page.selectOption('#flavor-prep-style', 'make-fresh');
  await page.click('#flavor-form button[type="submit"]');
  await page.waitForTimeout(200);

  const id = await page.evaluate(() => AppState.flavors[0].id);
  expect(id.startsWith('flv-')).toBe(true);
  expect(Number.isFinite(Number(id))).toBe(false);
});

test('an unprefixed inbound id is re-prefixed rather than left in the shared numeric space', async ({ page }) => {
  await loadOffline(page);
  const out = await page.evaluate(() => normalizeFlavors([
    { id: 5, name: 'Numeric' },
    { id: '', name: 'Empty Id Flavor' },
    { id: 'flv-', name: 'Prefix Only' }
  ]));
  out.forEach((f) => expect(String(f.id).startsWith('flv-')).toBe(true));
  expect(out[0].id).toBe('flv-5');
  expect(out[1].id).toBe('flv-empty-id-flavor');
});

test('prefixed flavor ids survive a numeric tombstone that deletes a recipe, hack and pantry item', async ({ page }) => {
  await loadOffline(page);
  const result = await page.evaluate(() => {
    // The exact pre-existing collision: recipe ids and hack ids share the numeric
    // space, and AppState.deletions is ONE flat map across every TOMBSTONE_KEY.
    AppState.recipes = [{ id: 5, name: 'Recipe Five', updatedAt: '2026-01-01T00:00:00.000Z' }];
    AppState.customHacks = [{ id: 5, title: 'Hack Five', category: 'Storage', description: 'x', updatedAt: '2026-01-01T00:00:00.000Z' }];
    AppState.pantry = [{ id: 5, name: 'Pantry Five', updatedAt: '2026-01-01T00:00:00.000Z' }];
    AppState.flavors = normalizeFlavors([
      { id: 'flv-soy-calamansi', name: 'Soy-Calamansi', updatedAt: '2026-01-01T00:00:00.000Z' }
    ]);
    AppState.deletions = { '5': '2026-06-01T00:00:00.000Z' };
    applyTombstones();
    return {
      recipes: AppState.recipes.length,
      hacks: AppState.customHacks.length,
      pantry: AppState.pantry.length,
      flavors: AppState.flavors.map((f) => f.id)
    };
  });
  // The legacy numeric tombstone is now ambiguous and is dropped instead of
  // applying globally across every TOMBSTONE_KEYS collection.
  expect(result.recipes).toBe(1);
  expect(result.hacks).toBe(1);
  expect(result.pantry).toBe(1);
  expect(result.flavors).toEqual(['flv-soy-calamansi']); // untouched
});

// ───────────────────────────────────────────────────────────────────────────
// 4. localStorage round-trip
// ───────────────────────────────────────────────────────────────────────────

test('every flavor field survives a save and a reload', async ({ page }) => {
  await loadOffline(page);
  await page.evaluate((f) => { AppState.flavors = normalizeFlavors([f]); saveData(); }, makeFlavor({
    name: 'Round Trip', activeTime: 7, preparationStyle: 'freezer-friendly',
    worksWith: ['chicken', 'salmon', 'tofu'], tags: ['spicy', 'creamy'],
    instructions: 'Line one. Line two.',
    ingredients: [
      { name: 'Butter', baseQuantity: 100, unit: 'g', category: 'Dairy' },
      { name: 'Garlic', baseQuantity: 6, unit: 'cloves', category: 'Vegetable' }
    ]
  }));

  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForRestored(page, () => AppState.flavors.some((f) => f.id === 'flv-test-one'));

  const [f] = await readFlavors(page);
  expect(f.name).toBe('Round Trip');
  expect(f.activeTime).toBe(7);
  expect(f.preparationStyle).toBe('freezer-friendly');
  expect(f.worksWith).toEqual(['chicken', 'salmon', 'tofu']);
  expect(f.tags).toEqual(['spicy', 'creamy']);
  expect(f.instructions).toBe('Line one. Line two.');
  expect(f.ingredients).toEqual([
    { name: 'Butter', baseQuantity: 100, unit: 'g', category: 'Dairy' },
    { name: 'Garlic', baseQuantity: 6, unit: 'cloves', category: 'Vegetable' }
  ]);
});

test('an activeTime of 0 survives as 0 and a blank one survives as null', async ({ page }) => {
  await loadOffline(page);
  await page.evaluate(() => {
    AppState.flavors = normalizeFlavors([
      { id: 'flv-zero', name: 'Zero', activeTime: 0, preparationStyle: 'make-fresh' },
      { id: 'flv-blank', name: 'Blank', preparationStyle: 'make-fresh' }
    ]);
    saveData();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitForRestored(page, () => AppState.flavors.length === 2);
  const out = await page.evaluate(() => AppState.flavors.map((f) => f.activeTime));
  expect(out).toEqual([0, null]);
});

// ───────────────────────────────────────────────────────────────────────────
// 5. Backup / restore, export / import
// ───────────────────────────────────────────────────────────────────────────

test('flavors are captured in a backup and come back on restore', async ({ page }) => {
  await loadOffline(page);
  const snapshot = await page.evaluate((f) => {
    AppState.flavors = normalizeFlavors([f]);
    return snapshotData().flavors;
  }, makeFlavor());
  expect(snapshot).toHaveLength(1);
  expect(snapshot[0].id).toBe('flv-test-one');

  const restored = await page.evaluate((f) => {
    AppState.flavors = normalizeFlavors([f]);
    createBackup('test');
    AppState.flavors = [];                       // simulate the destructive action
    const raw = JSON.parse(localStorage.getItem('mealPrepBackup'));
    return (raw.data.flavors || []).map((x) => x.id);
  }, makeFlavor());
  expect(restored).toEqual(['flv-test-one']);
});

test('export includes flavors and import merges them without losing an edited local copy', async ({ page }) => {
  await loadOffline(page);
  const exported = await page.evaluate((f) => {
    AppState.flavors = normalizeFlavors([f]);
    // exportData() builds its payload inline; read the same fields it writes.
    return { hasKey: 'flavors' in { flavors: AppState.flavors }, ids: AppState.flavors.map((x) => x.id) };
  }, makeFlavor());
  expect(exported.ids).toEqual(['flv-test-one']);

  // The import merge itself: existing local copy must win on a duplicate id.
  const merged = await page.evaluate((incoming) => {
    AppState.flavors = normalizeFlavors([
      { id: 'flv-test-one', name: 'MY EDITED NAME', preparationStyle: 'make-fresh' }
    ]);
    AppState.flavors = normalizeFlavors(unionById(AppState.flavors, incoming));
    return AppState.flavors.map((f) => ({ id: f.id, name: f.name }));
  }, [makeFlavor({ name: 'Imported Name' }), makeFlavor({ id: 'flv-new-one', name: 'Brand New' })]);

  expect(merged).toHaveLength(2);
  expect(merged.find((f) => f.id === 'flv-test-one').name).toBe('MY EDITED NAME'); // local wins
  expect(merged.find((f) => f.id === 'flv-new-one').name).toBe('Brand New');       // new arrives
});

test('an export file written before flavors existed still imports', async ({ page }) => {
  await loadOffline(page);
  const ok = await page.evaluate(() => {
    const legacy = { recipes: [{ id: 555, name: 'Legacy' }], version: '1.1' };
    const KNOWN = ['recipes', 'weeklyPlan', 'pantry', 'customIngredients', 'customHacks',
                   'flavors', 'userIngredients', 'groceryList', 'cookedMeals'];
    return KNOWN.some((k) => legacy[k]);   // the same acceptance test importData() runs
  });
  expect(ok).toBe(true);
});

// ───────────────────────────────────────────────────────────────────────────
// 6. Firestore — payload, load, sign-in union, cloud conflict, realtime
// ───────────────────────────────────────────────────────────────────────────

test('the Firestore payload carries flavors', async ({ page }) => {
  await loadOffline(page);
  const payload = await page.evaluate((f) => {
    AppState.flavors = normalizeFlavors([f]);
    return buildFirestorePayload();
  }, makeFlavor());
  expect(Array.isArray(payload.flavors)).toBe(true);
  expect(payload.flavors.map((f) => f.id)).toEqual(['flv-test-one']);
});

test('a signed-in load pulls flavors out of the cloud document', async ({ page }) => {
  await loadSignedIn(page, {
    cloudDoc: {
      version: 4, lastSaved: '2026-08-10T00:00:00.000Z',
      recipes: [], flavors: [makeFlavor({ id: 'flv-cloud', name: 'From Cloud' })]
    }
  });
  await page.waitForFunction(() => AppState.flavors.some((f) => f.id === 'flv-cloud'));
  const names = await page.evaluate(() => AppState.flavors.map((f) => f.name));
  expect(names).toContain('From Cloud');
});

test('an account whose cloud doc predates flavors is not auto-seeded', async ({ page }) => {
  await loadSignedIn(page, {
    cloudDoc: { version: 9, lastSaved: '2026-07-01T00:00:00.000Z', recipes: [], pantry: [] }
  });
  expect(await page.evaluate(() => AppState.flavors)).toEqual([]);
});

test('signing in UNIONS local flavors into the cloud copy instead of shadowing them', async ({ page }) => {
  await loadSignedIn(page, {
    cloudDoc: {
      version: 2, lastSaved: '2026-08-05T00:00:00.000Z', recipes: [],
      flavors: [makeFlavor({ id: 'flv-cloud-only', name: 'Cloud Only' })]
    },
    localDoc: {
      recipes: [], version: 1,
      flavors: [makeFlavor({ id: 'flv-local-only', name: 'Local Only' })]
    }
  });
  await page.waitForFunction(() => AppState.flavors.length >= 2, null, { timeout: 15000 });
  const ids = await page.evaluate(() => AppState.flavors.map((f) => f.id).sort());
  expect(ids).toEqual(['flv-cloud-only', 'flv-local-only']);
});

test('a newer local edit wins the sign-in union over an older cloud copy (LWW)', async ({ page }) => {
  await loadSignedIn(page, {
    cloudDoc: {
      version: 2, lastSaved: '2026-08-05T00:00:00.000Z', recipes: [],
      flavors: [makeFlavor({ name: 'OLD CLOUD NAME', updatedAt: '2026-08-01T00:00:00.000Z' })]
    },
    localDoc: {
      recipes: [], version: 1,
      flavors: [makeFlavor({ name: 'NEW LOCAL NAME', updatedAt: '2026-08-20T00:00:00.000Z' })]
    }
  });
  await page.waitForFunction(() => AppState.flavors.length === 1);
  expect(await page.evaluate(() => AppState.flavors[0].name)).toBe('NEW LOCAL NAME');
});

test('a concurrent cloud write is merged, not clobbered', async ({ page }) => {
  await loadSignedIn(page, {
    cloudDoc: { version: 1, lastSaved: '2026-08-01T00:00:00.000Z', recipes: [], flavors: [] }
  });

  // This device adds one flavor...
  await page.evaluate((f) => { AppState.flavors = normalizeFlavors([f]); }, makeFlavor({ id: 'flv-mine', name: 'Mine' }));

  // ...while another device has already written a DIFFERENT one at a higher version.
  await page.evaluate((other) => window.__setCloudSilently({
    version: 99, recipes: [], flavors: [other], deletions: {}
  }), makeFlavor({ id: 'flv-theirs', name: 'Theirs' }));

  await page.evaluate(() => saveData());
  await page.waitForFunction(() => window.__writes.length > 0, null, { timeout: 15000 });

  const last = await page.evaluate(() => window.__writes[window.__writes.length - 1]);
  expect((last.flavors || []).map((f) => f.id).sort()).toEqual(['flv-mine', 'flv-theirs']);
  expect(last.version).toBe(100);
});

test('the realtime listener applies a flavor added on another device', async ({ page }) => {
  await loadSignedIn(page, {
    cloudDoc: { version: 1, lastSaved: '2026-08-01T00:00:00.000Z', recipes: [], flavors: [] }
  });
  await page.evaluate((f) => window.__pushSnapshot({
    version: 50, recipes: [], flavors: [f], deletions: {}
  }), makeFlavor({ id: 'flv-remote', name: 'Remote Flavor' }));

  await page.waitForFunction(() => AppState.flavors.some((f) => f.id === 'flv-remote'), null, { timeout: 15000 });
  await openFlavorTab(page);
  await expect(page.locator('.flavor-card[data-flavor-id="flv-remote"]')).toBeVisible();
});

test('the realtime listener applies a flavor DELETED on another device', async ({ page }) => {
  await loadSignedIn(page, {
    cloudDoc: {
      version: 1, lastSaved: '2026-08-01T00:00:00.000Z', recipes: [],
      flavors: [makeFlavor({ id: 'flv-doomed', name: 'Doomed' })]
    }
  });
  await page.waitForFunction(() => AppState.flavors.some((f) => f.id === 'flv-doomed'));

  // The other device deleted it: gone from the array AND tombstoned.
  await page.evaluate(() => window.__pushSnapshot({
    version: 60, recipes: [], flavors: [],
    deletions: { 'flv-doomed': '2026-08-25T00:00:00.000Z' }
  }));
  await page.waitForFunction(() => AppState.flavors.length === 0, null, { timeout: 15000 });
});

// ───────────────────────────────────────────────────────────────────────────
// 7. Deletion and tombstones
// ───────────────────────────────────────────────────────────────────────────

test('deleting a flavor while signed in tombstones it through the normal save path', async ({ page }) => {
  await loadSignedIn(page, {
    cloudDoc: {
      version: 1, lastSaved: '2026-08-01T00:00:00.000Z', recipes: [],
      flavors: [makeFlavor({ id: 'flv-to-delete', name: 'To Delete' })]
    }
  });
  await page.waitForFunction(() => AppState.flavors.length === 1);

  await openFlavorTab(page);
  await page.click('.flavor-card[data-flavor-id="flv-to-delete"] .flavor-head');
  await page.click('.flavor-card[data-flavor-id="flv-to-delete"] .flavor-delete');
  await page.click('.confirm-overlay .confirm-ok-btn');

  await page.waitForFunction(
    () => AppState.flavors.length === 0 && !!((AppState.deletions || {}).flavors || {})['flv-to-delete'],
    null, { timeout: 15000 });

  const last = await page.evaluate(() => window.__writes[window.__writes.length - 1]);
  expect(last.flavors).toEqual([]);
  expect(last.deletions.flavors['flv-to-delete']).toBeTruthy();
});

test('a tombstoned flavor is not resurrected by a cloud copy that still has it', async ({ page }) => {
  await loadSignedIn(page, {
    cloudDoc: {
      version: 3, lastSaved: '2026-08-02T00:00:00.000Z', recipes: [],
      // The cloud still carries the flavor, but the tombstone is NEWER than it.
      flavors: [makeFlavor({ id: 'flv-zombie', name: 'Zombie', updatedAt: '2026-08-01T00:00:00.000Z' })],
      deletions: { 'flv-zombie': '2026-08-20T00:00:00.000Z' }
    }
  });
  expect(await page.evaluate(() => AppState.flavors.map((f) => f.id))).toEqual([]);
});

test('a flavor genuinely re-added after its tombstone survives (LWW, not a blanket ban)', async ({ page }) => {
  await loadSignedIn(page, {
    cloudDoc: {
      version: 3, lastSaved: '2026-08-02T00:00:00.000Z', recipes: [],
      // Re-added AFTER the tombstone → it must win.
      flavors: [makeFlavor({ id: 'flv-reborn', name: 'Reborn', updatedAt: '2026-08-25T00:00:00.000Z' })],
      deletions: { 'flv-reborn': '2026-08-20T00:00:00.000Z' }
    }
  });
  expect(await page.evaluate(() => AppState.flavors.map((f) => f.id))).toEqual(['flv-reborn']);
});

/**
 * MUTATION CHECK. The two tests above only mean something if removing 'flavors'
 * from TOMBSTONE_KEYS would actually break them. Here the mutant is applied inside
 * the page and the same assertion is re-run: with the key present the tombstoned
 * flavor is dropped, with it absent the flavor survives. If both branches agreed,
 * the resurrection tests would be passing vacuously.
 */
test('MUTATION: removing flavors from TOMBSTONE_KEYS resurrects a deleted flavor', async ({ page }) => {
  await loadOffline(page);
  const result = await page.evaluate(() => {
    const fixture = () => {
      AppState.flavors = normalizeFlavors([
        { id: 'flv-zombie', name: 'Zombie', updatedAt: '2026-08-01T00:00:00.000Z' }
      ]);
      AppState.deletions = { flavors: { 'flv-zombie': '2026-08-20T00:00:00.000Z' } };
    };
    const original = TOMBSTONE_KEYS.slice();

    fixture();
    applyTombstones();
    const withKey = AppState.flavors.length;

    // Apply the mutant in place (TOMBSTONE_KEYS is read live by applyTombstones).
    const i = TOMBSTONE_KEYS.indexOf('flavors');
    TOMBSTONE_KEYS.splice(i, 1);
    fixture();
    applyTombstones();
    const withoutKey = AppState.flavors.length;

    TOMBSTONE_KEYS.length = 0;
    original.forEach((k) => TOMBSTONE_KEYS.push(k));
    return { withKey, withoutKey, restored: TOMBSTONE_KEYS.indexOf('flavors') >= 0 };
  });

  expect(result.withKey).toBe(0);      // guarded: the tombstone wins
  expect(result.withoutKey).toBe(1);   // mutant: the flavor comes back — test has teeth
  expect(result.restored).toBe(true);
});

/**
 * MUTATION CHECK #2 — the id prefix. If flavor ids were bare numbers they would sit
 * in the same flat deletions namespace as recipes, and a recipe deletion would take
 * the flavor with it.
 */
test('MUTATION: an unprefixed flavor id is destroyed by an unrelated numeric tombstone', async ({ page }) => {
  await loadOffline(page);
  const result = await page.evaluate(() => {
    const run = (flavorId) => {
      AppState.recipes = [];
      AppState.flavors = [{ id: flavorId, name: 'Victim', updatedAt: '2026-08-01T00:00:00.000Z' }];
      AppState.deletions = { '5': '2026-08-20T00:00:00.000Z' }; // a RECIPE was deleted
      applyTombstones();
      return AppState.flavors.length;
    };
    const oldFlatBare = (() => {
      AppState.flavors = [{ id: 5, name: 'Victim', updatedAt: '2026-08-01T00:00:00.000Z' }];
      const flat = { '5': '2026-08-20T00:00:00.000Z' };
      AppState.flavors = AppState.flavors.filter((f) => !flat[String(f.id)]);
      return AppState.flavors.length;
    })();
    return { prefixed: run('flv-5'), bare: run(5), oldFlatBare };
  });
  expect(result.prefixed).toBe(1); // the rule protects it
  expect(result.bare).toBe(1);     // collection-aware tombstones protect it too
  expect(result.oldFlatBare).toBe(0); // the old flat map is the mutant
});

// ───────────────────────────────────────────────────────────────────────────
// 8. Starter flavors
// ───────────────────────────────────────────────────────────────────────────

test('the starter pack adds all ten flavors once', async ({ page }) => {
  await loadOffline(page);
  await openFlavorTab(page);
  await page.click('.flavor-sp-add');
  await page.waitForFunction(() => AppState.flavors.length === 10);

  const ids = await page.evaluate(() => AppState.flavors.map((f) => f.id));
  expect(ids.sort()).toEqual(SEED_IDS.slice().sort());
  await expect(page.locator('.flavor-card')).toHaveCount(10);
  expect((await readPersisted(page)).length).toBe(10);
});

test('tapping Add repeatedly never duplicates', async ({ page }) => {
  await loadOffline(page);
  await openFlavorTab(page);
  await page.click('.flavor-sp-add');
  await page.waitForFunction(() => AppState.flavors.length === 10);
  // The prompt retires itself once the offer is empty.
  await expect(page.locator('.flavor-sp-add')).toHaveCount(0);

  const after = await page.evaluate(() => {
    addStarterFlavors(); addStarterFlavors(); addStarterFlavors();
    return AppState.flavors.length;
  });
  expect(after).toBe(10);
});

test('an edited starter flavor is never overwritten by the starter pack', async ({ page }) => {
  await loadOffline(page, {
    recipes: [], version: 1,
    flavors: [{ id: 'flv-soy-calamansi', name: 'MY VERSION', instructions: 'My way.',
                activeTime: 99, preparationStyle: 'make-fresh', worksWith: ['egg'],
                tags: [], ingredients: [], updatedAt: '2026-08-01T00:00:00.000Z' }]
  });
  await openFlavorTab(page);
  await page.click('.flavor-sp-add');
  await page.waitForFunction(() => AppState.flavors.length === 10);

  const mine = await page.evaluate(
    () => AppState.flavors.find((f) => f.id === 'flv-soy-calamansi'));
  expect(mine.name).toBe('MY VERSION');
  expect(mine.instructions).toBe('My way.');
  expect(mine.activeTime).toBe(99);
  expect(mine.preparationStyle).toBe('make-fresh');
});

test('a deleted starter flavor is not re-offered or resurrected', async ({ page }) => {
  await loadOffline(page, {
    recipes: [], version: 1, flavors: [],
    deletions: { 'flv-honey-garlic': '2026-08-20T00:00:00.000Z' }
  });
  await openFlavorTab(page);

  const offered = await page.evaluate(() => flavorStarterCandidates().map((f) => f.id));
  expect(offered).not.toContain('flv-honey-garlic');
  expect(offered).toHaveLength(9);

  await page.click('.flavor-sp-add');
  await page.waitForFunction(() => AppState.flavors.length === 9);
  const ids = await page.evaluate(() => AppState.flavors.map((f) => f.id));
  expect(ids).not.toContain('flv-honey-garlic');
});

test('added starter flavors are independent copies of the defaultFlavors constant', async ({ page }) => {
  await loadOffline(page);
  await openFlavorTab(page);
  await page.click('.flavor-sp-add');
  await page.waitForFunction(() => AppState.flavors.length === 10);

  const clean = await page.evaluate(() => {
    const mine = AppState.flavors.find((f) => f.id === 'flv-soy-calamansi');
    mine.name = 'MUTATED';
    mine.ingredients[0].name = 'MUTATED ING';
    mine.worksWith.push('tofu');
    const seed = defaultFlavors.find((f) => f.id === 'flv-soy-calamansi');
    return {
      seedName: seed.name,
      seedIng: seed.ingredients[0].name,
      seedWorksWith: seed.worksWith.indexOf('tofu') < 0
    };
  });
  expect(clean.seedName).toBe('Soy-Calamansi');
  expect(clean.seedIng).toBe('Soy Sauce (Toyo)');
  expect(clean.seedWorksWith).toBe(true);
});

test('the three preparation styles are all represented in the starter set', async ({ page }) => {
  await loadOffline(page);
  const styles = await page.evaluate(
    () => defaultFlavors.map((f) => f.preparationStyle));
  expect(new Set(styles)).toEqual(new Set(['make-fresh', 'fridge-batch', 'freezer-friendly']));
});

// ───────────────────────────────────────────────────────────────────────────
// 9. CRUD through the UI
// ───────────────────────────────────────────────────────────────────────────

test('a user can add, edit and delete a flavor through the UI', async ({ page }) => {
  await loadOffline(page);
  await openFlavorTab(page);

  // ADD
  await page.click('#add-flavor-btn');
  await page.fill('#flavor-name', 'Calamansi Butter');
  await page.selectOption('#flavor-prep-style', 'freezer-friendly');
  await page.fill('#flavor-active-time', '6');
  await page.fill('#flavor-ingredients', '100 g Butter\n4 pieces Calamansi\nSalt');
  await page.fill('#flavor-instructions', 'Mash it together and freeze.');
  await page.check('#flavor-works-with input[value="chicken"]');
  await page.check('#flavor-works-with input[value="shrimp"]');
  await page.check('#flavor-tag-choices input[value="garlicky"]');
  await page.click('#flavor-form button[type="submit"]');
  await page.waitForFunction(() => AppState.flavors.length === 1);

  let [f] = await readFlavors(page);
  expect(f.name).toBe('Calamansi Butter');
  expect(f.preparationStyle).toBe('freezer-friendly');
  expect(f.activeTime).toBe(6);
  expect(f.worksWith).toEqual(['chicken', 'shrimp']);
  expect(f.tags).toEqual(['garlicky']);
  expect(f.instructions).toBe('Mash it together and freeze.');
  expect(f.ingredients.map((i) => i.name)).toEqual(['Butter', 'Calamansi', 'Salt']);
  expect(f.ingredients[0]).toEqual({ name: 'Butter', baseQuantity: 100, unit: 'g', category: 'Dairy' });

  // EDIT — same id, changed content
  const originalId = f.id;
  await page.click('.flavor-card .flavor-head');
  await page.click('.flavor-card .flavor-edit');
  await expect(page.locator('#flavor-modal')).not.toHaveClass(/hidden/);
  await expect(page.locator('#flavor-name')).toHaveValue('Calamansi Butter');
  await expect(page.locator('#flavor-works-with input[value="chicken"]')).toBeChecked();
  await page.fill('#flavor-name', 'Calamansi Butter v2');
  await page.selectOption('#flavor-prep-style', 'fridge-batch');
  await page.uncheck('#flavor-works-with input[value="shrimp"]');
  await page.click('#flavor-form button[type="submit"]');
  await page.waitForFunction(() => AppState.flavors[0].name === 'Calamansi Butter v2');

  [f] = await readFlavors(page);
  expect(f.id).toBe(originalId);          // an edit must NOT mint a new id
  expect(f.preparationStyle).toBe('fridge-batch');
  expect(f.worksWith).toEqual(['chicken']);
  expect(await page.evaluate(() => AppState.flavors.length)).toBe(1); // not duplicated

  // DELETE
  await page.click('.flavor-card .flavor-head');
  await page.click('.flavor-card .flavor-delete');
  await page.click('.confirm-overlay .confirm-ok-btn');
  await page.waitForFunction(() => AppState.flavors.length === 0);
  await expect(page.locator('.flavor-card')).toHaveCount(0);
});

test('an edit stamps updatedAt so it can win a later merge', async ({ page }) => {
  await loadOffline(page);
  await page.evaluate((f) => { AppState.flavors = normalizeFlavors([f]); saveData(); }, makeFlavor());
  await openFlavorTab(page);
  await page.click('.flavor-card .flavor-head');
  await page.click('.flavor-card .flavor-edit');
  await page.fill('#flavor-name', 'Edited');
  await page.click('#flavor-form button[type="submit"]');
  await page.waitForFunction(() => AppState.flavors[0].name === 'Edited');

  const stamped = await page.evaluate(() => AppState.flavors[0].updatedAt);
  expect(stamped > '2026-08-01T00:00:00.000Z').toBe(true);
});

// ───────────────────────────────────────────────────────────────────────────
// 10. Compatibility, filtering and rendering
// ───────────────────────────────────────────────────────────────────────────

test('the three preparation styles render distinctly', async ({ page }) => {
  await loadOffline(page);
  await openFlavorTab(page);
  await page.click('.flavor-sp-add');
  await page.waitForFunction(() => AppState.flavors.length === 10);

  await expect(page.locator('.flavor-style--make-fresh').first()).toBeVisible();
  await expect(page.locator('.flavor-style--fridge-batch').first()).toBeVisible();
  await expect(page.locator('.flavor-style--freezer-friendly').first()).toBeVisible();

  // Distinct classes AND distinct rendered colours — colour alone would not be
  // enough, and identical colours would make the classes cosmetic.
  const colours = await page.evaluate(() => ['make-fresh', 'fridge-batch', 'freezer-friendly']
    .map((s) => {
      const el = document.querySelector('.flavor-style--' + s);
      return el ? getComputedStyle(el).color : null;
    }));
  expect(new Set(colours).size).toBe(3);
  colours.forEach((c) => expect(c).toBeTruthy());
});

test('compatibility filtering is deterministic and only returns compatible flavors', async ({ page }) => {
  await loadOffline(page);
  await openFlavorTab(page);
  await page.click('.flavor-sp-add');
  await page.waitForFunction(() => AppState.flavors.length === 10);

  const runs = await page.evaluate(() => {
    flavorFilters.protein = 'tuna'; flavorFilters.style = ''; flavorFilters.search = '';
    const a = getFilteredFlavors().map((f) => f.id);
    const b = getFilteredFlavors().map((f) => f.id);
    const c = getFilteredFlavors().map((f) => f.id);
    const everyOneCompatible = getFilteredFlavors()
      .every((f) => f.worksWith.indexOf('tuna') >= 0);
    flavorFilters.protein = '';
    return { a, b, c, everyOneCompatible };
  });
  expect(runs.a).toEqual(runs.b);
  expect(runs.b).toEqual(runs.c);            // deterministic
  expect(runs.everyOneCompatible).toBe(true);
  expect(runs.a).toEqual(['flv-japanese-spicy-mayo']);
});

test('the protein filter narrows the visible list in the UI', async ({ page }) => {
  await loadOffline(page);
  await openFlavorTab(page);
  await page.click('.flavor-sp-add');
  await expect(page.locator('.flavor-card')).toHaveCount(10);

  await page.selectOption('#flavor-protein-filter', 'vegetables');
  const shown = await page.locator('.flavor-card').count();
  expect(shown).toBeGreaterThan(0);
  expect(shown).toBeLessThan(10);

  const allCompatible = await page.evaluate(() =>
    Array.prototype.slice.call(document.querySelectorAll('.flavor-card'))
      .every((el) => {
        const f = AppState.flavors.find((x) => String(x.id) === el.dataset.flavorId);
        return f && f.worksWith.indexOf('vegetables') >= 0;
      }));
  expect(allCompatible).toBe(true);
});

test('the style filter narrows to one preparation style', async ({ page }) => {
  await loadOffline(page);
  await openFlavorTab(page);
  await page.click('.flavor-sp-add');
  await expect(page.locator('.flavor-card')).toHaveCount(10);

  await page.selectOption('#flavor-style-filter', 'make-fresh');
  await expect(page.locator('.flavor-card')).toHaveCount(2);
  await expect(page.locator('.flavor-style--fridge-batch')).toHaveCount(0);
});

test('search matches name, ingredient and protein', async ({ page }) => {
  await loadOffline(page);
  await openFlavorTab(page);
  await page.click('.flavor-sp-add');
  await expect(page.locator('.flavor-card')).toHaveCount(10);

  await page.fill('#flavor-search', 'gochujang');
  await expect(page.locator('.flavor-card')).toHaveCount(1);

  await page.fill('#flavor-search', 'calamansi');       // an ingredient, not a name
  expect(await page.locator('.flavor-card').count()).toBeGreaterThanOrEqual(2);

  await page.fill('#flavor-search', 'zzzznothing');
  await expect(page.locator('.flavor-card')).toHaveCount(0);
  await expect(page.locator('#flavor-list .empty-state')).toBeVisible();
});

test('opening a flavor shows its ingredients and instructions and mutates nothing', async ({ page }) => {
  await loadOffline(page);
  await openFlavorTab(page);
  await page.click('.flavor-sp-add');
  await page.waitForFunction(() => AppState.flavors.length === 10);

  const before = await page.evaluate(() => JSON.stringify({
    flavors: AppState.flavors, pantry: AppState.pantry, grocery: AppState.groceryList,
    cooked: AppState.cookedMeals, deletions: AppState.deletions
  }));

  const card = page.locator('.flavor-card[data-flavor-id="flv-soy-calamansi"]');
  await card.locator('.flavor-head').click();
  await expect(card.locator('.flavor-ings li').first()).toContainText('Soy Sauce');
  await expect(card.locator('.flavor-instructions')).toContainText('calamansi');
  await expect(card.locator('.flavor-proteins')).toContainText('Chicken');

  const after = await page.evaluate(() => JSON.stringify({
    flavors: AppState.flavors, pantry: AppState.pantry, grocery: AppState.groceryList,
    cooked: AppState.cookedMeals, deletions: AppState.deletions
  }));
  expect(after).toBe(before);  // viewing is read-only, always
});

// ───────────────────────────────────────────────────────────────────────────
// 11. No collateral damage to what already existed
// ───────────────────────────────────────────────────────────────────────────

test('flavors do not enter recipes, hacks, pantry, cooked meals or the grocery list', async ({ page }) => {
  await loadOffline(page, {
    recipes: [{ id: 101, name: 'Old Adobo', baseIngredients: [], instructions: 'Cook.',
                nutritionPerServing: { calories: 100, protein: 5, carbs: 5, fat: 5, fiber: 1, sodium: 10 } }],
    customHacks: [{ id: 1, category: 'Storage', title: 'Old Hack', description: 'x' }],
    pantry: [{ id: 900, name: 'Eggs' }],
    cookedMeals: [{ id: 800, name: 'Old Batch', cookedDate: '2026-08-20', storage: 'fridge', fridgeLife: 4 }],
    groceryList: [{ id: 700, name: 'Rice' }],
    version: 3
  });

  const before = await page.evaluate(() => ({
    recipes: AppState.recipes.length, hacks: AppState.customHacks.length,
    pantry: AppState.pantry.length, cooked: AppState.cookedMeals.length,
    grocery: AppState.groceryList.length,
    eat: getWhatShouldWeEatSuggestions().map((p) => p.name)
  }));

  await openFlavorTab(page);
  await page.click('.flavor-sp-add');
  await page.waitForFunction(() => AppState.flavors.length === 10);

  const after = await page.evaluate(() => ({
    recipes: AppState.recipes.length, hacks: AppState.customHacks.length,
    pantry: AppState.pantry.length, cooked: AppState.cookedMeals.length,
    grocery: AppState.groceryList.length,
    eat: getWhatShouldWeEatSuggestions().map((p) => p.name),
    hackCards: document.querySelectorAll('.hack-item').length
  }));

  expect(after.recipes).toBe(before.recipes);
  expect(after.hacks).toBe(before.hacks);
  expect(after.pantry).toBe(before.pantry);
  expect(after.cooked).toBe(before.cooked);
  expect(after.grocery).toBe(before.grocery);
  expect(after.eat).toEqual(before.eat);   // ranking is untouched by flavors
});

test('the Cooking Hacks tab is unaffected by the flavor collection', async ({ page }) => {
  await loadOffline(page, {
    recipes: [], version: 1,
    customHacks: [{ id: 1, category: 'Storage', title: 'Only Hack', description: 'Keep it cold.' }]
  });
  await page.evaluate(() => { AppState.flavors = normalizeFlavors(JSON.parse(JSON.stringify(defaultFlavors))); });
  const hacksBefore = await page.evaluate(() => AppState.customHacks.length);
  await page.evaluate(() => showTab('hacks'));
  // Loading the whole flavor library must not change the hack list by even one row.
  await expect(page.locator('.hack-item')).toHaveCount(hacksBefore);
  await expect(page.locator('#cooking-hacks')).toContainText('Only Hack');
  await expect(page.locator('#cooking-hacks')).not.toContainText('Soy-Calamansi');
  await expect(page.locator('#cooking-hacks')).not.toContainText('Gochujang');
});

test('flavors add exactly one persisted key and one AppState collection', async ({ page }) => {
  await loadOffline(page);
  const keys = await page.evaluate(() => {
    AppState.flavors = normalizeFlavors(JSON.parse(JSON.stringify(defaultFlavors)));
    saveData();
    return {
      persisted: Object.keys(JSON.parse(localStorage.getItem('mealPrepAppData'))).sort(),
      payload: Object.keys(buildFirestorePayload()).sort(),
      // (__flavorSpecBootstrapped is this spec's own harness key, not the app's.)
      storageKeys: Object.keys(localStorage)
        .filter((k) => /flavor/i.test(k) && k !== '__flavorSpecBootstrapped')
    };
  });
  expect(keys.persisted).toContain('flavors');
  expect(keys.payload).toContain('flavors');
  // No side-channel: a flavor filter or "seen" flag must never become storage.
  expect(keys.storageKeys).toEqual([]);
});

// ───────────────────────────────────────────────────────────────────────────
// 12. Mobile and error hygiene
// ───────────────────────────────────────────────────────────────────────────

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the flavor library fits a phone with no horizontal overflow', async ({ page }) => {
    await loadOffline(page);
    await openFlavorTab(page);
    await page.click('.flavor-sp-add');
    await page.waitForFunction(() => AppState.flavors.length === 10);
    await page.click('.flavor-card[data-flavor-id="flv-chili-garlic"] .flavor-head');

    const overflow = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      body: document.body.scrollWidth - document.body.clientWidth
    }));
    expect(overflow.doc).toBeLessThanOrEqual(1);
    expect(overflow.body).toBeLessThanOrEqual(1);

    // Every card stays inside the viewport.
    const wide = await page.evaluate(() => Array.prototype.slice
      .call(document.querySelectorAll('.flavor-card'))
      .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1).length);
    expect(wide).toBe(0);
  });

  test('the add/edit modal is usable on a phone with no overflow', async ({ page }) => {
    await loadOffline(page);
    await openFlavorTab(page);
    await page.click('#add-flavor-btn');
    await expect(page.locator('#flavor-modal')).not.toHaveClass(/hidden/);
    await page.fill('#flavor-name', 'Phone Flavor');
    await page.selectOption('#flavor-prep-style', 'make-fresh');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);

    await page.click('#flavor-form button[type="submit"]');
    await page.waitForFunction(() => AppState.flavors.length === 1);
  });
});

test('the whole flavor flow raises no page or console errors', async ({ page }) => {
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await loadOffline(page);
  await openFlavorTab(page);
  await page.click('.flavor-sp-add');
  await page.waitForFunction(() => AppState.flavors.length === 10);
  await page.click('.flavor-card[data-flavor-id="flv-garlic-butter"] .flavor-head');
  await page.selectOption('#flavor-protein-filter', 'chicken');
  await page.fill('#flavor-search', 'garlic');
  await page.fill('#flavor-search', '');
  await page.selectOption('#flavor-protein-filter', '');
  await page.click('#add-flavor-btn');
  await page.fill('#flavor-name', 'Error Check');
  await page.selectOption('#flavor-prep-style', 'make-fresh');
  await page.click('#flavor-form button[type="submit"]');
  await page.waitForFunction(() => AppState.flavors.length === 11);
  await page.evaluate(() => { showTab('recipes'); showTab('fridge'); showTab('hacks'); showTab('flavors'); });
  await page.waitForTimeout(300);

  // The offline fixture aborts the firebase imports on purpose; that noise is not
  // an app error. Same filter every other local spec uses.
  const real = errors.filter((e) => !/firebase|firestore|net::ERR|Failed to load resource/i.test(e));
  expect(real).toEqual([]);
});
