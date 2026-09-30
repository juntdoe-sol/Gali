/**
 * The atlas: one image, every sprite, drawn at 1x by scripts/pixel-art.py.
 *
 * Tinted sprites (overalls, pick heads, claim highlights) are coloured once per
 * colour into a small offscreen canvas and cached, so a frame never recolours a
 * pixel twice.
 */
import ART from './art.json';

export type Rect = [number, number, number, number, number, number]; // x y w h ax ay
export const RECTS = ART.atlas.rects as unknown as Record<string, Rect>;
export const ISLE = ART.island;
export const ACTORS = ART.actors;
export const FONT = ART.font;

export type Ctx = CanvasRenderingContext2D;

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}
export function ctx2d(c: HTMLCanvasElement): Ctx {
  const x = c.getContext('2d')!;
  x.imageSmoothingEnabled = false;
  return x;
}

let sheet: HTMLImageElement | null = null;

export function loadAtlas(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      sheet = img;
      resolve();
    };
    img.onerror = reject;
    img.src = src;
  });
}

export const has = (name: string) => name in RECTS;
export const rect = (name: string): Rect | undefined => RECTS[name];

/**
 * Draw a sprite with its anchor at (x, y), `s` screen pixels per art pixel.
 * Positions snap to whole art pixels so sprites never straddle two.
 */
export function draw(c: Ctx, name: string, x: number, y: number, s: number, flip = false, alpha = 1) {
  const r = RECTS[name];
  if (!r || !sheet) return;
  const [sx, sy, w, h, ax, ay] = r;
  const px = Math.round((flip ? x - (w - ax) * s : x - ax * s));
  const py = Math.round(y - ay * s);
  if (alpha !== 1) c.globalAlpha = alpha;
  if (flip) {
    c.save();
    c.translate(px + w * s, py);
    c.scale(-1, 1);
    c.drawImage(sheet, sx, sy, w, h, 0, 0, w * s, h * s);
    c.restore();
  } else c.drawImage(sheet, sx, sy, w, h, px, py, Math.round(w * s), Math.round(h * s));
  if (alpha !== 1) c.globalAlpha = 1;
}

/** Draw a sprite's top-left at (x, y) with no anchor, e.g. the ground and the claim masks. */
export function blit(c: Ctx, name: string, x: number, y: number, w: number, h: number) {
  const r = RECTS[name];
  if (!r || !sheet) return;
  c.drawImage(sheet, r[0], r[1], r[2], r[3], x, y, w, h);
}

/** A sprite as its own canvas, optionally flooded with one colour (for masks). */
const tintCache = new Map<string, HTMLCanvasElement>();
export function sprite(name: string, tint?: string): HTMLCanvasElement | null {
  const key = tint ? `${name}|${tint}` : name;
  const hit = tintCache.get(key);
  if (hit) return hit;
  const r = RECTS[name];
  if (!r || !sheet) return null;
  const cv = makeCanvas(r[2], r[3]);
  const g = ctx2d(cv);
  g.drawImage(sheet, r[0], r[1], r[2], r[3], 0, 0, r[2], r[3]);
  if (tint) {
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = tint;
    g.fillRect(0, 0, r[2], r[3]);
  }
  tintCache.set(key, cv);
  return cv;
}

/** Draw a cached canvas (from `sprite` or `compose`) anchored at (x, y). */
export function drawCanvas(c: Ctx, cv: HTMLCanvasElement, ax: number, ay: number, x: number, y: number, s: number, flip = false, alpha = 1) {
  const w = cv.width;
  const h = cv.height;
  const px = Math.round(flip ? x - (w - ax) * s : x - ax * s);
  const py = Math.round(y - ay * s);
  if (alpha !== 1) c.globalAlpha = alpha;
  if (flip) {
    c.save();
    c.translate(px + w * s, py);
    c.scale(-1, 1);
    c.drawImage(cv, 0, 0, w, h, 0, 0, w * s, h * s);
    c.restore();
  } else c.drawImage(cv, 0, 0, w, h, px, py, Math.round(w * s), Math.round(h * s));
  if (alpha !== 1) c.globalAlpha = 1;
}

/* ---------------- bitmap text ---------------- */
const widths = FONT.widths as Record<string, number>;
export function textWidth(t: string) {
  let w = 0;
  for (const ch of t.toUpperCase()) w += (ch === ' ' ? FONT.space : widths[ch] ?? 3) + FONT.gap;
  return Math.max(0, w - FONT.gap);
}
/** Pixel text at (x, y) top-left, `s` screen px per font pixel. */
export function text(c: Ctx, t: string, x: number, y: number, s: number, color: string, shadow?: string) {
  if (shadow) text(c, t, x + s, y + s, s, shadow);
  let cx = Math.round(x);
  const cy = Math.round(y);
  for (const ch of t.toUpperCase()) {
    if (ch === ' ') {
      cx += (FONT.space + FONT.gap) * s;
      continue;
    }
    const name = `font-${ch.charCodeAt(0)}`;
    const cv = sprite(name, color);
    const w = widths[ch] ?? 3;
    if (cv) c.drawImage(cv, 0, 0, cv.width, cv.height, cx, cy, cv.width * s, cv.height * s);
    cx += (w + FONT.gap) * s;
  }
}
export function textCentered(c: Ctx, t: string, x: number, y: number, s: number, color: string, shadow?: string) {
  text(c, t, x - (textWidth(t) * s) / 2, y, s, color, shadow);
}
