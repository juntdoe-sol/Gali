/**
 * The first-time coach (computer). On a miner's first visit the lobby teaches, one at a time: walk, jump,
 * swing the pickaxe, ride a cart or scooter, then sends them to ORE Island for the LITE mining tutorial.
 * Each step moves on when the miner does it; any step can be skipped, and X ends the whole intro.
 * After that, each place (cave, market, arena, the games row) explains itself once, the first time the
 * miner walks up to it. How to play can replay it all.
 */
import { create } from 'zustand';
import { DOORS, LT, type DoorId } from './lobbyMap';

export const INTRO = ['walk', 'jump', 'swing', 'ride', 'mine'] as const;
export type IntroId = (typeof INTRO)[number];
/** the intro's last step: go mine (the island's LITE tutorial takes over there) */
export const INTRO_MINE = INTRO.indexOf('mine');

export type PlaceId = 'cave' | 'market' | 'arena' | 'games';
const PLACE_OF: Partial<Record<DoorId, PlaceId>> = { cave: 'cave', market: 'market', arena: 'arena', tunnel: 'games', pot: 'games', crash: 'games' };

const INTRO_KEY = 'gali-coach-intro-v1';
const PLACES_KEY = 'gali-coach-places-v1';
const get = (k: string) => {
  try {
    return globalThis.localStorage?.getItem(k) ?? null;
  } catch {
    return null;
  }
};
const put = (k: string, v: string) => {
  try {
    globalThis.localStorage?.setItem(k, v);
  } catch {
    /* private window */
  }
};
const readPlaces = (): PlaceId[] => {
  try {
    const v = JSON.parse(get(PLACES_KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

/** how far, in tiles, a place notices you walking up */
const NEAR_TILES = 5;
/** how far, in pixels, you walk before "walk" counts */
const WALK_PX = LT * 3;

interface Coach {
  introDone: boolean;
  /** -1 = no intro on screen */
  introStep: number;
  places: PlaceId[];
  /** a place card on screen */
  place: PlaceId | null;
  walkFrom: { x: number; y: number } | null;
  startIntro: () => void;
  nextIntro: () => void;
  finishIntro: () => void;
  /** the miner did something: moves the intro on when it is the step's action */
  did: (a: IntroId) => void;
  /** the lobby's position report: counts the walk, and wakes a place's card the first time you get near */
  moved: (x: number, y: number) => void;
  closePlace: () => void;
  /** How to play's REPLAY TUTORIAL: everything shows again */
  replay: () => void;
}

export const useCoach = create<Coach>((set, getS) => ({
  introDone: get(INTRO_KEY) === 'done',
  introStep: -1,
  places: readPlaces(),
  place: null,
  walkFrom: null,
  startIntro: () => set({ introStep: 0, walkFrom: null, place: null }),
  nextIntro: () => {
    const n = getS().introStep + 1;
    // the last step (mine) stays up until the island's tutorial takes over or the miner closes it
    if (n > INTRO_MINE) getS().finishIntro();
    else set({ introStep: n });
  },
  finishIntro: () => {
    put(INTRO_KEY, 'done');
    set({ introDone: true, introStep: -1 });
  },
  did: (a) => {
    const s = getS();
    if (s.introStep >= 0 && INTRO[s.introStep] === a) s.nextIntro();
  },
  moved: (x, y) => {
    const s = getS();
    if (s.introStep >= 0 && INTRO[s.introStep] === 'walk') {
      if (!s.walkFrom) set({ walkFrom: { x, y } });
      else if (Math.hypot(x - s.walkFrom.x, y - s.walkFrom.y) > WALK_PX) s.nextIntro();
      return;
    }
    if (s.introStep >= 0 || s.place) return;
    for (const d of DOORS) {
      const id = PLACE_OF[d.id];
      if (!id || s.places.includes(id)) continue;
      const cx = (d.x + d.w / 2) * LT;
      const cy = (d.y + d.h / 2) * LT;
      if (Math.hypot(x - cx, y - cy) < NEAR_TILES * LT) {
        set({ place: id });
        return;
      }
    }
  },
  closePlace: () => {
    const s = getS();
    if (!s.place) return;
    const places = [...s.places, s.place];
    put(PLACES_KEY, JSON.stringify(places));
    set({ places, place: null });
  },
  replay: () => {
    put(INTRO_KEY, '');
    put(PLACES_KEY, '[]');
    set({ introDone: false, introStep: -1, places: [], place: null, walkFrom: null });
  },
}));
