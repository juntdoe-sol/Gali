import type { GearKind } from '../game/constants';
import type { PixName } from './pixIcons';

/** Pixel icons for gear kinds and the items that have their own, drawn by scripts/ui_icons_hud.py. */
export const GEAR_ICON: Record<GearKind, PixName> = { pickaxe: 'pick', helmet: 'helmet', outfit: 'vest', pet: 'paw' };
export const ITEM_ICON: Record<string, PixName> = {
  'pick-neon': 'bolt',
  'pick-seeker': 'pick',
  'hat-crown': 'crown',
  'hat-songkok': 'hat',
  'hat-astro': 'planet',
  'fit-gold': 'sparkle',
  'pet-mole': 'mole',
  'pet-bat': 'bat',
  'pet-sprite': 'gem',
  'pet-firefly': 'firefly',
};
