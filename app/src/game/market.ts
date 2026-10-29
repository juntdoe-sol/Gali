/**
 * The Gear Market window: opened by the vending machine in front of the market hall, the travel menu, or the
 * MARKET signs. For now it is a showcase of Gear 555; buying opens with the Gali NFT market.
 */
import { create } from 'zustand';
import type { GearCat, GearRarity } from './gear555';

interface MarketState {
  open: boolean;
  cat: GearCat;
  rarity: GearRarity | 'all';
  /** the item open in the detail panel */
  pick: string | null;
  show: (cat?: GearCat) => void;
  hide: () => void;
  setCat: (c: GearCat) => void;
  setRarity: (r: GearRarity | 'all') => void;
  setPick: (id: string | null) => void;
}

export const useMarket = create<MarketState>((set) => ({
  open: false,
  cat: 'head',
  rarity: 'all',
  pick: null,
  show: (cat) => set((s) => ({ open: true, cat: cat ?? s.cat, pick: null })),
  hide: () => set({ open: false, pick: null }),
  setCat: (cat) => set({ cat, pick: null }),
  setRarity: (rarity) => set({ rarity, pick: null }),
  setPick: (pick) => set({ pick }),
}));
