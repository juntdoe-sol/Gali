import { create } from 'zustand';

/** What the map is showing, for the UI around it: the island, or a claim up close. */
interface ViewState {
  /** the claim the camera has dived into, or -1 */
  focus: number;
  /** the engine has drawn its first frame */
  ready: boolean;
  /** ask the engine to dive into a claim (or -1 to come back) */
  request: number | null;
  go: (i: number) => void;
}

export const useView = create<ViewState>((set) => ({
  focus: -1,
  ready: false,
  request: null,
  go: (i) => set({ request: i }),
}));
