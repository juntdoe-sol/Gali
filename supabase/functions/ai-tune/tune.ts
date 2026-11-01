// What Claude sees each hour and how its answer is applied. Pure, so the Node tests cover it without calling Claude.
import { BOUNDS, clampParams, LOSS, limitStep, type AiParams } from '../_shared/aiStrategy.ts';

export interface RoundRow {
  total: number; // lamports
  fee: number;
  ev: number;
  board_before: number;
  board_after: number | null;
  sol_back: number | null;
  ore_grams: number | null;
  won: boolean | null;
  motherlode: boolean | null;
  squares: number;
}

export interface Summary {
  plays: number;
  wallets: number;
  stakedSol: number;
  returnedSol: number;
  ore: number;
  /** after ORE's 10% claim fee, at today's price */
  oreValueSol: number;
  feesSol: number;
  netSol: number;
  /** net / staked */
  realizedReturn: number;
  /** what the plays expected (cautious), / staked */
  expectedReturn: number;
  winRate: number;
  /** squares covered / 25, averaged: the win rate a fair draw gives */
  fairWinRate: number;
  avgSquares: number;
  motherlodes: number;
  /** median share of SOL that landed on the AI's squares after it deployed */
  lateCrowdMedian: number | null;
  lateCrowdP80: number | null;
}

const quantile = (xs: number[], q: number) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

export function summarize(rows: (RoundRow & { wallet: string })[], oreSol: number): Summary {
  const sum = (f: (r: RoundRow) => number) => rows.reduce((n, r) => n + f(r), 0);
  const staked = sum((r) => r.total) / 1e9;
  const returned = sum((r) => r.sol_back ?? 0) / 1e9;
  const ore = sum((r) => r.ore_grams ?? 0) / 1e11;
  const fees = sum((r) => r.fee) / 1e9;
  const oreValue = ore * 0.9 * oreSol;
  const net = returned + oreValue - staked - fees;
  const late = rows
    .filter((r) => r.board_after !== null && r.board_before > 0)
    .map((r) => Math.max(0, (r.board_after! - r.board_before - r.total) / r.board_before));
  return {
    plays: rows.length,
    wallets: new Set(rows.map((r) => r.wallet)).size,
    stakedSol: staked,
    returnedSol: returned,
    ore,
    oreValueSol: oreValue,
    feesSol: fees,
    netSol: net,
    realizedReturn: staked > 0 ? net / staked : 0,
    expectedReturn: staked > 0 ? sum((r) => r.ev) / 1e9 / staked : 0,
    winRate: rows.length ? rows.filter((r) => r.won).length / rows.length : 0,
    fairWinRate: rows.length ? sum((r) => r.squares) / 25 / rows.length : 0,
    avgSquares: rows.length ? sum((r) => r.squares) / rows.length : 0,
    motherlodes: rows.filter((r) => r.motherlode).length,
    lateCrowdMedian: quantile(late, 0.5),
    lateCrowdP80: quantile(late, 0.8),
  };
}

export const SYSTEM = `You tune the settings of Gali AI, a bot that plays ORE's mining board on Solana for players who fund it.

How ORE pays: every round (about 80 seconds) players put SOL on any of 25 squares. One square wins, picked by a fair random draw that nobody can predict. ORE keeps 1% of every square and another 10% of the rest on the 24 squares that miss, and returns the rest. So about ${(LOSS * 100).toFixed(1)}% of every SOL staked is lost on average. The winning square also mines 1 ORE, shared by SOL on it (or, on some squares, all to one miner with odds equal to their share). One round in 500 the winning square also pays the motherlode pool, shared by SOL on it. Claiming ORE costs 10%.

How the bot plays: it waits until targetSlotsLeft slots (0.4 s each) before the round ends, reads the board, and stakes only squares where the expected ORE is worth more than the expected SOL loss plus a margin of minEdge per SOL. It assumes crowdBuffer more SOL (as a share of what is already there) will land on each square after it deploys. It never uses more than maxRoundShare of a player's balance in one round. It sits out rounds where nothing clears the margin. A bigger motherlode raises every square's prize, so the bot plays more when the pool is big: that is how it chases the motherlode without gambling.

Your job: from the results below, choose settings that keep players' balances growing over time and avoid large losses. Players asked for "play safe, don't lose much, be smart".
- Results swing a lot: a square wins 1 time in 25, and the motherlode hits 1 round in 500. Do not chase a few lucky or unlucky rounds. Under about 300 plays, stay close to the current settings unless something is clearly wrong.
- lateCrowdMedian/P80 measure how much SOL actually landed after the bot deployed. If they run above crowdBuffer, the bot is staking against a board that fills up after it: raise crowdBuffer, or deploy later (lower targetSlotsLeft, but never so late that sends miss the round).
- If realizedReturn is well below expectedReturn over many plays, be more cautious (higher minEdge or crowdBuffer). If the bot is almost never playing (very few plays), the margin may be too strict.
- maxRoundShare is the main protection against a bad streak. Keep it low unless results over many rounds justify more.

Allowed ranges: minEdge ${BOUNDS.minEdge.join('-')}, crowdBuffer ${BOUNDS.crowdBuffer.join('-')}, maxRoundShare ${BOUNDS.maxRoundShare.join('-')}, targetSlotsLeft ${BOUNDS.targetSlotsLeft.join('-')}. Each hour a setting can move at most a quarter of its range.

Players with a pass read your answers as an hourly log.
- "learned": two to four plain sentences on what this hour's numbers show (how often the bot played, how the board filled after it deployed, how real results compared with what it expected) and what you take from it. Use the numbers. Say so when there is too little data to learn anything yet.
- "note": one short sentence on what you changed and why, or why you kept things as they are.
No hype, no promises of profit, no jargon a casual player wouldn't follow.`;

export function prompt(current: AiParams, last24h: Summary, last7d: Summary, history: { at: string; note: string | null }[]): string {
  const fmt = (s: Summary) => JSON.stringify(s, (_k, v) => (typeof v === 'number' ? Number(v.toPrecision(5)) : v));
  return [
    `Current settings: ${JSON.stringify(current)}`,
    `Last 24 hours: ${fmt(last24h)}`,
    `Last 7 days: ${fmt(last7d)}`,
    `Your recent notes, newest first:\n${history.map((h) => `- ${h.at}: ${h.note ?? ''}`).join('\n') || '- none yet'}`,
    'Choose the settings for the next hour.',
  ].join('\n\n');
}

export const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    minEdge: { type: 'number' },
    crowdBuffer: { type: 'number' },
    maxRoundShare: { type: 'number' },
    targetSlotsLeft: { type: 'integer' },
    learned: { type: 'string' },
    note: { type: 'string' },
  },
  required: ['minEdge', 'crowdBuffer', 'maxRoundShare', 'targetSlotsLeft', 'learned', 'note'],
  additionalProperties: false,
} as const;

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Claude's answer, made safe: inside the bounds and at most a quarter-range step from the current settings. */
export function apply(answer: unknown, current: AiParams): { params: AiParams; note: string; learned: string } {
  const a = (answer && typeof answer === 'object' ? answer : {}) as Record<string, unknown>;
  const params = limitStep(clampParams(a, current), current);
  return { params, note: text(a.note, 280), learned: text(a.learned, 900) };
}
