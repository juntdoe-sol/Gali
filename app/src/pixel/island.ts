/**
 * Gali Island, as the game reads it.
 *
 * The picture and the shapes both come out of scripts/island.py, so the ground a
 * player can see, the ground they can tap and the ground a character can stand on
 * are the same ground. When the island is re-authored, nothing here needs editing.
 */
import { META } from './sprites';

export const ISLE = META.island;

export const [MAP_W, MAP_H] = META.map;
export const BLOCK = ISLE.block;
export const COLS = ISLE.cols;
export const ROWS = ISLE.rows;

export type Claim = (typeof ISLE.claims)[number];
export const CLAIMS = ISLE.claims as readonly Claim[];
export const REGIONS = ISLE.regions as readonly (readonly [string, number, number])[];
export const SHIPS = ISLE.ships;

const [, , ICON_AX, ICON_AY] = ISLE.icon;
const [, , SHIP_AX, SHIP_AY] = ISLE.ship;
const [, , BIRD_AX, BIRD_AY] = ISLE.bird;
export const ICON_ANCHOR = [ICON_AX, ICON_AY] as const;
export const SHIP_ANCHOR = [SHIP_AX, SHIP_AY] as const;
export const BIRD_ANCHOR = [BIRD_AX, BIRD_AY] as const;

/**
 * One character per terrain block: 'A'-'Y' a claim, '.' open land, '~' sea.
 * 9,900 characters, which is cheaper to carry and to read than any polygon set.
 */
const GRID: string = ISLE.grid;

const cell = (cx: number, cy: number) =>
  cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS ? '~' : GRID[cy * COLS + cx];

/** The claim occupying a block, or -1 for open ground and water. */
export function ownerOf(cx: number, cy: number): number {
  const ch = cell(cx, cy);
  return ch >= 'A' && ch <= 'Y' ? ch.charCodeAt(0) - 65 : -1;
}

/** The claim under a point in map pixels, or -1. */
export const claimAt = (x: number, y: number) =>
  ownerOf(Math.floor(x / BLOCK), Math.floor(y / BLOCK));

/**
 * How far off a claim a tap still counts, in map pixels.
 *
 * A claim is about 34x36 of these across. Rendered between the HUD and the
 * deploy panel that lands near 32 screen pixels, which is under a fingertip —
 * the old square spots were nearly twice that, because only a fifth of the map
 * was on screen. Growing the claims to compensate would pave over the open
 * ground that makes the island an island, so the tolerance goes here instead,
 * where it costs no pixels: the drawn claim stays honest and the thing you have
 * to hit is bigger than the thing you can see.
 */
export const TAP_SLOP = 8;

/**
 * The claim a tap meant: the one under it, or the nearest one within the slop.
 * Returns -1 only when the tap is genuinely out on open ground or water.
 */
export function claimForTap(x: number, y: number): number {
  const here = claimAt(x, y);
  if (here >= 0) return here;
  const gx = Math.floor(x / BLOCK);
  const gy = Math.floor(y / BLOCK);
  const reach = Math.ceil(TAP_SLOP / BLOCK);
  let best = -1;
  let bd = TAP_SLOP * TAP_SLOP;
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const o = ownerOf(gx + dx, gy + dy);
      if (o < 0) continue;
      const px = (gx + dx) * BLOCK + BLOCK / 2 - x;
      const py = (gy + dy) * BLOCK + BLOCK / 2 - y;
      const d = px * px + py * py;
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
  }
  return best;
}

export const isLand = (x: number, y: number) =>
  cell(Math.floor(x / BLOCK), Math.floor(y / BLOCK)) !== '~';

/**
 * The closest walkable point to somewhere a player tapped.
 *
 * Tapping the sea should not strand a character in the water, and it should not
 * be ignored either — walking to the nearest beach is what the player meant.
 */
export function toLand(x: number, y: number): [number, number] {
  if (isLand(x, y)) return [x, y];
  const gx = Math.max(0, Math.min(COLS - 1, Math.floor(x / BLOCK)));
  const gy = Math.max(0, Math.min(ROWS - 1, Math.floor(y / BLOCK)));
  // Inland by one block, not the first block of shore: standing on the waterline
  // reads as standing in the sea, because the drawn coast overlaps it.
  const solid = (cx: number, cy: number) =>
    cell(cx, cy) !== '~' && cell(cx - 1, cy) !== '~' && cell(cx + 1, cy) !== '~' &&
    cell(cx, cy - 1) !== '~' && cell(cx, cy + 1) !== '~';
  let shore: [number, number] | null = null;
  for (let r = 1; r < Math.max(COLS, ROWS); r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const cx = gx + dx;
        const cy = gy + dy;
        if (cell(cx, cy) === '~') continue;
        const at: [number, number] = [cx * BLOCK + BLOCK / 2, cy * BLOCK + BLOCK / 2];
        if (solid(cx, cy)) return at;
        shore = shore ?? at;
      }
    }
    // a one-block islet has no solid interior; take the shore rather than loop forever
    if (shore && r > 3) return shore;
  }
  return shore ?? [MAP_W / 2, MAP_H / 2];
}

/** Somewhere open to wander to, for the practice-mode crowd. */
export function openSpot(): [number, number] {
  for (let tries = 0; tries < 60; tries++) {
    const cx = Math.floor(Math.random() * COLS);
    const cy = Math.floor(Math.random() * ROWS);
    if (cell(cx, cy) === '.') return [cx * BLOCK + BLOCK / 2, cy * BLOCK + BLOCK / 2];
  }
  return ISLE.home as [number, number];
}

/** Where a ship is on its circuit, and which way it is pointing. */
export function shipAt(path: readonly (readonly number[])[], t: number): [number, number, number] {
  const n = path.length;
  const u = ((t % n) + n) % n;
  const i = Math.floor(u);
  const a = path[i];
  const b = path[(i + 1) % n];
  const k = u - i;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, b[0] >= a[0] ? 1 : -1];
}
