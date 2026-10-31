/**
 * The Gali Fightclub's three stages, painted once each (rules and floor plans: game/brawl2/sim.ts STAGES).
 * All underground, each a different place: the Ore Pit, the Crystal Grotto and the Refinery.
 * A scene is a picture of the world (map px from WX0, WY0) plus the bits drawn live: lamps, the crowd's helmet
 * lights, and each stage's own motion (animateScene).
 */
import { ctx2d, makeCanvas, text, textWidth, type Ctx } from './art';
import type { Stage } from '../game/brawl2/sim';

/** the world painted behind the stage (map px), wide enough to show the blast zone edges */
export const WX0 = -100;
export const WY0 = -140;
export const WW = 680;
export const WH = 540;

export interface Scene {
  cv: HTMLCanvasElement;
  /** hanging lamps (their glow flickers live) */
  lamps: [number, number][];
  /** the crowd's helmet lamps */
  crowd: [number, number][];
  lamp: string;
}

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
  return { cv, g, px, rnd };
}

/** The GALI FIGHTCLUB board hung from the roof beam, in each stage's own materials. */
function sign(g: Ctx, px: Px, top: number, edge: string, face: string, hi: string, ink: string) {
  const sw = textWidth('GALI FIGHTCLUB') * 2 + 16;
  const sx0 = 240 - sw / 2;
  for (const cx of [sx0 + 8, sx0 + sw - 9]) px(cx, top - 14, 1, 14 + 14, '#8a8a96');
  px(sx0, top + 14, sw, 20, edge);
  px(sx0 + 1, top + 15, sw - 2, 18, face);
  px(sx0 + 1, top + 15, sw - 2, 1, hi);
  g.save();
  g.translate(-WX0, -WY0);
  text(g, 'GALI FIGHTCLUB', sx0 + 8, top + 19, 2, ink, '#0a0608');
  g.restore();
}

/** A rock ledge packed with cheering miners; their helmet lamps go in `crowd`. */
function ledge(px: Px, rnd: () => number, crowd: [number, number][], x0: number, x1: number, y: number, rock: [string, string, string]) {
  px(x0 - 4, y, x1 - x0 + 8, 6, rock[0]);
  px(x0 - 4, y, x1 - x0 + 8, 1, rock[1]);
  px(x0, y + 6, x1 - x0, 8, rock[2]);
  for (let x = x0 + 3; x < x1 - 3; x += 7 + Math.round(rnd() * 3)) {
    const h = 9 + Math.round(rnd() * 3);
    const body = ['#3a5a8a', '#7a2f5c', '#8a7a4a', '#2e6a5a', '#6a3a2a'][Math.floor(rnd() * 5)];
    px(x - 2, y - h + 4, 5, h - 4, body);
    px(x - 2, y - h, 5, 4, ['#e0b090', '#c08a60', '#8a5a3a'][Math.floor(rnd() * 3)]);
    px(x - 3, y - h - 2, 7, 3, ['#ffc93c', '#ff5a5a', '#3de0c8', '#f4ecff'][Math.floor(rnd() * 4)]);
    if (rnd() < 0.5) px(x + (rnd() < 0.5 ? -4 : 3), y - h - 4, 1, 5, '#e0b090');
    crowd.push([x, y - h - 1]);
  }
}

/** Paint a stage once (cached by the engine). */
export function paintScene(stage: Stage): Scene {
  return stage.id === 'grotto' ? paintGrotto() : stage.id === 'refinery' ? paintRefinery() : paintPit();
}


/**
 * The Gali Fightclub: a fight pit dug into an ORE mine. Rock walls with glowing ore veins, timber supports, a crowd
 * of miners on the ledges, and the mine shaft dropping away under the ring.
 */
function paintPit(): Scene {
  const { cv, g, px, rnd } = canvas(7);
  const crowd: [number, number][] = [];
  // deep rock: warm brown at the top, black down the shaft
  for (let y = WY0; y < WY0 + WH; y++) {
    const k = (y - WY0) / WH;
    px(WX0, y, WW, 1, `rgb(${Math.round(40 - 30 * k)},${Math.round(28 - 22 * k)},${Math.round(34 - 22 * k)})`);
  }
  // rock blocks in the far wall
  for (let i = 0; i < 900; i++) {
    const x = WX0 + rnd() * WW, y = WY0 + rnd() * 420;
    const w = 6 + rnd() * 18, h = 4 + rnd() * 10;
    const t = rnd();
    px(x, y, w, h, t < 0.4 ? '#2e2028' : t < 0.75 ? '#35252e' : '#281b23');
    px(x, y, w, 1, 'rgba(255,220,180,0.06)');
  }
  // ore veins: crooked lines of glowing ore running through the rock
  const vein = (x0: number, y0: number, len: number, col: string, glow: string) => {
    let x = x0, y = y0;
    for (let i = 0; i < len; i++) {
      g.fillStyle = glow;
      g.fillRect(Math.round(x - WX0) - 2, Math.round(y - WY0) - 2, 5, 5);
      px(x, y, 2, 2, col);
      if (rnd() < 0.18) px(x - 1, y - 1, 3, 3, '#fff3b0');
      x += 1 + rnd() * 2;
      y += (rnd() - 0.5) * 3;
    }
  };
  vein(-90, 20, 60, '#ffc93c', 'rgba(255,190,60,0.10)');
  vein(380, -40, 70, '#ffc93c', 'rgba(255,190,60,0.10)');
  vein(-60, 150, 50, '#3de0c8', 'rgba(60,220,200,0.10)');
  vein(430, 140, 55, '#3de0c8', 'rgba(60,220,200,0.10)');
  vein(150, -90, 60, '#ffc93c', 'rgba(255,190,60,0.08)');
  vein(250, 60, 40, '#b86bff', 'rgba(180,110,255,0.08)');
  // the crowd: miners packed on rock ledges on both sides, helmet lamps on
  const rock: [string, string, string] = ['#4a3530', '#7a5a48', '#2a1c20'];
  ledge(px, rnd, crowd, -96, 74, 112, rock);
  ledge(px, rnd, crowd, 406, 576, 112, rock);
  ledge(px, rnd, crowd, -96, 40, 60, rock);
  ledge(px, rnd, crowd, 440, 576, 60, rock);
  // timber supports framing the pit, with a cross beam under the roof
  for (const bx of [-6, 84, 388, 478]) {
    px(bx, -140, 10, 380, '#5a3a24');
    px(bx, -140, 2, 380, '#7a5432');
    px(bx + 8, -140, 2, 380, '#3a2414');
    for (let y = -120; y < 240; y += 40) px(bx - 1, y, 12, 2, '#2a1a10');
  }
  px(-100, -8, 680, 10, '#5a3a24');
  px(-100, -8, 680, 2, '#7a5432');
  px(-100, 0, 680, 2, '#3a2414');
  // the sign: GALI FIGHTCLUB on a board hung from the beam
  sign(g, px, 2, '#3a2414', '#5a3a24', '#8a6040', '#ffc93c');
  // the shaft below: rails of an old lift, and a hot ore glow far down
  for (const rx of [150, 330]) for (let y = 236; y < 400; y += 3) px(rx, y, 2, 2, '#3a2a2a');
  for (let y = 300; y < 400; y++) {
    const a = ((y - 300) / 100) * 0.55;
    g.fillStyle = `rgba(255,110,30,${a.toFixed(3)})`;
    g.fillRect(0, y - WY0, WW, 1);
  }
  for (let i = 0; i < 40; i++) px(WX0 + rnd() * WW, 360 + rnd() * 40, 2, 2, rnd() < 0.5 ? '#ffd24a' : '#ff7a1a');
  // the ring: a slab of packed rock with a plank floor, ore studs on the face, roots of rock tapering under it
  const main = { x0: 110, x1: 370, y: 196 };
  for (let y = main.y; y < main.y + 40; y++) {
    const inset = Math.max(0, (y - main.y - 14) * 1.7);
    const c = y === main.y ? '#e8c890' : y < main.y + 4 ? (y % 2 ? '#8a5a34' : '#7a4e2c') : y % 7 === 0 ? '#2e2026' : '#3e2c30';
    px(main.x0 + inset, y, main.x1 - main.x0 - inset * 2, 1, c);
  }
  for (let x = main.x0 + 12; x < main.x1 - 6; x += 18) px(x, main.y + 1, 1, 3, '#4a2e18');
  for (let i = 0; i < 26; i++) {
    const x = main.x0 + 20 + rnd() * (main.x1 - main.x0 - 40), y = main.y + 8 + rnd() * 18;
    px(x, y, 3, 3, rnd() < 0.7 ? '#ffc93c' : '#3de0c8');
    px(x, y, 3, 1, '#fff3b0');
  }
  // rope ring posts at the two ends
  for (const x of [main.x0 + 3, main.x1 - 6]) {
    px(x, main.y - 16, 3, 16, '#5a3a24');
    px(x - 1, main.y - 17, 5, 2, '#ffc93c');
  }
  // the platforms: scaffold planks on ropes, a lantern on each
  for (const p of [{ x0: 140, x1: 214, y: 150 }, { x0: 266, x1: 340, y: 150 }]) {
    px(p.x0, p.y, p.x1 - p.x0, 1, '#e8c890');
    px(p.x0, p.y + 1, p.x1 - p.x0, 3, '#7a4e2c');
    for (let x = p.x0 + 9; x < p.x1; x += 10) px(x, p.y + 1, 1, 3, '#4a2e18');
    px(p.x0 + 2, p.y + 4, p.x1 - p.x0 - 4, 1, '#3a2414');
    for (const cx of [p.x0 + 5, p.x1 - 6]) for (let y = 2; y < p.y; y += 3) px(cx, y, 1, 2, '#b89a6a');
  }
  return { cv, lamps: [[40, 34], [176, 18], [304, 18], [440, 34]], crowd, lamp: '#ffbe5a' };
}


/**
 * The Crystal Grotto: a cold blue cave deep under the mine. Crystal clusters glowing teal and violet, stalactites,
 * glowing mushrooms, a still pool far below. The ring is a rock shelf with crystals growing from its edges.
 */
function paintGrotto(): Scene {
  const { cv, g, px, rnd } = canvas(23);
  const crowd: [number, number][] = [];
  for (let y = WY0; y < WY0 + WH; y++) {
    const k = (y - WY0) / WH;
    px(WX0, y, WW, 1, `rgb(${Math.round(22 - 16 * k)},${Math.round(26 - 18 * k)},${Math.round(48 - 30 * k)})`);
  }
  // cave rock: rounded lumps in cold blues
  for (let i = 0; i < 700; i++) {
    const x = WX0 + rnd() * WW, y = WY0 + rnd() * 430;
    const r = 3 + rnd() * 10;
    const t = rnd();
    px(x, y, r * 2, r, t < 0.4 ? '#1c2238' : t < 0.75 ? '#232a44' : '#181c30');
    px(x + 2, y, r * 2 - 4, 1, 'rgba(160,200,255,0.05)');
  }
  // stalactites from the roof
  for (let x = WX0; x < WX0 + WW; x += 8 + Math.round(rnd() * 14)) {
    const len = 10 + rnd() * 40;
    for (let k = 0; k < len; k++) {
      const w = Math.max(1, Math.round((1 - k / len) * 6));
      px(x - w / 2, WY0 + 30 + k, w, 1, k % 5 ? '#2a3150' : '#323b5e');
    }
  }
  // a big crystal: a hexagonal prism pointing up, light face, dark face, a bright edge, a glow behind
  const crystal = (x: number, y: number, h: number, w: number, col: string, dark: string, glow: string) => {
    g.fillStyle = glow;
    g.fillRect(Math.round(x - WX0 - w * 2), Math.round(y - WY0 - h - w), w * 4, h + w * 2);
    for (let k = 0; k < h; k++) {
      const tip = k < w ? (k / w) : 1;
      const hw = Math.max(1, Math.round(w * tip));
      px(x - hw, y - h + k, hw, 1, col);
      px(x, y - h + k, hw, 1, dark);
    }
    px(x, y - h, 1, h, '#e8ffff');
  };
  const clusters: [number, number, string, string, string][] = [
    [-70, 150, '#3de0c8', '#1f8a80', 'rgba(60,220,200,0.07)'],
    [30, 90, '#b86bff', '#6a3aa8', 'rgba(180,110,255,0.07)'],
    [450, 150, '#3de0c8', '#1f8a80', 'rgba(60,220,200,0.07)'],
    [530, 70, '#b86bff', '#6a3aa8', 'rgba(180,110,255,0.07)'],
    [240, -40, '#3de0c8', '#1f8a80', 'rgba(60,220,200,0.05)'],
  ];
  for (const [cx, cy, c1, c2, gl] of clusters) {
    crystal(cx, cy, 40 + rnd() * 20, 7, c1, c2, gl);
    crystal(cx - 12, cy + 2, 24 + rnd() * 10, 5, c1, c2, 'rgba(0,0,0,0)');
    crystal(cx + 11, cy + 3, 18 + rnd() * 10, 4, c1, c2, 'rgba(0,0,0,0)');
  }
  // glowing mushrooms on the cave floor ledges
  const shroom = (x: number, y: number) => {
    px(x, y - 4, 1, 4, '#d8e0f0');
    px(x - 2, y - 6, 5, 2, rnd() < 0.5 ? '#ff8ad8' : '#8ef06a');
  };
  // the crowd on crystal-studded ledges
  const rock: [string, string, string] = ['#2a3150', '#5a6a9a', '#161a2c'];
  ledge(px, rnd, crowd, -96, 64, 118, rock);
  ledge(px, rnd, crowd, 416, 576, 118, rock);
  ledge(px, rnd, crowd, -96, 30, 54, rock);
  ledge(px, rnd, crowd, 450, 576, 54, rock);
  for (let i = 0; i < 10; i++) shroom(-90 + rnd() * 150, 132), shroom(420 + rnd() * 150, 132);
  sign(g, px, 2, '#1a2040', '#2a3466', '#5a6aaa', '#3de0c8');
  // a still pool far below, catching the crystals' light
  for (let y = 312; y < 400; y++) {
    const k = (y - 312) / 88;
    px(WX0, y, WW, 1, `rgb(${Math.round(16 + 10 * k)},${Math.round(40 + 30 * k)},${Math.round(60 + 30 * k)})`);
  }
  for (let i = 0; i < 60; i++) px(WX0 + rnd() * WW, 316 + rnd() * 80, 4 + rnd() * 10, 1, 'rgba(160,240,255,0.25)');
  // rock pillars holding up the low side ledges, down into the pool
  for (const [x0, x1, y] of [[92, 150, 166], [330, 388, 166]] as [number, number, number][]) {
    const cx = (x0 + x1) / 2;
    for (let yy = y + 4; yy < 330; yy++) {
      const w = 10 + Math.round(Math.sin(yy * 0.13) * 2);
      px(cx - w / 2, yy, w, 1, yy % 9 ? '#232a44' : '#2a3150');
    }
  }
  // the ring: a shelf of blue rock, crystals on its edges and studded in its face
  const main = { x0: 126, x1: 354, y: 200 };
  for (let y = main.y; y < main.y + 44; y++) {
    const inset = Math.max(0, (y - main.y - 10) * 2.2);
    const c = y === main.y ? '#b8d8ff' : y < main.y + 3 ? '#5a6a9a' : y % 6 === 0 ? '#1c2238' : '#2a3150';
    px(main.x0 + inset, y, main.x1 - main.x0 - inset * 2, 1, c);
  }
  for (let i = 0; i < 22; i++) {
    const x = main.x0 + 16 + rnd() * (main.x1 - main.x0 - 32), y = main.y + 6 + rnd() * 18;
    px(x, y, 3, 3, rnd() < 0.6 ? '#3de0c8' : '#b86bff');
    px(x, y, 1, 1, '#e8ffff');
  }
  crystal(main.x0 + 4, main.y + 1, 14, 3, '#3de0c8', '#1f8a80', 'rgba(60,220,200,0.08)');
  crystal(main.x1 - 4, main.y + 1, 14, 3, '#b86bff', '#6a3aa8', 'rgba(180,110,255,0.08)');
  // the ledges: slabs of crystal (the middle one hangs from a stalactite on chains)
  for (const [x0, x1, y, col] of [[200, 280, 132, '#b86bff'], [92, 150, 166, '#3de0c8'], [330, 388, 166, '#3de0c8']] as [number, number, number, string][]) {
    px(x0, y, x1 - x0, 1, '#e8ffff');
    px(x0, y + 1, x1 - x0, 3, col);
    px(x0 + 2, y + 4, x1 - x0 - 4, 1, '#1c2238');
    for (let x = x0 + 6; x < x1 - 4; x += 9) px(x, y + 1, 1, 3, 'rgba(255,255,255,0.35)');
  }
  for (const cx of [206, 273]) for (let y = 0; y < 132; y += 3) px(cx, y, 1, 2, '#8a9ac0');
  return { cv, lamps: [[60, 26], [420, 26]], crowd, lamp: '#7ae8ff' };
}

/**
 * The Refinery: where the mine's ore is melted down. Riveted iron walls, pipes and gears, a giant ladle pouring
 * molten ore, and a pool of it glowing under an iron catwalk. Gantries hang on chains above.
 */
function paintRefinery(): Scene {
  const { cv, g, px, rnd } = canvas(41);
  const crowd: [number, number][] = [];
  for (let y = WY0; y < WY0 + WH; y++) {
    const k = (y - WY0) / WH;
    px(WX0, y, WW, 1, `rgb(${Math.round(30 + 20 * k)},${Math.round(24 - 6 * k)},${Math.round(26 - 12 * k)})`);
  }
  // iron wall panels with rivets
  for (let y = WY0; y < 300; y += 30) {
    for (let x = WX0; x < WX0 + WW; x += 44) {
      const t = rnd();
      px(x + 1, y + 1, 42, 28, t < 0.5 ? '#2a2528' : '#2e282c');
      px(x + 1, y + 1, 42, 1, 'rgba(255,255,255,0.05)');
      for (const [rx, ry] of [[3, 3], [39, 3], [3, 25], [39, 25]]) px(x + rx, y + ry, 1, 1, '#5a5058');
    }
  }
  // pipes running along the wall
  const pipe = (y: number, col: string) => {
    px(WX0, y, WW, 6, col);
    px(WX0, y, WW, 1, 'rgba(255,255,255,0.18)');
    px(WX0, y + 5, WW, 1, 'rgba(0,0,0,0.35)');
    for (let x = WX0 + 20; x < WX0 + WW; x += 70) px(x, y - 1, 4, 8, '#1a1618');
  };
  pipe(30, '#6a4a3a');
  pipe(96, '#3a5a6a');
  // big gears behind
  const gear = (cx: number, cy: number, r: number, col: string) => {
    for (let a = 0; a < Math.PI * 2; a += 0.02) {
      const tooth = Math.floor(a / (Math.PI / 8)) % 2 === 0 ? 3 : 0;
      for (let rr = r * 0.45; rr < r + tooth; rr += 1) px(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 1, 1, col);
    }
    for (let a = 0; a < Math.PI * 2; a += 0.05) px(cx + Math.cos(a) * r * 0.25, cy + Math.sin(a) * r * 0.25, 1, 1, '#1a1618');
  };
  gear(20, 40, 30, '#3a3236');
  gear(470, 20, 38, '#3a3236');
  gear(540, 120, 20, '#332c30');
  // the ladle up in the corner (its pour is drawn live)
  // the ladle hangs under the right-hand crowd, tipped to pour into the melt
  px(430, 134, 56, 4, '#4a4248');
  for (let k = 0; k < 22; k++) px(436 + k * 0.4, 138 + k, 44 - k * 0.8, 1, k < 2 ? '#ffb030' : '#3a3236');
  px(434, 139, 48, 2, '#ffd24a');
  for (const cx of [438, 478]) for (let y = 130; y < 134; y++) px(cx, y, 1, 1, '#8a8088');
  // the crowd on an upper catwalk with a railing, and on a lower one
  const rock: [string, string, string] = ['#4a4248', '#7a7078', '#2a2528'];
  ledge(px, rnd, crowd, -96, 70, 116, rock);
  ledge(px, rnd, crowd, 410, 576, 116, rock);
  ledge(px, rnd, crowd, -96, 40, 52, rock);
  ledge(px, rnd, crowd, 440, 576, 52, rock);
  for (const [x0, x1, y] of [[-96, 70, 116], [410, 576, 116], [-96, 40, 52], [440, 576, 52]] as [number, number, number][]) {
    px(x0 - 4, y - 7, x1 - x0 + 8, 1, '#8a8088');
    for (let x = x0 - 4; x < x1 + 4; x += 10) px(x, y - 7, 1, 7, '#8a8088');
  }
  sign(g, px, 2, '#2a2528', '#4a4248', '#8a8088', '#ff9a3d');
  // molten ore below: bright at the surface, crusting darker deeper
  for (let y = 290; y < 400; y++) {
    const k = (y - 290) / 110;
    px(WX0, y, WW, 1, `rgb(${Math.round(255 - 120 * k)},${Math.round(170 - 120 * k)},${Math.round(40 - 20 * k)})`);
  }
  for (let i = 0; i < 120; i++) px(WX0 + rnd() * WW, 292 + rnd() * 50, 3 + rnd() * 8, 1, rnd() < 0.5 ? '#fff3b0' : '#ffd24a');
  for (let y = 250; y < 290; y++) {
    g.fillStyle = `rgba(255,140,40,${(((y - 250) / 40) * 0.35).toFixed(3)})`;
    g.fillRect(0, y - WY0, WW, 1);
  }
  // supports under the catwalk, standing in the melt
  for (const x of [130, 240, 350]) {
    px(x - 3, 208, 6, 90, '#3a3236');
    px(x - 3, 208, 1, 90, '#6a6068');
    for (let y = 216; y < 290; y += 16) {
      px(x - 3, y, 6, 1, '#1a1618');
    }
  }
  // the catwalk: an iron grate with hazard stripes on the edges
  const main = { x0: 96, x1: 384, y: 204 };
  px(main.x0, main.y, main.x1 - main.x0, 1, '#d8d0d8');
  px(main.x0, main.y + 1, main.x1 - main.x0, 6, '#5a5058');
  for (let x = main.x0; x < main.x1; x += 4) px(x, main.y + 2, 2, 4, '#2a2528');
  for (let x = main.x0; x < main.x1; x += 8) {
    px(x, main.y + 7, 4, 3, '#ffc93c');
    px(x + 4, main.y + 7, 4, 3, '#1a1618');
  }
  px(main.x0, main.y + 10, main.x1 - main.x0, 4, '#3a3236');
  // gantries: steel beams on chains
  for (const [x0, x1, y] of [[120, 182, 158], [209, 271, 140], [298, 360, 158]] as [number, number, number][]) {
    px(x0, y, x1 - x0, 1, '#e8e0e8');
    px(x0, y + 1, x1 - x0, 2, '#8a8088');
    px(x0 + 3, y + 3, x1 - x0 - 6, 2, '#5a5058');
    px(x0, y + 5, x1 - x0, 1, '#8a8088');
    for (const cx of [x0 + 5, x1 - 6]) for (let yy = 0; yy < y; yy += 3) px(cx, yy, 1, 2, '#6a6068');
  }
  return { cv, lamps: [[60, 20], [176, 6], [304, 6], [420, 20]], crowd, lamp: '#ffd08a' };
}

/** Each stage's own motion, drawn over the painting every frame. */
export function animateScene(c: Ctx, stage: Stage, now: number, sx: (x: number) => number, sy: (y: number) => number, Z: number) {
  if (stage.id === 'refinery') {
    // the ladle pours a stream of molten ore into the melt
    const w = 3 + Math.sin(now / 120) * 0.8;
    const gr = c.createLinearGradient(0, sy(156), 0, sy(300));
    gr.addColorStop(0, '#fff3b0');
    gr.addColorStop(1, '#ff8a2a');
    c.fillStyle = gr;
    c.fillRect(sx(458 - w / 2), sy(156), w * Z, 140 * Z);
    // bubbles popping on the melt
    for (let i = 0; i < 9; i++) {
      const t = ((now / 1400 + i * 0.37) % 1);
      const x = 40 + ((i * 97) % 420);
      c.globalAlpha = 1 - t;
      c.fillStyle = '#fff3b0';
      const r = (1 + t * 3) * Z;
      c.fillRect(sx(x) - r / 2, sy(292 - t * 4), r, r * 0.6);
    }
    c.globalAlpha = 1;
    // sparks rising from the pour
    for (let i = 0; i < 6; i++) {
      const t = ((now / 900 + i / 6) % 1);
      c.fillStyle = i % 2 ? '#ffd24a' : '#ff7a1a';
      c.globalAlpha = 1 - t;
      c.fillRect(sx(458 + Math.sin(i * 3 + now / 300) * 20 * t), sy(290 - t * 70), Z, Z);
    }
    c.globalAlpha = 1;
  } else if (stage.id === 'grotto') {
    // crystals twinkle, and light ripples on the pool
    for (let i = 0; i < 14; i++) {
      const t = (now / 1600 + i * 0.29) % 1;
      if (t > 0.3) continue;
      const x = [-70, 30, 450, 530, 240, 130, 350][i % 7] + ((i * 13) % 20) - 10;
      const y = [110, 50, 110, 30, -80, 205, 205][i % 7] + ((i * 7) % 16);
      c.globalAlpha = 1 - t / 0.3;
      c.fillStyle = '#e8ffff';
      c.fillRect(sx(x) - Z, sy(y), 3 * Z, Z);
      c.fillRect(sx(x), sy(y) - Z, Z, 3 * Z);
    }
    for (let i = 0; i < 10; i++) {
      const x = -80 + ((i * 71 + now / 40) % 640);
      c.globalAlpha = 0.25;
      c.fillStyle = '#a0f0ff';
      c.fillRect(sx(x), sy(316 + ((i * 17) % 60)), 12 * Z, Z);
    }
    c.globalAlpha = 1;
  } else {
    // dust drifting down the shaft
    for (let i = 0; i < 12; i++) {
      const t = (now / 6000 + i / 12) % 1;
      c.globalAlpha = 0.35 * (1 - t);
      c.fillStyle = '#d8b890';
      c.fillRect(sx(60 + ((i * 83) % 360) + Math.sin(now / 1000 + i) * 6), sy(-20 + t * 360), Z, Z);
    }
    c.globalAlpha = 1;
  }
}
