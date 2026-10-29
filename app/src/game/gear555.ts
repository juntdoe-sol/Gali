/**
 * Gali Gear 555: the catalogue the Market shows. Built by scripts/gear555/build_market.py from the sprite
 * sources in scripts/gear555/, which draw every item on the game's own miner rig.
 *
 * gear-thumbs.png: one 40x40 cell per item, 24 to a row: the item on a silhouette miner (pets on their own).
 * gear-anim.png: Legendary items, 8 frames each (one row per item), for the animated cards.
 * gear555.json: the list. It is loaded on first use so it stays out of the startup bundle.
 */
import type { ImageSourcePropType } from 'react-native';

export type GearCat = 'head' | 'clothes' | 'shoes' | 'weapons' | 'pets';
export type GearRarity = 'Common' | 'Uncommon' | 'Rare' | 'Legendary';
export interface GearItem {
  id: string;
  name: string;
  cat: GearCat;
  /** Head, Top, Bottom, Shoes, Weapon or Pet */
  sub: string;
  rarity: GearRarity;
  set: string;
  flavor: string;
  supply: number | 'claim';
  /** cell index in gear-thumbs.png */
  thumb: number;
  /** row in gear-anim.png (Legendary only) */
  anim: number | null;
  status: 'New' | 'Existing';
}
export interface GearBook {
  cell: [number, number];
  cols: number;
  animFrames: number;
  items: GearItem[];
}

export const THUMBS: ImageSourcePropType = require('../../assets/market/gear-thumbs.png');
export const ANIM: ImageSourcePropType = require('../../assets/market/gear-anim.png');
/** atlas sizes in pixels (24 x 24 cells of 40, and 8 x 57 cells of 40) */
export const THUMBS_SIZE: [number, number] = [960, 960];
/** Try-on: every item worn by the full-colour miner, idle frame, 40x56 cells, 24 to a row (boy and girl). */
export const TRYON: Record<'m' | 'f', ImageSourcePropType> = {
  m: require('../../assets/market/gear-tryon-m.png'),
  f: require('../../assets/market/gear-tryon-f.png'),
};
export const TRYON_SIZE: [number, number] = [960, 1344];
export const TRYON_CELL: [number, number] = [40, 56];
export const ANIM_SIZE: [number, number] = [320, 2280];
export const CELL = 40;
export const COLS = 24;

export const CATS: { id: GearCat; label: string }[] = [
  { id: 'head', label: 'HEAD' },
  { id: 'clothes', label: 'CLOTHES' },
  { id: 'shoes', label: 'SHOES' },
  { id: 'weapons', label: 'AXES & WEAPONS' },
  { id: 'pets', label: 'PETS' },
];
export const RARITIES: GearRarity[] = ['Common', 'Uncommon', 'Rare', 'Legendary'];
export const RARITY_HUE: Record<GearRarity, string> = {
  Common: '#b8b0c8',
  Uncommon: '#6ad46f',
  Rare: '#4fc8ff',
  Legendary: '#ffb020',
};

let book: GearBook | null = null;
let bookP: Promise<GearBook> | null = null;
/** The catalogue, loaded once. */
export function loadGear(): Promise<GearBook> {
  if (book) return Promise.resolve(book);
  return (bookP ??= import('../../assets/market/gear555.json').then((m) => {
    book = ((m as unknown as { default?: GearBook }).default ?? m) as unknown as GearBook;
    return book;
  }));
}
export const gearNow = () => book;

/** Items that animate on the card: every Legendary, plus the claim-only Jarl Helmet (also Legendary). */
export const animated = (it: GearItem) => it.anim !== null;
