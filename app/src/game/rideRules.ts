/**
 * Rides in the lobby: mine carts and scooters that belong to nobody. Pure rules, no network and no canvas,
 * so every phone works out the same fleet from the same inputs and the tests can check it.
 *
 * - The fleet has fixed ids. Ride k always starts at the same home spot and is always the same kind,
 *   so two players who never talked still agree where the rides are.
 * - How many rides show depends on how many miners are online (fleetSize). A ride someone is on never vanishes.
 * - Anyone can get on any free ride. Get off and it stays where you left it, for everyone.
 * - A ride parked away from home and left alone goes back home after RETURN_MS, so they don't pile up in a corner.
 * - Rides never block anyone: you walk through a parked one. They only refuse to park on a door.
 */
import { DOORS, doorAt, LCOLS, LH, lidx, LROWS, LT, LW, nearestFree, PLAZA, ROAD, SPAWNS, standable, tileCentre, tileOf, type Lobby } from './lobbyMap';

export type RideKind = 'cart' | 'scoot';

export interface Ride {
  id: number;
  kind: RideKind;
  x: number;
  y: number;
  f: 1 | -1;
  /** the player on it (a lobby id), or null when it is parked */
  rider: string | null;
  /** wall clock of the last change (someone got on or off). Newer wins when two phones disagree. */
  at: number;
}

/** The most rides there can ever be, and the fewest that show. */
export const FLEET_MAX = 30;
export const FLEET_MIN = 6;
/** Walking is 58 map px a second; a cart rolls at 1.9x, a scooter at 2.1x. */
export const RIDE_SPEED: Record<RideKind, number> = { cart: 110, scoot: 122 };
/** How close (map px) your miner must stand to hop on. */
export const REACH = 22;
/** A ride left away from home goes back after this long. */
export const RETURN_MS = 15 * 60_000;

/** How many rides show for this many miners online (you included): about one for every two miners, 6 to 30. */
export function fleetSize(online: number): number {
  const n = Math.max(1, Math.floor(online));
  return Math.max(FLEET_MIN, Math.min(FLEET_MAX, 4 + Math.ceil(n / 2)));
}

/** Ride k's kind: carts and scooters alternate, so any fleet size has both. */
export const kindOf = (id: number): RideKind => (id % 2 === 0 ? 'cart' : 'scoot');

// a small fixed-seed generator, so every phone picks the same home spots
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const nearDoorOrSpawn = (tx: number, ty: number) =>
  DOORS.some((d) => tx >= d.x - 2 && tx < d.x + d.w + 2 && ty >= d.y - 2 && ty < d.y + d.h + 2) ||
  Object.values(SPAWNS).some(([sx, sy]) => Math.abs(sx - tx) <= 1 && Math.abs(sy - ty) <= 1);

let homesCache: [number, number][] | null = null;
/**
 * The FLEET_MAX home spots, as map pixels: on open plaza and road tiles (nothing blocking around them), spread out
 * (no two within 3 tiles), never on or next to a door or a spawn. The same list on every phone.
 */
export function homes(m: Lobby): [number, number][] {
  if (homesCache) return homesCache;
  const cand: [number, number][] = [];
  for (let ty = 1; ty < LROWS - 1; ty++)
    for (let tx = 1; tx < LCOLS - 1; tx++) {
      const t = m.terrain[lidx(tx, ty)];
      if (t !== PLAZA && t !== ROAD) continue;
      // open ground all round, so a ride never hides behind a rock, a stall or a lamp
      let open = true;
      for (let dy = -1; dy <= 1 && open; dy++) for (let dx = -1; dx <= 1; dx++) if (m.block[lidx(tx + dx, ty + dy)]) open = false;
      if (open && !nearDoorOrSpawn(tx, ty)) cand.push([tx, ty]);
    }
  const r = rng(7331);
  // shuffle, then take spots that keep their distance
  for (let i = cand.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [cand[i], cand[j]] = [cand[j], cand[i]];
  }
  const out: [number, number][] = [];
  for (const gap of [3, 2, 1]) {
    for (const [tx, ty] of cand) {
      if (out.length >= FLEET_MAX) break;
      const [x, y] = tileCentre(tx, ty);
      if (out.some(([ox, oy]) => Math.abs(ox - x) < gap * LT && Math.abs(oy - y) < gap * LT)) continue;
      out.push([x, y]);
    }
    if (out.length >= FLEET_MAX) break;
  }
  homesCache = out;
  return out;
}

/** A ride where it starts: at home, parked, facing a fixed way. */
export function homeRide(m: Lobby, id: number): Ride {
  const [x, y] = homes(m)[id % homes(m).length];
  return { id, kind: kindOf(id), x, y, f: id % 3 === 0 ? -1 : 1, rider: null, at: 0 };
}

/** The whole fleet at home. */
export const homeFleet = (m: Lobby): Ride[] => Array.from({ length: FLEET_MAX }, (_, id) => homeRide(m, id));

/**
 * Where a ride may be left when its rider gets off at (x, y): right there, unless that is a door or a spot
 * nobody can stand on, then the nearest free tile that is not a door.
 */
export function parkSpot(m: Lobby, x: number, y: number): [number, number] {
  const cx = Math.max(0, Math.min(LW - 1, x));
  const cy = Math.max(0, Math.min(LH - 1, y));
  if (standable(m, cx, cy) && !doorAt(cx, cy)) return [Math.round(cx), Math.round(cy)];
  const [tx, ty] = tileOf(cx, cy);
  // step down off a door (doors face down onto the plaza), then find the nearest free tile
  for (let dy = 0; dy < 6; dy++) {
    const f = nearestFree(m, tx, ty + dy);
    if (f) {
      const [px, py] = tileCentre(f[0], f[1]);
      if (!doorAt(px, py)) return [px, py];
    }
  }
  return homes(m)[0];
}

/** Which rides show: the first fleetSize(online) ids, plus any ride someone is on. */
export function visible(rides: Ride[], online: number): Ride[] {
  const n = fleetSize(online);
  return rides.filter((r) => r.id < n || r.rider !== null);
}

/** The nearest free, visible ride within reach of (x, y), or null. */
export function nearestRide(rides: Ride[], online: number, x: number, y: number): Ride | null {
  let best: Ride | null = null;
  let bd = REACH;
  for (const r of visible(rides, online)) {
    if (r.rider) continue;
    const d = Math.hypot(r.x - x, r.y - y);
    if (d <= bd) {
      bd = d;
      best = r;
    }
  }
  return best;
}

/**
 * Two players got on the same ride at nearly the same moment: who keeps it. The earlier claim wins;
 * on a tie the smaller id, so both phones pick the same winner without talking again.
 */
export function claimWinner(a: { id: string; at: number }, b: { id: string; at: number }): string {
  if (a.at !== b.at) return a.at < b.at ? a.id : b.id;
  return a.id < b.id ? a.id : b.id;
}

/** Rides parked away from home and untouched for RETURN_MS go back home. Returns the same array if nothing moved. */
export function sendHome(m: Lobby, rides: Ride[], now: number): Ride[] {
  let changed = false;
  const out = rides.map((r) => {
    if (r.rider || !r.at || now - r.at < RETURN_MS) return r;
    const h = homeRide(m, r.id);
    if (h.x === r.x && h.y === r.y) return r;
    changed = true;
    return { ...h, at: 0 };
  });
  return changed ? out : rides;
}

/** A ride id from the network: an integer in the fleet, or null. */
export const asRideId = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < FLEET_MAX ? v : null);
