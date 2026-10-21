/**
 * The Two-Mouthed, drawn and animated: the team's boss drawing as a pixel sprite in three layers, with
 * both mouths, the long belly tongue and the held leg moved in code.
 *
 * Idle, it breathes, sways the leg it holds as a weapon, and its face and belly mouths open in turn while
 * blood drips from the tongue and the leg. Each attack has a wind-up (the warning) and the act:
 *
 *   sweep   the leg is drawn back, then swung through low in front of it
 *   tongue  the belly mouth opens wide, the tongue pulls in, then lashes far ahead
 *   roar    the face mouth opens wider and wider, the head shakes, then it roars
 *
 * Everything is painted at sprite size into a small canvas, then scaled up with the map, so the pixels
 * stay crisp. Pure: it only needs the canvas helpers and the sprite.
 */
import { ctx2d, makeCanvas, type Ctx } from './art';
import { BOSS_LOWER, BOSS_SPR, BOSS_UPPER, BOSS_WEAPON } from './bossSprite';
import type { BossAtk } from '../game/arenaMap';

/** map px per sprite px */
export const BOSS_SCALE = 0.56;
/** room to the left of the sprite (it faces left) for the tongue at full reach */
const OX = 300;
const OY = 8;
const OW = OX + BOSS_SPR.w + 12;
const OH = BOSS_SPR.h + OY + 6;
/** where the weapon leg's foot sits, from the grip, at rest */
const WEAPON_FOOT: [number, number] = [-16, 51];

const C = {
  out: '#100810',
  dark: '#1e060a',
  red: '#78121a',
  tooth: '#ece2c8',
  tooth2: '#c4b696',
  tongue: '#a8242a',
  tongueSh: '#6e1016',
  tongueHi: '#d65c4c',
};

let imgs: { lower: HTMLImageElement; upper: HTMLImageElement; weapon: HTMLImageElement } | null = null;
let loaded = 0;
function load() {
  if (imgs || typeof Image === 'undefined') return;
  const mk = (src: string) => {
    const im = new Image();
    im.onload = () => (loaded += 1);
    im.src = src;
    return im;
  };
  imgs = { lower: mk(BOSS_LOWER), upper: mk(BOSS_UPPER), weapon: mk(BOSS_WEAPON) };
}
/** Start loading the sprite early (it is embedded, so this is quick). */
export const preloadBoss = () => load();

let off: HTMLCanvasElement | null = null;
let og: Ctx | null = null;

export interface BossPose {
  facing: 1 | -1;
  wall: number;
  /** the attack in play, and ms since its wind-up began */
  atk: BossAtk | null;
  t: number;
  /** wind-up length for this phase */
  wind: number;
  act: number;
  /** below half HP: angrier, faster */
  p2: boolean;
  flash: boolean;
}
export interface BossTips {
  /** where the tongue and the weapon foot end, in map px from the boss's feet */
  tongue: [number, number];
  weapon: [number, number];
  /** the face mouth, for the roar's shock ring */
  face: [number, number];
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * Math.max(0, Math.min(1, k));
const ease = (k: number) => 1 - (1 - Math.max(0, Math.min(1, k))) ** 3;
const DEG = Math.PI / 180;

/** The pose of each part for this moment. */
function parts(st: BossPose) {
  const per = st.p2 ? 1150 : 1800;
  const p = ((st.wall % per) / per) * Math.PI * 2;
  let breathe = Math.round(1 + Math.sin(p));
  let ang = (-6 + 12 * Math.sin(p + Math.PI / 2)) * DEG;
  let face = ((Math.sin(p * 2) + 1) / 2) * 0.7;
  let belly = ((Math.sin(p * 2 + Math.PI) + 1) / 2) * 0.8;
  let tongue = 28 + 6 * belly;
  let shake = 0;
  let lash = false;
  if (st.atk) {
    const wind = st.t < st.wind;
    const k = wind ? st.t / st.wind : (st.t - st.wind) / st.act;
    if (st.atk === 'sweep') {
      if (wind) {
        ang = lerp(ang, -42 * DEG, ease(k));
        breathe = 2;
      } else ang = k < 0.35 ? lerp(-42 * DEG, 88 * DEG, k / 0.35) : lerp(88 * DEG, 0, (k - 0.35) / 0.65);
      face = 0.5;
    } else if (st.atk === 'tongue') {
      belly = 1.3;
      lash = !wind;
      tongue = wind ? lerp(30, 6, ease(k)) : k < 0.3 ? lerp(6, 250, ease(k / 0.3)) : lerp(250, 30, (k - 0.3) / 0.7);
      if (wind) breathe = 2;
    } else {
      face = wind ? 0.5 + 0.8 * k : 1.45;
      shake = wind ? (Math.floor(st.wall / 40) % 2 ? 1 : -1) * Math.round(k * 2) : Math.floor(st.wall / 30) % 2 ? 1 : -1;
      breathe = wind ? 2 : 0;
    }
  }
  return { p, breathe, ang, face, belly, tongue, shake, lash };
}

/** Draw the boss with its feet at (X, Y) on screen, `z` screen px per map px. Returns its tips. */
export function drawTwoMouthed(c: Ctx, X: number, Y: number, z: number, st: BossPose, alpha = 1): BossTips | null {
  load();
  if (!imgs || loaded < 3) return null;
  if (!off) {
    off = makeCanvas(OW, OH);
    og = ctx2d(off);
  }
  const g = og!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, OW, OH);
  g.imageSmoothingEnabled = false;
  const P = parts(st);
  const sx = OX;
  const sy = OY;
  // legs stay put; the body breathes and shakes on top
  g.drawImage(imgs.lower, sx, sy);
  g.drawImage(imgs.upper, sx + P.shake, sy + P.breathe);
  // the held leg swings from the grip
  const [px, py] = BOSS_SPR.piv;
  g.save();
  g.translate(sx + px + P.shake, sy + py + P.breathe);
  g.rotate(P.ang);
  g.drawImage(imgs.weapon, -px, -py);
  g.restore();
  // the face mouth (hinge at the back of the jaw, opening forward, to the left)
  const pt = (x: number, y: number, col: string) => {
    g.fillStyle = col;
    g.fillRect(Math.round(x), Math.round(y), 1, 1);
  };
  const span = (x: number, y0: number, y1: number, col: string) => {
    if (y1 < y0) return;
    g.fillStyle = col;
    g.fillRect(Math.round(x), Math.round(y0), 1, Math.round(y1) - Math.round(y0) + 1);
  };
  {
    const [fx, fy] = BOSS_SPR.face;
    const hx = sx + fx + P.shake;
    const hy = sy + fy + P.breathe;
    const L = 12;
    const gap = 1 + Math.round(8 * P.face);
    const lift = 1 + 2 * Math.min(1, P.face);
    for (let i = 0; i <= L; i++) {
      const top = hy - Math.round((lift * i) / L);
      const bot = hy + 1 + Math.round(((gap - 1) * i) / L);
      span(hx - i, top, bot, C.dark);
      if (gap > 3 && i > 2 && i < L - 1) span(hx - i, top + 2, bot - 1, C.red);
      if (i % 2 === 1) pt(hx - i, top + 1, C.tooth);
      if (i % 4 === 1 && gap > 2) pt(hx - i, top + 2, C.tooth2);
      if (i % 2 === 0 && i > 0) pt(hx - i, bot - 1, C.tooth);
      if (i % 4 === 2 && gap > 2) pt(hx - i, bot - 2, C.tooth2);
    }
  }
  // the belly mouth, and the tongue out of it
  const [bx0, by0] = BOSS_SPR.belly;
  const bx = sx + bx0 + P.shake * 0;
  const by = sy + by0 + P.breathe;
  {
    const w = 10;
    const h = 1 + Math.round(5 * Math.min(1.3, P.belly));
    for (let x = -w; x <= w; x++) {
      const half = h * Math.sqrt(Math.max(0, 1 - (x / w) ** 2));
      span(bx + x, by - half - 1, by + half + 1, C.out);
      span(bx + x, by - half, by + half, C.dark);
      if (h > 2 && Math.abs(x) < w - 3) span(bx + x, by - half + 2, by + half - 1, C.red);
      if (x % 2 === 0 && Math.abs(x) < w - 1) {
        pt(bx + x, by - half + 1, C.tooth);
        if ((x / 2) % 2 === 0 && h > 1) pt(bx + x, by - half + 2, C.tooth2);
        pt(bx + x + 1, by + half - 1, C.tooth);
        if ((x / 2) % 2 !== 0 && h > 2) pt(bx + x + 1, by + half - 2, C.tooth2);
      }
    }
  }
  let tip: [number, number] = [bx - 3, by];
  {
    const L = Math.max(4, Math.round(P.tongue));
    const rx = bx - 3;
    const ry = by;
    const pts: [number, number][] = [];
    for (let k = 0; k < L; k++) {
      const wave = (P.lash ? 1.2 : 1.8) * Math.sin(P.p * 1.5 - k * (P.lash ? 0.12 : 0.28)) * (k / L) * (P.lash ? 2 : 1);
      const droop = P.lash ? Math.min(6, 0.0016 * k * k) : 0.01 * k * k;
      pts.push([rx - k, ry + Math.round(droop + wave)]);
    }
    const thick = (k: number) => (k < L * 0.45 ? 3 : k < L - 3 ? 2 : 1);
    for (let k = 0; k < L; k++) span(pts[k][0], pts[k][1] - 1, pts[k][1] + thick(k), C.out);
    for (let k = 0; k < L; k++) {
      const [x, y] = pts[k];
      const t = thick(k);
      for (let d = 0; d < t; d++) {
        let col = C.tongue;
        if (d === 0 && k % 2 === 0) col = C.tongueHi;
        if (d === t - 1 && t > 1) col = C.tongueSh;
        pt(x, y + d, col);
      }
    }
    tip = [pts[L - 1][0] - 1, pts[L - 1][1] + 2];
  }
  if (st.flash) {
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = 'rgba(255,255,255,0.72)';
    g.fillRect(0, 0, OW, OH);
    g.globalCompositeOperation = 'source-over';
  }
  // onto the map, flipped when it faces right
  const k = z * BOSS_SCALE;
  c.save();
  if (alpha < 1) c.globalAlpha = Math.max(0, alpha);
  c.imageSmoothingEnabled = false;
  c.translate(Math.round(X), Math.round(Y));
  if (st.facing > 0) c.scale(-1, 1);
  c.drawImage(off, Math.round(-(OX + BOSS_SPR.ax) * k), Math.round(-(OY + BOSS_SPR.ay) * k), Math.round(OW * k), Math.round(OH * k));
  c.restore();
  // tips back in map px from the feet
  const toMap = (x: number, y: number): [number, number] => [(x - OX - BOSS_SPR.ax) * BOSS_SCALE * (st.facing > 0 ? -1 : 1), (y - OY - BOSS_SPR.ay) * BOSS_SCALE];
  const ca = Math.cos(P.ang);
  const sa = Math.sin(P.ang);
  const wf: [number, number] = [sx + px + WEAPON_FOOT[0] * ca - WEAPON_FOOT[1] * sa, sy + py + P.breathe + WEAPON_FOOT[0] * sa + WEAPON_FOOT[1] * ca];
  return { tongue: toMap(tip[0], tip[1]), weapon: toMap(wf[0], wf[1]), face: toMap(sx + BOSS_SPR.face[0] - 8, sy + BOSS_SPR.face[1] + 4) };
}
