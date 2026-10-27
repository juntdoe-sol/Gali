/**
 * What the TV reads. Chain reads reuse src/chain/board.ts as it is (fetchOreClock, fetchBoardRound,
 * fetchOreMotherlode, fetchPastBoardRounds) through the public RPC, polled every 10 seconds and only while the
 * app is in the foreground. Community numbers come from the Supabase REST table gali_miners with the public key.
 * Nothing here signs or sends.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { fetchBoardRound, fetchMinerLifetimes, fetchOreClock, fetchOreMotherlode, fetchPastBoardRounds, type BoardRound, type OreClock } from '../chain/board';

export const POLL_MS = 10_000;

export interface Live {
  clock: OreClock | null;
  round: BoardRound | null;
  /** the last settled round, for the Strike band and Stats */
  last: BoardRound | null;
  motherlode: number | null;
  /** when the clock was read, so the countdown can run between polls */
  at: number;
  error: boolean;
}

const EMPTY: Live = { clock: null, round: null, last: null, motherlode: null, at: 0, error: false };

/** Polls the live round while the app is in the foreground. */
export function useLive(active = true): Live {
  const [live, setLive] = useState<Live>(EMPTY);
  const busy = useRef(false);
  const lastId = useRef<number | null>(null);
  const last = useRef<BoardRound | null>(null);

  const tick = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      const clock = await fetchOreClock();
      const id = Number(clock.roundId);
      const [round, motherlode] = await Promise.all([fetchBoardRound(id).catch(() => null), fetchOreMotherlode().catch(() => null)]);
      if (lastId.current !== id) {
        lastId.current = id;
        // a new round: the one before it has settled, read it for the last-round result
        const past = await fetchPastBoardRounds(id, 1).catch(() => [] as BoardRound[]);
        if (past[0]) last.current = past[0];
      }
      setLive((p) => ({ clock, round, last: last.current, motherlode: motherlode ?? p.motherlode, at: Date.now(), error: false }));
    } catch {
      setLive((p) => ({ ...p, error: true }));
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (id) return;
      void tick();
      id = setInterval(() => void tick(), POLL_MS);
    };
    const stop = () => {
      if (id) clearInterval(id);
      id = null;
    };
    if (AppState.currentState === 'active') start();
    const sub = AppState.addEventListener('change', (s) => (s === 'active' ? start() : stop()));
    return () => {
      stop();
      sub.remove();
    };
  }, [active, tick]);

  return live;
}

/** Milliseconds left in the mining window, counted down locally between polls. */
export function useCountdown(live: Live): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!live.clock || live.clock.phase !== 'mining') return 0;
  return Math.max(0, live.clock.msLeft - (now - live.at));
}

export const mmss = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/* ---------------- community stats (Supabase REST, public key) ---------------- */

const wsUrl = process.env.EXPO_PUBLIC_WORLD_URL ?? '';
const KEY = process.env.EXPO_PUBLIC_WORLD_KEY ?? '';
const BASE = wsUrl.replace(/^ws/, 'http').replace(/\/realtime\/v1\/?$/, '');
const H = { apikey: KEY, authorization: `Bearer ${KEY}` };

export interface TopMiner {
  name: string;
  wallet: string;
  ore: number;
}
export interface Community {
  online: number | null;
  registered: number | null;
  newToday: number | null;
  oreMined: number | null;
  top: TopMiner[];
  /** set when the table is missing or the server refuses us, so Stats can say so instead of showing zeros */
  problem: string | null;
}

const count = async (query: string): Promise<number> => {
  const r = await fetch(`${BASE}/rest/v1/gali_miners?select=wallet&${query}`, { method: 'HEAD', headers: { ...H, prefer: 'count=exact' } });
  if (!r.ok) throw new Error(String(r.status));
  const m = /\/(\d+)$/.exec(r.headers.get('content-range') ?? '');
  return m ? Number(m[1]) : 0;
};

const startOfTodayIso = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
};

export async function fetchCommunity(): Promise<Community> {
  const none: Community = { online: null, registered: null, newToday: null, oreMined: null, top: [], problem: null };
  if (!BASE || !KEY) return { ...none, problem: 'No Supabase URL or key in this build' };
  try {
    const [registered, newToday, online] = await Promise.all([
      count(''),
      count(`first_seen=gte.${encodeURIComponent(startOfTodayIso())}`),
      count(`seen=gte.${encodeURIComponent(new Date(Date.now() - 5 * 60_000).toISOString())}`),
    ]);
    const res = await fetch(`${BASE}/rest/v1/gali_miners?select=wallet,name&order=xp.desc&limit=100`, { headers: H });
    const rows = res.ok ? ((await res.json()) as { wallet: string; name: string }[]) : [];
    const life = await fetchMinerLifetimes(rows.map((r) => r.wallet)).catch(() => ({}) as Record<string, { ore: number; deployed: number }>);
    const top = rows
      .map((r) => ({ name: r.name || `${r.wallet.slice(0, 4)}..${r.wallet.slice(-4)}`, wallet: r.wallet, ore: life[r.wallet]?.ore ?? 0 }))
      .sort((a, b) => b.ore - a.ore)
      .slice(0, 5);
    const oreMined = Object.values(life).reduce((a, b) => a + b.ore, 0);
    return { online, registered, newToday, oreMined, top, problem: null };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    return { ...none, problem: msg === '404' ? 'Table gali_miners not found (404)' : `Community stats unavailable (${msg})` };
  }
}

/** Community numbers, refreshed every 60 seconds while Stats is open. */
export function useCommunity(active: boolean): Community | null {
  const [c, setC] = useState<Community | null>(null);
  useEffect(() => {
    if (!active) return;
    let dead = false;
    const run = () => void fetchCommunity().then((x) => !dead && setC(x));
    run();
    const id = setInterval(run, 60_000);
    return () => {
      dead = true;
      clearInterval(id);
    };
  }, [active]);
  return c;
}
