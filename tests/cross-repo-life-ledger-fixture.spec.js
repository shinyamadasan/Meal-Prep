const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const FIXTURE_UPDATE_ENV = 'MEAL_CROSS_REPO_LIFE_LEDGER_FIXTURE_UPDATE';
const FIXTURE_UPDATE_ENABLED = process.env[FIXTURE_UPDATE_ENV] === '1';
const FIXTURE_KEYS = [
  'capturedAt',
  'capturedFrom',
  'cookedMeals',
  'mealConsumptions',
  'deletions',
  'tombstoneScenario'
];
const LEDGER_KEYS = ['cookedMeals', 'mealConsumptions', 'deletions'];
const TOMBSTONE_KEYS = [
  'recipes',
  'pantry',
  'customIngredients',
  'customHacks',
  'flavors',
  'preparedFlavors',
  'cookedMeals',
  'userIngredients'
];
const TOMBSTONE_MEAL_ID = 'cm_xrepo_1700000000000_003';

/**
 * Cross-repo Life Ledger proof, half A (source side).
 *
 * The ChronaSense meal-life-ledger-adapter test suite must validate against REAL Meal
 * source output shapes, not only hand-built adapter fixtures (architectural review
 * requirement). This spec captures REAL cookedMeal and mealConsumption records by
 * calling the same runtime functions used by the app in a real browser page.
 *
 * Every run writes the captured bytes to Playwright's per-test output directory. The
 * tracked fixture is changed only by the explicit fixture-update command, which sets
 * FIXTURE_UPDATE_ENV. That file is read directly by the ChronaSense repo's
 * meal-cross-repo-life-ledger.test.js (relative sibling-directory path - both repos live
 * under the same parent folder on this machine). Re-run this spec whenever Meal's
 * cookedMeal/mealConsumption shape changes, so the fixture never drifts stale.
 */

test.use({ viewport: { width: 1200, height: 1500 } });

async function loadLocalApp(page) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__crossRepoFixtureBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__crossRepoFixtureBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
  });
  await page.goto(pathToFileURL(path.resolve('index.html')).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => typeof AppState !== 'undefined' && Array.isArray(AppState.cookedMeals) &&
          typeof saveData === 'function' && typeof useCookedPortion === 'function' &&
          typeof removeCookedMeal === 'function' && typeof snapshotIdBaseline === 'function' &&
          typeof recordLocalDeletions === 'function',
    null, { timeout: 30000 });
  await page.waitForTimeout(300);
}

function assertCleanUtf8Json(filePath) {
  const bytes = fs.readFileSync(filePath);
  const raw = bytes.toString('utf8');

  // A decode/re-encode round trip rejects malformed UTF-8 rather than silently
  // accepting replacement characters. The explicit checks cover control bytes/BOM.
  expect(Buffer.from(raw, 'utf8').equals(bytes)).toBe(true);
  const hasUnsafeByte = Array.from(raw).some((ch) => {
    const code = ch.codePointAt(0);
    return code === 0x00 || code === 0x7f || (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d);
  });
  expect(hasUnsafeByte).toBe(false);
  expect(raw.codePointAt(0)).not.toBe(0xfeff); // no BOM
  return JSON.parse(raw);
}

function assertDeletionShape(deletions) {
  expect(deletions).toBeTruthy();
  expect(Object.keys(deletions).sort()).toEqual(TOMBSTONE_KEYS.slice().sort());
  TOMBSTONE_KEYS.forEach((key) => expect(deletions[key]).toEqual(expect.any(Object)));
}

function assertLedgerShape(ledger) {
  expect(Object.keys(ledger).sort()).toEqual(LEDGER_KEYS.slice().sort());
  expect(Array.isArray(ledger.cookedMeals)).toBe(true);
  expect(Array.isArray(ledger.mealConsumptions)).toBe(true);
  assertDeletionShape(ledger.deletions);
}

function assertFixtureShape(fixture) {
  expect(Object.keys(fixture).sort()).toEqual(FIXTURE_KEYS.slice().sort());
  expect(fixture.capturedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  expect(typeof fixture.capturedFrom).toBe('string');
  assertLedgerShape({
    cookedMeals: fixture.cookedMeals,
    mealConsumptions: fixture.mealConsumptions,
    deletions: fixture.deletions
  });
  expect(Object.keys(fixture.tombstoneScenario).sort()).toEqual(['before', 'after'].sort());
  assertLedgerShape(fixture.tombstoneScenario.before);
  assertLedgerShape(fixture.tombstoneScenario.after);

  const beforeMeals = fixture.tombstoneScenario.before.cookedMeals.map((meal) => meal.id);
  const afterMeals = fixture.tombstoneScenario.after.cookedMeals.map((meal) => meal.id);
  expect(beforeMeals).toContain(TOMBSTONE_MEAL_ID);
  expect(afterMeals).not.toContain(TOMBSTONE_MEAL_ID);
  expect(fixture.tombstoneScenario.after.deletions.cookedMeals[TOMBSTONE_MEAL_ID]).toEqual(expect.any(String));
}

test('capture real cookedMeal + mealConsumption output shapes for the ChronaSense adapter cross-repo suite', async ({ page }, testInfo) => {
  await loadLocalApp(page);

  const captured = await page.evaluate((tombstoneMealId) => {
    function clone(value) { return JSON.parse(JSON.stringify(value)); }
    function ledgerSnapshot() {
      return {
        cookedMeals: clone(AppState.cookedMeals),
        mealConsumptions: clone(AppState.mealConsumptions),
        deletions: clone(normalizeDeletions(AppState.deletions))
      };
    }

    // A real recipe-backed, portion-tracked batch, run through the SAME normalizeCookedMeals()
    // every persisted cookedMeal actually passes through.
    AppState.cookedMeals = normalizeCookedMeals([{
      id: 'cm_xrepo_1700000000000_001',
      recipeId: 'r_xrepo_42',
      source: null,
      name: 'Cross-Repo Chicken Bowls',
      cookedDate: '2026-08-28',
      storage: 'fridge',
      fridgeLife: 4,
      freezerLife: 90,
      initialPortions: 3,
      portionsRemaining: 3
    }]);
    AppState.mealConsumptions = [];
    AppState.deletions = normalizeDeletions({});

    // A second, manual/backdated batch - untracked (no portion count), exercising the
    // leftovers/no-recipeId shape too.
    AppState.cookedMeals.push({
      id: 'cm_xrepo_1700000000000_002',
      recipeId: null,
      source: 'leftovers',
      name: 'Cross-Repo Backdated Leftover Pork',
      cookedDate: '2026-08-20',
      storage: 'freezer',
      fridgeLife: 3,
      freezerLife: 90,
      initialPortions: null,
      portionsRemaining: null
    });

    // A third, isolated batch exists only to prove the real remove/tombstone path and
    // does not affect the top-level positive cookedMeal examples after it is removed.
    AppState.cookedMeals.push({
      id: tombstoneMealId,
      recipeId: 'r_xrepo_99',
      source: null,
      name: 'Cross-Repo Tombstone Meal',
      cookedDate: '2026-08-27',
      storage: 'fridge',
      fridgeLife: 4,
      freezerLife: 90,
      initialPortions: 2,
      portionsRemaining: 2
    });

    // The ONLY genuinely unambiguous "I ate a portion" action in the real app - produces
    // exactly one durable mealConsumption record via the real recordMealConsumption() path,
    // using the real crypto.randomUUID()-based generateMealConsumptionId().
    useCookedPortion('cm_xrepo_1700000000000_001');

    // snapshotIdBaseline() is the same runtime baseline used by Meal's save path. The local
    // Playwright run is deliberately unauthenticated, so removeCookedMeal()'s saveData() has
    // no Firestore write to enter recordLocalDeletions(); invoke that real diff helper after
    // the real removal instead of fabricating a tombstone map.
    snapshotIdBaseline();
    const tombstoneBefore = ledgerSnapshot();
    removeCookedMeal(tombstoneMealId);
    recordLocalDeletions();
    const tombstoneAfter = ledgerSnapshot();

    return {
      capturedAt: new Date().toISOString(),
      capturedFrom: 'feat/durable-meal-consumption-events (post architectural redesign)',
      cookedMeals: tombstoneAfter.cookedMeals,
      mealConsumptions: tombstoneAfter.mealConsumptions,
      deletions: tombstoneBefore.deletions,
      tombstoneScenario: { before: tombstoneBefore, after: tombstoneAfter }
    };
  }, TOMBSTONE_MEAL_ID);

  // Sanity: this is genuinely the real output shape, not a stand-in.
  expect(captured.cookedMeals.length).toBe(2);
  expect(captured.mealConsumptions.length).toBe(1);
  expect(captured.mealConsumptions[0].cookedMealId).toBe('cm_xrepo_1700000000000_001');
  expect(captured.mealConsumptions[0].id.indexOf('mc_')).toBe(0);
  expect(captured.mealConsumptions[0].id.length).toBeGreaterThan('mc_'.length + 20); // crypto.randomUUID()-shaped, not the old short scheme
  expect(captured.tombstoneScenario.before.cookedMeals.map((meal) => meal.id)).toContain(TOMBSTONE_MEAL_ID);
  expect(captured.tombstoneScenario.after.cookedMeals.map((meal) => meal.id)).not.toContain(TOMBSTONE_MEAL_ID);
  expect(captured.tombstoneScenario.after.deletions.cookedMeals[TOMBSTONE_MEAL_ID]).toEqual(expect.any(String));

  const fixturePath = path.resolve(__dirname, 'fixtures', 'cross-repo-life-ledger-fixture.json');
  const liveArtifactPath = testInfo.outputPath('cross-repo-life-ledger-fixture.json');
  const serialized = JSON.stringify(captured, null, 2) + '\n';
  fs.mkdirSync(path.dirname(liveArtifactPath), { recursive: true });
  fs.writeFileSync(liveArtifactPath, serialized, 'utf8');

  // Intentional tracked-fixture mutation is available only through the explicit npm command.
  if (FIXTURE_UPDATE_ENABLED) fs.writeFileSync(fixturePath, serialized, 'utf8');

  const liveFixture = assertCleanUtf8Json(liveArtifactPath);
  const committedFixture = assertCleanUtf8Json(fixturePath);
  assertFixtureShape(liveFixture);
  assertFixtureShape(committedFixture);
  expect(liveFixture.cookedMeals.length).toBe(2);
  expect(liveFixture.mealConsumptions.length).toBe(1);
  expect(committedFixture.mealConsumptions.length).toBe(1);
});
