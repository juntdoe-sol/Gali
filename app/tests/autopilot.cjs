// Run: node tests/autopilot.cjs
// The autopilot server (supabase/functions/autopilot/core.ts) against a fake RPC: it only runs open,
// fixed-spot automations that can pay, never plays a round twice, settles the last round first,
// stays out of the lock window, and its deploy matches the app's own deploy instruction.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const out = path.join(os.tmpdir(), 'gali-autopilot.cjs');
const core = path.join(__dirname, '../../supabase/functions/autopilot/core.ts');
const plugin = `{name:'deps',setup(b){b.onResolve({filter:/deps\\.ts$/},()=>({path:'deps',namespace:'deps'}));b.onLoad({filter:/.*/,namespace:'deps'},()=>({contents:"export { ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js'; export { Buffer } from 'node:buffer';",resolveDir:${JSON.stringify(path.join(__dirname, '..'))}}))}}`;
fs.writeFileSync(out + '.build.cjs', `require(${JSON.stringify(require.resolve('esbuild', { paths: [path.join(__dirname, '..')] }))}).build({entryPoints:[${JSON.stringify(core)}],bundle:true,platform:'node',format:'cjs',outfile:${JSON.stringify(out)},nodePaths:[${JSON.stringify(path.join(__dirname, '../node_modules'))}],logLevel:'error',plugins:[${plugin}]})`);
execFileSync(process.execPath, [out + '.build.cjs'], { stdio: 'inherit' });
const C = require(out);
const { Keypair, PublicKey, Transaction } = require(require.resolve('@solana/web3.js', { paths: [path.join(__dirname, '..')] }));

const DISC = 8;
const w64 = (b, o, v) => b.writeBigUInt64LE(BigInt(v), DISC + o);
function boardData(roundId, start, end) {
  const b = Buffer.alloc(C.SIZE.board);
  w64(b, 0, roundId); w64(b, 8, start); w64(b, 16, end);
  return b;
}
function autoData({ authority, amount = 400_000n, balance = 100_000_000n, executor = C.EXECUTOR_ADDRESS, fee = 10_000n, strategy = 1n, mask = 0x1ffffffn }) {
  const b = Buffer.alloc(C.SIZE.automation);
  w64(b, 0, amount); authority.toBuffer().copy(b, DISC + 8); w64(b, 40, balance); executor.toBuffer().copy(b, DISC + 48);
  w64(b, 80, fee); w64(b, 88, strategy); w64(b, 96, mask);
  return b;
}
function minerData({ authority, roundId, checkpointId, deployedOn = -1 }) {
  const b = Buffer.alloc(C.SIZE.miner);
  authority.toBuffer().copy(b, DISC); w64(b, 40, checkpointId); w64(b, 656, roundId);
  if (deployedOn >= 0) w64(b, 56 + deployedOn * 8, 1000);
  return b;
}

function fakeConn(state) {
  return {
    sent: [],
    async getSlot() { return state.slot; },
    async getAccountInfo(k) { return k.equals(new PublicKey('BrcSxdp1nXFzou1YyDnQJcPNBNHgoypZmTsyKBSLLXzi')) ? { data: state.board } : null; },
    async getProgramAccounts(_p, cfg) {
      assert.equal(cfg.filters[1].memcmp.offset, 56, 'executor filter at the right offset');
      return state.autos.filter((a) => a.data.subarray(56, 88).equals(C.EXECUTOR_ADDRESS.toBuffer())).map((a) => ({ pubkey: a.key, account: { data: a.data } }));
    },
    async getMultipleAccountsInfo(keys) { return keys.map((k) => state.miners.get(k.toBase58()) ?? null); },
    async getLatestBlockhash() { return { blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1 }; },
    async sendRawTransaction(raw) { this.sent.push(Transaction.from(raw)); return 'sig' + this.sent.length; },
  };
}
const minerPda = (a) => PublicKey.findProgramAddressSync([Buffer.from('miner'), a.toBuffer()], C.ORE_PROGRAM_ID)[0];

(async () => {
  const server = Keypair.generate();
  const players = Array.from({ length: 7 }, () => Keypair.generate().publicKey);
  const [ok, deployed, needsCk, closedExec, discretionary, poor, fresh] = players;
  const other = Keypair.generate().publicKey;
  const state = {
    slot: 1000,
    board: boardData(77, 900, 1100), // mining, 100 slots left
    autos: [
      { key: other, data: autoData({ authority: ok }) },
      { key: other, data: autoData({ authority: deployed }) },
      { key: other, data: autoData({ authority: needsCk, strategy: 0n, mask: 0b111n }) },
      { key: other, data: autoData({ authority: closedExec, executor: Keypair.generate().publicKey }) },
      { key: other, data: autoData({ authority: discretionary, strategy: 3n }) },
      { key: other, data: autoData({ authority: poor, balance: 1000n }) },
      { key: other, data: autoData({ authority: fresh, amount: 3_000_000n }) }, // never deployed itself: no Miner account
    ],
    miners: new Map([
      [minerPda(deployed).toBase58(), { data: minerData({ authority: deployed, roundId: 77, checkpointId: 76, deployedOn: 4 }) }],
      [minerPda(needsCk).toBase58(), { data: minerData({ authority: needsCk, roundId: 75, checkpointId: 74 }) }],
      [minerPda(ok).toBase58(), { data: minerData({ authority: ok, roundId: 76, checkpointId: 76 }) }],
    ]),
  };
  // the round 'ok' played last (76): drawn, square 4 wins (entropy word 0 = 4), no motherlode
  const roundData = Buffer.alloc(8 + 944);
  w64(roundData, 0, 76);
  roundData.writeBigUInt64LE(4n, 8 + 608);
  const roundKey = PublicKey.findProgramAddressSync([Buffer.from('round'), Buffer.from(new BigUint64Array([76n]).buffer)], C.ORE_PROGRAM_ID)[0];
  state.miners.set(roundKey.toBase58(), { data: roundData, owner: C.ORE_PROGRAM_ID });
  const okMiner = minerData({ authority: ok, roundId: 76, checkpointId: 76 });
  for (const sq of [4, 9]) okMiner.writeBigUInt64LE(5000n, 8 + 56 + sq * 8);
  state.miners.set(minerPda(ok).toBase58(), { data: okMiner });
  const scores = [];
  const conn = fakeConn(state);
  const done = new Set();
  const r = await C.pass(conn, server, done, async (wallet, roundId, s) => { scores.push({ wallet, roundId, ...s }); });
  assert.deepEqual(scores, [{ wallet: ok.toBase58(), roundId: 76n, covered: 2, won: true, motherlode: false, points: 500, xp: 62 }], 'the finished round is scored before the next deploy');
  assert.equal(r.phase, 'mining');
  assert.equal(r.sent, 2, 'two automations played: the ready one and the one that needed settling');
  assert.equal(r.skipped, 2, 'the one already played this round and the one with no Miner account were skipped');
  assert.ok(!conn.sent.some((tx) => tx.instructions.at(-1).keys[1].pubkey.equals(fresh)), 'no send for a player ORE has no Miner for');
  const byAuth = new Map(conn.sent.map((tx) => [tx.instructions.at(-1).keys[1].pubkey.toBase58(), tx]));
  assert.ok(byAuth.has(ok.toBase58()) && byAuth.has(needsCk.toBase58()));
  assert.ok(!byAuth.has(discretionary.toBase58()), 'discretionary automations are never run');
  assert.ok(!byAuth.has(poor.toBase58()), 'automations that cannot pay a round are left alone');
  const ck = byAuth.get(needsCk.toBase58());
  assert.equal(ck.instructions.length, 4, 'budget, budget, checkpoint, deploy');
  assert.equal(ck.instructions[2].data[0], 2, 'checkpoint first');
  assert.equal(ck.instructions[2].keys[5].pubkey.toBase58(), PublicKey.findProgramAddressSync([Buffer.from('round'), Buffer.from(new BigUint64Array([75n]).buffer)], C.ORE_PROGRAM_ID)[0].toBase58(), 'checkpoints the round the miner played');
  for (const tx of conn.sent) {
    assert.ok(tx.feePayer.equals(server.publicKey));
    assert.ok(tx.verifySignatures(), 'signed by the server key');
    const d = tx.instructions.at(-1);
    assert.equal(d.data[0], 6, 'deploy');
    assert.equal(d.keys.length, 12);
  }

  // the deploy matches the app's own deployIx account by account
  const appOut = path.join(os.tmpdir(), 'gali-app-ix.cjs');
  fs.writeFileSync(appOut + '.build.cjs', `require(${JSON.stringify(require.resolve('esbuild', { paths: [path.join(__dirname, '..')] }))}).build({entryPoints:[${JSON.stringify(path.join(__dirname, '../src/chain/ore/ix.ts'))}],bundle:true,platform:'node',format:'cjs',outfile:${JSON.stringify(appOut)},nodePaths:[${JSON.stringify(path.join(__dirname, '../node_modules'))}],logLevel:'error',external:['react-native'],plugins:[{name:'poly',setup(b){b.onResolve({filter:/polyfill-web$/},()=>({path:'p',namespace:'p'}));b.onLoad({filter:/.*/,namespace:'p'},()=>({contents:''}))}}]})`);
  execFileSync(process.execPath, [appOut + '.build.cjs'], { stdio: 'inherit' });
  const app = require(appOut);
  const mine = byAuth.get(ok.toBase58()).instructions.at(-1);
  const ref = app.deployIx({ signer: server.publicKey, authority: ok, roundId: 77n, amount: 0n, squares: 0x1ffffff });
  assert.deepEqual(mine.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]), ref.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable]), 'same accounts as the app');
  assert.equal(Buffer.from(mine.data).toString('hex'), Buffer.from(ref.data).toString('hex'), 'same data as the app');

  // a second pass in the same run sends nothing new
  const before = conn.sent.length;
  await C.pass(conn, server, done);
  assert.equal(conn.sent.length, before, 'never plays the same round twice');

  // the lock window and the break between rounds: hands off
  state.slot = 1090;
  assert.equal((await C.pass(conn, server, new Set())).phase, 'locked');
  state.slot = 1200;
  assert.equal((await C.pass(conn, server, new Set())).phase, 'intermission');
  assert.equal(conn.sent.length, before);
  // a round waiting for its first deploy: we may start it
  state.board = boardData(78, 0, 18446744073709551615n);
  const w = await C.pass(conn, server, new Set());
  assert.equal(w.phase, 'waiting');
  assert.ok(w.sent >= 1, 'starts a waiting round');

  // the run loop stops inside its budget; a busy moment is rechecked in 4 s, a played round sleeps to its end
  let t = 0;
  const passes = await C.run(conn, server, 10_000, 4000, () => t, async (ms) => { t += ms; });
  assert.equal(passes.length, 3, 'a waiting round is rechecked every 4 seconds');
  assert.equal(C.nextGap({ phase: 'mining', candidates: 2, sent: 2, skipped: 0, failed: 0, slotsLeft: 100 }, 4000), 42_000, 'played: sleep until the round ends');
  assert.equal(C.nextGap({ phase: 'mining', candidates: 2, sent: 1, skipped: 0, failed: 1, slotsLeft: 100 }, 4000), 4000, 'a failed send is retried soon');
  assert.equal(C.nextGap({ phase: 'locked', candidates: 0, sent: 0, skipped: 0, failed: 0, slotsLeft: 5 }, 4000), 4000);

  // the key loads from solana-keygen JSON
  const k = Keypair.generate();
  assert.ok(C.loadKey(JSON.stringify(Array.from(k.secretKey))).publicKey.equals(k.publicKey));
  console.log('autopilot server tests passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
