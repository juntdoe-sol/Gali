/**
 * Brawl, step 1: simple fights in the lobby and on the island.
 *
 * Every miner with Brawl on has an HP bar. A pickaxe swing that lands takes 10 to 15 HP. At 0 HP the
 * miner is knocked down for a few seconds (a knockdown dance), then stands up again with full HP and a
 * short shield. Nothing real is lost: no ORE, no SOL, no gear. A KO gives the winner XP, within anti-farm
 * rules. Brawl is on by default and can be switched off in the profile page.
 *
 * Trust: there is no game server, so each player is the judge of their own HP. An attacker says "I hit X";
 * every client draws the hit (damage is worked out from the attacker's id and swing number, so all agree),
 * and X checks it (range, rate, safe states) before taking damage and telling everyone its real HP. A player
 * can only ever cheat their own HP, and XP for a KO only counts if you really landed a hit on that player.
 *
 * Messages ride the room you are in (game/rx.ts): 'bx' broadcasts for hits and HP, and a 'bw' field on the
 * normal position updates so late joiners learn everyone's state.
 */
import { create } from 'zustand';
import { announce, sendLobbyBx, useLobby } from './lobby';
import { baseDamage, GAP, GUARD_MS, GUARD_STING, REACH as W_REACH, swingDmg, taken, type Weapon } from './powers';
import { roomHooks, type Scope } from './rx';
import { loadJson, saveJson } from './storage';
import { sendWorldBx, useWorld } from './world';
export type { Scope } from './rx';

export const MAX_HP = 100;
/** a knockdown lasts this long, then you stand up again */
export const KO_MS = 3000;
/** after standing up (or arriving), nobody can hit you for this long; swinging ends it early */
export const SHIELD_MS = 3000;
/** time between swings */
export const SWING_MS = 450;
/** a jump lasts this long, and a hit that lands mid-air misses */
export const JUMP_MS = 460;
const JUMP_GAP = 600;
/** how far a swing reaches, map px between feet */
export const REACH = 22;
/** HP comes back after this long without a hit, at REGEN_HP every REGEN_TICK */
export const REGEN_AFTER = 6000;
const REGEN_TICK = 500;
const REGEN_HP = 5;
/** XP for a KO in the lobby or on the island (the arena will pay more) */
export const KO_XP = 20;
/** no XP for knocking out the same player again within this time */
export const SAME_FOE_MS = 10 * 60_000;
/** most fight XP a day (lobby, island and arena together) */
export const DAY_CAP = 300;
/** XP only counts if you landed a hit on them this recently */
const KO_CREDIT_MS = 6000;
/** slack on the victim's side for network delay */
const RANGE_SLACK = 26;
const CLAIM_SLACK = 64;
const HP_SEND_MS = 700;

/** Damage of an attacker's n-th swing: the same on every client, and not up to the attacker. */
export const dmgOf = swingDmg;
const WEAPONS: Weapon[] = ['swing', 'dash', 'slam', 'ore', 'splash', 'pet', 'boss', 'mob', 'sting', 'spin'];

export interface Fighter {
  hp: number;
  /** wall ms the knockdown started, 0 when standing */
  koAt: number;
  /** wall ms the shield ends */
  shieldUntil: number;
  /** Brawl switched on (and not busy deploying) */
  on: boolean;
  /** wall ms of the last hit taken, and of the last swing */
  hitAt: number;
  swingAt: number;
}
export interface MeFighter extends Fighter {
  /** counts stand-ups, so the canvas knows to put the miner back at the spawn */
  respawn: number;
  /** where the last hit came from (map px), for the knockback */
  hitFrom: [number, number];
}

const fresh = (now: number): Fighter => ({ hp: MAX_HP, koAt: 0, shieldUntil: 0, on: true, hitAt: 0, swingAt: 0 });

interface BrawlState {
  /** the player switched Brawl off */
  off: boolean;
  scope: Scope;
  me: MeFighter;
  peers: Record<string, Fighter>;
  /** when each player last jumped (wall ms), and when we did */
  jumps: Record<string, number>;
  myJumpAt: number;
  /** arena: blocking with Pickaxe Guard until then, and the passive you picked */
  guardUntil: number;
  passive: 'skin' | 'pet' | null;
  setOff: (off: boolean) => void;
}

export const useBrawl = create<BrawlState>((set) => ({
  off: false,
  scope: 'lobby',
  me: { ...fresh(0), respawn: 0, hitFrom: [0, 0] },
  peers: {},
  jumps: {},
  myJumpAt: 0,
  guardUntil: 0,
  passive: null,
  setOff: (off) => {
    set({ off });
    saveRecord({ ...rec, off });
    sendHp(true);
  },
}));

/* ---------------- anti-farm records (kept on this device) ---------------- */
interface Rec {
  off: boolean;
  day: string;
  dayXp: number;
  /** foe key -> wall ms of our last XP-paying KO on them */
  foes: Record<string, number>;
}
const REC_KEY = 'gali-brawl-v1';
let rec: Rec = { off: false, day: '', dayXp: 0, foes: {} };
const saveRecord = (r: Rec) => {
  rec = r;
  saveJson(REC_KEY, r, 300);
};
const dayOf = (now: number) => new Date(now).toISOString().slice(0, 10);

/**
 * XP for knocking out a foe. 20 at an even level, more for a stronger foe and less for a weaker one,
 * nothing for the same foe again within 10 minutes, and no more than 200 a day.
 */
export function koXp(r: Rec, o: { now: number; foeKeys: string[]; myLvl: number; foeLvl: number; base?: number }): { xp: number; rec: Rec } {
  const day = dayOf(o.now);
  const dayXp = r.day === day ? r.dayXp : 0;
  const foes = Object.fromEntries(Object.entries(r.foes).filter(([, at]) => o.now - at < SAME_FOE_MS));
  if (o.foeKeys.some((k) => foes[k] !== undefined)) return { xp: 0, rec: { ...r, day, dayXp, foes } };
  const scale = Math.max(0.25, Math.min(1.5, 1 + 0.08 * (o.foeLvl - o.myLvl)));
  const xp = Math.max(0, Math.min(DAY_CAP - dayXp, Math.round((o.base ?? KO_XP) * scale)));
  for (const k of o.foeKeys) foes[k] = o.now;
  return { xp, rec: { ...r, day, dayXp: dayXp + xp, foes } };
}

import { THROW_RANGE } from './arenaMap';
export { THROW_RANGE };
/**
 * Is a hit claim believable from where the victim stands? `claim` is where the hit came from: the attacker
 * for a melee hit, the shard for a thrown one. The weapon sets the reach and the least gap between hits.
 */
export function hitOk(o: { claim: [number, number]; seen: [number, number] | null; me: [number, number]; lastFrom: number; now: number; w?: Weapon }): boolean {
  const w = o.w ?? 'swing';
  if (o.now - o.lastFrom < GAP[w] - 80) return false;
  if (!o.seen) return false;
  const thrown = w === 'ore' || w === 'splash';
  // a melee hit comes from where the attacker stands; a thrown shard from within throwing range of them
  const slack = thrown ? THROW_RANGE + CLAIM_SLACK : CLAIM_SLACK;
  if (Math.hypot(o.claim[0] - o.seen[0], o.claim[1] - o.seen[1]) > slack) return false;
  return Math.hypot(o.claim[0] - o.me[0], o.claim[1] - o.me[1]) <= W_REACH[w] + RANGE_SLACK;
}

/* ---------------- wiring ---------------- */
let busy: () => boolean = () => false;
let myLevel: () => number = () => 1;
let canFight: (scope: Scope) => boolean = () => true;
let gainXp: (n: number) => void = () => undefined;
const myPos: Record<Scope, [number, number]> = { lobby: [0, 0], island: [0, 0], arena: [0, 0] };
let seq = 0;

/**
 * A room Brawl can run in. The lobby and the island are built in; the arena registers itself
 * (game/arena.ts), with its own rules for powers, XP and the host's boss.
 */
export interface Room {
  me: () => string;
  send: (p: Record<string, unknown>) => boolean;
  peer: (id: string) => { pos: [number, number]; lvl: number; name: string } | null;
  /** powers and the level bonus count here */
  arena?: boolean;
  /** XP for a KO here */
  koXp?: number;
  /** who may send the boss's hits (the arena's host) */
  host?: () => string | null;
  /** miners are on one side here right now (a raid): hits between them do nothing */
  coop?: () => boolean;
}
const rooms: Partial<Record<Scope, Room>> = {};
export function registerRoom(scope: Scope, r: Room) {
  rooms[scope] = r;
}
/** Things the arena and the ranks want to hear about. */
export const brawlHooks: {
  /** we knocked out `foeId` (after the anti-farm check; xp may be 0) */
  koed?: (scope: Scope, foeId: string, foeName: string | null, xp: number) => void;
  /** we were knocked out by `by` */
  kodBy?: (scope: Scope, by: string, byName: string | null) => void;
  /** a knockdown here lasts until a teammate revives you (the arena's Boss Raid): don't stand up on a timer */
  holdKo?: (scope: Scope) => boolean;
} = {};
/** how long a held knockdown can last before the room gives up on hearing its end (ms) */
export const HELD_KO_MS = 12_000;
/** when we last landed a hit on each foe (for KO credit) */
const myHits = new Map<string, number>();
/** when each attacker last hit us (rate check) */
const hitsFrom = new Map<string, number>();
let lastHpSent = 0;
let hpTimer: ReturnType<typeof setTimeout> | null = null;
let tick: ReturnType<typeof setInterval> | null = null;

registerRoom('lobby', {
  me: () => useLobby.getState().me,
  send: sendLobbyBx,
  peer: (id) => {
    const p = useLobby.getState().peers[id];
    return p ? { pos: [p.x, p.y], lvl: p.lvl, name: p.name } : null;
  },
});
registerRoom('island', {
  me: () => useWorld.getState().me,
  send: sendWorldBx,
  peer: (id) => {
    const p = useWorld.getState().peers[id];
    return p && !p.bot ? { pos: [p.x, p.y], lvl: p.lvl, name: p.name } : null;
  },
});
const meId = (scope: Scope) => rooms[scope]?.me() ?? '';
const send = (scope: Scope, p: Record<string, unknown>) => rooms[scope]?.send(p) ?? false;
const peerInfo = (scope: Scope, id: string) => rooms[scope]?.peer(id) ?? null;

/** Am I a fair target right now? Off, deploying, knocked down or shielded: no. */
function meSafe(now: number) {
  const { off, me, myJumpAt } = useBrawl.getState();
  // mid-air: the swing goes under you
  return off || busy() || me.koAt > 0 || now < me.shieldUntil || now - myJumpAt < JUMP_MS;
}

/** Our state, packed for the wire: [hp, flags] with bit 1 on, 2 knocked down, 4 shielded. */
function packMe(now: number): number[] {
  const { off, me } = useBrawl.getState();
  const on = !off && !busy();
  return [Math.round(me.hp), (on ? 1 : 0) | (me.koAt ? 2 : 0) | (now < me.shieldUntil ? 4 : 0)];
}

function sendHp(now = false, by?: string) {
  const scope = useBrawl.getState().scope;
  const go = () => {
    hpTimer = null;
    lastHpSent = Date.now();
    send(scope, { k: 's', id: meId(scope), b: packMe(Date.now()), ...(by ? { by } : {}) });
  };
  if (now) {
    if (hpTimer) clearTimeout(hpTimer);
    go();
  } else if (!hpTimer) hpTimer = setTimeout(go, Math.max(0, HP_SEND_MS - (Date.now() - lastHpSent)));
}

/** A peer's state from the wire. Unknown players (older builds) never get an HP bar and can't be hit. */
function setPeer(id: string, b: unknown, now: number) {
  if (!Array.isArray(b) || typeof b[0] !== 'number' || typeof b[1] !== 'number') return;
  const hp = Math.max(0, Math.min(MAX_HP, Math.round(b[0])));
  const fl = b[1] | 0;
  useBrawl.setState((s) => {
    const prev = s.peers[id] ?? fresh(now);
    const ko = (fl & 2) !== 0;
    return {
      peers: {
        ...s.peers,
        [id]: { ...prev, hp, on: (fl & 1) !== 0, koAt: ko ? prev.koAt || now : 0, shieldUntil: fl & 4 ? Math.max(prev.shieldUntil, now + 1500) : 0 },
      },
    };
  });
}

function onBx(scope: Scope, p: any) {
  const st = useBrawl.getState();
  if (scope !== st.scope || !p || typeof p !== 'object') return;
  const now = Date.now();
  const me = meId(scope);
  if (p.k === 'h' && typeof p.a === 'string' && typeof p.t === 'string' && p.a.length <= 16 && p.t.length <= 16 && Number.isFinite(p.s) && Number.isFinite(p.x) && Number.isFinite(p.y)) {
    const a: string = p.a;
    const room = rooms[scope];
    const w: Weapon = WEAPONS.includes(p.w) ? p.w : 'swing';
    // powers, thrown ORE and the boss only exist in the arena
    if (w !== 'swing' && !room?.arena) return;
    const boss = a === 'boss';
    // 'boss' is whatever the host runs: the Two-Mouthed and its crawlers
    if (boss && ((w !== 'boss' && w !== 'mob') || !room?.host || typeof p.h !== 'string' || room.host() !== p.h)) return;
    if (!boss && (w === 'boss' || w === 'mob')) return;
    // the attacker swung: draw it
    if (w === 'swing' && st.peers[a]) useBrawl.setState((s) => ({ peers: { ...s.peers, [a]: { ...s.peers[a], swingAt: now } } }));
    const info = boss ? null : peerInfo(scope, a);
    const dmg = baseDamage(w, a, Math.floor(p.s), info?.lvl ?? 1, Boolean(room?.arena));
    if (p.t === me) {
      if (!boss && room?.coop?.()) return;
      if (meSafe(now) || !canFight(scope)) return void sendHp();
      const key = `${a}:${w}`;
      const seen: [number, number] | null = boss ? [p.x, p.y] : info?.pos ?? null;
      if (!hitOk({ claim: [p.x, p.y], seen, me: myPos[scope], lastFrom: hitsFrom.get(key) ?? 0, now, w })) return;
      hitsFrom.set(key, now);
      if (hitsFrom.size > 300) hitsFrom.clear();
      const guarding = Boolean(room?.arena) && now < st.guardUntil;
      const got = taken(dmg, { skin: Boolean(room?.arena) && st.passive === 'skin', guarding });
      const hp = Math.max(0, st.me.hp - got);
      const ko = hp <= 0;
      useBrawl.setState((s) => ({ me: { ...s.me, hp, hitAt: now, hitFrom: [p.x, p.y], koAt: ko ? now : 0 } }));
      // Pickaxe Guard stings whoever hit you
      if (guarding && !boss) {
        seq += 1;
        send(scope, { k: 'h', a: me, t: a, s: seq, x: Math.round(myPos[scope][0]), y: Math.round(myPos[scope][1]), w: 'sting' });
      }
      if (ko) {
        sendHp(true, a);
        brawlHooks.kodBy?.(scope, a, boss ? (w === 'mob' ? 'A crawler' : 'The Two-Mouthed') : info?.name ?? null);
        if (!brawlHooks.holdKo?.(scope)) setTimeout(standUp, KO_MS);
      } else sendHp();
    } else {
      // someone else took a hit: show it now; their own word on their HP follows
      const v = st.peers[p.t];
      if (!v || !v.on || v.koAt || now < v.shieldUntil) return;
      useBrawl.setState((s) => ({ peers: { ...s.peers, [p.t]: { ...v, hp: Math.max(1, v.hp - dmg), hitAt: now } } }));
    }
  } else if (p.k === 'j' && typeof p.id === 'string' && p.id.length <= 16 && p.id !== me) {
    if (now - (st.jumps[p.id] ?? 0) < JUMP_GAP - 150) return;
    const jumps = Object.keys(st.jumps).length > 150 ? {} : { ...st.jumps };
    jumps[p.id] = now;
    useBrawl.setState({ jumps });
  } else if (p.k === 's' && typeof p.id === 'string' && p.id.length <= 16 && p.id !== me) {
    const was = st.peers[p.id];
    setPeer(p.id, p.b, now);
    const nowKo = useBrawl.getState().peers[p.id]?.koAt;
    if (p.by === me && nowKo && !was?.koAt) credit(scope, p.id, now);
  }
}

/** We knocked someone out: XP, if we really hit them and the anti-farm rules allow it. */
function credit(scope: Scope, foe: string, now: number) {
  const hitAt = myHits.get(foe) ?? 0;
  if (now - hitAt > KO_CREDIT_MS) return;
  myHits.delete(foe);
  const info = peerInfo(scope, foe);
  const keys = [`id:${foe}`, ...(info?.name ? [`n:${info.name.toLowerCase()}`] : [])];
  const r = koXp(rec, { now, foeKeys: keys, myLvl: myLevel(), foeLvl: info?.lvl ?? myLevel(), base: rooms[scope]?.koXp });
  saveRecord({ ...r.rec, off: useBrawl.getState().off });
  if (r.xp > 0) gainXp(r.xp);
  if (info?.name) announce({ k: 'ko', tn: info.name });
  brawlHooks.koed?.(scope, foe, info?.name ?? null, r.xp);
}

function standUp() {
  const now = Date.now();
  useBrawl.setState((s) => (s.me.koAt ? { me: { ...s.me, hp: MAX_HP, koAt: 0, shieldUntil: now + SHIELD_MS, respawn: s.me.respawn + 1 } } : s));
  sendHp(true);
}

/** HP comes back slowly after a while without a hit, for you and (as a guess until they say) for others. */
function regen() {
  const now = Date.now();
  const s = useBrawl.getState();
  let me = s.me;
  if (me.hp < MAX_HP && !me.koAt && now - me.hitAt > REGEN_AFTER) {
    me = { ...me, hp: Math.min(MAX_HP, me.hp + REGEN_HP) };
    if (me.hp === MAX_HP) sendHp();
  }
  let changed = me !== s.me;
  const peers = { ...s.peers };
  for (const [id, p] of Object.entries(peers)) {
    if (p.hp < MAX_HP && !p.koAt && now - p.hitAt > REGEN_AFTER) {
      peers[id] = { ...p, hp: Math.min(MAX_HP, p.hp + REGEN_HP) };
      changed = true;
    }
    // a knockdown we never heard the end of
    if (p.koAt && now - p.koAt > (brawlHooks.holdKo?.(s.scope) ? HELD_KO_MS + 3000 : KO_MS + 4000)) {
      peers[id] = { ...p, koAt: 0, hp: MAX_HP };
      changed = true;
    }
  }
  if (changed) useBrawl.setState({ me, peers });
}

/* ---------------- what the screens call ---------------- */

/**
 * Wire Brawl to the rest of the app. Called once at start.
 * busy: a deploy is being signed or sent (you are safe then). canFight: you are seen in that room.
 */
export function initBrawl(o: { busy: () => boolean; level: () => number; canFight: (scope: Scope) => boolean; gainXp: (n: number) => void }) {
  busy = o.busy;
  myLevel = o.level;
  canFight = o.canFight;
  gainXp = o.gainXp;
  roomHooks.onBx = onBx;
  roomHooks.onBw = (scope, id, bw) => {
    if (scope === useBrawl.getState().scope) setPeer(id, bw, Date.now());
  };
  roomHooks.myBw = () => packMe(Date.now());
  void loadJson<Rec>(REC_KEY, rec).then((r) => {
    rec = { off: r.off === true, day: typeof r.day === 'string' ? r.day : '', dayXp: Number(r.dayXp) || 0, foes: r.foes && typeof r.foes === 'object' ? r.foes : {} };
    useBrawl.setState({ off: rec.off });
  });
  if (!tick) tick = setInterval(regen, REGEN_TICK);
}

/** You moved to the lobby, the island or the arena: a fresh start there, with a shield while you arrive. */
export function enterScope(scope: Scope) {
  const now = Date.now();
  myHits.clear();
  hitsFrom.clear();
  useBrawl.setState((s) => ({ scope, peers: {}, jumps: {}, guardUntil: 0, me: { ...s.me, hp: MAX_HP, koAt: 0, hitAt: 0, shieldUntil: now + SHIELD_MS } }));
}

/** Fight XP that is not a KO (arena wins, the boss), under the same daily cap. Returns what was given. */
export function awardFightXp(n: number): number {
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const dayXp = rec.day === day ? rec.dayXp : 0;
  const xp = Math.max(0, Math.min(DAY_CAP - dayXp, Math.round(n)));
  saveRecord({ ...rec, day, dayXp: dayXp + xp, off: useBrawl.getState().off });
  if (xp > 0) gainXp(xp);
  return xp;
}

/** Arena: put me back to full HP (a new match), with a short shield. */
export function resetMe(shieldMs = SHIELD_MS) {
  const now = Date.now();
  useBrawl.setState((s) => ({ guardUntil: 0, me: { ...s.me, hp: MAX_HP, koAt: 0, hitAt: 0, shieldUntil: now + shieldMs, respawn: s.me.respawn + 1 } }));
  sendHp(true);
}

/** Arena: a teammate got you up (Boss Raid), or the raid gave up on you. You stay where you are. */
export function reviveMe(hp: number, shieldMs = 2000) {
  const now = Date.now();
  const s = useBrawl.getState();
  if (!s.me.koAt) return false;
  useBrawl.setState({ me: { ...s.me, hp: Math.max(1, Math.min(MAX_HP, hp)), koAt: 0, hitAt: now, shieldUntil: now + shieldMs } });
  sendHp(true);
  return true;
}

/**
 * Arena: you were thrown by `by` (who grabbed you while dizzy). You judge your own HP as always, so
 * this applies the damage here, with a knockback away from `from`.
 */
export function takeThrow(scope: Scope, dmg: number, from: [number, number], by: string) {
  const now = Date.now();
  const s = useBrawl.getState();
  if (scope !== s.scope || s.me.koAt || s.off || !rooms[scope]?.arena) return false;
  const hp = Math.max(0, s.me.hp - Math.max(0, Math.round(dmg)));
  const ko = hp <= 0;
  useBrawl.setState({ me: { ...s.me, hp, hitAt: now, hitFrom: from, koAt: ko ? now : 0 } });
  if (ko) {
    sendHp(true, by);
    brawlHooks.kodBy?.(scope, by, peerInfo(scope, by)?.name ?? null);
    if (!brawlHooks.holdKo?.(scope)) setTimeout(standUp, KO_MS);
  } else sendHp(true);
  return true;
}
/** We grabbed and threw `foe`: count it as our hit, so the KO (if it comes) is ours. */
export function markHit(foe: string) {
  myHits.set(foe, Date.now());
}

/** Arena: how much HP a pickup gives back, or a shield. */
export function heal(hp: number) {
  useBrawl.setState((s) => (s.me.koAt ? s : { me: { ...s.me, hp: Math.min(MAX_HP, s.me.hp + hp) } }));
  sendHp(true);
}
export function shieldMe(ms: number) {
  const now = Date.now();
  useBrawl.setState((s) => ({ me: { ...s.me, shieldUntil: Math.max(s.me.shieldUntil, now + ms) } }));
  sendHp(true);
}
/** Pickaxe Guard: block for a moment. */
export function guard() {
  useBrawl.setState({ guardUntil: Date.now() + GUARD_MS });
}
export function setPassive(p: 'skin' | 'pet' | null) {
  useBrawl.setState({ passive: p });
}

/**
 * An arena power or a thrown shard hit `target`. Same checks as a swing; `x, y` is where the hit
 * came from (you, or the shard). Returns true when it was sent.
 */
export function strike(scope: Scope, w: Weapon, target: string, x: number, y: number): boolean {
  const now = Date.now();
  const s = useBrawl.getState();
  const room = rooms[scope];
  if (!room?.arena || scope !== s.scope || s.off || s.me.koAt || !canFight(scope)) return false;
  if (target === 'boss' || /^m\d{1,7}$/.test(target)) {
    seq += 1;
    return send(scope, { k: 'h', a: meId(scope), t: target, s: seq, x: Math.round(x), y: Math.round(y), w });
  }
  const v = s.peers[target];
  if (!v || !v.on || v.koAt || now < v.shieldUntil) return false;
  seq += 1;
  if (!send(scope, { k: 'h', a: meId(scope), t: target, s: seq, x: Math.round(x), y: Math.round(y), w })) return false;
  myHits.set(target, now);
  const d = baseDamage(w, meId(scope), seq, myLevel(), true);
  useBrawl.setState((st) => ({ peers: { ...st.peers, [target]: { ...v, hp: Math.max(1, v.hp - d), hitAt: now } } }));
  return true;
}

/** The arena host's boss hits a player. Only the host calls this. */
export function bossHit(scope: Scope, target: string, x: number, y: number, host: string, w: 'boss' | 'mob' = 'boss') {
  seq += 1;
  // the host may be the target: deliver it to ourselves too
  const p = { k: 'h', a: 'boss', t: target, s: seq, x: Math.round(x), y: Math.round(y), w, h: host };
  if (target === meId(scope)) onBx(scope, p);
  else send(scope, p);
}

export function setMyPos(scope: Scope, x: number, y: number) {
  myPos[scope] = [x, y];
}

/**
 * Your miner swung (the canvas picked the nearest fair target, if any).
 * Returns false when the swing doesn't count: Brawl off, knocked down, deploying, or too soon.
 */
export function swing(scope: Scope, target: string | null, x: number, y: number): boolean {
  const now = Date.now();
  const s = useBrawl.getState();
  if (scope !== s.scope || s.off || busy() || s.me.koAt || now - s.me.swingAt < SWING_MS - 30 || !canFight(scope)) return false;
  // swinging drops your own shield
  useBrawl.setState({ me: { ...s.me, swingAt: now, shieldUntil: 0 } });
  if (!target) return true;
  const v = s.peers[target];
  if (!v || !v.on || v.koAt || now < v.shieldUntil) return true;
  seq += 1;
  if (!send(scope, { k: 'h', a: meId(scope), t: target, s: seq, x: Math.round(x), y: Math.round(y) })) return true;
  myHits.set(target, now);
  if (myHits.size > 100) myHits.clear();
  const d = baseDamage('swing', meId(scope), seq, myLevel(), Boolean(rooms[scope]?.arena));
  useBrawl.setState((st) => ({ peers: { ...st.peers, [target]: { ...v, hp: Math.max(1, v.hp - d), hitAt: now } } }));
  return true;
}

/** Your miner jumped. Everyone in the room sees the hop, and a swing at you mid-air misses. */
export function jump(scope: Scope): boolean {
  const now = Date.now();
  const s = useBrawl.getState();
  if (scope !== s.scope || s.me.koAt || now - s.myJumpAt < JUMP_GAP - 30) return false;
  useBrawl.setState({ myJumpAt: now });
  send(scope, { k: 'j', id: meId(scope) });
  return true;
}

/** Who may be targeted, for the canvas: Brawl on, standing, not shielded. */
export const fairTarget = (f: Fighter | undefined, now: number) => Boolean(f && f.on && !f.koAt && now >= f.shieldUntil);

/** What the canvas needs to draw HP bars, shields and knockdowns. */
export function brawlSnap(now: number) {
  const s = useBrawl.getState();
  const view = (f: Fighter) => ({ hp: f.hp, ko: f.koAt, sh: f.shieldUntil > now ? f.shieldUntil : 0, hit: f.hitAt, sw: f.swingAt, on: f.on });
  return {
    on: !s.off,
    me: { ...view(s.me), on: !s.off && !busy(), rs: s.me.respawn, hx: s.me.hitFrom[0], hy: s.me.hitFrom[1] },
    peers: Object.fromEntries(Object.entries(s.peers).map(([id, f]) => [id, view(f)])),
    jumps: Object.fromEntries(Object.entries(s.jumps).filter(([, at]) => now - at < JUMP_MS)),
  };
}

/** For tests. */
export const _test = { onBx, standUp, regen, setRec: (r: Rec) => (rec = r), getRec: () => rec };
export { GUARD_STING };
