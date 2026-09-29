import { sha256 } from '@noble/hashes/sha2.js';
import { BLOCKS, MOTHERLODE_ACCRUAL_SKR, MOTHERLODE_ODDS, ROUND_REWARD_ORE } from './constants';

/** Mirrors the program: 1% of every spot, plus the config's pot_fee_bps of the rest on each losing spot. */
export const ADMIN_FEE = 0.01;
/** Default losing-spot fee; the live value comes from the chain (see `setPotFee`). */
export const DEFAULT_POT_FEE = 0.1;
let potFee = DEFAULT_POT_FEE;
/** Keeps the client's maths in step with the program's `pot_fee_bps`. */
export const setPotFee = (bps: number) => {
  if (bps >= 0 && bps <= 2_000) potFee = bps / 10_000;
};
export const potFee_ = () => potFee;
export const SOLO_SPOTS = 10;
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

const soloCache = new Map<number, number>();
/** The round's 10 solo spots (bitmask), exactly as the program's `solo_mask`: sha256("gali-solo" || round id) + Fisher-Yates. */
export function soloMask(roundId: number): number {
  const hit = soloCache.get(roundId);
  if (hit !== undefined) return hit;
  const msg = new Uint8Array(17);
  msg.set(new TextEncoder().encode('gali-solo'));
  new DataView(msg.buffer).setBigUint64(9, BigInt(roundId), true);
  const seed = sha256(msg);
  const idx = [...Array(BLOCKS).keys()];
  let mask = 0;
  for (let i = 0; i < SOLO_SPOTS; i++) {
    const j = i + ((seed[2 * i] | (seed[2 * i + 1] << 8)) % (BLOCKS - i));
    [idx[i], idx[j]] = [idx[j], idx[i]];
    mask |= 1 << idx[i];
  }
  mask >>>= 0;
  if (soloCache.size > 64) soloCache.clear();
  soloCache.set(roundId, mask);
  return mask;
}

/** Practice mode: a stand-in Motherlode Pool that grows each round and resets on a hit. */
export const practiceMotherlode = (roundId: number) => 1_500 + ((roundId * 7) % MOTHERLODE_ODDS) * MOTHERLODE_ACCRUAL_SKR;

/** SOL left for the winning spot's miners if spot `win` strikes: everything minus the fees (settle_pot). */
export function poolFor(pot: PotView, win: number) {
  let fees = 0;
  for (let i = 0; i < BLOCKS; i++) {
    const d = pot.perBlock[i];
    if (!d) continue;
    fees += d * ADMIN_FEE + (i === win ? 0 : d * (1 - ADMIN_FEE) * potFee);
  }
  return pot.perBlock[win] > 0 ? pot.total - fees : 0;
}

/**
 * What `claim_pot` credits. SOL: the winning spot's miners split the whole pool (their SOL plus the
 * losing spots' SOL, minus fees) by their SOL on that spot; losing spots get nothing back.
 * ORE: what the round mines is split the same way, or on a solo claim goes whole to one
 * miner (odds = their share, `luckyRoll` in [0, 1)). ORE mints it; Gali does not.
 * A motherlode pays Gali's whole SKR pool (`motherlodeSkr`) on top, always split.
 */
export function payoutFor(pot: PotView, win: number, minePerBlock: number, mask: number, motherlodeSkr: number, split: boolean, luckyRoll: number) {
  const mine = mask & (1 << win) ? minePerBlock : 0;
  const onWin = pot.perBlock[win];
  if (!mine || !onWin) return { sol: 0, ore: 0, skrMotherlode: 0, lucky: false };
  const share = mine / onWin;
  const lucky = !split && luckyRoll < share;
  return { sol: share * poolFor(pot, win), ore: split ? share * ROUND_REWARD_ORE : lucky ? ROUND_REWARD_ORE : 0, skrMotherlode: share * motherlodeSkr, lucky };
}

/** Your SOL if a spot you cover strikes: the smallest and largest payout over your spots, given the pot so far (yours included). */
export function strikeRange(pot: PotView, mask: number, perBlock: number) {
  let lo = Infinity;
  let hi = 0;
  for (let i = 0; i < BLOCKS; i++) {
    if (!(mask & (1 << i))) continue;
    const v = (perBlock / pot.perBlock[i]) * poolFor(pot, i);
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  return hi > 0 ? { lo, hi } : null;
}

/** SOL per spot that spreads `amount` over OPTIMAL_ROUNDS rounds on all 25 spots (at least the minimum). */
export const optimalPerSpot = (amount: number) =>
  Math.max(MIN_SOL_PER_BLOCK, Math.floor((amount / OPTIMAL_ROUNDS / BLOCKS) * 1e5) / 1e5);

export const fmtSol = (v: number, dp = 4) => (v >= 100 ? v.toFixed(1) : v.toFixed(dp).replace(/0+$/, '').replace(/\.$/, '.0'));
