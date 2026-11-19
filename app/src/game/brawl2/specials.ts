/**
 * Gali Fightclub special moves, and which item gives which.
 *
 * Specials belong to weapon families (sim.ts SPECIALS, tuned equally strong). An item picks its family from the
 * kind of tool it is (hammer, axe, blade...) or, for pickaxes, from its theme (its set). The item itself only adds
 * flavour: the special's name stays the family's, the colour comes from the item.
 *
 * Ready for NFT items: specialOf() takes any item with a name, and optionally a set and an id (Gear 555 items,
 * certificate rewards, future NFT drops). A new family is one entry in SPECIALS and one here.
 */
import type { SkillId, SpecialId } from './sim';

export interface SpecialInfo {
  id: SpecialId;
  name: string;
  /** one line for the menu */
  line: string;
  /** how to aim it, one short line */
  how: string;
  color: string;
}
export const SPECIAL_INFO: Record<SpecialId, SpecialInfo> = {
  quake: { id: 'quake', name: 'ORE QUAKE', line: 'Stamp the floor. The shockwave launches miners on both sides.', how: 'Best when they are close on the ground', color: '#ffc93c' },
  rush: { id: 'rush', name: 'RUSH STRIKE', line: 'Dash straight through a miner and send them flying.', how: 'Face them from across the stage', color: '#4fd6ef' },
  moon: { id: 'moon', name: 'MOON SHOT', line: 'A rising uppercut. Also gets you back to the stage.', how: 'Under them, or when you fall off', color: '#8ef06a' },
  whirl: { id: 'whirl', name: 'WHIRLWIND', line: 'Spin and hit everything around you.', how: 'When you are surrounded', color: '#ff8ad8' },
  dive: { id: 'dive', name: 'LIQUIDATION', line: 'Hop and dive forward, spiking miners down.', how: 'Off the edge, over their head', color: '#ff5a6a' },
  guard: { id: 'guard', name: 'DIAMOND HANDS', line: 'Hold firm. Whoever hits you gets hit back hard.', how: 'Right before they swing', color: '#c8f0ff' },
};

/** A skill (sim.ts SKILLS): the six specials are free starters, the rest cost NUGS (supabase/sql/nugs-skills.sql). */
export interface SkillInfo {
  id: SkillId;
  name: string;
  line: string;
  how: string;
  color: string;
  /** NUGS, 0 = free for everyone */
  price: number;
  /** a word for the kind of move, for the shop's tag */
  kind: string;
}
const fromSpecial = (id: SpecialId, kind: string): SkillInfo => ({ ...SPECIAL_INFO[id], price: 0, kind });
export const SKILL_INFO: Record<SkillId, SkillInfo> = {
  moon: fromSpecial('moon', 'LAUNCHER'),
  rush: fromSpecial('rush', 'DASH'),
  quake: fromSpecial('quake', 'SHOCKWAVE'),
  whirl: fromSpecial('whirl', 'SPIN'),
  dive: fromSpecial('dive', 'SPIKE'),
  guard: fromSpecial('guard', 'COUNTER'),
  grab: { id: 'grab', name: 'ORE GRAB', line: 'Grab a miner and throw them: up, forward, behind or down.', how: 'Up close; point the stick where they should go', color: '#ffb347', price: 2000, kind: 'GRAB' },
  magnet: { id: 'magnet', name: 'MAGNET HOOK', line: 'A long magnetic pull drags a miner right up to you.', how: 'From across the stage, then hit them', color: '#ff6b9d', price: 3000, kind: 'PULL' },
  dynamite: { id: 'dynamite', name: 'DYNAMITE TOSS', line: 'Lob a stick of dynamite a few steps ahead. Boom.', how: 'Keep your distance', color: '#ff5a3c', price: 4000, kind: 'THROW' },
  geyser: { id: 'geyser', name: 'GEYSER', line: 'The floor bursts ahead of you and blasts a miner straight up.', how: 'When they stand a little way off', color: '#5ad8ff', price: 5000, kind: 'TRAP' },
  cavein: { id: 'cavein', name: 'CAVE-IN', line: 'Rocks rain down just ahead, spiking miners to the floor.', how: 'On miners near the edge', color: '#c8a070', price: 6500, kind: 'SPIKE' },
  tunnel: { id: 'tunnel', name: 'TUNNEL DIG', line: 'Dig in, safe from hits, and pop up behind the nearest miner.', how: 'To dodge in and punish', color: '#b388ff', price: 8000, kind: 'TELEPORT' },
  slide: { id: 'slide', name: 'CART SLIDE', line: 'Slide low along the floor and sweep miners off their feet.', how: 'Under a swing, along the ground', color: '#ffd84a', price: 2500, kind: 'SWEEP' },
  boomerang: { id: 'boomerang', name: 'PICK BOOMERANG', line: 'Your pickaxe spins out ahead and catches a miner a few steps off.', how: 'Just out of their reach', color: '#9fe870', price: 3500, kind: 'RANGED' },
  sonar: { id: 'sonar', name: 'SONAR PULSE', line: 'A ring of sound bursts out all round you and shoves everyone away.', how: 'When they crowd you', color: '#3ee6ff', price: 4500, kind: 'RING' },
  boulder: { id: 'boulder', name: 'BOULDER ROLL', line: 'Curl up and roll forward through anyone in the way.', how: 'Across the stage at a miner who is busy', color: '#b0a090', price: 5500, kind: 'ROLL' },
  meteor: { id: 'meteor', name: 'ORE METEOR', line: 'Leap forward and crash down like a meteor, spiking miners.', how: 'From above, at the edge', color: '#ff8a3d', price: 7000, kind: 'SLAM' },
  drill: { id: 'drill', name: 'DRILL CHARGE', line: 'The fastest dash there is. Miss, and you are wide open.', how: 'Only when you are sure', color: '#e0e6f0', price: 10000, kind: 'CHARGE' },
  inferno: { id: 'inferno', name: 'INFERNO ROAD', line: 'A wave of fire races along the floor and sets everyone in it alight.', how: 'Down a long flat stage', color: '#ff7a2a', price: 6000, kind: 'FIRE FIELD' },
  jade: { id: 'jade', name: 'JADE VORTEX', line: 'A spiral of jade blades cuts all round you, wide and slow.', how: 'In the middle of a crowd', color: '#2ee6c0', price: 7500, kind: 'VORTEX' },
  taiji: { id: 'taiji', name: 'TAIJI SEAL', line: 'A seal opens under you and freezes everyone on it, then throws them up.', how: 'When they rush in close', color: '#6ab8ff', price: 9000, kind: 'SEAL' },
  thunder: { id: 'thunder', name: 'THUNDER CLEAVE', line: 'Charge, then split the floor ahead with lightning.', how: 'From far off, at a miner who is busy', color: '#ffd84a', price: 12000, kind: 'LIGHTNING' },
  pillar: { id: 'pillar', name: 'GOLDEN PILLAR', line: 'A pillar of gold light drops on a miner a long way off.', how: 'At a miner across the stage', color: '#ffe27a', price: 15000, kind: 'PILLAR' },
};
/** shop order: free first, then by price */
export const SKILL_ORDER: SkillId[] = ['moon', 'rush', 'quake', 'whirl', 'dive', 'guard', 'grab', 'slide', 'magnet', 'boomerang', 'dynamite', 'sonar', 'geyser', 'boulder', 'cavein', 'meteor', 'inferno', 'tunnel', 'jade', 'taiji', 'drill', 'thunder', 'pillar'];
export const FREE_SKILLS: SkillId[] = SKILL_ORDER.filter((k) => SKILL_INFO[k].price === 0);

/** Tool kinds in an item's name. */
const BY_TOOL: [RegExp, SpecialId][] = [
  [/\b(hammer|mace|mallet|maul)\b/i, 'quake'],
  [/\b(club|bat|wrench|bonk)\b/i, 'moon'],
  [/\b(blade|sword|katana|scythe|knife|dagger|splitter|cutter)\b/i, 'rush'],
  [/\b(axe|hatchet)\b/i, 'whirl'],
  [/\b(drill|shovel|spade|auger)\b/i, 'dive'],
];
/** Pickaxes: by the theme of their set. */
const BY_SET: Record<string, SpecialId> = {
  // hold the line
  'Diamond Hands': 'guard', Whale: 'guard', 'Validator Crew': 'guard', 'Rent Exempt': 'guard', 'Seeker Squad': 'guard', 'Founding Miner': 'guard',
  // down only
  'Red Candle': 'dive', Liquidated: 'dive', 'Rug Pull Survivor': 'dive', 'Paper Hands': 'dive', Jeet: 'dive', Burn: 'dive', 'This Is Fine': 'dive',
  // up only
  'Green Candle': 'moon', WAGMI: 'moon', 'Hopium and Copium': 'moon', 'Solana Summer': 'moon', 'Level 20': 'moon', 'Mint Day': 'moon', 'GM Club': 'moon',
  // fast
  'Sniper Bot': 'rush', '400ms': 'rush', 'Priority Fee': 'rush', 'Network Halt': 'rush', 'Blockhash Expired': 'rush', 'Level 10': 'rush', 'Cave Run': 'rush',
  // chaos
  Arcade: 'whirl', 'Galaxy Brain': 'whirl', 'Clan Wars': 'whirl', 'Brawl Arena': 'whirl', 'Monke Business': 'whirl', 'Frog Pond': 'whirl', 'Probably Nothing': 'whirl',
  // the mine
  Nusantara: 'quake', 'ORE Refinery': 'quake', Motherlode: 'quake', 'Island Life': 'quake', 'Lobby Life': 'quake', Compressed: 'quake',
};
const ORDER: SpecialId[] = ['quake', 'rush', 'moon', 'whirl', 'dive', 'guard'];
/** The shop pickaxes of today (game/constants.ts GEAR): one each, so every tier plays a little different. */
const BY_KEY: Record<string, SpecialId> = {
  'pick-wood': 'quake',
  'pick-iron': 'rush',
  'pick-gold': 'moon',
  'pick-gem': 'guard',
  'pick-neon': 'dive',
  'pick-seeker': 'whirl',
};

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** The special an item gives. Works for shop gear ({key, name}), Gear 555 and NFT items ({id, name, set}). */
export function specialOf(item: { key?: string; id?: string; name?: string; set?: string } | null | undefined): SpecialId {
  if (!item) return 'quake';
  if (item.key && BY_KEY[item.key]) return BY_KEY[item.key];
  const name = item.name ?? '';
  for (const [re, sp] of BY_TOOL) if (re.test(name)) return sp;
  if (item.set && BY_SET[item.set]) return BY_SET[item.set];
  const seed = item.set || item.id || item.key || name;
  return seed ? ORDER[hash(seed) % ORDER.length] : 'quake';
}
