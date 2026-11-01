/**
 * Gali AI mining in the app: how many miners use it, what it made each of them, and this wallet's pass.
 * Numbers come from the server's gali_ai_* functions (supabase/sql/ai-mining.sql), which work them out from
 * ORE's own accounts after each round is drawn.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { publicKey, restBase } from './world';
import { useGame } from './store';

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
  tuneNote: string | null;
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
}
export const useAi = create<AiState>(() => ({ status: 'idle', stats: null, board: [], me: null, claiming: false }));

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
    const [s, b, m] = await Promise.all([rpc('gali_ai_stats'), rpc('gali_ai_board', { p_limit: 50 }), wallet ? rpc('gali_ai_me', { p_wallet: wallet }) : Promise.resolve(null)]);
    const r = Array.isArray(s) ? s[0] : null;
    const stats: AiStats | null = r
      ? {
          activeMiners: num(r.active_miners), miners: num(r.miners), rounds: num(r.rounds), wins: num(r.wins), motherlodes: num(r.motherlodes),
          deployedSol: num(r.deployed_sol), returnedSol: num(r.returned_sol), ore: num(r.ore), feesSol: num(r.fees_sol),
          oreSol: num(r.sol_usd) > 0 ? num(r.ore_usd) / num(r.sol_usd) : 0, tunedAt: r.tuned_at ?? null, tuneNote: r.tune_note ?? null,
        }
      : null;
    const board: AiMinerRow[] = (Array.isArray(b) ? b : []).map((x) => ({
      wallet: String(x.wallet), name: x.name ?? null, active: Boolean(x.active), rounds: num(x.rounds), wins: num(x.wins),
      deployedSol: num(x.deployed_sol), returnedSol: num(x.returned_sol), ore: num(x.ore), feesSol: num(x.fees_sol), netSol: num(x.net_sol),
    }));
    const mr = Array.isArray(m) ? m[0] : null;
    const me: AiMe | null = mr
      ? {
          expiresAt: mr.expires_at ? Date.parse(mr.expires_at) : null, rounds: num(mr.rounds), wins: num(mr.wins), deployedSol: num(mr.deployed_sol),
          returnedSol: num(mr.returned_sol), ore: num(mr.ore), feesSol: num(mr.fees_sol), pending: num(mr.pending),
        }
      : null;
    if (useGame.getState().wallet.owner !== wallet) return;
    useAi.setState({ status: 'ok', stats, board, me });
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
