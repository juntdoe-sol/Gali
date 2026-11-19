/**
 * The Gear Market window: opened by the vending machine in front of the market hall, the travel menu, or the
 * MARKET signs. For now it is a showcase of Gear 555; buying opens with the Gali NFT market.
 */
import { create } from 'zustand';
import type { GearCat, GearRarity } from './gear555';

interface MarketState {
  open: boolean;
  /** Gear 555, Mining Cards or Fight Club skills */
  section: 'gear' | 'cards' | 'skills';
  setSection: (s: 'gear' | 'cards' | 'skills') => void;
  cat: GearCat;
  rarity: GearRarity | 'all';
  /** the item open in the detail panel */
  pick: string | null;
  show: (cat?: GearCat, section?: 'gear' | 'cards' | 'skills') => void;
  hide: () => void;
  setCat: (c: GearCat) => void;
  setRarity: (r: GearRarity | 'all') => void;
  setPick: (id: string | null) => void;
}

export const useMarket = create<MarketState>((set) => ({
  open: false,
  section: 'gear',
  setSection: (section) => set({ section }),
  cat: 'head',
  rarity: 'all',
  pick: null,
  show: (cat, section) => set((s) => ({ open: true, cat: cat ?? s.cat, pick: null, section: section ?? (cat ? 'gear' : s.section) })),
  hide: () => set({ open: false, pick: null }),
  setCat: (cat) => set({ cat, pick: null }),
  setRarity: (rarity) => set({ rarity, pick: null }),
  setPick: (pick) => set({ pick }),
}));
