/**
 * The idle miner cut into layers (scripts/gear555/build_parts.py), so the BAG can show your miner wearing what is
 * equipped without a canvas. One 40x40 cell per layer, all lined up: stack them in order.
 */
import type { ImageSourcePropType } from 'react-native';
import { GEAR } from './constants';

export const PARTS: ImageSourcePropType = require('../../assets/market/miner-parts.png');
export const PARTS_W = 920;
export const PART = 40;
/** the sheet is two rows: layers to stack, then the same items as centred icons */
export const PARTS_H = 80;

const OUTFITS = ['fit-blue', 'fit-khaki', 'fit-batik', 'fit-hazard', 'fit-gold'];
const HATS = ['hat-yellow', 'hat-red', 'hat-teal', 'hat-songkok', 'hat-crown', 'hat-astro'];
const PICKS = ['pick-wood', 'pick-iron', 'pick-gold', 'pick-gem', 'pick-neon', 'pick-seeker'];
const PETS = ['pet-mole', 'pet-bat', 'pet-sprite', 'pet-firefly'];

/** Cell index for a body (sex) or a gear key from constants.GEAR. */
export function partCell(key: string): number | null {
  if (key === 'body-m') return 0;
  if (key === 'body-f') return 1;
  for (const [list, at] of [[OUTFITS, 2], [HATS, 7], [PICKS, 13], [PETS, 19]] as [string[], number][]) {
    const i = list.indexOf(key);
    if (i >= 0) return at + i;
  }
  return null;
}

export const hasPart = (key: string) => partCell(key) !== null && GEAR.some((g) => g.key === key);
