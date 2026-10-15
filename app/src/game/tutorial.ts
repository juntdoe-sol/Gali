/**
 * The mining tutorial: five short steps shown the first time a miner lands on ORE Island.
 * Steps 2 to 4 move on by themselves when the miner does the thing (walks to a spot, picks spots,
 * deploys). Closing it at any step ends it for good on this device; How to Play can start it again.
 */
import { create } from 'zustand';

const KEY = 'gali-mine-tutorial-v1';
export const TUTORIAL_STEPS = 5;

interface TutorialState {
  /** -1 = not showing */
  step: number;
  done: boolean;
  start: () => void;
  next: () => void;
  close: () => void;
  /** the island engine says the miner reached a mining spot */
  arrived: () => void;
}
const read = () => {
  try {
    return globalThis.localStorage?.getItem(KEY) === 'done';
  } catch {
    return false;
  }
};
const save = () => {
  try {
    globalThis.localStorage?.setItem(KEY, 'done');
  } catch {
    /* private window */
  }
};

export const useTutorial = create<TutorialState>((set, get) => ({
  step: -1,
  done: read(),
  start: () => set({ step: 0, done: false }),
  next: () => {
    const n = get().step + 1;
    if (n >= TUTORIAL_STEPS) {
      save();
      set({ step: -1, done: true });
    } else set({ step: n });
  },
  close: () => {
    save();
    set({ step: -1, done: true });
  },
  arrived: () => {
    if (get().step === 1) set({ step: 2 });
  },
}));
