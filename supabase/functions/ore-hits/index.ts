// Records Gali miners' big moments on ORE's board: solo wins (the whole round's ORE to one wallet) and motherlode
// hits (ORE's 1-in-~500 jackpot, split by SOL on the gold spot). pg_cron calls this every minute.
//
// ORE closes a round account about a day after it ends, so this keeps Gali's own record in public.ore_hits.
// Each run reads every round finished since the last run, newest first in batches of 100 (getMultipleAccounts).
// The first run reaches back as far as ORE still keeps rounds (about a day).
//
// Solo: Round.top_miner is the winner unless it is ORE's split address. Recorded when it is a Gali wallet.
// Motherlode: Round.motherlode > 0. The winners are whoever had SOL on the gold spot; that is read from each Gali
// miner's ORE Miner account while it still points at that round (it moves on at the miner's next deploy), so a
// motherlode is caught when this runs within a round or two of it. Autopilot and play also report each miner's
// motherlode via gali_score_round (just before their next deploy), and this job fills in the ORE for those rows.
//
// Layout offsets mirror app/src/chain/ore/accounts.ts (checked against mainnet by scripts/ore-probe.ts).
// Secrets: RPC_URL, CRON_SECRET (same as ore-rate). SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY come with Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { ed25519 } from 'npm:@noble/curves@2.4.0/ed25519.js';
import bs58 from 'npm:bs58@6';

const ORE_PROGRAM = 'oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv';
const BOARD = 'BrcSxdp1nXFzou1YyDnQJcPNBNHgoypZmTsyKBSLLXzi';
const SPLIT = 'SpLiT11111111111111111111111111111111111112';
const DEFAULT_KEY = '11111111111111111111111111111111';
const ROUND_SIZE = 8 + 944, MINER_SIZE = 8 + 744, BOARD_SIZE = 8 + 32;
const ORE_UNIT = 1e11;
const SECS_PER_ROUND = 82; // only to date rounds found by the first catch-up run
const MAX_BACK = 1100, BATCH = 100, MAX_PER_RUN = 700;

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const RPC = Deno.env.get('RPC_URL') ?? '';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function rpc(method: string, params: unknown[]) {
  for (let i = 0; i < 2; i++) {
    const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    if (r.status === 429 && i === 0) { await new Promise((ok) => setTimeout(ok, 800)); continue; }
    const j = await r.json();
    if (j.error) throw new Error(`${method}: ${j.error.message}`);
    return j.result;
  }
}
const b64bytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function accounts(keys: string[]): Promise<(Uint8Array | null)[]> {
  const out: (Uint8Array | null)[] = [];
  for (let i = 0; i < keys.length; i += BATCH) {
    const r = await rpc('getMultipleAccounts', [keys.slice(i, i + BATCH), { encoding: 'base64', commitment: 'confirmed' }]);
    for (const v of r.value) out.push(v && v.owner === ORE_PROGRAM ? b64bytes(v.data[0]) : null);
  }
  return out;
}

/* ---------- PDAs (Solana's find_program_address) ---------- */
const PROGRAM = bs58.decode(ORE_PROGRAM);
const PDA_TAIL = new TextEncoder().encode('ProgramDerivedAddress');
async function pda(seeds: Uint8Array[]) {
  for (let bump = 255; bump >= 0; bump--) {
    const parts = new Uint8Array([...seeds.flatMap((s) => [...s]), bump, ...PROGRAM, ...PDA_TAIL]);
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', parts));
    try { ed25519.Point.fromBytes(h); } catch { return bs58.encode(h); } // off the curve: a valid PDA
  }
  throw new Error('no PDA');
}
const u64le = (n: bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, n, true); return b; };
const enc = new TextEncoder();
const roundPda = (id: bigint) => pda([enc.encode('round'), u64le(id)]);
const minerPda = (wallet: string) => pda([enc.encode('miner'), bs58.decode(wallet)]);
const automationPda = (wallet: string) => pda([enc.encode('automation'), bs58.decode(wallet)]);
const AUTOMATION_SIZE = 8 + 152;

/* ---------- decoders (offsets after the 8-byte discriminator) ---------- */
const dvOf = (d: Uint8Array) => new DataView(d.buffer, d.byteOffset, d.length);
const u64 = (dv: DataView, o: number) => dv.getBigUint64(8 + o, true);
const sq = (dv: DataView, o: number) => Array.from({ length: 25 }, (_, i) => u64(dv, o + i * 8));
const keyAt = (d: Uint8Array, o: number) => bs58.encode(d.slice(8 + o, 8 + o + 32));
function decodeRound(d: Uint8Array) {
  if (d.length !== ROUND_SIZE) throw new Error(`round is ${d.length} bytes, expected ${ROUND_SIZE}`);
  const dv = dvOf(d);
  return {
    id: u64(dv, 0), deployed: sq(dv, 8), count: sq(dv, 408), slotHash: d.slice(8 + 608, 8 + 640), motherlode: u64(dv, 648),
    rewards: sq(dv, 688), topMiner: keyAt(d, 912),
  };
}
function decodeMiner(d: Uint8Array) {
  if (d.length !== MINER_SIZE) throw new Error(`miner is ${d.length} bytes, expected ${MINER_SIZE}`);
  const dv = dvOf(d);
  return {
    authority: keyAt(d, 0), deployed: sq(dv, 56), roundId: u64(dv, 656),
    lifetimeOre: u64(dv, 720), lifetimeDeployed: u64(dv, 728), lifetimeSol: u64(dv, 736),
  };
}
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const ORE_MINT = 'oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp';
const MARKET_EVERY_MS = 5 * 60_000;
const pdaCache = new Map<string, string>();
async function minerKeys(wallets: string[]) {
  return Promise.all(wallets.map(async (w) => { let k = pdaCache.get(w); if (!k) { k = await minerPda(w); pdaCache.set(w, k); } return k; }));
}
/** Jupiter Price API v3 (keyless); a token without a reliable price is left out of the reply. */
async function prices() {
  const r = await fetch(`https://api.jup.ag/price/v3?ids=${SOL_MINT},${ORE_MINT}`, { headers: Deno.env.get('JUP_API_KEY') ? { 'x-api-key': Deno.env.get('JUP_API_KEY')! } : {} });
  if (!r.ok) throw new Error(`Jupiter price ${r.status}`);
  const j = await r.json();
  const sol = Number(j?.[SOL_MINT]?.usdPrice), ore = Number(j?.[ORE_MINT]?.usdPrice);
  return { sol: sol > 0 ? sol : null, ore: ore > 0 ? ore : null };
}

/** SOL ORE gives back to a miner for a round, as ORE's checkpoint does: 1% off every spot, 10% more off spots that miss. */
const squareAdmin = (t: bigint) => (t / 100n > 0n ? t / 100n : 1n);
const squareProtocol = (rest: bigint) => (rest / 10n > 0n ? rest / 10n : 1n);
function solBack(mine: bigint[], totals: bigint[], w: number) {
  let back = 0n;
  for (let i = 0; i < 25; i++) {
    const total = totals[i], m = mine[i];
    if (total === 0n || m === 0n) continue;
    const rest = total - squareAdmin(total);
    back += (m * (i === w ? rest : rest - squareProtocol(rest))) / total;
  }
  return back;
}

/** XOR of the slot hash's four u64s, as ORE does. Null before the draw, 'refund' when ORE could not draw. */
function rngOf(h: Uint8Array): bigint | null | 'refund' {
  if (h.every((b) => b === 0)) return null;
  if (h.every((b) => b === 0xff)) return 'refund';
  const dv = dvOf(h);
  let r = 0n;
  for (let i = 0; i < 4; i++) r ^= dv.getBigUint64(i * 8, true);
  return r;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return json(401, { error: 'not allowed' });
  if (!RPC) return json(500, { error: 'missing RPC_URL' });
  try {
    const [boardRaw] = await accounts([BOARD]);
    if (!boardRaw || boardRaw.length !== BOARD_SIZE) return json(502, { error: 'could not read ORE board' });
    const current = u64(dvOf(boardRaw), 0); // the live round; everything before it can be settled

    const { data: st } = await db.from('ore_hits_state').select('last_round').eq('id', 1).maybeSingle();
    const last = st?.last_round ? BigInt(st.last_round) : current - BigInt(MAX_BACK);
    let from = last + 1n;
    if (current - from > BigInt(MAX_BACK)) from = current - BigInt(MAX_BACK);
    const to = current - 1n < from + BigInt(MAX_PER_RUN) - 1n ? current - 1n : from + BigInt(MAX_PER_RUN) - 1n;
    if (to < from) return json(200, { current: String(current), checked: 0 });

    const ids: bigint[] = [];
    for (let id = from; id <= to; id++) ids.push(id);
    const raws = await accounts(await Promise.all(ids.map(roundPda)));

    const { data: miners, error: mErr } = await db.from('gali_miners').select('wallet');
    if (mErr) throw mErr;
    const gali = new Set((miners ?? []).map((m) => m.wallet));

    // every 5 minutes: ORE and SOL prices, and all Gali wallets' lifetime ORE / SOL in / SOL back
    const list = [...gali];
    let minerAccts: (Uint8Array | null)[] | null = null;
    const { data: mk } = await db.from('gali_ore_market').select('prices_at,totals_at').eq('id', 1).maybeSingle();
    const stale = (t?: string | null) => !t || Date.now() - Date.parse(t) > MARKET_EVERY_MS;
    let market: Record<string, unknown> | null = null;
    if (stale(mk?.prices_at)) {
      try { const p = await prices(); market = { ...(p.sol ? { sol_usd: p.sol } : {}), ...(p.ore ? { ore_usd: p.ore } : {}), prices_at: new Date().toISOString() }; }
      catch (e) { console.error(String((e as Error).message)); }
    }
    if (stale(mk?.totals_at) && list.length) {
      minerAccts = await accounts(await minerKeys(list));
      let ore = 0n, dep = 0n, back = 0n, n = 0;
      for (const raw of minerAccts) {
        if (!raw) continue;
        try { const m = decodeMiner(raw); ore += m.lifetimeOre; dep += m.lifetimeDeployed; back += m.lifetimeSol; n++; } catch { /* skip */ }
      }
      market = { ...(market ?? {}), miners: n, ore: Number(ore) / ORE_UNIT, deployed_sol: Number(dep) / 1e9, returned_sol: Number(back) / 1e9, totals_at: new Date().toISOString() };
    }
    if (market) { const { error } = await db.from('gali_ore_market').upsert({ id: 1, ...market }); if (error) throw error; }

    const hits: Record<string, unknown>[] = [];
    const lodes: { id: bigint; w: number; deployed: bigint[]; motherlode: bigint; at: string; approx: boolean }[] = [];
    const allLodes: Record<string, unknown>[] = [];
    let done = from - 1n; // advance only through rounds that are settled or gone
    const now = Date.now();
    for (let k = 0; k < ids.length; k++) {
      const id = ids[k], raw = raws[k];
      if (!raw) { done = id; continue; } // closed by ORE, or never played
      let r;
      try { r = decodeRound(raw); } catch (e) { return json(500, { error: String((e as Error).message) }); }
      const rng = rngOf(r.slotHash);
      if (rng === null) break; // not drawn yet: pick it up next run
      done = id;
      if (rng === 'refund') continue;
      const w = Number(rng % 25n);
      const back = Number(current - id);
      const approx = back > 3;
      const at = new Date(now - back * SECS_PER_ROUND * 1000).toISOString();
      const ore = Number(r.rewards.reduce((a, b) => a + b, 0n)) / ORE_UNIT;
      if (r.topMiner !== SPLIT && r.topMiner !== DEFAULT_KEY && gali.has(r.topMiner)) {
        hits.push({ round_id: String(id), kind: 'solo', wallet: r.topMiner, square: w, ore, share: 1, round_sol: Number(r.deployed[w]) / 1e9, at, approx });
      }
      if (r.motherlode > 0n && r.deployed[w] > 0n) lodes.push({ id, w, deployed: r.deployed, motherlode: r.motherlode, at, approx });
      // every motherlode on the board, for the game's banner to all online miners
      if (r.motherlode > 0n) allLodes.push({ round_id: String(id), ore: Number(r.motherlode) / ORE_UNIT, square: w, miners: Number(r.count[w]), sol: Number(r.deployed[w]) / 1e9, at, approx });
    }

    if (lodes.length && list.length) {
      const mRaw = minerAccts ?? await accounts(await minerKeys(list));
      for (const raw of mRaw) {
        if (!raw) continue;
        let m;
        try { m = decodeMiner(raw); } catch { continue; }
        for (const L of lodes) {
          const mine = m.roundId === L.id ? m.deployed[L.w] : 0n;
          if (mine <= 0n) continue;
          const share = Number(mine) / Number(L.deployed[L.w]);
          hits.push({
            round_id: String(L.id), kind: 'motherlode', wallet: m.authority, square: L.w,
            ore: Number((L.motherlode * mine) / L.deployed[L.w]) / ORE_UNIT, share, round_sol: Number(L.deployed[L.w]) / 1e9,
            motherlode_ore: Number(L.motherlode) / ORE_UNIT, at: L.at, approx: L.approx,
            sol_in: Number(m.deployed.reduce((x, y) => x + y, 0n)) / 1e9, sol_back: Number(solBack(m.deployed, L.deployed, L.w)) / 1e9, sol_exact: true,
          });
        }
      }
    }

    if (allLodes.length) {
      const { error } = await db.from('ore_lodes').upsert(allLodes, { onConflict: 'round_id', ignoreDuplicates: true });
      if (error) throw error;
    }
    if (hits.length) {
      const { error } = await db.from('ore_hits').upsert(hits, { onConflict: 'round_id,kind,wallet', ignoreDuplicates: true });
      if (error) throw error;
    }

    // Fill in what each hit's miner put in and got back that round (and the ORE of motherlode rows reported by
    // autopilot / play via gali_score_round). Needs the round, which ORE keeps for about a day. The miner's own
    // SOL per spot comes from its ORE Miner account while it still holds the round (exact); after it has moved on,
    // from its autopilot settings (exact spots for Preferred, Random picks its spots, so the refund is estimated).
    const { data: todo } = await db.from('ore_hits').select('round_id,kind,wallet,ore')
      .or('sol_in.is.null,and(kind.eq.motherlode,ore.is.null)').gt('at', new Date(Date.now() - 23 * 3600e3).toISOString()).limit(30);
    let filled = 0;
    if (todo?.length) {
      const rIds = [...new Set(todo.map((t) => BigInt(t.round_id)))];
      const rRaw = await accounts(await Promise.all(rIds.map(roundPda)));
      const rounds = new Map(rIds.map((id, i) => { try { return [String(id), rRaw[i] ? decodeRound(rRaw[i]!) : null] as const; } catch { return [String(id), null] as const; } }));
      const ws = [...new Set(todo.map((t) => t.wallet))];
      const [mRaw, aRaw] = await Promise.all([accounts(await minerKeys(ws)), accounts(await Promise.all(ws.map(automationPda)))]);
      for (const t of todo) {
        const r = rounds.get(String(t.round_id));
        if (!r) continue;
        const rng = rngOf(r.slotHash);
        if (typeof rng !== 'bigint') continue;
        const w = Number(rng % 25n), total = r.deployed[w];
        if (total === 0n) continue;
        const k = ws.indexOf(t.wallet);
        // the miner's lamports on each spot that round
        let per: bigint[] | null = null, exact = false;
        try { const m = mRaw[k] ? decodeMiner(mRaw[k]!) : null; if (m && m.roundId === r.id && m.deployed[w] > 0n) { per = m.deployed; exact = true; } } catch { /* skip */ }
        if (!per && aRaw[k] && aRaw[k]!.length === AUTOMATION_SIZE) {
          const dv = dvOf(aRaw[k]!);
          const amount = u64(dv, 0), strategy = u64(dv, 88), mask = Number(u64(dv, 96) & 0x1ffffffn);
          const spots = [...Array(25).keys()].filter((i) => mask & (1 << i));
          if (amount > 0n && spots.length) {
            if (strategy === 1n) { // Preferred: these exact spots every round
              if (spots.includes(w)) { per = Array.from({ length: 25 }, (_, i) => (spots.includes(i) ? amount : 0n)); exact = true; }
            } else { // Random: the same number of spots, one of them the gold spot (they won), the rest unknown
              per = Array.from({ length: 25 }, () => 0n);
              per[w] = amount;
              let left = spots.length - 1;
              for (let i = 0; i < 25 && left > 0; i++) if (i !== w) { per[i] = amount; left--; }
            }
          }
        }
        if (!per || per[w] <= 0n || per[w] > total) continue;
        const patch: Record<string, unknown> = { sol_in: Number(per.reduce((a, b) => a + b, 0n)) / 1e9, sol_back: Number(solBack(per, r.deployed, w)) / 1e9, sol_exact: exact };
        if (t.kind === 'motherlode' && t.ore === null && r.motherlode > 0n) {
          Object.assign(patch, {
            square: w, ore: Number((r.motherlode * per[w]) / total) / ORE_UNIT, share: Number(per[w]) / Number(total),
            round_sol: Number(total) / 1e9, motherlode_ore: Number(r.motherlode) / ORE_UNIT,
          });
        }
        const { error } = await db.from('ore_hits').update(patch).eq('round_id', t.round_id).eq('kind', t.kind).eq('wallet', t.wallet);
        if (!error) filled++;
      }
    }

    if (done > last) {
      const { error } = await db.from('ore_hits_state').upsert({ id: 1, last_round: String(done), updated_at: new Date().toISOString() });
      if (error) throw error;
    }
    return json(200, { current: String(current), checked: ids.length, through: String(done), hits: hits.length, motherlodes: lodes.length, filled });
  } catch (e) {
    return json(500, { error: String((e as Error).message ?? e) });
  }
});
