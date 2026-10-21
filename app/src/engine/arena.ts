/**
 * The Arena, drawn and played: a gothic hall seen from the side, scrolling with you.
 *
 * A stone floor, two low ledges and the high throne in the middle, red arched windows, and a balcony along
 * the top where the crowd (and anyone knocked out) stands. Fighters run with A/D or the arrows (PC) or the
 * stick (phone), jump with W, Up or Space (or push the stick up), and drop off a ledge with S or Down (or
 * the stick down). On PC the left mouse button swings, the right throws ORE at the cursor, and every
 * unlocked power has its own key (Q E R C V X, or 1 to 6). F and G still swing and throw.
 *
 * In a Boss Raid everyone fights the Two-Mouthed: it warns before each attack (a red zone on the floor
 * and a flashing mark), so jump its sweep, get above its tongue and keep away from its roar.
 *
 * The engine owns movement, aiming and the flight of your own ORE shards (it knows where everyone is
 * drawn), and tells the app what landed. The app (game/arena.ts, game/brawl.ts) owns the rules.
 * It can also record a short clip of the canvas after a knockout, for sharing.
 */
import { canvasDpr, reducedMotion } from './screen';
import { ctx2d, text, textWidth, loadAtlas, type Ctx } from './art';
import { drawMiner, drawPet, frameAt, type Body } from './actors';
import { drawHp, drawKo, drawShield, FightFx, hitFlash, koAge, pickTarget, swingTilt } from './brawlfx';
import { Particles } from './particles';
import type { BrawlSnap, Look, Pose } from './types';
import {
  AH, AW, BALCONY, BOSS_ACT_MS, BOSS_HALF, BOSS_TALL, BOSS_WIND2_MS, BOSS_WIND_MS, GROUND, inHall, LEDGES, ROAR_REACH, spawnAt, standsSpot,
  SWEEP_REACH, THRONE, THROW_RANGE, TONGUE_REACH, WALL_L, WALL_R, type BossAtk, type Pickup, type Shot,
} from '../game/arenaMap';
import { trailColor } from '../game/trails';
import { drawFan, drawFlame, drawGlow, drawVignette, type Fan } from './arenaArt';
import { HALL_TORCHES, makeHallCrowd, paintHall } from './hallArt';
import { drawTwoMouthed, preloadBoss } from './bossArt';

export type ArenaEvent =
  | { t: 'ready' }
  | { t: 'me'; x: number; y: number; tx: number; ty: number; facing: 1 | -1; pose: string }
  | { t: 'swing'; target: string | null; x: number; y: number }
  | { t: 'jump' }
  /** an active power went off; targets it hit right away (dash, slam) */
  | { t: 'power'; p: string; targets: string[]; x: number; y: number }
  /** one of your shards (or your pet) hit someone */
  | { t: 'strike'; w: 'ore' | 'splash' | 'pet'; target: string; x: number; y: number }
  | { t: 'throw'; x: number; y: number; dirs: [number, number][]; w: 'ore' | 'splash' }
  | { t: 'grab'; i: number }
  | { t: 'peer'; id: string }
  | { t: 'clip'; url: string; mime: string }
  | { t: 'sfx'; name: 'swing' | 'hit' | 'pop' | 'slam' | 'throw' | 'pick' | 'cheer' | 'ko' };

export interface ArenaPeerView {
  id: string;
  name: string;
  x: number;
  y: number;
  tx: number;
  ty: number;
  f: 1 | -1;
  p: string;
  look: Look;
  spectator: boolean;
  trail: string;
  fx: { p: string; at: number } | null;
}
export interface ArenaSnap {
  me: { id: string; spectator: boolean; ammo: number; actives: string[]; passive: string | null; ready: Record<string, number>; trail: string; guardUntil: number };
  peers: ArenaPeerView[];
  brawl: BrawlSnap;
  match: { n: number; mode: string; phase: string; fighters: string[]; out: string[]; score: Record<string, number>; boss: { x: number; y: number; hp: number; max: number; atk: BossAtk | null; atkAt: number; hitAt: number; facing: 1 | -1 } | null };
  pickups: Pickup[];
  shots: Shot[];
  cheers: { id: string; at: number }[];
}
export interface ArenaOpts {
  /** CSS px the app's bars cover at the top and bottom */
  top: number;
  bottom: number;
  touch: boolean;
  /** CSS px of the phone's own bottom edge (home bar), so the stick sits clear of it */
  safeBottom?: number;
}

const SPEED = 72;
/** the hall's pull, a jump's kick, and the fastest fall (map px, per second) */
const GRAVITY = 600;
const JUMP_V = 262;
const MAX_FALL = 340;
/** how hard a hit throws you back, and a jump allowed just after running off an edge (ms) */
const KNOCK = 130;
const COYOTE_MS = 90;
const SHOT_SPEED = 170;
const DASH_PX = 52;
const DASH_MS = 180;
const SLAM_MS = 360;
const SLAM_R = 34;
const SPIN_R = 28;
const STICK_R = 54;
/** number keys 1 to 6 and the letter keys, in the order of ACTIVES */
const SLOT_KEYS = ['q', 'e', 'r', 'c', 'v', 'x'];
const SLOT_IDS = ['dash', 'guard', 'slam', 'splash', 'spin', 'mend'];

interface Mover extends Body {
  tx: number;
  ty: number;
  /** fall speed, and whether the feet are on a floor or ledge */
  vy?: number;
  grounded?: boolean;
}
/** The floor or ledge right under a body at (x, y): where its shadow falls. */
function surfaceBelow(x: number, y: number): number {
  let best = GROUND;
  for (const l of LEDGES) if (x >= l.x0 && x <= l.x1 && l.y >= y - 1 && l.y < best) best = l.y;
  return best;
}
interface MyShot {
  x: number;
  y: number;
  dx: number;
  dy: number;
  left: number;
  w: 'ore' | 'splash';
  done: boolean;
}

export class ArenaEngine {
  private c: Ctx;
  private dpr = 1;
  private W = 1;
  private H = 1;
  private z = 2;
  private ox = 0;
  private oy = 0;
  private camX = AW / 2;
  private camY = AH / 2;
  private raf = 0;
  private last = 0;
  private ready = false;
  private ground: HTMLCanvasElement | null = null;
  private parts = new Particles();
  private fx = new FightFx();
  private snap: ArenaSnap | null = null;
  private me: Mover;
  private others = new Map<string, Mover & { view: ArenaPeerView }>();
  private keys = new Set<string>();
  private stick: { id: number; x0: number; y0: number; dx: number; dy: number } | null = null;
  /** where the mouse points, in map px (PC aiming) */
  private aim: [number, number] | null = null;
  /** powers used here, before the app's snapshot catches up */
  private usedAt = new Map<string, number>();
  private spinAt = 0;
  private lastEmpty = 0;
  private lastEmit = 0;
  private lastEmitKey = '';
  private swingUntil = 0;
  private lastSwing = 0;
  private myJumpAt = 0;
  private lastGround = 0;
  /** the ledge you dropped through, ignored until this time */
  private dropY = -1;
  private dropUntil = 0;
  private knock = 0;
  private stickUp = false;
  private stickDown = false;
  private lastAtkKey = '';
  private lastDrip = 0;
  private dash: { from: [number, number]; dir: number; at: number; hit: boolean } | null = null;
  private slamAt = 0;
  private myShots: MyShot[] = [];
  private lastPet = 0;
  private lastRs = -1;
  private lastN = -1;
  private lastHit = 0;
  private myHp = 100;
  private seen = new Map<string, { hp: number; sw: number; ko: number; fx: number; fxAt: number }>();
  private lastBossHit = 0;
  private crowd: Fan[] = [];
  private lastEmber = 0;
  private grabbed = new Map<number, number>();
  private recorder: { rec: MediaRecorder; chunks: Blob[]; until: number } | null = null;
  private onKey = (e: KeyboardEvent) => this.key(e, true);
  private onKeyUp = (e: KeyboardEvent) => this.key(e, false);
  private onBlur = () => this.keys.clear();

  constructor(
    private canvas: HTMLCanvasElement,
    private emit: (e: ArenaEvent) => void,
    private look: Look,
    private opts: ArenaOpts,
  ) {
    this.c = ctx2d(canvas);
    const [x, y] = spawnAt(0, 1);
    this.me = { x, y, path: [], pose: 'idle', since: 0, facing: 1, tx: x, ty: y, vy: 0, grounded: true };
    preloadBoss();
    this.bindInput();
    (globalThis as unknown as { __galiArena?: ArenaEngine }).__galiArena = this;
  }

  setLook(l: Look) {
    this.look = l;
  }
  setOpts(o: Partial<ArenaOpts>) {
    this.opts = { ...this.opts, ...o };
  }
  push(s: ArenaSnap) {
    const prev = this.snap;
    this.snap = s;
    this.syncPeers(s.peers);
    this.react(s, prev);
  }

  async start(atlasUrl: string) {
    await loadAtlas(atlasUrl);
    this.buildGround();
    this.last = performance.now();
    const loop = (t: number) => {
      this.raf = requestAnimationFrame(loop);
      this.frame(t);
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop() {
    cancelAnimationFrame(this.raf);
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKey, true);
      window.removeEventListener('keyup', this.onKeyUp, true);
      window.removeEventListener('blur', this.onBlur);
    }
    try {
      this.recorder?.rec.stop();
    } catch {
      /* already stopped */
    }
  }

  /* ---------------- the pit, painted once ---------------- */
  private buildGround() {
    this.ground = paintHall();
    this.crowd = makeHallCrowd();
  }

  /* ---------------- people ---------------- */
  private syncPeers(views: ArenaPeerView[]) {
    const seen = new Set<string>();
    for (const v of views) {
      seen.add(v.id);
      let p = this.others.get(v.id);
      if (!p) {
        p = { x: v.x, y: v.y, path: [], pose: 'idle', since: 0, facing: v.f, tx: v.tx, ty: v.ty, view: v };
        this.others.set(v.id, p);
      }
      p.view = v;
      p.tx = v.tx;
      p.ty = v.ty;
      p.facing = v.f;
      if (Math.hypot(p.x - v.x, p.y - v.y) > 48) {
        p.x = v.x;
        p.y = v.y;
      }
    }
    for (const id of [...this.others.keys()]) if (!seen.has(id)) this.others.delete(id);
  }

  /** What changed since the last snapshot: a new match, a stand-up, hits, powers, the boss. */
  private react(s: ArenaSnap, prev: ArenaSnap | null) {
    const wall = Date.now();
    const me = this.me;
    const b = s.brawl;
    // a new match: everyone to their slot (spectators to the stands)
    if (s.match.n !== this.lastN && (s.match.phase === 'count' || this.lastN < 0)) {
      this.lastN = s.match.n;
      this.toStart(s);
    }
    if (this.lastRs < 0) this.lastRs = b.me.rs;
    if (b.me.rs !== this.lastRs) {
      this.lastRs = b.me.rs;
      if (s.match.phase !== 'count') this.toStart(s);
    }
    if (prev && s.me.spectator && !prev.me.spectator) this.toStart(s);
    if (b.me.hit && b.me.hit !== this.lastHit) {
      this.lastHit = b.me.hit;
      // thrown back, away from the hit, with a little hop
      if (!s.me.spectator) {
        this.knock = (me.x >= b.me.hx ? 1 : -1) * KNOCK;
        me.vy = Math.min(me.vy ?? 0, -110);
        me.grounded = false;
      }
      this.parts.burst('star', me.x, me.y - 14, 8, 26, 22, ['#ffffff', '#ffd84a', '#ff8a70'], 0.5);
      this.fx.hit(me.x, me.y, Math.max(0, this.myHp - b.me.hp), wall, true);
      this.fx.shake(200, 2.2, wall);
      this.emit({ t: 'sfx', name: 'hit' });
    }
    if (b.me.ko && (!prev || !prev.brawl.me.ko)) {
      this.fx.ko(me.x, me.y, wall);
      this.emit({ t: 'sfx', name: 'ko' });
      this.clip();
    }
    this.myHp = b.me.hp;
    for (const v of s.peers) {
      const f = b.peers[v.id];
      const p = this.others.get(v.id);
      const was = this.seen.get(v.id);
      if (f && p && was) {
        if (f.hit && f.hit !== was.fx && wall - f.hit < 800) {
          this.parts.burst('star', p.x, p.y - 14, 8, 26, 22, ['#ffffff', '#ffd84a', '#ff8a70'], 0.5);
          this.fx.hit(p.x, p.y, Math.max(0, was.hp - f.hp), wall, false);
        }
        if (f.sw && f.sw !== was.sw && wall - f.sw < 300) this.fx.slash(p.x, p.y, p.facing, f.sw, false, trailColor(v.trail));
        if (f.ko && !was.ko) {
          this.fx.ko(p.x, p.y, wall);
          this.clip();
        }
      }
      if (v.fx && v.fx.at !== (this.seen.get(v.id)?.fxAt ?? 0) && wall - v.fx.at < 600 && p) this.powerFx(v.fx.p, p.x, p.y, p.facing, wall);
      this.seen.set(v.id, { hp: f?.hp ?? 100, sw: f?.sw ?? 0, ko: f?.ko ?? 0, fx: f?.hit ?? 0, fxAt: v.fx?.at ?? 0 });
    }
    const boss = s.match.boss;
    if (boss) {
      if (boss.hitAt && boss.hitAt !== this.lastBossHit && wall - boss.hitAt < 600) {
        this.lastBossHit = boss.hitAt;
        this.parts.burst('star', boss.x, boss.y - 50, 6, 26, 22, ['#ffffff', '#ffd84a'], 0.45);
      }
    }
  }

  private toStart(s: ArenaSnap) {
    const me = this.me;
    if (s.me.spectator) {
      const [x, y] = standsSpot(s.me.id);
      me.x = x;
      me.y = y;
    } else {
      const ids = s.match.fighters.length ? s.match.fighters : [s.me.id];
      const i = Math.max(0, ids.indexOf(s.me.id));
      const [x, y] = spawnAt(i, ids.length);
      me.x = x;
      me.y = y;
      me.facing = x < AW / 2 ? 1 : -1;
    }
    me.tx = me.x;
    me.ty = me.y;
    me.vy = 0;
    me.grounded = true;
    this.knock = 0;
    this.parts.burst('dust', me.x, me.y, 10, 22, 14, ['#f2e6c8', '#d8c8a8'], 0.7);
  }

  /* ---------------- actions ---------------- */
  private downed(wall: number) {
    const b = this.snap?.brawl;
    return b ? koAge(b.me, wall) >= 0 : false;
  }
  private fighting() {
    const s = this.snap;
    return Boolean(s && !s.me.spectator && s.match.phase === 'fight' && s.brawl.on);
  }
  private targets() {
    const b = this.snap?.brawl;
    const list = [...this.others.values()].filter((p) => !p.view.spectator).map((p) => ({ id: p.view.id, x: p.x, y: p.y, v: b?.peers[p.view.id] }));
    const boss = this.snap?.match.boss;
    if (boss && boss.hp > 0) list.push({ id: 'boss', x: boss.x, y: boss.y, v: { hp: boss.hp, ko: 0, sh: 0, hit: boss.hitAt, sw: 0, on: true } });
    return list;
  }

  attack() {
    const wall = Date.now();
    if (!this.fighting() || this.downed(wall) || wall - this.lastSwing < 450) return;
    this.lastSwing = wall;
    const me = this.me;
    if (this.aim && Math.abs(this.aim[0] - me.x) > 3) me.facing = this.aim[0] > me.x ? 1 : -1;
    let t = pickTarget(me, this.targets(), wall);
    // the boss is big: it can be hit from a little further away
    const boss = this.snap?.match.boss;
    if (!t && boss && boss.hp > 0 && Math.abs(boss.x - me.x) < BOSS_HALF + 14 && me.y > boss.y - BOSS_TALL) t = { id: 'boss', facing: boss.x >= me.x ? 1 : -1 };
    if (t) me.facing = t.facing;
    this.swingUntil = performance.now() + 540;
    me.pose = 'swing';
    me.since = performance.now();
    this.fx.slash(me.x, me.y, me.facing, wall, Boolean(t), trailColor(this.snap?.me.trail));
    if (t) this.fx.shake(140, 1.4, wall + 200);
    this.emit({ t: 'swing', target: t?.id ?? null, x: me.x, y: me.y });
    this.emit({ t: 'sfx', name: 'swing' });
  }

  /** Jump: off the floor or a ledge (or just after running off one). Mid-air you dodge hits for a moment. */
  jump() {
    const wall = Date.now();
    const me = this.me;
    if (this.downed(wall) || this.snap?.me.spectator) return;
    if (!me.grounded && performance.now() - this.lastGround > COYOTE_MS) return;
    me.vy = -JUMP_V;
    me.grounded = false;
    this.lastGround = 0;
    this.myJumpAt = wall;
    this.parts.burst('dust', me.x, me.y, 5, 14, 8, ['#f2e6c8', '#d8c8a8'], 0.4);
    this.emit({ t: 'jump' });
  }
  /** Drop down through the ledge you stand on. */
  drop() {
    const me = this.me;
    if (!me.grounded || me.y >= GROUND - 1 || this.snap?.me.spectator) return;
    this.dropY = me.y;
    this.dropUntil = performance.now() + 260;
    me.grounded = false;
    me.vy = 40;
  }

  /** Is power `p` unlocked and off cooldown? */
  canUse(p: string, wall = Date.now()) {
    const s = this.snap;
    if (!s || !s.me.actives.includes(p)) return false;
    const used = this.usedAt.get(p) ?? 0;
    return wall >= (s.me.ready[p] ?? 0) && wall - used > 400;
  }

  /** Use power `p`. The app checks the cooldown and unlock again; this does the moving and aiming. */
  power(p: string) {
    const s = this.snap;
    const wall = Date.now();
    if (!s || !this.fighting() || this.downed(wall) || !this.canUse(p, wall)) return;
    this.usedAt.set(p, wall);
    const me = this.me;
    if (this.aim && (p === 'dash' || p === 'splash') && Math.abs(this.aim[0] - me.x) > 3) me.facing = this.aim[0] > me.x ? 1 : -1;
    this.powerFx(p, me.x, me.y, me.facing, wall);
    if (p === 'dash') {
      this.dash = { from: [me.x, me.y], dir: me.facing, at: performance.now(), hit: false };
      this.emit({ t: 'power', p, targets: [], x: me.x, y: me.y });
    } else if (p === 'slam') {
      this.slamAt = wall;
      this.myJumpAt = wall;
      me.vy = -JUMP_V * 0.75;
      me.grounded = false;
      this.emit({ t: 'power', p, targets: [], x: me.x, y: me.y });
      setTimeout(() => {
        // land: everyone close takes it
        const hit = this.targets().filter((o) => o.v && o.v.on && !(o.v.ko && wall - o.v.ko < 4500) && Date.now() >= o.v.sh && (o.id === 'boss' ? Math.abs(o.x - me.x) <= SLAM_R + BOSS_HALF / 2 : Math.hypot(o.x - me.x, o.y - me.y) <= SLAM_R)).map((o) => o.id);
        this.parts.burst('dust', me.x, me.y, 16, 40, 16, ['#d8c8a8', '#f2e6c8'], 0.6);
        this.fx.shake(220, 2.4, Date.now());
        this.emit({ t: 'power', p: 'slam-land', targets: hit, x: me.x, y: me.y });
        this.emit({ t: 'sfx', name: 'slam' });
      }, SLAM_MS);
    } else if (p === 'guard') {
      this.emit({ t: 'power', p, targets: [], x: me.x, y: me.y });
    } else if (p === 'splash') {
      const dirs: [number, number][] = [-0.35, 0, 0.35].map((a) => [Math.cos(a) * me.facing, Math.sin(a)]);
      this.fire(dirs, 'splash');
      this.emit({ t: 'power', p, targets: [], x: me.x, y: me.y });
    } else if (p === 'spin') {
      // everyone next to you takes it at once
      this.spinAt = performance.now();
      this.swingUntil = this.spinAt + 540;
      const hit = this.targets().filter((o) => o.v && o.v.on && !(o.v.ko && wall - o.v.ko < 4500) && wall >= o.v.sh && (o.id === 'boss' ? Math.abs(o.x - me.x) <= SPIN_R + BOSS_HALF / 2 && me.y > o.y - BOSS_TALL : Math.hypot(o.x - me.x, o.y - me.y) <= SPIN_R)).map((o) => o.id);
      this.fx.slash(me.x, me.y, 1, wall, hit.length > 0, trailColor(this.snap?.me.trail));
      this.fx.slash(me.x, me.y, -1, wall, hit.length > 0, trailColor(this.snap?.me.trail));
      this.parts.burst('star', me.x, me.y - 10, 10, 34, 16, ['#ffffff', '#ffd84a'], 0.45);
      if (hit.length) this.fx.shake(180, 2, wall);
      this.emit({ t: 'power', p, targets: hit, x: me.x, y: me.y });
      this.emit({ t: 'sfx', name: 'swing' });
    } else if (p === 'mend') {
      this.parts.burst('star', me.x, me.y - 14, 12, 26, 24, ['#7dffa0', '#ffffff'], 0.6);
      this.emit({ t: 'power', p, targets: [], x: me.x, y: me.y });
      this.emit({ t: 'sfx', name: 'pick' });
    }
  }

  /** Throw an ORE shard: at the mouse on PC, else at the nearest target ahead (needs ammo; the app checks). */
  throwOre(at?: [number, number] | null) {
    const s = this.snap;
    const wall = Date.now();
    if (!s || !this.fighting() || this.downed(wall)) return;
    const me = this.me;
    if (s.me.ammo <= 0) {
      if (wall - this.lastEmpty > 900) {
        this.lastEmpty = wall;
        this.fx.say(me.x, me.y - 40, 'NO ORE', '#8ea2cc', wall);
      }
      return;
    }
    if (at && Math.hypot(at[0] - me.x, at[1] - (me.y - 10)) > 4) {
      const d = Math.hypot(at[0] - me.x, at[1] - (me.y - 10));
      const dx = (at[0] - me.x) / d;
      if (Math.abs(dx) > 0.2) me.facing = dx > 0 ? 1 : -1;
      this.fire([[dx, (at[1] - (me.y - 10)) / d]], 'ore');
      return;
    }
    const ahead = this.targets().filter((o) => Math.sign(o.x - me.x) === me.facing && Math.hypot(o.x - me.x, o.y - me.y) < THROW_RANGE).sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y))[0];
    let dx = me.facing;
    let dy = 0;
    if (ahead) {
      const d = Math.hypot(ahead.x - me.x, ahead.y - me.y) || 1;
      dx = (ahead.x - me.x) / d;
      dy = (ahead.y - me.y) / d;
    }
    this.fire([[dx, dy]], 'ore');
  }

  private fire(dirs: [number, number][], w: 'ore' | 'splash') {
    const me = this.me;
    for (const [dx, dy] of dirs) this.myShots.push({ x: me.x, y: me.y - 10, dx, dy, left: THROW_RANGE, w, done: false });
    this.emit({ t: 'throw', x: me.x, y: me.y - 10, dirs, w });
    this.emit({ t: 'sfx', name: 'throw' });
  }

  private powerFx(p: string, x: number, y: number, facing: number, wall: number) {
    const names: Record<string, [string, string]> = { dash: ['DASH!', '#7fe3ff'], slam: ['SLAM!', '#ff8a3d'], guard: ['GUARD!', '#9fd6ee'], splash: ['SPLASH!', '#ffd84a'], spin: ['WHIRL!', '#ffffff'], mend: ['+HP', '#7dffa0'] };
    const n = names[p];
    if (n) this.fx.say(x, y - 40, n[0], n[1], wall);
    if (p === 'dash') for (let k = 0; k < 6; k++) this.parts.spawn('dust', x - facing * k * 4, y, { vx: -facing * 20, vz: 4, life: 0.35, c: '#e8d4b0' });
  }

  /* ---------------- input ---------------- */
  /** Where the phone's stick rests: bottom left, clear of the home bar. */
  stickBase() {
    return { x: 22 + STICK_R, y: this.H - (this.opts.safeBottom ?? 0) - 26 - STICK_R };
  }
  private toMap(x: number, y: number): [number, number] {
    return [(x - this.ox) / this.z, (y - this.oy) / this.z];
  }
  private bindInput() {
    const cv = this.canvas;
    cv.style.touchAction = 'none';
    const pos = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    // the right button throws: no browser menu over the pit
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      const fa = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
      if (fa && fa !== document.body && fa.tagName !== 'INPUT' && fa.tagName !== 'TEXTAREA') fa.blur?.();
      const p = pos(e);
      const mouse = e.pointerType === 'mouse' && !this.opts.touch;
      if (!mouse) {
        // phone: the left half is the stick. It rests bottom left; touch further away and it comes to your thumb.
        if (!this.stick && p.x < this.W * 0.5 && p.y > this.opts.top) {
          cv.setPointerCapture?.(e.pointerId);
          const b = this.stickBase();
          const near = Math.hypot(p.x - b.x, p.y - b.y) < STICK_R * 1.6;
          this.stick = { id: e.pointerId, x0: near ? b.x : p.x, y0: near ? b.y : p.y, dx: 0, dy: 0 };
          if (near) this.stickTo(p.x, p.y);
          return;
        }
        const [mx, my] = this.toMap(p.x, p.y);
        const hitPeer = [...this.others.values()].find((o) => Math.abs(o.x - mx) < 8 && my < o.y + 2 && my > o.y - 24);
        if (hitPeer) this.emit({ t: 'peer', id: hitPeer.view.id });
        return;
      }
      e.preventDefault();
      this.aim = this.toMap(p.x, p.y);
      // right button: throw at the cursor
      if (e.button === 2) return this.throwOre(this.aim);
      if (e.button !== 0) return;
      // left button: swing while you fight; else a click on a miner opens them
      if (this.fighting()) return this.attack();
      const [mx, my] = this.aim;
      const hitPeer = [...this.others.values()].find((o) => Math.abs(o.x - mx) < 8 && my < o.y + 2 && my > o.y - 24);
      if (hitPeer) this.emit({ t: 'peer', id: hitPeer.view.id });
    });
    cv.addEventListener('pointermove', (e) => {
      const p = pos(e);
      if (e.pointerType === 'mouse' && !this.opts.touch) this.aim = this.toMap(p.x, p.y);
      if (this.stick && e.pointerId === this.stick.id) this.stickTo(p.x, p.y);
    });
    const up = (e: PointerEvent) => {
      if (this.stick && e.pointerId === this.stick.id) this.stick = null;
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') this.aim = null;
    });
    if (typeof window !== 'undefined') {
      // capture: the game hears its keys before a focused button does (Space would press the button)
      window.addEventListener('keydown', this.onKey, true);
      window.addEventListener('keyup', this.onKeyUp, true);
      window.addEventListener('blur', this.onBlur);
    }
  }
  private stickTo(x: number, y: number) {
    if (!this.stick) return;
    const dx = (x - this.stick.x0) / STICK_R;
    const dy = (y - this.stick.y0) / STICK_R;
    const n = Math.hypot(dx, dy);
    this.stick.dx = n > 1 ? dx / n : dx;
    this.stick.dy = n > 1 ? dy / n : dy;
  }
  private key(e: KeyboardEvent, down: boolean) {
    const t = e.target as HTMLElement | null;
    if (t && (/^(INPUT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    // a button clicked on the way in (GO, ARENA, a skill) still has focus: Space and Enter would press it
    if (t && t.tagName === 'BUTTON' && (k === ' ' || k === 'spacebar')) {
      e.preventDefault();
      e.stopPropagation();
      t.blur();
    }
    // powers: the letter keys, or 1 to 6, in the same order
    const slot = SLOT_KEYS.indexOf(k) >= 0 ? SLOT_KEYS.indexOf(k) : /^[1-6]$/.test(k) ? Number(k) - 1 : -1;
    if (down && !e.repeat) {
      if (k === 'f') this.attack();
      else if (k === ' ' || k === 'spacebar' || k === 'w' || k === 'arrowup') this.jump();
      else if (k === 's' || k === 'arrowdown') this.drop();
      else if (k === 'g') this.throwOre(this.aim);
      else if (k === 'shift') this.power('dash');
      else if (slot >= 0) this.power(SLOT_IDS[slot]);
    }
    if (['f', ' ', 'spacebar', 'g'].includes(k) || slot >= 0) e.preventDefault();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) {
      if (down) this.keys.add(k);
      else this.keys.delete(k);
      e.preventDefault();
    }
  }

  /* ---------------- the loop ---------------- */
  private resize() {
    const cssW = this.canvas.clientWidth || window.innerWidth;
    const cssH = this.canvas.clientHeight || window.innerHeight;
    const dpr = canvasDpr(cssW, cssH, 2);
    if (cssW !== this.W || cssH !== this.H || dpr !== this.dpr) {
      this.W = cssW;
      this.H = cssH;
      this.dpr = dpr;
      this.canvas.width = Math.round(cssW * dpr);
      this.canvas.height = Math.round(cssH * dpr);
      this.c = ctx2d(this.canvas);
    }
    // the hall's full height between the app's bars (on a phone a little closer, following you up and
    // down too); it scrolls sideways with you
    const availH = Math.max(100, this.H - this.opts.top - this.opts.bottom);
    const fit = availH / AH;
    this.z = this.opts.touch ? Math.min(3, Math.max(fit, 1.9)) : Math.max(1, Math.min(4, fit));
    const viewW = this.W / this.z;
    const viewH = availH / this.z;
    const fx = this.me.x + this.me.facing * 24;
    const cx = AW <= viewW ? AW / 2 : Math.max(viewW / 2, Math.min(AW - viewW / 2, fx));
    const cy = AH <= viewH ? AH / 2 : Math.max(viewH / 2, Math.min(AH - viewH / 2, this.me.y - 30));
    this.camX += (cx - this.camX) * 0.12;
    this.camY += (cy - this.camY) * 0.15;
    this.ox = Math.round(this.W / 2 - this.camX * this.z);
    this.oy = Math.round(this.opts.top + availH / 2 - this.camY * this.z);
  }

  private frame(t: number) {
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    this.resize();
    this.parts.update(dt, 0.1);
    this.think(dt, t);
    this.draw();
    if (!this.ready && this.ground) {
      this.ready = true;
      this.canvas.dataset.ready = '1';
      this.emit({ t: 'ready' });
    }
  }

  private think(dt: number, now: number) {
    const me = this.me;
    const wall = Date.now();
    const downed = this.downed(wall);
    let ix = 0;
    if (this.keys.has('arrowleft') || this.keys.has('a')) ix -= 1;
    if (this.keys.has('arrowright') || this.keys.has('d')) ix += 1;
    if (this.stick) {
      ix = Math.abs(this.stick.dx) < 0.2 ? 0 : this.stick.dx;
      // push the stick up to jump, down to drop off a ledge (once per push)
      const up = this.stick.dy < -0.62;
      const dn = this.stick.dy > 0.66;
      if (up && !this.stickUp) this.jump();
      if (dn && !this.stickDown) this.drop();
      this.stickUp = up;
      this.stickDown = dn;
    } else {
      this.stickUp = false;
      this.stickDown = false;
    }
    let moving = false;
    const spectator = Boolean(this.snap?.me.spectator);
    if (spectator) {
      // on the balcony: walk along it, no jumping
      me.y = BALCONY.y;
      me.vy = 0;
      me.grounded = true;
      if (ix) {
        me.x = Math.max(BALCONY.x0, Math.min(BALCONY.x1, me.x + ix * SPEED * dt));
        me.facing = ix > 0 ? 1 : -1;
        moving = true;
      }
    } else if (this.dash && !downed) {
      // the dash carries you, even through the air; the first fighter in your path is hit
      const k = Math.min(1, (now - this.dash.at) / DASH_MS);
      me.x = Math.max(WALL_L + 4, Math.min(WALL_R - 4, this.dash.from[0] + this.dash.dir * DASH_PX * k));
      me.vy = 0;
      me.facing = this.dash.dir < 0 ? -1 : 1;
      if (!this.dash.hit) {
        const foe = this.targets().find((o) => o.v && o.v.on && !(o.v.ko && wall - o.v.ko < 4500) && wall >= o.v.sh && Math.abs(o.x - me.x) < (o.id === 'boss' ? BOSS_HALF : 12) && (o.id === 'boss' ? me.y > o.y - BOSS_TALL : Math.abs(o.y - me.y) < 14));
        if (foe) {
          this.dash.hit = true;
          this.fx.slash(me.x, me.y, me.facing, wall, true, trailColor(this.snap?.me.trail));
          this.fx.shake(160, 1.8, wall);
          this.emit({ t: 'power', p: 'dash-hit', targets: [foe.id], x: me.x, y: me.y });
        }
      }
      if (k >= 1) this.dash = null;
      moving = true;
    } else {
      // run, fall, land: the floor and the ledges hold you (from above), the walls stop you
      const run = downed ? 0 : ix * SPEED;
      me.x = Math.max(WALL_L + 4, Math.min(WALL_R - 4, me.x + (run + this.knock) * dt));
      this.knock *= Math.exp(-7 * dt);
      if (Math.abs(this.knock) < 2) this.knock = 0;
      const prevY = me.y;
      const wasGrounded = Boolean(me.grounded);
      me.vy = Math.min(MAX_FALL, (me.vy ?? 0) + GRAVITY * dt);
      let ny = me.y + me.vy * dt;
      let landed = false;
      if (me.vy >= 0) {
        for (const l of LEDGES) {
          if (now < this.dropUntil && Math.abs(l.y - this.dropY) < 1) continue;
          if (me.x >= l.x0 - 2 && me.x <= l.x1 + 2 && prevY <= l.y + 0.5 && ny >= l.y) {
            ny = l.y;
            landed = true;
            break;
          }
        }
        if (!landed && ny >= GROUND) {
          ny = GROUND;
          landed = true;
        }
      }
      if (me.vy < 0 && ny < 4) ny = 4;
      me.y = ny;
      if (landed) {
        if (!wasGrounded && me.vy > 200) this.parts.burst('dust', me.x, me.y, 6, 16, 8, ['#8a7a94', '#5a4a62'], 0.4);
        me.vy = 0;
        me.grounded = true;
        this.lastGround = now;
      } else me.grounded = false;
      if (ix && !downed) me.facing = ix > 0 ? 1 : -1;
      moving = Math.abs(run) > 1 || !me.grounded;
    }
    me.tx = me.x;
    me.ty = me.y;
    const swinging = now < this.swingUntil && !downed;
    const want: Pose = swinging ? 'swing' : moving ? 'walk' : 'idle';
    if (me.pose !== want) {
      me.pose = want;
      me.since = now;
    }
    // embers drift up from the fires
    if (now - this.lastEmber > 140) {
      this.lastEmber = now;
      const src = HALL_TORCHES[Math.floor(Math.random() * HALL_TORCHES.length)];
      this.parts.spawn('ember', src[0] + (Math.random() - 0.5) * 4, src[1], { vx: (Math.random() - 0.5) * 6, vy: -8 - Math.random() * 8, life: 0.9 + Math.random() * 0.6, c: Math.random() < 0.5 ? '#ffb43d' : '#ff6a2a' });
    }
    // pick up whatever you walk over
    for (const it of this.snap?.pickups ?? []) {
      if (Math.hypot(it.x - me.x, it.y - me.y) < 12 && wall - (this.grabbed.get(it.i) ?? 0) > 1500 && this.fighting()) {
        this.grabbed.set(it.i, wall);
        this.emit({ t: 'grab', i: it.i });
      }
    }
    // your shards in flight
    for (const sh of this.myShots) {
      if (sh.done) continue;
      const step = SHOT_SPEED * dt;
      sh.x += sh.dx * step;
      sh.y += sh.dy * step;
      sh.left -= step;
      if (sh.left <= 0 || !inHall(sh.x, sh.y) || sh.y >= GROUND - 1) {
        sh.done = true;
        continue;
      }
      const foe = this.targets().find((o) => o.v && o.v.on && !(o.v.ko && wall - o.v.ko < 4500) && wall >= o.v.sh && (o.id === 'boss' ? Math.abs(o.x - sh.x) < BOSS_HALF && sh.y > o.y - BOSS_TALL && sh.y <= o.y : Math.hypot(o.x - sh.x, o.y - 10 - sh.y) < 10));
      if (foe) {
        sh.done = true;
        this.parts.burst('gold', sh.x, sh.y, 6, 20, 14, ['#ffd24a', '#fff1a8'], 0.4);
        this.emit({ t: 'strike', w: sh.w, target: foe.id, x: sh.x, y: sh.y + 10 });
      }
    }
    this.myShots = this.myShots.filter((s) => !s.done);
    // Pet Assist: your pet nips a fighter next to you every few seconds
    const s = this.snap;
    if (s && s.me.passive === 'pet' && this.look.pet && this.fighting() && !downed && wall - this.lastPet > 3000) {
      const foe = this.targets().find((o) => o.v && o.v.on && !(o.v.ko && wall - o.v.ko < 4500) && wall >= o.v.sh && Math.hypot(o.x - me.x, o.y - me.y) < 28);
      if (foe) {
        this.lastPet = wall;
        this.parts.burst('star', foe.x, foe.y - 8, 4, 14, 10, ['#ffffff', '#c7f284'], 0.35);
        this.emit({ t: 'strike', w: 'pet', target: foe.id, x: me.x, y: me.y });
      }
    }
    // others glide toward where they said they are going
    for (const p of this.others.values()) {
      // ease toward where they said they are (jumps and falls are quick, so follow fast)
      const dx = p.view.tx - p.x;
      const dy = p.view.ty - p.y;
      const d = Math.hypot(dx, dy);
      const k = Math.min(1, dt * 12);
      if (d > 0.3) {
        p.x += dx * k;
        p.y += dy * k;
        if (Math.abs(dx) > 0.5) p.facing = dx > 0 ? 1 : -1;
      }
      const air = p.y < surfaceBelow(p.x, p.y) - 1.5;
      const pw: Pose = d > 0.5 || air ? 'walk' : (/^dance[123]$/.test(p.view.p) || p.view.p === 'cheer' ? p.view.p : 'idle') as Pose;
      if (p.pose !== pw) {
        p.pose = pw;
        p.since = now;
      }
    }
    // tell the app where we are
    if (performance.now() - this.lastEmit > 60) {
      this.lastEmit = performance.now();
      const pose = swinging ? 'swing' : moving ? 'walk' : 'idle';
      const key = `${Math.round(me.x)},${Math.round(me.y)},${Math.round(me.tx)},${Math.round(me.ty)},${pose},${me.facing}`;
      if (key !== this.lastEmitKey) {
        this.lastEmitKey = key;
        this.emit({ t: 'me', x: me.x, y: me.y, tx: me.tx, ty: me.ty, facing: me.facing, pose });
      }
    }
  }

  /* ---------------- drawing ---------------- */
  private draw() {
    const c = this.c;
    const dpr = this.dpr;
    const wall = Date.now();
    const now = performance.now();
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.imageSmoothingEnabled = false;
    c.fillStyle = '#120c1a';
    c.fillRect(0, 0, this.W, this.H);
    if (!this.ground) return;
    const [shx, shy] = this.fx.offset(wall, reducedMotion());
    const z = this.z;
    const ox = this.ox - shx * z;
    const oy = this.oy - shy * z;
    const sx = (x: number) => ox + x * z;
    const sy = (y: number) => oy + y * z;
    c.drawImage(this.ground, ox, oy, AW * z, AH * z);
    const s = this.snap;
    // the crowd on the balcony bobs, and jumps with their arms up when someone cheers or lands a KO
    const loud = (s?.cheers ?? []).filter((ch) => wall - ch.at < 1200).length;
    for (const f of this.crowd) {
      const wild = loud > 0 && (f.ph + Math.floor(wall / 90)) % 7 < loud + 1;
      const hop = wild ? (Math.floor(wall / 120 + f.ph) % 2) * 2 : Math.floor(((wall / 300 + f.ph) % 4) / 3);
      drawFan(c, f, sx, sy, z, hop, wild || (f.ph + Math.floor(wall / 700)) % 23 === 0);
    }
    // torch flames on the pillars
    HALL_TORCHES.forEach(([tx, ty], i) => {
      c.fillStyle = '#3a2a1a';
      c.fillRect(sx(tx - 1), sy(ty), 3 * z, 5 * z);
      drawFlame(c, sx(tx + 0.5), sy(ty), z, wall, i, 1.1);
    });
    // King of the Hill: the throne glows
    if (s?.match.mode === 'koth') {
      c.save();
      c.globalAlpha = 0.45 + 0.2 * Math.sin(wall / 300);
      c.fillStyle = '#ffd24a';
      c.fillRect(sx(THRONE.x0 - 2), sy(THRONE.y), (THRONE.x1 - THRONE.x0 + 4) * z, Math.max(1, z));
      c.globalAlpha *= 0.4;
      c.fillRect(sx(THRONE.x0), sy(THRONE.y - 14), (THRONE.x1 - THRONE.x0) * z, 14 * z);
      c.restore();
      text(c, 'THRONE', Math.round(sx((THRONE.x0 + THRONE.x1) / 2) - (textWidth('THRONE') * z) / 2), Math.round(sy(THRONE.y + 9)), Math.max(1, Math.round(z)), '#ffd84a', '#1a0c10');
    }
    // pickups
    for (const it of s?.pickups ?? []) {
      const bob = Math.round(Math.sin(wall / 260 + it.i) * 1.5);
      const X = sx(it.x);
      const Y = sy(it.y - 4 + bob);
      c.fillStyle = 'rgba(0,0,0,0.25)';
      c.fillRect(X - 4 * z, sy(it.y) - z, 8 * z, 2 * z);
      if (it.k === 'ore') {
        c.fillStyle = '#ffd24a';
        c.fillRect(X - 3 * z, Y - 4 * z, 6 * z, 5 * z);
        c.fillStyle = '#fff1a8';
        c.fillRect(X - 2 * z, Y - 4 * z, 2 * z, 2 * z);
        c.fillStyle = '#c9861a';
        c.fillRect(X + 1 * z, Y - 1 * z, 2 * z, 2 * z);
      } else if (it.k === 'heart') {
        c.fillStyle = '#ff4f5e';
        c.fillRect(X - 4 * z, Y - 5 * z, 3 * z, 3 * z);
        c.fillRect(X + 1 * z, Y - 5 * z, 3 * z, 3 * z);
        c.fillRect(X - 4 * z, Y - 3 * z, 8 * z, 2 * z);
        c.fillRect(X - 3 * z, Y - 1 * z, 6 * z, 1 * z);
        c.fillRect(X - 1 * z, Y, 2 * z, 1 * z);
      } else {
        c.strokeStyle = '#7fe3ff';
        c.lineWidth = Math.max(1, z);
        c.beginPath();
        c.arc(X, Y - 2 * z, 4 * z, 0, Math.PI * 2);
        c.stroke();
        c.fillStyle = 'rgba(127,227,255,0.35)';
        c.fill();
      }
    }
    // the Two-Mouthed: its warning first (under everyone), then the boss
    const boss = s?.match.boss;
    if (boss && (boss.hp > 0 || s?.match.phase === 'end')) this.drawBoss(boss, sx, sy, z, wall, s?.match.phase === 'end' && boss.hp <= 0);
    // people: the boss stands behind them all
    const b = s?.brawl;
    const fighter = (id: string, look: Look, body: Mover, mine: boolean, spectator: boolean, fxp: { p: string; at: number } | null) => {
      const X = sx(body.x);
      const floor = spectator ? body.y : surfaceBelow(body.x, body.y);
      const Y = sy(floor);
      const v = b ? (mine ? b.me : b.peers[id]) : undefined;
      const ko = v ? koAge(v, wall) : -1;
      const lift = ko >= 0 ? 0 : Math.max(0, floor - body.y);
      if (look.pet && !spectator) drawPet(c, look.pet, now, X - 15 * z * body.facing, sy(body.y) + 1 * z, z, body.facing);
      if (ko < 0 || !drawKo(c, look, X, sy(body.y), z, body.facing, ko, wall)) {
        const sw = !mine && v && v.sw && wall - v.sw < 540 ? wall - v.sw : -1;
        const swAge = sw >= 0 ? sw : mine && wall - this.lastSwing < 540 ? wall - this.lastSwing : -1;
        const pose: Pose = sw >= 0 ? 'swing' : spectator && body.pose === 'idle' && s?.cheers.some((ch) => ch.id === id && wall - ch.at < 1400) ? 'cheer' : body.pose;
        const f = sw >= 0 ? Math.min(5, Math.floor(sw / 90)) : lift > 0 && pose === 'walk' ? 1 : frameAt(pose, body.since, now);
        drawMiner(c, look, pose, f, X, Y, z, body.facing, hitFlash(v, wall) ? 0.45 : 1, lift, swingTilt(swAge, body.facing));
      }
      const FY = sy(body.y);
      // Pickaxe Guard: a blue shield in front
      const guarding = mine ? (s?.me.guardUntil ?? 0) > wall : fxp && fxp.p === 'guard' && wall - fxp.at < 1500;
      if (guarding) {
        c.fillStyle = 'rgba(127,227,255,0.5)';
        c.fillRect(X + body.facing * 7 * z - (body.facing < 0 ? 3 * z : 0), FY - 22 * z, 3 * z, 18 * z);
      }
      if (v && v.on && !spectator && b?.on) {
        if (v.sh) drawShield(c, X, FY, z, wall, v.sh);
        if (ko < 0) drawHp(c, v, X, FY, z, wall, mine);
      }
    };
    const me = this.me;
    if (s) {
      for (const p of this.others.values()) fighter(p.view.id, p.view.look, p, false, p.view.spectator, p.view.fx);
      fighter(s.me.id, this.look, me, true, s.me.spectator, null);
    }
    // shards in flight: yours, and others' as they told us
    const shard = (x: number, y: number) => {
      const r = Math.floor(wall / 60) % 2;
      c.fillStyle = '#ffd24a';
      c.fillRect(sx(x) - 2 * z, sy(y) - (r ? 1 : 2) * z, 4 * z, (r ? 2 : 4) * z);
      c.fillStyle = '#fff1a8';
      c.fillRect(sx(x) - 1 * z, sy(y) - 1 * z, 1 * z, 1 * z);
    };
    for (const sh of this.myShots) shard(sh.x, sh.y);
    for (const sh of s?.shots ?? []) {
      const d = ((wall - sh.at) / 1000) * SHOT_SPEED;
      if (d > THROW_RANGE) continue;
      shard(sh.x + sh.dx * d, sh.y + sh.dy * d);
    }
    this.parts.draw(c, ox, oy, z);
    drawGlow(c, HALL_TORCHES.map(([tx, ty]) => [sx(tx), sy(ty - 4), 46] as [number, number, number]), z, wall);
    this.fx.draw(c, ox, oy, z, wall);
    // names
    const fs = Math.max(1, Math.round(z * 0.8));
    const tag = (name: string, x: number, y: number, col: string) => {
      const w = textWidth(name) * fs;
      const X = Math.round(sx(x) - w / 2);
      const Y = Math.round(sy(y - 36));
      c.fillStyle = 'rgba(7,13,32,0.72)';
      c.fillRect(X - 2 * fs, Y - fs, w + 4 * fs, 8 * fs);
      text(c, name, X, Y, fs, col);
    };
    if (s) {
      for (const p of this.others.values()) tag(p.view.name, p.x, p.y, p.view.spectator ? '#8ea2cc' : '#ffffff');
      tag('YOU', me.x, me.y, '#ffd24a');
      // King of the Hill: a crown on the leader
      if (s.match.mode === 'koth') {
        const lead = Object.entries(s.match.score).sort((a, bb) => bb[1] - a[1])[0];
        const body = lead ? (lead[0] === s.me.id ? me : this.others.get(lead[0])) : null;
        if (body) {
          c.fillStyle = '#ffd24a';
          const X = sx(body.x) - 4 * z;
          const Y = sy(body.y - 46);
          c.fillRect(X, Y + 2 * z, 8 * z, 3 * z);
          c.fillRect(X, Y, 2 * z, 2 * z);
          c.fillRect(X + 3 * z, Y - z, 2 * z, 3 * z);
          c.fillRect(X + 6 * z, Y, 2 * z, 2 * z);
        }
      }
    }
    drawVignette(c, this.W, this.H);
    if (boss && boss.hp > 0 && s?.match.phase !== 'wait') this.drawBossBar(boss, wall);
    // the stick: always shown on a phone, bright while you hold it
    if (this.opts.touch && !s?.me.spectator) {
      const b = this.stickBase();
      const st = this.stick;
      const x0 = st ? st.x0 : b.x;
      const y0 = st ? st.y0 : b.y;
      c.globalAlpha = st ? 0.7 : 0.35;
      c.fillStyle = 'rgba(8,13,32,0.6)';
      c.beginPath();
      c.arc(x0, y0, STICK_R, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = '#ffd24a';
      c.lineWidth = 2;
      c.stroke();
      c.fillStyle = '#ffd24a';
      c.beginPath();
      c.arc(x0 + (st?.dx ?? 0) * (STICK_R - 18), y0 + (st?.dy ?? 0) * (STICK_R - 18), 22, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 1;
    }
    // PC: a small crosshair where your throws go
    const aiming = !this.opts.touch && Boolean(this.aim) && this.fighting();
    const cur = aiming ? 'none' : 'default';
    if (this.canvas.style.cursor !== cur) this.canvas.style.cursor = cur;
    if (aiming && this.aim) {
      const X = Math.round(sx(this.aim[0]));
      const Y = Math.round(sy(this.aim[1]));
      c.fillStyle = (s?.me.ammo ?? 0) > 0 ? 'rgba(255,210,74,0.85)' : 'rgba(142,162,204,0.6)';
      c.fillRect(X - 7, Y - 1, 5, 2);
      c.fillRect(X + 2, Y - 1, 5, 2);
      c.fillRect(X - 1, Y - 7, 2, 5);
      c.fillRect(X - 1, Y + 2, 2, 5);
    }
  }

  /* ---------------- the Two-Mouthed ---------------- */
  private roarAt = 0;
  private deathAt = 0;
  /**
   * The boss, its warnings and what its attacks look like. The host decides when an attack lands; here
   * the wind-up shows as a red zone where it will hit and a flashing mark over its head, then the hit
   * shakes the hall. Blood drips from its tongue and the leg it holds.
   */
  private drawBoss(boss: NonNullable<ArenaSnap['match']['boss']>, sx: (x: number) => number, sy: (y: number) => number, z: number, wall: number, dying: boolean) {
    const c = this.c;
    const p2 = boss.hp <= boss.max / 2;
    const wind = p2 ? BOSS_WIND2_MS : BOSS_WIND_MS;
    const t = boss.atk ? wall - boss.atkAt : 0;
    const f = boss.facing;
    // the moment an attack starts, and the moment it lands
    const key = boss.atk ? `${boss.atk}:${Math.round(boss.atkAt / 50)}` : '';
    if (key && key !== this.lastAtkKey && t < wind) {
      this.lastAtkKey = key;
      this.emit({ t: 'sfx', name: 'pop' });
    }
    const landedKey = `${key}:hit`;
    if (key && t >= wind && t < wind + BOSS_ACT_MS && this.lastAtkKey !== landedKey && (this.lastAtkKey === key || this.lastAtkKey === '')) {
      this.lastAtkKey = landedKey;
      const words: Record<BossAtk, [string, string]> = { sweep: ['SWEEP!', '#ff8a3d'], tongue: ['LASH!', '#ff4f5e'], roar: ['ROAAAR!', '#ffd84a'] };
      const [w, col] = words[boss.atk as BossAtk];
      this.fx.say(boss.x, boss.y - BOSS_TALL - 6, w, col, wall);
      this.fx.shake(boss.atk === 'roar' ? 420 : 260, boss.atk === 'roar' ? 3.4 : 2.6, wall);
      this.emit({ t: 'sfx', name: 'slam' });
      if (boss.atk === 'sweep') this.parts.burst('dust', boss.x + f * 30, GROUND, 18, 50, 14, ['#8a7a94', '#c8b8d0'], 0.6);
      if (boss.atk === 'roar') this.roarAt = wall;
    }
    // the warning: where it is about to hit
    if (boss.atk && t < wind && !dying) {
      const a = 0.22 + 0.18 * Math.sin(wall / 55);
      c.save();
      c.fillStyle = `rgba(255,40,40,${a})`;
      c.strokeStyle = `rgba(255,90,70,${Math.min(1, a * 2.6)})`;
      c.lineWidth = Math.max(1, z);
      if (boss.atk === 'sweep') {
        c.fillRect(sx(boss.x - SWEEP_REACH), sy(GROUND - 12), SWEEP_REACH * 2 * z, 12 * z);
        c.strokeRect(sx(boss.x - SWEEP_REACH), sy(GROUND - 12), SWEEP_REACH * 2 * z, 12 * z);
      } else if (boss.atk === 'tongue') {
        const x0 = f > 0 ? boss.x : boss.x - TONGUE_REACH;
        c.fillRect(sx(x0), sy(GROUND - 64), TONGUE_REACH * z, 64 * z);
        c.strokeRect(sx(x0), sy(GROUND - 64), TONGUE_REACH * z, 64 * z);
      } else {
        c.beginPath();
        c.ellipse(sx(boss.x), sy(GROUND), ROAR_REACH * z, 90 * z, 0, Math.PI, Math.PI * 2);
        c.closePath();
        c.fill();
        c.stroke();
      }
      c.restore();
      if (Math.floor(wall / 120) % 2 === 0) {
        const sc = Math.max(2, Math.round(z * 2));
        text(c, '!', Math.round(sx(boss.x) - (textWidth('!') * sc) / 2), Math.round(sy(boss.y - BOSS_TALL - 22)), sc, '#ff4f5e', '#1a0c10');
      }
    }
    // the roar's shock ring
    const ra = wall - this.roarAt;
    if (this.roarAt && ra < 520) {
      const k = ra / 520;
      c.save();
      c.globalAlpha = 1 - k;
      c.strokeStyle = '#ffd84a';
      c.lineWidth = Math.max(1, 2 * z);
      c.beginPath();
      c.ellipse(sx(boss.x), sy(boss.y - 60), (20 + k * ROAR_REACH) * z, (14 + k * 70) * z, 0, 0, Math.PI * 2);
      c.stroke();
      c.restore();
    }
    // knocked down: it sinks and fades
    let alpha = 1;
    let sink = 0;
    if (dying) {
      if (!this.deathAt) this.deathAt = wall;
      const k = Math.min(1, (wall - this.deathAt) / 1400);
      alpha = 1 - k;
      sink = k * 14;
      if (k < 1 && Math.random() < 0.3) this.parts.burst('smoke', boss.x + (Math.random() - 0.5) * 40, GROUND, 1, 10, 6, ['#3a2a3a', '#5a4a5a'], 0.9);
    } else this.deathAt = 0;
    // a shadow on the floor
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.beginPath();
    c.ellipse(sx(boss.x), sy(GROUND), 30 * z, 4 * z, 0, 0, Math.PI * 2);
    c.fill();
    const tips = drawTwoMouthed(c, sx(boss.x), sy(boss.y + sink), z, { facing: f, wall, atk: dying ? null : boss.atk, t, wind, act: BOSS_ACT_MS, p2, flash: Boolean(boss.hitAt && wall - boss.hitAt < 120) }, alpha);
    // blood drips from the tongue and the leg it holds
    const now = performance.now();
    if (tips && !dying && now - this.lastDrip > 240) {
      this.lastDrip = now;
      const [dx, dy] = Math.random() < 0.55 ? tips.tongue : tips.weapon;
      const x = boss.x + dx;
      const y = boss.y + dy;
      if (y < GROUND - 2) this.parts.spawn('drip', x, GROUND, { z: GROUND - y, vz: -25, life: 1.6, c: Math.random() < 0.5 ? '#9a1018' : '#c42028' });
    }
  }
  /** The boss's name and HP across the top of the screen, like a proper boss fight. */
  private drawBossBar(boss: NonNullable<ArenaSnap['match']['boss']>, wall: number) {
    const c = this.c;
    const fr = Math.max(0, boss.hp / boss.max);
    const p2 = fr <= 0.5;
    const w = Math.round(Math.min(this.W * 0.62, 460));
    const h = 8;
    const x = Math.round((this.W - w) / 2);
    const y = Math.round(this.opts.top + 22);
    const name = 'THE TWO-MOUTHED';
    const sc = 2;
    // a dark plate so the name reads over the crowd
    c.fillStyle = 'rgba(10,6,12,0.72)';
    c.fillRect(x - 14, y - 22, w + 28, h + 30);
    text(c, name, Math.round(this.W / 2 - (textWidth(name) * sc) / 2), y - 16, sc, '#f2e6c8', '#1a0c10');
    if (p2) text(c, 'ENRAGED', x + w - textWidth('ENRAGED') * 1 - 2, y - 10, 1, Math.floor(wall / 250) % 2 ? '#ff4f5e' : '#ff8a3d', '#1a0c10');
    c.fillStyle = '#0c0608';
    c.fillRect(x - 3, y - 3, w + 6, h + 6);
    c.fillStyle = '#8a6a3a';
    c.fillRect(x - 2, y - 2, w + 4, 1);
    c.fillRect(x - 2, y + h + 1, w + 4, 1);
    c.fillStyle = '#2a0c10';
    c.fillRect(x, y, w, h);
    c.fillStyle = p2 ? (Math.floor(wall / 300) % 2 ? '#c41a24' : '#a8121c') : '#b8202a';
    c.fillRect(x, y, Math.round(w * fr), h);
    c.fillStyle = 'rgba(255,255,255,0.25)';
    c.fillRect(x, y, Math.round(w * fr), 2);
    c.fillStyle = '#0c0608';
    for (let k = 1; k < 10; k++) c.fillRect(Math.round(x + (w * k) / 10), y, 1, h);
  }

  /* ---------------- clips ---------------- */
  /**
   * Record a few seconds of the canvas after a knockout (the fall, the dance, the K.O. pop), and hand
   * the app a video it can offer to save or share. One clip at a time.
   */
  private clip() {
    if (this.recorder || typeof MediaRecorder === 'undefined' || typeof this.canvas.captureStream !== 'function') return;
    try {
      const stream = this.canvas.captureStream(30);
      const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported?.(m)) ?? '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 2_500_000 } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size) chunks.push(e.data);
      };
      rec.onstop = () => {
        this.recorder = null;
        stream.getTracks().forEach((t) => t.stop());
        if (!chunks.length) return;
        const blob = new Blob(chunks, { type: rec.mimeType || mime || 'video/webm' });
        this.emit({ t: 'clip', url: URL.createObjectURL(blob), mime: blob.type });
      };
      rec.start(250);
      this.recorder = { rec, chunks, until: Date.now() + 3600 };
      setTimeout(() => {
        try {
          rec.stop();
        } catch {
          this.recorder = null;
        }
      }, 3600);
    } catch {
      this.recorder = null;
    }
  }
}
