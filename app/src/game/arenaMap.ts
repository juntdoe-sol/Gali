/**
 * The arena as data: a gothic hall seen from the side. Fighters run along the stone floor, jump onto
 * three ledges and fall back down; the middle, highest ledge is the throne for King of the Hill. Anyone
 * knocked out (or watching) stands on the balcony along the top. Pure, with no imports, so the canvas
 * (which runs in a WebView on Android) can use it without pulling in the app.
 *
 * Coordinates are map px: x runs left to right, y runs down, and a miner's y is where their feet are.
 */
export const AW = 480;
export const AH = 220;
/** the stone floor the fight stands on */
export const GROUND = 198;
/** the hall's side walls: nobody gets past these */
export const WALL_L = 12;
export const WALL_R = AW - 12;
export interface Ledge {
  x0: number;
  x1: number;
  y: number;
}
/** two low ledges at the sides and the high throne in the middle (always last) */
export const LEDGES: Ledge[] = [
  { x0: 40, x1: 128, y: 156 },
  { x0: 352, x1: 440, y: 156 },
  { x0: 174, x1: 306, y: 118 },
];
export const THRONE = LEDGES[2];
/** the balcony along the top where spectators stand (and the crowd behind them) */
export const BALCONY = { x0: 22, x1: AW - 22, y: 54 };
/** kept for older callers: the middle of the floor */
export const FLOOR = { cx: AW / 2, cy: GROUND };
export const MAX_FIGHTERS = 12;
/** the furthest a thrown shard flies, map px */
export const THROW_RANGE = 150;

/** Is (x, y) inside the hall? */
export function inHall(x: number, y: number, pad = 0): boolean {
  return x >= WALL_L + pad && x <= WALL_R - pad && y <= GROUND + 2 && y >= 0;
}
/** Kept name: a point a fighter or the boss may stand at or fly through. */
export function onFloor(x: number, y: number, pad = 0): boolean {
  return inHall(x, y, Math.max(0, pad));
}
/** The ledge under x that a body at feet-height y would land on next, or null for the floor. */
export function ledgeAt(x: number, y: number, slack = 2): Ledge | null {
  for (const l of LEDGES) if (x >= l.x0 && x <= l.x1 && Math.abs(y - l.y) <= slack) return l;
  return null;
}
/** Where a body standing at x, feet at y, is standing on: a ledge's y, the floor's, or null in the air. */
export function standingOn(x: number, y: number): number | null {
  if (y >= GROUND - 1) return GROUND;
  const l = ledgeAt(x, y, 1.5);
  return l ? l.y : null;
}
/** On the throne (King of the Hill)? */
export const onThrone = (x: number, y: number) => x >= THRONE.x0 && x <= THRONE.x1 && Math.abs(y - THRONE.y) <= 3;

/** Spawn slot i of n, spread along the floor. */
export function spawnAt(i: number, n: number): [number, number] {
  const k = n <= 1 ? 0.25 : i / Math.max(1, n - 1);
  return [Math.round(60 + k * (AW - 120)), GROUND];
}
export const standsSpot = (id: string): [number, number] => {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return [BALCONY.x0 + 8 + (h % (BALCONY.x1 - BALCONY.x0 - 16)), BALCONY.y];
};
/** A random spot on a surface (floor or ledge), for pickups. `r` is a 0..1 random source. */
export function surfaceSpot(r: () => number): [number, number] {
  if (r() < 0.45) {
    const l = LEDGES[Math.floor(r() * LEDGES.length)];
    return [Math.round(l.x0 + 10 + r() * (l.x1 - l.x0 - 20)), l.y];
  }
  return [Math.round(WALL_L + 24 + r() * (WALL_R - WALL_L - 48)), GROUND];
}

export type PickKind = 'ore' | 'heart' | 'shield';
export interface Pickup {
  i: number;
  k: PickKind;
  x: number;
  y: number;
}
export interface Shot {
  id: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  at: number;
}

/* ---------------- the Two-Mouthed ---------------- */
export type BossAtk = 'sweep' | 'tongue' | 'roar';
/** wind-up before an attack lands (the warning), and how long the attack shows after */
export const BOSS_WIND_MS = 750;
export const BOSS_WIND2_MS = 520;
export const BOSS_ACT_MS = 650;
/** reach of each attack, map px from the boss's feet */
export const SWEEP_REACH = 64;
export const TONGUE_REACH = 128;
export const ROAR_REACH = 104;
/** the boss is this tall and half this wide, map px (for hits on it) */
export const BOSS_TALL = 98;
export const BOSS_HALF = 24;
/** Who an attack catches, from where they stand. `f` is the way the boss faces (1 right, -1 left). */
export function bossCatches(atk: BossAtk, bx: number, f: 1 | -1, px: number, py: number): boolean {
  const dx = px - bx;
  if (atk === 'sweep') return Math.abs(dx) <= SWEEP_REACH && py >= GROUND - 3;
  if (atk === 'tongue') return dx * f > -6 && dx * f <= TONGUE_REACH && py >= GROUND - 64;
  return Math.abs(dx) <= ROAR_REACH && py >= GROUND - 90;
}

/* ---------------- playing with each other ---------------- */
/** quick emotes, shown over your miner for a moment (keys: T, then 1 to 6) */
export const EMOTES = ['wave', 'laugh', 'gg', 'angry', 'heart', 'skull'] as const;
export type Emote = (typeof EMOTES)[number];
export const EMOTE_MS = 2600;
/** at or under this HP a miner is dizzy (stars over the head) and can be grabbed */
export const DIZZY_HP = 35;
/** how close a grab reaches (map px, sideways and up or down), how long you can carry, and the throw */
export const GRAB_X = 18;
export const GRAB_Y = 14;
export const HOLD_MS = 1500;
export const THROW_DMG = 22;
/** Boss Raid: a downed miner lies here this long waiting for help, then goes to the balcony */
export const DOWN_MS = 12_000;
/** stand over a downed teammate this long to get them up, with this much HP */
export const REVIVE_MS = 2000;
export const REVIVE_HP = 30;
export const REVIVE_X = 16;
/** Can a grabber at (gx, gy) grab a miner at (vx, vy)? */
export const inGrabReach = (gx: number, gy: number, vx: number, vy: number) => Math.abs(vx - gx) <= GRAB_X && Math.abs(vy - gy) <= GRAB_Y;
/** Is a rescuer at (rx, ry) close enough to revive a miner lying at (vx, vy)? */
export const inReviveReach = (rx: number, ry: number, vx: number, vy: number) => Math.abs(vx - rx) <= REVIVE_X && Math.abs(vy - ry) <= 10;
