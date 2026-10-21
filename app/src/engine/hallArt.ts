/**
 * The arena hall, painted in code: a gothic hall seen from the side. A dark stone wall with tall arched
 * windows glowing red, pillars between them, a balcony along the top where the crowd stands, three
 * stone ledges to jump onto, and a cold stone floor.
 *
 * Painted once into a canvas at map size and scaled up with the map; the crowd, the torches and the
 * light move each frame (arenaArt.ts draws those). Pure: it only needs the map data and canvas helpers.
 */
import { ctx2d, makeCanvas } from './art';
import { AH, AW, BALCONY, GROUND, LEDGES, WALL_L, WALL_R } from '../game/arenaMap';
import type { Fan } from './arenaArt';

function hash2(x: number, y: number, s = 0): number {
  let n = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 982451653)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function rng(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** the window centres along the wall, and the pillars between them */
export const WINDOWS = [60, 180, 300, 420];
export const COLUMNS = [0, 120, 240, 360, 480];
/** torches on the pillars, where the flames sit (map px) */
export const HALL_TORCHES: [number, number][] = [
  [120, 104],
  [240, 92],
  [360, 104],
];

export function paintHall(): HTMLCanvasElement {
  const cv = makeCanvas(AW, AH);
  const g = ctx2d(cv);
  g.imageSmoothingEnabled = false;
  const px = (x: number, y: number, w: number, h: number, col: string) => {
    g.fillStyle = col;
    g.fillRect(x, y, w, h);
  };
  // the wall: dark stone, brighter low down where the windows light it
  for (let y = 0; y < GROUND; y++) {
    const k = y / GROUND;
    const r = Math.round(16 + 12 * k);
    const gg = Math.round(11 + 7 * k);
    const b = Math.round(22 + 10 * k);
    px(0, y, AW, 1, `rgb(${r},${gg},${b})`);
  }
  // stone courses with staggered joints, and a little grain
  for (let y = 68; y < GROUND; y += 10) {
    px(0, y, AW, 1, '#140d1a');
    const off = (y / 10) % 2 ? 0 : 9;
    for (let x = off; x < AW; x += 18) px(x, y + 1, 1, 9, '#140d1a');
  }
  for (let y = 66; y < GROUND; y++)
    for (let x = 0; x < AW; x++) {
      const n = hash2(x, y, 3);
      if (n > 0.965) px(x, y, 1, 1, 'rgba(255,255,255,0.05)');
      else if (n < 0.03) px(x, y, 1, 1, 'rgba(0,0,0,0.18)');
    }
  // tall gothic windows, glowing red, with dark tracery
  for (const cx of WINDOWS) {
    const w = 34;
    const top = 80;
    const bot = 176;
    // a soft red spill round each window
    for (let r = 26; r > 0; r -= 2) {
      g.fillStyle = `rgba(170,20,32,${0.012 * (26 - r)})`;
      g.beginPath();
      g.ellipse(cx, (top + bot) / 2, w / 2 + r, (bot - top) / 2 + r, 0, 0, Math.PI * 2);
      g.fill();
    }
    const arch = (inset: number, col: string) => {
      const x0 = cx - w / 2 + inset;
      const x1 = cx + w / 2 - inset;
      const hw = (x1 - x0) / 2;
      for (let x = x0; x <= x1; x++) {
        // a pointed arch: two circles meeting at the top
        const d = Math.abs(x - cx);
        const rr = hw * 1.6;
        const yTop = top + inset + (hw * 1.6 - Math.sqrt(Math.max(0, rr * rr - (rr - (hw - d)) ** 2)));
        px(x, Math.round(yTop), 1, bot - inset - Math.round(yTop), col);
      }
    };
    arch(0, '#2a0c12');
    arch(3, '#6a0e18');
    arch(5, '#a8182a');
    // glass panes, lighter in the middle
    for (let y = top + 10; y < bot - 6; y += 2)
      for (let x = cx - 10; x <= cx + 10; x++) if (hash2(x, y, 9) > 0.86) px(x, y, 1, 1, 'rgba(255,90,80,0.35)');
    // tracery: a mullion, a transom and a rose
    px(cx, top + 6, 1, bot - top - 9, '#2a0810');
    px(cx - 12, top + 54, 25, 1, '#2a0810');
    g.strokeStyle = '#2a0810';
    g.lineWidth = 1;
    g.beginPath();
    g.arc(cx + 0.5, top + 26.5, 6, 0, Math.PI * 2);
    g.stroke();
    // the sill
    px(cx - w / 2 - 3, bot, w + 6, 3, '#3a2c40');
    px(cx - w / 2 - 3, bot, w + 6, 1, '#5a4a62');
  }
  // pillars between the windows, with capitals and bases
  for (const x of COLUMNS) {
    const x0 = x - 7;
    px(x0, 60, 14, GROUND - 60, '#24182c');
    px(x0 + 2, 60, 2, GROUND - 60, '#3a2c46');
    px(x0 + 11, 60, 2, GROUND - 60, '#160e1c');
    px(x0 - 3, 64, 20, 5, '#30223a');
    px(x0 - 3, 64, 20, 1, '#4a3a56');
    px(x0 - 3, GROUND - 8, 20, 8, '#30223a');
    px(x0 - 3, GROUND - 8, 20, 1, '#4a3a56');
  }
  // the balcony: a dark gallery behind, a stone rail in front of the crowd
  px(0, 0, AW, 44, '#0e0912');
  for (let x = 6; x < AW; x += 24) {
    // little arches in the gallery's back wall
    px(x, 12, 14, 30, '#140c1a');
    px(x + 2, 14, 10, 28, '#1a1020');
  }
  px(0, BALCONY.y, AW, 4, '#3c2e46');
  px(0, BALCONY.y, AW, 1, '#5e4c6a');
  px(0, BALCONY.y + 4, AW, 8, '#251a2e');
  for (let x = 2; x < AW; x += 8) px(x, BALCONY.y + 4, 3, 8, '#3a2c44');
  px(0, BALCONY.y + 12, AW, 2, '#120a16');
  // banners hanging from the balcony
  const R = rng(41);
  for (const cx of [30, 150, 270, 390, 450]) {
    const col = R() < 0.5 ? '#7a1420' : '#3a1450';
    const len = 22 + Math.floor(R() * 8);
    px(cx - 5, BALCONY.y + 14, 10, len, col);
    px(cx - 5, BALCONY.y + 14, 1, len, 'rgba(255,255,255,0.12)');
    for (let k = 0; k < 5; k++) px(cx - 5 + k * 2, BALCONY.y + 14 + len, 1, 2 - (k % 2), col);
    px(cx - 2, BALCONY.y + 20, 4, 4, '#c8a040');
  }
  // the side walls
  px(0, 0, WALL_L, AH, '#0a0610');
  px(WALL_R, 0, AW - WALL_R, AH, '#0a0610');
  px(WALL_L - 1, 0, 1, AH, '#2a1e32');
  px(WALL_R, 0, 1, AH, '#2a1e32');
  // the floor: big worn flagstones, lit at the edge
  px(0, GROUND, AW, AH - GROUND, '#1c1422');
  px(0, GROUND, AW, 1, '#5a4862');
  px(0, GROUND + 1, AW, 1, '#3a2c44');
  for (let x = 0; x < AW; x += 26) px(x + ((x / 26) % 2 ? 6 : 0), GROUND + 2, 1, AH - GROUND - 2, '#120c16');
  px(0, GROUND + 11, AW, 1, '#120c16');
  for (let y = GROUND + 2; y < AH; y++)
    for (let x = 0; x < AW; x++) if (hash2(x, y, 7) > 0.97) px(x, y, 1, 1, 'rgba(255,255,255,0.06)');
  // the ledges: thick stone slabs on corbels
  for (const l of LEDGES) {
    const w = l.x1 - l.x0;
    px(l.x0 - 2, l.y, w + 4, 6, '#3e3048');
    px(l.x0 - 2, l.y, w + 4, 1, '#6a5874');
    px(l.x0 - 2, l.y + 5, w + 4, 1, '#160e1a');
    for (let x = l.x0 + 6; x < l.x1 - 2; x += 14) px(x, l.y + 1, 1, 4, '#2a2032');
    for (const cx of [l.x0 + 8, l.x1 - 8]) {
      px(cx - 4, l.y + 6, 8, 3, '#30243a');
      px(cx - 3, l.y + 9, 6, 3, '#281e30');
      px(cx - 2, l.y + 12, 4, 3, '#221a2a');
    }
    // a shadow on the wall under it
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.fillRect(l.x0, l.y + 6, w, 8);
  }
  return cv;
}

/** The crowd on the balcony: rows behind the rail. */
export function makeHallCrowd(): Fan[] {
  const R = rng(77);
  const skins = ['#f2c99a', '#d8a070', '#a86a40', '#7a4a2a', '#ffd8b8'];
  const hairs = ['#2a1a10', '#6a3a1a', '#d8b040', '#1a1a2a', '#c0c0c8', '#a83a1a'];
  const shirts = ['#d04a3a', '#2f5fd0', '#3aa05a', '#9a4ad0', '#e08a1e', '#2aa0b0', '#c0c040', '#d06aa0', '#f2f5ff', '#3a3a4a'];
  const out: Fan[] = [];
  for (let r = 0; r < 2; r++)
    for (let x = WALL_L + 6; x < WALL_R - 4; x += 7 + Math.floor(R() * 5)) {
      if (R() < 0.18) continue;
      out.push({ x, y: BALCONY.y - 4 + r * 4, skin: skins[Math.floor(R() * skins.length)], hair: hairs[Math.floor(R() * hairs.length)], shirt: shirts[Math.floor(R() * shirts.length)], ph: Math.floor(R() * 100), flag: R() < 0.08 });
    }
  return out;
}
