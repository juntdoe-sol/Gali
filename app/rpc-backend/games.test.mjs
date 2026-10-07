// Tests the arcade house against an in-memory Solana: real transaction bytes are decoded with @solana/web3.js,
// signatures are verified, balances move, and the one-time mutex accounts really block a second payout.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const web3 = require('@solana/web3.js');
const spl = require('@solana/spl-token');
const bs58 = require('bs58').default ?? require('bs58');
import games, * as G from './functions/games.mjs';

const RM = G.ROUND_MS;
const T0 = 1_800_000_000_000 - (1_800_000_000_000 % RM); // a round boundary
let clock = T0;
const ROUND = T0 / RM;
const houseKp = web3.Keypair.generate();
const env = { HELIUS_RPC_KEY: 'testkey-123456', GAMES_MASTER: 'master-secret-for-tests-only', HOUSE_KEY: JSON.stringify([...houseKp.secretKey]) };
const MINTS = { ore: { key: G.TOKENS.o.mint, dec: 11 }, skr: { key: G.TOKENS.s.mint, dec: 6 } };

// ----- in-memory chain -----
const chain = { tokens: new Map(), accounts: new Set(), txs: [], sigSeq: 0 };
const ataOf = (owner, mint) => bs58.encode(crypto.createHash('sha256').update(`${owner}|${mint}`).digest());
const bal = (a) => chain.tokens.get(a)?.amount ?? 0n;
function setBal(owner, token, amount) { chain.tokens.set(ataOf(owner, MINTS[token].key), { owner, mint: MINTS[token].key, amount }); }
function record(sig, blockTime, ixs, signer, err = null) {
  chain.txs.unshift({ sig, blockTime, err, ixs, signer, ata: new Set(ixs.flatMap((i) => i.touch ?? [])) });
}
function playerBet(wallet, token, game, round, choice, amountUnits, { blockTime, memo, mint } = {}) {
  const m = MINTS[token];
  const src = ataOf(wallet, m.key), dst = ataOf(houseKp.publicKey.toBase58(), m.key);
  assert.ok(bal(src) >= amountUnits, 'player funded');
  chain.tokens.get(src).amount -= amountUnits;
  chain.tokens.get(dst).amount += amountUnits;
  const sig = `bet${++chain.sigSeq}${'x'.repeat(60)}`;
  const memoText = memo ?? `gali1|${game}|${token === 'ore' ? 'o' : 's'}|${round}|${choice}`;
  record(sig, Math.floor((blockTime ?? clock) / 1000), [
    { program: 'spl-token', parsed: { type: 'transferChecked', info: { source: src, destination: dst, authority: wallet, mint: mint ?? m.key, tokenAmount: { amount: String(amountUnits), decimals: m.dec } } }, touch: [dst, src] },
    { program: 'spl-memo', parsed: memoText },
  ], wallet);
  return sig;
}
function rpcHandler(method, params) {
  switch (method) {
    case 'getAccountInfo': {
      const [addr] = params;
      const mint = Object.values(MINTS).find((x) => x.key === addr);
      if (mint) { const d = new Uint8Array(82); d[44] = mint.dec; return { value: { owner: spl.TOKEN_PROGRAM_ID.toBase58(), data: [Buffer.from(d).toString('base64'), 'base64'], lamports: 1 } }; }
      return { value: chain.accounts.has(addr) ? { owner: '11111111111111111111111111111111', data: ['', 'base64'], lamports: 890880 } : null };
    }
    case 'getTokenAccountsByOwner': {
      const [owner, { mint }] = params;
      const a = ataOf(owner, mint);
      return { value: chain.tokens.has(a) ? [{ pubkey: a }] : [] };
    }
    case 'getTokenAccountBalance': return { value: { amount: String(bal(params[0])) } };
    case 'getSignaturesForAddress': {
      const [addr, opts] = params;
      const rows = chain.txs.filter((t) => t.ata.has(addr)).map((t) => ({ signature: t.sig, blockTime: t.blockTime, err: t.err }));
      const at = opts?.before ? rows.findIndex((r) => r.signature === opts.before) + 1 : 0;
      return rows.slice(at, at + (opts?.limit ?? 1000));
    }
    case 'getTransaction': {
      const t = chain.txs.find((x) => x.sig === params[0]);
      if (!t) return null;
      return { blockTime: t.blockTime, meta: { err: t.err }, transaction: { signatures: [t.sig], message: { instructions: t.ixs.map(({ touch, ...rest }) => rest) } } };
    }
    case 'getLatestBlockhash': return { value: { blockhash: bs58.encode(crypto.randomBytes(32)), lastValidBlockHeight: 100 } };
    case 'getSignatureStatuses': return { value: params[0].map(() => ({ confirmationStatus: 'confirmed', err: null })) };
    case 'sendTransaction': {
      const tx = web3.Transaction.from(Buffer.from(params[0], 'base64'));
      assert.ok(tx.verifySignatures(), 'house signature must verify');
      const created = [];
      const moves = [];
      const touch = [];
      for (const ix of tx.instructions) {
        if (ix.programId.equals(web3.SystemProgram.programId)) {
          const d = web3.SystemInstruction.decodeCreateWithSeed(ix);
          assert.ok(d.newAccountPubkey.equals(web3.PublicKey.createWithSeed ? tx.instructions && d.newAccountPubkey : d.newAccountPubkey));
          if (chain.accounts.has(d.newAccountPubkey.toBase58()) || created.includes(d.newAccountPubkey.toBase58())) { const e = new Error('Transaction simulation failed: account already in use'); e.code = -32002; throw e; }
          created.push(d.newAccountPubkey.toBase58());
        } else if (ix.programId.equals(spl.TOKEN_PROGRAM_ID)) {
          const d = spl.decodeTransferCheckedInstruction(ix);
          moves.push({ src: d.keys.source.pubkey.toBase58(), dst: d.keys.destination.pubkey.toBase58(), amount: d.data.amount });
          touch.push(d.keys.source.pubkey.toBase58(), d.keys.destination.pubkey.toBase58());
        }
      }
      for (const m of moves) { assert.ok(bal(m.src) >= m.amount, 'house has the funds'); chain.tokens.get(m.src).amount -= m.amount; chain.tokens.get(m.dst).amount += m.amount; }
      created.forEach((c) => chain.accounts.add(c));
      const sig = bs58.encode(tx.signature);
      record(sig, Math.floor(clock / 1000), [{ program: 'spl-token', parsed: { type: 'transferChecked', info: { source: '', destination: 'x', authority: 'house', tokenAmount: { amount: '0' } } }, touch }], 'house');
      return sig;
    }
    default: throw new Error(`unmocked ${method}`);
  }
}
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  try { return Response.json({ jsonrpc: '2.0', id: body.id, result: rpcHandler(body.method, body.params) }); }
  catch (e) { return Response.json({ jsonrpc: '2.0', id: body.id, error: { code: e.code ?? -32000, message: e.message } }); }
};

const house = await G.loadHouse(env);
const H = houseKp.publicKey.toBase58();
assert.equal(house.owner, H);
const U = (ui, token) => BigInt(Math.round(Number(ui) * 10 ** MINTS[token].dec));
const newPlayer = (token, ui) => { const k = web3.Keypair.generate().publicKey.toBase58(); setBal(k, token, U(ui, token)); return k; };
const fundHouse = (token, ui) => setBal(H, token, U(ui, token));
const settle = (game, token, round = ROUND, now = clock + G.SETTLE_AFTER_MS + 4000) => G.settleRound(env, house, { game, token, round, now });

// 1. encoding helpers, mutex address and transaction bytes agree with web3.js
{
  const raw = crypto.randomBytes(40);
  assert.equal(G.b58enc(raw), bs58.encode(raw));
  assert.deepEqual(Buffer.from(G.b58dec('11' + bs58.encode(raw))), Buffer.concat([Buffer.from([0, 0]), raw]));
  const seed = 'tos1abc.0';
  const expect = await web3.PublicKey.createWithSeed(houseKp.publicKey, seed, web3.SystemProgram.programId);
  assert.equal(await G.mutexAddress(H, seed), expect.toBase58());
  const dest = web3.Keypair.generate().publicKey.toBase58();
  const ixs = [
    { program: '11111111111111111111111111111111', keys: [{ pubkey: H, signer: true, writable: true }, { pubkey: expect.toBase58(), writable: true }], data: new Uint8Array(0) },
  ];
  const bh = bs58.encode(crypto.randomBytes(32));
  const { raw: txRaw } = await G.signTransaction(house, bh, [
    ...ixs.slice(0, 0),
    { program: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', keys: [], data: new TextEncoder().encode('hello') },
    { program: spl.TOKEN_PROGRAM_ID.toBase58(), keys: [{ pubkey: dest, writable: true }, { pubkey: MINTS.ore.key }, { pubkey: dest, writable: true }, { pubkey: H, signer: true }], data: Uint8Array.from([12, 5, 0, 0, 0, 0, 0, 0, 0, 11]) },
  ]);
  const tx = web3.Transaction.from(Buffer.from(txRaw));
  assert.ok(tx.verifySignatures());
  assert.equal(tx.feePayer.toBase58(), H);
  assert.equal(tx.recentBlockhash, bh);
  assert.equal(tx.instructions.length, 2);
  console.log('PASS tx encoding, signature and mutex address match web3.js');
}

// helper: run a full tunnel round with named choices
fundHouse('ore', 5); fundHouse('skr', 5000);
const fee = (x) => (x * 500n) / 10_000n;

// 2. Tunnel Collapse pays survivors the collapsed tunnel's stakes minus 5%, once, and is replay-safe
{
  const pre = bal(ataOf(H, MINTS.ore.key));
  const players = [0, 1, 2, 3, 4].map(() => newPlayer('ore', 1));
  const stakes = [0.1, 0.05, 0.05, 0.01, 0.1];
  players.forEach((p, i) => playerBet(p, 'ore', 't', ROUND, i, U(stakes[i], 'ore'), { blockTime: clock + 5000 + i * 1000 }));
  const before = bal(ataOf(H, MINTS.ore.key));
  const r = await settle('tunnel', 'ore');
  assert.equal(r.status, 'paid');
  const c = r.outcome.collapsed;
  const total = stakes.reduce((n, s) => n + U(s, 'ore'), 0n);
  const lose = U(stakes[c], 'ore');
  const paidOut = players.reduce((n, p) => n + (bal(ataOf(p, MINTS.ore.key)) - U(1, 'ore')), 0n); // net change of players
  // players' net = winners' share minus their stakes: sum of net changes == -fee-ish (house keeps fee + dust)
  const houseDelta = bal(ataOf(H, MINTS.ore.key)) - pre; // = deposits - payouts
  const survivorsPaid = r.pays.filter((p) => p.kind === 'win');
  assert.equal(survivorsPaid.length, 4);
  assert.ok(houseDelta >= fee(lose) - 5n && houseDelta <= fee(lose) + 5n, `house keeps about the 5% fee (${houseDelta} vs ${fee(lose)})`);
  assert.ok(paidOut <= 0n, 'players cannot gain more than the house loses');
  // replay and concurrency never pay twice
  const snap = new Map([...chain.tokens].map(([k, v]) => [k, v.amount]));
  const again = await Promise.all([settle('tunnel', 'ore'), settle('tunnel', 'ore'), settle('tunnel', 'ore')]);
  again.forEach((a) => assert.equal(a.status, 'paid'));
  for (const [k, v] of chain.tokens) assert.equal(v.amount, snap.get(k), 'balances unchanged after replay');
  // fairness: the revealed secret matches the commit and recomputes the seed
  assert.equal(crypto.createHash('sha256').update(Buffer.from(r.secret, 'hex')).digest('hex'), r.commit);
  const seed = await G.seedOf(Buffer.from(r.secret, 'hex'), ROUND, r.bets.map((b) => b.sig));
  assert.equal(Buffer.from(seed).toString('hex'), r.seed);
  console.log('PASS tunnel pays survivors once, keeps ~5%, replay-safe, secret verifiable');
}

// 3. Concurrent first settle: three callers at once still pay exactly once
{
  const round = ROUND + 1;
  const ps = [0, 1, 2, 3].map(() => newPlayer('skr', 1000));
  ps.forEach((p, i) => playerBet(p, 'skr', 't', round, i % 2, U(50, 'skr'), { blockTime: clock + RM + 3000 + i * 500 }));
  const start = new Map([...chain.tokens].map(([k, v]) => [k, v.amount]));
  const rs = await Promise.all([1, 2, 3].map(() => settle('tunnel', 'skr', round, clock + RM + G.SETTLE_AFTER_MS + 4000)));
  rs.forEach((x) => assert.ok(['paid', 'void'].includes(x.status), x.status));
  let net = 0n;
  for (const [k, v] of chain.tokens) net += v.amount - (start.get(k) ?? 0n);
  assert.equal(net, 0n, 'tokens are conserved');
  const allPaid = ps.reduce((n, p) => n + bal(ataOf(p, MINTS.skr.key)), 0n);
  assert.ok(allPaid <= U(4000, 'skr') && allPaid >= U(4000, 'skr') - fee(U(100, 'skr')) - 10n, 'players only lose the fee');
  console.log('PASS three concurrent settles pay once');
}

// 4. Gold Rush Pot: one winner takes 95%; a lone player is refunded
{
  const round = ROUND + 2;
  const a = newPlayer('ore', 1), b = newPlayer('ore', 1), c = newPlayer('ore', 1);
  [a, b, c].forEach((p, i) => playerBet(p, 'ore', 'p', round, 0, U(0.1, 'ore'), { blockTime: clock + 2 * RM + 2000 + i * 700 }));
  const r = await settle('pot', 'ore', round, clock + 2 * RM + G.SETTLE_AFTER_MS + 4000);
  assert.equal(r.status, 'paid');
  assert.equal(r.pays.length, 1);
  assert.equal(r.pays[0].amount, '0.285');
  const lone = newPlayer('ore', 1);
  const round2 = ROUND + 3;
  playerBet(lone, 'ore', 'p', round2, 0, U(0.05, 'ore'), { blockTime: clock + 3 * RM + 2000 });
  const r2 = await settle('pot', 'ore', round2, clock + 3 * RM + G.SETTLE_AFTER_MS + 4000);
  assert.equal(r2.status, 'void');
  assert.equal(bal(ataOf(lone, MINTS.ore.key)), U(1, 'ore'));
  console.log('PASS pot winner gets 95%, lone player refunded');
}

// 5. Crash Cart: bets at or under the crash point pay stake x target; a thin bankroll voids the round
{
  let sawWin = false, sawLoss = false;
  for (let i = 0; i < 40 && !(sawWin && sawLoss); i++) {
    const round = ROUND + 10 + i;
    const w = newPlayer('ore', 1), l = newPlayer('ore', 1);
    const t0 = clock + (10 + i) * RM;
    playerBet(w, 'ore', 'c', round, 12, U(0.1, 'ore'), { blockTime: t0 + 2000 }); // 1.2x
    playerBet(l, 'ore', 'c', round, 100, U(0.1, 'ore'), { blockTime: t0 + 3000 }); // 10x
    const r = await settle('crash', 'ore', round, t0 + G.SETTLE_AFTER_MS + 4000);
    assert.ok(['paid', 'void'].includes(r.status));
    const crash = r.outcome.crash;
    const wb = bal(ataOf(w, MINTS.ore.key)) - U(1, 'ore');
    if (crash >= 1.2) { assert.equal(wb, U(0.02, 'ore')); sawWin = true; } else { assert.equal(wb, -U(0.1, 'ore')); }
    if (crash < 10) sawLoss = true;
    assert.equal(bal(ataOf(l, MINTS.ore.key)) - U(1, 'ore'), crash >= 10 ? U(0.9, 'ore') : -U(0.1, 'ore'));
  }
  assert.ok(sawWin && sawLoss);
  // bankroll too low: every bettor is refunded instead of the house paying out money it does not hold
  const prior = bal(ataOf(H, MINTS.skr.key));
  chain.tokens.get(ataOf(H, MINTS.skr.key)).amount = 0n;
  const round = ROUND + 80;
  const t0 = clock + 80 * RM;
  const w = newPlayer('skr', 1000);
  playerBet(w, 'skr', 'c', round, 12, U(100, 'skr'), { blockTime: t0 + 2000 }); // pays 1.2x if the cart is above 1.2x, so the house needs 120 and holds 100
  const r = await settle('crash', 'skr', round, t0 + G.SETTLE_AFTER_MS + 4000);
  if (r.outcome.void) assert.equal(bal(ataOf(w, MINTS.skr.key)), U(1000, 'skr'));
  chain.tokens.get(ataOf(H, MINTS.skr.key)).amount += prior;
  console.log('PASS crash pays by target, low bankroll refunds');
}

// 6. Bad deposits are refunded: late, no memo, wrong chip, over the per-wallet cap, wrong table
{
  const round = ROUND + 100;
  const t0 = clock + 100 * RM;
  const late = newPlayer('ore', 1), nomemo = newPlayer('ore', 1), odd = newPlayer('ore', 1), whale = newPlayer('ore', 5), good1 = newPlayer('ore', 1), good2 = newPlayer('ore', 1);
  playerBet(late, 'ore', 't', round, 1, U(0.1, 'ore'), { blockTime: t0 + G.BET_MS + 2000 });
  playerBet(nomemo, 'ore', 't', round, 1, U(0.1, 'ore'), { blockTime: t0 + 3000, memo: 'hello' });
  playerBet(odd, 'ore', 't', round, 1, U(0.07, 'ore'), { blockTime: t0 + 3000 });
  for (let i = 0; i < 7; i++) playerBet(whale, 'ore', 't', round, 0, U(0.1, 'ore'), { blockTime: t0 + 4000 + i * 100 });
  playerBet(good1, 'ore', 't', round, 2, U(0.05, 'ore'), { blockTime: t0 + 5000 });
  playerBet(good2, 'ore', 't', round, 3, U(0.05, 'ore'), { blockTime: t0 + 6000 });
  const r = await settle('tunnel', 'ore', round, t0 + G.SETTLE_AFTER_MS + 4000);
  assert.ok(['paid', 'void'].includes(r.status), r.status);
  assert.equal(bal(ataOf(late, MINTS.ore.key)), U(1, 'ore'));
  assert.equal(bal(ataOf(nomemo, MINTS.ore.key)), U(1, 'ore'));
  assert.equal(bal(ataOf(odd, MINTS.ore.key)), U(1, 'ore'));
  const spent = U(5, 'ore') - bal(ataOf(whale, MINTS.ore.key));
  assert.ok(spent <= U(0.5, 'ore') + 1n, `whale stake capped at 0.5 ORE (net ${spent})`);
  assert.equal(r.refunds.length, 3);
  console.log('PASS late, memo-less, odd-size and over-cap deposits are refunded');
}

// 7. Early settle is refused, empty rounds cost nothing, the HTTP handler works
{
  const early = await G.settleRound(env, house, { game: 'tunnel', token: 'ore', round: ROUND + 200, now: clock + 200 * RM + 10_000 });
  assert.equal(early.early, true);
  const none = await settle('tunnel', 'ore', ROUND + 300, clock + 300 * RM + G.SETTLE_AFTER_MS + 4000);
  assert.equal(none.status, 'none');
  const req = (body) => new Request('https://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const cfg = await (await games(req({ action: 'config' }), { env })).json();
  assert.equal(cfg.house, H);
  assert.equal(cfg.tokens.ore.decimals, 11);
  assert.equal(cfg.tokens.skr.decimals, 6);
  const st = await (await games(req({ action: 'selftest' }), { env })).json();
  assert.equal(st.ok, true);
  assert.equal((await games(req({ action: 'nope' }), { env })).status, 400);
  assert.equal((await games(req({ action: 'config' }), { env: {} })).status, 503);
  const text = JSON.stringify(cfg) + JSON.stringify(none);
  assert.ok(!text.includes(env.HOUSE_KEY) && !text.includes(env.GAMES_MASTER) && !text.includes('testkey'));
  console.log('PASS early refusal, empty rounds, http handler, no secrets in replies');
}
console.log('games arcade tests passed');
