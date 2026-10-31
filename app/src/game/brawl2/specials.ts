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
import type { SpecialId } from './sim';

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
