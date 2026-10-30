/**
 * The lobby's market pieces, painted in code:
 *  - the gear vending machine in front of the market hall: a tall glowing cabinet whose screen shows a miner
 *    trying on gear, one look after another, with a NEW tag and price-free "SOON" ticker
 *  - the big digital signboard behind the flags: an LED screen on two steel posts that cycles slides
 *    (GEAR MARKET, a dancing line-up of miners in gear, FOUNDING MINERS, ORE ISLAND)
 *
 * Bodies are drawn once into canvases; screens are drawn each frame into small 1x canvases, given an LED grid,
 * and scaled up with the map. Pure canvas: it only needs the atlas helpers and the miner composer.
 */
import { minerFrame } from './actors';
import { ctx2d, makeCanvas, sprite, rect, text, textWidth, type Ctx } from './art';
import type { Look } from './types';

type Light = { x: number; y: number; r: number; c: string; k: number };
type Px = (x: number, y: number, w: number, h: number, col: string) => void;
const painter = (g: Ctx): Px => (x, y, w, h, col) => {
  g.fillStyle = col;
  g.fillRect(x, y, w, h);
};

/** Looks the screens dress miners in: the hats and colours already in the atlas. */
const LOOKS: Look[] = [
  { hat: 'hat-crown', fit: '#b81d34', pick: '#ffcf3d', handle: '#6b4228', pet: null, glow: 'legendary' },
  { hat: 'hat-astro', fit: '#2f5fd0', pick: '#7ad7ff', handle: '#4a4a5a', pet: null, glow: 'epic' },
  { hat: 'hat-songkok', fit: '#1d1b2e', pick: '#f2b632', handle: '#6b4228', pet: null, glow: 'rare' },
  { hat: 'hat-red', fit: '#e8eef5', pick: '#c9c9c9', handle: '#6b4228', pet: null, glow: 'none', sex: 'f' },
  { hat: 'hat-teal', fit: '#ff7a1a', pick: '#3de0c8', handle: '#4a4a5a', pet: null, glow: 'rare' },
  { hat: 'hat-yellow', fit: '#4f6b3a', pick: '#c9c9c9', handle: '#6b4228', pet: null, glow: 'none' },
];
const RAR = ['#ffb020', '#b86bff', '#4fc8ff', '#6ad46f', '#4fc8ff', '#b8b0c8'];
const RAR_NAME = ['LEGENDARY', 'RARE', 'RARE', 'UNCOMMON', 'RARE', 'COMMON'];

/** An LED look: every other row and column a little darker. */
function led(g: Ctx, w: number, h: number) {
  g.fillStyle = 'rgba(0,0,0,0.28)';
  for (let y = 1; y < h; y += 2) g.fillRect(0, y, w, 1);
  g.fillStyle = 'rgba(0,0,0,0.14)';
  for (let x = 1; x < w; x += 2) g.fillRect(x, 0, 1, h);
}

function blitMiner(g: Ctx, look: Look, pose: 'idle' | 'cheer' | 'dance1' | 'dance2' | 'dance3', f: number, x: number, y: number) {
  const cv = minerFrame(look, pose, f);
  // composed frame: 10px side pad, 12px top pad, feet on row 12 + 25
  g.drawImage(cv, Math.round(x - cv.width / 2), Math.round(y - (12 + 25)));
}

/* ------------------------------------------------------------------ vending machine */
export const VEND_W = 48;
export const VEND_H = 64;
const SCR = { x: 6, y: 13, w: 26, h: 30 };
let vendBody: HTMLCanvasElement | null = null;
const vendScreen = makeCanvasLazy(SCR.w, SCR.h);

function makeCanvasLazy(w: number, h: number) {
  let cv: HTMLCanvasElement | null = null;
  return () => (cv ??= makeCanvas(w, h));
}

function paintVending(): HTMLCanvasElement {
  const cv = makeCanvas(VEND_W, VEND_H);
  const g = ctx2d(cv);
  const P = painter(g);
  const ink = '#140c22';
  // shadow and feet
  P(4, 61, 40, 3, 'rgba(0,0,0,0.25)');
  P(6, 58, 5, 4, ink);
  P(37, 58, 5, 4, ink);
  // cabinet
  P(2, 4, 44, 56, ink);
  P(3, 5, 42, 54, '#4b2f7a');
  P(3, 5, 42, 2, '#7a55b8'); // lit top edge
  P(3, 5, 2, 54, '#6a47a6'); // lit left edge
  P(43, 5, 2, 54, '#2e1c50'); // shade right
  P(3, 57, 42, 2, '#2e1c50');
  // marquee across the top
  P(5, 7, 38, 5, '#1a0f2e');
  text(g, 'GEAR', 12, 7, 1, '#ffcf4a');
  P(36, 8, 2, 2, '#3ee6ff');
  P(39, 8, 2, 2, '#ff4fd8');
  // screen bezel
  P(SCR.x - 2, SCR.y - 2, SCR.w + 4, SCR.h + 4, ink);
  P(SCR.x - 1, SCR.y - 1, SCR.w + 2, SCR.h + 2, '#2a1a44');
  // side panel: keypad, coin slot, a card reader
  P(34, 14, 9, 30, '#3a2462');
  P(35, 15, 7, 6, '#0d1a12');
  text(g, '555', 35, 16, 1, '#6af08a');
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) P(35 + c * 2 + (c ? c - 0 : 0), 23 + r * 3, 2, 2, r === 2 && c === 2 ? '#ff4d5e' : '#cfc6e0');
  P(36, 34, 5, 1, '#0a0614'); // coin slot
  P(35, 33, 7, 3, '#8f7a9e');
  P(36, 34, 5, 1, '#0a0614');
  P(35, 38, 7, 4, '#1a0f2e'); // card reader
  P(36, 39, 5, 1, '#3ee6ff');
  // dispenser flap
  P(6, 47, 28, 9, ink);
  P(7, 48, 26, 7, '#1a0f2e');
  P(7, 48, 26, 2, '#2a1a44');
  P(16, 51, 8, 2, '#8f7a9e');
  // sticker: a gold star
  P(37, 48, 5, 5, '#ffcf4a');
  P(38, 49, 3, 3, '#ffe9a0');
  return cv;
}

/** The vending machine, feet on (X, Y), `z` screen px per art px. */
export function drawVending(c: Ctx, X: number, Y: number, z: number, now: number, lights: Light[], dpr: number) {
  vendBody ??= paintVending();
  const x0 = Math.round((X - (VEND_W / 2) * z) * dpr) / dpr;
  const y0 = Math.round((Y - VEND_H * z) * dpr) / dpr;
  c.drawImage(vendBody, 0, 0, VEND_W, VEND_H, x0, y0, VEND_W * z, VEND_H * z);
  // the screen: a miner trying on looks, a new one every 1.6 s
  const k = Math.floor(now / 1600) % LOOKS.length;
  const t = (now % 1600) / 1600;
  const cv = vendScreen();
  const g = ctx2d(cv);
  g.clearRect(0, 0, SCR.w, SCR.h);
  const grad = g.createLinearGradient(0, 0, 0, SCR.h);
  grad.addColorStop(0, '#2a1650');
  grad.addColorStop(1, '#0c1838');
  g.fillStyle = grad;
  g.fillRect(0, 0, SCR.w, SCR.h);
  // a spotlight in the item's rarity colour
  g.globalAlpha = 0.35;
  g.fillStyle = RAR[k];
  g.beginPath();
  g.ellipse(SCR.w / 2, SCR.h - 6, 10, 3, 0, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
  const pose = t < 0.55 ? 'idle' : 'cheer';
  const f = pose === 'idle' ? Math.floor(now / 180) % 4 : Math.min(3, Math.floor((t - 0.55) / 0.1));
  blitMiner(g, LOOKS[k], pose, f, SCR.w / 2, SCR.h - 6);
  // swipe-in flash on each change
  if (t < 0.08) {
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.fillRect(0, 0, SCR.w, SCR.h);
  }
  // NEW tag, blinking
  if (Math.floor(now / 400) % 2) {
    g.fillStyle = '#ff4d5e';
    g.fillRect(0, 0, 13, 7);
    text(g, 'NEW', 1, 1, 1, '#ffffff');
  }
  // rarity strip at the bottom
  g.fillStyle = 'rgba(4,6,15,0.75)';
  g.fillRect(0, SCR.h - 5, SCR.w, 5);
  const nm = RAR_NAME[k];
  const scrollX = SCR.w - ((now / 40) % (textWidth(nm) + SCR.w));
  text(g, nm, Math.round(scrollX), SCR.h - 5, 1, RAR[k]);
  led(g, SCR.w, SCR.h);
  c.drawImage(cv, 0, 0, SCR.w, SCR.h, x0 + SCR.x * z, y0 + SCR.y * z, SCR.w * z, SCR.h * z);
  // glass glint
  c.fillStyle = 'rgba(255,255,255,0.12)';
  c.fillRect(x0 + (SCR.x + 2) * z, y0 + (SCR.y + 1) * z, 2 * z, (SCR.h - 6) * z);
  lights.push({ x: X * dpr, y: (Y - 34 * z) * dpr, r: 70 * z * dpr, c: RAR[k], k: 0.75 + 0.25 * Math.sin(now / 250) });
}

/* ------------------------------------------------------------------ billboard */
export const BB_W = 148;
export const BB_H = 96;
const LED = { x: 8, y: 8, w: 132, h: 56 };
let bbBody: HTMLCanvasElement | null = null;
const bbScreen = makeCanvasLazy(LED.w, LED.h);

function paintBillboard(): HTMLCanvasElement {
  const cv = makeCanvas(BB_W, BB_H);
  const g = ctx2d(cv);
  const P = painter(g);
  const ink = '#140c22';
  // posts with braces
  for (const px of [22, BB_W - 30]) {
    P(px, 60, 8, 36, ink);
    P(px + 1, 60, 6, 36, '#6f6a78');
    P(px + 1, 60, 2, 36, '#a59fb0');
    P(px + 5, 60, 2, 36, '#4a4552');
    for (let y = 66; y < 92; y += 8) P(px + 1, y, 6, 1, '#4a4552');
    P(px - 2, 92, 12, 4, '#4a4552');
  }
  P(18, 94, BB_W - 36, 2, 'rgba(0,0,0,0.25)');
  // frame
  P(2, 2, BB_W - 4, 66, ink);
  P(3, 3, BB_W - 6, 64, '#2b2240');
  P(3, 3, BB_W - 6, 2, '#5a4a7a');
  P(5, 5, BB_W - 10, 60, '#0a0614');
  // rivets and the little lamps along the top
  for (let x = 8; x < BB_W - 8; x += 12) P(x, 2, 2, 1, '#ffcf4a');
  for (const [x, y] of [[4, 4], [BB_W - 6, 4], [4, 64], [BB_W - 6, 64]]) P(x, y, 2, 2, '#8f7a9e');
  // a nameplate under the screen
  P(BB_W / 2 - 22, 66, 44, 7, ink);
  P(BB_W / 2 - 21, 67, 42, 5, '#3a2462');
  text(g, 'GALI TOWN', Math.round(BB_W / 2 - textWidth('GALI TOWN') / 2), 67, 1, '#ffcf4a');
  return cv;
}

const SLIDE_MS = 5200;

function slideMarket(g: Ctx, now: number, t: number) {
  // GEAR MARKET in big gold letters, a gem burst and a scrolling ticker
  const grad = g.createLinearGradient(0, 0, 0, LED.h);
  grad.addColorStop(0, '#2a1650');
  grad.addColorStop(1, '#3a0f2e');
  g.fillStyle = grad;
  g.fillRect(0, 0, LED.w, LED.h);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + now / 1800;
    g.strokeStyle = i % 2 ? 'rgba(255,207,74,0.16)' : 'rgba(184,107,255,0.16)';
    g.beginPath();
    g.moveTo(LED.w / 2, 20);
    g.lineTo(LED.w / 2 + Math.cos(a) * 120, 20 + Math.sin(a) * 120);
    g.stroke();
  }
  const pop = Math.min(1, t * 6);
  const s = 2;
  const w1 = textWidth('GEAR MARKET') * s;
  text(g, 'GEAR MARKET', Math.round(LED.w / 2 - w1 / 2), Math.round(10 - (1 - pop) * 20), s, '#ffcf4a', '#7a3a00');
  const w2 = textWidth('555 ITEMS') * s;
  text(g, '555 ITEMS', Math.round(LED.w / 2 - w2 / 2), 24, s, '#ffffff', '#3a2462');
  // ticker
  g.fillStyle = '#ffcf4a';
  g.fillRect(0, LED.h - 11, LED.w, 9);
  const tick = 'HEAD  -  CLOTHES  -  SHOES  -  AXES  -  PETS  -  COMING SOON  -  ';
  const tw = textWidth(tick);
  const off = (now / 30) % tw;
  for (let x = -off; x < LED.w; x += tw) text(g, tick, Math.round(x), LED.h - 9, 1, '#2a1650');
}

function slideParade(g: Ctx, now: number) {
  // six miners in gear dancing in a line, spotlights sweeping
  g.fillStyle = '#0c1838';
  g.fillRect(0, 0, LED.w, LED.h);
  for (let i = 0; i < 3; i++) {
    const x = LED.w / 2 + Math.sin(now / 700 + i * 2.1) * 55;
    g.globalAlpha = 0.18;
    g.fillStyle = ['#ff4fd8', '#3ee6ff', '#ffcf4a'][i];
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x - 18, LED.h);
    g.lineTo(x + 18, LED.h);
    g.closePath();
    g.fill();
    g.globalAlpha = 1;
  }
  g.fillStyle = '#2a1650';
  g.fillRect(0, LED.h - 8, LED.w, 8);
  const poses = ['dance1', 'dance2', 'dance3'] as const;
  LOOKS.forEach((look, i) => {
    const pose = poses[i % 3];
    const n = pose === 'dance2' ? 4 : 6;
    const f = Math.floor(now / 140 + i) % n;
    blitMiner(g, look, pose, f, 12 + i * 21.5, LED.h - 8);
  });
  const w = textWidth('DRESS YOUR MINER');
  text(g, 'DRESS YOUR MINER', Math.round(LED.w / 2 - w / 2), 2, 1, '#ffffff', '#2a1650');
}

function slideFounders(g: Ctx, now: number, t: number) {
  const grad = g.createLinearGradient(0, 0, LED.w, LED.h);
  grad.addColorStop(0, '#3a2408');
  grad.addColorStop(1, '#1a0f2e');
  g.fillStyle = grad;
  g.fillRect(0, 0, LED.w, LED.h);
  // a crowned miner on a pedestal, coins raining
  g.fillStyle = '#d69628';
  g.fillRect(14, LED.h - 9, 26, 3);
  g.fillStyle = '#6f6a78';
  g.fillRect(17, LED.h - 6, 20, 6);
  blitMiner(g, LOOKS[0], 'cheer', Math.floor(now / 150) % 4, 27, LED.h - 9);
  for (let i = 0; i < 9; i++) {
    const x = (i * 37 + 7) % LED.w;
    const y = ((now / 12 + i * 23) % (LED.h + 10)) - 6;
    g.fillStyle = i % 2 ? '#ffcf4a' : '#ffe9a0';
    g.fillRect(x, Math.round(y), 2, 2);
  }
  text(g, 'FOUNDING', 50, 9, 2, '#ffcf4a', '#7a3a00');
  text(g, 'MINERS', 50, 22, 2, '#ffcf4a', '#7a3a00');
  if (Math.floor(now / 450) % 2 || t > 0.6) text(g, 'CLAIM YOUR CERTIFICATE', 50, 38, 1, '#ffffff');
  text(g, 'BETA MINERS ONLY', 50, 46, 1, '#d29bff');
}

function slideIsland(g: Ctx, now: number) {
  g.fillStyle = '#123a6b';
  g.fillRect(0, 0, LED.w, LED.h);
  // waves
  for (let y = 30; y < LED.h; y += 6)
    for (let x = 0; x < LED.w; x += 10) {
      const o = Math.round(Math.sin(now / 400 + x * 0.3 + y) * 2);
      g.fillStyle = '#2f7fc4';
      g.fillRect(x + o, y, 5, 1);
    }
  // a little island and a pickaxe glint
  g.fillStyle = '#e6d29a';
  g.beginPath();
  g.ellipse(100, 44, 26, 8, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#5f9d41';
  g.beginPath();
  g.ellipse(100, 41, 18, 6, 0, 0, Math.PI * 2);
  g.fill();
  const r = rect('icon-gold');
  const s = sprite('icon-gold');
  if (r && s) g.drawImage(s, 92, 26 + Math.round(Math.sin(now / 300) * 2));
  text(g, 'ORE ISLAND', 6, 8, 2, '#3ee6ff', '#0a1e3a');
  text(g, 'MINE ORE EVERY ROUND', 6, 24, 1, '#ffffff');
  text(g, 'WALK EAST TO THE PIER', 6, 32, 1, '#8fd8ff');
}

function slideAdvertise(g: Ctx, now: number, t: number) {
  // "your ad here": an invitation to put a product on this screen
  const grad = g.createLinearGradient(0, 0, 0, LED.h);
  grad.addColorStop(0, '#0b2a3a');
  grad.addColorStop(1, '#1a0f2e');
  g.fillStyle = grad;
  g.fillRect(0, 0, LED.w, LED.h);
  const mid = (str: string, y: number, sc: number, col: string, sh?: string) => text(g, str, Math.round(LED.w / 2 - (textWidth(str) * sc) / 2), y, sc, col, sh);
  mid('WANNA SEE', 3, 1, '#ffffff');
  const pop = Math.min(1, t * 6);
  mid('YOUR PRODUCT', Math.round(10 - (1 - pop) * 16), 2, '#ffcf4a', '#7a3a00');
  mid('ON THIS SCREEN?', 23, 1, '#ffffff');
  // a dashed frame with marching ants round "YOUR AD HERE"
  const fx = 36, fy = 30, fw = 60, fh = 11;
  const step = Math.floor(now / 120) % 4;
  g.fillStyle = '#3ee6ff';
  for (let x = 0; x < fw; x++) if ((x + step) % 4 < 2) { g.fillRect(fx + x, fy, 1, 1); g.fillRect(fx + fw - 1 - x, fy + fh - 1, 1, 1); }
  for (let y = 0; y < fh; y++) if ((y + step) % 4 < 2) { g.fillRect(fx + fw - 1, fy + y, 1, 1); g.fillRect(fx, fy + fh - 1 - y, 1, 1); }
  if (Math.floor(now / 500) % 2 || t > 0.7) mid('YOUR AD HERE', fy + 3, 1, '#3ee6ff');
  // the contact on a bar along the bottom
  g.fillStyle = '#3ee6ff';
  g.fillRect(0, LED.h - 11, LED.w, 9);
  mid('CONTACT @SMSONX ON X', LED.h - 9, 1, '#0b2a3a');
}

/** The signboard, posts on (X, Y). */
export function drawBillboard(c: Ctx, X: number, Y: number, z: number, now: number, lights: Light[], dpr: number) {
  bbBody ??= paintBillboard();
  const x0 = Math.round((X - (BB_W / 2) * z) * dpr) / dpr;
  const y0 = Math.round((Y - BB_H * z) * dpr) / dpr;
  c.drawImage(bbBody, 0, 0, BB_W, BB_H, x0, y0, BB_W * z, BB_H * z);
  const cv = bbScreen();
  const g = ctx2d(cv);
  g.clearRect(0, 0, LED.w, LED.h);
  const slide = Math.floor(now / SLIDE_MS) % 5;
  const t = (now % SLIDE_MS) / SLIDE_MS;
  if (slide === 0) slideMarket(g, now, t);
  else if (slide === 1) slideParade(g, now);
  else if (slide === 2) slideFounders(g, now, t);
  else if (slide === 3) slideIsland(g, now);
  else slideAdvertise(g, now, t);
  // a quick wipe between slides
  if (t < 0.05) {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, Math.round((t / 0.05) * LED.w), LED.h);
  }
  led(g, LED.w, LED.h);
  c.drawImage(cv, 0, 0, LED.w, LED.h, x0 + LED.x * z, y0 + LED.y * z, LED.w * z, LED.h * z);
  // the screen lights the clearing
  const col = ['#ffcf4a', '#ff4fd8', '#ffb020', '#3ee6ff', '#3ee6ff'][slide];
  lights.push({ x: X * dpr, y: (Y - 60 * z) * dpr, r: 120 * z * dpr, c: col, k: 0.8 });
}
