/**
 * BrawlOre, drawn and played: the platform fighter's canvas (rules: game/brawl2/sim.ts, bots: game/brawl2/bots.ts).
 *
 * The match runs right here at a fixed 60 steps a second, so a button press moves your miner on the very next
 * frame. Phone controls are drawn and heard inside the canvas too (a floating stick on the left half, four buttons
 * on the right), with no trip through the app, which is what made the old arena's buttons feel late.
 *
 * Keys (computer): A / D or arrows move, W / Up / Space jump, S / Down drop through or aim down,
 * J or left click light attack, K or right click heavy attack, L or Shift dodge.
 */
import { canvasDpr, reducedMotion } from './screen';
import { ctx2d, loadAtlas, makeCanvas, text, textWidth, type Ctx } from './art';
import { drawMiner, frameAt } from './actors';
import type { Look } from './types';
import { Bots } from '../game/brawl2/bots';
import { FPS, MOVES, moveHitbox, newMatch, NO_INPUT, poseOf, step, STOCKS, type Difficulty, type Fighter, type Input, type Match, type Mode, type Weapon } from '../game/brawl2/sim';

export interface BrawlSetup {
  mode: Mode;
  diff: Difficulty;
  name: string;
  look: Look;
  weapon: Weapon;
  seed?: number;
}
export interface BrawlResult {
  mode: Mode;
  diff: Difficulty;
  place: number;
  of: number;
  kos: number;
  falls: number;
  /** everyone, in finishing order */
  table: { name: string; place: number; kos: number; falls: number; you: boolean }[];
}
export type BrawlEvent =
  | { t: 'ready' }
  | { t: 'end'; result: BrawlResult }
  | { t: 'sfx'; name: 'swing' | 'hit' | 'pop' | 'slam' | 'cheer' | 'ko' | 'pick' | 'throw' }
  | { t: 'menu' };

const ME = 'me';
/** each fighter's colour: you are gold */
const COLORS = ['#ffc93c', '#ff5a6a', '#4fd6ef', '#8ef06a'];
const BOT_NAMES = ['Rusty', 'Clank', 'Pebble', 'Grit'];
const BOT_LOOKS: Look[] = [
  { hat: 'hat-red', fit: '#7a2f5c', pick: '#b8c4d6', handle: '#6b4a32', pet: null, glow: 'none', sex: 'm' },
  { hat: 'hat-teal', fit: '#8a7a4a', pick: '#3de0c8', handle: '#2b2140', pet: null, glow: 'none', sex: 'f' },
  { hat: 'hat-songkok', fit: '#ff7a00', pick: '#ffc83d', handle: '#5a3a24', pet: null, glow: 'none', sex: 'm' },
];
/** the world painted behind the stage (map px), wide enough to show the blast zone edges */
const WX0 = -100;
const WY0 = -140;
const WW = 680;
const WH = 540;

interface Fx {
  k: 'spark' | 'ring' | 'beam' | 'dust' | 'word';
  x: number;
  y: number;
  t0: number;
  dur: number;
  c: string;
  vx?: number;
  vy?: number;
  s?: number;
  word?: string;
  ang?: number;
}

export class BrawlEngine {
  private c: Ctx;
  private W = 0;
  private H = 0;
  private dpr = 1;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private world: HTMLCanvasElement | null = null;
  private match: Match | null = null;
  private setup: BrawlSetup | null = null;
  private bots = new Bots();
  private looks = new Map<string, Look>();
  private colorOf = new Map<string, string>();
  private fx: Fx[] = [];
  private shake = { until: 0, mag: 0 };
  private cam = { x: 240, y: 170, z: 2 };
  private sent = false;
  private ready = false;
  private since = new Map<string, { pose: string; at: number }>();
  /* input */
  private keys = new Set<string>();
  private mouse = { light: false, heavy: false };
  private stick: { id: number; ox: number; oy: number; x: number; y: number } | null = null;
  private held = new Map<number, 'jump' | 'light' | 'heavy' | 'dodge'>();

  constructor(
    private canvas: HTMLCanvasElement,
    private emit: (e: BrawlEvent) => void,
    private touch: boolean,
  ) {
    this.c = ctx2d(canvas);
    this.bind();
    (globalThis as unknown as { __brawlore?: BrawlEngine }).__brawlore = this;
  }

  async start(atlasUrl: string) {
    await loadAtlas(atlasUrl);
    this.world = paintWorld();
    this.last = performance.now();
    const loop = (t: number) => {
      this.raf = requestAnimationFrame(loop);
      this.frame(t);
    };
    this.raf = requestAnimationFrame(loop);
    this.ready = true;
    this.emit({ t: 'ready' });
  }
  stop() {
    cancelAnimationFrame(this.raf);
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKey, true);
      window.removeEventListener('keyup', this.onKeyUp, true);
      window.removeEventListener('blur', this.onBlur);
    }
  }
  setTouch(on: boolean) {
    this.touch = on;
  }

  /** Start a match against bots. */
  begin(s: BrawlSetup) {
    this.setup = s;
    const n = s.mode === '1v1' ? 1 : 3;
    const players = [{ id: ME, name: s.name || 'You', bot: null, weapon: s.weapon }];
    for (let k = 0; k < n; k++) players.push({ id: `bot${k}`, name: BOT_NAMES[k], bot: s.diff as never, weapon: 'pick' as Weapon });
    this.match = newMatch({ mode: s.mode, players, seed: s.seed ?? Math.floor(Math.random() * 1e9) });
    this.bots = new Bots();
    this.looks.clear();
    this.colorOf.clear();
    this.looks.set(ME, s.look);
    players.forEach((p, k) => {
      if (p.id !== ME) this.looks.set(p.id, BOT_LOOKS[(k - 1) % BOT_LOOKS.length]);
      this.colorOf.set(p.id, COLORS[k % COLORS.length]);
    });
    this.fx = [];
    this.sent = false;
    this.acc = 0;
    this.cam = { x: 240, y: 170, z: this.cam.z };
  }
  /** Leave the match (back to the menu). */
  quit() {
    this.match = null;
  }

  /* ---------------- input ---------------- */
  private onKey = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(k)) e.preventDefault();
    if (k === 'escape') this.emit({ t: 'menu' });
    this.keys.add(k);
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
  private onBlur = () => {
    this.keys.clear();
    this.mouse = { light: false, heavy: false };
  };
  private bind() {
    if (typeof window === 'undefined') return;
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('blur', this.onBlur);
    const cv = this.canvas;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') {
        if (e.button === 0) this.mouse.light = true;
        if (e.button === 2) this.mouse.heavy = true;
        return;
      }
      e.preventDefault();
      cv.setPointerCapture?.(e.pointerId);
      const x = e.offsetX;
      const y = e.offsetY;
      const b = this.buttonAt(x, y);
      if (b) this.held.set(e.pointerId, b);
      else if (x < this.W * 0.5 && !this.stick) this.stick = { id: e.pointerId, ox: x, oy: y, x, y };
    });
    cv.addEventListener('pointermove', (e) => {
      if (this.stick && e.pointerId === this.stick.id) {
        this.stick.x = e.offsetX;
        this.stick.y = e.offsetY;
      }
    });
    const up = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') {
        if (e.button === 0) this.mouse.light = false;
        if (e.button === 2) this.mouse.heavy = false;
        return;
      }
      this.held.delete(e.pointerId);
      if (this.stick?.id === e.pointerId) this.stick = null;
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
  }

  /** The phone buttons, in CSS px: [id, x, y, radius, label]. */
  private buttons(): ['jump' | 'light' | 'heavy' | 'dodge', number, number, number, string][] {
    const r = Math.max(26, Math.min(40, this.H * 0.085));
    const bx = this.W - r * 1.6;
    const by = this.H - r * 1.5;
    return [
      ['light', bx, by - r * 2.3, r, 'LIGHT'],
      ['heavy', bx - r * 2.3, by - r * 0.9, r, 'HEAVY'],
      ['jump', bx, by, r * 1.05, 'JUMP'],
      ['dodge', bx - r * 2.4, by - r * 3.2, r * 0.8, 'DODGE'],
    ];
  }
  private buttonAt(x: number, y: number) {
    if (!this.touch) return null;
    for (const [id, bx, by, r] of this.buttons()) if (Math.hypot(x - bx, y - by) < r * 1.15) return id;
    return null;
  }

  private myInput(): Input {
    const k = this.keys;
    let mx = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    let my = (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0);
    if (this.stick) {
      const dx = this.stick.x - this.stick.ox;
      const dy = this.stick.y - this.stick.oy;
      const R = 46;
      mx = Math.abs(dx) < 10 ? 0 : Math.max(-1, Math.min(1, dx / R));
      my = Math.abs(dy) < 14 ? 0 : Math.max(-1, Math.min(1, dy / R));
    }
    const held = new Set(this.held.values());
    return {
      mx,
      my,
      jump: k.has('w') || k.has('arrowup') || k.has(' ') || held.has('jump'),
      light: k.has('j') || this.mouse.light || held.has('light'),
      heavy: k.has('k') || this.mouse.heavy || held.has('heavy'),
      dodge: k.has('l') || k.has('shift') || held.has('dodge'),
    };
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
  }

  private frame(t: number) {
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    this.resize();
    const m = this.match;
    if (m && !m.over) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= 1 / FPS && n < 5) {
        this.acc -= 1 / FPS;
        n++;
        const inputs = this.bots.inputs(m);
        inputs[ME] = m.fighters[0].stocks > 0 ? this.myInput() : NO_INPUT;
        step(m, inputs);
        this.react(m);
      }
      if (n === 5) this.acc = 0;
    }
    if (m && m.over && !this.sent) {
      this.sent = true;
      const me = m.fighters[0];
      const table = [...m.fighters].sort((a, b) => a.place - b.place).map((f) => ({ name: f.name, place: f.place, kos: f.kos, falls: f.falls, you: f.id === ME }));
      setTimeout(() => this.emit({ t: 'end', result: { mode: m.mode, diff: this.setup!.diff, place: me.place, of: m.fighters.length, kos: me.kos, falls: me.falls, table } }), 1400);
    }
    this.draw(t);
  }

  /** Effects and sounds for what happened this step. */
  private react(m: Match) {
    const now = performance.now();
    for (const e of m.events) {
      const col = (e.id && this.colorOf.get(e.id)) || '#fff';
      if (e.t === 'hit') {
        const big = Boolean(e.heavy);
        for (let k = 0; k < (big ? 14 : 7); k++) {
          const a = Math.random() * Math.PI * 2;
          const v = (big ? 120 : 70) * (0.5 + Math.random());
          this.fx.push({ k: 'spark', x: e.x!, y: e.y!, t0: now, dur: 260 + Math.random() * 200, c: k % 3 ? '#fff6c0' : this.colorOf.get(e.by!) ?? '#fff', vx: Math.cos(a) * v, vy: Math.sin(a) * v });
        }
        this.fx.push({ k: 'ring', x: e.x!, y: e.y!, t0: now, dur: big ? 320 : 200, c: '#ffffff', s: big ? 22 : 12 });
        if (big) this.kick(260, 3.2);
        else this.kick(90, 1.2);
        this.emit({ t: 'sfx', name: big ? 'slam' : 'hit' });
      } else if (e.t === 'ko') {
        const b = m.stage.blast;
        const ang = e.x! <= b.x0 + 1 ? 0 : e.x! >= b.x1 - 1 ? Math.PI : e.y! <= b.y0 + 1 ? Math.PI / 2 : -Math.PI / 2;
        this.fx.push({ k: 'beam', x: e.x!, y: e.y!, t0: now, dur: 700, c: col, ang });
        this.fx.push({ k: 'word', x: 240, y: 110, t0: now, dur: 1000, c: col, word: e.by === ME ? 'KO!' : e.id === ME ? 'OUCH' : 'KO' });
        this.kick(420, 5);
        this.emit({ t: 'sfx', name: 'ko' });
      } else if (e.t === 'land' && e.heavy) {
        for (let k = 0; k < 6; k++) this.fx.push({ k: 'dust', x: e.x! + (k - 3) * 3, y: e.y!, t0: now, dur: 420, c: '#b9a8c8', vx: (k - 3) * 20, vy: -30 });
      } else if (e.t === 'jump') {
        this.fx.push({ k: 'dust', x: e.x!, y: e.y!, t0: now, dur: 300, c: '#9a8aa8', vx: 0, vy: -10 });
      } else if (e.t === 'swing' && e.id === ME) {
        this.emit({ t: 'sfx', name: 'swing' });
      } else if (e.t === 'dodge') {
        this.fx.push({ k: 'ring', x: e.x!, y: e.y! - 10, t0: now, dur: 220, c: '#c8f0ff', s: 10 });
      } else if (e.t === 'go') {
        this.fx.push({ k: 'word', x: 240, y: 110, t0: now, dur: 800, c: '#ffc93c', word: 'BRAWL!' });
        this.emit({ t: 'sfx', name: 'cheer' });
      } else if (e.t === 'end') {
        this.fx.push({ k: 'word', x: 240, y: 110, t0: now, dur: 1400, c: '#ffc93c', word: 'GAME!' });
        this.emit({ t: 'sfx', name: 'cheer' });
      }
    }
  }
  private kick(ms: number, mag: number) {
    if (reducedMotion()) return;
    const now = performance.now();
    this.shake = { until: now + ms, mag: Math.max(mag, this.shake.until > now ? this.shake.mag : 0) };
  }

  /* ---------------- drawing ---------------- */
  private draw(now: number) {
    const c = this.c;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.imageSmoothingEnabled = false;
    c.fillStyle = '#0b0712';
    c.fillRect(0, 0, this.W, this.H);
    if (!this.world) return;
    const m = this.match;
    // the camera: everyone in play, and the main stage, in view
    let x0 = 120, x1 = 360, y0 = 120, y1 = 210;
    if (m) {
      for (const f of m.fighters) {
        if (f.stocks <= 0 || f.respawn > 0) continue;
        x0 = Math.min(x0, f.x - 30);
        x1 = Math.max(x1, f.x + 30);
        y0 = Math.min(y0, f.y - 50);
        y1 = Math.max(y1, f.y + 20);
      }
      x0 = Math.max(x0, m.stage.blast.x0 + 10);
      x1 = Math.min(x1, m.stage.blast.x1 - 10);
      y0 = Math.max(y0, m.stage.blast.y0 + 10);
      y1 = Math.min(y1, m.stage.blast.y1 - 30);
    }
    const zFit = Math.min(this.W / (x1 - x0 + 60), this.H / (y1 - y0 + 70));
    const zMax = this.touch ? 3.2 : 3;
    const z = Math.max(this.W / WW, Math.min(zMax, zFit));
    this.cam.z += (z - this.cam.z) * 0.06;
    this.cam.x += ((x0 + x1) / 2 - this.cam.x) * 0.1;
    this.cam.y += ((y0 + y1) / 2 - this.cam.y) * 0.1;
    const Z = this.cam.z;
    let shx = 0, shy = 0;
    if (now < this.shake.until) {
      shx = (Math.random() - 0.5) * this.shake.mag * 2;
      shy = (Math.random() - 0.5) * this.shake.mag * 2;
    }
    const ox = this.W / 2 - this.cam.x * Z + shx;
    const oy = this.H / 2 - this.cam.y * Z + shy;
    const sx = (x: number) => ox + x * Z;
    const sy = (y: number) => oy + y * Z;
    c.drawImage(this.world, sx(WX0), sy(WY0), WW * Z, WH * Z);
    // torches flicker
    for (const [tx, ty] of TORCHES) {
      const fl = 0.75 + 0.25 * Math.sin(now / 90 + tx) * Math.sin(now / 37 + ty);
      const gl = c.createRadialGradient(sx(tx), sy(ty - 3), 0, sx(tx), sy(ty - 3), 26 * Z);
      gl.addColorStop(0, `rgba(255,150,50,${0.28 * fl})`);
      gl.addColorStop(1, 'rgba(255,150,50,0)');
      c.fillStyle = gl;
      c.fillRect(sx(tx - 26), sy(ty - 29), 52 * Z, 52 * Z);
      // the sconce, and a flame that flickers
      c.fillStyle = '#2a1e30';
      c.fillRect(sx(tx - 2), sy(ty), 5 * Z, 2 * Z);
      c.fillRect(sx(tx), sy(ty + 2), 1 * Z, 4 * Z);
      const h = 3 + Math.round(fl * 3);
      c.fillStyle = '#ff7a1a';
      c.fillRect(sx(tx - 1), sy(ty - h), 3 * Z, h * Z);
      c.fillStyle = '#ffe08a';
      c.fillRect(sx(tx), sy(ty - h + 1), 1 * Z, (h - 1) * Z);
    }
    if (!m) {
      this.drawTouch(now, false);
      return;
    }
    // fighters
    const order = [...m.fighters].sort((a, b) => (a.id === ME ? 1 : 0) - (b.id === ME ? 1 : 0));
    for (const f of order) this.drawFighter(c, f, m, sx, sy, Z, now);
    // effects
    this.fx = this.fx.filter((e) => now - e.t0 < e.dur);
    for (const e of this.fx) this.drawFx(c, e, now, sx, sy, Z);
    // someone off screen: a bubble at the edge pointing at them
    for (const f of m.fighters) {
      if (f.stocks <= 0 || f.respawn > 0) continue;
      const X = sx(f.x), Y = sy(f.y - 12);
      if (X > 0 && X < this.W && Y > 0 && Y < this.H) continue;
      const bx = Math.max(22, Math.min(this.W - 22, X));
      const by = Math.max(22, Math.min(this.H - 22, Y));
      c.fillStyle = 'rgba(10,6,18,0.85)';
      c.beginPath();
      c.arc(bx, by, 16, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = this.colorOf.get(f.id) ?? '#fff';
      c.lineWidth = 2;
      c.stroke();
      drawMiner(c, this.looks.get(f.id)!, 'idle', 0, bx, by + 10, 1, f.facing);
    }
    this.drawHud(c, m, now);
    this.drawTouch(now, !m.over);
  }

  private drawFighter(c: Ctx, f: Fighter, m: Match, sx: (x: number) => number, sy: (y: number) => number, Z: number, now: number) {
    if (f.stocks <= 0 || f.respawn > 0) return;
    const look = this.looks.get(f.id)!;
    const col = this.colorOf.get(f.id) ?? '#fff';
    const pv = poseOf(f);
    const prev = this.since.get(f.id);
    if (!prev || prev.pose !== pv.pose) this.since.set(f.id, { pose: pv.pose, at: now });
    const k = pv.k >= 0 ? pv.k : frameAt(pv.pose, this.since.get(f.id)!.at, now);
    // the floor under them, for the shadow
    const under = m.stage.plats.filter((p) => f.x >= p.x0 && f.x <= p.x1 && p.y >= f.y - 1).sort((a, b) => a.y - b.y)[0];
    const gy = under ? under.y : f.y;
    const lift = under ? Math.min(60, gy - f.y) : 0;
    const blink = f.invuln > 0 && Math.floor(now / 80) % 2 === 0;
    const tilt = f.hitstun > 0 ? Math.max(-0.9, Math.min(0.9, (f.vx / 400) * -f.facing)) : f.dodge > 0 ? 0.3 * f.facing : 0;
    // the active hit: a slash arc where the weapon is
    if (f.act) {
      const mv = MOVES[f.weapon][f.act.move];
      if (f.act.f >= mv.start - 1 && f.act.f < mv.start + mv.active + 1) {
        const hb = moveHitbox(f, mv);
        c.strokeStyle = f.act.move.endsWith('Heavy') || f.act.move === 'pound' ? '#fff3b0' : 'rgba(255,255,255,0.85)';
        c.lineWidth = Math.max(2, Z * 1.6);
        c.beginPath();
        const cx = sx((hb.x0 + hb.x1) / 2), cy = sy((hb.y0 + hb.y1) / 2);
        const r = Math.max(hb.x1 - hb.x0, hb.y1 - hb.y0) * 0.55 * Z;
        const a0 = f.facing > 0 ? -1.4 : Math.PI - 0.4;
        c.arc(cx, cy, r, a0, a0 + 1.8);
        c.stroke();
      }
    }
    if (f.dodge > 0) {
      c.globalAlpha = 0.35;
      drawMiner(c, look, pv.pose, k, sx(f.x - f.vx * 0.04), sy(gy), Z, f.facing, 0.5, lift, tilt);
      c.globalAlpha = 1;
    }
    drawMiner(c, look, pv.pose, k, sx(f.x), sy(gy), Z, f.facing, blink ? 0.35 : f.dodge > 0 ? 0.6 : 1, lift, tilt);
    // name over the head, YOU arrow
    const label = f.id === ME ? 'YOU' : f.name;
    const ts = Math.max(1, Math.round(Z * 0.5));
    const tw = textWidth(label) * ts;
    const ty = sy(f.y - 34);
    text(c, label, sx(f.x) - tw / 2, ty, ts, col, '#120c1a');
    if (f.id === ME) {
      c.fillStyle = col;
      const ax = sx(f.x);
      c.beginPath();
      c.moveTo(ax - 3 * ts, ty + 7 * ts);
      c.lineTo(ax + 3 * ts, ty + 7 * ts);
      c.lineTo(ax, ty + 10 * ts);
      c.fill();
    }
  }

  private drawFx(c: Ctx, e: Fx, now: number, sx: (x: number) => number, sy: (y: number) => number, Z: number) {
    const p = (now - e.t0) / e.dur;
    const t = (now - e.t0) / 1000;
    if (e.k === 'spark' || e.k === 'dust') {
      const x = e.x + (e.vx ?? 0) * t;
      const y = e.y + (e.vy ?? 0) * t + (e.k === 'dust' ? 0 : 180 * t * t);
      c.globalAlpha = 1 - p;
      c.fillStyle = e.c;
      const s = (e.k === 'dust' ? 2 : 1.5) * Z;
      c.fillRect(sx(x) - s / 2, sy(y) - s / 2, s, s);
      c.globalAlpha = 1;
    } else if (e.k === 'ring') {
      c.globalAlpha = 1 - p;
      c.strokeStyle = e.c;
      c.lineWidth = Math.max(1.5, Z * (1 - p) * 2);
      c.beginPath();
      c.arc(sx(e.x), sy(e.y), (e.s ?? 10) * (0.4 + p) * Z, 0, Math.PI * 2);
      c.stroke();
      c.globalAlpha = 1;
    } else if (e.k === 'beam') {
      // the KO blast: a wide beam of the fighter's colour from where they flew out
      c.save();
      c.translate(sx(e.x), sy(e.y));
      c.rotate(e.ang ?? 0);
      c.globalAlpha = Math.max(0, 1 - p);
      const g = c.createLinearGradient(0, 0, 260 * Z, 0);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.25, e.c);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      const h = (18 + 30 * (1 - p)) * Z;
      c.fillRect(0, -h / 2, 260 * Z, h);
      c.restore();
      c.globalAlpha = 1;
    } else if (e.k === 'word') {
      // big centred word on the screen
      const s = Math.max(3, Math.round(Math.min(this.W, this.H) / 70));
      const pop = p < 0.15 ? 1 + (0.15 - p) * 4 : 1;
      const ss = Math.round(s * pop);
      const w = textWidth(e.word!) * ss;
      c.globalAlpha = p > 0.75 ? (1 - p) * 4 : 1;
      text(c, e.word!, this.W / 2 - w / 2, this.H * 0.3, ss, e.c, '#120c1a');
      c.globalAlpha = 1;
    }
  }

  private drawHud(c: Ctx, m: Match, now: number) {
    const s = Math.max(2, Math.round(Math.min(this.W, this.H) / 200));
    // countdown, then the clock
    if (m.countdown > 0) {
      const n = Math.ceil(m.countdown / FPS);
      const big = s * 4;
      const w = textWidth(String(n)) * big;
      text(c, String(n), this.W / 2 - w / 2, this.H * 0.3, big, '#ffc93c', '#120c1a');
    } else {
      const secs = Math.max(0, Math.ceil(m.timeLeft / FPS));
      const t = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      const w = textWidth(t) * s;
      text(c, t, this.W / 2 - w / 2, 12, s, secs <= 10 ? '#ff5a6a' : '#f4ecff', '#120c1a');
    }
    // a card per fighter along the bottom (on a phone, along the top so thumbs don't cover it)
    const n = m.fighters.length;
    const cw = Math.min(150, (this.W - 40) / n - 8);
    const ch = 16 * s;
    const total = n * cw + (n - 1) * 8;
    const left = this.touch ? this.W / 2 - total / 2 : this.W / 2 - total / 2;
    const top = this.touch ? 12 + 10 * s : this.H - ch - 12;
    m.fighters.forEach((f, k) => {
      const x = left + k * (cw + 8);
      const col = this.colorOf.get(f.id) ?? '#fff';
      c.fillStyle = 'rgba(12,8,22,0.82)';
      c.fillRect(x, top, cw, ch);
      c.fillStyle = col;
      c.fillRect(x, top, 3, ch);
      const name = (f.id === ME ? 'YOU' : f.name).slice(0, 8);
      text(c, name, x + 7, top + 3, Math.max(1, s - 1), col);
      // damage %: white to yellow to red as it rises; out = grey
      const d = Math.round(f.dmg);
      const dc = f.stocks <= 0 ? '#5a5070' : d < 50 ? '#ffffff' : d < 100 ? '#ffe46a' : d < 150 ? '#ff9a3a' : '#ff4a4a';
      const ds = f.stocks <= 0 ? 'OUT' : `${d}%`;
      const shakeX = f.hitstun > 0 && f.stocks > 0 ? Math.round((Math.random() - 0.5) * 3) : 0;
      text(c, ds, x + cw - textWidth(ds) * (s + 1) - 6 + shakeX, top + 3 + s * 2, s + 1, dc, '#120c1a');
      for (let i = 0; i < STOCKS; i++) {
        c.fillStyle = i < f.stocks ? col : 'rgba(255,255,255,0.15)';
        c.fillRect(x + 7 + i * (s * 4), top + ch - s * 4, s * 3, s * 3);
      }
      if (f.respawn > 0 && f.stocks > 0) {
        c.globalAlpha = 0.6;
        c.fillStyle = '#000';
        c.fillRect(x, top, cw, ch);
        c.globalAlpha = 1;
      }
    });
    void now;
  }

  private drawTouch(now: number, live: boolean) {
    if (!this.touch || !live) return;
    const c = this.c;
    const held = new Set(this.held.values());
    for (const [id, x, y, r, label] of this.buttons()) {
      const on = held.has(id);
      c.fillStyle = on ? 'rgba(255,201,60,0.55)' : 'rgba(14,10,26,0.55)';
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = id === 'jump' ? '#ffc93c' : id === 'heavy' ? '#ff7a4a' : id === 'dodge' ? '#8fd8ff' : '#f4ecff';
      c.lineWidth = 2.5;
      c.stroke();
      const s = r > 34 ? 2 : 1;
      text(c, label, x - (textWidth(label) * s) / 2, y - 3 * s, s, '#f4ecff', '#120c1a');
    }
    if (this.stick) {
      const { ox, oy, x, y } = this.stick;
      c.strokeStyle = 'rgba(244,236,255,0.5)';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(ox, oy, 46, 0, Math.PI * 2);
      c.stroke();
      const dx = x - ox, dy = y - oy;
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(46, d) / d;
      c.fillStyle = 'rgba(255,201,60,0.7)';
      c.beginPath();
      c.arc(ox + dx * k, oy + dy * k, 18, 0, Math.PI * 2);
      c.fill();
    } else {
      // a hint where the stick goes
      c.globalAlpha = 0.35 + 0.15 * Math.sin(now / 500);
      text(c, 'MOVE', 40, this.H - 40, 2, '#f4ecff', '#120c1a');
      c.globalAlpha = 1;
    }
  }
}

/* ---------------- the hall, painted once ---------------- */
const TORCHES: [number, number][] = [
  [60, 90],
  [180, 70],
  [300, 70],
  [420, 90],
];

function paintWorld(): HTMLCanvasElement {
  const cv = makeCanvas(WW, WH);
  const g = ctx2d(cv);
  const px = (x: number, y: number, w: number, h: number, col: string) => {
    g.fillStyle = col;
    g.fillRect(Math.round(x - WX0), Math.round(y - WY0), Math.round(w), Math.round(h));
  };
  // night air: dark violet at the top, black in the abyss
  for (let y = WY0; y < WY0 + WH; y++) {
    const k = (y - WY0) / WH;
    const r = Math.round(30 - 22 * k), gg = Math.round(18 - 12 * k), b = Math.round(46 - 30 * k);
    px(WX0, y, WW, 1, `rgb(${Math.max(6, r)},${Math.max(4, gg)},${Math.max(10, b)})`);
  }
  // the far wall of the hall: stone with tall arched windows glowing red
  for (let y = -40; y < 260; y += 9) {
    for (let x = WX0; x < WX0 + WW; x += 16) {
      const off = ((y + 40) / 9) % 2 ? 0 : 8;
      px(x + off, y, 15, 8, (x * 7 + y * 3) % 5 ? '#1c1328' : '#20162e');
    }
  }
  for (const wx of [0, 120, 240, 360, 480]) {
    // window: arch top, red glow, mullions
    const w = 34, top = 10, bot = 150;
    for (let y = top; y < bot; y++) {
      const half = y < top + w / 2 ? Math.sqrt(Math.max(0, (w / 2) ** 2 - (top + w / 2 - y) ** 2)) : w / 2;
      const k = (y - top) / (bot - top);
      px(wx - half, y, half * 2, 1, `rgb(${Math.round(150 - 60 * k)},${Math.round(24 + 10 * k)},${Math.round(40 + 6 * k)})`);
    }
    px(wx - 1, top + 6, 2, bot - top - 6, '#3a1420');
    for (let y = top + 30; y < bot; y += 28) px(wx - w / 2, y, w, 2, '#3a1420');
    // pillar between windows
    px(wx + 60 - 7, -40, 14, 300, '#140d1c');
    px(wx + 60 - 7, -40, 2, 300, '#2a1e3a');
  }
  // the abyss below: mist bands
  for (let y = 240; y < 400; y += 6) {
    const a = Math.min(0.35, (y - 240) / 400);
    g.fillStyle = `rgba(90,60,130,${a})`;
    g.fillRect(0, y - WY0, WW, 2);
  }
  // the main stage: a thick block of stone over the abyss, with a lit top edge and roots hanging under it
  const main = { x0: 110, x1: 370, y: 196 };
  for (let y = main.y; y < main.y + 40; y++) {
    const inset = Math.max(0, (y - main.y - 22) * 1.6);
    px(main.x0 + inset, y, main.x1 - main.x0 - inset * 2, 1, y === main.y ? '#c8b8e0' : y < main.y + 3 ? '#7a6a96' : (y % 6 === 0 ? '#2e2240' : '#3a2c50'));
  }
  for (let x = main.x0 + 6; x < main.x1 - 6; x += 22) px(x, main.y + 4, 1, 14, '#2a1e3a');
  for (let x = main.x0 + 20; x < main.x1 - 20; x += 37) px(x, main.y + 40, 1, 10 + (x % 7), '#2a1e3a');
  // soft platforms: thin slabs hung on chains
  for (const p of [{ x0: 140, x1: 214, y: 150 }, { x0: 266, x1: 340, y: 150 }]) {
    px(p.x0, p.y, p.x1 - p.x0, 1, '#d8c8f0');
    px(p.x0, p.y + 1, p.x1 - p.x0, 3, '#6a5a86');
    px(p.x0 + 2, p.y + 4, p.x1 - p.x0 - 4, 1, '#3a2c50');
    for (const cx of [p.x0 + 6, p.x1 - 7]) for (let y = -40; y < p.y; y += 4) px(cx, y, 1, 2, '#4a3c60');
  }
  return cv;
}
