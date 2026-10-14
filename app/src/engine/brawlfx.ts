/**
 * Brawl on the canvas: HP bars, the shield bubble, the hit flash, the knockdown and the pick of a target.
 * Shared by the lobby and the island, which both draw miners at feet (X, Y) with `s` screen px per map px.
 */
import { ACTORS, text, textWidth, type Ctx } from './art';
import { drawMiner, frameAt, minerFrame } from './actors';
import type { BrawlView, Look } from './types';

/** the knockdown: fall, lie dizzy, then a little dance before standing up */
export const KO_MS = 3000;
const FALL_MS = 220;
const LIE_MS = 1500;
/** a jump: up and down in this long, this high (map px) */
export const JUMP_MS = 460;
const JUMP_H = 11;
/** How high a miner is off the ground at `now` (map px), from when the jump started. */
export function jumpLift(at: number | undefined, now: number): number {
  if (!at) return 0;
  const t = (now - at) / JUMP_MS;
  return t > 0 && t < 1 ? Math.sin(Math.PI * t) * JUMP_H : 0;
}
/** How far a miner leans into a swing that started `age` ms ago (radians, signed by facing). */
export function swingTilt(age: number, facing: number): number {
  if (age < 0 || age > 540) return 0;
  // lean back on the wind-up, then throw the weight forward on the strike
  const t = age / 540;
  const k = t < 0.3 ? -0.45 * Math.sin((Math.PI * t) / 0.3) : Math.sin((Math.PI * (t - 0.3)) / 0.7);
  return facing * 0.32 * k;
}
/** how far a swing reaches (map px between feet), matching game/brawl.ts */
export const REACH = 22;

const M = ACTORS.miner;

/** Is this fighter knocked down at `now`, and for how long already (ms)? -1 when standing. */
export function koAge(v: BrawlView | undefined, now: number): number {
  if (!v || !v.ko) return -1;
  const a = now - v.ko;
  return a >= 0 && a < KO_MS + 1500 ? a : -1;
}

/**
 * Draw a miner that is knocked down. Falls over, lies with stars going round its head, then gets up for a
 * short dance. Returns false when the knockdown is over (draw the miner as usual).
 */
export function drawKo(c: Ctx, look: Look, X: number, Y: number, s: number, facing: number, age: number, now: number): boolean {
  if (age < 0) return false;
  if (age < FALL_MS + LIE_MS) {
    const k = Math.min(1, age / FALL_MS);
    const cv = minerFrame(look, 'idle', 0);
    const ax = M.ax + 10;
    const ay = M.ay + 12;
    c.save();
    c.translate(Math.round(X), Math.round(Y - 2 * s));
    c.rotate(-facing * (Math.PI / 2) * k);
    if (facing < 0) c.scale(-1, 1);
    c.drawImage(cv, -ax * s, -ay * s, cv.width * s, cv.height * s);
    c.restore();
    if (age > FALL_MS) stars(c, X - facing * 18 * s, Y - 8 * s, s, now);
    return true;
  }
  // the knockdown dance
  const f = frameAt('dance2', 0, now);
  drawMiner(c, look, 'dance2', f, X, Y, s, facing);
  stars(c, X, Y - 30 * s, s * 0.8, now);
  return true;
}

function stars(c: Ctx, X: number, Y: number, s: number, now: number) {
  for (let i = 0; i < 3; i++) {
    const a = now / 260 + (i * Math.PI * 2) / 3;
    const x = Math.round(X + Math.cos(a) * 7 * s);
    const y = Math.round(Y + Math.sin(a) * 2.5 * s);
    const p = Math.max(1, Math.round(s));
    c.fillStyle = i === 1 ? '#ffffff' : '#ffd84a';
    c.fillRect(x - p, y, p * 3, p);
    c.fillRect(x, y - p, p, p * 3);
  }
}

/** The HP bar above a miner's head. Green, then gold, then red; a white tail shows the hit just taken. */
export function drawHp(c: Ctx, v: BrawlView, X: number, Y: number, s: number, now: number, mine: boolean) {
  const w = 16;
  const k = Math.max(1, Math.round(s));
  const bw = w * k;
  const x0 = Math.round(X - bw / 2);
  const y0 = Math.round(Y - 29.5 * s);
  const hp = Math.max(0, Math.min(100, v.hp));
  c.fillStyle = 'rgba(4,6,15,0.85)';
  c.fillRect(x0 - k, y0 - k, bw + 2 * k, 2 * k + 2 * k);
  const fill = Math.round((bw * hp) / 100);
  // the chunk just lost flashes white for a moment
  const since = now - v.hit;
  if (since >= 0 && since < 350) {
    c.fillStyle = '#ffffff';
    c.fillRect(x0, y0, Math.min(bw, fill + 3 * k), 2 * k);
  }
  c.fillStyle = hp > 55 ? (mine ? '#7cff6b' : '#3ee07a') : hp > 25 ? '#ffcf4a' : '#ff4f5e';
  c.fillRect(x0, y0, fill, 2 * k);
}

/** A bubble round a miner who can't be hit yet (just stood up, or just arrived). */
export function drawShield(c: Ctx, X: number, Y: number, s: number, now: number, until: number) {
  const left = until - now;
  if (left <= 0) return;
  // blink in the last half second
  if (left < 500 && Math.floor(now / 80) % 2) return;
  c.save();
  c.globalAlpha = 0.55 + Math.sin(now / 140) * 0.15;
  c.strokeStyle = '#7fe3ff';
  c.lineWidth = Math.max(1, s * 0.8);
  c.beginPath();
  c.ellipse(Math.round(X), Math.round(Y - 12 * s), 12 * s, 15 * s, 0, 0, Math.PI * 2);
  c.stroke();
  c.globalAlpha = 0.12;
  c.fillStyle = '#7fe3ff';
  c.fill();
  c.restore();
}

/** A red flash over a miner that was hit in the last few frames. */
export function hitFlash(v: BrawlView | undefined, now: number): boolean {
  return Boolean(v && v.hit && now - v.hit >= 0 && now - v.hit < 140);
}

/**
 * Who a swing hits: the nearest fair fighter within reach, preferring the side you face.
 * Returns the id and which way to face, or null.
 */
export function pickTarget(me: { x: number; y: number; facing: number }, others: { id: string; x: number; y: number; v: BrawlView | undefined }[], now: number): { id: string; facing: 1 | -1 } | null {
  let best: { id: string; facing: 1 | -1; d: number } | null = null;
  for (const o of others) {
    const v = o.v;
    if (!v || !v.on || (v.ko && now - v.ko < KO_MS + 1500) || now < v.sh) continue;
    const dx = o.x - me.x;
    const dy = (o.y - me.y) * 1.6;
    const d = Math.hypot(dx, dy);
    if (d > REACH) continue;
    // a foe behind you counts a little further away, so you hit the one you face first
    const score = d + (Math.sign(dx || me.facing) !== me.facing ? 6 : 0);
    if (!best || score < best.d) best = { id: o.id, facing: dx === 0 ? (me.facing < 0 ? -1 : 1) : dx > 0 ? 1 : -1, d: score };
  }
  return best ? { id: best.id, facing: best.facing } : null;
}

/* ---------------- the punch of a fight: slashes, lunges, damage numbers, shake ---------------- */


interface Slash { x: number; y: number; facing: number; at: number; big: boolean }
interface Pop { x: number; y: number; t: string; c: string; at: number; big: boolean }
const WORDS = ['BONK!', 'POW!', 'WHAM!', 'CLANG!', 'THWACK!'];

/**
 * One per canvas. Positions are map px; draw() takes the map-to-screen origin and scale.
 * Everything here is cosmetic and runs on wall-clock ms.
 */
export class FightFx {
  private slashes: Slash[] = [];
  private pops: Pop[] = [];
  private shakeUntil = 0;
  private shakeK = 0;

  /** a pickaxe swing: a white arc in front of the miner; bigger when it connects */
  slash(x: number, y: number, facing: number, at: number, big: boolean) {
    this.slashes.push({ x, y, facing, at, big });
    if (this.slashes.length > 30) this.slashes.shift();
  }
  /** a hit landed at (x, y): the damage, and now and then a comic word */
  hit(x: number, y: number, dmg: number, at: number, onMe: boolean) {
    if (dmg > 0) this.pops.push({ x: x + 10 + (Math.random() - 0.5) * 6, y: y - 38, t: `-${dmg}`, c: onMe ? '#ff4f5e' : '#ffffff', at, big: true });
    if (Math.random() < 0.55) this.pops.push({ x: x - 8 + (Math.random() - 0.5) * 8, y: y - 18, t: WORDS[Math.floor(Math.random() * WORDS.length)], c: '#ffd84a', at, big: true });
    if (this.pops.length > 40) this.pops.splice(0, this.pops.length - 40);
  }
  ko(x: number, y: number, at: number) {
    this.pops.push({ x, y: y - 34, t: 'K.O.!', c: '#ff8a3d', at, big: true });
  }
  shake(ms: number, k: number, now: number) {
    this.shakeUntil = Math.max(this.shakeUntil, now + ms);
    this.shakeK = Math.max(k, now < this.shakeUntil ? this.shakeK : 0);
  }
  /** screen shake offset, in map px */
  offset(now: number, reduced: boolean): [number, number] {
    if (reduced || now >= this.shakeUntil) return [0, 0];
    const k = this.shakeK;
    return [(Math.random() - 0.5) * 2 * k, (Math.random() - 0.5) * 2 * k];
  }

  draw(c: Ctx, ox: number, oy: number, s: number, now: number) {
    this.slashes = this.slashes.filter((sl) => now - sl.at < 520);
    for (const sl of this.slashes) {
      const a = now - sl.at;
      // the pick comes over the head and down in front: the arc sweeps from above to in front
      if (a < 120) continue;
      const t = Math.min(1, (a - 120) / 130);
      const fade = a > 330 ? Math.max(0, 1 - (a - 330) / 190) : 1;
      const r = (sl.big ? 19 : 16) * s;
      const cx = ox + (sl.x + sl.facing * 4) * s;
      const cy = oy + (sl.y - 12) * s;
      const start = -Math.PI * 0.62;
      const end = start + Math.PI * 0.95 * t;
      c.save();
      if (sl.facing < 0) {
        c.translate(cx, cy);
        c.scale(-1, 1);
        c.translate(-cx, -cy);
      }
      c.lineCap = 'butt';
      c.globalAlpha = 0.85 * fade;
      c.strokeStyle = sl.big ? '#ffd84a' : '#9fd6ee';
      c.lineWidth = Math.max(2, (sl.big ? 5 : 3.5) * s);
      c.beginPath();
      c.arc(cx, cy, r, start, end);
      c.stroke();
      c.globalAlpha = fade;
      c.strokeStyle = '#ffffff';
      c.lineWidth = Math.max(1, 1.5 * s);
      c.beginPath();
      c.arc(cx, cy, r - 1.5 * s, Math.max(start, end - 0.9), end);
      c.stroke();
      c.restore();
    }
    this.pops = this.pops.filter((p) => now - p.at < 900);
    for (const p of this.pops) {
      const a = (now - p.at) / 900;
      const k = Math.max(1, Math.round(s * (p.big ? 1.25 : 0.9)));
      const pop = a < 0.12 ? 1.4 - a * 3 : 1;
      const fs = Math.max(1, Math.round(k * pop));
      const w = textWidth(p.t) * fs;
      const X = Math.round(ox + p.x * s - w / 2);
      const Y = Math.round(oy + (p.y - a * 12) * s);
      c.globalAlpha = a > 0.7 ? (1 - a) / 0.3 : 1;
      text(c, p.t, X, Y, fs, p.c, '#1a0c10');
      c.globalAlpha = 1;
    }
  }
}
