// Run: npm test (from app/). Runs every node test suite in its own process; exits non-zero if any fails.
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
const suites = [
  'tests/cave.cjs',
  'tests/juice.cjs',
  'tests/live-clock-ui.cjs',
  'tests/live-poll-budget.cjs',
  'tests/lobby.cjs',
  'tests/lobby-net.cjs',
  'tests/brawl.cjs',
  'tests/pixel-guest.cjs',
  'src/chain/safety.test.cjs',
  'rpc-backend/client.test.cjs',
  'rpc-backend/games.test.mjs',
  'rpc-backend/rpc.test.mjs',
];

const failed = [];
for (const suite of suites) {
  console.log(`\n== ${suite}`);
  const r = spawnSync(process.execPath, [suite], { cwd: root, stdio: 'inherit', timeout: 120_000 });
  if (r.status !== 0) failed.push(suite);
}

console.log(`\n${suites.length - failed.length}/${suites.length} suites passed`);
if (failed.length) {
  console.error(`failed: ${failed.join(', ')}`);
  process.exit(1);
}
