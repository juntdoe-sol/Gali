/**
 * Fight gear: cosmetics you earn by fighting. Nothing here changes damage or mining.
 *
 * Fight points come from what you do in Brawl: 1 per KO, 3 per arena win, 2 per Mole Boss down.
 * Points unlock swing trails (the colour of the arc your pickaxe draws) and a title shown in the arena.
 * Your own record is kept on this device; the weekly ranks (game/ranks.ts) are shared.
 */
import { create } from 'zustand';
import { loadJson, saveJson } from './storage';

import { TRAILS } from './trails';
export { TRAILS, trailColor, type Trail } from './trails';

export const TITLES: { need: number; name: string }[] = [
  { need: 0, name: 'BRAWLER' },
  { need: 10, name: 'SCRAPPER' },
  { need: 30, name: 'BRUISER' },
  { need: 60, name: 'CHAMPION' },
  { need: 120, name: 'LEGEND' },
];

export interface FightStats {
  kos: number;
  wins: number;
  bossWins: number;
  /** times you were knocked out */
  downs: number;
}
export const fightPoints = (s: FightStats) => s.kos + s.wins * 3 + s.bossWins * 2;
export const titleOf = (pts: number) => [...TITLES].reverse().find((t) => pts >= t.need)?.name ?? TITLES[0].name;
export const trailUnlocked = (id: string, pts: number) => (TRAILS.find((t) => t.id === id)?.need ?? Infinity) <= pts;

const KEY = 'gali-fight-stats-v1';
export const useFightStats = create<FightStats & { add: (k: keyof FightStats, n?: number) => void }>((set, get) => ({
  kos: 0,
  wins: 0,
  bossWins: 0,
  downs: 0,
  add: (k, n = 1) => {
    set({ [k]: get()[k] + n } as Partial<FightStats>);
    const { kos, wins, bossWins, downs } = get();
    saveJson(KEY, { kos, wins, bossWins, downs }, 400);
  },
}));
void loadJson<FightStats>(KEY, { kos: 0, wins: 0, bossWins: 0, downs: 0 }).then((s) => {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
  useFightStats.setState({ kos: n(s.kos), wins: n(s.wins), bossWins: n(s.bossWins), downs: n(s.downs) });
});
