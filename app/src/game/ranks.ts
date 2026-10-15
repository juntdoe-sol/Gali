/**
 * Weekly Brawl ranks, shared through the Supabase project the lobby already uses (a small table, see
 * supabase/sql/brawl-ranks.sql).
 *
 * A knockout is reported by the player who got knocked out, never by the winner: nobody gains rank by
 * claiming a KO. Arena wins are reported by the match host. The database caps how often one pair can
 * count (once per 2 minutes) and the ranking counts each victim at most 3 times a day per winner, so
 * farming a friend is slow and shows. Names are what players typed; this is for fun, not for prizes.
 */
import { create } from 'zustand';
import { publicKey, restBase } from './world';

export interface RankRow {
  name: string;
  points: number;
  kos: number;
  wins: number;
  /** Mole King fights won this week */
  bosses: number;
}
interface RanksState {
  rows: RankRow[];
  at: number;
  status: 'idle' | 'loading' | 'ok' | 'off' | 'error';
  load: () => Promise<void>;
}

const headers = () => ({ apikey: publicKey(), authorization: `Bearer ${publicKey()}`, 'content-type': 'application/json' });
const clean = (s: string) => s.slice(0, 24);

export const useRanks = create<RanksState>((set, get) => ({
  rows: [],
  at: 0,
  status: 'idle',
  load: async () => {
    const base = restBase();
    if (!base) return set({ status: 'off' });
    if (get().status === 'loading' || Date.now() - get().at < 15_000) return;
    set({ status: 'loading' });
    try {
      const r = await fetch(`${base}/rest/v1/brawl_ranks?select=*&order=points.desc&limit=50`, { headers: headers() });
      if (!r.ok) throw new Error(String(r.status));
      const data = (await r.json()) as RankRow[];
      const rows = (Array.isArray(data) ? data : []).filter((x) => x && typeof x.name === 'string').map((x) => ({ name: clean(x.name), points: Number(x.points) || 0, kos: Number(x.kos) || 0, wins: Number(x.wins) || 0, bosses: Number(x.bosses) || 0 }));
      set({ rows, at: Date.now(), status: 'ok' });
    } catch {
      set({ status: 'error', at: Date.now() });
    }
  },
}));

/** We were knocked out by `killer`. The victim's word is what counts. */
export function reportKo(o: { killer: string; victim: string; scope: string }) {
  const base = restBase();
  if (!base || !o.killer || !o.victim || o.killer === o.victim) return;
  void fetch(`${base}/rest/v1/brawl_kos`, { method: 'POST', headers: { ...headers(), prefer: 'return=minimal' }, body: JSON.stringify({ killer: clean(o.killer), victim: clean(o.victim), scope: o.scope }) }).catch(() => undefined);
}

/** The arena host reports a match winner. */
export function reportWin(o: { winner: string; host: string; mode: string; players: number }) {
  const base = restBase();
  if (!base || !o.winner || o.players < (o.mode === 'boss' ? 1 : 2)) return;
  void fetch(`${base}/rest/v1/brawl_wins`, { method: 'POST', headers: { ...headers(), prefer: 'return=minimal' }, body: JSON.stringify({ winner: clean(o.winner), host: clean(o.host), mode: o.mode, players: Math.min(12, o.players) }) }).catch(() => undefined);
}

/* ---------------- miner ranks: every Gali wallet, with lifetime ORE read from chain ---------------- */

export interface MinerRow {
  wallet: string;
  name: string;
  level: number;
  xp: number;
  points: number;
  /** lifetime ORE mined, from ORE's Miner account (null until read) */
  ore: number | null;
  /** lifetime SOL deployed on ORE's board */
  deployed: number | null;
}
interface MinersState {
  rows: MinerRow[];
  at: number;
  status: 'idle' | 'loading' | 'ok' | 'off' | 'error';
  load: (lifetimes?: (wallets: string[]) => Promise<Record<string, { ore: number; deployed: number }>>) => Promise<void>;
}

export const useMinerRanks = create<MinersState>((set, get) => ({
  rows: [],
  at: 0,
  status: 'idle',
  load: async (lifetimes) => {
    const base = restBase();
    if (!base) return set({ status: 'off' });
    if (get().status === 'loading' || Date.now() - get().at < 20_000) return;
    set({ status: 'loading' });
    try {
      const r = await fetch(`${base}/rest/v1/gali_miners?select=wallet,name,level,xp,points&order=xp.desc&limit=200`, { headers: headers() });
      if (!r.ok) throw new Error(String(r.status));
      const data = (await r.json()) as Partial<MinerRow>[];
      let rows: MinerRow[] = (Array.isArray(data) ? data : [])
        .filter((x) => x && typeof x.wallet === 'string')
        .map((x) => ({ wallet: String(x.wallet), name: clean(String(x.name ?? '')), level: Number(x.level) || 1, xp: Number(x.xp) || 0, points: Number(x.points) || 0, ore: null, deployed: null }));
      set({ rows, at: Date.now(), status: 'ok' });
      if (lifetimes && rows.length) {
        const life = await lifetimes(rows.map((x) => x.wallet)).catch(() => ({}) as Record<string, { ore: number; deployed: number }>);
        rows = rows.map((x) => (life[x.wallet] ? { ...x, ore: life[x.wallet].ore, deployed: life[x.wallet].deployed } : { ...x, ore: 0, deployed: 0 }));
        set({ rows });
      }
    } catch {
      set({ status: 'error', at: Date.now() });
    }
  },
}));

let lastSeen = { key: '', at: 0 };
/** Check in this wallet's name, level, XP and points. Throttled; the database also keeps only rises. */
export function reportMiner(o: { wallet: string; name: string; level: number; xp: number; points: number }) {
  const base = restBase();
  if (!base || !o.wallet) return;
  const key = `${o.wallet}|${o.name}|${o.level}|${Math.floor(o.xp / 25)}|${o.points}`;
  const now = Date.now();
  if (key === lastSeen.key || now - lastSeen.at < 15_000) return;
  lastSeen = { key, at: now };
  void fetch(`${base}/rest/v1/rpc/gali_seen`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ p_wallet: o.wallet, p_name: clean(o.name), p_level: Math.round(o.level), p_xp: Math.round(o.xp), p_points: Math.round(o.points) }),
  }).catch(() => undefined);
}

/** This wallet's saved level, XP and points, so a second device (web and app) picks up where the first left off. */
export async function fetchMiner(wallet: string): Promise<{ xp: number; points: number; level: number } | null> {
  const base = restBase();
  if (!base || !wallet) return null;
  try {
    const r = await fetch(`${base}/rest/v1/gali_miners?select=xp,points,level&wallet=eq.${encodeURIComponent(wallet)}&limit=1`, { headers: headers() });
    if (!r.ok) return null;
    const rows = (await r.json()) as { xp?: number; points?: number; level?: number }[];
    const x = Array.isArray(rows) ? rows[0] : null;
    return x ? { xp: Number(x.xp) || 0, points: Number(x.points) || 0, level: Number(x.level) || 1 } : null;
  } catch {
    return null;
  }
}
