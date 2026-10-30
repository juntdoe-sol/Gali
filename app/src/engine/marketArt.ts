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
import { ctx2d, makeCanvas, text, textWidth, type Ctx } from './art';
import type { Look } from './types';
import { COLOSSEUM_MARK, COLOSSEUM_WORD, ORE_MARK, ORE_WORD, SEEKER_MARK_S, SEEKER_WORD, drawBits } from './logos';

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

/** The vending machine's screen: a miner trying on looks, a new one every 1.6 s. */
function paintVendScreen(now: number) {
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
  return { cv, k };
}

/** The vending machine, feet on (X, Y), `z` screen px per art px. */
export function drawVending(c: Ctx, X: number, Y: number, z: number, now: number, lights: Light[], dpr: number) {
  vendBody ??= paintVending();
  const x0 = Math.round((X - (VEND_W / 2) * z) * dpr) / dpr;
  const y0 = Math.round((Y - VEND_H * z) * dpr) / dpr;
  c.drawImage(vendBody, 0, 0, VEND_W, VEND_H, x0, y0, VEND_W * z, VEND_H * z);
  const { cv, k } = paintVendScreen(now);
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
  // the gear vending machine from the market, glowing, with GEAR MARKET beside it
  const grad = g.createLinearGradient(0, 0, 0, LED.h);
  grad.addColorStop(0, '#2a1650');
  grad.addColorStop(1, '#3a0f2e');
  g.fillStyle = grad;
  g.fillRect(0, 0, LED.w, LED.h);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + now / 1800;
    g.strokeStyle = i % 2 ? 'rgba(255,207,74,0.14)' : 'rgba(184,107,255,0.14)';
    g.beginPath();
    g.moveTo(28, 30);
    g.lineTo(28 + Math.cos(a) * 120, 30 + Math.sin(a) * 120);
    g.stroke();
  }
  vendBody ??= paintVending();
  const { cv } = paintVendScreen(now);
  const vx = 4;
  const vy = LED.h - VEND_H + 2;
  g.drawImage(vendBody, vx, vy);
  g.drawImage(cv, vx + SCR.x, vy + SCR.y);
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.fillRect(vx + SCR.x + 2, vy + SCR.y + 1, 2, SCR.h - 6);
  // sparkles round the machine
  for (let i = 0; i < 5; i++) {
    const ph = (now / 500 + i * 1.3) % 3;
    if (ph > 1) continue;
    g.fillStyle = '#fff1a8';
    const x = vx + ((i * 17) % 48), y = vy + 6 + ((i * 23) % 40);
    g.fillRect(x, y - 1, 1, 3);
    g.fillRect(x - 1, y, 3, 1);
  }
  const pop = Math.min(1, t * 6);
  const R = 54; // the right-hand column
  const cx = R + (LED.w - R) / 2;
  const mid = (str: string, y: number, sc: number, col: string, sh?: string) => text(g, str, Math.round(cx - (textWidth(str) * sc) / 2), y, sc, col, sh);
  mid('GEAR', Math.round(3 - (1 - pop) * 20), 2, '#ffcf4a', '#7a3a00');
  mid('MARKET', Math.round(15 - (1 - pop) * 20), 2, '#ffcf4a', '#7a3a00');
  mid('555 ITEMS', 28, 1, '#ffffff', '#3a2462');
  if (Math.floor(now / 450) % 2 || t > 0.6) mid('IN GALI TOWN', 36, 1, '#3ee6ff');
  // ticker under the text
  g.fillStyle = '#120a22';
  g.fillRect(R, LED.h - 12, LED.w - R, 11);
  g.fillStyle = '#ffcf4a';
  g.fillRect(R, LED.h - 12, LED.w - R, 1);
  g.save();
  g.beginPath();
  g.rect(R, LED.h - 12, LED.w - R, 11);
  g.clip();
  const tick = 'HEAD  -  CLOTHES  -  SHOES  -  AXES  -  PETS  -  ';
  const tw = textWidth(tick);
  const off = (now / 30) % tw;
  for (let x = R - off; x < LED.w; x += tw) text(g, tick, Math.round(x), LED.h - 9, 1, '#ffe14a', '#000000');
  g.restore();
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

function slideColosseum(g: Ctx, now: number, t: number) {
  // Colosseum: its pillar mark and wordmark in white on a dark violet night, with light beams rising behind the pillar
  g.fillStyle = '#1b1426';
  g.fillRect(0, 0, LED.w, LED.h);
  const glow = g.createRadialGradient(18, LED.h, 2, 18, LED.h, 60);
  glow.addColorStop(0, 'rgba(160,90,255,0.55)');
  glow.addColorStop(1, 'rgba(160,90,255,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, LED.w, LED.h);
  // the big pale blocks of the poster, top right
  g.fillStyle = 'rgba(90,60,110,0.35)';
  g.fillRect(70, 0, 62, 6);
  g.fillRect(84, LED.h - 20, 40, 20);
  const mw = COLOSSEUM_MARK[0].length, ww = COLOSSEUM_WORD[0].length, gap = 5;
  const x0 = Math.round((LED.w - (mw + gap + ww)) / 2);
  const pop = Math.min(1, t * 6);
  const y0 = Math.round(9 - (1 - pop) * 24);
  // beams up through the pillars, pulsing
  const k = 0.35 + 0.25 * Math.sin(now / 300);
  g.fillStyle = `rgba(190,140,255,${k})`;
  for (const dx of [4, 9, 14]) g.fillRect(x0 + dx, 0, 3, LED.h);
  drawBits(g, COLOSSEUM_MARK, x0, y0, '#ffffff');
  drawBits(g, COLOSSEUM_WORD, x0 + mw + gap, y0 + Math.round((COLOSSEUM_MARK.length - COLOSSEUM_WORD.length) / 2), '#ffffff');
  if (Math.floor(now / 450) % 2 || t > 0.6) midText(g, 'ENTER THE ARENA', 33, 1, '#d8b4ff');
  // ticker
  g.fillStyle = '#0a0612';
  g.fillRect(0, LED.h - 12, LED.w, 11);
  g.fillStyle = '#a066ff';
  g.fillRect(0, LED.h - 12, LED.w, 1);
  const tick = "CRYPTO WORLD'S FAIR  -  BUILD YOUR CRYPTO STARTUP  -  WIN AND JOIN THE ACCELERATOR  -  ";
  const tw = textWidth(tick);
  const off = (now / 30) % tw;
  for (let x = -off; x < LED.w; x += tw) text(g, tick, Math.round(x), LED.h - 9, 1, '#ffffff', '#000000');
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
  g.fillStyle = '#04121c';
  g.fillRect(0, LED.h - 12, LED.w, 11);
  g.fillStyle = '#3ee6ff';
  g.fillRect(0, LED.h - 12, LED.w, 1);
  mid('CONTACT @SMSONX ON X', LED.h - 9, 1, '#ffe14a', '#000000');
}

const midText = (g: Ctx, str: string, y: number, sc: number, col: string, sh?: string) => text(g, str, Math.round(LED.w / 2 - (textWidth(str) * sc) / 2), y, sc, col, sh);

function slideOre(g: Ctx, now: number, t: number) {
  // ORE's own mark and wordmark, white on black, with a few gold sparks
  g.fillStyle = '#07070d';
  g.fillRect(0, 0, LED.w, LED.h);
  for (let i = 0; i < 8; i++) {
    const x = (i * 37 + 9) % LED.w;
    const y = ((now / 22 + i * 29) % (LED.h + 8)) - 4;
    g.fillStyle = i % 2 ? 'rgba(214,150,40,0.7)' : 'rgba(255,233,160,0.5)';
    g.fillRect(x, Math.round(y), 1, 2);
  }
  midText(g, 'POWERED BY', 3, 1, '#8a93a8');
  const pop = Math.min(1, t * 6);
  const mw = ORE_MARK[0].length, ww = ORE_WORD[0].length, gap = 7;
  const x0 = Math.round((LED.w - (mw + gap + ww)) / 2);
  const y0 = Math.round(11 - (1 - pop) * 24);
  drawBits(g, ORE_MARK, x0, y0, '#ffffff');
  drawBits(g, ORE_WORD, x0 + mw + gap, y0 + Math.round((ORE_MARK.length - ORE_WORD.length) / 2), '#ffffff');
  g.fillStyle = '#000000';
  g.fillRect(0, LED.h - 12, LED.w, 11);
  g.fillStyle = '#ffcf4a';
  g.fillRect(0, LED.h - 12, LED.w, 1);
  midText(g, 'A NEW ORE ROUND EVERY MINUTE', LED.h - 9, 1, '#ffffff', '#000000');
}

function slideSeeker(g: Ctx, now: number, t: number) {
  // the Seeker wordmark and SOLANA (S) MOBILE lockup, white on black, beside a phone showing the island
  g.fillStyle = '#050508';
  g.fillRect(0, 0, LED.w, LED.h);
  const bob = Math.round(Math.sin(now / 500) * 1.5);
  const px = 8, py = 5 + bob, pw = 24, ph = 40;
  g.fillStyle = '#2a2a36';
  g.fillRect(px + 1, py, pw - 2, ph);
  g.fillRect(px, py + 1, pw, ph - 2);
  g.fillStyle = '#0a0a12';
  g.fillRect(px + 2, py + 2, pw - 4, ph - 4);
  // its screen: sea, island, sun
  g.fillStyle = '#123a6b';
  g.fillRect(px + 3, py + 5, pw - 6, ph - 10);
  g.fillStyle = '#e6d29a';
  g.fillRect(px + 6, py + 24, 12, 4);
  g.fillStyle = '#5f9d41';
  g.fillRect(px + 8, py + 20, 8, 5);
  g.fillStyle = '#ffcf4a';
  g.fillRect(px + 15, py + 9, 3, 3);
  if (Math.floor(now / 300) % 2) {
    g.fillStyle = '#ffffff';
    g.fillRect(px + 11, py + 16, 2, 2);
  }
  const R = 38;
  const cx = R + (LED.w - R) / 2;
  const pop = Math.min(1, t * 6);
  const sw = SEEKER_WORD[0].length;
  drawBits(g, SEEKER_WORD, Math.round(cx - sw / 2), Math.round(7 - (1 - pop) * 24), '#ffffff');
  // SOLANA (S) MOBILE
  const a = 'SOLANA', b = 'MOBILE';
  const mk = SEEKER_MARK_S[0].length;
  const lw = textWidth(a) + 4 + mk + 4 + textWidth(b);
  let lx = Math.round(cx - lw / 2);
  const ly = 25;
  text(g, a, lx, ly + 2, 1, '#ffffff');
  lx += textWidth(a) + 4;
  drawBits(g, SEEKER_MARK_S, lx, ly, '#ffffff');
  lx += mk + 4;
  text(g, b, lx, ly + 2, 1, '#ffffff');
  const bar = g.createLinearGradient(R, 0, LED.w, 0);
  bar.addColorStop(0, '#9945ff');
  bar.addColorStop(1, '#14f195');
  g.fillStyle = '#000000';
  g.fillRect(R, LED.h - 12, LED.w - R, 11);
  g.fillStyle = bar;
  g.fillRect(R, LED.h - 12, LED.w - R, 1);
  const m = 'PLAY GALI ON YOUR SEEKER';
  text(g, m, Math.round(cx - textWidth(m) / 2), LED.h - 9, 1, '#14f195', '#000000');
}

function slideSuperteam(g: Ctx, now: number, t: number) {
  // Superteam: a purple night, a glowing pit on the horizon and a lone builder looking in
  const grad = g.createLinearGradient(0, 0, 0, LED.h);
  grad.addColorStop(0, '#120a3a');
  grad.addColorStop(0.6, '#4b1fb0');
  grad.addColorStop(1, '#2a1880');
  g.fillStyle = grad;
  g.fillRect(0, 0, LED.w, LED.h);
  for (let i = 0; i < 18; i++) {
    if ((Math.floor(now / 400) + i) % 5 === 0) continue;
    g.fillStyle = '#ffffff';
    g.fillRect((i * 47 + 3) % LED.w, (i * 13 + 2) % 26, 1, 1);
  }
  // the floor grid
  g.fillStyle = 'rgba(10,6,40,0.55)';
  for (let x = -60; x < LED.w + 60; x += 14) {
    for (let y = 36; y < LED.h; y++) g.fillRect(Math.round(LED.w / 2 + (x - LED.w / 2) * (1 + (y - 36) / 14)), y, 1, 1);
  }
  for (const y of [40, 46, 54]) g.fillRect(0, y, LED.w, 1);
  // the glow
  const gl = g.createRadialGradient(LED.w / 2, 40, 2, LED.w / 2, 40, 46);
  gl.addColorStop(0, 'rgba(255,170,60,0.95)');
  gl.addColorStop(0.5, 'rgba(232,90,140,0.55)');
  gl.addColorStop(1, 'rgba(120,50,220,0)');
  g.fillStyle = gl;
  g.beginPath();
  g.ellipse(LED.w / 2, 40, 46, 9, 0, 0, Math.PI * 2);
  g.fill();
  // the builder
  const fx = LED.w / 2 + 16;
  g.fillStyle = '#0a0614';
  g.fillRect(fx, 33, 2, 2);
  g.fillRect(fx - 1, 35, 4, 4);
  g.fillRect(fx - 1, 39, 1, 3);
  g.fillRect(fx + 2, 39, 1, 3);
  const pop = Math.min(1, t * 6);
  midText(g, 'SUPERTEAM', Math.round(6 - (1 - pop) * 20), 3, '#ffffff', '#2a0f6a');
  midText(g, 'WHERE SOLANA BUILDERS MEET', 23, 1, '#ffd9a0');
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
  const slide = Math.floor(now / SLIDE_MS) % 8;
  const t = (now % SLIDE_MS) / SLIDE_MS;
  if (slide === 0) slideMarket(g, now, t);
  else if (slide === 1) slideParade(g, now);
  else if (slide === 2) slideFounders(g, now, t);
  else if (slide === 3) slideColosseum(g, now, t);
  else if (slide === 4) slideOre(g, now, t);
  else if (slide === 5) slideSeeker(g, now, t);
  else if (slide === 6) slideSuperteam(g, now, t);
  else slideAdvertise(g, now, t);
  // a quick wipe between slides
  if (t < 0.05) {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, Math.round((t / 0.05) * LED.w), LED.h);
  }
  led(g, LED.w, LED.h);
  c.drawImage(cv, 0, 0, LED.w, LED.h, x0 + LED.x * z, y0 + LED.y * z, LED.w * z, LED.h * z);
  // the screen lights the clearing
  const col = ['#ffcf4a', '#ff4fd8', '#ffb020', '#a066ff', '#ffcf4a', '#9945ff', '#ff9a3c', '#3ee6ff'][slide];
  lights.push({ x: X * dpr, y: (Y - 60 * z) * dpr, r: 120 * z * dpr, c: col, k: 0.8 });
}
