/**
 * Particles, in map pixels, drawn as whole art pixels so they sit on the same
 * grid as everything else. A fixed pool: a burst never allocates.
 */
import type { Ctx } from './art';

export type Kind = 'dust' | 'chip' | 'spark' | 'gold' | 'smoke' | 'splash' | 'ring' | 'leaf' | 'fly' | 'coin' | 'star' | 'drip' | 'ember';

interface P {
  on: boolean;
  k: Kind;
  x: number;
  y: number;
  z: number; // height above the ground, for things that arc and land
  vx: number;
  vy: number;
  vz: number;
  life: number;
  age: number;
  c: string;
  s: number; // size in art px
}

const MAX = 700;

export class Particles {
  private pool: P[] = Array.from({ length: MAX }, () => ({ on: false, k: 'dust' as Kind, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 1, age: 0, c: '#fff', s: 1 }));
  private cursor = 0;
  budget = 1; // scaled down on slow phones

  spawn(k: Kind, x: number, y: number, o: Partial<Omit<P, 'on' | 'k' | 'x' | 'y'>> = {}) {
    if (this.budget < 1 && Math.random() > this.budget) return;
    for (let n = 0; n < MAX; n++) {
      const p = this.pool[this.cursor];
      this.cursor = (this.cursor + 1) % MAX;
      if (p.on) continue;
      p.on = true;
      p.k = k;
      p.x = x;
      p.y = y;
      p.z = o.z ?? 0;
      p.vx = o.vx ?? 0;
      p.vy = o.vy ?? 0;
      p.vz = o.vz ?? 0;
      p.life = o.life ?? 0.6;
      p.age = 0;
      p.c = o.c ?? '#ffffff';
      p.s = o.s ?? 1;
      return;
    }
  }

  burst(k: Kind, x: number, y: number, n: number, spread: number, up: number, colors: string[], life = 0.7) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = spread * (0.4 + Math.random() * 0.6);
      this.spawn(k, x, y, {
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v * 0.45,
        vz: up * (0.5 + Math.random() * 0.7),
        life: life * (0.6 + Math.random() * 0.6),
        c: colors[i % colors.length],
        s: k === 'gold' || k === 'coin' ? 1 + (Math.random() < 0.3 ? 1 : 0) : 1,
      });
    }
  }

  update(dt: number, wind: number) {
    for (const p of this.pool) {
      if (!p.on) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.on = false;
        continue;
      }
      switch (p.k) {
        case 'smoke':
          p.x += (p.vx + wind * 6) * dt;
          p.z += (p.vz || 7) * dt;
          break;
        case 'leaf':
          p.x += (p.vx + wind * 14) * dt;
          p.y += p.vy * dt;
          p.z += Math.sin(p.age * 5) * 4 * dt - 2 * dt;
          break;
        case 'fly':
          p.x += Math.sin(p.age * 1.3 + p.vx) * 4 * dt;
          p.y += Math.cos(p.age * 1.7 + p.vy) * 3 * dt;
          break;
        case 'ring':
        case 'splash':
          break;
        default:
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vz -= (p.k === 'spark' || p.k === 'star' ? 40 : 90) * dt;
          p.z += p.vz * dt;
          if (p.z < 0) {
            p.z = 0;
            p.vz = -p.vz * 0.35;
            p.vx *= 0.5;
            p.vy *= 0.5;
          }
      }
    }
  }

  draw(c: Ctx, ox: number, oy: number, s: number) {
    const px = Math.max(1, Math.round(s));
    for (const p of this.pool) {
      if (!p.on) continue;
      const k = p.age / p.life;
      const X = Math.round(ox + p.x * s);
      const Y = Math.round(oy + (p.y - p.z) * s);
      switch (p.k) {
        case 'ring': {
          // an expanding pixel ring, for rain on water and splashes
          const r = 1 + k * 3;
          c.globalAlpha = 1 - k;
          c.fillStyle = p.c;
          for (let a = 0; a < 8; a++) {
            const ax = Math.round(Math.cos((a / 8) * Math.PI * 2) * r * 1.4);
            const ay = Math.round(Math.sin((a / 8) * Math.PI * 2) * r * 0.6);
            c.fillRect(X + ax * px, Y + ay * px, px, px);
          }
          c.globalAlpha = 1;
          break;
        }
        case 'smoke': {
          const sz = Math.round((1 + k * 3) * px);
          c.globalAlpha = (1 - k) * 0.55;
          c.fillStyle = p.c;
          c.fillRect(X - sz / 2, Y - sz / 2, sz, sz);
          c.globalAlpha = 1;
          break;
        }
        case 'fly': {
          const on = Math.sin(p.age * 6 + p.vx * 3) > -0.2;
          if (!on) break;
          c.fillStyle = p.c;
          c.fillRect(X, Y, px, px);
          break;
        }
        case 'star': {
          c.fillStyle = p.c;
          c.globalAlpha = 1 - k * 0.6;
          c.fillRect(X, Y, px, px);
          if (k < 0.5) {
            c.fillRect(X - px, Y, px, px);
            c.fillRect(X + px, Y, px, px);
            c.fillRect(X, Y - px, px, px);
            c.fillRect(X, Y + px, px, px);
          }
          c.globalAlpha = 1;
          break;
        }
        default: {
          c.globalAlpha = p.k === 'dust' ? (1 - k) * 0.8 : k > 0.75 ? (1 - k) * 4 : 1;
          c.fillStyle = p.c;
          c.fillRect(X, Y, px * p.s, px * p.s);
          c.globalAlpha = 1;
        }
      }
    }
  }

  clear() {
    for (const p of this.pool) p.on = false;
  }
}
