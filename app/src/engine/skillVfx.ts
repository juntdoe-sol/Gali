/**
 * Fight Club skill effects, in pixels: fire, smoke, sparks, debris, water, projectiles and shock rings, one look per
 * skill. Everything lives in world px (the fight's map units) and is drawn snapped to that grid, so it reads as pixel
 * art at any zoom. Light is a soft additive glow on top. No randomness leaks into the match: this is drawing only.
 *
 * The engine calls skill() when a fighter starts a skill (with the move, so timings match its frames), hit() when a
 * skill lands, blink() when Tunnel Dig pops up, then update(dt) and draw() every frame.
 */
import type { Ctx } from './art';
import type { Move, SkillId } from '../game/brawl2/sim';

const FPS = 60;
type V = { x: number; y: number };
type Kind = 'fire' | 'smoke' | 'spark' | 'chip' | 'drop' | 'dust' | 'ember' | 'bolt';
interface Part {
  k: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  s: number;
  c: string;
  g: number;
  drag: number;
}
interface Light {
  x: number;
  y: number;
  r: number;
  c: string;
  life: number;
  max: number;
  k: number;
}
interface Ring {
  x: number;
  y: number;
  r0: number;
  r1: number;
  life: number;
  max: number;
  c: string;
  flat: number;
  w: number;
}
/** something drawn by its own function for a while: a projectile, a crescent, a beam, a shield */
interface Prop {
  t: number;
  max: number;
  /** delay before it shows */
  wait: number;
  draw: (c: Ctx, t: number, P: Pen) => void;
  step?: (t: number, dt: number) => void;
}
/** a pen in world px: blocks snapped to the pixel grid */
export interface Pen {
  px: (x: number, y: number, w: number, h: number, c: string, a?: number) => void;
  Z: number;
  sx: (x: number) => number;
  sy: (y: number) => number;
}

// colour ramps, hottest first
const FIRE = ['#ffffff', '#fff3a0', '#ffd23c', '#ff9a2a', '#f0542a', '#a8282c', '#5a1a26'];
const SMOKE = ['#6a5a6e', '#4e4256', '#3a3044', '#2a2234'];
const WATER = ['#ffffff', '#c8f4ff', '#7ad8ff', '#3a9ae0', '#2060b0'];
const ROCK = ['#e8d0a8', '#c8a070', '#9a7650', '#6e5238', '#463424'];
const ramp = (r: string[], p: number) => r[Math.min(r.length - 1, Math.max(0, Math.floor(p * r.length)))];

/** a tiny seeded random, so the look is lively but never touches the match */
let seed = 1;
const rnd = (a = 0, b = 1) => {
  seed = (seed * 16807) % 2147483647;
  return a + ((seed - 1) / 2147483646) * (b - a);
};

export class SkillVfx {
  private parts: Part[] = [];
  private lights: Light[] = [];
  private rings: Ring[] = [];
  private props: Prop[] = [];
  private emitters: { t: number; max: number; wait: number; tick: (t: number, dt: number) => void }[] = [];
  /** marks left on the floor: scorch, frost, cracks; they fade */
  private decals: { x: number; y: number; w: number; c: string; life: number; max: number; seed: number }[] = [];
  /** a white flash over everything, for the biggest hits */
  private flash = 0;

  constructor(private posOf: (id: string) => (V & { facing: number; vx: number; vy: number; alive: boolean }) | null) {}

  clear() {
    this.parts = [];
    this.lights = [];
    this.rings = [];
    this.props = [];
    this.emitters = [];
    this.decals = [];
    this.flash = 0;
  }

  /** A status on a miner's body for a while: flames, frost arrows, crackling current or gold motes. */
  status(id: string, kind: 'burn' | 'frost' | 'shock' | 'gold', ms: number) {
    const at = () => this.posOf(id);
    if (kind === 'frost') {
      // a column of ice arrows driving down onto them, the way a seal pins a target
      this.prop(0, ms, (c, t, P) => {
        const f = at();
        if (f) frostArrows(P, f.x, f.y, t, 1 - Math.max(0, (t - ms / 1000 + 0.25) / 0.25));
      });
    }
    this.during(0, ms, () => {
      const f = at();
      if (!f) return;
      const bx = f.x + rnd(-5, 5), by = f.y - rnd(2, 22);
      if (kind === 'burn') {
        for (let i = 0; i < 2; i++) this.part('fire', bx, by, rnd(-8, 8), -rnd(30, 70), rnd(0.2, 0.4), rnd(2, 4), '', -60, 0.9);
        if (rnd() < 0.3) this.part('ember', bx, by, rnd(-20, 20), -rnd(40, 90), 0.6, 1, '#ffd23c', 60, 0.97);
        if (rnd() < 0.15) this.part('smoke', bx, by - 6, rnd(-6, 6), -rnd(10, 25), 0.7, 3, '', -6, 0.96);
        if (rnd() < 0.2) this.light(f.x, f.y - 12, 22, '#ff7a2a', 0.12, 0.5);
      } else if (kind === 'frost') {
        if (rnd() < 0.5) this.part('spark', bx, by, rnd(-10, 10), rnd(10, 40), 0.3, 1, rnd() < 0.5 ? '#ffffff' : '#9adcff', 0, 0.95);
        if (rnd() < 0.2) this.light(f.x, f.y - 12, 22, '#6ab8ff', 0.12, 0.5);
      } else if (kind === 'shock') {
        if (rnd() < 0.6) this.part('bolt', bx, by, rnd() < 0.5 ? 80 : -80, 0, 0.06, rnd(3, 6), rnd() < 0.5 ? '#ffffff' : '#ffe27a', 0, 0.8);
      } else {
        if (rnd() < 0.5) this.part('spark', bx, by, rnd(-6, 6), -rnd(20, 50), 0.5, 1, rnd() < 0.5 ? '#ffffff' : '#ffe27a', -20, 0.96);
      }
    });
  }
  /** a mark on the floor: scorch, frost or a crack, fading over a couple of seconds */
  decal(x: number, y: number, w: number, c: string, ms = 2200) {
    if (this.decals.length > 40) this.decals.shift();
    this.decals.push({ x, y, w, c, life: ms / 1000, max: ms / 1000, seed: Math.floor(rnd(1, 9999)) });
  }

  /* ---------------- building blocks ---------------- */
  private part(k: Kind, x: number, y: number, vx: number, vy: number, life: number, s = 1, c = '#fff', g = 0, drag = 0.9) {
    if (this.parts.length > 900) return;
    this.parts.push({ k, x, y, vx, vy, life, max: life, s, c, g, drag });
  }
  private light(x: number, y: number, r: number, c: string, life: number, k = 0.6) {
    this.lights.push({ x, y, r, c, life, max: life, k });
  }
  private ring(x: number, y: number, r0: number, r1: number, life: number, c: string, flat = 1, w = 2) {
    this.rings.push({ x, y, r0, r1, life, max: life, c, flat, w });
  }
  private later(ms: number, fn: () => void) {
    this.emitters.push({ t: 0, max: 0.001, wait: ms / 1000, tick: fn });
  }
  private during(waitMs: number, lenMs: number, tick: (t: number, dt: number) => void) {
    this.emitters.push({ t: 0, max: lenMs / 1000, wait: waitMs / 1000, tick });
  }
  private prop(waitMs: number, lenMs: number, draw: Prop['draw'], step?: Prop['step']) {
    this.props.push({ t: 0, max: lenMs / 1000, wait: waitMs / 1000, draw, step });
  }

  /** A burst of flame: tongues that rise and cool, embers, a puff of smoke, a flash of light. */
  private fireBurst(x: number, y: number, n: number, spread: number, up: number, scale = 1) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, Math.PI * 2);
      const v = rnd(0.3, 1) * spread;
      this.part('fire', x + rnd(-2, 2), y + rnd(-2, 2), Math.cos(a) * v, Math.sin(a) * v * 0.6 - rnd(0.3, 1) * up, rnd(0.25, 0.55) * scale, rnd(2, 4) * scale, '', -40, 0.9);
    }
    for (let i = 0; i < n / 3; i++) this.part('ember', x, y, rnd(-1, 1) * spread * 1.4, -rnd(40, 120), rnd(0.4, 0.9), 1, rnd() < 0.5 ? '#ffd23c' : '#ff7a2a', 180, 0.97);
    for (let i = 0; i < n / 4; i++) this.part('smoke', x + rnd(-4, 4), y - 4, rnd(-20, 20), -rnd(10, 30), rnd(0.6, 1.1), rnd(3, 5) * scale, '', -10, 0.96);
    this.light(x, y, 34 * scale, '#ff9a2a', 0.4, 0.8);
    this.decal(x, y + 4, 14 * scale, '#3a1410');
  }
  /** A rolling fireball: a disc of flame that swells fast, boils and burns down to smoke. */
  private boom(x: number, y: number, r: number, ms = 520) {
    const len = ms / 1000;
    this.prop(0, ms, (c, t, P) => {
      const u = t / len;
      const rad = r * (u < 0.15 ? u / 0.15 : 1 - (u - 0.15) * 0.5);
      for (let yy = -rad; yy <= rad; yy++) for (let xx = -rad; xx <= rad; xx++) {
        const d = Math.hypot(xx, yy * 1.1) / Math.max(1, rad);
        if (d > 1) continue;
        // boiling edge: a cheap noise from the position and time
        const n = Math.sin(xx * 1.7 + t * 23) * Math.sin(yy * 1.9 - t * 19) * 0.18;
        const heat = d + u * 0.9 + n - (yy < 0 ? 0.05 : -0.08);
        if (heat > 1.25) continue;
        P.px(x + xx, y + yy - u * 8, 1, 1, heat > 1 ? SMOKE[Math.min(3, Math.floor((heat - 1) * 12))] : ramp(FIRE, heat * 0.95));
      }
    });
  }
  private sparks(x: number, y: number, n: number, sp: number, c: string, dir = 0, cone = Math.PI) {
    for (let i = 0; i < n; i++) {
      const a = dir + rnd(-cone, cone);
      const v = rnd(0.4, 1) * sp;
      this.part('spark', x, y, Math.cos(a) * v, Math.sin(a) * v, rnd(0.15, 0.4), 1, rnd() < 0.3 ? '#ffffff' : c, 240, 0.94);
    }
  }
  private debris(x: number, y: number, n: number, sp: number, up: number, cols = ROCK) {
    for (let i = 0; i < n; i++) this.part('chip', x + rnd(-6, 6), y, rnd(-1, 1) * sp, -rnd(0.4, 1) * up, rnd(0.5, 0.9), rnd() < 0.3 ? 3 : 2, cols[1 + Math.floor(rnd(0, cols.length - 1))], 520, 0.99);
  }
  private dust(x: number, y: number, n: number, sp: number, c = '#b9a8c8') {
    for (let i = 0; i < n; i++) this.part('dust', x + rnd(-4, 4), y - 1, rnd(-1, 1) * sp, -rnd(5, 25), rnd(0.4, 0.8), rnd(2, 4), c, -8, 0.93);
  }

  /* ---------------- the skills ---------------- */
  /**
   * A fighter started a skill. `mv` is the move (frames for wind-up and active), `pos` where they stand,
   * `d` the way they face, `col` the skill's colour.
   */
  skill(k: SkillId, id: string, mv: Move, pos: V, d: number, col: string) {
    seed = (Math.floor(pos.x * 31 + pos.y * 17) % 2147483646) + 1;
    const on = (mv.start / FPS) * 1000;
    const act = (mv.active / FPS) * 1000;
    const at = () => this.posOf(id);
    const x = pos.x, y = pos.y;
    // a gather of light in the skill's colour on every skill: the wind-up reads
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      this.part('spark', x + Math.cos(a) * 14, y - 12 + Math.sin(a) * 10, -Math.cos(a) * 60, -Math.sin(a) * 45, 0.18, 1, col, 0, 0.9);
    }
    this.light(x, y - 12, 18, col, Math.max(0.15, on / 1000), 0.5);

    switch (k) {
      case 'moon': {
        // a rising green crescent and a column of motes following the uppercut
        this.prop(0, on + act + 120, (c, t, P) => {
          const f = at();
          if (!f) return;
          const p = Math.min(1, t / ((on + act) / 1000));
          const fa = 1 - Math.max(0, (t - (on + act) / 1000) / 0.12);
          glowArc(c, P, f.x + d * 4, f.y - 18, 20, d > 0 ? -Math.PI * 0.9 + p * 1.4 : Math.PI * 1.9 - p * 1.4, 2.2, col, fa, 1);
          crescent(P, f.x + d * 4, f.y - 18, 16, -Math.PI * 0.9 + p * 1.2, 2.2, col, d, fa);
        });
        this.during(0, on + act, () => {
          const f = at();
          if (f) this.part('spark', f.x + rnd(-5, 5), f.y - rnd(0, 24), rnd(-10, 10), rnd(30, 80), rnd(0.2, 0.4), 1, rnd() < 0.4 ? '#ffffff' : col, 0, 0.92);
        });
        break;
      }
      case 'rush': {
        // after-images streak behind, electric sparks crackle off the body
        this.during(on * 0.5, act + on * 0.5, () => {
          const f = at();
          if (!f) return;
          for (let i = 0; i < 2; i++) this.part('bolt', f.x - d * rnd(4, 14), f.y - rnd(4, 22), -d * rnd(80, 160), 0, rnd(0.12, 0.22), rnd(4, 9), rnd() < 0.5 ? '#ffffff' : col, 0, 0.85);
          if (rnd() < 0.5) this.sparks(f.x + d * 8, f.y - 12, 2, 90, col, d < 0 ? 0 : Math.PI, 0.6);
        });
        this.later(on, () => this.light(x, y - 12, 26, col, 0.25, 0.7));
        break;
      }
      case 'quake': {
        this.later(on, () => {
          const f = at() ?? { x, y };
          this.ring(f.x, f.y, 4, 46, 0.35, col, 0.28, 2);
          this.ring(f.x, f.y, 2, 30, 0.25, '#ffffff', 0.28, 1);
          this.debris(f.x, f.y, 18, 110, 230);
          this.dust(f.x - 18, f.y, 6, 60, ROCK[1]);
          this.dust(f.x + 18, f.y, 6, 60, ROCK[1]);
          this.light(f.x, f.y - 4, 40, col, 0.3, 0.6);
          // a crack runs along the floor both ways, glowing
          this.prop(0, 600, (c, t, P) => crack(P, f.x, f.y, 34 * Math.min(1, t / 0.12), col, 1 - t / 0.6));
        });
        break;
      }
      case 'whirl': {
        this.prop(on * 0.6, act + 200, (c, t, P) => {
          const f = at();
          if (!f) return;
          const spin = t * 26;
          const fa = 1 - Math.max(0, (t - act / 1000) / 0.2);
          for (let j = 0; j < 2; j++) glowArc(c, P, f.x, f.y - 12, 20 - j * 5, spin + j * Math.PI, 2.2, j ? '#ffffff' : col, fa, 0.6);
        });
        this.during(on, act, () => {
          const f = at();
          if (!f) return;
          const a = rnd(0, Math.PI * 2);
          this.part('spark', f.x + Math.cos(a) * 15, f.y - 12 + Math.sin(a) * 9, -Math.sin(a) * 140, Math.cos(a) * 90, 0.3, 1, rnd() < 0.5 ? '#ffffff' : col, 60, 0.95);
        });
        break;
      }
      case 'dive': {
        // Liquidation: a red-hot dive trailing fire, a burst where it ends
        this.during(on * 0.5, act, () => {
          const f = at();
          if (!f) return;
          for (let i = 0; i < 3; i++) this.part('fire', f.x - d * rnd(0, 6), f.y - rnd(4, 16), -d * rnd(10, 40) - f.vx * 0.2, rnd(-20, 10), rnd(0.18, 0.35), rnd(2, 4), '', -30, 0.9);
        });
        this.later(on + act, () => {
          const f = at() ?? { x, y };
          this.boom(f.x + d * 6, f.y - 6, 8, 420);
          this.fireBurst(f.x + d * 6, f.y - 4, 26, 90, 70);
          this.ring(f.x + d * 6, f.y, 3, 30, 0.3, '#ff5a3c', 0.3, 2);
        });
        break;
      }
      case 'guard': {
        // Diamond Hands: a faceted crystal shell round the body, glinting
        this.prop(0, on + act + 150, (c, t, P) => {
          const f = at();
          if (!f) return;
          const fade = 1 - Math.max(0, (t - (on + act) / 1000) / 0.15);
          diamondShell(P, f.x, f.y - 12, 15, 17, col, t, fade);
        });
        break;
      }
      case 'grab': {
        this.later(on, () => {
          const f = at() ?? { x, y };
          this.light(f.x + d * 12, f.y - 14, 14, col, 0.2, 0.7);
          this.sparks(f.x + d * 12, f.y - 14, 8, 90, col, d > 0 ? 0 : Math.PI, 0.7);
        });
        this.prop(on, 160, (c, t, P) => {
          const f = at();
          if (f) fist(P, f.x + d * (8 + t * 40), f.y - 14, d, col, 1 - t / 0.16);
        });
        break;
      }
      case 'slide': {
        this.during(on, act, () => {
          const f = at();
          if (!f) return;
          this.part('dust', f.x - d * 6, f.y - 1, -d * rnd(20, 60), -rnd(4, 18), rnd(0.3, 0.6), rnd(2, 4), '#c8b8a0', -6, 0.92);
          // grinding sparks off the floor
          for (let i = 0; i < 2; i++) this.part('spark', f.x + d * 4, f.y - 1, -d * rnd(60, 180), -rnd(30, 120), rnd(0.15, 0.3), 1, rnd() < 0.5 ? '#ffffff' : col, 320, 0.97);
        });
        this.prop(on, act + 100, (c, t, P) => {
          const f = at();
          if (f) streaks(P, f.x, f.y - 6, d, col, 1 - Math.max(0, t - act / 1000) / 0.1, 3);
        });
        break;
      }
      case 'magnet': {
        // a chain shoots out with a horseshoe magnet on the end, crackling, and reels back in
        const reach = mv.hx + mv.hw;
        this.prop(on * 0.8, act + 260, (c, t, P) => {
          const f = at();
          if (!f) return;
          const out = Math.min(1, t / (act / 1000)) ;
          const back = Math.max(0, (t - act / 1000) / 0.26);
          const len = reach * (back > 0 ? 1 - back : out);
          chain(P, f.x + d * 6, f.y - 14, len, d, col, t);
        });
        this.during(on, act + 200, (t) => {
          const f = at();
          if (!f) return;
          const len = reach * Math.min(1, t / (act / 1000));
          if (rnd() < 0.7) this.part('bolt', f.x + d * (6 + rnd(0, len)), f.y - 14 + rnd(-4, 4), 0, rnd(-20, 20), 0.08, rnd(2, 4), rnd() < 0.5 ? '#ffffff' : col, 0, 0.8);
        });
        break;
      }
      case 'boomerang': {
        // the pickaxe spins out ahead and comes back
        const reach = mv.hx + mv.hw;
        const len = act + 380;
        this.prop(on, len, (c, t, P) => {
          const f = at();
          if (!f) return;
          const u = t / (len / 1000);
          const dist = Math.sin(Math.min(1, u) * Math.PI) * reach;
          spinPick(P, f.x + d * (8 + dist), f.y - 16 - Math.sin(u * Math.PI) * 4, t * 30, col);
        });
        this.during(on, len, (t) => {
          const f = at();
          if (!f) return;
          const u = t / (len / 1000);
          const dist = Math.sin(Math.min(1, u) * Math.PI) * reach;
          this.part('spark', f.x + d * (8 + dist), f.y - 16 + rnd(-3, 3), rnd(-20, 20), rnd(-20, 20), 0.22, 1, rnd() < 0.5 ? '#ffffff' : col, 0, 0.9);
        });
        break;
      }
      case 'dynamite': {
        // a stick of dynamite lobbed in an arc, fuse fizzing, then BOOM where the hitbox is
        const ax = mv.hx + mv.hw / 2;
        this.prop(0, on, (c, t, P) => {
          const u = Math.min(1, t / (on / 1000));
          const px = x + d * (6 + ax * u);
          const py = y - 18 - Math.sin(u * Math.PI) * 26 + u * 12;
          stick(P, px, py, t * 14 * d);
        });
        this.during(0, on, (t) => {
          const u = Math.min(1, t / (on / 1000));
          const px = x + d * (6 + ax * u);
          const py = y - 22 - Math.sin(u * Math.PI) * 26 + u * 12;
          this.part('spark', px, py, rnd(-40, 40), -rnd(20, 80), 0.18, 1, rnd() < 0.5 ? '#fff3a0' : '#ff9a2a', 200, 0.95);
          if (rnd() < 0.3) this.part('smoke', px, py, rnd(-6, 6), -rnd(5, 15), 0.5, 2, '', -5, 0.95);
        });
        this.later(on, () => {
          const bx = x + d * (6 + ax), by = y - 12;
          this.ring(bx, by, 4, 34, 0.25, '#ffffff', 1, 2);
          this.ring(bx, by + 10, 6, 40, 0.4, '#ff9a2a', 0.3, 2);
          this.boom(bx, by, 13, 560);
          this.fireBurst(bx, by, 40, 120, 60, 1.3);
          this.debris(bx, by + 10, 10, 120, 200);
          this.light(bx, by, 50, '#ffd23c', 0.18, 1);
        });
        break;
      }
      case 'sonar': {
        this.later(on, () => {
          const f = at() ?? { x, y };
          for (let i = 0; i < 3; i++) this.ring(f.x, f.y - 14, 3 + i * 3, 40 + i * 8, 0.35 + i * 0.12, i === 1 ? '#ffffff' : col, 0.85, 2);
          this.light(f.x, f.y - 14, 34, col, 0.3, 0.6);
          this.sparks(f.x, f.y - 14, 16, 160, col);
        });
        this.prop(on, 450, (c, t, P) => {
          const f = at();
          if (f) waves(P, f.x, f.y - 14, t, col);
        });
        break;
      }
      case 'geyser': {
        // the floor bursts ahead: a white column of water, foam and falling drops
        const gx = x + d * (mv.hx + mv.hw / 2);
        this.during(0, on, () => {
          if (rnd() < 0.5) this.part('drop', gx + rnd(-6, 6), y - 1, rnd(-10, 10), -rnd(20, 60), 0.3, 1, ramp(WATER, rnd(0.2, 0.7)), 300, 0.98);
        });
        this.later(on, () => {
          this.ring(gx, y, 3, 24, 0.3, '#c8f4ff', 0.3, 2);
          for (let i = 0; i < 46; i++) this.part('drop', gx + rnd(-5, 5), y - rnd(0, 6), rnd(-50, 50), -rnd(160, 320), rnd(0.5, 0.9), rnd() < 0.4 ? 2 : 1, ramp(WATER, rnd(0, 0.8)), 420, 0.99);
          this.light(gx, y - 20, 30, '#7ad8ff', 0.35, 0.5);
        });
        this.prop(on, act + 380, (c, t, P) => column(P, gx, y, 64 * Math.min(1, t / 0.08) * (1 - Math.max(0, (t - act / 1000) / 0.38)), 12, t));
        break;
      }
      case 'boulder': {
        // curl up into a boulder and roll, shedding pebbles and dust
        this.prop(on * 0.7, act + on * 0.3 + 120, (c, t, P) => {
          const f = at();
          if (!f) return;
          const fade = 1 - Math.max(0, (t - (act + on * 0.3) / 1000) / 0.12);
          boulder(P, f.x, f.y - 11, 11, t * 18 * d, fade);
        });
        this.during(on * 0.7, act, () => {
          const f = at();
          if (!f) return;
          this.part('dust', f.x - d * 8, f.y - 1, -d * rnd(10, 40), -rnd(4, 16), rnd(0.3, 0.6), rnd(2, 4), '#b0a090', -6, 0.92);
          if (rnd() < 0.4) this.part('chip', f.x, f.y - 2, -d * rnd(20, 80), -rnd(60, 140), 0.5, 2, ROCK[2 + Math.floor(rnd(0, 2))], 520, 0.99);
        });
        break;
      }
      case 'cavein': {
        // rocks rain down ahead, each with a dust trail, cracking on the floor
        const cx = x + d * (mv.hx + mv.hw / 2);
        for (let i = 0; i < 5; i++) {
          const ox = cx + rnd(-mv.hw / 2, mv.hw / 2);
          const delay = on * 0.4 + i * 60;
          const fall = on * 0.6 + 60;
          this.prop(delay, fall, (c, t, P) => {
            const u = t / (fall / 1000);
            rock(P, ox, y - 62 + u * u * 60, 3 + (i % 3), t * 8);
          });
          this.during(delay, fall, (t) => {
            const u = t / (fall / 1000);
            this.part('dust', ox + rnd(-2, 2), y - 62 + u * u * 60 - 4, rnd(-4, 4), -rnd(5, 15), 0.4, 2, '#8a7a6a', -4, 0.95);
          });
          this.later(delay + fall, () => {
            this.debris(ox, y - 1, 6, 80, 150);
            this.dust(ox, y, 4, 40, ROCK[1]);
          });
        }
        this.later(on, () => this.ring(cx, y, 6, 30, 0.35, col, 0.3, 2));
        break;
      }
      case 'meteor': {
        // a leap trailing a comet of fire, a crater blast on landing
        this.during(0, on + act, () => {
          const f = at();
          if (!f) return;
          for (let i = 0; i < 4; i++) this.part('fire', f.x - f.vx * 0.01 + rnd(-4, 4), f.y - rnd(4, 18), -f.vx * 0.3 + rnd(-20, 20), -f.vy * 0.3 + rnd(-30, 0), rnd(0.2, 0.4), rnd(2, 5), '', -40, 0.9);
          if (rnd() < 0.3) this.part('smoke', f.x, f.y - 10, -f.vx * 0.2, -f.vy * 0.2, 0.7, 4, '', -6, 0.95);
        });
        this.later(on + act, () => {
          const f = at() ?? { x, y };
          this.ring(f.x, f.y, 4, 44, 0.4, '#ff8a3d', 0.28, 3);
          this.ring(f.x, f.y - 10, 3, 26, 0.2, '#ffffff', 1, 2);
          this.boom(f.x, f.y - 8, 12, 520);
          this.fireBurst(f.x, f.y - 6, 44, 130, 90, 1.3);
          this.debris(f.x, f.y, 16, 140, 240);
          this.prop(0, 700, (c, t, P) => crack(P, f.x, f.y, 26 * Math.min(1, t / 0.08), '#ff8a3d', 1 - t / 0.7));
        });
        break;
      }
      case 'tunnel': {
        // dig in: a spray of dirt and a mound; the pop-up comes from blink()
        this.during(0, on, () => {
          this.part('chip', x + rnd(-6, 6), y - 1, rnd(-90, 90), -rnd(80, 200), rnd(0.4, 0.7), 2, ROCK[1 + Math.floor(rnd(0, 3))], 520, 0.99);
          if (rnd() < 0.4) this.part('dust', x, y - 2, rnd(-30, 30), -rnd(10, 30), 0.5, 3, '#8a7a6a', -6, 0.94);
        });
        this.prop(0, on + 400, (c, t, P) => mound(P, x, y, Math.min(1, t / 0.15) * (1 - Math.max(0, (t - on / 1000) / 0.4)), col));
        break;
      }
      case 'drill': {
        // a spinning drill cone out front, sparks spraying, speed lines behind
        this.prop(on * 0.5, act + on * 0.5 + 80, (c, t, P) => {
          const f = at();
          if (!f) return;
          drillCone(P, f.x + d * 10, f.y - 13, d, t, 1 - Math.max(0, (t - (act + on * 0.5) / 1000) / 0.08));
          streaks(P, f.x - d * 6, f.y - 13, d, '#e0e6f0', 1, 4);
        });
        this.during(on, act, () => {
          const f = at();
          if (!f) return;
          for (let i = 0; i < 3; i++) this.part('spark', f.x + d * 22, f.y - 13 + rnd(-3, 3), d * rnd(20, 120), rnd(-120, 40), rnd(0.12, 0.28), 1, rnd() < 0.5 ? '#ffffff' : '#ffd23c', 300, 0.95);
        });
        break;
      }
      case 'inferno': {
        // a wave of fire races along the floor, and behind it the floor burns
        const len = mv.hx + mv.hw;
        const run = act + on * 0.3;
        this.during(on * 0.7, run, (t) => {
          const u = Math.min(1, t / (run / 1000));
          const fx = x + d * (8 + len * u);
          for (let i = 0; i < 4; i++) this.part('fire', fx + rnd(-4, 4), y - rnd(0, 4), d * rnd(10, 40), -rnd(40, 120), rnd(0.25, 0.45), rnd(2, 5), '', -60, 0.9);
          if (rnd() < 0.5) this.part('ember', fx, y - 6, rnd(-30, 30), -rnd(60, 140), 0.7, 1, '#ffd23c', 120, 0.97);
          if (rnd() < 0.3) this.decal(fx, y + 1, 10, '#3a1410', 2600);
        });
        this.prop(on * 0.7, run + 900, (c, t, P) => {
          const u = Math.min(1, t / (run / 1000));
          const fade = 1 - Math.max(0, (t - run / 1000) / 0.9);
          fireField(P, x + d * 8, y, len * u, d, t, fade);
        });
        this.later(on, () => this.light(x + d * len * 0.5, y - 8, len * 0.7, '#ff7a2a', 0.6, 0.6));
        break;
      }
      case 'jade': {
        // a spiral of jade blades all round, two turns, glowing
        this.prop(on * 0.5, act + on * 0.5 + 220, (c, t, P) => {
          const f = at();
          if (!f) return;
          const fade = 1 - Math.max(0, (t - (act + on * 0.5) / 1000) / 0.22);
          for (let j = 0; j < 3; j++) glowArc(c, P, f.x, f.y - 12, 26 - j * 7, t * 16 + j * 2.1, 2.4, j === 2 ? '#ffffff' : col, fade, 0.45);
        });
        this.during(on, act, () => {
          const f = at();
          if (!f) return;
          const a = rnd(0, Math.PI * 2);
          this.part('spark', f.x + Math.cos(a) * 26, f.y - 12 + Math.sin(a) * 12, -Math.sin(a) * 160, Math.cos(a) * 80, 0.35, 1, rnd() < 0.5 ? '#ffffff' : col, 40, 0.95);
        });
        this.later(on, () => this.light(x, y - 12, 44, col, 0.4, 0.6));
        break;
      }
      case 'taiji': {
        // a seal opens on the floor, turning, then flares
        const R = Math.abs(mv.hx) + 6;
        this.prop(0, on + act + 500, (c, t, P) => {
          const f = at();
          if (!f) return;
          const open = Math.min(1, t / (on / 1000));
          const fade = 1 - Math.max(0, (t - (on + act) / 1000) / 0.5);
          taijiSeal(c, P, f.x, f.y, R * open, t * 3, col, fade);
        });
        this.later(on, () => {
          const f = at() ?? { x, y };
          this.ring(f.x, f.y, R * 0.6, R * 1.4, 0.4, '#ffffff', 0.3, 2);
          this.light(f.x, f.y - 6, R * 1.6, col, 0.45, 0.8);
          for (let i = 0; i < 24; i++) this.part('spark', f.x + rnd(-R, R), f.y - rnd(0, 4), 0, -rnd(80, 200), rnd(0.3, 0.6), 1, rnd() < 0.5 ? '#ffffff' : col, 0, 0.95);
          this.decal(f.x, f.y + 1, R, '#16304e', 1800);
        });
        break;
      }
      case 'thunder': {
        // charge: arcs and sparks rush into the hand; then lightning splits the floor ahead
        const len = mv.hx + mv.hw;
        this.during(0, on, () => {
          const f = at();
          if (!f) return;
          const a = rnd(0, Math.PI * 2), r = rnd(14, 26);
          this.part('spark', f.x + d * 8 + Math.cos(a) * r, f.y - 16 + Math.sin(a) * r, -Math.cos(a) * r * 6, -Math.sin(a) * r * 6, 0.16, 1, rnd() < 0.5 ? '#ffffff' : col, 0, 0.9);
          if (rnd() < 0.3) this.light(f.x + d * 8, f.y - 16, 16, col, 0.1, 0.6);
        });
        this.later(on, () => {
          const f = at() ?? { x, y };
          const seedBolt = Math.floor(rnd(1, 9999));
          this.prop(0, 420, (c, t, P) => lightning(c, P, f.x + d * 8, f.y, len, d, seedBolt, 1 - t / 0.42, col));
          this.light(f.x + d * len * 0.5, f.y - 12, len * 0.8, col, 0.35, 1);
          this.flash = 0.35;
          this.sparks(f.x + d * len, f.y - 6, 20, 200, col);
          this.decal(f.x + d * len * 0.5, f.y + 1, len * 0.5, '#2a2416', 1800);
        });
        break;
      }
      case 'pillar': {
        // a gold ring marks the spot far ahead; the pillar of light drops on it
        const px = x + d * (mv.hx + mv.hw / 2);
        this.prop(0, on, (c, t, P) => pixelRing(P, px, y, 12 + Math.sin(t * 30) * 1.5, 4, 1, col, 0.4 + 0.6 * (t / (on / 1000))));
        this.later(on, () => {
          this.prop(0, act + 450, (c, t, P) => goldPillar(c, P, px, y, t, (act + 450) / 1000, col));
          this.ring(px, y, 4, 34, 0.45, col, 0.3, 2);
          this.light(px, y - 30, 60, col, 0.5, 1);
          this.flash = 0.25;
          for (let i = 0; i < 30; i++) this.part('spark', px + rnd(-10, 10), y - rnd(0, 70), rnd(-30, 30), -rnd(20, 90), rnd(0.4, 0.8), 1, rnd() < 0.5 ? '#ffffff' : col, -10, 0.96);
          this.decal(px, y + 1, 16, '#3a3010', 2000);
        });
        break;
      }
    }
  }

  /** A skill landed on `id` at (x, y). */
  hit(k: SkillId, id: string, x: number, y: number, col: string) {
    const fiery = k === 'dive' || k === 'meteor' || k === 'dynamite' || k === 'inferno';
    if (fiery) this.fireBurst(x, y, 14, 70, 40, 0.8);
    else if (k === 'geyser') for (let i = 0; i < 14; i++) this.part('drop', x, y, rnd(-80, 80), -rnd(60, 160), 0.5, 1, ramp(WATER, rnd(0, 0.8)), 400, 0.98);
    else if (k === 'quake' || k === 'cavein' || k === 'boulder') this.debris(x, y + 6, 8, 90, 140);
    if (fiery) this.status(id, 'burn', 1300);
    else if (k === 'taiji' || k === 'geyser' || k === 'guard') this.status(id, 'frost', 900);
    else if (k === 'thunder' || k === 'drill' || k === 'magnet' || k === 'rush') this.status(id, 'shock', 600);
    else if (k === 'pillar' || k === 'moon' || k === 'jade') this.status(id, 'gold', 700);
    this.sparks(x, y, 18, 190, col);
    this.prop(0, 180, (c, t, P) => star(P, x, y, 5 + t * 90, col, 1 - t / 0.18));
    this.light(x, y, 34, col, 0.22, 0.9);
    this.flash = Math.max(this.flash, 0.12);
  }

  /** Tunnel Dig pops up at (x, y). */
  blink(x: number, y: number, col: string) {
    for (let i = 0; i < 22; i++) this.part('chip', x + rnd(-6, 6), y - 1, rnd(-110, 110), -rnd(120, 260), rnd(0.5, 0.8), rnd() < 0.3 ? 3 : 2, ROCK[1 + Math.floor(rnd(0, 3))], 520, 0.99);
    this.dust(x, y, 8, 60, '#8a7a6a');
    this.sparks(x, y - 10, 12, 140, col);
    this.ring(x, y, 3, 26, 0.3, col, 0.3, 2);
    this.light(x, y - 8, 24, col, 0.25, 0.6);
  }

  /* ---------------- the loop ---------------- */
  update(dt: number) {
    for (const e of this.emitters) {
      if (e.wait > 0) {
        e.wait -= dt;
        if (e.wait > 0) continue;
      }
      e.tick(e.t, dt);
      e.t += dt;
    }
    this.emitters = this.emitters.filter((e) => e.wait > 0 || e.t < e.max);
    for (const p of this.props) {
      if (p.wait > 0) {
        p.wait -= dt;
        continue;
      }
      p.step?.(p.t, dt);
      p.t += dt;
    }
    this.props = this.props.filter((p) => p.wait > 0 || p.t < p.max);
    for (const p of this.parts) {
      p.life -= dt;
      p.vy += p.g * dt;
      const k = Math.pow(p.drag, dt * 60);
      p.vx *= k;
      p.vy *= k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.parts = this.parts.filter((p) => p.life > 0);
    for (const l of this.lights) l.life -= dt;
    this.lights = this.lights.filter((l) => l.life > 0);
    for (const r of this.rings) r.life -= dt;
    this.rings = this.rings.filter((r) => r.life > 0);
    for (const dc of this.decals) dc.life -= dt;
    this.decals = this.decals.filter((dc) => dc.life > 0);
    this.flash = Math.max(0, this.flash - dt * 2.2);
  }

  draw(c: Ctx, sx: (x: number) => number, sy: (y: number) => number, Z: number) {
    const P: Pen = {
      Z,
      sx,
      sy,
      px: (x, y, w, h, col, a = 1) => {
        if (a <= 0) return;
        c.globalAlpha = Math.min(1, a);
        c.fillStyle = col;
        c.fillRect(Math.round(sx(Math.round(x))), Math.round(sy(Math.round(y))), Math.ceil(w * Z), Math.ceil(h * Z));
      },
    };
    // floor marks first: scorch, frost, cracks, in blocky splats
    for (const dc of this.decals) {
      const a = Math.min(1, (dc.life / dc.max) * 1.6) * 0.7;
      let sd = dc.seed;
      for (let i = -dc.w; i <= dc.w; i += 2) {
        sd = (sd * 16807) % 2147483647;
        if (sd % 3 === 0) continue;
        P.px(dc.x + i, dc.y - 1 + (sd % 2), 2, 1 + (sd % 2), dc.c, a * (1 - Math.abs(i) / (dc.w + 1)));
      }
    }
    // rings under everything
    for (const r of this.rings) {
      const p = 1 - r.life / r.max;
      const rad = r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - p, 3));
      pixelRing(P, r.x, r.y, rad, rad * r.flat, r.w, r.c, 1 - p);
    }
    for (const p of this.props) {
      if (p.wait > 0) continue;
      c.globalAlpha = 1;
      p.draw(c, p.t, P);
    }
    c.globalAlpha = 1;
    for (const p of this.parts) {
      const u = 1 - p.life / p.max;
      if (p.k === 'fire') {
        const s = Math.max(1, Math.round(p.s * (1 - u * 0.6)));
        P.px(p.x - s / 2, p.y - s / 2, s, s, ramp(FIRE, u * 1.1));
      } else if (p.k === 'smoke') {
        const s = Math.round(p.s * (0.8 + u * 0.8));
        P.px(p.x - s / 2, p.y - s / 2, s, s, ramp(SMOKE, u), 0.75 * (1 - u));
      } else if (p.k === 'ember') {
        if ((p.life * 30) % 2 > 0.6) P.px(p.x, p.y, 1, 1, p.c);
      } else if (p.k === 'spark') {
        P.px(p.x, p.y, 1, 1, p.c, 1 - u * 0.5);
        P.px(p.x - p.vx * 0.012, p.y - p.vy * 0.012, 1, 1, p.c, 0.5 * (1 - u));
      } else if (p.k === 'chip') {
        P.px(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s, p.c, u > 0.8 ? (1 - u) * 5 : 1);
      } else if (p.k === 'drop') {
        P.px(p.x, p.y, p.s, p.s + (Math.abs(p.vy) > 120 ? 1 : 0), p.c, u > 0.8 ? (1 - u) * 5 : 1);
      } else if (p.k === 'dust') {
        const s = Math.round(p.s * (0.7 + u));
        P.px(p.x - s / 2, p.y - s / 2, s, s, p.c, 0.55 * (1 - u));
      } else if (p.k === 'bolt') {
        P.px(p.x - (p.vx > 0 ? p.s : 0), p.y, p.s, 1, p.c, 1 - u);
      }
    }
    c.globalAlpha = 1;
    // light on top, additive
    if (this.lights.length) {
      const prev = c.globalCompositeOperation;
      c.globalCompositeOperation = 'lighter';
      for (const l of this.lights) {
        const a = (l.life / l.max) * l.k;
        const X = sx(l.x), Y = sy(l.y), R = l.r * Z;
        const g = c.createRadialGradient(X, Y, 0, X, Y, R);
        g.addColorStop(0, hexA(l.c, 0.55 * a));
        g.addColorStop(1, hexA(l.c, 0));
        c.fillStyle = g;
        c.fillRect(X - R, Y - R, R * 2, R * 2);
      }
      c.globalCompositeOperation = prev;
    }
    if (this.flash > 0.01) {
      const prev = c.globalCompositeOperation;
      c.globalCompositeOperation = 'lighter';
      c.fillStyle = `rgba(255,248,220,${this.flash * 0.5})`;
      c.fillRect(-10000, -10000, 20000, 20000);
      c.globalCompositeOperation = prev;
    }
  }
}

/* ---------------- shapes, in world px ---------------- */
function hexA(h: string, a: number) {
  const n = parseInt(h.slice(1), 16);
  const full = h.length === 4 ? ((n & 0xf00) * 0x1100) | ((n & 0xf0) * 0x110) | ((n & 0xf) * 0x11) : n;
  return `rgba(${(full >> 16) & 255},${(full >> 8) & 255},${full & 255},${Math.max(0, Math.min(1, a))})`;
}
/** a ring of pixel blocks; `ry` squashes it into a floor ellipse */
function pixelRing(P: Pen, x: number, y: number, rx: number, ry: number, w: number, col: string, a: number) {
  const n = Math.max(12, Math.round(rx * 1.6));
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    P.px(x + Math.cos(t) * rx, y + Math.sin(t) * ry, w, Math.max(1, w * (ry / rx) + 0.5), col, a);
  }
}
/** a thick crescent swept round (x, y) from angle a0, `len` radians long, tapering at both ends */
function crescent(P: Pen, x: number, y: number, r: number, a0: number, len: number, col: string, d: number, a: number, flat = 1) {
  if (a <= 0) return;
  const n = Math.round(r * len * 1.2);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    const t = a0 + u * len;
    const th = Math.max(1, Math.round(3 * Math.sin(u * Math.PI)));
    const cx = x + Math.cos(t) * r * d, cy = y + Math.sin(t) * r * flat;
    P.px(cx, cy, th, th, u > 0.75 ? '#ffffff' : col, a * (0.4 + u * 0.6));
  }
}
function crack(P: Pen, x: number, y: number, len: number, col: string, a: number) {
  for (const s of [-1, 1]) {
    let yy = 0;
    for (let i = 0; i < len; i += 2) {
      yy += ((i * 7 + s * 13) % 5) - 2 > 0 ? 0.5 : -0.5;
      P.px(x + s * i, y + Math.max(-1, Math.min(1, yy)), 2, 1, i < len * 0.4 ? '#ffffff' : col, a);
    }
  }
}
function diamondShell(P: Pen, x: number, y: number, rx: number, ry: number, col: string, t: number, a: number) {
  const pts: [number, number][] = [[0, -ry], [rx * 0.75, -ry * 0.45], [rx, ry * 0.15], [rx * 0.45, ry], [-rx * 0.45, ry], [-rx, ry * 0.15], [-rx * 0.75, -ry * 0.45]];
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[(i + 1) % pts.length];
    const n = Math.round(Math.hypot(bx - ax, by - ay));
    for (let j = 0; j <= n; j++) {
      const u = j / Math.max(1, n);
      const glint = Math.abs(((t * 3 + i / pts.length) % 1) - u) < 0.12;
      P.px(x + ax + (bx - ax) * u, y + ay + (by - ay) * u, 1, 1, glint ? '#ffffff' : col, a * 0.9);
    }
  }
  // facets inside, faint
  for (let i = 0; i < pts.length; i += 2) {
    const [ax, ay] = pts[i];
    for (let j = 0; j < 6; j++) P.px(x + ax * (j / 6), y + ay * (j / 6), 1, 1, col, a * 0.3);
  }
}
function fist(P: Pen, x: number, y: number, d: number, col: string, a: number) {
  P.px(x - 3, y - 3, 6, 6, '#f6c294', a);
  P.px(x - 3, y - 3, 6, 1, '#ffffff', a);
  P.px(x + (d > 0 ? 2 : -3), y - 2, 1, 4, '#cf8f5e', a);
  for (let i = 1; i < 4; i++) P.px(x - d * (3 + i * 3), y - 2 + i, 3, 1, col, a * (1 - i / 4));
}
function streaks(P: Pen, x: number, y: number, d: number, col: string, a: number, n: number) {
  for (let i = 0; i < n; i++) {
    const len = 6 + ((i * 5) % 7);
    P.px(x - d * (6 + i * 2) - (d > 0 ? len : 0), y - 8 + i * 5, len, 1, i % 2 ? '#ffffff' : col, a * 0.8);
  }
}
function chain(P: Pen, x: number, y: number, len: number, d: number, col: string, t: number) {
  for (let i = 0; i < len; i += 4) {
    const wob = Math.sin(t * 40 + i * 0.4) * 0.6;
    P.px(x + d * i, y + wob, 3, 2, i % 8 ? '#c8c8d8' : '#8a8a9a');
  }
  // the horseshoe magnet: red with silver tips
  const hx = x + d * len;
  P.px(hx - 3, y - 5, 6, 2, '#e83a4a');
  P.px(hx + (d > 0 ? 1 : -3), y - 5, 2, 10, '#e83a4a');
  P.px(hx - 3, y + 3, 6, 2, '#e83a4a');
  P.px(hx + (d > 0 ? 3 : -5), y - 5, 2, 2, '#ffffff');
  P.px(hx + (d > 0 ? 3 : -5), y + 3, 2, 2, '#ffffff');
  P.px(hx + d * 6, y - 1, 1, 2, col, 0.8);
}
function spinPick(P: Pen, x: number, y: number, ang: number, col: string) {
  // a pickaxe: a shaft and a curved head, turning
  const c = Math.cos(ang), s = Math.sin(ang);
  for (let i = -5; i <= 5; i++) P.px(x + c * i, y + s * i, 1, 1, '#9a6636');
  for (let i = -5; i <= 5; i++) {
    const hx = x + c * 5 - s * i * 0.9, hy = y + s * 5 + c * i * 0.9;
    P.px(hx + c * Math.abs(i) * -0.25, hy + s * Math.abs(i) * -0.25, 1, 1, Math.abs(i) > 3 ? '#ffffff' : '#c4c9d6');
  }
  // a motion blur ring in the skill's colour
  for (let k = 0; k < 10; k++) {
    const a = ang - k * 0.35;
    P.px(x + Math.cos(a) * 7, y + Math.sin(a) * 7, 1, 1, col, 0.6 - k * 0.06);
  }
}
function stick(P: Pen, x: number, y: number, ang: number) {
  const c = Math.cos(ang), s = Math.sin(ang);
  for (let i = -3; i <= 3; i++) P.px(x + c * i, y + s * i, 2, 2, i === -3 || i === 3 ? '#7a1a20' : '#e0342a');
  P.px(x + c * 4, y + s * 4 - 1, 1, 1, '#fff3a0');
}
function waves(P: Pen, x: number, y: number, t: number, col: string) {
  for (let k = 0; k < 3; k++) {
    const r = 10 + ((t * 90 + k * 14) % 42);
    const a = 1 - r / 52;
    for (const d of [-1, 1]) for (let i = -4; i <= 4; i++) {
      const th = (i / 4) * 0.8;
      P.px(x + d * Math.cos(th) * r, y + Math.sin(th) * r, 1, 2, k === 1 ? '#ffffff' : col, a);
    }
  }
}
function column(P: Pen, x: number, y: number, h: number, w: number, t: number) {
  if (h <= 0) return;
  for (let yy = 0; yy < h; yy += 2) {
    const wob = Math.round(Math.sin(t * 30 + yy * 0.4) * 1.5);
    const ww = w * (0.6 + 0.4 * (1 - yy / h));
    P.px(x - ww / 2 + wob, y - yy - 2, ww, 2, ramp(WATER, 0.2 + ((yy * 3 + Math.floor(t * 40)) % 7) / 14));
    P.px(x - ww / 2 + wob, y - yy - 2, 1, 2, '#ffffff', 0.8);
  }
  // a foamy crown
  for (let i = 0; i < 6; i++) P.px(x - 5 + i * 2, y - h - 2 - ((i * 3 + Math.floor(t * 30)) % 3), 2, 2, '#ffffff');
}
function boulder(P: Pen, x: number, y: number, r: number, ang: number, a: number) {
  for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) {
    const d2 = xx * xx + yy * yy;
    if (d2 > r * r) continue;
    // light from top-left, a few turning spots
    const lit = (-xx - yy) / (r * 1.4);
    const spot = Math.sin(xx * 0.9 + Math.cos(ang) * 3) * Math.sin(yy * 0.9 + Math.sin(ang) * 3) > 0.6;
    const col = d2 > (r - 1) * (r - 1) ? ROCK[4] : spot ? ROCK[3] : ramp(ROCK, 0.55 - lit * 0.5);
    P.px(x + xx, y + yy, 1, 1, col, a);
  }
}
function rock(P: Pen, x: number, y: number, r: number, ang: number) {
  for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) {
    if (Math.abs(xx) + Math.abs(yy) > r + ((Math.floor(ang) + xx) & 1)) continue;
    P.px(x + xx, y + yy, 1, 1, xx + yy < -1 ? ROCK[1] : xx + yy > 1 ? ROCK[3] : ROCK[2]);
  }
}
function mound(P: Pen, x: number, y: number, a: number, col: string) {
  if (a <= 0) return;
  const w = Math.round(14 * a);
  for (let i = -w; i <= w; i++) {
    const h = Math.round(Math.sqrt(Math.max(0, w * w - i * i)) * 0.35);
    P.px(x + i, y - h, 1, h + 1, h > 2 ? ROCK[2] : ROCK[3]);
    if (h > 0) P.px(x + i, y - h, 1, 1, ROCK[1]);
  }
  P.px(x - 1, y - Math.round(w * 0.35) - 2, 2, 2, col, a);
}
function drillCone(P: Pen, x: number, y: number, d: number, t: number, a: number) {
  if (a <= 0) return;
  for (let i = 0; i < 12; i++) {
    const h = Math.round((12 - i) * 0.5);
    for (let j = -h; j <= h; j++) {
      const band = (Math.floor(t * 60) + i + j) % 3 === 0;
      P.px(x + d * i, y + j, 1, 1, band ? '#ffffff' : j < 0 ? '#e0e6f0' : '#8a92a8', a);
    }
  }
}
function star(P: Pen, x: number, y: number, r: number, col: string, a: number) {
  if (a <= 0) return;
  for (let i = 0; i < 8; i++) {
    const t = (i / 8) * Math.PI * 2;
    const len = i % 2 ? r * 0.55 : r;
    for (let k = 2; k < len; k += 1.5) P.px(x + Math.cos(t) * k, y + Math.sin(t) * k, 1, 1, k < len * 0.5 ? '#ffffff' : col, a);
  }
}

/** A smooth glowing blade arc: a wide soft band in the colour, a bright edge, a white core, added as light. */
function glowArc(c: Ctx, P: Pen, x: number, y: number, r: number, a0: number, len: number, col: string, a: number, flat = 1) {
  if (a <= 0) return;
  const X = P.sx(x), Y = P.sy(y), R = r * P.Z;
  const prev = c.globalCompositeOperation;
  c.globalCompositeOperation = 'lighter';
  c.save();
  c.translate(X, Y);
  c.scale(1, flat);
  c.lineCap = 'round';
  const steps = 14;
  for (let i = 0; i < steps; i++) {
    const u0 = i / steps, u1 = (i + 1) / steps;
    // the head of the blade is thick and hot, the tail thin and fading
    const w = (0.5 + u1 * 3.2) * P.Z;
    c.strokeStyle = hexA(col, a * (0.15 + u1 * 0.5));
    c.lineWidth = w * 2.4;
    c.beginPath();
    c.arc(0, 0, R, a0 + u0 * len, a0 + u1 * len);
    c.stroke();
    c.strokeStyle = hexA(u1 > 0.7 ? '#ffffff' : col, a * (0.3 + u1 * 0.7));
    c.lineWidth = Math.max(1, w * 0.7);
    c.beginPath();
    c.arc(0, 0, R + w * 0.4, a0 + u0 * len, a0 + u1 * len);
    c.stroke();
  }
  c.restore();
  c.globalCompositeOperation = prev;
}
/** a burning strip of floor: chunky white-hot flames with dark holes and tall licks, like a road of fire */
function fireField(P: Pen, x: number, y: number, len: number, d: number, t: number, a: number) {
  if (a <= 0 || len <= 0) return;
  for (let i = 0; i < len; i += 2) {
    const k = Math.floor(i / 2);
    const lick = (Math.sin(k * 2.3 + t * 18) + Math.sin(k * 0.9 - t * 11)) * 0.5;
    const h = Math.max(3, Math.round((11 + lick * 7) * a * (0.6 + 0.4 * Math.min(1, i / 10))));
    for (let yy = 0; yy < h; yy += 2) {
      const heat = yy / h + (Math.sin(k * 3.1 + yy * 1.7 + t * 25) > 0.6 ? 0.45 : 0);
      P.px(x + d * i - (d < 0 ? 2 : 0), y - yy - 2, 2, 2, heat > 1 ? '#5a1a26' : ramp(FIRE, heat * 0.9), a);
    }
    // a tall tongue now and then
    if ((k * 7 + Math.floor(t * 10)) % 5 === 0) for (let yy = h; yy < h + 12; yy += 2) P.px(x + d * i, y - yy - 2, 1, 2, ramp(FIRE, 0.3 + (yy - h) / 10), a);
  }
}
/** a yin-yang seal on the floor in perspective, with a glowing rim */
function taijiSeal(c: Ctx, P: Pen, x: number, y: number, R: number, spin: number, col: string, a: number) {
  if (a <= 0 || R < 2) return;
  const ry = R * 0.32;
  for (let yy = -ry; yy <= ry; yy += 1) for (let xx = -R; xx <= R; xx += 1) {
    const nx = xx / R, ny = yy / ry;
    const d2 = nx * nx + ny * ny;
    if (d2 > 1) continue;
    // rotate into the seal's frame
    const rx = nx * Math.cos(spin) - ny * Math.sin(spin), ryy = nx * Math.sin(spin) + ny * Math.cos(spin);
    const top = Math.hypot(rx, ryy - 0.5), bot = Math.hypot(rx, ryy + 0.5);
    let white = rx > 0;
    if (top < 0.5) white = true;
    if (bot < 0.5) white = false;
    if (top < 0.14) white = false;
    if (bot < 0.14) white = true;
    const rim = d2 > 0.82;
    P.px(x + xx, y + yy, 1, 1, rim ? '#ffffff' : white ? '#e8f0ff' : '#0c1426', a * (rim ? 0.9 : 0.75));
  }
  // the outer ring of light
  glowArc(c, P, x, y, R + 3, spin * 2, Math.PI * 1.6, col, a * 0.9, 0.32);
}
/** ice arrows driving down onto a pinned miner, and a ring of frost round their feet */
function frostArrows(P: Pen, x: number, y: number, t: number, a: number) {
  if (a <= 0) return;
  for (let k = 0; k < 4; k++) {
    const ox = x - 6 + k * 4;
    const fall = ((t * 70 + k * 9) % 30);
    const ay = y - 34 + fall;
    for (let i = 0; i < 6; i++) P.px(ox, ay - i * 2, 1, 2, i === 0 ? '#ffffff' : '#7ac8ff', a * (1 - i / 7));
    P.px(ox - 1, ay - 1, 1, 1, '#ffffff', a);
    P.px(ox + 1, ay - 1, 1, 1, '#ffffff', a);
  }
  pixelRing(P, x, y, 10, 3, 1, '#9adcff', a * 0.8);
}
/** a jagged bolt running along the floor with branches, redrawn a little different every few frames */
function lightning(c: Ctx, P: Pen, x: number, y: number, len: number, d: number, seed0: number, a: number, col: string) {
  if (a <= 0) return;
  let sd = seed0 + Math.floor(a * 6);
  const r = () => ((sd = (sd * 16807) % 2147483647) / 2147483647);
  const prev = c.globalCompositeOperation;
  c.globalCompositeOperation = 'lighter';
  for (let pass = 0; pass < 2; pass++) {
    let px = 0, py = -10;
    c.strokeStyle = pass ? hexA('#ffffff', a) : hexA(col, a * 0.6);
    c.lineWidth = (pass ? 1 : 4) * P.Z;
    c.beginPath();
    c.moveTo(P.sx(x), P.sy(y + py));
    while (px < len) {
      px += 6 + r() * 8;
      py = Math.max(-26, Math.min(0, py + (r() - 0.5) * 14));
      c.lineTo(P.sx(x + d * px), P.sy(y + py));
      // a branch to the floor
      if (r() < 0.25) {
        c.moveTo(P.sx(x + d * px), P.sy(y + py));
        c.lineTo(P.sx(x + d * (px + 6)), P.sy(y));
        c.moveTo(P.sx(x + d * px), P.sy(y + py));
      }
    }
    c.stroke();
  }
  c.globalCompositeOperation = prev;
  // the floor splits under it
  for (let i = 0; i < len; i += 3) P.px(x + d * i, y - 1, 2, 1, i % 6 ? col : '#ffffff', a * 0.8);
}
/** a column of gold light dropping from the sky: white core, gold body, soft edges, rays at the foot */
function goldPillar(c: Ctx, P: Pen, x: number, y: number, t: number, len: number, col: string) {
  const u = t / len;
  const drop = Math.min(1, t / 0.08);
  const a = u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3;
  const w = 14 * (u < 0.15 ? 1.3 - u * 2 : 1) * (1 - Math.max(0, u - 0.7) * 2);
  const top = y - 120, bot = top + (y - top) * drop;
  const X = P.sx(x), Z = P.Z;
  const prev = c.globalCompositeOperation;
  c.globalCompositeOperation = 'lighter';
  const g = c.createLinearGradient(X - w * Z, 0, X + w * Z, 0);
  g.addColorStop(0, hexA(col, 0));
  g.addColorStop(0.3, hexA(col, 0.5 * a));
  g.addColorStop(0.5, hexA('#ffffff', 0.95 * a));
  g.addColorStop(0.7, hexA(col, 0.5 * a));
  g.addColorStop(1, hexA(col, 0));
  c.fillStyle = g;
  c.fillRect(X - w * Z, P.sy(top), w * 2 * Z, P.sy(bot) - P.sy(top));
  c.globalCompositeOperation = prev;
  // rays fanning out at the foot
  for (let i = 0; i < 10; i++) {
    const ang = Math.PI + (i / 9) * Math.PI;
    const l = 10 + ((i * 7 + Math.floor(t * 20)) % 8);
    for (let k = 3; k < l; k += 2) P.px(x + Math.cos(ang) * k * 1.6, y + Math.sin(ang) * k * 0.5, 1, 1, k < 6 ? '#ffffff' : col, a);
  }
}
