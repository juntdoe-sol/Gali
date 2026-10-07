/**
 * The lobby: where you are (lobby or island), who else is in it, and what they say.
 *
 * Players meet on one realtime room that rides the same connection as the island's
 * world (game/world.ts). Only a player's own name, look and position cross it, plus
 * short chat lines. Nothing here touches SOL, ORE or a wallet, and nothing a stranger
 * sends is trusted: every field is clamped, every colour checked, chat is length-capped
 * and rate-limited per sender, and one sender cannot fill the room with invented players.
 */
import type { RealtimeChannel } from '@supabase/realtime-js';
import { create } from 'zustand';
import type { Look } from '../engine/types';
import { cleanChat, cleanName, LH, LOBBY_CAP, LW, SPAWNS, type DoorId } from './lobbyMap';
import { useName } from './username';
import { useWorld, worldClient, worldReady } from './world';

export type LobbyPose = 'idle' | 'walk' | 'cheer' | 'dance1' | 'dance2' | 'dance3';
const POSE_OK = ['walk', 'cheer', 'dance1', 'dance2', 'dance3'];
export const asPose = (v: unknown): LobbyPose => (typeof v === 'string' && POSE_OK.includes(v) ? (v as LobbyPose) : 'idle');
export type Where = 'lobby' | 'island';
export type Say = { t: string; at: number };

export interface LobbyPeer {
  id: string;
  name: string;
  x: number;
  y: number;
  tx: number;
  ty: number;
  facing: 1 | -1;
  pose: LobbyPose;
  look: Look;
  lvl: number;
  /** the wallet they play with, if they connected one (for tips). It is their claim: the tip sheet shows it before you send. */
  wallet: string | null;
  seen: number;
  say: Say | null;
  emoji: string | null;
  emojiAt: number;
}
export interface LobbyMsg {
  id: number;
  from: string;
  name: string;
  text: string;
  at: number;
  mine?: boolean;
}

/** One line in the lobby's activity feed. */
export type Act =
  | { id: number; at: number; k: 'win'; n: string; sol: number; pts: number }
  | { id: number; at: number; k: 'tip'; n: string; tn: string; a: number; tk: 'SOL' | 'ORE' | 'SKR'; toMe: boolean; mine?: boolean }
  | { id: number; at: number; k: 'xp'; n: string; xp: number }
  | { id: number; at: number; k: 'play'; n: string; g: 'tunnel' | 'pot' | 'crash'; a: number; tk: 'ORE' | 'SKR'; win: boolean; mine?: boolean }
  | { id: number; at: number; k: 'join'; n: string };
export const ACT_LIFE_MS = 5200;
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

interface LobbyState {
  /** the app opens in the lobby */
  where: Where;
  /** the way back in: you appear at the door you walked out of */
  spawn: 'start' | DoorId;
  status: 'off' | 'joining' | 'online' | 'full';
  /** the shared chat room, joined for as long as the app is open (lobby and island both use it) */
  chatStatus: 'off' | 'joining' | 'online';
  me: string;
  peers: Record<string, LobbyPeer>;
  msgs: LobbyMsg[];
  /** what players are doing, newest last; each line is dropped a few seconds after it appears */
  feed: Act[];
  /** my own speech bubble and emote, for the engine to draw */
  mySay: Say | null;
  myEmoji: { e: string; at: number } | null;
  /** which dance I am doing (0 = none). Walking stops it. */
  myDance: 0 | 1 | 2 | 3;
  setDance: (n: 0 | 1 | 2 | 3) => void;
  /** the lobby chat sheet, and how many lines arrived while it was closed */
  chatOpen: boolean;
  unread: number;
  setChatOpen: (open: boolean) => void;
  go: (where: Where, spawn?: 'start' | DoorId) => void;
  say: (text: string) => boolean;
  emote: (e: string) => void;
}

/** Emotes are pixel icons: each is a key into the icon set (ui-<key> in the atlas, assets/icons/<key>.png). */
export const LOBBY_EMOTES = ['wave', 'laugh', 'heart', 'fire', 'pick', 'gem'] as const;
const LEGACY_EMOTE: Record<string, string> = { '👋': 'wave', '😂': 'laugh', '❤️': 'heart', '🔥': 'fire', '⛏️': 'pick', '💎': 'gem' };

const rid = () => Math.random().toString(36).slice(2, 10);
const HEX = /^#[0-9a-fA-F]{6}$/;
const KEY = /^[a-z0-9-]{2,24}$/;
const GLOWS = ['none', 'rare', 'epic', 'legendary'];
const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo);
const col = (v: unknown, d: string) => (typeof v === 'string' && HEX.test(v) ? v : d);

const STALE_MS = 12_000;
const SEND_MS = 220;
const BEAT_MS = 4_000;
const CHAT_GAP_MS = 900;
const MAX_MSGS = 60;

let msgId = 1;

export const useLobby = create<LobbyState>((set, get) => ({
  where: 'lobby',
  spawn: 'start',
  status: 'off',
  chatStatus: 'off',
  me: rid(),
  peers: {},
  msgs: [],
  feed: [],
  mySay: null,
  myEmoji: null,
  chatOpen: false,
  unread: 0,
  setChatOpen: (open) => set(open ? { chatOpen: true, unread: 0 } : { chatOpen: false }),
  go: (where, spawn) => set({ where, spawn: spawn ?? get().spawn }),
  say: (raw) => {
    const text = cleanChat(raw);
    const name = useName.getState().name;
    if (!text || !name) return false;
    const s = get();
    const now = Date.now();
    if (s.mySay && now - s.mySay.at < CHAT_GAP_MS) return false;
    set({
      mySay: { t: text, at: now },
      msgs: [...s.msgs, { id: msgId++, from: s.me, name, text, at: now, mine: true }].slice(-MAX_MSGS),
    });
    void chatChannel?.send({ type: 'broadcast', event: 'chat', payload: { id: s.me, nm: name, t: text } });
    return true;
  },
  myDance: 0,
  setDance: (n) => set({ myDance: n }),
  emote: (e) => {
    if (!(LOBBY_EMOTES as readonly string[]).includes(e)) return;
    set({ myEmoji: { e, at: Date.now() } });
    void channel?.send({ type: 'broadcast', event: 'emote', payload: { id: get().me, e } });
  },
}));

/* ---------------- transport ---------------- */
let channel: RealtimeChannel | null = null;
let chatChannel: RealtimeChannel | null = null;
let chatJoining = false;
let joining = false;
let pruneTimer: ReturnType<typeof setInterval> | null = null;
let joinedAt = 0;
const lastChatFrom = new Map<string, number>();

function onState(p: any) {
  const me = useLobby.getState().me;
  if (!p || typeof p.id !== 'string' || p.id.length > 16 || p.id === me) return;
  const id: string = p.id;
  const nm = cleanName(p.nm);
  if (!nm) return; // someone who has not picked a name yet does not show up
  const prev = useLobby.getState().peers[id];
  const peers = useLobby.getState().peers;
  // one sender cannot fill the room with invented players
  if (!prev && Object.keys(peers).length >= LOBBY_CAP - 1) return;
  const x = num(p.x, 0, LW);
  const y = num(p.y, 0, LH);
  const look: Look = {
    hat: typeof p.h === 'string' && KEY.test(p.h) ? p.h : 'hat-yellow',
    fit: col(p.c, '#2f5fd0'),
    pick: col(p.k, '#c9c9c9'),
    handle: col(p.hd, '#9b6b43'),
    pet: typeof p.pt === 'string' && KEY.test(p.pt) ? p.pt : null,
    glow: GLOWS.includes(p.g) ? p.g : 'none',
    sex: p.sx === 'f' ? 'f' : 'm',
  };
  const jumped = !prev || Math.hypot(prev.x - x, prev.y - y) > 40;
  const peer: LobbyPeer = {
    id,
    name: nm,
    x: jumped ? x : prev.x,
    y: jumped ? y : prev.y,
    tx: num(p.tx, 0, LW),
    ty: num(p.ty, 0, LH),
    facing: p.f === -1 ? -1 : 1,
    pose: asPose(p.p),
    look,
    lvl: Math.floor(num(p.lvl, 1, 999)),
    wallet: typeof p.w === 'string' && B58.test(p.w) ? p.w : null,
    seen: Date.now(),
    say: prev?.say ?? null,
    emoji: prev?.emoji ?? null,
    emojiAt: prev?.emojiAt ?? 0,
  };
  useLobby.setState((s) => ({ peers: { ...s.peers, [id]: peer } }));
  if (!prev && Date.now() - joinedAt > 3000) pushAct({ k: 'join', n: nm });
}

/* ---------------- activity feed ---------------- */
let actId = 1;
export function pushAct(a: DistributiveOmit<Act, 'id' | 'at'>) {
  const act = { ...a, id: actId++, at: Date.now() } as Act;
  useLobby.setState((s) => ({ feed: [...s.feed.filter((x) => act.at - x.at < ACT_LIFE_MS), act].slice(-5) }));
}
type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;

const lastActFrom = new Map<string, number>();
function onAct(p: any) {
  const s = useLobby.getState();
  if (!p || typeof p.id !== 'string' || p.id === s.me) return;
  const n = cleanName(p.nm);
  if (!n) return;
  const now = Date.now();
  if (now - (lastActFrom.get(p.id) ?? 0) < 1200) return; // flooding: drop it
  lastActFrom.set(p.id, now);
  if (lastActFrom.size > 300) lastActFrom.clear();
  const amt = (v: unknown, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(hi, v)) : 0);
  if (p.k === 'win') pushAct({ k: 'win', n, sol: amt(p.sol, 1000), pts: Math.floor(amt(p.pts, 1e6)) });
  else if (p.k === 'xp') {
    const xp = Math.floor(amt(p.xp, 1e5));
    if (xp > 0) pushAct({ k: 'xp', n, xp });
  } else if (p.k === 'play' && (p.tk === 'ORE' || p.tk === 'SKR') && (p.g === 'tunnel' || p.g === 'pot' || p.g === 'crash')) {
    const a = amt(p.a, 1e6);
    if (a > 0) pushAct({ k: 'play', n, g: p.g, a, tk: p.tk, win: p.win === true });
  } else if (p.k === 'tip' && (p.tk === 'SOL' || p.tk === 'ORE' || p.tk === 'SKR')) {
    const tn = cleanName(p.tn);
    const a = amt(p.a, 1e6);
    if (tn && a > 0) pushAct({ k: 'tip', n, tn, a, tk: p.tk, toMe: p.to === s.me });
  }
}
/** Tell the lobby what this player just did. Cosmetic: a feed line shows to everyone, and nothing here moves money. */
export function announce(a: { k: 'win'; sol: number; pts: number } | { k: 'xp'; xp: number } | { k: 'play'; g: 'tunnel' | 'pot' | 'crash'; a: number; tk: 'ORE' | 'SKR'; win: boolean } | { k: 'tip'; to: string; tn: string; a: number; tk: 'SOL' | 'ORE' | 'SKR' }) {
  const name = useName.getState().name;
  if (!name) return;
  const me = useLobby.getState().me;
  if (a.k === 'win') pushAct({ k: 'win', n: name, sol: a.sol, pts: a.pts });
  else if (a.k === 'xp') pushAct({ k: 'xp', n: name, xp: a.xp });
  else if (a.k === 'play') pushAct({ k: 'play', n: name, g: a.g, a: a.a, tk: a.tk, win: a.win, mine: true });
  else pushAct({ k: 'tip', n: name, tn: a.tn, a: a.a, tk: a.tk, toMe: false, mine: true });
  void chatChannel?.send({ type: 'broadcast', event: 'act', payload: { id: me, nm: name, ...(a.k === 'tip' ? { k: 'tip', to: a.to, tn: a.tn, a: a.a, tk: a.tk } : a) } });
}
let xpAcc = 0;
let xpTimer: ReturnType<typeof setTimeout> | null = null;
/** XP comes in small pieces while digging; show it as one line every few seconds. */
export function announceXp(n: number) {
  if (!(n > 0)) return;
  xpAcc += n;
  if (xpTimer) return;
  xpTimer = setTimeout(() => {
    const xp = Math.round(xpAcc);
    xpAcc = 0;
    xpTimer = null;
    if (xp > 0) announce({ k: 'xp', xp });
  }, 6000);
}

function onChat(p: any) {
  const s = useLobby.getState();
  if (!p || typeof p.id !== 'string' || p.id === s.me) return;
  const peer = s.peers[p.id];
  const text = cleanChat(p.t);
  const name = cleanName(p.nm) || peer?.name;
  if (!text || !name) return;
  const now = Date.now();
  if (now - (lastChatFrom.get(p.id) ?? 0) < CHAT_GAP_MS - 100) return; // flooding: drop it
  lastChatFrom.set(p.id, now);
  if (lastChatFrom.size > 300) lastChatFrom.clear();
  useLobby.setState((st) => ({
    peers: peer ? { ...st.peers, [p.id]: { ...peer, say: { t: text, at: now } } } : st.peers,
    msgs: [...st.msgs, { id: msgId++, from: p.id, name, text, at: now }].slice(-MAX_MSGS),
    unread: st.chatOpen ? 0 : Math.min(99, st.unread + 1),
  }));
}

function onEmote(p: any) {
  const s = useLobby.getState();
  const key = typeof p?.e === 'string' ? LEGACY_EMOTE[p.e] ?? p.e : '';
  if (!p || typeof p.id !== 'string' || !(LOBBY_EMOTES as readonly string[]).includes(key)) return;
  const peer = s.peers[p.id];
  if (peer) useLobby.setState({ peers: { ...s.peers, [p.id]: { ...peer, emoji: key, emojiAt: Date.now() } } });
}

function onBye(p: any) {
  const id = p?.id;
  if (typeof id !== 'string') return;
  useLobby.setState((s) => {
    if (!s.peers[id]) return s;
    const peers = { ...s.peers };
    delete peers[id];
    return { peers };
  });
}

/** Join the lobby room. Safe to call again: it joins once and waits for the world's connection. */
export function joinLobby() {
  if (channel || joining) return;
  // no realtime server configured in this build: say so, instead of waiting for ever
  if (!worldReady) {
    useLobby.setState({ status: 'off' });
    return;
  }
  const client = worldClient();
  if (!client) {
    // the world connection is still starting; try again when it is up
    useLobby.setState({ status: 'joining' });
    const un = useWorld.subscribe((w) => {
      if (w.status === 'online' && worldClient()) {
        un();
        if (useLobby.getState().where === 'lobby') joinLobby();
      }
    });
    return;
  }
  joining = true;
  useLobby.setState({ status: 'joining', peers: {} });
  const ch = client.channel('gali-lobby', { config: { broadcast: { self: false, ack: false } } });
  ch.on('broadcast', { event: 'state' }, ({ payload }) => onState(payload))
    .on('broadcast', { event: 'emote' }, ({ payload }) => onEmote(payload))
    .on('broadcast', { event: 'bye' }, ({ payload }) => onBye(payload))
    .subscribe((st) => {
      if (st === 'SUBSCRIBED') {
        joinedAt = Date.now();
        useLobby.setState({ status: 'online' });
        // listen for a moment before deciding the room has space for us
        setTimeout(() => {
          if (channel === ch && Object.keys(useLobby.getState().peers).length >= LOBBY_CAP - 1) useLobby.setState({ status: 'full' });
        }, 2500);
      } else if (st === 'CLOSED' || st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') {
        if (channel === ch) useLobby.setState({ status: 'off' });
      }
    });
  channel = ch;
  joining = false;
  pruneTimer = setInterval(() => {
    const now = Date.now();
    const { peers } = useLobby.getState();
    const alive = Object.fromEntries(Object.entries(peers).filter(([, p]) => now - p.seen < STALE_MS));
    // old speech bubbles and emotes fade out
    for (const p of Object.values(alive)) {
      if (p.say && now - p.say.at > 6000) p.say = null;
      if (p.emoji && now - p.emojiAt > 3000) p.emoji = null;
    }
    useLobby.setState((st) => ({ peers: alive, feed: st.feed.some((a) => now - a.at >= ACT_LIFE_MS) ? st.feed.filter((a) => now - a.at < ACT_LIFE_MS) : st.feed }));
  }, 1500);
}

/**
 * Join the shared chat room. One room for the whole app: the lobby and the island's CHAT tab show the same
 * messages. Safe to call again; it waits for the world's realtime connection.
 */
export function joinChat() {
  if (chatChannel || chatJoining || !worldReady) return;
  const client = worldClient();
  if (!client) {
    useLobby.setState({ chatStatus: 'joining' });
    const un = useWorld.subscribe((w) => {
      if (w.status === 'online' && worldClient()) {
        un();
        joinChat();
      }
    });
    return;
  }
  chatJoining = true;
  useLobby.setState({ chatStatus: 'joining' });
  const ch = client.channel('gali-chat', { config: { broadcast: { self: false, ack: false } } });
  ch.on('broadcast', { event: 'chat' }, ({ payload }) => onChat(payload))
    .on('broadcast', { event: 'act' }, ({ payload }) => onAct(payload))
    .subscribe((st) => {
    if (st === 'SUBSCRIBED') useLobby.setState({ chatStatus: 'online' });
    else if (st === 'CLOSED' || st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') {
      if (chatChannel === ch) useLobby.setState({ chatStatus: 'off' });
    }
  });
  chatChannel = ch;
  chatJoining = false;
}

export function leaveLobby() {
  if (pruneTimer) clearInterval(pruneTimer);
  pruneTimer = null;
  const ch = channel;
  channel = null;
  joining = false;
  if (ch) {
    void ch.send({ type: 'broadcast', event: 'bye', payload: { id: useLobby.getState().me } });
    void ch.unsubscribe();
  }
  lastKey = '';
  useLobby.setState({ status: 'off', peers: {} });
}

let lastSent = 0;
let lastKey = '';
/** Called by the lobby screen when your miner moves or stops; sends when it changes, and as a slow heartbeat. */
export function publishLobbyMe(m: { x: number; y: number; tx: number; ty: number; facing: 1 | -1; pose: string; look: Look; lvl: number; wallet?: string | null }) {
  const { status, me } = useLobby.getState();
  const name = useName.getState().name;
  if (!channel || status !== 'online' || !name) return;
  if (![m.x, m.y, m.tx, m.ty].every(Number.isFinite)) return;
  const now = Date.now();
  const r = (v: number) => Math.round(v);
  const payload = {
    id: me,
    nm: name,
    x: r(m.x),
    y: r(m.y),
    tx: r(m.tx),
    ty: r(m.ty),
    f: m.facing,
    p: asPose(m.pose),
    h: m.look.hat,
    c: m.look.fit,
    k: m.look.pick,
    hd: m.look.handle,
    pt: m.look.pet,
    g: m.look.glow,
    sx: m.look.sex === 'f' ? 'f' : 'm',
    lvl: m.lvl,
    ...(m.wallet ? { w: m.wallet } : {}),
  };
  const key = JSON.stringify({ ...payload, x: 0, y: 0 });
  // a walker sends when the target changes; someone standing still sends a heartbeat
  if (now - lastSent < SEND_MS || (key === lastKey && now - lastSent < BEAT_MS)) return;
  lastSent = now;
  lastKey = key;
  void channel.send({ type: 'broadcast', event: 'state', payload });
}

export const lobbySpawn = (k: 'start' | DoorId) => SPAWNS[k];
export const lobbyJoinedAt = () => joinedAt;
