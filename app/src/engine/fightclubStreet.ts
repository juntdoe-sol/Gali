/**
 * The Gali Fightclub, street version: a beat-up brick warehouse at the edge of the lobby with a hot-pink neon
 * FIGHTCLUB sign, a roll-up garage door half open on a ring full of red light, graffiti all over the brick, a chain-link
 * fence with razor wire, burning oil drums, stacked tyres, a tagged dumpster, a water tank on the roof, a fire escape and
 * a pair of sneakers hanging off the power line. Painted once at 1 art px per map px; the neon, the drum fires and the
 * street lamp are lit live (STREET_LIGHTS).
 */
import { text, textWidth, type Ctx } from './art';
import { paintGaliLogo, paintOreLogo } from './fightLogos';

type G = CanvasRenderingContext2D | Ctx;
type C3 = [number, number, number];
const hex = (h: string): C3 => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgb = (c: C3, k = 1) => `rgb(${Math.max(0, Math.min(255, Math.round(c[0] * k)))},${Math.max(0, Math.min(255, Math.round(c[1] * k)))},${Math.max(0, Math.min(255, Math.round(c[2] * k)))})`;
const mix = (a: C3, b: C3, t: number): C3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const noise = (x: number, y: number) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

export const STREET_W = 288;
export const STREET_H = 208;

/** Live lights, in sprite px: neon (pulses, flickers), drum fires (flicker), the street lamp (steady). */
export const STREET_LIGHTS: { x: number; y: number; r: number; c: string; kind: 'neon' | 'fire' | 'lamp' }[] = [
  { x: 144, y: 74, r: 90, c: '#ff3fa4', kind: 'neon' },
  { x: 144, y: 58, r: 50, c: '#3de0c8', kind: 'neon' },
  { x: 88, y: 176, r: 44, c: '#ff8a30', kind: 'fire' },
  { x: 200, y: 176, r: 44, c: '#ff8a30', kind: 'fire' },
  { x: 272, y: 96, r: 70, c: '#ffe2a0', kind: 'lamp' },
  { x: 222, y: 30, r: 46, c: '#ffe2a0', kind: 'lamp' },
  { x: 144, y: 186, r: 60, c: '#ff3040', kind: 'fire' },
];

export function paintFightclubStreet(g: G) {
  const W = STREET_W;
  const H = STREET_H;
  const cx = W / 2;
  const P = (x: number, y: number, w: number, h: number, c: string) => {
    g.fillStyle = c;
    g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };
  const ground = H - 8;

  // ---------- the building: three storeys of old brick ----------
  const bx0 = 26, bx1 = W - 30, roof = 44;
  const brick = hex('#7a3a2e'), brickD = hex('#4e2420'), mortar = hex('#2c1a1c');
  for (let y = roof; y < ground; y++) {
    const row = Math.floor((y - roof) / 4);
    for (let x = bx0; x < bx1; x++) {
      const off = row % 2 ? 4 : 0;
      const isMortar = (y - roof) % 4 === 3 || (x - bx0 + off) % 9 === 8;
      const n = noise((x + off) / 9 | 0, row);
      // grime: darker toward the ground and down the right side, a stain under the roof line
      const grime = Math.min(0.85, ((y - roof) / (ground - roof)) ** 2 * 0.55 + Math.max(0, (x - cx) / W) * 0.35 + (y - roof < 8 ? 0.25 : 0));
      const base = isMortar ? mortar : mix(mix(brick, hex('#8e4636'), n * 0.7), brickD, grime);
      P(x, y, 1, 1, rgb(base, isMortar ? 1 : 0.9 + noise(x, y) * 0.18));
    }
  }
  // a missing-brick patch or two, showing the grey block behind
  for (const [px, py, pw, ph] of [[40, 128, 14, 7], [226, 70, 10, 6], [60, 64, 8, 5]] as const) {
    P(px, py, pw, ph, '#3c3a44');
    for (let k = 0; k < pw; k += 3) P(px + k, py + (k % 2), 2, 1, '#55525e');
  }
  // the roof parapet: concrete coping, rusty flashing
  P(bx0 - 3, roof - 5, bx1 - bx0 + 6, 6, '#5c5866');
  P(bx0 - 3, roof - 5, bx1 - bx0 + 6, 1, '#8a8696');
  P(bx0 - 3, roof, bx1 - bx0 + 6, 1, '#2a2832');
  for (let x = bx0; x < bx1; x += 7) P(x, roof + 1, 1, 2 + (x % 3), 'rgba(120,60,30,0.6)');

  // ---------- on the roof: a wooden water tank, an AC unit, a crooked antenna ----------
  const tx = 46;
  for (const lx of [tx + 2, tx + 26]) P(lx, 22, 2, roof - 27, '#2a2228');
  P(tx, 30, 30, 2, '#2a2228');
  for (let y = 2; y < 24; y++) {
    const bulge = Math.round(Math.sin(((y - 2) / 22) * Math.PI) * 2);
    for (let x = -bulge; x < 30 + bulge; x++) {
      const stave = ((x + 40) % 5) === 0;
      P(tx + x, y, 1, 1, stave ? '#4a3224' : rgb(mix(hex('#7a5a3a'), hex('#4a3424'), (x + bulge) / (30 + bulge * 2)), 0.95 + noise(x, y) * 0.1));
    }
  }
  for (const hy of [6, 13, 20]) P(tx - 2, hy, 34, 1, '#2e2a30');
  P(tx + 1, 0, 28, 2, '#5a4030');
  P(tx + 6, -1, 18, 1, '#5a4030');
  // AC unit
  P(96, roof - 18, 26, 13, '#8a8e9a');
  P(96, roof - 18, 26, 1, '#b4b8c4');
  for (let k = 0; k < 5; k++) P(99 + k * 4, roof - 15, 2, 8, '#5a5e6a');
  P(122, roof - 12, 6, 2, '#5a5e6a');
  // antenna
  P(150, roof - 30, 1, 25, '#4a4a56');
  for (const [ax, ay, aw] of [[144, roof - 28, 13], [146, roof - 22, 9], [148, roof - 16, 5]] as const) P(ax, ay, aw, 1, '#4a4a56');
  // the rooftop billboard: Gali's mark and ORE's, lit from below
  const bbx = 180, bby = 0, bbw = 84, bbh = 36;
  for (const lx of [bbx + 10, bbx + bbw - 12]) P(lx, bby + bbh, 2, roof - bby - bbh - 5, '#2a2832');
  P(bbx + 6, bby + bbh + 6, bbw - 12, 1, '#2a2832');
  P(bbx - 1, bby - 1, bbw + 2, bbh + 2, '#050308');
  P(bbx, bby, bbw, bbh, '#0e0a14');
  P(bbx, bby, bbw, 1, '#3a2a3c');
  paintGaliLogo(P, bbx + 6, bby + 3, 'small');
  text(g as Ctx, 'X', bbx + 41, bby + 14, 1, '#ff3fa4');
  paintOreLogo(P, bbx + 62, bby + 18, 18, '#f4f0f8');
  for (const lx of [bbx + 14, bbx + bbw / 2, bbx + bbw - 16]) P(lx - 2, bby + bbh, 5, 2, '#ffe2a0');

  // ---------- windows: two rows, boarded, barred or lit ----------
  const win = (x: number, y: number, kind: 'lit' | 'board' | 'bars' | 'dark') => {
    P(x - 1, y - 1, 18, 20, '#2a1a18');
    P(x - 2, y + 18, 20, 2, '#6a6672');
    if (kind === 'lit') {
      for (let k = 0; k < 18; k++) P(x, y + k, 16, 1, `rgb(${255},${Math.round(150 + k * 3)},${Math.round(70 + k * 2)})`);
      P(x + 3, y + 8, 4, 10, '#3a2020');
      P(x + 4, y + 5, 3, 3, '#3a2020');
    } else if (kind === 'board') {
      P(x, y, 16, 18, '#1a1214');
      for (const [k, t] of [[2, 1], [8, -1], [13, 1]] as const) {
        for (let i = 0; i < 16; i++) P(x + i, y + k + Math.round((i / 16) * 3 * t), 1, 4, i % 5 ? '#8a6a44' : '#6a4e30');
      }
    } else {
      P(x, y, 16, 18, kind === 'dark' ? '#141a2a' : '#1e2638');
      P(x + 1, y + 1, 5, 4, 'rgba(120,150,200,0.25)');
      if (kind === 'bars') for (let i = 1; i < 16; i += 3) P(x + i, y, 1, 18, '#5a5e6a');
    }
  };
  // the sign covers the middle of the top floor: one window each side of it
  win(36, 56, 'lit');
  win(234, 56, 'bars');
  win(232, 96, 'board');

  // ---------- the fire escape down the right side ----------
  const fx0 = 190, fx1 = 252;
  for (const fy of [80, 118]) {
    P(fx0, fy, fx1 - fx0, 2, '#2c2c36');
    for (let x = fx0; x <= fx1; x += 4) P(x, fy - 8, 1, 8, '#3a3a46');
    P(fx0, fy - 8, fx1 - fx0 + 1, 1, '#4a4a56');
  }
  for (let k = 0; k < 18; k++) P(fx1 - 6 - k * 2, 82 + k * 2, 3, 1, '#3a3a46');
  for (let k = 0; k < 14; k++) P(fx0 + 4 + k * 2, 120 + k * 2, 3, 1, '#3a3a46');
  P(fx1 - 6, 82, 1, 36, '#2c2c36');

  // ---------- graffiti ----------
  // a big gold ORE throw-up on the left wall, black outline, white shine, drips
  const throwup = (word: string, x: number, y: number, fill: string, edge: string) => {
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [2, 2], [-1, 1], [1, -1]] as const) text(g as Ctx, word, x + dx * 2, y + dy * 2, 3, edge);
    text(g as Ctx, word, x, y, 3, fill);
  };
  throwup('ORE', 34, 100, '#ffc93c', '#140c10');

  P(36, 101, 3, 1, '#fff3b0');
  P(52, 101, 3, 1, '#fff3b0');
  for (const [dx, len] of [[38, 6], [47, 9], [60, 4], [72, 7]] as const) P(dx, 116, 1, len, '#ffc93c');
  // a teal crown tag and GM in the corner
  const crown = (x: number, y: number, c: string) => {
    P(x, y + 6, 15, 2, c);
    for (const k of [0, 7, 14]) {
      P(x + k, y + 2, 1, 4, c);
      P(x + k - 1, y + 1, 3, 1, c);
    }
    P(x + 3, y + 4, 1, 2, c);
    P(x + 11, y + 4, 1, 2, c);
  };
  crown(78, 98, '#3de0c8');
  text(g as Ctx, 'GM', 79, 109, 2, '#3de0c8', '#0a1418');
  P(82, 119, 1, 5, '#3de0c8');
  // crossed pickaxes stencil, white, on the right of the door
  const pick = (x: number, y: number, dir: 1 | -1) => {
    // the handle runs down from the head; the head is a curved blade across its top
    for (let k = 2; k < 20; k++) P(x + k * dir, y + k, 2, 2, '#e8e4ee');
    for (let k = -7; k <= 7; k++) P(x + k, y - k * dir + Math.round(k * k * 0.09), 2, 2, '#e8e4ee');
  };
  pick(214, 132, 1);
  pick(236, 132, -1);
  // a pink "KO" bubble and a wild-style squiggle
  text(g as Ctx, 'KO', 240, 150, 2, '#ff3fa4', '#1a0810');
  for (let k = 0; k < 26; k++) P(34 + k, 150 + Math.round(Math.sin(k * 0.6) * 3), 2, 1, '#9b6bff');
  // wheat-paste posters by the side door
  const poster = (x: number, y: number, bg: string, l1: string, l2: string, ink: string) => {
    P(x, y, 22, 28, bg);
    P(x + 22, y + 2, 1, 26, 'rgba(0,0,0,0.35)');
    P(x + 15, y + 22, 7, 6, 'rgba(0,0,0,0.18)');
    text(g as Ctx, l1, x + Math.round((22 - textWidth(l1)) / 2), y + 4, 1, ink);
    text(g as Ctx, l2, x + Math.round((22 - textWidth(l2)) / 2), y + 12, 1, ink);
    P(x + 5, y + 20, 12, 2, ink);
  };
  poster(40, 128, '#f2e6c4', 'FRI', 'NITE', '#c0202e');
  poster(66, 132, '#ffc93c', '1V1', 'NOW', '#140c10');

  // ---------- the neon sign: GALI in teal script over FIGHTCLUB in hot pink tubes ----------
  const sw = textWidth('FIGHTCLUB') * 3 + 20;
  const sx = Math.round(cx - sw / 2), sy = 50;
  for (const k of [10, 6, 3]) P(sx - k, sy - k, sw + k * 2, 44 + k * 2, `rgba(255,63,164,${(0.05 + (10 - k) * 0.012).toFixed(3)})`);
  P(sx, sy, sw, 44, '#120a14');
  P(sx, sy, sw, 1, '#3a2a3c');
  P(sx, sy + 43, sw, 1, '#050208');
  for (const bxx of [sx + 3, sx + sw - 4]) for (const byy of [sy + 3, sy + 40]) P(bxx, byy, 1, 1, '#8a8696');
  // brackets into the brick
  for (const bxx of [sx + 12, sx + sw - 14]) P(bxx, sy + 44, 3, 6, '#2a2832');
  const gl = 'GALI';
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) text(g as Ctx, gl, Math.round(cx - textWidth(gl)) + dx, sy + 5 + dy, 2, 'rgba(61,224,200,0.35)');
  text(g as Ctx, gl, Math.round(cx - textWidth(gl)), sy + 5, 2, '#9ffff0');
  const fc = 'FIGHTCLUB';
  const fcx = Math.round(cx - (textWidth(fc) * 3) / 2);
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1]] as const) text(g as Ctx, fc, fcx + dx, sy + 20 + dy, 3, 'rgba(255,63,164,0.45)');
  text(g as Ctx, fc, fcx, sy + 20, 3, '#ff3fa4');
  // the cable from the sign down to the box
  for (let y = sy + 44; y < 104; y++) P(sx + sw - 6 + ((y >> 2) % 2), y, 1, 1, '#141018');

  // ---------- the roll-up garage door, half open on the ring ----------
  const dw = 84, dx0 = Math.round(cx - dw / 2), dTop = 112, open = 150;
  // steel frame
  P(dx0 - 6, dTop - 6, dw + 12, ground - dTop + 6, '#3a3a46');
  P(dx0 - 6, dTop - 6, dw + 12, 2, '#6a6a78');
  P(dx0 - 4, dTop - 4, 3, ground - dTop + 4, '#24242e');
  P(dx0 + dw + 1, dTop - 4, 3, ground - dTop + 4, '#24242e');
  // the warning stripes on the jambs
  for (let y = dTop; y < ground; y += 6) {
    P(dx0 - 6, y, 2, 3, '#ffc93c');
    P(dx0 + dw + 4, y + 3, 2, 3, '#ffc93c');
  }
  // inside: red light, the ring ropes, a crowd of silhouettes
  for (let y = open; y < ground; y++) {
    const k = (y - open) / (ground - open);
    P(dx0, y, dw, 1, `rgb(${Math.round(90 + 110 * k)},${Math.round(14 + 30 * k)},${Math.round(24 + 10 * k)})`);
  }
  for (let i = 0; i < 18; i++) {
    const hx = dx0 + 3 + i * 4.6 + noise(i, 2) * 2, hy = ground - 14 - noise(i, 5) * 6;
    P(hx, hy, 4, ground - hy, '#1a0608');
    P(hx + 0.5, hy - 3, 3, 3, '#1a0608');
    if (noise(i, 7) < 0.35) P(hx + (i % 2 ? 3 : -1), hy - 7, 1, 5, '#1a0608');
  }
  for (const ry of [open + 9, open + 15, open + 21]) P(dx0 + 6, ry, dw - 12, 1, '#ffe2e2');
  for (const rx of [dx0 + 6, dx0 + dw - 7]) P(rx, open + 6, 2, ground - open - 12, '#d8d4dc');
  // the rolled door: corrugated steel, tagged
  for (let y = dTop; y < open; y++) {
    const rib = (y - dTop) % 4;
    P(dx0, y, dw, 1, rib === 0 ? '#9ea2ae' : rib === 3 ? '#4e525e' : rgb(hex('#7a7e8a'), 0.92 + noise(y, 3) * 0.12));
  }
  P(dx0, open - 2, dw, 2, '#2a2a34');
  P(dx0 + dw / 2 - 6, open - 5, 12, 2, '#2a2a34');
  text(g as Ctx, 'NO RULES', dx0 + Math.round((dw - textWidth('NO RULES') * 2) / 2), dTop + 8, 2, '#ff3fa4', '#1a0810');
  for (let k = 0; k < 30; k++) P(dx0 + 8 + k * 2.4, dTop + 26 + Math.round(Math.sin(k * 0.9) * 2), 2, 1, '#3de0c8');

  // a caged bulb over the garage door
  P(cx - 2, dTop - 14, 5, 5, '#2a2832');
  P(cx - 1, dTop - 13, 3, 3, '#fff0b0');

  // ---------- out front: chain-link fence and razor wire ----------
  const fence = (x0: number, x1: number) => {
    const top = ground - 34;
    for (let y = top; y < ground; y++) for (let x = x0; x < x1; x++) {
      if ((x + y) % 4 === 0 || (x - y + 400) % 4 === 0) P(x, y, 1, 1, 'rgba(170,176,190,0.55)');
    }
    for (let x = x0; x <= x1; x += 18) {
      P(x, top - 4, 2, ground - top + 4, '#8a8e9a');
      P(x, top - 4, 2, 1, '#c4c8d4');
    }
    P(x0, top, x1 - x0, 1, '#8a8e9a');
    // razor wire coils
    for (let x = x0; x < x1; x += 6) {
      for (let a = 0; a < 12; a++) {
        const t = (a / 12) * Math.PI * 2;
        P(x + 3 + Math.cos(t) * 3, top - 6 + Math.sin(t) * 3, 1, 1, a % 3 ? '#9aa0ae' : '#d4d8e4');
      }
    }
  };
  fence(0, 66);
  fence(W - 52, W);

  // ---------- burning oil drums either side of the door ----------
  const drum = (x: number) => {
    const y = ground - 16;
    P(x - 7, y, 14, 16, '#3a4a3e');
    P(x - 7, y, 14, 1, '#6a7a6e');
    for (const yy of [y + 5, y + 11]) P(x - 7, yy, 14, 1, '#2a3a2e');
    P(x - 7, y + 2, 2, 12, '#7a5a3a');
    P(x + 3, y + 8, 3, 4, '#7a4a2a');
    // flames (the flicker is live)
    for (let k = 0; k < 7; k++) {
      const fh = 6 + Math.round(noise(k, x) * 7);
      P(x - 6 + k * 2, y - fh, 2, fh, k % 2 ? '#ff8a30' : '#ffc93c');
      P(x - 6 + k * 2, y - fh, 2, 2, '#fff0a0');
    }
    P(x - 6, y - 2, 12, 2, '#ff5020');
  };
  drum(88);
  drum(200);

  // ---------- stacked tyres on the left, a tagged dumpster on the right ----------
  for (let i = 0; i < 4; i++) {
    const ty = ground - 6 - i * 6, txx = 18 + (i % 2);
    P(txx, ty, 22, 6, '#1e1e24');
    P(txx, ty, 22, 1, '#3a3a44');
    P(txx + 7, ty + 2, 8, 2, '#0c0c10');
  }
  P(222, ground - 20, 40, 20, '#2e5a3e');
  P(220, ground - 22, 44, 3, '#244a32');
  P(222, ground - 19, 40, 1, '#3e7a52');
  for (const wx of [226, 254]) P(wx, ground - 2, 4, 3, '#14141a');
  text(g as Ctx, 'GALI', 228, ground - 15, 2, '#ffc93c', '#101810');

  // ---------- the street lamp and the sneakers on the wire ----------
  const lx = W - 12;
  P(lx, 92, 3, ground - 92, '#3a3a46');
  P(lx - 14, 92, 17, 2, '#3a3a46');
  P(lx - 18, 92, 8, 4, '#24242e');
  P(lx - 17, 96, 6, 1, '#ffe2a0');
  // the power line from the lamp to the roof, sagging, with a pair of sneakers
  for (let x = bx1; x < lx; x++) {
    const t = (x - bx1) / (lx - bx1);
    P(x, 78 + Math.round(Math.sin(t * Math.PI) * 6), 1, 1, '#141018');
  }
  const kx = bx1 + 12, ky = 84;
  for (const [ox, oy] of [[0, 0], [5, 2]] as const) {
    P(kx + ox, ky + oy, 1, 6, '#e8e4ee');
    P(kx + ox - 2, ky + oy + 6, 5, 3, '#f4f0f8');
    P(kx + ox - 2, ky + oy + 9, 5, 1, '#c0202e');
  }

  // ---------- the street: wet asphalt with neon in the puddles ----------
  for (let y = ground; y < H; y++) for (let x = 0; x < W; x++) P(x, y, 1, 1, rgb(hex('#26242c'), 0.85 + noise(x >> 1, y) * 0.25));
  P(0, ground, W, 1, '#3a3842');
  for (const [px, pw, c] of [[110, 40, '255,63,164'], [176, 22, '255,138,48'], [30, 26, '61,224,200']] as const) {
    P(px, ground + 3, pw, 3, `rgba(${c},0.35)`);
    P(px + 4, ground + 4, pw - 8, 1, `rgba(${c},0.6)`);
  }
  // a cracked curb line and a shadow under the building
  for (let x = 0; x < W; x += 11) P(x, ground + 1, 6, 1, 'rgba(0,0,0,0.3)');
  P(bx0, ground - 2, bx1 - bx0, 2, 'rgba(0,0,0,0.35)');
}
