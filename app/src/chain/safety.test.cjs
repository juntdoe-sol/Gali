// Offline regression harness. Run: node src/chain/safety.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const web3 = require('@solana/web3.js');
const A = web3.Keypair.generate(), B = web3.Keypair.generate();
const tests = [];
const test = (name, run) => tests.push({ name, run });
function load(file, mocks = {}, globals = {}) {
  const filename = path.resolve(__dirname, file);
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { exports, require: id => id in mocks ? mocks[id] : require(id), Buffer, console, setTimeout, clearTimeout, TextEncoder, ...globals }, { filename });
  return exports;
}
function client(options = {}) {
  const data = options.data ?? new Map([['gali-owner', JSON.stringify({ owner: A.publicKey.toBase58() })], ['gali-mwa-auth', 'saved']]);
  let authorized = false, authCalls = 0, signs = 0, sends = 0;
  const rpc = {
    getLatestBlockhash: async () => ({ blockhash: web3.PublicKey.default.toBase58(), lastValidBlockHeight: 10 }),
    getSignatureStatuses: async () => ({ value: [{ confirmationStatus: 'confirmed', err: null }] }),
    getBlockHeight: async () => 11,
    sendRawTransaction: async () => { sends++; return 'signature'; },
    ...options.rpc,
  };
  const wallet = {
    authorize: async () => { authCalls++; if (options.authError && authCalls === 1) throw options.authError; authorized = true; return { auth_token: 'fresh', accounts: [{ address: (options.owner ?? A.publicKey).toBuffer().toString('base64') }] }; },
    signAndSendTransactions: async () => { signs++; return ['signature']; },
    signTransactions: async ({ transactions }) => { signs++; for (const tx of transactions) tx.sign(A); return transactions; },
  };
  const c = load('client.ts', {
    './polyfill-web': {},
    '@coral-xyz/anchor': { AnchorProvider: class {}, Program: class { account = {}; }, utils: { bytes: { bs58: { encode: b => Buffer.from(b).toString('hex') } } } },
    '@solana-mobile/mobile-wallet-adapter-protocol-web3js': { transact: fn => fn(wallet) },
    '@solana/web3.js': { ...web3, Connection: class { constructor() { return rpc; } } },
    '@noble/curves/ed25519.js': { ed25519: {} },
    '@react-native-async-storage/async-storage': { getItem: async k => data.get(k) ?? null, setItem: async (k,v) => data.set(k,v), removeItem: async k => data.delete(k) },
    'react-native': { Platform: { OS: 'android' } },
    './webWallet': {}, './idl.json': { accounts: [{ name: 'Player', discriminator: [] }] }, './deployment.json': { skrDecimals: 6 },
    './light': { CLUSTER: 'mainnet-beta', PROGRAM_ID_STR: web3.PublicKey.default.toBase58(), SKR_MINT_STR: A.publicKey.toBase58(), MAX_SESSION_FUND_SOL: .1 },
  }, options.globals);
  return { c, data, rpc, authorized: () => authorized, authCalls: () => authCalls, signs: () => signs, sends: () => sends };
}
const transfer = owner => [web3.SystemProgram.transfer({ fromPubkey: owner, toPubkey: B.publicKey, lamports: 1 })];
test('cold restored displayed owner A cannot authorize and spend B', async () => {
  const h = client({ owner: B.publicKey });
  await assert.rejects(h.c.sendWithWallet(async owner => transfer(owner), A.publicKey), /Wallet changed/);
  assert.equal(h.signs(), 0);
});
test('wallet cancellation never opens a second authorization prompt', async () => {
  const h = client({ authError: Object.assign(new Error('User cancelled'), { code: -1 }) });
  await assert.rejects(h.c.connectWallet(), /cancelled/);
  assert.equal(h.authCalls(), 1);
});
test('cached wallet rebuilds against fresh round after authorization', async () => {
  const h = client();
  await h.c.connectWallet();
  await h.c.sendWithWallet(async owner => { assert.equal(h.authCalls(), 2, 'built before authorization'); return transfer(owner); }, A.publicKey);
});
test('processed then expired is unknown, signature survives restart, repeat is blocked', async () => {
  const rpc = { getSignatureStatuses: async () => ({ value: [{ confirmationStatus: 'processed', err: null }] }) };
  const h = client({ rpc, globals: { setTimeout: (fn, ms) => ms === 1000 ? setTimeout(fn, 0) : setTimeout(fn, ms) } });
  await assert.rejects(h.c.sendWithWallet(async owner => transfer(owner), A.publicKey), /unknown/i);
  assert.equal(h.signs(), 1);
  const saved = [...h.data.entries()].find(([k]) => k.includes('pending'));
  assert.ok(saved && JSON.parse(saved[1]).signature, 'signature must be durable');
  const restarted = client({ data: h.data, rpc });
  await assert.rejects(restarted.c.sendWithWallet(async owner => transfer(owner), A.publicKey), /unknown|pending/i);
  assert.equal(restarted.signs(), 0);
});
test('token RPC outage is unavailable, not zero', async () => {
  const h = client({ rpc: { getTokenAccountBalance: async () => { throw new Error('RPC unavailable'); } } });
  await assert.rejects(h.c.fetchSkrBalance(A.publicKey), /unavailable/);
  await assert.rejects(h.c.fetchOreBalance(A.publicKey, B.publicKey.toBase58()), /unavailable/);
});
test('live wallet fails visibly when rewards RPC fails', async () => {
  const b = load('board.ts', {
    './polyfill-web': {}, './client': { connection: {}, fetchSolBalance: async () => 2, fetchOreBalance: async () => 3 },
    './light': { REFINING_FEE_BPS: 1000 }, './ore/consts': { ORE_MINT: A.publicKey },
    './ore/read': { ORE_REFINING_BPS: 1000n, fetchOreTreasury: async () => ({ motherlode: 0n }), fetchClock: async () => { throw new Error('rewards RPC unavailable'); }, fetchOreMiner: async () => null },
    './ore/tx': {}, './ore/accounts': {},
  });
  await assert.rejects(b.fetchLiveWallet(A.publicKey), /unavailable/);
});
test('mainnet never creates or funds insecure sessions; existing key remains recoverable', async () => {
  const h = client();
  await assert.rejects(h.c.loadSession(A.publicKey), /disabled.*mainnet/i);
  await assert.rejects(h.c.startSession(A.publicKey, B, false), /disabled.*mainnet/i);
  h.data.set(`gali-session-${A.publicKey.toBase58()}`, JSON.stringify(Array.from(B.secretKey)));
  assert.equal((await h.c.loadSession(A.publicKey)).publicKey.toBase58(), B.publicKey.toBase58());
});
function store(board = {}) {
  const constants = load('../game/constants.ts');
  const pot = load('../game/pot.ts', { './constants': constants });
  const sounds = [];
  const c = client().c;
  const s = load('../game/store.ts', {
    '../chain/lazy': { loadChain: async () => c, loadBoard: async () => board, loadOreTx: async () => ({}) },
    '../chain/light': { oreLive: true, chainReady: false, onChainMode: true, NOTHING_CLAIMABLE: { sol: 0, unrefined: 0, refined: 0, fee: 0 }, short: x => x, isRateLimited: () => false },
    './constants': constants, './pot': pot,
    './sfx': { play: x => sounds.push(x), setMuted() {}, haptic: { win() {}, thud() {}, tap() {}, heavy() {} } },
    './storage': { saveJson() {}, loadJson: async (_, fallback) => fallback },
  }, { setTimeout: () => 0 });
  return { ...s, sounds };
}
test('wallet refresh outage preserves prior values and flags stale data', async () => {
  const h = store({ fetchLiveWallet: async () => { throw new Error('offline'); } });
  const g = h.useGame;
  g.setState({ wallet: { ...g.getState().wallet, owner: A.publicKey.toBase58(), sol: 12, ore: 3 } });
  await g.getState().refreshWallet();
  assert.match(g.getState().wallet.readError ?? '', /unavailable|stale/i);
  assert.equal(g.getState().wallet.sol, 12);
  assert.equal(g.getState().wallet.ore, 3);
});
test('confirmed claim never promises stale estimated payout', async () => {
  const h = store({ claimBoardSol: async () => 'sig', fetchLiveWallet: async () => { throw new Error('offline'); } });
  const g = h.useGame;
  g.setState({ wallet: { ...g.getState().wallet, owner: A.publicKey.toBase58(), unclaimed: { sol: 123.45 } } });
  await g.getState().claimRewards('sol');
  assert.ok(g.getState().claimedAt > 0, 'confirmed claim stamps the cosmetic event');
  assert.ok(g.getState().toasts.some(t => /confirmed/i.test(t.text)));
  assert.ok(g.getState().toasts.every(t => !t.text.includes('123.4500')));
});
test('failed or unknown claim never fires cosmetic claim juice', async () => {
  const h = store({ claimBoardSol: async () => { throw new Error('Transaction outcome unknown. Do not repeat.'); } });
  const g = h.useGame;
  g.setState({ wallet: { ...g.getState().wallet, owner: A.publicKey.toBase58(), unclaimed: { sol: 1 } } });
  await g.getState().claimRewards('sol');
  assert.equal(g.getState().claimedAt, 0);
  assert.ok(g.getState().toasts.some(t => /unknown/i.test(t.text)));
});
test('live clock uses measured 240-slot span rather than legacy 200', async () => {
  const h = store();
  const st = h.useGame.getState();
  assert.equal(h.roundSpanMs({ ...st, wallet: { ...st.wallet, owner: A.publicKey.toBase58() }, liveClock: { spanMs: 96_000 } }), 96_000);
});
test('disconnected mainnet never simulates a pot, runs or countdown audio', async () => {
  const h = store();
  const g = h.useGame;
  await g.getState().refreshPot();
  assert.equal(g.getState().pot.total, 0);
  const run = { kind: 'lite', blocks: 'all', perRound: .025, total: 1, smartN: 8, manualMask: 0 };
  await g.getState().startRun(run);
  assert.equal(g.getState().run, null);
  g.setState({ roundId: Math.floor(Date.now() / 60000), now: 0 });
  g.getState().tick();
  assert.equal(h.sounds.length, 0);
});
test('claims bind to displayed account even when cached storage differs', async () => {
  let expected;
  const h = store({ claimBoardSol: async owner => { expected = owner; }, fetchLiveWallet: async () => { throw new Error('offline'); } });
  const g = h.useGame;
  g.setState({ wallet: { ...g.getState().wallet, owner: B.publicKey.toBase58(), unclaimed: { sol: 1 } } });
  await g.getState().claimRewards('sol');
  assert.equal(expected?.toBase58(), B.publicKey.toBase58());
});
(async () => {
  let failures = 0;
  for (const { name, run } of tests) {
    try { await run(); console.log('PASS', name); }
    catch (e) { failures++; console.error('FAIL', name, e.message); }
  }
  process.exitCode = failures ? 1 : 0;
})();
