/**
 * Gali miners' big moments on ORE's board: every solo win (one wallet takes the round's whole ORE) and every
 * motherlode hit. The server's ore-hits job records them from ORE's own accounts (public.ore_hits, read with
 * gali_ore_hits), because ORE closes a round's account about a day after it ends.
 */
import { create } from 'zustand';
import { publicKey, restBase } from './world';

export interface OreHit {
  roundId: number;
  kind: 'solo' | 'motherlode';
  wallet: string;
  name: string | null;
  /** ORE this miner won; null while the server is still working out a motherlode share */
  ore: number | null;
  /** share of SOL on the gold spot (1 for a solo win) */
  share: number | null;
  /** the whole motherlode that round */
  motherlodeOre: number | null;
  at: string;
  /** the time is estimated from the round number (rounds found when the record started) */
  approx: boolean;
  /** SOL this miner put on the board that round, and SOL ORE gave back after its fees; null if unknown */
  solIn: number | null;
  solBack: number | null;
  /** false when worked out from their autopilot settings (Random spots), so the refund is close, not exact */
  solExact: boolean;
}

interface HitsState {
  status: 'idle' | 'loading' | 'ok' | 'error';
  hits: OreHit[];
  at: number;
  load: (force?: boolean) => Promise<void>;
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export const useOreHits = create<HitsState>((set, get) => ({
  status: 'idle',
  hits: [],
  at: 0,
  async load(force) {
    const base = restBase();
    if (!base) return set({ status: 'error' });
    if (!force && get().status === 'ok' && Date.now() - get().at < 60_000) return;
    if (get().status !== 'ok') set({ status: 'loading' });
    try {
      const r = await fetch(`${base}/rest/v1/rpc/gali_ore_hits`, {
        method: 'POST',
        headers: { apikey: publicKey(), authorization: `Bearer ${publicKey()}`, 'content-type': 'application/json' },
        body: JSON.stringify({ p_limit: 200 }),
      });
      if (!r.ok) throw new Error(String(r.status));
      const rows = (await r.json()) as Record<string, unknown>[];
      set({
        status: 'ok',
        at: Date.now(),
        hits: rows.map((x) => ({
          roundId: Number(x.round_id), kind: x.kind === 'solo' ? 'solo' : 'motherlode', wallet: String(x.wallet),
          name: x.name ? String(x.name) : null, ore: num(x.ore), share: num(x.share), motherlodeOre: num(x.motherlode_ore),
          at: String(x.at), approx: Boolean(x.approx),
          solIn: num(x.sol_in), solBack: num(x.sol_back), solExact: x.sol_exact !== false,
        })),
      });
    } catch {
      set((s) => ({ status: s.hits.length ? 'ok' : 'error' }));
    }
  },
}));
