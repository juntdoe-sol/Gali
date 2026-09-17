import { create } from 'zustand';
import { PublicKey, type Keypair } from '@solana/web3.js';
import * as chain from '../chain/client';
import {
  ACHIEVEMENTS, BLOCKS, boostFor, FREE_GEAR_MASK, GEAR, LOCK_MS, localDay, levelFromXp, MOTHERLODE_ODDS,
  pointsFor, QUESTS, REVEAL_MIN_MS, ROUND_REWARD_SKR, ROUND_SECS,
} from './constants';
import { addToPot, emptyPot, idxOf, maskOf, MIN_SOL_PER_BLOCK, payoutFor, practiceMotherlode, PRACTICE_SOL, simPot, smartPick, soloMask, type PotView } from './pot';
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
  skr: number; // SKR from the Motherlode Pool
  solIn: number; // SOL deployed this round
  solOut: number; // SOL given back this round (after fees; credited to Unclaimed)
  skrMined: number; // SKR mined from the round reward
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
  { amount: '', perSpot: '0.001', blocks: 'manual', smartN: 5, rounds: 1 },
  { amount: '', perSpot: '0.001', blocks: 'smart', smartN: 5, rounds: 5 },
  { amount: '', perSpot: '0.0005', blocks: 'smart', smartN: 10, rounds: 10 },
  { amount: '', perSpot: '0.0002', blocks: 'all', smartN: 25, rounds: 20 },
];

export type DockTab = 'lite' | 'pro';

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
  practiceUnclaimedSol: number;
  practiceUnclaimedSkr: number; // unrefined
  practiceRefinedSkr: number;
  presets: Preset[];
  preset: number;
  muted: boolean;
  onboarded: boolean;
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
  practiceUnclaimedSol: 0,
  practiceUnclaimedSkr: 0,
  practiceRefinedSkr: 0,
  presets: defaultPresets(),
  preset: 0,
  muted: false,
  onboarded: false,
});

interface Wallet {
  owner: string | null;
  player: chain.ChainPlayer | null;
  skr: number;
  sol: number;
  sessionSol: number;
  pool: number; // SKR in the Motherlode Pool
  rewards: number; // SKR in the Rewards Pool
  unclaimed: chain.Unclaimed;
  economy: chain.Economy | null;
  busy: string | null;
}

interface GameState {
  loaded: boolean;
  save: Save;
  wallet: Wallet;
  offsetMs: number;
  now: number;
  roundId: number;
  phase: Phase;
  settleStartAt: number;
  revealStartAt: number;
  winning: number | null;
  pending: Pending | null;
  pot: PotView;
  potAt: number;
  run: Run | null;
  dockTab: DockTab;
  selected: number[];
  lastResult: RoundResult | null;
  resultAt: number;
  toasts: Toast[];
  levelUp: number | null;
  emote: number;
  gearReveal: string | null;
  /** web only: wallets to choose from when several are installed */
  walletPicker: chain.WebWalletInfo[] | null;

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
  buyGear: (key: string) => Promise<void>;
  stake: (amount: number) => Promise<void>;
  unstake: (amount: number) => Promise<void>;
  claimRewards: (what: 'sol' | 'skr') => Promise<void>;
  connect: (webWallet?: string) => Promise<void>;
  closeWalletPicker: () => void;
  disconnect: () => Promise<void>;
  refreshWallet: () => Promise<void>;
  airdrop: () => Promise<void>;
  setMute: (m: boolean) => void;
  finishOnboarding: () => void;
  toast: (text: string, tone?: Toast['tone']) => void;
  setDockTab: (t: DockTab) => void;
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
const NO_UNCLAIMED: chain.Unclaimed = { sol: 0, unrefined: 0, refined: 0, fee: 0, claimedSol: 0, claimedSkr: 0 };
/** Practice mode: other (simulated) miners' refining fees add this share of your unrefined SKR each round. */
const PRACTICE_REFINE_RATE = 0.003;
let lastClockSync = Date.now();
let session: Keypair | null = null;
const chainNow = (offset: number) => Date.now() + offset;
const roundOf = (t: number) => Math.floor(t / 1000 / ROUND_SECS);
export const roundEnd = (rid: number) => (rid + 1) * ROUND_SECS * 1000;
const errMsg = (e: unknown) => {
  const m = String((e as Error)?.message ?? e);
  if (/RoundLocked/.test(m)) return 'Round is locking. Try next round';
  if (/AlreadyOnBlock/.test(m)) return 'You already have SOL on one of those spots this round';
  if (/StakeInPlay/.test(m)) return 'Your staked SKR is boosting this round. Unstake after it ends';
  if (/Paused/.test(m)) return 'Gali is paused for maintenance. Try again soon';
  if (/insufficient|0x1\b/i.test(m)) return 'Not enough balance';
  if (/declined|cancel|rejected/i.test(m)) return 'Cancelled in wallet';
  if (/found no installed|wallet/i.test(m) && /not found|no.*wallet/i.test(m)) return 'No Solana wallet app found';
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
  const ownerKey = () => (get().wallet.owner ? new PublicKey(get().wallet.owner!) : null);
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
    session = session ?? (await chain.loadSession(owner));
    const p = get().wallet.player;
    const valid = p && p.session === session.publicKey.toBase58() && p.sessionExpires * 1000 > Date.now() + 120_000;
    const sessionSol = await chain.fetchSolBalance(session.publicKey);
    if (valid && sessionSol > Math.max(0.005, needSol + 0.004)) return session;
    setWallet({
      busy: `Approve: fund your 24h miner session with ${Math.min(chain.MAX_SESSION_FUND_SOL, needSol + 0.01).toFixed(3)} SOL`,
    });
    await chain.startSession(owner, session, Boolean(p), needSol);
    await get().refreshWallet();
    get().toast('Session started. Rounds now run without pop-ups', 'good');
    return session;
  }

  async function settle(roundId: number) {
    const { pending, offsetMs } = get();
    if (!pending) return;
    let winning: number;
    let motherlode = false;
    let solOut = 0;
    let skrMined = 0;
    let skr = 0; // from the Motherlode Pool
    let split = true;
    let lucky = false;
    if (pending.onChain) {
      const owner = ownerKey();
      try {
        if (!owner || !session) throw new Error('wallet disconnected');
        const r = await chain.sessionSettlePot(owner, session, roundId);
        winning = r.winning;
        motherlode = r.motherlode;
        solOut = r.payout;
        skrMined = r.skr;
        skr = r.skrMotherlode;
        split = r.split;
        lucky = r.lucky;
      } catch (e) {
        get().toast(`Couldn't settle round: ${errMsg(e)}`, 'bad');
        set({ phase: 'mining', pending: null, roundId: roundOf(chainNow(offsetMs)) });
        return;
      }
    } else {
      await new Promise((r) => setTimeout(r, 900));
      winning = Math.floor(Math.random() * BLOCKS);
      motherlode = Math.random() < 1 / MOTHERLODE_ODDS;
      split = (soloMask(roundId) & (1 << winning)) === 0;
      const final = addToPot(simPot(roundId, 1), pending.mask, pending.perBlock);
      const pay = payoutFor(final, winning, pending.perBlock, pending.mask, motherlode ? practiceMotherlode(roundId) : 0, split, Math.random());
      solOut = pay.sol;
      skrMined = pay.skr;
      skr = pay.skrMotherlode;
      lucky = pay.lucky;
    }
    play('rumble');
    set({ phase: 'reveal', winning, revealStartAt: Date.now() });
    const covered = pending.mask.toString(2).split('1').length - 1;
    const won = (pending.mask & (1 << winning)) !== 0;
    const points = won ? pointsFor(covered, motherlode, pending.boostBps) : 0;
    const solIn = pending.total;
    setTimeout(async () => {
      if (pending.onChain) await get().refreshWallet();
      const result: RoundResult = { roundId, winning, covered, won, points, motherlode, onChain: pending.onChain, skr, solIn, solOut, skrMined, split, lucky };
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
          practiceUnclaimedSkr: pending.onChain ? s.practiceUnclaimedSkr : (s.practiceUnclaimedSkr ?? 0) + skrMined + skr,
          practiceRefinedSkr: pending.onChain ? s.practiceRefinedSkr : (s.practiceRefinedSkr ?? 0) + (s.practiceUnclaimedSkr ?? 0) * PRACTICE_REFINE_RATE,
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
        roundId: roundOf(chainNow(get().offsetMs)),
        run: run && run.left <= 0 ? null : run,
      });
      if (run && run.left <= 0) get().toast(`Autopilot finished ${run.total} round${run.total > 1 ? 's' : ''}`, 'info');
    }, REVEAL_MIN_MS - 1400);
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
    const now = chainNow(st.offsetMs);
    const roundId = roundOf(now);
    set({ run: { ...run, lastRound: roundId } });
    let idx: number[];
    if (run.blocks === 'all') idx = [...Array(BLOCKS).keys()];
    else if (run.blocks === 'smart') idx = smartPick(st.pot.roundId === roundId ? st.pot.perBlock : emptyPot(roundId).perBlock, run.smartN);
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
    const owner = ownerKey();
    const onChain = Boolean(owner && chain.chainReady);
    set({ selected: idx });
    try {
      if (onChain && owner) {
        if (st.wallet.sol + st.wallet.sessionSol < total + ROUND_RENT_SOL) throw new Error('insufficient SOL');
        // the session key also pays account rent (round pot, reveal, stake) and fees, ~0.01 SOL a round
        const s = await ensureSession(owner, Math.min(chain.MAX_SESSION_FUND_SOL - 0.01, (total + ROUND_RENT_SOL) * run.left));
        setWallet({ busy: `Deploying ${total.toFixed(4)} SOL…` });
        if (roundOf(chainNow(get().offsetMs)) !== roundId) throw new Error('RoundLocked');
        await chain.sessionDeploy(owner, s, roundId, mask, perBlock);
      } else {
        if (get().save.practiceSol < total) throw new Error('insufficient practice SOL. Refill it in the panel');
        updateSave((sv) => ({ ...sv, practiceSol: sv.practiceSol - total }));
      }
    } catch (e) {
      console.warn('[gali] deploy failed', e);
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

  return {
    loaded: false,
    save: freshSave(),
    wallet: { owner: null, player: null, skr: 0, sol: 0, sessionSol: 0, pool: 0, rewards: 0, unclaimed: NO_UNCLAIMED, economy: null, busy: null },
    offsetMs: 0,
    now: Date.now(),
    roundId: roundOf(Date.now()),
    phase: 'mining',
    settleStartAt: 0,
    revealStartAt: 0,
    winning: null,
    pending: null,
    pot: emptyPot(roundOf(Date.now())),
    potAt: 0,
    run: null,
    dockTab: 'lite',
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
      chain
        .clockOffsetMs()
        .then((o) => set({ offsetMs: o, roundId: roundOf(chainNow(o)) }))
        .catch(() => undefined);
      if (chain.chainReady) {
        Promise.all([chain.fetchMotherlodePool(), chain.fetchRewardsPool(), chain.fetchEconomy()])
          .then(([pool, rewards, economy]) => setWallet({ pool, rewards, economy }))
          .catch(() => undefined);
      }
      if (owner.owner && chain.chainReady) {
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
      // re-sync with the chain clock now and then (device clocks drift; so can the chain's)
      if (chain.chainReady && Date.now() - lastClockSync > 30_000) {
        lastClockSync = Date.now();
        chain
          .clockOffsetMs()
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
      // tapping a tile by hand means "I pick": switch the PRO preset to manual
      const cur = st.save.presets[st.save.preset];
      if (cur && cur.blocks !== 'manual') get().editPreset({ blocks: 'manual' });
      if (st.selected.includes(i)) {
        play('deselect');
        set({ selected: st.selected.filter((x) => x !== i) });
      } else {
        play('select');
        set({ selected: [...st.selected, i] });
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
      const n = st.selected.length > 0 && st.selected.length < BLOCKS ? st.selected.length : 5;
      set({ selected: smartPick(st.pot.perBlock, n), dockTab: 'pro' });
      if (st.save.presets[st.save.preset]) get().editPreset({ blocks: 'smart', smartN: n });
      play('select');
      haptic.thud();
      updateSave((s) => ({ ...s, questProgress: { ...s.questProgress, shake: 1 } }));
      get().toast(`Shake! Smart-picked the ${n} emptiest spots`, 'good');
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

    buyGear: async (key) => {
      const g = GEAR.find((x) => x.key === key);
      const st = get();
      if (!g) return;
      if (!st.wallet.owner) return st.toast('Connect a wallet to buy gear with SKR', 'bad');
      if (!st.wallet.player) return st.toast('Play one round first to create your miner', 'bad');
      if (st.wallet.skr < g.priceSkr) return st.toast(`You need ${g.priceSkr} SKR`, 'bad');
      try {
        setWallet({ busy: `Buying ${g.name} for ${g.priceSkr} SKR…` });
        await chain.buyGear(g.id);
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
        await chain.stakeSkr(amount);
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
        await chain.unstakeSkr(amount);
        await get().refreshWallet();
        get().toast(`Unstaked ${amount} SKR`, 'good');
      } catch (e) {
        get().toast(errMsg(e), 'bad');
      } finally {
        setWallet({ busy: null });
      }
    },

    connect: async (webWallet?: string) => {
      if (!chain.chainReady) return get().toast('On-chain mode is not deployed yet. Playing practice mode', 'info');
      set({ walletPicker: null });
      try {
        setWallet({ busy: 'Connecting wallet…' });
        const owner = await chain.connectWallet(typeof webWallet === 'string' ? webWallet : undefined);
        saveJson('gali-owner', { owner: owner.toBase58() }, 0);
        session = await chain.loadSession(owner);
        setWallet({ owner: owner.toBase58() });
        await get().refreshWallet();
        get().toast(`Connected ${chain.short(owner.toBase58())}`, 'good');
      } catch (e) {
        if (e instanceof chain.PickWalletError) set({ walletPicker: e.wallets });
        else get().toast(errMsg(e), 'bad');
      } finally {
        setWallet({ busy: null });
      }
    },

    claimRewards: async (what) => {
      const st = get();
      const owner = ownerKey();
      const fmtSkr = (v: number) => Math.floor(v).toLocaleString();
      if (!owner || !chain.chainReady) {
        const { practiceUnclaimedSol: sol = 0, practiceUnclaimedSkr: unrefined = 0, practiceRefinedSkr: refined = 0 } = st.save;
        if (what === 'sol') {
          if (sol <= 0) return st.toast('No SOL to claim yet', 'info');
          updateSave((s) => ({ ...s, practiceSol: s.practiceSol + sol, practiceUnclaimedSol: 0 }));
          play('win');
          return st.toast(`Claimed ${sol.toFixed(4)} SOL (practice)`, 'good');
        }
        if (unrefined + refined <= 0) return st.toast('No SKR to claim yet', 'info');
        const fee = unrefined * chain.REFINING_FEE;
        updateSave((s) => ({ ...s, practiceSkr: s.practiceSkr + unrefined - fee + refined, practiceUnclaimedSkr: 0, practiceRefinedSkr: 0 }));
        play('win');
        return st.toast(`Claimed ${fmtSkr(unrefined - fee + refined)} SKR · ${fmtSkr(fee)} refining fee (practice)`, 'good');
      }
      const u = st.wallet.unclaimed;
      if (what === 'sol' ? u.sol <= 0 : u.unrefined + u.refined <= 0) return st.toast(`No ${what.toUpperCase()} to claim yet`, 'info');
      try {
        // the session pays the fee when it can (no pop-up); otherwise the wallet signs
        const p = st.wallet.player;
        const sessionOk =
          session && p && p.session === session.publicKey.toBase58() && p.sessionExpires * 1000 > Date.now() + 60_000 && st.wallet.sessionSol > 0.003;
        setWallet({ busy: sessionOk ? 'Claiming…' : `Approve: claim your ${what.toUpperCase()}` });
        await chain.claimRewards(owner, what === 'sol' ? chain.CLAIM_SOL : chain.CLAIM_SKR, sessionOk ? session : null);
        await get().refreshWallet();
        play('win');
        haptic.win();
        if (what === 'sol') get().toast(`Claimed ${u.sol.toFixed(4)} SOL`, 'good');
        else {
          const fee = u.fee;
          get().toast(`Claimed ${fmtSkr(u.unrefined - fee + u.refined)} SKR · ${fmtSkr(fee)} refining fee`, 'good');
        }
      } catch (e) {
        get().toast(`Claim failed: ${errMsg(e)}`, 'bad');
      } finally {
        setWallet({ busy: null });
      }
    },

    closeWalletPicker: () => set({ walletPicker: null }),

    disconnect: async () => {
      await chain.disconnectWallet();
      saveJson('gali-owner', { owner: null }, 0);
      session = null;
      set({ run: null, wallet: { owner: null, player: null, skr: 0, sol: 0, sessionSol: 0, pool: 0, rewards: 0, unclaimed: NO_UNCLAIMED, economy: null, busy: null } });
    },

    refreshWallet: async () => {
      const owner = ownerKey();
      if (!owner) return;
      try {
        session = session ?? (await chain.loadSession(owner));
        const [player, skr, sol, sessionSol, pool, rewards, unclaimed, economy] = await Promise.all([
          chain.fetchPlayer(owner),
          chain.fetchSkrBalance(owner),
          chain.fetchSolBalance(owner),
          chain.fetchSolBalance(session.publicKey),
          chain.fetchMotherlodePool(),
          chain.fetchRewardsPool(),
          chain.fetchUnclaimed(owner).catch(() => NO_UNCLAIMED),
          chain.fetchEconomy().catch(() => null),
        ]);
        setWallet({ player, skr, sol, sessionSol, pool, rewards, unclaimed, economy });
      } catch {
        /* offline */
      }
    },

    airdrop: async () => {
      const owner = ownerKey();
      if (!owner) return;
      try {
        setWallet({ busy: 'Requesting devnet SOL…' });
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

    startRun: async (r) => {
      const st = get();
      if (st.run) return;
      if (st.wallet.owner && !chain.chainReady) return st.toast('On-chain mode is not deployed yet', 'bad');
      set({ run: { ...r, left: r.total, lastRound: -1 } });
      play('select');
      get().toast(r.total > 1 ? `Autopilot on: ${r.total} rounds` : 'Deploying this round', 'good');
      const now = chainNow(st.offsetMs);
      const rid = roundOf(now);
      if (st.phase === 'mining' && !st.pending && roundEnd(rid) - now > LOCK_MS + 2000) await runRound();
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
      if (chain.chainReady && st.wallet.owner) {
        const p = await chain.fetchPot(rid).catch(() => null);
        set({ pot: p ? { roundId: rid, perBlock: p.perBlock, total: p.total, miners: p.miners } : emptyPot(rid) });
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
export const useOwnedMask = () => useGame((s) => (s.wallet.player?.gearMask ?? 0) | FREE_GEAR_MASK);

/** SKR the gold spot mines this round: the on-chain budget when connected, the fixed cap in practice. */
export const useRoundReward = () =>
  useGame((s) => (s.wallet.owner && chain.chainReady && s.wallet.economy ? chain.roundRewardNow(s.wallet.economy, s.wallet.rewards) : ROUND_REWARD_SKR));
