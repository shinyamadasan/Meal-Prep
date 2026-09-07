const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

/**
 * Compatibility gate: "Does current Meal still satisfy MEAL_LEDGER_SOURCE_CONTRACT_V1?"
 *
 * The authoritative contract document lives in the ChronaSense repo at
 * contracts/MEAL_LEDGER_SOURCE_CONTRACT_V1.md — every test below is anchored to one of its
 * numbered sections. This spec calls the REAL global functions (canonicalizeMealConsumption,
 * mergeMealConsumptions, normalizeCookedMeal, recordLocalDeletions, generateMealConsumptionId,
 * ...) inside a real browser page, exactly like tests/cross-repo-life-ledger-fixture.spec.js —
 * it proves BEHAVIOR at the write/merge paths, not just object shapes.
 *
 * Run in isolation: `npm run test:ledger-contract`.
 */

test.use({ viewport: { width: 1200, height: 1500 } });

async function loadLocalApp(page) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__ledgerContractBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__ledgerContractBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
  });
  await page.goto(pathToFileURL(path.resolve('index.html')).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => typeof AppState !== 'undefined' &&
          typeof canonicalizeMealConsumption === 'function' &&
          typeof mergeMealConsumptions === 'function' &&
          typeof reconcileMealConsumptions === 'function' &&
          typeof normalizeCookedMeals === 'function' &&
          typeof generateMealConsumptionId === 'function' &&
          typeof recordLocalDeletions === 'function' &&
          typeof snapshotIdBaseline === 'function',
    null, { timeout: 30000 });
  await page.waitForTimeout(300);
}

test.describe('MEAL_LEDGER_SOURCE_CONTRACT_V1 — §3 closed six-field consumption schema', () => {
  test('chaos: a renamed portionsConsumed field is rejected by the real canonicalizeMealConsumption(), not coerced', async ({ page }) => {
    await loadLocalApp(page);
    const result = await page.evaluate(() => canonicalizeMealConsumption({
      id: 'mc_test', cookedMealId: 'cm_test', recipeId: null, mealName: 'Test',
      portions: 1, consumedAt: new Date().toISOString()
    }));
    expect(result, 'contract §3 broken: a record with `portions` instead of `portionsConsumed` must be rejected as outside the closed schema').toBeNull();
  });

  test('chaos: a fractional portionsConsumed is rejected by the real source function', async ({ page }) => {
    await loadLocalApp(page);
    const result = await page.evaluate(() => canonicalizeMealConsumption({
      id: 'mc_test', cookedMealId: 'cm_test', recipeId: null, mealName: 'Test',
      portionsConsumed: 1.5, consumedAt: new Date().toISOString()
    }));
    expect(result, 'contract §3 broken: a fractional portion count must be rejected').toBeNull();
  });

  test('chaos: an extra unrecognized key on an otherwise-valid record is rejected, proving the schema is genuinely closed', async ({ page }) => {
    await loadLocalApp(page);
    const result = await page.evaluate(() => canonicalizeMealConsumption({
      id: 'mc_test', cookedMealId: 'cm_test', recipeId: null, mealName: 'Test',
      portionsConsumed: 1, consumedAt: new Date().toISOString(), note: 'not part of the schema'
    }));
    expect(result, 'contract §3 broken: an extra field must be rejected, not silently dropped and accepted').toBeNull();
  });

  test('the real generateMealConsumptionId() produces the mc_ + UUID shape', async ({ page }) => {
    await loadLocalApp(page);
    const id = await page.evaluate(() => generateMealConsumptionId());
    expect(id.indexOf('mc_')).toBe(0);
    expect(id.length).toBe('mc_'.length + 36);
  });
});

test.describe('MEAL_LEDGER_SOURCE_CONTRACT_V1 — §4 append-only merge / conflict evidence', () => {
  test('append-only union: disjoint ids from both sides all survive', async ({ page }) => {
    await loadLocalApp(page);
    const result = await page.evaluate(() => mergeMealConsumptions(
      [{ id: 'mc_a', cookedMealId: 'cm_1', recipeId: null, mealName: 'A', portionsConsumed: 1, consumedAt: new Date().toISOString() }],
      [{ id: 'mc_b', cookedMealId: 'cm_2', recipeId: null, mealName: 'B', portionsConsumed: 1, consumedAt: new Date().toISOString() }]
    ));
    expect(result.merged.length).toBe(2);
    expect(result.conflicts.length).toBe(0);
  });

  test('chaos ("realtime snapshot replacement"): merging a smaller incoming array never drops existing unique ids — no wholesale replacement', async ({ page }) => {
    await loadLocalApp(page);
    const result = await page.evaluate(() => mergeMealConsumptions(
      [
        { id: 'mc_a', cookedMealId: 'cm_1', recipeId: null, mealName: 'A', portionsConsumed: 1, consumedAt: new Date().toISOString() },
        { id: 'mc_b', cookedMealId: 'cm_2', recipeId: null, mealName: 'B', portionsConsumed: 1, consumedAt: new Date().toISOString() }
      ],
      [] // an incoming "realtime snapshot" with nothing in it
    ));
    expect(result.merged.length, 'contract §4 broken: an empty/smaller incoming side must never wipe out already-accepted facts').toBe(2);
  });

  test('chaos ("backup rollback"): a stale backup record with different facts under the same id produces a conflict, never a silent rollback', async ({ page }) => {
    await loadLocalApp(page);
    const result = await page.evaluate(() => {
      const current = [{ id: 'mc_a', cookedMealId: 'cm_1', recipeId: null, mealName: 'A', portionsConsumed: 2, consumedAt: '2026-09-01T10:00:00.000Z' }];
      const staleBackup = [{ id: 'mc_a', cookedMealId: 'cm_1', recipeId: null, mealName: 'A', portionsConsumed: 1, consumedAt: '2026-08-01T10:00:00.000Z' }];
      // reconcileMealConsumptions(incoming, incomingIsAuthoritative) — a restored backup is NOT
      // authoritative over current state, so it is merged as the non-authoritative side.
      AppState.mealConsumptions = current;
      const changed = reconcileMealConsumptions(staleBackup, false);
      return { changed, merged: AppState.mealConsumptions, conflicts: AppState.mealConsumptionConflicts };
    });
    expect(result.merged.length).toBe(1);
    expect(result.merged[0].portionsConsumed, 'contract §4/§7 broken: a stale backup must never silently roll back an already-accepted fact').toBe(2);
    expect(result.conflicts.length, 'contract §4 broken: the rollback attempt must leave durable conflict evidence, not vanish silently').toBeGreaterThan(0);
  });

  test('an exact duplicate (same id, identical facts) from both sides dedupes to one, no conflict recorded', async ({ page }) => {
    await loadLocalApp(page);
    const result = await page.evaluate(() => {
      const rec = { id: 'mc_a', cookedMealId: 'cm_1', recipeId: null, mealName: 'A', portionsConsumed: 1, consumedAt: '2026-09-01T10:00:00.000Z' };
      return mergeMealConsumptions([rec], [Object.assign({}, rec)]);
    });
    expect(result.merged.length).toBe(1);
    expect(result.conflicts.length).toBe(0);
  });
});

test.describe('MEAL_LEDGER_SOURCE_CONTRACT_V1 — §5 deletion evidence (mass-delete guard, cloud-sync gating)', () => {
  test('chaos: more than MASS_DELETE_GUARD simultaneous vanishes are NOT tombstoned (treated as a transient load race)', async ({ page }) => {
    await loadLocalApp(page);
    const result = await page.evaluate(() => {
      AppState.cookedMeals = [
        { id: 'cm_1', name: 'A', cookedDate: '2026-08-01' }, { id: 'cm_2', name: 'B', cookedDate: '2026-08-01' },
        { id: 'cm_3', name: 'C', cookedDate: '2026-08-01' }, { id: 'cm_4', name: 'D', cookedDate: '2026-08-01' },
        { id: 'cm_5', name: 'E', cookedDate: '2026-08-01' }, { id: 'cm_6', name: 'F', cookedDate: '2026-08-01' }
      ];
      AppState.deletions = normalizeDeletions({});
      snapshotIdBaseline();
      AppState.cookedMeals = []; // all 6 vanish at once — a load-race shape, not a real bulk delete
      recordLocalDeletions();
      return AppState.deletions.cookedMeals;
    });
    expect(Object.keys(result).length, 'contract §5 broken: MASS_DELETE_GUARD must refuse to tombstone a >5 simultaneous vanish').toBe(0);
  });

  test('a real one-at-a-time delete (within the guard) IS tombstoned by recordLocalDeletions', async ({ page }) => {
    await loadLocalApp(page);
    const result = await page.evaluate(() => {
      AppState.cookedMeals = [{ id: 'cm_solo', name: 'A', cookedDate: '2026-08-01' }];
      AppState.deletions = normalizeDeletions({});
      snapshotIdBaseline();
      AppState.cookedMeals = [];
      recordLocalDeletions();
      return AppState.deletions.cookedMeals;
    });
    expect(typeof result.cm_solo).toBe('string');
  });
});

test.describe('MEAL_LEDGER_SOURCE_CONTRACT_V1 — benign changes must not break normalization', () => {
  test('benign: an unrelated extra property on a cookedMeal record survives normalizeCookedMeals() untouched', async ({ page }) => {
    await loadLocalApp(page);
    const result = await page.evaluate(() => {
      const meals = [{ id: 'cm_1', name: 'A', cookedDate: '2026-08-01', initialPortions: 2, portionsRemaining: 2, futureField: { anything: true } }];
      normalizeCookedMeals(meals);
      return meals[0];
    });
    expect(result.futureField).toEqual({ anything: true });
    expect(result.initialPortions).toBe(2);
  });

  test('benign: cookedDate is never touched/reinterpreted by normalizeCookedMeal — it only manages portion counts', async ({ page }) => {
    await loadLocalApp(page);
    const result = await page.evaluate(() => {
      const meals = [{ id: 'cm_1', name: 'A', cookedDate: '2026-08-20', initialPortions: 1, portionsRemaining: 1 }];
      normalizeCookedMeals(meals);
      return meals[0].cookedDate;
    });
    expect(result, 'contract §2 broken: the source must never reinterpret cookedDate\'s meaning').toBe('2026-08-20');
  });
});
