/**
 * The Arena: Brawl with everything on. A pit behind the lobby where up to 12 miners fight in matches that
 * rotate through three modes:
 *
 *   Last Miner Standing  one life each; a KO puts you in the stands until the next match
 *   King of the Hill     stand alone in the ring to score; first to 20 seconds wins
 *   Mole Boss            everyone against one big mole; it slams whoever is close
 *
 * In here powers count (one active, one passive, unlocked by level), ORE shards can be picked up and
 * thrown, hearts and shields lie around, and the stands cheer. Nothing real is at stake: XP only.
 *
 * There is no game server. One player's client is the host: the one with the smallest id that is still
 * here. The host runs the match clock, the scores, the pickups and the boss, and tells everyone. If the
 * host leaves, the next smallest id takes over within a few seconds. Hits work as everywhere else in
 * Brawl (game/brawl.ts): each player is the judge of their own HP.
 */
import type { RealtimeChannel } from '@supabase/realtime-js';
import { create } from 'zustand';
import type { Look } from '../engine/types';
import { awardFightXp, bossHit, brawlHooks, enterScope, heal, registerRoom, resetMe, shieldMe, useBrawl, MAX_HP } from './brawl';
import { cleanName } from './lobbyMap';
import { ACTIVES, PASSIVES, baseDamage, unlocked, type ActiveId, type PassiveId } from './powers';
import { roomHooks } from './rx';
import { loadJson, saveJson } from './storage';
import { useName } from './username';
import { useWorld, worldClient, worldReady } from './world';

/* ---------------- the pit ---------------- */
import { AH, AW, FLOOR, MAX_FIGHTERS, onFloor, RING, spawnAt, type PickKind, type Pickup, type Shot } from './arenaMap';
export * from './arenaMap';

/* ---------------- matches ---------------- */
export type Mode = 'lms' | 'koth' | 'boss';
export const MODES: Mode[] = ['lms', 'koth', 'boss'];
export const MODE_NAME: Record<Mode, string> = { lms: 'LAST MINER STANDING', koth: 'KING OF THE HILL', boss: 'MOLE BOSS' };
export type Phase = 'wait' | 'count' | 'fight' | 'end';
export const COUNT_MS = 5000;
export const FIGHT_MS: Record<Mode, number> = { lms: 120_000, koth: 90_000, boss: 120_000 };
export const END_MS = 6000;
export const KOTH_WIN = 20;
/** XP for a KO in the arena, and for winning (the boss pays everyone who fought) */
export const ARENA_KO_XP = 40;
export const WIN_XP = 50;
export const BOSS_XP = 30;
export const BOSS_BASE_HP = 400;
export const BOSS_HP_PER = 150;
const BOSS_SPEED = 30;
const BOSS_SLAM_MS = 2600;
const BOSS_SLAM_R = 40;

export interface Boss {
  x: number;
  y: number;
  hp: number;
  max: number;
  /** when its last slam landed (wall ms) */
  slamAt: number;
  hitAt: number;
  facing: 1 | -1;
}
export interface Match {
  host: string;
  n: number;
  mode: Mode;
  phase: Phase;
  /** when this phase ends, on our clock */
  endsAt: number;
  /** ids who were in at the start of the fight */
  fighters: string[];
  /** Last Miner Standing: ids knocked out */
  out: string[];
  /** King of the Hill: seconds in the ring */
  score: Record<string, number>;
  winner: string | null;
  /** who won, by name, for the banner */
  winnerName: string | null;
  boss: Boss | null;
}
export interface ArenaPeer {
  id: string;
  name: string;
  x: number;
  y: number;
  tx: number;
  ty: number;
  facing: 1 | -1;
  pose: string;
  look: Look;
  lvl: number;
  wallet: string | null;
  spectator: boolean;
  /** cosmetics: swing trail and KO effect ids */
  trail: string;
  /** last power they used, for the effect */
  fx: { p: string; at: number } | null;
  seen: number;
}

export interface Loadout {
  active: ActiveId | null;
  passive: PassiveId | null;
  trail: string;
}

interface ArenaState {
  open: boolean;
  status: 'off' | 'joining' | 'online';
  me: string;
  peers: Record<string, ArenaPeer>;
  match: Match;
  pickups: Pickup[];
  shots: Shot[];
  ammo: number;
  /** wall ms the active power can be used again */
  readyAt: number;
  loadout: Loadout;
  /** spectators cheering: the last few */
  cheers: { id: string; at: number }[];
  /** you were knocked out in Last Miner Standing: watch from the stands */
  spectator: boolean;
  show: () => void;
  close: () => void;
  setLoadout: (l: Partial<Loadout>) => void;
}

const rid = () => Math.random().toString(36).slice(2, 10);
const blankMatch = (): Match => ({ host: '', n: 0, mode: 'lms', phase: 'wait', endsAt: 0, fighters: [], out: [], score: {}, winner: null, winnerName: null, boss: null });

export const useArena = create<ArenaState>((set, get) => ({
  open: false,
  status: 'off',
  me: rid(),
  peers: {},
  match: blankMatch(),
  pickups: [],
  shots: [],
  ammo: 0,
  readyAt: 0,
  loadout: { active: null, passive: null, trail: 'plain' },
  cheers: [],
  spectator: false,
  show: () => {
    if (get().open) return;
    set({ open: true, peers: {}, match: blankMatch(), pickups: [], shots: [], ammo: 0, spectator: false });
    enterScope('arena');
    // the host loop runs even offline: alone, you practise against the boss
    if (!hostTimer) hostTimer = setInterval(hostTick, 250);
    join();
  },
  close: () => {
    leave();
    set({ open: false, peers: {}, status: 'off' });
  },
  setLoadout: (l) => {
    const lo = { ...get().loadout, ...l };
    set({ loadout: lo });
    saveJson(LO_KEY, lo, 300);
    useBrawl.setState({ passive: lo.passive });
  },
}));
const LO_KEY = 'gali-arena-loadout-v1';
void loadJson<Loadout>(LO_KEY, { active: null, passive: null, trail: 'plain' }).then((lo) => {
  const ok = (v: unknown, list: readonly string[]) => (typeof v === 'string' && list.includes(v) ? v : null);
  useArena.setState({ loadout: { active: ok(lo.active, ACTIVES) as ActiveId | null, passive: ok(lo.passive, PASSIVES) as PassiveId | null, trail: typeof lo.trail === 'string' ? lo.trail : 'plain' } });
});

/** The powers you can actually use at this level (falls back to the first unlocked). */
export function effectiveLoadout(lvl: number): { active: ActiveId | null; passive: PassiveId | null } {
  const lo = useArena.getState().loadout;
  const active = lo.active && unlocked(lo.active, lvl) ? lo.active : ACTIVES.find((p) => unlocked(p, lvl)) ?? null;
  const passive = lo.passive && unlocked(lo.passive, lvl) ? lo.passive : PASSIVES.find((p) => unlocked(p, lvl)) ?? null;
  return { active, passive };
}

/* ---------------- the network ---------------- */
let channel: RealtimeChannel | null = null;
let hostTimer: ReturnType<typeof setInterval> | null = null;
let level: () => number = () => 1;
let look: () => Look = () => ({ hat: 'hat-yellow', fit: '#2f5fd0', pick: '#c9c9c9', handle: '#9b6b43', pet: null, glow: 'none' });
let wallet: () => string | null = () => null;
let myPos: [number, number] = [FLOOR.cx, FLOOR.cy + 40];
let myState = { tx: 0, ty: 0, f: 1 as 1 | -1, p: 'idle' };
let lastSent = 0;
let lastKey = '';
const HEX = /^#[0-9a-fA-F]{6}$/;
const KEY = /^[a-z0-9-]{2,24}$/;
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo);
const send = (event: string, payload: Record<string, unknown>) => {
  if (!channel || useArena.getState().status !== 'online') return false;
  void channel.send({ type: 'broadcast', event, payload });
  return true;
};

/** Wire the arena to the app. Called once at start (with the same things Brawl gets). */
export function initArena(o: { level: () => number; look: () => Look; wallet: () => string | null; gainXp: (n: number) => void }) {
  level = o.level;
  look = o.look;
  wallet = o.wallet;
  void o.gainXp; // arena XP goes through Brawl (awardFightXp), under the daily cap
  registerRoom('arena', {
    me: () => useArena.getState().me,
    send: (p) => send('bx', p),
    peer: (id) => {
      const p = useArena.getState().peers[id];
      return p ? { pos: [p.x, p.y], lvl: p.lvl, name: p.name } : null;
    },
    arena: true,
    koXp: ARENA_KO_XP,
    host: () => hostId(),
  });
}

function join() {
  if (channel || !worldReady) {
    if (!worldReady) useArena.setState({ status: 'off' });
    return;
  }
  const client = worldClient();
  if (!client) {
    useArena.setState({ status: 'joining' });
    const un = useWorld.subscribe((w) => {
      if (w.status === 'online' && worldClient()) {
        un();
        if (useArena.getState().open) join();
      }
    });
    return;
  }
  useArena.setState({ status: 'joining' });
  const ch = client.channel('gali-arena', { config: { broadcast: { self: false, ack: false } } });
  ch.on('broadcast', { event: 'st' }, ({ payload }) => onState(payload))
    .on('broadcast', { event: 'bx' }, ({ payload }) => {
      roomHooks.onBx?.('arena', payload);
      onBossHit(payload);
    })
    .on('broadcast', { event: 'm' }, ({ payload }) => onMatch(payload))
    .on('broadcast', { event: 'pk' }, ({ payload }) => onPickups(payload))
    .on('broadcast', { event: 'grab' }, ({ payload }) => onGrab(payload))
    .on('broadcast', { event: 'took' }, ({ payload }) => onTook(payload))
    .on('broadcast', { event: 'thr' }, ({ payload }) => onThrow(payload))
    .on('broadcast', { event: 'pw' }, ({ payload }) => onPower(payload))
    .on('broadcast', { event: 'cheer' }, ({ payload }) => onCheer(payload))
    .on('broadcast', { event: 'bye' }, ({ payload }) => {
      const id = payload?.id;
      if (typeof id !== 'string') return;
      useArena.setState((s) => {
        const peers = { ...s.peers };
        delete peers[id];
        return { peers };
      });
    })
    .on('broadcast', { event: 'hi' }, () => {
      lastKey = '';
      lastSent = 0;
      // the host answers a newcomer with the match as it stands
      if (isHost()) broadcastMatch();
    })
    .subscribe((st) => {
      if (st === 'SUBSCRIBED') {
        useArena.setState({ status: 'online' });
        void ch.send({ type: 'broadcast', event: 'hi', payload: { id: useArena.getState().me } });
      } else if (st === 'CLOSED' || st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') {
        if (channel === ch) useArena.setState({ status: 'off' });
      }
    });
  channel = ch;
  // standing still sends nothing new, so say we are here every 2 seconds (others drop players after 6)
  if (!beatTimer) beatTimer = setInterval(() => publishArenaMe({ x: myPos[0], y: myPos[1], tx: myState.tx || myPos[0], ty: myState.ty || myPos[1], facing: myState.f, pose: myState.p }), 2000);
}
let beatTimer: ReturnType<typeof setInterval> | null = null;
let trailTimer: ReturnType<typeof setTimeout> | null = null;

function leave() {
  if (hostTimer) clearInterval(hostTimer);
  hostTimer = null;
  if (beatTimer) clearInterval(beatTimer);
  beatTimer = null;
  const ch = channel;
  channel = null;
  if (ch) {
    void ch.send({ type: 'broadcast', event: 'bye', payload: { id: useArena.getState().me } });
    void ch.unsubscribe();
  }
}

function onState(p: any) {
  const s = useArena.getState();
  if (!p || typeof p.id !== 'string' || p.id.length > 16 || p.id === s.me) return;
  const name = cleanName(p.nm);
  if (!name) return;
  const prev = s.peers[p.id];
  if (!prev && Object.keys(s.peers).length >= 40) return;
  const x = num(p.x, 0, AW);
  const y = num(p.y, 0, AH);
  const hasLook = typeof p.h === 'string';
  const lk: Look = !hasLook && prev ? prev.look : {
    hat: typeof p.h === 'string' && KEY.test(p.h) ? p.h : 'hat-yellow',
    fit: typeof p.c === 'string' && HEX.test(p.c) ? p.c : '#2f5fd0',
    pick: typeof p.k === 'string' && HEX.test(p.k) ? p.k : '#c9c9c9',
    handle: typeof p.hd === 'string' && HEX.test(p.hd) ? p.hd : '#9b6b43',
    pet: typeof p.pt === 'string' && KEY.test(p.pt) ? p.pt : null,
    glow: ['none', 'rare', 'epic', 'legendary'].includes(p.g) ? p.g : 'none',
    sex: p.sx === 'f' ? 'f' : 'm',
  };
  const jumped = !prev || Math.hypot(prev.x - x, prev.y - y) > 40;
  const peer: ArenaPeer = {
    id: p.id,
    name,
    x: jumped ? x : prev.x,
    y: jumped ? y : prev.y,
    tx: num(p.tx, 0, AW),
    ty: num(p.ty, 0, AH),
    facing: p.f === -1 ? -1 : 1,
    pose: typeof p.p === 'string' && /^(idle|walk|swing|cheer|dance[123])$/.test(p.p) ? p.p : 'idle',
    look: lk,
    lvl: Math.floor(num(p.lvl, 1, 999)),
    wallet: typeof p.w === 'string' && B58.test(p.w) ? p.w : prev?.wallet ?? null,
    spectator: p.sp === 1,
    trail: typeof p.tr === 'string' && KEY.test(p.tr) ? p.tr : prev?.trail ?? 'plain',
    fx: prev?.fx ?? null,
    seen: Date.now(),
  };
  useArena.setState((st) => ({ peers: { ...st.peers, [p.id]: peer } }));
  if (p.bw !== undefined) roomHooks.onBw?.('arena', p.id, p.bw);
}

/** Your miner moved: share it (up to about 8 times a second while moving). */
export function publishArenaMe(m: { x: number; y: number; tx: number; ty: number; facing: 1 | -1; pose: string }) {
  myPos = [m.x, m.y];
  myState = { tx: m.tx, ty: m.ty, f: m.facing, p: m.pose };
  const s = useArena.getState();
  const name = useName.getState().name;
  if (!channel || s.status !== 'online' || !name) return;
  const now = Date.now();
  const r = Math.round;
  const lk = look();
  const bw = roomHooks.myBw?.();
  const move = { id: s.me, nm: name, x: r(m.x), y: r(m.y), tx: r(m.tx), ty: r(m.ty), f: m.facing, p: m.pose, sp: s.spectator ? 1 : 0, ...(bw ? { bw } : {}) };
  const key = JSON.stringify(move);
  if (key === lastKey && now - lastSent < 1900) return;
  if (now - lastSent < 120) {
    // too soon: send the latest a moment later, so the last move is never lost
    if (!trailTimer) trailTimer = setTimeout(() => {
      trailTimer = null;
      publishArenaMe({ x: myPos[0], y: myPos[1], tx: myState.tx, ty: myState.ty, facing: myState.f, pose: myState.p });
    }, 125 - (now - lastSent));
    return;
  }
  lastSent = now;
  lastKey = key;
  const w = wallet();
  void channel.send({
    type: 'broadcast',
    event: 'st',
    payload: { ...move, h: lk.hat, c: lk.fit, k: lk.pick, hd: lk.handle, pt: lk.pet, g: lk.glow, sx: lk.sex === 'f' ? 'f' : 'm', lvl: level(), tr: s.loadout.trail, ...(w ? { w } : {}) },
  });
}
export const arenaPos = () => myPos;

/* ---------------- host ---------------- */
/** The host: the smallest id among the players still here (and us). */
export function hostId(): string | null {
  const s = useArena.getState();
  if (!s.open) return null;
  const now = Date.now();
  const ids = [s.me, ...Object.values(s.peers).filter((p) => now - p.seen < 6000).map((p) => p.id)];
  return ids.sort()[0] ?? null;
}
export const isHost = () => hostId() === useArena.getState().me;

/** Everyone who could fight right now: present, not watching by choice. */
function presentIds(): string[] {
  const s = useArena.getState();
  const now = Date.now();
  return [s.me, ...Object.values(s.peers).filter((p) => now - p.seen < 6000).map((p) => p.id)].sort().slice(0, MAX_FIGHTERS);
}
const nameOf = (id: string) => (id === useArena.getState().me ? useName.getState().name : useArena.getState().peers[id]?.name) ?? null;

let pickSeq = 1;
let lastPickAt = 0;
let lastBroadcast = 0;
function broadcastMatch() {
  const m = useArena.getState().match;
  lastBroadcast = Date.now();
  send('m', { h: useArena.getState().me, n: m.n, mode: m.mode, ph: m.phase, left: Math.max(0, m.endsAt - Date.now()), fi: m.fighters, out: m.out, sc: m.score, win: m.winner, wn: m.winnerName, boss: m.boss ? { x: Math.round(m.boss.x), y: Math.round(m.boss.y), hp: m.boss.hp, max: m.boss.max, sl: m.boss.slamAt ? Date.now() - m.boss.slamAt : -1, f: m.boss.facing } : null });
}
function setMatch(m: Partial<Match>, tell = true) {
  useArena.setState((s) => ({ match: { ...s.match, ...m } }));
  if (tell) broadcastMatch();
}

/** Start a phase. Only the host calls this. */
function startPhase(phase: Phase, mode: Mode, now: number) {
  const s = useArena.getState();
  if (phase === 'count') {
    const fighters = presentIds();
    const boss = mode === 'boss' ? { x: FLOOR.cx, y: FLOOR.cy - 20, hp: BOSS_BASE_HP + BOSS_HP_PER * Math.max(0, fighters.length - 1), max: BOSS_BASE_HP + BOSS_HP_PER * Math.max(0, fighters.length - 1), slamAt: 0, hitAt: 0, facing: 1 as const } : null;
    setMatch({ host: s.me, n: s.match.n + 1, mode, phase, endsAt: now + COUNT_MS, fighters, out: [], score: {}, winner: null, winnerName: null, boss });
  } else if (phase === 'fight') setMatch({ phase, endsAt: now + FIGHT_MS[mode] });
  else if (phase === 'end') setMatch({ phase, endsAt: now + END_MS });
  else setMatch({ phase: 'wait', endsAt: 0, fighters: [], out: [], score: {}, boss: null, winner: null, winnerName: null });
}

function hostTick() {
  const s = useArena.getState();
  if (!s.open || !isHost()) return;
  const now = Date.now();
  const m = s.match;
  // we just became host (or nobody was): take over the match as it stands
  if (m.host !== s.me) {
    useArena.setState({ match: { ...m, host: s.me } });
    if (m.phase === 'wait' || !m.endsAt) startPhase('wait', m.mode, now);
  }
  const present = presentIds();
  const nextMode = (mode: Mode): Mode => MODES[(MODES.indexOf(mode) + 1) % MODES.length];
  if (m.phase === 'wait') {
    // pick the next mode that fits the crowd: two or more for a fight between miners, the boss works solo
    let mode = m.n ? nextMode(m.mode) : 'lms';
    if (present.length < 2) mode = 'boss';
    startPhase('count', mode, now);
  } else if (m.phase === 'count' && now >= m.endsAt) {
    startPhase('fight', m.mode, now);
    spawnPickups(now, true);
  } else if (m.phase === 'fight') {
    const alive = m.fighters.filter((id) => present.includes(id) && !m.out.includes(id));
    if (m.mode === 'lms') {
      if (m.fighters.length >= 2 && alive.length <= 1) return finish(alive[0] ?? null, now);
      if (m.fighters.length < 2 && alive.length === 0) return finish(null, now);
    } else if (m.mode === 'koth') {
      const inRing = alive.filter((id) => {
        const p = id === s.me ? myPos : [s.peers[id]?.x ?? -999, s.peers[id]?.y ?? -999];
        const f = id === s.me ? useBrawl.getState().me : useBrawl.getState().peers[id];
        return Math.hypot(p[0] - RING.x, (p[1] - RING.y) * 1.6) <= RING.r && !(f && f.koAt);
      });
      if (inRing.length === 1) {
        const id = inRing[0];
        const sc = { ...m.score, [id]: Math.round(((m.score[id] ?? 0) + 0.25) * 100) / 100 };
        setMatch({ score: sc }, now - lastBroadcast > 900);
        if (sc[id] >= KOTH_WIN) return finish(id, now);
      }
    } else if (m.mode === 'boss' && m.boss) {
      bossThink(m.boss, alive, now);
      if (m.boss.hp <= 0) return finish('boss-down', now);
      if (!alive.length) return finish(null, now);
    }
    if (now - lastPickAt > 9000) spawnPickups(now, false);
    if (now >= m.endsAt) {
      // time: the most HP (LMS) or the highest score (KOTH) wins; the boss survives
      if (m.mode === 'lms') {
        const hpOf = (id: string) => (id === s.me ? useBrawl.getState().me.hp : useBrawl.getState().peers[id]?.hp ?? 0);
        finish(alive.sort((a, b) => hpOf(b) - hpOf(a))[0] ?? null, now);
      } else if (m.mode === 'koth') finish(Object.entries(m.score).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null, now);
      else finish(null, now);
    } else if (now - lastBroadcast > 3000) broadcastMatch();
  } else if (m.phase === 'end' && now >= m.endsAt) {
    useArena.setState({ pickups: [] });
    send('pk', { h: s.me, items: [] });
    startPhase('wait', m.mode, now);
  }
}

function finish(winner: string | null, now: number) {
  const m = useArena.getState().match;
  setMatch({ winner, winnerName: winner === 'boss-down' ? 'THE MINERS' : winner ? nameOf(winner) : null, phase: 'end', endsAt: now + END_MS, boss: m.boss ? { ...m.boss, hp: Math.max(0, m.boss.hp) } : null });
  const done = useArena.getState().match;
  hostResultListeners.forEach((f) => f(done));
  applyResult(done);
}
/** The host hears every result first (it reports wins to the ranks). */
export const hostResultListeners = new Set<(m: Match) => void>();

/* ---------------- pickups ---------------- */
function randomFloorSpot(): [number, number] {
  for (let k = 0; k < 40; k++) {
    const x = FLOOR.cx + (Math.random() * 2 - 1) * (FLOOR.rx - 20);
    const y = FLOOR.cy + (Math.random() * 2 - 1) * (FLOOR.ry - 14);
    if (onFloor(x, y, 14)) return [Math.round(x), Math.round(y)];
  }
  return [FLOOR.cx, FLOOR.cy];
}
function spawnPickups(now: number, fresh: boolean) {
  lastPickAt = now;
  const s = useArena.getState();
  const items = fresh ? [] : [...s.pickups];
  const want = fresh ? 4 : 1;
  for (let k = 0; k < want && items.length < 6; k++) {
    const r = Math.random();
    const kind: PickKind = r < 0.55 ? 'ore' : r < 0.8 ? 'heart' : 'shield';
    const [x, y] = randomFloorSpot();
    items.push({ i: pickSeq++, k: kind, x, y });
  }
  useArena.setState({ pickups: items });
  send('pk', { h: s.me, items });
}
function onPickups(p: any) {
  if (!p || p.h !== hostId() || !Array.isArray(p.items)) return;
  const items: Pickup[] = p.items
    .slice(0, 8)
    .filter((it: any) => it && Number.isFinite(it.i) && ['ore', 'heart', 'shield'].includes(it.k))
    .map((it: any) => ({ i: Math.floor(it.i), k: it.k, x: num(it.x, 0, AW), y: num(it.y, 0, AH) }));
  useArena.setState({ pickups: items });
}
/** You walked over a pickup. The host decides who got it first. */
export function grab(i: number) {
  const s = useArena.getState();
  if (s.spectator) return;
  if (isHost()) return hostGive(i, s.me, myPos);
  send('grab', { id: s.me, i, x: Math.round(myPos[0]), y: Math.round(myPos[1]) });
}
function onGrab(p: any) {
  if (!isHost() || !p || typeof p.id !== 'string' || !Number.isFinite(p.i)) return;
  const peer = useArena.getState().peers[p.id];
  if (!peer) return;
  // trust where they say they are only if it is close to where we last saw them
  const claim: [number, number] = Number.isFinite(p.x) && Number.isFinite(p.y) && Math.hypot(p.x - peer.x, p.y - peer.y) < 60 ? [p.x, p.y] : [peer.x, peer.y];
  hostGive(Math.floor(p.i), p.id, claim);
}
function hostGive(i: number, to: string, at: [number, number]) {
  const s = useArena.getState();
  const it = s.pickups.find((x) => x.i === i);
  if (!it || Math.hypot(it.x - at[0], it.y - at[1]) > 30) return;
  const items = s.pickups.filter((x) => x.i !== i);
  useArena.setState({ pickups: items });
  send('pk', { h: s.me, items });
  send('took', { h: s.me, i, by: to, k: it.k });
  if (to === s.me) applyPickup(it.k);
}
function onTook(p: any) {
  if (!p || p.h !== hostId()) return;
  useArena.setState((s) => ({ pickups: s.pickups.filter((x) => x.i !== p.i) }));
  if (p.by === useArena.getState().me && ['ore', 'heart', 'shield'].includes(p.k)) applyPickup(p.k);
}
function applyPickup(k: PickKind) {
  if (k === 'ore') useArena.setState((s) => ({ ammo: Math.min(9, s.ammo + 3) }));
  else if (k === 'heart') heal(30);
  else shieldMe(3000);
  pickupListeners.forEach((f) => f(k));
}
export const pickupListeners = new Set<(k: PickKind) => void>();

/* ---------------- throwing, powers, cheers (what others see) ---------------- */
/** You threw a shard (or three): tell the others so they see it fly. Hits are sent by brawl.strike. */
export function shareThrow(x: number, y: number, dirs: [number, number][]) {
  send('thr', { id: useArena.getState().me, x: Math.round(x), y: Math.round(y), d: dirs.map(([a, b]) => [Math.round(a * 100) / 100, Math.round(b * 100) / 100]) });
}
function onThrow(p: any) {
  if (!p || typeof p.id !== 'string' || !Array.isArray(p.d)) return;
  const now = Date.now();
  const shots: Shot[] = p.d.slice(0, 3).filter((d: any) => Array.isArray(d)).map((d: any) => ({ id: p.id, x: num(p.x, 0, AW), y: num(p.y, 0, AH), dx: num(d[0], -1, 1), dy: num(d[1], -1, 1), at: now }));
  useArena.setState((s) => ({ shots: [...s.shots.filter((x) => now - x.at < 1200), ...shots].slice(-20) }));
}
export function sharePower(p: string) {
  send('pw', { id: useArena.getState().me, p });
}
function onPower(p: any) {
  if (!p || typeof p.id !== 'string' || typeof p.p !== 'string' || !/^(dash|slam|guard|splash)$/.test(p.p)) return;
  const peer = useArena.getState().peers[p.id];
  if (peer) useArena.setState((s) => ({ peers: { ...s.peers, [p.id]: { ...peer, fx: { p: p.p, at: Date.now() } } } }));
}
let lastCheer = 0;
export function cheer() {
  const now = Date.now();
  if (now - lastCheer < 600) return;
  lastCheer = now;
  const me = useArena.getState().me;
  useArena.setState((s) => ({ cheers: [...s.cheers.filter((c) => now - c.at < 2500), { id: me, at: now }].slice(-30) }));
  send('cheer', { id: me });
}
const cheerFrom = new Map<string, number>();
function onCheer(p: any) {
  if (!p || typeof p.id !== 'string') return;
  const now = Date.now();
  if (now - (cheerFrom.get(p.id) ?? 0) < 500) return;
  cheerFrom.set(p.id, now);
  if (cheerFrom.size > 100) cheerFrom.clear();
  useArena.setState((s) => ({ cheers: [...s.cheers.filter((c) => now - c.at < 2500), { id: p.id, at: now }].slice(-30) }));
}

/* ---------------- the boss ---------------- */
function bossThink(b: Boss, alive: string[], now: number) {
  const s = useArena.getState();
  const pos = (id: string): [number, number] => (id === s.me ? myPos : [s.peers[id]?.x ?? FLOOR.cx, s.peers[id]?.y ?? FLOOR.cy]);
  const targets = alive.filter((id) => !(id === s.me ? useBrawl.getState().me.koAt : useBrawl.getState().peers[id]?.koAt));
  if (!targets.length) return;
  const near = targets.map((id) => ({ id, p: pos(id), d: Math.hypot(pos(id)[0] - b.x, pos(id)[1] - b.y) })).sort((a, c) => a.d - c.d)[0];
  let { x, y } = b;
  if (near.d > 26) {
    const k = Math.min(1, (BOSS_SPEED * 0.25) / near.d);
    const nx = x + (near.p[0] - x) * k;
    const ny = y + (near.p[1] - y) * k;
    if (onFloor(nx, ny, 10)) {
      x = nx;
      y = ny;
    }
  }
  const facing: 1 | -1 = near.p[0] >= x ? 1 : -1;
  let slamAt = b.slamAt;
  if (near.d < BOSS_SLAM_R && now - b.slamAt > BOSS_SLAM_MS) {
    slamAt = now;
    for (const id of targets) {
      const p = pos(id);
      if (Math.hypot(p[0] - x, p[1] - y) <= BOSS_SLAM_R) bossHit('arena', id, x, y, s.me);
    }
  }
  setMatch({ boss: { ...b, x, y, facing, slamAt } }, slamAt !== b.slamAt || now - lastBroadcast > 400);
}
/** A player hit the boss. The host checks it and keeps the boss's HP. */
const bossHitsFrom = new Map<string, number>();
function onBossHit(p: any) {
  if (!p || p.k !== 'h' || p.t !== 'boss' || !isHost()) return;
  const s = useArena.getState();
  const b = s.match.boss;
  if (!b || s.match.phase !== 'fight' || typeof p.a !== 'string') return;
  const peer = s.peers[p.a];
  if (!peer || Math.hypot(peer.x - b.x, peer.y - b.y) > 170) return;
  const now = Date.now();
  const w = ['swing', 'dash', 'slam', 'ore', 'splash', 'pet'].includes(p.w) ? p.w : 'swing';
  const key = `${p.a}:${w}`;
  if (now - (bossHitsFrom.get(key) ?? 0) < 300) return;
  bossHitsFrom.set(key, now);
  hurtBoss(baseDamage(w, p.a, Math.floor(Number(p.s) || 0), peer.lvl, true), now);
}
/** The host's own hits on the boss, and everyone's once checked. */
export function hurtBoss(dmg: number, now = Date.now()) {
  const b = useArena.getState().match.boss;
  if (!b) return;
  setMatch({ boss: { ...b, hp: Math.max(0, b.hp - dmg), hitAt: now } }, true);
}

/* ---------------- what everyone does with the host's word ---------------- */
let appliedN = -1;
let resultN = -1;
function onMatch(p: any) {
  if (!p || typeof p.h !== 'string' || p.h !== hostId() || !MODES.includes(p.mode)) return;
  const now = Date.now();
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length <= 16).slice(0, 40) : []);
  const score: Record<string, number> = {};
  if (p.sc && typeof p.sc === 'object') for (const [k, v] of Object.entries(p.sc)) if (k.length <= 16 && typeof v === 'number') score[k] = Math.max(0, Math.min(999, v));
  const boss: Boss | null = p.boss && typeof p.boss === 'object' ? { x: num(p.boss.x, 0, AW), y: num(p.boss.y, 0, AH), hp: num(p.boss.hp, 0, 99999), max: num(p.boss.max, 1, 99999), slamAt: p.boss.sl >= 0 ? now - num(p.boss.sl, 0, 60000) : 0, hitAt: useArena.getState().match.boss?.hitAt ?? 0, facing: p.boss.f === -1 ? -1 : 1 } : null;
  const prevBoss = useArena.getState().match.boss;
  if (boss && prevBoss && boss.hp < prevBoss.hp) boss.hitAt = now;
  const m: Match = {
    host: p.h,
    n: Math.floor(num(p.n, 0, 1e9)),
    mode: p.mode,
    phase: ['wait', 'count', 'fight', 'end'].includes(p.ph) ? p.ph : 'wait',
    endsAt: now + num(p.left, 0, 600_000),
    fighters: ids(p.fi),
    out: ids(p.out),
    score,
    winner: typeof p.win === 'string' ? p.win : null,
    winnerName: typeof p.wn === 'string' ? cleanName(p.wn) || (p.wn === 'THE MINERS' ? p.wn : null) : null,
    boss,
  };
  useArena.setState({ match: m });
  onMatchChanged(m);
}

/** Things that follow from the match: a fresh start at the countdown, the stands when you are out, XP at the end. */
function onMatchChanged(m: Match) {
  const s = useArena.getState();
  if (m.phase === 'count' && appliedN !== m.n) {
    appliedN = m.n;
    const i = m.fighters.indexOf(s.me);
    useArena.setState({ spectator: i < 0, ammo: 0, readyAt: 0 });
    resetMe(COUNT_MS + 600);
    matchListeners.forEach((f) => f(m));
  }
  if (m.phase === 'end') applyResult(m);
}
export const matchListeners = new Set<(m: Match) => void>();

function applyResult(m: Match) {
  if (resultN === m.n) return;
  resultN = m.n;
  const s = useArena.getState();
  const fought = m.fighters.includes(s.me);
  if (!fought) return;
  if (m.mode === 'boss' && m.winner === 'boss-down') awardFightXp(BOSS_XP);
  else if (m.winner === s.me && m.fighters.length >= 2) awardFightXp(WIN_XP);
  resultListeners.forEach((f) => f(m));
}
export const resultListeners = new Set<(m: Match) => void>();

/* ---------------- KOs in the arena ---------------- */
// Last Miner Standing: a KO puts you in the stands until the next match. The host hears it from the
// victim's HP state (knocked down) and marks them out; the victim moves to the stands itself.
brawlHooks.kodBy = ((prev) => (scope, by, name) => {
  prev?.(scope, by, name);
  if (scope !== 'arena') return;
  const m = useArena.getState().match;
  if (m.phase === 'fight' && m.mode === 'lms') {
    useArena.setState({ spectator: true });
    if (isHost()) setMatch({ out: [...new Set([...m.out, useArena.getState().me])] });
  }
})(brawlHooks.kodBy);
/** The host's view of a knockdown it heard about. */
export function hostSawKo(id: string) {
  if (!isHost()) return;
  const m = useArena.getState().match;
  if (m.phase === 'fight' && m.mode === 'lms' && m.fighters.includes(id) && !m.out.includes(id)) setMatch({ out: [...m.out, id] });
}
useBrawl.subscribe((b, prev) => {
  if (!useArena.getState().open || b.scope !== 'arena') return;
  for (const [id, f] of Object.entries(b.peers)) if (f.koAt && !prev.peers[id]?.koAt) hostSawKo(id);
});

/** For the canvas: your HP is full again after a match, the boss's bar, the ring. */
export const arenaMaxHp = MAX_HP;
/** For tests. */
export const _arenaTest = { hostTick, onMatch, onState, onGrab, onTook, onPickups, finish: (w: string | null) => finish(w, Date.now()), setMyPos: (x: number, y: number) => (myPos = [x, y]) };
