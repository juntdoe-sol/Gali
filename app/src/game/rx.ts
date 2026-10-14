/**
 * Hooks the realtime rooms call into, so features layered on top (Brawl) can ride the lobby's and the
 * island's channels without those files importing them back. Everything a stranger sends is untrusted:
 * whoever registers here cleans it.
 */
export type Scope = 'lobby' | 'island';

export const roomHooks: {
  /** a 'bx' broadcast arrived on a room */
  onBx?: (scope: Scope, payload: unknown) => void;
  /** a player's position update carried a 'bw' (brawl state) field */
  onBw?: (scope: Scope, id: string, bw: unknown) => void;
  /** what to put in our own 'bw' field (undefined: send nothing) */
  myBw?: () => number[] | undefined;
} = {};
