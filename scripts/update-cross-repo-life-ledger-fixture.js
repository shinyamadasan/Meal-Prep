'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const playwrightCli = path.resolve(repoRoot, 'node_modules', 'playwright', 'cli.js');
const result = spawnSync(
  process.execPath,
  [playwrightCli, 'test', 'tests/cross-repo-life-ledger-fixture.spec.js', '--project=local'],
  {
    cwd: repoRoot,
    env: Object.assign({}, process.env, {
      MEAL_CROSS_REPO_LIFE_LEDGER_FIXTURE_UPDATE: '1'
    }),
    stdio: 'inherit'
  }
);

if (result.error) {
  console.error('Fixture update command failed to start:', result.error.message);
  process.exitCode = 1;
} else {
  process.exitCode = result.status == null ? 1 : result.status;
}
