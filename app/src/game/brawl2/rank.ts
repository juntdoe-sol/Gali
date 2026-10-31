/**
 * Gali Fightclub rank: a rating (everyone starts at 1000) and its tier, moved by online matches only.
 *
 * After an online match every wallet in it reports the finishing order through the `play` function (action
 * `fight`, supabase/functions/play). The server changes ratings only once every wallet has reported the same order
 * (supabase/sql/fightclub.sql), so a host cannot fake a win. Bots never count, and one pair of wallets counts at
 * most 5 rated matches a day.
 */
import { create } from 'zustand';
import { playCall } from '../play';
import { publicKey, restBase } from '../world';

export type Tier = 'COPPER' | 'IRON' | 'SILVER' | 'GOLD' | 'DIAMOND';
export const TIERS: { tier: Tier; from: number; color: string }[] = [
  { tier: 'COPPER', from: 0, color: '#d08a5a' },
  { tier: 'IRON', from: 1100, color: '#b8c4d6' },
  { tier: 'SILVER', from: 1250, color: '#e8eef8' },
  { tier: 'GOLD', from: 1400, color: '#ffc93c' },
  { tier: 'DIAMOND', from: 1600, color: '#7ae8ff' },
];
export const tierOf = (rating: number) => [...TIERS].reverse().find((t) => rating >= t.from) ?? TIERS[0];

export interface RankMe {
  rating: number;
  tier: Tier;
  games: number;
  wins: number;
  /** place on the board, once rated */
  place: number | null;
}
export interface RankRow {
  wallet: string;
  name: string;
  rating: number;
  tier: Tier;
  games: number;
  wins: number;
}
/** What the last online match did to your rank. */
export interface LastResult {
  mid: string;
  state: 'waiting' | 'done' | 'unrated';
  /** why it is not rated, in a few words */
  why?: string;
  delta?: number;
  rating?: number;
}

interface FcRank {
  me: RankMe | null;
  meWallet: string | null;
  rows: RankRow[];
  status: 'idle' | 'loading' | 'ok' | 'off' | 'error';
  at: number;
  last: LastResult | null;
  loadMe: (wallet: string | null) => Promise<void>;
  loadBoard: () => Promise<void>;
}

const headers = () => ({ apikey: publicKey(), authorization: `Bearer ${publicKey()}`, 'content-type': 'application/json' });
const rpc = async <T>(fn: string, args: Record<string, unknown>): Promise<T | null> => {
  const base = restBase();
  if (!base) return null;
  const r = await fetch(`${base}/rest/v1/rpc/${fn}`, { method: 'POST', headers: headers(), body: JSON.stringify(args) });
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()) as T;
};

export const useFcRank = create<FcRank>((set, get) => ({
  me: null,
  meWallet: null,
  rows: [],
  status: 'idle',
  at: 0,
  last: null,
  loadMe: async (wallet) => {
    if (!wallet) return set({ me: null, meWallet: null });
    try {
      const r = await rpc<RankMe[]>('fc_rank_of', { p_wallet: wallet });
      const x = Array.isArray(r) ? r[0] : null;
      if (x) set({ me: { rating: Number(x.rating) || 1000, tier: tierOf(Number(x.rating) || 1000).tier, games: Number(x.games) || 0, wins: Number(x.wins) || 0, place: x.place == null ? null : Number(x.place) }, meWallet: wallet });
    } catch {
      /* the server may not have the Fightclub tables yet */
    }
  },
  loadBoard: async () => {
    if (get().status === 'loading' || Date.now() - get().at < 15_000) return;
    if (!restBase()) return set({ status: 'off' });
    set({ status: 'loading' });
    try {
      const r = await rpc<RankRow[]>('fc_ranks', { p_limit: 50 });
      const rows = (Array.isArray(r) ? r : [])
        .filter((x) => x && typeof x.wallet === 'string')
        .map((x) => ({ wallet: x.wallet, name: String(x.name ?? '').slice(0, 24), rating: Number(x.rating) || 1000, tier: tierOf(Number(x.rating) || 1000).tier, games: Number(x.games) || 0, wins: Number(x.wins) || 0 }));
      set({ rows, status: 'ok', at: Date.now() });
    } catch {
      set({ status: 'error', at: Date.now() });
    }
  },
}));

/**
 * Report an online match's finishing order (wallets, 1st first). Asks again a few times until every player's
 * report is in and the server settles it, then reloads your rank.
 */
export async function reportFight(o: { mid: string; mode: '1v1' | 'ffa'; ord: string[]; me: string }) {
  useFcRank.setState({ last: { mid: o.mid, state: 'waiting' } });
  for (const wait of [0, 3000, 6000, 12000, 20000]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    if (useFcRank.getState().last?.mid !== o.mid) return;
    const r = await playCall<{ ok: boolean; settled?: boolean; delta?: number; rating?: number; reason?: string }>('fight', { mid: o.mid, mode: o.mode, ord: o.ord });
    if (!r) continue;
    if (!r.ok) return useFcRank.setState({ last: { mid: o.mid, state: 'unrated', why: r.reason === 'daily limit' ? 'Daily limit reached' : 'Results did not match' } });
    if (r.settled) {
      useFcRank.setState({ last: { mid: o.mid, state: 'done', delta: r.delta ?? 0, rating: r.rating } });
      void useFcRank.getState().loadMe(o.me);
      useFcRank.setState({ at: 0 });
      return;
    }
  }
  if (useFcRank.getState().last?.mid === o.mid) useFcRank.setState({ last: { mid: o.mid, state: 'unrated', why: 'Not every player reported' } });
}
