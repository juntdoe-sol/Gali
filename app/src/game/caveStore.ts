/**
 * State for Cave Run: whether it is open, today's runs and your best depth.
 * Kept apart from the main game save. It reads the main store for two things only:
 * to add XP, and to hand out a run when a live round is deployed.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { localDay } from './constants';
import { addRuns, freshCave, parseCave, recordDepth, rollCaveDay, ROUND_RUNS, spendRun, type CaveSave } from './cave';
import { useGame } from './store';

const KEY = 'gali-cave-v1';

interface CaveStore {
  open: boolean;
  ready: boolean;
  spot: number;
  save: CaveSave;
  show: (spot: number) => void;
  close: () => void;
  /** A run began: spend it. */
  spend: () => void;
  xp: (n: number) => void;
  ended: (depth: number) => void;
}

let loaded: Promise<void> | null = null;
const persist = (save: CaveSave) => {
  AsyncStorage.setItem(KEY, JSON.stringify(save)).catch(() => undefined);
};
/** Read the save once. Every caller waits on the same read, so nothing can write over it early. */
const load = () =>
  (loaded ??= AsyncStorage.getItem(KEY)
    .then((raw) => useCave.setState({ save: parseCave(raw, localDay()), ready: true }))
    .catch(() => useCave.setState({ ready: true })));

export const useCave = create<CaveStore>((set, get) => {
  const update = (fn: (s: CaveSave) => CaveSave) => {
    const save = fn(rollCaveDay(get().save, localDay()));
    set({ save });
    persist(save);
  };
  return {
    open: false,
    ready: false,
    spot: 0,
    save: freshCave(localDay()),
    show: (spot) => {
      void load().then(() => {
        update((s) => s);
        set({ open: true, spot });
      });
    },
    close: () => set({ open: false }),
    spend: () => update(spendRun),
    xp: (n) => useGame.getState().gainXp(n),
    ended: (depth) => update((s) => recordDepth(s, depth)),
  };
});
void load();

/**
 * Mining a live round earns a run. Watches the main store for a new on-chain deploy,
 * so the game store never has to know Cave Run exists.
 */
let lastRound = -1;
useGame.subscribe((s) => {
  const p = s.pending;
  if (!p || !p.onChain || p.roundId === lastRound) return;
  lastRound = p.roundId;
  void load().then(() => {
    const save = addRuns(rollCaveDay(useCave.getState().save, localDay()), ROUND_RUNS);
    useCave.setState({ save });
    persist(save);
  });
});
