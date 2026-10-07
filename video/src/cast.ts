/**
 * Who is in the film. YOU is the same miner on the island, in the lobby and down the cave. The lobby crowd is
 * a couple of dozen players with their own hats, outfits, picks and pets, boys and girls.
 */
import type { Look } from '../../app/src/engine/types';

export const LOOK: Look = { hat: 'hat-songkok', fit: '#7a2f5c', pick: '#ffc83d', handle: '#5a3a24', pet: 'pet-firefly', glow: 'rare' };

const HATS = ['hat-yellow', 'hat-red', 'hat-teal', 'hat-songkok', 'hat-crown', 'hat-astro'];
const FITS = ['#2f5fd0', '#8a7a4a', '#e0a92a', '#ff7a00', '#2f9a8a', '#b8456b', '#5b4bc4', '#3a8f4a', '#c94a3a', '#4a6a8a'];
const PICKS = ['#b8c4d6', '#3de0c8', '#ff4fd8', '#c7f284', '#ffc83d', '#9b6b43', '#ff6a4f'];
const PETS = [null, 'pet-mole', null, 'pet-bat', null, 'pet-sprite', null, null, 'pet-firefly', null];
const GLOWS = ['none', 'none', 'rare', 'none', 'epic', 'none', 'legendary', 'none'] as const;

const NAMES = [
  // the friends you meet at the fountain
  'AYU', 'RAJ', 'MEI', 'TOMI', 'SITI', 'KAI',
  // the rest of the town
  'LINA', 'ZACK', 'NORA', 'DANI', 'WEI', 'IMAN', 'BEN', 'SARA', 'HANA', 'OMAR', 'LEO', 'MAYA', 'FAIZ', 'ANA', 'IZZ', 'JUN', 'PIP', 'JOSH', 'RAX', 'ELI',
];
/** Girls in the cast, by name. */
const GIRLS = new Set(['AYU', 'MEI', 'SITI', 'LINA', 'NORA', 'SARA', 'HANA', 'MAYA', 'ANA', 'IMAN']);

export interface Player {
  id: string;
  name: string;
  look: Look;
}
export const CAST: Player[] = NAMES.map((name, k) => ({
  id: `p${k}`,
  name,
  look: {
    hat: HATS[(k * 5 + 1) % HATS.length],
    fit: FITS[(k * 3 + 2) % FITS.length],
    pick: PICKS[(k * 4 + 1) % PICKS.length],
    handle: k % 3 ? '#6b4a32' : '#2b2140',
    pet: PETS[(k * 7 + 3) % PETS.length],
    glow: GLOWS[(k * 3) % GLOWS.length],
    sex: GIRLS.has(name) ? 'f' : 'm',
  } as Look,
}));
export const FRIENDS = 6;
