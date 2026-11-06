// Audit-only gate configuration: run the repository's complete local project while
// preventing CDN/telemetry/production connections. Mocked requests can still be fulfilled.
const path = require('path');
const root = path.resolve(__dirname, '../..');
const base = require(path.join(root, 'playwright.config.js'));
module.exports = {
  ...base,
  testDir: path.join(root, 'tests'),
  outputDir: path.join(root, 'test-results/task079-full'),
  webServer: { ...base.webServer, cwd: root },
  reporter: [['json', { outputFile: path.join(__dirname, 'full-regression.json') }]],
  projects: base.projects.map(project => ({
    ...project,
    use: { ...project.use, proxy: { server: 'http://127.0.0.1:9', bypass: '127.0.0.1,localhost' } }
  }))
};
