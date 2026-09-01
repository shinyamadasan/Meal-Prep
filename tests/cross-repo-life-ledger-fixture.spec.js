const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

/**
 * Cross-repo Life Ledger proof, half A (source side).
 *
 * The ChronaSense meal-life-ledger-adapter test suite must validate against REAL Meal
 * source output shapes, not only hand-built adapter fixtures (architectural review
 * requirement). This spec captures a REAL cookedMeal record and a REAL mealConsumption
 * record - produced by actually calling normalizeCookedMeals() and useCookedPortion() in a
 * real browser page, the same way every other spec in this suite exercises the app - and
 * writes them to tests/fixtures/cross-repo-life-ledger-fixture.json.
 *
 * That file is read directly by the ChronaSense repo's
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
          typeof saveData === 'function' && typeof useCookedPortion === 'function',
    null, { timeout: 30000 });
  await page.waitForTimeout(300);
}

test('capture real cookedMeal + mealConsumption output shapes for the ChronaSense adapter cross-repo suite', async ({ page }) => {
  await loadLocalApp(page);

  const captured = await page.evaluate(() => {
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

    // The ONLY genuinely unambiguous "I ate a portion" action in the real app - produces
    // exactly one durable mealConsumption record via the real recordMealConsumption() path,
    // using the real crypto.randomUUID()-based generateMealConsumptionId().
    useCookedPortion('cm_xrepo_1700000000000_001');

    return {
      cookedMeals: JSON.parse(JSON.stringify(AppState.cookedMeals)),
      mealConsumptions: JSON.parse(JSON.stringify(AppState.mealConsumptions)),
      deletions: JSON.parse(JSON.stringify(normalizeDeletions(AppState.deletions)))
    };
  });

  // Sanity: this is genuinely the real output shape, not a stand-in.
  expect(captured.cookedMeals.length).toBe(2);
  expect(captured.mealConsumptions.length).toBe(1);
  expect(captured.mealConsumptions[0].cookedMealId).toBe('cm_xrepo_1700000000000_001');
  expect(captured.mealConsumptions[0].id.indexOf('mc_')).toBe(0);
  expect(captured.mealConsumptions[0].id.length).toBeGreaterThan('mc_'.length + 20); // crypto.randomUUID()-shaped, not the old short scheme

  const fixturesDir = path.resolve(__dirname, 'fixtures');
  fs.mkdirSync(fixturesDir, { recursive: true });
  const fixturePath = path.join(fixturesDir, 'cross-repo-life-ledger-fixture.json');
  fs.writeFileSync(fixturePath, JSON.stringify({
    capturedAt: new Date().toISOString(),
    capturedFrom: 'feat/durable-meal-consumption-events (post architectural redesign)',
    cookedMeals: captured.cookedMeals,
    mealConsumptions: captured.mealConsumptions,
    deletions: captured.deletions
  }, null, 2) + '\n', 'utf8');

  // The write must itself be clean UTF-8 with no stray control bytes (byte/encoding audit).
  // Escaped code-point checks only, deliberately never a literal control character typed in
  // this source file.
  const raw = fs.readFileSync(fixturePath, 'utf8');
  const hasUnsafeByte = Array.from(raw).some((ch) => {
    const code = ch.codePointAt(0);
    return code === 0x00 || code === 0x7f || (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d);
  });
  expect(hasUnsafeByte).toBe(false);
  expect(raw.codePointAt(0)).not.toBe(0xfeff); // no BOM
  expect(JSON.parse(raw).mealConsumptions.length).toBe(1);
});
