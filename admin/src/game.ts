// Game values the admin page shows. Copied from app/src/game/constants.ts so the admin build
// does not depend on the Expo app's packages; keep them in sync when the shop changes.
export const MOTHERLODE_ODDS = 625;
export const SKR_USD = 0.018;
export const GEAR: { id: number; kind: string; name: string }[] = [
  { id: 0, kind: 'pickaxe', name: 'Kayu Pick' },
  { id: 1, kind: 'pickaxe', name: 'Besi Pick' },
  { id: 2, kind: 'pickaxe', name: 'Emas Pick' },
  { id: 3, kind: 'pickaxe', name: 'Permata Pick' },
  { id: 4, kind: 'pickaxe', name: 'Neon Drill' },
  { id: 5, kind: 'pickaxe', name: 'Seeker Splitter' },
  { id: 6, kind: 'helmet', name: 'Classic Hardhat' },
  { id: 7, kind: 'helmet', name: 'Merah Helmet' },
  { id: 8, kind: 'helmet', name: 'Lagun Helmet' },
  { id: 9, kind: 'helmet', name: 'Songkok Lampu' },
  { id: 10, kind: 'helmet', name: 'Raja Crown' },
  { id: 11, kind: 'helmet', name: 'Deep Core Dome' },
  { id: 12, kind: 'outfit', name: 'Blue Overalls' },
  { id: 13, kind: 'outfit', name: 'Kampung Khaki' },
  { id: 14, kind: 'outfit', name: 'Batik Digger' },
  { id: 15, kind: 'outfit', name: 'Hi-Vis Hazard' },
  { id: 16, kind: 'outfit', name: 'Golden Suit' },
  { id: 17, kind: 'pet', name: 'Baby Mole' },
  { id: 18, kind: 'pet', name: 'Cave Bat' },
  { id: 19, kind: 'pet', name: 'Gem Sprite' },
  { id: 20, kind: 'pet', name: 'Pelita Firefly' },
];
