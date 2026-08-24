const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

/**
 * Guards the local-vs-production split itself.
 *
 * The split is only useful if it stays true. A new spec that hits the deployed site
 * but is not listed in PROD_SPECS would land in the local suite, where it would make
 * the pre-merge gate depend on the network and on whatever is already deployed — the
 * exact confusion this separation exists to end. A spec listed as prod that no longer
 * touches the network is the mirror mistake: it would be excluded from the branch gate
 * for no reason.
 *
 * This runs in the LOCAL project and reads files off disk, so it costs nothing and
 * cannot itself be flaky.
 */

const DEPLOYED_URL = 'shinyamadasan.github.io';
const { PROD_SPECS } = require('../playwright.config.js');

// This guard spec necessarily contains the deployed URL in its own constant, so it
// would match itself. Exclude it by name rather than by weakening the check.
const SELF = path.basename(__filename);

function specFiles() {
  const dir = path.resolve(__dirname);
  return fs.readdirSync(dir).filter((f) => f.endsWith('.spec.js') && f !== SELF);
}

const hitsDeployedSite = (file) =>
  fs.readFileSync(path.join(__dirname, file), 'utf8').includes(DEPLOYED_URL);

test('every spec that hits the deployed site is classified as prod', () => {
  const misfiled = specFiles().filter((f) => hitsDeployedSite(f) && !PROD_SPECS.includes(f));
  expect(misfiled,
    'These specs fetch the deployed site but are not in PROD_SPECS, so they would run in ' +
    'the local branch gate and make it network-dependent. Add them to playwright.config.js.'
  ).toEqual([]);
});

test('every spec classified as prod actually hits the deployed site', () => {
  const stale = PROD_SPECS.filter((f) => !hitsDeployedSite(f));
  expect(stale,
    'These specs are listed in PROD_SPECS but never reference the deployed site, so they ' +
    'are being excluded from the branch gate for no reason. Remove them from PROD_SPECS.'
  ).toEqual([]);
});

test('every spec named in PROD_SPECS exists', () => {
  const missing = PROD_SPECS.filter((f) => !fs.existsSync(path.join(__dirname, f)));
  expect(missing, 'PROD_SPECS names a file that is not in tests/.').toEqual([]);
});

test('the local suite is not empty and does not contain the deployed URL', () => {
  const local = specFiles().filter((f) => !PROD_SPECS.includes(f));
  expect(local.length).toBeGreaterThan(10);
  expect(local.filter(hitsDeployedSite)).toEqual([]);
});

/**
 * The automation invokes tools/*.ps1 by path. A wrong or renamed path only shows up at
 * 3am as a CommandNotFoundException whose message names the string that was passed in,
 * which is why the 2026-08-23 halt was hard to read. Checking the referenced files
 * exist is cheap and catches the whole class.
 */
test('every tools script run-claude.ps1 invokes actually exists', () => {
  const root = path.resolve(__dirname, '..');
  const src = fs.readFileSync(path.join(root, 'run-claude.ps1'), 'utf8');
  // Matches both `& "$projectPath\tools\X.ps1"` and `Join-Path $projectPath 'tools/X.ps1'`.
  const referenced = [...src.matchAll(/tools[\\/]([A-Za-z0-9._-]+\.ps1)/g)].map((m) => m[1]);
  expect(referenced.length).toBeGreaterThan(0);
  const missing = [...new Set(referenced)].filter(
    (f) => !fs.existsSync(path.join(root, 'tools', f)));
  expect(missing, 'run-claude.ps1 references a tools script that does not exist.').toEqual([]);
});

test('the docs-consistency check can never halt the overnight run', () => {
  // D-050 documents this block as non-fatal; it halted anyway until D-065. A hygiene
  // check that can kill the run makes the whole automated loop untrustworthy.
  const src = fs.readFileSync(path.resolve(__dirname, '..', 'run-claude.ps1'), 'utf8');
  const idx = src.indexOf('$docsCheckScript');
  expect(idx, 'Phase 3b no longer resolves the script into $docsCheckScript.').toBeGreaterThan(-1);
  // Bound the window at the next phase rather than by a character count: the git-commit
  // block immediately after DOES legitimately call Halt-Automation, and a loose window
  // would pick it up and make this guard permanently red.
  const end = src.indexOf('git add planning/DIGEST.md', idx);
  expect(end, 'Cannot find the end of Phase 3b.').toBeGreaterThan(idx);
  const block = src.slice(idx, end);
  expect(block).toContain('Test-Path -LiteralPath $docsCheckScript');
  expect(block).not.toContain('Halt-Automation');
});
