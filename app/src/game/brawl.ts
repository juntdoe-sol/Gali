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
import { roomHooks, type Scope } from './rx';
import { loadJson, saveJson } from './storage';
import { sendWorldBx, useWorld } from './world';

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
/** most fight XP a day */
export const DAY_CAP = 200;
/** XP only counts if you landed a hit on them this recently */
const KO_CREDIT_MS = 6000;
/** slack on the victim's side for network delay */
const RANGE_SLACK = 26;
const CLAIM_SLACK = 64;
const HP_SEND_MS = 700;

/** Damage of an attacker's n-th swing: the same on every client, and not up to the attacker. */
export function dmgOf(attacker: string, seq: number): number {
  let h = 2166136261;
  const s = `${attacker}:${seq}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 10 + ((h >>> 0) % 6);
}

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
  setOff: (off: boolean) => void;
}

export const useBrawl = create<BrawlState>((set) => ({
  off: false,
  scope: 'lobby',
  me: { ...fresh(0), respawn: 0, hitFrom: [0, 0] },
  peers: {},
  jumps: {},
  myJumpAt: 0,
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

/** Is a hit claim believable from where the victim stands? */
export function hitOk(o: { claim: [number, number]; seen: [number, number] | null; me: [number, number]; lastFrom: number; now: number }): boolean {
  if (o.now - o.lastFrom < SWING_MS - 80) return false;
  if (!o.seen) return false;
  if (Math.hypot(o.claim[0] - o.seen[0], o.claim[1] - o.seen[1]) > CLAIM_SLACK) return false;
  return Math.hypot(o.claim[0] - o.me[0], o.claim[1] - o.me[1]) <= REACH + RANGE_SLACK;
}

/* ---------------- wiring ---------------- */
let busy: () => boolean = () => false;
let myLevel: () => number = () => 1;
let canFight: (scope: Scope) => boolean = () => true;
let gainXp: (n: number) => void = () => undefined;
const myPos: Record<Scope, [number, number]> = { lobby: [0, 0], island: [0, 0] };
let seq = 0;
/** when we last landed a hit on each foe (for KO credit) */
const myHits = new Map<string, number>();
/** when each attacker last hit us (rate check) */
const hitsFrom = new Map<string, number>();
let lastHpSent = 0;
let hpTimer: ReturnType<typeof setTimeout> | null = null;
let tick: ReturnType<typeof setInterval> | null = null;

const meId = (scope: Scope) => (scope === 'lobby' ? useLobby.getState().me : useWorld.getState().me);
const send = (scope: Scope, p: Record<string, unknown>) => (scope === 'lobby' ? sendLobbyBx(p) : sendWorldBx(p));
function peerInfo(scope: Scope, id: string): { pos: [number, number]; lvl: number; name: string } | null {
  if (scope === 'lobby') {
    const p = useLobby.getState().peers[id];
    return p ? { pos: [p.x, p.y], lvl: p.lvl, name: p.name } : null;
  }
  const p = useWorld.getState().peers[id];
  return p && !p.bot ? { pos: [p.x, p.y], lvl: p.lvl, name: p.name } : null;
}

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
    // the attacker swung: draw it
    if (st.peers[a]) useBrawl.setState((s) => ({ peers: { ...s.peers, [a]: { ...s.peers[a], swingAt: now } } }));
    const dmg = dmgOf(a, Math.floor(p.s));
    if (p.t === me) {
      if (meSafe(now) || !canFight(scope)) return void sendHp();
      const info = peerInfo(scope, a);
      if (!hitOk({ claim: [p.x, p.y], seen: info?.pos ?? null, me: myPos[scope], lastFrom: hitsFrom.get(a) ?? 0, now })) return;
      hitsFrom.set(a, now);
      if (hitsFrom.size > 200) hitsFrom.clear();
      const hp = Math.max(0, st.me.hp - dmg);
      const ko = hp <= 0;
      useBrawl.setState((s) => ({ me: { ...s.me, hp, hitAt: now, hitFrom: [p.x, p.y], koAt: ko ? now : 0 } }));
      if (ko) {
        sendHp(true, a);
        setTimeout(standUp, KO_MS);
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
  const r = koXp(rec, { now, foeKeys: keys, myLvl: myLevel(), foeLvl: info?.lvl ?? myLevel() });
  saveRecord({ ...r.rec, off: useBrawl.getState().off });
  if (r.xp > 0) gainXp(r.xp);
  if (info?.name) announce({ k: 'ko', tn: info.name });
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
    if (p.koAt && now - p.koAt > KO_MS + 4000) {
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

/** You moved to the lobby or the island: a fresh start there, with a shield while you arrive. */
export function enterScope(scope: Scope) {
  const now = Date.now();
  myHits.clear();
  hitsFrom.clear();
  useBrawl.setState((s) => ({ scope, peers: {}, jumps: {}, me: { ...s.me, hp: MAX_HP, koAt: 0, hitAt: 0, shieldUntil: now + SHIELD_MS } }));
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
  useBrawl.setState((st) => ({ peers: { ...st.peers, [target]: { ...v, hp: Math.max(1, v.hp - dmgOf(meId(scope), seq)), hitAt: now } } }));
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
