/**
 * Cave Run, drawn and played: one canvas, one loop.
 *
 * The rules (what a floor holds, what things are worth) live in game/cave.ts.
 * This file is everything you see and touch: the joystick, the swing, the lamp
 * light, bats, falling rock, and the cards before and after a run. It reuses the
 * island's atlas, miner and particles, so your miner and pet look the same here.
 *
 * It tells the app four things and nothing else: a run started, XP was earned,
 * how deep you got, and that you want to leave.
 */
import { draw, makeCanvas, ctx2d, text, textCentered, textWidth, loadAtlas, type Ctx } from './art';
import { drawMiner, drawPet, frameAt, petFlies } from './actors';
import { Particles } from './particles';
import type { Look, Pose } from './types';
import {
  CAVE_COLS as COLS, CAVE_ROWS as ROWS, TILE, FLOOR, WALL, ROCK, HEARTS, OIL_MAX, OIL_START, OIL_CAN, OIL_FLOOR,
  XP_ROCK, XP_NUGGET, XP_GEM, XP_BAT, XP_FLOOR, batSpeed, idx, inside, makeLevel, rockfallEvery, type Level, type Loot,
} from '../game/cave';

export type CaveEvent =
  | { t: 'ready' }
  | { t: 'run' }
  | { t: 'xp'; n: number }
  | { t: 'end'; depth: number; xp: number }
  | { t: 'sfx'; name: 'hit' | 'crack' | 'pop' | 'gem' | 'hurt' | 'descend' | 'over' | 'start' | 'tick' | 'oil' }
  | { t: 'close' };

export interface CaveOpts {
  spot: number;
  runs: number;
  best: number;
  /** CSS pixels of safe area above and below. */
  top: number;
  bottom: number;
}

type Phase = 'intro' | 'play' | 'descend' | 'over';
interface Item { kind: Exclude<Loot, ''>; x: number; y: number; z: number; vz: number; born: number }
interface Bat { x: number; y: number; hx: number; hy: number; seed: number; awake: boolean; dead: boolean }
interface Fall { x: number; y: number; at: number; done: boolean }
interface Float { x: number; y: number; t: string; c: string; at: number; big?: boolean }
interface Rect { x: number; y: number; w: number; h: number; go: () => void }

const SWING_MS = 330;
const SWING_HIT_MS = 150;
const SPEED = 60;
const WARN = 0.9;
const seeded = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/* ---------------- sprites, drawn once ---------------- */
function grid(rows: string[], pal: Record<string, string>): HTMLCanvasElement {
  const cv = makeCanvas(rows[0].length, rows.length);
  const g = ctx2d(cv);
  rows.forEach((r, y) => {
    for (let x = 0; x < r.length; x++) {
      const col = pal[r[x]];
      if (!col) continue;
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    }
  });
  return cv;
}

function floorTile(v: number) {
  const cv = makeCanvas(TILE, TILE);
  const g = ctx2d(cv);
  g.fillStyle = '#2b2233';
  g.fillRect(0, 0, TILE, TILE);
  for (let k = 0; k < 14; k++) {
    const x = Math.floor(seeded(v * 31 + k * 3.3) * TILE);
    const y = Math.floor(seeded(v * 17 + k * 7.9) * TILE);
    g.fillStyle = k % 3 === 0 ? '#3a2f45' : k % 3 === 1 ? '#231b2b' : '#32283c';
    g.fillRect(x, y, k % 5 === 0 ? 2 : 1, 1);
  }
  return cv;
}

function wallTile(v: number) {
  const cv = makeCanvas(TILE, TILE + 4);
  const g = ctx2d(cv);
  g.fillStyle = '#4a4258';
  g.fillRect(0, 0, TILE, TILE - 2);
  g.fillStyle = '#5d5470';
  g.fillRect(0, 0, TILE, 2);
  g.fillStyle = '#2a2436';
  g.fillRect(0, TILE - 2, TILE, 6);
  g.fillStyle = '#1b1724';
  g.fillRect(0, TILE + 2, TILE, 2);
  for (let k = 0; k < 9; k++) {
    const x = Math.floor(seeded(v * 13 + k * 5.1) * (TILE - 2));
    const y = 2 + Math.floor(seeded(v * 29 + k * 2.7) * (TILE - 6));
    g.fillStyle = k % 2 ? '#3d364a' : '#554c66';
    g.fillRect(x, y, 2, 1);
  }
  g.fillStyle = '#342d42';
  g.fillRect(Math.floor(seeded(v) * 10) + 2, TILE - 1, 1, 4);
  return cv;
}

const ROCK_PAL = [
  { hi: '#d9a871', mid: '#b98552', lo: '#8a5f38', dk: '#5e3f25' },
  { hi: '#b8c0cc', mid: '#8f98a8', lo: '#666f80', dk: '#434a59' },
  { hi: '#8089c8', mid: '#5a629c', lo: '#3d4474', dk: '#272c50' },
];
function rockTile(kind: number, v: number) {
  const p = ROCK_PAL[kind];
  const cv = makeCanvas(TILE, TILE + 3);
  const g = ctx2d(cv);
  const body = (x: number, y: number, w: number, h: number, c: string) => {
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  };
  body(2, 1, 12, 17, p.dk);
  body(1, 3, 14, 13, p.dk);
  body(2, 2, 12, 13, p.mid);
  body(1, 4, 14, 9, p.mid);
  body(3, 2, 9, 2, p.hi);
  body(2, 4, 3, 3, p.hi);
  body(2, 13, 12, 3, p.lo);
  body(1, 11, 14, 2, p.lo);
  for (let k = 0; k < 5; k++) {
    const x = 3 + Math.floor(seeded(v * 7 + k * 3.7 + kind) * 9);
    const y = 5 + Math.floor(seeded(v * 11 + k * 9.1 + kind) * 7);
    body(x, y, 2, 1, k % 2 ? p.lo : p.hi);
  }
  return cv;
}
const CRACKS = [
  grid(['......', '..x...', '.x....', '..x...', '...x..', '..x...', '.x....'], { x: '#14101c' }),
  grid(['....x...', '...x....', '..xx....', '.x..x...', 'x....x..', '.x....x.', '..x...x.', '.x.....x', 'x.......'], { x: '#14101c' }),
];

const NUGGET = grid(['..hhh...', '.hyyyh..', 'hyyyyyo.', 'hyywyyo.', '.oyyyoo.', '..ooo...'], { h: '#fff1a8', y: '#ffd24a', w: '#ffffff', o: '#c98a1c' });
const GEM = grid(['...ww...', '..wccc..', '.wccccd.', 'wccwccdd', '.cccddd.', '..cddd..', '...dd...'], { w: '#eaffff', c: '#5ceeff', d: '#1f9ec4' });
const OIL = grid(['..kkk...', '..kyk...', '.kkkkk..', '.krrrk..', '.krwrk..', '.krrrk..', '.kkkkk..'], { k: '#2a1c10', y: '#ffd24a', r: '#e0702a', w: '#ffd9a8' });
const HEART = grid(['.rr.rr.', 'rwrrrrr', 'rrrrrrr', '.rrrrr.', '..rrr..', '...r...'], { r: '#ff4f6a', w: '#ffd0d8' });
const HEART_OFF = grid(['.rr.rr.', 'rrrrrrr', 'rrrrrrr', '.rrrrr.', '..rrr..', '...r...'], { r: '#3a2a3a' });
const FLAME = grid(['..y..', '.yy..', '.yoy.', 'yooy.', 'yowoy', '.ooo.'], { y: '#ffd24a', o: '#ff8a2a', w: '#fff6d0' });
const LADDER = grid(
  [
    '................', '..kkkkkkkkkkkk..', '.kddddddddddddk.', '.kdbbddddddbbdk.', '.kdbwwwwwwwwbdk.', '.kdbbddddddbbdk.', '.kdbbddddddbbdk.',
    '.kdbwwwwwwwwbdk.', '.kdbbddddddbbdk.', '.kdbbddddddbbdk.', '.kdbwwwwwwwwbdk.', '.kdbbddddddbbdk.', '.kddddddddddddk.', '..kkkkkkkkkkkk..', '................', '................',
  ],
  { k: '#15101c', d: '#07050b', b: '#8a5f38', w: '#c9955a' },
);

export class CaveEngine {
  private c: Ctx;
  private W = 1;
  private H = 1;
  private dpr = 1;
  private S = 4; // device px per art px
  private raf = 0;
  private last = 0;
  private phase: Phase = 'intro';
  private phaseAt = 0;
  private level: Level = makeLevel(1);
  private parts = new Particles();
  private floors = [0, 1, 2, 3].map(floorTile);
  private walls = [0, 1, 2].map(wallTile);
  private rocks = [0, 1, 2].map((k) => [0, 1].map((v) => rockTile(k, v)));
  private light: HTMLCanvasElement | null = null;
  // you
  private x = 0;
  private y = 0;
  private aim = { x: 0, y: -1 };
  private facing: 1 | -1 = 1;
  private pose: Pose = 'idle';
  private since = 0;
  private swingAt = -1;
  private swingHit = false;
  private hearts = HEARTS;
  private oil = OIL_START;
  private hurtAt = -9999;
  private kx = 0;
  private ky = 0;
  private pet = { x: 0, y: 0 };
  private stepAt = 0;
  // the floor
  private items: Item[] = [];
  private bats: Bat[] = [];
  private falls: Fall[] = [];
  private floats: Float[] = [];
  private hitAt = new Map<number, number>();
  private nextFall = 0;
  private lastTick = 0;
  private shake = 0;
  private cam = { x: 0, y: 0 };
  // the run
  private runXp = 0;
  private xpOut = 0;
  private xpAt = 0;
  private why = '';
  private moved = false;
  // input
  private stick: { id: number; bx: number; by: number; x: number; y: number } | null = null;
  private swingHeld = new Set<number>();
  private keys = new Set<string>();
  private buttons: Rect[] = [];
  private unbind: (() => void)[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private emit: (e: CaveEvent) => void,
    private look: Look,
    private opts: CaveOpts,
  ) {
    this.c = ctx2d(canvas);
    this.bind();
    this.load(1);
    (globalThis as unknown as { __galiCave?: CaveEngine }).__galiCave = this;
  }

  async start(atlasUrl: string) {
    await loadAtlas(atlasUrl);
    this.last = performance.now();
    const loop = (t: number) => {
      this.raf = requestAnimationFrame(loop);
      this.frame(t);
    };
    this.raf = requestAnimationFrame(loop);
    this.emit({ t: 'ready' });
  }
  stop() {
    cancelAnimationFrame(this.raf);
    this.flushXp(true);
    this.unbind.forEach((f) => f());
  }
  setOpts(o: Partial<CaveOpts>) {
    this.opts = { ...this.opts, ...o };
  }
  setLook(l: Look) {
    this.look = l;
  }

  /* ---------------- a run ---------------- */
  private load(depth: number) {
    const lv = makeLevel(depth);
    this.level = lv;
    this.x = lv.start[0] * TILE + TILE / 2;
    this.y = lv.start[1] * TILE + TILE - 3;
    this.pet = { x: this.x - 10, y: this.y };
    this.items = [];
    this.falls = [];
    this.hitAt.clear();
    this.parts.clear();
    this.bats = lv.bats.map(([bx, by], k) => ({ x: bx * TILE + 8, y: by * TILE + 8, hx: bx * TILE + 8, hy: by * TILE + 8, seed: k * 3.7 + depth, awake: false, dead: false }));
    this.nextFall = Date.now() + 2500;
    this.cam = { x: this.x, y: this.y };
    this.aim = { x: 0, y: -1 };
  }
  private begin() {
    if (this.opts.runs <= 0) return;
    this.opts.runs--;
    this.emit({ t: 'run' });
    this.emit({ t: 'sfx', name: 'start' });
    this.hearts = HEARTS;
    this.oil = OIL_START;
    this.runXp = 0;
    this.xpOut = 0;
    this.floats = [];
    this.load(1);
    this.phase = 'play';
    this.phaseAt = Date.now();
    this.say(this.x, this.y - 30, 'DEPTH 1', '#ffd24a', true);
  }
  private end(why: string) {
    if (this.phase === 'over') return;
    this.why = why;
    this.phase = 'over';
    this.phaseAt = Date.now();
    this.stick = null;
    this.swingHeld.clear();
    this.flushXp(true);
    this.opts.best = Math.max(this.opts.best, this.level.depth);
    this.emit({ t: 'end', depth: this.level.depth, xp: this.runXp });
    this.emit({ t: 'sfx', name: 'over' });
  }
  private gain(n: number, x: number, y: number, c = '#8ff0ff') {
    this.runXp += n;
    this.say(x, y, `+${n} XP`, c);
  }
  /** XP goes to the app in small batches, so a busy second is one message. */
  private flushXp(force = false) {
    const now = Date.now();
    const due = this.runXp - this.xpOut;
    if (due <= 0 || (!force && now - this.xpAt < 900)) return;
    this.xpAt = now;
    this.xpOut = this.runXp;
    this.emit({ t: 'xp', n: due });
  }
  private say(x: number, y: number, t: string, c: string, big = false) {
    this.floats.push({ x, y, t, c, at: Date.now(), big });
    if (this.floats.length > 14) this.floats.shift();
  }

  /* ---------------- input ---------------- */
  private bind() {
    const cv = this.canvas;
    cv.style.touchAction = 'none';
    const pos = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, k: K | string, f: (e: never) => void, o?: AddEventListenerOptions) => {
      el.addEventListener(k as string, f as EventListener, o);
      this.unbind.push(() => el.removeEventListener(k as string, f as EventListener));
    };
    on(cv, 'pointerdown', (e: PointerEvent) => {
      e.preventDefault();
      const p = pos(e);
      cv.setPointerCapture?.(e.pointerId);
      for (const b of this.buttons) {
        if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return b.go();
      }
      if (this.phase !== 'play') return;
      const sb = this.swingButton();
      if (Math.hypot(p.x - sb.x, p.y - sb.y) < sb.r + 14) {
        this.swingHeld.add(e.pointerId);
        this.swing();
        return;
      }
      if (!this.stick) this.stick = { id: e.pointerId, bx: p.x, by: p.y, x: p.x, y: p.y };
    });
    on(cv, 'pointermove', (e: PointerEvent) => {
      if (!this.stick || this.stick.id !== e.pointerId) return;
      const p = pos(e);
      this.stick.x = p.x;
      this.stick.y = p.y;
      // the base follows a long drag, so the thumb never runs out of room
      const dx = p.x - this.stick.bx;
      const dy = p.y - this.stick.by;
      const d = Math.hypot(dx, dy);
      if (d > 62) {
        this.stick.bx += (dx / d) * (d - 62);
        this.stick.by += (dy / d) * (d - 62);
      }
    });
    const up = (e: PointerEvent) => {
      this.swingHeld.delete(e.pointerId);
      if (this.stick?.id === e.pointerId) this.stick = null;
    };
    on(cv, 'pointerup', up);
    on(cv, 'pointercancel', up);
    if (typeof window !== 'undefined') {
      on(window, 'keydown', (e: KeyboardEvent) => {
        const k = e.key.toLowerCase();
        if (k === ' ' || k === 'enter') {
          if (this.phase === 'play') this.swing();
          else if (this.phase !== 'descend' && !e.repeat) this.buttons[0]?.go();
          e.preventDefault();
        }
        this.keys.add(k);
      });
      on(window, 'keyup', (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase()));
      on(window, 'blur', () => {
        this.keys.clear();
        this.stick = null;
        this.swingHeld.clear();
      });
    }
  }
  private swingButton() {
    return { x: this.W - 66, y: this.H - this.opts.bottom - 92, r: 40 };
  }
  private wish(): [number, number] {
    let x = 0;
    let y = 0;
    const k = this.keys;
    if (k.has('arrowleft') || k.has('a')) x -= 1;
    if (k.has('arrowright') || k.has('d')) x += 1;
    if (k.has('arrowup') || k.has('w')) y -= 1;
    if (k.has('arrowdown') || k.has('s')) y += 1;
    if (this.stick) {
      const dx = this.stick.x - this.stick.bx;
      const dy = this.stick.y - this.stick.by;
      const d = Math.hypot(dx, dy);
      if (d > 7) {
        const m = Math.min(1, d / 40);
        x = (dx / d) * m;
        y = (dy / d) * m;
      }
    }
    const d = Math.hypot(x, y);
    return d > 1 ? [x / d, y / d] : [x, y];
  }
  private swing() {
    const now = Date.now();
    if (this.phase !== 'play' || (this.swingAt > 0 && now - this.swingAt < SWING_MS)) return;
    this.swingAt = now;
    this.swingHit = false;
    this.pose = 'swing';
    this.since = now;
    this.moved = true;
  }

  /* ---------------- the world ---------------- */
  private solid(px: number, py: number) {
    const cx = Math.floor(px / TILE);
    const cy = Math.floor(py / TILE);
    if (!inside(cx, cy)) return true;
    const i = idx(cx, cy);
    const k = this.level.cells[i];
    return k === WALL || (k === ROCK && this.level.hp[i] > 0);
  }
  private blocked(x: number, y: number) {
    return this.solid(x - 4, y - 5) || this.solid(x + 4, y - 5) || this.solid(x - 4, y) || this.solid(x + 4, y);
  }
  /** The rock a swing would land on: the cell in front, or the one you are pressed against. */
  private target(): number {
    const tx = this.x + this.aim.x * 11;
    const ty = this.y - 3 + this.aim.y * 11;
    const cx = Math.floor(tx / TILE);
    const cy = Math.floor(ty / TILE);
    const isRock = (x: number, y: number) => inside(x, y) && this.level.cells[idx(x, y)] === ROCK && this.level.hp[idx(x, y)] > 0;
    if (isRock(cx, cy)) return idx(cx, cy);
    const mx = Math.floor(this.x / TILE);
    const my = Math.floor((this.y - 3) / TILE);
    const sx = Math.abs(this.aim.x) > 0.35 ? Math.sign(this.aim.x) : 0;
    const sy = Math.abs(this.aim.y) > 0.35 ? Math.sign(this.aim.y) : 0;
    if (sx && isRock(mx + sx, my)) return idx(mx + sx, my);
    if (sy && isRock(mx, my + sy)) return idx(mx, my + sy);
    return -1;
  }
  private strike(now: number) {
    const hx = this.x + this.aim.x * 10;
    const hy = this.y - 6 + this.aim.y * 10;
    let landed = false;
    for (const b of this.bats) {
      if (b.dead || Math.hypot(b.x - hx, b.y - hy) > 15) continue;
      b.dead = true;
      landed = true;
      this.parts.burst('smoke', b.x, b.y, 6, 14, 10, ['#6a5a86', '#3d3352'], 0.6);
      this.parts.burst('star', b.x, b.y, 5, 26, 20, ['#ffffff', '#ff9ad0'], 0.5);
      this.gain(XP_BAT, b.x, b.y - 8, '#ff9ad0');
      this.emit({ t: 'sfx', name: 'pop' });
    }
    const i = this.target();
    if (i >= 0) {
      landed = true;
      const lv = this.level;
      const cx = (i % COLS) * TILE + 8;
      const cy = Math.floor(i / COLS) * TILE + 8;
      lv.hp[i]--;
      this.hitAt.set(i, now);
      const pal = ROCK_PAL[lv.max[i] - 1];
      this.parts.burst('chip', cx, cy, 5, 30, 28, [pal.hi, pal.mid, pal.lo], 0.6);
      this.parts.burst('dust', cx, cy, 3, 12, 8, ['#cdbfae', '#8d7f90'], 0.5);
      if (this.look.glow !== 'none') this.parts.burst('spark', cx, cy - 2, 4, 30, 22, ['#fff1a8', '#5ceeff'], 0.5);
      if (lv.hp[i] <= 0) {
        this.shake = Math.max(this.shake, 2.2);
        this.parts.burst('chip', cx, cy, 12, 44, 40, [pal.hi, pal.mid, pal.lo, pal.dk], 0.9);
        this.parts.burst('dust', cx, cy, 8, 20, 12, ['#cdbfae', '#8d7f90'], 0.8);
        this.gain(XP_ROCK, cx, cy - 6, '#cfd6e6');
        const drop = lv.loot[i];
        if (drop) this.items.push({ kind: drop, x: cx, y: cy + 3, z: 2, vz: 46, born: now });
        this.emit({ t: 'sfx', name: 'crack' });
      } else {
        this.shake = Math.max(this.shake, 1);
        this.emit({ t: 'sfx', name: 'hit' });
      }
    }
    if (!landed) this.parts.burst('dust', hx, hy + 6, 2, 8, 6, ['#8d7f90'], 0.35);
  }
  private hurt(fromX: number, fromY: number, now: number) {
    if (now - this.hurtAt < 1200 || this.phase !== 'play') return;
    this.hurtAt = now;
    this.hearts--;
    const d = Math.hypot(this.x - fromX, this.y - fromY) || 1;
    this.kx = ((this.x - fromX) / d) * 130;
    this.ky = ((this.y - fromY) / d) * 130;
    this.shake = 5;
    this.parts.burst('star', this.x, this.y - 10, 8, 34, 24, ['#ff4f6a', '#ffffff'], 0.5);
    this.emit({ t: 'sfx', name: 'hurt' });
    if (this.hearts <= 0) this.end('KNOCKED OUT');
  }

  private think(dt: number, now: number) {
    const lv = this.level;
    if (this.phase === 'descend') {
      if (now - this.phaseAt > 520 && lv.depth === this.descendFrom) {
        this.load(lv.depth + 1);
        this.say(this.x, this.y - 30, `DEPTH ${this.level.depth}`, '#ffd24a', true);
      }
      if (now - this.phaseAt > 1040) {
        this.phase = 'play';
        this.nextFall = now + 2000;
      }
      return;
    }
    if (this.phase !== 'play') {
      this.pose = this.phase === 'over' ? 'idle' : this.pose;
      return;
    }
    // walk
    const [wx, wy] = this.wish();
    const swinging = this.swingAt > 0 && now - this.swingAt < SWING_MS;
    const speed = SPEED * (swinging ? 0.45 : 1);
    let vx = wx * speed + this.kx;
    let vy = wy * speed + this.ky;
    this.kx *= Math.max(0, 1 - dt * 9);
    this.ky *= Math.max(0, 1 - dt * 9);
    if (wx || wy) {
      const d = Math.hypot(wx, wy);
      this.aim = { x: wx / d, y: wy / d };
      if (Math.abs(wx) > 0.2) this.facing = wx > 0 ? 1 : -1;
      this.moved = true;
    }
    const nx = this.x + vx * dt;
    if (!this.blocked(nx, this.y)) this.x = nx;
    else vx = 0;
    const ny = this.y + vy * dt;
    if (!this.blocked(this.x, ny)) this.y = ny;
    else vy = 0;
    const walking = (wx || wy) && (Math.abs(vx) + Math.abs(vy) > 4);
    if (swinging) {
      if (!this.swingHit && now - this.swingAt >= SWING_HIT_MS) {
        this.swingHit = true;
        this.strike(now);
      }
    } else {
      if (this.swingHeld.size || this.keys.has(' ')) this.swing();
      else {
        const want: Pose = walking ? 'walk' : 'idle';
        if (this.pose !== want) {
          this.pose = want;
          this.since = now;
        }
      }
    }
    if (walking && now - this.stepAt > 210) {
      this.stepAt = now;
      this.parts.spawn('dust', this.x - this.aim.x * 3, this.y, { vx: -this.aim.x * 5, vy: -this.aim.y * 3, vz: 8, life: 0.4, c: '#6f6380' });
    }
    // pet at heel
    if (this.look.pet) {
      const tx = this.x - 11 * this.facing;
      const ty = this.y + (petFlies(this.look.pet) ? -14 : 2);
      this.pet.x += (tx - this.pet.x) * Math.min(1, dt * 4);
      this.pet.y += (ty - this.pet.y) * Math.min(1, dt * 4);
    }
    // the lantern
    this.oil = Math.max(0, this.oil - dt);
    if (this.oil <= 10 && now - this.lastTick > 1000) {
      this.lastTick = now;
      this.emit({ t: 'sfx', name: 'tick' });
    }
    if (this.oil <= 0) return this.end('LANTERN OUT');
    // things on the floor
    for (const it of this.items) {
      it.vz -= 190 * dt;
      it.z += it.vz * dt;
      if (it.z < 0) {
        it.z = 0;
        it.vz = it.vz < -30 ? -it.vz * 0.4 : 0;
      }
      const d = Math.hypot(it.x - this.x, it.y - (this.y - 4));
      if (now - it.born > 260 && d < 26) {
        it.x += ((this.x - it.x) / d) * 90 * dt;
        it.y += ((this.y - 4 - it.y) / d) * 90 * dt;
      }
    }
    this.items = this.items.filter((it) => {
      if (now - it.born < 260 || Math.hypot(it.x - this.x, it.y - (this.y - 4)) > 8) return true;
      if (it.kind === 'nugget') {
        this.gain(XP_NUGGET, it.x, it.y - 8, '#ffd24a');
        this.parts.burst('gold', it.x, it.y, 8, 26, 24, ['#ffd24a', '#fff1a8'], 0.6);
        this.emit({ t: 'sfx', name: 'pop' });
      } else if (it.kind === 'gem') {
        this.gain(XP_GEM, it.x, it.y - 8, '#5ceeff');
        this.parts.burst('star', it.x, it.y, 16, 40, 30, ['#5ceeff', '#ffffff', '#b86bff'], 0.9);
        this.shake = Math.max(this.shake, 2);
        this.emit({ t: 'sfx', name: 'gem' });
      } else if (it.kind === 'oil') {
        this.oil = Math.min(OIL_MAX, this.oil + OIL_CAN);
        this.say(it.x, it.y - 8, `+${OIL_CAN}S LIGHT`, '#ffb060');
        this.parts.burst('ember', it.x, it.y, 8, 20, 26, ['#ff8a2a', '#ffd24a'], 0.6);
        this.emit({ t: 'sfx', name: 'oil' });
      } else {
        if (this.hearts < HEARTS) this.hearts++;
        this.say(it.x, it.y - 8, '+1 HEART', '#ff8aa0');
        this.parts.burst('star', it.x, it.y, 8, 22, 22, ['#ff4f6a', '#ffd0d8'], 0.6);
        this.emit({ t: 'sfx', name: 'oil' });
      }
      return false;
    });
    // bats
    const bs = batSpeed(lv.depth);
    for (const b of this.bats) {
      if (b.dead) continue;
      const px = this.x;
      const py = this.y - 8;
      const d = Math.hypot(px - b.x, py - b.y);
      if (!b.awake && d < 78) {
        b.awake = true;
        this.say(b.x, b.y - 10, '!', '#ff4f6a', true);
      }
      if (b.awake) {
        const wob = Math.sin(now / 170 + b.seed) * 0.6;
        const ax = (px - b.x) / (d || 1);
        const ay = (py - b.y) / (d || 1);
        b.x += (ax - ay * wob) * bs * dt;
        b.y += (ay + ax * wob) * bs * dt;
        if (d < 8) {
          this.hurt(b.x, b.y, now);
          b.x -= ax * 22;
          b.y -= ay * 22;
        }
      } else {
        b.x = b.hx + Math.sin(now / 900 + b.seed) * 7;
        b.y = b.hy + Math.cos(now / 700 + b.seed) * 4;
      }
    }
    // falling rock: a shadow warns you, then it lands
    const every = rockfallEvery(lv.depth);
    if (every && now > this.nextFall) {
      this.nextFall = now + every * 1000 * (0.7 + Math.random() * 0.6);
      this.falls.push({ x: this.x + (Math.random() - 0.5) * 22, y: this.y - 3 + (Math.random() - 0.5) * 14, at: now, done: false });
    }
    for (const f of this.falls) {
      const age = (now - f.at) / 1000;
      if (age < WARN && Math.random() < dt * 14) this.parts.spawn('drip', f.x + (Math.random() - 0.5) * 8, f.y, { z: 60, vz: -20, life: 0.5, c: '#8d7f90' });
      if (!f.done && age >= WARN) {
        f.done = true;
        this.shake = Math.max(this.shake, 3);
        this.parts.burst('chip', f.x, f.y, 12, 40, 36, ['#8f98a8', '#666f80', '#434a59'], 0.8);
        this.parts.burst('dust', f.x, f.y, 8, 22, 10, ['#cdbfae', '#8d7f90'], 0.8);
        this.emit({ t: 'sfx', name: 'crack' });
        if (Math.hypot(f.x - this.x, f.y - (this.y - 3)) < 10) this.hurt(f.x, f.y + 1, now);
      }
    }
    this.falls = this.falls.filter((f) => now - f.at < (WARN + 0.5) * 1000);
    // the ladder
    const [lx, ly] = lv.ladder;
    if (Math.floor(this.x / TILE) === lx && Math.floor((this.y - 3) / TILE) === ly && this.phase === 'play') {
      this.descendFrom = lv.depth;
      this.phase = 'descend';
      this.phaseAt = now;
      this.oil = Math.min(OIL_MAX, this.oil + OIL_FLOOR);
      this.gain(XP_FLOOR * lv.depth, this.x, this.y - 22, '#c7f284');
      this.emit({ t: 'sfx', name: 'descend' });
    }
    this.flushXp();
  }
  private descendFrom = 0;

  /* ---------------- drawing ---------------- */
  private resize() {
    const cssW = this.canvas.clientWidth || window.innerWidth;
    const cssH = this.canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    if (cssW === this.W && cssH === this.H && dpr === this.dpr) return;
    this.W = cssW;
    this.H = cssH;
    this.dpr = dpr;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.c = ctx2d(this.canvas);
    this.S = Math.max(2, Math.floor(Math.min(this.canvas.width / 150, this.canvas.height / 215)));
    this.light = makeCanvas(Math.ceil(this.canvas.width / this.S) + 2, Math.ceil(this.canvas.height / this.S) + 2);
  }

  private frame(t: number) {
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    const now = Date.now();
    this.resize();
    this.think(dt, now);
    this.parts.update(dt, 0);
    this.shake = Math.max(0, this.shake - dt * 14);
    this.cam.x += (this.x - this.cam.x) * Math.min(1, dt * 7);
    this.cam.y += (this.y - this.cam.y) * Math.min(1, dt * 7);
    this.buttons = [];
    const c = this.c;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.imageSmoothingEnabled = false;
    this.drawWorld(c, now);
    if (this.phase === 'play' || this.phase === 'descend') this.drawHud(c, now);
    if (this.phase === 'descend') {
      const k = (now - this.phaseAt) / 1040;
      c.fillStyle = `rgba(3,2,6,${k < 0.5 ? k * 2 : (1 - k) * 2})`;
      c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    if (this.phase === 'intro') this.drawIntro(c, now);
    if (this.phase === 'over') this.drawOver(c, now);
  }

  private drawWorld(c: Ctx, now: number) {
    const S = this.S;
    const DW = this.canvas.width;
    const DH = this.canvas.height;
    const lv = this.level;
    const sh = this.shake;
    const mapW = COLS * TILE;
    // keep the whole width in view when it fits; otherwise follow
    const viewW = DW / S;
    const camX = viewW >= mapW ? mapW / 2 : Math.max(viewW / 2, Math.min(mapW - viewW / 2, this.cam.x));
    const OX = Math.round(DW / 2 - camX * S + (seeded(now / 33) - 0.5) * sh * S);
    const OY = Math.round(DH * 0.44 - this.cam.y * S + (seeded(now / 29 + 9) - 0.5) * sh * S);
    c.fillStyle = '#0a0810';
    c.fillRect(0, 0, DW, DH);
    const x0 = Math.floor(-OX / S / TILE) - 1;
    const x1 = Math.ceil((DW - OX) / S / TILE);
    const y0 = Math.floor(-OY / S / TILE) - 1;
    const y1 = Math.ceil((DH - OY) / S / TILE) + 1;
    type It = { z: number; f: () => void };
    const items: It[] = [];
    const tgt = this.phase === 'play' ? this.target() : -1;
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const X = OX + cx * TILE * S;
        const Y = OY + cy * TILE * S;
        const v = Math.floor(seeded(cx * 7.3 + cy * 13.7) * 97);
        const k = inside(cx, cy) ? lv.cells[idx(cx, cy)] : WALL;
        if (k === WALL) {
          const w = this.walls[v % 3];
          items.push({ z: (cy + 1) * TILE - 0.5, f: () => c.drawImage(w, X, Y - 2 * S, w.width * S, w.height * S) });
          continue;
        }
        c.drawImage(this.floors[v % 4], X, Y, TILE * S, TILE * S);
        if (k !== ROCK) continue;
        const i = idx(cx, cy);
        if (lv.hp[i] <= 0) continue;
        const kind = lv.max[i] - 1;
        const r = this.rocks[kind][v % 2];
        const dmg = lv.max[i] - lv.hp[i];
        const age = now - (this.hitAt.get(i) ?? 0);
        const jx = age < 130 ? Math.round((seeded(now / 22 + i) - 0.5) * 3) : 0;
        items.push({
          z: (cy + 1) * TILE - 1,
          f: () => {
            c.drawImage(r, X + jx * S, Y - 3 * S, r.width * S, r.height * S);
            if (dmg > 0) {
              const cr = CRACKS[Math.min(dmg, 2) - 1];
              c.drawImage(cr, X + (4 + jx) * S, Y + 1 * S, cr.width * S, cr.height * S);
            }
            if (age < 70) {
              c.fillStyle = 'rgba(255,255,255,0.55)';
              c.fillRect(X + 2 * S, Y - 1 * S, 12 * S, 14 * S);
            }
            if (i === tgt) {
              // corner brackets on the rock your swing will hit
              c.fillStyle = '#ffd24a';
              const b = 3 * S;
              const p = S;
              for (const [ax, ay] of [[0, -2], [TILE, -2], [0, TILE], [TILE, TILE]] as const) {
                const px = X + ax * S - (ax ? b : 0);
                const py = Y + ay * S - (ay > 0 ? p : 0);
                c.fillRect(px, py, b, p);
                c.fillRect(ax ? X + ax * S - p : X, ay > 0 ? Y + ay * S - b : Y + ay * S, p, b);
              }
            }
          },
        });
      }
    }
    // the ladder down
    const [lx, ly] = lv.ladder;
    c.drawImage(LADDER, OX + lx * TILE * S, OY + ly * TILE * S, TILE * S, TILE * S);
    if (Math.floor(now / 400) % 2) draw(c, 'fx-sparkle-0', OX + (lx * TILE + 8) * S, OY + (ly * TILE + 2) * S, S * 0.5, false, 0.7);
    // warnings under falling rock
    for (const f of this.falls) {
      const age = (now - f.at) / 1000;
      if (age >= WARN) continue;
      const k = age / WARN;
      const r = 3 + k * 6;
      c.fillStyle = `rgba(255,60,80,${0.25 + 0.35 * k * (Math.floor(now / 90) % 2 ? 1 : 0.6)})`;
      c.fillRect(OX + Math.round(f.x - r) * S, OY + Math.round(f.y - r * 0.5) * S, Math.round(r * 2) * S, Math.round(r) * S);
      const zz = (1 - k * k) * 120;
      items.push({ z: f.y + 1, f: () => draw(c, 'fx-rock-0', OX + f.x * S, OY + (f.y - zz) * S, S * 1.5) });
    }
    for (const it of this.items) {
      const sp = it.kind === 'nugget' ? NUGGET : it.kind === 'gem' ? GEM : it.kind === 'oil' ? OIL : HEART;
      const bob = it.z > 0 ? 0 : Math.round(Math.sin(now / 200 + it.x) * 1);
      items.push({
        z: it.y,
        f: () => {
          c.fillStyle = 'rgba(0,0,0,0.3)';
          c.fillRect(OX + Math.round(it.x - 3) * S, OY + Math.round(it.y) * S, 6 * S, S);
          c.drawImage(sp, OX + Math.round(it.x - sp.width / 2) * S, OY + Math.round(it.y - sp.height - it.z + bob) * S, sp.width * S, sp.height * S);
        },
      });
    }
    // you
    const blink = now - this.hurtAt < 1200 && Math.floor(now / 80) % 2 === 0;
    const swinging = this.swingAt > 0 && now - this.swingAt < SWING_MS;
    const mf = swinging ? Math.min(5, Math.floor(((now - this.swingAt) / SWING_MS) * 6)) : frameAt(this.pose === 'swing' ? 'idle' : this.pose, this.since, now);
    const pose: Pose = swinging ? 'swing' : this.pose === 'swing' ? 'idle' : this.pose;
    if (!blink) items.push({ z: this.y, f: () => drawMiner(c, this.look, pose, mf, OX + this.x * S, OY + this.y * S, S, this.facing) });
    if (this.look.pet) items.push({ z: this.pet.y + (petFlies(this.look.pet) ? 16 : 0), f: () => drawPet(c, this.look.pet!, now, OX + this.pet.x * S, OY + this.pet.y * S, S, this.facing) });
    for (const b of this.bats) {
      if (b.dead) continue;
      const f = Math.floor(now / 90) % 4;
      items.push({
        z: b.y + 14,
        f: () => {
          c.fillStyle = 'rgba(0,0,0,0.3)';
          c.fillRect(OX + Math.round(b.x - 4) * S, OY + Math.round(b.y + 12) * S, 8 * S, 2 * S);
          draw(c, `pet-bat-${f}`, OX + b.x * S, OY + b.y * S, S, this.x < b.x);
          if (b.awake) {
            c.fillStyle = '#ff3050';
            c.fillRect(OX + Math.round(b.x - 2) * S, OY + Math.round(b.y - 1) * S, S, S);
            c.fillRect(OX + Math.round(b.x + 1) * S, OY + Math.round(b.y - 1) * S, S, S);
          }
        },
      });
    }
    items.sort((a, b) => a.z - b.z);
    for (const it of items) it.f();
    this.parts.draw(c, OX, OY, S);

    // the dark, with a hole where the lamp is
    const L = this.light;
    if (L) {
      const g = ctx2d(L);
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, L.width, L.height);
      g.fillStyle = 'rgba(5,3,10,0.94)';
      g.fillRect(0, 0, L.width, L.height);
      g.globalCompositeOperation = 'destination-out';
      const hole = (mx: number, my: number, r: number, k = 1) => {
        const X = (OX + mx * S) / S;
        const Y = (OY + my * S) / S;
        const gr = g.createRadialGradient(X, Y, 0, X, Y, r);
        gr.addColorStop(0, `rgba(0,0,0,${k})`);
        gr.addColorStop(0.55, `rgba(0,0,0,${k * 0.92})`);
        gr.addColorStop(0.8, `rgba(0,0,0,${k * 0.5})`);
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.fillRect(X - r, Y - r, r * 2, r * 2);
      };
      const idle = this.phase === 'intro' || this.phase === 'over';
      const oilK = idle ? 1 : this.oil / OIL_MAX;
      const flick = 1 + Math.sin(now / 90) * 0.02 + (oilK < 0.17 ? Math.sin(now / 40) * 0.06 : 0);
      hole(this.x, this.y - 10, (38 + 62 * Math.sqrt(oilK)) * flick);
      hole(lx * TILE + 8, ly * TILE + 8, 20 + Math.sin(now / 300) * 2, 0.75);
      for (const it of this.items) hole(it.x, it.y - 3, it.kind === 'gem' ? 16 : 9, 0.7);
      for (const b of this.bats) if (!b.dead && b.awake) hole(b.x, b.y, 8, 0.45);
      c.drawImage(L, 0, 0, L.width, L.height, 0, 0, L.width * S, L.height * S);
      // a warm tint near the lamp
      c.save();
      c.globalCompositeOperation = 'lighter';
      const R = 60 * S;
      const gr = c.createRadialGradient(OX + this.x * S, OY + (this.y - 10) * S, 0, OX + this.x * S, OY + (this.y - 10) * S, R);
      gr.addColorStop(0, 'rgba(255,190,90,0.13)');
      gr.addColorStop(1, 'rgba(255,190,90,0)');
      c.fillStyle = gr;
      c.fillRect(OX + this.x * S - R, OY + (this.y - 10) * S - R, R * 2, R * 2);
      c.restore();
    }
    // floating words, over the dark
    const u = Math.max(2, Math.round(S * 0.5));
    this.floats = this.floats.filter((f) => now - f.at < (f.big ? 1500 : 900));
    for (const f of this.floats) {
      const k = (now - f.at) / (f.big ? 1500 : 900);
      const sc = f.big ? u * 2 : u;
      c.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      textCentered(c, f.t, OX + f.x * S, OY + (f.y - k * 16) * S - 5 * sc, sc, f.c, '#05030a');
      c.globalAlpha = 1;
    }
    // hurt flash and low-oil pulse
    const h = now - this.hurtAt;
    if (h < 260) {
      c.fillStyle = `rgba(255,40,70,${0.3 * (1 - h / 260)})`;
      c.fillRect(0, 0, DW, DH);
    }
    if (this.phase === 'play' && this.oil <= 10) {
      c.fillStyle = `rgba(255,60,40,${0.07 + 0.07 * Math.sin(now / 160)})`;
      c.fillRect(0, 0, DW, DH);
    }
  }

  private drawHud(c: Ctx, now: number) {
    const d = this.dpr;
    const u = Math.max(2, Math.round(d * 1.5));
    const top = (this.opts.top + 10) * d;
    const pad = 14 * d;
    // hearts
    for (let i = 0; i < HEARTS; i++) {
      const sp = i < this.hearts ? HEART : HEART_OFF;
      const pop = i === this.hearts && now - this.hurtAt < 300 ? 1.4 : 1;
      c.drawImage(sp, pad + i * 9 * u * 1.1, top, sp.width * u * pop, sp.height * u * pop);
    }
    // lantern
    const ly = top + 9 * u;
    const bw = 62 * u * 0.9;
    c.drawImage(FLAME, pad, ly - u, FLAME.width * u, FLAME.height * u);
    c.fillStyle = '#05030a';
    c.fillRect(pad + 7 * u, ly, bw + 2 * u, 5 * u);
    const k = this.oil / OIL_MAX;
    c.fillStyle = k < 0.17 ? (Math.floor(now / 160) % 2 ? '#ff4f3a' : '#ffb060') : '#ffb030';
    c.fillRect(pad + 8 * u, ly + u, Math.round(bw * k), 3 * u);
    c.fillStyle = '#fff1a8';
    c.fillRect(pad + 8 * u, ly + u, Math.round(bw * k), u);
    text(c, `${Math.ceil(this.oil)}S`, pad + 10 * u + bw, ly, u, k < 0.17 ? '#ff8a70' : '#ffd9a8', '#05030a');
    // depth and xp, right side
    const right = this.W * d - pad - 34 * d;
    const dt = `DEPTH ${this.level.depth}`;
    text(c, dt, right - textWidth(dt) * u, top, u, '#ffd24a', '#05030a');
    const xt = `${this.runXp} XP`;
    text(c, xt, right - textWidth(xt) * u, top + 8 * u, u, '#8ff0ff', '#05030a');
    // leave
    const ex = { x: this.W - 40, y: this.opts.top + 4, w: 36, h: 36 };
    c.fillStyle = 'rgba(5,3,10,0.6)';
    c.fillRect(ex.x * d, ex.y * d, ex.w * d, ex.h * d);
    textCentered(c, 'x', (ex.x + ex.w / 2) * d, (ex.y + ex.h / 2) * d - 2.5 * u * 1.4, u * 1.4, '#cfd6e6');
    if (this.phase === 'play') this.buttons.push({ ...ex, go: () => this.end('RUN ENDED') });
    if (this.phase !== 'play') return;
    // swing button
    const sb = this.swingButton();
    const down = this.swingHeld.size > 0 || (this.swingAt > 0 && now - this.swingAt < 120);
    const r = sb.r * d * (down ? 0.92 : 1);
    c.beginPath();
    c.arc(sb.x * d, sb.y * d, r, 0, Math.PI * 2);
    c.fillStyle = down ? 'rgba(255,210,74,0.5)' : 'rgba(255,210,74,0.22)';
    c.fill();
    c.lineWidth = 2.5 * d;
    c.strokeStyle = '#ffd24a';
    c.stroke();
    textCentered(c, 'SWING', sb.x * d, sb.y * d - 2.5 * u, u, '#fff1a8', '#05030a');
    // joystick: where your thumb is, or a ghost of it until you first move
    const st = this.stick;
    const base = st ? { x: st.bx, y: st.by } : { x: 78, y: this.H - this.opts.bottom - 92 };
    const a = st ? 1 : this.moved ? 0.25 : 0.55 + 0.25 * Math.sin(now / 300);
    c.globalAlpha = a;
    c.beginPath();
    c.arc(base.x * d, base.y * d, 46 * d, 0, Math.PI * 2);
    c.fillStyle = 'rgba(255,255,255,0.08)';
    c.fill();
    c.lineWidth = 2 * d;
    c.strokeStyle = 'rgba(255,255,255,0.5)';
    c.stroke();
    let kx = 0;
    let ky = 0;
    if (st) {
      const dx = st.x - st.bx;
      const dy = st.y - st.by;
      const dd = Math.hypot(dx, dy) || 1;
      const m = Math.min(40, dd);
      kx = (dx / dd) * m;
      ky = (dy / dd) * m;
    }
    c.beginPath();
    c.arc((base.x + kx) * d, (base.y + ky) * d, 20 * d, 0, Math.PI * 2);
    c.fillStyle = 'rgba(255,255,255,0.75)';
    c.fill();
    c.globalAlpha = 1;
    if (!this.moved) {
      textCentered(c, 'DRAG TO MOVE', base.x * d, (base.y - 68) * d, u, '#ffffff', '#05030a');
      textCentered(c, 'TAP TO DIG', sb.x * d, (sb.y - 62) * d, u, '#ffffff', '#05030a');
    }
  }

  private panel(c: Ctx, lines: { t: string; c: string; k?: number }[], buttons: { t: string; gold?: boolean; go: () => void }[]) {
    const d = this.dpr;
    const u = Math.max(2, Math.round(d * 1.5));
    const DW = this.canvas.width;
    const DH = this.canvas.height;
    c.fillStyle = 'rgba(5,3,10,0.55)';
    c.fillRect(0, 0, DW, DH);
    const w = Math.min(DW - 32 * d, 330 * d);
    const lineH = 9 * u;
    const bh = 50 * d;
    const hgt = lines.reduce((n, l) => n + lineH * (l.k ?? 1), 0) + buttons.length * (bh + 10 * d) + 36 * d;
    const x = (DW - w) / 2;
    const y = Math.round(DH * 0.5 - hgt / 2);
    c.fillStyle = '#ffcf4a';
    c.fillRect(x - 3 * d, y - 3 * d, w + 6 * d, hgt + 6 * d);
    c.fillStyle = '#1a1226';
    c.fillRect(x, y, w, hgt);
    c.fillStyle = '#241a36';
    c.fillRect(x, y, w, 4 * d);
    let cy = y + 20 * d;
    for (const l of lines) {
      const k = l.k ?? 1;
      textCentered(c, l.t, DW / 2, cy + (lineH * k - 5 * u * k) / 2, u * k, l.c, '#05030a');
      cy += lineH * k;
    }
    cy += 8 * d;
    for (const b of buttons) {
      const bx = x + 16 * d;
      const bw = w - 32 * d;
      c.fillStyle = b.gold ? '#8a4b0a' : '#0a1733';
      c.fillRect(bx, cy + 4 * d, bw, bh);
      c.fillStyle = b.gold ? '#ffcf4a' : '#1f3a78';
      c.fillRect(bx, cy, bw, bh);
      c.fillStyle = b.gold ? '#fff2b8' : '#3559a8';
      c.fillRect(bx, cy, bw, 4 * d);
      textCentered(c, b.t, DW / 2, cy + bh / 2 - 2.5 * u * 1.2, u * 1.2, b.gold ? '#3a1800' : '#ffffff');
      this.buttons.push({ x: bx / d, y: cy / d, w: bw / d, h: (bh + 4 * d) / d, go: b.go });
      cy += bh + 10 * d;
    }
  }

  private drawIntro(c: Ctx, now: number) {
    const runs = this.opts.runs;
    void now;
    const lines = [
      { t: `SPOT ${this.opts.spot + 1} CAVE`, c: '#ffd24a', k: 2 },
      { t: ' ', c: '#fff' },
      { t: 'BREAK ROCKS. GRAB THE GOLD.', c: '#ffffff' },
      { t: 'FIND THE LADDER AND GO DEEPER.', c: '#ffffff' },
      { t: 'WATCH YOUR LANTERN AND THE BATS.', c: '#ffb060' },
      { t: ' ', c: '#fff' },
      { t: this.opts.best > 0 ? `YOUR BEST: DEPTH ${this.opts.best}` : 'XP LEVELS UP YOUR MINER', c: '#8ff0ff' },
    ];
    if (runs > 0) {
      this.panel(c, lines, [
        { t: `START RUN - ${runs} LEFT TODAY`, gold: true, go: () => this.begin() },
        { t: 'BACK', go: () => this.emit({ t: 'close' }) },
      ]);
    } else {
      this.panel(c, [...lines.slice(0, 1), { t: ' ', c: '#fff' }, { t: 'NO RUNS LEFT TODAY', c: '#ff8a70' }, { t: 'MINE A ROUND FOR +1 RUN', c: '#ffffff' }, { t: '3 FREE RUNS EVERY DAY', c: '#cfd6e6' }], [
        { t: 'BACK', gold: true, go: () => this.emit({ t: 'close' }) },
      ]);
    }
  }

  private drawOver(c: Ctx, now: number) {
    if (now - this.phaseAt < 700) return;
    const runs = this.opts.runs;
    const lines = [
      { t: this.why, c: '#ff8a70', k: 2 },
      { t: ' ', c: '#fff' },
      { t: `REACHED DEPTH ${this.level.depth}`, c: '#ffd24a' },
      { t: `+${this.runXp} XP FOR YOUR MINER`, c: '#8ff0ff' },
      { t: this.level.depth >= this.opts.best && this.level.depth > 1 ? 'NEW BEST!' : `BEST: DEPTH ${this.opts.best}`, c: '#c7f284' },
    ];
    const again = runs > 0 ? [{ t: `RUN AGAIN - ${runs} LEFT`, gold: true, go: () => this.begin() }] : [];
    if (!runs) lines.push({ t: 'MINE A ROUND FOR +1 RUN', c: '#ffffff' });
    this.panel(c, lines, [...again, { t: 'BACK', gold: !runs, go: () => this.emit({ t: 'close' }) }]);
  }
}
