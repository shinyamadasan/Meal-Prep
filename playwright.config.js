// @ts-check
const { defineConfig } = require('@playwright/test');

/**
 * Two projects, because this repo's specs answer two different questions and mixing
 * them made one number meaningless:
 *
 *   local — loads index.html from THIS checkout via file://. Deterministic, offline,
 *           and the only suite that can validate a branch before it is merged.
 *   prod  — fetches https://shinyamadasan.github.io/Meal-Prep/. Validates whatever is
 *           DEPLOYED, so it cannot say anything about unmerged code, and it fails when
 *           the network or GitHub Pages hiccups rather than when the app is wrong.
 *
 * Everything else is left at Playwright's defaults on purpose: this change is about
 * which specs run together, not about timeouts, retries, workers or reporters. Adding
 * a config file must not quietly re-tune the suite.
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
  'production-smoke-inventory-expiry.spec.js',
  'production-smoke-cook-tombstones.spec.js',
  'production-smoke-kitchen-truth.spec.js',
  'production-smoke-low-effort.spec.js',
  'production-smoke-ready-food.spec.js',
  'production-smoke-what-should-we-eat.spec.js',
  'smoke.spec.js'
];

module.exports = defineConfig({
  testDir: './tests',
  projects: [
    {
      name: 'local',
      testIgnore: PROD_SPECS
    },
    {
      name: 'prod',
      testMatch: PROD_SPECS
    }
  ]
});

module.exports.PROD_SPECS = PROD_SPECS;
