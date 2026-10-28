/**
 * Pixel art for the lobby's rides: an ORE mine cart and a kick scooter, drawn in code in the same
 * chunky style as the miners. Each sprite faces right; drawCanvas flips it for left. Two frames each,
 * so the wheels turn while it rolls.
 */
import { ctx2d, drawCanvas, makeCanvas, type Ctx } from './art';
import type { RideKindView } from './types';

export const CART_W = 22;
export const CART_H = 13;
export const SCOOT_W = 18;
export const SCOOT_H = 15;
/** How far the rider is lifted off the ground (art px): into the cart, onto the deck. */
export const RIDE_LIFT: Record<RideKindView, number> = { cart: 4, scoot: 3 };

const SCOOT_COLORS = ['#3de0c8', '#ff6fae', '#ffcf4a', '#a77bff', '#5fb8ff'];

const cache = new Map<string, HTMLCanvasElement>();

function cart(frame: number): HTMLCanvasElement {
  const cv = makeCanvas(CART_W, CART_H);
  const g = ctx2d(cv);
  const px = (x: number, y: number, w: number, h: number, c: string) => {
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  };
  // the tub: wider at the rim, narrowing to the base
  for (let y = 3; y <= 8; y++) {
    const inset = Math.floor((y - 3) / 3);
    const l = 1 + inset;
    const r = CART_W - 2 - inset;
    px(l, y, r - l + 1, 1, '#2a1d12');
    px(l + 1, y, r - l - 1, 1, y % 2 ? '#8a5a2b' : '#9c6a34');
    // plank seams
    for (let x = l + 4; x < r - 1; x += 4) px(x, y, 1, 1, '#6e4520');
  }
  // iron bands down the sides
  px(5, 3, 1, 6, '#6b7280');
  px(CART_W - 6, 3, 1, 6, '#6b7280');
  // the rim
  px(0, 1, CART_W, 2, '#2a1d12');
  px(1, 1, CART_W - 2, 1, '#c3cad6');
  px(1, 2, CART_W - 2, 1, '#7c8594');
  // a gold ORE mark on the side
  px(10, 5, 2, 2, '#ffcf4a');
  px(10, 5, 1, 1, '#fff1a8');
  // the frame under it
  px(3, 9, CART_W - 6, 1, '#2a1d12');
  // wheels, with a hub that turns
  for (const cx of [4, CART_W - 7]) {
    px(cx, 9, 4, 4, '#1b1b22');
    px(cx + 1, 10, 2, 2, '#4a4f5c');
    px(cx + (frame ? 2 : 1), frame ? 11 : 10, 1, 1, '#d9d9d9');
  }
  return cv;
}

function scooter(frame: number, color: string): HTMLCanvasElement {
  const cv = makeCanvas(SCOOT_W, SCOOT_H);
  const g = ctx2d(cv);
  const px = (x: number, y: number, w: number, h: number, c: string) => {
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  };
  // the stem, leaning back a little, and the handlebar
  for (let y = 2; y <= 10; y++) px(14 - Math.floor((10 - y) / 5), y, 1, 1, '#c9d2e0');
  px(11, 1, 5, 1, '#c9d2e0');
  px(10, 1, 2, 1, '#1b1b22');
  px(15, 1, 2, 1, '#1b1b22');
  // the deck
  px(2, 10, 13, 2, '#1b1b22');
  px(3, 10, 11, 1, color);
  px(3, 11, 11, 1, '#2d3346');
  // a rear guard
  px(1, 10, 2, 1, color);
  // wheels
  for (const cx of [2, 13]) {
    px(cx, 12, 3, 3, '#1b1b22');
    px(cx + (frame ? 2 : 0), 13, 1, 1, '#ffcf4a');
  }
  return cv;
}

function spriteOf(kind: RideKindView, frame: number, id: number): HTMLCanvasElement {
  const color = SCOOT_COLORS[id % SCOOT_COLORS.length];
  const key = kind === 'cart' ? `c${frame}` : `s${frame}${color}`;
  let cv = cache.get(key);
  if (!cv) {
    cv = kind === 'cart' ? cart(frame) : scooter(frame, color);
    cache.set(key, cv);
  }
  return cv;
}

/**
 * One ride standing with its base centre at (X, Y), `z` screen px per art px.
 * `rolling` turns the wheels; a parked ride bobs a highlight so players notice it.
 */
export function drawRide(c: Ctx, kind: RideKindView, id: number, X: number, Y: number, z: number, facing: number, rolling: boolean, now: number, parked: boolean) {
  const w = kind === 'cart' ? CART_W : SCOOT_W;
  const h = kind === 'cart' ? CART_H : SCOOT_H;
  // shadow
  c.fillStyle = 'rgba(0,0,0,0.28)';
  c.fillRect(Math.round(X - (w / 2 - 1) * z), Math.round(Y - z), Math.round((w - 2) * z), Math.ceil(z * 1.5));
  const frame = rolling ? Math.floor(now / 90) % 2 : 0;
  drawCanvas(c, spriteOf(kind, frame, id), w / 2, h, X, Y, z, facing < 0);
  if (parked) {
    // a small bouncing arrow above a free ride
    const a = 0.55 + 0.45 * Math.sin(now / 260 + id);
    c.globalAlpha = a;
    c.fillStyle = '#fff1a8';
    const ay = Math.round(Y - (h + 6 + Math.sin(now / 300 + id) * 1.5) * z);
    c.fillRect(Math.round(X - z), ay, Math.ceil(2 * z), Math.ceil(z));
    c.fillRect(Math.round(X - 0.5 * z), Math.round(ay + z), Math.ceil(z), Math.ceil(z));
    c.globalAlpha = 1;
  }
}
