/**
 * GALI in 30 seconds.
 *
 * The island, the miners, the water and the dive into a claim are the real game
 * engine, driven by a script instead of a player. Everything laid over it (the
 * logo build, the kinetic type, the step cards, the counters) is drawn here. The
 * page renders one frame per call so a headless browser can step through it at
 * exactly 30 fps and hand each frame to ffmpeg.
 */
import { clock } from './clock';
import { Engine } from '../../app/src/engine/engine';
import art from '../../app/src/engine/art.json';
import type { Look, PeerView, Snapshot } from '../../app/src/engine/types';

const q = new URLSearchParams(location.search);
const W = Number(q.get('w') ?? 1080);
const H = Number(q.get('h') ?? 1920);
const PORTRAIT = H > W;
const U = Math.min(W, H) / 1080; // layout unit
const FPS = 30;
const DUR = 35;

const NAVY = '#070d20';
const GOLD = '#ffcf4a';
const GOLD2 = '#e08a1e';
const TEAL = '#3ee6ff';
const SOLG = '#14f195';
const SKR = '#c7f284';
const WHITE = '#f2f5ff';
const MUTED = '#8ea2cc';
const DISPLAY = 'Jersey15';
const BODY = 'ChakraBold';

/* ---------------- easing ---------------- */
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const prog = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const outCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const inCubic = (x: number) => x * x * x;
const inOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const outExpo = (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
const inExpo = (x: number) => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10));
const outBack = (x: number, s = 1.9) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2);
const outElastic = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const hash = (n: number) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/* ---------------- stage ---------------- */
const out = document.createElement('canvas');
out.width = W;
out.height = H;
out.id = 'out';
document.body.appendChild(out);
const g = out.getContext('2d')!;

const game = document.createElement('canvas');
game.style.cssText = `position:absolute;left:0;top:0;width:${W / 2}px;height:${H / 2}px;visibility:hidden`;
document.body.appendChild(game);

const engine = new Engine(game, () => undefined);
const E = engine as unknown as {
  frame: (t: number) => void;
  cam: { ox: number; oy: number; z: number; fitZ: number; cx: number; cy: number; hold: boolean; userZoomed: boolean; home: (ms: number) => void; flyTo: (x: number, y: number, z: number, ms: number) => void };
  perfFrom: number;
  mode: string;
  sky: { setTime: (f: number) => void; night: number };
};

const CLAIMS = art.island.claims;
/** A claim's centre on the video frame. */
const onScreen = (i: number): [number, number] => {
  const c = CLAIMS[i];
  return [(E.cam.ox + c.cx * E.cam.z) * 2, (E.cam.oy + c.cy * E.cam.z) * 2];
};
const mapToScreen = (x: number, y: number): [number, number] => [(E.cam.ox + x * E.cam.z) * 2, (E.cam.oy + y * E.cam.z) * 2];

/* ---------------- assets ---------------- */
const img = (src: string) =>
  new Promise<HTMLImageElement>((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
const GEAR_KEYS = [
  'pick-wood', 'pick-iron', 'pick-gold', 'pick-gem', 'pick-neon', 'pick-seeker',
  'hat-yellow', 'hat-red', 'hat-teal', 'hat-songkok', 'hat-crown', 'hat-astro',
  'fit-blue', 'fit-khaki', 'fit-batik', 'fit-hazard', 'fit-gold',
  'pet-mole', 'pet-bat', 'pet-sprite', 'pet-firefly',
];
let LOGO: HTMLImageElement;
let PICK: HTMLImageElement;
const GEAR: Record<string, HTMLImageElement> = {};
let logoPts: { x: number; y: number; c: string }[] = [];

async function load() {
  const fonts = [
    new FontFace(DISPLAY, 'url(fonts/Jersey15_400Regular.woff2)'),
    new FontFace(BODY, 'url(fonts/ChakraPetch_700Bold.woff2)'),
  ];
  for (const f of fonts) document.fonts.add(await f.load());
  LOGO = await img('wordmark.png');
  PICK = await img('gear/pick-gold.png');
  await Promise.all(GEAR_KEYS.map(async (k) => (GEAR[k] = await img(`gear/${k}.png`))));
  // points of the logo for the particle build: one per 5 px of its artwork
  const cv = document.createElement('canvas');
  cv.width = LOGO.width;
  cv.height = LOGO.height;
  const x = cv.getContext('2d')!;
  x.drawImage(LOGO, 0, 0);
  const d = x.getImageData(0, 0, cv.width, cv.height).data;
  const step = 7;
  for (let y = 0; y < cv.height; y += step)
    for (let xx = 0; xx < cv.width; xx += step) {
      const o = (y * cv.width + xx) * 4;
      if (d[o + 3] > 150) logoPts.push({ x: xx / cv.width - 0.5, y: y / cv.height - 0.5, c: `rgb(${d[o]},${d[o + 1]},${d[o + 2]})` });
    }
  E.perfFrom = 1e15; // a render farm is never "too slow"
  await engine.start('pixel/atlas.png');
}

/* ---------------- the script the engine plays ---------------- */
const PICKS = [3, 12, 7, 18, 21];
const PICK_AT = [8.25, 8.65, 9.05, 9.45, 9.85];
const WINNER = 7;
const DEPLOY_AT = 10.3;
const SETTLE_AT = 13.6;
const REVEAL_AT = 14.4; // gold shows 1.1 s later, at 15.5
const DIVE_AT = 17.0;
const DIG_AT = 18.4;
const EXIT_AT = 22.0;
const mask = (ids: number[]) => ids.reduce((m, i) => m | (1 << i), 0);
const others = Array.from({ length: 25 }, (_, i) => 0.004 + hash(i * 3.7) * 0.07);

const LOOK: Look = { hat: 'hat-songkok', fit: '#7a2f5c', pick: '#ffc83d', handle: '#5a3a24', pet: 'pet-firefly', glow: 'rare' };
const BOTS: { id: string; name: string; look: Look; route: number[] }[] = [
  { id: 'b1', name: 'Ayu', look: { hat: 'hat-red', fit: '#2f5fd0', pick: '#b8c4d6', handle: '#6b4a32', pet: null, glow: 'none' }, route: [10, 13, 18, 24] },
  { id: 'b2', name: 'Raj', look: { hat: 'hat-teal', fit: '#8a7a4a', pick: '#3de0c8', handle: '#2b2140', pet: 'pet-bat', glow: 'epic' }, route: [15, 16, 19, 9] },
  { id: 'b3', name: 'Mei', look: { hat: 'hat-crown', fit: '#e0a92a', pick: '#ff4fd8', handle: '#1a1a2e', pet: null, glow: 'legendary' }, route: [0, 2, 14, 22] },
  { id: 'b4', name: 'Tomi', look: { hat: 'hat-astro', fit: '#ff7a00', pick: '#c7f284', handle: '#10151f', pet: 'pet-sprite', glow: 'legendary' }, route: [5, 11, 6, 8] },
];
/** Bots walk a loop of claims: 2.4 s walking, 2.2 s swinging at each. */
function bots(t: number): PeerView[] {
  return BOTS.map((b, k) => {
    const leg = 4.6;
    const u = t + k * 1.3;
    const n = Math.floor(u / leg);
    const f = u / leg - n;
    const a = CLAIMS[b.route[n % b.route.length]].stand;
    const c = CLAIMS[b.route[(n + 1) % b.route.length]].stand;
    const walking = f < 0.52;
    const w = walking ? inOut(f / 0.52) : 1;
    const x = lerp(a[0], c[0], w);
    const y = lerp(a[1], c[1], w);
    return {
      id: b.id,
      name: `BOT ${b.name.toUpperCase()}`,
      x,
      y,
      tx: x,
      ty: y,
      facing: c[0] >= a[0] ? 1 : -1,
      pose: walking ? 'walk' : 'swing',
      look: b.look,
      tone: 'bot',
      emoji: null,
    } as PeerView;
  });
}

function snapshot(t: number): Snapshot {
  const view = PORTRAIT
    ? t >= DIVE_AT && t < EXIT_AT + 0.4
      ? { top: 185, bottom: 150 }
      : { top: 250, bottom: 250 }
    : t >= DIVE_AT && t < EXIT_AT + 0.4
      ? { top: 30, bottom: 30 }
      : { top: 108, bottom: 78 };
  const selected = t < DEPLOY_AT ? PICKS.filter((_, k) => t >= PICK_AT[k]) : [];
  let pending = t >= DEPLOY_AT && t < 17.2 ? mask(PICKS) : 0;
  if (t >= DIG_AT && t < 28) pending = mask([WINNER]);
  const heat = prog(t, 9.2, 13.2);
  const round2 = t >= DIG_AT;
  const perBlock = others.map((v, i) => (round2 ? (i === WINNER ? 0.062 : v * 0.6) : v * heat) + (pending & (1 << i) ? 0.01 : 0));
  const mine = perBlock.map((_, i) => (pending & (1 << i) ? 0.01 : 0));
  let phase = 'mining';
  if (!round2 && t >= SETTLE_AT) phase = t >= REVEAL_AT ? 'reveal' : 'settling';
  return {
    view,
    phase,
    roundId: round2 ? 45801 : 45800,
    roundEndsAt: Date.now() + 40_000,
    lockMs: 3000,
    settleStartAt: clock.ms - (t - SETTLE_AT) * 1000,
    revealStartAt: clock.ms - (t - REVEAL_AT) * 1000,
    winner: phase === 'reveal' ? WINNER : null,
    motherlode: false,
    caveIn: false,
    selected,
    pending,
    solo: 0,
    perBlock: perBlock.map((v) => Math.round(v * 1e5) / 1e5),
    mine,
    me: { look: LOOK, emoji: null, emoteAt: t >= 28.7 && t < 33 ? clock.ms - (t - 28.7) * 1000 : 0, name: 'You' },
    peers: bots(t),
    practice: true,
    quality: 1,
    amounts: false,
  };
}

let lastT = -1;
let islandStill: HTMLCanvasElement | null = null;
function drive(t: number) {
  // one-off camera and scene cues, fired the frame their time comes round
  const cue = (at: number) => lastT < at && t >= at;
  if (cue(0)) {
    E.sky.setTime(0.47);
  }
  if (cue(4.0)) {
    // start low over the water off the south beach, then pull back to the whole island
    E.cam.cx = 150;
    E.cam.cy = 205;
    E.cam.z = E.cam.fitZ * 5.2;
    E.cam.hold = true;
    E.cam.flyTo(150, 205, E.cam.fitZ * 5.2, 10);
  }
  if (cue(4.35)) E.cam.home(2300);
  if (cue(DIVE_AT - 0.08) && !PORTRAIT) {
    // keep what the island looked like, blurred, as the backdrop for the window
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    cv.getContext('2d')!.drawImage(game, 0, 0, W, H);
    islandStill = cv;
  }
  if (cue(DIVE_AT)) {
    if (!PORTRAIT) game.style.width = `${H / 2}px`; // a square stage for the diorama
    engine.setFocus(WINNER);
  }
  if (cue(EXIT_AT)) {
    if (!PORTRAIT) {
      // cut straight back to the island under a flash rather than dissolve in a square
      game.style.width = `${W / 2}px`;
      engine.setFocus(-1);
      const e = engine as unknown as { mode: string; visit: unknown };
      e.mode = 'island';
      e.visit = null;
    } else engine.setFocus(-1);
  }
  if (t >= 22.6 && t <= 24.6) E.sky.setTime(0.52 + inOut(prog(t, 22.6, 24.4)) * 0.43);
  if (cue(28.0)) E.sky.setTime(0.3);
  lastT = t;
}

/* ---------------- drawing helpers ---------------- */
function font(size: number, fam = DISPLAY) {
  g.font = `${Math.round(size)}px ${fam}`;
}
function textW(s: string, size: number, fam = DISPLAY) {
  font(size, fam);
  return g.measureText(s).width;
}
/** Text that arrives a letter at a time, each dropping in with overshoot. */
function kinetic(s: string, cx: number, y: number, size: number, t: number, t0: number, opts: { fam?: string; color?: string; stagger?: number; dur?: number; out?: number; shadow?: string; spacing?: number; align?: 'center' | 'left' } = {}) {
  const fam = opts.fam ?? DISPLAY;
  const stagger = opts.stagger ?? 0.035;
  const dur = opts.dur ?? 0.45;
  const spacing = (opts.spacing ?? 0) * size;
  font(size, fam);
  const widths = [...s].map((ch) => g.measureText(ch).width + spacing);
  const total = widths.reduce((a, b) => a + b, 0) - spacing;
  let x = opts.align === 'left' ? cx : cx - total / 2;
  const fade = opts.out !== undefined ? 1 - prog(t, opts.out, opts.out + 0.3) : 1;
  [...s].forEach((ch, i) => {
    const p = prog(t, t0 + i * stagger, t0 + i * stagger + dur);
    if (p <= 0) {
      x += widths[i];
      return;
    }
    const e = outBack(p);
    g.save();
    g.globalAlpha = clamp01(p * 3) * fade;
    g.translate(x + widths[i] / 2, y + (1 - e) * size * 0.7 - (opts.out !== undefined ? inCubic(prog(t, opts.out, opts.out + 0.3)) * size * 0.4 : 0));
    g.scale(0.6 + 0.4 * e, 0.6 + 0.4 * e);
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    if (opts.shadow) {
      g.fillStyle = opts.shadow;
      g.fillText(ch, size * 0.06, size * 0.06);
    }
    g.fillStyle = opts.color ?? WHITE;
    g.fillText(ch, 0, 0);
    g.restore();
    x += widths[i];
  });
}
function rr(x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
/** A navy panel with the game's gold trim. */
function panel(x: number, y: number, w: number, h: number, a = 1, glow = GOLD) {
  g.save();
  g.globalAlpha = a;
  g.shadowColor = glow + '88';
  g.shadowBlur = 30 * U;
  rr(x, y, w, h, 18 * U);
  const gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, '#15285aee');
  gr.addColorStop(1, '#070d20ee');
  g.fillStyle = gr;
  g.fill();
  g.shadowBlur = 0;
  g.lineWidth = 3 * U;
  g.strokeStyle = '#c9a24e';
  g.stroke();
  g.restore();
}

/** "01  PICK YOUR CLAIMS": a numbered step card that wipes in and out. */
function stepCard(n: string, title: string, sub: string, t: number, t0: number, t1: number, at?: number) {
  if (t < t0 || t > t1 + 0.4) return;
  const pin = outExpo(prog(t, t0, t0 + 0.5));
  const pout = inExpo(prog(t, t1, t1 + 0.35));
  const size = (PORTRAIT ? 92 : 72) * U;
  const numW = textW(n, size * 1.1) + 48 * U;
  const titleW = textW(title, size);
  const subSize = size * 0.34;
  const w = numW + titleW + 64 * U;
  const h = size * 1.35;
  const cx = at ?? W / 2;
  const y = PORTRAIT ? 250 * U : at !== undefined ? 150 * U : 44 * U;
  const x = cx - w / 2 - pout * W;
  g.save();
  g.beginPath();
  g.rect(x - 40 * U, y - 40 * U, (w + 80 * U) * pin, h + 120 * U);
  g.clip();
  panel(x, y, w, h);
  rr(x + 12 * U, y + 12 * U, numW - 24 * U, h - 24 * U, 12 * U);
  const gg = g.createLinearGradient(0, y, 0, y + h);
  gg.addColorStop(0, '#fff2b8');
  gg.addColorStop(0.5, GOLD);
  gg.addColorStop(1, GOLD2);
  g.fillStyle = gg;
  g.fill();
  font(size * 1.1);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#3a1800';
  g.fillText(n, x + numW / 2, y + h / 2 + 4 * U);
  g.textAlign = 'left';
  font(size);
  g.fillStyle = WHITE;
  g.fillText(title, x + numW + 28 * U, y + h / 2 + 4 * U);
  g.restore();
  if (sub) {
    g.save();
    g.globalAlpha = prog(t, t0 + 0.35, t0 + 0.7) * (1 - pout);
    font(subSize, BODY);
    g.textAlign = 'center';
    g.fillStyle = MUTED;
    g.fillText(sub, cx - pout * W, y + h + subSize * 1.6);
    g.restore();
  }
}

/* ---------------- our own particles, for the overlay ---------------- */
interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  age: number;
  c: string;
  s: number;
  g: number;
}
let sparks: Spark[] = [];
function burst(x: number, y: number, n: number, speed: number, colors: string[], size = 6, grav = 900, life = 1) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = speed * (0.3 + Math.random() * 0.7) * U;
    sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.3 * U, life: life * (0.6 + Math.random() * 0.6), age: 0, c: colors[i % colors.length], s: size * U * (0.6 + Math.random() * 0.8), g: grav * U });
  }
}
function stepSparks(dt: number) {
  for (const s of sparks) {
    s.age += dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.vy += s.g * dt;
    s.vx *= 0.985;
  }
  sparks = sparks.filter((s) => s.age < s.life);
  for (const s of sparks) {
    g.globalAlpha = 1 - Math.pow(s.age / s.life, 3);
    g.fillStyle = s.c;
    g.fillRect(Math.round(s.x - s.s / 2), Math.round(s.y - s.s / 2), Math.ceil(s.s), Math.ceil(s.s));
  }
  g.globalAlpha = 1;
}
function ring(x: number, y: number, t: number, t0: number, dur: number, maxR: number, color: string, width: number) {
  const p = prog(t, t0, t0 + dur);
  if (p <= 0 || p >= 1) return;
  g.save();
  g.globalAlpha = 1 - p;
  g.strokeStyle = color;
  g.lineWidth = width * U * (1 - p * 0.7);
  g.beginPath();
  g.arc(x, y, outExpo(p) * maxR * U, 0, Math.PI * 2);
  g.stroke();
  g.restore();
}
/** Pixel-perfect square ripple, for taps on the island. */
function tapRipple(x: number, y: number, t: number, t0: number) {
  const p = prog(t, t0, t0 + 0.55);
  if (p <= 0 || p >= 1) return;
  g.save();
  g.globalAlpha = 1 - p;
  g.strokeStyle = TEAL;
  g.lineWidth = 5 * U;
  const r = (18 + outExpo(p) * 60) * U;
  g.strokeRect(x - r, y - r, r * 2, r * 2);
  g.restore();
}

/* ---------------- scenes ---------------- */
function background(t: number) {
  const gr = g.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, Math.max(W, H) * 0.75);
  gr.addColorStop(0, '#15285a');
  gr.addColorStop(1, NAVY);
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
  // drifting pixel dust
  for (let i = 0; i < 90; i++) {
    const x = (hash(i) * W + t * (8 + hash(i + 9) * 30) * U) % W;
    const y = (hash(i + 3) * H - t * (12 + hash(i + 5) * 20) * U + H * 2) % H;
    g.globalAlpha = 0.25 + 0.5 * hash(i + 7) * (0.5 + 0.5 * Math.sin(t * 3 + i));
    g.fillStyle = i % 5 === 0 ? GOLD : '#6f82b0';
    const s = Math.round((2 + hash(i + 2) * 4) * U);
    g.fillRect(Math.round(x), Math.round(y), s, s);
  }
  g.globalAlpha = 1;
}

function logoRect(scale: number, cy: number) {
  const w = (PORTRAIT ? 860 : 900) * U * scale;
  const h = (w * LOGO.height) / LOGO.width;
  return { x: W / 2 - w / 2, y: cy - h / 2, w, h };
}

/** Draw the logo with a light sweep across it. */
function drawLogo(r: { x: number; y: number; w: number; h: number }, sweep: number, alpha = 1) {
  g.save();
  g.globalAlpha = alpha;
  g.imageSmoothingEnabled = true;
  g.shadowColor = '#000000aa';
  g.shadowBlur = 40 * U;
  g.shadowOffsetY = 18 * U;
  g.drawImage(LOGO, r.x, r.y, r.w, r.h);
  g.restore();
  if (sweep > 0 && sweep < 1) {
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(r.w);
    cv.height = Math.ceil(r.h);
    const x = cv.getContext('2d')!;
    x.drawImage(LOGO, 0, 0, r.w, r.h);
    x.globalCompositeOperation = 'source-atop';
    const bx = -r.w * 0.4 + sweep * r.w * 1.8;
    const gr = x.createLinearGradient(bx - r.w * 0.15, 0, bx + r.w * 0.15, r.h * 0.4);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.5, 'rgba(255,255,240,0.85)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr;
    x.fillRect(0, 0, r.w, r.h);
    g.save();
    g.globalAlpha = alpha;
    g.globalCompositeOperation = 'lighter';
    g.drawImage(cv, r.x, r.y);
    g.restore();
  }
}

let shake = 0;
function sceneIntro(t: number) {
  background(t);
  const cy = PORTRAIT ? H * 0.42 : H * 0.4;
  const final = logoRect(1, cy);
  // 0.2 - 1.9: pixels swirl in and settle into the logo
  if (t < 2.0) {
    const p = inOut(prog(t, 0.15, 1.9));
    logoPts.forEach((pt, i) => {
      const tx = final.x + (pt.x + 0.5) * final.w;
      const ty = final.y + (pt.y + 0.5) * final.h;
      const a0 = hash(i) * Math.PI * 2;
      const r0 = (500 + hash(i + 1) * 900) * U;
      const spin = (1 - p) * (2.4 + hash(i + 2));
      const sx = W / 2 + Math.cos(a0 + spin) * r0 * (1 - p);
      const sy = cy + Math.sin(a0 + spin) * r0 * (1 - p) * 0.8;
      const x = lerp(sx, tx, p);
      const y = lerp(sy, ty, p);
      const s = Math.round((5 + 3 * (1 - p)) * U);
      g.globalAlpha = clamp01(prog(t, 0.1 + hash(i + 4) * 0.5, 0.6 + hash(i + 4) * 0.5));
      g.fillStyle = pt.c;
      g.fillRect(Math.round(x), Math.round(y), s, s);
    });
    g.globalAlpha = 1;
    // the logo resolves out of the pixels just before the hit
    if (t > 1.6) drawLogo(final, 0, prog(t, 1.6, 1.95));
    // the pickaxe winds up from the top right
    const pw = 190 * U;
    const k = inCubic(prog(t, 1.2, 2.0));
    const ang = lerp(-2.4, 0.15, k);
    const px = final.x + final.w * 0.82;
    const py = final.y + final.h * 0.05;
    g.save();
    g.globalAlpha = prog(t, 1.1, 1.3);
    g.translate(px + 140 * U, py - 120 * U);
    g.rotate(ang);
    g.imageSmoothingEnabled = false;
    g.drawImage(PICK, -pw * 0.2, -pw * 0.8, pw, pw);
    g.restore();
    return;
  }
  // 2.0: the hit. Slam, shake, shockwave, sparks.
  const hit = 2.0;
  if (lastSceneT < hit) {
    burst(final.x + final.w * 0.78, final.y + final.h * 0.2, 90, 1300, [GOLD, '#fff1a8', '#ffffff', GOLD2], 9, 1400, 1.2);
    shake = 1;
  }
  const slam = outElastic(prog(t, hit, hit + 0.9));
  const sc = 1.22 - 0.22 * slam;
  // leave the stage at 3.75
  const leave = inExpo(prog(t, 3.7, 4.2));
  const r = logoRect(sc * (1 - leave * 0.55), cy - leave * H * 0.6);
  ring(final.x + final.w * 0.78, final.y + final.h * 0.2, t, hit, 0.7, 900, '#fff1a8', 18);
  ring(W / 2, cy, t, hit + 0.05, 0.9, 1300, GOLD, 10);
  drawLogo(r, prog(t, 2.35, 3.05), 1);
  // the pick, stuck in, then flicked away
  const pw = 190 * U;
  g.save();
  g.globalAlpha = 1 - prog(t, 2.3, 2.6);
  g.translate(final.x + final.w * 0.82 + 140 * U + prog(t, 2.2, 2.6) * 300 * U, final.y + final.h * 0.05 - 120 * U - prog(t, 2.2, 2.6) * 200 * U);
  g.rotate(0.15 + prog(t, 2.2, 2.6) * 2);
  g.imageSmoothingEnabled = false;
  g.drawImage(PICK, -pw * 0.2, -pw * 0.8, pw, pw);
  g.restore();
  // the promise, a word at a time
  const ty = r.y + r.h + (PORTRAIT ? 150 : 110) * U;
  const size = (PORTRAIT ? 96 : 84) * U;
  g.save();
  g.translate(0, -leave * H * 0.4);
  kinetic('DEPLOY SOL.', W / 2, ty, size, t, 2.35, { color: WHITE, shadow: '#00000088', out: 3.7 });
  kinetic('STRIKE GOLD.', W / 2, ty + size * 1.05, size, t, 2.7, { color: GOLD, shadow: '#3a1800', out: 3.72 });
  g.globalAlpha = prog(t, 3.1, 3.4) * (1 - prog(t, 3.6, 3.8));
  font(30 * U, BODY);
  g.textAlign = 'center';
  g.fillStyle = MUTED;
  g.fillText('A PIXEL MINING GAME ON SOLANA', W / 2, ty + size * 1.05 + 70 * U);
  g.restore();
}

/** The block wipe from the intro onto the island. */
function blockWipe(t: number, t0: number, dur: number, reverse = false) {
  const p = prog(t, t0, t0 + dur);
  if (p <= 0 || p >= 1) return p >= 1 !== reverse;
  const cell = 60 * U;
  const cols = Math.ceil(W / cell);
  const rows = Math.ceil(H / cell);
  g.fillStyle = NAVY;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const d = (x / cols) * 0.5 + (y / rows) * 0.5;
      const k = clamp01((p * 1.6 - d * 0.6) / 1);
      const s = reverse ? outCubic(k) : 1 - outCubic(k);
      if (s <= 0) continue;
      const w = cell * s;
      g.fillRect(x * cell + (cell - w) / 2, y * cell + (cell - w) / 2, Math.ceil(w), Math.ceil(w));
    }
  return true;
}

function sceneIsland(t: number) {
  // 4.3 - 8.0 welcome, then the claims introduce themselves
  const topY = PORTRAIT ? 270 * U : 70 * U;
  if (t < 8.1) {
    const sz = (PORTRAIT ? 64 : 48) * U;
    kinetic('WELCOME TO', W / 2, topY + sz, sz * 0.55, t, 4.6, { fam: BODY, color: MUTED, spacing: 0.25, out: 7.7 });
    kinetic('GALI ISLAND', W / 2, topY + sz * 2.4, sz * 1.9, t, 4.8, { color: GOLD, shadow: '#3a1800', stagger: 0.05, out: 7.75 });
  }
  // the 25 claims ping in a wave with a counter
  if (t > 6.0 && t < 8.2) {
    const order = CLAIMS.map((c, i) => [i, c.cx + c.cy * 0.4] as const).sort((a, b) => a[1] - b[1]);
    let n = 0;
    order.forEach(([i], k) => {
      const t0 = 6.1 + k * 0.045;
      if (t >= t0) n++;
      const [x, y] = onScreen(i);
      tapRipple(x, y, t, t0);
    });
    const a = prog(t, 6.0, 6.2) * (1 - prog(t, 7.8, 8.1));
    g.save();
    g.globalAlpha = a;
    const y = PORTRAIT ? H - 470 * U : H - 110 * U;
    const big = (PORTRAIT ? 150 : 110) * U;
    const numW = textW('25', big);
    const labW = textW(' CLAIMS', big * 0.5);
    const x0 = W / 2 - (numW + labW) / 2;
    font(big);
    g.textAlign = 'right';
    g.fillStyle = TEAL;
    g.fillText(String(n), x0 + numW, y);
    font(big * 0.5);
    g.fillStyle = WHITE;
    g.textAlign = 'left';
    g.fillText(' CLAIMS', x0 + numW, y);
    font(26 * U, BODY);
    g.textAlign = 'center';
    g.fillStyle = MUTED;
    g.fillText('ONE ROUND EVERY MINUTE', W / 2, y + 56 * U);
    g.restore();
  }
}

function sceneSteps(t: number) {
  stepCard('01', 'PICK YOUR CLAIMS', 'TAP A CLAIM TO LOOK INSIDE · HOLD TO PICK', t, 8.05, 9.95);
  // a finger on the glass
  if (t > 7.95 && t < 10.25) {
    const path = PICKS.map((i) => onScreen(i));
    let fx: number;
    let fy: number;
    const k = PICK_AT.findIndex((a) => t < a);
    const i = k < 0 ? PICKS.length - 1 : k;
    const from = i === 0 ? [W * 0.75, H * 0.85] : path[i - 1];
    const to = path[i];
    const t0 = i === 0 ? 7.95 : PICK_AT[i - 1];
    const e = inOut(prog(t, t0 + 0.05, PICK_AT[i] - 0.05));
    fx = lerp(from[0], to[0], e);
    fy = lerp(from[1], to[1], e);
    if (k < 0) {
      fx = path[4][0] + prog(t, 9.9, 10.25) * 200 * U;
      fy = path[4][1] + prog(t, 9.9, 10.25) * 400 * U;
    }
    const press = PICK_AT.some((a) => t >= a - 0.08 && t < a + 0.12);
    g.save();
    g.globalAlpha = prog(t, 7.95, 8.1) * (1 - prog(t, 10.0, 10.25));
    g.fillStyle = '#ffffffcc';
    g.strokeStyle = '#070d20';
    g.lineWidth = 5 * U;
    g.beginPath();
    g.arc(fx, fy, (press ? 26 : 34) * U, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.restore();
    PICK_AT.forEach((a, j) => {
      const [x, y] = path[j];
      tapRipple(x, y, t, a);
      ring(x, y, t, a, 0.5, 90, TEAL, 8);
    });
  }
  stepCard('02', 'DEPLOY SOL', 'YOUR SOL GOES ON THE CLAIMS YOU PICKED', t, 10.05, 11.95);
  // SOL coins arc from the bottom of the screen into each pick
  if (t > 10.0 && t < 11.4) {
    PICKS.forEach((i, k) => {
      const t0 = DEPLOY_AT - 0.35 + k * 0.08;
      const p = prog(t, t0, t0 + 0.45);
      if (p <= 0 || p >= 1) return;
      const [x1, y1] = onScreen(i);
      const x0 = W / 2;
      const y0 = H + 40 * U;
      const x = lerp(x0, x1, p);
      const y = lerp(y0, y1, p) - Math.sin(p * Math.PI) * 260 * U;
      coin(x, y, 30 * U, SOLG);
    });
  }
  if (t > 10.3 && t < 12.1) {
    const a = prog(t, 10.35, 10.6) * (1 - prog(t, 11.85, 12.1));
    const n = Math.min(5, Math.floor(prog(t, 10.3, 10.75) * 5 + 0.0001) + (t > 10.75 ? 1 : 0));
    g.save();
    g.globalAlpha = a;
    const y = PORTRAIT ? H - 470 * U : H - 100 * U;
    const big = (PORTRAIT ? 120 : 92) * U;
    font(big);
    g.textAlign = 'center';
    g.fillStyle = SOLG;
    g.fillText(`${(Math.min(5, n) * 0.01).toFixed(2)} SOL`, W / 2, y);
    font(26 * U, BODY);
    g.fillStyle = MUTED;
    g.fillText(`ON ${Math.min(5, n)} CLAIMS`, W / 2, y + 52 * U);
    g.restore();
  }
  // the countdown, one digit a beat
  ['3', '2', '1'].forEach((d, k) => {
    const t0 = 12.0 + k * 0.5;
    const p = prog(t, t0, t0 + 0.5);
    if (p <= 0 || p >= 1) return;
    const s = 1.6 - 0.6 * outBack(prog(t, t0, t0 + 0.22));
    g.save();
    g.globalAlpha = 1 - inCubic(prog(t, t0 + 0.3, t0 + 0.5));
    g.translate(W / 2, H * (PORTRAIT ? 0.47 : 0.52));
    g.scale(s, s);
    font(330 * U);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#00000077';
    g.fillText(d, 10 * U, 14 * U);
    g.fillStyle = k === 2 ? '#ff4d5e' : WHITE;
    g.fillText(d, 0, 0);
    g.restore();
  });
  if (t >= 13.45 && t < 14.0) {
    const p = prog(t, 13.45, 13.6);
    g.save();
    g.globalAlpha = p * (1 - prog(t, 13.85, 14.0));
    font(120 * U);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ff4d5e';
    g.fillText('LOCKED', W / 2, H * (PORTRAIT ? 0.47 : 0.52));
    g.restore();
  }
  stepCard('03', 'ONE CLAIM STRIKES GOLD', 'ITS MINERS SPLIT THE POT BY THEIR SOL', t, 14.0, 16.8);
  // STRUCK GOLD
  if (t >= 15.5 && t < 17.1) {
    if (lastSceneT < 15.5) {
      const [x, y] = onScreen(WINNER);
      burst(x, y, 140, 1500, [GOLD, '#fff1a8', '#ffffff', GOLD2, SOLG], 10, 1200, 1.6);
      shake = 1;
    }
    const [x, y] = onScreen(WINNER);
    ring(x, y, t, 15.5, 0.8, 700, '#fff1a8', 16);
    const s = 1 + 0.5 * (1 - outElastic(prog(t, 15.5, 16.3)));
    const out = inExpo(prog(t, 16.75, 17.05));
    const cy = PORTRAIT ? H * 0.68 : H * 0.8;
    g.save();
    g.translate(W / 2, cy);
    g.scale(s * (1 - out), s * (1 - out));
    font(150 * U);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // chromatic split on the landing frame
    const split = (1 - prog(t, 15.5, 15.75)) * 14 * U;
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = '#ff2255';
    g.fillText('STRUCK GOLD!', -split, 0);
    g.fillStyle = '#22ccff';
    g.fillText('STRUCK GOLD!', split, 0);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#3a1800';
    g.fillText('STRUCK GOLD!', 6 * U, 8 * U);
    const gg = g.createLinearGradient(0, -70 * U, 0, 70 * U);
    gg.addColorStop(0, '#fff2b8');
    gg.addColorStop(0.55, GOLD);
    gg.addColorStop(1, GOLD2);
    g.fillStyle = gg;
    g.fillText('STRUCK GOLD!', 0, 0);
    // the payout rolls up underneath
    const pay = 0.0377 * outCubic(prog(t, 15.9, 16.6));
    g.globalAlpha = prog(t, 15.85, 16.0);
    font(76 * U);
    g.fillStyle = SOLG;
    g.fillText(`+${pay.toFixed(4)} SOL`, 0, 118 * U);
    g.restore();
  }
}

function coin(x: number, y: number, r: number, color: string) {
  g.save();
  g.fillStyle = '#00000055';
  g.beginPath();
  g.arc(x + 4 * U, y + 6 * U, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#0a5a3c';
  g.lineWidth = 4 * U;
  g.stroke();
  font(r * 1.3, BODY);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#0a3a28';
  g.fillText('◎', x, y + 2 * U);
  g.restore();
}

function sceneInside(t: number) {
  stepCard('04', 'MINE ORE', 'EVERY ROUND MINES 1 ORE FOR THE WINNERS', t, 18.1, 20.1, PORTRAIT ? undefined : 380 * U);
  // ORE ticker on the pickaxe beats
  if (t > 18.3 && t < 21.9) {
    const a = prog(t, 18.3, 18.6) * (1 - prog(t, 21.6, 21.9));
    const hits = Math.max(0, Math.floor((t - 18.9) / 0.54));
    const val = 0.03 + hits * 0.0125;
    g.save();
    g.globalAlpha = a;
    const x = PORTRAIT ? W / 2 : 380 * U;
    const y = PORTRAIT ? H - 250 * U : H * 0.66;
    panel(x - 230 * U, y - 90 * U, 460 * U, 150 * U, a, SKR);
    font(88 * U);
    g.textAlign = 'center';
    g.fillStyle = SKR;
    g.fillText(`${val.toFixed(3)} ORE`, x, y + 10 * U);
    font(22 * U, BODY);
    g.fillStyle = MUTED;
    g.fillText('MINED THIS SESSION', x, y + 44 * U);
    g.restore();
  }
  // the motherlode meter
  if (t > 20.3 && t < 22.1) {
    const a = prog(t, 20.3, 20.55) * (1 - prog(t, 21.8, 22.1));
    const fill = outCubic(prog(t, 20.35, 20.95));
    const full = t >= 20.95;
    if (lastSceneT < 20.95 && t >= 20.95) {
      burst(PORTRAIT ? W / 2 : 380 * U, PORTRAIT ? 330 * U : H * 0.3, 120, 1400, [SKR, '#efffc9', GOLD, '#ffffff'], 9, 1100, 1.4);
      shake = 0.8;
    }
    g.save();
    g.globalAlpha = a;
    const cx = PORTRAIT ? W / 2 : 380 * U;
    const cy = PORTRAIT ? 300 * U : H * 0.3;
    const bw = (PORTRAIT ? 640 : 560) * U;
    panel(cx - bw / 2 - 30 * U, cy - 110 * U, bw + 60 * U, 250 * U, a, SKR);
    font(58 * U);
    g.textAlign = 'center';
    g.fillStyle = SKR;
    g.fillText('SKR MOTHERLODE', cx, cy - 36 * U);
    rr(cx - bw / 2, cy, bw, 44 * U, 10 * U);
    g.fillStyle = '#0c1734';
    g.fill();
    g.strokeStyle = '#2a4480';
    g.lineWidth = 3 * U;
    g.stroke();
    g.save();
    rr(cx - bw / 2, cy, bw * fill, 44 * U, 10 * U);
    g.clip();
    const gr = g.createLinearGradient(cx - bw / 2, 0, cx + bw / 2, 0);
    gr.addColorStop(0, '#7fbf3c');
    gr.addColorStop(1, SKR);
    g.fillStyle = gr;
    g.fillRect(cx - bw / 2, cy, bw, 44 * U);
    for (let k = 0; k < 12; k++) {
      g.fillStyle = '#ffffff44';
      g.fillRect(cx - bw / 2 + ((k * 70 + t * 300) % (bw + 70)) * U * 0 + ((k * 70 + t * 300 * U) % bw), cy + 6 * U, 20 * U, 8 * U);
    }
    g.restore();
    font(30 * U, BODY);
    g.fillStyle = full ? GOLD : WHITE;
    const s = full ? 1 + 0.15 * (1 - outElastic(prog(t, 20.95, 21.6))) : 1;
    g.translate(cx, cy + 100 * U);
    g.scale(s, s);
    g.fillText(full ? '1 IN 500 ROUNDS PAYS IT ALL' : 'EVERY ROUND ADDS TO THE POOL', 0, 0);
    g.restore();
  }
}

function sceneLiving(t: number) {
  if (t < 22.5 || t > 24.4) return;
  const a = prog(t, 22.5, 22.8) * (1 - prog(t, 24.1, 24.4));
  const y = PORTRAIT ? 330 * U : 110 * U;
  g.save();
  g.globalAlpha = a;
  kinetic('A LIVING ISLAND', W / 2, y, (PORTRAIT ? 110 : 90) * U, t, 22.55, { color: WHITE, shadow: '#000000aa', stagger: 0.04, out: 24.05 });
  font(28 * U, BODY);
  g.textAlign = 'center';
  g.fillStyle = MUTED;
  g.globalAlpha = a * prog(t, 23.0, 23.3);
  g.fillText('DAY · NIGHT · WEATHER · SHIPS · MINERS LIVE ON THE MAP', W / 2, y + 60 * U);
  g.restore();
  // a clock hand sweeping the sun down
}

function sceneGear(t: number) {
  if (t < 24.2 || t > 28.3) return;
  const a = prog(t, 24.2, 24.5) * (1 - prog(t, 27.95, 28.3));
  g.save();
  g.globalAlpha = a * 0.82;
  g.fillStyle = NAVY;
  g.fillRect(0, 0, W, H);
  g.restore();
  // spotlight
  g.save();
  g.globalAlpha = a;
  const sg = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.6);
  sg.addColorStop(0, '#2c56a855');
  sg.addColorStop(1, '#00000000');
  g.fillStyle = sg;
  g.fillRect(0, 0, W, H);
  // one row per kind, centred: pickaxes, helmets, outfits, pets
  const rowsOf = [GEAR_KEYS.slice(0, 6), GEAR_KEYS.slice(6, 12), GEAR_KEYS.slice(12, 17), GEAR_KEYS.slice(17)];
  const rows = rowsOf.length;
  const cell = (PORTRAIT ? 172 : 150) * U;
  const gy = H / 2 - (rows * cell) / 2 + (PORTRAIT ? 40 : 60) * U;
  const RC: Record<string, string> = { wood: '#b8c4d6', iron: '#b8c4d6', gold: '#4aa8ff', gem: '#b86bff', neon: '#ffb13d', seeker: '#ffb13d', yellow: '#b8c4d6', red: '#b8c4d6', teal: '#4aa8ff', songkok: '#b86bff', crown: '#ffb13d', astro: '#ffb13d', blue: '#b8c4d6', khaki: '#b8c4d6', batik: '#4aa8ff', hazard: '#b86bff', mole: '#b8c4d6', bat: '#4aa8ff', sprite: '#b86bff', firefly: '#ffb13d' };
  rowsOf.forEach((keys, row) => {
    keys.forEach((k, col) => {
      const i = row * 7 + col;
      const t0 = 24.55 + row * 0.32 + col * 0.07;
      const p = outBack(prog(t, t0, t0 + 0.5), 2.2);
      if (p <= 0) return;
      const bob = Math.sin(t * 4 + i) * 4 * U;
      const x = W / 2 - (keys.length * cell) / 2 + col * cell + cell / 2;
      const y = gy + row * cell + cell / 2 + bob;
      const sz = cell * 0.84 * p;
      const rc = RC[k.split('-')[1]] ?? '#b8c4d6';
      g.save();
      g.translate(x, y);
      g.rotate((1 - p) * 0.6);
      rr(-sz / 2, -sz / 2, sz, sz, 16 * U);
      g.fillStyle = '#0f1c3f';
      g.fill();
      const glint = Math.max(0, 1 - Math.abs(t - (26.1 + (row * 6 + col) * 0.07)) / 0.18);
      g.lineWidth = (5 + glint * 5) * U;
      g.strokeStyle = rc;
      if (glint > 0) {
        g.shadowColor = rc;
        g.shadowBlur = 30 * U * glint;
      }
      g.stroke();
      g.shadowBlur = 0;
      g.imageSmoothingEnabled = false;
      const is = sz * 0.8;
      g.drawImage(GEAR[k], -is / 2, -is / 2, is, is);
      g.restore();
    });
  });
  const ty = PORTRAIT ? gy - 120 * U : gy - 70 * U;
  kinetic('GEAR UP', W / 2, ty, (PORTRAIT ? 130 : 100) * U, t, 24.3, { color: GOLD, shadow: '#3a1800', out: 27.95, stagger: 0.06, dur: 0.55 });
  g.globalAlpha = a * prog(t, 25.9, 26.3);
  font(28 * U, BODY);
  g.textAlign = 'center';
  g.fillStyle = MUTED;
  g.fillText('21 PICKAXES, HELMETS, OUTFITS AND PETS · COSMETIC ONLY', W / 2, gy + rows * cell + 50 * U);
  g.restore();
}

function sceneEnd(t: number) {
  if (t < 28.0) return;
  const a = prog(t, 28.0, 28.35);
  g.save();
  g.globalAlpha = a * 0.78;
  g.fillStyle = NAVY;
  g.fillRect(0, 0, W, H);
  g.restore();
  const cy = PORTRAIT ? H * 0.38 : H * 0.36;
  const hit = 28.6;
  if (lastSceneT < hit && t >= hit) {
    const r = logoRect(1, cy);
    burst(W / 2, cy, 120, 1300, [GOLD, '#fff1a8', '#ffffff', GOLD2], 9, 1100, 1.3);
    shake = 1;
    void r;
  }
  if (t >= hit - 0.25) {
    const p = prog(t, hit - 0.25, hit);
    const s = t < hit ? lerp(2.4, 1.1, inCubic(p)) : 1.1 - 0.1 * outElastic(prog(t, hit, hit + 0.9));
    const r = logoRect(s, cy);
    ring(W / 2, cy, t, hit, 0.8, 1200, GOLD, 12);
    drawLogo(r, t < 31 ? prog(t, 29.1, 30.0) : prog(t, 32.2, 33.1), clamp01(p * 2));
  }
  const ty = cy + (PORTRAIT ? 310 : 250) * U;
  const size = (PORTRAIT ? 70 : 60) * U;
  kinetic('DEPLOY SOL', W / 2, ty, size, t, 29.3, { color: WHITE, stagger: 0.05, dur: 0.55 });
  kinetic('STRIKE GOLD', W / 2, ty + size * 1.05, size, t, 30.0, { color: GOLD, stagger: 0.05, dur: 0.55 });
  kinetic('MINE ORE', W / 2, ty + size * 2.1, size, t, 30.7, { color: SKR, stagger: 0.05, dur: 0.55 });
  g.save();
  g.globalAlpha = prog(t, 31.5, 32.0);
  const by = ty + size * 2.1 + 110 * U;
  const label = 'BUILT FOR SOLANA SEEKER';
  font(34 * U, BODY);
  const bw = g.measureText(label).width + 80 * U;
  rr(W / 2 - bw / 2, by - 44 * U, bw, 70 * U, 35 * U);
  g.fillStyle = '#0c1734';
  g.fill();
  g.strokeStyle = SOLG;
  g.lineWidth = 3 * U;
  g.stroke();
  g.textAlign = 'center';
  g.fillStyle = WHITE;
  g.fillText(label, W / 2, by + 2 * U);
  g.restore();
  // fade to black on the last beat
  g.save();
  g.globalAlpha = prog(t, 34.2, 35);
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  g.restore();
}

/* ---------------- one frame ---------------- */
let lastSceneT = -1;
let prevT = 0;
function render(frame: number) {
  const t = frame / FPS;
  clock.ms = t * 1000;
  drive(t);
  engine.push(snapshot(t));
  const dt = Math.max(1 / FPS, t - prevT);
  prevT = t;
  // shake decays; everything below it is offset
  const sx = shake > 0.01 ? (Math.random() - 0.5) * 40 * U * shake : 0;
  const sy = shake > 0.01 ? (Math.random() - 0.5) * 40 * U * shake : 0;
  shake *= 0.86;

  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  g.translate(sx, sy);

  if (t >= 3.9) {
    E.frame(clock.ms);
    g.imageSmoothingEnabled = false;
    const windowed = !PORTRAIT && t >= DIVE_AT && t < EXIT_AT;
    if (windowed) {
      // landscape: the diorama opens in a framed window on the right
      if (islandStill) {
        g.save();
        g.filter = 'blur(14px) brightness(0.45) saturate(1.2)';
        g.drawImage(islandStill, -40, -40, W + 80, H + 80);
        g.restore();
      }
      const inK = outExpo(prog(t, DIVE_AT, DIVE_AT + 0.6));
      const outK = inExpo(prog(t, EXIT_AT - 0.3, EXIT_AT));
      const side = H * 0.86;
      const x = W - side - 70 * U + (1 - inK) * (side + 120 * U);
      const y = (H - side) / 2;
      const sc = 1 + outK * 0.25;
      g.save();
      g.translate(x + side / 2, y + side / 2);
      g.scale(sc, sc);
      g.globalAlpha = 1 - outK;
      g.shadowColor = '#000000cc';
      g.shadowBlur = 60 * U;
      rr(-side / 2, -side / 2, side, side, 26 * U);
      g.fillStyle = NAVY;
      g.fill();
      g.shadowBlur = 0;
      g.save();
      rr(-side / 2, -side / 2, side, side, 26 * U);
      g.clip();
      g.drawImage(game, 0, 0, game.width, game.height, -side / 2, -side / 2, side, side);
      g.restore();
      rr(-side / 2, -side / 2, side, side, 26 * U);
      g.lineWidth = 6 * U;
      g.strokeStyle = '#c9a24e';
      g.stroke();
      g.restore();
      if (t >= EXIT_AT - 0.12) {
        g.fillStyle = `rgba(255,248,220,${prog(t, EXIT_AT - 0.12, EXIT_AT)})`;
        g.fillRect(0, 0, W, H);
      }
    } else g.drawImage(game, 0, 0, game.width, game.height, 0, 0, W, H);
    if (!PORTRAIT && t >= EXIT_AT && t < EXIT_AT + 0.35) {
      g.fillStyle = `rgba(255,248,220,${1 - prog(t, EXIT_AT, EXIT_AT + 0.35)})`;
      g.fillRect(0, 0, W, H);
    }
    // a soft vignette keeps the eye in the middle
    const v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, '#00000000');
    v.addColorStop(1, '#000000aa');
    g.fillStyle = v;
    g.fillRect(-50, -50, W + 100, H + 100);
    sceneIsland(t);
    sceneSteps(t);
    sceneInside(t);
    sceneLiving(t);
    sceneGear(t);
    sceneEnd(t);
  }
  if (t < 4.6) {
    if (t < 4.0) sceneIntro(t);
    else {
      // hold the last intro frame under the block wipe
      blockWipe(t, 4.0, 0.6);
    }
  }
  stepSparks(dt);
  lastSceneT = t;
}

(window as unknown as Record<string, unknown>).gali = {
  ready: load().then(() => true),
  render,
  frames: FPS * DUR,
  grab: (quality = 0.93) => out.toDataURL('image/jpeg', quality),
};
