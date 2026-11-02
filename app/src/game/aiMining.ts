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

interface AiState {
  status: 'idle' | 'loading' | 'ok' | 'error';
  stats: AiStats | null;
  board: AiMinerRow[];
  me: AiMe | null;
  /** a pass payment the server has not confirmed yet */
  claiming: boolean;
  /** what the AI learned at each review, newest first; null until loaded (subscribers only) */
  log: AiLogEntry[] | null;
  logBusy: boolean;
  /** what the AI saw and decided in the latest rounds, newest first (everyone) */
  thoughts: AiThought[];
}
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
  /** the once-a-day deeper review (Sonnet); the others run every 3 hours (Haiku) */
  daily: boolean;
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
export const useAi = create<AiState>(() => ({ status: 'idle', stats: null, board: [], me: null, claiming: false, log: null, logBusy: false, thoughts: [] }));

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

export async function refreshAi() {
  const wallet = useGame.getState().wallet.owner;
  if (useAi.getState().status === 'idle') useAi.setState({ status: 'loading' });
  try {
    const [s, b, m, t] = await Promise.all([
      rpc('gali_ai_stats'), rpc('gali_ai_board', { p_limit: 50 }), wallet ? rpc('gali_ai_me', { p_wallet: wallet }) : Promise.resolve(null), rpc('gali_ai_thoughts', { p_limit: 8 }).catch(() => []),
    ]);
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
    const thoughts: AiThought[] = (Array.isArray(t) ? t : []).map((x) => ({
      round: num(x.round_id), at: Date.parse(x.at), slotsLeft: num(x.slots_left), motherlodeOre: num(x.motherlode_grams) / 1e11, prizeSol: num(x.prize) / 1e9,
      boardSol: num(x.board) / 1e9, quietestSol: num(x.quietest) / 1e9, joinLimitSol: num(x.join_limit) / 1e9, played: num(x.played), skipped: num(x.skipped),
    }));
    if (useGame.getState().wallet.owner !== wallet) return;
    useAi.setState({ status: 'ok', stats, board, me, thoughts });
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
  g.toast('Gali AI pass active for 7 days', 'good');
  await refreshAi();
  return true;
}

/* ---------------- the free week and the learning log: both need the wallet's sign-in (one signature, no fee) ---------------- */

async function passCall<T>(body: Record<string, unknown>): Promise<{ status: number; data: T & { error?: string } }> {
  const base = restBase();
  if (!base) throw new Error('Gali AI is not set up in this build');
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
    g.toast('Your free week of Gali AI has started', 'good');
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
        daily: x.source === 'claude-daily',
        learned: typeof x.learned === 'string' ? x.learned : null,
        note: typeof x.note === 'string' ? x.note : null,
        feedbackReply: typeof x.feedback_reply === 'string' ? x.feedback_reply : null,
        minEdge: num(x.min_edge), crowdBuffer: num(x.crowd_buffer), maxRoundShare: num(x.max_round_share), targetSlotsLeft: num(x.target_slots_left),
        plays: day && typeof day.plays === 'number' ? day.plays : null,
      };
    });
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
