# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: prepared-flavors.spec.js >> MUTATION: removing preparedFlavors from buildFirestorePayload() loses it on save
- Location: tests\prepared-flavors.spec.js:537:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: page.goto: Test timeout of 30000ms exceeded.
Call log:
  - navigating to "http://127.0.0.1:47813/index.html", waiting until "domcontentloaded"

```

# Test source

```ts
  1   | const { test, expect } = require('@playwright/test');
  2   | const { waitForAppReady, waitForRestored } = require('./app-ready');
  3   | 
  4   | /**
  5   |  * Flavor Bomb v1 — AppState.preparedFlavors, a NEW top-level synced collection.
  6   |  *
  7   |  * Same reason flavor-library.spec.js exists (D-070): this is D-032 red-zone work —
  8   |  * it adds a key to TOMBSTONE_KEYS, the Firestore payload, the Firestore load, the
  9   |  * sign-in union, the cloud-conflict merge and the realtime listener. Coverage here
  10  |  * is deliberately PERSISTENCE first, UI second. See DECISIONS.md D-074.
  11  |  *
  12  |  * Two harnesses, same shape as flavor-library.spec.js:
  13  |  *   loadOffline()  — no window.firebase. Proves localStorage / backup / import.
  14  |  *   loadSignedIn() — installs a Firestore MOCK before the page loads, so initApp()
  15  |  *                    takes the real signed-in branch and exercises the actual
  16  |  *                    loadFromFirestore / loadUserData-union / setupRealtimeListeners
  17  |  *                    / saveToFirestore code, not a re-implementation of it.
  18  |  */
  19  | 
  20  | const APP_URL = () => '/index.html';
  21  | 
  22  | const SOY_ID = 'flv-soy-calamansi';
  23  | const SOY_NAME = 'Soy-Calamansi';
  24  | 
  25  | function makeFlavor(over) {
  26  |   return Object.assign({
  27  |     id: SOY_ID,
  28  |     name: SOY_NAME,
  29  |     ingredients: [{ name: 'Soy Sauce', baseQuantity: 4, unit: 'tbsp', category: 'Pantry' }],
  30  |     instructions: 'Mix it.',
  31  |     activeTime: 5,
  32  |     preparationStyle: 'freezer-friendly',
  33  |     worksWith: ['chicken'],
  34  |     tags: [],
  35  |     updatedAt: '2026-08-01T00:00:00.000Z'
  36  |   }, over || {});
  37  | }
  38  | 
  39  | function makePrepared(over) {
  40  |   return Object.assign({
  41  |     id: 'pfl-test-one',
  42  |     flavorId: SOY_ID,
  43  |     portionsInitial: 8,
  44  |     portionsRemaining: 8,
  45  |     storage: 'freezer',
  46  |     preparedAt: '2026-08-20',
  47  |     expiresAt: null,
  48  |     updatedAt: '2026-08-20T00:00:00.000Z'
  49  |   }, over || {});
  50  | }
  51  | 
  52  | function bootstrapStorage() {
  53  |   return (doc) => {
  54  |     try {
  55  |       if (localStorage.getItem('__preparedFlavorSpecBootstrapped')) return;
  56  |       localStorage.clear();
  57  |       localStorage.setItem('__preparedFlavorSpecBootstrapped', '1');
  58  |       localStorage.setItem('mealPrepHelpSeen', '1');
  59  |       localStorage.setItem('mealPrepStartDone', '1');
  60  |       localStorage.setItem('pantryOnboardingDone', '1');
  61  |       localStorage.setItem('mealPrepInitialized', '1');
  62  |       if (doc) localStorage.setItem('mealPrepAppData', JSON.stringify(doc));
  63  |     } catch (e) {}
  64  |   };
  65  | }
  66  | 
  67  | async function loadOffline(page, localDoc) {
  68  |   await page.route('**/firebasejs/**', (r) => r.abort());
  69  |   await page.addInitScript(bootstrapStorage(), localDoc || null);
> 70  |   await page.goto(APP_URL(), { waitUntil: 'domcontentloaded' });
      |              ^ Error: page.goto: Test timeout of 30000ms exceeded.
  71  |   await waitForAppReady(page);
  72  | }
  73  | 
  74  | async function loadSignedIn(page, { cloudDoc = null, localDoc = null } = {}) {
  75  |   await page.route('**/firebasejs/**', (r) => r.abort());
  76  |   await page.addInitScript(bootstrapStorage(), localDoc);
  77  |   await page.addInitScript((initialCloud) => {
  78  |     const state = { doc: initialCloud ? JSON.parse(JSON.stringify(initialCloud)) : null };
  79  |     let snapshotCb = null;
  80  |     const snapOf = () => ({ exists: () => state.doc !== null, data: () => JSON.parse(JSON.stringify(state.doc)) });
  81  |     const write = (data) => {
  82  |       state.doc = JSON.parse(JSON.stringify(data));
  83  |       window.__writes.push(JSON.parse(JSON.stringify(data)));
  84  |     };
  85  |     window.__writes = [];
  86  |     window.__cloud = state;
  87  |     window.__pushSnapshot = (data) => { state.doc = JSON.parse(JSON.stringify(data)); if (snapshotCb) snapshotCb(snapOf()); };
  88  |     window.__setCloudSilently = (data) => { state.doc = JSON.parse(JSON.stringify(data)); };
  89  |     const user = { uid: 'test-uid', email: 'test@example.com', emailVerified: true, reload: async () => {} };
  90  |     window.firebase = {
  91  |       db: {},
  92  |       auth: { currentUser: user },
  93  |       doc: () => ({ __ref: 'users/test-uid' }),
  94  |       collection: () => ({ __ref: 'photos' }),
  95  |       getDoc: async () => snapOf(),
  96  |       getDocs: async () => ({ forEach: () => {} }),
  97  |       setDoc: async (_ref, data) => write(data),
  98  |       deleteDoc: async () => {},
  99  |       runTransaction: async (_db, fn) => fn({ get: async () => snapOf(), set: (_ref, data) => write(data) }),
  100 |       onSnapshot: (_ref, cb) => { snapshotCb = cb; return () => {}; },
  101 |       onAuthStateChanged: (_auth, cb) => { setTimeout(() => cb(user), 0); return () => {}; },
  102 |       signOut: async () => {},
  103 |       query: () => ({}), where: () => ({}), orderBy: () => ({}),
  104 |       signInWithEmailAndPassword: async () => ({ user }),
  105 |       createUserWithEmailAndPassword: async () => ({ user }),
  106 |       sendEmailVerification: async () => {},
  107 |       sendPasswordResetEmail: async () => {}
  108 |     };
  109 |   }, cloudDoc);
  110 |   await page.goto(APP_URL(), { waitUntil: 'domcontentloaded' });
  111 |   await waitForAppReady(page);
  112 |   await page.waitForFunction(() => AppState.cloudReady === true, null, { timeout: 30000 });
  113 | }
  114 | 
  115 | async function openFlavorTab(page) {
  116 |   await page.evaluate(() => showTab('flavors'));
  117 |   await expect(page.locator('#flavors')).toHaveClass(/active/);
  118 | }
  119 | 
  120 | const readPreparedPersisted = (page) => page.evaluate(
  121 |   () => JSON.parse(localStorage.getItem('mealPrepAppData') || '{}').preparedFlavors || null);
  122 | 
  123 | // ───────────────────────────────────────────────────────────────────────────
  124 | // 1. Backward compatibility
  125 | // ───────────────────────────────────────────────────────────────────────────
  126 | 
  127 | test('1. a saved document with no preparedFlavors key loads as empty stock', async ({ page }) => {
  128 |   await loadOffline(page, { recipes: [], flavors: [makeFlavor()], version: 3 });
  129 |   const list = await page.evaluate(() => AppState.preparedFlavors);
  130 |   expect(list).toEqual([]);
  131 | });
  132 | 
  133 | test('24. old saved data (recipes/pantry/flavors, no preparedFlavors) remains fully compatible', async ({ page }) => {
  134 |   await loadOffline(page, {
  135 |     recipes: [{ id: 101, name: 'Old Adobo', baseIngredients: [], instructions: 'Cook.' }],
  136 |     pantry: [{ id: 900, name: 'Eggs' }],
  137 |     flavors: [makeFlavor()],
  138 |     version: 3
  139 |   });
  140 |   const state = await page.evaluate(() => ({
  141 |     recipes: AppState.recipes.map((r) => r.name),
  142 |     pantry: AppState.pantry.map((p) => p.name),
  143 |     flavors: AppState.flavors.map((f) => f.name),
  144 |     prepared: AppState.preparedFlavors
  145 |   }));
  146 |   expect(state.recipes).toEqual(['Old Adobo']);
  147 |   expect(state.pantry).toEqual(['Eggs']);
  148 |   expect(state.flavors).toEqual([SOY_NAME]);
  149 |   expect(state.prepared).toEqual([]);
  150 | });
  151 | 
  152 | // ───────────────────────────────────────────────────────────────────────────
  153 | // 2. Creation from a Flavor Library flavor
  154 | // ───────────────────────────────────────────────────────────────────────────
  155 | 
  156 | test('2+3. a prepared flavor can be created from a Flavor Library flavor and flavorId stays linked', async ({ page }) => {
  157 |   await loadOffline(page, { flavors: [makeFlavor()], version: 1 });
  158 |   await openFlavorTab(page);
  159 |   await page.click('.flavor-head'); // expand the card so actions are visible
  160 |   await page.click('.flavor-prepare');
  161 |   await page.fill('#prepared-flavor-portions', '8');
  162 |   await page.click('input[name="prepared-flavor-storage"][value="freezer"]');
  163 |   await page.click('.confirm-ok-btn');
  164 |   await page.waitForTimeout(200);
  165 | 
  166 |   const pf = await page.evaluate(() => AppState.preparedFlavors[0]);
  167 |   expect(pf.flavorId).toBe(SOY_ID);
  168 |   expect(pf.portionsInitial).toBe(8);
  169 |   expect(pf.portionsRemaining).toBe(8);
  170 |   expect(pf.storage).toBe('freezer');
```