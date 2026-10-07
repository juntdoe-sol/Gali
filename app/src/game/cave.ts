/**
 * Cave Run: the rules that do not need a screen.
 *
 * You walk your miner through a dark cave under a spot. Break rocks to open a way,
 * pick up what falls out, find the ladder and climb down to a harder floor. Bats and
 * falling rock cost hearts, and the lantern burns down the whole time.
 *
 * Everything it pays is XP for the same miner level the rest of the game uses. It never
 * touches SOL, ORE, odds or claims. Runs are the only resource: a free set each day and
 * one more for every live round you mine.
 *
 * Pure: no storage, no wallet, no canvas. The engine draws it, the store saves it.
 */
export const CAVE_COLS = 13;
export const CAVE_ROWS = 19;
export const TILE = 16;

/** Free runs at the start of each day (device local date). */
export const DAILY_RUNS = 3;
/** Extra runs for each live round you deploy in. */
export const ROUND_RUNS = 1;
/** Runs never pile up past this. */
export const MAX_RUNS = 9;

export const XP_ROCK = 1;
export const XP_NUGGET = 5;
export const XP_GEM = 25;
export const XP_BAT = 3;
/** Bonus for climbing down, times the floor you just cleared. */
export const XP_FLOOR = 10;

export const HEARTS = 3;
export const OIL_MAX = 80;
export const OIL_START = 60;
export const OIL_CAN = 12;
export const OIL_FLOOR = 15;

export const FLOOR = 0;
export const WALL = 1;
export const ROCK = 2;
export type Loot = '' | 'nugget' | 'gem' | 'oil' | 'heart';

export interface Level {
  depth: number;
  /** FLOOR, WALL or ROCK for each cell, row by row. */
  cells: number[];
  /** Hits left on each rock (0 elsewhere). */
  hp: number[];
  /** Hits each rock took when fresh: 1 soft, 2 stone, 3 hard. */
  max: number[];
  /** What a rock drops when it breaks. */
  loot: Loot[];
  start: [number, number];
  ladder: [number, number];
  /** Cells the bats start in. */
  bats: [number, number][];
}

export const idx = (cx: number, cy: number) => cy * CAVE_COLS + cx;
export const inside = (cx: number, cy: number) => cx >= 0 && cy >= 0 && cx < CAVE_COLS && cy < CAVE_ROWS;

/** A small seeded generator, so a test can build the same cave twice. */
export function seededRand(seed: number) {
  let h = seed | 0;
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let x = Math.imul(h ^ (h >>> 15), 1 | h);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cells you could reach from `from` if every rock were broken. */
export function reachable(cells: number[], from: [number, number]): boolean[] {
  const seen: boolean[] = Array(cells.length).fill(false);
  const queue: [number, number][] = [from];
  seen[idx(from[0], from[1])] = true;
  while (queue.length) {
    const [x, y] = queue.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inside(nx, ny) || seen[idx(nx, ny)] || cells[idx(nx, ny)] === WALL) continue;
      seen[idx(nx, ny)] = true;
      queue.push([nx, ny]);
    }
  }
  return seen;
}

export function makeLevel(depth: number, rand: () => number = Math.random): Level {
  const n = CAVE_COLS * CAVE_ROWS;
  const pick = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const start: [number, number] = [Math.floor(CAVE_COLS / 2), CAVE_ROWS - 3];
  const ladder: [number, number] = [pick(2, CAVE_COLS - 3), pick(1, 2)];
  for (let attempt = 0; ; attempt++) {
    const cells: number[] = Array(n).fill(ROCK);
    for (let y = 0; y < CAVE_ROWS; y++)
      for (let x = 0; x < CAVE_COLS; x++) if (x === 0 || y === 0 || x === CAVE_COLS - 1 || y === CAVE_ROWS - 1) cells[idx(x, y)] = WALL;
    // pillars: solid stone you have to dig around (none on the last attempts, so a cave always works)
    if (attempt < 4) {
      for (let y = 2; y < CAVE_ROWS - 2; y++)
        for (let x = 2; x < CAVE_COLS - 2; x++) {
          if (rand() > 0.09) continue;
          let near = false;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (cells[idx(x + dx, y + dy)] === WALL) near = true;
          if (!near) cells[idx(x, y)] = WALL;
        }
    }
    // the room you start in
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) cells[idx(start[0] + dx, start[1] + dy)] = FLOOR;
    // open caverns: short random walks
    const open: [number, number][] = [];
    const caverns = 3 + Math.min(2, Math.floor(depth / 2));
    for (let k = 0; k < caverns; k++) {
      let x = pick(2, CAVE_COLS - 3);
      let y = pick(3, CAVE_ROWS - 6);
      for (let step = 0; step < pick(5, 9); step++) {
        if (cells[idx(x, y)] !== WALL) {
          cells[idx(x, y)] = FLOOR;
          open.push([x, y]);
        }
        const d = pick(0, 3);
        x = Math.max(1, Math.min(CAVE_COLS - 2, x + (d === 0 ? 1 : d === 1 ? -1 : 0)));
        y = Math.max(3, Math.min(CAVE_ROWS - 6, y + (d === 2 ? 1 : d === 3 ? -1 : 0)));
      }
    }
    cells[idx(ladder[0], ladder[1])] = FLOOR;
    const reach = reachable(cells, start);
    if (!reach[idx(ladder[0], ladder[1])]) continue;

    const hard = Math.min(0.45, 0.08 + depth * 0.06);
    const hp: number[] = Array(n).fill(0);
    const rocks: number[] = [];
    for (let i = 0; i < n; i++) {
      if (cells[i] !== ROCK) continue;
      const roll = rand();
      hp[i] = roll < hard ? 3 : roll < hard + 0.35 ? 2 : 1;
      if (reach[i]) rocks.push(i);
    }
    for (let i = rocks.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [rocks[i], rocks[j]] = [rocks[j], rocks[i]];
    }
    const loot: Loot[] = Array(n).fill('');
    const drops: Loot[] = [
      ...Array(depth >= 3 ? 2 : 1).fill('gem'),
      ...Array(7).fill('nugget'),
      'oil',
      'oil',
      ...(depth >= 2 ? ['heart'] : []),
    ] as Loot[];
    drops.forEach((d, k) => {
      if (k < rocks.length) loot[rocks[k]] = d;
    });
    // bats wait in the open, well away from where you come in
    const far = open.filter(([x, y]) => Math.abs(x - start[0]) + Math.abs(y - start[1]) > 6);
    const bats: [number, number][] = [];
    for (let k = 0; k < Math.min(6, depth); k++) bats.push(far.length ? far[pick(0, far.length - 1)] : ladder);
    return { depth, cells, hp, max: hp.slice(), loot, start, ladder, bats };
  }
}

/** Seconds between falling rocks on a floor; 0 means none (the first floor is calm). */
export const rockfallEvery = (depth: number) => (depth < 2 ? 0 : Math.max(1.6, 4.4 - depth * 0.4));
export const batSpeed = (depth: number) => Math.min(50, 24 + depth * 3);

/* ---------------- runs: what the app saves ---------------- */
export interface CaveSave {
  day: string;
  runs: number;
  /** Deepest floor ever reached. */
  best: number;
}

export const freshCave = (day: string, best = 0): CaveSave => ({ day, runs: DAILY_RUNS, best });
/** A new day brings the free runs back. Unused bonus runs do not carry over. */
export const rollCaveDay = (s: CaveSave, day: string): CaveSave => (s.day === day ? s : freshCave(day, s.best));
export const addRuns = (s: CaveSave, n: number): CaveSave => ({ ...s, runs: Math.min(MAX_RUNS, s.runs + Math.max(0, Math.floor(n))) });
/** Spend one run. Returns the same state when there are none. */
export const spendRun = (s: CaveSave): CaveSave => (s.runs > 0 ? { ...s, runs: s.runs - 1 } : s);
export const recordDepth = (s: CaveSave, depth: number): CaveSave => (Number.isInteger(depth) && depth > s.best && depth < 1000 ? { ...s, best: depth } : s);

export function parseCave(raw: string | null, day: string): CaveSave {
  if (!raw) return freshCave(day);
  try {
    const p = JSON.parse(raw) as CaveSave;
    const ok = (v: unknown, hi: number) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= hi;
    if (!p || typeof p.day !== 'string' || !ok(p.runs, MAX_RUNS) || !ok(p.best, 999)) return freshCave(day);
    return rollCaveDay({ day: p.day, runs: p.runs, best: p.best }, day);
  } catch {
    return freshCave(day);
  }
}
