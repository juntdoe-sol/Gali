/**
 * Expected value of a deploy into the live ORE round, from ORE's own payout rules and the SOL already on the board.
 *
 * For every spot you cover, with `a` SOL on it and `T` SOL already there:
 *   SOL back: ORE keeps 1% of every spot and 10% more of spots that miss. The gold spot is one in 25, so on average
 *             0.99 x (1/25 + 24/25 x 0.9) = 0.89496 of each SOL comes back.
 *   ORE:      the spot strikes 1 time in 25; then its 1 ORE (and, 1 round in MOTHERLODE_ODDS, the motherlode) is
 *             shared by SOL there, so your share is a / (T + a). A solo spot pays it all to one miner with odds equal
 *             to that same share, so the average is the same.
 * ORE is valued at today's ORE/SOL price, less ORE's 10% fee for claiming unrefined ORE. The Gali fee is a cost.
 * It is an average over many rounds; one round is all or nothing on the gold spot.
 */
import { BLOCKS, MOTHERLODE_ODDS } from './constants';

export const SOL_BACK = 0.99 * (1 / BLOCKS + ((BLOCKS - 1) / BLOCKS) * 0.9);
export const ORE_PER_ROUND = 1;
export const CLAIM_KEEP = 0.9;

export interface Ev {
  /** SOL in, including the Gali fee */
  cost: number;
  /** expected SOL back after ORE's fees */
  solBack: number;
  /** expected ORE (round reward + motherlode share) */
  ore: number;
  /** that ORE in SOL, after the 10% claim fee */
  oreSol: number;
  /** expected profit in SOL, and as a share of what goes in */
  ev: number;
  pct: number;
  /** the SOL per spot at which this plan breaks even (lower = more crowded spots still pay) */
  breakEvenT: number;
}

export function evOf(onBoard: number[], squares: number[], perSpot: number, orePool: number, orePriceInSol: number, feeBps: number): Ev | null {
  if (!squares.length || !(perSpot > 0) || !(orePriceInSol > 0)) return null;
  const prize = (ORE_PER_ROUND + Math.max(0, orePool) / MOTHERLODE_ODDS) * CLAIM_KEEP * orePriceInSol; // SOL value of a spot's whole prize
  const put = perSpot * squares.length;
  const cost = put * (1 + feeBps / 10_000);
  let ore = 0;
  for (const i of squares) {
    const t = Math.max(0, onBoard[i] ?? 0);
    ore += (1 / BLOCKS) * (perSpot / (t + perSpot)) * (ORE_PER_ROUND + Math.max(0, orePool) / MOTHERLODE_ODDS);
  }
  const oreSol = ore * CLAIM_KEEP * orePriceInSol;
  const solBack = put * SOL_BACK;
  const ev = solBack + oreSol - cost;
  // break-even crowd per spot for this stake: prize/25 x a/(T+a) = a x (1 + fee - SOL_BACK)
  const loss = 1 + feeBps / 10_000 - SOL_BACK;
  const breakEvenT = Math.max(0, prize / BLOCKS / loss - perSpot);
  return { cost, solBack, ore, oreSol, ev, pct: ev / cost, breakEvenT };
}
