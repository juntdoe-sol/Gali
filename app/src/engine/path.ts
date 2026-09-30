/**
 * Walking on the island: A* over the terrain blocks, then string-pulled so a
 * miner cuts straight across open ground and only bends round the sea.
 */
import { BLOCK, COLS, ROWS, ISLE } from './island';

const GRID: string = ISLE.grid;
const walkable = (x: number, y: number) => x >= 0 && y >= 0 && x < COLS && y < ROWS && GRID[y * COLS + x] !== '~';

function lineClear(x0: number, y0: number, x1: number, y1: number) {
  const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) * 2) + 1;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    if (!walkable(Math.floor(x0 + (x1 - x0) * t), Math.floor(y0 + (y1 - y0) * t))) return false;
  }
  return true;
}

/** Waypoints in map pixels from (ax, ay) to (bx, by), both feet positions. */
export function findPath(ax: number, ay: number, bx: number, by: number): [number, number][] {
  const sx = Math.floor(ax / BLOCK);
  const sy = Math.floor(ay / BLOCK);
  const tx = Math.floor(bx / BLOCK);
  const ty = Math.floor(by / BLOCK);
  if (!walkable(sx, sy) || !walkable(tx, ty) || lineClear(sx + 0.5, sy + 0.5, tx + 0.5, ty + 0.5)) return [[bx, by]];
  const N = COLS * ROWS;
  const g = new Float32Array(N).fill(Infinity);
  const from = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const open: number[] = [];
  const f = new Float32Array(N).fill(Infinity);
  const start = sy * COLS + sx;
  const goal = ty * COLS + tx;
  g[start] = 0;
  f[start] = Math.hypot(tx - sx, ty - sy);
  open.push(start);
  let guard = 0;
  while (open.length && guard++ < 6000) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i;
    const cur = open[bi];
    open[bi] = open[open.length - 1];
    open.pop();
    if (cur === goal) break;
    closed[cur] = 1;
    const cx = cur % COLS;
    const cy = (cur / COLS) | 0;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (!walkable(nx, ny) || (dx && dy && (!walkable(cx + dx, cy) || !walkable(cx, cy + dy)))) continue;
        const ni = ny * COLS + nx;
        if (closed[ni]) continue;
        const ng = g[cur] + (dx && dy ? 1.414 : 1);
        if (ng < g[ni]) {
          g[ni] = ng;
          from[ni] = cur;
          f[ni] = ng + Math.hypot(tx - nx, ty - ny);
          if (!open.includes(ni)) open.push(ni);
        }
      }
  }
  if (from[goal] < 0) return [[bx, by]];
  const cells: [number, number][] = [];
  for (let c = goal; c !== start && c >= 0; c = from[c]) cells.push([c % COLS, (c / COLS) | 0]);
  cells.reverse();
  // string pulling
  const out: [number, number][] = [];
  let px = sx + 0.5;
  let py = sy + 0.5;
  let i = 0;
  while (i < cells.length) {
    let j = cells.length - 1;
    while (j > i && !lineClear(px, py, cells[j][0] + 0.5, cells[j][1] + 0.5)) j--;
    px = cells[j][0] + 0.5;
    py = cells[j][1] + 0.5;
    out.push([px * BLOCK, py * BLOCK]);
    i = j + 1;
  }
  out[out.length - 1] = [bx, by];
  return out;
}
