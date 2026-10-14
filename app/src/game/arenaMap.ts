/**
 * The arena pit as data: its size, the oval floor, the pillars, the ring and the stands. Pure, with no
 * imports, so the canvas (which runs in a WebView on Android) can use it without pulling in the app.
 */
export const AW = 360;
export const AH = 220;
/** the fighting floor is an oval */
export const FLOOR = { cx: 180, cy: 132, rx: 158, ry: 72 };
export const PILLARS: [number, number][] = [
  [96, 104],
  [264, 104],
  [96, 162],
  [264, 162],
];
export const PILLAR_R = 9;
export const RING = { x: 180, y: 132, r: 24 };
/** where the stands are (spectators stand here) */
export const STANDS = { y0: 18, y1: 46 };
export const MAX_FIGHTERS = 12;
/** the furthest a thrown shard flies, map px */
export const THROW_RANGE = 150;

export function onFloor(x: number, y: number, pad = 6): boolean {
  const dx = (x - FLOOR.cx) / (FLOOR.rx - pad);
  const dy = (y - FLOOR.cy) / (FLOOR.ry - pad);
  if (dx * dx + dy * dy > 1) return false;
  return PILLARS.every(([px, py]) => Math.hypot(x - px, (y - py) * 1.4) > PILLAR_R + 3);
}
/** Spawn slot i of n, round the oval. */
export function spawnAt(i: number, n: number): [number, number] {
  const a = (i / Math.max(1, n)) * Math.PI * 2 + Math.PI / 2;
  return [Math.round(FLOOR.cx + Math.cos(a) * (FLOOR.rx - 30)), Math.round(FLOOR.cy + Math.sin(a) * (FLOOR.ry - 18))];
}
export const standsSpot = (id: string): [number, number] => {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return [30 + (h % 300), STANDS.y0 + 6 + ((h >>> 9) % (STANDS.y1 - STANDS.y0 - 8))];
};

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
