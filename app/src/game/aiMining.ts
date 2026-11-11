/**
 * Gali AI mining in the app: how many miners use it, what it made each of them, and this wallet's pass.
 * Numbers come from the server's gali_ai_* functions (supabase/sql/ai-mining.sql), which work them out from
 * ORE's own accounts after each round is drawn.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { publicKey, restBase } from './world';
import { useGame } from './store';
import { signIn, signOut, useDm } from './dm';

export interface AiStats {
  activeMiners: number;
  miners: number;
  rounds: number;
  wins: number;
  motherlodes: number;
  deployedSol: number;
  returnedSol: number;
  ore: number;
  feesSol: number;
  /** ORE in SOL at today's price, 0 while unknown */
  oreSol: number;
  tunedAt: string | null;
}
export interface AiMinerRow {
  wallet: string;
  name: string | null;
  active: boolean;
  rounds: number;
  wins: number;
  deployedSol: number;
  returnedSol: number;
  ore: number;
  feesSol: number;
  /** SOL back + ORE (after the 10% claim fee) at today's price - SOL in - executor fees */
  netSol: number;
}
export interface AiMe {
  expiresAt: number | null;
  /** never had a pass: the free week is open */
  trialOpen: boolean;
  /** when this wallet may send feedback again (null: now) */
  nextFeedbackAt: number | null;
  rounds: number;
  wins: number;
  deployedSol: number;
  returnedSol: number;
  ore: number;
  feesSol: number;
  pending: number;
}

/** One wallet's drawn bot rounds in the last 24 hours. */
export interface AiDay { rounds: number; wins: number; deployedSol: number; returnedSol: number; ore: number; feesSol: number }

interface AiState {
  status: 'idle' | 'loading' | 'ok' | 'error';
  stats: AiStats | null;
  board: AiMinerRow[];
  me: AiMe | null;
  /** the last 24 hours of the connected wallet's bot */
  day: AiDay | null;
  /** a pass payment the server has not confirmed yet */
  claiming: boolean;
  /** what the AI learned at each review, newest first; null until loaded (subscribers only) */
  log: AiLogEntry[] | null;
  logBusy: boolean;
  /** what the AI saw and decided in the latest rounds, newest first (everyone) */
  thoughts: AiThought[];
  /** the round reviewer's latest lessons (everyone) */
  lesson: AiLesson | null;
  /** the connected wallet's Bot / AI bot choice; null until it saves one (the server then plays AI bot, safe) */
  settings: BotSettings | null;
  /** the Bot / AI bot switch under the tabs, before START (null: what was saved) */
  modeDraft: BotMode | null;
  /** the settings as filled in before START; null while a value is invalid. START saves them, then funds the bot. */
  draft: BotSettings | null;
}
/** Bot: the player's own rules, no AI. AI bot: a style the review agents tune. SOL amounts in SOL; null = no such rule. */
export type BotMode = 'bot' | 'ai';
export type AiStyle = 'safe' | 'balance' | 'solo';
/** Bot mining is closed while it is being tuned: only these wallets see it (the server keeps the same list). */
export const BOT_WALLETS: readonly string[] = ['PNX9utQBdEs4W7vMNop4wkuzPEsd84dGbMgFeVcoKYa', 'JANRmfiFcQo2D251hQfqmpYzGCrEzqjCid7kisv3Vpym'];
export const botAllowed = (wallet: string | null | undefined) => BOT_WALLETS.length === 0 || (!!wallet && BOT_WALLETS.includes(wallet));
export interface BotSettings {
  mode: BotMode;
  style: AiStyle;
  spots: number;
  perSpotSol: number;
  maxSpotSol: number | null;
  minMotherlodeOre: number | null;
  maxRoundSol: number | null;
  stopLossSol: number | null;
  /** how long the bot runs from START, in hours; null: until stopped */
  runHours: number | null;
  /** when the current run ends (ms), from the server */
  runUntil?: number | null;
}
export const DEFAULT_BOT_SETTINGS: BotSettings = { mode: 'ai', style: 'safe', spots: 10, perSpotSol: 0.002, maxSpotSol: null, minMotherlodeOre: null, maxRoundSol: null, stopLossSol: null, runHours: null };
const orNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const toSettings = (x: Record<string, unknown>): BotSettings => ({
  mode: x.mode === 'bot' ? 'bot' : 'ai',
  style: x.style === 'solo' || x.style === 'balance' ? x.style : 'safe',
  spots: Number(x.spots) || 10, perSpotSol: Number(x.per_spot_sol) || 0.002,
  maxSpotSol: orNull(x.max_spot_sol), minMotherlodeOre: orNull(x.min_motherlode_ore), maxRoundSol: orNull(x.max_round_sol), stopLossSol: orNull(x.stop_loss_sol),
  runHours: orNull(x.run_hours), runUntil: x.run_until ? Date.parse(String(x.run_until)) || null : null,
});
export interface AiLesson { at: number; fromRound: number; toRound: number; rounds: number; played: number; lessons: string; watch: string | null }
const toLesson = (x: Record<string, unknown>): AiLesson => ({
  at: Date.parse(String(x.at)), fromRound: num(x.from_round), toRound: num(x.to_round), rounds: num(x.rounds), played: num(x.played),
  lessons: String(x.lessons ?? ''), watch: typeof x.watch === 'string' ? x.watch : null,
});
export interface AiThought {
  round: number;
  at: number;
  /** seconds before the round ended, roughly */
  slotsLeft: number;
  motherlodeOre: number;
  /** one winning spot's prize, motherlode share included */
  prizeSol: number;
  boardSol: number;
  quietestSol: number;
  /** spots holding more than this were not worth joining */
  joinLimitSol: number;
  played: number;
  skipped: number;
}
export interface AiLogEntry {
  at: number;
  /** review: the 3-hourly team (Haiku); daily: the once-a-day team (Sonnet); rounds: the 15-minute round reviewer (Haiku) */
  kind: 'review' | 'daily' | 'rounds';
  /** rounds entries: how many rounds it read, how many the AI played, and what it watches next */
  rounds?: number;
  played?: number;
  watch?: string | null;
  learned: string | null;
  note: string | null;
  /** how the team used subscribers' feedback in that review */
  feedbackReply: string | null;
  minEdge: number;
  crowdBuffer: number;
  maxRoundShare: number;
  targetSlotsLeft: number;
  /** plays in the 24 hours before this entry, when known */
  plays: number | null;
}
export const useAi = create<AiState>(() => ({ status: 'idle', stats: null, board: [], me: null, day: null, claiming: false, log: null, logBusy: false, thoughts: [], lesson: null, settings: null, modeDraft: null, draft: null }));

const headers = () => ({ apikey: publicKey(), authorization: `Bearer ${publicKey()}`, 'content-type': 'application/json' });
const rpc = async (fn: string, args: Record<string, unknown> = {}) => {
  const base = restBase();
  if (!base) throw new Error('offline');
  const r = await fetch(`${base}/rest/v1/rpc/${fn}`, { method: 'POST', headers: headers(), body: JSON.stringify(args) });
  if (!r.ok) throw new Error(`${fn} ${r.status}`);
  return r.json();
};
const num = (v: unknown) => Number(v) || 0;

/** Net result in SOL: what came back, plus ORE after ORE's 10% claim fee at today's price, minus what went in. */
export const netSol = (x: { deployedSol: number; returnedSol: number; ore: number; feesSol: number }, oreSol: number) =>
  x.returnedSol + x.ore * 0.9 * oreSol - x.deployedSol - x.feesSol;

/** One round for the connected wallet's bot: played (and how it went) or sat out. SOL and ORE. */
export interface AiRoundRow {
  round: number; at: number; played: boolean; landed: boolean; squares: number; sol: number; back: number | null; ore: number | null; won: boolean | null; settled: boolean;
  boardSol: number | null; quietestSol: number | null; joinLimitSol: number | null; motherlodeOre: number | null; botsPlayed: number | null; winSquare: number | null;
}
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));
/** The connected wallet's rounds since its bot started, newest first, the sat-out ones included. */
export async function loadRounds(limit = 150): Promise<AiRoundRow[] | null> {
  const wallet = useGame.getState().wallet.owner;
  if (!wallet) return null;
  const rows = await rpc('gali_ai_my_rounds', { p_wallet: wallet, p_limit: limit }).catch(() => null);
  if (!Array.isArray(rows)) return null;
  return rows.map((r) => ({
    round: num(r.round_id), at: Date.parse(r.at), played: Boolean(r.played), landed: Boolean(r.landed), squares: num(r.squares), sol: num(r.sol),
    back: numOrNull(r.back), ore: numOrNull(r.ore), won: r.won === null ? null : Boolean(r.won), settled: Boolean(r.settled),
    boardSol: numOrNull(r.board_sol), quietestSol: numOrNull(r.quietest_sol), joinLimitSol: numOrNull(r.join_limit_sol), motherlodeOre: numOrNull(r.motherlode_ore),
    botsPlayed: numOrNull(r.bots_played), winSquare: numOrNull(r.win_square),
  }));
}

/** A solo 1 ORE winner or a motherlode on ORE's board (any wallet). */
export interface BigHit { round: number; at: number; wallet: string | null; name: string | null; mine: boolean; squares: number | null; stakeSol: number | null; squareSol: number | null; share: number | null; ore: number; motherlodeOre: number }
export async function loadBigHits(limit = 60): Promise<BigHit[] | null> {
  const wallet = useGame.getState().wallet.owner;
  const rows = await rpc('gali_big_hits', { p_wallet: wallet ?? null, p_limit: limit }).catch(() => null);
  if (!Array.isArray(rows)) return null;
  return rows.map((r) => ({
    round: num(r.round_id), at: Date.parse(r.at), wallet: r.wallet ?? null, name: r.name || null, mine: Boolean(r.mine), squares: numOrNull(r.squares),
    stakeSol: numOrNull(r.stake_sol), squareSol: numOrNull(r.square_sol), share: numOrNull(r.share), ore: num(r.ore), motherlodeOre: num(r.motherlode_ore),
  }));
}

/** Everyone in the current ORE round, biggest deploy first. */
export interface RoundNow { round: string; slotsLeft: number; miners: number; sol: number; list: { wallet: string; name: string | null; sol: number; spots: number; perSpot: number }[] }
export async function loadRoundNow(): Promise<RoundNow | null> {
  const base = restBase();
  if (!base) return null;
  const r = await fetch(`${base}/functions/v1/round-miners`, { headers: headers() }).catch(() => null);
  if (!r || !r.ok) return null;
  return (await r.json().catch(() => null)) as RoundNow | null;
}

export async function refreshAi() {
  const wallet = useGame.getState().wallet.owner;
  if (useAi.getState().status === 'idle') useAi.setState({ status: 'loading' });
  try {
    const [s, b, m, cfg, d] = await Promise.all([
      rpc('gali_ai_stats'), rpc('gali_ai_board', { p_limit: 50 }), wallet ? rpc('gali_ai_me', { p_wallet: wallet }) : Promise.resolve(null),
      wallet ? rpc('gali_bot_settings_of', { p_wallet: wallet }).catch(() => null) : Promise.resolve(null),
      wallet ? rpc('gali_ai_day', { p_wallet: wallet }).catch(() => null) : Promise.resolve(null),
    ]);
    const dr = Array.isArray(d) ? d[0] : null;
    const day: AiDay | null = dr
      ? { rounds: num(dr.rounds), wins: num(dr.wins), deployedSol: num(dr.deployed_sol), returnedSol: num(dr.returned_sol), ore: num(dr.ore), feesSol: num(dr.fees_sol) }
      : null;
    const r = Array.isArray(s) ? s[0] : null;
    const stats: AiStats | null = r
      ? {
          activeMiners: num(r.active_miners), miners: num(r.miners), rounds: num(r.rounds), wins: num(r.wins), motherlodes: num(r.motherlodes),
          deployedSol: num(r.deployed_sol), returnedSol: num(r.returned_sol), ore: num(r.ore), feesSol: num(r.fees_sol),
          oreSol: num(r.sol_usd) > 0 ? num(r.ore_usd) / num(r.sol_usd) : 0, tunedAt: r.tuned_at ?? null,
        }
      : null;
    const board: AiMinerRow[] = (Array.isArray(b) ? b : []).map((x) => ({
      wallet: String(x.wallet), name: x.name ?? null, active: Boolean(x.active), rounds: num(x.rounds), wins: num(x.wins),
      deployedSol: num(x.deployed_sol), returnedSol: num(x.returned_sol), ore: num(x.ore), feesSol: num(x.fees_sol), netSol: num(x.net_sol),
    }));
    const mr = Array.isArray(m) ? m[0] : null;
    const me: AiMe | null = mr
      ? {
          expiresAt: mr.expires_at ? Date.parse(mr.expires_at) : null, trialOpen: Boolean(mr.trial_open), nextFeedbackAt: mr.next_feedback_at ? Date.parse(mr.next_feedback_at) : null, rounds: num(mr.rounds), wins: num(mr.wins), deployedSol: num(mr.deployed_sol),
          returnedSol: num(mr.returned_sol), ore: num(mr.ore), feesSol: num(mr.fees_sol), pending: num(mr.pending),
        }
      : null;
    if (useGame.getState().wallet.owner !== wallet) return;
    const settings = Array.isArray(cfg) && cfg[0] ? toSettings(cfg[0]) : null;
    useAi.setState({ status: 'ok', stats, board, me, settings, day });
  } catch {
    useAi.setState((st) => ({ status: st.stats ? 'ok' : 'error' }));
  }
  if (wallet) void retryPendingPass(wallet);
}

const PENDING_KEY = 'gali-ai-pass-pending';
const passActive = (me: AiMe | null) => Boolean(me?.expiresAt && me.expiresAt > Date.now());
export const hasPass = () => passActive(useAi.getState().me);

/** Tell the server about a pass payment. Kept on the device until it confirms, so a dropped connection loses nothing. */
async function claimPass(wallet: string, signature: string): Promise<'ok' | 'retry' | 'rejected'> {
  const base = restBase();
  if (!base) return 'retry';
  try {
    const r = await fetch(`${base}/functions/v1/ai-pass`, { method: 'POST', headers: headers(), body: JSON.stringify({ wallet, signature }) });
    if (r.ok || r.status === 409) return 'ok'; // 409: already counted
    if (r.status === 400) return 'rejected';
    return 'retry';
  } catch {
    return 'retry';
  }
}

async function retryPendingPass(wallet: string) {
  if (useAi.getState().claiming) return;
  const raw = await AsyncStorage.getItem(PENDING_KEY).catch(() => null);
  const p = raw ? (JSON.parse(raw) as { wallet: string; signature: string; at: number }) : null;
  if (!p || p.wallet !== wallet) return;
  useAi.setState({ claiming: true });
  const res = await claimPass(p.wallet, p.signature);
  useAi.setState({ claiming: false });
  if (res === 'retry' && Date.now() - p.at < 50 * 60_000) return;
  await AsyncStorage.removeItem(PENDING_KEY).catch(() => undefined);
  if (res === 'ok') void refreshAi();
}

/** Pay 0.1 SOL and turn it into 7 days of Gali AI. */
export async function buyPass(): Promise<boolean> {
  const g = useGame.getState();
  const wallet = g.wallet.owner;
  if (!wallet) {
    g.toast('Connect a wallet first', 'info');
    return false;
  }
  // closed while the bot is being tuned: never send SOL for a pass the server would refuse
  if (!botAllowed(wallet)) {
    g.toast('Bot mining is not open yet', 'info');
    return false;
  }
  const signature = await g.payAiPass();
  if (!signature) return false;
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify({ wallet, signature, at: Date.now() })).catch(() => undefined);
  useAi.setState({ claiming: true });
  let res: Awaited<ReturnType<typeof claimPass>> = 'retry';
  for (let i = 0; i < 4 && res === 'retry'; i++) {
    if (i) await new Promise((r) => setTimeout(r, 3000));
    res = await claimPass(wallet, signature);
  }
  useAi.setState({ claiming: false });
  if (res === 'retry') {
    g.toast('Payment sent. Your pass will show as soon as the server sees it', 'info');
    return true;
  }
  await AsyncStorage.removeItem(PENDING_KEY).catch(() => undefined);
  if (res === 'rejected') {
    g.toast('The server could not match that payment. Contact @Gali_Game with your transaction', 'bad');
    return false;
  }
  g.toast('Bot pass active for 7 days', 'good');
  await refreshAi();
  return true;
}

/* ---------------- the free week and the learning log: both need the wallet's sign-in (one signature, no fee) ---------------- */

async function passCall<T>(body: Record<string, unknown>): Promise<{ status: number; data: T & { error?: string } }> {
  const base = restBase();
  if (!base) throw new Error('The bot is not set up in this build');
  const r = await fetch(`${base}/functions/v1/ai-pass`, { method: 'POST', headers: headers(), body: JSON.stringify(body) });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

/** The sign-in pass for the connected wallet, asking the wallet to sign in when there is none. */
async function signedPass(): Promise<string | null> {
  const owner = useGame.getState().wallet.owner;
  const dm = useDm.getState();
  if (dm.pass && dm.me === owner) return dm.pass;
  try {
    await signIn();
  } catch (e) {
    useGame.getState().toast(String((e as Error)?.message ?? e).slice(0, 120), 'bad');
    return null;
  }
  return useDm.getState().pass;
}

/** Start the free week (once per wallet, only for wallets that never had a pass). */
export async function startTrial(): Promise<boolean> {
  const g = useGame.getState();
  if (!g.wallet.owner) {
    g.toast('Connect a wallet first', 'info');
    return false;
  }
  const pass = await signedPass();
  if (!pass) return false;
  try {
    let r = await passCall<{ expiresAt: string }>({ a: 'trial', pass });
    if (r.status === 401) {
      await signOut();
      const again = await signedPass();
      if (!again) return false;
      r = await passCall<{ expiresAt: string }>({ a: 'trial', pass: again });
    }
    if (r.status !== 200) {
      g.toast(r.data.error ?? 'Could not start the free week', 'bad');
      return false;
    }
    g.toast('Your free week of the bot has started', 'good');
    await refreshAi();
    return true;
  } catch {
    g.toast('Could not reach the server. Try again', 'bad');
    return false;
  }
}

/** What the AI learned at each review. Subscribers only: the server checks the sign-in and the pass. */
export async function loadLog(ask = false): Promise<void> {
  if (useAi.getState().logBusy) return;
  const owner = useGame.getState().wallet.owner;
  const dm = useDm.getState();
  const pass = dm.pass && dm.me === owner ? dm.pass : ask ? await signedPass() : null;
  if (!pass) return;
  useAi.setState({ logBusy: true });
  try {
    const r = await passCall<{ log: Record<string, unknown>[] }>({ a: 'log', pass });
    if (r.status === 401) {
      await signOut();
      return;
    }
    if (r.status !== 200) {
      useAi.setState({ log: null });
      return;
    }
    const log: AiLogEntry[] = (r.data.log ?? []).map((x) => {
      const day = (x.stats as { last24h?: { plays?: number } } | null)?.last24h;
      return {
        at: Date.parse(String(x.at)),
        kind: x.source === 'claude-daily' ? ('daily' as const) : ('review' as const),
        learned: typeof x.learned === 'string' ? x.learned : null,
        note: typeof x.note === 'string' ? x.note : null,
        feedbackReply: typeof x.feedback_reply === 'string' ? x.feedback_reply : null,
        minEdge: num(x.min_edge), crowdBuffer: num(x.crowd_buffer), maxRoundShare: num(x.max_round_share), targetSlotsLeft: num(x.target_slots_left),
        plays: day && typeof day.plays === 'number' ? day.plays : null,
      };
    });
    // the round reviewer's lessons go in the same log, so it fills every 15 minutes
    const lessons = await rpc('gali_ai_lessons', { p_limit: 20 }).catch(() => []);
    for (const x of Array.isArray(lessons) ? lessons : []) {
      const ls = toLesson(x);
      log.push({ at: ls.at, kind: 'rounds', rounds: ls.rounds, played: ls.played, watch: ls.watch, learned: ls.lessons, note: null, feedbackReply: null, minEdge: 0, crowdBuffer: 0, maxRoundShare: 0, targetSlotsLeft: 0, plays: null });
    }
    log.sort((a, b) => b.at - a.at);
    if (useGame.getState().wallet.owner === owner) useAi.setState({ log });
  } catch {
    /* keep what we had */
  } finally {
    useAi.setState({ logBusy: false });
  }
}

export type AiVote = 'more' | 'same' | 'safer';

/** Send feedback to the hourly review: a vote and an optional comment. Subscribers only, once every 2 hours. */
export async function sendFeedback(vote: AiVote, comment: string): Promise<boolean> {
  const g = useGame.getState();
  const pass = await signedPass();
  if (!pass) return false;
  try {
    let r = await passCall<{ nextAt: string }>({ a: 'feedback', pass, vote, comment: comment.slice(0, 200) });
    if (r.status === 401) {
      await signOut();
      const again = await signedPass();
      if (!again) return false;
      r = await passCall<{ nextAt: string }>({ a: 'feedback', pass: again, vote, comment: comment.slice(0, 200) });
    }
    const next = r.data.nextAt ? Date.parse(r.data.nextAt) : null;
    if (next) useAi.setState((st) => ({ me: st.me ? { ...st.me, nextFeedbackAt: next } : st.me }));
    if (r.status !== 200) {
      g.toast(r.data.error ?? 'Could not send your feedback', r.status === 429 ? 'info' : 'bad');
      return false;
    }
    g.toast('Thanks. The team reads it at the next review', 'good');
    return true;
  } catch {
    g.toast('Could not reach the server. Try again', 'bad');
    return false;
  }
}

/** Saves the wallet's Bot / AI bot choice (signs in once). Saving starts the stop-loss count again. */
export async function saveBotSettings(v: BotSettings): Promise<boolean> {
  const g = useGame.getState();
  const pass = await signedPass();
  if (!pass) return false;
  try {
    let r = await passCall<{ settings: Record<string, unknown> }>({ a: 'settings', pass, settings: v });
    if (r.status === 401) {
      await signOut();
      const again = await signedPass();
      if (!again) return false;
      r = await passCall<{ settings: Record<string, unknown> }>({ a: 'settings', pass: again, settings: v });
    }
    if (r.status !== 200 || !r.data.settings) {
      g.toast(r.data.error ?? 'Could not save your settings', 'bad');
      return false;
    }
    useAi.setState({ settings: toSettings(r.data.settings) });
    g.toast(v.mode === 'bot' ? 'Saved. The bot follows your rules from the next round' : 'Saved. The AI bot plays your style from the next round', 'good');
    return true;
  } catch {
    g.toast('Could not reach the server. Try again', 'bad');
    return false;
  }
}
