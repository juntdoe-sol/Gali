/**
 * The sea, drawn live.
 *
 * Two layers. The open ocean is a small tileable texture, animated in eight
 * frames and laid down as a pattern that moves with the map, so it reaches every
 * edge of any screen. The water near the island is computed per pixel from a
 * distance field around the coast: shallows fade from turquoise to deep blue,
 * swells roll toward the beach and break into foam on it, and the odd glint
 * catches the light. It is quantised to a handful of colours with an ordered
 * dither so it stays pixel art rather than a gradient.
 */
import { ISLE, makeCanvas, ctx2d, type Ctx } from './art';
import { BLOCK } from './island';

const [MW, MH] = ISLE.size as [number, number];
const TILE = 64;
const FRAMES = 8;
const REACH = 22; // map px of shallow water drawn around the coast

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

// deepest to lightest
const DEEP: RGB[] = ['#0f3060', '#123a6b', '#15437a'].map(hex);
const SHORE: RGB[] = ['#123a6b', '#1a5590', '#1f6fa6', '#2a8bbd', '#3aa9cf', '#5cc9dd', '#8fe3ea'].map(hex);
const FOAM: RGB = hex('#e9fbff');
const FOAM2: RGB = hex('#b9eef5');

/** Tileable value noise on a `per`-periodic lattice. */
function tileNoise(x: number, y: number, per: number, seed: number) {
  const h = (i: number, j: number) => {
    const ii = ((i % per) + per) % per;
    const jj = ((j % per) + per) % per;
    const s = Math.sin(ii * 127.1 + jj * 311.7 + seed * 74.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v;
}

export class Water {
  deepFrames: HTMLCanvasElement[] = [];
  shore: HTMLCanvasElement;
  private sg: Ctx;
  private img: ImageData;
  private dist: Float32Array; // distance to land in map px, sea pixels only; -1 = land
  private near: Int32Array; // indices of sea pixels within REACH
  private noise: Float32Array;
  private lastT = -1;
  river: { x: number; y: number }[] = [];

  constructor(groundAlpha: Uint8ClampedArray) {
    this.shore = makeCanvas(MW, MH);
    this.sg = ctx2d(this.shore);
    this.img = this.sg.createImageData(MW, MH);
    this.dist = new Float32Array(MW * MH);
    this.noise = new Float32Array(MW * MH);
    // exact-enough distance: two-pass chamfer (1, 1.414)
    const INF = 1e6;
    const d = this.dist;
    for (let i = 0; i < MW * MH; i++) d[i] = groundAlpha[i * 4 + 3] > 20 ? 0 : INF;
    const D = Math.SQRT2;
    for (let y = 0; y < MH; y++)
      for (let x = 0; x < MW; x++) {
        const i = y * MW + x;
        if (d[i] === 0) continue;
        let m = d[i];
        if (x > 0) m = Math.min(m, d[i - 1] + 1);
        if (y > 0) {
          m = Math.min(m, d[i - MW] + 1);
          if (x > 0) m = Math.min(m, d[i - MW - 1] + D);
          if (x < MW - 1) m = Math.min(m, d[i - MW + 1] + D);
        }
        d[i] = m;
      }
    for (let y = MH - 1; y >= 0; y--)
      for (let x = MW - 1; x >= 0; x--) {
        const i = y * MW + x;
        if (d[i] === 0) continue;
        let m = d[i];
        if (x < MW - 1) m = Math.min(m, d[i + 1] + 1);
        if (y < MH - 1) {
          m = Math.min(m, d[i + MW] + 1);
          if (x < MW - 1) m = Math.min(m, d[i + MW + 1] + D);
          if (x > 0) m = Math.min(m, d[i + MW - 1] + D);
        }
        d[i] = m;
      }
    const near: number[] = [];
    // value noise from a coarse lattice, interpolated: the same look as calling
    // the noise function per pixel at a fraction of the start-up cost
    const LW = Math.ceil(MW / 5) + 2;
    const LH = Math.ceil(MH / 5) + 2;
    const lat = new Float32Array(LW * LH);
    for (let j = 0; j < LH; j++)
      for (let k = 0; k < LW; k++) {
        const v = Math.sin(k * 127.1 + j * 311.7 + 3 * 74.7) * 43758.5453;
        lat[j * LW + k] = v - Math.floor(v);
      }
    for (let i = 0; i < MW * MH; i++) {
      if (d[i] > 0 && d[i] <= REACH) {
        near.push(i);
        const fx = (i % MW) / 5;
        const fy = ((i / MW) | 0) / 5;
        const xi = fx | 0;
        const yi = fy | 0;
        let u = fx - xi;
        let v = fy - yi;
        u = u * u * (3 - 2 * u);
        v = v * v * (3 - 2 * v);
        const a = lat[yi * LW + xi];
        const b = lat[yi * LW + xi + 1];
        const c = lat[(yi + 1) * LW + xi];
        const e = lat[(yi + 1) * LW + xi + 1];
        this.noise[i] = (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + e * u) * v;
      }
    }
    this.near = Int32Array.from(near);
    for (const [bx, by] of ISLE.rivers as number[][]) this.river.push({ x: bx * BLOCK, y: by * BLOCK });
    this.buildDeep(1);
  }

  /** Eight frames of open ocean: calm deep water, soft swells, the odd crest catching light. */
  private buildDeep(upTo = FRAMES) {
    const CREST = hex('#2a6aa6');
    const GLINT = hex('#7fbde6');
    for (let f = this.deepFrames.length; f < upTo; f++) {
      const cv = makeCanvas(TILE, TILE);
      const g = ctx2d(cv);
      const im = g.createImageData(TILE, TILE);
      const ph = (f / FRAMES) * Math.PI * 2;
      for (let y = 0; y < TILE; y++)
        for (let x = 0; x < TILE; x++) {
          const n = tileNoise(x / 16, y / 16, TILE / 16, 1) * 0.65 + tileNoise(x / 8, y / 8, TILE / 8, 2) * 0.35;
          // long, low swells running mostly sideways; the loop is seamless in time and space
          const sw = Math.sin((y / TILE) * Math.PI * 2 * 3 + (x / TILE) * Math.PI * 2 + ph + n * 2.4);
          let v = 0.3 + n * 0.4 + sw * 0.1;
          v += (BAYER[(y & 3) * 4 + (x & 3)] - 0.5) * 0.16;
          const k = Math.max(0, Math.min(DEEP.length - 1, Math.floor(v * DEEP.length)));
          let c = DEEP[k];
          // short crest dashes on a few swell tops
          if (sw > 0.96 && n > 0.52 && ((x + ((y * 7) % 11)) % 9) < 3) c = CREST;
          if (sw > 0.995 && n > 0.66 && ((x + y * 5) % 13) < 2) c = GLINT;
          const o = (y * TILE + x) * 4;
          im.data[o] = c[0];
          im.data[o + 1] = c[1];
          im.data[o + 2] = c[2];
          im.data[o + 3] = 255;
        }
      g.putImageData(im, 0, 0);
      this.deepFrames.push(cv);
    }
  }

  /** Recompute the shallows. Cheap enough at 15 fps on a phone. */
  update(t: number, calm: number, quality = 1) {
    const step = Math.floor(t / (quality ? 66 : 132));
    if (step === this.lastT) return;
    this.lastT = step;
    const data = this.img.data;
    const d = this.dist;
    const nz = this.noise;
    const tt = t / 1000;
    const near = this.near;
    for (let k = 0; k < near.length; k++) {
      const i = near[k];
      const x = i % MW;
      const y = (i / MW) | 0;
      const dd = d[i];
      const n = nz[i];
      const b = BAYER[(y & 3) * 4 + (x & 3)];
      // depth ramp: 1 at the beach, 0 out at REACH
      const depth = 1 - dd / REACH;
      let v = depth * depth * 0.95 + (n - 0.5) * 0.18;
      // swells rolling in: a crest every 7px, moving shoreward
      const wave = Math.sin((dd + tt * 3.2 * calm) * 0.9 - n * 2.4);
      v += wave * 0.07 * depth;
      const o = i * 4;
      let c: RGB;
      let a = 255;
      // breaking foam on the sand, pulsing with the swell
      const surf = 1.6 + Math.sin(tt * 1.7 + n * 6) * 0.9;
      if (dd <= surf && n + b * 0.5 > 0.35) c = FOAM;
      else if (dd <= surf + 1.2 && ((x + y + (tt * 4) | 0) & 3) === 0) c = FOAM2;
      else if (wave > 0.94 && dd < 12 && dd > 3 && n > 0.4) c = FOAM2; // crests further out
      else {
        const q = Math.max(0, Math.min(SHORE.length - 1, Math.floor((v + (b - 0.5) * 0.14) * SHORE.length)));
        c = SHORE[q];
        if (q === 0) a = 0; // blends into the open ocean underneath
      }
      data[o] = c[0];
      data[o + 1] = c[1];
      data[o + 2] = c[2];
      data[o + 3] = a;
    }
    // rare glints on the open water near the island
    for (let k = 0; k < 40; k++) {
      const i = near[(Math.floor(tileNoise(k * 13.1, step * 0.37, 1 << 20, 9) * near.length * 7)) % near.length];
      if (d[i] > 6) {
        const o = i * 4;
        data[o] = 220;
        data[o + 1] = 250;
        data[o + 2] = 255;
        data[o + 3] = 255;
      }
    }
    this.sg.putImageData(this.img, 0, 0);
  }

  deepFrame(t: number) {
    const f = Math.floor(t / 220) % FRAMES;
    // frames are drawn on first use, one at a time, so start-up doesn't pay for all eight
    if (f >= this.deepFrames.length) this.buildDeep(this.deepFrames.length + 1);
    return this.deepFrames[Math.min(f, this.deepFrames.length - 1)];
  }

  /** River highlights: bright pixels drifting downstream through each block. */
  drawRiver(c: Ctx, t: number, ox: number, oy: number, s: number) {
    c.fillStyle = '#9fdcff';
    for (let k = 0; k < this.river.length; k++) {
      const r = this.river[k];
      const u = ((t / 900 + k * 0.37) % 1) * BLOCK;
      c.fillRect(Math.round(ox + (r.x + u) * s), Math.round(oy + (r.y + 1) * s), Math.ceil(s), Math.ceil(s));
      if (k % 2 === 0) {
        c.fillStyle = '#d8f3ff';
        c.fillRect(Math.round(ox + (r.x + ((u + 1.5) % BLOCK)) * s), Math.round(oy + (r.y + 2) * s), Math.ceil(s), Math.ceil(s));
        c.fillStyle = '#9fdcff';
      }
    }
  }
}

