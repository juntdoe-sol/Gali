/**
 * The Gali Fightclub's three stages, street version (floor plans unchanged: game/brawl2/sim.ts STAGES):
 *   pit      -> THE CAGE      a boxing ring in the back of the warehouse, chain-link, neon and a packed floor
 *   grotto   -> THE ROOFTOP   the warehouse roof at night, a water tank in the middle, the city all round
 *   refinery -> THE CHOP SHOP a garage: a long steel lift runway over the service pit, shelving and hoists above
 * Same Scene shape as fightclubArt.ts: a picture painted once, plus lamps and crowd lights drawn live, plus each
 * stage's own motion (animateStreetScene).
 */
import { ctx2d, makeCanvas, text, textWidth, type Ctx } from './art';
import type { Stage } from '../game/brawl2/sim';
import { WH, WW, WX0, WY0, type Scene } from './fightclubArt';
import { paintGaliLogo, paintOreLogo } from './fightLogos';

type Px = (x: number, y: number, w: number, h: number, col: string) => void;
function canvas(seed0: number) {
  const cv = makeCanvas(WW, WH);
  const g = ctx2d(cv);
  const px: Px = (x, y, w, h, col) => {
    g.fillStyle = col;
    g.fillRect(Math.round(x - WX0), Math.round(y - WY0), Math.round(w), Math.round(h));
  };
  let seed = seed0;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return (seed >>> 8) / 16777216;
  };
  const say = (s: string, x: number, y: number, sc: number, col: string, shadow?: string) => {
    g.save();
    g.translate(-WX0, -WY0);
    text(g, s, x, y, sc, col, shadow);
    g.restore();
  };
  return { cv, g, px, rnd, say };
}

/** Brick wall: rows of bricks with mortar, a little noise, darker toward `dark` (0 top .. 1 bottom). */
function bricks(px: Px, rnd: () => number, x0: number, x1: number, y0: number, y1: number, base: [number, number, number], fade: number) {
  for (let y = y0; y < y1; y += 4) {
    const row = (y - y0) / 4;
    const k = 1 - ((y - y0) / (y1 - y0)) * fade;
    px(x0, y + 3, x1 - x0, 1, `rgb(${Math.round(base[0] * 0.35 * k)},${Math.round(base[1] * 0.35 * k)},${Math.round(base[2] * 0.4 * k)})`);
    for (let x = x0 - (row % 2 ? 4 : 0); x < x1; x += 9) {
      const n = 0.82 + rnd() * 0.3;
      px(x, y, 8, 3, `rgb(${Math.round(base[0] * n * k)},${Math.round(base[1] * n * k)},${Math.round(base[2] * n * k)})`);
    }
  }
}

/** A neon tube word with a soft halo. */
function neon(g: Ctx, say: (s: string, x: number, y: number, sc: number, col: string, shadow?: string) => void, s: string, cx: number, y: number, sc: number, col: string, halo: string) {
  const w = textWidth(s) * sc;
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-2, 0], [2, 0], [0, -2], [0, 2]] as const) say(s, cx - w / 2 + dx, y + dy, sc, halo);
  say(s, cx - w / 2, y, sc, col);
  void g;
}

/** A crowd behind a barrier: dark bodies, some arms up, phone screens lit (their light goes in `crowd`). */
function crowdRow(px: Px, rnd: () => number, crowd: [number, number][], x0: number, x1: number, y: number, tone: string[]) {
  for (let x = x0; x < x1; x += 5 + Math.round(rnd() * 3)) {
    const h = 14 + Math.round(rnd() * 5);
    const c = tone[Math.floor(rnd() * tone.length)];
    px(x - 3, y - h + 5, 6, h - 5, c);
    px(x - 2, y - h, 4, 5, c);
    // a rim of light from the ring on heads and shoulders, so the crowd reads against the dark
    px(x - 2, y - h, 4, 1, 'rgba(255,200,220,0.35)');
    px(x - 3, y - h + 5, 1, 4, 'rgba(255,200,220,0.25)');
    if (rnd() < 0.3) {
      const side = rnd() < 0.5 ? -4 : 3;
      px(x + side, y - h - 6, 1, 8, c);
      if (rnd() < 0.5) {
        px(x + side - 1, y - h - 9, 3, 4, '#141822');
        px(x + side, y - h - 8, 1, 2, '#bfe8ff');
        crowd.push([x + side, y - h - 8]);
      }
    }
  }
}

/** Chain-link: a diamond mesh between x0..x1, y0..y1. */
function chainLink(px: Px, x0: number, x1: number, y0: number, y1: number, col: string) {
  for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) if ((x + y) % 8 === 0 || (x - y + 4000) % 8 === 0) px(x, y, 1, 1, col);
}

/** Graffiti: a tag word with an outline and drips. */
function tag(px: Px, say: (s: string, x: number, y: number, sc: number, col: string, shadow?: string) => void, s: string, x: number, y: number, sc: number, fill: string, edge: string) {
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1]] as const) say(s, x + dx * sc * 0.6, y + dy * sc * 0.6, sc, edge);
  say(s, x, y, sc, fill);
  const w = textWidth(s) * sc;
  for (let k = 0; k < 4; k++) px(x + 2 + ((k * 37) % Math.max(4, w - 4)), y + 5 * sc, 1, 3 + ((k * 5) % 6), fill);
}

export function paintStreetScene(stage: Stage): Scene {
  return stage.id === 'grotto' ? paintRooftop() : stage.id === 'refinery' ? paintChopShop() : paintCage();
}

/* ---------------- THE CAGE ---------------- */

function paintCage(): Scene {
  const { cv, g, px, rnd, say } = canvas(11);
  const crowd: [number, number][] = [];
  // the back wall: old brick, near black at the top where the lamps do not reach
  for (let y = WY0; y < WY0 + WH; y++) px(WX0, y, WW, 1, '#0e0a10');
  bricks(px, rnd, WX0, WX0 + WW, -96, 210, [92, 44, 40], 0.2);
  // a soot band under the roof, and the roof: steel trusses
  for (let y = -96; y < -60; y++) px(WX0, y, WW, 1, `rgba(8,6,10,${(1 - (y + 96) / 36) * 0.8})`);
  for (let y = WY0; y < -96; y++) px(WX0, y, WW, 1, '#08060a');
  px(WX0, -104, WW, 6, '#2a2a34');
  px(WX0, -104, WW, 1, '#4a4a56');
  for (let x = WX0; x < WX0 + WW; x += 40) {
    for (let k = 0; k < 20; k++) {
      px(x + k * 2, -104 - k * 1.4, 2, 2, '#22222c');
      px(x + 40 - k * 2, -104 - k * 1.4, 2, 2, '#22222c');
    }
  }
  // tall factory windows, wired glass, the city's orange glow outside
  for (const wx of [-80, 20, 400, 500]) {
    px(wx - 2, -70, 54, 74, '#1a1418');
    for (let y = -68; y < 2; y++) px(wx, y, 50, 1, `rgb(${Math.round(60 + (y + 68) * 0.9)},${Math.round(34 + (y + 68) * 0.3)},${Math.round(40)})`);
    for (let x = wx; x <= wx + 50; x += 10) px(x, -68, 1, 70, '#1a1418');
    for (let y = -68; y < 2; y += 14) px(wx, y, 50, 1, '#1a1418');
    for (let k = 0; k < 4; k++) px(wx + 6 + k * 11, -60 + ((k * 23) % 50), 6, 1, 'rgba(255,255,255,0.12)');
    if (wx === 20) for (let k = 0; k < 6; k++) px(wx + 30 + k, -40 + k * 3, 1, 1, '#0a0608');
  }
  // graffiti on the wall
  tag(px, say, 'ORE', -70, 30, 4, '#ffc93c', '#140c10');
  tag(px, say, 'KO', 470, 40, 4, '#ff3fa4', '#1a0810');
  tag(px, say, 'GM', 520, -86, 2, '#3de0c8', '#0a1418');
  tag(px, say, 'NO REFS', 380, 10, 2, '#e8e4ee', '#141018');
  // a big Gali mark painted on the brick left of the sign, ORE's ring sprayed on the right
  paintGaliLogo(px, 84, -66, 'big');
  paintOreLogo(px, 352, -36, 38, '#f4f0f8');
  // the neon sign on the back wall, high over the ring
  const sw = textWidth('FIGHTCLUB') * 3 + 24;
  px(240 - sw / 2, -50, sw, 46, '#120a14');
  px(240 - sw / 2, -50, sw, 1, '#3a2a3c');
  for (let k = 1; k < 8; k++) {
    g.fillStyle = `rgba(255,63,164,${(0.03 * (8 - k)).toFixed(3)})`;
    g.fillRect(240 - sw / 2 - k * 3 - WX0, -50 - k * 3 - WY0, sw + k * 6, 46 + k * 6);
  }
  neon(g, say, 'GALI', 240, -44, 2, '#9ffff0', 'rgba(61,224,200,0.35)');
  neon(g, say, 'FIGHTCLUB', 240, -28, 3, '#ff3fa4', 'rgba(255,63,164,0.4)');
  // chain-link cage panels behind the ring, with posts
  chainLink(px, 60, 420, 70, 196, 'rgba(170,176,190,0.35)');
  for (let x = 60; x <= 420; x += 60) {
    px(x, 64, 3, 132, '#5a5e6a');
    px(x, 64, 1, 132, '#8a8e9a');
  }
  px(60, 68, 363, 2, '#5a5e6a');
  // the crowd behind barricades on both sides, phones up
  const tones = ['#2a2034', '#34243e', '#241c2e', '#3a2430'];
  crowdRow(px, rnd, crowd, -98, 100, 150, tones);
  crowdRow(px, rnd, crowd, 380, 578, 150, tones);
  crowdRow(px, rnd, crowd, -96, 96, 172, ['#120e16', '#1a1220']);
  crowdRow(px, rnd, crowd, 384, 578, 172, ['#120e16', '#1a1220']);
  for (const [x0, x1] of [[-100, 100], [380, 580]]) {
    px(x0, 170, x1 - x0, 12, '#3a3a46');
    px(x0, 170, x1 - x0, 2, '#7a7e8a');
    for (let x = x0; x < x1; x += 14) px(x, 174, 8, 3, '#ffc93c');
  }
  // the floor: concrete, stained, fading into the dark pit under the ring
  for (let y = 182; y < 400; y++) {
    const k = Math.min(1, (y - 182) / 120);
    px(WX0, y, WW, 1, `rgb(${Math.round(34 - 26 * k)},${Math.round(32 - 26 * k)},${Math.round(40 - 30 * k)})`);
  }
  for (let i = 0; i < 40; i++) px(WX0 + rnd() * WW, 184 + rnd() * 30, 4 + rnd() * 10, 1, 'rgba(0,0,0,0.25)');
  // the ring: canvas mat on a raised apron, a GALI skirt, ropes on four posts
  const main = { x0: 110, x1: 370, y: 196 };
  px(main.x0, main.y, main.x1 - main.x0, 1, '#f4eee2');
  px(main.x0, main.y + 1, main.x1 - main.x0, 4, '#cfc6b4');
  px(main.x0, main.y + 5, main.x1 - main.x0, 1, '#8a8274');
  for (let y = main.y + 6; y < main.y + 40; y++) {
    const inset = Math.max(0, (y - main.y - 26) * 2);
    px(main.x0 + inset, y, main.x1 - main.x0 - inset * 2, 1, y < main.y + 26 ? '#1a1420' : '#0c0a10');
  }
  px(main.x0, main.y + 6, main.x1 - main.x0, 1, '#ff3fa4');
  for (const sx of [150, 270]) say('GALI', sx, main.y + 12, 2, '#ffc93c', '#000000');
  // blood and sweat on the mat
  for (const [bx, bw] of [[180, 6], [300, 4], [236, 3]] as const) px(bx, main.y + 2, bw, 1, '#8a2030');
  for (const x of [main.x0 + 2, main.x1 - 6]) {
    px(x, main.y - 24, 4, 24, '#d8d4dc');
    px(x, main.y - 24, 1, 24, '#ffffff');
    for (const ty of [main.y - 21, main.y - 14, main.y - 7]) px(x - 1, ty, 6, 3, '#ff3fa4');
  }
  for (const ry of [main.y - 20, main.y - 13, main.y - 6]) px(main.x0 + 6, ry, main.x1 - main.x0 - 12, 1, 'rgba(240,236,244,0.55)');
  // the platforms: steel scaffold planks hung from the trusses on chains
  for (const p of [{ x0: 140, x1: 214, y: 150 }, { x0: 266, x1: 340, y: 150 }]) {
    px(p.x0, p.y, p.x1 - p.x0, 1, '#c4c8d4');
    px(p.x0, p.y + 1, p.x1 - p.x0, 3, '#6a6e7a');
    for (let x = p.x0 + 4; x < p.x1; x += 6) px(x, p.y + 1, 2, 3, '#4a4e5a');
    px(p.x0, p.y + 4, p.x1 - p.x0, 1, '#2a2a34');
    px(p.x0 + 2, p.y - 3, p.x1 - p.x0 - 4, 1, '#ffc93c');
    for (const cx of [p.x0 + 4, p.x1 - 5]) for (let y = -98; y < p.y; y += 3) px(cx, y, 1, 2, '#5a5e6a');
  }
  return { cv, lamps: [[40, -60], [176, -84], [304, -84], [440, -60]], crowd, lamp: '#ffe6b0' };
}

/* ---------------- THE ROOFTOP ---------------- */

function paintRooftop(): Scene {
  const { cv, g, px, rnd, say } = canvas(23);
  const crowd: [number, number][] = [];
  // night sky: deep violet to smoggy orange at the horizon
  for (let y = WY0; y < WY0 + WH; y++) {
    const k = Math.min(1, (y - WY0) / 360);
    px(WX0, y, WW, 1, `rgb(${Math.round(14 + 60 * k * k)},${Math.round(10 + 22 * k * k)},${Math.round(34 + 14 * k)})`);
  }
  for (let i = 0; i < 70; i++) px(WX0 + rnd() * WW, WY0 + rnd() * 160, 1, 1, rnd() < 0.2 ? '#ffffff' : 'rgba(255,255,255,0.5)');
  // the moon behind smog
  for (let r = 18; r > 0; r--) {
    g.fillStyle = r > 14 ? 'rgba(255,240,210,0.04)' : '#f4ead8';
    g.beginPath();
    g.arc(460 - WX0, -90 - WY0, r, 0, Math.PI * 2);
    g.fill();
  }
  px(452, -96, 5, 3, '#d8ccb8');
  px(462, -84, 4, 2, '#d8ccb8');
  // the far skyline, then a nearer one, windows lit at random
  const skyline = (y0: number, minH: number, maxH: number, col: string, win: string, step: number) => {
    let x = WX0;
    while (x < WX0 + WW) {
      const w = 18 + Math.round(rnd() * 34);
      const h = minH + Math.round(rnd() * (maxH - minH));
      px(x, y0 - h, w, 400, col);
      for (let wy = y0 - h + 4; wy < y0 + 120; wy += step) for (let wx = x + 3; wx < x + w - 3; wx += 5) if (rnd() < 0.28) px(wx, wy, 2, 3, win);
      if (rnd() < 0.3) {
        px(x + w / 2, y0 - h - 12, 1, 12, col);
        px(x + w / 2 - 1, y0 - h - 13, 3, 2, '#ff3040');
      }
      x += w + Math.round(rnd() * 4);
    }
  };
  skyline(60, 40, 150, '#1c1628', 'rgba(255,200,120,0.55)', 7);
  skyline(140, 30, 110, '#120e1a', 'rgba(255,220,150,0.8)', 8);
  // a neon billboard on a far roof
  px(-80, -10, 110, 40, '#0a0810');
  px(-80, -10, 110, 1, '#3a2a3c');
  neon(g, say, 'ORE', -25, -4, 3, '#ffc93c', 'rgba(255,201,60,0.35)');
  say('MINE IT', -50, 18, 1, '#3de0c8');
  for (const lx of [-70, 20]) px(lx, 30, 2, 40, '#2a2232');
  // neighbouring roofs left and right, with the crowd watching over the edge
  for (const [x0, x1, y] of [[-100, 70, 150], [410, 580, 150]] as const) {
    px(x0, y, x1 - x0, 300, '#16121e');
    px(x0, y - 3, x1 - x0, 3, '#3a3446');
    px(x0, y - 3, x1 - x0, 1, '#5a5468');
    crowdRow(px, rnd, crowd, x0 + 6, x1 - 6, y - 3, ['#0e0a14', '#1a1222', '#120e18']);
  }
  // our roof: the main slab, a parapet, the wall dropping to the street
  const main = { x0: 126, x1: 354, y: 200 };
  px(main.x0, main.y, main.x1 - main.x0, 1, '#a8a4b4');
  px(main.x0, main.y + 1, main.x1 - main.x0, 5, '#5c5866');
  px(main.x0, main.y + 6, main.x1 - main.x0, 1, '#2a2832');
  bricks(px, rnd, main.x0, main.x1, main.y + 7, 400, [96, 46, 40], 0.85);
  for (const wx of [146, 196, 270, 320]) for (let wy = main.y + 24; wy < 400; wy += 34) {
    px(wx, wy, 14, 16, rnd() < 0.4 ? '#ffb060' : '#0e1220');
    px(wx - 1, wy + 16, 16, 1, '#6a6672');
  }
  tag(px, say, 'GALI', 206, main.y + 12, 2, '#ff3fa4', '#1a0810');
  // the water tank in the middle: its lid is the high platform
  const tk = { x0: 200, x1: 280, y: 132 };
  for (const lx of [tk.x0 + 8, tk.x1 - 10]) {
    px(lx, tk.y + 46, 3, main.y - tk.y - 46, '#2a2228');
    px(lx + 3 - 1, tk.y + 52, 1, main.y - tk.y - 52, '#1a1418');
  }
  for (let k = 0; k < 6; k++) px(tk.x0 + 10 + k * 10, tk.y + 50 + (k % 2) * 6, 10, 1, '#2a2228');
  for (let y = tk.y + 1; y < tk.y + 46; y++) {
    for (let x = tk.x0 + 4; x < tk.x1 - 4; x++) {
      const stave = (x - tk.x0) % 6 === 0;
      const k = (x - tk.x0) / (tk.x1 - tk.x0);
      px(x, y, 1, 1, stave ? '#3a2818' : `rgb(${Math.round(120 - 50 * k)},${Math.round(86 - 36 * k)},${Math.round(56 - 24 * k)})`);
    }
  }
  for (const hy of [tk.y + 10, tk.y + 24, tk.y + 38]) px(tk.x0 + 2, hy, tk.x1 - tk.x0 - 4, 2, '#2e2a30');
  px(tk.x0, tk.y, tk.x1 - tk.x0, 1, '#d8b888');
  px(tk.x0, tk.y + 1, tk.x1 - tk.x0, 2, '#6a4a30');
  // Gali's mark stencilled on the tank
  paintGaliLogo(px, 224, tk.y + 8, 'small', 1, '#14100c');
  // the two low ledges: billboard catwalks on steel poles, past the roof's edges
  for (const p of [{ x0: 92, x1: 150, y: 166 }, { x0: 330, x1: 388, y: 166 }]) {
    px(p.x0, p.y, p.x1 - p.x0, 1, '#c4c8d4');
    px(p.x0, p.y + 1, p.x1 - p.x0, 3, '#5a5e6a');
    for (let x = p.x0 + 2; x < p.x1; x += 4) px(x, p.y + 1, 1, 3, '#3a3e4a');
    for (let x = p.x0; x <= p.x1; x += 8) px(x, p.y - 8, 1, 8, '#7a7e8a');
    px(p.x0, p.y - 8, p.x1 - p.x0 + 1, 1, '#9a9eaa');
    const pole = p.x0 < 200 ? p.x0 + 20 : p.x1 - 22;
    px(pole, p.y + 4, 3, 240, '#2a2a34');
    for (let y = p.y + 10; y < 400; y += 18) {
      px(pole - 6, y, 15, 1, '#2a2a34');
    }
  }
  // string lights across the roof
  for (let x = 120; x < 360; x += 2) px(x, 112 + Math.round(Math.sin(((x - 120) / 240) * Math.PI) * 12), 1, 1, '#1a1418');
  return { cv, lamps: [[150, 118], [200, 122], [280, 122], [330, 118]], crowd, lamp: '#ffd890' };
}

/* ---------------- THE CHOP SHOP ---------------- */

function paintChopShop(): Scene {
  const { cv, g, px, rnd, say } = canvas(37);
  const crowd: [number, number][] = [];
  // corrugated steel walls, grimy, a strip of fluorescent light under the roof
  for (let y = WY0; y < WY0 + WH; y++) px(WX0, y, WW, 1, '#0c0c12');
  for (let x = WX0; x < WX0 + WW; x++) {
    const rib = ((x - WX0) % 8);
    const c = rib === 0 ? '#3a3e4a' : rib < 3 ? '#2c303a' : rib === 7 ? '#14161c' : '#22252e';
    px(x, -110, 1, 320, c);
  }
  for (let i = 0; i < 60; i++) px(WX0 + rnd() * WW, -100 + rnd() * 300, 2 + rnd() * 6, 2 + rnd() * 12, 'rgba(90,50,20,0.25)');
  px(WX0, -116, WW, 6, '#1a1c22');
  for (const fx of [-60, 120, 300, 480]) {
    px(fx, -108, 60, 4, '#d8f4ff');
    px(fx - 2, -110, 64, 2, '#3a3e4a');
  }
  // a pegboard of tools on the left wall, tyres stacked on the right
  px(-90, -60, 120, 70, '#5a4430');
  for (let y = -56; y < 8; y += 5) for (let x = -86; x < 28; x += 5) px(x, y, 1, 1, '#2a2018');
  for (let k = 0; k < 9; k++) {
    const tx = -82 + k * 12;
    px(tx, -50, 2, 22 + (k % 3) * 6, '#9aa0ae');
    px(tx - 2, -52, 6, 3, k % 2 ? '#c0202e' : '#9aa0ae');
  }
  for (let i = 0; i < 7; i++) {
    const ty = 160 - i * 12;
    px(470 + (i % 2) * 3, ty, 50, 12, '#18181e');
    px(470 + (i % 2) * 3, ty, 50, 2, '#34343e');
    px(486 + (i % 2) * 3, ty + 4, 18, 4, '#0a0a0e');
  }
  // the lowrider on a lift at the back, candy paint, chrome wheels
  const car = { x: 130, y: 40 };
  px(car.x, car.y + 18, 220, 4, '#3a3a46');
  for (const lx of [car.x + 30, car.x + 186]) px(lx, car.y + 22, 6, 130, '#4a4a56');
  px(car.x + 10, car.y, 200, 16, '#7a1a5a');
  px(car.x + 40, car.y - 14, 120, 15, '#6a1450');
  px(car.x + 48, car.y - 11, 50, 10, '#1a2a3a');
  px(car.x + 104, car.y - 11, 50, 10, '#1a2a3a');
  px(car.x + 10, car.y, 200, 2, '#c050a0');
  px(car.x + 10, car.y + 8, 200, 1, '#ffc93c');
  for (const wx of [car.x + 40, car.x + 168]) {
    px(wx - 10, car.y + 10, 20, 12, '#101014');
    px(wx - 6, car.y + 13, 12, 6, '#c8ccd8');
    px(wx - 2, car.y + 15, 4, 2, '#ffffff');
  }
  // neon in the window and graffiti on the steel
  px(380, -80, 76, 34, '#0a0810');
  neon(g, say, 'OPEN', 418, -74, 2, '#ff3040', 'rgba(255,48,64,0.35)');
  neon(g, say, '24H', 418, -60, 2, '#3de0c8', 'rgba(61,224,200,0.3)');
  tag(px, say, 'GALI', 40, -96, 3, '#ffc93c', '#140c10');
  // a Gali banner hung on the steel
  px(48, -66, 70, 68, '#140c10');
  px(48, -66, 70, 1, '#3a2a3c');
  for (let k = 0; k < 7; k++) px(48 + k * 10, 2, 6, 4 + (k % 2) * 2, '#140c10');
  paintGaliLogo(px, 52, -62, 'big');
  tag(px, say, 'CHOP', 260, -96, 3, '#ff3fa4', '#1a0810');
  say('FIGHTCLUB', 240 - (textWidth('FIGHTCLUB') * 2) / 2, -70, 2, '#e8e4ee', '#000000');
  // the crowd on the shop floor at both ends, behind tool chests
  crowdRow(px, rnd, crowd, -96, 86, 172, ['#16121c', '#22182a', '#1a1420']);
  crowdRow(px, rnd, crowd, 394, 578, 172, ['#16121c', '#22182a', '#1a1420']);
  for (const x of [-60, 20, 420, 500]) {
    px(x, 150, 36, 32, '#a01a24');
    px(x, 150, 36, 2, '#e04050');
    for (let y = 156; y < 180; y += 6) px(x + 3, y, 30, 1, '#5a0a10');
  }
  // the floor and the service pit under the runway, an emergency light deep in it
  for (let y = 182; y < 400; y++) px(WX0, y, WW, 1, y < 210 ? '#24242c' : '#08080c');
  for (let y = 212; y < 400; y++) {
    const a = Math.max(0, 0.32 - (y - 212) / 600);
    g.fillStyle = `rgba(255,40,40,${a.toFixed(3)})`;
    g.fillRect(96 - WX0, y - WY0, 288, 1);
  }
  for (let y = 214; y < 300; y += 10) for (const wx of [100, 378]) px(wx, y, 2, 6, '#ffc93c');
  // the runway: a long steel lift, yellow and black edges
  const main = { x0: 96, x1: 384, y: 204 };
  px(main.x0, main.y, main.x1 - main.x0, 1, '#d8dce8');
  px(main.x0, main.y + 1, main.x1 - main.x0, 6, '#5a5e6a');
  for (let x = main.x0; x < main.x1; x += 8) px(x, main.y + 7, 4, 3, '#ffc93c');
  for (let x = main.x0 + 4; x < main.x1; x += 8) px(x, main.y + 7, 4, 3, '#14141a');
  for (let x = main.x0 + 10; x < main.x1; x += 24) px(x, main.y + 2, 6, 3, '#3a3e4a');
  for (const lx of [main.x0 + 30, main.x1 - 36]) px(lx, main.y + 10, 6, 200, '#3a3e4a');
  // the three platforms: steel shelving tops and an engine hoist in the middle
  for (const p of [{ x0: 120, x1: 182, y: 158 }, { x0: 298, x1: 360, y: 158 }]) {
    px(p.x0, p.y, p.x1 - p.x0, 1, '#c4c8d4');
    px(p.x0, p.y + 1, p.x1 - p.x0, 3, '#2e5a8a');
    for (const lx of [p.x0 + 2, p.x1 - 4]) px(lx, p.y + 4, 2, main.y - p.y - 4, '#2e5a8a');
    px(p.x0 + 2, p.y + 22, p.x1 - p.x0 - 4, 2, '#2e5a8a');
    for (let k = 0; k < 4; k++) {
      px(p.x0 + 6 + k * 14, p.y + 12 + (k % 2) * 2, 10, 10 - (k % 2) * 2, ['#c0202e', '#3a4a3e', '#ffc93c', '#5a5e6a'][k]);
    }
  }
  const h = { x0: 209, x1: 271, y: 140 };
  px(h.x0, h.y, h.x1 - h.x0, 1, '#d8dce8');
  px(h.x0, h.y + 1, h.x1 - h.x0, 4, '#c0202e');
  px(h.x0, h.y + 5, h.x1 - h.x0, 1, '#5a0a10');
  for (const cx of [h.x0 + 6, h.x1 - 7]) for (let y = -110; y < h.y; y += 3) px(cx, y, 1, 2, '#7a7e8a');
  // an engine block swinging under the hoist
  px(228, h.y + 8, 24, 16, '#3a3e4a');
  px(228, h.y + 8, 24, 2, '#6a6e7a');
  for (let k = 0; k < 4; k++) px(230 + k * 6, h.y + 4, 4, 4, '#2a2e3a');
  return { cv, lamps: [[-30, -104], [150, -104], [330, -104], [510, -104]], crowd, lamp: '#d8f4ff' };
}

/** Each stage's motion: camera flashes in the cage, blinking roof lights and string lights, welding sparks. */
export function animateStreetScene(c: Ctx, stage: Stage, now: number, sx: (x: number) => number, sy: (y: number) => number, Z: number) {
  if (stage.id === 'refinery') {
    // a welder at the back throwing sparks
    const on = Math.floor(now / 1700) % 3 !== 0;
    if (on) {
      c.fillStyle = '#ffffff';
      c.fillRect(sx(452), sy(120), 2 * Z, 2 * Z);
      for (let i = 0; i < 10; i++) {
        const t = (now / 500 + i / 10) % 1;
        c.globalAlpha = 1 - t;
        c.fillStyle = i % 2 ? '#ffd24a' : '#ff7a1a';
        c.fillRect(sx(452 + Math.sin(i * 2.3) * 26 * t), sy(120 + t * t * 40 - t * 10), Z, Z);
      }
      c.globalAlpha = 1;
    }
    // the pit light turning
    const a = (Math.sin(now / 260) + 1) / 2;
    c.globalAlpha = 0.18 * a;
    c.fillStyle = '#ff2030';
    c.fillRect(sx(96), sy(212), 288 * Z, 90 * Z);
    c.globalAlpha = 1;
  } else if (stage.id === 'grotto') {
    // aircraft lights on the towers blink, the string lights twinkle
    if (Math.floor(now / 700) % 2) {
      c.fillStyle = '#ff3040';
      for (const [x, y] of [[-40, -20], [120, -60], [380, -40], [540, 0]]) c.fillRect(sx(x), sy(y), 2 * Z, 2 * Z);
    }
    for (let i = 0; i < 24; i++) {
      const x = 122 + i * 10;
      const y = 112 + Math.round(Math.sin(((x - 120) / 240) * Math.PI) * 12);
      const on = (Math.floor(now / 400) + i) % 5 !== 0;
      c.fillStyle = on ? ['#ffd24a', '#ff3fa4', '#3de0c8'][i % 3] : '#3a3040';
      c.fillRect(sx(x), sy(y + 1), Z * 2, Z * 2);
    }
  } else {
    // phones flashing in the crowd
    for (let i = 0; i < 4; i++) {
      const t = (now / 1300 + i * 0.27) % 1;
      if (t > 0.08) continue;
      const x = i % 2 ? 420 + ((i * 53) % 140) : -80 + ((i * 61) % 160);
      c.globalAlpha = 1 - t / 0.08;
      c.fillStyle = '#ffffff';
      c.fillRect(sx(x) - 3 * Z, sy(128) - 3 * Z, 6 * Z, 6 * Z);
    }
    c.globalAlpha = 1;
  }
}
