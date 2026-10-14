/**
 * The Arena, drawn and played: one screen, the whole pit in view.
 *
 * A sand oval with four stone pillars and a ring in the middle, walled in, with stands full of a pixel
 * crowd along the top. Fighters move with WASD, the arrows or the stick; F swings, Space jumps, Q uses the
 * active power, G throws ORE. Spectators stand in the stands and cheer.
 *
 * The engine owns movement, aiming and the flight of your own ORE shards (it knows where everyone is
 * drawn), and tells the app what landed. The app (game/arena.ts, game/brawl.ts) owns the rules.
 * It can also record a short clip of the canvas after a knockout, for sharing.
 */
import { canvasDpr, reducedMotion } from './screen';
import { draw, ctx2d, makeCanvas, text, textWidth, loadAtlas, has, type Ctx } from './art';
import { drawMiner, drawPet, frameAt, moleNames, type Body } from './actors';
import { drawHp, drawKo, drawShield, FightFx, hitFlash, jumpLift, koAge, pickTarget, swingTilt } from './brawlfx';
import { Particles } from './particles';
import type { BrawlSnap, Look, Pose } from './types';
import { AH, AW, FLOOR, onFloor, PILLARS, PILLAR_R, RING, spawnAt, standsSpot, STANDS, THROW_RANGE, type Pickup, type Shot } from '../game/arenaMap';
import { trailColor } from '../game/trails';

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
  me: { id: string; spectator: boolean; ammo: number; active: string | null; passive: string | null; readyAt: number; trail: string; guardUntil: number };
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
}

const SPEED = 62;
const SHOT_SPEED = 170;
const DASH_PX = 52;
const DASH_MS = 180;
const SLAM_MS = 360;
const SLAM_R = 34;

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
  private walkTarget: [number, number] | null = null;
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
  private crowd: { x: number; y: number; c: string; ph: number }[] = [];
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
    const cv = makeCanvas(AW, AH);
    const g = ctx2d(cv);
    const P = (x: number, y: number, w: number, h: number, col: string) => {
      g.fillStyle = col;
      g.fillRect(x, y, w, h);
    };
    // night sky behind the stands, then the stands: stepped stone rows
    P(0, 0, AW, AH, '#1a1226');
    for (let r = 0; r < 4; r++) {
      const y = 8 + r * 10;
      P(0, y, AW, 10, r % 2 ? '#4a3b52' : '#56465e');
      P(0, y, AW, 1, '#6e5c76');
    }
    // banners
    for (let i = 0; i < 6; i++) {
      const x = 20 + i * 62;
      P(x, 0, 10, 16, i % 2 ? '#d8483a' : '#ffd24a');
      P(x, 16, 5, 3, i % 2 ? '#d8483a' : '#ffd24a');
      P(x + 3, 4, 4, 4, i % 2 ? '#ffd24a' : '#d8483a');
    }
    // the wall round the pit
    P(0, 48, AW, AH - 48, '#2a2030');
    // the floor: an oval of sand, dithered, darker at the rim
    for (let y = 48; y < AH; y++) {
      for (let x = 0; x < AW; x++) {
        const dx = (x - FLOOR.cx) / FLOOR.rx;
        const dy = (y - FLOOR.cy) / FLOOR.ry;
        const d = dx * dx + dy * dy;
        if (d > 1.08) continue;
        if (d > 1) {
          P(x, y, 1, 1, '#5e4630');
          continue;
        }
        const n = ((x * 73856093) ^ (y * 19349663)) >>> 0;
        const base = d > 0.85 ? [176, 138, 92] : [214, 178, 122];
        const k = (n % 7) < 1 ? 0.92 : (n % 11) < 1 ? 1.06 : 1;
        P(x, y, 1, 1, `rgb(${Math.round(base[0] * k)},${Math.round(base[1] * k)},${Math.round(base[2] * k)})`);
      }
    }
    // the ring in the middle
    g.strokeStyle = 'rgba(120,80,40,0.55)';
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(RING.x, RING.y, RING.r, RING.r / 1.6, 0, 0, Math.PI * 2);
    g.stroke();
    // torches on the wall
    for (const x of [28, 120, 240, 332]) {
      P(x, 52, 3, 8, '#5e4126');
    }
    this.ground = cv;
    // a crowd of pixel heads in the stands
    const cols = ['#d04a3a', '#2f5fd0', '#3aa05a', '#9a4ad0', '#e08a1e', '#2aa0b0', '#c0c040', '#d06aa0', '#f2f5ff'];
    this.crowd = [];
    for (let r = 0; r < 3; r++) for (let x = 6; x < AW - 6; x += 9 + ((x * 7) % 5)) this.crowd.push({ x, y: 16 + r * 10, c: cols[(x + r * 3) % cols.length], ph: (x * 13 + r * 7) % 100 });
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
      this.walkTarget = null;
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
    this.walkTarget = null;
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
    let t = pickTarget(me, this.targets(), wall);
    // the boss is big: it can be hit from a little further away
    const boss = this.snap?.match.boss;
    if (!t && boss && boss.hp > 0 && Math.hypot(boss.x - me.x, (boss.y - me.y) * 1.6) < 36) t = { id: 'boss', facing: boss.x >= me.x ? 1 : -1 };
    if (t) me.facing = t.facing;
    this.swingUntil = performance.now() + 540;
    me.pose = 'swing';
    me.since = performance.now();
    this.walkTarget = null;
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

  /** Use the active power. The app has checked the cooldown and unlock; this does the moving and aiming. */
  power() {
    const s = this.snap;
    const wall = Date.now();
    if (!s || !s.me.active || !this.fighting() || this.downed(wall) || wall < s.me.readyAt) return;
    const me = this.me;
    const p = s.me.active;
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
    }
  }

  /** Throw an ORE shard the way you face (needs ammo; the app checks). */
  throwOre() {
    const s = this.snap;
    const wall = Date.now();
    if (!s || s.me.ammo <= 0 || !this.fighting() || this.downed(wall)) return;
    // aim at the nearest target ahead, if any
    const me = this.me;
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
    const names: Record<string, [string, string]> = { dash: ['DASH!', '#7fe3ff'], slam: ['SLAM!', '#ff8a3d'], guard: ['GUARD!', '#9fd6ee'], splash: ['SPLASH!', '#ffd84a'] };
    const n = names[p];
    if (n) this.fx.say(x, y - 40, n[0], n[1], wall);
    if (p === 'dash') for (let k = 0; k < 6; k++) this.parts.spawn('dust', x - facing * k * 4, y, { vx: -facing * 20, vz: 4, life: 0.35, c: '#e8d4b0' });
  }

  /* ---------------- input ---------------- */
  private bindInput() {
    const cv = this.canvas;
    const pos = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    cv.addEventListener('pointerdown', (e) => {
      const p = pos(e);
      cv.setPointerCapture?.(e.pointerId);
      if (this.opts.touch && !this.stick && p.x < this.W * 0.5) {
        this.stick = { id: e.pointerId, x0: p.x, y0: p.y, dx: 0, dy: 0 };
        return;
      }
      // a tap: on a player, open them; else walk there
      const [mx, my] = [(p.x - this.ox) / this.z, (p.y - this.oy) / this.z];
      const hitPeer = [...this.others.values()].find((o) => Math.abs(o.x - mx) < 8 && my < o.y + 2 && my > o.y - 24);
      if (hitPeer) return this.emit({ t: 'peer', id: hitPeer.view.id });
      this.walkTarget = [mx, my];
    });
    cv.addEventListener('pointermove', (e) => {
      if (!this.stick || e.pointerId !== this.stick.id) return;
      const p = pos(e);
      const dx = (p.x - this.stick.x0) / 46;
      const dy = (p.y - this.stick.y0) / 46;
      const n = Math.hypot(dx, dy);
      this.stick.dx = n > 1 ? dx / n : dx;
      this.stick.dy = n > 1 ? dy / n : dy;
    });
    const up = (e: PointerEvent) => {
      if (this.stick && e.pointerId === this.stick.id) this.stick = null;
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKey);
      window.addEventListener('keyup', this.onKeyUp);
      window.addEventListener('blur', this.onBlur);
    }
  }
  private key(e: KeyboardEvent, down: boolean) {
    const t = e.target as HTMLElement | null;
    if (t && (/^(INPUT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (down && !e.repeat) {
      if (k === 'f') this.attack();
      else if (k === ' ') this.jump();
      else if (k === 'q') this.power();
      else if (k === 'g') this.throwOre();
    }
    if (['f', ' ', 'q', 'g'].includes(k)) e.preventDefault();
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
      this.z = Math.max(fit, Math.min(2.4, availH / AH));
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
    if ((ix || iy) && Math.hypot(ix, iy) > 0.18) this.walkTarget = null;
    else if (this.walkTarget) {
      const dx = this.walkTarget[0] - me.x;
      const dy = this.walkTarget[1] - me.y;
      const d = Math.hypot(dx, dy);
      if (d < 2) this.walkTarget = null;
      else {
        ix = dx / d;
        iy = dy / d;
      }
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
      } else this.walkTarget = null;
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
    // the crowd bobs, and jumps when someone cheers
    const loud = (s?.cheers ?? []).filter((ch) => wall - ch.at < 1200).length;
    for (const p of this.crowd) {
      const hop = loud && (p.ph + Math.floor(wall / 90)) % 7 < loud ? 3 : Math.floor(((wall / 300 + p.ph) % 4) / 3);
      c.fillStyle = p.c;
      c.fillRect(sx(p.x), sy(p.y - hop), 4 * z, 3 * z);
      c.fillStyle = '#f2c99a';
      c.fillRect(sx(p.x + 1), sy(p.y - 3 - hop), 2 * z, 2 * z);
    }
    // torch flames
    for (const x of [28, 120, 240, 332]) {
      const f = Math.floor(wall / 110) % 3;
      c.fillStyle = ['#ff9a3d', '#ffd24a', '#ff6a2a'][f];
      c.fillRect(sx(x - 1), sy(48 - f), 5 * z, (4 + f) * z);
    }
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
    for (const [px, py] of PILLARS) {
      items.push({
        y: py + 2,
        f: () => {
          const X = sx(px - PILLAR_R);
          c.fillStyle = 'rgba(0,0,0,0.3)';
          c.fillRect(X, sy(py), PILLAR_R * 2 * z, 4 * z);
          c.fillStyle = '#7a6e84';
          c.fillRect(X, sy(py - 30), PILLAR_R * 2 * z, 32 * z);
          c.fillStyle = '#968aa0';
          c.fillRect(X, sy(py - 30), 4 * z, 32 * z);
          c.fillStyle = '#5a5064';
          c.fillRect(X, sy(py - 34), PILLAR_R * 2 * z, 4 * z);
        },
      });
    }
    // the boss
    const boss = s?.match.boss;
    if (boss && boss.hp > 0) {
      items.push({
        y: boss.y,
        f: () => {
          const age = wall - boss.slamAt;
          const up = boss.slamAt && age < 400 ? Math.sin((age / 400) * Math.PI) * 10 : 0;
          const frames = moleNames.idle;
          const name = boss.hitAt && wall - boss.hitAt < 160 ? moleNames.bonk : frames[Math.floor(wall / moleNames.idleMs) % frames.length];
          c.fillStyle = 'rgba(0,0,0,0.3)';
          c.beginPath();
          c.ellipse(sx(boss.x), sy(boss.y), 16 * z, 5 * z, 0, 0, Math.PI * 2);
          c.fill();
          if (has(name)) draw(c, name, sx(boss.x), sy(boss.y - up), z * 2, boss.facing < 0, boss.hitAt && wall - boss.hitAt < 120 ? 0.5 : 1);
          // its HP bar
          const w = 50 * z;
          const X = sx(boss.x) - w / 2;
          const Y = sy(boss.y - 40);
          c.fillStyle = 'rgba(4,6,15,0.9)';
          c.fillRect(X - z, Y - z, w + 2 * z, 5 * z);
          c.fillStyle = '#ff4f5e';
          c.fillRect(X, Y, (w * boss.hp) / boss.max, 3 * z);
          text(c, 'MOLE BOSS', Math.round(sx(boss.x) - (textWidth('MOLE BOSS') * z) / 2), Math.round(Y - 8 * z), Math.max(1, Math.round(z)), '#ffd84a', '#1a0c10');
          if (boss.slamAt && age < 500) {
            c.save();
            c.globalAlpha = 1 - age / 500;
            c.strokeStyle = '#ff8a3d';
            c.lineWidth = 2 * z;
            c.beginPath();
            c.ellipse(sx(boss.x), sy(boss.y), (12 + age / 12) * z, ((12 + age / 12) / 1.6) * z, 0, 0, Math.PI * 2);
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
    // the stick
    if (this.opts.touch && this.stick) {
      c.globalAlpha = 0.6;
      c.strokeStyle = '#ffd24a';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(this.stick.x0, this.stick.y0, 46, 0, Math.PI * 2);
      c.stroke();
      c.fillStyle = '#ffd24a';
      c.beginPath();
      c.arc(this.stick.x0 + this.stick.dx * 30, this.stick.y0 + this.stick.dy * 30, 18, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 1;
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
