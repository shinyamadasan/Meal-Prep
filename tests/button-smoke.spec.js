const { test, expect } = require('@playwright/test');

const APP_URL = 'https://shinyamadasan.github.io/Meal-Prep/';

/**
 * Button smoke test.
 *
 * Loads the live app, finds every visible <button>, clicks each one, and records
 * anything that breaks: a console error, an uncaught page error, or a click that
 * fails outright. Failures never stop the run — at the end it prints a summary of
 * every broken button.
 *
 * Notes / limitations:
 *  - Native dialogs (confirm/alert) are auto-DISMISSED (cancel), so destructive
 *    actions like "Clear" don't actually run and nothing blocks.
 *  - Buttons are snapshotted at load. Buttons that only exist after a tab
 *    re-renders its content may be skipped (their handle detaches). This still
 *    covers all the static chrome: nav tabs, headers, modals, add bars, etc.
 *  - After each click we press Escape to close modals so the next click isn't
 *    blocked by a leftover overlay.
 */
test('button smoke: every visible button is clickable without errors', async ({ page }) => {
  test.setTimeout(240000);

  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    pageErrors.push(err.message);
  });
  // Cancel native dialogs so confirm()/alert() neither block nor mutate data.
  page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));

  // Pre-set the "help seen" flag so the first-run Help modal (which would cover
  // the whole page and block every click) never opens.
  await page.addInitScript(() => {
    try {
      localStorage.setItem('mealPrepHelpSeen', '1');
    } catch (e) {}
  });

  // Modals show/hide by toggling `.hidden`. Force-close any open one via JS so a
  // modal left open by a click can't block the next button.
  const closeAllModals = () =>
    page
      .evaluate(() => {
        document.querySelectorAll('.modal:not(.hidden)').forEach((m) => m.classList.add('hidden'));
        document.body.style.overflow = '';
      })
      .catch(() => {});

  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load').catch(() => {});
  await page.waitForTimeout(2500); // let the SPA initialize
  await closeAllModals();

  await expect(page).toHaveURL(/Meal-Prep/);

  const totalInDom = await page.locator('button').count();
  console.log(`\nDiscovered ${totalInDom} buttons in the DOM.\n`);

  const broken = [];
  let clicked = 0;

  // Walk the whole UI: repeatedly grab the first VISIBLE button we haven't
  // clicked yet (stamped via data-smoked), click it, and move on. Clicking a tab
  // reveals its buttons, which then get picked up in later iterations — so this
  // reaches dynamically-rendered content, not just what's visible at load.
  // Bounded by MAX_CLICKS: re-rendered row controls (every card's "×", "+") keep
  // producing fresh un-stamped buttons, so the cap, not exhaustion, ends the walk.
  const unsmoked = page.locator('button:visible:not([data-smoked="1"])');
  const MAX_CLICKS = 200;

  for (let n = 0; n < MAX_CLICKS; n++) {
    if ((await unsmoked.count()) === 0) break; // nothing visible left to click
    const handle = await unsmoked.first().elementHandle().catch(() => null);
    if (!handle) break;

    // Stamp it first so we never click the same button twice.
    await handle.evaluate((el) => el.setAttribute('data-smoked', '1')).catch(() => {});

    // Readable label for the report.
    let label = '(no label)';
    try {
      const text = ((await handle.textContent()) || '').replace(/\s+/g, ' ').trim();
      label = (
        text ||
        (await handle.getAttribute('title')) ||
        (await handle.getAttribute('aria-label')) ||
        (await handle.getAttribute('id')) ||
        '(no label)'
      ).slice(0, 60);
    } catch {}

    const ceBefore = consoleErrors.length;
    const peBefore = pageErrors.length;
    const entryErrors = [];

    try {
      await handle.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
      await handle.click({ timeout: 3000, noWaitAfter: true });
      clicked++;
    } catch (e) {
      entryErrors.push('click failed: ' + String(e.message).split('\n')[0]);
    }

    // Give click handlers a moment to throw / log.
    await page.waitForTimeout(120);

    consoleErrors.slice(ceBefore).forEach((m) => entryErrors.push('console: ' + m));
    pageErrors.slice(peBefore).forEach((m) => entryErrors.push('pageerror: ' + m));

    if (entryErrors.length) {
      broken.push({ label, errors: entryErrors });
      console.log(`  ✗ "${label}"\n      ${entryErrors.join('\n      ')}`);
    }

    // Close any modal the click opened so the next button isn't blocked.
    await closeAllModals();
    await page.waitForTimeout(40);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n──────────────── BUTTON SMOKE SUMMARY ────────────────');
  console.log(`Buttons in DOM      : ${totalInDom}`);
  console.log(`Clicked             : ${clicked}`);
  console.log(`Broken              : ${broken.length}`);

  if (broken.length) {
    console.log('\nBroken buttons:');
    broken.forEach((b) => {
      console.log(`\n  • [${b.index}] "${b.label}"`);
      b.errors.forEach((e) => console.log(`      - ${e}`));
    });
  } else {
    console.log('\nAll clicked buttons passed. 🎉');
  }
  console.log('──────────────────────────────────────────────────────\n');

  // Make the test status reflect health (the summary above prints either way).
  expect(
    broken,
    `${broken.length} button(s) produced errors — see the summary above.`
  ).toHaveLength(0);
});
