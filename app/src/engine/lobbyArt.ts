/**
 * Painted lobby landmarks: the arena colosseum, the Solana statues, the directory boards and the
 * pots and crates you can smash. Each is painted once into a small canvas at 1 art px per map px.
 */
import { text, textWidth, type Ctx } from './art';
import { DOORS, LT, type DoorId } from '../game/lobbyMap';

type G = CanvasRenderingContext2D | Ctx;
const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgb = (c: [number, number, number], k = 1) => `rgb(${Math.max(0, Math.min(255, Math.round(c[0] * k)))},${Math.max(0, Math.min(255, Math.round(c[1] * k)))},${Math.max(0, Math.min(255, Math.round(c[2] * k)))})`;
const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** a tiny fixed noise, so the stone and the crowd look the same on every phone */
const noise = (x: number, y: number) => {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/* ---------------- the arena ---------------- */

export const ARENA_W = 176;
export const ARENA_H = 128;
/** where the flags stand on the rim and the torches hang by the gate, in sprite px */
export const ARENA_FLAGS: [number, number][] = [
  [14, 30],
  [48, 15],
  [88, 11],
  [128, 15],
  [162, 30],
];
export const ARENA_TORCHES: [number, number][] = [
  [58, 92],
  [118, 92],
];

/**
 * A round sandstone colosseum seen from above and in front: the crowd in the stands behind the rim,
 * two rows of arches round the drum, and a big gate in the middle with ARENA over it.
 */
export function paintColosseum(g: G) {
  const W = ARENA_W;
  const cx = W / 2;
  const RX = 86;
  const TOP = 34;
  const BOT = 102;
  const RY = 22;
  const P = (x: number, y: number, w: number, h: number, c: string) => {
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  };
  const lightS = hex('#e3cba2');
  const midS = hex('#c2a67c');
  const darkS = hex('#8e7456');
  const mortar = hex('#6f5841');
  const hole = hex('#2b1b22');
  const crowd = ['#ff5a5a', '#ffd24a', '#5ad1ff', '#7cff6b', '#ff8ad8', '#ffffff', '#b98cff', '#ff9a3d'];
  for (let x = 0; x < W; x++) {
    const dx = (x + 0.5 - cx) / RX;
    if (Math.abs(dx) >= 1) continue;
    const e = Math.sqrt(1 - dx * dx);
    const yBack = TOP - RY * e;
    const yFront = TOP + RY * e;
    const yBot = BOT + RY * e;
    // the light comes from the upper left: the drum is brighter on its left and darker round the edges
    const shade = 0.62 + 0.42 * Math.pow(e, 0.6) - 0.1 * dx;
    // which arch column this x is in, squeezed toward the edges like a real round wall
    const u = (Math.asin(dx) / (Math.PI / 2)) * 9 + 9;
    const f = u - Math.floor(u);
    const col = Math.floor(u);
    for (let y = Math.floor(yBack); y < Math.ceil(yBot); y++) {
      if (y < 0) continue;
      if (y < yFront) {
        // the top: rim, then the stands full of people, then the sand
        const r = Math.hypot(dx, (y + 0.5 - TOP) / RY);
        if (r > 1) continue;
        let c: string;
        if (r > 0.9) c = rgb(r > 0.97 ? lightS : midS, 1.05);
        else if (r > 0.5) {
          const row = Math.floor((r - 0.5) * 30);
          const seat = rgb(row % 2 ? hex('#a68b6a') : hex('#8f7559'), 0.95);
          const n = noise(x, y);
          // the far stands are full, the near ones mostly hidden by the rim
          c = n < (y < TOP ? 0.55 : 0.3) ? crowd[Math.floor(noise(y, x) * crowd.length)] : seat;
        } else if (r > 0.46) c = rgb(darkS, 0.8);
        else c = rgb(hex('#e6c98e'), 0.95 + noise(x, y) * 0.08);
        P(x, y, 1, 1, c);
        continue;
      }
      // the front wall
      const v = y - yFront; // 0 at the top of the wall, about 68 at the foot
      let c: [number, number, number];
      if (v < 3) c = lightS;
      else if (v < 5) c = mortar;
      else if (v < 33) c = arch(f, v - 5, 28, 0.2) ? hole : stone(x, y, midS);
      else if (v < 36) c = v < 34 ? lightS : mortar;
      else if (v < 64) c = arch(f, v - 36, 28, 0.18) ? hole : stone(x, y, midS);
      else c = v < 65 ? lightS : darkS;
      let k = shade;
      // inside an arch: a little lighter near its top edge, so the openings have depth
      if (c === hole) k = 1 + (col % 2 ? 0.05 : 0);
      P(x, y, 1, 1, rgb(c, k));
    }
  }
  function stone(x: number, y: number, base: [number, number, number]): [number, number, number] {
    // blocks: a mortar line every 6 px, joints staggered
    if (y % 6 === 0) return mortar;
    if ((x + (Math.floor(y / 6) % 2 ? 4 : 0)) % 9 === 0) return mortar;
    const n = noise(x, y);
    return n < 0.08 ? darkS : n > 0.94 ? lightS : base;
  }
  // the gate: a deep arch with voussoirs, a raised portcullis and a warm light inside
  const gx0 = 62;
  const gx1 = 114;
  const gBot = BOT + RY - 0; // the wall's foot in the middle
  const gTop = gBot - 46;
  for (let y = gTop; y < gBot; y++)
    for (let x = gx0; x < gx1; x++) {
      const hx = (x + 0.5 - cx) / ((gx1 - gx0) / 2);
      const top = gTop + 14 - 14 * Math.sqrt(Math.max(0, 1 - hx * hx));
      if (y < top) continue;
      const inner = (x + 0.5 - cx) / ((gx1 - gx0) / 2 - 5);
      const itop = gTop + 18 - 13 * Math.sqrt(Math.max(0, 1 - inner * inner));
      if (Math.abs(inner) >= 1 || y < itop) {
        // the stone ring round the opening, in wedge blocks
        const ang = Math.atan2(y - (gTop + 14), x - cx);
        const wedge = Math.floor((ang + Math.PI) / 0.26) % 2;
        P(x, y, 1, 1, rgb(wedge ? lightS : midS, 1.02));
        continue;
      }
      const depth = (y - itop) / (gBot - itop);
      // dark at the top, the lit sand of the arena showing at the bottom
      const c = depth > 0.72 ? mix(hex('#5a3a28'), hex('#e0b070'), (depth - 0.72) / 0.28) : mix(hex('#140a12'), hex('#3a2218'), depth / 0.72);
      P(x, y, 1, 1, rgb(c));
    }
  // the portcullis, pulled up: its bars hang in the top of the opening
  for (let x = gx0 + 8; x < gx1 - 8; x += 5) P(x, gTop + 10, 1, 8, '#4a4458');
  P(gx0 + 7, gTop + 17, gx1 - gx0 - 14, 1, '#4a4458');
  for (let x = gx0 + 8; x < gx1 - 8; x += 5) P(x, gTop + 18, 1, 2, '#6a6480');
  // the plaque with the name
  const tw = textWidth('ARENA');
  const pw = tw + 10;
  const px = Math.round(cx - pw / 2);
  const py = gTop - 13;
  P(px - 1, py - 1, pw + 2, 11, '#3a1410');
  P(px, py, pw, 9, '#8e2228');
  P(px, py, pw, 1, '#c8423a');
  P(px, py + 8, pw, 1, '#5e1418');
  P(px - 2, py + 3, 2, 3, '#ffd24a');
  P(px + pw, py + 3, 2, 3, '#ffd24a');
  text(g as Ctx, 'ARENA', px + 5, py + 2, 1, '#ffd24a');
  // red banners either side of the gate, and gold ones further out
  for (const [bx, c1, c2] of [[44, '#c8323a', '#ffd24a'], [126, '#c8323a', '#ffd24a'], [22, '#ffd24a', '#c8323a'], [148, '#ffd24a', '#c8323a']] as [number, string, string][]) {
    const dx = (bx + 4 - cx) / RX;
    const yF = Math.round(TOP + RY * Math.sqrt(1 - dx * dx)) + 4;
    P(bx - 1, yF - 1, 10, 2, '#5e4126');
    P(bx, yF, 8, 22, c1);
    P(bx, yF, 1, 22, 'rgba(255,255,255,0.25)');
    P(bx + 7, yF, 1, 22, 'rgba(0,0,0,0.25)');
    P(bx, yF + 22, 3, 3, c1);
    P(bx + 5, yF + 22, 3, 3, c1);
    P(bx + 2, yF + 7, 4, 4, c2);
    P(bx + 3, yF + 6, 2, 6, c2);
  }
  // torch brackets by the gate (the flames are drawn live)
  for (const [tx, ty] of ARENA_TORCHES) {
    P(tx - 1, ty, 3, 6, '#3b2a18');
    P(tx - 2, ty - 2, 5, 2, '#26202e');
  }
  // flag poles on the rim (the cloth is drawn live)
  for (const [fx, fy] of ARENA_FLAGS) {
    P(fx, fy - 14, 1, 15, '#3b2a18');
    P(fx - 1, fy - 15, 3, 1, '#ffd24a');
  }
  // two shallow steps up to the gate, and a soft shadow round the foot
  P(gx0 - 4, gBot - 1, gx1 - gx0 + 8, 2, rgb(lightS, 0.95));
  P(gx0 - 8, gBot + 1, gx1 - gx0 + 16, 2, rgb(midS, 0.9));
  for (let x = 0; x < W; x++) {
    const dx = (x + 0.5 - cx) / RX;
    if (Math.abs(dx) >= 1) continue;
    const yb = Math.ceil(BOT + RY * Math.sqrt(1 - dx * dx));
    if (x < gx0 - 8 || x >= gx1 + 8) P(x, yb, 1, 2, 'rgba(0,0,0,0.22)');
  }
}
/** true where an arch opening is, for column fraction f and height v inside a tier of height h */
function arch(f: number, v: number, h: number, side: number) {
  if (f < side || f > 1 - side) return false;
  const half = 0.5 - side;
  const hx = (f - 0.5) / half;
  const r = 9;
  const top = 4 + r - r * Math.sqrt(Math.max(0, 1 - hx * hx));
  return v > top && v < h - 1;
}

/* ---------------- the Solana statue ---------------- */

export const SOL_BASE: [number, number] = [34, 26];
export const SOL_LOGO: [number, number] = [34, 28];

/** A polished dark stone pedestal with a gold band. */
export function paintSolBase(g: G) {
  const P = (x: number, y: number, w: number, h: number, c: string) => {
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  };
  P(0, 21, 34, 5, '#2c2840');
  P(0, 21, 34, 1, '#5a5478');
  P(3, 16, 28, 5, '#38334f');
  P(3, 16, 28, 1, '#6a6490');
  P(7, 4, 20, 12, '#433d5e');
  P(7, 4, 3, 12, '#5a5478');
  P(24, 4, 3, 12, '#2c2840');
  P(7, 9, 20, 2, '#d8a838');
  P(7, 9, 20, 1, '#ffe27a');
  P(5, 0, 24, 4, '#38334f');
  P(5, 0, 24, 1, '#7a74a0');
  // a glowing seam in the top, where the logo floats from
  P(9, 0, 16, 1, '#7ff5c8');
}

/**
 * The Solana logo: three slanted bars, the middle one leaning the other way, with the brand
 * gradient from green at the top right to magenta at the bottom left. `shine` (0..1) moves a
 * white glint across it; less than 0 for none.
 */
export function paintSolLogo(g: G, shine: number) {
  const [W, H] = SOL_LOGO;
  const green = hex('#14f195');
  const purple = hex('#9945ff');
  const magenta = hex('#dc1fff');
  const BAR_W = 26;
  const BAR_H = 6;
  const SHEAR = 5;
  const filled = new Uint8Array(W * H);
  const cols: string[] = new Array(W * H);
  for (let b = 0; b < 3; b++) {
    const y0 = 1 + b * 9;
    for (let j = 0; j < BAR_H; j++) {
      // the top and bottom bars lean right, the middle one left
      const off = b === 1 ? Math.round((j / (BAR_H - 1)) * SHEAR) : Math.round(((BAR_H - 1 - j) / (BAR_H - 1)) * SHEAR);
      for (let i = 0; i < BAR_W; i++) {
        const x = 1 + off + i;
        const y = y0 + j;
        const t = Math.max(0, Math.min(1, 0.32 * ((x - 1) / (W - 3)) + 0.78 * (1 - (y - 1) / (H - 3)) - 0.05));
        let c = t > 0.5 ? mix(purple, green, (t - 0.5) * 2) : mix(magenta, purple, t * 2);
        // the top edge of each bar catches the light, the bottom edge is in shade
        const k = j === 0 ? 1.25 : j === BAR_H - 1 ? 0.78 : 1;
        // the glint: a diagonal band of white
        if (shine >= 0) {
          const d = (x + (H - y) * 0.6) / (W + H * 0.6) - shine;
          if (Math.abs(d) < 0.05) c = mix(c, [255, 255, 255], 0.75);
        }
        filled[y * W + x] = 1;
        cols[y * W + x] = rgb(c, k);
      }
    }
  }
  // a dark outline so it reads on grass and stone alike
  g.fillStyle = '#120a26';
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (filled[y * W + x]) continue;
      const n = (xx: number, yy: number) => xx >= 0 && yy >= 0 && xx < W && yy < H && filled[yy * W + xx];
      if (n(x - 1, y) || n(x + 1, y) || n(x, y - 1) || n(x, y + 1)) g.fillRect(x, y, 1, 1);
    }
  for (let i = 0; i < W * H; i++)
    if (filled[i]) {
      g.fillStyle = cols[i];
      g.fillRect(i % W, Math.floor(i / W), 1, 1);
    }
}

/* ---------------- the directory boards ---------------- */

const SIGN_DEST: { id: DoorId; label: string; c: string }[] = [
  { id: 'island', label: 'ISLAND', c: '#3de0c8' },
  { id: 'market', label: 'MARKET', c: '#d29bff' },
  { id: 'cave', label: 'CAVE', c: '#ff9a3d' },
  { id: 'arena', label: 'ARENA', c: '#ff6a6a' },
  { id: 'pot', label: 'GAMES', c: '#ffcf4a' },
];
export const SIGN_W = 50;
export const SIGN_H = 62;

/** A wooden board on two posts, listing each place with an arrow pointing the way from (tx, ty). */
export function paintSign(g: G, tx: number, ty: number) {
  const P = (x: number, y: number, w: number, h: number, c: string) => {
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  };
  // posts and their shadow
  P(6, 44, 3, 18, '#4a331c');
  P(41, 44, 3, 18, '#4a331c');
  P(6, 44, 1, 18, '#6b4a2b');
  P(41, 44, 1, 18, '#6b4a2b');
  P(3, 60, 44, 2, 'rgba(0,0,0,0.22)');
  // the frame
  P(0, 0, 50, 48, '#5e4126');
  P(1, 1, 48, 46, '#8a6238');
  P(1, 1, 48, 1, '#b8854c');
  P(3, 3, 44, 42, '#14203f');
  // a little roof
  P(-0, 0, 50, 2, '#3b2a18');
  // the header
  const head = 'GALI PLAZA';
  text(g as Ctx, head, Math.round(25 - textWidth(head) / 2), 5, 1, '#ffe27a');
  P(6, 12, 38, 1, '#2c3a66');
  const cx = (tx + 1) * LT;
  const cy = (ty + 0.5) * LT;
  SIGN_DEST.forEach((d, i) => {
    const door = DOORS.find((k) => k.id === d.id);
    if (!door) return;
    const dx = (door.x + door.w / 2) * LT - cx;
    const dy = (door.y + door.h / 2) * LT - cy;
    const y = 15 + i * 6;
    arrow(g, 6, Math.round(y), Math.atan2(dy, dx), d.c);
    text(g as Ctx, d.label, 15, Math.round(y), 1, d.c);
  });
}
/** a 7 x 5 pixel arrow pointing at `ang` (radians, y down), snapped to the nearest of eight ways */
function arrow(g: G, x: number, y: number, ang: number, c: string) {
  const k = ((Math.round(ang / (Math.PI / 4)) % 8) + 8) % 8;
  const a = (k * Math.PI) / 4;
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  g.fillStyle = c;
  for (let py = 0; py < 5; py++)
    for (let px = 0; px < 7; px++) {
      const rx = px - 3;
      const ry = (py - 2) * 1.2;
      const along = rx * ux + ry * uy;
      const across = Math.abs(-rx * uy + ry * ux);
      const shaft = along > -3.2 && along < 1.5 && across < 0.6;
      const head = along >= 0 && along < 3.3 && across <= 3.2 - along;
      if (shaft || head) g.fillRect(x + px, y + py, 1, 1);
    }
}

/* ---------------- things to smash ---------------- */

export const SMASH_DIM: Record<'pot' | 'crate' | 'barrel', [number, number]> = { pot: [14, 16], crate: [16, 16], barrel: [14, 18] };
export const SMASH_COLORS: Record<'pot' | 'crate' | 'barrel', string[]> = {
  pot: ['#c8683a', '#e08a54', '#8e4426', '#f2c27a'],
  crate: ['#b78049', '#d8a468', '#6e4a26', '#f2d29a'],
  barrel: ['#7a5330', '#9a7040', '#3b2a18', '#8a8a96'],
};

/** A whole pot, crate or barrel, or (broken) the pile of bits it leaves. */
export function paintSmash(g: G, kind: 'pot' | 'crate' | 'barrel', broken: boolean) {
  const P = (x: number, y: number, w: number, h: number, c: string) => {
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  };
  const [W, H] = SMASH_DIM[kind];
  if (broken) {
    const [a, b, d, e] = SMASH_COLORS[kind];
    P(1, H - 2, W - 2, 2, 'rgba(0,0,0,0.2)');
    for (const [x, y, w, h, c] of [[2, H - 4, 4, 2, a], [6, H - 3, 3, 2, d], [8, H - 5, 4, 3, b], [4, H - 6, 3, 2, e], [10, H - 3, 3, 2, a]] as [number, number, number, number, string][]) P(x, y, w, h, c);
    return;
  }
  if (kind === 'pot') {
    // a round clay pot with a lip and a painted band
    for (let y = 0; y < 13; y++) {
      const t = y / 12;
      const hw = y < 2 ? 4 : y < 3 ? 3 : Math.round(3 + Math.sin(((y - 3) / 10) * Math.PI) * 3.6);
      for (let x = -hw; x < hw; x++) P(7 + x, 1 + y, 1, 1, x > hw - 3 ? '#8e4426' : x < -hw + 2 ? '#e08a54' : t > 0.45 && t < 0.6 ? '#f2c27a' : '#c8683a');
    }
    P(3, 1, 8, 1, '#f2c27a');
    P(5, 0, 4, 1, '#2a1410');
    P(2, 14, 10, 2, 'rgba(0,0,0,0.25)');
  } else if (kind === 'crate') {
    P(1, 2, 14, 12, '#a97b48');
    P(1, 2, 14, 2, '#d8a468');
    P(1, 12, 14, 2, '#6e4a26');
    P(1, 2, 2, 12, '#c79a60');
    P(13, 2, 2, 12, '#6e4a26');
    for (let k = 0; k < 9; k++) P(3 + k, 4 + k * 0.9, 2, 1, '#6e4a26');
    P(0, 14, 16, 2, 'rgba(0,0,0,0.25)');
  } else {
    P(1, 2, 12, 14, '#7a5330');
    P(2, 0, 10, 3, '#8f6a3e');
    P(1, 5, 12, 1, '#3b2a18');
    P(1, 12, 12, 1, '#3b2a18');
    P(3, 3, 2, 12, '#9a7040');
    P(10, 3, 2, 12, '#5a3a20');
    P(0, 16, 14, 2, 'rgba(0,0,0,0.25)');
  }
}

/* ---------- flags on the flag square ---------- */

export const FLAG_W = 26;
export const FLAG_H = 15;
/** A flag, flat, at 1 art px per map px. The engine waves it column by column. */
export function paintFlag(g: G, v: 'us' | 'my' | 'id' | 'ng') {
  const P = (x: number, y: number, w: number, h: number, c: string) => {
    g.fillStyle = c;
    g.fillRect(x, y, w, h);
  };
  const W = FLAG_W;
  const H = FLAG_H;
  if (v === 'us' || v === 'my') {
    // stripes: 13 for the USA, 14 for Malaysia's Jalur Gemilang, squeezed into 15 rows
    const n = v === 'us' ? 13 : 14;
    for (let y = 0; y < H; y++) P(0, y, W, 1, Math.floor((y * n) / H) % 2 ? '#f4f4f4' : '#c8202e');
    const cw = v === 'us' ? 11 : 13;
    const ch = v === 'us' ? 8 : 8;
    P(0, 0, cw, ch, v === 'us' ? '#2a3a8c' : '#1a2a7a');
    if (v === 'us') {
      for (let y = 1; y < ch - 1; y += 2) for (let x = 1 + ((y >> 1) % 2); x < cw - 1; x += 2) P(x, y, 1, 1, '#ffffff');
    } else {
      // a yellow crescent and a star
      const Y = '#ffd200';
      P(2, 2, 1, 4, Y);
      P(3, 1, 2, 1, Y);
      P(3, 6, 2, 1, Y);
      P(5, 2, 1, 1, Y);
      P(5, 5, 1, 1, Y);
      P(8, 3, 3, 1, Y);
      P(9, 2, 1, 3, Y);
      P(8, 2, 1, 1, Y);
      P(10, 4, 1, 1, Y);
    }
  } else if (v === 'id') {
    P(0, 0, W, Math.ceil(H / 2), '#d2232e');
    P(0, Math.ceil(H / 2), W, H - Math.ceil(H / 2), '#f4f4f4');
  } else {
    const t = Math.round(W / 3);
    P(0, 0, t, H, '#008751');
    P(t, 0, W - 2 * t, H, '#f4f4f4');
    P(W - t, 0, t, H, '#008751');
  }
  // a soft shade at the bottom edge so it reads as cloth
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(0, H - 1, W, 1);
}
