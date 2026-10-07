/**
 * Dig: the small game inside a spot's mine.
 *
 * Tap a rock to swing your pickaxe at it. Break it and it shows what was behind:
 * plain rock, a gold nugget, or the wall's one gem. Find the gem and you go a level
 * deeper. Everything it pays is XP for the same miner level the rest of the game
 * uses. It never touches SOL, ORE, odds or claims.
 *
 * Swings are the only resource: a free set every day, and more for each live round
 * you mine. Pure rules, no storage and no wallet state, so they can be tested alone.
 */
export const DIG_COLS = 4;
export const DIG_TILES = 16;
/** Free swings at the start of each day (device local date). */
export const DAILY_SWINGS = 30;
/** Extra swings for each live round you deploy in. */
export const ROUND_SWINGS = 10;
/** Swings never pile up past this. */
export const MAX_SWINGS = 99;
export const XP_ROCK = 1;
export const XP_NUGGET = 5;
export const XP_GEM = 25;
const NUGGETS = 3;

export type Find = 'rock' | 'nugget' | 'gem';
export interface Tile {
  /** Hits it takes when fresh: 1 soft, 2 stone, 3 hard. */
  max: number;
  /** Hits left. 0 means broken, and `find` is showing. */
  hp: number;
  find: Find;
}
export interface Wall {
  day: string;
  spot: number;
  depth: number;
  tiles: Tile[];
}
export interface DigState {
  day: string;
  swings: number;
  /** XP dug up today, for the summary line. */
  xpToday: number;
  wall: Wall | null;
}

/** Small seeded generator, so a wall is the same every time it is rebuilt from (day, spot, depth). */
function rng(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let x = Math.imul(h ^ (h >>> 15), 1 | h);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function newWall(day: string, spot: number, depth: number): Wall {
  const r = rng(`${day}:${spot}:${depth}`);
  const order = [...Array(DIG_TILES).keys()];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const finds: Find[] = Array(DIG_TILES).fill('rock');
  finds[order[0]] = 'gem';
  for (let k = 1; k <= NUGGETS; k++) finds[order[k]] = 'nugget';
  // deeper walls are a little harder: more stone and hard rock
  const hard = Math.min(0.5, 0.15 + depth * 0.05);
  const tiles = finds.map((find) => {
    const roll = r();
    const max = roll < hard ? 3 : roll < hard + 0.35 ? 2 : 1;
    return { max, hp: max, find };
  });
  return { day, spot, depth, tiles };
}

export const freshDig = (day: string): DigState => ({ day, swings: DAILY_SWINGS, xpToday: 0, wall: null });

/** A new day refills the free swings and starts the walls again from the surface. */
export function rollDigDay(s: DigState, day: string): DigState {
  return s.day === day ? s : freshDig(day);
}

export const addSwings = (s: DigState, n: number): DigState => ({ ...s, swings: Math.min(MAX_SWINGS, s.swings + Math.max(0, Math.floor(n))) });

export const gemFound = (w: Wall | null) => Boolean(w && w.tiles.some((t) => t.find === 'gem' && t.hp === 0));

/** Open the wall for a spot. Keeps the wall in progress if it is the same spot. */
export function enter(s: DigState, spot: number): DigState {
  if (s.wall && s.wall.spot === spot && s.wall.day === s.day) return s;
  return { ...s, wall: newWall(s.day, spot, 1) };
}

/** After the gem: the next wall down on the same spot. */
export function deeper(s: DigState): DigState {
  if (!s.wall || !gemFound(s.wall)) return s;
  return { ...s, wall: newWall(s.day, s.wall.spot, s.wall.depth + 1) };
}

export interface HitResult {
  state: DigState;
  /** XP this swing earned (0 while the rock still stands). */
  xp: number;
  /** What the swing uncovered, or null if the rock is still standing or nothing happened. */
  found: Find | null;
  /** False when the swing did nothing: no swings left, tile already broken, or no wall. */
  ok: boolean;
}

/** One swing at a tile. Costs one swing whether or not the rock breaks. */
export function hit(s: DigState, index: number): HitResult {
  const w = s.wall;
  const t = w?.tiles[index];
  if (!w || !t || t.hp <= 0 || s.swings <= 0 || gemFound(w)) return { state: s, xp: 0, found: null, ok: false };
  const hp = t.hp - 1;
  const tiles = w.tiles.map((x, i) => (i === index ? { ...x, hp } : x));
  const found = hp === 0 ? t.find : null;
  const xp = found === 'gem' ? XP_GEM : found === 'nugget' ? XP_NUGGET : found === 'rock' ? XP_ROCK : 0;
  return { state: { ...s, swings: s.swings - 1, xpToday: s.xpToday + xp, wall: { ...w, tiles } }, xp, found, ok: true };
}

/** Read a saved state back, refusing anything that is not the shape written above. */
export function parseDig(raw: string | null, day: string): DigState {
  if (!raw) return freshDig(day);
  try {
    const p = JSON.parse(raw) as DigState;
    const okNum = (v: unknown, hi: number) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= hi;
    if (!p || typeof p.day !== 'string' || !okNum(p.swings, MAX_SWINGS) || !okNum(p.xpToday, 1_000_000)) return freshDig(day);
    let wall: Wall | null = null;
    const w = p.wall;
    if (w && typeof w.day === 'string' && okNum(w.spot, 24) && okNum(w.depth, 10_000) && w.depth >= 1 && Array.isArray(w.tiles) && w.tiles.length === DIG_TILES) {
      // the layout is rebuilt from its seed; only the damage is trusted from the save
      const base = newWall(w.day, w.spot, w.depth);
      wall = { ...base, tiles: base.tiles.map((t, i) => ({ ...t, hp: okNum(w.tiles[i]?.hp, t.max) ? w.tiles[i].hp : t.max })) };
    }
    return rollDigDay({ day: p.day, swings: p.swings, xpToday: p.xpToday, wall }, day);
  } catch {
    return freshDig(day);
  }
}
