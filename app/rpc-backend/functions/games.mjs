// Gali arcade house: Tunnel Collapse, Gold Rush Pot and Crash Cart with real ORE and SKR.
//
// Stateless by design. Rounds are 40 s slots of the server clock. A player's bet is an SPL transfer to the
// house token account carrying a memo "gali1|<game>|<token>|<round>|<choice>". Nothing is stored here: the
// chain is the ledger. Settling a round re-reads the chain, so any caller (and any number of callers at once)
// computes the same outcome, and each payout batch is protected on chain by a one-time "mutex" account, so a
// batch can never be paid twice.
//
// Fairness: before a round opens the server publishes commit = SHA256(secret) with secret = HMAC(master, table|round).
// The round's seed is SHA256(secret | round | every valid bet signature, sorted). The secret is revealed with the
// result, so anyone can recompute the seed and the outcome.

export const ROUND_MS = 40_000;
export const BET_MS = 30_000; // stakes must land on chain before this point of the round
export const SETTLE_AFTER_MS = 46_000; // results are final this long after the round starts
const LATE_SCAN_MS = 10 * 60_000; // how far back late or malformed deposits are still refunded
const FEE_BPS = 500n; // 5% of the redistributed pot (Crash Cart: 5% built into the multiplier)
const CAP_MULT = 5n; // one wallet may stake at most 5 x the top chip per round
const MUTEX_LAMPORTS = 890_880n; // rent-exempt minimum for a 0-byte account
const BATCH = 5; // payouts per transaction

const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

export const TOKENS = {
  o: { id: 'ore', mint: 'oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp', chips: ['0.01', '0.05', '0.1'] },
  s: { id: 'skr', mint: 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3', chips: ['10', '50', '100'] },
};
export const GAMES = { t: 'tunnel', p: 'pot', c: 'crash' };
const GAME_KEY = { tunnel: 't', pot: 'p', crash: 'c' };
const TOKEN_KEY = { ore: 'o', skr: 's' };

const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const reply = (status, body) => Response.json(body, { status, headers });
const fail = (status, message) => reply(status, { ok: false, error: message });

// ---------- bytes, base58, hashing ----------
const enc = new TextEncoder();
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function b58enc(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b === 0) out = '1' + out; else break; }
  return out;
}
export function b58dec(str) {
  let n = 0n;
  for (const c of str) {
    const d = B58.indexOf(c);
    if (d < 0) throw new Error('bad base58');
    n = n * 58n + BigInt(d);
  }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n & 255n)); n >>= 8n; }
  let z = 0;
  for (const c of str) { if (c === '1') z++; else break; }
  return Uint8Array.from([...new Array(z).fill(0), ...bytes]);
}
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s) => Uint8Array.from(s.match(/../g).map((h) => parseInt(h, 16)));
const sha256 = async (b) => new Uint8Array(await crypto.subtle.digest('SHA-256', b));
async function hmac(keyText, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(keyText), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}
const u64le = (v) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(v), true); return b; };
const u32le = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; };
const compact = (n) => { const out = []; let v = n; for (;;) { const low = v & 0x7f; v >>= 7; if (v === 0) { out.push(low); break; } out.push(low | 0x80); } return Uint8Array.from(out); };
const b64 = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };

// ---------- ed25519 house key ----------
const PKCS8_PREFIX = unhex('302e020100300506032b657004220420');
export async function loadHouse(env) {
  const raw = env?.HOUSE_KEY;
  if (typeof raw !== 'string' || raw.length < 40) throw new Error('house key not configured');
  let bytes;
  if (raw.trim().startsWith('[')) bytes = Uint8Array.from(JSON.parse(raw));
  else bytes = b58dec(raw.trim());
  if (bytes.length !== 64) throw new Error('house key must be 64 bytes');
  const seed = bytes.slice(0, 32);
  const pub = bytes.slice(32);
  const key = await crypto.subtle.importKey('pkcs8', concat(PKCS8_PREFIX, seed), 'Ed25519', false, ['sign']);
  const pubKey = await crypto.subtle.importKey('raw', pub, 'Ed25519', false, ['verify']);
  const sign = async (msg) => new Uint8Array(await crypto.subtle.sign('Ed25519', key, msg));
  return { pub, owner: b58enc(pub), sign, pubKey };
}

// ---------- legacy transaction building ----------
// ix: { program: base58, keys: [{ pubkey: base58, signer?, writable? }], data: Uint8Array }
export function compileMessage(feePayer, blockhash, ixs) {
  const metas = new Map();
  const touch = (pubkey, signer, writable) => {
    const m = metas.get(pubkey);
    if (m) { m.signer ||= signer; m.writable ||= writable; } else metas.set(pubkey, { pubkey, signer, writable });
  };
  touch(feePayer, true, true);
  for (const ix of ixs) {
    for (const k of ix.keys) touch(k.pubkey, !!k.signer, !!k.writable);
    touch(ix.program, false, false);
  }
  const all = [...metas.values()];
  const group = (m) => (m.signer ? (m.writable ? 0 : 1) : m.writable ? 2 : 3);
  const ordered = [all.find((m) => m.pubkey === feePayer), ...all.filter((m) => m.pubkey !== feePayer)]
    .sort((a, b) => group(a) - group(b)); // stable: the fee payer stays first inside group 0
  const signers = ordered.filter((m) => m.signer).length;
  const roSigned = ordered.filter((m) => m.signer && !m.writable).length;
  const roUnsigned = ordered.filter((m) => !m.signer && !m.writable).length;
  const index = new Map(ordered.map((m, i) => [m.pubkey, i]));
  const parts = [Uint8Array.from([signers, roSigned, roUnsigned]), compact(ordered.length), ...ordered.map((m) => b58dec(m.pubkey)), b58dec(blockhash), compact(ixs.length)];
  for (const ix of ixs) {
    parts.push(Uint8Array.from([index.get(ix.program)]), compact(ix.keys.length), Uint8Array.from(ix.keys.map((k) => index.get(k.pubkey))), compact(ix.data.length), ix.data);
  }
  return { message: concat(...parts), signers: ordered.filter((m) => m.signer).map((m) => m.pubkey) };
}
export async function signTransaction(house, blockhash, ixs) {
  const { message, signers } = compileMessage(house.owner, blockhash, ixs);
  if (signers.length !== 1 || signers[0] !== house.owner) throw new Error('only the house signs payouts');
  const sig = await house.sign(message);
  return { raw: concat(compact(1), sig, message), signature: b58enc(sig) };
}
const transferChecked = (program, source, mint, dest, owner, amount, decimals) => ({
  program,
  keys: [{ pubkey: source, writable: true }, { pubkey: mint }, { pubkey: dest, writable: true }, { pubkey: owner, signer: true }],
  data: concat(Uint8Array.from([12]), u64le(amount), Uint8Array.from([decimals])),
});
const memoIx = (text) => ({ program: MEMO_PROGRAM, keys: [], data: enc.encode(text) });
export async function mutexAddress(houseOwner, seed) {
  const addr = await sha256(concat(b58dec(houseOwner), enc.encode(seed), b58dec(SYSTEM_PROGRAM)));
  return b58enc(addr);
}
const createMutex = (house, address, seed, lamports) => ({
  program: SYSTEM_PROGRAM,
  keys: [{ pubkey: house, signer: true, writable: true }, { pubkey: address, writable: true }],
  data: concat(u32le(3), b58dec(house), u64le(seed.length), enc.encode(seed), u64le(lamports), u64le(0), b58dec(SYSTEM_PROGRAM)),
});

// ---------- RPC ----------
function providers(env) {
  const list = [];
  const hk = env?.HELIUS_RPC_KEY;
  if (typeof hk === 'string' && hk && hk.length <= 256) list.push(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(hk)}`);
  const ak = env?.ALCHEMY_RPC_KEY;
  if (typeof ak === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(ak)) list.push(`https://solana-mainnet.g.alchemy.com/v2/${ak}`);
  return list;
}
export async function call(env, method, params = [], ms = 4500) {
  const list = providers(env);
  if (!list.length) throw new Error('RPC unavailable');
  let last = new Error('RPC unavailable');
  for (const [i, url] of list.entries()) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), list.length > 1 && i === 0 ? ms : ms + 2500);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: controller.signal });
      if (!res.ok) { last = new Error('RPC unavailable'); continue; }
      const json = await res.json();
      if (json.error) {
        const e = new Error(String(json.error.message || 'rpc error').slice(0, 300));
        e.rpc = true;
        if (method === 'sendTransaction') throw e; // a refused transaction is an answer, not an outage
        last = e;
        continue;
      }
      return json.result;
    } catch (e) {
      if (e?.rpc) throw e;
      last = new Error('RPC unavailable');
    } finally { clearTimeout(timer); }
  }
  throw last;
}

// ---------- tables ----------
const mintInfo = new Map();
async function loadMint(env, t) {
  const cached = mintInfo.get(t);
  if (cached) return cached;
  const acc = await call(env, 'getAccountInfo', [TOKENS[t].mint, { encoding: 'base64', commitment: 'confirmed' }]);
  if (!acc?.value) throw new Error(`${TOKENS[t].id} mint not found`);
  const data = Uint8Array.from(atob(acc.value.data[0]), (c) => c.charCodeAt(0));
  const info = { program: acc.value.owner, decimals: data[44] };
  if (info.program !== TOKEN_PROGRAM && info.program !== TOKEN_2022) throw new Error('unsupported token program');
  mintInfo.set(t, info);
  return info;
}
const houseAtaCache = new Map();
async function loadHouseAta(env, house, t) {
  const cached = houseAtaCache.get(t);
  if (cached) return cached;
  const res = await call(env, 'getTokenAccountsByOwner', [house.owner, { mint: TOKENS[t].mint }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
  const first = res?.value?.[0];
  if (!first) throw new Error(`The ${TOKENS[t].id} table is not funded yet`);
  houseAtaCache.set(t, first.pubkey);
  return first.pubkey;
}
const unitsOf = (ui, decimals) => {
  const [w, f = ''] = String(ui).split('.');
  return BigInt(w) * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0');
};
export const fmt = (units, decimals) => {
  const s = units.toString().padStart(decimals + 1, '0');
  const w = s.slice(0, s.length - decimals);
  const f = s.slice(s.length - decimals).replace(/0+$/, '');
  return f ? `${w}.${f}` : w;
};

// ---------- rounds and fairness ----------
const roundAt = (ms) => Math.floor(ms / ROUND_MS);
const startOf = (round) => round * ROUND_MS;
async function roundSecret(env, g, t, round) {
  const master = env?.GAMES_MASTER;
  if (typeof master !== 'string' || master.length < 16) throw new Error('games secret not configured');
  return hmac(master, `${g}${t}|${round}`);
}
export async function seedOf(secret, round, sigs) {
  return sha256(concat(secret, enc.encode(String(round)), enc.encode([...sigs].sort().join(','))));
}
const bigOf = (bytes) => BigInt('0x' + hex(bytes.slice(0, 16)));

// ---------- reading bets from chain ----------
const txCache = new Map(); // signature -> parsed deposit or null (only confirmed, successful transactions)
export function parseDeposit(tx, houseAta) {
  if (!tx || tx.meta?.err) return null;
  const msg = tx.transaction?.message;
  if (!msg) return null;
  let amount = 0n, from = null, source = null, mint = null, memo = null;
  for (const ix of msg.instructions ?? []) {
    if (ix.program === 'spl-memo' && typeof ix.parsed === 'string') memo = memo ?? ix.parsed;
    const p = ix.parsed;
    if ((ix.program === 'spl-token' || ix.program === 'spl-token-2022') && p?.type === 'transferChecked' && p.info?.destination === houseAta) {
      amount += BigInt(p.info.tokenAmount.amount);
      from = from ?? p.info.authority ?? p.info.multisigAuthority;
      source = source ?? p.info.source;
      mint = mint ?? p.info.mint;
    }
  }
  if (amount === 0n || !from || !source) return null;
  return { amount, from, source, mint, memo, blockTime: tx.blockTime ?? 0, sig: tx.transaction.signatures[0] };
}
export function parseMemo(memo) {
  const m = /^gali1\|([tpc])\|([os])\|(\d{1,9})\|(\d{1,4})$/.exec(memo ?? '');
  return m ? { g: m[1], t: m[2], round: Number(m[3]), choice: Number(m[4]) } : null;
}
async function fetchDeposits(env, houseAta, sinceSec) {
  const found = [];
  let before;
  for (let page = 0; page < 5; page++) {
    const sigs = await call(env, 'getSignaturesForAddress', [houseAta, { limit: 200, commitment: 'confirmed', ...(before ? { before } : {}) }]);
    if (!sigs.length) break;
    for (const s of sigs) if (!s.err && (s.blockTime ?? 0) >= sinceSec) found.push(s.signature);
    const last = sigs[sigs.length - 1];
    before = last.signature;
    if (sigs.length < 200 || (last.blockTime ?? 0) < sinceSec) break;
  }
  const out = [];
  const todo = found.filter((s) => { if (txCache.has(s)) { const d = txCache.get(s); if (d) out.push(d); return false; } return true; });
  for (let i = 0; i < todo.length; i += 8) {
    await Promise.all(todo.slice(i, i + 8).map(async (s) => {
      try {
        const tx = await call(env, 'getTransaction', [s, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
        if (!tx) return; // not visible yet: try again next call
        const d = parseDeposit(tx, houseAta);
        if (txCache.size > 4000) txCache.clear();
        txCache.set(s, d);
        if (d) out.push(d);
      } catch { /* leave it for the next call */ }
    }));
  }
  return out;
}

// ---------- game rules (pure) ----------
// bets: [{ from, source, amount, choice, sig }] sorted by (blockTime, sig). Returns { outcome, pays } with pays = [{ bet, amount, kind }].
export function playRound(game, bets, seed, ctx) {
  const feeOf = (x) => (x * FEE_BPS) / 10_000n;
  const total = bets.reduce((n, b) => n + b.amount, 0n);
  const refundAll = (why) => ({ outcome: { void: why }, pays: bets.map((bet) => ({ bet, amount: bet.amount, kind: 'refund' })) });
  const n = bigOf(seed);
  if (!bets.length) return { outcome: { none: true }, pays: [] };
  if (game === 't') {
    const collapsed = Number(n % 5n);
    const pool = [0n, 0n, 0n, 0n, 0n];
    for (const b of bets) pool[b.choice] += b.amount;
    const lose = pool[collapsed];
    const keep = total - lose;
    if (lose === 0n || keep === 0n) return { ...refundAll(lose === 0n ? 'nobody was in the collapsed tunnel' : 'everyone was in the collapsed tunnel'), outcome: { void: lose === 0n ? 'nobody was in the collapsed tunnel' : 'everyone was in the collapsed tunnel', collapsed } };
    const share = lose - feeOf(lose);
    const pays = bets.filter((b) => b.choice !== collapsed).map((bet) => ({ bet, amount: bet.amount + (share * bet.amount) / keep, kind: 'win' }));
    return { outcome: { collapsed, pool: pool.map(String), fee: String(feeOf(lose)) }, pays };
  }
  if (game === 'p') {
    const people = new Set(bets.map((b) => b.from));
    if (people.size < 2) return refundAll('needs two players');
    let pick = n % total;
    let winner = bets[bets.length - 1];
    for (const b of bets) { if (pick < b.amount) { winner = b; break; } pick -= b.amount; }
    const prize = total - feeOf(total);
    return { outcome: { winner: winner.from, winnerSig: winner.sig, pot: String(total), fee: String(feeOf(total)) }, pays: [{ bet: winner, amount: prize, kind: 'win' }] };
  }
  // crash: the cart crashes at m100/100; a bet with target t100 <= m100 pays stake * t100 / 100 (RTP about 95%)
  const x = n % 1_000_000_000n;
  let m100 = (95n * 1_000_000_000n) / (1_000_000_000n - x);
  if (m100 < 100n) m100 = 100n;
  if (m100 > 1_000_000n) m100 = 1_000_000n;
  const pays = [];
  let owed = 0n;
  for (const bet of bets) {
    const t100 = BigInt(bet.choice) * 10n;
    if (t100 <= m100) { const amount = (bet.amount * t100) / 100n; pays.push({ bet, amount, kind: 'win' }); owed += amount; }
  }
  if (ctx?.houseBalance !== undefined && ctx.houseBalance < owed) return refundAll('the house bankroll is too low for this round');
  return { outcome: { crash: Number(m100) / 100 }, pays };
}

// ---------- validating bets ----------
export function validChoice(game, choice) {
  if (game === 't') return choice >= 0 && choice <= 4;
  if (game === 'p') return choice === 0;
  return choice >= 12 && choice <= 100;
}
export function classify({ deposits, game, token, round, decimals }) {
  const g = game, t = token;
  const chips = new Set(TOKENS[t].chips.map((c) => unitsOf(c, decimals)));
  const cap = unitsOf(TOKENS[t].chips[2], decimals) * CAP_MULT;
  const start = startOf(round) / 1000;
  const mine = [];
  const rest = []; // deposits owned by this round that are refunded one by one
  for (const d of deposits) {
    const m = parseMemo(d.memo);
    const owner = m ? m.round : roundAt(d.blockTime * 1000);
    if (owner !== round) continue;
    if (m && (m.g !== g || m.t !== t)) continue; // another table's deposit
    if (!m && roundAt(d.blockTime * 1000) !== round) continue;
    if (!m) { rest.push({ d, why: 'no valid memo' }); continue; }
    if (d.mint && d.mint !== TOKENS[t].mint) { rest.push({ d, why: 'wrong token' }); continue; }
    if (d.blockTime < start - 60) { rest.push({ d, why: 'too early' }); continue; }
    if (d.blockTime >= start + BET_MS / 1000) { rest.push({ d, why: 'landed after betting closed' }); continue; }
    if (!validChoice(g, m.choice) || !chips.has(d.amount)) { rest.push({ d, why: 'not a valid bet' }); continue; }
    mine.push({ ...d, choice: m.choice });
  }
  mine.sort((a, b) => a.blockTime - b.blockTime || (a.sig < b.sig ? -1 : 1));
  const spent = new Map();
  const bets = [];
  const capped = [];
  for (const b of mine) {
    const s = (spent.get(b.from) ?? 0n) + b.amount;
    if (s > cap) { capped.push(b); continue; }
    spent.set(b.from, s);
    bets.push(b);
  }
  return { bets, capped, rest };
}

// ---------- payouts ----------
async function sendBatch(env, house, label, mintAddr, program, decimals, houseAta, items, memoText) {
  const seed = label;
  const mutex = await mutexAddress(house.owner, seed);
  const existing = await call(env, 'getAccountInfo', [mutex, { encoding: 'base64', commitment: 'confirmed' }]);
  if (existing?.value) return { label, state: 'paid' };
  const bh = await call(env, 'getLatestBlockhash', [{ commitment: 'confirmed' }]);
  const ixs = [
    createMutex(house.owner, mutex, seed, MUTEX_LAMPORTS),
    ...items.map((it) => transferChecked(program, houseAta, mintAddr, it.to, house.owner, it.amount, decimals)),
    memoIx(memoText),
  ];
  const { raw, signature } = await signTransaction(house, bh.value.blockhash, ixs);
  try {
    await call(env, 'sendTransaction', [b64(raw), { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 }]);
  } catch (e) {
    const again = await call(env, 'getAccountInfo', [mutex, { encoding: 'base64', commitment: 'confirmed' }]).catch(() => null);
    if (again?.value) return { label, state: 'paid' };
    return { label, state: 'failed', error: String(e.message).slice(0, 160) };
  }
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const st = await call(env, 'getSignatureStatuses', [[signature]]).catch(() => null);
    const s = st?.value?.[0];
    if (s?.err) return { label, state: 'failed', error: 'transaction failed' };
    if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') return { label, state: 'paid', signature };
  }
  return { label, state: 'pending', signature };
}

const shortKey = (k) => `${k.slice(0, 4)}…${k.slice(-4)}`;
const suffix = (n) => n.toString(36);

export async function settleRound(env, house, { game, token, round, now = Date.now() }) {
  const g = GAME_KEY[game], t = TOKEN_KEY[token];
  if (!g || !t) throw new Error('unknown table');
  if (!Number.isSafeInteger(round) || round < 0) throw new Error('bad round');
  const wait = startOf(round) + SETTLE_AFTER_MS - now;
  if (wait > 0) return { ok: false, early: true, retryMs: wait };
  const { decimals, program } = await loadMint(env, t);
  const houseAta = await loadHouseAta(env, house, t);
  const mint = TOKENS[t].mint;
  const secret = await roundSecret(env, g, t, round);
  const commit = hex(await sha256(secret));
  const since = Math.floor(startOf(round) / 1000) - 60;
  const deposits = await fetchDeposits(env, houseAta, since);
  const { bets, capped, rest } = classify({ deposits, game: g, token: t, round, decimals });
  const seed = await seedOf(secret, round, bets.map((b) => b.sig));
  let houseBalance;
  if (g === 'c') {
    const bal = await call(env, 'getTokenAccountBalance', [houseAta, { commitment: 'confirmed' }]);
    houseBalance = BigInt(bal.value.amount);
  }
  const played = playRound(g, bets, seed, { houseBalance });
  const pays = [...played.pays, ...capped.map((bet) => ({ bet, amount: bet.amount, kind: 'refund' }))];
  const items = pays.map((p) => ({ to: p.bet.source, amount: p.amount, kind: p.kind, from: p.bet.from, sig: p.bet.sig }));
  const batches = [];
  const key = `${g}${t}${suffix(round)}`;
  for (let i = 0; i < items.length; i += BATCH) {
    const k = i / BATCH;
    batches.push(await sendBatch(env, house, `${key}.${k}`, mint, program, decimals, houseAta, items.slice(i, i + BATCH), `gali1pay|${g}|${t}|${round}|${k}`));
  }
  const odd = [];
  for (const { d, why } of rest) {
    const r = await sendBatch(env, house, `r${t}${d.sig.slice(0, 28)}`, mint, program, decimals, houseAta, [{ to: d.source, amount: d.amount }], `gali1refund|${d.sig.slice(0, 40)}`);
    odd.push({ from: shortKey(d.from), amount: fmt(d.amount, decimals), why, state: r.state });
  }
  const states = batches.map((b) => b.state);
  const status = !bets.length && !capped.length ? 'none' : states.every((s) => s === 'paid') ? (played.outcome.void ? 'void' : 'paid') : states.includes('failed') ? 'failed' : 'pending';
  return {
    ok: true, game, token, round, status, commit, secret: hex(secret), seed: hex(seed),
    startsAt: startOf(round), decimals,
    outcome: played.outcome,
    bets: bets.map((b) => ({ who: b.from, short: shortKey(b.from), sig: b.sig, amount: fmt(b.amount, decimals), choice: b.choice })),
    pays: items.map((p) => ({ who: p.from, short: shortKey(p.from), amount: fmt(p.amount, decimals), kind: p.kind, sig: p.sig })),
    refunds: odd,
    batches,
    feeBps: Number(FEE_BPS),
  };
}

// ---------- HTTP ----------
export async function configFor(env, house) {
  const tokens = {};
  for (const [t, info] of Object.entries(TOKENS)) {
    try {
      const m = await loadMint(env, t);
      const ata = await loadHouseAta(env, house, t);
      tokens[info.id] = { ready: true, mint: info.mint, decimals: m.decimals, program: m.program, houseAta: ata, chips: info.chips, capUnits: String(unitsOf(info.chips[2], m.decimals) * CAP_MULT) };
    } catch (e) {
      tokens[info.id] = { ready: false, mint: info.mint, chips: info.chips, reason: String(e.message).slice(0, 120) };
    }
  }
  return { ok: true, house: house.owner, tokens, roundMs: ROUND_MS, betMs: BET_MS, settleAfterMs: SETTLE_AFTER_MS, feeBps: Number(FEE_BPS), serverNow: Date.now() };
}

export default async function games(req, ctx) {
  if (req.method !== 'POST') return fail(405, 'POST required');
  if (!/^application\/json/i.test(req.headers.get('content-type') || '')) return fail(415, 'JSON required');
  let body;
  try {
    const text = await req.text();
    if (text.length > 2048) return fail(413, 'too large');
    body = JSON.parse(text);
  } catch { return fail(400, 'bad json'); }
  const env = ctx?.env ?? {};
  let house;
  try { house = await loadHouse(env); } catch (e) { return fail(503, 'The arcade is not set up yet'); }
  try {
    if (body.action === 'config') return reply(200, await configFor(env, house));
    if (body.action === 'selftest') {
      const msg = enc.encode('gali');
      const sig = await house.sign(msg);
      const ok = await crypto.subtle.verify('Ed25519', house.pubKey, sig, msg);
      return reply(200, { ok, house: house.owner });
    }
    if (body.action === 'commit' || body.action === 'settle') {
      const game = body.game, token = body.token, round = body.round;
      const g = GAME_KEY[game], t = TOKEN_KEY[token];
      if (!g || !t || !Number.isSafeInteger(round)) return fail(400, 'bad table');
      const now = Date.now();
      if (body.action === 'commit') {
        if (round < roundAt(now) - 1 || round > roundAt(now) + 2) return fail(400, 'round out of range');
        const secret = await roundSecret(env, g, t, round);
        return reply(200, { ok: true, round, commit: hex(await sha256(secret)), startsAt: startOf(round), closesAt: startOf(round) + BET_MS, serverNow: now });
      }
      if (round > roundAt(now)) return fail(400, 'round has not started');
      const result = await settleRound(env, house, { game, token, round, now });
      return reply(200, { ...result, serverNow: now });
    }
    return fail(400, 'unknown action');
  } catch (e) {
    return fail(502, String(e?.message ?? 'failed').replace(/api-key=[^&\s]+/gi, '').slice(0, 200));
  }
}
