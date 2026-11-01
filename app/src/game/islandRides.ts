/**
 * ORE Island's scooters and carts: the same idea as the lobby's (game/rides.ts), on the island's own room.
 *
 * A fixed fleet parks round the helipad (art.json island.rides, scripts/island_ext.py ride_homes). Anyone can get on
 * a free one; get off and it stays there for everyone; left alone away from home it goes back after RETURN_MS.
 * Changes cross the island room as "rd" (on or off) and "rds" (a snapshot for someone who just arrived); while you
 * ride, your position update carries the ride's id, so it follows you on every screen. Nothing a stranger sends is
 * trusted: ids are checked, spots are put back on land, times are clamped, and senders are rate-limited.
 */
import { create } from 'zustand';
import { ISLE } from '../engine/art';
import { isLand, toLand } from '../engine/island';
import { useBrawl } from './brawl';
import { claimWinner, kindOf, RETURN_MS, type Ride } from './rideRules';
import { islandRideHooks, sendWorldRide, useWorld } from './world';

const HOMES = ((ISLE as unknown as { rides?: [number, number][] }).rides ?? []) as [number, number][];
export const ISLAND_FLEET = HOMES.length;
/** how close (map px) your miner must stand to hop on: the lobby's reach at the island's miner size */
const REACH = 12;

const homeRide = (id: number): Ride => ({ id, kind: kindOf(id), x: HOMES[id][0], y: HOMES[id][1], f: id % 3 === 0 ? -1 : 1, rider: null, at: 0 });
const homeFleet = () => HOMES.map((_, id) => homeRide(id));
const asId = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < ISLAND_FLEET ? v : null);
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const wall = (v: unknown, now: number) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v - now) < 60_000 ? v : now);
/** a parking spot: right there if it is land, else the nearest land */
const park = (x: number, y: number): [number, number] => (isLand(x, y) ? [Math.round(x), Math.round(y)] : toLand(x, y).map(Math.round) as [number, number]);

interface IslandRides {
  rides: Ride[];
  /** the ride I am on, and a free one within reach (for the RIDE button) */
  mine: number | null;
  near: number | null;
  toggle: () => void;
}

let myPos = { x: 0, y: 0, f: 1 as 1 | -1 };
const me = () => useWorld.getState().me;

function setRide(id: number, f: (r: Ride) => Ride) {
  useIslandRides.setState((s) => {
    const rides = s.rides.slice();
    rides[id] = f(rides[id]);
    return { rides };
  });
}
function nearest(x: number, y: number): Ride | null {
  let best: Ride | null = null;
  let bd = REACH;
  for (const r of useIslandRides.getState().rides) {
    if (r.rider) continue;
    const d = Math.hypot(r.x - x, (r.y - y) * 1.3);
    if (d <= bd) {
      bd = d;
      best = r;
    }
  }
  return best;
}

export const useIslandRides = create<IslandRides>(() => ({
  rides: homeFleet(),
  mine: null,
  near: null,
  toggle: () => {
    if (useIslandRides.getState().mine !== null) getOff();
    else {
      const n = nearest(myPos.x, myPos.y);
      if (n) getOn(n.id);
    }
  },
}));

export function getOn(id: number): boolean {
  const s = useIslandRides.getState();
  const r = s.rides[id];
  if (!r || s.mine !== null || r.rider || Math.hypot(r.x - myPos.x, r.y - myPos.y) > REACH + 3) return false;
  const at = Date.now();
  setRide(id, (x) => ({ ...x, rider: me(), at, x: myPos.x, y: myPos.y }));
  useIslandRides.setState({ mine: id, near: null });
  sendWorldRide('rd', { id: me(), r: id, on: 1, at });
  return true;
}

export function getOff() {
  const id = useIslandRides.getState().mine;
  if (id === null) return;
  const [x, y] = park(myPos.x, myPos.y);
  const t = Date.now();
  setRide(id, (r) => ({ ...r, rider: null, x, y, f: myPos.f, at: t }));
  useIslandRides.setState({ mine: null });
  sendWorldRide('rd', { id: me(), r: id, on: 0, x, y, f: myPos.f, at: t });
}

/** The island screen calls this with every position update of my miner. */
export function islandRideMoved(x: number, y: number, f: 1 | -1) {
  myPos = { x, y, f };
  const s = useIslandRides.getState();
  if (s.mine !== null) {
    setRide(s.mine, (r) => ({ ...r, x, y, f }));
    return;
  }
  const n = nearest(x, y);
  const near = n ? n.id : null;
  if (near !== s.near) useIslandRides.setState({ near });
}

/* ---------------- what other players send ---------------- */

const lastFrom = new Map<string, number[]>();
function limited(id: string): boolean {
  const now = Date.now();
  const list = (lastFrom.get(id) ?? []).filter((t) => now - t < 2000);
  list.push(now);
  lastFrom.set(id, list);
  if (lastFrom.size > 400) lastFrom.clear();
  return list.length > 8;
}

islandRideHooks.onRd = (raw) => {
  const p = raw as { id?: unknown; r?: unknown; on?: unknown; at?: unknown; x?: unknown; y?: unknown; f?: unknown };
  if (!p || typeof p.id !== 'string' || p.id.length > 16 || p.id === me() || limited(p.id)) return;
  const id = asId(p.r);
  if (id === null) return;
  const now = Date.now();
  const at = wall(p.at, now);
  const r = useIslandRides.getState().rides[id];
  if (p.on === 1) {
    if (r.rider && r.rider !== p.id) {
      // two claims on one ride: every phone keeps the same winner
      if (claimWinner({ id: r.rider, at: r.at }, { id: p.id, at }) !== p.id) return;
      if (r.rider === me()) useIslandRides.setState({ mine: null });
    }
    setRide(id, (x) => ({ ...x, rider: p.id as string, at }));
  } else if (p.on === 0) {
    if (r.rider && r.rider !== p.id) return;
    if (!r.rider && at < r.at) return;
    const [x, y] = park(num(p.x, r.x), num(p.y, r.y));
    setRide(id, (v) => ({ ...v, rider: null, x, y, f: p.f === -1 ? -1 : 1, at }));
  }
};

islandRideHooks.onPeer = (id, rd, x, y, f) => {
  const rid = rd === undefined || rd === null ? null : asId(rd);
  const s = useIslandRides.getState();
  const was = s.rides.find((r) => r.rider === id);
  if (was && was.id !== rid) {
    const [px, py] = park(x, y);
    setRide(was.id, (r) => ({ ...r, rider: null, x: px, y: py, at: Date.now() }));
  }
  if (rid === null) return;
  const r = useIslandRides.getState().rides[rid];
  if (r.rider && r.rider !== id) return;
  setRide(rid, (v) => ({ ...v, rider: id, x, y, f, at: v.rider === id ? v.at : Date.now() }));
};

/** Someone new arrived: one player (the smallest id here) tells them where the moved rides are. */
let snapTimer: ReturnType<typeof setTimeout> | null = null;
islandRideHooks.onHi = (newId) => {
  if (snapTimer || !ISLAND_FLEET) return;
  const ids = [me(), ...Object.keys(useWorld.getState().peers)].filter((x) => x !== newId).sort();
  if (ids[0] !== me()) return;
  snapTimer = setTimeout(() => {
    snapTimer = null;
    const r = useIslandRides
      .getState()
      .rides.filter((x) => x.rider || x.x !== HOMES[x.id][0] || x.y !== HOMES[x.id][1])
      .map((x) => [x.id, Math.round(x.x), Math.round(x.y), x.f, x.at, x.rider ?? '']);
    if (r.length) sendWorldRide('rds', { id: me(), r });
  }, 300 + Math.random() * 600);
};

islandRideHooks.onRds = (raw) => {
  const p = raw as { id?: unknown; r?: unknown };
  if (!p || !Array.isArray(p.r) || typeof p.id !== 'string' || p.id === me() || limited(p.id)) return;
  const now = Date.now();
  for (const e of p.r.slice(0, ISLAND_FLEET)) {
    if (!Array.isArray(e)) continue;
    const id = asId(e[0]);
    if (id === null) continue;
    const at = wall(e[4], now);
    const cur = useIslandRides.getState().rides[id];
    if (cur.rider === me() || at <= cur.at) continue;
    const rider = typeof e[5] === 'string' && e[5] && e[5].length <= 16 ? e[5] : null;
    const [x, y] = rider ? [num(e[1], cur.x), num(e[2], cur.y)] : park(num(e[1], cur.x), num(e[2], cur.y));
    setRide(id, (v) => ({ ...v, x, y, f: e[3] === -1 ? -1 : 1, at, rider: rider === me() ? null : rider }));
  }
};

islandRideHooks.myRide = () => useIslandRides.getState().mine ?? undefined;

/* ---------------- upkeep ---------------- */

let tick: ReturnType<typeof setInterval> | null = null;
let unBrawl: (() => void) | null = null;
let lastHit = 0;
/** Start keeping the island's rides (the island screen is up). */
export function startIslandRides() {
  if (tick) return;
  useIslandRides.setState({ rides: homeFleet(), mine: null, near: null });
  lastHit = useBrawl.getState().me.hitAt;
  // a hit knocks you off your ride
  unBrawl = useBrawl.subscribe((b) => {
    if (b.me.hitAt > lastHit || b.me.koAt) {
      lastHit = b.me.hitAt;
      if (useIslandRides.getState().mine !== null) getOff();
    }
  });
  tick = setInterval(() => {
    const peers = useWorld.getState().peers;
    const now = Date.now();
    let rides = useIslandRides.getState().rides;
    const start = rides;
    // a rider who left the island: their ride stays where they were last seen
    for (const r of rides) {
      if (!r.rider || r.rider === me() || peers[r.rider]) continue;
      const [x, y] = park(r.x, r.y);
      rides = rides.map((v) => (v.id === r.id ? { ...v, rider: null, x, y, at: now } : v));
    }
    // left alone away from home for a while: back to the helipad
    rides = rides.map((r) => (r.rider || !r.at || now - r.at < RETURN_MS || (r.x === HOMES[r.id][0] && r.y === HOMES[r.id][1]) ? r : { ...homeRide(r.id), at: 0 }));
    if (rides.some((r, i) => r !== start[i])) useIslandRides.setState({ rides });
  }, 1000);
}

export function stopIslandRides() {
  if (useIslandRides.getState().mine !== null) getOff();
  if (tick) clearInterval(tick);
  tick = null;
  unBrawl?.();
  unBrawl = null;
}
