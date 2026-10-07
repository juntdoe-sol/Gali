/**
 * The film's drawing kit: the stage, the palette, easing, and the motion-graphics helpers every scene shares.
 */
import { sprite } from '../../app/src/engine/art';
export const q = new URLSearchParams(location.search);
export const W = Number(q.get('w') ?? 1080);
export const H = Number(q.get('h') ?? 1920);
export const PORTRAIT = H > W;
export const U = Math.min(W, H) / 1080; // layout unit
export const FPS = 30;

/* ---------------- the timeline, in beats ---------------- */
export const BEAT = 0.54;
export const b = (n: number) => n * BEAT;

export const NAVY = '#070d20';
export const GOLD = '#ffcf4a';
export const GOLD2 = '#e08a1e';
export const TEAL = '#3ee6ff';
export const SOLG = '#14f195';
export const SKR = '#c7f284';
export const WHITE = '#f2f5ff';
export const MUTED = '#8ea2cc';
export const DISPLAY = 'Jersey15';
export const BODY = 'ChakraBold';

/* ---------------- easing ---------------- */
export const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
export const prog = (t: number, a: number, c: number) => clamp01((t - a) / (c - a));
export const outCubic = (x: number) => 1 - Math.pow(1 - x, 3);
export const inCubic = (x: number) => x * x * x;
export const inOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const outExpo = (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
export const inExpo = (x: number) => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10));
export const outBack = (x: number, s = 1.9) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2);
export const outElastic = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1);
export const lerp = (a: number, c: number, k: number) => a + (c - a) * k;
export const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/* ---------------- stage ---------------- */
/* ---------------- stage ---------------- */
export const out = document.createElement('canvas');
out.width = W;
out.height = H;
out.id = 'out';
document.body.appendChild(out);
export const g = out.getContext('2d')!;

/** Sounds the engines ask for, with their times, so the score can put a clink under every swing. */
export const events: { t: number; name: string }[] = [];

/** Camera shake, set by a scene and decayed by the frame loop; and the last frame time, for one-shot cues. */
export const fx = { shake: 0 };
export const st = { last: -1 };
export const crossed = (t: number, at: number) => st.last < at && t >= at;

/* ---------------- drawing helpers ---------------- */
export function font(size: number, fam = DISPLAY) {
  g.font = `${Math.round(size)}px ${fam}`;
}
export function textW(s: string, size: number, fam = DISPLAY) {
  font(size, fam);
  return g.measureText(s).width;
}
/** Text that arrives a letter at a time, each dropping in with overshoot, and leaves by lifting away. */
export function kinetic(s: string, cx: number, y: number, size: number, t: number, t0: number, opts: { fam?: string; color?: string; stagger?: number; dur?: number; out?: number; shadow?: string; spacing?: number } = {}) {
  const fam = opts.fam ?? DISPLAY;
  const stagger = opts.stagger ?? 0.035;
  const dur = opts.dur ?? 0.45;
  const spacing = (opts.spacing ?? 0) * size;
  font(size, fam);
  const widths = [...s].map((ch) => g.measureText(ch).width + spacing);
  const total = widths.reduce((a, c) => a + c, 0) - spacing;
  let x = cx - total / 2;
  [...s].forEach((ch, i) => {
    const p = prog(t, t0 + i * stagger, t0 + i * stagger + dur);
    // leave in the same order, a touch quicker
    const q2 = opts.out !== undefined ? prog(t, opts.out + i * stagger * 0.5, opts.out + i * stagger * 0.5 + 0.28) : 0;
    if (p <= 0 || q2 >= 1) {
      x += widths[i];
      return;
    }
    const e = outBack(p);
    g.save();
    g.globalAlpha = clamp01(p * 3) * (1 - q2);
    g.translate(x + widths[i] / 2, y + (1 - e) * size * 0.7 - inCubic(q2) * size * 0.6);
    const sc = (0.6 + 0.4 * e) * (1 - q2 * 0.3);
    g.scale(sc, sc);
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    if (opts.shadow) {
      g.fillStyle = opts.shadow;
      g.fillText(ch, size * 0.06, size * 0.06);
    }
    g.fillStyle = opts.color ?? WHITE;
    g.fillText(ch, 0, 0);
    g.restore();
    x += widths[i];
  });
}
export function rr(x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
/** A navy panel with the game's gold trim. */
export function panel(x: number, y: number, w: number, h: number, a = 1, glow = GOLD) {
  g.save();
  g.globalAlpha = a;
  g.shadowColor = glow + '88';
  g.shadowBlur = 30 * U;
  rr(x, y, w, h, 18 * U);
  const gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, '#15285aee');
  gr.addColorStop(1, '#070d20ee');
  g.fillStyle = gr;
  g.fill();
  g.shadowBlur = 0;
  g.lineWidth = 3 * U;
  g.strokeStyle = '#c9a24e';
  g.stroke();
  g.restore();
}
export function goldFill(y: number, h: number) {
  const gg = g.createLinearGradient(0, y, 0, y + h);
  gg.addColorStop(0, '#fff2b8');
  gg.addColorStop(0.5, GOLD);
  gg.addColorStop(1, GOLD2);
  return gg;
}

/**
 * "01  PICK YOUR SPOTS": a numbered card. The gold number tile lands first, then
 * the title panel unrolls out of it; on the way out it snaps shut and flies left.
 */
export function stepCard(n: string, title: string, sub: string, t: number, t0: number, t1: number, at?: number) {
  if (t < t0 || t > t1 + 0.45) return;
  const tile = outBack(prog(t, t0, t0 + 0.32), 2.2);
  const unroll = outExpo(prog(t, t0 + 0.12, t0 + 0.6));
  const shut = inCubic(prog(t, t1, t1 + 0.2));
  const fly = inExpo(prog(t, t1 + 0.15, t1 + 0.45));
  const size = (PORTRAIT ? 92 : 72) * U;
  const numW = textW(n, size * 1.1) + 48 * U;
  const titleW = textW(title, size);
  const subSize = size * 0.34;
  const w = numW + titleW + 64 * U;
  const h = size * 1.35;
  const cx = at ?? W / 2;
  const y = PORTRAIT ? 250 * U : at !== undefined ? 150 * U : 44 * U;
  const x = cx - w / 2 - fly * W * 0.9;
  const open = unroll * (1 - shut);
  g.save();
  g.globalAlpha = 1 - fly * 0.6;
  // the panel behind the title unrolls from the tile
  if (open > 0.01) {
    g.save();
    g.beginPath();
    g.rect(x - 40 * U, y - 60 * U, numW + (w - numW + 40 * U) * open + 40 * U, h + 140 * U);
    g.clip();
    panel(x, y, w, h);
    font(size);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = WHITE;
    g.fillText(title, x + numW + 28 * U - (1 - open) * 60 * U, y + h / 2 + 4 * U);
    g.restore();
  }
  // the number tile, which pops in and takes a little bounce
  const s = tile;
  g.save();
  g.translate(x + numW / 2, y + h / 2);
  g.scale(s, s);
  g.rotate((1 - tile) * -0.4);
  rr(-numW / 2 + 12 * U, -h / 2 + 12 * U, numW - 24 * U, h - 24 * U, 12 * U);
  g.shadowColor = '#00000088';
  g.shadowBlur = 20 * U;
  g.fillStyle = goldFill(-h / 2, h);
  g.fill();
  g.shadowBlur = 0;
  font(size * 1.1);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#3a1800';
  g.fillText(n, 0, 4 * U);
  g.restore();
  g.restore();
  if (sub) {
    g.save();
    g.globalAlpha = prog(t, t0 + 0.4, t0 + 0.75) * (1 - prog(t, t1 - 0.1, t1 + 0.1));
    font(subSize, BODY);
    g.textAlign = 'center';
    g.fillStyle = MUTED;
    g.fillText(sub, cx, y + h + subSize * 1.6 + (1 - prog(t, t0 + 0.4, t0 + 0.75)) * 12 * U);
    g.restore();
  }
}

/* ---------------- overlay particles and effects ---------------- */
export interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  age: number;
  c: string;
  s: number;
  g: number;
}
export let sparks: Spark[] = [];
export function burst(x: number, y: number, n: number, speed: number, colors: string[], size = 6, grav = 900, life = 1) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = speed * (0.3 + Math.random() * 0.7) * U;
    sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.3 * U, life: life * (0.6 + Math.random() * 0.6), age: 0, c: colors[i % colors.length], s: size * U * (0.6 + Math.random() * 0.8), g: grav * U });
  }
}
export function stepSparks(dt: number) {
  for (const s of sparks) {
    s.age += dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.vy += s.g * dt;
    s.vx *= 0.985;
  }
  sparks = sparks.filter((s) => s.age < s.life);
  for (const s of sparks) {
    g.globalAlpha = 1 - Math.pow(s.age / s.life, 3);
    g.fillStyle = s.c;
    g.fillRect(Math.round(s.x - s.s / 2), Math.round(s.y - s.s / 2), Math.ceil(s.s), Math.ceil(s.s));
  }
  g.globalAlpha = 1;
}
export function ring(x: number, y: number, t: number, t0: number, dur: number, maxR: number, color: string, width: number) {
  const p = prog(t, t0, t0 + dur);
  if (p <= 0 || p >= 1) return;
  g.save();
  g.globalAlpha = 1 - p;
  g.strokeStyle = color;
  g.lineWidth = width * U * (1 - p * 0.7);
  g.beginPath();
  g.arc(x, y, outExpo(p) * maxR * U, 0, Math.PI * 2);
  g.stroke();
  g.restore();
}
/** Square ripple for a tap on the island. */
export function tapRipple(x: number, y: number, t: number, t0: number) {
  const p = prog(t, t0, t0 + 0.55);
  if (p <= 0 || p >= 1) return;
  g.save();
  g.globalAlpha = 1 - p;
  g.strokeStyle = TEAL;
  g.lineWidth = 5 * U;
  const r = (18 + outExpo(p) * 60) * U;
  g.strokeRect(x - r, y - r, r * 2, r * 2);
  g.restore();
}
/** Speed lines radiating from a point: behind a slam, or pulling into a dive. */
export function speedLines(cx: number, cy: number, k: number, color: string, inward = false, seed = 1) {
  if (k <= 0) return;
  g.save();
  g.strokeStyle = color;
  const R = Math.hypot(W, H);
  for (let i = 0; i < 48; i++) {
    const a = hash(i * 7.3 + seed) * Math.PI * 2;
    const r0 = (0.18 + hash(i + seed * 3) * 0.25) * R * (inward ? 1 - k * 0.6 : 1);
    const len = (0.15 + hash(i * 2 + seed) * 0.35) * R * k;
    g.globalAlpha = k * (0.25 + hash(i * 5 + seed) * 0.45);
    g.lineWidth = (2 + hash(i * 9 + seed) * 6) * U;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    g.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len));
    g.stroke();
  }
  g.restore();
}
export function flash(k: number, color = '255,248,220') {
  if (k <= 0) return;
  g.fillStyle = `rgba(${color},${k})`;
  g.fillRect(-60, -60, W + 120, H + 120);
}
/** Horizontal shutters that close from alternate sides, then open again. */
export function shutters(close: number, open: number) {
  const n = 8;
  const hh = H / n;
  for (let i = 0; i < n; i++) {
    const delay = i * 0.06;
    const c = inOut(clamp01((close - delay) / (1 - 0.06 * n + 0.06)));
    const o = inOut(clamp01((open - delay) / (1 - 0.06 * n + 0.06)));
    const cover = c * (1 - o);
    if (cover <= 0) continue;
    const w = W * cover;
    const fromLeft = i % 2 === 0;
    const x = o > 0 ? (fromLeft ? W - w : 0) : fromLeft ? 0 : W - w;
    g.fillStyle = i % 2 ? '#0c1734' : NAVY;
    g.fillRect(x, i * hh - 1, w, hh + 2);
    // a gold edge on each leading blade
    g.fillStyle = GOLD;
    const ex = o > 0 ? (fromLeft ? x : x + w - 6 * U) : fromLeft ? x + w - 6 * U : x;
    if (cover < 0.999) g.fillRect(ex, i * hh, 6 * U, hh);
  }
}

export function background(t: number) {
  const gr = g.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, Math.max(W, H) * 0.75);
  gr.addColorStop(0, '#15285a');
  gr.addColorStop(1, NAVY);
  g.fillStyle = gr;
  g.fillRect(-60, -60, W + 120, H + 120);
  for (let i = 0; i < 90; i++) {
    const x = (hash(i) * W + t * (8 + hash(i + 9) * 30) * U) % W;
    const y = (hash(i + 3) * H - t * (12 + hash(i + 5) * 20) * U + H * 2) % H;
    g.globalAlpha = 0.25 + 0.5 * hash(i + 7) * (0.5 + 0.5 * Math.sin(t * 3 + i));
    g.fillStyle = i % 5 === 0 ? GOLD : '#6f82b0';
    const s = Math.round((2 + hash(i + 2) * 4) * U);
    g.fillRect(Math.round(x), Math.round(y), s, s);
  }
  g.globalAlpha = 1;
}

/* ---------------- pixel icons and feature cards ---------------- */

/** A pixel icon from the game's atlas (ui-<name>), drawn crisp at any size, centred on (x, y). */
export function icon(name: string, x: number, y: number, size: number, alpha = 1) {
  const sp = sprite(`ui-${name}`);
  if (!sp) return;
  g.save();
  g.globalAlpha *= alpha;
  g.imageSmoothingEnabled = false;
  g.drawImage(sp, Math.round(x - size / 2), Math.round(y - size / 2), Math.round(size), Math.round(size));
  g.restore();
}

/**
 * A feature card: a gold tile with a pixel icon, and a title panel that unrolls out of it.
 * The same move as the numbered step cards, for the things you do in the lobby.
 */
export function tagCard(ic: string, title: string, sub: string, t: number, t0: number, t1: number, at?: number, yAt?: number) {
  if (t < t0 || t > t1 + 0.45) return;
  const tile = outBack(prog(t, t0, t0 + 0.32), 2.2);
  const unroll = outExpo(prog(t, t0 + 0.12, t0 + 0.6));
  const shut = inCubic(prog(t, t1, t1 + 0.2));
  const fly = inExpo(prog(t, t1 + 0.15, t1 + 0.45));
  const size = (PORTRAIT ? 86 : 70) * U;
  const h = size * 1.35;
  const numW = h + 8 * U;
  const titleW = textW(title, size);
  const subSize = size * 0.34;
  const w = numW + titleW + 64 * U;
  const cx = at ?? W / 2;
  const y = yAt ?? (PORTRAIT ? 250 * U : 44 * U);
  const x = cx - w / 2 - fly * W * 0.9;
  const open = unroll * (1 - shut);
  g.save();
  g.globalAlpha = 1 - fly * 0.6;
  if (open > 0.01) {
    g.save();
    g.beginPath();
    g.rect(x - 40 * U, y - 60 * U, numW + (w - numW + 40 * U) * open + 40 * U, h + 140 * U);
    g.clip();
    panel(x, y, w, h);
    font(size);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = WHITE;
    g.fillText(title, x + numW + 28 * U - (1 - open) * 60 * U, y + h / 2 + 4 * U);
    g.restore();
  }
  g.save();
  g.translate(x + numW / 2, y + h / 2);
  g.scale(tile, tile);
  g.rotate((1 - tile) * -0.4);
  rr(-numW / 2 + 12 * U, -h / 2 + 12 * U, numW - 24 * U, h - 24 * U, 12 * U);
  g.shadowColor = '#00000088';
  g.shadowBlur = 20 * U;
  g.fillStyle = goldFill(-h / 2, h);
  g.fill();
  g.shadowBlur = 0;
  const px = Math.max(1, Math.floor((h - 44 * U) / 16));
  icon(ic, 0, 0, px * 16);
  g.restore();
  g.restore();
  if (sub) {
    g.save();
    g.globalAlpha = prog(t, t0 + 0.4, t0 + 0.75) * (1 - prog(t, t1 - 0.1, t1 + 0.1));
    font(subSize, BODY);
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    // a dark plate under the line, so it reads over grass, stone and water alike
    const sw = g.measureText(sub).width + 36 * U;
    const sy = y + h + subSize * 1.6 + (1 - prog(t, t0 + 0.4, t0 + 0.75)) * 12 * U;
    rr(cx - sw / 2, sy - subSize * 1.15, sw, subSize * 1.7, 10 * U);
    g.fillStyle = 'rgba(7,13,32,0.72)';
    g.fill();
    g.fillStyle = '#c9d4ff';
    g.fillText(sub, cx, sy);
    g.restore();
  }
}

/** A line of small type on a dark plate. */
export function caption(s: string, cx: number, y: number, size: number, alpha: number, color = '#c9d4ff') {
  if (alpha <= 0) return;
  g.save();
  g.globalAlpha = alpha;
  font(size, BODY);
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  const sw = g.measureText(s).width + 40 * U;
  rr(cx - sw / 2, y - size * 1.15, sw, size * 1.7, 12 * U);
  g.fillStyle = 'rgba(7,13,32,0.74)';
  g.fill();
  g.fillStyle = color;
  g.fillText(s, cx, y);
  g.restore();
}

/** See-through glass, the look of the cards in the app: dark, a thin light edge, a coloured glow. */
export function glass(x: number, y: number, w: number, h: number, r: number, edge = 'rgba(255,255,255,0.16)', fill = 'rgba(10,16,40,0.74)', glow?: string) {
  g.save();
  if (glow) {
    g.shadowColor = glow;
    g.shadowBlur = 40;
  }
  rr(x, y, w, h, r);
  g.fillStyle = fill;
  g.fill();
  g.shadowBlur = 0;
  g.lineWidth = 3;
  g.strokeStyle = edge;
  g.stroke();
  g.restore();
}
