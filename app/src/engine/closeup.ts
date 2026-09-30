/**
 * A claim, up close: the ground cut open like a diorama.
 *
 * Tap a claim on the island and the camera dives into it. Above the line is the
 * claim as it stands, in its own region's light: a headframe or a cave mouth, a
 * stream with a sluice, a sign with its number and the SOL on it. Below is what
 * the miners are after: strata, roots, fossils, and a gallery lit by lanterns
 * where everyone who put SOL on this claim is swinging at the face. How busy the
 * gallery is reflects how much SOL is on the claim.
 *
 * Every claim is generated from its own seed, so no two look alike, and none of
 * it is downloaded: it is drawn here, once, the first time you visit.
 */
import { draw, makeCanvas, ctx2d, text, textCentered, textWidth, type Ctx } from './art';
import { drawMiner, frameAt, HIT_FRAME, IMPACT, type Body } from './actors';
import { CLAIMS } from './island';
import type { Particles } from './particles';
import type { Look, Pose } from './types';

export const SW = 300;
export const SH = 250;
const SURF = 96; // surface line
const GAL_TOP = 184;
const GAL_BOT = 206; // gallery floor
const GAL_X0 = 84;
const FACE_X = 230; // the rock face they are digging at
const SHAFT_X = 98;
const SIGN_X = 158;
/** the middle of what matters, for centring on narrow screens */
export const SCENE_CX = 160;

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

interface Biome {
  top: string[]; // surface cap, light to dark
  soil: string[];
  clay: string[];
  rock: string[];
  deep: string[];
  hills: string[]; // far, near
  trees: string[];
  sky: 'green' | 'cap' | 'rust' | 'sands';
}
const BIOMES: Record<string, Biome> = {
  'The Green': {
    top: ['#7cc24f', '#5c9440', '#467d31'],
    soil: ['#8a5a36', '#744a2c', '#5e3a22'],
    clay: ['#a0683c', '#8a5632', '#6e4428'],
    rock: ['#7d7a78', '#666260', '#514d4c'],
    deep: ['#4a4450', '#3b3642', '#2d2934'],
    hills: ['#6f9fb4', '#4f8a5a'],
    trees: ['prop-oak-a-0', 'prop-oak-b-0', 'prop-pine-a-0', 'prop-bush-a-0', 'prop-sapling-a-0'],
    sky: 'green',
  },
  'The Cap': {
    top: ['#f4f9ff', '#dbe7f5', '#b9c9dd'],
    soil: ['#8d97a6', '#6e7a8c', '#566172'],
    clay: ['#7d8796', '#646e7e', '#4f5866'],
    rock: ['#626b7a', '#4f5766', '#3e4553'],
    deep: ['#3c3f52', '#303345', '#252838'],
    hills: ['#9fb6d6', '#dfe9f6'],
    trees: ['prop-pine-snow-0', 'prop-pine-b-0', 'prop-fir-a-0', 'prop-boulder-a-0'],
    sky: 'cap',
  },
  'Rust Badlands': {
    top: ['#e0a05a', '#c9803a', '#b57132'],
    soil: ['#c47a3e', '#a86430', '#8c5026'],
    clay: ['#b0552c', '#944524', '#7a381d'],
    rock: ['#8a4a2e', '#723c25', '#5c301e'],
    deep: ['#553040', '#452636', '#361e2c'],
    hills: ['#d6955e', '#b0603a'],
    trees: ['prop-cactus-a-0', 'prop-cactus-b-0', 'prop-deadtree-a-0', 'prop-boulder-b-0', 'prop-scrub-a-0'],
    sky: 'rust',
  },
  'South Sands': {
    top: ['#f1e2b0', '#e3cf94', '#d0b678'],
    soil: ['#d8bf86', '#c4a96c', '#ab8f56'],
    clay: ['#b99a62', '#9e814e', '#84693e'],
    rock: ['#8a7a64', '#726452', '#5c5042'],
    deep: ['#4a4450', '#3b3642', '#2d2934'],
    hills: ['#6fb4e0', '#2a8bbd'],
    trees: ['prop-palm-a-0', 'prop-palm-b-0', 'prop-bush-b-0', 'prop-tuft-a-0'],
    sky: 'sands',
  },
};

function rng(seed: number) {
  let s = (seed * 9301 + 49297) % 233280;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}
function vnoise(x: number, seed: number) {
  const i = Math.floor(x);
  const f = x - i;
  const h = (n: number) => {
    const s = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}

export interface Scene {
  i: number;
  biome: Biome;
  kind: string;
  ground: HTMLCanvasElement; // static: earth, carvings, props (transparent sky)
  far: HTMLCanvasElement; // static: background silhouettes
  surf: Int16Array; // surface y per column
  veins: { x: number; y: number }[]; // ore pixels near the face, for glints
  lanterns: { x: number; y: number }[];
  cart: number; // 0..1 along the rails
  cartDir: number;
  crowd: Crowd[];
  lastHit: number;
}
interface Crowd {
  look: Look;
  x: number;
  since: number;
  facing: 1 | -1;
  phase: number;
  lastSwing: number;
}

/** Deterministic looks for the crowd of other miners on a busy claim. */
const CROWD_LOOKS: Look[] = [
  { hat: 'hat-red', fit: '#8a7a4a', pick: '#b8c4d6', handle: '#6b4a32', pet: null, glow: 'none' },
  { hat: 'hat-teal', fit: '#2f5fd0', pick: '#c9c9c9', handle: '#9b6b43', pet: null, glow: 'none' },
  { hat: 'hat-yellow', fit: '#7a2f5c', pick: '#ffc83d', handle: '#5a3a24', pet: null, glow: 'rare' },
  { hat: 'hat-songkok', fit: '#ff7a00', pick: '#3de0c8', handle: '#2b2140', pet: null, glow: 'epic' },
  { hat: 'hat-yellow', fit: '#3b6fd1', pick: '#c9c9c9', handle: '#9b6b43', pet: null, glow: 'none' },
];

export function buildScene(i: number): Scene {
  const c = CLAIMS[i];
  const biome = BIOMES[c.region] ?? BIOMES['The Green'];
  const r = rng(i * 7919 + 13);
  const ground = makeCanvas(SW, SH);
  const g = ctx2d(ground);
  const im = g.createImageData(SW, SH);
  const d = im.data;
  const surf = new Int16Array(SW);
  for (let x = 0; x < SW; x++) {
    let h = SURF + (vnoise(x / 26, i) - 0.5) * 10 + (vnoise(x / 9, i + 50) - 0.5) * 3;
    if (Math.abs(x - SHAFT_X) < 14) h = SURF + 1; // level ground round the headframe
    surf[x] = Math.round(h);
  }
  const set = (x: number, y: number, col: RGB, a = 255) => {
    if (x < 0 || y < 0 || x >= SW || y >= SH) return;
    const o = (y * SW + x) * 4;
    d[o] = col[0];
    d[o + 1] = col[1];
    d[o + 2] = col[2];
    d[o + 3] = a;
  };
  const pal = (arr: string[]) => arr.map(hex);
  const TOP = pal(biome.top);
  const SOIL = pal(biome.soil);
  const CLAY = pal(biome.clay);
  const ROCK = pal(biome.rock);
  const DEEP = pal(biome.deep);
  // strata boundaries wander a little so the layers read as geology, not stripes
  for (let x = 0; x < SW; x++) {
    const s = surf[x];
    const b1 = s + 12 + Math.round((vnoise(x / 17, i + 3) - 0.5) * 8);
    const b2 = s + 44 + Math.round((vnoise(x / 23, i + 4) - 0.5) * 12);
    const b3 = s + 96 + Math.round((vnoise(x / 29, i + 5) - 0.5) * 14);
    for (let y = s; y < SH; y++) {
      const dy = y - s;
      const n = vnoise(x / 3 + y * 0.71, i + 9) * 0.6 + vnoise(x / 7 - y / 5, i + 10) * 0.4;
      const b = BAYER[(y & 3) * 4 + (x & 3)];
      const v = n + (b - 0.5) * 0.35;
      const k = v > 0.62 ? 0 : v > 0.38 ? 1 : 2;
      let col: RGB;
      if (dy < 3) col = dy === 0 ? TOP[0] : TOP[dy === 1 ? 1 : 2];
      else if (y < b1) col = SOIL[k];
      else if (y < b2) col = CLAY[k];
      else if (y < b3) col = ROCK[k];
      else col = DEEP[k];
      // a darker line where one stratum meets the next
      if (y === b1 || y === b2 || y === b3) col = [col[0] * 0.78, col[1] * 0.78, col[2] * 0.78];
      set(x, y, col);
    }
  }
  const blob = (cx: number, cy: number, rx: number, ry: number, fill: (x: number, y: number, e: number) => RGB | null) => {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
        const e = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
        if (e > 1 || y <= surf[Math.max(0, Math.min(SW - 1, x))] + 2) continue;
        const col = fill(x, y, e);
        if (col) set(x, y, col);
      }
  };
  // pebbles and boulders
  for (let k = 0; k < 70; k++) {
    const x = r() * SW;
    const y = SURF + 8 + r() * (SH - SURF - 8);
    const rr = 1 + r() * (y > SURF + 40 ? 3.2 : 2);
    const base = y < SURF + 40 ? ROCK : DEEP;
    blob(x, y, rr * 1.3, rr, (px, py, e) => (e > 0.7 ? [base[2][0] * 0.8, base[2][1] * 0.8, base[2][2] * 0.8] : py < y - rr * 0.3 && px < x ? base[0] : base[1]));
  }
  // roots under anything green
  if (biome.sky === 'green' || biome.sky === 'sands')
    for (let k = 0; k < 9; k++) {
      let x = r() * SW;
      let y = surf[Math.floor(x)] + 2;
      const len = 6 + r() * 12;
      for (let s = 0; s < len; s++) {
        set(Math.round(x), Math.round(y), [92, 60, 38]);
        x += (r() - 0.5) * 1.6;
        y += 0.8 + r() * 0.4;
      }
    }
  // a fossil or two in the clay: the island is old
  for (let k = 0; k < 2; k++) {
    const fx = 20 + r() * (SW - 40);
    const fy = SURF + 30 + r() * 30;
    for (let a = 0; a < 26; a++) {
      const t = a * 0.42;
      const rad = 0.6 + t * 0.55;
      set(Math.round(fx + Math.cos(t) * rad), Math.round(fy + Math.sin(t) * rad * 0.9), [226, 214, 188]);
    }
  }
  // ore: veins that thicken toward the face, gold everywhere, gems on gold claims
  const veins: { x: number; y: number }[] = [];
  const GOLD: RGB[] = pal(['#fff1a8', '#ffd24a', '#e0a020', '#8a5a14']);
  const GEM: RGB[] = pal(['#c8fff6', '#3de0c8', '#1f8a90']);
  const nVeins = 7 + Math.floor(r() * 4);
  for (let k = 0; k < nVeins; k++) {
    const near = k < 4;
    let x = near ? FACE_X - 6 + r() * 26 : 30 + r() * (SW - 50);
    let y = near ? GAL_TOP - 8 + r() * 36 : SURF + 40 + r() * (SH - SURF - 50);
    const steps = 8 + r() * 14;
    for (let s = 0; s < steps; s++) {
      const ix = Math.round(x);
      const iy = Math.round(y);
      if (iy > surf[Math.max(0, Math.min(SW - 1, ix))] + 6) {
        set(ix, iy, GOLD[1]);
        set(ix + 1, iy, GOLD[2]);
        set(ix, iy + 1, GOLD[3]);
        if (r() < 0.3) set(ix, iy - 1, GOLD[0]);
        veins.push({ x: ix, y: iy });
      }
      x += (r() - 0.4) * 2.2;
      y += (r() - 0.5) * 1.8;
    }
  }
  if (c.kind === 'gold' || c.kind === 'scree')
    for (let k = 0; k < 6; k++) {
      const gx = 30 + r() * (SW - 40);
      const gy = SURF + 50 + r() * (SH - SURF - 56);
      set(gx | 0, gy | 0, GEM[0]);
      set((gx | 0) + 1, gy | 0, GEM[1]);
      set(gx | 0, (gy | 0) + 1, GEM[1]);
      set((gx | 0) + 1, (gy | 0) + 1, GEM[2]);
      veins.push({ x: gx | 0, y: gy | 0 });
    }
  // carve: the shaft and the gallery
  const CAVE: RGB[] = pal(['#2a2230', '#211b27', '#18131d']);
  const carve = (x: number, y: number) => {
    const b = BAYER[(y & 3) * 4 + (x & 3)];
    const n = vnoise(x / 4 + y * 0.3, i + 77);
    set(x, y, CAVE[n + b * 0.3 > 0.75 ? 0 : n > 0.4 ? 1 : 2]);
  };
  for (let y = surf[SHAFT_X] + 1; y < GAL_BOT; y++) for (let x = SHAFT_X - 6; x <= SHAFT_X + 6; x++) carve(x, y);
  const roof = (x: number) => GAL_TOP + Math.round((vnoise(x / 11, i + 31) - 0.5) * 5);
  for (let x = GAL_X0; x <= FACE_X; x++) {
    const top = roof(x);
    const faceBulge = x > FACE_X - 6 ? Math.round((x - (FACE_X - 6)) * 1.2) : 0;
    for (let y = top + faceBulge; y < GAL_BOT - Math.floor(faceBulge / 2); y++) carve(x, y);
  }
  // timbering: posts and cap beams, every 24px
  const WOOD: RGB[] = pal(['#b07a48', '#8a5a32', '#5e3a20']);
  for (let x = GAL_X0 + 16; x < FACE_X - 12; x += 24) {
    const top = roof(x);
    for (let y = top; y < GAL_BOT; y++) {
      set(x, y, WOOD[1]);
      set(x + 1, y, WOOD[2]);
    }
    for (let bx = x - 4; bx <= x + 5; bx++) {
      set(bx, top, WOOD[0]);
      set(bx, top + 1, WOOD[2]);
    }
  }
  // shaft ladder
  for (let y = surf[SHAFT_X] + 2; y < GAL_BOT; y++) {
    set(SHAFT_X - 3, y, WOOD[1]);
    set(SHAFT_X + 3, y, WOOD[1]);
    if (y % 4 === 0) for (let x = SHAFT_X - 3; x <= SHAFT_X + 3; x++) set(x, y, WOOD[0]);
  }
  // rails: two lines and sleepers
  for (let x = GAL_X0 + 2; x < FACE_X - 4; x++) {
    if (x % 5 === 0) {
      set(x, GAL_BOT - 1, WOOD[2]);
      set(x + 1, GAL_BOT - 1, WOOD[2]);
    }
    set(x, GAL_BOT - 2, [150, 156, 170]);
  }
  // lanterns hang from alternate beams
  const lanterns: { x: number; y: number }[] = [];
  for (let x = GAL_X0 + 28; x < FACE_X - 16; x += 48) lanterns.push({ x, y: roof(x) + 5 });
  g.putImageData(im, 0, 0);

  // the surface: trees and rocks from the island's own props, then the workings
  const t = biome.trees;
  for (let k = 0; k < 7; k++) {
    const x = Math.round(8 + r() * (SW - 16));
    if (Math.abs(x - SHAFT_X) < 20 || Math.abs(x - SIGN_X) < 12) continue;
    draw(g, t[Math.floor(r() * t.length)], x, surf[x] + 1, 1);
  }
  const tuft = biome.sky === 'rust' ? 'prop-tuft-dry-0' : biome.sky === 'cap' ? 'prop-stone-a-0' : 'prop-tuft-a-0';
  for (let k = 0; k < 10; k++) {
    const x = Math.round(r() * SW);
    draw(g, tuft, x, surf[Math.max(0, Math.min(SW - 1, x))] + 1, 1);
  }
  drawWorkings(g, c.kind, surf, biome, i);
  // lantern posts on the surface
  draw(g, 'prop-lantern-0', SHAFT_X + 16, surf[SHAFT_X + 16] + 1, 1);

  // background: two bands of hills or mesas or sea, tinted to the region
  const far = makeCanvas(SW, SURF + 4);
  const fg = ctx2d(far);
  const [h1, h2] = biome.hills;
  for (let x = 0; x < SW; x++) {
    if (biome.sky === 'sands') {
      fg.fillStyle = h2;
      fg.fillRect(x, SURF - 26, 1, 30);
      if ((x + i) % 9 < 3) {
        fg.fillStyle = '#8fd2ee';
        fg.fillRect(x, SURF - 26 + ((x * 7) % 18), 1, 1);
      }
      fg.fillStyle = h1;
      fg.fillRect(x, SURF - 27, 1, 1);
      continue;
    }
    const mesa = biome.sky === 'rust';
    const hA = mesa ? (vnoise(x / 30, i + 60) > 0.55 ? 34 : 14) + vnoise(x / 6, i) * 3 : 26 + vnoise(x / 22, i + 60) * 26 + (biome.sky === 'cap' ? vnoise(x / 8, i + 61) * 14 : 0);
    fg.fillStyle = h1;
    fg.fillRect(x, Math.round(SURF - hA), 1, Math.round(hA) + 4);
    if (biome.sky === 'cap' && hA > 40) {
      fg.fillStyle = '#ffffff';
      fg.fillRect(x, Math.round(SURF - hA), 1, Math.round((hA - 40) * 0.8) + 1);
    }
    const hB = mesa ? 8 + vnoise(x / 14, i + 62) * 8 : 10 + vnoise(x / 13, i + 62) * 12;
    fg.fillStyle = h2;
    fg.fillRect(x, Math.round(SURF - hB), 1, Math.round(hB) + 4);
  }

  const crowd: Crowd[] = [];
  return { i, biome, kind: c.kind, ground, far, surf, veins, lanterns, cart: 0.2, cartDir: 1, crowd, lastHit: 0 };
}

/** What stands over the hole, by kind of claim. */
function drawWorkings(g: Ctx, kind: string, surf: Int16Array, biome: Biome, i: number) {
  const px = (x: number, y: number, w: number, h: number, col: string) => {
    g.fillStyle = col;
    g.fillRect(x, y, w, h);
  };
  const s = surf[SHAFT_X];
  const W0 = '#b07a48';
  const W1 = '#8a5a32';
  const W2 = '#5e3a20';
  if (kind === 'dig' || kind === 'gold') {
    // timber headframe: two legs, a cap, the sheave wheel is drawn live
    for (let k = 0; k < 30; k++) {
      px(SHAFT_X - 10 + Math.round(k * 0.2), s - k, 2, 1, W1);
      px(SHAFT_X + 9 - Math.round(k * 0.2), s - k, 2, 1, W1);
    }
    px(SHAFT_X - 5, s - 30, 12, 2, W0);
    px(SHAFT_X - 5, s - 29, 12, 1, W2);
    px(SHAFT_X - 8, s - 14, 18, 1, W2);
    // a brace and a winch house
    px(SHAFT_X - 26, s - 10, 12, 10, '#7a5638');
    px(SHAFT_X - 27, s - 12, 14, 3, '#5a3a24');
    px(SHAFT_X - 22, s - 7, 3, 4, '#2a1c14');
  } else if (kind === 'cave') {
    // a rock outcrop with the adit cut into it
    const R = ['#8d97a6', '#6e7a8c', '#4c5666'];
    for (let y = 0; y < 34; y++) {
      const half = Math.round(22 - y * 0.35 + vnoise(y / 3, i) * 3);
      for (let x = -half; x <= half; x++) {
        const k = x < -half / 3 ? 0 : x > half / 2 ? 2 : 1;
        px(SHAFT_X + x, s - y, 1, 1, R[k]);
      }
    }
    for (let y = 0; y < 16; y++) {
      const half = Math.round(Math.sqrt(Math.max(0, 64 - (y - 2) ** 2 * 0.28)));
      px(SHAFT_X - half, s - y, half * 2 + 1, 1, '#161219');
    }
    px(SHAFT_X - 9, s - 17, 19, 2, W0);
    px(SHAFT_X - 9, s - 16, 2, 16, W1);
    px(SHAFT_X + 8, s - 16, 2, 16, W1);
  } else {
    // scree: a sluice on legs and heaps of sorted stone
    px(SHAFT_X - 9, s - 8, 20, 3, W0);
    px(SHAFT_X - 9, s - 5, 20, 1, W2);
    for (const lx of [-8, 0, 8]) px(SHAFT_X + lx, s - 5, 1, 5, W1);
    for (let k = 0; k < 3; k++) {
      const hx = SHAFT_X + 20 + k * 11;
      for (let y = 0; y < 7 - k; y++) px(hx - (7 - y), surf[hx] - y, (7 - y) * 2, 1, ['#8d97a6', '#6e7a8c', '#aab3c0'][(y + k) % 3]);
    }
  }
  // the claim sign is drawn live (its number and SOL change), but its post is here
  const sx = SIGN_X;
  px(sx, surf[sx] - 12, 2, 12, W1);
  void biome;
}

export interface CloseupState {
  now: number;
  dt: number;
  el: number; // reveal clock, -1 when not revealing
  winner: number | null;
  sol: number; // SOL on this claim
  mine: number; // your SOL on it
  picked: boolean;
  deployed: boolean;
  solo: boolean;
  look: Look;
  night: number;
  skyAmbient: RGB;
  wind: number;
  quality: number;
}

const SKY: Record<Biome['sky'], [string, string, string]> = {
  green: ['#5fb3e8', '#8fd0f2', '#c9ecfa'],
  cap: ['#6aa6e0', '#a7cdf0', '#e2f0fb'],
  rust: ['#e89a5a', '#f2c08a', '#f8e0b8'],
  sands: ['#4fb0e6', '#8ed6f4', '#d6f3fb'],
};
const NIGHT_SKY: [string, string, string] = ['#0b1030', '#16204a', '#26305e'];

/** Your miner in the scene: walks down the shaft and along to the face when you pick the claim. */
export interface Visit {
  me: Body;
  enteredAt: number;
  shakeUntil: number;
}

export function newVisit(now: number): Visit {
  return { me: { x: SHAFT_X + 22, y: SURF + 1, path: [], pose: 'idle', since: now, facing: 1 }, enteredAt: now, shakeUntil: 0 };
}

/**
 * Draw the scene into screen space: `ox, oy` is the scene origin in device px,
 * `s` device px per art pixel. Returns the lights for the lightmap.
 */
export function drawScene(c: Ctx, sc: Scene, v: Visit, st: CloseupState, ox: number, oy: number, s: number, parts: Particles, sfx: (n: 'hit' | 'crack') => void) {
  const lights: { x: number; y: number; r: number; c: string; k: number }[] = [];
  const now = st.now;
  const P = (x: number) => Math.round(ox + x * s);
  const Q = (y: number) => Math.round(oy + y * s);
  const isWin = st.winner === sc.i && st.el >= 2500;
  const isLose = st.winner !== null && st.winner !== sc.i && st.el >= 1400;
  let shake = 0;
  if (st.el >= 0 && st.el < 1400) shake = (Math.random() - 0.5) * 2 * Math.min(1, st.el / 700);
  if (now < v.shakeUntil) shake += (Math.random() - 0.5) * 2;
  ox += shake * s;

  // sky, banded, with stars after dark
  const band = SKY[sc.biome.sky];
  const n = st.night;
  for (let k = 0; k < 3; k++) {
    c.fillStyle = n > 0.5 ? NIGHT_SKY[k] : band[k];
    const y0 = Math.floor((SURF * k) / 3) - 200;
    c.fillRect(P(-400), Q(y0 + (k ? 200 : 0)), (SW + 800) * s, Math.ceil(((SURF + 200) / 3) * s + s) + (k ? 0 : 200 * s));
  }
  if (n > 0.3) {
    c.fillStyle = '#ffffff';
    for (let k = 0; k < 40; k++) {
      const sx = (k * 53.7) % (SW + 60) - 30;
      const sy = (k * 29.3) % (SURF - 30);
      if (Math.sin(now / 400 + k) > -0.6) c.fillRect(P(sx), Q(sy), Math.ceil(s), Math.ceil(s));
    }
  } else {
    // a sun or its glow low on the horizon
    c.fillStyle = '#fff4c2';
    c.fillRect(P(SW - 90), Q(18), 8 * s, 8 * s);
  }
  c.drawImage(sc.far, P(0), Q(0), SW * s, sc.far.height * s);
  // side margins beyond the scene: continue the ground as plain strata
  c.drawImage(sc.ground, P(0), Q(0), SW * s, SH * s);

  // live bits of the workings: sheave wheel turning, bucket on its rope
  const busy = st.deployed || sc.crowd.length > 0;
  const sTop = sc.surf[SHAFT_X] - 30;
  if (sc.kind === 'dig' || sc.kind === 'gold') {
    const a = busy ? now / 300 : 0;
    c.fillStyle = '#3a2a1c';
    for (let k = 0; k < 8; k++) {
      const ang = a + (k * Math.PI) / 4;
      c.fillRect(P(SHAFT_X + 0.5 + Math.cos(ang) * 4), Q(sTop - 2 + Math.sin(ang) * 4), Math.ceil(s), Math.ceil(s));
    }
    c.fillRect(P(SHAFT_X), Q(sTop - 2), Math.ceil(s), Math.ceil(s));
    const by = sc.surf[SHAFT_X] + 10 + (busy ? (Math.sin(now / 1400) * 0.5 + 0.5) * 70 : 0);
    c.fillStyle = '#c9c1b0';
    c.fillRect(P(SHAFT_X + 4), Q(sTop + 2), Math.ceil(s * 0.5) || 1, (by - sTop - 2) * s);
    c.fillStyle = '#6b4a32';
    c.fillRect(P(SHAFT_X + 2), Q(by), 5 * s, 4 * s);
    c.fillStyle = '#ffd24a';
    c.fillRect(P(SHAFT_X + 3), Q(by), 3 * s, s);
  }
  if (sc.kind === 'gold') {
    // a stream crossing the surface, moving
    for (let x = 130; x < 196; x++) {
      const y = sc.surf[x];
      c.fillStyle = (x + Math.floor(now / 120)) % 6 < 2 ? '#bfeaff' : '#4fa8e0';
      c.fillRect(P(x), Q(y - 1), Math.ceil(s), 2 * s);
    }
  }

  // the claim sign: number and the SOL on it
  const sx = SIGN_X;
  const sy = sc.surf[sx] - 12;
  const label = `CLAIM ${sc.i + 1}`;
  const solTxt = st.sol > 0 ? `${st.sol < 0.01 ? st.sol.toFixed(4) : st.sol.toFixed(3)} SOL` : 'NO SOL YET';
  const w = Math.max(textWidth(label), textWidth(solTxt)) + 6;
  c.fillStyle = '#5e3a20';
  c.fillRect(P(sx + 1 - w / 2) - s, Q(sy - 15) - s, (w + 2) * s, 15 * s);
  c.fillStyle = '#c69058';
  c.fillRect(P(sx + 1 - w / 2), Q(sy - 15), w * s, 13 * s);
  c.fillStyle = '#a8763f';
  c.fillRect(P(sx + 1 - w / 2), Q(sy - 4), w * s, 2 * s);
  textCentered(c, label, P(sx + 1), Q(sy - 13), s, '#3a2412');
  textCentered(c, solTxt, P(sx + 1), Q(sy - 7), s, st.solo ? '#7a1d6a' : '#3a2412');
  if (st.solo) text(c, '*', P(sx + 1 + w / 2 + 2), Q(sy - 16), s, '#ffd84a', '#3a1d00');

  // the minecart shuttles between the shaft and the face
  if (busy) {
    sc.cart += sc.cartDir * st.dt * 0.12;
    if (sc.cart > 1) {
      sc.cart = 1;
      sc.cartDir = -1;
    } else if (sc.cart < 0) {
      sc.cart = 0;
      sc.cartDir = 1;
    }
  }
  const cx = GAL_X0 + 16 + sc.cart * (FACE_X - GAL_X0 - 60);
  c.fillStyle = '#3e4553';
  c.fillRect(P(cx), Q(GAL_BOT - 9), 12 * s, 6 * s);
  c.fillStyle = '#626b7a';
  c.fillRect(P(cx + 1), Q(GAL_BOT - 9), 10 * s, s);
  c.fillStyle = sc.cartDir < 0 ? '#ffd24a' : '#8a7a64';
  c.fillRect(P(cx + 2), Q(GAL_BOT - 11), 8 * s, 2 * s);
  c.fillStyle = '#1a1420';
  c.fillRect(P(cx + 1), Q(GAL_BOT - 3), 3 * s, 2 * s);
  c.fillRect(P(cx + 8), Q(GAL_BOT - 3), 3 * s, 2 * s);

  // ore glints
  for (let k = 0; k < sc.veins.length; k += 3) {
    const vn = sc.veins[k];
    if (Math.sin(now / 260 + k * 1.7) > 0.93) {
      c.fillStyle = '#ffffff';
      c.fillRect(P(vn.x), Q(vn.y), Math.ceil(s), Math.ceil(s));
      c.fillRect(P(vn.x - 1), Q(vn.y), Math.ceil(s), Math.ceil(s));
      c.fillRect(P(vn.x + 1), Q(vn.y), Math.ceil(s), Math.ceil(s));
    }
  }

  // lanterns
  for (const l of sc.lanterns) {
    const fl = 0.85 + Math.sin(now / 90 + l.x) * 0.08 + Math.random() * 0.05;
    const dim = isLose ? Math.max(0.35, 1 - (st.el - 1400) / 1200) : 1;
    c.fillStyle = '#2a1c14';
    c.fillRect(P(l.x), Q(l.y - 4), Math.ceil(s), 3 * s);
    c.fillStyle = '#ffcf70';
    c.fillRect(P(l.x - 1), Q(l.y - 1), 3 * s, 3 * s);
    lights.push({ x: P(l.x), y: Q(l.y), r: 44 * s * fl * dim, c: '#ffb45a', k: fl });
  }
  lights.push({ x: P(SHAFT_X + 16), y: Q(sc.surf[SHAFT_X + 16] - 7), r: 18 * s, c: '#ffcf70', k: 1 });

  // the crowd: one miner per step of SOL others have put here, at the face
  const others = Math.max(0, st.sol - st.mine);
  const want = others <= 0 ? 0 : Math.min(5, 1 + Math.floor(Math.log2(1 + others * 150)));
  while (sc.crowd.length < want) {
    const k = sc.crowd.length;
    sc.crowd.push({ look: CROWD_LOOKS[(k + sc.i) % CROWD_LOOKS.length], x: FACE_X - 12 - k * 15 - (k % 2) * 3, since: now - k * 170, facing: 1, phase: k * 0.37, lastSwing: -1 });
  }
  if (sc.crowd.length > want) sc.crowd.length = want;
  const swingMs = 6 * 90;
  const onHit = (x: number, y: number, look: Look) => {
    parts.burst('chip', x, y, 4, 22, 20, [sc.biome.rock[0], sc.biome.rock[1], '#ffd24a'], 0.6);
    parts.burst('dust', x, y, 3, 8, 6, ['#d8c8a8'], 0.8);
    if (look.glow !== 'none') parts.burst('spark', x, y - 2, 4, 30, 18, look.glow === 'legendary' ? ['#ff4fd8', '#c7f284', '#ffffff'] : ['#fff1a8', '#ffd24a'], 0.5);
  };
  for (const m of sc.crowd) {
    const f = frameAt('swing', m.since, now);
    const cycle = Math.floor((now - m.since) / swingMs);
    if (f >= HIT_FRAME && m.lastSwing !== cycle) {
      m.lastSwing = cycle;
      onHit(m.x + (IMPACT[0] - 10) + 3, GAL_BOT - 2, m.look);
    }
    if ((now - m.since) % swingMs >= swingMs - 20) m.since = now; // restart cleanly
    drawMiner(c, m.look, 'swing', f, P(m.x), Q(GAL_BOT - 1), s, 1);
    lights.push({ x: P(m.x + 3), y: Q(GAL_BOT - 22), r: 16 * s, c: '#fff1c8', k: 1 });
  }

  // you: down the ladder and along to the face once you've put SOL here
  const me = v.me;
  const wantFace = st.deployed || st.picked;
  const faceX = FACE_X - 6 - sc.crowd.length * 15 - 12;
  if (wantFace && !me.path.length && Math.abs(me.x - faceX) > 1 && me.y !== GAL_BOT - 1) {
    me.path = [
      [SHAFT_X + 5, sc.surf[SHAFT_X] + 1],
      [SHAFT_X + 5, GAL_BOT - 1],
      [faceX, GAL_BOT - 1],
    ];
  } else if (!wantFace && me.y === GAL_BOT - 1 && !me.path.length) {
    me.path = [
      [SHAFT_X + 5, GAL_BOT - 1],
      [SHAFT_X + 5, sc.surf[SHAFT_X] + 1],
      [SHAFT_X + 22, sc.surf[SHAFT_X + 22] + 1],
    ];
  }
  let pose: Pose = me.pose;
  if (me.path.length) {
    const [tx, ty] = me.path[0];
    const dx = tx - me.x;
    const dy = ty - me.y;
    const dist = Math.hypot(dx, dy);
    const step = (Math.abs(dy) > Math.abs(dx) ? 26 : 40) * st.dt;
    if (Math.abs(dx) > 0.3) me.facing = dx > 0 ? 1 : -1;
    if (dist <= step) {
      me.x = tx;
      me.y = ty;
      me.path.shift();
    } else {
      me.x += (dx / dist) * step;
      me.y += (dy / dist) * step;
    }
    pose = 'walk';
    if (me.pose !== 'walk') me.since = now;
    me.pose = 'walk';
  } else if (me.y === GAL_BOT - 1 && wantFace) {
    if (me.pose !== 'swing') {
      me.pose = 'swing';
      me.since = now;
      me.facing = 1;
    }
    pose = 'swing';
    const f = frameAt('swing', me.since, now);
    const cycle = Math.floor((now - me.since) / swingMs);
    if (f >= HIT_FRAME && sc.lastHit !== cycle) {
      sc.lastHit = cycle;
      onHit(me.x + 6, GAL_BOT - 2, st.look);
      sfx('hit');
    }
    if ((now - me.since) % swingMs >= swingMs - 20) me.since = now;
  } else {
    if (me.pose !== 'idle' && me.pose !== 'cheer') {
      me.pose = 'idle';
      me.since = now;
    }
    pose = me.pose;
  }
  if (isWin && st.mine > 0) pose = 'cheer';
  const climbing = me.path.length > 0 && Math.abs(me.path[0][0] - me.x) < 0.5 && me.y > sc.surf[SHAFT_X] + 2;
  const f = frameAt(pose, pose === 'cheer' ? now - (now % 480) : me.since, now);
  drawMiner(c, st.look, climbing ? 'walk' : pose, climbing ? Math.floor(now / 160) % 2 : f, P(me.x), Q(me.y), s, me.facing);
  const lampY = me.y - 22;
  lights.push({ x: P(me.x + 3 * me.facing), y: Q(lampY), r: 22 * s, c: '#fff1c8', k: 1 });
  // a nametag over you
  const tag = 'YOU';
  const tw = textWidth(tag) + 4;
  c.fillStyle = 'rgba(7,13,32,0.85)';
  c.fillRect(P(me.x - tw / 2), Q(me.y - 36), tw * s, 7 * s);
  textCentered(c, tag, P(me.x), Q(me.y - 35), s, '#ffcf4a');

  // drips from the gallery roof
  if (Math.random() < st.dt * 1.2) parts.spawn('drip', GAL_X0 + Math.random() * (FACE_X - GAL_X0), GAL_TOP + 3, { vz: -5, z: 0, life: 0.9, c: '#7fb8e0' });

  // the result
  if (isWin) {
    const k = Math.min(1, (st.el - 2500) / 400);
    lights.push({ x: P(FACE_X), y: Q(GAL_TOP + 10), r: 120 * s * k, c: '#ffd24a', k: 1 });
    if (Math.random() < 0.6) parts.burst('gold', FACE_X - 4, GAL_BOT - 8, 3, 36, 40, ['#fff1a8', '#ffd24a', '#e0a020'], 1.1);
    if (Math.random() < 0.3) parts.burst('star', FACE_X - 10 + Math.random() * 20, GAL_TOP + Math.random() * 20, 1, 10, 10, ['#ffffff', '#fff1a8'], 0.8);
    const bob = Math.round(Math.sin(now / 160) * 2);
    textCentered(c, 'STRUCK GOLD!', P(SW / 2), Q(SURF + 40 + bob), s * 2, '#ffd84a', '#3a1d00');
  } else if (isLose) {
    if (Math.random() < st.dt * 6) parts.spawn('dust', GAL_X0 + Math.random() * (FACE_X - GAL_X0), GAL_TOP + 2, { vz: -8, life: 1.2, c: '#9a8a78' });
  }
  if (st.el >= 0 && st.el < 1400 && Math.random() < 0.2) sfx('crack');

  return lights;
}

/** The ambient painter for the lightmap: daylight above ground, near black below. */
export function paintUnderground(sc: Scene, ox: number, oy: number, s: number, W: number, H: number, sky: RGB) {
  return (g: Ctx, q: number) => {
    g.fillStyle = '#4a4262';
    g.beginPath();
    g.moveTo(0, H / q);
    for (let x = 0; x <= SW; x += 4) g.lineTo((ox + x * s) / q, (oy + (sc.surf[Math.min(SW - 1, x)] + 3) * s) / q);
    g.lineTo(W / q, (oy + (sc.surf[SW - 1] + 3) * s) / q);
    g.lineTo(W / q, H / q);
    g.closePath();
    g.fill();
    // the first few pixels below ground still catch some daylight
    g.globalAlpha = 0.5;
    g.fillStyle = `rgb(${sky[0] | 0},${sky[1] | 0},${sky[2] | 0})`;
    for (let x = 0; x < SW; x += 4) g.fillRect((ox + x * s) / q, (oy + (sc.surf[x] + 2) * s) / q, (4 * s) / q + 1, (6 * s) / q);
    g.globalAlpha = 1;
  };
}

export const SCENE_SURF = SURF;
