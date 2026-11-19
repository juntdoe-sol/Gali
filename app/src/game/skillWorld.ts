/**
 * Your three Fight Club skills out in the lobby and on ORE Island (the SKILLS keys, Q R X). There they are a
 * flourish plus an ordinary swing, so they hit with Brawl's usual rules and damage; Guard is a short shield.
 * Each slot then waits 7 seconds, as in the Fight Club.
 */
import { create } from 'zustand';
import type { SkillId } from './brawl2/sim';
import { SKILL_INFO } from './brawl2/specials';
import { shieldMe, useBrawl } from './brawl';
import { fightLoadout } from './skills';
import { play, type Sound } from './sfx';

export type WorldMove = 'jump' | 'dash' | 'burst' | 'guard';
export const WORLD_MOVE: Record<SkillId, WorldMove> = {
  moon: 'jump', rush: 'dash', quake: 'burst', whirl: 'burst', dive: 'jump', guard: 'guard',
  grab: 'dash', magnet: 'dash', dynamite: 'burst', geyser: 'jump', cavein: 'burst', tunnel: 'dash',
  slide: 'dash', boomerang: 'burst', sonar: 'burst', boulder: 'dash', meteor: 'jump', drill: 'dash',
  inferno: 'burst', jade: 'burst', taiji: 'burst', thunder: 'burst', pillar: 'jump',
};
export const SKILL_KEYS = ['Q', 'R', 'X'] as const;
export const WORLD_CD_MS = 7000;

export const useSkillCd = create<{ until: number[] }>(() => ({ until: [0, 0, 0] }));

/** Use the skill in `slot`, if it is set and ready: what the canvas should play, or null. */
export function fireSkill(slot: number): { move: WorldMove; color: string } | null {
  const k = fightLoadout()[slot];
  if (!k) return null;
  const now = Date.now();
  if (now < useSkillCd.getState().until[slot]) return null;
  const b = useBrawl.getState();
  if (b.me.koAt) return null;
  useSkillCd.setState((s) => {
    const until = [...s.until];
    until[slot] = now + WORLD_CD_MS;
    return { until };
  });
  const move = WORLD_MOVE[k];
  play(`sk_${k}` as Sound);
  if (move === 'guard' && !b.off) shieldMe(1500);
  return { move, color: SKILL_INFO[k].color };
}
