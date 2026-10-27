// Tests the arcade house against an in-memory Solana and an in-memory ledger: real transaction bytes are decoded
// with @solana/web3.js, signatures are verified, balances move, and a payout can never land twice.
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
const H = houseKp.publicKey.toBase58();
const TOKEN = spl.TOKEN_PROGRAM_ID.toBase58();
const MINTS = { ore: { key: G.TOKENS.o.mint, dec: 11 }, skr: { key: G.TOKENS.s.mint, dec: 6 } };

// ----- in-memory ledger with the same rules as supabase/sql/arcade-ledger.sql -----
const ledger = {
  rounds: new Map(), sends: new Map(), stores: 0,
  async getRound(key) { return structuredClone(this.rounds.get(key) ?? null); },
  owedNow(token) { let n = 0n; for (const s of this.sends.values()) if (s.token === token && ['new', 'sending', 'failed'].includes(s.state)) for (const i of s.items) n += BigInt(i.amount); return n; },
  async owed(token) { return this.owedNow(token); },
  async storeRound({ key, token, result, sends, need, balance }) {
    this.stores++;
    if (this.rounds.has(key)) return structuredClone(this.rounds.get(key));
    if (need > 0n && balance - this.owedNow(token) < need) return null;
    this.rounds.set(key, structuredClone(result));
    for (const s of sends) if (!this.sends.has(s.label)) this.sends.set(s.label, { label: s.label, token, items: s.items, pre: s.pre ?? [], memo: s.memo, state: 'new', tx: null, sig: null, last_valid: null, attempts: 0, lease: 0 });
    return structuredClone(result);
  },
  async addSend({ label, token, items, pre, memo, need = 0n, balance = 0n }) {
    if (this.sends.has(label)) return true;
    if (need > 0n && balance - this.owedNow(token) < need) return false;
    this.sends.set(label, { label, token, items, pre: pre ?? [], memo, state: 'new', tx: null, sig: null, last_valid: null, attempts: 0, lease: 0 });
    return true;
  },
  async getSend(label) { const s = this.sends.get(label); return s ? structuredClone(s) : null; },
  async lease(label, secs) {
    const s = this.sends.get(label);
    if (!s || s.state === 'paid' || s.state === 'split' || s.lease > Date.now()) return null;
    s.lease = Date.now() + secs * 1000;
    return structuredClone(s);
  },
  async update(label, patch) { const s = this.sends.get(label); if (!s) return; if ('lease_until' in patch) { s.lease = 0; delete patch.lease_until; } Object.assign(s, patch); },
};
const env = { HELIUS_RPC_KEY: 'testkey-123456', GAMES_MASTER: 'master-secret-for-tests-only', HOUSE_KEY: JSON.stringify([...houseKp.secretKey]), __ledger: ledger, __pollMs: 5 };

// ----- in-memory chain -----
const chain = { tokens: new Map(), txs: [], applied: new Map(), sigSeq: 0, height: 50, closed: new Set(), dropSends: 0 };
const ataCache = new Map();
async function ata(owner, token) {
  const k = `${owner}|${token}`;
  if (!ataCache.has(k)) ataCache.set(k, await G.ataOf(owner, MINTS[token].key, TOKEN));
  return ataCache.get(k);
}
const bal = (a) => chain.tokens.get(a)?.amount ?? 0n;
async function setBal(owner, token, amount) { chain.tokens.set(await ata(owner, token), { owner, mint: MINTS[token].key, amount }); }
function record(sig, blockTime, ixs, memo, err = null) {
  chain.txs.unshift({ sig, blockTime, err, ixs, memo, ata: new Set(ixs.flatMap((i) => i.touch ?? [])) });
}
async function playerBet(wallet, token, game, round, choice, amountUnits, { blockTime, memo, mint } = {}) {
  const m = MINTS[token];
  const src = await ata(wallet, token), dst = await ata(H, token);
  assert.ok(bal(src) >= amountUnits, 'player funded');
  chain.tokens.get(src).amount -= amountUnits;
  chain.tokens.get(dst).amount += amountUnits;
  const sig = bs58.encode(crypto.randomBytes(64));
  const memoText = memo === null ? null : (memo ?? `gali1|${game}|${token === 'ore' ? 'o' : 's'}|${round}|${choice}`);
  record(sig, Math.floor((blockTime ?? clock) / 1000), [
    { program: 'spl-token', parsed: { type: 'transferChecked', info: { source: src, destination: dst, authority: wallet, mint: mint ?? m.key, tokenAmount: { amount: String(amountUnits), decimals: m.dec } } }, touch: [dst, src] },
    ...(memoText ? [{ program: 'spl-memo', parsed: memoText }] : []),
  ], memoText);
  return sig;
}
function rpcHandler(method, params) {
  switch (method) {
    case 'getAccountInfo': {
      const [addr] = params;
      const mint = Object.values(MINTS).find((x) => x.key === addr);
      if (mint) { const d = new Uint8Array(82); d[44] = mint.dec; return { value: { owner: TOKEN, data: [Buffer.from(d).toString('base64'), 'base64'], lamports: 1 } }; }
      return { value: chain.tokens.has(addr) ? { owner: TOKEN, data: ['', 'base64'], lamports: 2039280 } : null };
    }
    case 'getTokenAccountBalance': return { value: { amount: String(bal(params[0])) } };
    case 'getSlot': return 1;
    case 'getBlockTime': return Math.floor(clock / 1000);
    case 'getBlockHeight': return chain.height;
    case 'getBalance': return { value: 100_000_000 };
    case 'getSignaturesForAddress': {
      const [addr, opts] = params;
      const rows = chain.txs.filter((t) => t.ata.has(addr)).map((t) => ({ signature: t.sig, blockTime: t.blockTime, err: t.err, memo: t.memo ? `[${t.memo.length}] ${t.memo}` : null }));
      const at = opts?.before ? rows.findIndex((r) => r.signature === opts.before) + 1 : 0;
      return rows.slice(at, at + (opts?.limit ?? 1000));
    }
    case 'getTransaction': {
      const t = chain.txs.find((x) => x.sig === params[0]);
      if (!t) return null;
      return { blockTime: t.blockTime, meta: { err: t.err }, transaction: { signatures: [t.sig], message: { instructions: t.ixs.map(({ touch, ...rest }) => rest) } } };
    }
    case 'getLatestBlockhash': return { value: { blockhash: bs58.encode(crypto.randomBytes(32)), lastValidBlockHeight: chain.height + 150 } };
    case 'getSignatureStatuses': return { value: params[0].map((s) => (chain.applied.has(s) ? { confirmationStatus: 'confirmed', err: null } : null)) };
    case 'sendTransaction': {
      const raw = Buffer.from(params[0], 'base64');
      const tx = web3.Transaction.from(raw);
      assert.ok(tx.verifySignatures(), 'house signature must verify');
      const sig = bs58.encode(tx.signature);
      if (chain.dropSends > 0) { chain.dropSends--; const e = new Error('network'); e.network = true; throw e; }
      if (chain.applied.has(sig)) return sig; // the same bytes never apply twice
      const moves = [];
      const touch = [];
      for (const ix of tx.instructions) {
        assert.ok(!ix.programId.equals(web3.SystemProgram.programId), 'no rent-funded marker accounts');
        if (ix.programId.equals(spl.ASSOCIATED_TOKEN_PROGRAM_ID)) {
          const a = ix.keys[1].pubkey.toBase58();
          if (!chain.tokens.has(a)) chain.tokens.set(a, { owner: ix.keys[2].pubkey.toBase58(), mint: ix.keys[3].pubkey.toBase58(), amount: 0n });
        } else if (ix.programId.equals(spl.TOKEN_PROGRAM_ID)) {
          const d = spl.decodeTransferCheckedInstruction(ix);
          const dst = d.keys.destination.pubkey.toBase58();
          if (!chain.tokens.has(dst) || chain.closed.has(dst)) { const e = new Error('Transaction simulation failed: Error processing Instruction: invalid account data for instruction'); e.code = -32002; throw e; }
          moves.push({ src: d.keys.source.pubkey.toBase58(), dst, amount: d.data.amount });
          touch.push(d.keys.source.pubkey.toBase58(), dst);
        }
      }
      const need = new Map();
      for (const m of moves) need.set(m.src, (need.get(m.src) ?? 0n) + m.amount);
      for (const [src, n] of need) if (bal(src) < n) { const e = new Error('Transaction simulation failed: insufficient funds'); e.code = -32002; throw e; }
      for (const m of moves) { chain.tokens.get(m.src).amount -= m.amount; chain.tokens.get(m.dst).amount += m.amount; }
      chain.applied.set(sig, true);
      record(sig, Math.floor(clock / 1000), [{ program: 'spl-token', parsed: { type: 'transferChecked', info: { source: '', destination: 'x', authority: 'house', tokenAmount: { amount: '0' } } }, touch }], 'gali1pay');
      chain.sent = (chain.sent ?? 0) + 1;
      return sig;
    }
    default: throw new Error(`unmocked ${method}`);
  }
}
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  try { return Response.json({ jsonrpc: '2.0', id: body.id, result: rpcHandler(body.method, body.params) }); }
  catch (e) {
    if (e.network) throw new TypeError('fetch failed');
    return Response.json({ jsonrpc: '2.0', id: body.id, error: { code: e.code ?? -32000, message: e.message } });
  }
};

const house = await G.loadHouse(env);
assert.equal(house.owner, H);
const U = (ui, token) => BigInt(Math.round(Number(ui) * 10 ** MINTS[token].dec));
const newPlayer = async (token, ui) => { const k = web3.Keypair.generate().publicKey.toBase58(); await setBal(k, token, U(ui, token)); return k; };
const fundHouse = (token, ui) => setBal(H, token, U(ui, token));
const settleAt = (game, token, round) => { clock = round * RM + G.SETTLE_AFTER_MS + 4000; return G.settleRound(env, house, { game, token, round, now: clock }); };
const snapshot = () => new Map([...chain.tokens].map(([k, v]) => [k, v.amount]));
const fee = (x) => (x * 500n) / 10_000n;

// 1. encoding helpers and transaction bytes agree with web3.js; mints with risky extensions are refused
{
  const raw = crypto.randomBytes(40);
  assert.equal(G.b58enc(raw), bs58.encode(raw));
  assert.deepEqual(Buffer.from(G.b58dec('11' + bs58.encode(raw))), Buffer.concat([Buffer.from([0, 0]), raw]));
  const dest = web3.Keypair.generate().publicKey.toBase58();
  const bh = bs58.encode(crypto.randomBytes(32));
  const { raw: txRaw } = await G.signTransaction(house, bh, [
    { program: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', keys: [], data: new TextEncoder().encode('hello') },
    { program: TOKEN, keys: [{ pubkey: dest, writable: true }, { pubkey: MINTS.ore.key }, { pubkey: dest, writable: true }, { pubkey: H, signer: true }], data: Uint8Array.from([12, 5, 0, 0, 0, 0, 0, 0, 0, 11]) },
  ]);
  const tx = web3.Transaction.from(Buffer.from(txRaw));
  assert.ok(tx.verifySignatures());
  assert.equal(tx.feePayer.toBase58(), H);
  assert.equal(tx.recentBlockhash, bh);
  const expectAta = spl.getAssociatedTokenAddressSync(new web3.PublicKey(MINTS.ore.key), houseKp.publicKey).toBase58();
  assert.equal(await G.ataOf(H, MINTS.ore.key, TOKEN), expectAta);
  // Token-2022 mint with a transfer fee (type 1) or permanent delegate (type 12) is refused; plain mints pass
  const t22 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
  const withExt = (type) => { const d = new Uint8Array(166 + 4 + 8); d[165] = 1; d[166] = type; d[168] = 8; return d; };
  assert.equal(G.mintProblem(TOKEN, new Uint8Array(82)), null);
  assert.equal(G.mintProblem(t22, withExt(1)), 'unsupported token extension');
  assert.equal(G.mintProblem(t22, withExt(12)), 'unsupported token extension');
  assert.equal(G.mintProblem(t22, withExt(16)), null);
  assert.equal(G.memoFromList('[3] abc; [21] gali1|t|o|123|2'), 'gali1|t|o|123|2');
  console.log('PASS tx encoding, ATA derivation, mint extension check, memo parsing');
}

await fundHouse('ore', 5); await fundHouse('skr', 5000);

// 2. Tunnel Collapse pays survivors once, the 5% goes to revenue, replay and concurrency never pay twice
{
  const pre = bal(await ata(H, 'ore'));
  const players = await Promise.all([0, 1, 2, 3, 4].map(() => newPlayer('ore', 1)));
  const stakes = [0.1, 0.05, 0.05, 0.01, 0.1];
  for (const [i, p] of players.entries()) await playerBet(p, 'ore', 't', ROUND, i, U(stakes[i], 'ore'), { blockTime: T0 + 5000 + i * 1000 });
  const r = await settleAt('tunnel', 'ore', ROUND);
  assert.equal(r.status, 'paid');
  const lose = U(stakes[r.outcome.collapsed], 'ore');
  assert.equal(r.pays.filter((p) => p.kind === 'win').length, 4);
  const revAta = await G.ataOf(G.REVENUE_DEFAULT, MINTS.ore.key, TOKEN);
  assert.equal(bal(revAta), fee(lose), 'revenue wallet gets the 5% fee');
  const houseDelta = bal(await ata(H, 'ore')) - pre;
  assert.ok(houseDelta >= 0n && houseDelta <= 5n, `house keeps only dust (${houseDelta})`);
  const snap = snapshot();
  const sentBefore = chain.sent;
  const again = await Promise.all([settleAt('tunnel', 'ore', ROUND), settleAt('tunnel', 'ore', ROUND), settleAt('tunnel', 'ore', ROUND)]);
  again.forEach((a) => assert.equal(a.status, 'paid'));
  for (const [k, v] of chain.tokens) assert.equal(v.amount, snap.get(k), 'balances unchanged after replay');
  assert.equal(chain.sent, sentBefore, 'replays send nothing');
  assert.equal(crypto.createHash('sha256').update(Buffer.from(r.secret, 'hex')).digest('hex'), r.commit);
  const seed = await G.seedOf(Buffer.from(r.secret, 'hex'), ROUND, r.bets.map((b) => b.sig));
  assert.equal(Buffer.from(seed).toString('hex'), r.seed);
  console.log('PASS tunnel pays once, fee to revenue, replays send nothing, secret verifiable');
}

// 3. Concurrent first settles record one result and pay once
{
  const round = ROUND + 1;
  const ps = await Promise.all([0, 1, 2, 3].map(() => newPlayer('skr', 1000)));
  for (const [i, p] of ps.entries()) await playerBet(p, 'skr', 't', round, i % 2, U(50, 'skr'), { blockTime: round * RM + 3000 + i * 500 });
  const start = snapshot();
  clock = round * RM + G.SETTLE_AFTER_MS + 4000;
  const rs = await Promise.all([1, 2, 3].map(() => G.settleRound(env, house, { game: 'tunnel', token: 'skr', round, now: clock })));
  rs.forEach((x) => assert.ok(['paid', 'void', 'pending'].includes(x.status), x.status));
  assert.equal(new Set(rs.map((x) => x.seed)).size, 1, 'one recorded result');
  const fin = await settleAt('tunnel', 'skr', round);
  assert.ok(['paid', 'void'].includes(fin.status));
  let net = 0n;
  for (const [k, v] of chain.tokens) net += v.amount - (start.get(k) ?? 0n);
  assert.equal(net, 0n, 'tokens are conserved');
  const allPaid = (await Promise.all(ps.map(async (p) => bal(await ata(p, 'skr'))))).reduce((n, b) => n + b, 0n);
  assert.ok(allPaid <= U(4000, 'skr') && allPaid >= U(4000, 'skr') - fee(U(100, 'skr')) - 10n, 'players only lose the fee');
  console.log('PASS concurrent settles record one result and pay once');
}

// 4. Gold Rush Pot: one winner takes 95%; a lone player is refunded
{
  const round = ROUND + 2;
  const ps = [await newPlayer('ore', 1), await newPlayer('ore', 1), await newPlayer('ore', 1)];
  for (const [i, p] of ps.entries()) await playerBet(p, 'ore', 'p', round, 0, U(0.1, 'ore'), { blockTime: round * RM + 2000 + i * 700 });
  const r = await settleAt('pot', 'ore', round);
  assert.equal(r.status, 'paid');
  assert.equal(r.pays.length, 1);
  assert.equal(r.pays[0].amount, '0.285');
  const lone = await newPlayer('ore', 1);
  const round2 = ROUND + 3;
  await playerBet(lone, 'ore', 'p', round2, 0, U(0.05, 'ore'), { blockTime: round2 * RM + 2000 });
  const r2 = await settleAt('pot', 'ore', round2);
  assert.equal(r2.status, 'void');
  assert.equal(bal(await ata(lone, 'ore')), U(1, 'ore'));
  console.log('PASS pot winner gets 95%, lone player refunded');
}

// 5. Crash Cart pays by target; the bankroll check counts what the house already owes
{
  let sawWin = false, sawLoss = false;
  for (let i = 0; i < 40 && !(sawWin && sawLoss); i++) {
    const round = ROUND + 10 + i;
    const w = await newPlayer('ore', 1), l = await newPlayer('ore', 1);
    await playerBet(w, 'ore', 'c', round, 12, U(0.1, 'ore'), { blockTime: round * RM + 2000 });
    await playerBet(l, 'ore', 'c', round, 100, U(0.1, 'ore'), { blockTime: round * RM + 3000 });
    const r = await settleAt('crash', 'ore', round);
    assert.ok(['paid', 'void'].includes(r.status));
    const crash = r.outcome.crash;
    const wb = bal(await ata(w, 'ore')) - U(1, 'ore');
    if (crash >= 1.2) { assert.equal(wb, U(0.02, 'ore')); sawWin = true; } else assert.equal(wb, -U(0.1, 'ore'));
    if (crash < 10) sawLoss = true;
    assert.equal(bal(await ata(l, 'ore')) - U(1, 'ore'), crash >= 10 ? U(0.9, 'ore') : -U(0.1, 'ore'));
  }
  assert.ok(sawWin && sawLoss);
  // an unpaid debt on the same token counts against the bankroll
  const houseSkr = await ata(H, 'skr');
  const prior = bal(houseSkr);
  chain.tokens.get(houseSkr).amount = 0n;
  await ledger.addSend({ label: 'test-debt', token: 's', items: [{ to: houseSkr, amount: String(U(100, 'skr')) }], memo: 'x' });
  let voided = false;
  for (let i = 0; i < 20 && !voided; i++) {
    const round = ROUND + 80 + i;
    chain.tokens.get(houseSkr).amount = 0n; // only this round's stake is in the bankroll
    const w = await newPlayer('skr', 1000);
    await playerBet(w, 'skr', 'c', round, 12, U(100, 'skr'), { blockTime: round * RM + 2000 });
    const r = await settleAt('crash', 'skr', round);
    if (r.outcome.void) { voided = true; assert.equal(bal(await ata(w, 'skr')), U(1000, 'skr')); }
    else if (r.outcome.crash >= 1.2) assert.fail('house paid a win it could not cover');
  }
  assert.ok(voided, 'a round the house could not cover was refunded');
  ledger.sends.delete('test-debt');
  chain.tokens.get(houseSkr).amount = prior;
  console.log('PASS crash pays by target, bankroll check counts open debts');
}

// 6. Bad stakes are refunded in batches; dust and memo-less transfers cost the house nothing
{
  const round = ROUND + 100;
  const t0 = round * RM;
  const late = await newPlayer('ore', 1), nomemo = await newPlayer('ore', 1), odd = await newPlayer('ore', 1), whale = await newPlayer('ore', 5), dust = await newPlayer('ore', 1);
  const good1 = await newPlayer('ore', 1), good2 = await newPlayer('ore', 1);
  await playerBet(late, 'ore', 't', round, 1, U(0.1, 'ore'), { blockTime: t0 + G.BET_MS + 2000 });
  await playerBet(nomemo, 'ore', 't', round, 1, U(0.1, 'ore'), { blockTime: t0 + 3000, memo: null });
  await playerBet(odd, 'ore', 't', round, 1, U(0.07, 'ore'), { blockTime: t0 + 3000 });
  for (let i = 0; i < 40; i++) await playerBet(dust, 'ore', 't', round, 1, 1n, { blockTime: t0 + 3000, memo: 'hello' });
  for (let i = 0; i < 40; i++) await playerBet(dust, 'ore', 't', round, 1, 1n, { blockTime: t0 + 3000 });
  for (let i = 0; i < 7; i++) await playerBet(whale, 'ore', 't', round, 0, U(0.1, 'ore'), { blockTime: t0 + 4000 + i * 100 });
  await playerBet(good1, 'ore', 't', round, 2, U(0.05, 'ore'), { blockTime: t0 + 5000 });
  await playerBet(good2, 'ore', 't', round, 3, U(0.05, 'ore'), { blockTime: t0 + 6000 });
  const sent0 = chain.sent;
  const r = await settleAt('tunnel', 'ore', round);
  assert.ok(['paid', 'void'].includes(r.status), r.status);
  assert.equal(bal(await ata(odd, 'ore')), U(1, 'ore'), 'odd chip refunded');
  assert.equal(bal(await ata(nomemo, 'ore')), U(0.9, 'ore'), 'memo-less transfer is not refunded automatically');
  const spent = U(5, 'ore') - bal(await ata(whale, 'ore'));
  assert.ok(spent <= U(0.5, 'ore') + 1n, `whale stake capped at 0.5 ORE (net ${spent})`);
  assert.equal(r.refunds.filter((x) => x.why === 'not a valid bet').length, 1);
  assert.ok(chain.sent - sent0 <= 4, `refunds and payouts are batched (${chain.sent - sent0} transactions)`);
  // the late stake is refunded by the round in which it landed
  const r2 = await settleAt('tunnel', 'ore', round + 1);
  assert.equal(r2.refunds.length, 1);
  assert.equal(bal(await ata(late, 'ore')), U(1, 'ore'), 'late stake refunded once');
  await settleAt('tunnel', 'ore', round + 1);
  assert.equal(bal(await ata(late, 'ore')), U(1, 'ore'));
  console.log('PASS bad stakes refunded in batches, dust and memo-less transfers ignored, late stake refunded once');
}

// 7. Spam after a round cannot hide its stakes or change a recorded result
{
  const round = ROUND + 200;
  const t0 = round * RM;
  const a = await newPlayer('ore', 1), b = await newPlayer('ore', 1);
  await playerBet(a, 'ore', 't', round, 0, U(0.1, 'ore'), { blockTime: t0 + 2000 });
  await playerBet(b, 'ore', 't', round, 1, U(0.1, 'ore'), { blockTime: t0 + 3000 });
  const spammer = await newPlayer('ore', 1);
  for (let i = 0; i < 2500; i++) await playerBet(spammer, 'ore', 't', round + 1, 0, 1n, { blockTime: t0 + 45_000, memo: 'spam' });
  const r = await settleAt('tunnel', 'ore', round);
  assert.equal(r.bets.length, 2, 'stakes found past 2,500 newer signatures');
  // after the result is recorded, more spam and more late stakes change nothing
  for (let i = 0; i < 300; i++) await playerBet(spammer, 'ore', 't', round, 1, 1n, { blockTime: t0 + 46_000 });
  const again = await settleAt('tunnel', 'ore', round);
  assert.equal(again.seed, r.seed);
  assert.deepEqual(again.pays, r.pays);
  console.log('PASS spam cannot hide stakes or change a recorded result');
}

// 8. A closed recipient account only blocks its own payout
{
  const round = ROUND + 300;
  const t0 = round * RM;
  const ps = await Promise.all([0, 1, 2, 3, 4, 5].map(() => newPlayer('ore', 1)));
  for (const [i, p] of ps.entries()) await playerBet(p, 'ore', 'p', round, 0, U(0.01, 'ore'), { blockTime: t0 + 2000 + i * 100 });
  const bad = await ata(ps[0], 'ore');
  chain.closed.add(bad);
  // force a full refund batch: a pot with one wallet only refunds, so use six stakes from five wallets and close one
  const r = await settleAt('pot', 'ore', round);
  if (r.outcome.winner === ps[0]) assert.equal(r.status, 'failed');
  else {
    assert.equal(r.status, 'paid');
    const winner = r.pays[0].who;
    assert.equal(bal(await ata(winner, 'ore')), U(1, 'ore') - U(0.01, 'ore') + U(0.057, 'ore'));
  }
  chain.closed.delete(bad);
  // a refund batch with one closed account still refunds the other four
  const round2 = ROUND + 301;
  const lone = await newPlayer('ore', 1);
  for (let i = 0; i < 5; i++) await playerBet(lone, 'ore', 'p', round2, 0, U(0.01, 'ore'), { blockTime: round2 * RM + 2000 + i * 100 });
  const others = await Promise.all([0, 1, 2, 3].map(() => newPlayer('ore', 1)));
  for (const [i, p] of others.entries()) await playerBet(p, 'ore', 'p', round2, 0, U(0.05, 'ore'), { blockTime: round2 * RM + 3000 + i * 100, memo: `gali1|p|o|${round2}|3` });
  chain.closed.add(await ata(others[0], 'ore'));
  const r2 = await settleAt('pot', 'ore', round2);
  for (const p of others.slice(1)) assert.equal(bal(await ata(p, 'ore')), U(1, 'ore'), 'other refunds still paid');
  assert.ok([...ledger.sends.values()].some((s) => s.state === 'split'), 'the refused batch was split');
  assert.ok(['failed', 'paid'].includes(r2.status));
  chain.closed.clear();
  console.log('PASS a closed recipient only blocks its own payout');
}

// 9. A send lost in the network is resent with the same bytes, and only signed again after it expires
{
  const round = ROUND + 400;
  const a = await newPlayer('skr', 1000), b = await newPlayer('skr', 1000);
  await playerBet(a, 'skr', 'p', round, 0, U(10, 'skr'), { blockTime: round * RM + 2000 });
  await playerBet(b, 'skr', 'p', round, 0, U(10, 'skr'), { blockTime: round * RM + 3000 });
  chain.dropSends = 1;
  const r1 = await settleAt('pot', 'skr', round);
  assert.equal(r1.status, 'pending');
  const label = r1.labels[0];
  const firstSig = ledger.sends.get(label).sig;
  assert.ok(firstSig);
  const r2 = await settleAt('pot', 'skr', round); // still valid: rebroadcast of the same bytes
  assert.equal(r2.status, 'paid');
  assert.equal(ledger.sends.get(label).sig, firstSig);
  // expiry path: a send that never arrived is signed again only after its blockhash expires
  const round2 = ROUND + 401;
  const c = await newPlayer('skr', 1000), d = await newPlayer('skr', 1000);
  await playerBet(c, 'skr', 'p', round2, 0, U(10, 'skr'), { blockTime: round2 * RM + 2000 });
  await playerBet(d, 'skr', 'p', round2, 0, U(10, 'skr'), { blockTime: round2 * RM + 3000 });
  chain.dropSends = 2; // the first send and the rebroadcast both vanish
  await settleAt('pot', 'skr', round2);
  const s1 = ledger.sends.get(`ps${(round2).toString(36)}.0`).sig;
  await settleAt('pot', 'skr', round2);
  assert.equal(ledger.sends.get(`ps${(round2).toString(36)}.0`).sig, s1, 'no new signature while the old one can still land');
  chain.height += 1000;
  const fin = await settleAt('pot', 'skr', round2);
  assert.equal(fin.status, 'paid');
  const total = bal(await ata(c, 'skr')) + bal(await ata(d, 'skr'));
  assert.equal(total, U(2000, 'skr') - fee(U(20, 'skr')), 'paid exactly once');
  console.log('PASS lost sends are resent with the same bytes and re-signed only after expiry');
}

// 10. Early settle is refused, empty rounds cost nothing, old rounds are refused, the HTTP handler works
{
  const early = await G.settleRound(env, house, { game: 'tunnel', token: 'ore', round: ROUND + 500, now: (ROUND + 500) * RM + 10_000 });
  assert.equal(early.early, true);
  const none = await settleAt('tunnel', 'ore', ROUND + 600);
  assert.equal(none.status, 'none');
  await assert.rejects(G.settleRound(env, house, { game: 'tunnel', token: 'ore', round: ROUND + 601, now: (ROUND + 601) * RM + G.MAX_SETTLE_AGE_MS + 1000 }), /too old/);
  const req = (body) => new Request('https://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const cfg = await (await games(req({ action: 'config' }), { env })).json();
  assert.equal(cfg.house, H);
  assert.equal(cfg.tokens.ore.decimals, 11);
  assert.equal(cfg.tokens.ore.houseAta, await ata(H, 'ore'));
  assert.equal(cfg.settleAfterMs, G.SETTLE_AFTER_MS);
  const noLedger = await (await games(req({ action: 'config' }), { env: { ...env, __ledger: undefined } })).json();
  assert.equal(noLedger.tokens.ore.ready, false, 'tables stay closed without a ledger');
  const st = await (await games(req({ action: 'selftest' }), { env })).json();
  assert.equal(st.ok, true);
  assert.equal((await games(req({ action: 'nope' }), { env })).status, 400);
  assert.equal((await games(req({ action: 'config' }), { env: {} })).status, 503);
  const text = JSON.stringify(cfg) + JSON.stringify(none);
  assert.ok(!text.includes(env.HOUSE_KEY) && !text.includes(env.GAMES_MASTER) && !text.includes('testkey'));
  console.log('PASS early and old rounds refused, empty rounds, http handler, no secrets in replies');
}
console.log('games arcade tests passed');
