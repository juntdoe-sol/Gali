// Shared, mutable signals between the pixel scene and the HUD (no React re-renders).
import { useGame } from '../game/store';

export const fx = {
  hits: new Map<number, number>(), // spot -> Date.now() of the last pickaxe impact
  moleBlock: -1,
  /** screen pixels covered by the HUD above and the deploy panel below; the map keeps the spots between them */
  viewTop: 215,
  viewBottom: 150,
};

/**
 * Reveal timeline in ms:
 * 0–1400 shake (held while the chain settles), 1400–2500 losers darken, 2500+ the winner strikes gold.
 * Returns -1 when no reveal is running.
 */
export function revealEl(): number {
  const st = useGame.getState();
  if (st.phase === 'settling') return Math.min(1300, Date.now() - st.settleStartAt);
  if (st.phase === 'reveal') return 1400 + (Date.now() - st.revealStartAt);
  return -1;
}

