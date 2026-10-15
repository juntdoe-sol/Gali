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

/** The three mini games are doors too: walk into a pavilion and its game opens. Their ids are the game ids. */
export type DoorId = 'island' | 'cave' | 'market' | 'tunnel' | 'pot' | 'crash' | 'arena';
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
  { id: 'island', x: 66, y: 26, w: 3, h: 3, label: 'ORE ISLAND', sub: 'Mine ORE' },
  { id: 'cave', x: 14, y: 10, w: 3, h: 1, label: 'CAVE RUN', sub: 'Dig for XP' },
  { id: 'market', x: 51, y: 9, w: 3, h: 1, label: 'MARKET', sub: 'Gear and items' },
  { id: 'tunnel', x: 26, y: 42, w: 3, h: 1, label: 'TUNNEL', sub: 'ORE and SKR' },
  { id: 'pot', x: 35, y: 42, w: 3, h: 1, label: 'GOLD RUSH', sub: 'ORE and SKR' },
  { id: 'crash', x: 44, y: 42, w: 3, h: 1, label: 'CRASH CART', sub: 'ORE and SKR' },
  { id: 'arena', x: 7, y: 30, w: 3, h: 1, label: 'ARENA', sub: 'Brawl' },
];
/** The three pavilions on the games row: the body tiles that block, above each door. */
export const PAVILIONS: { id: 'tunnel' | 'pot' | 'crash'; x: number; y: number; w: number; h: number }[] = [
  { id: 'tunnel', x: 26, y: 38, w: 3, h: 4 },
  { id: 'pot', x: 35, y: 38, w: 3, h: 4 },
  { id: 'crash', x: 44, y: 38, w: 3, h: 4 },
];

/** Where you appear, as a tile, for each way into the lobby. */
export const SPAWNS: Record<'start' | DoorId, [number, number]> = {
  start: [36, 35],
  island: [61, 27],
  cave: [15, 13],
  market: [52, 12],
  tunnel: [27, 44],
  pot: [36, 44],
  crash: [45, 44],
  arena: [8, 33],
};

/** Things with a shape of their own: a tent, a stall, the lighthouse. The engine draws each; the tiles under them block. */
export interface Structure {
  kind: 'tent' | 'fire' | 'cart' | 'crates' | 'barrel' | 'stall-red' | 'stall-teal' | 'lighthouse' | 'rack' | 'boulder' | 'sol-crystal' | 'ore-vein' | 'arena' | 'sign' | 'flag';
  /** tiles that block: x, y, width, height */
  at: [number, number, number, number];
  /** which flag, for a flagpole */
  v?: 'us' | 'my' | 'id' | 'ng';
}
export const STRUCTURES: Structure[] = [
  // the Brawl arena: a round stone colosseum, its gate on the south side, a cobbled drive up to it
  { kind: 'arena', at: [3, 24, 11, 6] },
  // a directory board by the fountain: every place, and an arrow to it
  { kind: 'sign', at: [32, 19, 2, 1] },
  // the flag square between Cave Run and the market: where our miners come from
  { kind: 'flag', at: [31, 8, 1, 1], v: 'us' },
  { kind: 'flag', at: [33, 8, 1, 1], v: 'my' },
  { kind: 'flag', at: [35, 8, 1, 1], v: 'id' },
  { kind: 'flag', at: [37, 8, 1, 1], v: 'ng' },
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
  { kind: 'sol-crystal', at: [30, 28, 1, 1] },
  { kind: 'ore-vein', at: [41, 30, 1, 1] },
  { kind: 'ore-vein', at: [14, 17, 1, 1] },
];

/**
 * Things a miner can smash with a swing: pots, crates, barrels. No XP, but breaking one gives back some HP
 * (see SMASH_HEAL), so a hurt fighter can patch up between brawls. They always block
 * their tile (broken, they leave rubble, then grow back), so every phone still walks the same routes.
 */
export interface Smashable {
  kind: 'pot' | 'crate' | 'barrel';
  x: number;
  y: number;
  /** swings to break it */
  hp: number;
}
/** HP a miner gets back for breaking one */
export const SMASH_HEAL: Record<Smashable['kind'], number> = { pot: 10, crate: 15, barrel: 15 };
export const SMASHABLES: Smashable[] = [
  // the arena forecourt
  { kind: 'barrel', x: 4, y: 30, hp: 2 },
  { kind: 'crate', x: 4, y: 31, hp: 2 },
  { kind: 'pot', x: 12, y: 30, hp: 1 },
  { kind: 'pot', x: 13, y: 30, hp: 1 },
  // round the plaza
  { kind: 'pot', x: 25, y: 27, hp: 1 },
  { kind: 'pot', x: 26, y: 29, hp: 1 },
  { kind: 'crate', x: 45, y: 23, hp: 2 },
  { kind: 'barrel', x: 46, y: 23, hp: 2 },
  { kind: 'pot', x: 45, y: 31, hp: 1 },
  { kind: 'crate', x: 27, y: 31, hp: 2 },
  // the market square and the shore
  { kind: 'pot', x: 47, y: 12, hp: 1 },
  { kind: 'crate', x: 58, y: 12, hp: 2 },
  { kind: 'barrel', x: 60, y: 24, hp: 2 },
  // the games row
  { kind: 'pot', x: 25, y: 41, hp: 1 },
  { kind: 'barrel', x: 48, y: 41, hp: 2 },
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
  road(24, 32, 8, 31, 1); // the drive to the arena: west along the pond, then up to the gate
  rect(4, 30, 9, 2, PLAZA, 0); // the arena forecourt
  rect(29, 7, 11, 3, PLAZA, 0); // the flag square, up in the woods
  road(34, 10, 34, 19, 1); // and the path down through the trees to the plaza
  road(40, 20, 52, 12); // to the market: east, then north
  road(46, 27, 60, 27, 1); // toward the pier
  // the pier
  rect(57, 26, 13, 3, PLANK, 0);
  // little paths for the shore and the pond
  road(36, 38, 36, 46, 1);
  // the games row: a road along the front of three pavilions, and a path down to it either side of the middle one
  rect(24, 42, 25, 3, ROAD, 0);
  rect(31, 38, 2, 4, ROAD, 0);
  rect(40, 38, 2, 4, ROAD, 0);
  for (const pv of PAVILIONS) rect(pv.x, pv.y, pv.w, pv.h, terrain[lidx(pv.x, pv.y)], 1);

  for (const st of STRUCTURES) rect(st.at[0], st.at[1], st.at[2], st.at[3], terrain[lidx(st.at[0], st.at[1])], 1);
  for (const sm of SMASHABLES) block[lidx(sm.x, sm.y)] = 1;

  // trees: a thick wood round the edge, thinner inside, never on a road, the plaza or a door
  const keep: [number, number, number][] = [
    [36, 28, 14], // plaza
    [15, 12, 7],
    [10, 15, 7],
    [52, 11, 9],
    [65, 27, 6],
    [36, 42, 15], // the games row
    [8, 28, 9], // the arena and its forecourt
    [34, 8, 4], // the flag square: a clearing, with the woods close round it
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
  // the flag square sits deep in the woods: a ring of trees round the clearing, open only to the path
  for (const [x, y, k] of [
    [27, 6, 'pine'], [28, 5, 'oak'], [30, 5, 'pine'], [32, 5, 'oak'], [34, 5, 'pine'], [36, 5, 'oak'], [38, 5, 'pine'], [40, 5, 'oak'], [41, 6, 'pine'],
    [27, 8, 'oak'], [27, 10, 'pine'], [41, 8, 'oak'], [41, 10, 'pine'],
    [29, 11, 'oak'], [31, 11, 'pine'], [37, 11, 'pine'], [39, 11, 'oak'], [30, 13, 'pine'], [38, 13, 'oak'],
  ] as [number, number, Tree['kind']][]) {
    if (free(x, y)) {
      trees.push({ x, y, kind: k, v: (x + y) % 3 });
      block[lidx(x, y)] = 1;
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
    [28, 24], [44, 24], [28, 33], [44, 33], [36, 19],
    [14, 13], [17, 13], [44, 13], [60, 13], [64, 26], [64, 28], [31, 44], [41, 44], [23, 44], [49, 44],
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

/**
 * Chat stickers: a message that is exactly `[s:<id>]` shows as an animated pixel sticker
 * (assets/stickers/<id>.png). Over a miner's head, and in older builds, it reads as its caption.
 */
export const STICKERS: { id: string; caption: string }[] = [
  { id: 'gm', caption: 'GM' },
  { id: 'letsmine', caption: "LET'S MINE" },
  { id: 'lfg', caption: 'LFG' },
  { id: 'gold', caption: 'GOLD!' },
  { id: 'motherlode', caption: 'MOTHERLODE!' },
  { id: 'wagmi', caption: 'WAGMI' },
  { id: 'bonk', caption: 'BONK!' },
  { id: 'rekt', caption: 'REKT' },
  { id: 'gg', caption: 'GG' },
  { id: 'gn', caption: 'GN' },
];
const STICKER_RE = /^\[s:([a-z]{2,12})\]$/;
/** The sticker id a chat line carries, or null for plain text. */
export function stickerOf(text: string): string | null {
  const m = STICKER_RE.exec(text.trim());
  return m && STICKERS.some((s) => s.id === m[1]) ? m[1] : null;
}
/** A chat line as words: a sticker becomes its caption. */
export function chatWords(text: string): string {
  const id = stickerOf(text);
  return id ? (STICKERS.find((s) => s.id === id)?.caption ?? text) : text;
}
