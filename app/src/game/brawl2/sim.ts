/**
 * Brawl Arena v2: a simple platform fighter in the style of Brawlhalla (plan: project doc claude/gali-brawl-arena-v2.md).
 *
 * Pure and deterministic: a fixed 60 Hz step over plain data, no DOM, no clock, no Math.random (bots get a seeded
 * random), so the same inputs give the same match on every device. That is what online play (step 2) will build on.
 *
 * Rules
 *  - Hits raise a fighter's damage %. Knockback = base + growth x damage% (after the hit). Fly past the blast zone
 *    and you lose a life (stock). 3 stocks each; the last fighter with stocks wins. 3 minutes; on time, most stocks
 *    wins, then lowest damage %.
 *  - Move: run, jump, one double jump, one recovery (heavy in the air without down), fast fall (down in the air).
 *    Drop through the soft platforms with down. One dodge button: a short invincible dash (once in the air).
 *  - Light and heavy attacks, each aimed neutral, side or down; light attacks also have air versions.
 *  - Moves come from the weapon type (pick, axe, hammer, blade). Rarity never changes stats.
 *
 * Map px: x right, y down, a fighter's (x, y) is where its feet are.
 */

export type Weapon = 'pick' | 'axe' | 'hammer' | 'blade';
export type MoveId =
  | 'nLight' | 'sLight' | 'dLight' | 'nAir' | 'sAir' | 'dAir'
  | 'nHeavy' | 'sHeavy' | 'dHeavy' | 'recovery' | 'pound' | 'special'
  /** the fighter's equipped skills: SKILL alone, SKILL + side, SKILL + down (moveOf picks the real one) */
  | 'skN' | 'skS' | 'skD';
/**
 * Special moves: one button, used when the meter is full. Each weapon family has one (game/brawl2/specials.ts
 * maps gear and NFT items to them). They are tuned to be equally strong: different, never better.
 */
export type SpecialId = 'quake' | 'rush' | 'moon' | 'whirl' | 'dive' | 'guard';
/**
 * Skills: bought with NUGS (the in-game coin) and put in three slots: SKILL alone, SKILL + side, SKILL + down, each
 * with its own cooldown. The six specials are also skills, free for everyone, a little lighter than the meter
 * version. Every skill has the same power budget: they play differently, none is stronger (specials.ts SKILL_INFO).
 */
export type SkillId = SpecialId | 'grab' | 'dynamite' | 'magnet' | 'tunnel' | 'geyser' | 'cavein';
export const SKILL_SLOTS = ['skN', 'skS', 'skD'] as const;
/** frames between uses of one skill slot */
export const SKILL_CD_F = 7 * 60;
export type Mode = '1v1' | 'ffa';
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface Input {
  /** stick or keys, -1..1 */
  mx: number;
  my: number;
  jump: boolean;
  light: boolean;
  heavy: boolean;
  dodge: boolean;
  /** the special move (needs a full meter) */
  special?: boolean;
  /** use a skill: the slot comes from the stick (none, side, down) */
  skill?: boolean;
}
export const NO_INPUT: Input = { mx: 0, my: 0, jump: false, light: false, heavy: false, dodge: false, special: false, skill: false };

export interface Move {
  /** frames before, during and after the hit */
  start: number;
  active: number;
  end: number;
  /** hitbox relative to the feet, x forward (in the facing direction), y up is negative */
  hx: number;
  hy: number;
  hw: number;
  hh: number;
  dmg: number;
  /** knockback, px/s: base + growth * damage% / 100 */
  base: number;
  growth: number;
  /** launch angle in degrees: 0 forward, -90 straight up, 90 down */
  angle: number;
  /** speed the attacker gets when the move starts (forward, up) */
  lunge?: [number, number];
  air?: boolean;
  /** a ground pound: falls fast until it lands */
  slam?: boolean;
  /** launch away from the attacker whichever way they face (spins) */
  away?: boolean;
  /** a counter stance: no hitbox; a hit that lands during it is turned back on the attacker */
  guard?: boolean;
  /** a grab: on a hit, throw them up, forward, back or down, the way the stick points */
  grab?: boolean;
  /** pulls the one it hits in toward the attacker, for a follow-up */
  pull?: boolean;
  /** tunnels: safe while it digs, then pops up behind the nearest foe as the hit starts */
  blink?: boolean;
}

export interface Fighter {
  id: string;
  name: string;
  bot: Difficulty | null;
  weapon: Weapon;
  team: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
  grounded: boolean;
  /** the platform stood on (index), -1 for none */
  on: number;
  airJumps: number;
  recoveryUsed: boolean;
  airDodgeUsed: boolean;
  dmg: number;
  stocks: number;
  /** frames left in each state */
  hitstun: number;
  freeze: number;
  invuln: number;
  dodge: number;
  dodgeCool: number;
  dodgeDir: [number, number];
  /** dropping through a soft platform: ignore soft platforms for these frames */
  dropping: number;
  /** dead, waiting to respawn */
  respawn: number;
  act: { move: MoveId; f: number; hit: string[] } | null;
  /** who hit me last and when (frame), for KO credit */
  lastBy: string | null;
  lastAt: number;
  kos: number;
  falls: number;
  /** last frame's buttons, for presses */
  prev: Input;
  /** match result: 1st, 2nd... (0 while still in) */
  place: number;
  /** hits taken so far: online, a guest notices a new hit by this going up */
  hitN: number;
  special: SpecialId;
  /** 0..METER_FULL: fills by landing and taking hits */
  meter: number;
  /** hanging from a ledge: frames so far (0 = not), and which platform's edge */
  hang: number;
  ledge: number;
  /** frames before another ledge grab */
  ledgeCool: number;
  /** equipped skills: SKILL alone, SKILL + side, SKILL + down (null: empty slot) */
  skills: (SkillId | null)[];
  /** frames left before each slot can be used again */
  skillCd: number[];
}

export interface Platform {
  x0: number;
  x1: number;
  y: number;
  /** soft: stand on it, jump up through it, drop through it with down */
  soft: boolean;
}

export interface Stage {
  id: 'pit' | 'grotto' | 'refinery';
  name: string;
  w: number;
  h: number;
  plats: Platform[];
  /** blast zone: past these you lose a stock */
  blast: { x0: number; x1: number; y0: number; y1: number };
  spawns: [number, number][];
  respawn: [number, number];
}

/**
 * The Gali Fightclub's three stages, all underground. Same blast zone and about the same space to fight in;
 * each has its own floor plan. One is picked at random for each match (online, from the host's seed).
 */
const BLAST = { x0: -70, x1: 550, y0: -110, y1: 360 };
/** The Ore Pit: the club's main ring, a plank floor over the shaft, two scaffold planks above. */
export const PIT: Stage = {
  id: 'pit',
  name: 'THE CAGE',
  w: 480,
  h: 300,
  plats: [
    { x0: 110, x1: 370, y: 196, soft: false },
    { x0: 140, x1: 214, y: 150, soft: true },
    { x0: 266, x1: 340, y: 150, soft: true },
  ],
  blast: BLAST,
  spawns: [[160, 196], [320, 196], [200, 150], [280, 150]],
  respawn: [240, 70],
};
/** The Crystal Grotto: a narrower rock shelf, one high crystal ledge in the middle and two low ones out wide. */
export const GROTTO: Stage = {
  id: 'grotto',
  name: 'THE ROOFTOP',
  w: 480,
  h: 300,
  plats: [
    { x0: 126, x1: 354, y: 200, soft: false },
    { x0: 200, x1: 280, y: 132, soft: true },
    { x0: 92, x1: 150, y: 166, soft: true },
    { x0: 330, x1: 388, y: 166, soft: true },
  ],
  blast: BLAST,
  spawns: [[170, 200], [310, 200], [120, 166], [360, 166]],
  respawn: [240, 70],
};
/** The Refinery: a long iron catwalk over molten ore, three short gantries in a row above it. */
export const REFINERY: Stage = {
  id: 'refinery',
  name: 'THE CHOP SHOP',
  w: 480,
  h: 300,
  plats: [
    { x0: 96, x1: 384, y: 204, soft: false },
    { x0: 120, x1: 182, y: 158, soft: true },
    { x0: 209, x1: 271, y: 140, soft: true },
    { x0: 298, x1: 360, y: 158, soft: true },
  ],
  blast: BLAST,
  spawns: [[150, 204], [330, 204], [150, 158], [330, 158]],
  respawn: [240, 70],
};
export const STAGES: Stage[] = [PIT, GROTTO, REFINERY];
/** older name for the first stage */
export const HALL = PIT;
/** The stage for a match: picked from its seed, so every player in an online match gets the same one. */
export const stageFor = (seed: number) => STAGES[(seed >>> 0) % STAGES.length];

export const FPS = 60;
const DT = 1 / FPS;
const GRAV = 980;
const MAX_FALL = 320;
const FAST_FALL = 520;
const RUN = 118;
const RUN_ACCEL = 1400;
const AIR_ACCEL = 700;
const AIR_MAX = 112;
const GROUND_FRICTION = 0.78;
const AIR_DRAG = 0.995;
const KB_DRAG = 0.96;
const JUMP_V = 318;
const AIR_JUMP_V = 290;
const DODGE_F = 14;
const DODGE_INV: [number, number] = [2, 12];
const DODGE_V = 190;
const DODGE_COOL = 34;
const RESPAWN_F = 90;
const RESPAWN_INV = 120;
export const STOCKS = 3;
export const MATCH_F = 180 * FPS;
const COUNTDOWN_F = 3 * FPS;
/** a fighter's hurtbox, around the feet */
const BODY_W = 12;
const BODY_H = 22;
export const METER_FULL = 100;
/** a ledge hang lasts at most this long, and is safe at first */
const HANG_MAX = 150;
const HANG_INV = 24;
/** meter per damage dealt and taken */
const METER_DEAL = 2.2;
const METER_TAKE = 1.2;

/* ---------------- movesets ---------------- */
/** knockback growth, tuned so most stocks are taken between about 110% and 180% */
const GROWTH = 1.35;
const m = (o: Partial<Move> & Pick<Move, 'start' | 'active' | 'end' | 'dmg' | 'base' | 'growth' | 'angle'>): Move => ({ hx: 6, hy: -14, hw: 16, hh: 14, ...o, growth: o.growth * GROWTH });

/** Pick: the all-rounder. */
const PICK: Record<MoveId, Move> = {
  nLight: m({ start: 4, active: 3, end: 10, hx: 4, hy: -16, hw: 16, hh: 12, dmg: 6, base: 110, growth: 70, angle: -40 }),
  sLight: m({ start: 5, active: 3, end: 12, hx: 6, hy: -14, hw: 18, hh: 10, dmg: 7, base: 120, growth: 85, angle: -25, lunge: [70, 0] }),
  dLight: m({ start: 5, active: 4, end: 12, hx: 2, hy: -6, hw: 20, hh: 7, dmg: 6, base: 100, growth: 60, angle: -70 }),
  nAir: m({ start: 4, active: 5, end: 10, hx: -8, hy: -24, hw: 28, hh: 24, dmg: 7, base: 110, growth: 70, angle: -50, air: true }),
  sAir: m({ start: 5, active: 4, end: 12, hx: 6, hy: -18, hw: 18, hh: 14, dmg: 8, base: 120, growth: 95, angle: -20, air: true }),
  dAir: m({ start: 6, active: 4, end: 14, hx: -6, hy: -2, hw: 14, hh: 12, dmg: 8, base: 90, growth: 80, angle: 65, air: true }),
  nHeavy: m({ start: 14, active: 5, end: 18, hx: -6, hy: -34, hw: 26, hh: 20, dmg: 15, base: 170, growth: 180, angle: -80 }),
  sHeavy: m({ start: 16, active: 5, end: 20, hx: 4, hy: -24, hw: 24, hh: 24, dmg: 17, base: 180, growth: 200, angle: -30, lunge: [90, 0] }),
  dHeavy: m({ start: 14, active: 6, end: 20, hx: -18, hy: -8, hw: 48, hh: 9, dmg: 14, base: 160, growth: 170, angle: -45 }),
  recovery: m({ start: 3, active: 10, end: 14, hx: -4, hy: -30, hw: 20, hh: 30, dmg: 9, base: 140, growth: 110, angle: -75, lunge: [40, -360], air: true }),
  pound: m({ start: 8, active: 30, end: 16, hx: -8, hy: -6, hw: 24, hh: 12, dmg: 13, base: 150, growth: 150, angle: 70, air: true, slam: true }),
  // stands in for the fighter's own special (moveOf picks the real one)
  special: m({ start: 8, active: 6, end: 20, dmg: 14, base: 190, growth: 180, angle: -45 }),
  // stand in for the fighter's skills
  skN: m({ start: 8, active: 6, end: 20, dmg: 11, base: 160, growth: 145, angle: -45 }),
  skS: m({ start: 8, active: 6, end: 20, dmg: 11, base: 160, growth: 145, angle: -45 }),
  skD: m({ start: 8, active: 6, end: 20, dmg: 11, base: 160, growth: 145, angle: -45 }),
};

/** The specials, same budget each: about 14 damage and a finisher's knockback, paid for with wind-up or end lag. */
export const SPECIALS: Record<SpecialId, Move> = {
  // Ore Quake: stamps the floor, the shockwave launches both sides upward
  quake: m({ start: 13, active: 6, end: 24, hx: -32, hy: -10, hw: 64, hh: 12, dmg: 13, base: 185, growth: 172, angle: -80, away: true }),
  // Rush Strike: a long dash through the foe
  rush: m({ start: 8, active: 10, end: 22, hx: 2, hy: -20, hw: 20, hh: 18, dmg: 13, base: 200, growth: 175, angle: -20, lunge: [330, 0] }),
  // Moon Shot: a rising uppercut, also a second recovery
  moon: m({ start: 7, active: 8, end: 26, hx: -4, hy: -40, hw: 24, hh: 40, dmg: 12, base: 200, growth: 158, angle: -88, lunge: [20, -380] }),
  // Whirlwind: spins, hitting all round
  whirl: m({ start: 5, active: 16, end: 18, hx: -20, hy: -26, hw: 40, hh: 26, dmg: 14, base: 190, growth: 185, angle: -35, away: true }),
  // Liquidation: hops and dives forward, spiking down
  dive: m({ start: 6, active: 20, end: 16, hx: 2, hy: -14, hw: 20, hh: 16, dmg: 14, base: 170, growth: 170, angle: 45, lunge: [240, -170] }),
  // Diamond Hands: a counter stance; whoever hits you during it gets hit back hard
  guard: m({ start: 1, active: 32, end: 14, hx: -6, hy: -30, hw: 24, hh: 30, dmg: 17, base: 240, growth: 200, angle: -40, away: true, guard: true }),
};
export const SPECIAL_IDS = Object.keys(SPECIALS) as SpecialId[];
export const isSpecial = (x: unknown): x is SpecialId => typeof x === 'string' && (SPECIAL_IDS as string[]).includes(x);

/** A special as a skill: the same move, about a fifth lighter (it comes back every 7 seconds, not with the meter). */
const lighter = (mv: Move): Move => ({ ...mv, dmg: Math.round(mv.dmg * 0.8), base: mv.base * 0.85, growth: mv.growth * 0.8 });
/** Skills, one budget: about 11 damage and a light finisher's knockback, paid for with wind-up, reach or end lag. */
export const SKILLS: Record<SkillId, Move> = {
  quake: { ...lighter(SPECIALS.quake), start: 11 },
  // the dash and the dive punish a miss hard: as skills they recover sooner and reach a little wider
  rush: { ...lighter(SPECIALS.rush), dmg: 13, base: SPECIALS.rush.base * 0.95, end: 12, hw: 28, hh: 22, hy: -22 },
  moon: lighter(SPECIALS.moon),
  whirl: lighter(SPECIALS.whirl),
  dive: { ...lighter(SPECIALS.dive), end: 12, hw: 24 },
  guard: lighter(SPECIALS.guard),
  // Ore Grab: a short reach that grabs, then throws the way you point (up when you don't)
  grab: m({ start: 6, active: 4, end: 22, hx: 4, hy: -20, hw: 16, hh: 18, dmg: 10, base: 175, growth: 150, angle: -85, grab: true }),
  // Dynamite Toss: lobbed ahead, it blows up a few steps away
  dynamite: m({ start: 18, active: 5, end: 16, hx: 52, hy: -26, hw: 40, hh: 30, dmg: 11, base: 170, growth: 150, angle: -55, away: true }),
  // Magnet Hook: a long, thin reach that drags them in
  magnet: m({ start: 10, active: 5, end: 18, hx: 6, hy: -16, hw: 110, hh: 10, dmg: 6, base: 0, growth: 0, angle: 0, pull: true }),
  // Tunnel Dig: dig in (safe), pop up behind the nearest foe and strike
  tunnel: m({ start: 24, active: 5, end: 22, hx: -2, hy: -24, hw: 20, hh: 24, dmg: 10, base: 160, growth: 140, angle: -40, blink: true }),
  // Geyser: the floor bursts a little way ahead, straight up
  geyser: m({ start: 14, active: 8, end: 16, hx: 60, hy: -48, hw: 28, hh: 48, dmg: 11, base: 185, growth: 150, angle: -88 }),
  // Cave-In: rocks drop from above, ahead of you, spiking down
  cavein: m({ start: 20, active: 7, end: 18, hx: 34, hy: -60, hw: 34, hh: 60, dmg: 11, base: 150, growth: 135, angle: 75 }),
};
export const SKILL_IDS = Object.keys(SKILLS) as SkillId[];
export const isSkill = (x: unknown): x is SkillId => typeof x === 'string' && (SKILL_IDS as string[]).includes(x);
const slotOf = (id: MoveId) => (id === 'skN' ? 0 : id === 'skS' ? 1 : id === 'skD' ? 2 : -1);
export const isSkillMove = (id: MoveId) => slotOf(id) >= 0;
/** The skill in a fighter's move (null when it isn't a skill). */
export function skillOf(f: Pick<Fighter, 'skills'>, id: MoveId): SkillId | null {
  const k = slotOf(id);
  return k >= 0 ? (f.skills?.[k] ?? null) : null;
}

/** The move a fighter is doing (its own special for 'special', its own skill for a skill slot). */
export const moveOf = (f: Pick<Fighter, 'weapon' | 'special'> & Partial<Pick<Fighter, 'skills'>>, id: MoveId): Move => {
  if (id === 'special') return SPECIALS[f.special];
  const sk = slotOf(id) >= 0 ? f.skills?.[slotOf(id)] : null;
  return sk ? SKILLS[sk] : MOVES[f.weapon][id];
};

const tune = (base: Record<MoveId, Move>, f: (mv: Move, id: MoveId) => Partial<Move>) =>
  Object.fromEntries((Object.keys(base) as MoveId[]).map((id) => [id, { ...base[id], ...f(base[id], id) }])) as Record<MoveId, Move>;

export const MOVES: Record<Weapon, Record<MoveId, Move>> = {
  pick: PICK,
  // Axe: slower, longer, hits harder
  axe: tune(PICK, (mv, id) => ({ start: mv.start + 2, end: mv.end + 2, hw: mv.hw + 6, growth: mv.growth * 1.12, dmg: mv.dmg + (id.endsWith('Heavy') ? 2 : 1) })),
  // Hammer: slowest, biggest finishers, the down heavy ground pound shakes the floor
  hammer: tune(PICK, (mv, id) => ({
    start: mv.start + (id.endsWith('Heavy') ? 5 : 3),
    end: mv.end + 3,
    growth: mv.growth * (id.endsWith('Heavy') || id === 'pound' ? 1.25 : 1.05),
    dmg: mv.dmg + 2,
    ...(id === 'dHeavy' ? { hx: -28, hw: 68 } : {}),
  })),
  // Blade: fastest, chains lights, weak finishers
  blade: tune(PICK, (mv, id) => ({ start: Math.max(2, mv.start - 2), end: Math.max(6, mv.end - 4), growth: mv.growth * 0.85, dmg: Math.max(4, mv.dmg - (id.endsWith('Heavy') ? 2 : 1)) })),
};

/* ---------------- the match ---------------- */
export interface MatchEvent {
  t: 'hit' | 'ko' | 'jump' | 'dodge' | 'swing' | 'land' | 'spawn' | 'go' | 'end' | 'recover' | 'special' | 'counter' | 'grab' | 'sudden' | 'skill' | 'blink' | 'throw';
  id?: string;
  by?: string;
  x?: number;
  y?: number;
  heavy?: boolean;
  dmg?: number;
  kb?: number;
  move?: MoveId;
}

export interface Match {
  stage: Stage;
  mode: Mode;
  frame: number;
  /** frames of countdown left (no moving), then the fight */
  countdown: number;
  timeLeft: number;
  fighters: Fighter[];
  over: boolean;
  /** time ran out with a tie at the top: the tied fighters play on, 1 life each, next KO wins */
  sudden?: boolean;
  /** seeded random, for bots and sudden death */
  seed: number;
  events: MatchEvent[];
  /**
   * Online, a guest's copy of the match is not the judge: it moves the local fighter at once and shows its own
   * swings landing (sparks, sound), but damage, knockback, lives and the end come from the host's snapshots.
   * False only there; `local` is the guest's own fighter.
   */
  authority?: boolean;
  local?: string;
}

export function rand(match: Match): number {
  // mulberry32
  let t = (match.seed = (match.seed + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function newFighter(o: { id: string; name: string; bot: Difficulty | null; weapon: Weapon; special?: SpecialId; skills?: (SkillId | null)[]; team: number; at: [number, number]; facing: 1 | -1 }): Fighter {
  return {
    id: o.id, name: o.name, bot: o.bot, weapon: o.weapon, team: o.team,
    x: o.at[0], y: o.at[1], vx: 0, vy: 0, facing: o.facing, grounded: false, on: -1,
    airJumps: 1, recoveryUsed: false, airDodgeUsed: false,
    dmg: 0, stocks: STOCKS, hitstun: 0, freeze: 0, invuln: 0, dodge: 0, dodgeCool: 0, dodgeDir: [0, 0], dropping: 0, respawn: 0,
    act: null, lastBy: null, lastAt: 0, kos: 0, falls: 0, prev: { ...NO_INPUT }, place: 0, hitN: 0, special: o.special ?? 'quake', meter: 0, hang: 0, ledge: -1, ledgeCool: 0,
    skills: [0, 1, 2].map((k) => (isSkill(o.skills?.[k]) ? o.skills![k] : null)), skillCd: [0, 0, 0],
  };
}

export function newMatch(o: { mode: Mode; players: { id: string; name: string; bot: Difficulty | null; weapon: Weapon; special?: SpecialId; skills?: (SkillId | null)[] }[]; seed?: number; stage?: Stage }): Match {
  const stage = o.stage ?? stageFor(o.seed ?? 12345);
  const fighters = o.players.map((p, i) => newFighter({ ...p, team: i, at: stage.spawns[i % stage.spawns.length], facing: stage.spawns[i % stage.spawns.length][0] < stage.w / 2 ? 1 : -1 }));
  return { stage, mode: o.mode, frame: 0, countdown: COUNTDOWN_F, timeLeft: MATCH_F, fighters, over: false, seed: o.seed ?? 12345, events: [] };
}

const alive = (f: Fighter) => f.stocks > 0 && f.respawn === 0;
export const inPlay = (f: Fighter) => f.stocks > 0;

/** Which move the buttons ask for. */
function pickMove(f: Fighter, i: Input, heavy: boolean): MoveId {
  const down = i.my > 0.5;
  const side = Math.abs(i.mx) > 0.3;
  if (f.grounded) {
    if (heavy) return down ? 'dHeavy' : side ? 'sHeavy' : 'nHeavy';
    return down ? 'dLight' : side ? 'sLight' : 'nLight';
  }
  if (heavy) return down ? 'pound' : 'recovery';
  return down ? 'dAir' : side ? 'sAir' : 'nAir';
}

function startMove(match: Match, f: Fighter, id: MoveId, i: Input) {
  if (id === 'recovery') {
    if (f.recoveryUsed) id = Math.abs(i.mx) > 0.3 ? 'sAir' : 'nAir';
    else f.recoveryUsed = true;
  }
  if (Math.abs(i.mx) > 0.3 && f.grounded) f.facing = i.mx > 0 ? 1 : -1;
  f.act = { move: id, f: 0, hit: [] };
  const mv = moveOf(f, id);
  if (mv.lunge) {
    f.vx = mv.lunge[0] * f.facing + (f.grounded ? 0 : f.vx * 0.3);
    if (mv.lunge[1]) {
      f.vy = mv.lunge[1];
      f.grounded = false;
      f.on = -1;
    }
  }
  match.events.push({ t: 'swing', id: f.id, move: id, heavy: id.endsWith('Heavy') || id === 'pound' || id === 'recovery' || id === 'special' || isSkillMove(id) });
  if (id === 'special') match.events.push({ t: 'special', id: f.id, x: f.x, y: f.y });
  if (isSkillMove(id)) {
    match.events.push({ t: 'skill', id: f.id, x: f.x, y: f.y, move: id });
    // digging in: nobody can hit you until you pop out
    if (mv.blink) f.invuln = Math.max(f.invuln, mv.start + 1);
  }
  if (id === 'recovery') match.events.push({ t: 'recover', id: f.id, x: f.x, y: f.y });
}

/** One fighter's own movement and buttons for one frame. */
function control(match: Match, f: Fighter, i: Input) {
  const p = f.prev;
  const pressed = { jump: i.jump && !p.jump, light: i.light && !p.light, heavy: i.heavy && !p.heavy, dodge: i.dodge && !p.dodge, special: Boolean(i.special && !p.special), skill: Boolean(i.skill && !p.skill) };
  for (let k = 0; k < 3; k++) if (f.skillCd[k] > 0) f.skillCd[k]--;
  const downPressed = i.my > 0.6 && p.my <= 0.6;
  f.prev = { ...i };
  if (f.dodgeCool > 0) f.dodgeCool--;
  if (f.dropping > 0) f.dropping--;
  if (f.ledgeCool > 0) f.ledgeCool--;

  // hanging from a ledge: climb up, jump off, or let go
  if (f.hang > 0) {
    const p = match.stage.plats[f.ledge];
    f.hang++;
    f.vx = 0;
    f.vy = 0;
    const inward = f.facing;
    if (!p || f.hang > HANG_MAX || downPressed) {
      f.hang = 0;
      f.ledgeCool = 40;
      return;
    }
    if (pressed.jump) {
      f.hang = 0;
      f.ledgeCool = 20;
      f.vy = -JUMP_V;
      f.airJumps = 1;
      match.events.push({ t: 'jump', id: f.id, x: f.x, y: f.y });
      return;
    }
    if (f.hang > 6 && (Math.sign(i.mx) === inward && Math.abs(i.mx) > 0.4 || i.my < -0.6 || pressed.light || pressed.heavy)) {
      f.hang = 0;
      f.ledgeCool = 20;
      f.x = inward > 0 ? p.x0 + 8 : p.x1 - 8;
      f.y = p.y;
      f.grounded = true;
      f.on = f.ledge;
      f.invuln = Math.max(f.invuln, 10);
      match.events.push({ t: 'land', id: f.id, x: f.x, y: f.y });
    }
    return;
  }

  if (f.hitstun > 0) {
    f.hitstun--;
    // a little drift while flying
    f.vx += i.mx * 120 * DT;
    return;
  }
  if (f.dodge > 0) {
    f.dodge--;
    f.vx = f.dodgeDir[0] * DODGE_V;
    f.vy = f.dodgeDir[1] * DODGE_V * 0.7;
    if (f.dodge === 0) {
      f.vx *= 0.35;
      f.vy = Math.min(f.vy, 0) * 0.3;
    }
    return;
  }
  const busy = f.act !== null;
  const mv = f.act ? moveOf(f, f.act.move) : null;

  // dodge
  if (pressed.dodge && f.dodgeCool === 0 && (f.grounded || !f.airDodgeUsed) && (!busy || (f.act && f.act.f >= mv!.start + mv!.active))) {
    const dx = Math.abs(i.mx) > 0.3 ? Math.sign(i.mx) : 0;
    const dy = f.grounded ? 0 : Math.abs(i.my) > 0.4 ? Math.sign(i.my) : 0;
    f.dodge = DODGE_F;
    f.dodgeDir = [dx, dy];
    f.invuln = Math.max(f.invuln, DODGE_INV[1]);
    f.dodgeCool = DODGE_COOL;
    if (!f.grounded) f.airDodgeUsed = true;
    f.act = null;
    if (dx) f.facing = dx > 0 ? 1 : -1;
    match.events.push({ t: 'dodge', id: f.id, x: f.x, y: f.y });
    return;
  }
  // attacks
  const slot = i.my > 0.5 ? 2 : Math.abs(i.mx) > 0.3 ? 1 : 0;
  if (!busy && pressed.special && f.meter >= METER_FULL) {
    f.meter = 0;
    startMove(match, f, 'special', i);
  } else if (!busy && pressed.skill && f.skills[slot] && f.skillCd[slot] === 0) {
    f.skillCd[slot] = SKILL_CD_F;
    startMove(match, f, SKILL_SLOTS[slot], i);
  } else if (!busy && (pressed.light || pressed.heavy)) startMove(match, f, pickMove(f, i, pressed.heavy), i);
  // jump (also cancels the end of a light attack)
  const cur = f.act ? moveOf(f, f.act.move) : null;
  const canCancel = Boolean(f.act && cur && !cur.slam && f.act.f >= cur.start + cur.active + 2 && !f.act.move.endsWith('Heavy') && f.act.move !== 'recovery' && f.act.move !== 'pound' && f.act.move !== 'special' && !isSkillMove(f.act.move));
  if (pressed.jump && (!f.act || canCancel)) {
    if (f.grounded) {
      f.vy = -JUMP_V;
      f.grounded = false;
      f.on = -1;
      f.act = null;
      match.events.push({ t: 'jump', id: f.id, x: f.x, y: f.y });
    } else if (f.airJumps > 0) {
      f.airJumps--;
      f.vy = -AIR_JUMP_V;
      f.act = null;
      match.events.push({ t: 'jump', id: f.id, x: f.x, y: f.y });
    }
  }
  // drop through a soft platform
  if (f.grounded && downPressed && f.on >= 0 && match.stage.plats[f.on].soft && !f.act) {
    f.dropping = 10;
    f.grounded = false;
    f.on = -1;
    f.y += 2;
  }
  // run / drift
  const moving = !f.act || f.act.move === 'recovery' || !f.grounded;
  if (f.grounded) {
    if (moving && Math.abs(i.mx) > 0.2) {
      f.vx += Math.sign(i.mx) * RUN_ACCEL * DT;
      if (Math.abs(f.vx) > RUN * Math.abs(i.mx)) f.vx = Math.sign(f.vx) * RUN * Math.max(0.4, Math.abs(i.mx));
      if (!f.act) f.facing = i.mx > 0 ? 1 : -1;
    } else {
      f.vx *= GROUND_FRICTION;
    }
  } else if (moving && Math.abs(i.mx) > 0.2) {
    const want = Math.sign(i.mx) * AIR_MAX;
    if (Math.abs(f.vx) < AIR_MAX || Math.sign(f.vx) !== Math.sign(i.mx)) f.vx += Math.sign(want - f.vx) * AIR_ACCEL * DT;
  }
  // fast fall
  if (!f.grounded && i.my > 0.6 && f.vy > -40 && !f.act) f.vy = Math.max(f.vy, FAST_FALL * 0.8);
}

function hurtbox(f: Fighter) {
  return { x0: f.x - BODY_W / 2, x1: f.x + BODY_W / 2, y0: f.y - BODY_H, y1: f.y };
}
function hitbox(f: Fighter, mv: Move) {
  const x0 = f.facing > 0 ? f.x + mv.hx : f.x - mv.hx - mv.hw;
  return { x0, x1: x0 + mv.hw, y0: f.y + mv.hy, y1: f.y + mv.hy + mv.hh };
}
const overlap = (a: { x0: number; x1: number; y0: number; y1: number }, b: { x0: number; x1: number; y0: number; y1: number }) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
export { hitbox as moveHitbox };

/** Attacks landing, this frame. */
function strike(match: Match) {
  for (const a of match.fighters) {
    if (!alive(a) || !a.act || a.freeze > 0) continue;
    const mv = moveOf(a, a.act.move);
    const f = a.act.f;
    if (mv.guard || f < mv.start || f >= mv.start + mv.active) continue;
    const box = hitbox(a, mv);
    for (const d of match.fighters) {
      if (d === a || !alive(d) || d.invuln > 0 || a.act.hit.includes(d.id)) continue;
      if (match.mode !== 'ffa' && d.team === a.team) continue;
      if (!overlap(box, hurtbox(d))) continue;
      const heavy = a.act.move.endsWith('Heavy') || a.act.move === 'pound' || a.act.move === 'special' || isSkillMove(a.act.move);
      if (match.authority === false) {
        // a guest: only its own swings, and only the spark and sound; the host's snapshot brings the hit
        if (a.id !== match.local) continue;
        a.act.hit.push(d.id);
        match.events.push({ t: 'hit', id: d.id, by: a.id, x: d.x, y: d.y - BODY_H / 2, dmg: mv.dmg, kb: 0, heavy });
        continue;
      }
      a.act.hit.push(d.id);
      // Diamond Hands: the hit is turned back on the one who swung
      const dm = d.act ? moveOf(d, d.act.move) : null;
      if (dm?.guard && d.act && d.act.f >= dm.start && d.act.f < dm.start + dm.active && !d.act.hit.includes(a.id)) {
        d.act.hit.push(a.id);
        d.act.f = dm.start + dm.active;
        match.events.push({ t: 'counter', id: d.id, by: a.id, x: d.x, y: d.y - BODY_H / 2 });
        land(match, d, a, dm, true);
        break;
      }
      land(match, a, d, mv, heavy || mv.dmg >= 12);
      if (a.act.move !== 'special') a.meter = Math.min(METER_FULL, a.meter + mv.dmg * METER_DEAL);
    }
  }
}

/** a lands a hit with move mv on d */
function land(match: Match, a: Fighter, d: Fighter, mv: Move, heavy: boolean) {
  d.hitN++;
  d.dmg = Math.min(999, d.dmg + mv.dmg);
  d.meter = Math.min(METER_FULL, d.meter + mv.dmg * METER_TAKE);
  const kb = mv.base + (mv.growth * d.dmg) / 100;
  // the launch angle, mirrored by facing; a hit from behind still sends them away from the attacker
  const dir = d.x >= a.x ? 1 : -1;
  let face: number = mv.away || Math.abs(mv.angle) >= 85 ? dir : a.facing;
  let angle = mv.angle;
  if (mv.grab) {
    // the throw goes where the stick points: down spikes, toward throws forward, away throws behind, none throws up
    const sx = a.prev.mx * a.facing;
    if (a.prev.my > 0.5) angle = 70;
    else if (sx > 0.3) angle = -30;
    else if (sx < -0.3) {
      angle = -30;
      face = -a.facing;
    }
    match.events.push({ t: 'throw', id: d.id, by: a.id, x: d.x, y: d.y - BODY_H / 2 });
  }
  const rad = (angle * Math.PI) / 180;
  d.vx = Math.cos(rad) * kb * face;
  d.vy = Math.sin(rad) * kb;
  if (mv.pull) {
    // dragged in to just in front of the attacker
    const to = a.x + a.facing * 16;
    d.vx = Math.max(-420, Math.min(420, (to - d.x) * 7));
    d.vy = -90;
  }
  // grounded and sent down: bounce up instead
  if (d.grounded && d.vy > 0) d.vy = -d.vy * 0.5;
  d.grounded = d.vy >= 0 && d.grounded;
  if (d.vy < 0) {
    d.grounded = false;
    d.on = -1;
  }
  d.hitstun = mv.pull ? 24 : Math.round(Math.min(60, 6 + kb * 0.05));
  d.hang = 0;
  d.ledgeCool = 30;
  d.act = null;
  d.dodge = 0;
  d.lastBy = a.id;
  d.lastAt = match.frame;
  // a hit resets the air options, so you can recover
  d.airJumps = 1;
  d.recoveryUsed = false;
  d.airDodgeUsed = false;
  const stop = Math.round(Math.min(10, 3 + mv.dmg / 3));
  a.freeze = stop;
  d.freeze = stop;
  match.events.push({ t: 'hit', id: d.id, by: a.id, x: d.x, y: d.y - BODY_H / 2, dmg: mv.dmg, kb, heavy: kb > 300 || heavy });
}

/** Gravity, platforms and the blast zone. */
function physics(match: Match, f: Fighter) {
  const st = match.stage;
  if (f.hang > 0) return;
  if (!f.grounded) {
    const slam = f.act && moveOf(f, f.act.move).slam;
    f.vy += GRAV * DT;
    const cap = slam ? FAST_FALL * 1.3 : f.hitstun > 0 ? 9999 : f.prev.my > 0.6 ? FAST_FALL : MAX_FALL;
    if (f.vy > cap) f.vy = cap;
    if (slam) f.vx *= 0.9;
    f.vx *= f.hitstun > 0 ? KB_DRAG : AIR_DRAG;
  }
  const ox = f.x;
  const oy = f.y;
  f.x += f.vx * DT;
  f.y += f.vy * DT;
  // landing: crossing a platform top while falling
  if (f.vy >= 0) {
    for (let k = 0; k < st.plats.length; k++) {
      const p = st.plats[k];
      if (p.soft && f.dropping > 0) continue;
      if (f.x < p.x0 - 2 || f.x > p.x1 + 2) continue;
      if (oy <= p.y + 0.5 && f.y >= p.y) {
        // a hard hit bounces off the floor instead of landing
        if (f.hitstun > 0 && f.vy > 330) {
          f.y = p.y;
          f.vy = -f.vy * 0.45;
          match.events.push({ t: 'land', id: f.id, x: f.x, y: p.y, heavy: true });
          break;
        }
        const was = f.grounded;
        f.y = p.y;
        f.vy = 0;
        f.grounded = true;
        f.on = k;
        f.airJumps = 1;
        f.recoveryUsed = false;
        f.airDodgeUsed = false;
        if (f.act && moveOf(f, f.act.move).air) {
          const slam = moveOf(f, f.act.move).slam;
          f.act = null;
          if (slam) f.freeze = 6;
        }
        if (!was) match.events.push({ t: 'land', id: f.id, x: f.x, y: p.y });
        break;
      }
    }
  }
  // the main stage is solid from below and from the sides
  for (const p of st.plats) {
    if (p.soft) continue;
    const body = { x0: f.x - BODY_W / 2, x1: f.x + BODY_W / 2, y0: f.y - BODY_H, y1: f.y };
    const block = { x0: p.x0, x1: p.x1, y0: p.y + 0.5, y1: p.y + 36 };
    if (!overlap(body, block)) continue;
    if (oy - BODY_H >= block.y1 - 1) {
      f.y = block.y1 + BODY_H;
      if (f.vy < 0) f.vy = 0;
    } else if (ox <= p.x0) {
      f.x = p.x0 - BODY_W / 2;
      if (f.vx > 0) f.vx = f.hitstun > 0 ? -f.vx * 0.4 : 0;
    } else if (ox >= p.x1) {
      f.x = p.x1 + BODY_W / 2;
      if (f.vx < 0) f.vx = f.hitstun > 0 ? -f.vx * 0.4 : 0;
    }
  }
  // walked off the edge
  if (f.grounded) {
    const p = st.plats[f.on];
    if (!p || f.x < p.x0 - 2 || f.x > p.x1 + 2) {
      f.grounded = false;
      f.on = -1;
    }
  }
}

function ko(match: Match, f: Fighter) {
  const b = match.stage.blast;
  if (f.x > b.x0 && f.x < b.x1 && f.y > b.y0 && f.y < b.y1) return;
  f.stocks--;
  f.falls++;
  const by = f.lastBy && match.frame - f.lastAt < 6 * FPS ? match.fighters.find((x) => x.id === f.lastBy) : undefined;
  if (by) by.kos++;
  match.events.push({ t: 'ko', id: f.id, by: by?.id, x: Math.max(b.x0, Math.min(b.x1, f.x)), y: Math.max(b.y0, Math.min(b.y1, f.y)) });
  f.act = null;
  f.hitstun = 0;
  f.vx = 0;
  f.vy = 0;
  f.dmg = 0;
  f.lastBy = null;
  if (f.stocks > 0) {
    f.respawn = RESPAWN_F;
  } else {
    f.place = match.fighters.filter((x) => x.stocks > 0).length + 1;
  }
}

/** Tunnel Dig: pop up behind the nearest foe standing or falling (it stays put if nobody is in reach). */
function tunnel(match: Match, f: Fighter) {
  let best: Fighter | null = null;
  for (const o of match.fighters) {
    if (o === f || !alive(o) || (match.mode !== 'ffa' && o.team === f.team)) continue;
    if (!best || Math.abs(o.x - f.x) < Math.abs(best.x - f.x)) best = o;
  }
  if (!best || Math.abs(best.x - f.x) > 170) return;
  f.x = best.x - best.facing * 20;
  f.y = best.y;
  f.vx = 0;
  f.vy = 0;
  f.grounded = best.grounded;
  f.on = best.on;
  f.facing = best.facing;
  match.events.push({ t: 'blink', id: f.id, x: f.x, y: f.y });
}

/** Falling past the end of a solid platform, close to its edge: grab the ledge. */
function grabLedge(match: Match, f: Fighter) {
  if (f.hang > 0 || f.grounded || f.vy < 0 || f.hitstun > 0 || f.ledgeCool > 0 || f.dodge > 0) return;
  if (f.act && !moveOf(f, f.act.move).air && f.act.move !== 'special') return;
  const plats = match.stage.plats;
  for (let k = 0; k < plats.length; k++) {
    const p = plats[k];
    if (p.soft || f.y < p.y + 4 || f.y > p.y + 28) continue;
    const left = f.x > p.x0 - 16 && f.x < p.x0 - 1;
    const right = f.x < p.x1 + 16 && f.x > p.x1 + 1;
    if (!left && !right) continue;
    // someone already hangs there
    if (match.fighters.some((o) => o !== f && o.hang > 0 && o.ledge === k && (o.x < (p.x0 + p.x1) / 2) === left)) continue;
    f.hang = 1;
    f.ledge = k;
    f.facing = left ? 1 : -1;
    f.x = left ? p.x0 - 6 : p.x1 + 6;
    f.y = p.y + 20;
    f.vx = 0;
    f.vy = 0;
    f.act = null;
    f.invuln = Math.max(f.invuln, HANG_INV);
    f.airJumps = 1;
    f.recoveryUsed = false;
    f.airDodgeUsed = false;
    match.events.push({ t: 'grab', id: f.id, x: f.x, y: p.y });
    return;
  }
}

/** Advance the match one frame. `inputs` by fighter id (missing = no buttons). */
export function step(match: Match, inputs: Record<string, Input>) {
  match.events.length = 0;
  if (match.over) return;
  match.frame++;
  if (match.countdown > 0) {
    match.countdown--;
    for (const f of match.fighters) {
      f.prev = { ...(inputs[f.id] ?? NO_INPUT) };
      physics(match, f);
    }
    if (match.countdown === 0) match.events.push({ t: 'go' });
    return;
  }
  if (!match.sudden && match.timeLeft > 0) match.timeLeft--;
  for (const f of match.fighters) {
    if (f.stocks <= 0) continue;
    if (f.respawn > 0) {
      f.respawn--;
      if (f.respawn === 0) {
        [f.x, f.y] = match.stage.respawn;
        f.vx = 0;
        f.vy = 0;
        f.invuln = RESPAWN_INV;
        f.grounded = false;
        f.on = -1;
        f.airJumps = 1;
        f.recoveryUsed = false;
        f.airDodgeUsed = false;
        match.events.push({ t: 'spawn', id: f.id, x: f.x, y: f.y });
      }
      continue;
    }
    if (f.invuln > 0) f.invuln--;
    if (f.freeze > 0) {
      f.freeze--;
      continue;
    }
    control(match, f, inputs[f.id] ?? NO_INPUT);
    if (f.act) {
      f.act.f++;
      const mv = moveOf(f, f.act.move);
      if (mv.blink && f.act.f === mv.start) tunnel(match, f);
      // a ground pound keeps going until it lands; everything else ends on time
      if (mv.slam) {
        if (f.act.f >= mv.start + mv.active) f.act.f = mv.start + mv.active - 1;
        if (f.act.f >= mv.start) f.vy = FAST_FALL * 1.3;
      } else if (f.act.f >= mv.start + mv.active + mv.end) f.act = null;
    }
    physics(match, f);
    grabLedge(match, f);
  }
  strike(match);
  if (match.authority === false) return;
  for (const f of match.fighters) if (f.stocks > 0 && f.respawn === 0) ko(match, f);
  // the end: one fighter (or one team) left, or the clock ran out
  const left = match.fighters.filter(inPlay);
  if (left.length > 1 && match.timeLeft <= 0 && !match.sudden) {
    const order = [...left].sort((a, b) => b.stocks - a.stocks || a.dmg - b.dmg);
    const top = order.filter((f) => f.stocks === order[0].stocks);
    if (top.length > 1) {
      // a tie on lives: sudden death between the tied, one life each and already hurt; the rest are out
      match.sudden = true;
      const rest = order.filter((f) => !top.includes(f));
      rest.forEach((f, k) => {
        f.place = top.length + k + 1;
        f.stocks = 0;
      });
      for (const f of top) {
        f.stocks = 1;
        f.dmg = Math.max(f.dmg, 120);
        f.meter = METER_FULL;
      }
      match.events.push({ t: 'sudden' });
      return;
    }
  }
  if (left.length <= 1 || (match.timeLeft <= 0 && !match.sudden)) {
    const order = [...left].sort((a, b) => b.stocks - a.stocks || a.dmg - b.dmg);
    order.forEach((f, k) => (f.place = k + 1));
    match.over = true;
    match.events.push({ t: 'end' });
  }
}

/** The view a renderer needs of one fighter. */
export function poseOf(f: Fighter): { pose: 'idle' | 'walk' | 'swing' | 'cheer'; k: number; air: boolean } {
  if (f.act) {
    const mv = moveOf(f, f.act.move);
    const total = mv.start + mv.active + mv.end;
    // the swing's 6 frames: wind up through the start, frame 3 is the hit
    const k = f.act.f < mv.start ? Math.floor((f.act.f / Math.max(1, mv.start)) * 3) : f.act.f < mv.start + mv.active ? 3 : 4 + Math.min(1, Math.floor(((f.act.f - mv.start - mv.active) / Math.max(1, mv.end)) * 2));
    return { pose: 'swing', k: Math.min(5, k), air: !f.grounded && total > 0 };
  }
  if (f.hang > 0) return { pose: 'idle', k: 1, air: true };
  if (!f.grounded) return { pose: 'idle', k: f.vy < 0 ? 1 : 2, air: true };
  if (Math.abs(f.vx) > 20) return { pose: 'walk', k: -1, air: false };
  return { pose: 'idle', k: -1, air: false };
}
