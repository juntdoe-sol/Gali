/**
 * Light and weather: a day that turns, clouds that cast shadows, rain that
 * comes and goes, and at night a lightmap that leaves the island lit only by
 * what is burning on it.
 *
 * The day is compressed to eight minutes so anyone playing for a few rounds
 * sees the sun go down. Night is moody, never so dark a claim can't be read.
 */
import { makeCanvas, ctx2d, type Ctx } from './art';

export const DAY_MS = 8 * 60_000;

type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const css = (c: RGB, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

// ambient multiply colours across the day (0 = midnight, 0.5 = noon)
const KEYS: [number, RGB][] = [
  [0.0, [92, 104, 170]],
  [0.2, [96, 106, 168]],
  [0.27, [214, 150, 150]], // dawn
  [0.33, [255, 236, 214]],
  [0.45, [255, 255, 255]],
  [0.62, [255, 250, 240]],
  [0.7, [255, 196, 150]], // golden hour
  [0.76, [196, 132, 150]], // dusk
  [0.82, [104, 108, 172]],
  [1.0, [92, 104, 170]],
];

export class Sky {
  /** 0..1 through the day; starts mid-morning so a first visit opens in daylight */
  private epoch = Date.now() - DAY_MS * 0.36;
  private light: HTMLCanvasElement;
  private lg: Ctx;
  private glowCache = new Map<string, HTMLCanvasElement>();
  clouds: { x: number; y: number; w: number; cv: HTMLCanvasElement; shadow: HTMLCanvasElement; sp: number }[] = [];
  rain = 0; // 0..1 current intensity
  private rainTarget = 0;
  private nextWeather = Date.now() + 45_000;
  wind = 0.4;
  private drops: { x: number; y: number; v: number; l: number }[] = [];
  lightning = 0;

  constructor() {
    this.light = makeCanvas(8, 8);
    this.lg = ctx2d(this.light);
    for (let k = 0; k < 6; k++) this.clouds.push(this.makeCloud(k));
  }

  /** Force the time of day, for screenshots: 0..1 */
  setTime(f: number) {
    this.epoch = Date.now() - DAY_MS * f;
  }
  get day() {
    return (((Date.now() - this.epoch) % DAY_MS) + DAY_MS) % DAY_MS / DAY_MS;
  }
  /** 0 in full day, 1 in full night */
  get night() {
    const d = this.day;
    if (d < 0.22 || d > 0.82) return 1;
    if (d < 0.32) return 1 - (d - 0.22) / 0.1;
    if (d > 0.72) return (d - 0.72) / 0.1;
    return 0;
  }
  ambient(): RGB {
    const d = this.day;
    let i = 0;
    while (i < KEYS.length - 2 && KEYS[i + 1][0] <= d) i++;
    const [t0, c0] = KEYS[i];
    const [t1, c1] = KEYS[i + 1];
    let c = mix(c0, c1, (d - t0) / Math.max(1e-6, t1 - t0));
    // rain greys the day down
    c = mix(c, [150, 160, 182], this.rain * 0.45);
    if (this.lightning > 0) c = mix(c, [255, 255, 255], this.lightning);
    return c;
  }

  private makeCloud(seed: number) {
    const w = 38 + ((seed * 37) % 30);
    const h = 16 + ((seed * 13) % 8);
    const cv = makeCanvas(w, h);
    const g = ctx2d(cv);
    const sh = makeCanvas(w, h);
    const sg = ctx2d(sh);
    const blobs = 5 + (seed % 3);
    const r = (n: number) => {
      const s = Math.sin(seed * 91.7 + n * 13.3) * 43758.5;
      return s - Math.floor(s);
    };
    const pts: [number, number, number][] = [];
    for (let b = 0; b < blobs; b++) pts.push([6 + r(b) * (w - 12), h * 0.55 + (r(b + 9) - 0.5) * h * 0.3, 5 + r(b + 20) * 6]);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let inside = false;
        let top = false;
        for (const [bx, by, br] of pts) {
          const d = Math.hypot(x - bx, (y - by) * 1.3);
          if (d < br) inside = true;
          if (d < br && Math.hypot(x - bx + 1, (y - by + 2) * 1.3) >= br) top = true;
        }
        if (y > h * 0.78) inside = inside && y < h - 1 && x > 3 && x < w - 3;
        if (!inside) continue;
        g.fillStyle = top ? '#ffffff' : y > h * 0.66 ? '#c9d6ee' : '#eef3ff';
        g.fillRect(x, y, 1, 1);
        sg.fillStyle = '#000';
        sg.fillRect(x, y, 1, 1);
      }
    return { x: r(40) * 520 - 80, y: -10 + r(41) * 190, w, cv, shadow: sh, sp: 0.6 + r(42) * 0.8 };
  }

  update(dtS: number, now: number, quality: number) {
    // weather: mostly fair, with passing showers
    if (now > this.nextWeather) {
      const roll = Math.random();
      this.rainTarget = roll < 0.22 ? 0.6 + Math.random() * 0.4 : 0;
      this.wind = 0.25 + Math.random() * (this.rainTarget > 0 ? 1.1 : 0.6);
      this.nextWeather = now + (this.rainTarget > 0 ? 25_000 + Math.random() * 20_000 : 50_000 + Math.random() * 60_000);
    }
    this.rain += (this.rainTarget - this.rain) * Math.min(1, dtS * 0.25);
    if (this.rain > 0.7 && Math.random() < dtS * 0.04) this.lightning = 0.9;
    this.lightning = Math.max(0, this.lightning - dtS * 3);
    for (const c of this.clouds) {
      c.x += c.sp * (4 + this.wind * 10) * dtS;
      if (c.x > 460) c.x = -120 - Math.random() * 60;
    }
    const want = quality ? Math.floor(this.rain * 140) : Math.floor(this.rain * 50);
    while (this.drops.length < want) this.drops.push({ x: Math.random(), y: Math.random(), v: 0.9 + Math.random() * 0.5, l: 3 + Math.random() * 4 });
    if (this.drops.length > want) this.drops.length = want;
    for (const d of this.drops) {
      d.y += d.v * dtS * 1.6;
      d.x += this.wind * dtS * 0.12;
      if (d.y > 1) {
        d.y -= 1;
        d.x = Math.random();
      }
      if (d.x > 1) d.x -= 1;
    }
  }

  /** Cloud shadows on the ground, in map space. */
  drawShadows(c: Ctx, ox: number, oy: number, s: number) {
    const k = 0.1 + 0.08 * (1 - this.night);
    c.globalAlpha = k;
    for (const cl of this.clouds) c.drawImage(cl.shadow, Math.round(ox + (cl.x + 26) * s), Math.round(oy + (cl.y + 34) * s), cl.w * s, cl.shadow.height * s);
    c.globalAlpha = 1;
  }
  /** The clouds themselves, above everything, fading as the camera comes down. */
  drawClouds(c: Ctx, ox: number, oy: number, s: number, fade: number) {
    if (fade <= 0) return;
    const n = this.night;
    c.globalAlpha = fade * (0.72 + this.rain * 0.2) * (1 - n * 0.35);
    for (const cl of this.clouds) c.drawImage(cl.cv, Math.round(ox + cl.x * s), Math.round(oy + cl.y * s), cl.w * s, cl.cv.height * s);
    c.globalAlpha = 1;
  }

  drawRain(c: Ctx, W: number, H: number, px: number) {
    if (this.drops.length === 0) return;
    c.fillStyle = 'rgba(200,220,255,0.55)';
    const slant = this.wind * 0.6;
    for (const d of this.drops) {
      const x = Math.round(d.x * W);
      const y = Math.round(d.y * H);
      for (let k = 0; k < d.l; k++) c.fillRect(Math.round(x - k * slant * px), y - k * px, px, px);
    }
  }

  private glow(color: string) {
    let g = this.glowCache.get(color);
    if (g) return g;
    g = makeCanvas(64, 64);
    const x = g.getContext('2d')!;
    const grad = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, color);
    grad.addColorStop(0.35, color + 'aa');
    grad.addColorStop(1, color + '00');
    x.fillStyle = grad;
    x.fillRect(0, 0, 64, 64);
    this.glowCache.set(color, g);
    return g;
  }

  /**
   * Multiply the scene by the ambient light, then add back every light source.
   * `lights` are in screen pixels. Skipped entirely at noon.
   */
  applyLight(
    c: Ctx,
    W: number,
    H: number,
    lights: { x: number; y: number; r: number; c: string; k: number }[],
    extraDark = 0,
    /** paints extra ambient regions into the quarter-size lightmap, e.g. darkness underground */
    paint?: (g: Ctx, q: number) => void,
    /** false on a struggling phone: skip the bloom pass on top of the lightmap */
    bloom = true,
  ) {
    const amb = this.ambient();
    const dark = paint ? 1 : Math.min(1, this.night + extraDark);
    const flat = amb[0] > 250 && amb[1] > 250 && amb[2] > 250 && extraDark === 0 && !paint;
    if (flat) return;
    const lw = Math.ceil(W / 4);
    const lh = Math.ceil(H / 4);
    if (this.light.width !== lw || this.light.height !== lh) {
      this.light.width = lw;
      this.light.height = lh;
    }
    const g = this.lg;
    g.globalCompositeOperation = 'source-over';
    let a = amb;
    if (extraDark) a = mix(amb, [40, 44, 70], extraDark);
    g.fillStyle = css(a);
    g.fillRect(0, 0, lw, lh);
    if (paint) paint(g, 4);
    if (dark > 0.05) {
      g.globalCompositeOperation = 'lighter';
      for (const l of lights) {
        const r = (l.r / 4) * (0.92 + l.k * 0.08);
        g.globalAlpha = Math.min(1, dark * 1.1) * (0.85 + l.k * 0.15);
        g.drawImage(this.glow(l.c), l.x / 4 - r, l.y / 4 - r, r * 2, r * 2);
      }
      g.globalAlpha = 1;
    }
    c.save();
    c.globalCompositeOperation = 'multiply';
    c.imageSmoothingEnabled = true;
    c.drawImage(this.light, 0, 0, lw, lh, 0, 0, W, H);
    c.restore();
    // a soft bloom so lamps read as bright, not just un-dark
    if (dark > 0.2 && !paint && bloom) {
      c.save();
      c.globalCompositeOperation = 'lighter';
      for (const l of lights) {
        const r = l.r * 0.45;
        c.globalAlpha = dark * 0.22 * (0.8 + l.k * 0.2);
        c.drawImage(this.glow(l.c), l.x - r, l.y - r, r * 2, r * 2);
      }
      c.restore();
    }
  }
}

export type { RGB };
