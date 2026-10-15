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


interface Slash { x: number; y: number; facing: number; at: number; big: boolean; color?: string }
interface Pop { x: number; y: number; t: string; c: string; at: number; big: boolean; tilt: number }
interface Impact { x: number; y: number; at: number; c: string; k: number; seed: number }
const WORDS = ['BONK!', 'POW!', 'WHAM!', 'CLANG!', 'THWACK!'];
/** how long the impact burst lives (ms) */
const IMPACT_MS = 300;

export class FightFx {
  private slashes: Slash[] = [];
  private pops: Pop[] = [];
  private impacts: Impact[] = [];
  private shakeUntil = 0;
  private shakeK = 0;

  /** a pickaxe swing: a white arc in front of the miner; bigger when it connects */
  slash(x: number, y: number, facing: number, at: number, big: boolean, color?: string) {
    this.slashes.push({ x, y, facing, at, big, color });
    if (this.slashes.length > 30) this.slashes.shift();
  }
  /** a hit landed at (x, y): the damage, and now and then a comic word */
  hit(x: number, y: number, dmg: number, at: number, onMe: boolean) {
    const tilt = () => (Math.random() - 0.5) * 0.16;
    if (dmg > 0) this.pops.push({ x: x + 10 + (Math.random() - 0.5) * 6, y: y - 38, t: `-${dmg}`, c: onMe ? '#ff4f5e' : '#ffffff', at, big: true, tilt: tilt() });
    if (Math.random() < 0.55) this.pops.push({ x: x - 8 + (Math.random() - 0.5) * 8, y: y - 18, t: WORDS[Math.floor(Math.random() * WORDS.length)], c: '#ffd84a', at, big: true, tilt: tilt() });
    if (this.pops.length > 40) this.pops.splice(0, this.pops.length - 40);
    this.impact(x, y - 13, at, onMe ? '#ff6a5e' : '#ffd84a', dmg >= 12 ? 1.25 : 1);
  }
  /** a burst where a blow lands: a white flash star, a ring and sparks flying out */
  impact(x: number, y: number, at: number, c = '#ffd84a', k = 1) {
    this.impacts.push({ x, y, at, c, k, seed: Math.random() * Math.PI * 2 });
    if (this.impacts.length > 24) this.impacts.shift();
  }
  ko(x: number, y: number, at: number) {
    this.pops.push({ x, y: y - 34, t: 'K.O.!', c: '#ff8a3d', at, big: true, tilt: 0 });
    this.impact(x, y - 12, at, '#ff8a3d', 1.6);
  }
  /** a word in the air, like a power's name */
  say(x: number, y: number, t: string, c: string, at: number) {
    this.pops.push({ x, y, t, c, at, big: true, tilt: 0 });
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
      // the pick comes over the head and down in front: a thick crescent sweeps from above to in front
      if (a < 110) continue;
      const t = Math.min(1, (a - 110) / 110);
      const ease = 1 - (1 - t) * (1 - t);
      const fade = a > 300 ? Math.max(0, 1 - (a - 300) / 220) : 1;
      const r = (sl.big ? 21 : 17) * s;
      const cx = ox + (sl.x + sl.facing * 4) * s;
      const cy = oy + (sl.y - 12) * s;
      const start = -Math.PI * 0.7;
      const end = start + Math.PI * 1.02 * ease;
      // the tail trails the tip, so the blade looks like it moves
      const tail = Math.max(start, end - Math.PI * (0.55 + 0.35 * (1 - t)));
      const thick = (sl.big ? 7 : 4.5) * s * (0.6 + 0.4 * fade);
      const col = sl.color === 'rainbow' ? `hsl(${(now / 3) % 360},90%,62%)` : sl.color ?? (sl.big ? '#ffd84a' : '#9fd6ee');
      c.save();
      if (sl.facing < 0) {
        c.translate(cx, cy);
        c.scale(-1, 1);
        c.translate(-cx, -cy);
      }
      const crescent = (w: number, rr: number) => {
        const n = 14;
        c.beginPath();
        for (let i = 0; i <= n; i++) {
          const th = tail + ((end - tail) * i) / n;
          c.lineTo(cx + Math.cos(th) * rr, cy + Math.sin(th) * rr);
        }
        for (let i = n; i >= 0; i--) {
          const th = tail + ((end - tail) * i) / n;
          // thin at the tail, full at the leading edge
          const ww = w * Math.pow(i / n, 0.7);
          c.lineTo(cx + Math.cos(th) * (rr - ww), cy + Math.sin(th) * (rr - ww));
        }
        c.closePath();
        c.fill();
      };
      // a soft afterglow, the coloured blade, then a white edge
      c.globalAlpha = 0.25 * fade;
      c.fillStyle = col;
      crescent(thick * 1.8, r + 2 * s);
      c.globalAlpha = 0.9 * fade;
      crescent(thick, r);
      c.globalAlpha = fade;
      c.fillStyle = '#ffffff';
      crescent(thick * 0.38, r);
      // speed lines just behind the tip
      c.strokeStyle = '#ffffff';
      c.lineWidth = Math.max(1, 0.9 * s);
      c.globalAlpha = 0.7 * fade;
      for (let k = 0; k < 3; k++) {
        const th = end - 0.25 - k * 0.22;
        if (th < tail) break;
        const r0 = r + (2 + k * 2) * s;
        c.beginPath();
        c.arc(cx, cy, r0, th - 0.28, th);
        c.stroke();
      }
      c.restore();
    }
    this.impacts = this.impacts.filter((im) => now - im.at < IMPACT_MS);
    for (const im of this.impacts) {
      const a = now - im.at;
      if (a < 0) continue;
      const t = a / IMPACT_MS;
      const X = ox + im.x * s;
      const Y = oy + im.y * s;
      const k = im.k * s;
      c.save();
      // the flash: a white four-point star for the first few frames
      if (a < 90) {
        const q = 1 - a / 90;
        const R = (9 + 5 * (1 - q)) * k;
        c.globalAlpha = 0.95;
        c.fillStyle = im.c;
        star4(c, X, Y, R * 1.25, R * 0.32, im.seed);
        c.fillStyle = '#ffffff';
        star4(c, X, Y, R, R * 0.22, im.seed);
        c.beginPath();
        c.arc(X, Y, 3.2 * k * q + k, 0, Math.PI * 2);
        c.fill();
      }
      // a ring that opens and thins out
      c.globalAlpha = Math.max(0, 1 - t) * 0.9;
      c.strokeStyle = t < 0.35 ? '#ffffff' : im.c;
      c.lineWidth = Math.max(1, (1 - t) * 3 * k);
      c.beginPath();
      c.ellipse(X, Y, (5 + t * 15) * k, (4 + t * 11) * k, 0, 0, Math.PI * 2);
      c.stroke();
      // sparks: short streaks flying out
      c.strokeStyle = im.c;
      c.lineWidth = Math.max(1, 1.3 * k);
      for (let i = 0; i < 7; i++) {
        const ang = im.seed + (i * Math.PI * 2) / 7;
        const d0 = (4 + t * 16) * k;
        const d1 = d0 + (1 - t) * 6 * k;
        c.globalAlpha = Math.max(0, 1 - t * 1.2);
        c.beginPath();
        c.moveTo(X + Math.cos(ang) * d0, Y + Math.sin(ang) * d0 * 0.8);
        c.lineTo(X + Math.cos(ang) * d1, Y + Math.sin(ang) * d1 * 0.8);
        c.stroke();
      }
      c.restore();
    }
    this.pops = this.pops.filter((p) => now - p.at < 900);
    for (const p of this.pops) {
      const a = (now - p.at) / 900;
      const k = Math.max(1, Math.round(s * (p.big ? 1.25 : 0.9)));
      // punch in big, settle, then drift up and fade
      const pop = a < 0.08 ? 1.7 - a * 6 : a < 0.16 ? 1.22 - (a - 0.08) * 2.7 : 1;
      const fs = Math.max(1, Math.round(k * pop));
      const w = textWidth(p.t) * fs;
      const X = Math.round(ox + p.x * s);
      const Y = Math.round(oy + (p.y - a * 12) * s);
      c.globalAlpha = a > 0.7 ? (1 - a) / 0.3 : 1;
      c.save();
      c.translate(X, Y);
      if (p.tilt) c.rotate(p.tilt);
      // a dark outline all round, so the number reads on sand, grass or a crowd
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) text(c, p.t, -w / 2 + dx * fs * 0.6, dy * fs * 0.6, fs, '#1a0c10');
      text(c, p.t, -w / 2, 0, fs, p.c, '#1a0c10');
      c.restore();
      c.globalAlpha = 1;
    }
  }
}

/** a four-point star (two thin diamonds crossed), for the flash of a hit */
function star4(c: Ctx, x: number, y: number, R: number, r: number, rot: number) {
  c.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = rot * 0.15 + (i * Math.PI) / 4;
    const d = i % 2 ? r : R;
    c.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
  }
  c.closePath();
  c.fill();
}
