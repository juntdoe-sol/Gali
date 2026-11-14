// Run: node tests/fee-topup.cjs
// The fee wallet top-up check (supabase/functions/_shared/feeTopup.ts): a row is recorded only for a confirmed,
// successful system transfer to the autopilot fee wallet, with the right sender, amount and balances.
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const out = path.join(os.tmpdir(), 'gali-fee-topup.cjs');
require(require.resolve('esbuild', { paths: [path.join(__dirname, '..')] })).buildSync({
  entryPoints: [path.join(__dirname, '../../supabase/functions/_shared/feeTopup.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error',
});
const F = require(out);
const SYS = '11111111111111111111111111111111';
const REV = 'HDa2MTDdZXnrjTs6RRUUzEqCcrWMWu1fM673Cg7pzQMw', OTHER = 'PNX9utQBdEs4W7vMNop4wkuzPEsd84dGbMgFeVcoKYa';
const transfer = (source, destination, lamports) => ({ programId: SYS, parsed: { type: 'transfer', info: { source, destination, lamports } } });
const tx = (ixs, { err = null, keys = [REV, F.FEE_WALLET, SYS], pre = [500_000_000, 10_000_000, 1], post = [399_995_000, 110_000_000, 1] } = {}) => ({
  blockTime: 1794700000, meta: { err, preBalances: pre, postBalances: post },
  transaction: { message: { accountKeys: keys.map((pubkey) => ({ pubkey })), instructions: ixs } },
});

const ok = F.feeTransfer(tx([transfer(REV, F.FEE_WALLET, 100_000_000)]));
assert.deepEqual(ok, { from: REV, lamports: 100_000_000, at: new Date(1794700000 * 1000).toISOString(), fromBefore: 500_000_000, feeBefore: 10_000_000, feeAfter: 110_000_000 });
// any sender counts, and the record names it
assert.equal(F.feeTransfer(tx([transfer(OTHER, F.FEE_WALLET, 5)], { keys: [OTHER, F.FEE_WALLET, SYS] })).from, OTHER);
// two transfers from one wallet add up
assert.equal(F.feeTransfer(tx([transfer(REV, F.FEE_WALLET, 3), transfer(REV, F.FEE_WALLET, 4)])).lamports, 7);
// what does not count
assert.match(F.feeTransfer(null), /not found yet/);
assert.match(F.feeTransfer(tx([transfer(REV, F.FEE_WALLET, 9)], { err: { InstructionError: [0, 'x'] } })), /failed on chain/);
assert.match(F.feeTransfer(tx([transfer(REV, OTHER, 9)])), /no SOL to the autopilot fee wallet/, 'a transfer elsewhere');
assert.match(F.feeTransfer(tx([{ programId: 'Tokenkeg', parsed: { type: 'transfer', info: { source: REV, destination: F.FEE_WALLET, lamports: 9 } } }])), /no SOL/, 'not the system program');
assert.match(F.feeTransfer(tx([transfer(REV, F.FEE_WALLET, 0)])), /no SOL/);
assert.match(F.feeTransfer(tx([transfer(REV, F.FEE_WALLET, 1), transfer(OTHER, F.FEE_WALLET, 1)])), /more than one wallet/);
// signatures
assert.ok(F.SIG_RE.test('5'.repeat(88))); assert.ok(!F.SIG_RE.test('0OIl'.repeat(22))); assert.ok(!F.SIG_RE.test('abc'));
console.log('fee top-up tests passed');
