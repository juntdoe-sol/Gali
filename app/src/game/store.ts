import { create } from 'zustand';
import { PublicKey, type Keypair } from '@solana/web3.js';
import * as chain from '../chain/client';
import {
  ACHIEVEMENTS, BLOCKS, boostFor, DAILY_FREE_DIGS, FREE_GEAR_MASK, GEAR, LOCK_MS, localDay, levelFromXp, MOTHERLODE_ODDS,
  pointsFor, QUESTS, REVEAL_MIN_MS, ROUND_SECS,
} from './constants';
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
  digs: number;
  digsToday: number;
  digDay: string;
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
  digsToday: 0,
  digDay: localDay(),
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
  muted: false,
  onboarded: false,
});

interface Wallet {
  owner: string | null;
  player: chain.ChainPlayer | null;
  skr: number;
  sol: number;
  sessionSol: number;
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
  pending: { roundId: number; mask: number; boostBps: number; onChain: boolean } | null;
  selected: number[];
  lastResult: RoundResult | null;
  resultAt: number;
  toasts: Toast[];
  levelUp: number | null;
  emote: number;
  gearReveal: string | null;

  boot: () => Promise<void>;
  tick: () => void;
  toggleBlock: (i: number) => void;
  selectRandom: (n: number) => void;
  selectAll: () => void;
  clearSelection: () => void;
  dig: (via?: 'tap' | 'shake') => Promise<void>;
  bonkMole: () => void;
  doEmote: () => void;
  claimQuest: (id: string) => void;
  equip: (key: string) => void;
  buyGear: (key: string) => Promise<void>;
  stake: (amount: number) => Promise<void>;
  unstake: (amount: number) => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  refreshWallet: () => Promise<void>;
  airdrop: () => Promise<void>;
  setMute: (m: boolean) => void;
  finishOnboarding: () => void;
  toast: (text: string, tone?: Toast['tone']) => void;
  dismissLevel: () => void;
  dismissGear: () => void;
}

let toastId = 1;
let session: Keypair | null = null;
const chainNow = (offset: number) => Date.now() + offset;
const roundOf = (t: number) => Math.floor(t / 1000 / ROUND_SECS);
export const roundEnd = (rid: number) => (rid + 1) * ROUND_SECS * 1000;
const errMsg = (e: unknown) => {
  const m = String((e as Error)?.message ?? e);
  if (/OutOfDigs/.test(m)) return 'No free digs left today';
  if (/RoundLocked/.test(m)) return 'Round is locking. Try next round';
  if (/insufficient|0x1\b/i.test(m)) return 'Not enough balance';
  if (/declined|cancel|rejected/i.test(m)) return 'Cancelled in wallet';
  if (/found no installed|wallet/i.test(m) && /not found|no.*wallet/i.test(m)) return 'No Solana wallet app found';
  return m.length > 90 ? `${m.slice(0, 90)}…` : m;
};

function rollDay(s: Save): Save {
  const today = localDay();
  let out = s;
  if (s.questDay !== today) out = { ...out, questDay: today, questProgress: {}, questClaimed: [] };
  if (s.digDay !== today) out = { ...out, digDay: today, digsToday: 0 };
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

  async function ensureSession(owner: PublicKey) {
    session = session ?? (await chain.loadSession(owner));
    const p = get().wallet.player;
    const valid = p && p.session === session.publicKey.toBase58() && p.sessionExpires * 1000 > Date.now() + 120_000;
    const sessionSol = await chain.fetchSolBalance(session.publicKey);
    if (valid && sessionSol > 0.005) return session;
    setWallet({ busy: 'Approve a 24h dig session in your wallet' });
    await chain.startSession(owner, session, Boolean(p));
    await get().refreshWallet();
    get().toast('Session started. Digs are now one tap', 'good');
    return session;
  }

  async function settle(roundId: number) {
    const { pending, offsetMs } = get();
    if (!pending) return;
    let winning: number;
    let motherlode = false;
    if (pending.onChain) {
      const owner = ownerKey();
      try {
        if (!owner || !session) throw new Error('wallet disconnected');
        const r = await chain.sessionSettle(owner, session, roundId);
        if (!r) throw new Error('round not revealed');
        winning = r.winning;
        motherlode = r.motherlode;
      } catch (e) {
        get().toast(`Couldn't settle round: ${errMsg(e)}`, 'bad');
        set({ phase: 'mining', pending: null, roundId: roundOf(chainNow(offsetMs)) });
        return;
      }
    } else {
      await new Promise((r) => setTimeout(r, 900));
      winning = Math.floor(Math.random() * BLOCKS);
      motherlode = Math.random() < 1 / MOTHERLODE_ODDS;
    }
    play('rumble');
    set({ phase: 'reveal', winning, revealStartAt: Date.now() });
    const covered = pending.mask.toString(2).split('1').length - 1;
    const won = (pending.mask & (1 << winning)) !== 0;
    const points = won ? pointsFor(covered, motherlode, pending.boostBps) : 0;
    setTimeout(async () => {
      const result: RoundResult = { roundId, winning, covered, won, points, motherlode, onChain: pending.onChain };
      if (pending.onChain) await get().refreshWallet();
      updateSave((s) => {
        const winStreak = won ? s.winStreak + 1 : 0;
        const qp = { ...s.questProgress };
        if (won) qp.win1 = (qp.win1 ?? 0) + 1;
        if (won && covered <= 5) qp.sharp = 1;
        return {
          ...s,
          xp: pending.onChain ? s.xp : s.xp + (won ? 50 : 0),
          points: pending.onChain ? s.points : s.points + points,
          wins: pending.onChain ? s.wins : s.wins + (won ? 1 : 0),
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
      set({
        phase: 'mining',
        pending: null,
        winning: null,
        lastResult: result,
        resultAt: Date.now(),
        roundId: roundOf(chainNow(get().offsetMs)),
      });
    }, REVEAL_MIN_MS - 1400);
  }

  return {
    loaded: false,
    save: freshSave(),
    wallet: { owner: null, player: null, skr: 0, sol: 0, sessionSol: 0, busy: null },
    offsetMs: 0,
    now: Date.now(),
    roundId: roundOf(Date.now()),
    phase: 'mining',
    settleStartAt: 0,
    revealStartAt: 0,
    winning: null,
    pending: null,
    selected: [],
    lastResult: null,
    resultAt: 0,
    toasts: [],
    levelUp: null,
    emote: 0,
    gearReveal: null,

    boot: async () => {
      const save = rollDay(await loadJson(SAVE_KEY, freshSave()));
      setMuted(save.muted);
      const owner = await loadJson<{ owner: string | null }>('gali-owner', { owner: null });
      set({ save, loaded: true });
      chain
        .clockOffsetMs()
        .then((o) => set({ offsetMs: o, roundId: roundOf(chainNow(o)) }))
        .catch(() => undefined);
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
      if (st.phase !== 'mining' || st.pending) return;
      haptic.tap();
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

    dig: async (via = 'tap') => {
      const st = get();
      if (st.phase !== 'mining' || st.pending || st.wallet.busy) return;
      let selected = st.selected;
      if (!selected.length) {
        if (via !== 'shake') return st.toast('Tap blocks on the mine first', 'bad');
        selected = [...Array(BLOCKS).keys()].sort(() => Math.random() - 0.5).slice(0, 3);
        set({ selected });
      }
      const now = chainNow(st.offsetMs);
      const roundId = roundOf(now);
      if (roundEnd(roundId) - now < LOCK_MS) return st.toast('Round is locking. Get ready for the next one', 'bad');
      const save = rollDay(st.save);
      const digsToday = st.wallet.player && st.wallet.player.day === Math.floor(now / 86_400_000) ? st.wallet.player.digsToday : save.digsToday;
      if (digsToday >= DAILY_FREE_DIGS) return st.toast(`You've used all ${DAILY_FREE_DIGS} free digs today`, 'bad');
      const mask = selected.reduce((m, i) => m | (1 << i), 0);
      const owner = ownerKey();
      const onChain = Boolean(owner && chain.chainReady);
      const boostBps = boostFor(staked());
      try {
        if (onChain && owner) {
          const s = await ensureSession(owner);
          setWallet({ busy: 'Digging on Solana…' });
          const rNow = roundOf(chainNow(get().offsetMs));
          if (rNow !== roundId) throw new Error('RoundLocked');
          await chain.sessionDig(owner, s, roundId, mask);
        }
      } catch (e) {
        setWallet({ busy: null });
        return get().toast(errMsg(e), 'bad');
      }
      setWallet({ busy: null });
      play('dig');
      haptic.thud();
      set({ pending: { roundId, mask, boostBps, onChain }, selected, roundId });
      updateSave((s) => {
        const today = localDay();
        const yesterday = localDay(Date.now() - 86_400_000);
        const dayStreak = s.lastDigDay === today ? s.dayStreak : s.lastDigDay === yesterday ? s.dayStreak + 1 : 1;
        const qp: Record<string, number> = { ...s.questProgress, dig5: (s.questProgress.dig5 ?? 0) + 1 };
        if (via === 'shake') qp.shake = 1;
        return { ...s, digs: s.digs + 1, digsToday: s.digsToday + 1, dayStreak, lastDigDay: today, xp: onChain ? s.xp : s.xp + 10 + selected.length, questProgress: qp };
      });
      if (onChain) void get().refreshWallet();
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
      updateSave((s) => (g.kind === 'pickaxe' ? { ...s, pickaxe: key } : { ...s, helmet: key }));
    },

    buyGear: async (key) => {
      const g = GEAR.find((x) => x.key === key);
      const st = get();
      if (!g) return;
      if (!st.wallet.owner) return st.toast('Connect a wallet to buy gear with SKR', 'bad');
      if (!st.wallet.player) return st.toast('Dig once first to create your miner', 'bad');
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
      if (!st.wallet.player) return st.toast('Dig once first to create your miner', 'bad');
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

    connect: async () => {
      if (!chain.chainReady) return get().toast('On-chain mode is not deployed yet. Playing practice mode', 'info');
      try {
        setWallet({ busy: 'Connecting wallet…' });
        const owner = await chain.connectWallet();
        saveJson('gali-owner', { owner: owner.toBase58() }, 0);
        session = await chain.loadSession(owner);
        setWallet({ owner: owner.toBase58() });
        await get().refreshWallet();
        get().toast(`Connected ${chain.short(owner.toBase58())}`, 'good');
      } catch (e) {
        get().toast(errMsg(e), 'bad');
      } finally {
        setWallet({ busy: null });
      }
    },

    disconnect: async () => {
      await chain.disconnectWallet();
      saveJson('gali-owner', { owner: null }, 0);
      session = null;
      set({ wallet: { owner: null, player: null, skr: 0, sol: 0, sessionSol: 0, busy: null } });
    },

    refreshWallet: async () => {
      const owner = ownerKey();
      if (!owner) return;
      try {
        session = session ?? (await chain.loadSession(owner));
        const [player, skr, sol, sessionSol] = await Promise.all([
          chain.fetchPlayer(owner),
          chain.fetchSkrBalance(owner),
          chain.fetchSolBalance(owner),
          chain.fetchSolBalance(session.publicKey),
        ]);
        setWallet({ player, skr, sol, sessionSol });
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
