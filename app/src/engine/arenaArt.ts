/**
 * The arena's moving bits, shared by the hall (hallArt.ts paints the still parts, bossArt.ts the boss):
 * torch flames, the warm light they throw, the dark edge round the screen, and the crowd's fans.
 */
import type { Ctx } from './art';

/* ---------------- flames and light ---------------- */
/** a flickering flame whose base sits at (X, Y) on screen */
export function drawFlame(c: Ctx, X: number, Y: number, z: number, wall: number, seed: number, big = 1) {
  const f = Math.floor(wall / 90 + seed) % 4;
  const h = (5 + [0, 1, 2, 1][f]) * big;
  const sway = [0, 1, 0, -1][(f + seed) % 4];
  const col = ['#c8321a', '#ff6a2a', '#ffb43d', '#fff1a8'];
  for (let i = 0; i < 4; i++) {
    const w = (5 - i) * big * 0.9;
    const hh = h * (1 - i * 0.2);
    c.fillStyle = col[i];
    c.fillRect(Math.round(X + (sway * i * 0.4 - w / 2) * z), Math.round(Y - hh * z), Math.max(1, Math.round(w * z)), Math.round(hh * z));
  }
}
/** warm light pools from the fires, added on top */
export function drawGlow(c: Ctx, pts: [number, number, number][], z: number, wall: number) {
  c.save();
  c.globalCompositeOperation = 'lighter';
  pts.forEach(([X, Y, r], i) => {
    const fl = 0.85 + 0.15 * Math.sin(wall / 120 + i * 1.7) + 0.05 * Math.sin(wall / 47 + i);
    const g = c.createRadialGradient(X, Y, 0, X, Y, r * z * fl);
    g.addColorStop(0, 'rgba(255,170,80,0.22)');
    g.addColorStop(0.5, 'rgba(255,120,40,0.08)');
    g.addColorStop(1, 'rgba(255,100,30,0)');
    c.fillStyle = g;
    c.fillRect(X - r * z, Y - r * z, r * 2 * z, r * 2 * z);
  });
  c.restore();
}
export function drawVignette(c: Ctx, W: number, H: number) {
  const g = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
  g.addColorStop(0, 'rgba(8,4,16,0)');
  g.addColorStop(1, 'rgba(8,4,16,0.55)');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
}

/* ---------------- the crowd ---------------- */
export interface Fan {
  x: number;
  y: number;
  skin: string;
  hair: string;
  shirt: string;
  ph: number;
  flag: boolean;
}
/** one fan: 5 wide, 8 tall, feet at y. `hop` lifts them; `arms` raises their arms. */
export function drawFan(c: Ctx, f: Fan, sx: (x: number) => number, sy: (y: number) => number, z: number, hop: number, arms: boolean) {
  const P = (x: number, y: number, w: number, h: number, col: string) => {
    c.fillStyle = col;
    c.fillRect(sx(f.x + x), sy(f.y + y - hop), w * z, h * z);
  };
  P(-2, -4, 5, 4, f.shirt);
  P(-2, -4, 1, 4, 'rgba(0,0,0,0.25)');
  P(-1, -7, 3, 3, f.skin);
  P(-1, -8, 3, 1, f.hair);
  P(-1, -7, 1, 1, f.hair);
  if (arms) {
    P(-3, -8, 1, 4, f.skin);
    P(3, -8, 1, 4, f.skin);
  } else {
    P(-3, -4, 1, 3, f.skin);
    P(3, -4, 1, 3, f.skin);
  }
  if (f.flag) {
    P(3, -12, 1, 8, '#8a6a2a');
    P(4, -12, 4, 3, f.ph % 2 ? '#ffd24a' : '#d8483a');
  }
}
