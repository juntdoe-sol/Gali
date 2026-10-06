// Cosmetic-only helpers for the island: nothing here reads or writes wallet, deploy or claim state.

export type Landed = { i: number; add: number };

/** Live deploy feed: SOL that landed on spots other than yours between two pot reads.
 *  `prev` null (first read of a round) and a smaller total (round rolled over) yield nothing,
 *  so a round never opens with a burst of labels. The pot is read every ~3s, so this is the
 *  net change between polls, not an individual deploy. */
export function landedSince(prev: number[] | null, next: number[], mineMask: number, minAdd = 0.001): Landed[] {
  if (!prev || prev.length !== next.length) return [];
  const sum = (a: number[]) => a.reduce((n, v) => n + (v || 0), 0);
  if (sum(next) < sum(prev) - 1e-9) return [];
  const out: Landed[] = [];
  for (let i = 0; i < next.length; i++) {
    if (mineMask & (1 << i)) continue;
    const add = (next[i] || 0) - (prev[i] || 0);
    if (add >= minAdd) out.push({ i, add });
  }
  return out.sort((a, b) => b.add - a.add).slice(0, 3);
}

/** Countdown rumble amplitude in map px (0 = off). Only inside the last `lockMs` of a live,
 *  still-open round; stays under 2px and never runs on low quality. */
export function rumbleAmp(msLeft: number, lockMs: number, phase: string, quality: number): number {
  if (!quality || phase !== 'mining' || msLeft <= 0 || msLeft > lockMs) return 0;
  return 0.4 + 1.4 * (1 - msLeft / lockMs);
}

/** A claim celebration fires once per new, positive timestamp from the app. */
export function shouldCelebrate(seen: number, next: number | undefined): boolean {
  return typeof next === 'number' && next > 0 && next !== seen;
}
