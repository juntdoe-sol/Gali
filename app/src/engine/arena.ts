/**
 * The Arena, drawn and played: one screen, the whole pit in view.
 *
 * A sand oval with four stone pillars and a ring in the middle, walled in, with stands full of a pixel
 * crowd along the top. Fighters move with WASD or the arrows (PC) or the stick (phone). On PC the left mouse
 * button swings, the right throws ORE at the cursor, Space jumps, and every unlocked power has its own key
 * (Q E R C V X, or 1 to 6). F and G still swing and throw. Spectators stand in the stands and cheer.
 *
 * The engine owns movement, aiming and the flight of your own ORE shards (it knows where everyone is
 * drawn), and tells the app what landed. The app (game/arena.ts, game/brawl.ts) owns the rules.
 * It can also record a short clip of the canvas after a knockout, for sharing.
 */
import { canvasDpr, reducedMotion } from './screen';
import { ctx2d, text, textWidth, loadAtlas, type Ctx } from './art';
import { drawMiner, drawPet, frameAt, type Body } from './actors';
import { drawHp, drawKo, drawShield, FightFx, hitFlash, jumpLift, koAge, pickTarget, swingTilt } from './brawlfx';
import { Particles } from './particles';
import type { BrawlSnap, Look, Pose } from './types';
import { AH, AW, FLOOR, onFloor, PILLARS, PILLAR_R, RING, spawnAt, standsSpot, STANDS, THROW_RANGE, type Pickup, type Shot } from '../game/arenaMap';
import { trailColor } from '../game/trails';
import { BOSS_EYE, bossSprite, drawFan, drawFlags, drawFlame, drawGlow, drawPillar, drawVignette, makeCrowd, paintArena, TORCHES, type Fan } from './arenaArt';

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
  match: { n: number; mode: string; phase: string; fighters: string[]; out: string[]; score: Record<string, number>; boss: { x: number; y: number; hp: number; max: number; slamAt: number; hitAt: number; facing: 1 | -1 } | null };
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

const SPEED = 62;
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
  private dash: { from: [number, number]; dir: number; at: number; hit: boolean } | null = null;
  private slamAt = 0;
  private myShots: MyShot[] = [];
  private lastPet = 0;
  private lastRs = -1;
  private lastN = -1;
  private lastHit = 0;
  private myHp = 100;
  private seen = new Map<string, { hp: number; sw: number; ko: number; fx: number; fxAt: number }>();
  private lastBossSlam = 0;
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
    this.me = { x, y, path: [], pose: 'idle', since: 0, facing: 1, tx: x, ty: y };
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
      window.removeEventListener('keydown', this.onKey);
      window.removeEventListener('keyup', this.onKeyUp);
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
    this.ground = paintArena();
    this.crowd = makeCrowd();
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
      const dx = me.x - b.me.hx;
      const d = Math.abs(dx) || 1;
      for (let i = 0; i < 12; i++) {
        const nx = me.x + dx / d;
        if (!onFloor(nx, me.y)) break;
        me.x = nx;
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
      if (boss.slamAt && boss.slamAt !== this.lastBossSlam && wall - boss.slamAt < 800) {
        this.lastBossSlam = boss.slamAt;
        this.parts.burst('dust', boss.x, boss.y, 18, 46, 18, ['#d8c8a8', '#f2e6c8'], 0.7);
        this.fx.shake(260, 2.6, wall);
        this.fx.say(boss.x, boss.y - 46, 'SLAM!', '#ff8a3d', wall);
        this.emit({ t: 'sfx', name: 'slam' });
      }
      if (boss.hitAt && boss.hitAt !== this.lastBossHit && wall - boss.hitAt < 600) {
        this.lastBossHit = boss.hitAt;
        this.parts.burst('star', boss.x, boss.y - 24, 6, 26, 22, ['#ffffff', '#ffd84a'], 0.45);
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
      me.facing = x < FLOOR.cx ? 1 : -1;
    }
    me.tx = me.x;
    me.ty = me.y;
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
    if (!t && boss && boss.hp > 0 && Math.hypot(boss.x - me.x, (boss.y - me.y) * 1.6) < 36) t = { id: 'boss', facing: boss.x >= me.x ? 1 : -1 };
    if (t) me.facing = t.facing;
    this.swingUntil = performance.now() + 540;
    me.pose = 'swing';
    me.since = performance.now();
    this.fx.slash(me.x, me.y, me.facing, wall, Boolean(t), trailColor(this.snap?.me.trail));
    if (t) this.fx.shake(140, 1.4, wall + 200);
    this.emit({ t: 'swing', target: t?.id ?? null, x: me.x, y: me.y });
    this.emit({ t: 'sfx', name: 'swing' });
  }

  jump() {
    const wall = Date.now();
    if (this.downed(wall) || wall - this.myJumpAt < 600) return;
    this.myJumpAt = wall;
    this.parts.burst('dust', this.me.x, this.me.y, 5, 14, 8, ['#f2e6c8', '#d8c8a8'], 0.4);
    this.emit({ t: 'jump' });
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
      this.emit({ t: 'power', p, targets: [], x: me.x, y: me.y });
      setTimeout(() => {
        // land: everyone close takes it
        const hit = this.targets().filter((o) => o.v && o.v.on && !(o.v.ko && wall - o.v.ko < 4500) && Date.now() >= o.v.sh && Math.hypot(o.x - me.x, (o.y - me.y) * 1.4) <= SLAM_R).map((o) => o.id);
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
      const hit = this.targets().filter((o) => o.v && o.v.on && !(o.v.ko && wall - o.v.ko < 4500) && wall >= o.v.sh && Math.hypot(o.x - me.x, (o.y - me.y) * 1.4) <= (o.id === 'boss' ? SPIN_R + 10 : SPIN_R)).map((o) => o.id);
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
      window.addEventListener('keydown', this.onKey);
      window.addEventListener('keyup', this.onKeyUp);
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
    // powers: the letter keys, or 1 to 6, in the same order
    const slot = SLOT_KEYS.indexOf(k) >= 0 ? SLOT_KEYS.indexOf(k) : /^[1-6]$/.test(k) ? Number(k) - 1 : -1;
    if (down && !e.repeat) {
      if (k === 'f') this.attack();
      else if (k === ' ') this.jump();
      else if (k === 'g') this.throwOre(this.aim);
      else if (k === 'shift') this.power('dash');
      else if (slot >= 0) this.power(SLOT_IDS[slot]);
    }
    if (['f', ' ', 'g'].includes(k) || slot >= 0) e.preventDefault();
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
    // the whole pit in view between the app's bars; on a narrow phone, closer in and following you
    const availH = Math.max(100, this.H - this.opts.top - this.opts.bottom);
    const fit = Math.min(this.W / AW, availH / AH);
    if (fit >= 1.8) {
      this.z = Math.max(1, fit);
      this.ox = Math.round((this.W - AW * this.z) / 2);
      this.oy = Math.round(this.opts.top + (availH - AH * this.z) / 2);
    } else {
      // phones: close enough to see the fight, never tiny (the buttons float over the edges)
      this.z = Math.max(fit, this.opts.touch ? Math.min(2.4, Math.max(1.9, availH / AH)) : Math.min(2.4, availH / AH));
      const viewW = this.W / this.z;
      const viewH = availH / this.z;
      const cx = Math.max(viewW / 2, Math.min(AW - viewW / 2, this.me.x));
      const cy = Math.max(viewH / 2, Math.min(AH - viewH / 2, this.me.y - 20));
      this.camX += ((AW <= viewW ? AW / 2 : cx) - this.camX) * 0.15;
      this.camY += ((AH <= viewH ? AH / 2 : cy) - this.camY) * 0.15;
      this.ox = Math.round(this.W / 2 - this.camX * this.z);
      this.oy = Math.round(this.opts.top + availH / 2 - this.camY * this.z);
    }
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

  private canStand(x: number, y: number) {
    if (this.snap?.me.spectator) return x > 12 && x < AW - 12 && y > STANDS.y0 + 2 && y < STANDS.y1;
    return onFloor(x, y);
  }

  private think(dt: number, now: number) {
    const me = this.me;
    const wall = Date.now();
    const downed = this.downed(wall);
    let ix = 0;
    let iy = 0;
    if (this.keys.has('arrowleft') || this.keys.has('a')) ix -= 1;
    if (this.keys.has('arrowright') || this.keys.has('d')) ix += 1;
    if (this.keys.has('arrowup') || this.keys.has('w')) iy -= 1;
    if (this.keys.has('arrowdown') || this.keys.has('s')) iy += 1;
    if (this.stick) {
      ix = this.stick.dx;
      iy = this.stick.dy;
    }
    if (Math.hypot(ix, iy) < 0.18) {
      ix = 0;
      iy = 0;
    }
    let moving = false;
    if (this.dash && !downed) {
      // the dash carries you; the first fighter in your path is hit
      const k = Math.min(1, (now - this.dash.at) / DASH_MS);
      const nx = this.dash.from[0] + this.dash.dir * DASH_PX * k;
      if (this.canStand(nx, me.y)) me.x = nx;
      me.facing = this.dash.dir < 0 ? -1 : 1;
      if (!this.dash.hit) {
        const foe = this.targets().find((o) => o.v && o.v.on && !(o.v.ko && wall - o.v.ko < 4500) && wall >= o.v.sh && Math.abs(o.x - me.x) < 12 && Math.abs(o.y - me.y) < 10);
        if (foe) {
          this.dash.hit = true;
          this.fx.slash(me.x, me.y, me.facing, wall, true, trailColor(this.snap?.me.trail));
          this.fx.shake(160, 1.8, wall);
          this.emit({ t: 'power', p: 'dash-hit', targets: [foe.id], x: me.x, y: me.y });
        }
      }
      if (k >= 1) this.dash = null;
      moving = true;
    } else if (!downed && (ix || iy)) {
      const n = Math.hypot(ix, iy);
      const sp = SPEED * Math.min(1, n * 1.15);
      const ux = ix / n;
      const uy = iy / n;
      const nx = me.x + ux * sp * dt;
      const ny = me.y + uy * sp * dt;
      if (this.canStand(nx, ny)) {
        me.x = nx;
        me.y = ny;
        moving = true;
      } else if (this.canStand(nx, me.y)) {
        me.x = nx;
        moving = true;
      } else if (this.canStand(me.x, ny)) {
        me.y = ny;
        moving = true;
      }
      if (Math.abs(ux) > 0.25) me.facing = ux > 0 ? 1 : -1;
      me.tx = me.x + ux * 20;
      me.ty = me.y + uy * 20;
    }
    const swinging = now < this.swingUntil && !downed;
    const want: Pose = swinging ? 'swing' : moving ? 'walk' : 'idle';
    if (me.pose !== want) {
      me.pose = want;
      me.since = now;
    }
    if (!moving) {
      me.tx = me.x;
      me.ty = me.y;
    }
    // embers drift up from the fires
    if (now - this.lastEmber > 140) {
      this.lastEmber = now;
      const src = Math.random() < 0.5 ? TORCHES[Math.floor(Math.random() * TORCHES.length)] : ((pp) => [pp[0], pp[1] - 44] as [number, number])(PILLARS[Math.floor(Math.random() * PILLARS.length)]);
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
      if (sh.left <= 0 || !onFloor(sh.x, sh.y + 10, -4)) {
        sh.done = true;
        continue;
      }
      const foe = this.targets().find((o) => o.v && o.v.on && !(o.v.ko && wall - o.v.ko < 4500) && wall >= o.v.sh && Math.hypot(o.x - sh.x, o.y - 10 - sh.y) < (o.id === 'boss' ? 20 : 10));
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
      const dx = p.view.tx - p.x;
      const dy = p.view.ty - p.y;
      const d = Math.hypot(dx, dy);
      const step = SPEED * dt;
      if (d > 0.5) {
        p.x += (dx / d) * Math.min(d, step);
        p.y += (dy / d) * Math.min(d, step);
        if (Math.abs(dx) > 0.5) p.facing = dx > 0 ? 1 : -1;
      }
      const pw: Pose = d > 0.5 ? 'walk' : (/^dance[123]$/.test(p.view.p) || p.view.p === 'cheer' ? p.view.p : 'idle') as Pose;
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
    drawFlags(c, sx, sy, z, wall);
    // the crowd bobs, and jumps with their arms up when someone cheers or lands a KO
    const loud = (s?.cheers ?? []).filter((ch) => wall - ch.at < 1200).length;
    for (const f of this.crowd) {
      const wild = loud > 0 && (f.ph + Math.floor(wall / 90)) % 7 < loud + 1;
      const hop = wild ? (Math.floor(wall / 120 + f.ph) % 2) * 2 : Math.floor(((wall / 300 + f.ph) % 4) / 3);
      drawFan(c, f, sx, sy, z, hop, wild || (f.ph + Math.floor(wall / 700)) % 23 === 0);
    }
    // torch flames on the wall
    TORCHES.forEach(([tx, ty], i) => drawFlame(c, sx(tx + 0.5), sy(ty - 1), z, wall, i));
    // the ring glows in King of the Hill
    if (s?.match.mode === 'koth') {
      c.save();
      c.globalAlpha = 0.35 + 0.15 * Math.sin(wall / 300);
      c.strokeStyle = '#ffd24a';
      c.lineWidth = 2 * z;
      c.beginPath();
      c.ellipse(sx(RING.x), sy(RING.y), RING.r * z, (RING.r / 1.6) * z, 0, 0, Math.PI * 2);
      c.stroke();
      c.restore();
    }
    // pickups
    for (const it of s?.pickups ?? []) {
      const bob = Math.round(Math.sin(wall / 260 + it.i) * 1.5);
      const X = sx(it.x);
      const Y = sy(it.y - 4 + bob);
      c.fillStyle = 'rgba(0,0,0,0.25)';
      c.fillRect(X - 4 * z, sy(it.y), 8 * z, 2 * z);
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
    // pillars (behind or in front of people by depth)
    type Item = { y: number; f: () => void };
    const items: Item[] = [];
    PILLARS.forEach(([px, py], i) => {
      items.push({
        y: py + 2,
        f: () => {
          drawPillar(c, sx(px), sy(py), z);
          drawFlame(c, sx(px), sy(py - 42), z, wall, i + 5, 1.2);
        },
      });
    });
    // the boss: the Mole King
    const boss = s?.match.boss;
    if (boss && boss.hp > 0) {
      items.push({
        y: boss.y,
        f: () => {
          const age = wall - boss.slamAt;
          const up = boss.slamAt && age < 400 ? Math.sin((age / 400) * Math.PI) * 12 : 0;
          const bob = Math.round(Math.sin(wall / 260) * 0.8);
          const flash = Boolean(boss.hitAt && wall - boss.hitAt < 120);
          // claws up when it is ready to slam and someone is close: get out of the red ring
          const near = [this.me, ...this.others.values()].some((o) => Math.hypot(o.x - boss.x, o.y - boss.y) < 50);
          const ready = !boss.slamAt || age > 1900;
          const raise = (ready && near) || (boss.slamAt > 0 && age < 220);
          const X = sx(boss.x);
          const Y = sy(boss.y);
          c.fillStyle = 'rgba(0,0,0,0.35)';
          c.beginPath();
          c.ellipse(X, Y, (20 - up * 0.4) * z, (6 - up * 0.1) * z, 0, 0, Math.PI * 2);
          c.fill();
          if (ready && near) {
            c.save();
            c.globalAlpha = 0.35 + 0.25 * Math.sin(wall / 70);
            c.strokeStyle = '#ff3a3a';
            c.lineWidth = 2 * z;
            c.beginPath();
            c.ellipse(X, Y, 40 * z, 25 * z, 0, 0, Math.PI * 2);
            c.stroke();
            c.restore();
          }
          const spr = bossSprite(raise, flash);
          c.save();
          c.translate(X, Math.round(Y - (48 + up + bob) * z));
          if (boss.facing < 0) c.scale(-1, 1);
          c.drawImage(spr, -26 * z, 0, spr.width * z, spr.height * z);
          // the eye glows
          c.globalCompositeOperation = 'lighter';
          const g = c.createRadialGradient((BOSS_EYE[0] - 26) * z, BOSS_EYE[1] * z, 0, (BOSS_EYE[0] - 26) * z, BOSS_EYE[1] * z, 7 * z);
          g.addColorStop(0, 'rgba(255,60,40,0.7)');
          g.addColorStop(1, 'rgba(255,60,40,0)');
          c.fillStyle = g;
          c.fillRect((BOSS_EYE[0] - 33) * z, (BOSS_EYE[1] - 7) * z, 14 * z, 14 * z);
          c.restore();
          // its HP bar, in a frame, with ticks every tenth
          const w = 60 * z;
          const bx = Math.round(X - w / 2);
          const by = Math.round(sy(boss.y - 58));
          c.fillStyle = '#140a0e';
          c.fillRect(bx - 2 * z, by - 2 * z, w + 4 * z, 7 * z);
          c.fillStyle = '#3a1418';
          c.fillRect(bx, by, w, 3 * z);
          const fr = Math.max(0, boss.hp / boss.max);
          c.fillStyle = fr > 0.5 ? '#ff4f5e' : fr > 0.25 ? '#ff8a3d' : '#ffd24a';
          c.fillRect(bx, by, w * fr, 3 * z);
          c.fillStyle = 'rgba(255,255,255,0.35)';
          c.fillRect(bx, by, w * fr, z);
          c.fillStyle = '#140a0e';
          for (let k = 1; k < 10; k++) c.fillRect(Math.round(bx + (w * k) / 10), by, Math.max(1, Math.round(z / 2)), 3 * z);
          c.fillStyle = '#ffd24a';
          c.fillRect(bx - 2 * z, by - 2 * z, 2 * z, 2 * z);
          c.fillRect(bx + w, by - 2 * z, 2 * z, 2 * z);
          text(c, 'MOLE KING', Math.round(X - (textWidth('MOLE KING') * z) / 2), Math.round(by - 9 * z), Math.max(1, Math.round(z)), '#ffd84a', '#1a0c10');
          if (boss.slamAt && age < 500) {
            c.save();
            c.globalAlpha = 1 - age / 500;
            c.strokeStyle = '#ff8a3d';
            c.lineWidth = 2 * z;
            c.beginPath();
            c.ellipse(X, Y, (12 + age / 12) * z, ((12 + age / 12) / 1.6) * z, 0, 0, Math.PI * 2);
            c.stroke();
            c.restore();
          }
        },
      });
    }
    // people
    const b = s?.brawl;
    const fighter = (id: string, look: Look, body: Mover, mine: boolean, trail: string, spectator: boolean, jumpAt: number | undefined, fxp: { p: string; at: number } | null) => {
      const X = sx(body.x);
      const Y = sy(body.y);
      const v = b ? (mine ? b.me : b.peers[id]) : undefined;
      const ko = v ? koAge(v, wall) : -1;
      const slamUp = mine && this.slamAt && wall - this.slamAt < SLAM_MS ? Math.sin(((wall - this.slamAt) / SLAM_MS) * Math.PI) * 16 : 0;
      const lift = ko >= 0 ? 0 : Math.max(jumpLift(jumpAt, wall), slamUp);
      if (look.pet && !spectator) drawPet(c, look.pet, now, X - 15 * z * body.facing, Y + 1 * z, z, body.facing);
      if (ko < 0 || !drawKo(c, look, X, Y, z, body.facing, ko, wall)) {
        const sw = !mine && v && v.sw && wall - v.sw < 540 ? wall - v.sw : -1;
        const swAge = sw >= 0 ? sw : mine && wall - this.lastSwing < 540 ? wall - this.lastSwing : -1;
        const pose: Pose = sw >= 0 ? 'swing' : lift > 0 && body.pose !== 'walk' ? 'walk' : spectator && body.pose === 'idle' && s?.cheers.some((ch) => ch.id === id && wall - ch.at < 1400) ? 'cheer' : body.pose;
        const f = sw >= 0 ? Math.min(5, Math.floor(sw / 90)) : frameAt(pose, body.since, now);
        drawMiner(c, look, pose, f, X, Y, z, body.facing, hitFlash(v, wall) ? 0.45 : 1, lift, swingTilt(swAge, body.facing));
      }
      // Pickaxe Guard: a blue shield in front
      const guarding = mine ? (s?.me.guardUntil ?? 0) > wall : fxp && fxp.p === 'guard' && wall - fxp.at < 1500;
      if (guarding) {
        c.fillStyle = 'rgba(127,227,255,0.5)';
        c.fillRect(X + body.facing * 7 * z - (body.facing < 0 ? 3 * z : 0), Y - 22 * z, 3 * z, 18 * z);
      }
      if (v && v.on && !spectator && b?.on) {
        if (v.sh) drawShield(c, X, Y - lift * z, z, wall, v.sh);
        if (ko < 0) drawHp(c, v, X, Y, z, wall, mine);
      }
      void trail;
    };
    const me = this.me;
    if (s) {
      items.push({ y: me.y, f: () => fighter(s.me.id, this.look, me, true, s.me.trail, s.me.spectator, this.myJumpAt, null) });
      for (const p of this.others.values()) items.push({ y: p.y, f: () => fighter(p.view.id, p.view.look, p, false, p.view.trail, p.view.spectator, b?.jumps?.[p.view.id], p.view.fx) });
    }
    items.sort((a, bb) => a.y - bb.y);
    for (const it of items) it.f();
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
    drawGlow(c, [...TORCHES.map(([tx, ty]) => [sx(tx), sy(ty - 4), 46] as [number, number, number]), ...PILLARS.map(([px, py]) => [sx(px), sy(py - 46), 40] as [number, number, number])], z, wall);
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
