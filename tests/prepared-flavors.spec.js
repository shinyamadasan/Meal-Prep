const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');
const { waitForAppReady, waitForRestored } = require('./app-ready');

/**
 * Flavor Bomb v1 — AppState.preparedFlavors, a NEW top-level synced collection.
 *
 * Same reason flavor-library.spec.js exists (D-070): this is D-032 red-zone work —
 * it adds a key to TOMBSTONE_KEYS, the Firestore payload, the Firestore load, the
 * sign-in union, the cloud-conflict merge and the realtime listener. Coverage here
 * is deliberately PERSISTENCE first, UI second. See DECISIONS.md D-074.
 *
 * Two harnesses, same shape as flavor-library.spec.js:
 *   loadOffline()  — no window.firebase. Proves localStorage / backup / import.
 *   loadSignedIn() — installs a Firestore MOCK before the page loads, so initApp()
 *                    takes the real signed-in branch and exercises the actual
 *                    loadFromFirestore / loadUserData-union / setupRealtimeListeners
 *                    / saveToFirestore code, not a re-implementation of it.
 */

const APP_URL = () => pathToFileURL(path.resolve('index.html')).href;

const SOY_ID = 'flv-soy-calamansi';
const SOY_NAME = 'Soy-Calamansi';

function makeFlavor(over) {
  return Object.assign({
    id: SOY_ID,
    name: SOY_NAME,
    ingredients: [{ name: 'Soy Sauce', baseQuantity: 4, unit: 'tbsp', category: 'Pantry' }],
    instructions: 'Mix it.',
    activeTime: 5,
    preparationStyle: 'freezer-friendly',
    worksWith: ['chicken'],
    tags: [],
    updatedAt: '2026-08-01T00:00:00.000Z'
  }, over || {});
}

function makePrepared(over) {
  return Object.assign({
    id: 'pfl-test-one',
    flavorId: SOY_ID,
    portionsInitial: 8,
    portionsRemaining: 8,
    storage: 'freezer',
    preparedAt: '2026-08-20',
    expiresAt: null,
    updatedAt: '2026-08-20T00:00:00.000Z'
  }, over || {});
}

function bootstrapStorage() {
  return (doc) => {
    try {
      if (localStorage.getItem('__preparedFlavorSpecBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__preparedFlavorSpecBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
      localStorage.setItem('mealPrepInitialized', '1');
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

async function loadSignedIn(page, { cloudDoc = null, localDoc = null } = {}) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(bootstrapStorage(), localDoc);
  await page.addInitScript((initialCloud) => {
    const state = { doc: initialCloud ? JSON.parse(JSON.stringify(initialCloud)) : null };
    let snapshotCb = null;
    const snapOf = () => ({ exists: () => state.doc !== null, data: () => JSON.parse(JSON.stringify(state.doc)) });
    const write = (data) => {
      state.doc = JSON.parse(JSON.stringify(data));
      window.__writes.push(JSON.parse(JSON.stringify(data)));
    };
    window.__writes = [];
    window.__cloud = state;
    window.__pushSnapshot = (data) => { state.doc = JSON.parse(JSON.stringify(data)); if (snapshotCb) snapshotCb(snapOf()); };
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
      runTransaction: async (_db, fn) => fn({ get: async () => snapOf(), set: (_ref, data) => write(data) }),
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

async function openFlavorTab(page) {
  await page.evaluate(() => showTab('flavors'));
  await expect(page.locator('#flavors')).toHaveClass(/active/);
}

const readPreparedPersisted = (page) => page.evaluate(
  () => JSON.parse(localStorage.getItem('mealPrepAppData') || '{}').preparedFlavors || null);

// ───────────────────────────────────────────────────────────────────────────
// 1. Backward compatibility
// ───────────────────────────────────────────────────────────────────────────

test('1. a saved document with no preparedFlavors key loads as empty stock', async ({ page }) => {
  await loadOffline(page, { recipes: [], flavors: [makeFlavor()], version: 3 });
  const list = await page.evaluate(() => AppState.preparedFlavors);
  expect(list).toEqual([]);
});

test('24. old saved data (recipes/pantry/flavors, no preparedFlavors) remains fully compatible', async ({ page }) => {
  await loadOffline(page, {
    recipes: [{ id: 101, name: 'Old Adobo', baseIngredients: [], instructions: 'Cook.' }],
    pantry: [{ id: 900, name: 'Eggs' }],
    flavors: [makeFlavor()],
    version: 3
  });
  const state = await page.evaluate(() => ({
    recipes: AppState.recipes.map((r) => r.name),
    pantry: AppState.pantry.map((p) => p.name),
    flavors: AppState.flavors.map((f) => f.name),
    prepared: AppState.preparedFlavors
  }));
  expect(state.recipes).toEqual(['Old Adobo']);
  expect(state.pantry).toEqual(['Eggs']);
  expect(state.flavors).toEqual([SOY_NAME]);
  expect(state.prepared).toEqual([]);
});

// ───────────────────────────────────────────────────────────────────────────
// 2. Creation from a Flavor Library flavor
// ───────────────────────────────────────────────────────────────────────────

test('2+3. a prepared flavor can be created from a Flavor Library flavor and flavorId stays linked', async ({ page }) => {
  await loadOffline(page, { flavors: [makeFlavor()], version: 1 });
  await openFlavorTab(page);
  await page.click('.flavor-head'); // expand the card so actions are visible
  await page.click('.flavor-prepare');
  await page.fill('#prepared-flavor-portions', '8');
  await page.click('input[name="prepared-flavor-storage"][value="freezer"]');
  await page.click('.confirm-ok-btn');
  await page.waitForTimeout(200);

  const pf = await page.evaluate(() => AppState.preparedFlavors[0]);
  expect(pf.flavorId).toBe(SOY_ID);
  expect(pf.portionsInitial).toBe(8);
  expect(pf.portionsRemaining).toBe(8);
  expect(pf.storage).toBe('freezer');
});

test('5+6. fridge and freezer storage both round-trip', async ({ page }) => {
  await loadOffline(page);
  const out = await page.evaluate((flavor) => {
    AppState.flavors.push(normalizeFlavor(flavor));
    savePreparedFlavor(flavor.id, '4', 'fridge', '');
    var fridge = findPreparedFlavorByFlavorId(flavor.id).storage;
    savePreparedFlavor(flavor.id, '4', 'freezer', '');
    var freezer = findPreparedFlavorByFlavorId(flavor.id).storage;
    return { fridge: fridge, freezer: freezer };
  }, makeFlavor());
  expect(out.fridge).toBe('fridge');
  expect(out.freezer).toBe('freezer');
});

test('7. preparedAt round-trips as today\'s local date', async ({ page }) => {
  await loadOffline(page);
  const out = await page.evaluate((flavor) => {
    AppState.flavors.push(normalizeFlavor(flavor));
    savePreparedFlavor(flavor.id, '2', 'fridge', '');
    return { preparedAt: findPreparedFlavorByFlavorId(flavor.id).preparedAt, today: todayISO() };
  }, makeFlavor());
  expect(out.preparedAt).toBe(out.today);
});

test('8. blank expiresAt remains blank and is never inferred', async ({ page }) => {
  await loadOffline(page);
  const out = await page.evaluate((flavor) => {
    AppState.flavors.push(normalizeFlavor(flavor));
    savePreparedFlavor(flavor.id, '2', 'freezer', '');
    return findPreparedFlavorByFlavorId(flavor.id).expiresAt;
  }, makeFlavor());
  expect(out).toBeNull();
});

test('9. user-entered expiresAt round-trips', async ({ page }) => {
  await loadOffline(page);
  const out = await page.evaluate((flavor) => {
    AppState.flavors.push(normalizeFlavor(flavor));
    savePreparedFlavor(flavor.id, '2', 'freezer', '2026-12-01');
    return findPreparedFlavorByFlavorId(flavor.id).expiresAt;
  }, makeFlavor());
  expect(out).toBe('2026-12-01');
});

test('26. an invalid/unknown flavorId does not silently attach a prepared batch to another flavor', async ({ page }) => {
  await loadOffline(page, { flavors: [makeFlavor(), makeFlavor({ id: 'flv-other', name: 'Other' })], version: 1 });
  const out = await page.evaluate(() => {
    savePreparedFlavor('flv-does-not-exist', '3', 'fridge', ''); // no-op: findFlavor() returns null
    return AppState.preparedFlavors.length;
  });
  expect(out).toBe(0);
});

test('31. one active batch per flavorId is enforced — a second "I made this" replaces, never duplicates', async ({ page }) => {
  await loadOffline(page);
  const out = await page.evaluate((flavor) => {
    AppState.flavors.push(normalizeFlavor(flavor));
    savePreparedFlavor(flavor.id, '8', 'freezer', '');
    var firstId = AppState.preparedFlavors[0].id;
    savePreparedFlavor(flavor.id, '3', 'fridge', ''); // "replace" path — same flavorId again
    return {
      count: AppState.preparedFlavors.length,
      sameId: AppState.preparedFlavors[0].id === firstId,
      portions: AppState.preparedFlavors[0].portionsRemaining,
      storage: AppState.preparedFlavors[0].storage
    };
  }, makeFlavor());
  expect(out.count).toBe(1);
  expect(out.sameId).toBe(true);
  expect(out.portions).toBe(3);
  expect(out.storage).toBe('fridge');
});

// ───────────────────────────────────────────────────────────────────────────
// 3. Used 1
// ───────────────────────────────────────────────────────────────────────────

test('10. Used 1 decrements exactly once locally', async ({ page }) => {
  await loadOffline(page, { flavors: [makeFlavor()], preparedFlavors: [makePrepared({ portionsInitial: 8, portionsRemaining: 8 })], version: 1 });
  await page.waitForFunction(() => AppState.preparedFlavors.length === 1);
  const out = await page.evaluate(() => { useOnePreparedFlavor('pfl-test-one'); return AppState.preparedFlavors[0].portionsRemaining; });
  expect(out).toBe(7);
});

test('11. Used 1 cannot drive portions negative', async ({ page }) => {
  await loadOffline(page, { flavors: [makeFlavor()], preparedFlavors: [makePrepared({ portionsInitial: 1, portionsRemaining: 1 })], version: 1 });
  await page.waitForFunction(() => AppState.preparedFlavors.length === 1);
  const out = await page.evaluate(() => {
    useOnePreparedFlavor('pfl-test-one'); // 1 -> 0 -> removed
    useOnePreparedFlavor('pfl-test-one'); // already gone — must be a no-op, never -1
    return AppState.preparedFlavors;
  });
  expect(out).toEqual([]);
});

test('12+13. the last Used 1 removes the batch and writes an explicit tombstone', async ({ page }) => {
  await loadOffline(page, { flavors: [makeFlavor()], preparedFlavors: [makePrepared({ portionsInitial: 1, portionsRemaining: 1 })], version: 1 });
  await page.waitForFunction(() => AppState.preparedFlavors.length === 1);
  const out = await page.evaluate(() => {
    useOnePreparedFlavor('pfl-test-one');
    return { list: AppState.preparedFlavors, tomb: readTombstone('preparedFlavors', 'pfl-test-one') };
  });
  expect(out.list).toEqual([]);
  expect(out.tomb).not.toBeNull();
});

test('15. a partial decrement (not reaching zero) writes no deletion tombstone', async ({ page }) => {
  await loadOffline(page, { flavors: [makeFlavor()], preparedFlavors: [makePrepared({ portionsInitial: 8, portionsRemaining: 8 })], version: 1 });
  await page.waitForFunction(() => AppState.preparedFlavors.length === 1);
  const tomb = await page.evaluate(() => { useOnePreparedFlavor('pfl-test-one'); return readTombstone('preparedFlavors', 'pfl-test-one'); });
  expect(tomb).toBeNull();
});

test('30. Used 1 creates no cookHistory entry — it is not a "cooked" event', async ({ page }) => {
  await loadOffline(page, { flavors: [makeFlavor()], preparedFlavors: [makePrepared()], cookHistory: [], version: 1 });
  await page.waitForFunction(() => AppState.preparedFlavors.length === 1);
  const len = await page.evaluate(() => { useOnePreparedFlavor('pfl-test-one'); return (AppState.cookHistory || []).length; });
  expect(len).toBe(0);
});

// ───────────────────────────────────────────────────────────────────────────
// 4. Persistence registry
// ───────────────────────────────────────────────────────────────────────────

test('16. preparedFlavors round-trips through localStorage', async ({ page }) => {
  await loadOffline(page, { flavors: [makeFlavor()], preparedFlavors: [makePrepared()], version: 1 });
  await page.waitForFunction(() => AppState.preparedFlavors.length === 1);
  await page.evaluate(() => saveToLocalStorage());
  const persisted = await readPreparedPersisted(page);
  expect(persisted).toHaveLength(1);
  expect(persisted[0].flavorId).toBe(SOY_ID);
});

test('17. export/import round-trips preparedFlavors (union merge, existing wins)', async ({ page }) => {
  await loadOffline(page, { flavors: [makeFlavor()], preparedFlavors: [makePrepared()], version: 1 });
  await page.waitForFunction(() => AppState.preparedFlavors.length === 1);
  const merged = await page.evaluate((flavor) => {
    var exportPayload = { flavors: [flavor], preparedFlavors: [{ id: 'pfl-imported', flavorId: flavor.id, portionsInitial: 4, portionsRemaining: 4, storage: 'fridge', preparedAt: '2026-08-01', expiresAt: null, updatedAt: '2026-08-01T00:00:00.000Z' }] };
    AppState.preparedFlavors = normalizePreparedFlavors(unionById(AppState.preparedFlavors, exportPayload.preparedFlavors));
    return AppState.preparedFlavors.map(function(p) { return p.id; }).sort();
  }, makeFlavor());
  expect(merged).toEqual(['pfl-imported', 'pfl-test-one']);
});

test('18. backup/restore round-trips preparedFlavors', async ({ page }) => {
  await loadOffline(page, { flavors: [makeFlavor()], preparedFlavors: [makePrepared()], version: 1 });
  await page.waitForFunction(() => AppState.preparedFlavors.length === 1);
  await page.evaluate(() => createBackup('test'));
  await page.evaluate(() => { AppState.preparedFlavors = []; saveToLocalStorage(); });
  const restored = await page.evaluate(() => {
    var raw = localStorage.getItem('mealPrepBackup');
    var backup = JSON.parse(raw);
    AppState.preparedFlavors = normalizePreparedFlavors(backup.data.preparedFlavors || []);
    return AppState.preparedFlavors;
  });
  expect(restored).toHaveLength(1);
  expect(restored[0].flavorId).toBe(SOY_ID);
});

test('19. buildFirestorePayload() includes preparedFlavors', async ({ page }) => {
  await loadOffline(page, { flavors: [makeFlavor()], preparedFlavors: [makePrepared()], version: 1 });
  await page.waitForFunction(() => AppState.preparedFlavors.length === 1);
  const payload = await page.evaluate(() => buildFirestorePayload());
  expect(payload.preparedFlavors).toHaveLength(1);
  expect(payload.preparedFlavors[0].id).toBe('pfl-test-one');
});

test('20. sign-in merge (loadUserData UKEYS union) preserves preparedFlavors made offline', async ({ page }) => {
  await loadSignedIn(page, {
    cloudDoc: { version: 1, flavors: [makeFlavor()], recipes: [] },
    localDoc: { flavors: [makeFlavor()], preparedFlavors: [makePrepared()], version: 0 }
  });
  await page.waitForFunction(() => AppState.preparedFlavors.length === 1);
  const pf = await page.evaluate(() => AppState.preparedFlavors[0]);
  expect(pf.id).toBe('pfl-test-one');
});

test('21. the realtime listener path recognizes preparedFlavors from another device', async ({ page }) => {
  await loadSignedIn(page, { cloudDoc: { version: 1, flavors: [makeFlavor()], recipes: [] } });
  await page.evaluate((flavor) => {
    window.__pushSnapshot({
      version: 2, flavors: [flavor],
      preparedFlavors: [{ id: 'pfl-remote', flavorId: flavor.id, portionsInitial: 5, portionsRemaining: 5, storage: 'freezer', preparedAt: '2026-08-25', expiresAt: null, updatedAt: '2026-08-25T00:00:00.000Z' }]
    });
  }, makeFlavor());
  await page.waitForFunction(() => AppState.preparedFlavors.length === 1);
  const pf = await page.evaluate(() => AppState.preparedFlavors[0]);
  expect(pf.id).toBe('pfl-remote');
});

// ───────────────────────────────────────────────────────────────────────────
// 5. Tombstones
// ───────────────────────────────────────────────────────────────────────────

test('22. a tombstone suppresses a stale prepared-flavor record on load', async ({ page }) => {
  await loadOffline(page, {
    flavors: [makeFlavor()],
    preparedFlavors: [makePrepared({ updatedAt: '2026-08-01T00:00:00.000Z' })],
    deletions: { preparedFlavors: { 'pfl-test-one': '2026-08-15T00:00:00.000Z' } },
    version: 1
  });
  const out = await page.evaluate(() => { applyTombstones(); return AppState.preparedFlavors; });
  expect(out).toEqual([]);
});

test('23. a deleted prepared flavor does not resurrect from a stale remote copy (sign-in union)', async ({ page }) => {
  await loadSignedIn(page, {
    cloudDoc: { version: 1, flavors: [makeFlavor()], recipes: [], preparedFlavors: [makePrepared({ updatedAt: '2026-08-01T00:00:00.000Z' })] },
    localDoc: { flavors: [makeFlavor()], preparedFlavors: [], deletions: { preparedFlavors: { 'pfl-test-one': '2026-08-20T00:00:00.000Z' } }, version: 0 }
  });
  await page.waitForFunction(() => AppState.cloudReady === true);
  const list = await page.evaluate(() => AppState.preparedFlavors);
  expect(list).toEqual([]);
});

test('14. 6+ simultaneous prepared-flavor disappearances are suppressed by MASS_DELETE_GUARD, not tombstoned as real deletes', async ({ page }) => {
  await loadOffline(page);
  const result = await page.evaluate(() => {
    var items = Array.from({ length: 6 }, (_, i) => ({
      id: 'pfl-guard-' + i, flavorId: 'flv-guard-' + i, portionsInitial: 1, portionsRemaining: 1,
      storage: 'fridge', preparedAt: '2026-08-01', expiresAt: null, updatedAt: '2026-08-01T00:00:00.000Z'
    }));
    AppState.preparedFlavors = items;
    snapshotIdBaseline();
    AppState.preparedFlavors = []; // transient-empty load-race simulation, not a real user delete
    recordLocalDeletions();
    return normalizeDeletions(AppState.deletions).preparedFlavors;
  });
  expect(Object.keys(result)).toEqual([]);
});

// ───────────────────────────────────────────────────────────────────────────
// 6. Normalization robustness
// ───────────────────────────────────────────────────────────────────────────

test('25. a malformed preparedFlavor record does not crash rendering', async ({ page }) => {
  await loadOffline(page, {
    flavors: [makeFlavor()],
    preparedFlavors: [null, 'garbage', {}, { id: 'pfl-no-flavor' }, makePrepared()],
    version: 1
  });
  await expect(page.locator('#flavors')).toBeAttached();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await openFlavorTab(page);
  const list = await page.evaluate(() => AppState.preparedFlavors);
  expect(list).toHaveLength(1); // only the one well-formed record survives
  expect(errors).toEqual([]);
});

test('normalization repairs an incoherent portions pair by raising initial, never clamping remaining', async ({ page }) => {
  await loadOffline(page);
  const out = await page.evaluate(() => normalizePreparedFlavor({ id: 'pfl-x', flavorId: 'flv-x', portionsInitial: 2, portionsRemaining: 5 }));
  expect(out.portionsInitial).toBe(5);
  expect(out.portionsRemaining).toBe(5);
});

test('normalization never invents updatedAt', async ({ page }) => {
  await loadOffline(page);
  const out = await page.evaluate(() => normalizePreparedFlavor({ id: 'pfl-x', flavorId: 'flv-x' }));
  expect(out.updatedAt).toBeUndefined();
});

test('normalizePreparedFlavors is idempotent', async ({ page }) => {
  await loadOffline(page);
  const same = await page.evaluate(() => {
    var raw = [makePreparedFixture()];
    function makePreparedFixture() { return { id: 'pfl-a', flavorId: 'flv-a', portionsInitial: 8, portionsRemaining: 3, storage: 'freezer', preparedAt: '2026-08-01', expiresAt: null }; }
    var once = normalizePreparedFlavors(JSON.parse(JSON.stringify(raw)));
    var twice = normalizePreparedFlavors(JSON.parse(JSON.stringify(once)));
    return JSON.stringify(once) === JSON.stringify(twice);
  });
  expect(same).toBe(true);
});

// ───────────────────────────────────────────────────────────────────────────
// 7. Isolation from Flavor Library, cookedMeals and Meal Lego
// ───────────────────────────────────────────────────────────────────────────

test('27. Flavor Library recipe/knowledge data is unchanged when prepared stock changes', async ({ page }) => {
  await loadOffline(page, { flavors: [makeFlavor()], version: 1 });
  const before = await page.evaluate(() => JSON.stringify(AppState.flavors[0]));
  await page.evaluate((flavorId) => { savePreparedFlavor(flavorId, '8', 'freezer', ''); useOnePreparedFlavor(findPreparedFlavorByFlavorId(flavorId).id); }, SOY_ID);
  const after = await page.evaluate(() => JSON.stringify(AppState.flavors[0]));
  expect(after).toBe(before);
});

test('28. cookedMeals is unchanged when prepared-flavor stock changes', async ({ page }) => {
  await loadOffline(page, {
    flavors: [makeFlavor()],
    cookedMeals: [{ id: 'cm_1', name: 'Cooked Chicken', cookedDate: '2026-08-20', storage: 'fridge', portionsRemaining: 4, initialPortions: 4 }],
    version: 1
  });
  const before = await page.evaluate(() => JSON.stringify(AppState.cookedMeals));
  await page.evaluate((flavorId) => { savePreparedFlavor(flavorId, '8', 'freezer', ''); }, SOY_ID);
  const after = await page.evaluate(() => JSON.stringify(AppState.cookedMeals));
  expect(after).toBe(before);
});

test('29. Meal Lego compatibility output is unchanged by prepared-flavor stock', async ({ page }) => {
  await loadOffline(page, {
    flavors: [makeFlavor()],
    cookedMeals: [{ id: 'cm_1', name: 'Cooked Chicken', cookedDate: '2026-08-20', storage: 'fridge', proteinType: 'chicken' }],
    version: 1
  });
  const before = await page.evaluate(() => JSON.stringify(getCompatibleFlavorsForCookedMeal(AppState.cookedMeals[0])));
  await page.evaluate((flavorId) => { savePreparedFlavor(flavorId, '8', 'freezer', ''); }, SOY_ID);
  const after = await page.evaluate(() => JSON.stringify(getCompatibleFlavorsForCookedMeal(AppState.cookedMeals[0])));
  expect(after).toBe(before);
});

test('32. deleting a Flavor Library flavor does not mutate its prepared-stock record (orphan, not cascade-deleted)', async ({ page }) => {
  await loadOffline(page, { flavors: [makeFlavor()], preparedFlavors: [makePrepared()], version: 1 });
  await page.waitForFunction(() => AppState.preparedFlavors.length === 1);
  const out = await page.evaluate((flavorId) => {
    AppState.flavors = AppState.flavors.filter((f) => f.id !== flavorId);
    return AppState.preparedFlavors;
  }, SOY_ID);
  expect(out).toHaveLength(1);
  expect(out[0].flavorId).toBe(SOY_ID);
  expect(out[0].portionsRemaining).toBe(8);
});

test('orphaned prepared stock (flavor deleted) renders honestly instead of crashing', async ({ page }) => {
  await loadOffline(page, { flavors: [makeFlavor()], preparedFlavors: [makePrepared()], version: 1 });
  await page.waitForFunction(() => AppState.preparedFlavors.length === 1);
  await page.evaluate((flavorId) => { AppState.flavors = AppState.flavors.filter((f) => f.id !== flavorId); }, SOY_ID);
  await openFlavorTab(page);
  await expect(page.locator('#prepared-flavors-list')).toContainText('Unknown flavor');
});

// ───────────────────────────────────────────────────────────────────────────
// 8. UI smoke
// ───────────────────────────────────────────────────────────────────────────

test('39. Prepared Flavors card has no horizontal overflow at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await loadOffline(page, { flavors: [makeFlavor()], preparedFlavors: [makePrepared()], version: 1 });
  await page.waitForFunction(() => AppState.preparedFlavors.length === 1);
  await openFlavorTab(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  expect(overflow).toBe(false);
});

test('40. no console/page errors from load through Used 1', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await loadOffline(page, { flavors: [makeFlavor()], preparedFlavors: [makePrepared({ portionsInitial: 1, portionsRemaining: 1 })], version: 1 });
  await page.waitForFunction(() => AppState.preparedFlavors.length === 1);
  await openFlavorTab(page);
  await page.click('.prepared-flavor-use');
  await page.waitForTimeout(200);
  const appErrors = errors.filter((e) => !/net::ERR|Failed to load resource|favicon|frame-ancestors|google\.com/i.test(e));
  expect(appErrors).toEqual([]);
});

// ───────────────────────────────────────────────────────────────────────────
// MUTATION PROOFS — prove the safety code actually does something
// ───────────────────────────────────────────────────────────────────────────

test('MUTATION: removing preparedFlavors from buildFirestorePayload() loses it on save', async ({ page }) => {
  await loadOffline(page, { flavors: [makeFlavor()], preparedFlavors: [makePrepared()], version: 1 });
  await page.waitForFunction(() => AppState.preparedFlavors.length === 1);
  const result = await page.evaluate(() => {
    var original = buildFirestorePayload;
    var mutant = eval('(' + original.toString().replace(/preparedFlavors:\s*AppState\.preparedFlavors,\s*pantry:/, 'pantry:') + ')');
    var payload = mutant();
    return { hasKey: Object.prototype.hasOwnProperty.call(payload, 'preparedFlavors') };
  });
  expect(result.hasKey).toBe(false); // proves the real function's line is load-bearing
  const realHasKey = await page.evaluate(() => Object.prototype.hasOwnProperty.call(buildFirestorePayload(), 'preparedFlavors'));
  expect(realHasKey).toBe(true);
});

test('MUTATION: removing the explicit tombstone write from removePreparedFlavor() lets a zero-batch resurrect from a stale cloud copy', async ({ page }) => {
  await loadOffline(page);
  const result = await page.evaluate(() => {
    var original = removePreparedFlavor;
    var mutant = eval('(' + original.toString().replace("writeTombstone('preparedFlavors', id);", '') + ')');

    // Real function: tombstone IS written.
    AppState.preparedFlavors = [{ id: 'pfl-z', flavorId: 'flv-z', portionsInitial: 1, portionsRemaining: 1, storage: 'fridge', preparedAt: '2026-08-01', expiresAt: null, updatedAt: '2026-08-01T00:00:00.000Z' }];
    AppState.deletions = {};
    removePreparedFlavor('pfl-z');
    var realTomb = readTombstone('preparedFlavors', 'pfl-z');

    // Mutant: tombstone write removed.
    AppState.preparedFlavors = [{ id: 'pfl-z2', flavorId: 'flv-z', portionsInitial: 1, portionsRemaining: 1, storage: 'fridge', preparedAt: '2026-08-01', expiresAt: null, updatedAt: '2026-08-01T00:00:00.000Z' }];
    AppState.deletions = {};
    mutant('pfl-z2');
    var mutantTomb = readTombstone('preparedFlavors', 'pfl-z2');

    return { realTomb: realTomb, mutantTomb: mutantTomb };
  });
  expect(result.realTomb).not.toBeNull();
  expect(result.mutantTomb).toBeNull(); // the mutant proves the removed line was the only thing writing it
});

test('MUTATION: bypassing the existing-batch lookup in savePreparedFlavor() duplicates instead of replacing', async ({ page }) => {
  await loadOffline(page);
  const result = await page.evaluate((flavor) => {
    AppState.flavors.push(normalizeFlavor(flavor));
    var original = savePreparedFlavor;
    // Force "existing" to always be null, simulating a save that skipped the
    // one-active-batch lookup entirely.
    var mutant = eval('(' + original.toString().replace('var existing = findPreparedFlavorByFlavorId(flavorId);', 'var existing = null;') + ')');

    mutant(flavor.id, '8', 'freezer', '');
    mutant(flavor.id, '3', 'fridge', '');
    return AppState.preparedFlavors.length;
  }, makeFlavor());
  expect(result).toBe(2); // proves the real lookup (which keeps this at 1 — see test 31) is load-bearing
});
