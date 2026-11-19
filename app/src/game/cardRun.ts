/**
 * A Mining Card's autopilot run, from redeeming the code to the summary at the end (game/miningCards.ts).
 *
 * 1. Redeemed: the server added the XP and booked the pack. The card's SOL comes from Gali's house wallet; until its
 *    payout shows on the card (payout_sig), the run waits ("pending"), kept on this device.
 * 2. Paid out ("ready"): the player taps CLAIM NOW and the app starts an all-spots autopilot sized to the card's
 *    SOL (setup and fees included).
 * 3. Running: each autopilot round's result is added up; the mining panel shows progress and the time left.
 * 4. Done (the planned rounds played, or autopilot stopped): the summary shows what the card brought in.
 */
import { create } from 'zustand';
import { PLATFORM_FEE_BPS } from '../chain/light';
import { BLOCKS } from './constants';
import { playCards } from './play';
import { loadJson, saveJson } from './storage';
import { useGame } from './store';

const KEY = 'gali-card-run-v1';
const LITE_PER_ROUND = 0.01;
const EXEC_FEE = 0.00001;
const SETUP = 0.0065;

export interface CardRun {
  code: string;
  value: number;
  lamports: number;
  state: 'pending' | 'ready' | 'running' | 'done';
  rounds: number;
  played: number;
  solIn: number;
  solOut: number;
  ore: number;
  wins: number;
  startedAt?: number;
}

interface CardRunState {
  run: CardRun | null;
  /** the summary window is open */
  summary: boolean;
  closeSummary: () => void;
}

export const useCardRun = create<CardRunState>((set) => ({
  run: null,
  summary: false,
  closeSummary: () => {
    set({ summary: false, run: null });
    saveJson(KEY, { run: null }, 0);
  },
}));

const save = (run: CardRun | null) => {
  useCardRun.setState({ run });
  saveJson(KEY, { run }, 0);
};

/** Rounds of 0.01 SOL across all 25 spots that the card's SOL covers, with setup and fees. */
export function roundsFor(lamports: number): number {
  const sol = lamports / 1e9;
  const per = LITE_PER_ROUND + EXEC_FEE + (LITE_PER_ROUND * Number(PLATFORM_FEE_BPS)) / 10_000;
  return Math.max(0, Math.floor((sol - SETUP) / per));
}

/** About how long a live ORE round takes, for the time-left estimate. */
export const CARD_ROUND_SECS = 80;

/** Called after a code is redeemed: ready to claim when the SOL is already paid out, otherwise it waits for it. */
export function beginCardRun(code: string, value: number, lamports: number, paidOut: boolean) {
  save({ code, value, lamports, state: paidOut ? 'ready' : 'pending', rounds: roundsFor(lamports), played: 0, solIn: 0, solOut: 0, ore: 0, wins: 0 });
}

/** CLAIM NOW: start the card's autopilot. */
export async function claimCard() {
  const run = useCardRun.getState().run;
  if (!run || run.state !== 'ready' || run.rounds < 1) return;
  const g = useGame.getState();
  if (g.autopilot || g.run) {
    g.toast('Your card is ready. Stop the autopilot that is running, then it starts.', 'info');
    return;
  }
  await g.startRun({
    kind: 'lite',
    perRound: LITE_PER_ROUND,
    perSpot: LITE_PER_ROUND / BLOCKS,
    blocks: 'all',
    smartN: BLOCKS,
    manualMask: (1 << BLOCKS) - 1,
    total: run.rounds,
  });
  if (useGame.getState().run) save({ ...run, state: 'running', startedAt: Date.now() });
}

/** A waiting card checks whether its SOL has arrived (the payout is written on the card by the server). */
export async function checkPendingCard() {
  const run = useCardRun.getState().run;
  if (!run || run.state !== 'pending') return;
  const cards = await playCards();
  const mine = cards?.redeemed.find((c) => c.code === run.code);
  if (mine?.payout_sig) {
    save({ ...run, state: 'ready' });
    useGame.getState().toast(`Your $${run.value} card's SOL arrived. Tap CLAIM NOW in the mining panel`, 'good');
  }
}

let started = false;
/** Load a card run kept on this device and follow autopilot rounds. Once, at app start. */
export function watchCardRun() {
  if (started) return;
  started = true;
  void loadJson<{ run: CardRun | null }>(KEY, { run: null }).then(({ run }) => {
    if (!run) return;
    useCardRun.setState({ run, summary: run.state === 'done' });
  });
  useGame.subscribe((s, p) => {
    const run = useCardRun.getState().run;
    if (!run || run.state !== 'running') return;
    const r = s.lastResult;
    if (r && r !== p.lastResult && r.auto && r.onChain) {
      const next = { ...run, played: run.played + 1, solIn: run.solIn + r.solIn, solOut: run.solOut + r.solOut, ore: run.ore + r.oreMined, wins: run.wins + (r.won ? 1 : 0) };
      const done = next.played >= next.rounds;
      save(done ? { ...next, state: 'done' } : next);
      if (done) useCardRun.setState({ summary: true });
      return;
    }
    // stopped early: autopilot closed (or the run ended) before every round played
    if (p.run && !s.run && !s.autopilot && run.played > 0) {
      save({ ...run, state: 'done' });
      useCardRun.setState({ summary: true });
    }
  });
  setInterval(() => void checkPendingCard(), 60_000);
}
