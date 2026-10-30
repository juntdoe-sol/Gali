/**
 * The ORE stats panel on desktop ORE Island: your ORE (from your ORE miner account on chain) and all of
 * Gali's miners together (from the Supabase tables in supabase/sql/ore-stats.sql).
 *
 * Refined ORE grows on its own while you hold unrefined ORE: every claim of unrefined ORE pays 10% to the
 * holders. ORE keeps one running factor for that; a server job saves it every hour, so the gain over the
 * last 24 hours is your unrefined ORE times how much the factor rose since then.
 */
import { create } from 'zustand';
import { loadBoard } from '../chain/lazy';
import { useGame } from './store';
import { publicKey, restBase } from './world';

export interface OreStatsState {
  status: 'idle' | 'loading' | 'ok' | 'error';
  /** you (null until a wallet is connected and read) */
  me: { lifetime: number; unrefined: number; refined: number; gain: number | null; gainHours: number; deployedSol: number; returnedSol: number } | null;
  /** everyone who played Gali */
  gali: { miners: number; ore: number } | null;
  /** ORE and SOL in dollars and every Gali wallet's all-time totals, saved by the server every 5 minutes */
  market: { solUsd: number | null; oreUsd: number | null; ore: number; deployedSol: number; returnedSol: number; miners: number } | null;
}

export const useOreStats = create<OreStatsState>(() => ({ status: 'idle', me: null, gali: null, market: null }));

/**
 * All-time profit in dollars at today's prices: ORE mined (ORE's lifetime counter) plus the SOL ORE gave back,
 * minus the SOL put on the board. Null until both prices are known.
 */
export function profitUsd(ore: number, deployedSol: number, returnedSol: number, m: OreStatsState['market']): number | null {
  if (!m || !(m.solUsd && m.solUsd > 0) || !(m.oreUsd && m.oreUsd > 0)) return null;
  return ore * m.oreUsd + (returnedSol - deployedSol) * m.solUsd;
}
export const fmtUsd = (n: number) => {
  const a = Math.abs(n);
  return `${n < 0 ? '-' : '+'}$${a.toLocaleString(undefined, { minimumFractionDigits: a < 1000 ? 2 : 0, maximumFractionDigits: a < 1000 ? 2 : 0 })}`;
};

const headers = () => ({ apikey: publicKey(), authorization: `Bearer ${publicKey()}`, 'content-type': 'application/json' });
const rpc = async (fn: string, args: Record<string, unknown> = {}) => {
  const base = restBase();
  if (!base) return null;
  const r = await fetch(`${base}/rest/v1/rpc/${fn}`, { method: 'POST', headers: headers(), body: JSON.stringify(args) });
  return r.ok ? r.json() : null;
};

/** The refining factor saved about 24 hours ago (or the oldest one, while the history is younger than that). */
let rateAgo: { at: number; factor: bigint } | null = null;
let rateAt = 0;
let totalAt = 0;
let marketAt = 0;

async function loadServer(now: number) {
  if (now - rateAt > 10 * 60_000) {
    rateAt = now;
    const rows = await rpc('gali_ore_rate_ago', { p_hours: 24 }).catch(() => null);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (row && typeof row.factor === 'string' && /^\d{1,40}$/.test(row.factor)) rateAgo = { at: Date.parse(row.at), factor: BigInt(row.factor) };
  }
  if (now - totalAt > 5 * 60_000) {
    totalAt = now;
    const rows = await rpc('gali_ore_total').catch(() => null);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (row) useOreStats.setState({ gali: { miners: Number(row.miners) || 0, ore: Number(row.ore) || 0 } });
  }
  await refreshMarket(now);
}

/** ORE and SOL prices (and Gali-wide totals), saved by the server every 5 minutes. Also used by the round's EV signal. */
export async function refreshMarket(now = Date.now()) {
  if (now - marketAt > 5 * 60_000) {
    marketAt = now;
    const rows = await rpc('gali_ore_market').catch(() => null);
    const row = Array.isArray(rows) ? rows[0] : null;
    const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    if (row) {
      useOreStats.setState({
        market: {
          solUsd: n(row.sol_usd), oreUsd: n(row.ore_usd), ore: Number(row.ore) || 0,
          deployedSol: Number(row.deployed_sol) || 0, returnedSol: Number(row.returned_sol) || 0, miners: Number(row.miners) || 0,
        },
      });
    }
  }
}

/** Read everything once. The panel calls this every minute while it is on screen. */
export async function refreshOreStats() {
  const now = Date.now();
  const owner = useGame.getState().wallet.owner;
  if (useOreStats.getState().status === 'idle') useOreStats.setState({ status: 'loading' });
  try {
    await loadServer(now).catch(() => undefined);
    if (!owner) {
      useOreStats.setState({ status: 'ok', me: null });
      return;
    }
    const board = await loadBoard();
    const { PublicKey } = await import('@solana/web3.js');
    const s = await board.fetchOreStats(new PublicKey(owner));
    let gain: number | null = null;
    let gainHours = 24;
    if (rateAgo) {
      const rise = BigInt(s.factor) - rateAgo.factor;
      gain = rise > 0n ? Number((BigInt(s.unrefinedGrams) * rise) / board.FACTOR_ONE) / 1e11 : 0;
      gainHours = Math.max(1, Math.min(24, Math.round((now - rateAgo.at) / 3_600_000)));
    }
    useOreStats.setState({ status: 'ok', me: { lifetime: s.lifetime, unrefined: s.unrefined, refined: s.refined, gain, gainHours, deployedSol: s.deployedSol, returnedSol: s.returnedSol } });
  } catch {
    useOreStats.setState((st) => ({ status: st.me ? 'ok' : 'error' }));
  }
}
