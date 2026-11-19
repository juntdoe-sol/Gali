/**
 * Fight Club skills: what this player owns, which three are equipped, and their NUGS (the in-game coin).
 *
 * NUGS are worked out by the server from XP (1 for every 10 XP, plus bonuses, minus what was spent), so buying a
 * skill never lowers XP or the level. The six starter skills are free for everyone; the others are bought with NUGS
 * through the play function (supabase/sql/nugs-skills.sql). The loadout is kept on this device.
 */
import { create } from 'zustand';
import { isSkill, type SkillId } from './brawl2/sim';
import { FREE_SKILLS, SKILL_INFO } from './brawl2/specials';
import { playAsk, playCall, playWallet } from './play';
import { loadJson, saveJson } from './storage';

const KEY = 'gali-skills-v1';
/** SKILL alone, SKILL + side, SKILL + down */
export const SLOT_NAMES = ['SKILL', 'SKILL + SIDE', 'SKILL + DOWN'] as const;
const DEFAULT: (SkillId | null)[] = ['moon', 'rush', 'quake'];

interface SkillsState {
  nugs: number | null;
  owned: SkillId[];
  loadout: (SkillId | null)[];
  loaded: boolean;
  /** read NUGS and owned skills from the server (needs the sign-in pass) */
  refresh: () => Promise<void>;
  buy: (k: SkillId) => Promise<string | null>;
  equip: (slot: number, k: SkillId | null) => void;
  has: (k: SkillId) => boolean;
}

export const useSkills = create<SkillsState>((set, get) => ({
  nugs: null,
  owned: [],
  loadout: DEFAULT,
  loaded: false,
  refresh: async () => {
    const r = await playCall<{ ok: boolean; nugs: number; owned: string[] }>('skills', {});
    if (r?.ok) set({ nugs: r.nugs, owned: r.owned.filter(isSkill), loaded: true });
  },
  buy: async (k) => {
    if (!playWallet()) return 'Connect your wallet and sign in first.';
    const r = await playAsk<{ nugs: number }>('buyskill', { skill: k });
    if (!r.ok) return r.error;
    set((s) => ({ nugs: r.nugs ?? s.nugs, owned: s.owned.includes(k) ? s.owned : [...s.owned, k] }));
    return null;
  },
  equip: (slot, k) => {
    const lo = [...get().loadout];
    // a skill sits in one slot only: moving it empties where it was
    if (k) for (let i = 0; i < lo.length; i++) if (lo[i] === k) lo[i] = null;
    lo[slot] = k;
    set({ loadout: lo });
    saveJson(KEY, { loadout: lo }, 0);
  },
  has: (k) => SKILL_INFO[k].price === 0 || get().owned.includes(k),
}));

/** The loadout to fight with: only skills this player has (a bought skill not yet confirmed reads as empty). */
export function fightLoadout(): (SkillId | null)[] {
  const s = useSkills.getState();
  return s.loadout.map((k) => (k && s.has(k) ? k : null));
}

void loadJson<{ loadout: (SkillId | null)[] }>(KEY, { loadout: DEFAULT }).then(({ loadout }) => {
  const lo = [0, 1, 2].map((i) => (isSkill(loadout?.[i]) ? loadout[i] : null));
  useSkills.setState({ loadout: lo });
});
export { FREE_SKILLS };
