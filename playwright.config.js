// @ts-check
const { defineConfig } = require('@playwright/test');

/**
 * Two projects, because this repo's specs answer two different questions and mixing
 * them made one number meaningless:
 *
 *   local — loads index.html from THIS checkout, served by tests/static-server.js on
 *           127.0.0.1. Deterministic, no internet dependency, and the only suite that
 *           can validate a branch before it is merged. Not file:// — Chromium can drop a
 *           fresh context's whole file:// localStorage across its first reload, which
 *           made every save-then-reload spec a coin flip (TASK-061, D-077).
 *   prod  — fetches https://shinyamadasan.github.io/Meal-Prep/. Validates whatever is
 *           DEPLOYED, so it cannot say anything about unmerged code, and it fails when
 *           the network or GitHub Pages hiccups rather than when the app is wrong.
 *
 * Everything else is left at Playwright's defaults on purpose: no timeouts, retries,
 * workers or reporters are tuned here. The only runtime settings are the local
 * project's origin (baseURL + webServer) and serviceWorkers: 'block', which keeps the
 * http origin exactly as SW-free as file:// was — sw.js must not start caching app.js
 * underneath a test.
 *
 * PROD_SPECS is an explicit list rather than a filename pattern because three of the
 * live-site specs predate the `production-smoke-*` convention (button-smoke,
 * buttons-functional, smoke) and renaming them is not this wave's business.
 * tests/suite-classification.spec.js runs in the LOCAL project and fails if this list
 * and the specs' actual targets ever disagree, so a new spec cannot be silently
 * misfiled.
 */
const PROD_SPECS = [
  'button-smoke.spec.js',
  'buttons-functional.spec.js',
  'production-smoke-attention-notifications.spec.js',
  'production-smoke-cook-method.spec.js',
  'production-smoke-bulk-add-dates.spec.js',
  'production-smoke-bulk-add-partial-retry.spec.js',
  'production-smoke-inventory-expiry.spec.js',
  'production-smoke-inventory-quantity-truth.spec.js',
  'production-smoke-cook-tombstones.spec.js',
  'production-smoke-kitchen-truth.spec.js',
  'production-smoke-low-effort.spec.js',
  'production-smoke-ready-food.spec.js',
  'production-smoke-what-should-we-eat.spec.js',
  'smoke.spec.js'
];

const LOCAL_PORT = 47813;
const LOCAL_ORIGIN = 'http://127.0.0.1:' + LOCAL_PORT;

module.exports = defineConfig({
  testDir: './tests',
  // Never reuse an already-running server: it could be serving a different checkout
  // (e.g. a sibling worktree), and the gate would then validate the wrong code.
  webServer: {
    command: 'node tests/static-server.js',
    url: LOCAL_ORIGIN + '/index.html',
    env: { LOCAL_APP_PORT: String(LOCAL_PORT) },
    reuseExistingServer: false
  },
  projects: [
    {
      name: 'local',
      testIgnore: PROD_SPECS,
      use: { baseURL: LOCAL_ORIGIN, serviceWorkers: 'block' }
    },
    {
      name: 'prod',
      testMatch: PROD_SPECS
    }
  ]
});

module.exports.PROD_SPECS = PROD_SPECS;
