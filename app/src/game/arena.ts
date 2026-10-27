/**
 * The Arena: Brawl with everything on. A pit behind the lobby where up to 12 miners fight in matches that
 * rotate through three modes:
 *
 *   Last Miner Standing  one life each; a KO puts you in the stands until the next match
 *   King of the Hill     stand alone in the ring to score; first to 20 seconds wins
 *   Boss Raid            everyone against the Two-Mouthed: it sweeps, lashes its tongue and roars
 *
 * In here powers count (one active, one passive, unlocked by level), ORE shards can be picked up and
 * thrown, hearts and shields lie around, and the balcony cheers. Nothing real is at stake: XP only.
 *
 * The hall is seen from the side: miners run, jump onto ledges and drop back down (engine/arena.ts).
 *
 * There is no game server. One player's client is the host: the one with the smallest id that is still
 * here. The host runs the match clock, the scores, the pickups and the boss, and tells everyone. If the
 * host leaves, the next smallest id takes over within a few seconds. Hits work as everywhere else in
 * Brawl (game/brawl.ts): each player is the judge of their own HP.
 */
import { boundWallet, idFor } from './peerId';
import type { RealtimeChannel } from '@supabase/realtime-js';
import { create } from 'zustand';
import type { Look } from '../engine/types';
import { awardFightXp, bossHit, brawlHooks, enterScope, heal, markHit, registerRoom, resetMe, reviveMe, shieldMe, takeThrow, useBrawl, MAX_HP } from './brawl';
import { cleanName } from './lobbyMap';
import { ACTIVES, PASSIVES, baseDamage, unlocked, type ActiveId, type PassiveId } from './powers';
import { roomHooks } from './rx';
import { loadJson, saveJson } from './storage';
import { useName } from './username';
import { useWorld, worldClient, worldReady } from './world';

/* ---------------- the pit ---------------- */
import { AH, AW, BOSS_ACT_MS, BOSS_WIND2_MS, BOSS_WIND_MS, bossCatches, DIZZY_HP, DOWN_MS, EMOTE_MS, EMOTES, GRAB_X, GRAB_Y, GROUND, HOLD_MS, inGrabReach, inReviveReach, MAX_FIGHTERS, onThrone, REVIVE_HP, REVIVE_MS, ROAR_REACH, SWEEP_REACH, surfaceSpot, THROW_DMG, TONGUE_REACH, WALL_L, WALL_R, type BossAtk, type Emote, type PickKind, type Pickup, type Shot } from './arenaMap';
export * from './arenaMap';

/* ---------------- matches ---------------- */
export type Mode = 'lms' | 'koth' | 'waves' | 'boss';
export const MODES: Mode[] = ['lms', 'koth', 'waves', 'boss'];
export const MODE_NAME: Record<Mode, string> = { lms: 'LAST MINER STANDING', koth: 'KING OF THE HILL', waves: 'CRAWLER WAVES', boss: 'BOSS RAID' };
/** Modes where the miners are one side against the hall: no hits between miners, downed teammates wait for help. */
export const coop = (mode: Mode) => mode === 'boss' || mode === 'waves';
/**
 * Crawler Waves: three miners hold the hall against waves of crawlers. Each wave brings more of them, a
 * little tougher; clear the last one to win. More than three in the arena: the first three fight, the
 * rest cheer from the balcony.
 */
export const WAVES = 5;
export const WAVE_SQUAD = 3;
export const WAVES_XP = 40;
/** crawlers in wave w, their HP, and the breather before the next wave */
export const waveSize = (w: number) => 3 + 2 * w;
export const waveHp = (w: number) => 26 + 6 * w;
const WAVE_REST_MS = 3500;
const WAVE_SPAWN_MS = 1100;
export interface Wave {
  /** this wave (1..WAVES), crawlers still to come out, and when it starts (a breather before each) */
  n: number;
  toSpawn: number;
  startAt: number;
}
export const BOSS_NAME = 'THE TWO-MOUTHED';
export type Phase = 'wait' | 'count' | 'fight' | 'end';
export const COUNT_MS = 5000;
export const FIGHT_MS: Record<Mode, number> = { lms: 120_000, koth: 90_000, waves: 180_000, boss: 120_000 };
export const END_MS = 6000;
export const KOTH_WIN = 20;
/** XP for a KO in the arena, and for winning (the boss pays everyone who fought) */
export const ARENA_KO_XP = 40;
export const WIN_XP = 50;
export const BOSS_XP = 30;
export const BOSS_BASE_HP = 400;
export const BOSS_HP_PER = 150;
const BOSS_SPEED = 26;
const BOSS_SPEED2 = 40;
/** least time between attacks, and in phase two (below half HP) */
const BOSS_COOL_MS = 2300;
const BOSS_COOL2_MS = 1500;

export interface Boss {
  x: number;
  y: number;
  hp: number;
  max: number;
  /** the attack it is winding up or doing, and when the wind-up started (wall ms) */
  atk: BossAtk | null;
  atkAt: number;
  /** the attack's hit has been dealt */
  hitDone: boolean;
  /** when its last attack ended (host only) */
  lastAtk: number;
  hitAt: number;
  facing: 1 | -1;
}
/**
 * Crawlers: small things that crawl out of the walls during a fight, in every mode. They walk the floor
 * toward the nearest miner and bite. A few swings kill one, for a little XP. The host runs them.
 */
export interface Mob {
  i: number;
  x: number;
  hp: number;
  max: number;
  f: 1 | -1;
  /** wall ms of its last bite, and of the last hit it took */
  atkAt: number;
  hitAt: number;
}
export const MOB_HP = 30;
export const MOB_XP = 5;
const MOB_SPEED = 34;
/** one bite: within this far of a miner on the floor, at most every MOB_BITE_MS */
const MOB_REACH = 12;
const MOB_BITE_MS = 1300;
/** how often one crawls out, and how many at once: more in a Boss Raid */
const MOB_EVERY: Record<Mode, number> = { lms: 9000, koth: 9000, waves: WAVE_SPAWN_MS, boss: 5000 };
const MOB_MAX: Record<Mode, number> = { lms: 3, koth: 3, waves: 7, boss: 5 };

/** Below half HP the boss is angrier: faster wind-ups and attacks. */
export const bossPhase2 = (b: { hp: number; max: number }) => b.hp <= b.max / 2;
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
  mobs: Mob[];
  /** Crawler Waves: where the fight is */
  wave: Wave | null;
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
  /** what their app can do: 2 knows Crawler Waves (older apps would ignore a match in a mode they don't know) */
  v: number;
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
  /** wall ms each active power can be used again */
  readyAt: Partial<Record<ActiveId, number>>;
  loadout: Loadout;
  /** spectators cheering: the last few */
  cheers: { id: string; at: number }[];
  /** you were knocked out in Last Miner Standing: watch from the stands */
  spectator: boolean;
  /** emotes over people's heads: the last few */
  emotes: { id: string; e: Emote; at: number }[];
  /** the emote picker is open (T on PC, the smile button on a phone) */
  emoteOpen: boolean;
  /** you are carrying someone you grabbed (ok once they agreed it was a fair grab) */
  holding: { id: string; at: number; ok: boolean } | null;
  /** someone grabbed you and is carrying you */
  heldBy: { id: string; at: number } | null;
  /** you were just thrown: which way */
  thrown: { at: number; d: 1 | -1 } | null;
  /** Boss Raid: when you went down waiting for a teammate (0 when standing) */
  downAt: number;
  /** teammates standing over a downed miner, getting them up */
  revives: { id: string; t: string; at: number }[];
  show: () => void;
  close: () => void;
  setLoadout: (l: Partial<Loadout>) => void;
}

const rid = () => Math.random().toString(36).slice(2, 10);
const blankMatch = (): Match => ({ host: '', n: 0, mode: 'lms', phase: 'wait', endsAt: 0, fighters: [], out: [], score: {}, winner: null, winnerName: null, boss: null, mobs: [], wave: null });

export const useArena = create<ArenaState>((set, get) => ({
  open: false,
  status: 'off',
  me: rid(),
  peers: {},
  match: blankMatch(),
  pickups: [],
  shots: [],
  ammo: 0,
  readyAt: {},
  loadout: { active: null, passive: null, trail: 'plain' },
  cheers: [],
  spectator: false,
  emotes: [],
  emoteOpen: false,
  holding: null,
  heldBy: null,
  thrown: null,
  downAt: 0,
  revives: [],
  show: () => {
    if (get().open) return;
    set({ open: true, peers: {}, match: blankMatch(), pickups: [], shots: [], ammo: 0, spectator: false, emotes: [], emoteOpen: false, holding: null, heldBy: null, thrown: null, downAt: 0, revives: [] });
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

/** The powers you can actually use at this level: every unlocked active, and your passive (or the first unlocked). */
export function effectiveLoadout(lvl: number): { actives: ActiveId[]; passive: PassiveId | null } {
  const lo = useArena.getState().loadout;
  const actives = ACTIVES.filter((p) => unlocked(p, lvl));
  const passive = lo.passive && unlocked(lo.passive, lvl) ? lo.passive : PASSIVES.find((p) => unlocked(p, lvl)) ?? null;
  return { actives, passive };
}

/* ---------------- the network ---------------- */
let channel: RealtimeChannel | null = null;
let hostTimer: ReturnType<typeof setInterval> | null = null;
let level: () => number = () => 1;
let look: () => Look = () => ({ hat: 'hat-yellow', fit: '#2f5fd0', pick: '#c9c9c9', handle: '#9b6b43', pet: null, glow: 'none' });
let wallet: () => string | null = () => null;
let myPos: [number, number] = [AW / 2, GROUND];
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
    coop: () => {
      const m = useArena.getState().match;
      return m.phase === 'fight' && coop(m.mode);
    },
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
  // with a wallet, fight under an id made from it (game/peerId.ts), so nobody can put their wallet on us
  useArena.setState({ status: 'joining', me: idFor(wallet(), useArena.getState().me) });
  // the side-view hall is a new room: older apps (top-down arena) keep to their own
  const ch = client.channel('gali-arena2', { config: { broadcast: { self: false, ack: false } } });
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
    .on('broadcast', { event: 'mk' }, ({ payload }) => onMobKilled(payload))
    .on('broadcast', { event: 'emo' }, ({ payload }) => onEmote(payload))
    .on('broadcast', { event: 'gb' }, ({ payload }) => onGrabbed(payload))
    .on('broadcast', { event: 'gok' }, ({ payload }) => onGrabAnswer(payload))
    .on('broadcast', { event: 'gth' }, ({ payload }) => onThrown(payload))
    .on('broadcast', { event: 'rv' }, ({ payload }) => onReviving(payload))
    .on('broadcast', { event: 'rvd' }, ({ payload }) => onRevived(payload))
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
    pose: typeof p.p === 'string' && /^(idle|walk|swing|cheer|carry|held|dance[123])$/.test(p.p) ? p.p : 'idle',
    look: lk,
    lvl: Math.floor(num(p.lvl, 1, 999)),
    wallet: boundWallet(p.id, p.w) ?? prev?.wallet ?? null,
    spectator: p.sp === 1,
    trail: typeof p.tr === 'string' && KEY.test(p.tr) ? p.tr : prev?.trail ?? 'plain',
    fx: prev?.fx ?? null,
    v: typeof p.v === 'number' ? Math.floor(p.v) : prev?.v ?? 1,
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
    payload: { ...move, v: 2, h: lk.hat, c: lk.fit, k: lk.pick, hd: lk.handle, pt: lk.pet, g: lk.glow, sx: lk.sex === 'f' ? 'f' : 'm', lvl: level(), tr: s.loadout.trail, ...(w ? { w } : {}) },
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
  send('m', { h: useArena.getState().me, n: m.n, mode: m.mode, ph: m.phase, left: Math.max(0, m.endsAt - Date.now()), fi: m.fighters, out: m.out, sc: m.score, win: m.winner, wn: m.winnerName, boss: m.boss ? { x: Math.round(m.boss.x), y: Math.round(m.boss.y), hp: m.boss.hp, max: m.boss.max, a: m.boss.atk ?? '', aa: m.boss.atk ? Date.now() - m.boss.atkAt : -1, hd: m.boss.hitDone ? 1 : 0, f: m.boss.facing } : null, mb: m.mobs.map((x) => [x.i, Math.round(x.x), x.hp, x.f, Date.now() - x.atkAt < 400 ? 1 : 0, x.max]), wv: m.wave ? [m.wave.n, m.wave.toSpawn, Math.max(0, m.wave.startAt - Date.now())] : null });
}
function setMatch(m: Partial<Match>, tell = true) {
  useArena.setState((s) => ({ match: { ...s.match, ...m } }));
  if (tell) broadcastMatch();
}

/** Start a phase. Only the host calls this. */
function startPhase(phase: Phase, mode: Mode, now: number) {
  const s = useArena.getState();
  if (phase === 'count') {
    const fighters = mode === 'waves' ? presentIds().slice(0, WAVE_SQUAD) : presentIds();
    const hp = BOSS_BASE_HP + BOSS_HP_PER * Math.max(0, fighters.length - 1);
    const boss: Boss | null = mode === 'boss' ? { x: Math.round(AW * 0.72), y: GROUND, hp, max: hp, atk: null, atkAt: 0, hitDone: false, lastAtk: now, hitAt: 0, facing: -1 } : null;
    setMatch({ host: s.me, n: s.match.n + 1, mode, phase, endsAt: now + COUNT_MS, fighters, out: [], score: {}, winner: null, winnerName: null, boss, mobs: [], wave: null });
  } else if (phase === 'fight') setMatch({ phase, endsAt: now + FIGHT_MS[mode], wave: mode === 'waves' ? { n: 1, toSpawn: waveSize(1), startAt: now + 1500 } : null });
  else if (phase === 'end') setMatch({ phase, endsAt: now + END_MS });
  else setMatch({ phase: 'wait', endsAt: 0, fighters: [], out: [], score: {}, boss: null, mobs: [], wave: null, winner: null, winnerName: null });
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
    // Crawler Waves only when every miner here has an app that knows it
    if (mode === 'waves' && present.some((id) => id !== s.me && (s.peers[id]?.v ?? 1) < 2)) mode = nextMode(mode);
    // alone: the co-op modes, in turn
    if (present.length < 2) mode = m.mode === 'boss' && m.n ? 'waves' : 'boss';
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
        return onThrone(p[0], p[1]) && !(f && f.koAt);
      });
      if (inRing.length === 1) {
        const id = inRing[0];
        const sc = { ...m.score, [id]: Math.round(((m.score[id] ?? 0) + 0.25) * 100) / 100 };
        setMatch({ score: sc }, now - lastBroadcast > 900);
        if (sc[id] >= KOTH_WIN) return finish(id, now);
      }
    } else if (m.mode === 'boss' && m.boss) {
      // whoever went to the balcony (no one got them up in time) is out of this raid
      const gone = alive.filter((id) => (id === s.me ? s.spectator : s.peers[id]?.spectator));
      if (gone.length) setMatch({ out: [...new Set([...m.out, ...gone])] });
      bossThink(m.boss, alive.filter((id) => !gone.includes(id)), now);
      if (m.boss.hp <= 0) return finish('boss-down', now);
      if (!alive.filter((id) => !gone.includes(id)).length) return finish(null, now);
    }
    if (m.mode === 'waves') {
      const gone = alive.filter((id) => (id === s.me ? s.spectator : s.peers[id]?.spectator));
      if (gone.length) setMatch({ out: [...new Set([...m.out, ...gone])] });
      if (!alive.filter((id) => !gone.includes(id)).length) return finish(null, now);
      const w = m.wave;
      // a wave is done when none are left to come out and none are standing: the next one, or the win
      if (w && now >= w.startAt && w.toSpawn <= 0 && !m.mobs.length) {
        if (w.n >= WAVES) return finish('waves-won', now);
        setMatch({ wave: { n: w.n + 1, toSpawn: waveSize(w.n + 1), startAt: now + WAVE_REST_MS } });
      }
    }
    mobsThink(alive.filter((id) => !(id === s.me ? s.spectator : s.peers[id]?.spectator)), now);
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
  setMatch({ winner, winnerName: winner === 'boss-down' || winner === 'waves-won' ? 'THE MINERS' : winner ? nameOf(winner) : null, phase: 'end', endsAt: now + END_MS, boss: m.boss ? { ...m.boss, hp: Math.max(0, m.boss.hp) } : null, mobs: [] });
  const done = useArena.getState().match;
  hostResultListeners.forEach((f) => f(done));
  applyResult(done);
}
/** The host hears every result first (it reports wins to the ranks). */
export const hostResultListeners = new Set<(m: Match) => void>();

/* ---------------- pickups ---------------- */
const randomFloorSpot = (): [number, number] => surfaceSpot(Math.random);
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
  if (!p || typeof p.id !== 'string' || typeof p.p !== 'string' || !/^(dash|slam|guard|splash|spin|mend)$/.test(p.p)) return;
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

/* ---------------- emotes ---------------- */
let lastEmote = 0;
/** Show an emote over your miner (everyone sees it for a moment). */
export function emote(e: Emote) {
  const now = Date.now();
  if (!EMOTES.includes(e) || now - lastEmote < 700) return false;
  lastEmote = now;
  const me = useArena.getState().me;
  useArena.setState((s) => ({ emoteOpen: false, emotes: [...s.emotes.filter((x) => now - x.at < EMOTE_MS && x.id !== me), { id: me, e, at: now }].slice(-30) }));
  send('emo', { id: me, e });
  return true;
}
export const setEmoteOpen = (open: boolean) => useArena.setState({ emoteOpen: open });
const emoteFrom = new Map<string, number>();
function onEmote(p: any) {
  if (!p || typeof p.id !== 'string' || p.id.length > 16 || !EMOTES.includes(p.e)) return;
  const now = Date.now();
  if (now - (emoteFrom.get(p.id) ?? 0) < 500) return;
  emoteFrom.set(p.id, now);
  if (emoteFrom.size > 100) emoteFrom.clear();
  useArena.setState((s) => ({ emotes: [...s.emotes.filter((x) => now - x.at < EMOTE_MS && x.id !== p.id), { id: p.id, e: p.e, at: now }].slice(-30) }));
}

/* ---------------- grab and throw ---------------- */
/**
 * A dizzy miner (low HP, stars over the head) can be grabbed by someone right next to them, carried for
 * a moment and thrown. The one grabbed is the judge, as with every hit: their app checks the grab was
 * fair (close, really dizzy, not shielded) and says yes or no, and applies the throw's damage itself.
 * Not in a Boss Raid, where everyone is on the same side.
 */
const pvp = () => {
  const m = useArena.getState().match;
  return m.phase === 'fight' && !coop(m.mode);
};
/** The nearest dizzy foe you could grab right now, if any (for the GRAB button). */
export function grabbable(): string | null {
  const s = useArena.getState();
  const b = useBrawl.getState();
  if (!pvp() || s.spectator || !s.match.fighters.includes(s.me) || s.holding || s.heldBy || b.me.koAt) return null;
  const now = Date.now();
  let best: string | null = null;
  let bd = Infinity;
  for (const p of Object.values(s.peers)) {
    const f = b.peers[p.id];
    if (p.spectator || !f || !f.on || f.koAt || f.hp > DIZZY_HP || now < f.shieldUntil || now - p.seen > 4000) continue;
    if (!inGrabReach(myPos[0], myPos[1], p.x, p.y)) continue;
    const d = Math.abs(p.x - myPos[0]);
    if (d < bd) {
      bd = d;
      best = p.id;
    }
  }
  return best;
}
/** You reach for `target`. They decide if it counts; until then you are only reaching. */
export function tryGrab(target: string) {
  const s = useArena.getState();
  const now = Date.now();
  if (!pvp() || s.holding || s.heldBy || useBrawl.getState().me.koAt) return false;
  useArena.setState({ holding: { id: target, at: now, ok: false } });
  send('gb', { a: s.me, t: target, x: Math.round(myPos[0]), y: Math.round(myPos[1]) });
  // no answer (they left, or run an older app): let go
  setTimeout(() => {
    const h = useArena.getState().holding;
    if (h && h.id === target && h.at === now && !h.ok) useArena.setState({ holding: null });
  }, 700);
  return true;
}
const grabbedFrom = new Map<string, number>();
/** Someone grabbed at us: fair? */
function onGrabbed(p: any) {
  const s = useArena.getState();
  if (!p || p.t !== s.me || typeof p.a !== 'string' || p.a.length > 16) return;
  const now = Date.now();
  const me = useBrawl.getState().me;
  const peer = s.peers[p.a];
  const answer = (ok: boolean) => send('gok', { t: s.me, a: p.a, ok: ok ? 1 : 0 });
  const recent = now - (grabbedFrom.get(p.a) ?? 0) < 2500;
  const thrownLately = s.thrown && now - s.thrown.at < 1800;
  const claim: [number, number] = [num(p.x, 0, AW), num(p.y, 0, AH)];
  // where they say they are must be close to where we see them, and both close to us
  const near = peer && Math.hypot(claim[0] - peer.x, claim[1] - peer.y) < 40 && inGrabReach(myPos[0], myPos[1], claim[0], claim[1]) && Math.abs(peer.x - myPos[0]) <= GRAB_X + 24 && Math.abs(peer.y - myPos[1]) <= GRAB_Y + 16;
  const ok = pvp() && !s.spectator && s.match.fighters.includes(s.me) && !s.heldBy && !s.holding && !me.koAt && me.hp <= DIZZY_HP && now >= me.shieldUntil && !recent && !thrownLately && Boolean(near) && !peer?.spectator;
  if (!ok) return answer(false);
  grabbedFrom.set(p.a, now);
  if (grabbedFrom.size > 100) grabbedFrom.clear();
  useArena.setState({ heldBy: { id: p.a, at: now } });
  answer(true);
  // if the throw never comes, you slip free
  setTimeout(() => {
    const h = useArena.getState().heldBy;
    if (h && h.id === p.a && h.at === now) useArena.setState({ heldBy: null });
  }, HOLD_MS + 900);
}
function onGrabAnswer(p: any) {
  const s = useArena.getState();
  if (!p || p.a !== s.me || !s.holding || s.holding.id !== p.t) return;
  if (p.ok === 1) useArena.setState({ holding: { ...s.holding, ok: true, at: Date.now() } });
  else useArena.setState({ holding: null });
}
/** Throw whoever you carry, the way you face. */
export function throwHeld(d: 1 | -1) {
  const s = useArena.getState();
  const h = s.holding;
  if (!h) return false;
  useArena.setState({ holding: null });
  if (!h.ok) return false;
  markHit(h.id);
  send('gth', { a: s.me, t: h.id, d, x: Math.round(myPos[0]), y: Math.round(myPos[1]) });
  return true;
}
function onThrown(p: any) {
  const s = useArena.getState();
  if (!p || p.t !== s.me || !s.heldBy || s.heldBy.id !== p.a) return;
  const d: 1 | -1 = p.d === -1 ? -1 : 1;
  const now = Date.now();
  useArena.setState({ heldBy: null, thrown: { at: now, d } });
  // the hit comes from just behind you, so the knock carries you the way you were thrown
  takeThrow('arena', THROW_DMG, [myPos[0] - d * 10, myPos[1]], p.a);
}
/** You were hit or knocked down while carrying someone: they drop. */
function dropWhatYouHold() {
  const h = useArena.getState().holding;
  if (h) useArena.setState({ holding: null });
}
useBrawl.subscribe((b, prev) => {
  if (b.me.hitAt !== prev.me.hitAt && useArena.getState().holding) dropWhatYouHold();
});

/* ---------------- Boss Raid: down, and back up ---------------- */
/** In a raid with friends a knockdown keeps you down until someone gets you up (or time runs out). */
export function downMode(): boolean {
  const m = useArena.getState().match;
  return coop(m.mode) && m.phase === 'fight' && m.fighters.length >= 2;
}
function goDown() {
  const at = Date.now();
  useArena.setState({ downAt: at });
  setTimeout(() => {
    const s = useArena.getState();
    if (s.downAt !== at) return;
    // nobody came: to the balcony for the rest of this raid
    useArena.setState({ downAt: 0, spectator: true });
    reviveMe(MAX_HP, 0);
  }, DOWN_MS);
}
/** You stand over a downed teammate (on), stepped away (off), or held on long enough (done). */
export function shareRevive(target: string, state: 'on' | 'off' | 'done') {
  const s = useArena.getState();
  const now = Date.now();
  if (state === 'on') useArena.setState({ revives: [...s.revives.filter((r) => r.id !== s.me && now - r.at < REVIVE_MS + 4000), { id: s.me, t: target, at: now }] });
  else useArena.setState({ revives: s.revives.filter((r) => r.id !== s.me) });
  if (state === 'done') send('rvd', { id: s.me, t: target, x: Math.round(myPos[0]), y: Math.round(myPos[1]) });
  else send('rv', { id: s.me, t: target, on: state === 'on' ? 1 : 0 });
}
function onReviving(p: any) {
  if (!p || typeof p.id !== 'string' || typeof p.t !== 'string' || p.id.length > 16 || p.t.length > 16) return;
  const now = Date.now();
  useArena.setState((s) => ({ revives: [...s.revives.filter((r) => r.id !== p.id && now - r.at < REVIVE_MS + 4000), ...(p.on === 1 ? [{ id: p.id, t: p.t, at: now }] : [])].slice(-20) }));
}
/** A teammate says they got us up. We check they were really there, long enough. */
function onRevived(p: any) {
  const s = useArena.getState();
  if (!p || typeof p.id !== 'string') return;
  const started = s.revives.find((r) => r.id === p.id && r.t === p.t);
  useArena.setState({ revives: s.revives.filter((r) => r.id !== p.id) });
  if (p.t !== s.me || !s.downAt || !downMode()) return;
  const peer = s.peers[p.id];
  const now = Date.now();
  if (!peer || peer.spectator || !s.match.fighters.includes(p.id) || s.match.out.includes(p.id)) return;
  // they started standing over us a while ago (we heard it), and are still close
  if (!started || now - started.at < REVIVE_MS - 400) return;
  if (!inReviveReach(peer.x, peer.y, myPos[0], myPos[1]) && !inReviveReach(num(p.x, 0, AW), num(p.y, 0, AH), myPos[0], myPos[1])) return;
  useArena.setState({ downAt: 0 });
  reviveMe(REVIVE_HP);
  reviveListeners.forEach((f) => f(p.id));
}
/** You were got up (by this id), for the screen to say thanks. */
export const reviveListeners = new Set<(by: string) => void>();

/* ---------------- the boss ---------------- */
/**
 * The Two-Mouthed, run by the host. It walks the floor toward the nearest miner and, when its last
 * attack has cooled, winds one up (everyone sees the warning), then lands it:
 *
 *   sweep   the held leg swings low across the floor in front and behind: jump it or stand on a ledge
 *   tongue  the belly mouth lashes its tongue far ahead at floor and low-ledge height
 *   roar    the face mouth roars: everyone close is hit and knocked back, ledges included
 *
 * Below half HP (phase two) it walks faster and winds up quicker. Whoever is mid-air when it lands
 * dodges it on their own side (brawl.ts: a jump makes you safe for a moment).
 */
function bossThink(b: Boss, alive: string[], now: number) {
  const s = useArena.getState();
  const pos = (id: string): [number, number] => (id === s.me ? myPos : [s.peers[id]?.x ?? AW / 2, s.peers[id]?.y ?? GROUND]);
  const targets = alive.filter((id) => !(id === s.me ? useBrawl.getState().me.koAt : useBrawl.getState().peers[id]?.koAt));
  const p2 = bossPhase2(b);
  let { x, facing, atk, atkAt, hitDone, lastAtk } = b;
  let loud = false;
  if (atk) {
    const wind = p2 ? BOSS_WIND2_MS : BOSS_WIND_MS;
    if (!hitDone && now - atkAt >= wind) {
      hitDone = true;
      loud = true;
      for (const id of targets) {
        const [px, py] = pos(id);
        // the hit is claimed where the victim stands: the boss's reach is long, the host has judged it
        if (bossCatches(atk, x, facing, px, py)) bossHit('arena', id, px, py - 10, s.me);
      }
    } else if (now - atkAt >= wind + BOSS_ACT_MS) {
      atk = null;
      lastAtk = now;
      loud = true;
    }
  } else if (targets.length) {
    // the nearest miner along the floor; ones on the floor first, they are easier to reach
    const near = targets
      .map((id) => ({ id, p: pos(id) }))
      .sort((m, n) => Math.abs(m.p[0] - x) + (m.p[1] < GROUND - 3 ? 60 : 0) - (Math.abs(n.p[0] - x) + (n.p[1] < GROUND - 3 ? 60 : 0)))[0];
    const dx = near.p[0] - x;
    const want: 1 | -1 = dx >= 0 ? 1 : -1;
    if (want !== facing && Math.abs(dx) > 6) {
      facing = want;
      loud = true;
    }
    if (Math.abs(dx) > 22) x = Math.max(WALL_L + 30, Math.min(WALL_R - 30, x + Math.sign(dx) * (p2 ? BOSS_SPEED2 : BOSS_SPEED) * 0.25));
    if (now - lastAtk > (p2 ? BOSS_COOL2_MS : BOSS_COOL_MS)) {
      const close = targets.filter((id) => Math.abs(pos(id)[0] - x) <= ROAR_REACH - 10).length;
      const r = Math.random();
      let pick: BossAtk | null = null;
      if ((close >= 2 && r < 0.45) || (close >= 1 && r < 0.18)) pick = 'roar';
      else if (Math.abs(dx) <= SWEEP_REACH - 8 && near.p[1] >= GROUND - 3) pick = r < 0.75 ? 'sweep' : 'tongue';
      else if (Math.abs(dx) <= TONGUE_REACH - 12) pick = 'tongue';
      if (pick) {
        atk = pick;
        atkAt = now;
        hitDone = false;
        loud = true;
      }
    }
  }
  setMatch({ boss: { ...b, x, facing, atk, atkAt, hitDone, lastAtk } }, loud || now - lastBroadcast > 400);
}
/** A player hit the boss. The host checks it and keeps the boss's HP. */
const bossHitsFrom = new Map<string, number>();
function onBossHit(p: any) {
  if (p && p.k === 'h' && typeof p.t === 'string' && /^m\d{1,7}$/.test(p.t) && isHost()) return onMobHit(p);
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

/* ---------------- crawlers ---------------- */
let mobSeq = 1;
let mobsOn = true;
let lastMobAt = 0;
let lastMobSend = 0;
/** The host moves the crawlers, lets them bite, and sends a new one out of a wall now and then. */
function mobsThink(alive: string[], now: number) {
  const s = useArena.getState();
  const m = s.match;
  const pos = (id: string): [number, number] => (id === s.me ? myPos : [s.peers[id]?.x ?? -999, s.peers[id]?.y ?? -999]);
  const targets = alive.filter((id) => !(id === s.me ? useBrawl.getState().me.koAt : useBrawl.getState().peers[id]?.koAt));
  let mobs = m.mobs.map((x) => ({ ...x }));
  let loud = false;
  const w = m.mode === 'waves' ? m.wave : null;
  const canSpawn = m.mode === 'waves' ? Boolean(w && now >= w.startAt && w.toSpawn > 0) : true;
  if (mobsOn && canSpawn && now - lastMobAt > MOB_EVERY[m.mode] && mobs.length < MOB_MAX[m.mode] && targets.length) {
    lastMobAt = now;
    const left = mobSeq % 2 === 0;
    const hp = w ? waveHp(w.n) : MOB_HP;
    mobs.push({ i: mobSeq++, x: left ? WALL_L + 8 : WALL_R - 8, hp, max: hp, f: left ? 1 : -1, atkAt: 0, hitAt: 0 });
    if (w) useArena.setState((st) => ({ match: { ...st.match, wave: st.match.wave ? { ...st.match.wave, toSpawn: st.match.wave.toSpawn - 1 } : null } }));
    loud = true;
  }
  for (const mob of mobs) {
    // the nearest miner, ones on the floor first (crawlers can't climb)
    const near = targets
      .map((id) => ({ id, p: pos(id) }))
      .sort((a, b) => Math.abs(a.p[0] - mob.x) + (a.p[1] < GROUND - 12 ? 200 : 0) - (Math.abs(b.p[0] - mob.x) + (b.p[1] < GROUND - 12 ? 200 : 0)))[0];
    if (!near) continue;
    const dx = near.p[0] - mob.x;
    if (Math.abs(dx) > 3) mob.f = dx > 0 ? 1 : -1;
    if (Math.abs(dx) > MOB_REACH - 4) mob.x = Math.max(WALL_L + 6, Math.min(WALL_R - 6, mob.x + Math.sign(dx) * MOB_SPEED * 0.25));
    if (Math.abs(dx) <= MOB_REACH && near.p[1] >= GROUND - 14 && now - mob.atkAt > MOB_BITE_MS) {
      mob.atkAt = now;
      loud = true;
      bossHit('arena', near.id, near.p[0], near.p[1] - 6, s.me, 'mob');
    }
  }
  mobs = mobs.filter((x) => x.hp > 0);
  useArena.setState((st) => ({ match: { ...st.match, mobs } }));
  if (mobs.length && (loud || now - lastMobSend > 300)) {
    lastMobSend = now;
    broadcastMatch();
  }
}
function parseMobs(v: unknown): Mob[] {
  if (!Array.isArray(v)) return [];
  const old = new Map(useArena.getState().match.mobs.map((x) => [x.i, x]));
  const now = Date.now();
  return v
    .slice(0, 8)
    .filter((x): x is number[] => Array.isArray(x) && x.length >= 4 && x.every((n) => typeof n === 'number' && Number.isFinite(n)))
    .map(([i, x, hp, f, bit, mx]) => {
      const was = old.get(Math.floor(i));
      const h = Math.max(0, Math.min(999, hp));
      return { i: Math.floor(i), x: num(x, 0, AW), hp: h, max: Number.isFinite(mx) ? num(mx, 1, 999) : MOB_HP, f: f === -1 ? -1 : 1, atkAt: bit ? (was && now - was.atkAt < 600 ? was.atkAt : now) : was?.atkAt ?? 0, hitAt: was && h < was.hp ? now : was?.hitAt ?? 0 } as Mob;
    });
}
/** A miner hit a crawler. The host checks it was close enough and takes the HP off. */
const mobHitsFrom = new Map<string, number>();
function onMobHit(p: any) {
  const s = useArena.getState();
  if (s.match.phase !== 'fight' || typeof p.a !== 'string') return;
  const peer = s.peers[p.a];
  const i = Number(String(p.t).slice(1));
  const mob = s.match.mobs.find((x) => x.i === i);
  if (!peer || !mob || Math.abs(peer.x - mob.x) > 170) return;
  const w = ['swing', 'dash', 'slam', 'ore', 'splash', 'pet', 'spin'].includes(p.w) ? p.w : 'swing';
  const now = Date.now();
  const key = `${p.a}:${w}:${i}`;
  if (now - (mobHitsFrom.get(key) ?? 0) < 300) return;
  mobHitsFrom.set(key, now);
  if (mobHitsFrom.size > 300) mobHitsFrom.clear();
  hurtMob(i, baseDamage(w, p.a, Math.floor(Number(p.s) || 0), peer.lvl, true), p.a, now);
}
/** The host's own hits on a crawler, and everyone's once checked. The killing blow earns the XP. */
export function hurtMob(i: number, dmg: number, by: string, now = Date.now()) {
  const s = useArena.getState();
  const mob = s.match.mobs.find((x) => x.i === i);
  if (!mob || mob.hp <= 0) return;
  const hp = Math.max(0, mob.hp - dmg);
  const mobs = hp > 0 ? s.match.mobs.map((x) => (x.i === i ? { ...x, hp, hitAt: now } : x)) : s.match.mobs.filter((x) => x.i !== i);
  useArena.setState({ match: { ...s.match, mobs } });
  if (hp <= 0) {
    send('mk', { h: s.me, i, by, x: Math.round(mob.x) });
    onMobKilled({ h: s.me, i, by, x: mob.x });
  }
  broadcastMatch();
}
function onMobKilled(p: any) {
  if (!p || p.h !== hostId() || !Number.isFinite(p.i)) return;
  const me = useArena.getState().me;
  useArena.setState((st) => ({ match: { ...st.match, mobs: st.match.mobs.filter((x) => x.i !== p.i) } }));
  mobKillListeners.forEach((f) => f(num(p.x, 0, AW), p.by === me));
  if (p.by === me) awardFightXp(MOB_XP);
}
/** Someone killed a crawler at x (mine: we did). The canvas puffs it away. */
export const mobKillListeners = new Set<(x: number, mine: boolean) => void>();

/* ---------------- what everyone does with the host's word ---------------- */
let appliedN = -1;
let resultN = -1;
function onMatch(p: any) {
  if (!p || typeof p.h !== 'string' || p.h !== hostId() || !MODES.includes(p.mode)) return;
  const now = Date.now();
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length <= 16).slice(0, 40) : []);
  const score: Record<string, number> = {};
  if (p.sc && typeof p.sc === 'object') for (const [k, v] of Object.entries(p.sc)) if (k.length <= 16 && typeof v === 'number') score[k] = Math.max(0, Math.min(999, v));
  const atk: BossAtk | null = p.boss && ['sweep', 'tongue', 'roar'].includes(p.boss.a) ? p.boss.a : null;
  const boss: Boss | null =
    p.boss && typeof p.boss === 'object'
      ? { x: num(p.boss.x, 0, AW), y: num(p.boss.y, 0, AH), hp: num(p.boss.hp, 0, 99999), max: num(p.boss.max, 1, 99999), atk, atkAt: atk ? now - num(p.boss.aa, 0, 60000) : 0, hitDone: p.boss.hd === 1, lastAtk: 0, hitAt: useArena.getState().match.boss?.hitAt ?? 0, facing: p.boss.f === -1 ? -1 : 1 }
      : null;
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
    mobs: parseMobs(p.mb),
    wave: Array.isArray(p.wv) && p.wv.length >= 3 ? { n: Math.floor(num(p.wv[0], 1, WAVES)), toSpawn: Math.floor(num(p.wv[1], 0, 99)), startAt: now + num(p.wv[2], 0, 60_000) } : null,
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
    useArena.setState({ spectator: i < 0, ammo: 0, readyAt: {}, holding: null, heldBy: null, downAt: 0, revives: [] });
    resetMe(COUNT_MS + 600);
    matchListeners.forEach((f) => f(m));
  }
  if (m.phase === 'end') applyResult(m);
  // the raid is over while you lie there: up you get
  if (m.phase !== 'fight' && s.downAt) {
    useArena.setState({ downAt: 0 });
    reviveMe(MAX_HP);
  }
}
export const matchListeners = new Set<(m: Match) => void>();

function applyResult(m: Match) {
  if (resultN === m.n) return;
  resultN = m.n;
  const s = useArena.getState();
  const fought = m.fighters.includes(s.me);
  if (!fought) return;
  if (m.mode === 'boss' && m.winner === 'boss-down') awardFightXp(BOSS_XP);
  else if (m.mode === 'waves' && m.winner === 'waves-won') awardFightXp(WAVES_XP);
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
  if (downMode()) goDown();
  dropWhatYouHold();
})(brawlHooks.kodBy);
brawlHooks.holdKo = (scope) => scope === 'arena' && useArena.getState().open && downMode();
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
export const _arenaTest = { hostTick, onMatch, onState, onGrab, onTook, onPickups, onEmote, onGrabbed, onGrabAnswer, onThrown, onRevived, finish: (w: string | null) => finish(w, Date.now()), setMyPos: (x: number, y: number) => (myPos = [x, y]), mobs: (on: boolean) => (mobsOn = on), mobsThink };
