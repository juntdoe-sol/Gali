import { PublicKey } from '@solana/web3.js';
import { create } from 'zustand';
import * as chain from '../chain/client';
import cfg from '../chain/chat.json';
import { haptic, play } from './sfx';
import { useGame } from './store';

export const chatReady = Boolean(cfg.url && cfg.anonKey);
const ROOM = 'global';

export interface ChatMsg {
  id: number;
  wallet: string;
  name: string;
  level: number;
  kind: 'msg' | 'tip';
  body: string;
  tip_to: string | null;
  tip_amount: number | null;
  created_at: string;
  local?: boolean;
}

interface ChatState {
  open: boolean;
  msgs: ChatMsg[];
  unread: number;
  lastId: number;
  sending: boolean;
  error: string | null;
  tipTarget: string | null; // wallet we're about to send SKR to
  setOpen: (o: boolean) => void;
  poll: () => Promise<void>;
  send: (text: string) => Promise<boolean>;
  setTipTarget: (w: string | null) => void;
  tip: (to: string, amount: number, note: string) => Promise<boolean>;
}

const headers = { apikey: cfg.anonKey, Authorization: `Bearer ${cfg.anonKey}`, 'Content-Type': 'application/json' };

async function post(body: string, extra?: { tip: { to: string; amount: number; sig: string } }) {
  const g = useGame.getState();
  const owner = g.wallet.owner;
  const session = g.session();
  if (!owner || !session) throw new Error('Connect your wallet to chat');
  const player = g.wallet.player;
  const valid = player && player.session === session.publicKey.toBase58() && player.sessionExpires * 1000 > Date.now();
  if (!valid) throw new Error('Play one round on-chain to start a session, then chat');
  const ts = Date.now();
  const sig = chain.signWithSession(session, `gali-chat:${ROOM}:${owner}:${ts}:${body}`);
  const r = await fetch(`${cfg.url}/functions/v1/chat-post`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ wallet: owner, session: session.publicKey.toBase58(), body, ts, sig, room: ROOM, ...extra }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? `Chat server error ${r.status}`);
  return j as ChatMsg;
}

export const useChat = create<ChatState>((set, get) => ({
  open: false,
  msgs: [],
  unread: 0,
  lastId: 0,
  sending: false,
  error: null,
  tipTarget: null,

  setOpen: (open) => {
    set({ open, unread: open ? 0 : get().unread });
    if (open) void get().poll();
  },

  poll: async () => {
    if (!chatReady) return;
    try {
      const { lastId } = get();
      const q = lastId
        ? `id=gt.${lastId}&order=id.asc&limit=100`
        : `order=id.desc&limit=60`;
      const r = await fetch(`${cfg.url}/rest/v1/messages?select=*&room=eq.${ROOM}&${q}`, { headers });
      if (!r.ok) throw new Error(`Chat server error ${r.status}`);
      let rows = (await r.json()) as ChatMsg[];
      if (!lastId) rows = rows.reverse();
      if (!rows.length) return set({ error: null });
      const me = useGame.getState().wallet.owner;
      const fresh = rows.filter((m) => !get().msgs.some((x) => x.id === m.id));
      const tipsToMe = fresh.filter((m) => m.kind === 'tip' && m.tip_to === me && lastId);
      if (tipsToMe.length) {
        play('claim');
        haptic.win();
        tipsToMe.forEach((m) => useGame.getState().toast(`🎁 ${m.name} sent you ${m.tip_amount} SKR`, 'gold'));
        void useGame.getState().refreshWallet();
      }
      set((s) => ({
        msgs: [...s.msgs.filter((m) => !m.local), ...fresh].slice(-200),
        lastId: Math.max(s.lastId, ...rows.map((m) => m.id)),
        unread: s.open || !lastId ? 0 : s.unread + fresh.filter((m) => m.wallet !== me).length,
        error: null,
      }));
    } catch (e) {
      set({ error: String((e as Error).message ?? e) });
    }
  },

  send: async (text) => {
    const body = text.trim().slice(0, 280);
    if (!body || get().sending) return false;
    if (!chatReady) {
      set((s) => ({ error: 'Chat server not set up yet (app/src/chain/chat.json)', msgs: s.msgs }));
      return false;
    }
    set({ sending: true });
    try {
      const m = await post(body);
      set((s) => ({ msgs: [...s.msgs.filter((x) => x.id !== m.id), m], lastId: Math.max(s.lastId, m.id), error: null }));
      play('select');
      return true;
    } catch (e) {
      useGame.getState().toast(String((e as Error).message ?? e), 'bad');
      return false;
    } finally {
      set({ sending: false });
    }
  },

  setTipTarget: (w) => set({ tipTarget: w }),

  tip: async (to, amount, note) => {
    const g = useGame.getState();
    let dest: PublicKey;
    try {
      dest = new PublicKey(to.trim());
    } catch {
      g.toast("That isn't a Solana address", 'bad');
      return false;
    }
    if (!g.wallet.owner) {
      g.toast('Connect your wallet to send SKR', 'bad');
      return false;
    }
    if (!(amount > 0) || amount > g.wallet.skr) {
      g.toast(`You have ${g.wallet.skr.toLocaleString()} SKR`, 'bad');
      return false;
    }
    try {
      useGame.setState((s) => ({ wallet: { ...s.wallet, busy: `Sending ${amount} SKR…` } }));
      const sig = await chain.sendSkr(dest, amount);
      await g.refreshWallet();
      play('mint');
      haptic.win();
      g.toast(`Sent ${amount} SKR to ${chain.short(dest.toBase58())}`, 'gold');
      set({ tipTarget: null });
      if (chatReady) {
        const body = note.trim() || `sent ${amount} SKR ⛏`;
        const m = await post(body, { tip: { to: dest.toBase58(), amount, sig } }).catch(() => null);
        if (m) set((s) => ({ msgs: [...s.msgs, m], lastId: Math.max(s.lastId, m.id) }));
      }
      return true;
    } catch (e) {
      g.toast(String((e as Error).message ?? e).slice(0, 90), 'bad');
      return false;
    } finally {
      useGame.setState((s) => ({ wallet: { ...s.wallet, busy: null } }));
    }
  },
}));

/** Poll fast while the chat is open, slowly otherwise (for the unread badge and tip alerts). */
export function startChatPolling() {
  if (!chatReady) return () => undefined;
  let stopped = false;
  let t: ReturnType<typeof setTimeout>;
  const loop = async () => {
    if (stopped) return;
    await useChat.getState().poll();
    t = setTimeout(loop, useChat.getState().open ? 2000 : 10000);
  };
  void loop();
  return () => {
    stopped = true;
    clearTimeout(t);
  };
}
