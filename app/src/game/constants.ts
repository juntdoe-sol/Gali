// Mirrors the on-chain config set by scripts/setup-devnet.ts.
export const GRID = 5;
export const BLOCKS = GRID * GRID;
export const ROUND_SECS = 60;
export const LOCK_MS = 3_000;
export const REVEAL_MIN_MS = 4_500; // animation length once the winner is known
export const DAILY_FREE_DIGS = 30;
export const BASE_POINTS = 40; // points for covering every block; × 25/blocks otherwise
export const MOTHERLODE_POINTS = 10_000;
export const MOTHERLODE_ODDS = 625;
export const CAVE_IN_EVERY = 10;

export const pointsFor = (covered: number, motherlode: boolean, boostBps: number) =>
  Math.floor(((Math.floor((BASE_POINTS * BLOCKS) / Math.max(1, covered)) + (motherlode ? MOTHERLODE_POINTS : 0)) * boostBps) / 10_000);

/** SKR boost tiers (whole SKR). Match boost_tier1/2 in the program config. */
export const BOOST_TIERS = [
  { min: 0, bps: 10_000, label: 'No boost' },
  { min: 1_000, bps: 12_500, label: '1.25x points' },
  { min: 10_000, bps: 15_000, label: '1.5x points' },
];
export const boostFor = (stakedSkr: number) => [...BOOST_TIERS].reverse().find((t) => stakedSkr >= t.min)!.bps;

export const SEASON = { name: 'Season 1: Batu Awal', endsAt: new Date('2026-10-31T23:59:59+08:00').getTime() };

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export interface Gear {
  id: number; // on-chain item id (bit index in gear_mask)
  key: string;
  kind: 'pickaxe' | 'helmet';
  name: string;
  priceSkr: number;
  color: string;
  accent: string;
  rarity: Rarity;
  perk: string;
}

export const GEAR: Gear[] = [
  { id: 0, key: 'pick-wood', kind: 'pickaxe', name: 'Kayu Pick', priceSkr: 0, color: '#9b6b43', accent: '#c9c9c9', rarity: 'common', perk: 'Starter tool' },
  { id: 1, key: 'pick-iron', kind: 'pickaxe', name: 'Besi Pick', priceSkr: 50, color: '#6b4a32', accent: '#b8c4d6', rarity: 'common', perk: 'Steel shine' },
  { id: 2, key: 'pick-gold', kind: 'pickaxe', name: 'Emas Pick', priceSkr: 200, color: '#5a3a24', accent: '#ffc83d', rarity: 'rare', perk: 'Gold sparks' },
  { id: 3, key: 'pick-gem', kind: 'pickaxe', name: 'Permata Pick', priceSkr: 500, color: '#2b2140', accent: '#3de0c8', rarity: 'epic', perk: 'Gem trail' },
  { id: 4, key: 'pick-neon', kind: 'pickaxe', name: 'Neon Drill', priceSkr: 1200, color: '#1a1a2e', accent: '#ff4fd8', rarity: 'legendary', perk: 'Neon glow + sparkles' },
  { id: 5, key: 'hat-yellow', kind: 'helmet', name: 'Classic Hardhat', priceSkr: 0, color: '#ffc83d', accent: '#fff6c9', rarity: 'common', perk: 'Starter helmet' },
  { id: 6, key: 'hat-red', kind: 'helmet', name: 'Merah Helmet', priceSkr: 80, color: '#ff5a4f', accent: '#fff0c0', rarity: 'common', perk: 'Cosmetic' },
  { id: 7, key: 'hat-teal', kind: 'helmet', name: 'Lagun Helmet', priceSkr: 300, color: '#3de0c8', accent: '#e8fffb', rarity: 'rare', perk: 'Cosmetic' },
  { id: 8, key: 'hat-crown', kind: 'helmet', name: 'Raja Crown', priceSkr: 2000, color: '#ffd84d', accent: '#ff4fd8', rarity: 'legendary', perk: 'Crown lamp' },
];
export const FREE_GEAR_MASK = GEAR.filter((g) => g.priceSkr === 0).reduce((m, g) => m | (1 << g.id), 0);
export const gearByKey = (k: string) => GEAR.find((g) => g.key === k) ?? GEAR[0];

export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#b8b0c8',
  rare: '#4fa8ff',
  epic: '#b86bff',
  legendary: '#ffb020',
};

export interface QuestDef {
  id: string;
  label: string;
  target: number;
  rewardXp: number;
}
export const QUESTS: QuestDef[] = [
  { id: 'dig5', label: 'Dig in 5 rounds', target: 5, rewardXp: 60 },
  { id: 'win1', label: 'Strike ore once', target: 1, rewardXp: 80 },
  { id: 'sharp', label: 'Win with 5 blocks or fewer', target: 1, rewardXp: 120 },
  { id: 'shake', label: 'Shake your phone to dig', target: 1, rewardXp: 40 },
  { id: 'mole3', label: 'Bonk 3 moles', target: 3, rewardXp: 50 },
];

export interface AchDef {
  id: string;
  label: string;
  desc: string;
}
export const ACHIEVEMENTS: AchDef[] = [
  { id: 'first-dig', label: 'First Swing', desc: 'Dig your first round' },
  { id: 'first-win', label: 'Struck Ore', desc: 'Win your first round' },
  { id: 'wins-10', label: 'Seasoned Digger', desc: 'Win 10 rounds' },
  { id: 'sniper', label: 'Sniper', desc: 'Win with a single block' },
  { id: 'motherlode', label: 'MOTHERLODE', desc: 'Hit the motherlode' },
  { id: 'lvl-5', label: 'Foreman', desc: 'Reach level 5' },
  { id: 'hot-3', label: 'On Fire', desc: 'Win 3 rounds in a row' },
  { id: 'moles-10', label: 'Mole Whacker', desc: 'Bonk 10 moles' },
  { id: 'staker', label: 'Seeker Backer', desc: 'Stake SKR for a boost' },
  { id: 'streak-3', label: 'Regular', desc: '3-day dig streak' },
];

export const levelFromXp = (xp: number) => {
  let lvl = 1;
  while (xp >= (100 * lvl * (lvl + 1)) / 2) lvl++;
  return lvl;
};
export const xpForLevel = (lvl: number) => (100 * (lvl - 1) * lvl) / 2;

export const localDay = (t = Date.now()) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const COLORS = {
  bg: '#1b1426',
  bg2: '#251b35',
  card: '#2d2240',
  card2: '#382a50',
  line: '#4a3a66',
  text: '#fff6e8',
  muted: '#b8a9cf',
  gold: '#ffc83d',
  gold2: '#ff9f1a',
  teal: '#3de0c8',
  pink: '#ff6b9a',
  red: '#ff5a4f',
  green: '#5be37d',
  sol: '#14f195',
  skr: '#c7f284',
};
