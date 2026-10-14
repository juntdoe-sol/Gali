/**
 * Brawl powers and the damage rules every client shares.
 *
 * Powers unlock with your level and only work in the arena. You pick one active power (a key or button,
 * with a cooldown) and one passive (always on). The level bonus is small and capped, so a high level helps
 * but never decides a fight: at most +20% damage.
 *
 * Damage is worked out the same way on every client from what travels in a hit message (the attacker's
 * id, swing number and weapon), so the HP bars agree. The victim's client has the last word: it checks the
 * weapon's reach and cooldown, applies its own passive and guard, and tells everyone its real HP.
 */

export type Weapon = 'swing' | 'dash' | 'slam' | 'ore' | 'splash' | 'pet' | 'boss' | 'sting';
export type ActiveId = 'dash' | 'slam' | 'guard' | 'splash';
export type PassiveId = 'skin' | 'pet';
export type PowerId = ActiveId | PassiveId;

export interface Power {
  id: PowerId;
  name: string;
  kind: 'active' | 'passive';
  /** level it unlocks at */
  lvl: number;
  /** ms between uses (actives) */
  cd: number;
  desc: string;
}

export const POWERS: Record<PowerId, Power> = {
  dash: { id: 'dash', name: 'Dash Strike', kind: 'active', lvl: 3, cd: 6000, desc: 'Charge forward and hit the first miner in your path for 1.3x damage.' },
  guard: { id: 'guard', name: 'Pickaxe Guard', kind: 'active', lvl: 5, cd: 8000, desc: 'Block for 1.5 seconds: hits do a fifth of their damage, and the attacker takes 5.' },
  slam: { id: 'slam', name: 'Ground Slam', kind: 'active', lvl: 8, cd: 9000, desc: 'Leap and slam: 12 damage to everyone close, and knocks them back.' },
  splash: { id: 'splash', name: 'Ore Splash', kind: 'active', lvl: 12, cd: 7000, desc: 'Throw three ORE shards in a fan, 7 damage each.' },
  skin: { id: 'skin', name: 'Stone Skin', kind: 'passive', lvl: 6, cd: 0, desc: 'Take 15% less damage.' },
  pet: { id: 'pet', name: 'Pet Assist', kind: 'passive', lvl: 10, cd: 3000, desc: 'Your pet nips a miner next to you every 3 seconds for 4 damage.' },
};
export const ACTIVES: ActiveId[] = ['dash', 'guard', 'slam', 'splash'];
export const PASSIVES: PassiveId[] = ['skin', 'pet'];

export const unlocked = (p: PowerId, lvl: number) => lvl >= POWERS[p].lvl;

/** How far each weapon reaches, map px between the attacker (or the shard) and the victim's feet. */
export const REACH: Record<Weapon, number> = { swing: 22, dash: 52, slam: 34, ore: 26, splash: 26, pet: 30, boss: 40, sting: 40 };
/** The least time between two hits of the same weapon from one attacker. */
export const GAP: Record<Weapon, number> = { swing: 420, dash: POWERS.dash.cd - 500, slam: POWERS.slam.cd - 500, ore: 350, splash: 120, pet: POWERS.pet.cd - 300, boss: 900, sting: 300 };

/** The arena's level bonus: +1% damage per 2 levels above 1, never more than +20%. */
export const levelBonus = (lvl: number) => 1 + Math.min(0.2, Math.max(0, Math.floor((lvl - 1) / 2)) / 100);

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A swing's base damage: 10 to 15, from the attacker's id and swing number. */
export const swingDmg = (attacker: string, seq: number) => 10 + (hash(`${attacker}:${seq}`) % 6);

/**
 * Damage of one hit before the victim's own defences.
 * `arena` turns on the level bonus (powers and levels only count in the arena).
 */
export function baseDamage(w: Weapon, attacker: string, seq: number, attackerLvl: number, arena: boolean): number {
  const d =
    w === 'swing' ? swingDmg(attacker, seq)
    : w === 'dash' ? Math.round(swingDmg(attacker, seq) * 1.3)
    : w === 'slam' ? 12
    : w === 'ore' ? 8
    : w === 'splash' ? 7
    : w === 'pet' ? 4
    : w === 'sting' ? GUARD_STING
    : 14; // the boss
  return arena && w !== 'boss' && w !== 'sting' ? Math.round(d * levelBonus(attackerLvl)) : d;
}

/** What the victim takes after its passive and guard. Guarding also stings the attacker. */
export function taken(dmg: number, o: { skin: boolean; guarding: boolean }): number {
  let d = dmg;
  if (o.skin) d *= 0.85;
  if (o.guarding) d *= 0.2;
  return Math.max(1, Math.round(d));
}
export const GUARD_MS = 1500;
export const GUARD_STING = 5;
