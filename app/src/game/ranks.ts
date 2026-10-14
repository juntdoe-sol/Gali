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
      const r = await fetch(`${base}/rest/v1/brawl_ranks?select=name,points,kos,wins&order=points.desc&limit=50`, { headers: headers() });
      if (!r.ok) throw new Error(String(r.status));
      const data = (await r.json()) as RankRow[];
      const rows = (Array.isArray(data) ? data : []).filter((x) => x && typeof x.name === 'string').map((x) => ({ name: clean(x.name), points: Number(x.points) || 0, kos: Number(x.kos) || 0, wins: Number(x.wins) || 0 }));
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
  if (!base || !o.winner || o.players < 2) return;
  void fetch(`${base}/rest/v1/brawl_wins`, { method: 'POST', headers: { ...headers(), prefer: 'return=minimal' }, body: JSON.stringify({ winner: clean(o.winner), host: clean(o.host), mode: o.mode, players: Math.min(12, o.players) }) }).catch(() => undefined);
}
