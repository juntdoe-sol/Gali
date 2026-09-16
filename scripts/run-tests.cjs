// Runs the Anchor tests with ts-mocha. Newer Node versions (22.18+) strip TypeScript
// natively and load .ts files as ES modules before ts-node sees them, which breaks the
// JSON IDL import. Turn that off where the flag exists, then hand over to ts-mocha.
const { spawnSync } = require('child_process');
const [major, minor] = process.versions.node.split('.').map(Number);
const hasFlag = major > 22 || (major === 22 && minor >= 6);
const env = { ...process.env };
if (hasFlag && !/strip-types/.test(env.NODE_OPTIONS ?? '')) {
  env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ''} --no-experimental-strip-types`.trim();
}
const r = spawnSync('npx', ['ts-mocha', '-p', './tsconfig.json', '-t', '1000000', 'tests/**/*.ts'], { stdio: 'inherit', env, shell: process.platform === 'win32' });
process.exit(r.status ?? 1);
