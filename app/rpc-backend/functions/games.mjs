// Gali arcade house: Tunnel Collapse, Gold Rush Pot and Crash Cart with real ORE and SKR.
//
// Rounds are 40 s slots of the server clock. A player's bet is an SPL transfer to the house's associated token
// account carrying a memo "gali1|<game>|<token>|<round>|<choice>". The chain holds the stakes; the ledger in
// Supabase (supabase/sql/arcade-ledger.sql) holds each round's result and every payout, written once. The first
// settle call after the betting window is finalized works the result out and records it; every later call reads it
// back, so the result can never change between calls. Each payout is signed once and only resent with the same
// bytes, so it can never be paid twice.
//
// Fairness: before a round opens the server publishes commit = SHA256(secret) with secret = HMAC(master, table|round).
// The round's seed is SHA256(secret | round | every valid bet signature, sorted). The secret is revealed with the
// result, so anyone can recompute the seed and the outcome. Whoever holds GAMES_MASTER knows every secret in
// advance, so the operator must never play.

export const ROUND_MS = 40_000;
export const BET_MS = 30_000; // stakes must land on chain before this point of the round
export const SETTLE_AFTER_MS = 52_000; // the round settles once its betting window is finalized, about this long after it starts
export const MAX_SETTLE_AGE_MS = 30 * 60_000; // a round nobody settled within 30 minutes needs a manual refund
const LATE_SHIFT_MS = 10_000; // a late deposit is refunded by the round 10 s after it landed
const MAX_SCAN_PAGES = 20; // 20,000 signatures back; beyond that settle refuses rather than miss a stake
const CONFIRM_POLL_MS = 1000;
const SEND_BUDGET_MS = 10_000;
const LATE_SCAN_MS = 10 * 60_000; // admin: stakes this recent may not be in the ledger yet
const FEE_BPS = 500n; // 5% of the redistributed pot (Crash Cart: 5% built into the multiplier)
const CAP_MULT = 5n; // one wallet may stake at most 5 x the top chip per round
const BATCH = 5; // payouts per transaction

const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
// Platform revenue: Tunnel Collapse and Gold Rush Pot fees are sent here as each round settles. Override with REVENUE_WALLET.
export const REVENUE_DEFAULT = 'HDa2MTDdZXnrjTs6RRUUzEqCcrWMWu1fM673Cg7pzQMw';
const ADMIN_SESSION_MS = 12 * 3600_000; // an admin sign-in lasts 12 hours
const ADMIN_SIG_MS = 5 * 60_000; // a signed admin request is good for 5 minutes
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

// ---------- program addresses (associated token accounts) ----------
const ED_P = 2n ** 255n - 19n;
const modp = (a) => ((a % ED_P) + ED_P) % ED_P;
function powmod(b, e) { let r = 1n; b = modp(b); while (e > 0n) { if (e & 1n) r = (r * b) % ED_P; b = (b * b) % ED_P; e >>= 1n; } return r; }
const ED_D = modp(-121665n * powmod(121666n, ED_P - 2n));
/** true when 32 bytes decode to a point on ed25519 (a PDA must not) */
export function onCurve(bytes) {
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(i === 31 ? bytes[i] & 0x7f : bytes[i]);
  if (y >= ED_P) return false;
  const y2 = (y * y) % ED_P;
  const u = modp(y2 - 1n), v = modp(ED_D * y2 + 1n);
  const w = (u * powmod(v, ED_P - 2n)) % ED_P;
  return w === 0n || powmod(w, (ED_P - 1n) / 2n) === 1n;
}
export async function findPda(seeds, programId) {
  for (let bump = 255; bump >= 0; bump--) {
    const h = await sha256(concat(...seeds, Uint8Array.from([bump]), b58dec(programId), enc.encode('ProgramDerivedAddress')));
    if (!onCurve(h)) return b58enc(h);
  }
  throw new Error('no program address');
}
export const ataOf = (owner, mint, tokenProgram) => findPda([b58dec(owner), b58dec(tokenProgram), b58dec(mint)], ATA_PROGRAM);
const createAtaIdem = (payer, ata, owner, mint, tokenProgram) => ({
  program: ATA_PROGRAM,
  keys: [{ pubkey: payer, signer: true, writable: true }, { pubkey: ata, writable: true }, { pubkey: owner }, { pubkey: mint }, { pubkey: SYSTEM_PROGRAM }, { pubkey: tokenProgram }],
  data: Uint8Array.from([1]),
});
const revenueOf = (env) => (typeof env?.REVENUE_WALLET === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(env.REVENUE_WALLET) ? env.REVENUE_WALLET : REVENUE_DEFAULT);

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

// ---------- ledger (Supabase) ----------
// Every round result and every transfer the house makes is recorded once in Supabase (supabase/sql/arcade-ledger.sql).
// The first settle call stores the result; every later call reads it, so a round cannot be settled twice with
// different bets. A transfer is signed once, its signature stored before it is sent, and resent with the same bytes
// until it lands or its blockhash expires, so it is never paid twice and needs no rent-funded marker account.
export function ledgerOf(env) {
  if (env?.__ledger) return env.__ledger; // tests
  const url = typeof env?.SUPABASE_URL === 'string' ? env.SUPABASE_URL.replace(/\/$/, '') : '';
  const key = env?.SUPABASE_SERVICE_KEY;
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) || typeof key !== 'string' || key.length < 20) throw new Error('arcade ledger not configured');
  const headers = { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  async function rest(path, init = {}) {
    const res = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
    if (!res.ok) throw new Error('ledger unavailable');
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  const rpc = (fn, args) => rest(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
  const q = encodeURIComponent;
  return {
    async getRound(key) { return (await rest(`arcade_rounds?key=eq.${q(key)}&select=result`))?.[0]?.result ?? null; },
    storeRound: (a) => rpc('arcade_store', { p_key: a.key, p_token: a.token, p_round: a.round, p_result: a.result, p_sends: a.sends, p_need: String(a.need), p_balance: String(a.balance) }),
    addSend: (a) => rpc('arcade_add_send', { p_label: a.label, p_token: a.token, p_items: a.items, p_pre: a.pre ?? [], p_memo: a.memo, p_need: String(a.need ?? 0n), p_balance: String(a.balance ?? 0n) }),
    async getSend(label) { return (await rest(`arcade_sends?label=eq.${q(label)}&select=*`))?.[0] ?? null; },
    async lease(label, secs) { return (await rpc('arcade_lease', { p_label: label, p_secs: secs }))?.[0] ?? null; },
    async update(label, patch) { await rest(`arcade_sends?label=eq.${q(label)}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }) }); },
    async owed(token) { const v = await rpc('arcade_owed', { p_token: token }); return BigInt(String(v ?? 0).split('.')[0]); },
  };
}

// ---------- tables ----------
const mintInfo = new Map();
// Token-2022 extensions that would let a mint take fees, run code on transfer, move the house's tokens or freeze them.
const BAD_EXTENSIONS = new Set([1, 9, 12, 14, 26]); // TransferFeeConfig, NonTransferable, PermanentDelegate, TransferHook, Pausable
export function mintProblem(owner, data) {
  if (owner === TOKEN_PROGRAM) return data.length >= 82 ? null : 'bad mint';
  if (owner !== TOKEN_2022) return 'unsupported token program';
  for (let o = 166; o + 4 <= data.length;) {
    const type = data[o] | (data[o + 1] << 8), len = data[o + 2] | (data[o + 3] << 8);
    if (type === 0) break;
    if (BAD_EXTENSIONS.has(type)) return 'unsupported token extension';
    o += 4 + len;
  }
  return null;
}
async function loadMint(env, t) {
  const cached = mintInfo.get(t);
  if (cached) return cached;
  const acc = await call(env, 'getAccountInfo', [TOKENS[t].mint, { encoding: 'base64', commitment: 'confirmed' }]);
  if (!acc?.value) throw new Error(`${TOKENS[t].id} mint not found`);
  const data = Uint8Array.from(atob(acc.value.data[0]), (c) => c.charCodeAt(0));
  const problem = mintProblem(acc.value.owner, data);
  if (problem) throw new Error(problem);
  const info = { program: acc.value.owner, decimals: data[44] };
  mintInfo.set(t, info);
  return info;
}
const houseAtaCache = new Map();
async function loadHouseAta(env, house, t) {
  const cached = houseAtaCache.get(t);
  if (cached) return cached;
  const { program } = await loadMint(env, t);
  // Only the house's own associated account counts, never any other account it may own.
  const ata = await ataOf(house.owner, TOKENS[t].mint, program);
  const acc = await call(env, 'getAccountInfo', [ata, { encoding: 'base64', commitment: 'confirmed' }]);
  if (!acc?.value) throw new Error(`The ${TOKENS[t].id} table is not funded yet`);
  houseAtaCache.set(t, ata);
  return ata;
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

// ---------- reading stakes from chain ----------
export function parseMemo(memo) {
  const m = /^gali1\|([tpc])\|([os])\|(\d{1,9})\|(\d{1,4})$/.exec(memo ?? '');
  return m ? { g: m[1], t: m[2], round: Number(m[3]), choice: Number(m[4]) } : null;
}
/** The gali1 stake memo inside an RPC signature-list memo field ("[24] gali1|t|o|123|2", several joined by "; "). */
export function memoFromList(field) {
  if (typeof field !== 'string') return null;
  for (const part of field.split('; ')) {
    const text = part.replace(/^\[\d+\]\s*/, '');
    if (parseMemo(text)) return text;
  }
  return null;
}
/**
 * The one round that settles a deposit. A stake with valid timing belongs to the round its memo names. Anything
 * else (late, far too early) is refunded by the round in which it landed, counted 10 s late so a deposit landing at
 * the very end of a round is settled by the next one, after it is surely visible.
 */
export function ownerOf(memo, blockTimeSec) {
  const ms = blockTimeSec * 1000;
  if (memo && ms >= startOf(memo.round) - 60_000 && ms < startOf(memo.round) + BET_MS) return memo.round;
  return roundAt(ms + LATE_SHIFT_MS);
}
const txCache = new Map(); // signature -> parsed deposit or null (only finalized, successful transactions)
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
/**
 * Every finalized stake that this table's round owns. Only transactions whose memo names this table are fetched,
 * so unrelated traffic costs one list read per 1,000 signatures. Throws when the scan cannot reach the start of the
 * round, rather than settle on a partial list.
 */
async function fetchOwned(env, houseAta, g, t, round) {
  const since = Math.floor(startOf(round) / 1000) - 60;
  const wanted = [];
  let before;
  let reached = false;
  for (let page = 0; page < MAX_SCAN_PAGES; page++) {
    const sigs = await call(env, 'getSignaturesForAddress', [houseAta, { limit: 1000, commitment: 'finalized', ...(before ? { before } : {}) }], 8000);
    if (!Array.isArray(sigs)) throw new Error('RPC unavailable');
    for (const s of sigs) {
      if (s.err || (s.blockTime ?? 0) < since) continue;
      if (s.memo === undefined) { wanted.push(s.signature); continue; } // provider gave no memo field: read the transaction
      const memo = parseMemo(memoFromList(s.memo));
      if (!memo || memo.g !== g || memo.t !== t) continue; // only this table's stakes are ever played or refunded
      if (ownerOf(memo, s.blockTime) === round) wanted.push(s.signature);
    }
    if (!sigs.length || sigs.length < 1000 || (sigs[sigs.length - 1].blockTime ?? 0) < since) { reached = true; break; }
    before = sigs[sigs.length - 1].signature;
  }
  if (!reached) throw Object.assign(new Error('The arcade is busy. Try again in a minute.'), { busy: true });
  const out = [];
  const keep = (d) => { const m = d && parseMemo(d.memo); if (m && m.g === g && m.t === t && ownerOf(m, d.blockTime) === round) out.push(d); };
  const todo = wanted.filter((s) => { if (txCache.has(s)) { keep(txCache.get(s)); return false; } return true; });
  for (let i = 0; i < todo.length; i += 8) {
    await Promise.all(todo.slice(i, i + 8).map(async (s) => {
      const tx = await call(env, 'getTransaction', [s, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'finalized' }]);
      if (!tx) throw new Error('RPC unavailable'); // listed as finalized but not readable: do not settle without it
      const d = parseDeposit(tx, houseAta);
      if (txCache.size > 4000) txCache.clear();
      txCache.set(s, d);
      keep(d);
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
  if (ctx?.refundAll) return refundAll(ctx.refundAll);
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
  for (const bet of bets) {
    const t100 = BigInt(bet.choice) * 10n;
    if (t100 <= m100) pays.push({ bet, amount: (bet.amount * t100) / 100n, kind: 'win' });
  }
  return { outcome: { crash: Number(m100) / 100 }, pays };
}

// ---------- validating stakes ----------
export function validChoice(game, choice) {
  if (game === 't') return choice >= 0 && choice <= 4;
  if (game === 'p') return choice === 0;
  return choice >= 12 && choice <= 100;
}
/** deposits: this table's deposits owned by this round (see ownerOf). Dust below the smallest chip is ignored. */
export function classify({ deposits, game, token, round, decimals }) {
  const g = game, t = token;
  const chips = TOKENS[t].chips.map((c) => unitsOf(c, decimals));
  const chipSet = new Set(chips);
  const cap = chips[2] * CAP_MULT;
  const start = startOf(round) / 1000;
  const mine = [];
  const rest = []; // refunded one by one: late, wrong size, wrong choice
  for (const d of deposits) {
    const m = parseMemo(d.memo);
    if (!m || m.g !== g || m.t !== t) continue;
    if (d.amount < chips[0]) continue; // dust: never worth a refund transaction
    if (d.mint && d.mint !== TOKENS[t].mint) { rest.push({ d, why: 'wrong token' }); continue; }
    if (m.round !== round) { rest.push({ d, why: m.round > round ? 'too early' : 'landed after betting closed' }); continue; }
    if (d.blockTime < start - 60) { rest.push({ d, why: 'too early' }); continue; }
    if (d.blockTime >= start + BET_MS / 1000) { rest.push({ d, why: 'landed after betting closed' }); continue; }
    if (!validChoice(g, m.choice) || !chipSet.has(d.amount)) { rest.push({ d, why: 'not a valid bet' }); continue; }
    mine.push({ ...d, choice: m.choice });
  }
  mine.sort((a, b) => a.blockTime - b.blockTime || (a.sig < b.sig ? -1 : 1));
  rest.sort((a, b) => (a.d.sig < b.d.sig ? -1 : 1));
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

// ---------- transfers ----------
const LEASE_SECS = 25;
/**
 * Sends one recorded transfer at most once. The signed bytes and signature are stored before the first send; a
 * later call resends the same bytes while the blockhash is valid, and signs afresh only once the old one has expired
 * without landing. A batch the chain refuses (one bad recipient) is split into single transfers so the others still pay.
 */
export async function sendRecorded(env, house, ledger, label, depth = 0) {
  let row = await ledger.lease(label, LEASE_SECS);
  if (!row) {
    const cur = await ledger.getSend(label);
    if (!cur) return { label, state: 'failed', error: 'unknown transfer' };
    if (cur.state === 'split' && depth === 0) return sendChildren(env, house, ledger, cur);
    return { label, state: cur.state === 'paid' ? 'paid' : 'pending', signature: cur.sig ?? undefined };
  }
  try {
    if (row.sig) {
      const st = (await call(env, 'getSignatureStatuses', [[row.sig], { searchTransactionHistory: true }]))?.value?.[0];
      if (st && !st.err && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) {
        await ledger.update(label, { state: 'paid', error: null });
        return { label, state: 'paid', signature: row.sig };
      }
      if (st && st.err) {
        await ledger.update(label, { state: 'failed', tx: null, sig: null, last_valid: null, error: 'transaction failed on chain', attempts: row.attempts + 1 });
        row = { ...row, tx: null, sig: null };
      } else {
        const height = await call(env, 'getBlockHeight', [{ commitment: 'confirmed' }]);
        if (Number(height) <= Number(row.last_valid)) {
          await call(env, 'sendTransaction', [row.tx, { encoding: 'base64', skipPreflight: true, maxRetries: 2 }]).catch(() => null);
          return await confirm(env, ledger, label, row.sig);
        }
        // expired: it can never land now, but make sure it did not land before
        const landed = await call(env, 'getTransaction', [row.sig, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
        if (landed && !landed.meta?.err) {
          await ledger.update(label, { state: 'paid', error: null });
          return { label, state: 'paid', signature: row.sig };
        }
        await ledger.update(label, { tx: null, sig: null, last_valid: null });
        row = { ...row, tx: null, sig: null };
      }
    }
    const { program, decimals } = await loadMint(env, row.token);
    const houseAta = await loadHouseAta(env, house, row.token);
    const ixs = [
      ...(row.pre ?? []).map((p) => createAtaIdem(house.owner, p.ata, p.owner, TOKENS[row.token].mint, program)),
      ...row.items.map((it) => transferChecked(program, houseAta, TOKENS[row.token].mint, it.to, house.owner, BigInt(it.amount), decimals)),
      memoIx(row.memo),
    ];
    const bh = await call(env, 'getLatestBlockhash', [{ commitment: 'confirmed' }]);
    const { raw, signature } = await signTransaction(house, bh.value.blockhash, ixs);
    const tx = b64(raw);
    await ledger.update(label, { state: 'sending', tx, sig: signature, last_valid: bh.value.lastValidBlockHeight, error: null });
    try {
      await call(env, 'sendTransaction', [tx, { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 }]);
    } catch (e) {
      if (!e?.rpc) return { label, state: 'pending', signature }; // network trouble: the stored signature is checked next time
      // the node refused it in simulation, so it was never sent
      const error = String(e.message).replace(/api-key=[^&\s]+/gi, '').slice(0, 160);
      const blockhashOnly = /blockhash/i.test(error);
      await ledger.update(label, { state: 'failed', tx: null, sig: null, last_valid: null, error, attempts: row.attempts + 1 });
      if (!blockhashOnly && row.items.length > 1 && depth === 0) {
        for (const [i, it] of row.items.entries()) {
          await ledger.addSend({ label: `${label}.${i}`, token: row.token, items: [it], pre: i === 0 ? row.pre : [], memo: `${row.memo}|${i}` });
        }
        await ledger.update(label, { state: 'split', error });
        return sendChildren(env, house, ledger, { ...row, state: 'split' });
      }
      return { label, state: 'failed', error };
    }
    return await confirm(env, ledger, label, signature);
  } finally {
    await ledger.update(label, { lease_until: null }).catch(() => null);
  }
}
async function confirm(env, ledger, label, signature) {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, env?.__pollMs ?? CONFIRM_POLL_MS));
    const s = (await call(env, 'getSignatureStatuses', [[signature]]).catch(() => null))?.value?.[0];
    if (s?.err) return { label, state: 'pending', signature }; // recorded; the next call clears it and retries
    if (s?.confirmationStatus === 'confirmed' || s?.confirmationStatus === 'finalized') {
      await ledger.update(label, { state: 'paid', error: null });
      return { label, state: 'paid', signature };
    }
  }
  return { label, state: 'pending', signature };
}
async function sendChildren(env, house, ledger, parent) {
  const states = [];
  for (let i = 0; i < parent.items.length; i++) states.push(await sendRecorded(env, house, ledger, `${parent.label}.${i}`, 1));
  const all = states.map((s) => s.state);
  return { label: parent.label, state: all.every((s) => s === 'paid') ? 'paid' : all.includes('pending') ? 'pending' : 'failed', parts: states };
}

const shortKey = (k) => `${k.slice(0, 4)}…${k.slice(-4)}`;
const suffix = (n) => n.toString(36);
const roundKey = (g, t, round) => `${g}${t}${suffix(round)}`;

/** Works out a round's result from finalized chain data and records it, or returns the result already recorded. */
async function recordRound(env, house, ledger, { g, t, round, now }) {
  const key = roundKey(g, t, round);
  const stored = await ledger.getRound(key);
  if (stored) return stored;
  if (now - startOf(round) > MAX_SETTLE_AGE_MS) throw Object.assign(new Error('This round is too old to settle. Ask support for a refund.'), { status: 410 });
  // Settle only from finalized data that covers the whole betting window.
  const fslot = await call(env, 'getSlot', [{ commitment: 'finalized' }]);
  const ftime = await call(env, 'getBlockTime', [fslot]);
  const close = (startOf(round) + BET_MS) / 1000;
  if (!(Number(ftime) >= close + 1)) return { early: true, retryMs: 3000 };
  const { decimals, program } = await loadMint(env, t);
  const houseAta = await loadHouseAta(env, house, t);
  const mint = TOKENS[t].mint;
  const secret = await roundSecret(env, g, t, round);
  const commit = hex(await sha256(secret));
  const deposits = await fetchOwned(env, houseAta, g, t, round);
  const { bets, capped, rest } = classify({ deposits, game: g, token: t, round, decimals });
  const seed = await seedOf(secret, round, bets.map((b) => b.sig));
  const balance = g === 'c' ? BigInt((await call(env, 'getTokenAccountBalance', [houseAta, { commitment: 'confirmed' }])).value.amount) : 0n;
  const build = (played) => {
    const pays = [
      ...played.pays,
      ...capped.map((bet) => ({ bet, amount: bet.amount, kind: 'refund' })),
      ...rest.map(({ d, why }) => ({ bet: d, amount: d.amount, kind: 'refund', why })),
    ];
    const items = pays.map((p) => ({ to: p.bet.source, amount: p.amount, kind: p.kind, from: p.bet.from, sig: p.bet.sig, why: p.why }));
    const sends = [];
    for (let i = 0; i < items.length; i += BATCH) {
      const k = i / BATCH;
      sends.push({ label: `${key}.${k}`, items: items.slice(i, i + BATCH).map((it) => ({ to: it.to, amount: String(it.amount) })), memo: `gali1pay|${g}|${t}|${round}|${k}` });
    }
    const fee = played.outcome?.fee && !played.outcome.void ? BigInt(played.outcome.fee) : 0n;
    return { pays, items, sends, fee, outcome: played.outcome };
  };
  let plan = build(playRound(g, bets, seed));
  const result = async (p) => {
    const sends = [...p.sends];
    if (p.fee > 0n) {
      const rev = revenueOf(env);
      const revAta = await ataOf(rev, mint, program);
      sends.push({ label: `${key}.f`, items: [{ to: revAta, amount: String(p.fee) }], pre: [{ ata: revAta, owner: rev }], memo: `gali1fee|${g}|${t}|${round}` });
    }
    return {
      sends,
      result: {
        game: GAMES[g], token: TOKENS[t].id, round, commit, secret: hex(secret), seed: hex(seed), startsAt: startOf(round), decimals,
        outcome: p.outcome,
        bets: bets.map((b) => ({ who: b.from, short: shortKey(b.from), sig: b.sig, amount: fmt(b.amount, decimals), choice: b.choice })),
        pays: p.items.filter((it) => !it.why).map((it) => ({ who: it.from, short: shortKey(it.from), amount: fmt(it.amount, decimals), kind: it.kind, sig: it.sig })),
        refunds: p.items.filter((it) => it.why).map((it) => ({ who: it.from, from: shortKey(it.from), amount: fmt(it.amount, decimals), why: it.why, sig: it.sig })),
        labels: sends.map((s) => s.label),
        feeBps: Number(FEE_BPS),
      },
    };
  };
  // Crash Cart pays from the bankroll: the house must hold the winnings on top of everything it already owes.
  const need = g === 'c' ? plan.pays.filter((p) => p.kind === 'win').reduce((n, p) => n + p.amount, 0n) : 0n;
  let r = await result(plan);
  let saved = await ledger.storeRound({ key, token: t, round, result: r.result, sends: r.sends, need, balance });
  if (saved === null) {
    plan = build(playRound(g, bets, seed, { refundAll: 'the house bankroll is too low for this round' }));
    r = await result(plan);
    saved = await ledger.storeRound({ key, token: t, round, result: r.result, sends: r.sends, need: 0n, balance });
  }
  return saved;
}

export async function settleRound(env, house, { game, token, round, now = Date.now() }) {
  const g = GAME_KEY[game], t = TOKEN_KEY[token];
  if (!g || !t) throw new Error('unknown table');
  if (!Number.isSafeInteger(round) || round < 0) throw new Error('bad round');
  const wait = startOf(round) + SETTLE_AFTER_MS - now;
  if (wait > 0) return { ok: false, early: true, retryMs: wait };
  const ledger = ledgerOf(env);
  const rec = await recordRound(env, house, ledger, { g, t, round, now });
  if (rec.early) return { ok: false, early: true, retryMs: rec.retryMs };
  // keep inside the function's 20 s limit: whatever is left is picked up by the next settle call
  const began = Date.now();
  const batches = [];
  for (const label of rec.labels) batches.push(Date.now() - began > SEND_BUDGET_MS ? { label, state: 'pending' } : await sendRecorded(env, house, ledger, label));
  const states = batches.map((b) => b.state);
  const hasStakes = rec.bets.length || rec.refunds.length || rec.pays.length;
  const status = !hasStakes ? 'none' : states.every((s) => s === 'paid') ? (rec.outcome.void ? 'void' : 'paid') : states.includes('pending') ? 'pending' : 'failed';
  return { ok: true, ...rec, status, batches };
}

// ---------- admin ----------
async function verifySig(wallet, text, sigB58) {
  const pub = b58dec(wallet), sig = b58dec(sigB58);
  if (pub.length !== 32 || sig.length !== 64) return false;
  const key = await crypto.subtle.importKey('raw', pub, 'Ed25519', false, ['verify']);
  return crypto.subtle.verify('Ed25519', key, sig, enc.encode(text));
}
const adminWallet = (env) => (typeof env?.ADMIN_WALLET === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(env.ADMIN_WALLET.trim()) ? env.ADMIN_WALLET.trim() : null);
async function sessionTag(env, wallet, exp) { return hex(await hmac(String(env.GAMES_MASTER), `admin|${wallet}|${exp}`)); }
function sameText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
/** A signed request from the admin wallet: `Gali admin <op> <args...> <ts>`, fresh within 5 minutes. */
async function checkSigned(env, body, op, args) {
  const admin = adminWallet(env);
  if (!admin) throw Object.assign(new Error('No admin wallet is set on the server yet'), { status: 403 });
  const ts = Number(body.ts);
  if (!Number.isSafeInteger(ts) || Math.abs(Date.now() - ts) > ADMIN_SIG_MS) throw Object.assign(new Error('That signature is too old. Sign again.'), { status: 401 });
  if (body.wallet !== admin) throw Object.assign(new Error('This wallet is not the Gali admin'), { status: 403 });
  const text = ['Gali admin', op, ...args, String(ts)].join(' ');
  if (!(await verifySig(admin, text, String(body.sig ?? '')))) throw Object.assign(new Error('Signature check failed'), { status: 401 });
  return { admin, ts };
}
async function checkSession(env, body) {
  const admin = adminWallet(env);
  const [wallet, expS, tag] = String(body.session ?? '').split('.');
  const exp = Number(expS);
  if (!admin || wallet !== admin || !Number.isSafeInteger(exp) || exp < Date.now() || !sameText(tag, await sessionTag(env, wallet, exp)))
    throw Object.assign(new Error('Sign in again'), { status: 401 });
  return admin;
}
async function tokenBalance(env, ata) {
  try { const b = await call(env, 'getTokenAccountBalance', [ata, { commitment: 'confirmed' }]); return BigInt(b.value.amount); } catch { return 0n; }
}
/** Stakes that landed in the last 10 minutes and may not be recorded in the ledger yet. */
async function recentStakes(env, houseAta) {
  const since = Math.floor((Date.now() - LATE_SCAN_MS) / 1000);
  const sigs = await call(env, 'getSignaturesForAddress', [houseAta, { limit: 1000, commitment: 'confirmed' }]);
  let owed = 0n;
  const todo = (sigs ?? []).filter((s) => !s.err && (s.blockTime ?? 0) >= since && memoFromList(s.memo)).map((s) => s.signature);
  for (const s of todo.slice(0, 200)) {
    const tx = await call(env, 'getTransaction', [s, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]).catch(() => null);
    const d = parseDeposit(tx, houseAta);
    if (d) owed += d.amount;
  }
  return owed;
}
/** House and revenue balances, stakes and payouts still owed, and what can be swept per token. */
async function treasury(env, house) {
  const rev = revenueOf(env);
  const ledger = ledgerOf(env);
  const [houseSol, revSol] = await Promise.all([call(env, 'getBalance', [house.owner, { commitment: 'confirmed' }]), call(env, 'getBalance', [rev, { commitment: 'confirmed' }])]);
  const tokens = {};
  for (const [t, info] of Object.entries(TOKENS)) {
    const m = await loadMint(env, t);
    let houseAta = null;
    try { houseAta = await loadHouseAta(env, house, t); } catch { /* not funded */ }
    const revAta = await ataOf(rev, info.mint, m.program);
    const houseBal = houseAta ? await tokenBalance(env, houseAta) : 0n;
    const revBal = await tokenBalance(env, revAta);
    // never sweep recent stakes or payouts the ledger has not confirmed yet
    const owed = (houseAta ? await recentStakes(env, houseAta) : 0n) + (await ledger.owed(t));
    // keep at least one maximum Crash Cart win (5 x top chip x 10) in the bankroll
    const floorMin = unitsOf(info.chips[2], m.decimals) * CAP_MULT * 10n;
    tokens[info.id] = { decimals: m.decimals, houseAta, revenueAta: revAta, house: String(houseBal), revenue: String(revBal), owed: String(owed), floorMin: String(floorMin) };
  }
  return { house: house.owner, revenue: rev, houseSol: houseSol.value, revenueSol: revSol.value, tokens, feeBps: Number(FEE_BPS) };
}
async function sweep(env, house, token, floorUi, ts) {
  const t = TOKEN_KEY[token];
  if (!t) throw new Error('unknown token');
  const info = TOKENS[t];
  const m = await loadMint(env, t);
  const ledger = ledgerOf(env);
  const tr = await treasury(env, house);
  const row = tr.tokens[info.id];
  if (!row.houseAta) throw new Error(`The ${info.id} table is not funded yet`);
  let floor;
  try { floor = unitsOf(String(floorUi), m.decimals); } catch { throw new Error('bad floor'); }
  if (floor < BigInt(row.floorMin)) throw new Error(`The floor must be at least ${fmt(BigInt(row.floorMin), m.decimals)} ${info.id.toUpperCase()}`);
  const amount = BigInt(row.house) - BigInt(row.owed) - floor;
  if (amount <= 0n) throw new Error('Nothing above the floor to sweep');
  const label = `sw${t}${suffix(Math.floor(ts / 1000))}`;
  const ok = await ledger.addSend({ label, token: t, items: [{ to: row.revenueAta, amount: String(amount) }], pre: [{ ata: row.revenueAta, owner: tr.revenue }], memo: `gali1sweep|${t}|${ts}`, need: amount + floor, balance: BigInt(row.house) });
  if (!ok) throw new Error('Nothing above the floor to sweep');
  const r = await sendRecorded(env, house, ledger, label);
  return { ...r, amount: fmt(amount, m.decimals), token: info.id };
}

// ---------- HTTP ----------
export async function configFor(env, house) {
  const tokens = {};
  for (const [t, info] of Object.entries(TOKENS)) {
    try {
      ledgerOf(env); // no stakes are taken until results and payouts can be recorded
      const m = await loadMint(env, t);
      const ata = await loadHouseAta(env, house, t);
      tokens[info.id] = { ready: true, mint: info.mint, decimals: m.decimals, program: m.program, houseAta: ata, chips: info.chips, capUnits: String(unitsOf(info.chips[2], m.decimals) * CAP_MULT) };
    } catch (e) {
      tokens[info.id] = { ready: false, mint: info.mint, chips: info.chips, reason: String(e.message).slice(0, 120) };
    }
  }
  return { ok: true, house: house.owner, tokens, roundMs: ROUND_MS, betMs: BET_MS, settleAfterMs: SETTLE_AFTER_MS, feeBps: Number(FEE_BPS), serverNow: Date.now() };
}

// Browsers may call the house only from these sites (deployed with --cors passthrough, so this function answers
// preflight itself). The Android app sends no Origin and is unaffected. ALLOWED_ORIGINS (comma separated) overrides.
const ORIGINS_DEFAULT = ['https://galiisland.bounded.page', 'https://galiadmin.bounded.page', 'https://gali.fun', 'https://www.gali.fun', 'http://localhost:8081'];
function originsOf(env) {
  const raw = typeof env?.ALLOWED_ORIGINS === 'string' ? env.ALLOWED_ORIGINS : '';
  const list = raw.split(',').map((x) => x.trim().replace(/\/$/, '')).filter((x) => /^https?:\/\/[^\s/]+$/.test(x));
  return list.length ? list : ORIGINS_DEFAULT;
}
function corsHeaders(req, env) {
  const origin = req.headers.get('origin');
  if (!origin || !originsOf(env).includes(origin)) return {};
  return { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600', vary: 'Origin' };
}
export default async function games(req, ctx) {
  const cors = corsHeaders(req, ctx?.env ?? {});
  if (req.method === 'OPTIONS') return new Response(null, { status: cors['access-control-allow-origin'] ? 204 : 403, headers: cors });
  const res = await handle(req, ctx);
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  return res;
}

async function handle(req, ctx) {
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
    if (body.action === 'admin-login') {
      const { admin } = await checkSigned(env, body, 'login', []);
      const exp = Date.now() + ADMIN_SESSION_MS;
      return reply(200, { ok: true, session: `${admin}.${exp}.${await sessionTag(env, admin, exp)}`, expires: exp });
    }
    if (body.action === 'admin-treasury') {
      await checkSession(env, body);
      return reply(200, { ok: true, ...(await treasury(env, house)) });
    }
    if (body.action === 'admin-sweep') {
      // moving money needs a fresh wallet signature, not only the session
      const { ts } = await checkSigned(env, body, 'sweep', [String(body.token), String(body.floor)]);
      return reply(200, { ok: true, ...(await sweep(env, house, String(body.token), String(body.floor), ts)) });
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
    if (e?.status === 401 || e?.status === 403 || e?.status === 410) return fail(e.status, e.message);
    if (e?.busy) return fail(503, e.message);
    return fail(502, String(e?.message ?? 'failed').replace(/api-key=[^&\s]+/gi, '').slice(0, 200));
  }
}
