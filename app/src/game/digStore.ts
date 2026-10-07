/**
 * State for the dig game: today's swings, the wall in progress, and saving both.
 * Kept apart from the main game save. It reads the main store for two things only:
 * to add XP, and to hand out swings when a live round is deployed.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { localDay } from './constants';
import { addSwings, deeper, enter, freshDig, hit, parseDig, rollDigDay, ROUND_SWINGS, type DigState, type Find } from './dig';
import { haptic, play } from './sfx';
import { useGame } from './store';

const KEY = 'gali-dig-v1';

interface DigStore {
  open: boolean;
  ready: boolean;
  dig: DigState;
  /** The last swing's find, for the line under the wall. */
  last: { found: Find | null; xp: number; at: number } | null;
  show: (spot: number) => void;
  close: () => void;
  swing: (index: number) => void;
  goDeeper: () => void;
}

let loaded: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const persist = (dig: DigState) => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    AsyncStorage.setItem(KEY, JSON.stringify(dig)).catch(() => undefined);
  }, 300);
};

/** Read the save once. Every caller waits on the same read, so nothing can write over it early. */
const load = () =>
  (loaded ??= AsyncStorage.getItem(KEY)
    .then((raw) => useDig.setState({ dig: parseDig(raw, localDay()), ready: true }))
    .catch(() => useDig.setState({ ready: true })));

export const useDig = create<DigStore>((set, get) => {
  const update = (fn: (d: DigState) => DigState) => {
    const dig = fn(rollDigDay(get().dig, localDay()));
    set({ dig });
    persist(dig);
  };
  return {
    open: false,
    ready: false,
    dig: freshDig(localDay()),
    last: null,
    show: (spot) => {
      set({ open: true, last: null });
      void load().then(() => update((d) => enter(d, spot)));
    },
    close: () => set({ open: false }),
    swing: (index) => {
      if (!get().ready) return;
      const r = hit(rollDigDay(get().dig, localDay()), index);
      if (!r.ok) return;
      update(() => r.state);
      set({ last: { found: r.found, xp: r.xp, at: Date.now() } });
      haptic.thud();
      play(r.found === 'gem' ? 'win' : r.found === 'nugget' ? 'claim' : 'dig');
      if (r.xp) useGame.getState().gainXp(r.xp);
    },
    goDeeper: () => {
      update(deeper);
      set({ last: null });
      play('select');
    },
  };
});

/**
 * Mining a live round earns swings. Watches the main store for a new on-chain deploy,
 * so the game store never has to know the dig game exists.
 */
let lastRound = -1;
useGame.subscribe((s) => {
  const p = s.pending;
  if (!p || !p.onChain || p.roundId === lastRound) return;
  lastRound = p.roundId;
  void load().then(() => {
    const dig = addSwings(rollDigDay(useDig.getState().dig, localDay()), ROUND_SWINGS);
    useDig.setState({ dig });
    persist(dig);
  });
});
