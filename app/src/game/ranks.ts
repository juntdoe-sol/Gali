/**
 * Ranks for today, this month, this year and all time (supabase/sql/ranks-periods.sql). Brawl ranks are
 * shared through the Supabase project the lobby already uses (a small table, see
 * supabase/sql/brawl-ranks.sql).
 *
 * A knockout is reported by the player who got knocked out, never by the winner: nobody gains rank by
 * claiming a KO. Arena wins are reported by the match host. The database caps how often one pair can
 * count (once per 2 minutes) and the ranking counts each victim at most 3 times a day per winner, so
 * farming a friend is slow and shows. Names are what players typed; this is for fun, not for prizes.
 */
import { create } from 'zustand';
import { publicKey, restBase } from './world';

/** Which stretch of time a board counts: today, this month, this year, or everything. Days start at midnight Malaysia time. */
export type Period = 'day' | 'month' | 'year' | 'all';
export const PERIODS: [Period, string][] = [
  ['day', 'TODAY'],
  ['month', 'MONTH'],
  ['year', 'YEAR'],
  ['all', 'ALL TIME'],
];
export const PERIOD_WORDS: Record<Period, string> = { day: 'today', month: 'this month', year: 'this year', all: 'of all time' };

export interface RankRow {
  name: string;
  points: number;
  kos: number;
  wins: number;
  /** Boss Raids won in the period */
  bosses: number;
}
interface RanksState {
  period: Period;
  rows: RankRow[];
  at: number;
  status: 'idle' | 'loading' | 'ok' | 'off' | 'error';
  load: (period?: Period) => Promise<void>;
}

const headers = () => ({ apikey: publicKey(), authorization: `Bearer ${publicKey()}`, 'content-type': 'application/json' });
const clean = (s: string) => s.slice(0, 24);
const rpc = (base: string, fn: string, args: Record<string, unknown>) => fetch(`${base}/rest/v1/rpc/${fn}`, { method: 'POST', headers: headers(), body: JSON.stringify(args) });

export const useRanks = create<RanksState>((set, get) => ({
  period: 'day',
  rows: [],
  at: 0,
  status: 'idle',
  load: async (period) => {
    const base = restBase();
    if (!base) return set({ status: 'off' });
    const p = period ?? get().period;
    const same = p === get().period;
    if (same && (get().status === 'loading' || Date.now() - get().at < 15_000)) return;
    set({ status: 'loading', period: p, ...(same ? {} : { rows: [] }) });
    try {
      const r = await rpc(base, 'brawl_ranks_period', { p_period: p, p_limit: 50 });
      if (!r.ok) throw new Error(String(r.status));
      const data = (await r.json()) as RankRow[];
      if (get().period !== p) return;
      const rows = (Array.isArray(data) ? data : []).filter((x) => x && typeof x.name === 'string').map((x) => ({ name: clean(x.name), points: Number(x.points) || 0, kos: Number(x.kos) || 0, wins: Number(x.wins) || 0, bosses: Number(x.bosses) || 0 }));
      set({ rows, at: Date.now(), status: 'ok' });
    } catch {
      if (get().period === p) set({ status: 'error', at: Date.now() });
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
  /** XP gained in the period (all time: the total) */
  gain: number;
  /** lifetime ORE mined, from ORE's Miner account (null until read) */
  ore: number | null;
  /** ORE mined in the period: the chain's total minus the day mark before it (null when there is no mark yet) */
  oreGain: number | null;
  /** lifetime SOL deployed on ORE's board */
  deployed: number | null;
}
type Lifetimes = (wallets: string[]) => Promise<Record<string, { ore: number; deployed: number }>>;
interface MinersState {
  period: Period;
  rows: MinerRow[];
  /** everyone, for the ORE board (it reads the chain for each) */
  everyone: MinerRow[];
  at: number;
  status: 'idle' | 'loading' | 'ok' | 'off' | 'error';
  load: (period?: Period, lifetimes?: Lifetimes) => Promise<void>;
}

const oreMarked = new Map<string, string>();
/** Write down each wallet's ORE total once a day, so the day, month and year boards have a starting mark. */
function markOre(base: string, life: Record<string, { ore: number }>) {
  const day = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  for (const [w, v] of Object.entries(life)) {
    const key = `${day}:${v.ore.toFixed(6)}`;
    if (oreMarked.get(w) === key || !(v.ore >= 0)) continue;
    oreMarked.set(w, key);
    void rpc(base, 'gali_ore_seen', { p_wallet: w, p_ore: Math.round(v.ore * 1e6) / 1e6 }).catch(() => undefined);
  }
}

export const useMinerRanks = create<MinersState>((set, get) => ({
  period: 'day',
  rows: [],
  everyone: [],
  at: 0,
  status: 'idle',
  load: async (period, lifetimes) => {
    const base = restBase();
    if (!base) return set({ status: 'off' });
    const p = period ?? get().period;
    const same = p === get().period;
    if (same && (get().status === 'loading' || Date.now() - get().at < 20_000)) return;
    set({ status: 'loading', period: p, ...(same ? {} : { rows: [] }) });
    const toRow = (x: Partial<MinerRow> & { gain?: number }): MinerRow => ({ wallet: String(x.wallet), name: clean(String(x.name ?? '')), level: Number(x.level) || 1, xp: Number(x.xp) || 0, points: Number(x.points) || 0, gain: Number(x.gain ?? x.xp) || 0, ore: null, oreGain: null, deployed: null });
    try {
      // the XP board for the period, and everyone (for ORE)
      const [r, all] = await Promise.all([
        p === 'all' ? null : rpc(base, 'gali_miner_ranks', { p_period: p, p_limit: 100 }),
        fetch(`${base}/rest/v1/gali_miners?select=wallet,name,level,xp,points&order=xp.desc&limit=200`, { headers: headers() }),
      ]);
      if (!all.ok || (r && !r.ok)) throw new Error(String(r && !r.ok ? r.status : all.status));
      const everyoneRaw = (await all.json()) as Partial<MinerRow>[];
      let everyone = (Array.isArray(everyoneRaw) ? everyoneRaw : []).filter((x) => x && typeof x.wallet === 'string').map(toRow);
      let rows = r ? ((await r.json()) as Partial<MinerRow>[]).filter((x) => x && typeof x.wallet === 'string').map(toRow) : everyone;
      if (get().period !== p) return;
      set({ rows, everyone, at: Date.now(), status: 'ok' });
      if (lifetimes && everyone.length) {
        const life = await lifetimes(everyone.map((x) => x.wallet)).catch(() => ({}) as Record<string, { ore: number; deployed: number }>);
        markOre(base, life);
        let marks: Record<string, number> = {};
        if (p !== 'all') {
          const b = await rpc(base, 'gali_ore_base', { p_period: p }).catch(() => null);
          const list = b && b.ok ? ((await b.json()) as { wallet: string; ore: number }[]) : [];
          marks = Object.fromEntries((Array.isArray(list) ? list : []).map((x) => [x.wallet, Number(x.ore)]));
        }
        const withOre = (x: MinerRow): MinerRow => {
          const ore = life[x.wallet]?.ore ?? 0;
          const mark = marks[x.wallet];
          return { ...x, ore, deployed: life[x.wallet]?.deployed ?? 0, oreGain: p === 'all' ? ore : mark === undefined ? null : Math.max(0, ore - mark) };
        };
        everyone = everyone.map(withOre);
        rows = rows.map(withOre);
        if (get().period === p) set({ rows, everyone });
      }
    } catch {
      if (get().period === p) set({ status: 'error', at: Date.now() });
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
