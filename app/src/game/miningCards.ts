/**
 * Gali Mining Cards: bought in the Market with SKR or ORE, each card is a code that funds an autopilot run with SOL
 * and comes with a fixed free pack (game items when the NFT market opens, XP, extras). Contents are fixed and printed
 * on the card: nothing is random.
 *
 * Redeeming a code (the mining panel): the server marks it used, adds the XP, books the items and sends the card's
 * SOL to the player's wallet from Gali's house wallet; the app then starts an all-spots autopilot with exactly that
 * SOL, and shows what the run brought in when it ends (game/cardRun.ts). The SOL value is fixed when the card is
 * bought (dollar price at that day's SOL price), so a code is worth the same SOL whenever it is used.
 *
 * Buying opens with the Market; until then the cards show, and Buy says when.
 * Card art: scripts/nft/mining-cards/card.py (2 second loops).
 */
import { Platform } from 'react-native';

export type CardValue = 10 | 25 | 50 | 75 | 100 | 250 | 500 | 1000;

export interface CardItem {
  n: number;
  rarity: 'Common' | 'Uncommon' | 'Rare' | 'Legendary';
}

export interface CardTier {
  value: CardValue;
  name: string;
  /** frame colour, for borders and glows around the card */
  hue: string;
  items: CardItem[];
  xp: number;
  /** extras printed on the card, in a few words each */
  extras: string[];
}

export const CARD_TIERS: CardTier[] = [
  { value: 10, name: 'Starter', hue: '#e0925c', items: [{ n: 1, rarity: 'Common' }, { n: 1, rarity: 'Uncommon' }], xp: 500, extras: [] },
  { value: 25, name: 'Bronze', hue: '#e8ac54', items: [{ n: 2, rarity: 'Common' }, { n: 1, rarity: 'Uncommon' }], xp: 1500, extras: [] },
  { value: 50, name: 'Silver', hue: '#cad4e4', items: [{ n: 2, rarity: 'Uncommon' }, { n: 1, rarity: 'Rare' }], xp: 3500, extras: [] },
  { value: 75, name: 'Gold', hue: '#ffcf4a', items: [{ n: 1, rarity: 'Uncommon' }, { n: 2, rarity: 'Rare' }], xp: 6000, extras: [] },
  { value: 100, name: 'Platinum', hue: '#c4ecec', items: [{ n: 3, rarity: 'Rare' }], xp: 9000, extras: ['Platinum badge'] },
  { value: 250, name: 'Diamond', hue: '#3ee6ff', items: [{ n: 2, rarity: 'Rare' }, { n: 1, rarity: 'Legendary' }], xp: 25000, extras: ['Gold name for 30 days'] },
  { value: 500, name: 'Master', hue: '#d08cff', items: [{ n: 1, rarity: 'Rare' }, { n: 2, rarity: 'Legendary' }], xp: 55000, extras: ['Gold name for 30 days', 'Master badge'] },
  { value: 1000, name: 'Legend', hue: '#ff7860', items: [{ n: 3, rarity: 'Legendary' }], xp: 120000, extras: ['"Legend" title', 'Gold name for 90 days', 'Legend card frame'] },
];

export const tierOf = (v: number) => CARD_TIERS.find((t) => t.value === v) ?? null;

/** Buying opens with the Market. */
export const CARDS_FOR_SALE = false;

const ART: Record<CardValue, { gif: number; png: number }> = {
  10: { gif: require('../../assets/market/cards/card-10.gif'), png: require('../../assets/market/cards/card-10-still.png') },
  25: { gif: require('../../assets/market/cards/card-25.gif'), png: require('../../assets/market/cards/card-25-still.png') },
  50: { gif: require('../../assets/market/cards/card-50.gif'), png: require('../../assets/market/cards/card-50-still.png') },
  75: { gif: require('../../assets/market/cards/card-75.gif'), png: require('../../assets/market/cards/card-75-still.png') },
  100: { gif: require('../../assets/market/cards/card-100.gif'), png: require('../../assets/market/cards/card-100-still.png') },
  250: { gif: require('../../assets/market/cards/card-250.gif'), png: require('../../assets/market/cards/card-250-still.png') },
  500: { gif: require('../../assets/market/cards/card-500.gif'), png: require('../../assets/market/cards/card-500-still.png') },
  1000: { gif: require('../../assets/market/cards/card-1000.gif'), png: require('../../assets/market/cards/card-1000-still.png') },
};
/** The card's picture: the 2 second loop on the web, a still on Android (React Native's Image doesn't animate GIFs there). */
export const cardArt = (v: CardValue) => (Platform.OS === 'web' ? ART[v].gif : ART[v].png);
/** Card art is 108x150 pixels, drawn at 3x. */
export const CARD_RATIO = 150 / 108;

/** What a card gives, in short lines for the card's detail panel. */
export function perkLines(t: CardTier): string[] {
  return [
    `$${t.value} of SOL for autopilot mining`,
    ...t.items.map((i) => `${i.n} ${i.rarity} item${i.n > 1 ? 's' : ''}`),
    `+${t.xp.toLocaleString()} XP`,
    `+${(t.xp / 10).toLocaleString()} NUGS`,
    ...t.extras,
  ];
}

/** GALI-XXXX-XXXX-XXXX, typed in any case, with or without dashes. */
export function cleanCode(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = s.startsWith('GALI') ? s.slice(4) : s;
  if (!/^[A-Z0-9]{12}$/.test(body)) return null;
  return `GALI-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8)}`;
}
export const maskCode = (code: string) => `${code.slice(0, 5)}••••-••••-${code.slice(-4)}`;
