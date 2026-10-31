/**
 * Gali Fightclub online: finding other miners and carrying the match messages (rules: sim.ts, wire format: net.ts).
 *
 * Everything rides the arena's relay room ('gali-arena2'), with its own event names, so the relay needs no change:
 *   boq  "I am looking for a match": every 1.5 s while searching  {id, name, look, weapon, q, since}
 *   bom  a match starts (from its host)                           {id, mid, mode, seed, players}
 *   bos  host snapshot, 10 a second                               net.ts Snap + {id}
 *   boi  guest's own fighter, 10 a second                         {id, mid, s}
 *   bol  leaving a match                                          {id, mid}
 *
 * Matching needs no server: everyone searching the same queue sees the same list, sorted by who has waited longest.
 * The first on that list is the host and starts the match: 1v1 as soon as two are in; free for all at four, or
 * after 10 s with two or three (bots fill the rest). Nobody else for 12 s: a match against bots instead.
 * A private room is a 4-letter code; whoever made it first hosts and presses START.
 */
import { create } from 'zustand';
import type { Look } from '../../engine/types';
import { cleanName } from '../lobbyMap';
import { idFor } from '../peerId';
import { useWorld, worldClient, worldReady } from '../world';
import { isSpecial, type Mode } from './sim';
import type { NetPlayer } from './net';

export type Queue = '1v1' | 'ffa' | `code:${string}`;
export interface OnlineMatch {
  mid: string;
  host: string;
  mode: Mode;
  seed: number;
  players: NetPlayer[];
}
interface Peer extends NetPlayer {
  q: Queue;
  since: number;
  seen: number;
}
interface OnlineState {
  phase: 'off' | 'connecting' | 'search' | 'match';
  q: Queue | null;
  me: string;
  since: number;
  peers: Record<string, Peer>;
  match: OnlineMatch | null;
  /** nobody came: play bots instead (the screen starts that match) */
  solo: boolean;
  error: string | null;
}

/** Quick free for all starts with fewer than 4 after this long. */
export const FFA_WAIT_MS = 10_000;
/** Nobody else searching: bots after this long. */
export const SOLO_WAIT_MS = 12_000;
const PING_MS = 1500;
const STALE_MS = 4500;

const randomId = () => 'b' + Math.random().toString(36).slice(2, 10);
export const useOnline = create<OnlineState>(() => ({ phase: 'off', q: null, me: randomId(), since: 0, peers: {}, match: null, solo: false, error: null }));

type Ch = {
  on: (t: 'broadcast', f: { event: string }, cb: (m: { payload: any }) => void) => Ch; // eslint-disable-line @typescript-eslint/no-explicit-any
  subscribe: (cb?: (s: string) => void) => Ch;
  send: (m: { type: 'broadcast'; event: string; payload: unknown }) => Promise<unknown>;
  unsubscribe: () => Promise<unknown>;
};
let channel: Ch | null = null;
let joined = false;
let ticker: ReturnType<typeof setInterval> | null = null;
let lastPing = 0;
/**
 * A callout room starts by itself: when everyone called out is in (`need`), or, for a free for all, 2 minutes
 * after the first two are in (bots take the empty spots). No START needed.
 */
let autoStart: { need: number; pairAt: number } | null = null;
let mine: { name: string; look: Look; weapon: string; sp: string; w?: string } | null = null;
let sink: ((e: string, p: any) => void) | null = null; // eslint-disable-line @typescript-eslint/no-explicit-any
const seenMids = new Set<string>();

/** The match screen hears match messages here (one listener). */
export function onNet(cb: ((e: string, p: any) => void) | null) { // eslint-disable-line @typescript-eslint/no-explicit-any
  sink = cb;
}
/** Send a match message. */
export function sendNet(e: 'bos' | 'boi' | 'bol', p: Record<string, unknown>) {
  if (!channel || !joined) return;
  void channel.send({ type: 'broadcast', event: e, payload: { ...p, id: useOnline.getState().me } });
}

/** Start looking for a match in a queue. */
export function search(q: Queue, me: { name: string; look: Look; weapon: string; sp: string }, wallet: string | null, opts?: { need?: number }) {
  autoStart = opts?.need ? { need: Math.max(2, Math.min(4, opts.need)), pairAt: 0 } : null;
  mine = { ...me, w: wallet && B58.test(wallet) ? wallet : undefined };
  useOnline.setState((s) => ({ phase: joined ? 'search' : 'connecting', q, me: idFor(wallet, s.me), since: Date.now(), peers: {}, match: null, solo: false, error: null }));
  lastPing = 0;
  join();
  if (!ticker) ticker = setInterval(tick, 400);
}
/** Stop looking (back to the menu). */
export function cancel() {
  stopTicker();
  useOnline.setState({ phase: 'off', q: null, peers: {}, solo: false });
}
/** The match ended or was left. */
export function endMatch(left: boolean) {
  const m = useOnline.getState().match;
  if (left && m) sendNet('bol', { mid: m.mid });
  stopTicker();
  useOnline.setState({ phase: 'off', match: null, peers: {}, solo: false });
}
/** The screen closed: leave the room. */
export function leaveOnline() {
  endMatch(true);
  if (channel) void channel.unsubscribe();
  channel = null;
  joined = false;
  useOnline.setState({ q: null });
}
/** A private room's host starts the match. */
export function startRoom() {
  const list = queueList();
  if (list[0]?.id !== useOnline.getState().me || list.length < 2) return;
  start(list.slice(0, 4), list.length === 2 ? '1v1' : 'ffa');
}

/** Everyone in my queue (me too), the one who waited longest first. */
export function queueList(): (NetPlayer & { since: number })[] {
  const s = useOnline.getState();
  if (!s.q || !mine) return [];
  const now = Date.now();
  const list = Object.values(s.peers).filter((p) => p.q === s.q && now - p.seen < STALE_MS);
  list.push({ id: s.me, name: mine.name, look: mine.look, weapon: mine.weapon, sp: mine.sp, w: mine.w, q: s.q, since: s.since, seen: now });
  return list.sort((a, b) => a.since - b.since || (a.id < b.id ? -1 : 1));
}

function stopTicker() {
  if (ticker) clearInterval(ticker);
  ticker = null;
}

function tick() {
  const s = useOnline.getState();
  if (s.phase !== 'search' || !s.q || !mine) return;
  const now = Date.now();
  if (now - lastPing >= PING_MS) {
    lastPing = now;
    void channel?.send({ type: 'broadcast', event: 'boq', payload: { id: s.me, name: mine.name, look: mine.look, weapon: mine.weapon, sp: mine.sp, w: mine.w, q: s.q, since: s.since } });
  }
  const list = queueList();
  if (s.q.startsWith('code:')) {
    // a callout starts by itself when the rival arrives; a private room waits for its host's START
    if (autoStart && list.length >= 2) {
      if (!autoStart.pairAt) autoStart.pairAt = now;
      const all = list.length >= autoStart.need;
      if (list[0].id === s.me && (all || now - autoStart.pairAt > 120_000)) start(list.slice(0, autoStart.need), autoStart.need === 2 ? '1v1' : 'ffa');
    } else if (autoStart) autoStart.pairAt = 0;
    return;
  }
  const waited = now - s.since;
  if (list.length === 1) {
    if (waited >= SOLO_WAIT_MS) {
      stopTicker();
      useOnline.setState({ phase: 'off', solo: true });
    }
    return;
  }
  if (list[0].id !== s.me) return;
  if (s.q === '1v1') start(list.slice(0, 2), '1v1');
  else if (list.length >= 4) start(list.slice(0, 4), 'ffa');
  else if (waited >= FFA_WAIT_MS) start(list, 'ffa');
}

function start(list: NetPlayer[], mode: Mode) {
  const s = useOnline.getState();
  const mid = `${s.me}-${Date.now().toString(36)}`;
  const m: OnlineMatch = { mid, host: s.me, mode, seed: Math.floor(Math.random() * 1e9), players: list.map(({ id, name, look, weapon, sp, w }) => ({ id, name, look, weapon, sp, w })) };
  seenMids.add(mid);
  stopTicker();
  useOnline.setState({ phase: 'match', match: m });
  // said three times: a guest that misses it would wait in the queue forever
  const say = () => void channel?.send({ type: 'broadcast', event: 'bom', payload: { id: s.me, ...m } });
  say();
  setTimeout(say, 400);
  setTimeout(say, 1000);
}

function join() {
  if (channel) return;
  if (!worldReady) {
    useOnline.setState({ phase: 'off', error: 'Online play is not available here.' });
    return;
  }
  const client = worldClient() as unknown as { channel: (t: string, o: unknown) => Ch } | null;
  if (!client) {
    const un = useWorld.subscribe((w) => {
      if (w.status === 'online' && worldClient()) {
        un();
        if (useOnline.getState().phase === 'connecting') join();
      }
    });
    return;
  }
  const ch = client.channel('gali-arena2', { config: { broadcast: { self: false, ack: false } } });
  channel = ch;
  ch.on('broadcast', { event: 'boq' }, ({ payload }) => onQueue(payload))
    .on('broadcast', { event: 'bom' }, ({ payload }) => onMatch(payload))
    .on('broadcast', { event: 'bos' }, ({ payload }) => forward('bos', payload))
    .on('broadcast', { event: 'boi' }, ({ payload }) => forward('boi', payload))
    .on('broadcast', { event: 'bol' }, ({ payload }) => forward('bol', payload))
    .on('broadcast', { event: 'bye' }, ({ payload }) => {
      const id = typeof payload?.id === 'string' ? payload.id : '';
      if (!id) return;
      useOnline.setState((s) => {
        const peers = { ...s.peers };
        delete peers[id];
        return { peers };
      });
      forward('bye', payload);
    })
    .subscribe((st) => {
      joined = st === 'SUBSCRIBED';
      if (joined && useOnline.getState().phase === 'connecting') useOnline.setState({ phase: 'search', since: Date.now() });
      if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') useOnline.setState({ error: 'Could not reach the arena. Try again.' });
    });
}

function forward(e: string, p: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const m = useOnline.getState().match;
  if (!m || !p || typeof p !== 'object') return;
  if (e !== 'bye' && p.mid !== m.mid) return;
  sink?.(e, p);
}

function onQueue(p: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!p || typeof p.id !== 'string' || p.id.length > 32 || typeof p.q !== 'string' || typeof p.since !== 'number') return;
  const s = useOnline.getState();
  if (p.id === s.me || p.q !== s.q) return;
  const peer: Peer = { id: p.id, name: cleanName(p.name) || 'Miner', look: cleanLook(p.look), weapon: 'pick', sp: isSpecial(p.sp) ? p.sp : 'quake', w: walletOf(p.id, p.w), q: p.q, since: Math.min(p.since, Date.now()), seen: Date.now() };
  useOnline.setState({ peers: { ...s.peers, [p.id]: peer } });
}

function onMatch(p: any) { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!p || typeof p.mid !== 'string' || !Array.isArray(p.players) || p.players.length < 2 || p.players.length > 4) return;
  const s = useOnline.getState();
  const ids = p.players.map((x: { id?: unknown }) => x?.id);
  // whoever this match took is no longer waiting
  if (!ids.includes(s.me)) {
    if (Object.keys(s.peers).some((id) => ids.includes(id))) {
      const peers = { ...s.peers };
      for (const id of ids) delete peers[id as string];
      useOnline.setState({ peers });
    }
    return;
  }
  if (s.phase !== 'search' || seenMids.has(p.mid) || p.host !== p.id) return;
  seenMids.add(p.mid);
  const players: NetPlayer[] = p.players.map((x: { id: string; name: unknown; look: unknown; sp?: unknown; w?: unknown }) => ({ id: String(x.id).slice(0, 32), name: cleanName(x.name) || 'Miner', look: x.id === s.me ? mine?.look : cleanLook(x.look), weapon: 'pick', sp: isSpecial(x.sp) ? x.sp : 'quake', w: x.id === s.me ? mine?.w : walletOf(String(x.id), x.w) }));
  stopTicker();
  useOnline.setState({ phase: 'match', match: { mid: p.mid, host: p.host, mode: p.mode === '1v1' ? '1v1' : 'ffa', seed: Number(p.seed) >>> 0, players } });
}

const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** A wallet someone claims, believed only when their player id carries it (game/peerId.ts). */
function walletOf(id: string, w: unknown): string | undefined {
  return typeof w === 'string' && B58.test(w) && id.startsWith(w.slice(0, 8)) ? w : undefined;
}

const DEFAULT_LOOK: Look = { hat: 'hat-yellow', fit: '#3a5a8a', pick: '#b8c4d6', handle: '#6b4a32', pet: null, glow: 'none', sex: 'm' };
const GLOWS = ['none', 'rare', 'epic', 'legendary'];
/** Someone else's look, kept to plain short values so a bad packet cannot break drawing. */
function cleanLook(raw: unknown): Look {
  if (!raw || typeof raw !== 'object') return DEFAULT_LOOK;
  const out: Record<string, unknown> = { ...DEFAULT_LOOK };
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, 24)) {
    if (k.length > 16) continue;
    if (typeof v === 'string' && v.length <= 40) out[k] = v;
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
    else if (typeof v === 'boolean' || v === null) out[k] = v;
  }
  if (!GLOWS.includes(out.glow as string)) out.glow = 'none';
  if (out.sex !== 'f') out.sex = 'm';
  for (const k of ['hat', 'fit', 'pick', 'handle'] as const) if (typeof out[k] !== 'string') out[k] = DEFAULT_LOOK[k];
  return out as unknown as Look;
}
