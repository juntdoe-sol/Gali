/**
 * Grab and throw: a pot, crate or barrel a miner picked up and threw, in the lobby and on ORE Island.
 *
 * Each canvas (engine/lobby.ts, engine/engine.ts) keeps its own smashables; this file is what they share: the
 * sprites, where a throw is along its arc, and how it is drawn. A throw lasts THROW_MS and breaks where it lands.
 */
import { ctx2d, makeCanvas, type Ctx } from './art';
import { paintSmash, SMASH_COLORS, SMASH_DIM } from './lobbyArt';
import { THROW_MS, type PropKind } from '../game/powers';

export { THROW_MS, SMASH_COLORS };
export type { PropKind };
export const isProp = (k: string): k is PropKind => k === 'pot' || k === 'crate' || k === 'barrel';

/** A pot in the air: from where it was thrown to where it lands (map px), and when it left (wall ms). */
export interface Flight {
  kind: PropKind;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  at: number;
  /** ours (we pay the hit and the heal) or someone else's (drawn only) */
  mine: boolean;
  done: boolean;
}

const cache = new Map<string, HTMLCanvasElement>();
/** A pot, crate or barrel, whole or broken, at the lobby's art size (SMASH_DIM). */
export function propSprite(kind: PropKind, broken = false): HTMLCanvasElement {
  const key = `${kind}-${broken ? 1 : 0}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const [w, h] = SMASH_DIM[kind];
  const cv = makeCanvas(w, h);
  paintSmash(ctx2d(cv), kind, broken);
  cache.set(key, cv);
  return cv;
}

/** How far along a throw is (0 to 1), and where it is: on the ground line and how high above it. */
export function flightAt(f: Flight, now: number, peak: number): { t: number; x: number; y: number; h: number } {
  const t = Math.max(0, Math.min(1, (now - f.at) / THROW_MS));
  return { t, x: f.x0 + (f.x1 - f.x0) * t, y: f.y0 + (f.y1 - f.y0) * t, h: Math.sin(t * Math.PI) * peak + (1 - t) * peak * 0.6 };
}

/** Draw a prop with its feet at screen (X, Y), `z` screen px per art px, turned by `rot`. */
export function drawProp(c: Ctx, kind: PropKind, X: number, Y: number, z: number, rot = 0, broken = false) {
  const sp = propSprite(kind, broken);
  c.save();
  c.translate(Math.round(X), Math.round(Y));
  if (rot) c.rotate(rot);
  c.drawImage(sp, 0, 0, sp.width, sp.height, -(sp.width / 2) * z, -sp.height * z, sp.width * z, sp.height * z);
  c.restore();
}

/** A throw in the air, with a shadow on the ground under it. `S` scales map px to screen, `z` the art. */
export function drawFlight(c: Ctx, f: Flight, now: number, sx: (x: number) => number, sy: (y: number) => number, z: number, peak: number) {
  const p = flightAt(f, now, peak);
  if (p.t >= 1) return;
  const [w] = SMASH_DIM[f.kind];
  c.fillStyle = 'rgba(0,0,0,0.25)';
  c.beginPath();
  c.ellipse(sx(p.x), sy(p.y), (w / 2) * z * 0.8, 2 * z, 0, 0, Math.PI * 2);
  c.fill();
  drawProp(c, f.kind, sx(p.x), sy(p.y) - p.h * (sy(1) - sy(0)), z, p.t * Math.PI * 2.2 * (f.x1 >= f.x0 ? 1 : -1));
}
