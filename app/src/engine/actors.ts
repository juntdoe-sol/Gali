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
/** Draw a miner with feet at screen (x, y). `lift` raises the body off the ground (map px) for a jump; the shadow stays down. */
export function drawMiner(c: Ctx, look: Look, pose: Pose, f: number, x: number, y: number, s: number, facing: number, alpha = 1, lift = 0, tilt = 0) {
  const sh = shadow();
  const k = lift > 0 ? Math.max(0.55, 1 - lift / 22) : 1;
  c.drawImage(sh, Math.round(x - 7 * s * k), Math.round(y - 2 * s), 14 * s * k, 4 * s);
  const cv = minerFrame(look, pose, f);
  if (tilt) {
    // lean into a swing, pivoting on the feet
    c.save();
    c.translate(x, y);
    c.rotate(tilt);
    c.translate(-x, -y);
  }
  drawCanvas(c, cv, M.ax + PAD_X, M.ay + PAD_T, x, Math.round(y - lift * s), s, facing < 0, alpha);
  if (tilt) c.restore();
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

/* ---------------- dances ---------------- */
/** Every dance, by number (the wire sends `dance<n>`). 1 to 3 have their own frames; the rest are moves
 *  built from the miner's frames with a flip, a bounce, a slide or a lean, on the wall clock. */
export { DANCES, DANCE_COUNT, isDance } from '../game/dances';
export interface DanceStep {
  pose: Pose;
  f: number;
  /** sideways nudge and height off the ground (art px), a lean (radians), and whether to face the other way */
  dx: number;
  lift: number;
  tilt: number;
  flip: boolean;
  /** this dance glows gold (AURA FARM) */
  aura?: boolean;
}
/** The step of dance `n` at wall time `t` (ms). */
export function danceStep(n: number, t: number): DanceStep {
  const base: DanceStep = { pose: 'idle', f: 0, dx: 0, lift: 0, tilt: 0, flip: false };
  const beat = (ms: number) => Math.floor(t / ms);
  if (n >= 1 && n <= 3) {
    const pose = `dance${n}` as Pose;
    return { ...base, pose, f: frameAt(pose, 0, t) };
  }
  switch (n) {
    case 4: // FLOSS: arms swing past the hips, side to side, fast
      return { ...base, pose: 'dance2', f: beat(110) % 4, dx: beat(220) % 2 ? 1.5 : -1.5, flip: beat(220) % 2 === 1 };
    case 5: // GRIDDY: knees up, heels tapping, little hops and a turn every few beats
      return { ...base, pose: 'walk', f: beat(85) % 6, lift: Math.abs(Math.sin(t / 140)) * 2.2, dx: Math.sin(t / 280) * 2, flip: beat(1120) % 2 === 1 };
    case 6: { // ROBOT: stiff, stepped, snapping from one lean to the next
      const k = beat(380) % 4;
      return { ...base, pose: 'cheer', f: k % 2 ? 1 : 3, tilt: [0, 0.14, 0, -0.14][k], dx: [0, 1, 0, -1][k] };
    }
    case 7: { // MOONWALK: the walk, gliding backwards
      const per = 2600;
      const k = (t % per) / per;
      const tri = k < 0.5 ? k * 2 : 2 - k * 2;
      return { ...base, pose: 'walk', f: 5 - (beat(100) % 6), dx: (tri - 0.5) * 18, flip: k >= 0.5 };
    }
    case 8: // SPIN: arms up, whirling round
      return { ...base, pose: 'cheer', f: 3, flip: beat(90) % 2 === 1, lift: Math.abs(Math.sin(t / 360)) * 1.5 };
    case 9: { // WORM: flat on the floor, a wave running through
      return { ...base, pose: 'walk', f: 2, tilt: -Math.PI / 2, lift: Math.abs(Math.sin(t / 160)) * 2.5, dx: 4 };
    }
    case 10: { // SPRINKLER: one arm out, ticking round, then sweeping back
      const k = beat(140) % 10;
      const step = k < 6 ? k : 10 - k;
      return { ...base, pose: 'swing', f: 2, tilt: -0.18 + step * 0.06 };
    }
    case 11: // AURA FARM: cool and slow, a sway like rowing, a golden glow
      return { ...base, pose: 'idle', f: beat(400) % 4, tilt: Math.sin(t / 520) * 0.09, dx: Math.sin(t / 520) * 1.2, aura: true };
    case 12: { // SIX SEVEN: both hands bouncing up and down, weighing it up
      const k = beat(170) % 2;
      return { ...base, pose: 'cheer', f: k ? 1 : 3, lift: k ? 1.5 : 0 };
    }
    default:
      return base;
  }
}
/** Draw a dancing miner (feet at x, y). A dance that glows gets a gold aura under and around it. */
export function drawDancer(c: Ctx, look: Look, n: number, t: number, x: number, y: number, s: number, facing: number, alpha = 1) {
  const st = danceStep(n, t);
  if (st.aura) {
    const pulse = 0.5 + 0.5 * Math.sin(t / 260);
    c.save();
    c.globalAlpha = 0.35 + 0.25 * pulse;
    c.fillStyle = '#ffd24a';
    c.beginPath();
    c.ellipse(x, y - 1 * s, (10 + pulse * 2) * s, (3.5 + pulse) * s, 0, 0, Math.PI * 2);
    c.fill();
    // rising gold flecks
    for (let k = 0; k < 6; k++) {
      const ph = ((t / 900 + k / 6) % 1 + 1) % 1;
      const fx = x + Math.sin(k * 2.1 + t / 400) * 9 * s;
      const fy = y - ph * 30 * s;
      c.globalAlpha = (1 - ph) * 0.9;
      c.fillStyle = k % 2 ? '#fff1a8' : '#ffd24a';
      c.fillRect(Math.round(fx), Math.round(fy), Math.max(1, Math.round(s)), Math.max(1, Math.round(s * 2)));
    }
    c.restore();
  }
  drawMiner(c, look, st.pose, st.f, x + st.dx * s * facing, y, s, st.flip ? -facing : facing, alpha, st.lift, st.tilt);
  if (st.aura) {
    // shades on
    c.fillStyle = '#0a0a12';
    const fx = facing * (st.flip ? -1 : 1);
    const hx = x + st.dx * s * facing + fx * 1 * s;
    const hy = y - (19 + st.lift) * s;
    c.fillRect(Math.round(hx - 3 * s), Math.round(hy), Math.round(7 * s), Math.round(2 * s));
  }
}
