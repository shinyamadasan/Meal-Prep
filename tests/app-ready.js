/**
 * Shared readiness wait for the local (file://) specs.
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

module.exports = { waitForAppReady };
