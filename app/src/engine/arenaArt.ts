/**
 * The arena's art, painted in code: the pit (stands, royal box, stone wall, banners, raked sand with a
 * cobbled rim, the ring), the pillars, the crowd, the torch light, and the Mole King boss.
 *
 * Everything static is painted once into canvases and scaled up with the map; only flames, flags, the
 * crowd and the light move each frame. Pure: it only needs the map data and the canvas helpers.
 */
import { ctx2d, makeCanvas, type Ctx } from './art';
import { AH, AW, FLOOR, PILLAR_R, RING } from '../game/arenaMap';

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const mul = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];

function hash2(x: number, y: number, s = 0): number {
  let n = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 982451653)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x: number, y: number, scale: number, s: number): number {
  const fx = x / scale;
  const fy = y / scale;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash2(ix, iy, s);
  const b = hash2(ix + 1, iy, s);
  const c = hash2(ix, iy + 1, s);
  const d = hash2(ix + 1, iy + 1, s);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
/** a seeded random, so the pit looks the same for everyone */
function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** A small RGBA pixel buffer. */
class Px {
  d: Uint8ClampedArray;
  constructor(
    public w: number,
    public h: number,
  ) {
    this.d = new Uint8ClampedArray(w * h * 4);
  }
  set(x: number, y: number, c: RGB, a = 1) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    const d = this.d;
    if (a >= 1 || d[i + 3] === 0) {
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
      d[i + 3] = Math.round(255 * Math.min(1, a));
      return;
    }
    d[i] = d[i] + (c[0] - d[i]) * a;
    d[i + 1] = d[i + 1] + (c[1] - d[i + 1]) * a;
    d[i + 2] = d[i + 2] + (c[2] - d[i + 2]) * a;
  }
  get(x: number, y: number): RGB | null {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return null;
    const i = (y * this.w + x) * 4;
    return this.d[i + 3] ? [this.d[i], this.d[i + 1], this.d[i + 2]] : null;
  }
  opaque(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h && this.d[(y * this.w + x) * 4 + 3] > 0;
  }
  rect(x: number, y: number, w: number, h: number, c: RGB, a = 1) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c, a);
  }
  /** fill an ellipse; `col` gets the point's place in it (-1..1 each way) */
  ell(cx: number, cy: number, rx: number, ry: number, col: (nx: number, ny: number, x: number, y: number) => RGB | null) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - cy) / ry;
        if (nx * nx + ny * ny > 1) continue;
        const c = col(nx, ny, x, y);
        if (c) this.set(x, y, c);
      }
  }
  line(x0: number, y0: number, x1: number, y1: number, c: RGB, w = 1) {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      const y = y0 + ((y1 - y0) * i) / n;
      this.rect(Math.round(x - (w - 1) / 2), Math.round(y - (w - 1) / 2), w, w, c);
    }
  }
  /** a dark edge round everything drawn so far */
  outline(c: RGB) {
    const add: [number, number][] = [];
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        if (this.opaque(x, y)) continue;
        if (this.opaque(x - 1, y) || this.opaque(x + 1, y) || this.opaque(x, y - 1) || this.opaque(x, y + 1)) add.push([x, y]);
      }
    for (const [x, y] of add) this.set(x, y, c);
  }
  canvas(): HTMLCanvasElement {
    const cv = makeCanvas(this.w, this.h);
    const g = ctx2d(cv);
    const img = g.createImageData(this.w, this.h);
    img.data.set(this.d);
    g.putImageData(img, 0, 0);
    return cv;
  }
}

export const TORCHES: [number, number][] = [
  [28, 52],
  [120, 52],
  [240, 52],
  [332, 52],
];
const FLAGS = [14, 98, 262, 346];
const BOX = { x0: 150, x1: 210 };

/** the top edge of the floor at column x (where the wall meets the sand) */
const floorTop = (x: number) => {
  const dx = (x - FLOOR.cx) / FLOOR.rx;
  return Math.abs(dx) >= 1 ? AH : FLOOR.cy - FLOOR.ry * Math.sqrt(1 - dx * dx);
};

/* ---------------- the pit ---------------- */
export function paintArena(): HTMLCanvasElement {
  const p = new Px(AW, AH);
  const R = rng(20261014);
  // night sky with stars
  for (let y = 0; y < AH; y++) for (let x = 0; x < AW; x++) p.set(x, y, mix(hex('#0e0a1c'), hex('#22163a'), Math.min(1, y / 30)));
  for (let i = 0; i < 40; i++) p.set(R() * AW, R() * 7, R() < 0.3 ? hex('#fff6c8') : hex('#8e86c0'));

  // the stands: four stepped rows of brick, darker at the back
  for (let r = 0; r < 4; r++) {
    const y0 = 6 + r * 10;
    const k = 0.72 + r * 0.09;
    for (let x = 0; x < AW; x++) {
      // seat
      p.set(x, y0, mul(hex('#a898b0'), k));
      p.set(x, y0 + 1, mul(hex('#857590'), k));
      for (let j = 2; j < 10; j++) {
        const y = y0 + j;
        const row = Math.floor((j - 2) / 4);
        const off = (row + r) % 2 ? 5 : 0;
        const mortar = (j - 2) % 4 === 3 || (x + off) % 10 === 0;
        const v = 0.92 + hash2(Math.floor((x + off) / 10), r * 4 + row, 3) * 0.16;
        p.set(x, y, mortar ? mul(hex('#2e2438'), k) : mul(hex(j % 4 === 2 ? '#665670' : '#584a62'), k * v));
      }
      p.set(x, y0 + 9, mul(hex('#241c2c'), k));
    }
  }
  // the royal box: a striped canopy on gold posts, a red velvet back, an empty throne
  for (let y = 2; y < 31; y++) for (let x = BOX.x0; x < BOX.x1; x++) p.set(x, y, mix(hex('#4a1020'), hex('#7a1c30'), vnoise(x, y, 3, 9) * 0.6));
  for (let x = BOX.x0 - 2; x < BOX.x1 + 2; x++) {
    for (let y = 0; y < 8; y++) p.set(x, y, Math.floor((x - BOX.x0) / 4) % 2 ? hex('#d8483a') : hex('#ffd24a'));
    const sc = 8 + (((x - BOX.x0) % 6) < 3 ? 1 : 0) + (((x - BOX.x0) % 6) === 1 ? 1 : 0);
    for (let y = 8; y < sc; y++) p.set(x, y, Math.floor((x - BOX.x0) / 4) % 2 ? hex('#a8322a') : hex('#c9861a'));
    p.set(x, 0, hex('#fff1a8'));
  }
  for (const px of [BOX.x0 - 2, BOX.x1]) {
    p.rect(px, 8, 2, 23, hex('#c9861a'));
    p.rect(px, 8, 1, 23, hex('#ffd24a'));
  }
  // throne
  p.rect(174, 13, 12, 3, hex('#c9861a'));
  p.rect(175, 12, 10, 1, hex('#ffd24a'));
  p.rect(176, 16, 8, 8, hex('#8a1426'));
  p.rect(173, 22, 14, 3, hex('#c9861a'));
  p.rect(173, 22, 14, 1, hex('#ffd24a'));
  p.rect(174, 25, 2, 5, hex('#8a5a12'));
  p.rect(184, 25, 2, 5, hex('#8a5a12'));
  p.set(180, 11, hex('#ff4f5e'));
  p.rect(178, 9, 5, 2, hex('#ffd24a'));
  // the rail along the front of the stands
  for (let x = 0; x < AW; x++) {
    p.set(x, 45, hex('#c9861a'));
    p.set(x, 46, hex('#6a4a1a'));
    if (x % 12 === 0) p.rect(x, 40, 1, 5, hex('#8a6a2a'));
  }

  // the wall round the pit: big stone blocks, mossy at the joints
  for (let y = 47; y < AH; y++) {
    for (let x = 0; x < AW; x++) {
      const row = Math.floor((y - 47) / 7);
      const off = row % 2 ? 7 : 0;
      const bx = Math.floor((x + off) / 14);
      const inY = (y - 47) % 7;
      const inX = (x + off) % 14;
      const mortar = inY === 6 || inX === 0;
      const v = 0.86 + hash2(bx, row, 5) * 0.22;
      let c: RGB = mortar ? hex('#231a2c') : mul(hex(inY === 0 ? '#6a5c78' : inX === 1 ? '#5e5070' : '#4e4260'), v);
      if (!mortar && hash2(x, y, 6) < 0.05) c = mul(c, 0.82);
      if (mortar && hash2(x, y, 7) < 0.18) c = hex('#3a5232');
      p.set(x, y, c);
    }
  }
  // coping along the top of the wall
  for (let x = 0; x < AW; x++) {
    p.set(x, 47, hex('#9a8eaa'));
    p.set(x, 48, hex('#7a6e8a'));
    p.set(x, 49, hex('#1a1220'));
  }

  // hanging banners with crossed pickaxes
  const bannerX = [52, 84, 150, 204, 270, 302];
  bannerX.forEach((bx, i) => {
    const len = Math.max(8, Math.min(22, Math.floor(floorTop(bx + 5) - 52)));
    const base = i % 2 ? hex('#2f4fb0') : hex('#b0302a');
    const dark = mul(base, 0.68);
    p.rect(bx - 1, 49, 12, 2, hex('#8a6a2a'));
    for (let y = 0; y < len; y++)
      for (let x = 0; x < 10; x++) {
        const tip = y > len - 5 && Math.abs(x - 4.5) < y - (len - 5);
        if (tip) continue;
        const edge = x === 0 || x === 9;
        p.set(bx + x, 51 + y, edge ? hex('#ffd24a') : x < 3 ? dark : base);
      }
    // emblem
    const ey = 51 + Math.min(4, Math.floor(len / 3));
    for (let k = 0; k < 5; k++) {
      p.set(bx + 2 + k, ey + k, hex('#ffd24a'));
      p.set(bx + 7 - k, ey + k, hex('#ffd24a'));
    }
    p.rect(bx + 1, ey, 3, 1, hex('#e8e8f0'));
    p.rect(bx + 6, ey, 3, 1, hex('#e8e8f0'));
  });
  // iron brackets for the torches
  for (const [tx, ty] of TORCHES) {
    p.rect(tx - 3, ty - 1, 7, 2, hex('#3a3440'));
    p.rect(tx - 2, ty + 1, 5, 1, hex('#2a2430'));
    p.rect(tx, ty + 2, 1, 7, hex('#3a3440'));
    p.rect(tx - 2, ty + 8, 5, 2, hex('#4a4450'));
    p.set(tx - 3, ty - 1, hex('#6a6470'));
  }

  // the floor
  const sandA = hex('#e0bc84');
  const sandB = hex('#c89c64');
  const stoneC = [hex('#9a8670'), hex('#8a7662'), hex('#a8937a'), hex('#94806a')];
  for (let y = 48; y < AH; y++) {
    for (let x = 0; x < AW; x++) {
      const dx = (x + 0.5 - FLOOR.cx) / FLOOR.rx;
      const dy = (y + 0.5 - FLOOR.cy) / FLOOR.ry;
      const d = dx * dx + dy * dy;
      if (d > 1.075) {
        // the front parapet's coping, just below the floor
        if (dy > 0 && d < 1.16) p.set(x, y, d < 1.1 ? hex('#8f839c') : hex('#6a5e78'));
        continue;
      }
      if (d > 1) {
        p.set(x, y, hex('#2a1e18'));
        continue;
      }
      if (d > 0.9) {
        // cobbled rim: a tiny voronoi of stones
        const cs = 5;
        const gx = Math.floor(x / cs);
        const gy = Math.floor(y / cs);
        let f1 = 99;
        let f2 = 99;
        let best: [number, number, number, number] = [0, 0, 0, 0];
        for (let j = -1; j <= 1; j++)
          for (let i = -1; i <= 1; i++) {
            const px = (gx + i + 0.2 + hash2(gx + i, gy + j, 11) * 0.6) * cs;
            const py = (gy + j + 0.2 + hash2(gx + i, gy + j, 12) * 0.6) * cs;
            const dd = Math.hypot(x - px, y - py);
            if (dd < f1) {
              f2 = f1;
              f1 = dd;
              best = [gx + i, gy + j, px, py];
            } else if (dd < f2) f2 = dd;
          }
        if (f2 - f1 < 1.1) p.set(x, y, hex('#4a3a2c'));
        else {
          let c = stoneC[Math.floor(hash2(best[0], best[1], 13) * 4)];
          if (y - best[3] < -1.2) c = mix(c, hex('#d8c8b0'), 0.35);
          else if (y - best[3] > 1.5) c = mul(c, 0.8);
          p.set(x, y, c);
        }
        continue;
      }
      // sand: soft patches, fine grain, raked rings, darker at the edge and in the wall's shadow
      const n = vnoise(x, y, 16, 1) * 0.65 + vnoise(x, y, 5, 2) * 0.35;
      let c = mix(sandB, sandA, n);
      const g = hash2(x, y, 3);
      if (g < 0.05) c = mul(c, 0.88);
      else if (g > 0.975) c = mix(c, hex('#fff0cc'), 0.5);
      const rake = (Math.sqrt(d) * 15) % 1;
      if (rake < 0.09 && d < 0.8) c = mul(c, 0.93);
      if (d > 0.72) c = mul(c, 1 - (d - 0.72) * 0.5);
      const fromTop = y - floorTop(x);
      if (fromTop < 12) c = mul(c, 1 - (1 - fromTop / 12) * 0.38);
      // the ring: a stone band with gold studs, lighter sand inside
      const rd = Math.hypot((x + 0.5 - RING.x) / RING.r, (y + 0.5 - RING.y) / (RING.r / 1.6));
      if (rd < 1.04 && rd > 0.86) {
        const ang = Math.atan2((y - RING.y) * 1.6, x - RING.x);
        const seg = ((ang / (Math.PI * 2)) * 24 + 24) % 1;
        c = seg < 0.08 ? hex('#4a3a2c') : rd < 0.9 ? hex('#6e5e4e') : hex('#9a8a76');
        if (seg > 0.46 && seg < 0.56 && rd > 0.92 && rd < 0.99) c = hex('#ffd24a');
      } else if (rd <= 0.86) c = mix(c, hex('#f0d29c'), 0.35);
      p.set(x, y, c);
    }
  }
  // the ring's emblem: crossed pickaxes in darker sand
  const em = hex('#b88a54');
  const emD = hex('#9a7040');
  for (let k = -6; k <= 6; k++) {
    p.set(RING.x + k, RING.y + Math.round(k * 0.55), em);
    p.set(RING.x - k, RING.y + Math.round(k * 0.55), em);
  }
  p.rect(RING.x - 9, RING.y - 5, 5, 2, emD);
  p.rect(RING.x + 5, RING.y - 5, 5, 2, emD);

  // scatter: pebbles, cracks, scorch marks, bones, dry grass at the rim
  const onSand = (x: number, y: number, lim = 0.86) => {
    const dx = (x - FLOOR.cx) / FLOOR.rx;
    const dy = (y - FLOOR.cy) / FLOOR.ry;
    const d = dx * dx + dy * dy;
    const rd = Math.hypot((x - RING.x) / RING.r, (y - RING.y) / (RING.r / 1.6));
    return d < lim && rd > 1.15;
  };
  for (let i = 0; i < 9; i++) {
    const cx = FLOOR.cx + (R() - 0.5) * FLOOR.rx * 1.6;
    const cy = FLOOR.cy + (R() - 0.5) * FLOOR.ry * 1.5;
    if (!onSand(cx, cy, 0.7)) continue;
    const r = 5 + R() * 5;
    for (let y = -r; y <= r; y++)
      for (let x = -r * 1.5; x <= r * 1.5; x++) {
        const q = Math.hypot(x / 1.5, y) / r;
        if (q < 1 && hash2(cx + x, cy + y, 21) > q * 0.9) {
          const c = p.get(Math.round(cx + x), Math.round(cy + y));
          if (c) p.set(cx + x, cy + y, mul(c, 0.82 + q * 0.12));
        }
      }
  }
  for (let i = 0; i < 7; i++) {
    let x = FLOOR.cx + (R() - 0.5) * FLOOR.rx * 1.5;
    let y = FLOOR.cy + (R() - 0.5) * FLOOR.ry * 1.4;
    for (let k = 0, n = 8 + R() * 10; k < n; k++) {
      if (!onSand(x, y)) break;
      const c = p.get(Math.round(x), Math.round(y));
      if (c) p.set(x, y, mul(c, 0.68));
      x += R() < 0.5 ? 1 : -1;
      y += R() < 0.3 ? 1 : 0;
    }
  }
  for (let i = 0; i < 46; i++) {
    const x = FLOOR.cx + (R() - 0.5) * FLOOR.rx * 1.9;
    const y = FLOOR.cy + (R() - 0.5) * FLOOR.ry * 1.9;
    if (!onSand(x, y, 0.88)) continue;
    const big = R() < 0.35;
    p.set(x, y, hex('#8a7a6a'));
    if (big) {
      p.set(x + 1, y, hex('#7a6a5a'));
      p.set(x, y - 1, hex('#b8a894'));
    }
    p.set(x, y + 1, hex('#9a744a'));
  }
  for (let i = 0; i < 4; i++) {
    const x = Math.round(FLOOR.cx + (R() - 0.5) * FLOOR.rx * 1.4);
    const y = Math.round(FLOOR.cy + (R() - 0.5) * FLOOR.ry * 1.2);
    if (!onSand(x, y, 0.75)) continue;
    const bone = hex('#efe6d2');
    p.rect(x - 2, y, 5, 1, bone);
    p.set(x - 3, y - 1, bone);
    p.set(x - 3, y + 1, bone);
    p.set(x + 3, y - 1, bone);
    p.set(x + 3, y + 1, bone);
    p.rect(x - 2, y + 1, 5, 1, hex('#a89880'));
  }
  for (let i = 0; i < 60; i++) {
    const a = R() * Math.PI * 2;
    const rr = 0.84 + R() * 0.05;
    const x = FLOOR.cx + Math.cos(a) * FLOOR.rx * rr;
    const y = FLOOR.cy + Math.sin(a) * FLOOR.ry * rr;
    const h = 1 + Math.floor(R() * 3);
    for (let k = 0; k < h; k++) {
      p.set(x, y - k, k ? hex('#b8b048') : hex('#7a7a30'));
      if (k === h - 1 && R() < 0.5) p.set(x + 1, y - k, hex('#d8c860'));
    }
  }
  return p.canvas();
}

/* ---------------- pillars ---------------- */
let pillarCv: HTMLCanvasElement | null = null;
/** A fluted stone pillar with a brazier on top; 26 x 46, feet at (13, 44). */
function pillarSprite(): HTMLCanvasElement {
  if (pillarCv) return pillarCv;
  const p = new Px(26, 46);
  const W = PILLAR_R * 2;
  const x0 = 13 - PILLAR_R;
  // plinth
  p.rect(x0 - 2, 39, W + 4, 5, hex('#6a5e74'));
  p.rect(x0 - 2, 39, W + 4, 1, hex('#a89cb4'));
  p.rect(x0 - 1, 37, W + 2, 2, hex('#8a7e96'));
  // shaft with fluting, lit from the left
  for (let y = 10; y < 37; y++)
    for (let x = 0; x < W; x++) {
      const k = x / W;
      let c = mix(hex('#b0a4bc'), hex('#4e4460'), k);
      if (x % 4 === 1) c = mul(c, 0.78);
      if (x % 4 === 2) c = mix(c, hex('#ffffff'), 0.08);
      p.set(x0 + x, y, c);
    }
  // a crack and some ivy
  const crack: [number, number][] = [
    [x0 + 12, 14], [x0 + 11, 15], [x0 + 11, 16], [x0 + 12, 17], [x0 + 13, 18], [x0 + 12, 19],
  ];
  for (const [x, y] of crack) p.set(x, y, hex('#2e2638'));
  for (let y = 22; y < 38; y++) {
    const x = x0 + 2 + Math.round(Math.sin(y / 2.2) * 1.5);
    p.set(x, y, hex('#3e7a34'));
    if (y % 3 === 0) {
      p.set(x + 1, y, hex('#5aa04a'));
      p.set(x - 1, y - 1, hex('#5aa04a'));
    }
  }
  // capital
  p.rect(x0 - 2, 6, W + 4, 4, hex('#8a7e96'));
  p.rect(x0 - 2, 6, W + 4, 1, hex('#c4b8d0'));
  p.rect(x0 - 1, 10, W + 2, 1, hex('#5a5068'));
  // brazier bowl
  p.rect(x0 + 2, 2, W - 4, 4, hex('#3a3440'));
  p.rect(x0 + 1, 1, W - 2, 1, hex('#6a6470'));
  p.rect(x0 + 4, 2, W - 8, 1, hex('#ff8a3d'));
  p.outline(hex('#140e18'));
  pillarCv = p.canvas();
  return pillarCv;
}
export function drawPillar(c: Ctx, X: number, Y: number, z: number) {
  const cv = pillarSprite();
  c.fillStyle = 'rgba(0,0,0,0.32)';
  c.beginPath();
  c.ellipse(X + 3 * z, Y, 14 * z, 4 * z, 0, 0, Math.PI * 2);
  c.fill();
  c.drawImage(cv, Math.round(X - 13 * z), Math.round(Y - 44 * z), 26 * z, 46 * z);
}

/* ---------------- flames, flags, light ---------------- */
/** a flickering flame whose base sits at (X, Y) on screen */
export function drawFlame(c: Ctx, X: number, Y: number, z: number, wall: number, seed: number, big = 1) {
  const f = Math.floor(wall / 90 + seed) % 4;
  const h = (5 + [0, 1, 2, 1][f]) * big;
  const sway = [0, 1, 0, -1][(f + seed) % 4];
  const col = ['#c8321a', '#ff6a2a', '#ffb43d', '#fff1a8'];
  for (let i = 0; i < 4; i++) {
    const w = (5 - i) * big * 0.9;
    const hh = h * (1 - i * 0.2);
    c.fillStyle = col[i];
    c.fillRect(Math.round(X + (sway * i * 0.4 - w / 2) * z), Math.round(Y - hh * z), Math.max(1, Math.round(w * z)), Math.round(hh * z));
  }
}
/** warm light pools from the fires, added on top */
export function drawGlow(c: Ctx, pts: [number, number, number][], z: number, wall: number) {
  c.save();
  c.globalCompositeOperation = 'lighter';
  pts.forEach(([X, Y, r], i) => {
    const fl = 0.85 + 0.15 * Math.sin(wall / 120 + i * 1.7) + 0.05 * Math.sin(wall / 47 + i);
    const g = c.createRadialGradient(X, Y, 0, X, Y, r * z * fl);
    g.addColorStop(0, 'rgba(255,170,80,0.22)');
    g.addColorStop(0.5, 'rgba(255,120,40,0.08)');
    g.addColorStop(1, 'rgba(255,100,30,0)');
    c.fillStyle = g;
    c.fillRect(X - r * z, Y - r * z, r * 2 * z, r * 2 * z);
  });
  c.restore();
}
export function drawVignette(c: Ctx, W: number, H: number) {
  const g = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
  g.addColorStop(0, 'rgba(8,4,16,0)');
  g.addColorStop(1, 'rgba(8,4,16,0.55)');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
}
export function drawFlags(c: Ctx, sx: (x: number) => number, sy: (y: number) => number, z: number, wall: number) {
  FLAGS.forEach((fx, i) => {
    c.fillStyle = '#6a4a1a';
    c.fillRect(sx(fx), sy(-6), Math.max(1, z), 12 * z);
    c.fillStyle = '#ffd24a';
    c.fillRect(sx(fx) - z, sy(-7), 3 * z, z);
    const col = i % 2 ? '#2f5fd0' : '#d8483a';
    for (let k = 0; k < 9; k++) {
      const wv = Math.round(Math.sin(wall / 160 - k * 0.7 + i) * 1.2);
      c.fillStyle = k === 8 ? '#ffd24a' : col;
      c.fillRect(sx(fx + 1 + k), sy(-5 + wv), z, 5 * z);
    }
  });
}

/* ---------------- the crowd ---------------- */
export interface Fan {
  x: number;
  y: number;
  skin: string;
  hair: string;
  shirt: string;
  ph: number;
  flag: boolean;
}
export function makeCrowd(): Fan[] {
  const R = rng(77);
  const skins = ['#f2c99a', '#d8a070', '#a86a40', '#7a4a2a', '#ffd8b8'];
  const hairs = ['#2a1a10', '#6a3a1a', '#d8b040', '#1a1a2a', '#c0c0c8', '#a83a1a'];
  const shirts = ['#d04a3a', '#2f5fd0', '#3aa05a', '#9a4ad0', '#e08a1e', '#2aa0b0', '#c0c040', '#d06aa0', '#f2f5ff', '#3a3a4a'];
  const out: Fan[] = [];
  for (let r = 0; r < 4; r++)
    for (let x = 4; x < AW - 4; x += 6 + Math.floor(R() * 4)) {
      const y = 15 + r * 10;
      if (x > BOX.x0 - 4 && x < BOX.x1 + 3 && y < 34) continue;
      if (R() < 0.12) continue;
      out.push({ x, y, skin: skins[Math.floor(R() * skins.length)], hair: hairs[Math.floor(R() * hairs.length)], shirt: shirts[Math.floor(R() * shirts.length)], ph: Math.floor(R() * 100), flag: R() < 0.08 });
    }
  return out;
}
/** one fan: 5 wide, 8 tall, feet at y. `hop` lifts them; `arms` raises their arms. */
export function drawFan(c: Ctx, f: Fan, sx: (x: number) => number, sy: (y: number) => number, z: number, hop: number, arms: boolean) {
  const P = (x: number, y: number, w: number, h: number, col: string) => {
    c.fillStyle = col;
    c.fillRect(sx(f.x + x), sy(f.y + y - hop), w * z, h * z);
  };
  P(-2, -4, 5, 4, f.shirt);
  P(-2, -4, 1, 4, 'rgba(0,0,0,0.25)');
  P(-1, -7, 3, 3, f.skin);
  P(-1, -8, 3, 1, f.hair);
  P(-1, -7, 1, 1, f.hair);
  if (arms) {
    P(-3, -8, 1, 4, f.skin);
    P(3, -8, 1, 4, f.skin);
  } else {
    P(-3, -4, 1, 3, f.skin);
    P(3, -4, 1, 3, f.skin);
  }
  if (f.flag) {
    P(3, -12, 1, 8, '#8a6a2a');
    P(4, -12, 4, 3, f.ph % 2 ? '#ffd24a' : '#d8483a');
  }
}

/* ---------------- the Mole King ---------------- */
const bossCache = new Map<string, HTMLCanvasElement>();
export const BOSS_W = 52;
export const BOSS_H = 50;
/**
 * The boss, facing right: a huge armoured mole with a crown, glowing eyes, buck teeth and big claws.
 * `up` raises its claws for a slam; `flash` is the white of a hit.
 */
export function bossSprite(up: boolean, flash: boolean): HTMLCanvasElement {
  const key = `${up ? 1 : 0}${flash ? 1 : 0}`;
  const hit = bossCache.get(key);
  if (hit) return hit;
  const p = new Px(BOSS_W, BOSS_H);
  const fur = (dark: number) => (nx: number, ny: number, x: number, y: number): RGB => {
    const l = -nx * 0.55 - ny * 0.8 + (hash2(x, y, 31) - 0.5) * 0.25;
    const c = l > 0.45 ? hex('#9a7058') : l > -0.15 ? hex('#6e4c3a') : l > -0.6 ? hex('#523629') : hex('#3c271e');
    return mul(c, dark);
  };
  const skin = (nx: number, ny: number): RGB => (-nx * 0.5 - ny * 0.8 > 0.3 ? hex('#ffb8c4') : -ny > -0.4 ? hex('#e8909e') : hex('#b8606e'));
  const metal = (nx: number, ny: number, x: number, y: number): RGB => {
    const l = -nx * 0.6 - ny * 0.7;
    if ((x + y) % 5 === 0 && l > -0.2) return hex('#e8eef8');
    return l > 0.35 ? hex('#c8d0dc') : l > -0.25 ? hex('#8a92a2') : hex('#545a6a');
  };
  const claw = (x0: number, y0: number, dx: number, dy: number) => {
    // three thick claws, side by side, pointing (dx, dy)
    const sx = -dy;
    const sy = dx;
    for (let k = -1; k <= 1; k++) {
      const ox = x0 + sx * k * 2.2;
      const oy = y0 + sy * k * 2.2;
      p.line(ox, oy, ox + dx * 4, oy + dy * 4, hex('#f4eedc'), 2);
      p.set(ox + dx * 5, oy + dy * 5, hex('#a8a090'));
    }
  };
  const hand = (cx: number, cy: number) => p.ell(cx, cy, 5, 4.5, skin);
  // the far arm (behind)
  if (up) {
    p.line(14, 28, 9, 12, hex('#3c271e'), 6);
    hand(8, 10);
    claw(7, 5, -0.5, -1);
  } else {
    p.ell(9, 34, 5, 7, fur(0.75));
    hand(8, 41);
    claw(6, 45, -0.4, 1);
  }
  // feet
  p.ell(16, 47, 7, 2.6, () => hex('#3a261e'));
  p.ell(31, 47, 7, 2.6, () => hex('#3a261e'));
  for (const fx of [20, 35]) for (let k = 0; k < 3; k++) p.rect(fx + k * 2, 47, 1, 2, hex('#f4eedc'));
  // body
  p.ell(23, 33, 16, 14, fur(1));
  // belly, with a scar of lighter fur
  p.ell(24, 38, 10, 8, (nx, ny, x, y) => (ny < -0.6 ? hex('#c49a78') : hash2(x, y, 41) < 0.12 ? hex('#9a7050') : hex('#b08866')));
  p.line(19, 34, 26, 41, hex('#d8b494'));
  // a metal pauldron with rivets, and a belt with a gold buckle
  p.ell(13, 24, 7, 5, metal);
  p.set(10, 23, hex('#2a2a34'));
  p.set(14, 22, hex('#2a2a34'));
  p.set(17, 25, hex('#2a2a34'));
  for (let x = 9; x < 38; x++) {
    const y = 43 + Math.round((x - 23) * (x - 23) * 0.006);
    p.set(x, y, hex('#3a2418'));
    p.set(x, y + 1, hex('#5a3a24'));
  }
  p.rect(21, 42, 5, 4, hex('#ffd24a'));
  p.rect(22, 43, 3, 2, hex('#c9861a'));
  // the head, a little lighter, forward and up
  p.ell(32, 19, 11, 10, fur(1.08));
  // a torn ear
  p.ell(24, 13, 3, 3, (nx, ny) => (ny < 0 ? hex('#6e4c3a') : hex('#b8606e')));
  p.set(23, 11, hex('#140a0e'));
  // snout and nose
  p.ell(42, 22, 8, 5, skin);
  p.set(45, 24, hex('#8a3a4a'));
  p.set(42, 25, hex('#8a3a4a'));
  p.ell(48, 21, 3.2, 3, (nx, ny) => (nx < -0.2 && ny < -0.2 ? hex('#ffd0dc') : hex('#ff6f8a')));
  p.set(47, 20, hex('#ffffff'));
  // whiskers
  p.line(45, 23, 51, 22, hex('#2a1a14'));
  p.line(45, 25, 51, 26, hex('#2a1a14'));
  // buck teeth
  p.rect(39, 26, 2, 4, hex('#f8f4e8'));
  p.rect(41, 26, 2, 4, hex('#e8e0cc'));
  p.set(40, 29, hex('#c8c0b0'));
  // an angry glowing eye under a heavy brow
  p.rect(33, 14, 5, 4, hex('#1a0606'));
  p.rect(34, 15, 3, 2, hex('#ff2a2a'));
  p.set(35, 15, hex('#fff0a0'));
  p.line(31, 11, 39, 14, hex('#2a1a14'), 2);
  // a scar over the eye
  p.line(36, 10, 34, 19, hex('#c89a7a'));
  // the crown
  p.rect(25, 7, 15, 4, hex('#ffd24a'));
  p.rect(25, 10, 15, 1, hex('#c9861a'));
  for (const [cx, h] of [[25, 5], [31, 7], [38, 5]] as [number, number][]) {
    for (let k = 0; k < h; k++) {
      const w = Math.max(1, 3 - Math.floor(k / 2));
      p.rect(cx + 1 - Math.floor(w / 2), 7 - k, w, 1, k === h - 1 ? hex('#fff1a8') : hex('#ffd24a'));
    }
  }
  p.rect(31, 8, 2, 2, hex('#d8283a'));
  p.set(31, 8, hex('#ff8a9a'));
  p.set(27, 8, hex('#3ad0ff'));
  p.set(37, 8, hex('#3ad0ff'));
  p.rect(25, 7, 15, 1, hex('#fff1a8'));
  // the near arm (in front)
  if (up) {
    p.line(33, 32, 43, 12, hex('#5a3c2e'), 6);
    p.line(32, 31, 41, 13, hex('#8a6450'), 2);
    hand(44, 10);
    claw(45, 5, 0.5, -1);
  } else {
    p.ell(35, 37, 5.5, 7, fur(0.95));
    hand(39, 43);
    claw(41, 46, 0.6, 1);
  }
  p.outline(hex('#140a0e'));
  if (flash) {
    for (let i = 0; i < p.d.length; i += 4) {
      if (!p.d[i + 3]) continue;
      p.d[i] += (255 - p.d[i]) * 0.65;
      p.d[i + 1] += (255 - p.d[i + 1]) * 0.65;
      p.d[i + 2] += (255 - p.d[i + 2]) * 0.65;
    }
  }
  const cv = p.canvas();
  bossCache.set(key, cv);
  return cv;
}
/** the eye's place in the sprite, for its glow */
export const BOSS_EYE: [number, number] = [35, 16];
