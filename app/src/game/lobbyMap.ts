/**
 * The lobby map, as data: where the ground, water, trees and doors are, and how a
 * player finds a way across it. Pure: no canvas, no network. The engine draws it,
 * the tests walk it.
 *
 * One tile is 16 art pixels. The map is 72 x 52 tiles, about 1150 x 830 pixels, so a
 * hundred players can stand in it without touching. Everything is generated from a
 * fixed seed, so every player's lobby is the same lobby, and a walking route
 * computed on one phone is the route every other phone computes too.
 */
export const LT = 16;
export const LCOLS = 72;
export const LROWS = 52;
export const LW = LCOLS * LT;
export const LH = LROWS * LT;
/** Players in one lobby. The next one sees "lobby full" and can still play on the island. */
export const LOBBY_CAP = 100;

export const GRASS = 0;
export const PLAZA = 1;
export const ROAD = 2;
export const WATER = 3;
export const SAND = 4;
export const PLANK = 6;
export const CLIFF = 7;
export const HALL = 8;

export type DoorId = 'island' | 'cave' | 'market';
export interface Door {
  id: DoorId;
  /** the tiles that count as walking in */
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  sub: string;
}

export const DOORS: Door[] = [
  { id: 'island', x: 66, y: 26, w: 3, h: 3, label: 'GALI ISLAND', sub: 'Mine ORE' },
  { id: 'cave', x: 14, y: 10, w: 3, h: 1, label: 'CAVE RUN', sub: 'Dig for XP' },
  { id: 'market', x: 51, y: 9, w: 3, h: 1, label: 'MARKET', sub: 'Gear and items' },
];

/** Where you appear, as a tile, for each way into the lobby. */
export const SPAWNS: Record<'start' | DoorId, [number, number]> = {
  start: [36, 35],
  island: [61, 27],
  cave: [15, 13],
  market: [52, 12],
};

/** Things with a shape of their own: a tent, a stall, the lighthouse. The engine draws each; the tiles under them block. */
export interface Structure {
  kind: 'tent' | 'fire' | 'cart' | 'crates' | 'barrel' | 'stall-red' | 'stall-teal' | 'lighthouse' | 'rack' | 'boulder';
  /** tiles that block: x, y, width, height */
  at: [number, number, number, number];
}
export const STRUCTURES: Structure[] = [
  { kind: 'tent', at: [8, 14, 3, 2] },
  { kind: 'fire', at: [12, 15, 1, 1] },
  { kind: 'tent', at: [5, 17, 3, 2] },
  { kind: 'cart', at: [19, 12, 2, 1] },
  { kind: 'crates', at: [11, 12, 1, 1] },
  { kind: 'rack', at: [20, 14, 2, 1] },
  { kind: 'stall-red', at: [46, 11, 3, 1] },
  { kind: 'stall-teal', at: [56, 11, 3, 1] },
  { kind: 'barrel', at: [49, 10, 1, 1] },
  { kind: 'barrel', at: [55, 10, 1, 1] },
  { kind: 'crates', at: [60, 12, 1, 1] },
  { kind: 'boulder', at: [12, 12, 1, 1] },
  { kind: 'boulder', at: [18, 12, 1, 1] },
  { kind: 'lighthouse', at: [59, 17, 1, 1] },
  { kind: 'crates', at: [63, 26, 1, 1] },
  { kind: 'barrel', at: [63, 28, 1, 1] },
];

export interface Tree {
  x: number;
  y: number;
  kind: 'oak' | 'pine' | 'palm';
  v: number;
}
export interface Decor {
  x: number;
  y: number;
  s: string;
}
export interface Lobby {
  terrain: Uint8Array;
  /** 1 = nobody can stand here */
  block: Uint8Array;
  trees: Tree[];
  decor: Decor[];
  lamps: [number, number][];
}

export const lidx = (tx: number, ty: number) => ty * LCOLS + tx;
export const linside = (tx: number, ty: number) => tx >= 0 && ty >= 0 && tx < LCOLS && ty < LROWS;

function rng(seed: number) {
  let h = seed | 0;
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let x = Math.imul(h ^ (h >>> 15), 1 | h);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

let built: Lobby | null = null;
export function lobbyMap(): Lobby {
  if (built) return built;
  const R = rng(20261007);
  const terrain = new Uint8Array(LCOLS * LROWS).fill(GRASS);
  const block = new Uint8Array(LCOLS * LROWS);
  const set = (x: number, y: number, t: number, b = -1) => {
    if (!linside(x, y)) return;
    terrain[lidx(x, y)] = t;
    if (b >= 0) block[lidx(x, y)] = b;
  };
  const rect = (x0: number, y0: number, w: number, h: number, t: number, b = -1) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(x, y, t, b);
  };

  // the sea to the east, with a ragged shore, and the open water to the south
  for (let y = 0; y < LROWS; y++) {
    const shore = 61 + Math.round(Math.sin(y * 0.55) * 1.4 + Math.sin(y * 0.21 + 1) * 1.2);
    for (let x = shore; x < LCOLS; x++) set(x, y, WATER, 1);
    for (let x = shore - 2; x < shore; x++) if (terrain[lidx(x, y)] === GRASS) set(x, y, SAND, 0);
  }
  for (let x = 0; x < LCOLS; x++) {
    const shore = 49 + Math.round(Math.sin(x * 0.4) * 0.8);
    for (let y = shore; y < LROWS; y++) set(x, y, WATER, 1);
    if (terrain[lidx(x, shore - 1)] === GRASS) set(x, shore - 1, SAND, 0);
  }
  // a pond to the south west, with a sandy rim
  for (let y = 36; y <= 45; y++)
    for (let x = 8; x <= 21; x++) {
      const d = Math.hypot((x - 14.5) / 7.2, (y - 40.5) / 5.2);
      if (d < 1) set(x, y, WATER, 1);
      else if (d < 1.22 && terrain[lidx(x, y)] === GRASS) set(x, y, SAND, 0);
    }

  // the cave: a cliff face with a dark mouth
  rect(5, 1, 21, 10, CLIFF, 1);
  for (let x = 5; x < 26; x++) {
    const bite = Math.floor(R() * 3);
    for (let y = 1; y < 1 + bite; y++) set(x, y, GRASS, 0); // ragged top edge, hidden by the border trees
  }
  rect(5, 10, 21, 2, CLIFF, 1);
  rect(13, 10, 5, 2, ROAD, 0); // the gap you walk through
  // the market hall
  rect(45, 2, 15, 7, HALL, 1);
  rect(45, 9, 15, 4, PLAZA, 0); // its square

  // the plaza, with the fountain in the middle
  for (let y = 19; y <= 38; y++)
    for (let x = 22; x <= 50; x++) {
      const d = Math.hypot((x - 36) / 13.5, (y - 28.5) / 9.6);
      if (d < 1) set(x, y, PLAZA, 0);
    }
  rect(35, 27, 3, 3, PLAZA, 1); // fountain

  // roads from the plaza to each door
  const road = (x0: number, y0: number, x1: number, y1: number, half = 1) => {
    // L-shaped: along x, then along y
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let k = -half; k <= half; k++) if (terrain[lidx(x, y0 + k)] !== WATER) set(x, y0 + k, terrain[lidx(x, y0 + k)] === PLAZA ? PLAZA : ROAD, 0);
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) for (let k = -half; k <= half; k++) if (terrain[lidx(x1 + k, y)] !== WATER && terrain[lidx(x1 + k, y)] !== CLIFF && terrain[lidx(x1 + k, y)] !== HALL) set(x1 + k, y, terrain[lidx(x1 + k, y)] === PLAZA ? PLAZA : ROAD, 0);
  };
  road(28, 24, 15, 12); // to the cave: west, then north
  road(40, 20, 52, 12); // to the market: east, then north
  road(46, 27, 60, 27, 1); // toward the pier
  // the pier
  rect(57, 26, 13, 3, PLANK, 0);
  // little paths for the shore and the pond
  road(36, 38, 36, 46, 1);

  for (const st of STRUCTURES) rect(st.at[0], st.at[1], st.at[2], st.at[3], terrain[lidx(st.at[0], st.at[1])], 1);

  // trees: a thick wood round the edge, thinner inside, never on a road, the plaza or a door
  const keep: [number, number, number][] = [
    [36, 28, 14], // plaza
    [15, 12, 7],
    [10, 15, 7],
    [52, 11, 9],
    [65, 27, 6],
  ];
  const trees: Tree[] = [];
  const decor: Decor[] = [];
  const free = (x: number, y: number) => linside(x, y) && terrain[lidx(x, y)] === GRASS && !block[lidx(x, y)];
  for (let y = 0; y < LROWS; y++)
    for (let x = 0; x < LCOLS; x++) {
      if (!free(x, y)) continue;
      const edge = Math.min(x, y, LCOLS - 1 - x, LROWS - 1 - y);
      const p = edge < 3 ? 0.75 : edge < 7 ? 0.2 : 0.045;
      let near = false;
      for (const [kx, ky, kr] of keep) if (Math.hypot(x - kx, (y - ky) * 1.3) < kr) near = true;
      // keep every road clear: a road tile within 2 tiles
      for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) if (linside(x + dx, y + dy) && (terrain[lidx(x + dx, y + dy)] === ROAD || terrain[lidx(x + dx, y + dy)] === PLANK)) near = true;
      const r = R();
      if (!near && r < p) {
        trees.push({ x, y, kind: x > 46 && R() < 0.5 ? 'palm' : R() < 0.45 ? 'pine' : 'oak', v: Math.floor(R() * 3) });
        block[lidx(x, y)] = 1;
      } else if (r < 0.2) {
        decor.push({ x, y, s: ['prop-flower-a', 'prop-flower-b', 'prop-flower-c', 'prop-tuft-a', 'prop-tuft-b', 'prop-tuft-c', 'prop-bush-a', 'prop-bush-b', 'prop-stone-a', 'prop-boulder-a'][Math.floor(R() * 10)] });
      }
    }
  // the border is always closed: nobody walks off the map
  for (let x = 0; x < LCOLS; x++) {
    block[lidx(x, 0)] = 1;
    block[lidx(x, LROWS - 1)] = 1;
  }
  for (let y = 0; y < LROWS; y++) {
    block[lidx(0, y)] = 1;
    block[lidx(LCOLS - 1, y)] = 1;
  }
  // a notice board and two benches, and lamps round the plaza
  rect(30, 34, 2, 1, PLAZA, 1);
  rect(41, 34, 2, 1, PLAZA, 1);
  rect(31, 22, 2, 1, PLAZA, 1);
  const lamps: [number, number][] = [
    [28, 24], [44, 24], [28, 33], [44, 33], [36, 19], [36, 38],
    [14, 13], [17, 13], [44, 13], [60, 13], [64, 26], [64, 28], [36, 44],
  ];
  for (const [x, y] of lamps) if (linside(x, y) && !block[lidx(x, y)] && terrain[lidx(x, y)] !== WATER) block[lidx(x, y)] = 1;

  // nothing stands on a door or its way in
  for (const d of DOORS) for (let y = d.y - 1; y <= d.y + d.h + 2; y++) for (let x = d.x - 1; x <= d.x + d.w; x++) if (linside(x, y) && terrain[lidx(x, y)] !== CLIFF && terrain[lidx(x, y)] !== HALL && terrain[lidx(x, y)] !== WATER) block[lidx(x, y)] = block[lidx(x, y)] && trees.some((t) => t.x === x && t.y === y) ? 0 : block[lidx(x, y)];
  const clearTrees = trees.filter((t) => !DOORS.some((d) => t.x >= d.x - 1 && t.x <= d.x + d.w && t.y >= d.y - 1 && t.y <= d.y + d.h + 2));
  built = { terrain, block, trees: clearTrees, decor: decor.filter((d) => !block[lidx(d.x, d.y)]), lamps };
  return built;
}

export const isFree = (m: Lobby, tx: number, ty: number) => linside(tx, ty) && !m.block[lidx(tx, ty)];

/** The tile centre in pixels. */
export const tileCentre = (tx: number, ty: number): [number, number] => [tx * LT + LT / 2, ty * LT + LT / 2];
export const tileOf = (x: number, y: number): [number, number] => [Math.floor(x / LT), Math.floor(y / LT)];
/** Whether the spot a player's feet are on can be stood on. */
export const standable = (m: Lobby, x: number, y: number) => {
  const [tx, ty] = tileOf(x, y);
  return isFree(m, tx, ty);
};

export function doorAt(x: number, y: number): DoorId | null {
  const [tx, ty] = tileOf(x, y);
  for (const d of DOORS) if (tx >= d.x && tx < d.x + d.w && ty >= d.y && ty < d.y + d.h) return d.id;
  return null;
}

/** The closest free tile to (tx, ty), searching in rings. */
export function nearestFree(m: Lobby, tx: number, ty: number): [number, number] | null {
  if (isFree(m, tx, ty)) return [tx, ty];
  for (let r = 1; r < 12; r++) {
    let best: [number, number] | null = null;
    let bd = Infinity;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (!isFree(m, tx + dx, ty + dy)) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) {
          bd = d;
          best = [tx + dx, ty + dy];
        }
      }
    if (best) return best;
  }
  return null;
}

function lineClear(m: Lobby, ax: number, ay: number, bx: number, by: number) {
  const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 4) + 1;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    // the body is wider than a point: check the feet and a hand either side
    if (!standable(m, x, y) || !standable(m, x - 5, y) || !standable(m, x + 5, y)) return false;
  }
  return true;
}

/**
 * Waypoints in pixels from a start to a target, round whatever blocks the way.
 * The same inputs give the same route on every device.
 */
export function lobbyPath(m: Lobby, ax: number, ay: number, bx: number, by: number): [number, number][] {
  const s = nearestFree(m, ...tileOf(ax, ay));
  const goal = nearestFree(m, ...tileOf(bx, by));
  if (!s || !goal) return [];
  // aim at the exact spot when it is standable, otherwise the middle of the nearest free tile
  const end: [number, number] = standable(m, bx, by) ? [bx, by] : tileCentre(goal[0], goal[1]);
  if (lineClear(m, ax, ay, end[0], end[1])) return [end];
  const N = LCOLS * LROWS;
  const g = new Float32Array(N).fill(Infinity);
  const from = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const open: number[] = [];
  const si = lidx(s[0], s[1]);
  const gi = lidx(goal[0], goal[1]);
  g[si] = 0;
  open.push(si);
  const h = (i: number) => Math.hypot((i % LCOLS) - goal[0], Math.floor(i / LCOLS) - goal[1]);
  const f = new Float32Array(N).fill(Infinity);
  f[si] = h(si);
  while (open.length) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k;
    const cur = open.splice(bi, 1)[0];
    if (cur === gi) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cx = cur % LCOLS;
    const cy = Math.floor(cur / LCOLS);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (!isFree(m, nx, ny)) continue;
        // no cutting a corner round a blocked tile
        if (dx && dy && (!isFree(m, cx + dx, cy) || !isFree(m, cx, cy + dy))) continue;
        const ni = lidx(nx, ny);
        if (closed[ni]) continue;
        const ng = g[cur] + (dx && dy ? 1.4142 : 1);
        if (ng < g[ni]) {
          g[ni] = ng;
          from[ni] = cur;
          f[ni] = ng + h(ni);
          open.push(ni);
        }
      }
  }
  if (from[gi] < 0 && gi !== si) return []; // sealed in; stay put
  const tiles: [number, number][] = [];
  for (let i = gi; i !== -1 && i !== si; i = from[i]) tiles.push(tileCentre(i % LCOLS, Math.floor(i / LCOLS)));
  tiles.reverse();
  // string-pull: skip every waypoint you can see past
  const pts: [number, number][] = [[ax, ay], ...tiles, end];
  const out: [number, number][] = [];
  let at = 0;
  while (at < pts.length - 1) {
    let far = pts.length - 1;
    while (far > at + 1 && !lineClear(m, pts[at][0], pts[at][1], pts[far][0], pts[far][1])) far--;
    out.push(pts[far]);
    at = far;
  }
  return out;
}

/** What a player says about themselves is cleaned the same way everywhere. */
export function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const s = raw
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9 _.\-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 14);
  return s.length >= 2 ? s : '';
}
export function cleanChat(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}
