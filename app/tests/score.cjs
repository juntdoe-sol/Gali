// Run: node tests/score.cjs
// The server's round scoring (supabase/functions/_shared/score.ts) matches the Gali program's winning-square rule
// and the app's own points and XP rules.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const out = path.join(os.tmpdir(), 'gali-score.cjs');
const esbuild = require.resolve('esbuild', { paths: [path.join(__dirname, '..')] });
const entry = path.join(os.tmpdir(), 'gali-score-entry.ts');
fs.writeFileSync(entry, `export * from ${JSON.stringify(path.join(__dirname, '../../supabase/functions/_shared/score.ts'))};\nexport { pointsFor as appPointsFor } from ${JSON.stringify(path.join(__dirname, '../src/game/constants.ts'))};\n`);
fs.writeFileSync(out + '.build.cjs', `require(${JSON.stringify(esbuild)}).build({entryPoints:[${JSON.stringify(entry)}],bundle:true,platform:'node',format:'cjs',outfile:${JSON.stringify(out)},nodePaths:[${JSON.stringify(path.join(__dirname, '../node_modules'))}],logLevel:'error',external:['react-native']})`);
execFileSync(process.execPath, [out + '.build.cjs'], { stdio: 'inherit' });
const S = require(out);

const entropy = (words) => {
  const b = Buffer.alloc(32);
  words.forEach((w, i) => b.writeBigUInt64LE(BigInt(w), i * 8));
  return new Uint8Array(b);
};
// the same vectors as the Rust unit test in programs/gali/src/ore.rs
assert.equal(S.winningSquare(entropy([7, 0, 0, 0])), 7);
assert.equal(S.winningSquare(entropy([25, 0, 0, 0])), 0);
assert.equal(S.winningSquare(entropy([3, 5, 0, 0])), (3 ^ 5) % 25);
assert.equal(S.winningSquare(new Uint8Array(32)), null, 'undrawn');
assert.equal(S.winningSquare(new Uint8Array(32).fill(0xff)), null, 'refunded');

// points match the app for every spot count, with and without a motherlode
for (let c = 1; c <= 25; c++) for (const ml of [false, true]) assert.equal(S.pointsFor(c, ml), S.appPointsFor(c, ml, 10_000));

const dep = (spots) => Array.from({ length: 25 }, (_, i) => (spots.includes(i) ? 1000n : 0n));
assert.deepEqual(S.scoreRound(dep([7, 8]), entropy([7, 0, 0, 0]), 0n), { covered: 2, won: true, motherlode: false, points: 500, xp: 62 });
assert.deepEqual(S.scoreRound(dep([8]), entropy([7, 0, 0, 0]), 5n), { covered: 1, won: false, motherlode: false, points: 0, xp: 11 });
assert.deepEqual(S.scoreRound(dep([7]), entropy([7, 0, 0, 0]), 5n), { covered: 1, won: true, motherlode: true, points: 11_000, xp: 61 });
assert.equal(S.scoreRound(dep([]), entropy([7, 0, 0, 0]), 0n), null, 'did not play');
assert.equal(S.scoreRound(dep([7]), new Uint8Array(32), 0n), null, 'not drawn yet');
assert.equal(S.scoreRound(dep([0]), new Uint8Array(32).fill(0xff), 0n).won, false, 'a refunded round never wins');
console.log('score: all passed');
