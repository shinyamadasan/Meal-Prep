/**
 * Shared readiness waits for the local (file://) specs.
 *
 * Every spec used to do `await page.waitForTimeout(2500)` after a goto or reload. That
 * is a guess, and on a slower runner it fires MID-initialisation: the test then mutates
 * state that init subsequently overwrites, nothing persists, and a later assertion
 * reports the product as broken when the harness was. That exact failure took three CI
 * runs to diagnose on 2026-08-23/24.
 *
 * The condition below is what "initialised" actually means for this app:
 *   - AppState exists and its recipes array is present (load/seed has run)
 *   - saveData is defined (the script finished evaluating)
 *   - #dashboard has been rendered, which initApp() does last via showTab('dashboard')
 *
 * Deliberately NOT `AppState.recipes.length > 0`: several specs boot a saved document
 * with zero recipes on purpose, and that is a legitimate ready state. Verified against
 * both a first-run boot (seeds 40) and a saved-doc-with-no-recipes boot; both satisfy
 * it in under ~100ms locally, versus the 2500ms that was being burned per navigation.
 *
 * The trailing short settle covers render work queued in the same tick as showTab.
 */
async function waitForAppReady(page, { timeout = 30000 } = {}) {
  await page.waitForFunction(
    () => typeof AppState !== 'undefined' && Array.isArray(AppState.recipes) &&
          typeof saveData === 'function' &&
          document.getElementById('dashboard') &&
          document.getElementById('dashboard').children.length > 0,
    null,
    { timeout }
  );
  await page.waitForTimeout(150);
}

/**
 * Readiness for a test that RELOADS and then asserts that something PERSISTED.
 *
 * Why waitForAppReady() is not enough here, and must not be "simplified" back to it:
 *
 * Its contract is "the app booted and painted", which is a weaker statement than "the
 * saved document has been restored into AppState". `initApp()` ends with
 * showTab('dashboard') -> renderDashboard() unconditionally, on whatever AppState holds
 * at that moment. When `window.firebase` is present the restore happens later, inside
 * the async onAuthStateChanged callback, so the dashboard can render — and the condition
 * go true — against a still-default AppState. Measured on this app: readiness at 346ms,
 * the saved pantry landing at 406ms. The ONLY thing covering that 60ms gap is the fixed
 * `waitForTimeout(150)` above, i.e. elapsed time standing in for a state check.
 *
 * On a fast machine 150ms is plenty and the tests pass. On a loaded CI runner it is not,
 * and the test asserts against a pre-restore AppState. Reproduced under CPU throttling:
 * the pantry read back empty after reload — the exact symptom of the three GitHub Actions
 * failures of 2026-08-25 (kitchen-truth `pantryHas: false`, low-effort-metadata recipe
 * `undefined`, cook-depletion-tombstones `pantryIds: []`), all of which asserted straight
 * after `page.reload()` + `waitForAppReady()`.
 *
 * So: wait for the state the test is actually about. `predicate` runs in the page and
 * should be the NARROWEST truthful description of "the thing I am about to assert is
 * now restored" — not a convenient global. If it never becomes true the wait times out
 * naming that state, which is a far better failure than an assertion diff against an
 * empty AppState.
 *
 * Rule this encodes: never let elapsed time stand in as evidence that restoration
 * finished when a state condition is available.
 *
 *   await page.reload({ waitUntil: 'domcontentloaded' });
 *   await waitForRestored(page, () => AppState.pantry.some((p) => p.name === 'Eggs'));
 */
async function waitForRestored(page, predicate, arg = null, { timeout = 30000 } = {}) {
  await waitForAppReady(page, { timeout });
  await page.waitForFunction(predicate, arg, { timeout });
}

module.exports = { waitForAppReady, waitForRestored };
