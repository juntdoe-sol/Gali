import { create } from 'zustand';
import type { Keypair, PublicKey } from '@solana/web3.js';
import { loadBoard, loadChain, loadOreTx } from '../chain/lazy';
import {
  chainReady, clockOffsetMs, isPickWalletError, isRateLimited, LIVE_MAX_ROUND_SOL, MAX_SESSION_FUND_SOL, NOTHING_CLAIMABLE,
  onChainMode, oreLive, REFINING_FEE, short,
  type ChainPlayer, type Claimable, type ShopConfig, type WebWalletInfo,
} from '../chain/light';
import {
  ACHIEVEMENTS, BLOCKS, boostFor, FREE_GEAR_MASK, GEAR, LOCK_MS, localDay, levelFromXp, MOTHERLODE_ODDS,
  pointsFor, QUESTS, REVEAL_MIN_MS, ROUND_REWARD_ORE, ROUND_SECS, type Gear,
} from './constants';
import { addToPot, emptyPot, idxOf, maskOf, MIN_SOL_PER_BLOCK, payoutFor, practiceMotherlode, practiceOreMotherlode, PRACTICE_SOL, randomPick, simPot, soloMask, DEFAULT_SMART, SMART_COUNTS, type PotView } from './pot';
import { haptic, play, setMuted } from './sfx';
import { loadJson, saveJson } from './storage';

export type Phase = 'mining' | 'settling' | 'reveal';

export interface RoundResult {
  roundId: number;
  winning: number;
  covered: number;
  won: boolean;
  points: number;
  motherlode: boolean;
  onChain: boolean;
  skr: number; // your share of Gali's SKR Motherlode Pool
  oreMotherlode: number; // your share of ORE's own motherlode
  solIn: number; // SOL deployed this round
  solOut: number; // SOL given back this round (after fees; credited to Unclaimed)
  oreMined: number; // ORE the gold spot mined this round
  split?: boolean; // the round's SKR was split (false: a solo spot won and one miner took it)
  lucky?: boolean; // you were the lucky winner
}

export interface Preset {
  amount: string; // older saves: SOL per round (no longer used)
  perSpot?: string; // SOL on each spot, like the amount per block on other mining boards
  blocks: 'manual' | 'all' | 'smart';
  smartN: number;
  rounds: number;
}
const defaultPresets = (): Preset[] => [
  { amount: '', perSpot: '0.001', blocks: 'manual', smartN: 8, rounds: 1 },
  { amount: '', perSpot: '0.001', blocks: 'smart', smartN: 8, rounds: 5 },
  { amount: '', perSpot: '0.0005', blocks: 'smart', smartN: 15, rounds: 10 },
  { amount: '', perSpot: '0.0002', blocks: 'all', smartN: 25, rounds: 20 },
];

export type DockTab = 'lite' | 'pro';
export type LiteMode = 'all' | 'smart' | 'pick';

export interface Run {
  kind: 'lite' | 'pro';
  perRound: number; // SOL (LITE: spread over the spots)
  perSpot?: number; // PRO: fixed SOL on each spot
  blocks: Preset['blocks'];
  smartN: number;
  manualMask: number;
  total: number; // rounds planned
  left: number;
  lastRound: number;
}

export interface Pending {
  roundId: number;
  mask: number;
  boostBps: number;
  onChain: boolean;
  perBlock: number; // SOL on each covered block
  total: number; // SOL deployed
}

export interface Toast {
  id: number;
  text: string;
  tone: 'good' | 'bad' | 'info' | 'gold';
}

export interface Save {
  xp: number; // practice xp + quest/mole bonus xp
  bonusXp: number; // quest/mole xp that isn't on-chain
  points: number; // practice points
  wins: number;
  digs: number; // rounds played in practice mode
  dayStreak: number;
  lastDigDay: string;
  winStreak: number;
  bestStreak: number;
  moles: number;
  achievements: string[];
  questDay: string;
  questProgress: Record<string, number>;
  questClaimed: string[];
  history: RoundResult[];
  pickaxe: string;
  helmet: string;
  outfit: string;
  pet: string | null;
  practiceSol: number;
  practiceSkr: number; // SKR "mined" in practice mode (not real)
  /** on-chain rounds we deployed in and haven't settled yet; retried in the background */
  unsettled: number[];
  practiceUnclaimedSol: number;
  practiceUnclaimedSkr: number; // unrefined
  practiceRefinedSkr: number;
  presets: Preset[];
  preset: number;
  muted: boolean;
  onboarded: boolean;
  /** Accepted the real-money notice for live ORE rounds. */
  liveAccepted: boolean;
}

const SAVE_KEY = 'gali-save-v2';
const freshSave = (): Save => ({
  xp: 0,
  bonusXp: 0,
  points: 0,
  wins: 0,
  digs: 0,
  dayStreak: 0,
  lastDigDay: '',
  winStreak: 0,
  bestStreak: 0,
  moles: 0,
  achievements: [],
  questDay: localDay(),
  questProgress: {},
  questClaimed: [],
  history: [],
  pickaxe: 'pick-wood',
  helmet: 'hat-yellow',
  outfit: 'fit-blue',
  pet: null,
  practiceSol: PRACTICE_SOL,
  practiceSkr: 0,
  unsettled: [],
  practiceUnclaimedSol: 0,
  practiceUnclaimedSkr: 0,
  practiceRefinedSkr: 0,
  presets: defaultPresets(),
  preset: 0,
  muted: false,
  onboarded: false,
  liveAccepted: false,
});

interface Wallet {
  owner: string | null;
  player: ChainPlayer | null;
  skr: number;
  sol: number;
  sessionSol: number;
  pool: number; // SKR in Gali's Motherlode Pool
  orePool: number; // ORE in ORE's own motherlode
  ore: number; // ORE in the wallet
  shop: ShopConfig | null; // gear prices and token rates from the config
  unclaimed: Claimable;
  busy: string | null;
}

/** ORE's board clock, in live mode. `endsAt` is chain-time ms, 0 while the round waits for its first deploy. */
export interface LiveClock {
  roundId: number;
  phase: 'waiting' | 'mining' | 'intermission';
  endsAt: number;
  /** ORE's solo squares for this round, as a bitmask. */
  solo: number;
}

interface GameState {
  loaded: boolean;
  liveClock: LiveClock | null;
  /** The real-money notice is up. A string is the web wallet to connect once accepted. */
  liveNotice: boolean | string;
  save: Save;
  wallet: Wallet;
  offsetMs: number;
  now: number;
  roundId: number;
  phase: Phase;
  settleStartAt: number;
  revealStartAt: number;
  /** the round being revealed hit ORE's motherlode */
  revealMotherlode: boolean;
  winning: number | null;
  pending: Pending | null;
  pot: PotView;
  potAt: number;
  run: Run | null;
  dockTab: DockTab;
  /** LITE's spot choice: all 25, Smart (random liteSmart spots) or the spots picked by hand. */
  liteMode: LiteMode;
  liteSmart: number;
  /** The LITE / PRO panel. Closed by default; the MINE button opens it. */
  dockOpen: boolean;
  selected: number[];
  lastResult: RoundResult | null;
  resultAt: number;
  toasts: Toast[];
  levelUp: number | null;
  emote: number;
  gearReveal: string | null;
  /** web only: wallets to choose from when several are installed */
  walletPicker: WebWalletInfo[] | null;

  boot: () => Promise<void>;
  tick: () => void;
  toggleBlock: (i: number) => void;
  selectRandom: (n: number) => void;
  selectAll: () => void;
  clearSelection: () => void;
  shakePick: () => void;
  bonkMole: () => void;
  doEmote: () => void;
  claimQuest: (id: string) => void;
  equip: (key: string) => void;
  buyGear: (key: string, pay?: 'skr' | 'ore') => Promise<void>;
  stake: (amount: number) => Promise<void>;
  unstake: (amount: number) => Promise<void>;
  claimRewards: (what: 'sol' | 'skr') => Promise<void>;
  sweepSession: () => Promise<void>;
  connect: (webWallet?: string) => Promise<void>;
  acceptLive: () => void;
  declineLive: () => void;
  closeWalletPicker: () => void;
  disconnect: () => Promise<void>;
  refreshWallet: () => Promise<void>;
  airdrop: () => Promise<void>;
  setMute: (m: boolean) => void;
  finishOnboarding: () => void;
  toast: (text: string, tone?: Toast['tone']) => void;
  setDockTab: (t: DockTab) => void;
  setLiteSmart: (n: number) => void;
  setLiteMode: (m: LiteMode) => void;
  setDockOpen: (open: boolean) => void;
  startRun: (r: Omit<Run, 'left' | 'lastRound'>) => Promise<void>;
  stopRun: () => void;
  refreshPot: () => Promise<void>;
  choosePreset: (i: number) => void;
  editPreset: (p: Partial<Preset>) => void;
  refillPractice: () => void;
  session: () => Keypair | null;
  dismissLevel: () => void;
  dismissGear: () => void;
}

let toastId = 1;
const NO_UNCLAIMED: Claimable = NOTHING_CLAIMABLE;
/** Practice mode: other (simulated) miners' refining fees add this share of your unrefined SKR each round. */
const PRACTICE_REFINE_RATE = 0.003;
let lastClockSync = Date.now();
let session: Keypair | null = null;
const chainNow = (offset: number) => Date.now() + offset;
const roundOf = (t: number) => Math.floor(t / 1000 / ROUND_SECS);
export const roundEnd = (rid: number) => (rid + 1) * ROUND_SECS * 1000;

/** ORE's mining window: 200 slots of about 400 ms. */
export const LIVE_SPAN_MS = 80_000;
/** Live deploys stop this long before ORE closes the round: a wallet approval takes a few seconds. */
export const LIVE_LOCK_MS = 10_000;
/** SOL kept back for fees and, on a first deploy, the rent of ORE's miner account (about 0.0061 SOL). */
const LIVE_FEE_SOL = 0.008;

type Clocked = Pick<GameState, 'wallet' | 'roundId' | 'liveClock'>;
/** Live mode: a mainnet build with a wallet connected plays ORE's real board. */
export const isLive = (s: Pick<GameState, 'wallet'>) => Boolean(oreLive && s.wallet.owner);
/** Any on-chain play: Gali's program, or ORE's board in live mode. */
export const isOnChain = (s: Pick<GameState, 'wallet'>) => Boolean(s.wallet.owner && onChainMode);
/** When the current round's mining closes, in chain-time ms. 0 while a live round waits for its first deploy. */
export const roundEndsAt = (s: Clocked) => (isLive(s) ? (s.liveClock?.roundId === s.roundId ? s.liveClock.endsAt : 0) : roundEnd(s.roundId));
/** How long a round's mining window is, for the timer bar. */
export const roundSpanMs = (s: Pick<GameState, 'wallet'>) => (isLive(s) ? LIVE_SPAN_MS : ROUND_SECS * 1000);
/** The round's solo squares: ORE's real ones in live mode, the practice board's otherwise. */
export const soloOf = (s: Pick<GameState, 'wallet' | 'liveClock'>, rid: number) =>
  isLive(s) ? (s.liveClock?.roundId === rid ? s.liveClock.solo : 0) : soloMask(rid);
/** The round a deploy would go into right now. */
const curRound = (s: Clocked & Pick<GameState, 'offsetMs'>) => (isLive(s) ? (s.liveClock?.roundId ?? s.roundId) : roundOf(chainNow(s.offsetMs)));
/** Whether a deploy can still make the current round, leaving `marginMs` spare. */
const deployOpen = (s: Clocked & Pick<GameState, 'offsetMs'>, marginMs: number) => {
  const now = chainNow(s.offsetMs);
  if (!isLive(s)) return roundEnd(roundOf(now)) - now > LOCK_MS + marginMs;
  const c = s.liveClock;
  return Boolean(c && (c.phase === 'waiting' || (c.phase === 'mining' && c.endsAt - now > LIVE_LOCK_MS)));
};
const errMsg = (e: unknown) => {
  const m = String((e as Error)?.message ?? e);
  if (/RoundLocked/.test(m)) return 'Round is locking. Try next round';
  if (/LiveCap/.test(m)) return `Live rounds are capped at ${LIVE_MAX_ROUND_SOL} SOL`;
  if (/Paused/.test(m)) return 'Gali is paused for maintenance. Try again soon';
  if (/insufficient|0x1\b/i.test(m)) return 'Not enough balance';
  if (/declined|cancel|rejected/i.test(m)) return 'Cancelled in wallet';
  if (/found no installed|wallet/i.test(m) && /not found|no.*wallet/i.test(m)) return 'No Solana wallet app found';
  // a failed simulation: keep the part that says which instruction failed and why
  const ix = m.match(/Error processing Instruction (\d+): ([^\n]+?)(?:\.\s|\n|$)/);
  if (ix) {
    const logs = (e as { logs?: string[] })?.logs ?? [];
    console.warn('[gali] transaction failed', m, logs);
    return `Transaction failed at step ${Number(ix[1]) + 1}: ${ix[2].slice(0, 70)}`;
  }
  return m.length > 90 ? `${m.slice(0, 90)}…` : m;
};

function rollDay(s: Save): Save {
  const today = localDay();
  let out = s;
  if (s.questDay !== today) out = { ...out, questDay: today, questProgress: {}, questClaimed: [] };
  return out;
}

function checkAchievements(s: Save, extra: { staked: number; wins: number; xp: number }, push: (t: string) => void): Save {
  const has = new Set(s.achievements);
  const last = s.history[0];
  const checks: Record<string, boolean> = {
    'first-dig': s.digs > 0,
    'first-win': extra.wins > 0,
    'wins-10': extra.wins >= 10,
    sniper: Boolean(last?.won && last.covered === 1),
    motherlode: s.history.some((h) => h.motherlode && h.won),
    'lvl-5': levelFromXp(extra.xp) >= 5,
    'hot-3': s.bestStreak >= 3,
    'moles-10': s.moles >= 10,
    staker: extra.staked > 0,
    'streak-3': s.dayStreak >= 3,
  };
  const add = ACHIEVEMENTS.filter((a) => checks[a.id] && !has.has(a.id));
  if (!add.length) return s;
  add.forEach((a) => push(`Achievement: ${a.label}`));
  return { ...s, achievements: [...s.achievements, ...add.map((a) => a.id)] };
}

export const useGame = create<GameState>((set, get) => {
  const persist = (save: Save) => saveJson(SAVE_KEY, { ...save, history: save.history.slice(0, 30) });
  const totalXp = () => {
    const { save, wallet } = get();
    return wallet.player ? wallet.player.xp + save.bonusXp : save.xp;
  };
  const totalWins = () => get().wallet.player?.wins ?? get().save.wins;
  const staked = () => get().wallet.player?.stakedSkr ?? 0;
  /** The connected wallet as a PublicKey. Loads the chain code, so only on-chain paths call it. */
  const ownerKey = async (): Promise<PublicKey | null> => {
    const o = get().wallet.owner;
    if (!o) return null;
    const chain = await loadChain();
    return new chain.PublicKey(o);
  };
  const setWallet = (w: Partial<Wallet>) => set((st) => ({ wallet: { ...st.wallet, ...w } }));
  const updateSave = (fn: (s: Save) => Save) => {
    const before = levelFromXp(totalXp());
    let s = fn(rollDay(get().save));
    s = checkAchievements(s, { staked: staked(), wins: totalWins(), xp: totalXp() }, (t) => get().toast(t, 'gold'));
    set({ save: s });
    persist(s);
    const after = levelFromXp(totalXp());
    if (after > before) set({ levelUp: after });
  };

  async function ensureSession(owner: PublicKey, needSol: number) {
    const chain = await loadChain();
    session = session ?? (await chain.loadSession(owner));
    const p = get().wallet.player;
    const valid = p && p.session === session.publicKey.toBase58() && p.sessionExpires * 1000 > chainNow(get().offsetMs) + 120_000;
    const sessionSol = await chain.fetchSolBalance(session.publicKey);
    if (valid && sessionSol > Math.max(0.005, needSol + 0.004)) return session;
    setWallet({
      busy: `Approve: fund your 24h miner session with ${Math.min(MAX_SESSION_FUND_SOL, needSol + 0.01).toFixed(3)} SOL`,
    });
    await chain.startSession(owner, session, Boolean(p), needSol);
    await get().refreshWallet();
    get().toast('Session started. Rounds now run without pop-ups', 'good');
    return session;
  }

  async function settle(roundId: number) {
    const { pending, offsetMs } = get();
    if (!pending) return;
    if (pending.onChain) updateSave((sv) => ({ ...sv, unsettled: [...new Set([...(sv.unsettled ?? []), roundId])] }));
    let winning: number;
    let motherlode = false;
    let solOut = 0;
    let oreMined = 0;
    let skr = 0; // share of Gali's SKR Motherlode Pool
    let oreMotherlode = 0; // share of ORE's motherlode
    let split = true;
    let lucky = false;
    if (pending.onChain) {
      try {
        const owner = await ownerKey();
        if (!owner) throw new Error('wallet disconnected');
        const board = await loadBoard();
        let r: Awaited<ReturnType<typeof board.readOutcome>>;
        if (isLive(get())) {
          // ORE draws the round a few seconds after mining closes; wait for it
          for (let i = 0; ; i++) {
            if (await board.isRoundDrawn(roundId).catch(() => false)) break;
            if (i >= 45) throw new Error('The round is taking a while to draw');
            await new Promise((res) => setTimeout(res, 2000));
          }
          r = await board.readOutcome(owner, roundId);
        } else {
          if (!session) throw new Error('wallet disconnected');
          r = await board.settleAndRead(owner, session, roundId);
        }
        winning = r.winning;
        motherlode = r.motherlode;
        solOut = r.payout;
        oreMined = r.oreMined;
        oreMotherlode = r.oreMotherlode;
        // Gali's SKR jackpot splits by the same share; the player claims it with claim_jackpot
        skr = r.motherlode ? r.share * get().wallet.pool : 0;
        split = r.split;
        lucky = r.lucky;
      } catch (e) {
        const busy = isRateLimited(e);
        get().toast(busy ? 'The network is busy. This round will settle on its own.' : `Couldn't settle round: ${errMsg(e)}`, busy ? 'info' : 'bad');
        set({ phase: 'mining', pending: null, roundId: isLive(get()) ? curRound(get()) : roundOf(chainNow(offsetMs)) });
        return; // the round stays in save.unsettled and is retried in the background
      }
      updateSave((sv) => ({ ...sv, unsettled: (sv.unsettled ?? []).filter((r) => r !== roundId) }));
    } else {
      await new Promise((r) => setTimeout(r, 900));
      winning = Math.floor(Math.random() * BLOCKS);
      motherlode = Math.random() < 1 / MOTHERLODE_ODDS;
      split = (soloMask(roundId) & (1 << winning)) === 0;
      const final = addToPot(simPot(roundId, 1), pending.mask, pending.perBlock);
      const pay = payoutFor(
        final,
        winning,
        pending.perBlock,
        pending.mask,
        motherlode ? practiceMotherlode(roundId) : 0,
        motherlode ? practiceOreMotherlode(roundId) : 0,
        split,
        Math.random(),
      );
      solOut = pay.sol;
      oreMined = pay.ore;
      skr = pay.skrMotherlode;
      oreMotherlode = pay.oreMotherlode;
      lucky = pay.lucky;
    }
    play('rumble');
    set({ phase: 'reveal', winning, revealStartAt: Date.now(), revealMotherlode: motherlode });
    const covered = pending.mask.toString(2).split('1').length - 1;
    const won = (pending.mask & (1 << winning)) !== 0;
    const points = won ? pointsFor(covered, motherlode, pending.boostBps) : 0;
    const solIn = pending.total;
    setTimeout(async () => {
      if (pending.onChain) await get().refreshWallet();
      const result: RoundResult = { roundId, winning, covered, won, points, motherlode, onChain: pending.onChain, skr, oreMotherlode, solIn, solOut, oreMined, split, lucky };
      updateSave((s) => {
        const winStreak = won ? s.winStreak + 1 : 0;
        const qp = { ...s.questProgress };
        if (won) qp.win1 = (qp.win1 ?? 0) + 1;
        if (won && covered <= 5) qp.sharp = 1;
        const practiceWin = !pending.onChain && won;
        return {
          ...s,
          xp: pending.onChain ? s.xp : s.xp + (practiceWin ? 50 : 0),
          points: pending.onChain ? s.points : s.points + points,
          wins: pending.onChain ? s.wins : s.wins + (practiceWin ? 1 : 0),
          practiceUnclaimedSol: pending.onChain ? s.practiceUnclaimedSol : (s.practiceUnclaimedSol ?? 0) + solOut,
          // ORE pays a motherlode share as unrefined ORE, the same as the round's mining reward
          practiceUnclaimedSkr: pending.onChain ? s.practiceUnclaimedSkr : (s.practiceUnclaimedSkr ?? 0) + oreMined + oreMotherlode,
          practiceRefinedSkr: pending.onChain
            ? s.practiceRefinedSkr
            : (s.practiceRefinedSkr ?? 0) + ((s.practiceUnclaimedSkr ?? 0) + oreMined + oreMotherlode) * PRACTICE_REFINE_RATE,
          winStreak,
          bestStreak: Math.max(s.bestStreak, winStreak),
          questProgress: qp,
          history: [result, ...s.history].slice(0, 30),
        };
      });
      if (won) {
        play(motherlode ? 'motherlode' : 'win');
        haptic.win();
        if (get().save.winStreak >= 2) get().toast(`🔥 Hot streak x${get().save.winStreak}`, 'gold');
      } else {
        play('lose');
        haptic.lose();
      }
      const run = get().run;
      set({
        phase: 'mining',
        pending: null,
        winning: null,
        lastResult: result,
        resultAt: Date.now(),
        roundId: curRound(get()),
        run: run && run.left <= 0 ? null : run,
      });
      if (run && run.left <= 0 && run.total > 1) get().toast(`Autopilot finished ${run.total} rounds`, 'info');
    }, REVEAL_MIN_MS - 1400);
  }

  let retryAt = 0;
  /** Settles rounds a failed attempt left behind, and takes the SOL back from rounds nobody revealed. */
  async function retryUnsettled() {
    const st = get();
    const list = st.save.unsettled ?? [];
    const live = isLive(st);
    if (!isOnChain(st) || (!live && !session) || !list.length || st.phase !== 'mining' || st.pending || st.wallet.busy) return;
    if (Date.now() < retryAt) return;
    retryAt = Date.now() + 30_000;
    const roundId = list[0];
    const done = () => updateSave((sv) => ({ ...sv, unsettled: (sv.unsettled ?? []).filter((r) => r !== roundId) }));
    const loaded = await Promise.all([ownerKey(), loadBoard()]).catch(() => null); // null: chain code didn't load (offline); try later
    if (!loaded || !loaded[0] || (!live && !session)) return;
    const [owner, board] = loaded;
    if (live) {
      // nothing to sign: read the result. ORE settles it on the next deploy or claim.
      try {
        const r = await board.readOutcome(owner, roundId);
        done();
        await get().refreshWallet();
        if (r.payout > 0 || r.oreMined > 0) get().toast(`Round #${roundId} paid ${r.payout.toFixed(4)} SOL. Claim it any time`, 'good');
      } catch (e) {
        if (/gone|replaced/.test(String((e as Error)?.message ?? e))) done();
      }
      return;
    }
    if (!session) return;
    try {
      const r = await board.settleAndRead(owner, session, roundId);
      done();
      await get().refreshWallet();
      if (r.payout > 0 || r.oreMined > 0) get().toast(`Round #${roundId % 100000} settled: +${r.payout.toFixed(4)} SOL`, 'good');
      return;
    } catch (e) {
      if (isRateLimited(e)) return; // try again later
      const ageSecs = chainNow(get().offsetMs) / 1000 - (roundId + 1) * ROUND_SECS;
      if (ageSecs < 3_600) return;
      // A round that never drew refunds through ORE's own checkpoint, so there is
      // nothing separate to call: settling it again is the refund.
      try {
        await board.settleBoardRound(owner, session);
        done();
        await get().refreshWallet();
      } catch {
        if (ageSecs > 86_400) done(); // ORE expired the round; the position is gone
      }
    }
  }

  function recordRound(blocks: number, onChain: boolean) {
    updateSave((s) => {
      const today = localDay();
      const yesterday = localDay(Date.now() - 86_400_000);
      const dayStreak = s.lastDigDay === today ? s.dayStreak : s.lastDigDay === yesterday ? s.dayStreak + 1 : 1;
      const qp: Record<string, number> = { ...s.questProgress, dig5: (s.questProgress.dig5 ?? 0) + 1 };
      return { ...s, digs: s.digs + 1, dayStreak, lastDigDay: today, xp: onChain ? s.xp : s.xp + 10 + blocks, questProgress: qp };
    });
  }

  /** One round of a run: deploy SOL on the current round. */
  const ROUND_RENT_SOL = 0.01;
  async function runRound() {
    const st = get();
    const run = st.run;
    if (!run) return;
    const live = isLive(st);
    let roundId = curRound(st);
    const first = run.lastRound < 0;
    set({ run: { ...run, lastRound: roundId } });
    let idx: number[];
    if (run.blocks === 'all') idx = [...Array(BLOCKS).keys()];
    // Smart is random: the first round plays the spots on screen, autopilot rolls new ones each round
    else if (run.blocks === 'smart') idx = first && st.selected.length === run.smartN ? [...st.selected] : randomPick(run.smartN);
    else idx = idxOf(run.manualMask);
    const stop = (msg: string) => {
      set({ run: null });
      setWallet({ busy: null });
      get().toast(msg, 'bad');
    };
    if (!idx.length) return stop('Pick spots on the map first');
    const perBlock = run.perSpot ?? Math.floor((run.perRound / idx.length) * 1e9) / 1e9;
    if (perBlock < MIN_SOL_PER_BLOCK) return stop(`Minimum is ${MIN_SOL_PER_BLOCK} SOL per spot`);
    const mask = maskOf(idx);
    const total = perBlock * idx.length;
    const onChain = isOnChain(st);
    set({ selected: idx });
    try {
      if (live) {
        if (total > LIVE_MAX_ROUND_SOL + 1e-9) throw new Error('LiveCap');
        if (st.wallet.sol < total + LIVE_FEE_SOL) throw new Error('insufficient SOL');
        const [board, { maskToSquares }] = await Promise.all([loadBoard(), loadOreTx()]);
        setWallet({ busy: `Approve in your wallet: ${total.toFixed(4)} SOL on ORE's board` });
        roundId = await board.deployLive(maskToSquares(mask), perBlock);
        const cur = get().run;
        if (cur) set({ run: { ...cur, lastRound: roundId } });
      } else if (onChain) {
        if (st.wallet.sol + st.wallet.sessionSol < total + ROUND_RENT_SOL) throw new Error('insufficient SOL');
        const [owner, board, { maskToSquares }] = await Promise.all([ownerKey(), loadBoard(), loadOreTx()]);
        if (!owner) throw new Error('wallet disconnected');
        // the session key also pays account rent (round pot, reveal, stake) and fees, ~0.01 SOL a round
        const s = await ensureSession(owner, Math.min(MAX_SESSION_FUND_SOL - 0.01, (total + ROUND_RENT_SOL) * run.left));
        setWallet({ busy: `Deploying ${total.toFixed(4)} SOL…` });
        const nowMs = chainNow(get().offsetMs);
        if (roundOf(nowMs) !== roundId || roundEnd(roundId) - nowMs <= LOCK_MS) throw new Error('RoundLocked');
        await board.deployToBoard(owner, s, maskToSquares(mask), perBlock);
      } else {
        if (get().save.practiceSol < total) throw new Error('insufficient practice SOL. Refill it in the panel');
        updateSave((sv) => ({ ...sv, practiceSol: sv.practiceSol - total }));
      }
    } catch (e) {
      console.warn('[gali] deploy failed', e);
      const msg = String((e as Error)?.message ?? e);
      if (/RoundLocked|WrongRound/.test(msg) || isRateLimited(e)) {
        if (live) return stop('That round closed before it landed. Tap MINE to try the next one');
        // this round got away: keep the run and try the next one
        setWallet({ busy: null });
        get().toast('Missed that round. Trying the next one', 'info');
        return;
      }
      return stop(errMsg(e));
    }
    setWallet({ busy: null });
    play('dig');
    haptic.thud();
    const cur = get().run;
    set({
      pending: { roundId, mask, boostBps: boostFor(staked()), onChain, perBlock, total },
      roundId,
      run: cur ? { ...cur, left: cur.left - 1 } : null,
      pot: addToPot(get().pot.roundId === roundId ? get().pot : emptyPot(roundId), mask, perBlock),
    });
    recordRound(idx.length, onChain);
    if (onChain) void get().refreshWallet();
  }

  /** Live mode: read ORE's board clock every couple of seconds. */
  let clockAt = 0;
  let clockBusy = false;
  function pollLiveClock() {
    if (clockBusy || Date.now() - clockAt < 2000) return;
    clockBusy = true;
    clockAt = Date.now();
    loadBoard()
      .then(async (b) => {
        const c = await b.fetchOreClock();
        if (!isLive(get())) return;
        const roundId = Number(c.roundId);
        const prev = get().liveClock;
        const solo = prev?.roundId === roundId ? prev.solo : b.oreSoloMask(roundId);
        const endsAt = c.phase === 'mining' ? chainNow(get().offsetMs) + c.msLeft : 0;
        set({ liveClock: { roundId, phase: c.phase, endsAt, solo } });
      })
      .catch(() => undefined)
      .finally(() => {
        clockBusy = false;
      });
  }

  function liveTick() {
    const st = get();
    if (Date.now() - lastClockSync > 30_000) {
      lastClockSync = Date.now();
      clockOffsetMs()
        .then((o) => set({ offsetMs: o }))
        .catch(() => undefined);
    }
    pollLiveClock();
    const now = chainNow(st.offsetMs);
    const c = st.liveClock;
    const p = st.pending;
    if (c && st.phase === 'mining') {
      // mining closed on the round we are in: show the dig while ORE draws it
      // (a practice round left over from before the wallet connected settles at once)
      if (p && p.roundId === st.roundId && (c.roundId > p.roundId || c.phase === 'intermission' || !p.onChain)) {
        set({ phase: 'settling', settleStartAt: Date.now(), now });
        play('rumble');
        haptic.heavy();
        void settle(p.roundId);
        return;
      }
      // a new round: picks stay, so a player can line up the next one during the break
      if (!p && c.roundId !== st.roundId) set({ roundId: c.roundId, pot: emptyPot(c.roundId) });
    }
    if (st.phase === 'mining' && !p) void retryUnsettled();
    if (Date.now() - st.potAt > 3000) {
      set({ potAt: Date.now() });
      void get().refreshPot();
    }
    if (st.run && st.phase === 'mining' && !p && !st.wallet.busy && c && st.run.lastRound !== c.roundId && deployOpen(st, 0)) {
      void runRound();
    }
    if (st.phase === 'mining' && c?.phase === 'mining') {
      const left = c.endsAt - now;
      const prevLeft = c.endsAt - st.now;
      if (left < 5000 && left > 0 && Math.ceil(left / 1000) !== Math.ceil(prevLeft / 1000)) {
        play('tick');
        if (p) haptic.tap();
      }
    }
    set({ now });
  }

  return {
    loaded: false,
    liveClock: null,
    liveNotice: false,
    save: freshSave(),
    wallet: { owner: null, player: null, skr: 0, sol: 0, sessionSol: 0, pool: 0, orePool: 0, ore: 0, shop: null, unclaimed: NO_UNCLAIMED, busy: null },
    offsetMs: 0,
    now: Date.now(),
    roundId: roundOf(Date.now()),
    phase: 'mining',
    settleStartAt: 0,
    revealStartAt: 0,
    revealMotherlode: false,
    winning: null,
    pending: null,
    pot: emptyPot(roundOf(Date.now())),
    potAt: 0,
    run: null,
    dockTab: 'lite',
    liteMode: 'all',
    liteSmart: DEFAULT_SMART,
    dockOpen: false,
    selected: [],
    lastResult: null,
    resultAt: 0,
    toasts: [],
    levelUp: null,
    emote: 0,
    gearReveal: null,
    walletPicker: null,

    boot: async () => {
      const save = rollDay({ ...freshSave(), ...(await loadJson(SAVE_KEY, freshSave())) });
      setMuted(save.muted);
      const owner = await loadJson<{ owner: string | null }>('gali-owner', { owner: null });
      set({ save, loaded: true });
      // a bare JSON-RPC read (light.ts): practice mode never has to load the chain code
      clockOffsetMs()
        .then((o) => set({ offsetMs: o, roundId: roundOf(chainNow(o)) }))
        .catch(() => undefined);
      if (oreLive && !chainReady) {
        loadBoard()
          .then((board) => board.fetchOreMotherlode())
          .then((orePool) => setWallet({ orePool }))
          .catch(() => undefined);
      }
      if (chainReady) {
        Promise.all([loadChain(), loadBoard()])
          .then(([chain, board]) => Promise.all([chain.fetchMotherlodePool(), board.fetchOreMotherlode().catch(() => 0)]))
          .then(([pool, orePool]) => setWallet({ pool, orePool }))
          .catch(() => undefined);
      }
      if (owner.owner && onChainMode && (!oreLive || save.liveAccepted)) {
        setWallet({ owner: owner.owner });
        get().refreshWallet();
      }
    },

    toast: (text, tone = 'info') => {
      const id = toastId++;
      set((st) => ({ toasts: [...st.toasts.slice(-2), { id, text, tone }] }));
      setTimeout(() => set((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) })), 3200);
    },

    tick: () => {
      const st = get();
      if (isLive(st)) return liveTick();
      // re-sync with the chain clock now and then (device clocks drift; so can the chain's)
      if (chainReady && Date.now() - lastClockSync > 30_000) {
        lastClockSync = Date.now();
        clockOffsetMs()
          .then((o) => set({ offsetMs: o }))
          .catch(() => undefined);
      }
      const now = chainNow(st.offsetMs);
      const rid = roundOf(now);
      if (st.phase === 'mining' && rid > st.roundId) {
        if (st.pending && st.pending.roundId === st.roundId) {
          set({ phase: 'settling', settleStartAt: Date.now(), selected: [], now });
          play('rumble');
          haptic.heavy();
          void settle(st.roundId);
          return;
        }
        set({ roundId: rid, selected: [], pending: null, now });
        return;
      }
      if (st.phase === 'mining' && !st.pending) void retryUnsettled();
      if (Date.now() - st.potAt > 3000) {
        set({ potAt: Date.now() });
        void get().refreshPot();
      }
      if (st.run && st.phase === 'mining' && !st.pending && !st.wallet.busy && st.run.lastRound !== rid && roundEnd(rid) - now > LOCK_MS + 8000) {
        void runRound();
      }
      if (st.phase === 'mining') {
        const left = roundEnd(st.roundId) - now;
        const prevLeft = roundEnd(st.roundId) - st.now;
        if (left < 5000 && left > 0 && Math.ceil(left / 1000) !== Math.ceil(prevLeft / 1000)) {
          play('tick');
          if (st.pending) haptic.tap();
        }
      }
      set({ now });
    },

    toggleBlock: (i) => {
      const st = get();
      if (st.phase !== 'mining' || st.pending || st.run) return;
      haptic.tap();
      // tapping a spot by hand means "I pick": LITE goes to Pick, the PRO preset to manual
      if (st.dockTab === 'lite') {
        if (st.liteMode !== 'pick') set({ liteMode: 'pick', selected: st.liteMode === 'smart' ? st.selected : [] });
      } else {
        const cur = st.save.presets[st.save.preset];
        if (cur && cur.blocks !== 'manual') get().editPreset({ blocks: 'manual' });
      }
      const sel = get().selected;
      if (sel.includes(i)) {
        play('deselect');
        set({ selected: sel.filter((x) => x !== i) });
      } else {
        play('select');
        set({ selected: [...sel, i] });
      }
    },
    selectRandom: (n) => {
      if (get().phase !== 'mining' || get().pending) return;
      const pool = [...Array(BLOCKS).keys()].sort(() => Math.random() - 0.5);
      play('select');
      haptic.tap();
      set({ selected: pool.slice(0, n) });
    },
    selectAll: () => {
      if (get().phase !== 'mining' || get().pending) return;
      play('select');
      set({ selected: [...Array(BLOCKS).keys()] });
    },
    clearSelection: () => set({ selected: [] }),

    shakePick: () => {
      const st = get();
      if (st.phase !== 'mining' || st.pending || st.run || st.wallet.busy) return;
      if (st.dockTab === 'lite') {
        // LITE stays LITE: shaking switches it to Smart and rolls new spots
        set({ liteMode: 'smart', selected: randomPick(st.liteSmart) });
      } else {
        const cur = st.save.presets[st.save.preset];
        const n = cur && (SMART_COUNTS as readonly number[]).includes(cur.smartN) ? cur.smartN : DEFAULT_SMART;
        set({ selected: randomPick(n) });
        if (cur) get().editPreset({ blocks: 'smart', smartN: n });
      }
      const n = get().selected.length;
      play('select');
      haptic.thud();
      updateSave((s) => ({ ...s, questProgress: { ...s.questProgress, shake: 1 } }));
      get().toast(`Shake! Smart picked ${n} spots`, 'good');
    },

    bonkMole: () => {
      play('bonk');
      haptic.thud();
      updateSave((s) => ({
        ...s,
        moles: s.moles + 1,
        xp: s.xp + 3,
        bonusXp: s.bonusXp + 3,
        questProgress: { ...s.questProgress, mole3: (s.questProgress.mole3 ?? 0) + 1 },
      }));
      get().toast('Bonk! +3 XP', 'good');
    },

    doEmote: () => {
      play('claim');
      set({ emote: Date.now() });
    },

    claimQuest: (id) => {
      const q = QUESTS.find((x) => x.id === id);
      const s = rollDay(get().save);
      if (!q || s.questClaimed.includes(id) || (s.questProgress[id] ?? 0) < q.target) return;
      play('claim');
      haptic.win();
      updateSave((sv) => ({ ...sv, xp: sv.xp + q.rewardXp, bonusXp: sv.bonusXp + q.rewardXp, questClaimed: [...sv.questClaimed, id] }));
      get().toast(`Quest done: +${q.rewardXp} XP`, 'good');
    },

    equip: (key) => {
      const g = GEAR.find((x) => x.key === key);
      if (!g) return;
      const mask = (get().wallet.player?.gearMask ?? 0) | FREE_GEAR_MASK;
      if (!(mask & (1 << g.id))) return;
      play('select');
      updateSave((s) => {
        if (g.kind === 'pickaxe') return { ...s, pickaxe: key };
        if (g.kind === 'helmet') return { ...s, helmet: key };
        if (g.kind === 'outfit') return { ...s, outfit: key };
        return { ...s, pet: s.pet === key ? null : key };
      });
    },

    buyGear: async (key, pay = 'skr') => {
      const g = GEAR.find((x) => x.key === key);
      const st = get();
      if (!g) return;
      const unit = pay.toUpperCase();
      if (!st.wallet.owner) return st.toast(`Connect a wallet to buy gear with ${unit}`, 'bad');
      if (!st.wallet.player) return st.toast('Play one round first to create your miner', 'bad');
      const shop = st.wallet.shop;
      const price = pay === 'ore' ? orePrice(g, shop) : g.priceSkr;
      if (price === null) return st.toast('ORE prices are not set yet', 'bad');
      const balance = pay === 'ore' ? st.wallet.ore : st.wallet.skr;
      if (balance < price) return st.toast(`You need ${fmtToken(price)} ${unit}`, 'bad');
      try {
        setWallet({ busy: `Buying ${g.name} for ${fmtToken(price)} ${unit}…` });
        const chain = await loadChain();
        if (pay === 'ore' && shop) await chain.buyGearOre(g.id, shop.oreMint);
        else await chain.buyGear(g.id);
        await get().refreshWallet();
        play('mint');
        haptic.win();
        set({ gearReveal: key });
        get().equip(key);
      } catch (e) {
        get().toast(errMsg(e), 'bad');
      } finally {
        setWallet({ busy: null });
      }
    },

    stake: async (amount) => {
      const st = get();
      if (!st.wallet.player) return st.toast('Play one round first to create your miner', 'bad');
      if (amount <= 0 || amount > st.wallet.skr) return st.toast('Not enough SKR', 'bad');
      try {
        setWallet({ busy: `Staking ${amount} SKR…` });
        await (await loadChain()).stakeSkr(amount);
        await get().refreshWallet();
        play('claim');
        haptic.win();
        get().toast(`Staked ${amount} SKR`, 'gold');
        updateSave((s) => s);
      } catch (e) {
        get().toast(errMsg(e), 'bad');
      } finally {
        setWallet({ busy: null });
      }
    },

    unstake: async (amount) => {
      const st = get();
      if (amount <= 0 || amount > staked()) return st.toast('Nothing to unstake', 'bad');
      try {
        setWallet({ busy: `Unstaking ${amount} SKR…` });
        await (await loadChain()).unstakeSkr(amount);
        await get().refreshWallet();
        get().toast(`Unstaked ${amount} SKR`, 'good');
      } catch (e) {
        get().toast(errMsg(e), 'bad');
      } finally {
        setWallet({ busy: null });
      }
    },

    connect: async (webWallet?: string) => {
      if (!onChainMode) return get().toast('On-chain mode is not deployed yet. Playing practice mode', 'info');
      // real SOL on ORE's board: the player says yes to that once, before the wallet opens
      if (oreLive && !get().save.liveAccepted) return set({ liveNotice: typeof webWallet === 'string' ? webWallet : true, walletPicker: null });
      set({ walletPicker: null });
      try {
        setWallet({ busy: 'Connecting wallet…' });
        const chain = await loadChain();
        const owner = await chain.connectWallet(typeof webWallet === 'string' ? webWallet : undefined);
        saveJson('gali-owner', { owner: owner.toBase58() }, 0);
        if (chainReady) session = await chain.loadSession(owner);
        set({ liveClock: null });
        setWallet({ owner: owner.toBase58() });
        await get().refreshWallet();
        get().toast(`Connected ${short(owner.toBase58())}`, 'good');
      } catch (e) {
        if (isPickWalletError(e)) set({ walletPicker: e.wallets });
        else get().toast(errMsg(e), 'bad');
      } finally {
        setWallet({ busy: null });
      }
    },

    sweepSession: async () => {
      const st = get();
      if (!st.wallet.owner || !session) return;
      const s = session;
      try {
        setWallet({ busy: 'Returning session SOL…' });
        const [chain, owner] = await Promise.all([loadChain(), ownerKey()]);
        if (!owner) return;
        const back = await chain.sweepSession(owner, s);
        await get().refreshWallet();
        st.toast(`${back.toFixed(4)} SOL back in your wallet`, 'good');
      } catch (e) {
        get().toast(errMsg(e), 'bad');
      } finally {
        setWallet({ busy: null });
      }
    },

    claimRewards: async (what) => {
      const st = get();
      const fmtSkr = (v: number) => Math.floor(v).toLocaleString();
      if (!isOnChain(st)) {
        const { practiceUnclaimedSol: sol = 0, practiceUnclaimedSkr: unrefined = 0, practiceRefinedSkr: refined = 0 } = st.save;
        if (what === 'sol') {
          if (sol <= 0) return st.toast('No SOL to claim yet', 'info');
          updateSave((s) => ({ ...s, practiceSol: s.practiceSol + sol, practiceUnclaimedSol: 0 }));
          play('win');
          return st.toast(`Claimed ${sol.toFixed(4)} SOL (practice)`, 'good');
        }
        if (unrefined + refined <= 0) return st.toast('No SKR to claim yet', 'info');
        const fee = unrefined * REFINING_FEE;
        updateSave((s) => ({ ...s, practiceSkr: s.practiceSkr + unrefined - fee + refined, practiceUnclaimedSkr: 0, practiceRefinedSkr: 0 }));
        play('win');
        return st.toast(`Claimed ${fmtSkr(unrefined - fee + refined)} SKR · ${fmtSkr(fee)} refining fee (practice)`, 'good');
      }
      const u = st.wallet.unclaimed;
      const unit = what === 'sol' ? 'SOL' : isLive(st) ? 'ORE' : 'SKR';
      if (what === 'sol' ? u.sol <= 0 : u.unrefined + u.refined <= 0) return st.toast(`No ${unit} to claim yet`, 'info');
      try {
        // only the wallet can move rewards out, so this one always asks for a signature
        setWallet({ busy: `Approve: claim your ${unit}` });
        const board = await loadBoard();
        await (what === 'sol' ? board.claimBoardSol() : board.claimBoardOre());
        await get().refreshWallet();
        play('win');
        haptic.win();
        if (what === 'sol') get().toast(`Claimed ${u.sol.toFixed(4)} SOL`, 'good');
        else {
          const fee = u.fee;
          const f = isLive(st) ? (v: number) => Number(v.toPrecision(4)).toString() : fmtSkr;
          get().toast(`Claimed ${f(u.unrefined - fee + u.refined)} ${unit} · ${f(fee)} refining fee`, 'good');
        }
      } catch (e) {
        get().toast(`Claim failed: ${errMsg(e)}`, 'bad');
      } finally {
        setWallet({ busy: null });
      }
    },

    closeWalletPicker: () => set({ walletPicker: null }),

    acceptLive: () => {
      const w = get().liveNotice;
      updateSave((s) => ({ ...s, liveAccepted: true }));
      set({ liveNotice: false });
      void get().connect(typeof w === 'string' ? w : undefined);
    },
    declineLive: () => set({ liveNotice: false }),

    disconnect: async () => {
      // if the chain code can't load (offline), nothing it connected needs undoing; still clear local state
      const chain = await loadChain().catch(() => null);
      await chain?.disconnectWallet();
      saveJson('gali-owner', { owner: null }, 0);
      session = null;
      set({ run: null, liveClock: null, pending: null, phase: 'mining', roundId: roundOf(chainNow(get().offsetMs)), wallet: { owner: null, player: null, skr: 0, sol: 0, sessionSol: 0, pool: 0, orePool: 0, ore: 0, shop: null, unclaimed: NO_UNCLAIMED, busy: null } });
    },

    refreshWallet: async () => {
      if (!get().wallet.owner) return;
      if (isLive(get()) && !chainReady) {
        try {
          const [board, owner] = await Promise.all([loadBoard(), ownerKey()]);
          if (!owner) return;
          const w = await board.fetchLiveWallet(owner);
          if (get().wallet.owner !== owner.toBase58()) return;
          setWallet({ ...w, player: null, skr: 0, sessionSol: 0, pool: 0, shop: null });
        } catch {
          /* offline */
        }
        return;
      }
      try {
        const [chain, board, owner] = await Promise.all([loadChain(), loadBoard(), ownerKey()]);
        if (!owner) return;
        session = session ?? (await chain.loadSession(owner));
        const [player, skr, sol, sessionSol, pool, orePool, unclaimed] = await Promise.all([
          chain.fetchPlayer(owner),
          chain.fetchSkrBalance(owner),
          chain.fetchSolBalance(owner),
          chain.fetchSolBalance(session.publicKey),
          chain.fetchMotherlodePool(),
          board.fetchOreMotherlode().catch(() => 0),
          board.fetchClaimable(owner).catch(() => NO_UNCLAIMED),
        ]);
        const shop = await chain.fetchShopConfig().catch(() => null);
        const ore = shop ? await chain.fetchOreBalance(owner, shop.oreMint) : 0;
        if (get().wallet.owner !== owner.toBase58()) return; // disconnected or switched while loading
        setWallet({ player, skr, sol, sessionSol, pool, orePool, unclaimed, ore, shop });
      } catch {
        /* offline */
      }
    },

    airdrop: async () => {
      if (!get().wallet.owner) return;
      try {
        setWallet({ busy: 'Requesting devnet SOL…' });
        const [chain, owner] = await Promise.all([loadChain(), ownerKey()]);
        if (!owner) return;
        await chain.requestDevnetSol(owner);
        await get().refreshWallet();
        get().toast('+1 devnet SOL', 'good');
      } catch (e) {
        get().toast(`Airdrop failed: ${errMsg(e)}`, 'bad');
      } finally {
        setWallet({ busy: null });
      }
    },

    setDockTab: (t) => set({ dockTab: t }),
    setDockOpen: (open) => set({ dockOpen: open }),
    // picking a count (or the same count again) rolls a fresh random set
    setLiteSmart: (n) => {
      if (get().run) return;
      set({ liteMode: 'smart', liteSmart: n, selected: randomPick(n) });
    },
    setLiteMode: (m) => {
      const st = get();
      if (st.run || m === st.liteMode) return;
      if (m === 'smart') return get().setLiteSmart(st.liteSmart);
      set({ liteMode: m, selected: [] });
    },

    startRun: async (r) => {
      const st = get();
      if (st.run) return;
      if (st.wallet.owner && !onChainMode) return st.toast('On-chain mode is not deployed yet', 'bad');
      // live rounds are one at a time: every deploy is signed by the player
      const run = isLive(st) ? { ...r, total: 1 } : r;
      set({ run: { ...run, left: run.total, lastRound: -1 } });
      play('select');
      const open = deployOpen(st, 2000);
      get().toast(run.total > 1 ? `Autopilot on: ${run.total} rounds` : open ? 'Deploying this round' : 'Deploying when the next round opens', 'good');
      if (st.phase === 'mining' && !st.pending && open) await runRound();
    },

    stopRun: () => {
      if (!get().run) return;
      set({ run: null });
      get().toast('Autopilot stopped', 'info');
    },

    refreshPot: async () => {
      const st = get();
      const now = chainNow(st.offsetMs);
      const rid = roundOf(now);
      if (st.phase !== 'mining') return; // keep the played round's board during the reveal
      if (isLive(st)) {
        const lrid = st.liveClock?.roundId;
        if (lrid === undefined) return;
        const p = await loadBoard()
          .then((board) => board.fetchBoardRound(lrid))
          .catch(() => null);
        if (get().roundId !== lrid || get().phase !== 'mining') return;
        set({ pot: p ? { roundId: lrid, perBlock: p.perSquare, total: p.total, miners: p.miners } : emptyPot(lrid) });
        return;
      }
      if (chainReady && st.wallet.owner) {
        const p = await loadBoard()
          .then((board) => board.fetchBoardRound(rid))
          .catch(() => null);
        set({ pot: p ? { roundId: rid, perBlock: p.perSquare, total: p.total, miners: p.miners } : emptyPot(rid) });
        return;
      }
      const frac = 1 - (roundEnd(rid) - now) / (ROUND_SECS * 1000);
      let pot = simPot(rid, frac);
      const pend = st.pending;
      if (pend && pend.roundId === rid) pot = addToPot(pot, pend.mask, pend.perBlock);
      set({ pot });
    },

    choosePreset: (i) => updateSave((s) => ({ ...s, preset: i })),
    editPreset: (p) =>
      updateSave((s) => {
        const presets = (s.presets?.length === 4 ? s.presets : defaultPresets()).map((x, i) => (i === s.preset ? { ...x, ...p } : x));
        return { ...s, presets };
      }),
    refillPractice: () => {
      updateSave((s) => ({ ...s, practiceSol: PRACTICE_SOL }));
      get().toast(`Practice wallet refilled to ${PRACTICE_SOL} SOL`, 'good');
    },
    session: () => session,

    setMute: (m) => {
      setMuted(m);
      updateSave((s) => ({ ...s, muted: m }));
    },
    finishOnboarding: () => updateSave((s) => ({ ...s, onboarded: true })),
    dismissLevel: () => set({ levelUp: null }),
    dismissGear: () => set({ gearReveal: null }),
  };
});

/** helpers for UI */
export const useLevelXp = () =>
  useGame((s) => (s.wallet.player ? s.wallet.player.xp + s.save.bonusXp : s.save.xp));
export const usePoints = () => useGame((s) => (s.wallet.player ? s.wallet.player.points : s.save.points));
/** An item's price in whole ORE at the config's rate, or null before the rates are known. */
export function orePrice(g: Gear, shop: ShopConfig | null): number | null {
  const usd = shop?.gearUsd[g.id];
  if (!shop || usd === undefined || !(shop.oreUsd > 0)) return null;
  return usd / shop.oreUsd;
}
/** Token amounts for buttons and toasts: whole numbers stay whole, small ORE keeps 3 significant digits. */
export const fmtToken = (v: number) => (v >= 100 ? Math.ceil(v).toLocaleString() : Number(v.toPrecision(3)).toString());

export const useOwnedMask = () => useGame((s) => (s.wallet.player?.gearMask ?? 0) | FREE_GEAR_MASK);

/** ORE the gold claim mines this round. ORE mints it, so the figure is the same on chain and in practice. */
export const useRoundReward = () => ROUND_REWARD_ORE;
