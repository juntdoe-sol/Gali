/**
 * The lobby's public rides, kept in step between players.
 *
 * Everyone starts from the same fleet at home (rideRules). After that only changes cross the lobby room:
 * "rd" when someone gets on or off, and a snapshot ("rds") for a player who just walked in. While you ride,
 * your normal position update carries the ride's id, so the ride follows you on every screen with no extra
 * messages. Nothing here touches SOL, ORE or a wallet, and nothing a stranger sends is trusted: ids, spots
 * and times are clamped, a park spot is re-checked against the map, and each sender is rate-limited.
 */
import { create } from 'zustand';
import { useBrawl } from './brawl';
import { lobbyMap, LH, LW, SPAWNS, tileCentre, type DoorId } from './lobbyMap';
import { lobbyRoom, rideHooks, useLobby } from './lobby';
import { asRideId, claimWinner, FLEET_MAX, homeFleet, nearestRide, parkSpot, REACH, sendHome, visible, type Ride } from './rideRules';

interface RideState {
  rides: Ride[];
  /** the ride I am on */
  mine: number | null;
  /** a free ride within reach of my miner (for the RIDE button) */
  near: number | null;
  /** E or the RIDE button: get on the nearest ride, or off the one I'm on */
  toggle: () => void;
}

let myPos = { x: 0, y: 0, f: 1 as 1 | -1 };
let onBumped: (() => void) | null = null;
/** The lobby screen sets this to tell the player they lost a ride to someone quicker. */
export function onRideBumped(f: (() => void) | null) {
  onBumped = f;
}

const online = () => Object.keys(useLobby.getState().peers).length + 1;
const me = () => useLobby.getState().me;
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
/** a time from another phone: trusted only within a minute of ours */
const wall = (v: unknown, now: number) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v - now) < 60_000 ? v : now);

function setRide(id: number, f: (r: Ride) => Ride) {
  useRides.setState((s) => {
    const rides = s.rides.slice();
    rides[id] = f(rides[id]);
    return { rides };
  });
}

export const useRides = create<RideState>(() => ({
  rides: homeFleet(lobbyMap()),
  mine: null,
  near: null,
  toggle: () => {
    if (useRides.getState().mine !== null) getOff();
    else {
      const n = nearestRide(useRides.getState().rides, online(), myPos.x, myPos.y);
      if (n) getOn(n.id);
    }
  },
}));

/** Get on ride `id`, if it is free, showing and within reach. */
export function getOn(id: number): boolean {
  const s = useRides.getState();
  const r = s.rides[id];
  if (!r || s.mine !== null || r.rider) return false;
  if (!visible([r], online()).length || Math.hypot(r.x - myPos.x, r.y - myPos.y) > REACH + 4) return false;
  // dancing stops when you get on
  if (useLobby.getState().myDance) useLobby.getState().setDance(0);
  const at = Date.now();
  setRide(id, (x) => ({ ...x, rider: me(), at, x: myPos.x, y: myPos.y }));
  useRides.setState({ mine: id, near: null });
  lobbyRoom.send('rd', { id: me(), r: id, on: 1, at });
  return true;
}

/** Get off where you are; the ride stays there for everyone (nudged off a door). */
export function getOff(at?: { x: number; y: number }) {
  const id = useRides.getState().mine;
  if (id === null) return;
  const m = lobbyMap();
  const [x, y] = parkSpot(m, at?.x ?? myPos.x, at?.y ?? myPos.y);
  const t = Date.now();
  setRide(id, (r) => ({ ...r, rider: null, x, y, f: myPos.f, at: t }));
  useRides.setState({ mine: null });
  lobbyRoom.send('rd', { id: me(), r: id, on: 0, x, y, f: myPos.f, at: t });
}

/** Leaving the lobby through a door while riding: the ride waits just outside that door. */
export function parkAtDoor(door: DoorId) {
  if (useRides.getState().mine === null) return;
  const [x, y] = tileCentre(...SPAWNS[door]);
  getOff({ x, y });
}

/** The lobby screen calls this with every position update of my miner. */
export function rideMoved(x: number, y: number, f: 1 | -1) {
  myPos = { x, y, f };
  const s = useRides.getState();
  if (s.mine !== null) {
    setRide(s.mine, (r) => ({ ...r, x, y, f }));
    return;
  }
  const n = nearestRide(s.rides, online(), x, y);
  const near = n ? n.id : null;
  if (near !== s.near) useRides.setState({ near });
}

/** The ride id to send with my position update, or undefined when walking. */
export const myRideId = () => useRides.getState().mine ?? undefined;

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

/** Someone got on or off a ride. */
export function onRd(p: any) {
  if (!p || typeof p.id !== 'string' || p.id.length > 40 || p.id === me() || limited(p.id)) return;
  const id = asRideId(p.r);
  if (id === null) return;
  const now = Date.now();
  const at = wall(p.at, now);
  const r = useRides.getState().rides[id];
  if (p.on === 1) {
    if (r.rider && r.rider !== p.id) {
      // two claims on one ride: both phones keep the same winner
      const win = claimWinner({ id: r.rider, at: r.at }, { id: p.id, at });
      if (win !== p.id) return;
      if (r.rider === me()) {
        useRides.setState({ mine: null });
        onBumped?.();
      }
    }
    setRide(id, (x) => ({ ...x, rider: p.id, at }));
  } else if (p.on === 0) {
    // only its rider (or nobody's ride, if this is newer) can park it
    if (r.rider && r.rider !== p.id) return;
    if (!r.rider && at < r.at) return;
    const [x, y] = parkSpot(lobbyMap(), num(p.x, 0, LW - 1, r.x), num(p.y, 0, LH - 1, r.y));
    setRide(id, (v) => ({ ...v, rider: null, x, y, f: p.f === -1 ? -1 : 1, at }));
  }
}

/** A position update from another player: if it carries a ride, that ride goes where they go. */
export function onPeerRide(id: string, rd: unknown, x: number, y: number, f: 1 | -1) {
  const rid = rd === undefined || rd === null ? null : asRideId(rd);
  const s = useRides.getState();
  const was = s.rides.find((r) => r.rider === id);
  if (was && was.id !== rid) {
    // they are off it (we missed the message): park it where they are
    const [px, py] = parkSpot(lobbyMap(), x, y);
    setRide(was.id, (r) => ({ ...r, rider: null, x: px, y: py, at: Date.now() }));
  }
  if (rid === null) return;
  const r = useRides.getState().rides[rid];
  if (r.rider && r.rider !== id) return; // someone else holds it; the claim messages sort it out
  setRide(rid, (v) => ({ ...v, rider: id, x, y, f, at: v.rider === id ? v.at : Date.now() }));
}

/** Someone new walked in: one player (the smallest id here) tells them where the moved rides are. */
let snapTimer: ReturnType<typeof setTimeout> | null = null;
export function onHi(newId: unknown) {
  if (typeof newId !== 'string' || snapTimer) return;
  const ids = [me(), ...Object.keys(useLobby.getState().peers)].filter((x) => x !== newId).sort();
  if (ids[0] !== me()) return;
  snapTimer = setTimeout(() => {
    snapTimer = null;
    const home = homeFleet(lobbyMap());
    const r = useRides
      .getState()
      .rides.filter((x) => x.rider || x.x !== home[x.id].x || x.y !== home[x.id].y)
      .map((x) => [x.id, Math.round(x.x), Math.round(x.y), x.f, x.at, x.rider ?? '']);
    if (r.length) lobbyRoom.send('rds', { id: me(), to: newId, r });
  }, 300 + Math.random() * 600);
}

/** The snapshot for newcomers: keep whatever is newer than what we have. */
export function onRds(p: any) {
  // it goes to everyone (two newcomers a moment apart share one snapshot); each phone keeps only what is newer
  if (!p || !Array.isArray(p.r) || typeof p.id !== 'string' || p.id === me() || limited(p.id)) return;
  const now = Date.now();
  const m = lobbyMap();
  for (const e of p.r.slice(0, FLEET_MAX)) {
    if (!Array.isArray(e)) continue;
    const id = asRideId(e[0]);
    if (id === null) continue;
    const at = wall(e[4], now);
    const cur = useRides.getState().rides[id];
    if (cur.rider === me() || at <= cur.at) continue;
    const rider = typeof e[5] === 'string' && e[5] && e[5].length <= 40 ? e[5] : null;
    const [x, y] = rider ? [num(e[1], 0, LW - 1, cur.x), num(e[2], 0, LH - 1, cur.y)] : parkSpot(m, num(e[1], 0, LW - 1, cur.x), num(e[2], 0, LH - 1, cur.y));
    setRide(id, (v) => ({ ...v, x, y, f: e[3] === -1 ? -1 : 1, at, rider: rider === me() ? null : rider }));
  }
}

/* ---------------- upkeep ---------------- */

let tick: ReturnType<typeof setInterval> | null = null;
let lastHit = 0;
let unBrawl: (() => void) | null = null;
/** Start keeping the rides while the lobby is on screen. */
export function startRides() {
  if (tick) return;
  // back in the lobby: start from the fleet at home; whoever is here sends the rides that moved
  useRides.setState({ rides: homeFleet(lobbyMap()), mine: null, near: null });
  lastHit = useBrawl.getState().me.hitAt;
  // a hit knocks you off your ride (no damage from the fall)
  unBrawl = useBrawl.subscribe((b) => {
    if (b.me.hitAt > lastHit || b.me.koAt) {
      lastHit = b.me.hitAt;
      if (useRides.getState().mine !== null) getOff();
    }
  });
  tick = setInterval(() => {
    const peers = useLobby.getState().peers;
    const now = Date.now();
    const s = useRides.getState();
    let rides = s.rides;
    // a rider who left the lobby: their ride stays where they were last seen
    for (const r of rides) {
      if (!r.rider || r.rider === me() || peers[r.rider]) continue;
      const [x, y] = parkSpot(lobbyMap(), r.x, r.y);
      rides = rides.map((v) => (v.id === r.id ? { ...v, rider: null, x, y, at: now } : v));
    }
    rides = sendHome(lobbyMap(), rides, now);
    if (rides !== s.rides) useRides.setState({ rides });
  }, 1000);
}

export function stopRides() {
  if (useRides.getState().mine !== null) getOff();
  if (tick) clearInterval(tick);
  tick = null;
  unBrawl?.();
  unBrawl = null;
}

rideHooks.onRd = onRd;
rideHooks.onRds = onRds;
rideHooks.onHi = onHi;
rideHooks.onPeer = onPeerRide;
rideHooks.myRide = myRideId;
