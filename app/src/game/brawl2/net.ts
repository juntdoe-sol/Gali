/**
 * BrawlOre online: what goes over the wire, packed small (plain arrays of rounded numbers).
 *
 * How a match runs online:
 *  - The host (the miner who waited longest) runs the real match: bots, hits, lives, the end. 10 times a second it
 *    sends a snapshot ('bos') of every fighter.
 *  - A guest runs its own copy for its own miner only, so moving and swinging answer at once. 10 times a second it
 *    tells the host where it is and what it is swinging ('boi'). The host takes that as the truth for that miner,
 *    except while the miner is reeling from a hit or dead: then the host's own physics decide.
 *  - Damage, knockback, KOs and the result only ever come from the host.
 */
import { METER_FULL, MOVES, type Fighter, type Input, type Match, type MatchEvent, type MoveId } from './sim';

export const MOVE_LIST = Object.keys(MOVES.pick) as MoveId[];
const r1 = (n: number) => Math.round(n * 10) / 10;

/** A player in an online match, as the host lists them in 'bom'. */
export interface NetPlayer {
  id: string;
  name: string;
  look: unknown;
  weapon: string;
  /** the special move their weapon gives (specials.ts) */
  sp?: string;
}

/* ---------- a guest's own state, guest -> host ('boi') ---------- */
export type SelfPack = number[];
export function packSelf(f: Fighter, i: Input): SelfPack {
  return [
    r1(f.x), r1(f.y), Math.round(f.vx), Math.round(f.vy), f.facing, f.grounded ? 1 : 0, f.on,
    f.airJumps, f.recoveryUsed ? 1 : 0, f.airDodgeUsed ? 1 : 0, f.dodge, f.dodgeCool, f.dodgeDir[0], f.dodgeDir[1], f.dropping,
    f.act ? MOVE_LIST.indexOf(f.act.move) : -1, f.act ? f.act.f : 0,
    f.hitN, f.falls, r1(i.mx), r1(i.my),
  ];
}
/** The host takes a guest's own report for its fighter, unless the host knows of a hit or a fall it has not seen yet. */
export function applySelf(f: Fighter, p: SelfPack, input: Input): boolean {
  if (!Array.isArray(p) || p.length < 21 || !p.every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
  input.mx = clamp1(p[19]);
  input.my = clamp1(p[20]);
  if (f.stocks <= 0 || f.respawn > 0 || f.hitstun > 0 || f.freeze > 0) return false;
  if (p[17] < f.hitN || p[18] < f.falls) return false;
  f.x = p[0];
  f.y = p[1];
  f.vx = p[2];
  f.vy = p[3];
  f.facing = p[4] < 0 ? -1 : 1;
  f.grounded = p[5] === 1;
  f.on = p[6] | 0;
  f.airJumps = p[7] | 0;
  f.recoveryUsed = p[8] === 1;
  f.airDodgeUsed = p[9] === 1;
  f.dodge = p[10] | 0;
  f.dodgeCool = p[11] | 0;
  f.dodgeDir = [p[12], p[13]];
  f.dropping = p[14] | 0;
  let mv = MOVE_LIST[p[15]];
  // a special costs a full meter, and the host keeps the meter
  if (mv === 'special' && f.act?.move !== 'special') {
    if (f.meter >= METER_FULL) f.meter = 0;
    else mv = undefined as unknown as MoveId;
  }
  if (!mv) f.act = null;
  else if (f.act && f.act.move === mv && Math.abs(f.act.f - p[16]) < 8) {
    /* the same swing: keep the host's own count, and who it already hit */
  } else f.act = { move: mv, f: p[16] | 0, hit: f.act && f.act.move === mv ? f.act.hit : [] };
  return true;
}

/* ---------- the host's snapshot, host -> everyone ('bos') ---------- */
export interface Snap {
  /** match id */
  mid: string;
  /** frame, countdown, timeLeft, over */
  m: [number, number, number, number];
  /** fighters, in match order */
  f: number[][];
  /** what happened since the last snapshot (only what a guest cannot see coming) */
  e: MatchEvent[];
}
export function packFighter(f: Fighter, i: Input | undefined): number[] {
  return [
    r1(f.x), r1(f.y), Math.round(f.vx), Math.round(f.vy), f.facing, f.grounded ? 1 : 0, f.on,
    f.airJumps, f.recoveryUsed ? 1 : 0, f.airDodgeUsed ? 1 : 0, f.dodge, f.dodgeCool, f.dodgeDir[0], f.dodgeDir[1], f.dropping,
    f.act ? MOVE_LIST.indexOf(f.act.move) : -1, f.act ? f.act.f : 0,
    f.hitN, f.falls, r1(i?.mx ?? 0), r1(i?.my ?? 0),
    r1(f.dmg), f.stocks, f.hitstun, f.freeze, f.invuln, f.respawn, f.kos, f.place, f.bot ? 1 : 0, Math.round(f.meter),
  ];
}
/** Set a fighter from the snapshot: everything (another fighter), or only the score (your own, see adoptSelf). */
export function setFighter(f: Fighter, p: number[], all: boolean) {
  if (!Array.isArray(p) || p.length < 30) return;
  f.dmg = p[21];
  f.stocks = p[22];
  f.kos = p[27];
  f.place = p[28];
  if (typeof p[30] === 'number') f.meter = p[30];
  if (!all) return;
  setPhys(f, p);
  f.hitN = p[17];
  f.falls = p[18];
  f.hitstun = p[23];
  f.freeze = p[24];
  f.invuln = p[25];
  f.respawn = p[26];
  f.prev = { mx: p[19], my: p[20], jump: false, light: false, heavy: false, dodge: false };
  if (p[29] === 1 && !f.bot) f.bot = 'normal';
}
function setPhys(f: Fighter, p: number[]) {
  f.x = p[0];
  f.y = p[1];
  f.vx = p[2];
  f.vy = p[3];
  f.facing = p[4] < 0 ? -1 : 1;
  f.grounded = p[5] === 1;
  f.on = p[6];
  f.airJumps = p[7];
  f.recoveryUsed = p[8] === 1;
  f.airDodgeUsed = p[9] === 1;
  f.dodge = p[10];
  f.dodgeCool = p[11];
  f.dodgeDir = [p[12], p[13]];
  f.dropping = p[14];
  const mv = MOVE_LIST[p[15]];
  f.act = mv ? { move: mv, f: p[16], hit: f.act && f.act.move === mv ? f.act.hit : [] } : null;
}
/**
 * Your own fighter, on a guest: your copy moves it, except when the host says you were hit or fell (then take the
 * host's state once, and carry on from there), or when the two drifted far apart.
 */
export function adoptSelf(f: Fighter, p: number[]): boolean {
  if (!Array.isArray(p) || p.length < 30) return false;
  const hit = p[17] > f.hitN;
  const fell = p[18] > f.falls;
  setFighter(f, p, false);
  const far = Math.hypot(f.x - p[0], f.y - p[1]) > 70 && f.hitstun === 0 && f.respawn === 0 && p[26] === 0;
  if (!hit && !fell && !far) return false;
  setPhys(f, p);
  f.hitN = p[17];
  f.falls = p[18];
  f.hitstun = p[23];
  f.freeze = p[24];
  f.invuln = p[25];
  f.respawn = p[26];
  if (hit || fell) f.act = null;
  return true;
}

export function packSnap(mid: string, m: Match, inputs: Record<string, Input>, events: MatchEvent[]): Snap {
  return { mid, m: [m.frame, m.countdown, m.timeLeft, m.over ? 1 : 0], f: m.fighters.map((f) => packFighter(f, inputs[f.id])), e: events.slice(-24) };
}

const clamp1 = (n: number) => Math.max(-1, Math.min(1, n));

/** Room codes: 4 letters, no look-alikes. */
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export const newCode = () => Array.from({ length: 4 }, () => CODE_ABC[Math.floor(Math.random() * CODE_ABC.length)]).join('');
export const cleanCode = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, '').replace(/[IO]/g, '').slice(0, 4);
