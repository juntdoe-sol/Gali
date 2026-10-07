// Shared world: every miner on the map, live.
// Positions travel over Supabase Realtime broadcast (the same Supabase project as the chat).
// Nothing here is trusted: payloads are clamped, and a wallet name is only shown after the
// sender proves (with its session key) that the wallet's on-chain Player uses that session.
// In practice mode, a few labelled bots wander the quarry instead.
// The Supabase client and the chain code are loaded on demand (startWorld / a peer's identity claim),
// so neither is in the startup bundle.
import type { RealtimeChannel, RealtimeClient } from '@supabase/realtime-js';
import type { Keypair } from '@solana/web3.js';
import { create } from 'zustand';
import { loadChain, loadedChain } from '../chain/lazy';
import { short } from '../chain/light';
import cfg from '../chain/chat.json';
import { useName } from './username';
import { cleanName } from './lobbyMap';

export type Pose = 'idle' | 'walk' | 'swing';
export interface Avatar {
  id: string;
  name: string;
  wallet: string | null; // set only once verified
  x: number;
  y: number;
  tx: number;
  ty: number;
  facing: 1 | -1;
  pose: Pose;
  hat: string;
  fit: string;
  pick: string;
  pet: string | null;
  lvl: number;
  seen: number;
  bot?: boolean;
  /** helmet and pet gear keys, sent by newer clients; older ones send colours only */
  hk?: string;
  pk?: string | null;
  /** which miner body they play: 'f' is the girl miner */
  sx?: 'm' | 'f';
}
export interface MeState {
  x: number;
  y: number;
  tx: number;
  ty: number;
  facing: 1 | -1;
  pose: Pose;
  hat: string;
  fit: string;
  pick: string;
  pet: string | null;
  lvl: number;
  hk?: string;
  pk?: string | null;
  sx?: 'm' | 'f';
}

export const EMOTES = ['👋', '⛏️', '🎉', '💎', '🔥'] as const;

const URL_ = process.env.EXPO_PUBLIC_WORLD_URL || (cfg.url ? `${cfg.url.replace(/^http/, 'ws')}/realtime/v1` : '');
const KEY = process.env.EXPO_PUBLIC_WORLD_KEY || cfg.anonKey;
export const worldReady = Boolean(URL_ && KEY);

const MAP_W = 360;
const MAP_H = 440;
const STALE_MS = 8000;
const SEND_MS = 250;
const BEAT_MS = 2000;
const CLAIM_MS = 20_000;

const rid = () => Math.random().toString(36).slice(2, 10);
const HEX = /^#[0-9a-fA-F]{6}$/;
const clamp = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo);
const color = (v: unknown, dflt: string) => (typeof v === 'string' && HEX.test(v) ? v : dflt);

interface WorldState {
  status: 'off' | 'connecting' | 'online';
  me: string;
  peers: Record<string, Avatar>;
  emotes: Record<string, { emoji: string; at: number }>;
  focus: string | null;
  setFocus: (id: string | null) => void;
  emote: (emoji: string) => void;
}

export const useWorld = create<WorldState>((set, get) => ({
  status: 'off',
  me: rid(),
  peers: {},
  emotes: {},
  focus: null,
  setFocus: (focus) => set({ focus }),
  emote: (emoji) => {
    if (!EMOTES.includes(emoji as (typeof EMOTES)[number])) return;
    const me = get().me;
    set((s) => ({ emotes: { ...s.emotes, [me]: { emoji, at: Date.now() } } }));
    void channel?.send({ type: 'broadcast', event: 'emote', payload: { id: me, e: emoji } });
  },
}));

/* ---------------- transport ---------------- */
let client: RealtimeClient | null = null;
let channel: RealtimeChannel | null = null;
let pruneTimer: ReturnType<typeof setInterval> | null = null;
/** Bumped by stopWorld, so a start still waiting on the Supabase chunk knows it was cancelled. */
let startGen = 0;
let starting = false;
const MAX_PEERS = 60;
const verified = new Map<string, string | null>(); // `${id}:${wallet}:${session}` -> wallet or null (pending/failed)

/** The shared realtime connection, so the lobby rides the same socket instead of opening a second one. */
export const worldClient = () => client;

export function startWorld() {
  if (!worldReady || client || starting) return;
  starting = true;
  const gen = ++startGen;
  useWorld.setState({ status: 'connecting' });
  import('@supabase/realtime-js').then(
    ({ RealtimeClient }) => {
      starting = false;
      if (gen !== startGen || client) return; // stopped (or restarted) while the chunk loaded
      connect(RealtimeClient);
    },
    () => {
      starting = false;
      if (gen === startGen) useWorld.setState({ status: 'off' });
    },
  );
}

function connect(RealtimeClientCtor: typeof RealtimeClient) {
  client = new RealtimeClientCtor(URL_, { params: { apikey: KEY }, vsn: '1.0.0' } as ConstructorParameters<typeof RealtimeClient>[1]);
  channel = client.channel('gali-world', { config: { broadcast: { self: false, ack: false } } });
  channel
    .on('broadcast', { event: 'state' }, ({ payload }) => onState(payload))
    .on('broadcast', { event: 'emote' }, ({ payload }) => {
      const id = typeof payload?.id === 'string' ? payload.id.slice(0, 16) : '';
      const e = payload?.e;
      if (id && EMOTES.includes(e) && useWorld.getState().peers[id])
        useWorld.setState((s) => ({ emotes: { ...s.emotes, [id]: { emoji: e, at: Date.now() } } }));
    })
    .on('broadcast', { event: 'bye' }, ({ payload }) => {
      const id = payload?.id;
      if (typeof id !== 'string') return;
      useWorld.setState((s) => {
        // a verified miner only leaves by going stale, so a spoofed "bye" can't remove them
        if (!s.peers[id] || s.peers[id].wallet) return s;
        const peers = { ...s.peers };
        delete peers[id];
        return { peers };
      });
    })
    .subscribe((status) => useWorld.setState({ status: status === 'SUBSCRIBED' ? 'online' : 'off' }));
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') window.addEventListener('pagehide', sayBye);
  pruneTimer = setInterval(() => {
    const now = Date.now();
    const { peers } = useWorld.getState();
    const alive = Object.fromEntries(
      Object.entries(peers)
        .filter(([, p]) => p.bot || now - p.seen < STALE_MS)
        .sort((a, b) => b[1].seen - a[1].seen)
        .slice(0, MAX_PEERS), // one sender can't fill the map with invented miners
    );
    useWorld.setState((s) => ({ emotes: Object.fromEntries(Object.entries(s.emotes).filter(([id, e]) => now - e.at < 4000 && (alive[id] || id === useWorld.getState().me))) }));
    for (const key of [...verified.keys()]) if (verified.size > 200) verified.delete(key);
    if (Object.keys(alive).length !== Object.keys(peers).length) useWorld.setState({ peers: alive });
  }, 2000);
}

function sayBye() {
  if (channel) void channel.send({ type: 'broadcast', event: 'bye', payload: { id: useWorld.getState().me } });
}

export function stopWorld() {
  startGen++;
  starting = false;
  sayBye();
  if (pruneTimer) clearInterval(pruneTimer);
  void channel?.unsubscribe();
  client?.disconnect();
  client = null;
  channel = null;
  pruneTimer = null;
  useWorld.setState({ status: 'off' });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function onState(p: any) {
  if (!p || typeof p.id !== 'string' || p.id.length > 16 || p.id === useWorld.getState().me) return;
  const id: string = p.id;
  const prev = useWorld.getState().peers[id];
  const x = clamp(p.x, 0, MAP_W);
  const y = clamp(p.y, 0, MAP_H);
  const av: Avatar = {
    id,
    name: cleanName(p.nm) || (prev && !prev.wallet ? prev.name : '') || prev?.name || `Miner ${id.slice(0, 4)}`,
    wallet: prev?.wallet ?? null,
    // keep our smoothed position unless the sender jumped
    x: prev && Math.hypot(prev.x - x, prev.y - y) < 24 ? prev.x : x,
    y: prev && Math.hypot(prev.x - x, prev.y - y) < 24 ? prev.y : y,
    tx: clamp(p.tx, 0, MAP_W),
    ty: clamp(p.ty, 0, MAP_H),
    facing: p.f === -1 ? -1 : 1,
    pose: p.p === 'walk' || p.p === 'swing' ? p.p : 'idle',
    hat: color(p.hat, '#ffc83d'),
    fit: color(p.fit, '#3b6fd1'),
    pick: color(p.pick, '#c9c9c9'),
    pet: p.pet ? color(p.pet, '#8a5a3c') : null,
    lvl: Math.floor(clamp(p.lvl, 1, 999)),
    seen: Date.now(),
    hk: typeof p.hk === 'string' && /^hat-[a-z]{2,12}$/.test(p.hk) ? p.hk : undefined,
    pk: typeof p.pk === 'string' && /^pet-[a-z]{2,12}$/.test(p.pk) ? p.pk : null,
    sx: p.sx === 'f' ? 'f' : 'm',
  };
  useWorld.setState((s) => ({ peers: { ...s.peers, [id]: av } }));
  // identity claim: wallet + session key + signature over a fresh timestamp
  if (typeof p.wallet === 'string' && typeof p.session === 'string' && typeof p.sig === 'string' && typeof p.ts === 'number') {
    if (Math.abs(Date.now() - p.ts) > 120_000) return;
    const key = `${id}:${p.wallet}:${p.session}`;
    if (verified.has(key)) {
      const w = verified.get(key);
      if (w && av.wallet !== w) setIdentity(id, w);
      return;
    }
    verified.set(key, null);
    void loadChain()
      .then((chain) => chain.verifySessionClaim(p.wallet, p.session, claimMessage(id, p.ts), p.sig))
      .catch(() => false)
      .then((ok) => {
        if (!ok) return;
        verified.set(key, p.wallet);
        setIdentity(id, p.wallet);
      });
  }
}

function setIdentity(id: string, wallet: string) {
  useWorld.setState((s) => (s.peers[id] ? { peers: { ...s.peers, [id]: { ...s.peers[id], wallet, name: cleanName(s.peers[id].name) && !/^Miner [0-9a-z]{4}$/.test(s.peers[id].name) ? s.peers[id].name : short(wallet) } } } : s));
}

const claimMessage = (id: string, ts: number) => `gali-world:${id}:${ts}`;

let lastSent = 0;
let lastClaim = 0;
let lastKey = '';
let claim: { wallet: string; session: string; sig: string; ts: number } | null = null;

/** Called every frame by the map with our miner's state; sends it when it changes (and as a heartbeat). */
export function publishMe(me: MeState, identity: { wallet: string | null; session: Keypair | null; sessionValid: boolean }) {
  if (!channel || useWorld.getState().status !== 'online') return;
  if (![me.x, me.y, me.tx, me.ty].every(Number.isFinite)) return;
  const now = Date.now();
  const r = (v: number) => Math.round(v * 10) / 10;
  const payload: Record<string, unknown> = {
    id: useWorld.getState().me,
    x: r(me.x),
    y: r(me.y),
    tx: r(me.tx),
    ty: r(me.ty),
    f: me.facing,
    p: me.pose,
    hat: me.hat,
    fit: me.fit,
    pick: me.pick,
    pet: me.pet,
    lvl: me.lvl,
    hk: me.hk,
    pk: me.pk ?? null,
    sx: me.sx === 'f' ? 'f' : 'm',
    nm: useName.getState().name || undefined,
  };
  const key = JSON.stringify(payload);
  if (now - lastSent < SEND_MS || (key === lastKey && now - lastSent < BEAT_MS)) return;
  const claimable = identity.wallet && identity.session && identity.sessionValid;
  // a session key only exists once store.ts has loaded the chain code, so this is set whenever claimable is
  const chain = claimable ? loadedChain() : null;
  if (claimable && !chain) void loadChain().catch(() => undefined);
  if (chain && identity.wallet && identity.session && identity.sessionValid) {
    if (!claim || claim.wallet !== identity.wallet || now - lastClaim > CLAIM_MS) {
      const ts = now;
      claim = { wallet: identity.wallet, session: identity.session.publicKey.toBase58(), sig: chain.signWithSession(identity.session, claimMessage(payload.id as string, ts)), ts };
      lastClaim = now;
    }
    Object.assign(payload, claim);
  } else claim = null;
  lastSent = now;
  lastKey = key;
  void channel.send({ type: 'broadcast', event: 'state', payload });
}


/* ---------------- practice bots ---------------- */
const BOT_NAMES = ['Bot Ayu', 'Bot Raj', 'Bot Mei', 'Bot Tomi'];
const BOT_GEAR = [
  ['#ff5a4f', '#3b6fd1', '#ffc83d'],
  ['#3de0c8', '#6b4a32', '#b8c4d6'],
  ['#ffc83d', '#8a3fd1', '#3de0c8'],
  ['#c7f284', '#2f7a4f', '#ff4fd8'],
];

export function ensureBots(spots: [number, number][]) {
  const { peers } = useWorld.getState();
  if (Object.values(peers).some((p) => p.bot)) return;
  const now = Date.now();
  const bots: Record<string, Avatar> = {};
  BOT_NAMES.forEach((name, k) => {
    const [x, y] = spots[(k * 7 + 3) % spots.length];
    bots[`bot${k}`] = {
      id: `bot${k}`,
      name,
      wallet: null,
      x,
      y,
      tx: x,
      ty: y,
      facing: 1,
      pose: 'idle',
      hat: BOT_GEAR[k][0],
      fit: BOT_GEAR[k][1],
      pick: BOT_GEAR[k][2],
      pet: k === 2 ? '#4a3a66' : null,
      lvl: 2 + k * 3,
      seen: now + k * 1500, // used as "next decision at"
      bot: true,
    };
  });
  useWorld.setState((s) => ({ peers: { ...s.peers, ...bots } }));
}

export function clearBots() {
  useWorld.setState((s) => ({ peers: Object.fromEntries(Object.entries(s.peers).filter(([, p]) => !p.bot)) }));
}

/** Decide what each bot does next: walk to a spot, swing a while, sometimes wave. */
export function thinkBots(spots: [number, number][], wander: () => [number, number]) {
  const now = Date.now();
  const { peers } = useWorld.getState();
  let changed = false;
  const next = { ...peers };
  for (const b of Object.values(peers)) {
    if (!b.bot || now < b.seen) continue;
    changed = true;
    const atTarget = Math.hypot(b.tx - b.x, b.ty - b.y) < 1;
    if (!atTarget) continue;
    const roll = Math.random();
    if (b.pose === 'swing' || roll < 0.35) {
      const [tx, ty] = roll < 0.25 ? wander() : spots[Math.floor(Math.random() * spots.length)];
      next[b.id] = { ...b, tx, ty, pose: 'walk', seen: now + 400 };
    } else {
      next[b.id] = { ...b, pose: 'swing', facing: 1, seen: now + 1500 + Math.random() * 2500 };
      if (Math.random() < 0.15) useWorld.setState((s) => ({ emotes: { ...s.emotes, [b.id]: { emoji: EMOTES[Math.floor(Math.random() * EMOTES.length)], at: now } } }));
    }
  }
  if (changed) useWorld.setState({ peers: next });
}
