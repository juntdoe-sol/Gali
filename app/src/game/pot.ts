import { BLOCKS, MOTHERLODE_SKR, ROUND_REWARD_SKR } from './constants';

/** Mirrors the program config set by scripts/setup-devnet.ts */
export const POT_FEE = 0.1;
export const MIN_SOL_PER_BLOCK = 0.0001;
export const PRACTICE_SOL = 2;
export const OPTIMAL_ROUNDS = 10;

export interface PotView {
  roundId: number;
  perBlock: number[]; // SOL
  total: number; // SOL
  miners: number;
}

export const emptyPot = (roundId: number): PotView => ({ roundId, perBlock: Array(BLOCKS).fill(0), total: 0, miners: 0 });

/** Small deterministic PRNG so every practice round has a stable "crowd". */
function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Practice mode only: simulated miners who deploy during the round.
 * `frac` is how far through the round we are (0..1); later bots appear as it goes.
 */
export function simPot(roundId: number, frac: number): PotView {
  const r = rng(roundId * 2654435761);
  const bots = 6 + Math.floor(r() * 14);
  const pot = emptyPot(roundId);
  for (let b = 0; b < bots; b++) {
    const joinsAt = r() * 0.9;
    const blocks = 1 + Math.floor(r() * (r() < 0.3 ? 25 : 6));
    const perBlock = Math.round((0.001 + r() ** 2 * 0.04) * 1e4) / 1e4;
    const picks = [...Array(BLOCKS).keys()].sort(() => r() - 0.5).slice(0, blocks);
    if (frac < joinsAt) continue;
    picks.forEach((i) => (pot.perBlock[i] += perBlock));
    pot.total += perBlock * blocks;
    pot.miners += 1;
  }
  return pot;
}

export function addToPot(pot: PotView, mask: number, perBlock: number): PotView {
  const out = { ...pot, perBlock: [...pot.perBlock], miners: pot.miners + 1 };
  for (let i = 0; i < BLOCKS; i++)
    if (mask & (1 << i)) {
      out.perBlock[i] += perBlock;
      out.total += perBlock;
    }
  return out;
}

/** The n least-crowded blocks: the same SOL buys a bigger share there. */
export function smartPick(perBlock: number[], n: number): number[] {
  return [...perBlock.keys()]
    .map((i) => ({ i, v: perBlock[i] + Math.random() * 1e-9 }))
    .sort((a, b) => a.v - b.v)
    .slice(0, Math.max(1, Math.min(BLOCKS, n)))
    .map((x) => x.i);
}

export const maskOf = (idx: number[]) => idx.reduce((m, i) => m | (1 << i), 0);
export const idxOf = (mask: number) => [...Array(BLOCKS).keys()].filter((i) => mask & (1 << i));

/**
 * What `claim_pot` pays. The SOL pool (pot minus fee) is always shared by SOL on the winning block.
 * The round's SKR is either split the same way, or goes whole to one lucky winner, drawn with odds
 * equal to their share of the block (`luckyRoll` is a uniform number in [0, 1)).
 */
export function payoutFor(pot: PotView, win: number, minePerBlock: number, mask: number, motherlode: boolean, split: boolean, luckyRoll: number) {
  const mine = mask & (1 << win) ? minePerBlock : 0;
  const onWin = pot.perBlock[win];
  if (!mine || !onWin) return { sol: 0, skr: 0, lucky: false };
  const share = mine / onWin;
  const reward = ROUND_REWARD_SKR + (motherlode ? MOTHERLODE_SKR : 0);
  const lucky = !split && luckyRoll < share;
  return { sol: share * pot.total * (1 - POT_FEE), skr: split ? share * reward : lucky ? reward : 0, lucky };
}

export const optimalPerRound = (amount: number) => {
  const floor = MIN_SOL_PER_BLOCK * BLOCKS;
  return Math.max(floor, Math.floor((amount / OPTIMAL_ROUNDS) * 1e4) / 1e4);
};

export const fmtSol = (v: number, dp = 4) => (v >= 100 ? v.toFixed(1) : v.toFixed(dp).replace(/0+$/, '').replace(/\.$/, '.0'));
