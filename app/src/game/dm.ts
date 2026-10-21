/**
 * Direct messages between players, wallet to wallet.
 *
 * You sign in once by signing a short text with your wallet (free: no transaction). The server
 * (supabase/functions/dm) checks it and gives back a pass that lasts 30 days, kept in the phone's secure
 * storage. Only the two wallets in a conversation can read it. Messages are kept 30 days.
 *
 * Tokens can be sent in a DM: the same tip as the lobby (ORE, SKR or SOL, preset amounts), approved in
 * your wallet, then posted to the conversation once the chain shows it.
 *
 * The inbox is checked every 25 seconds while the app is open and signed in, the open conversation every
 * 4 seconds. Nothing here is trusted from the other side: the server cleans every line.
 */
import { create } from 'zustand';
import { loadChain } from '../chain/lazy';
import type { TipToken } from '../chain/light';
import { getSecret, removeSecret, setSecret } from '../chain/secure';
import { haptic, play } from './sfx';
import { useGame } from './store';
import { useName } from './username';
import { publicKey, restBase } from './world';

export interface DmMsg {
  id: number;
  at: string;
  sender: string;
  recipient: string;
  sender_name: string;
  kind: 'msg' | 'tip';
  body: string;
  tip_token: TipToken | null;
  tip_amount: number | null;
  tip_sig: string | null;
  read_at: string | null;
  /** sent from here, not yet confirmed */
  local?: boolean;
}
export interface DmThread {
  wallet: string;
  name: string;
  last: string;
  at: string;
  unread: number;
  kind: 'msg' | 'tip';
  mine: boolean;
}

interface DmState {
  open: boolean;
  /** the wallet the pass is for, and the pass */
  me: string | null;
  pass: string | null;
  threads: DmThread[];
  unread: number;
  /** the open conversation */
  withWallet: string | null;
  withName: string;
  msgs: DmMsg[];
  blocked: boolean;
  busy: boolean;
  error: string | null;
  /** names we learned from the lobby, island and arena, for threads that have none yet */
  names: Record<string, string>;
}

const PASS_KEY = 'gali-dm-pass';
export const dmReady = () => Boolean(restBase() && publicKey());
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const useDm = create<DmState>(() => ({
  open: false,
  me: null,
  pass: null,
  threads: [],
  unread: 0,
  withWallet: null,
  withName: '',
  msgs: [],
  blocked: false,
  busy: false,
  error: null,
  names: {},
}));

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const base = restBase();
  if (!base) throw new Error('Messages are not set up in this build');
  const r = await fetch(`${base}/functions/v1/dm`, {
    method: 'POST',
    headers: { apikey: publicKey(), Authorization: `Bearer ${publicKey()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && body.a !== 'login') {
    // the pass ran out or the server changed its secret: sign in again
    await signOut();
  }
  if (!r.ok) throw new Error(j.error ?? (r.status === 404 ? 'Messages are not switched on yet' : `Message server error ${r.status}`));
  return j as T;
}

/** The pass we kept, if it is for the wallet connected now. */
async function restore() {
  const owner = useGame.getState().wallet.owner;
  const raw = await getSecret(PASS_KEY).catch(() => null);
  if (!raw || !owner) return;
  try {
    const { wallet, pass, exp } = JSON.parse(raw);
    if (wallet === owner && typeof pass === 'string' && Number(exp) > Date.now()) useDm.setState({ me: wallet, pass });
  } catch {
    /* a broken copy: sign in again */
  }
}

/** Sign in with the connected wallet: one signature, no fee. */
export async function signIn() {
  const g = useGame.getState();
  const owner = g.wallet.owner;
  if (!owner) throw new Error('Connect a wallet first');
  const ts = Date.now();
  const text = `Gali: sign in to your messages\nWallet: ${owner}\nTime: ${ts}\nThis costs nothing and sends no transaction.`;
  const chain = await loadChain();
  const { owner: signer, sig } = await chain.signTextWithWallet(text);
  if (signer !== owner) throw new Error('That is a different wallet from the one connected');
  const r = await call<{ pass: string; exp: number; wallet: string }>({ a: 'login', wallet: owner, ts, sig });
  await setSecret(PASS_KEY, JSON.stringify({ wallet: owner, pass: r.pass, exp: r.exp }));
  useDm.setState({ me: owner, pass: r.pass, error: null });
  void refreshInbox();
}
export async function signOut() {
  await removeSecret(PASS_KEY).catch(() => undefined);
  useDm.setState({ me: null, pass: null, threads: [], unread: 0, msgs: [] });
}

let inboxAt = 0;
let lastUnread = 0;
export async function refreshInbox(force = false) {
  const s = useDm.getState();
  if (!s.pass || (!force && Date.now() - inboxAt < 3000)) return;
  inboxAt = Date.now();
  try {
    const { threads } = await call<{ threads: DmThread[] }>({ a: 'inbox', pass: s.pass });
    const names = useDm.getState().names;
    const list = threads.map((t) => ({ ...t, name: t.name || names[t.wallet] || '' }));
    const unread = list.reduce((n, t) => n + (t.wallet === useDm.getState().withWallet ? 0 : t.unread), 0);
    if (unread > lastUnread) {
      play('pop');
      haptic.tap();
    }
    lastUnread = unread;
    useDm.setState({ threads: list, unread });
  } catch (e) {
    useDm.setState({ error: String((e as Error).message ?? e) });
  }
}

let threadSeq = 0;
async function loadThread() {
  const s = useDm.getState();
  if (!s.pass || !s.withWallet) return;
  const seq = ++threadSeq;
  const w = s.withWallet;
  try {
    const r = await call<{ msgs: DmMsg[]; blocked: boolean }>({ a: 'thread', pass: s.pass, with: w });
    if (seq !== threadSeq || useDm.getState().withWallet !== w) return;
    const pending = useDm.getState().msgs.filter((m) => m.local);
    useDm.setState({ msgs: [...r.msgs, ...pending.filter((p) => !r.msgs.some((m) => m.sender === p.sender && m.body === p.body && Math.abs(Date.parse(m.at) - Date.parse(p.at)) < 60_000))], blocked: r.blocked, error: null });
    // reading it clears its unread count
    useDm.setState((st) => ({ threads: st.threads.map((t) => (t.wallet === w ? { ...t, unread: 0 } : t)) }));
  } catch (e) {
    if (seq === threadSeq) useDm.setState({ error: String((e as Error).message ?? e) });
  }
}

/** Remember the name a wallet goes by (from the lobby, the island or the arena). */
export function learnName(wallet: string | null | undefined, name: string | null | undefined) {
  if (!wallet || !name || !B58.test(wallet)) return;
  const names = useDm.getState().names;
  if (names[wallet] === name) return;
  const next = { ...names, [wallet]: name };
  const keys = Object.keys(next);
  if (keys.length > 300) delete next[keys[0]];
  useDm.setState({ names: next });
}

/** Open the messages window: the inbox, or straight into a conversation with `wallet`. */
export function openDm(wallet?: string | null, name?: string) {
  const g = useGame.getState();
  if (!g.wallet.owner) return g.toast('Connect a wallet to send messages', 'info');
  if (wallet && wallet === g.wallet.owner) return g.toast("That's your own wallet", 'info');
  if (wallet) learnName(wallet, name);
  useDm.setState({ open: true, error: null, ...(wallet ? { withWallet: wallet, withName: name || useDm.getState().names[wallet] || '', msgs: [] } : {}) });
  if (wallet) void loadThread();
  void refreshInbox(true);
}
export const closeDm = () => useDm.setState({ open: false, withWallet: null, msgs: [] });
export const backToInbox = () => {
  useDm.setState({ withWallet: null, msgs: [] });
  void refreshInbox(true);
};

/** Send a line to the open conversation. */
export async function sendDm(text: string): Promise<boolean> {
  const s = useDm.getState();
  const body = text.trim().slice(0, 280);
  if (!s.pass || !s.me || !s.withWallet || !body) return false;
  const local: DmMsg = { id: -Date.now(), at: new Date().toISOString(), sender: s.me, recipient: s.withWallet, sender_name: useName.getState().name ?? '', kind: 'msg', body, tip_token: null, tip_amount: null, tip_sig: null, read_at: null, local: true };
  useDm.setState({ msgs: [...s.msgs, local] });
  try {
    const { msg } = await call<{ msg: DmMsg }>({ a: 'send', pass: s.pass, to: s.withWallet, body, name: useName.getState().name ?? '' });
    useDm.setState((st) => ({ msgs: st.msgs.map((m) => (m === local ? msg : m)) }));
    return true;
  } catch (e) {
    useDm.setState((st) => ({ msgs: st.msgs.filter((m) => m !== local), error: String((e as Error).message ?? e) }));
    return false;
  }
}

/** Send tokens to the player in the open conversation, then post it there. */
export async function sendTokens(token: TipToken, amount: number): Promise<boolean> {
  const s = useDm.getState();
  const g = useGame.getState();
  if (!s.pass || !s.withWallet) return false;
  const to = s.withWallet;
  useDm.setState({ busy: true, error: null });
  try {
    const chain = await loadChain();
    const sig = await chain.sendTip(token, new chain.PublicKey(to), amount);
    g.toast(`Sent ${amount} ${token}`, 'good');
    g.track('tip');
    void g.refreshWallet();
    // the transfer is done; now show it in the chat (the server checks it on chain)
    try {
      const { msg } = await call<{ msg: DmMsg }>({ a: 'tip', pass: s.pass, to, token, amount, sig, name: useName.getState().name ?? '' });
      if (useDm.getState().withWallet === to) useDm.setState((st) => ({ msgs: [...st.msgs, msg] }));
    } catch (e) {
      useDm.setState({ error: `Sent, but not shown in the chat yet: ${String((e as Error).message ?? e)}` });
    }
    return true;
  } catch (e) {
    const m = String((e as Error)?.message ?? e);
    const cancelled = /declined|cancel|rejected/i.test(m);
    g.toast(cancelled ? 'Cancelled in wallet' : m.slice(0, 140), cancelled ? 'info' : 'bad');
    return false;
  } finally {
    useDm.setState({ busy: false });
  }
}

export async function setBlocked(on: boolean) {
  const s = useDm.getState();
  if (!s.pass || !s.withWallet) return;
  try {
    await call({ a: 'block', pass: s.pass, who: s.withWallet, on });
    useDm.setState({ blocked: on });
  } catch (e) {
    useDm.setState({ error: String((e as Error).message ?? e) });
  }
}

/* ---------------- keeping it fresh ---------------- */
let started = false;
/** Called once at start: keep the pass in step with the wallet, and check for new messages. */
export function startDm() {
  if (started) return;
  started = true;
  void restore();
  let owner = useGame.getState().wallet.owner;
  useGame.subscribe((g) => {
    if (g.wallet.owner === owner) return;
    owner = g.wallet.owner;
    // another wallet (or none): forget the old one's messages on screen, and look for its own pass
    useDm.setState({ me: null, pass: null, threads: [], unread: 0, msgs: [], withWallet: null, open: false });
    lastUnread = 0;
    void restore().then(() => refreshInbox(true));
  });
  setInterval(() => {
    const s = useDm.getState();
    if (!s.pass) return;
    if (s.open && s.withWallet) void loadThread();
  }, 4000);
  setInterval(() => void refreshInbox(), 25_000);
  void restore().then(() => refreshInbox(true));
}
