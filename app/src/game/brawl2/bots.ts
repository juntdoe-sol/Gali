/**
 * Brawl Arena v2 bots: they press the same buttons a player does (an Input each frame), so every move works for
 * them too. Three levels differ in how fast they react, how often they attack well, and how well they recover.
 * Deterministic: they draw from the match's seeded random.
 */
import { METER_FULL, MOVES, rand, type Difficulty, type Fighter, type Input, type Match } from './sim';

interface Brain {
  /** frames until the next decision; the input is held until then */
  wait: number;
  out: Input;
  target: string | null;
}
const LEVEL: Record<Difficulty, { react: number; aim: number; dodge: number; heavyAt: number; recover: number; chase: number }> = {
  easy: { react: 20, aim: 0.45, dodge: 0.0, heavyAt: 140, recover: 0.6, chase: 0.6 },
  normal: { react: 11, aim: 0.7, dodge: 0.12, heavyAt: 95, recover: 0.9, chase: 0.85 },
  hard: { react: 5, aim: 0.92, dodge: 0.3, heavyAt: 75, recover: 1, chase: 1 },
};

export class Bots {
  private brains = new Map<string, Brain>();

  inputs(match: Match): Record<string, Input> {
    const out: Record<string, Input> = {};
    for (const f of match.fighters) {
      if (!f.bot || f.stocks <= 0) continue;
      let b = this.brains.get(f.id);
      if (!b) {
        b = { wait: 0, out: { mx: 0, my: 0, jump: false, light: false, heavy: false, dodge: false, special: false }, target: null };
        this.brains.set(f.id, b);
      }
      if (b.wait > 0) {
        b.wait--;
        // buttons are taps: release them after the frame they were pressed
        out[f.id] = { ...b.out, light: false, heavy: false, dodge: false, special: false, jump: b.out.jump && b.wait > 3 };
        b.out = out[f.id];
        continue;
      }
      b.out = this.think(match, f, b);
      b.wait = Math.max(1, Math.round(LEVEL[f.bot].react * (0.6 + rand(match) * 0.8)));
      out[f.id] = b.out;
    }
    return out;
  }

  private think(match: Match, f: Fighter, b: Brain): Input {
    const L = LEVEL[f.bot!];
    const st = match.stage;
    const main = st.plats.find((p) => !p.soft)!;
    const i: Input = { mx: 0, my: 0, jump: false, light: false, heavy: false, dodge: false, special: false };
    if (match.countdown > 0 || f.respawn > 0) return i;

    // 0. hanging from a ledge: climb up, or jump if someone waits above
    if (f.hang > 0) {
      if (f.hang > 8 + Math.floor(rand(match) * 20)) {
        if (rand(match) < 0.35) i.jump = true;
        else i.mx = f.facing;
      }
      return i;
    }

    // 1. off the stage: get back
    const off = f.x < main.x0 + 4 || f.x > main.x1 - 4;
    const below = f.y > main.y - 4 && !f.grounded;
    if ((off && !f.grounded) || below) {
      const home = f.x < (main.x0 + main.x1) / 2 ? 1 : -1;
      i.mx = home;
      if (rand(match) < L.recover) {
        const needUp = f.y > main.y - 30 || f.vy > 120;
        if (needUp && f.special === 'moon' && f.meter >= METER_FULL && f.airJumps === 0) i.special = true;
        else if (needUp && f.airJumps > 0 && f.vy > -60) i.jump = true;
        else if (needUp && f.airJumps === 0 && !f.recoveryUsed && f.vy > 0) {
          i.heavy = true;
          i.my = -1;
        }
      }
      return i;
    }

    // 2. pick a foe: the closest one still fighting (FFA), or the other one (1v1)
    const foes = match.fighters.filter((o) => o !== f && o.stocks > 0 && o.respawn === 0 && (match.mode === 'ffa' || o.team !== f.team));
    if (!foes.length) return i;
    let foe = foes.find((o) => o.id === b.target);
    if (!foe || rand(match) < 0.08) {
      foe = foes.reduce((a, o) => (Math.hypot(o.x - f.x, o.y - f.y) < Math.hypot(a.x - f.x, a.y - f.y) ? o : a));
      b.target = foe.id;
    }
    const dx = foe.x - f.x;
    const dy = foe.y - f.y;
    const adx = Math.abs(dx);

    // 3. danger: the foe is swinging close by
    if (foe.act && adx < 44 && Math.abs(dy) < 34 && f.special === 'guard' && f.meter >= METER_FULL && !f.act && rand(match) < L.aim) {
      i.special = true;
      return i;
    }
    if (foe.act && adx < 36 && Math.abs(dy) < 30 && rand(match) < L.dodge) {
      i.dodge = true;
      i.mx = -Math.sign(dx);
      return i;
    }

    // 4. in reach: attack
    // a full meter: the special, when it would land
    if (f.meter >= METER_FULL && !f.act && f.special !== 'guard' && rand(match) < L.aim) {
      const fits =
        f.special === 'rush' ? adx < 90 && Math.abs(dy) < 20 && Math.sign(dx) === f.facing :
        f.special === 'moon' ? adx < 24 && dy < 4 && dy > -50 :
        f.special === 'dive' ? adx < 70 && adx > 20 && Math.abs(dy) < 30 && Math.sign(dx) === f.facing :
        f.special === 'whirl' ? adx < 30 && Math.abs(dy) < 26 :
        adx < 38 && Math.abs(dy) < 14 && f.grounded;
      if (fits) {
        i.special = true;
        return i;
      }
    }
    const reach = MOVES[f.weapon].sLight.hx + MOVES[f.weapon].sLight.hw;
    if (adx < reach + 2 && Math.abs(dy) < 26 && !f.act) {
      if (rand(match) > L.aim) {
        // a mistake: swing at the air, the wrong way
        i.light = true;
        i.mx = -Math.sign(dx) * (rand(match) < 0.5 ? 1 : 0);
        return i;
      }
      i.mx = Math.sign(dx) * 0.5;
      if (dy < -14) {
        // foe above: up / neutral attacks
        if (f.grounded && foe.dmg > L.heavyAt) i.heavy = true;
        else i.light = true;
      } else if (dy > 14 && !f.grounded) {
        i.my = 1;
        i.light = true;
      } else if (foe.dmg > L.heavyAt && f.grounded) {
        i.heavy = true;
        // a side heavy toward the nearer edge finishes best
        i.mx = Math.sign(dx);
      } else {
        i.light = true;
        if (rand(match) < 0.3) i.mx = 0;
      }
      return i;
    }

    // 5. chase, but don't run off the edge
    if (rand(match) < L.chase) {
      const edgeAhead = (dx > 0 && f.x > main.x1 - 10) || (dx < 0 && f.x < main.x0 + 10);
      if (!(f.grounded && f.on === st.plats.indexOf(main) && edgeAhead)) i.mx = Math.sign(dx) * (adx > 40 ? 1 : 0.6);
      if (dy < -24 && f.grounded) i.jump = true;
      if (dy > 20 && f.grounded && st.plats[f.on]?.soft) i.my = 1;
      if (!f.grounded && f.airJumps > 0 && dy < -30 && f.vy > 0) i.jump = true;
    }
    return i;
  }
}
