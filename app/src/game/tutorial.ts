/**
 * The mining tutorial: five short steps shown the first time a miner lands on ORE Island.
 * Steps 2 to 4 move on by themselves when the miner does the thing (walks to a spot, picks spots,
 * deploys). Closing it at any step ends it for good on this device; How to Play can start it again.
 */
import { create } from 'zustand';

const KEY = 'gali-mine-tutorial-v1';
/** the computer's LITE tutorial (new in v2: everyone on a computer sees it once) */
const DESK_KEY = 'gali-mine-tutorial-desk-v2';
export const TUTORIAL_STEPS = 5;

interface TutorialState {
  /** -1 = not showing */
  step: number;
  done: boolean;
  /** the computer's tutorial has been seen (it has its own steps) */
  deskDone: boolean;
  /** which tutorial is showing: the computer's or the phone's */
  desk: boolean;
  /** how many steps the showing tutorial has */
  total: number;
  start: (desk?: boolean, total?: number) => void;
  next: () => void;
  close: () => void;
  /** the island engine says the miner reached a mining spot */
  arrived: () => void;
}
const read = (k = KEY) => {
  try {
    return globalThis.localStorage?.getItem(k) === 'done';
  } catch {
    return false;
  }
};
const save = (desk: boolean) => {
  try {
    globalThis.localStorage?.setItem(desk ? DESK_KEY : KEY, 'done');
  } catch {
    /* private window */
  }
};

export const useTutorial = create<TutorialState>((set, get) => ({
  step: -1,
  done: read(),
  deskDone: read(DESK_KEY),
  desk: false,
  total: TUTORIAL_STEPS,
  start: (desk = false, total = TUTORIAL_STEPS) => set(desk ? { step: 0, deskDone: false, desk, total } : { step: 0, done: false, desk, total: TUTORIAL_STEPS }),
  next: () => {
    const n = get().step + 1;
    if (n >= get().total) get().close();
    else set({ step: n });
  },
  close: () => {
    const desk = get().desk;
    save(desk);
    set(desk ? { step: -1, deskDone: true } : { step: -1, done: true });
  },
  arrived: () => {
    if (get().step === 1 && !get().desk) set({ step: 2 });
  },
}));

/* ---------------- PRO: a short tour the first time a miner switches to PRO (computer) ---------------- */
const PRO_KEY = 'gali-pro-tutorial-v1';
export const PRO_STEPS = 3;
const proSeen = () => {
  try {
    return globalThis.localStorage?.getItem(PRO_KEY) === 'done';
  } catch {
    return false;
  }
};
export const useProTutorial = create<{ step: number; done: boolean; start: () => void; next: () => void; close: () => void }>((set, get) => ({
  step: -1,
  done: proSeen(),
  start: () => set({ step: 0 }),
  next: () => {
    const n = get().step + 1;
    if (n >= PRO_STEPS) get().close();
    else set({ step: n });
  },
  close: () => {
    try {
      globalThis.localStorage?.setItem(PRO_KEY, 'done');
    } catch {
      /* private window */
    }
    set({ step: -1, done: true });
  },
}));
