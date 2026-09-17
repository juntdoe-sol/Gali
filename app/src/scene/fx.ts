// Mutable per-frame signals shared between scene parts (no React re-renders).
import { GRID } from '../game/constants';
import { useGame } from '../game/store';

export const SPACING = 1.08;
export const BLOCK_TOP = 0.31;

export const blockPos = (i: number): [number, number, number] => {
  const col = i % GRID;
  const row = Math.floor(i / GRID);
  return [(col - (GRID - 1) / 2) * SPACING, 0, (row - (GRID - 1) / 2) * SPACING];
};

export const fx = {
  hits: new Map<number, number>(), // block -> performance.now() of last pickaxe impact
  moleBlock: -1,
  narrow: true,
  /** screen pixels covered by the HUD above and the deploy panel below; the camera keeps the board between them */
  viewTop: 215,
  viewBottom: 150,
};

/**
 * Reveal timeline in ms, matching the web build:
 * 0–1400 shake (held while the chain settles), 1400–2500 losers sink, 2500+ winner pops.
 * Returns -1 when no reveal is running.
 */
export function revealEl(): number {
  const st = useGame.getState();
  if (st.phase === 'settling') return Math.min(1300, Date.now() - st.settleStartAt);
  if (st.phase === 'reveal') return 1400 + (Date.now() - st.revealStartAt);
  return -1;
}

export const isDug = (i: number) => {
  const p = useGame.getState().pending;
  return Boolean(p && p.mask & (1 << i));
};
