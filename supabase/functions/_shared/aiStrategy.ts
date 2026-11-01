// Gali AI mining: what to play in an ORE round, and what a played round paid. Pure: no Deno or Node APIs, so the
// ai-miner and ai-tune functions and the Node tests share this one file.
//
// The draw is fair, so nothing here guesses the winning square. What it does:
//   1. Look at the board late in the round, when most of the SOL is already on it.
//   2. Play only squares where the ORE you can expect is worth more than the SOL ORE keeps, with a safety margin.
//   3. Stake each square the amount with the best expected return for how crowded it is.
//   4. Sit the round out when nothing clears the margin.
// The motherlode needs no special case: a bigger pool makes every square's prize bigger, so more squares clear the
// margin and stakes grow. When the pool is small the AI plays less.
//
// ORE's payout rules (ore program/src/checkpoint.rs, reset.rs): ORE keeps 1% of every square, and 10% more of the
// rest on squares that miss. The winning square (1 in 25) also mines the round's ORE: split by SOL on half the
// squares, all to one miner (odds equal to their share) on the other half. 1 round in 500 it also pays the
// motherlode, split by SOL on the winning square.

export const BLOCKS = 25;
export const LAMPORTS_PER_SOL = 1_000_000_000;
export const GRAMS_PER_ORE = 100_000_000_000;
export const MOTHERLODE_ODDS = 500;
/** ORE's 10% fee for claiming unrefined ORE. */
export const CLAIM_KEEP = 0.9;
/** Average share of each SOL that comes back: 99% on the winning square, 99% x 90% on the 24 that miss. */
export const SOL_BACK = 0.99 * (1 / BLOCKS + ((BLOCKS - 1) / BLOCKS) * 0.9);
/** Average share of each SOL that ORE keeps. */
export const LOSS = 1 - SOL_BACK;
/** Smallest stake worth placing on a square. */
export const MIN_STAKE = 100_000n; // 0.0001 SOL
/** An empty square is treated as holding this much, so the AI does not size against nothing: someone usually lands. */
export const EMPTY_FLOOR = 1_000_000; // 0.001 SOL
/** ORE's deploy takes one amount for a set of squares, so stakes are grouped. Keeps the transaction small. */
export const MAX_GROUPS = 4;
/** Discretionary automations pay the executor this much per round played. Covers the transaction, no margin. */
export const AI_EXECUTOR_FEE = 10_000n;

/** The settings Claude tunes once an hour. Code clamps every value to BOUNDS, whatever comes back. */
export interface AiParams {
  /** Extra return a square must promise on top of breaking even, per SOL staked (0.08 = 8%). */
  minEdge: number;
  /** SOL expected to land after the AI deploys, as a share of what was on the square (0.25 = 25% more). */
  crowdBuffer: number;
  /** Most of the automation's balance one round may use (0.05 = 5%). */
  maxRoundShare: number;
  /** Deploy when this many slots are left in the round (about 0.4 s each). ORE locks the last 15. */
  targetSlotsLeft: number;
}

export const DEFAULT_PARAMS: AiParams = { minEdge: 0.08, crowdBuffer: 0.25, maxRoundShare: 0.05, targetSlotsLeft: 22 };

export const BOUNDS: Record<keyof AiParams, [number, number]> = {
  minEdge: [0.02, 0.5],
  crowdBuffer: [0, 1.5],
  maxRoundShare: [0.01, 0.25],
  targetSlotsLeft: [18, 45],
};

/** Every param inside its bounds, missing or broken values replaced by `base`. */
export function clampParams(p: unknown, base: AiParams = DEFAULT_PARAMS): AiParams {
  const src = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
  const out = { ...base };
  for (const k of Object.keys(BOUNDS) as (keyof AiParams)[]) {
    const v = Number(src[k]);
    if (!Number.isFinite(v)) continue;
    const [lo, hi] = BOUNDS[k];
    out[k] = Math.min(hi, Math.max(lo, v));
  }
  out.targetSlotsLeft = Math.round(out.targetSlotsLeft);
  return out;
}

/** Moves each param at most `step` of its range away from `prev`, so one bad hour cannot swing the strategy. */
export function limitStep(next: AiParams, prev: AiParams, step = 0.25): AiParams {
  const out = { ...next };
  for (const k of Object.keys(BOUNDS) as (keyof AiParams)[]) {
    const [lo, hi] = BOUNDS[k];
    const d = (hi - lo) * step;
    out[k] = Math.min(prev[k] + d, Math.max(prev[k] - d, next[k]));
  }
  return clampParams(out, prev);
}

/** The SOL value (in lamports) of one square's whole prize: 1 ORE plus the motherlode's expected share, after the claim fee. */
export function prizeLamports(motherlodeGrams: bigint, orePriceSol: number): number {
  if (!(orePriceSol > 0)) return 0;
  const ore = 1 + Number(motherlodeGrams) / GRAMS_PER_ORE / MOTHERLODE_ODDS;
  return ore * CLAIM_KEEP * orePriceSol * LAMPORTS_PER_SOL;
}

/** Expected profit in lamports of staking `a` on a square holding `t`, for a square prize worth `prize`. */
export const squareEv = (a: number, t: number, prize: number) => (prize / BLOCKS) * (a / (t + a)) - LOSS * a;

export interface PlanInput {
  /** Lamports on each of the 25 squares right now. */
  onBoard: bigint[];
  /** Grams of ORE in the motherlode pool (ORE's Treasury). */
  motherlodeGrams: bigint;
  /** What one ORE is worth in SOL. */
  orePriceSol: number;
  /** The player's most per square (the automation's amount). */
  maxPerSquare: bigint;
  /** The automation's balance. */
  balance: bigint;
  params: AiParams;
}

export interface Plan {
  /** One deploy each: `amount` lamports on every square in `mask`. */
  groups: { amount: bigint; mask: number }[];
  /** Lamports staked in all. */
  total: bigint;
  squares: number[];
  /** Expected profit in lamports, after the executor fee, with the crowd buffer applied (so on the cautious side). */
  ev: number;
  /** Lamports already on the chosen squares when the plan was made. */
  boardBefore: bigint;
}

/** `x` rounded down to two significant digits (123_456 -> 120_000), so amounts read cleanly on an explorer. */
export function roundDown2(x: number): number {
  if (!(x >= 1)) return 0;
  const p = 10 ** Math.max(0, Math.floor(Math.log10(x)) - 1);
  return Math.floor(x / p) * p;
}

/**
 * Splits stakes (largest first) into at most `k` runs; each run plays its smallest stake on all its squares.
 * Picks the split that keeps the most SOL staked. Every square gets at most its own stake, so it stays +EV.
 */
export function groupStakes(stakes: { s: number; a: number }[], k: number): { amount: number; squares: number[] }[] {
  const xs = [...stakes].sort((x, y) => y.a - x.a);
  const n = xs.length;
  // best[g][i]: most staked using g runs over the first i stakes
  const best = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(-Infinity));
  const cut = Array.from({ length: k + 1 }, () => new Array<number>(n + 1).fill(0));
  best[0][0] = 0;
  for (let g = 1; g <= k; g++)
    for (let i = 1; i <= n; i++)
      for (let j = g - 1; j < i; j++) {
        const v = best[g - 1][j] + roundDown2(xs[i - 1].a) * (i - j);
        if (v > best[g][i]) {
          best[g][i] = v;
          cut[g][i] = j;
        }
      }
  let g = 1;
  for (let q = 1; q <= k; q++) if (best[q][n] > best[g][n]) g = q;
  const out: { amount: number; squares: number[] }[] = [];
  for (let i = n; g > 0 && i > 0; g--) {
    const j = cut[g][i];
    out.push({ amount: roundDown2(xs[i - 1].a), squares: xs.slice(j, i).map((x) => x.s) });
    i = j;
  }
  return out.reverse();
}

/**
 * What to play this round, or null to sit it out.
 * Every stake is rounded down, never up, so rounding can only make a square safer.
 */
export function planRound(i: PlanInput): Plan | null {
  const p = i.params;
  const prize = prizeLamports(i.motherlodeGrams, i.orePriceSol);
  if (!(prize > 0) || i.onBoard.length !== BLOCKS) return null;
  const budget = Math.min(Number(i.balance) * p.maxRoundShare, Number(i.balance - AI_EXECUTOR_FEE));
  const cap = Number(i.maxPerSquare);
  if (!(budget >= Number(MIN_STAKE)) || !(cap >= Number(MIN_STAKE))) return null;
  // what a stake must cost us per lamport for the margin to hold
  const cost = LOSS + p.minEdge;
  const crowd = (s: number) => Math.max(EMPTY_FLOOR, Number(i.onBoard[s]) * (1 + p.crowdBuffer));

  // best stake per square: maximise prize/25 x a/(t+a) - cost x a  =>  a = sqrt(t x prize / (25 cost)) - t
  let stakes: { s: number; a: number }[] = [];
  for (let s = 0; s < BLOCKS; s++) {
    const t = crowd(s);
    const a = Math.min(cap, Math.sqrt((t * prize) / (BLOCKS * cost)) - t);
    if (a >= Number(MIN_STAKE)) stakes.push({ s, a });
  }
  if (!stakes.length) return null;

  // over budget: shrink every stake by the same factor. Smaller stakes on a +EV square stay +EV.
  const sum = stakes.reduce((n, x) => n + x.a, 0);
  if (sum > budget) stakes = stakes.map((x) => ({ s: x.s, a: (x.a * budget) / sum })).filter((x) => x.a >= Number(MIN_STAKE));

  const groups: Plan['groups'] = [];
  const squares: number[] = [];
  let total = 0n;
  let ev = -Number(AI_EXECUTOR_FEE);
  let boardBefore = 0n;
  for (const { amount, squares: ss } of groupStakes(stakes, MAX_GROUPS)) {
    if (amount < Number(MIN_STAKE)) continue;
    let mask = 0;
    for (const s of ss) {
      mask |= 1 << s;
      squares.push(s);
      ev += squareEv(amount, crowd(s), prize);
      boardBefore += i.onBoard[s];
    }
    groups.push({ amount: BigInt(amount), mask });
    total += BigInt(amount) * BigInt(ss.length);
  }
  if (!groups.length || ev <= 0 || total + AI_EXECUTOR_FEE > i.balance) return null;
  squares.sort((a, b) => a - b);
  return { groups, total, squares, ev, boardBefore };
}

/** Adds a plan's stakes to the board, so the next automation in the same round sees them. */
export function addToBoard(onBoard: bigint[], plan: Plan): bigint[] {
  const out = [...onBoard];
  for (const g of plan.groups) for (let s = 0; s < BLOCKS; s++) if (g.mask & (1 << s)) out[s] += g.amount;
  return out;
}

// ---------------- what a played round paid ----------------

const u64le = (b: Uint8Array, o: number) => {
  let v = 0n;
  for (let k = 7; k >= 0; k--) v = (v << 8n) | BigInt(b[o + k]);
  return v;
};
const MASK64 = (1n << 64n) - 1n;
/** Rust's u64::reverse_bits. */
export function reverseBits64(x: bigint): bigint {
  let v = x & MASK64;
  let r = 0n;
  for (let k = 0; k < 64; k++) {
    r = (r << 1n) | (v & 1n);
    v >>= 1n;
  }
  return r;
}

/** ORE's round rng (Round::rng): the four u64 words of the entropy XORed, or null while undrawn or refunded. */
export function roundRng(entropy: Uint8Array): bigint | null {
  if (entropy.length !== 32 || entropy.every((b) => b === 0) || entropy.every((b) => b === 0xff)) return null;
  return u64le(entropy, 0) ^ u64le(entropy, 8) ^ u64le(entropy, 16) ^ u64le(entropy, 24);
}

export interface DrawnRound {
  deployed: bigint[];
  entropy: Uint8Array;
  /** ORE paid as the motherlode this round, in grams (0 when it did not hit). */
  motherlode: bigint;
  /** The round's ORE reward, in grams (sum of Round.rewards). */
  reward: bigint;
  /** True when the winning square's ORE is split by SOL (Round.top_miner is ORE's SPLIT_ADDRESS). */
  split: boolean;
}

export interface Settled {
  winningSquare: number;
  /** SOL returned to the miner, lamports. */
  solBack: bigint;
  /** ORE mined, grams (round reward share + motherlode share). */
  oreGrams: bigint;
  won: boolean;
  motherlode: boolean;
  /** False when the solo ORE could not be worked out (the miner's cumulative was not known). */
  exact: boolean;
}

/**
 * The same arithmetic as ORE's checkpoint for one miner's position. `cumulative` is the miner's Miner.cumulative
 * (SOL already on each square when they deployed there); only the solo ORE needs it. Null while undrawn.
 */
export function settleRound(r: DrawnRound, deployed: bigint[], cumulative: bigint[] | null): Settled | null {
  const rng = roundRng(r.entropy);
  if (rng === null) return null;
  const win = Number(rng % 25n);
  let solBack = 0n;
  let oreGrams = 0n;
  let exact = true;
  for (let s = 0; s < BLOCKS; s++) {
    const mine = deployed[s] ?? 0n;
    if (mine === 0n) continue;
    const total = r.deployed[s];
    if (total <= 0n) continue;
    const admin = total / 100n > 0n ? total / 100n : 1n;
    if (s === win) {
      solBack += (mine * (total - admin)) / total;
      if (r.split) oreGrams += (r.reward * mine) / total;
      else if (cumulative) {
        const sample = reverseBits64(rng) % total;
        if (sample >= cumulative[s] && sample < cumulative[s] + mine) oreGrams += r.reward;
      } else exact = false;
      if (r.motherlode > 0n) oreGrams += (r.motherlode * mine) / total;
    } else {
      const protocol = (total - admin) / 10n > 0n ? (total - admin) / 10n : 1n;
      const back = total - admin - protocol;
      solBack += (mine * (back > 0n ? back : 0n)) / total;
    }
  }
  return { winningSquare: win, solBack, oreGrams, won: (deployed[win] ?? 0n) > 0n, motherlode: r.motherlode > 0n && (deployed[win] ?? 0n) > 0n, exact };
}
