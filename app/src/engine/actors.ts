/**
 * Everyone who moves: your miner, the other miners, pets, the mole, ships and
 * birds. A miner is five layers plus a helmet, composed once per look and frame
 * into a small canvas and reused, so thirty miners cost thirty draws.
 */
import { ACTORS, draw, drawCanvas, makeCanvas, ctx2d, sprite, type Ctx } from './art';
import type { Look, Pose } from './types';

const M = ACTORS.miner;
export const MW = M.w;
export const MH = M.h;
const PAD_X = 10;
const PAD_T = 12;
const HEAD = M.head as unknown as Record<string, [number, number][]>;
const HATS = ACTORS.hats as unknown as Record<string, { ax: number; ay: number; lamp: [number, number] | null }>;
const PETS = ACTORS.pets as unknown as Record<string, { n: number; ms: number; fly: boolean; ax: number; ay: number; light: string | null }>;
export const POSES = M.poses as unknown as Record<Pose, { n: number; ms: number; loop: boolean }>;
export const HIT_FRAME = M.hit as number;
export const IMPACT = M.impact as unknown as [number, number];

const cache = new Map<string, HTMLCanvasElement>();
const lookKey = (l: Look) => `${l.hat}|${l.fit}|${l.pick}|${l.sex === 'f' ? 'f' : 'm'}`;

/** One composed frame: body, tinted overalls, helmet, tinted pick head, shading. */
export function minerFrame(look: Look, pose: Pose, f: number): HTMLCanvasElement {
  const key = `${lookKey(look)}|${pose}|${f}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const cv = makeCanvas(MW + PAD_X * 2, MH + PAD_T + 2);
  const g = ctx2d(cv);
  const put = (name: string, tint?: string) => {
    const s = sprite(name, tint);
    if (s) g.drawImage(s, PAD_X, PAD_T);
  };
  const base = `miner-${pose}-${f}`;
  for (const layer of M.order as string[]) {
    if (layer === 'hat') {
      const h = HATS[look.hat] ?? HATS['hat-yellow'];
      const s = sprite(look.hat in HATS ? look.hat : 'hat-yellow');
      const [hx, hy] = HEAD[pose]?.[f] ?? [10, 3];
      if (s && h) g.drawImage(s, PAD_X + hx - h.ax, PAD_T + hy - h.ay);
    } else if (layer === 'fit') put(`${base}-fit`, look.fit);
    else if (layer === 'pick') put(`${base}-pick`, look.pick);
    else if (layer === 'base' && look.sex === 'f') put(`minerf-${pose}-${f}-base`);
    else put(`${base}-${layer}`);
  }
  if (cache.size > 900) cache.clear();
  cache.set(key, cv);
  return cv;
}

/** A soft pixel shadow under anything that stands. */
let shadowCv: HTMLCanvasElement | null = null;
function shadow() {
  if (shadowCv) return shadowCv;
  shadowCv = makeCanvas(14, 4);
  const g = ctx2d(shadowCv);
  g.fillStyle = 'rgba(8,12,24,0.28)';
  g.fillRect(2, 0, 10, 4);
  g.fillRect(0, 1, 14, 2);
  return shadowCv;
}

/** Screen position of the helmet lamp, for the night lightmap. */
export function lampOf(look: Look, pose: Pose, f: number, facing: number): [number, number] | null {
  const h = HATS[look.hat] ?? HATS['hat-yellow'];
  if (!h?.lamp) return null;
  const [hx, hy] = HEAD[pose]?.[f] ?? [10, 3];
  const lx = hx + h.lamp[0] - M.ax;
  const ly = hy + h.lamp[1] - M.ay;
  return [lx * facing, ly];
}

export function frameAt(pose: Pose, since: number, now: number) {
  const p = POSES[pose] ?? POSES.idle;
  const k = Math.floor((now - since) / p.ms);
  return p.loop ? k % p.n : Math.min(p.n - 1, k);
}

/** Draw a miner with feet at screen (x, y). */
export function drawMiner(c: Ctx, look: Look, pose: Pose, f: number, x: number, y: number, s: number, facing: number, alpha = 1) {
  const sh = shadow();
  c.drawImage(sh, Math.round(x - 7 * s), Math.round(y - 2 * s), 14 * s, 4 * s);
  const cv = minerFrame(look, pose, f);
  drawCanvas(c, cv, M.ax + PAD_X, M.ay + PAD_T, x, y, s, facing < 0, alpha);
}

export function drawPet(c: Ctx, key: string, now: number, x: number, y: number, s: number, facing: number) {
  const p = PETS[key];
  if (!p) return;
  const f = Math.floor(now / p.ms) % p.n;
  if (!p.fly) {
    const sh = shadow();
    c.drawImage(sh, Math.round(x - 5 * s), Math.round(y - 2 * s), 10 * s, 3 * s);
  }
  const bob = p.fly ? Math.round(Math.sin(now / 300) * 2) : 0;
  draw(c, `${key}-${f}`, x, y + bob * s, s, facing < 0);
}
export const petFlies = (key: string | null) => Boolean(key && PETS[key]?.fly);
export const petLight = (key: string | null) => (key ? PETS[key]?.light ?? null : null);

/* ---------------- a walking body ---------------- */
export interface Body {
  x: number;
  y: number;
  path: [number, number][];
  pose: Pose;
  since: number;
  facing: 1 | -1;
}

/** Step a body along its path at `speed` px/s. Returns true on arrival this frame. */
export function stepBody(b: Body, dt: number, speed: number, now: number): boolean {
  if (!b.path.length) return false;
  let budget = speed * dt;
  while (budget > 0 && b.path.length) {
    const [tx, ty] = b.path[0];
    const dx = tx - b.x;
    const dy = ty - b.y;
    const d = Math.hypot(dx, dy);
    if (Math.abs(dx) > 0.3) b.facing = dx > 0 ? 1 : -1;
    if (d <= budget) {
      b.x = tx;
      b.y = ty;
      budget -= d;
      b.path.shift();
    } else {
      b.x += (dx / d) * budget;
      b.y += (dy / d) * budget;
      budget = 0;
    }
  }
  if (b.pose !== 'walk' && b.pose !== 'carry' && b.path.length) {
    b.pose = 'walk';
    b.since = now;
  }
  return b.path.length === 0;
}

export const moleNames = ACTORS.mole as unknown as { up: string[]; idle: string[]; bonk: string; ax: number; ay: number; ms: number; idleMs: number };
