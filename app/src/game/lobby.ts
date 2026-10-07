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
  pose: 'idle' | 'walk' | 'cheer';
  look: Look;
  lvl: number;
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

interface LobbyState {
  /** the app opens in the lobby */
  where: Where;
  /** the way back in: you appear at the door you walked out of */
  spawn: 'start' | DoorId;
  status: 'off' | 'joining' | 'online' | 'full';
  me: string;
  peers: Record<string, LobbyPeer>;
  msgs: LobbyMsg[];
  /** my own speech bubble and emote, for the engine to draw */
  mySay: Say | null;
  myEmoji: { e: string; at: number } | null;
  go: (where: Where, spawn?: 'start' | DoorId) => void;
  say: (text: string) => boolean;
  emote: (e: string) => void;
}

export const LOBBY_EMOTES = ['👋', '😂', '❤️', '🔥', '⛏️', '💎'] as const;

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
  me: rid(),
  peers: {},
  msgs: [],
  mySay: null,
  myEmoji: null,
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
    void channel?.send({ type: 'broadcast', event: 'chat', payload: { id: s.me, nm: name, t: text } });
    return true;
  },
  emote: (e) => {
    if (!(LOBBY_EMOTES as readonly string[]).includes(e)) return;
    set({ myEmoji: { e, at: Date.now() } });
    void channel?.send({ type: 'broadcast', event: 'emote', payload: { id: get().me, e } });
  },
}));

/* ---------------- transport ---------------- */
let channel: RealtimeChannel | null = null;
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
    pose: p.p === 'walk' || p.p === 'cheer' ? p.p : 'idle',
    look,
    lvl: Math.floor(num(p.lvl, 1, 999)),
    seen: Date.now(),
    say: prev?.say ?? null,
    emoji: prev?.emoji ?? null,
    emojiAt: prev?.emojiAt ?? 0,
  };
  useLobby.setState((s) => ({ peers: { ...s.peers, [id]: peer } }));
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
  }));
}

function onEmote(p: any) {
  const s = useLobby.getState();
  if (!p || typeof p.id !== 'string' || !(LOBBY_EMOTES as readonly string[]).includes(p.e)) return;
  const peer = s.peers[p.id];
  if (peer) useLobby.setState({ peers: { ...s.peers, [p.id]: { ...peer, emoji: p.e, emojiAt: Date.now() } } });
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
    .on('broadcast', { event: 'chat' }, ({ payload }) => onChat(payload))
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
    useLobby.setState({ peers: alive });
  }, 1500);
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
export function publishLobbyMe(m: { x: number; y: number; tx: number; ty: number; facing: 1 | -1; pose: string; look: Look; lvl: number }) {
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
    p: m.pose === 'walk' || m.pose === 'cheer' ? m.pose : 'idle',
    h: m.look.hat,
    c: m.look.fit,
    k: m.look.pick,
    hd: m.look.handle,
    pt: m.look.pet,
    g: m.look.glow,
    lvl: m.lvl,
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
