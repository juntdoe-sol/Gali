// Mirrors the on-chain config set by scripts/setup-devnet.ts.
export const GRID = 5;
export const BLOCKS = GRID * GRID;
export const ROUND_SECS = 60;
export const LOCK_MS = 3_000;
export const REVEAL_MIN_MS = 4_500; // animation length once the winner is known
export const BASE_POINTS = 40; // points for covering every block; × 25/blocks otherwise
export const MOTHERLODE_POINTS = 10_000;
export const MOTHERLODE_ODDS = 625;
export const CAVE_IN_EVERY = 10;

export const pointsFor = (covered: number, motherlode: boolean, boostBps: number) =>
  Math.floor(((Math.floor((BASE_POINTS * BLOCKS) / Math.max(1, covered)) + (motherlode ? MOTHERLODE_POINTS : 0)) * boostBps) / 10_000);

/** SKR boost tiers (whole SKR). Match boost_tier1/2 in the program config. */
export const BOOST_TIERS = [
  { min: 0, bps: 10_000, label: 'No boost' },
  { min: 5_000, bps: 12_500, label: '1.25x points' },
  { min: 50_000, bps: 15_000, label: '1.5x points' },
];
export const boostFor = (stakedSkr: number) => [...BOOST_TIERS].reverse().find((t) => stakedSkr >= t.min)!.bps;

export const SEASON = { name: 'Season 1: Batu Awal', endsAt: new Date('2026-10-31T23:59:59+08:00').getTime() };

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export type GearKind = 'pickaxe' | 'helmet' | 'outfit' | 'pet';
export interface Gear {
  id: number; // on-chain item id (bit index in gear_mask)
  key: string;
  kind: GearKind;
  name: string;
  priceSkr: number;
  color: string; // main colour (handle / shell / overalls / body)
  accent: string; // secondary colour (head / lamp / shirt / glow)
  rarity: Rarity;
  perk: string;
}

/** Whole-SKR prices. Keep ids and prices in sync with scripts/setup-devnet.ts GEAR_PRICES. */
export const GEAR: Gear[] = [
  // pickaxes 0-5
  { id: 0, key: 'pick-wood', kind: 'pickaxe', name: 'Kayu Pick', priceSkr: 0, color: '#9b6b43', accent: '#c9c9c9', rarity: 'common', perk: 'Starter tool' },
  { id: 1, key: 'pick-iron', kind: 'pickaxe', name: 'Besi Pick', priceSkr: 250, color: '#6b4a32', accent: '#b8c4d6', rarity: 'common', perk: 'Steel shine' },
  { id: 2, key: 'pick-gold', kind: 'pickaxe', name: 'Emas Pick', priceSkr: 800, color: '#5a3a24', accent: '#ffc83d', rarity: 'rare', perk: 'Gold sparks' },
  { id: 3, key: 'pick-gem', kind: 'pickaxe', name: 'Permata Pick', priceSkr: 2000, color: '#2b2140', accent: '#3de0c8', rarity: 'epic', perk: 'Gem trail' },
  { id: 4, key: 'pick-neon', kind: 'pickaxe', name: 'Neon Drill', priceSkr: 5000, color: '#1a1a2e', accent: '#ff4fd8', rarity: 'legendary', perk: 'Neon glow + sparkles' },
  { id: 5, key: 'pick-seeker', kind: 'pickaxe', name: 'Seeker Splitter', priceSkr: 12000, color: '#10151f', accent: '#c7f284', rarity: 'legendary', perk: 'SKR-green blade, lime sparkles' },
  // helmets 6-11
  { id: 6, key: 'hat-yellow', kind: 'helmet', name: 'Classic Hardhat', priceSkr: 0, color: '#ffc83d', accent: '#fff6c9', rarity: 'common', perk: 'Starter helmet' },
  { id: 7, key: 'hat-red', kind: 'helmet', name: 'Merah Helmet', priceSkr: 300, color: '#ff5a4f', accent: '#fff0c0', rarity: 'common', perk: 'Cosmetic' },
  { id: 8, key: 'hat-teal', kind: 'helmet', name: 'Lagun Helmet', priceSkr: 1000, color: '#3de0c8', accent: '#e8fffb', rarity: 'rare', perk: 'Cool lamp' },
  { id: 9, key: 'hat-songkok', kind: 'helmet', name: 'Songkok Lampu', priceSkr: 2500, color: '#1d1b2e', accent: '#ffd84d', rarity: 'epic', perk: 'Gold-trim songkok with a lamp' },
  { id: 10, key: 'hat-crown', kind: 'helmet', name: 'Raja Crown', priceSkr: 6000, color: '#ffd84d', accent: '#ff4fd8', rarity: 'legendary', perk: 'Crown lamp' },
  { id: 11, key: 'hat-astro', kind: 'helmet', name: 'Deep Core Dome', priceSkr: 15000, color: '#dfe7ff', accent: '#7ad7ff', rarity: 'legendary', perk: 'Glass dome for the deepest shafts' },
  // outfits 12-16
  { id: 12, key: 'fit-blue', kind: 'outfit', name: 'Blue Overalls', priceSkr: 0, color: '#2f5fd0', accent: '#ff8a3d', rarity: 'common', perk: 'Starter outfit' },
  { id: 13, key: 'fit-khaki', kind: 'outfit', name: 'Kampung Khaki', priceSkr: 200, color: '#8a7a4a', accent: '#f2efe4', rarity: 'common', perk: 'Field-ready' },
  { id: 14, key: 'fit-batik', kind: 'outfit', name: 'Batik Digger', priceSkr: 900, color: '#7a2f5c', accent: '#ffc83d', rarity: 'rare', perk: 'Batik-red overalls' },
  { id: 15, key: 'fit-hazard', kind: 'outfit', name: 'Hi-Vis Hazard', priceSkr: 2200, color: '#ff7a00', accent: '#e8ff4a', rarity: 'epic', perk: 'Glows in the dark' },
  { id: 16, key: 'fit-gold', kind: 'outfit', name: 'Golden Suit', priceSkr: 8000, color: '#e0a92a', accent: '#fff3c0', rarity: 'legendary', perk: 'Head-to-toe gold' },
  // pets 17-20
  { id: 17, key: 'pet-mole', kind: 'pet', name: 'Baby Mole', priceSkr: 500, color: '#8a5a3c', accent: '#ff7fa0', rarity: 'common', perk: 'Follows you and cheers on wins' },
  { id: 18, key: 'pet-bat', kind: 'pet', name: 'Cave Bat', priceSkr: 1500, color: '#4a3a66', accent: '#ffc83d', rarity: 'rare', perk: 'Flaps around your helmet' },
  { id: 19, key: 'pet-sprite', kind: 'pet', name: 'Gem Sprite', priceSkr: 4000, color: '#3de0c8', accent: '#b86bff', rarity: 'epic', perk: 'A floating crystal friend' },
  { id: 20, key: 'pet-firefly', kind: 'pet', name: 'Pelita Firefly', priceSkr: 10000, color: '#c7f284', accent: '#fff6c9', rarity: 'legendary', perk: 'Lights up the whole mine' },
];
export const GEAR_KINDS: { kind: GearKind; label: string }[] = [
  { kind: 'pickaxe', label: 'Pickaxes' },
  { kind: 'helmet', label: 'Helmets' },
  { kind: 'outfit', label: 'Outfits' },
  { kind: 'pet', label: 'Pets' },
];
export const FREE_GEAR_MASK = GEAR.filter((g) => g.priceSkr === 0).reduce((m, g) => m | (1 << g.id), 0);
export const gearByKey = (k: string | null | undefined) => GEAR.find((g) => g.key === k);
// SKR economy, priced at roughly 1 SKR = $0.018 (55 SKR = $1). Keep in sync with scripts/setup-devnet.ts.
export const SKR_USD = 0.018;
export const MOTHERLODE_ACCRUAL_SKR = 40; // added to the Motherlode Pool by every played round; a hit pays out the whole pool
export const MOTHERLODE_POOL_SHARE = 0.3; // share of each gear sale that feeds the Motherlode Pool
export const REWARDS_POOL_SHARE = 0.4; // share of each gear sale that feeds the Rewards Pool
export const ROUND_REWARD_SKR = 200; // SKR mined per round: split pro rata on the winning spot, or all to one miner if a solo spot wins
export const usd = (skr: number) => `$${(skr * SKR_USD).toLocaleString(undefined, { maximumFractionDigits: skr * SKR_USD < 10 ? 2 : 0 })}`;

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
  { id: 'dig5', label: 'Play 5 rounds', target: 5, rewardXp: 60 },
  { id: 'win1', label: 'Strike gold once', target: 1, rewardXp: 80 },
  { id: 'sharp', label: 'Win with 5 spots or fewer', target: 1, rewardXp: 120 },
  { id: 'shake', label: 'Shake your phone to Smart-pick', target: 1, rewardXp: 40 },
  { id: 'mole3', label: 'Bonk 3 moles', target: 3, rewardXp: 50 },
];

export interface AchDef {
  id: string;
  label: string;
  desc: string;
}
export const ACHIEVEMENTS: AchDef[] = [
  { id: 'first-dig', label: 'First Swing', desc: 'Play your first round' },
  { id: 'first-win', label: 'Struck Gold', desc: 'Win your first round' },
  { id: 'wins-10', label: 'Seasoned Digger', desc: 'Win 10 rounds' },
  { id: 'sniper', label: 'Sniper', desc: 'Win with a single spot' },
  { id: 'motherlode', label: 'MOTHERLODE', desc: 'Hit the motherlode' },
  { id: 'lvl-5', label: 'Foreman', desc: 'Reach level 5' },
  { id: 'hot-3', label: 'On Fire', desc: 'Win 3 rounds in a row' },
  { id: 'moles-10', label: 'Mole Whacker', desc: 'Bonk 10 moles' },
  { id: 'staker', label: 'Seeker Backer', desc: 'Stake SKR for a boost' },
  { id: 'streak-3', label: 'Regular', desc: '3-day mining streak' },
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
  // arena theme: deep navy panels, gold trim, cyan energy
  bg: '#070d20',
  bg2: '#0c1734',
  card: '#0f1c3f',
  card2: '#172b58',
  line: '#2a4480',
  trim: '#c9a24e',
  trimHi: '#ffe7a3',
  text: '#f2f5ff',
  muted: '#8ea2cc',
  gold: '#ffcf4a',
  gold2: '#e08a1e',
  teal: '#3ee6ff',
  pink: '#ff5fa2',
  red: '#ff4d5e',
  green: '#4be38a',
  sol: '#14f195',
  skr: '#c7f284',
};
