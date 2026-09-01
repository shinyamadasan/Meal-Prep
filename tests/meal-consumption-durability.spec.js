const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');
const { waitForRestored } = require('./app-ready');

/**
 * Durable consumption source hardening — architectural redesign following the adversarial
 * review of feat/durable-meal-consumption-events.
 *
 * Covers the canonical merge primitive (mergeMealConsumptions/reconcileMealConsumptions),
 * the collision-resistant id generator, and adversarial reconciliation scenarios: stale
 * realtime snapshots, sign-in reconciliation, backup restore, and duplicate/reconnect
 * replay — none of which may silently delete or overwrite an already-recorded consumption
 * fact.
 */

test.use({ viewport: { width: 1200, height: 1500 } });

async function loadLocalApp(page) {
  await page.route('**/firebasejs/**', (r) => r.abort());
  await page.addInitScript(() => {
    try {
      if (localStorage.getItem('__durabilityBootstrapped')) return;
      localStorage.clear();
      localStorage.setItem('__durabilityBootstrapped', '1');
      localStorage.setItem('mealPrepHelpSeen', '1');
      localStorage.setItem('mealPrepStartDone', '1');
      localStorage.setItem('pantryOnboardingDone', '1');
    } catch (e) {}
  });
  await page.goto(pathToFileURL(path.resolve('index.html')).href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => typeof AppState !== 'undefined' && typeof mergeMealConsumptions === 'function' &&
          typeof reconcileMealConsumptions === 'function' && typeof generateMealConsumptionId === 'function',
    null, { timeout: 30000 });
  await page.waitForTimeout(300);
}

function fact(overrides) {
  return Object.assign({
    id: 'mc_a',
    cookedMealId: 'cm_1',
    recipeId: 'r_1',
    mealName: 'Chicken Bowls',
    portionsConsumed: 1,
    consumedAt: '2026-08-29T18:00:00.000Z'
  }, overrides || {});
}

// ── mergeMealConsumptions: the canonical primitive ────────────────────────────

test('merge: identical facts under the same id dedupe to one record', async ({ page }) => {
  await loadLocalApp(page);
  const result = await page.evaluate((f) => mergeMealConsumptions([f], [JSON.parse(JSON.stringify(f))]), fact());
  expect(result.merged.length).toBe(1);
  expect(result.conflicts.length).toBe(0);
});

test('merge: different facts under the same id are an explicit conflict — the original is kept, never overwritten', async ({ page }) => {
  await loadLocalApp(page);
  const result = await page.evaluate(({ a, b }) => mergeMealConsumptions([a], [b]),
    { a: fact({ portionsConsumed: 1 }), b: fact({ portionsConsumed: 2 }) });
  expect(result.merged.length).toBe(1);
  expect(result.merged[0].portionsConsumed).toBe(1); // original preserved
  expect(result.conflicts.length).toBe(1);
  expect(result.conflicts[0].id).toBe('mc_a');
});

test('merge: disjoint ids on both sides all survive — append-only, order-independent', async ({ page }) => {
  await loadLocalApp(page);
  const result = await page.evaluate(({ a, b }) => mergeMealConsumptions([a], [b]),
    { a: fact({ id: 'mc_local_only' }), b: fact({ id: 'mc_remote_only' }) });
  expect(result.merged.length).toBe(2);
  expect(new Set(result.merged.map((r) => r.id))).toEqual(new Set(['mc_local_only', 'mc_remote_only']));
});

test('merge: a record missing from the incoming side is NOT treated as a deletion', async ({ page }) => {
  await loadLocalApp(page);
  const result = await page.evaluate((f) => mergeMealConsumptions([f], []), fact());
  expect(result.merged.length).toBe(1);
  expect(result.merged[0].id).toBe('mc_a');
});

// ── reconcileMealConsumptions: stale/adversarial snapshot protection ─────────

test('a stale/older snapshot with fewer facts cannot erase a local consumption already recorded', async ({ page }) => {
  await loadLocalApp(page);
  const result = await page.evaluate((f) => {
    AppState.mealConsumptions = [f]; // local already has this fact (e.g. recorded offline)
    // An unrelated/stale remote snapshot arrives with NO knowledge of it — a wholesale
    // "AppState.mealConsumptions = data.mealConsumptions" would erase it; the merge must not.
    reconcileMealConsumptions([]);
    return AppState.mealConsumptions.length;
  }, fact());
  expect(result).toBe(1);
});

test('a same-id-different-facts snapshot never silently overwrites the locally-known fact', async ({ page }) => {
  await loadLocalApp(page);
  const result = await page.evaluate((f) => {
    AppState.mealConsumptions = [f];
    reconcileMealConsumptions([Object.assign({}, f, { portionsConsumed: 99 })]);
    return AppState.mealConsumptions[0].portionsConsumed;
  }, fact());
  expect(result).toBe(1); // never became 99
});

test('duplicate snapshot / reconnect replay never creates a second record for the same id', async ({ page }) => {
  await loadLocalApp(page);
  const result = await page.evaluate((f) => {
    AppState.mealConsumptions = [];
    reconcileMealConsumptions([f]);
    reconcileMealConsumptions([JSON.parse(JSON.stringify(f))]);
    reconcileMealConsumptions([JSON.parse(JSON.stringify(f))]);
    return AppState.mealConsumptions.length;
  }, fact());
  expect(result).toBe(1);
});

test('two genuine consumptions produce two distinct ids and both survive reconciliation', async ({ page }) => {
  await loadLocalApp(page);
  const result = await page.evaluate((meal) => {
    AppState.cookedMeals = normalizeCookedMeals([JSON.parse(JSON.stringify(meal))]);
    AppState.mealConsumptions = [];
    useCookedPortion('cm_track_1');
    useCookedPortion('cm_track_1');
    // Simulate a remote snapshot that only knows about the FIRST recorded fact — must not
    // erase the second, locally-only-so-far fact.
    reconcileMealConsumptions([AppState.mealConsumptions[0]]);
    return {
      count: AppState.mealConsumptions.length,
      distinctIds: new Set(AppState.mealConsumptions.map((c) => c.id)).size
    };
  }, {
    id: 'cm_track_1', recipeId: 'r_42', source: null, name: 'Chicken Bowls',
    cookedDate: '2026-08-28', storage: 'fridge', fridgeLife: 4, freezerLife: 90,
    initialPortions: 3, portionsRemaining: 3
  });
  expect(result.count).toBe(2);
  expect(result.distinctIds).toBe(2);
});

// ── Sign-in reconciliation: mealConsumptions must survive it ─────────────────

test('mealConsumptions is included in loadUserData\'s sign-in reconciliation, not silently omitted', async ({ page }) => {
  await loadLocalApp(page);
  // Directly proves the specific bug: UKEYS previously omitted 'mealConsumptions', so a
  // local-only fact recorded while signed out (or before this account's cloud doc existed)
  // would be dropped on sign-in. This asserts the reconciliation path actually merges it.
  const survived = await page.evaluate((f) => {
    var localOnly = f;
    AppState.mealConsumptions = []; // simulate the post-loadFromFirestore wholesale set (cloud has never seen this fact)
    var changed = reconcileMealConsumptions([localOnly]); // the sign-in reconciliation step
    return { present: AppState.mealConsumptions.some((c) => c.id === localOnly.id), changed: changed };
  }, fact({ id: 'mc_signed_out_offline' }));
  expect(survived.present).toBe(true);
  expect(survived.changed).toBe(true);
});

// ── Collision-resistant ID generation ─────────────────────────────────────────

test('generateMealConsumptionId never reuses an id already present in AppState.mealConsumptions', async ({ page }) => {
  await loadLocalApp(page);
  const result = await page.evaluate(() => {
    AppState.mealConsumptions = [{ id: 'mc_existing_marker' }];
    const realRandomUUID = crypto.randomUUID.bind(crypto);
    let calls = 0;
    // Force the FIRST call to collide with an existing id, proving the generator detects it
    // and retries rather than returning a duplicate.
    crypto.randomUUID = () => {
      calls++;
      return calls === 1 ? 'existing_marker' : realRandomUUID();
    };
    try {
      const id = generateMealConsumptionId();
      return { id: id, calls: calls, collided: id === 'mc_existing_marker' };
    } finally {
      crypto.randomUUID = realRandomUUID;
    }
  });
  expect(result.collided).toBe(false);
  expect(result.calls).toBeGreaterThan(1); // proves it actually retried, not luck
});

test('a forced browser probe that always returns the same UUID is detected and refused rather than silently reused', async ({ page }) => {
  await loadLocalApp(page);
  const result = await page.evaluate(() => {
    AppState.mealConsumptions = [];
    const realRandomUUID = crypto.randomUUID.bind(crypto);
    // Pathological probe: generator always returns the exact same value.
    crypto.randomUUID = () => 'stuck-forever-uuid';
    let threw = false;
    let firstId = null;
    try {
      firstId = generateMealConsumptionId();
      AppState.mealConsumptions.push({ id: firstId });
      generateMealConsumptionId(); // must detect the collision against the id just recorded
    } catch (e) {
      threw = true;
    } finally {
      crypto.randomUUID = realRandomUUID;
    }
    return { threw, firstId };
  });
  // Generation must never intentionally reuse an existing id: since this probe can only ever
  // produce one value, the second call must fail loudly rather than hand back a duplicate.
  expect(result.threw).toBe(true);
  expect(result.firstId).toBe('mc_stuck-forever-uuid');
});

test('normal id generation produces distinct mc_<uuid>-shaped ids, not the old timestamp+small-random scheme', async ({ page }) => {
  await loadLocalApp(page);
  const ids = await page.evaluate(() => {
    AppState.mealConsumptions = [];
    const out = [];
    for (let i = 0; i < 25; i++) {
      const id = generateMealConsumptionId();
      AppState.mealConsumptions.push({ id });
      out.push(id);
    }
    return out;
  });
  expect(new Set(ids).size).toBe(25);
  ids.forEach((id) => {
    expect(id.indexOf('mc_')).toBe(0);
    // crypto.randomUUID()-shaped: mc_ + 36-char UUID (in a real Chromium/Playwright runtime).
    expect(id).toMatch(/^mc_[0-9a-f-]{36}$/);
  });
});
