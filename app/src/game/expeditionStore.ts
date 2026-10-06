import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { act, CHALLENGES, mastery, parseProgress, recordBest, startExpedition, utcDay, type Action, type Challenge, type Expedition, type Mine, type Progress } from './expedition';
import { publishExpeditionScore } from './world';

const KEY = 'gali-expeditions-v1'; // Separate from existing balances, gear and wallet saves.
let loading: Promise<void> | null = null;
let writes = Promise.resolve();
interface ExpeditionState {
  open: boolean; shaft: number | null; run: Expedition | null; progress: Progress;
  ready: boolean; storage: string; writable: boolean;
  show: (shaft?: number) => void; close: () => void; load: () => Promise<void>;
  start: (mine: Mine, challenge: Challenge) => void; action: (action: Action) => void;
  save: () => void;
}
export const useExpedition = create<ExpeditionState>((set, get) => ({
  open: false, shaft: null, run: null, progress: { v: 1, best: {} }, ready: false, storage: 'Loading local progress…', writable: false,
  show: (shaft) => { set({ open: true, shaft: shaft ?? null }); void get().load(); },
  close: () => set({ open: false }), // A running shift keeps its wall-clock deadline, even while hidden.
  load: () => {
    if (get().ready) return Promise.resolve();
    if (loading) return loading;
    loading = AsyncStorage.getItem(KEY).then((raw) => {
      set({ progress: parseProgress(raw), ready: true, writable: true, storage: 'Progress saved on this device only.' });
    }).catch(() => {
      set({ ready: true, writable: false, storage: 'Cannot read local progress. Play this session only; existing save will not be overwritten.' });
    }).finally(() => { loading = null; });
    return loading;
  },
  start: (mine, challenge) => {
    if (!get().ready || get().run?.status === 'active' || mastery(get().progress).xp < CHALLENGES[challenge].xp) return;
    set({ run: startExpedition(utcDay(), mine, challenge, Date.now()) });
  },
  action: (action) => {
    const before = get().run;
    if (!before) return;
    const run = act(before, action, Date.now());
    if (run === before) return;
    set({ run });
    if (before.status === 'active' && run.status === 'extracted') {
      const progress = recordBest(get().progress, run);
      if (progress !== get().progress) { set({ progress }); get().save(); }
      if (run.score > 0) publishExpeditionScore(run);
    }
  },
  save: () => {
    if (!get().writable) return;
    set({ storage: 'Saving local progress…' });
    // Serialize writes; a slow earlier extract cannot overwrite a newer best.
    const raw = JSON.stringify(get().progress);
    writes = writes.then(() => AsyncStorage.setItem(KEY, raw)).then(() => {
      set({ storage: 'Progress saved on this device only.' });
    }).catch(() => set({ storage: 'Save failed. Progress remains in this session. Retry save before leaving.' }));
  },
}));
