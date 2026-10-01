/**
 * GALI, the intro film.
 *
 * The island, the miners, the water and the dive into a claim are the real game
 * engine, driven by a script instead of a player. Everything laid over it (the
 * logo build, the kinetic type, the step cards, the counters, the transitions)
 * is drawn here. The page renders one frame per call so a headless browser can
 * step through it at exactly 30 fps and hand each frame to ffmpeg.
 *
 * Timing is written in beats. The score runs at 111.1 BPM, a beat every 0.54 s,
 * which is also exactly one pickaxe swing in the engine, so the miners dig in
 * time with the music. Scenes change on bar lines (every 4 beats).
 */
import { clock } from './clock';
import { Engine } from '../../app/src/engine/engine';
import art from '../../app/src/engine/art.json';
import type { EngineEvent, Look, PeerView, Snapshot } from '../../app/src/engine/types';

const q = new URLSearchParams(location.search);
const W = Number(q.get('w') ?? 1080);
const H = Number(q.get('h') ?? 1920);
const PORTRAIT = H > W;
const U = Math.min(W, H) / 1080; // layout unit
const FPS = 30;

/* ---------------- the timeline, in beats ---------------- */
export const BEAT = 0.54;
const b = (n: number) => n * BEAT;
const T = {
  hit: b(4), // the pickaxe strikes the logo
  tagA: b(4.75),
  tagB: b(5.5),
  sub: b(6.5),
  introOut: b(7.25),
  wipe: b(7.5), // block wipe onto the island, lands on b8
  island: b(8),
  welcome: b(9),
  wave: b(12.5),
  welcomeOut: b(15),
  s1: b(16),
  picks: [17, 18, 19, 20, 21].map(b),
  s1Out: b(23.25),
  s2: b(24),
  deploy: b(24.5),
  s2Out: b(27.25),
  count: [28, 29, 30].map(b),
  locked: b(31),
  settle: b(32),
  s3: b(32),
  strike: b(36),
  s3Out: b(39),
  dive: b(39.5),
  s4: b(41),
  dig: b(40.25), // a new round starts as the dive settles; you're mining this claim
  s4Out: b(44.75),
  ml: b(45.5),
  mlFull: b(48),
  mlOut: b(51.25),
  exit: b(52),
  living: b(52.75),
  lapse: [b(53), b(59)],
  livingOut: b(59.25),
  shutIn: b(59.5), // shutters close over the island, open on the gear
  gear: b(60),
  glint: b(64),
  gearOut: b(67.25),
  end: b(68),
  line1: b(70),
  line2: b(71),
  line3: b(72),
  badge: b(74),
  sweep2: b(76),
  fade: b(79),
  total: b(81),
};
const REVEAL_AT = T.strike - 1.1; // the engine shows gold 1.1 s into its reveal
const DUR = T.total;

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
const prog = (t: number, a: number, c: number) => clamp01((t - a) / (c - a));
const outCubic = (x: number) => 1 - Math.pow(1 - x, 3);
const inCubic = (x: number) => x * x * x;
const inOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const outExpo = (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
const inExpo = (x: number) => (x <= 0 ? 0 : Math.pow(2, 10 * x - 10));
const outBack = (x: number, s = 1.9) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2);
const outElastic = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1);
const lerp = (a: number, c: number, k: number) => a + (c - a) * k;
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

/** Sounds the engine asks for, with their times, so the score can put a clink under every swing. */
const events: { t: number; name: string }[] = [];
const engine = new Engine(game, (e: EngineEvent) => {
  if (e.t === 'sfx') events.push({ t: clock.ms / 1000, name: e.name });
});
const E = engine as unknown as {
  frame: (t: number) => void;
  cam: { ox: number; oy: number; z: number; fitZ: number; cx: number; cy: number; hold: boolean; userZoomed: boolean; home: (ms: number) => void; flyTo: (x: number, y: number, z: number, ms: number) => void };
  perfFrom: number;
  mode: string;
  visit: unknown;
  sky: { setTime: (f: number) => void; night: number };
};

const CLAIMS = art.island.claims;
/** A claim's centre on the video frame. */
const onScreen = (i: number): [number, number] => {
  const c = CLAIMS[i];
  return [(E.cam.ox + c.cx * E.cam.z) * 2, (E.cam.oy + c.cy * E.cam.z) * 2];
};

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
const logoPts: { x: number; y: number; c: string }[] = [];

async function load() {
  const fonts = [new FontFace(DISPLAY, 'url(fonts/Jersey15_400Regular.woff2)'), new FontFace(BODY, 'url(fonts/ChakraPetch_700Bold.woff2)')];
  for (const f of fonts) document.fonts.add(await f.load());
  LOGO = await img('wordmark.png');
  PICK = await img('gear/pick-gold.png');
  await Promise.all(GEAR_KEYS.map(async (k) => (GEAR[k] = await img(`gear/${k}.png`))));
  // points of the logo for the particle build
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
const WINNER = 7;
const mask = (ids: number[]) => ids.reduce((m, i) => m | (1 << i), 0);
const others = Array.from({ length: 25 }, (_, i) => 0.004 + hash(i * 3.7) * 0.07);

const LOOK: Look = { hat: 'hat-songkok', fit: '#7a2f5c', pick: '#ffc83d', handle: '#5a3a24', pet: 'pet-firefly', glow: 'rare' };
const BOTS: { id: string; name: string; look: Look; route: number[] }[] = [
  { id: 'b1', name: 'Ayu', look: { hat: 'hat-red', fit: '#2f5fd0', pick: '#b8c4d6', handle: '#6b4a32', pet: null, glow: 'none' }, route: [10, 13, 18, 24] },
  { id: 'b2', name: 'Raj', look: { hat: 'hat-teal', fit: '#8a7a4a', pick: '#3de0c8', handle: '#2b2140', pet: 'pet-bat', glow: 'epic' }, route: [15, 16, 19, 9] },
  { id: 'b3', name: 'Mei', look: { hat: 'hat-crown', fit: '#e0a92a', pick: '#ff4fd8', handle: '#1a1a2e', pet: null, glow: 'legendary' }, route: [0, 2, 14, 22] },
  { id: 'b4', name: 'Tomi', look: { hat: 'hat-astro', fit: '#ff7a00', pick: '#c7f284', handle: '#10151f', pet: 'pet-sprite', glow: 'legendary' }, route: [5, 11, 6, 8] },
];
/** Bots walk a loop of claims, then swing a while at each. */
function bots(t: number): PeerView[] {
  return BOTS.map((bt, k) => {
    const leg = b(8);
    const u = t + k * b(2.5);
    const n = Math.floor(u / leg);
    const f = u / leg - n;
    const a = CLAIMS[bt.route[n % bt.route.length]].stand;
    const c = CLAIMS[bt.route[(n + 1) % bt.route.length]].stand;
    const walking = f < 0.5;
    const w = walking ? inOut(f / 0.5) : 1;
    const x = lerp(a[0], c[0], w);
    const y = lerp(a[1], c[1], w);
    return { id: bt.id, name: `BOT ${bt.name.toUpperCase()}`, x, y, tx: x, ty: y, facing: c[0] >= a[0] ? 1 : -1, pose: walking ? 'walk' : 'swing', look: bt.look, tone: 'bot', emoji: null } as PeerView;
  });
}

const inside = (t: number) => t >= T.dive && t < T.exit;

function snapshot(t: number): Snapshot {
  const view = PORTRAIT ? (inside(t) ? { top: 185, bottom: 150 } : { top: 250, bottom: 250 }) : inside(t) ? { top: 30, bottom: 30 } : { top: 108, bottom: 78 };
  const selected = t < T.deploy ? PICKS.filter((_, k) => t >= T.picks[k]) : [];
  let pending = t >= T.deploy && t < T.dive + 0.2 ? mask(PICKS) : 0;
  if (t >= T.dig && t < T.end) pending = mask([WINNER]);
  const heat = prog(t, T.s1 + 1, T.count[0]);
  const round2 = t >= T.dig;
  const perBlock = others.map((v, i) => (round2 ? (i === WINNER ? 0.062 : v * 0.6) : v * heat) + (pending & (1 << i) ? 0.01 : 0));
  const mine = perBlock.map((_, i) => (pending & (1 << i) ? 0.01 : 0));
  let phase = 'mining';
  if (!round2 && t >= T.settle) phase = t >= REVEAL_AT ? 'reveal' : 'settling';
  return {
    view,
    phase,
    roundId: round2 ? 45801 : 45800,
    roundEndsAt: Date.now() + 40_000,
    lockMs: 3000,
    settleStartAt: clock.ms - (t - T.settle) * 1000,
    revealStartAt: clock.ms - (t - REVEAL_AT) * 1000,
    winner: phase === 'reveal' ? WINNER : null,
    motherlode: false,
    caveIn: false,
    selected,
    pending,
    solo: 0,
    perBlock: perBlock.map((v) => Math.round(v * 1e5) / 1e5),
    mine,
    me: { look: LOOK, emoji: null, emoteAt: t >= T.end && t < T.fade ? clock.ms - (t - T.end) * 1000 : 0, name: 'You' },
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
  if (cue(0)) E.sky.setTime(0.47);
  if (cue(T.wipe)) {
    // start low over the water off the south beach, then pull back to the whole island
    E.cam.cx = 150;
    E.cam.cy = 205;
    E.cam.z = E.cam.fitZ * 5.2;
    E.cam.hold = true;
    E.cam.flyTo(150, 205, E.cam.fitZ * 5.2, 10);
  }
  if (cue(T.island)) E.cam.home(b(6) * 1000);
  if (cue(T.dive - 0.08) && !PORTRAIT) {
    // keep what the island looked like, blurred, as the backdrop for the window
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    cv.getContext('2d')!.drawImage(game, 0, 0, W, H);
    islandStill = cv;
  }
  if (cue(T.dive)) {
    if (!PORTRAIT) game.style.width = `${H / 2}px`; // a square stage for the diorama
    engine.setFocus(WINNER);
  }
  if (cue(T.dig + 0.05)) {
    // we arrive to find ourselves already at the face, swinging with the crowd
    const v = E.visit as { me: { x: number; y: number; path: unknown[]; pose: string; since: number; facing: number } } | null;
    if (v) Object.assign(v.me, { x: 152, y: 205, path: [], pose: 'swing', since: clock.ms, facing: 1 });
  }
  if (cue(T.exit)) {
    // both formats cut back to the island under the same flash
    if (!PORTRAIT) game.style.width = `${W / 2}px`;
    engine.setFocus(-1);
    E.mode = 'island';
    E.visit = null;
  }
  if (t >= T.lapse[0] && t <= T.lapse[1] + 0.2) E.sky.setTime(0.52 + inOut(prog(t, T.lapse[0], T.lapse[1])) * 0.43);
  if (cue(T.shutIn + b(0.4))) E.sky.setTime(0.3); // dawn behind the shutters, ready for the end card
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
/** Text that arrives a letter at a time, each dropping in with overshoot, and leaves by lifting away. */
function kinetic(s: string, cx: number, y: number, size: number, t: number, t0: number, opts: { fam?: string; color?: string; stagger?: number; dur?: number; out?: number; shadow?: string; spacing?: number } = {}) {
  const fam = opts.fam ?? DISPLAY;
  const stagger = opts.stagger ?? 0.035;
  const dur = opts.dur ?? 0.45;
  const spacing = (opts.spacing ?? 0) * size;
  font(size, fam);
  const widths = [...s].map((ch) => g.measureText(ch).width + spacing);
  const total = widths.reduce((a, c) => a + c, 0) - spacing;
  let x = cx - total / 2;
  [...s].forEach((ch, i) => {
    const p = prog(t, t0 + i * stagger, t0 + i * stagger + dur);
    // leave in the same order, a touch quicker
    const q2 = opts.out !== undefined ? prog(t, opts.out + i * stagger * 0.5, opts.out + i * stagger * 0.5 + 0.28) : 0;
    if (p <= 0 || q2 >= 1) {
      x += widths[i];
      return;
    }
    const e = outBack(p);
    g.save();
    g.globalAlpha = clamp01(p * 3) * (1 - q2);
    g.translate(x + widths[i] / 2, y + (1 - e) * size * 0.7 - inCubic(q2) * size * 0.6);
    const sc = (0.6 + 0.4 * e) * (1 - q2 * 0.3);
    g.scale(sc, sc);
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
function goldFill(y: number, h: number) {
  const gg = g.createLinearGradient(0, y, 0, y + h);
  gg.addColorStop(0, '#fff2b8');
  gg.addColorStop(0.5, GOLD);
  gg.addColorStop(1, GOLD2);
  return gg;
}

/**
 * "01  PICK YOUR SPOTS": a numbered card. The gold number tile lands first, then
 * the title panel unrolls out of it; on the way out it snaps shut and flies left.
 */
function stepCard(n: string, title: string, sub: string, t: number, t0: number, t1: number, at?: number) {
  if (t < t0 || t > t1 + 0.45) return;
  const tile = outBack(prog(t, t0, t0 + 0.32), 2.2);
  const unroll = outExpo(prog(t, t0 + 0.12, t0 + 0.6));
  const shut = inCubic(prog(t, t1, t1 + 0.2));
  const fly = inExpo(prog(t, t1 + 0.15, t1 + 0.45));
  const size = (PORTRAIT ? 92 : 72) * U;
  const numW = textW(n, size * 1.1) + 48 * U;
  const titleW = textW(title, size);
  const subSize = size * 0.34;
  const w = numW + titleW + 64 * U;
  const h = size * 1.35;
  const cx = at ?? W / 2;
  const y = PORTRAIT ? 250 * U : at !== undefined ? 150 * U : 44 * U;
  const x = cx - w / 2 - fly * W * 0.9;
  const open = unroll * (1 - shut);
  g.save();
  g.globalAlpha = 1 - fly * 0.6;
  // the panel behind the title unrolls from the tile
  if (open > 0.01) {
    g.save();
    g.beginPath();
    g.rect(x - 40 * U, y - 60 * U, numW + (w - numW + 40 * U) * open + 40 * U, h + 140 * U);
    g.clip();
    panel(x, y, w, h);
    font(size);
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = WHITE;
    g.fillText(title, x + numW + 28 * U - (1 - open) * 60 * U, y + h / 2 + 4 * U);
    g.restore();
  }
  // the number tile, which pops in and takes a little bounce
  const s = tile;
  g.save();
  g.translate(x + numW / 2, y + h / 2);
  g.scale(s, s);
  g.rotate((1 - tile) * -0.4);
  rr(-numW / 2 + 12 * U, -h / 2 + 12 * U, numW - 24 * U, h - 24 * U, 12 * U);
  g.shadowColor = '#00000088';
  g.shadowBlur = 20 * U;
  g.fillStyle = goldFill(-h / 2, h);
  g.fill();
  g.shadowBlur = 0;
  font(size * 1.1);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#3a1800';
  g.fillText(n, 0, 4 * U);
  g.restore();
  g.restore();
  if (sub) {
    g.save();
    g.globalAlpha = prog(t, t0 + 0.4, t0 + 0.75) * (1 - prog(t, t1 - 0.1, t1 + 0.1));
    font(subSize, BODY);
    g.textAlign = 'center';
    g.fillStyle = MUTED;
    g.fillText(sub, cx, y + h + subSize * 1.6 + (1 - prog(t, t0 + 0.4, t0 + 0.75)) * 12 * U);
    g.restore();
  }
}

/* ---------------- overlay particles and effects ---------------- */
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
/** Square ripple for a tap on the island. */
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
/** Speed lines radiating from a point: behind a slam, or pulling into a dive. */
function speedLines(cx: number, cy: number, k: number, color: string, inward = false, seed = 1) {
  if (k <= 0) return;
  g.save();
  g.strokeStyle = color;
  const R = Math.hypot(W, H);
  for (let i = 0; i < 48; i++) {
    const a = hash(i * 7.3 + seed) * Math.PI * 2;
    const r0 = (0.18 + hash(i + seed * 3) * 0.25) * R * (inward ? 1 - k * 0.6 : 1);
    const len = (0.15 + hash(i * 2 + seed) * 0.35) * R * k;
    g.globalAlpha = k * (0.25 + hash(i * 5 + seed) * 0.45);
    g.lineWidth = (2 + hash(i * 9 + seed) * 6) * U;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    g.lineTo(cx + Math.cos(a) * (r0 + len), cy + Math.sin(a) * (r0 + len));
    g.stroke();
  }
  g.restore();
}
function flash(k: number, color = '255,248,220') {
  if (k <= 0) return;
  g.fillStyle = `rgba(${color},${k})`;
  g.fillRect(-60, -60, W + 120, H + 120);
}
/** Horizontal shutters that close from alternate sides, then open again. */
function shutters(close: number, open: number) {
  const n = 8;
  const hh = H / n;
  for (let i = 0; i < n; i++) {
    const delay = i * 0.06;
    const c = inOut(clamp01((close - delay) / (1 - 0.06 * n + 0.06)));
    const o = inOut(clamp01((open - delay) / (1 - 0.06 * n + 0.06)));
    const cover = c * (1 - o);
    if (cover <= 0) continue;
    const w = W * cover;
    const fromLeft = i % 2 === 0;
    const x = o > 0 ? (fromLeft ? W - w : 0) : fromLeft ? 0 : W - w;
    g.fillStyle = i % 2 ? '#0c1734' : NAVY;
    g.fillRect(x, i * hh - 1, w, hh + 2);
    // a gold edge on each leading blade
    g.fillStyle = GOLD;
    const ex = o > 0 ? (fromLeft ? x : x + w - 6 * U) : fromLeft ? x + w - 6 * U : x;
    if (cover < 0.999) g.fillRect(ex, i * hh, 6 * U, hh);
  }
}

/* ---------------- scenes ---------------- */
function background(t: number) {
  const gr = g.createRadialGradient(W / 2, H * 0.45, 0, W / 2, H * 0.45, Math.max(W, H) * 0.75);
  gr.addColorStop(0, '#15285a');
  gr.addColorStop(1, NAVY);
  g.fillStyle = gr;
  g.fillRect(-60, -60, W + 120, H + 120);
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
    const bx = -r.w * 0.4 + inOut(sweep) * r.w * 1.8;
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
let lastSceneT = -1;
const crossed = (t: number, at: number) => lastSceneT < at && t >= at;

function sceneIntro(t: number) {
  background(t);
  const cy = PORTRAIT ? H * 0.42 : H * 0.4;
  const final = logoRect(1, cy);
  const pickAt = (k: number): [number, number, number] => {
    // the pick winds up from the top right and swings down onto the logo
    const ang = lerp(-2.4, 0.15, k);
    return [final.x + final.w * 0.82 + 140 * U, final.y + final.h * 0.05 - 120 * U, ang];
  };
  const pw = 190 * U;
  if (t < T.hit) {
    // pixels swirl in and settle into the logo
    const p = inOut(prog(t, 0.1, T.hit - 0.12));
    logoPts.forEach((pt, i) => {
      const tx = final.x + (pt.x + 0.5) * final.w;
      const ty = final.y + (pt.y + 0.5) * final.h;
      const a0 = hash(i) * Math.PI * 2;
      const r0 = (500 + hash(i + 1) * 900) * U;
      const spin = (1 - p) * (2.4 + hash(i + 2));
      const sx = W / 2 + Math.cos(a0 + spin) * r0 * (1 - p);
      const sy = cy + Math.sin(a0 + spin) * r0 * (1 - p) * 0.8;
      const s = Math.round((5 + 3 * (1 - p)) * U);
      g.globalAlpha = clamp01(prog(t, 0.1 + hash(i + 4) * 0.5, 0.6 + hash(i + 4) * 0.5));
      g.fillStyle = pt.c;
      g.fillRect(Math.round(lerp(sx, tx, p)), Math.round(lerp(sy, ty, p)), s, s);
    });
    g.globalAlpha = 1;
    if (t > T.hit - 0.4) drawLogo(final, 0, prog(t, T.hit - 0.4, T.hit - 0.05));
    const [px, py, ang] = pickAt(inCubic(prog(t, T.hit - 0.75, T.hit)));
    g.save();
    g.globalAlpha = prog(t, T.hit - 0.9, T.hit - 0.7);
    g.translate(px, py);
    g.rotate(ang);
    g.imageSmoothingEnabled = false;
    g.drawImage(PICK, -pw * 0.2, -pw * 0.8, pw, pw);
    g.restore();
    return;
  }
  if (crossed(t, T.hit)) {
    burst(final.x + final.w * 0.78, final.y + final.h * 0.2, 90, 1300, [GOLD, '#fff1a8', '#ffffff', GOLD2], 9, 1400, 1.2);
    shake = 1;
  }
  speedLines(W / 2, cy, 1 - prog(t, T.hit, T.hit + 0.35), '#fff1a8', false, 3);
  const slam = outElastic(prog(t, T.hit, T.hit + 0.9));
  const sc = 1.22 - 0.22 * slam;
  // leave the stage: shrink and rise, into the wipe
  const leave = inExpo(prog(t, T.introOut, T.wipe));
  const r = logoRect(sc * (1 - leave * 0.55), cy - leave * H * 0.6);
  ring(final.x + final.w * 0.78, final.y + final.h * 0.2, t, T.hit, 0.7, 900, '#fff1a8', 18);
  ring(W / 2, cy, t, T.hit + 0.05, 0.9, 1300, GOLD, 10);
  drawLogo(r, prog(t, T.tagA, T.tagA + 0.8), 1);
  // the pick, stuck in, then flicked away
  const k = prog(t, T.hit + 0.15, T.hit + 0.5);
  const [px, py] = pickAt(1);
  g.save();
  g.globalAlpha = 1 - k;
  g.translate(px + k * 300 * U, py - k * 200 * U);
  g.rotate(0.15 + k * 2);
  g.imageSmoothingEnabled = false;
  g.drawImage(PICK, -pw * 0.2, -pw * 0.8, pw, pw);
  g.restore();
  const ty = r.y + r.h + (PORTRAIT ? 150 : 110) * U;
  const size = (PORTRAIT ? 96 : 84) * U;
  kinetic('DEPLOY SOL.', W / 2, ty, size, t, T.tagA, { color: WHITE, shadow: '#00000088', out: T.introOut });
  kinetic('STRIKE GOLD.', W / 2, ty + size * 1.05, size, t, T.tagB, { color: GOLD, shadow: '#3a1800', out: T.introOut + 0.05 });
  g.save();
  g.globalAlpha = prog(t, T.sub, T.sub + 0.3) * (1 - prog(t, T.introOut, T.introOut + 0.2));
  font(30 * U, BODY);
  g.textAlign = 'center';
  g.fillStyle = MUTED;
  g.fillText('A PIXEL MINING GAME ON SOLANA', W / 2, ty + size * 1.05 + 70 * U);
  g.restore();
}

/** Blocks that shrink away in a diagonal wave, with a gold rim on the ones mid-flight. */
function blockWipe(t: number, t0: number, dur: number) {
  const p = prog(t, t0, t0 + dur);
  if (p >= 1) return;
  const cell = 60 * U;
  const cols = Math.ceil(W / cell) + 1;
  const rows = Math.ceil(H / cell) + 1;
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const d = (x / cols) * 0.5 + (1 - y / rows) * 0.5;
      const k = clamp01(p * 1.7 - d * 0.7);
      const s = 1 - outCubic(k);
      if (s <= 0) continue;
      const w = cell * s;
      const px = x * cell + (cell - w) / 2;
      const py = y * cell + (cell - w) / 2;
      g.fillStyle = NAVY;
      g.fillRect(px, py, Math.ceil(w), Math.ceil(w));
      if (k > 0.05 && k < 0.9) {
        g.strokeStyle = GOLD;
        g.globalAlpha = 1 - k;
        g.lineWidth = 3 * U;
        g.strokeRect(px, py, w, w);
        g.globalAlpha = 1;
      }
    }
}

function sceneIsland(t: number) {
  const topY = PORTRAIT ? 270 * U : 70 * U;
  if (t < T.s1) {
    const sz = (PORTRAIT ? 64 : 48) * U;
    kinetic('WELCOME TO', W / 2, topY + sz, sz * 0.55, t, T.welcome, { fam: BODY, color: MUTED, spacing: 0.25, out: T.welcomeOut });
    kinetic('GALI ISLAND', W / 2, topY + sz * 2.4, sz * 1.9, t, T.welcome + b(0.5), { color: GOLD, shadow: '#3a1800', stagger: 0.05, out: T.welcomeOut + 0.05 });
  }
  // the 25 claims ping in a wave, with a counter
  if (t > T.wave - 0.1 && t < T.s1 + 0.3) {
    const order = CLAIMS.map((c, i) => [i, c.cx + c.cy * 0.4] as const).sort((a, c) => a[1] - c[1]);
    let n = 0;
    order.forEach(([i], k) => {
      const t0 = T.wave + k * (b(2) / 25);
      if (t >= t0) n++;
      const [x, y] = onScreen(i);
      tapRipple(x, y, t, t0);
    });
    const a = prog(t, T.wave - 0.1, T.wave + 0.1) * (1 - prog(t, T.s1 - 0.25, T.s1));
    g.save();
    g.globalAlpha = a;
    const y = PORTRAIT ? H - 470 * U : H - 110 * U;
    const big = (PORTRAIT ? 150 : 110) * U;
    const numW = textW('25', big);
    const labW = textW(' SPOTS', big * 0.5);
    const x0 = W / 2 - (numW + labW) / 2;
    const bump = 1 + 0.12 * (1 - prog(t, T.wave + (n - 1) * (b(2) / 25), T.wave + (n - 1) * (b(2) / 25) + 0.12));
    g.save();
    g.translate(x0 + numW, y);
    g.scale(bump, bump);
    font(big);
    g.textAlign = 'right';
    g.fillStyle = TEAL;
    g.fillText(String(n), 0, 0);
    g.restore();
    font(big * 0.5);
    g.fillStyle = WHITE;
    g.textAlign = 'left';
    g.fillText(' SPOTS', x0 + numW, y);
    font(26 * U, BODY);
    g.textAlign = 'center';
    g.fillStyle = MUTED;
    g.fillText('ONE ROUND EVERY MINUTE', W / 2, y + 56 * U);
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

function sceneSteps(t: number) {
  stepCard('01', 'PICK YOUR SPOTS', 'TAP A SPOT TO PICK · DOUBLE TAP TO DIVE IN', t, T.s1, T.s1Out);
  // a finger on the glass, landing on the beat
  if (t > T.s1 && t < T.s2 + 0.2) {
    const path = PICKS.map((i) => onScreen(i));
    const k = T.picks.findIndex((a) => t < a);
    const i = k < 0 ? PICKS.length - 1 : k;
    const from = i === 0 ? [W * 0.75, H * 0.85] : path[i - 1];
    const to = path[i];
    const t0 = i === 0 ? T.s1 + 0.1 : T.picks[i - 1];
    const e = inOut(prog(t, t0 + 0.08, T.picks[i] - 0.06));
    let fx = lerp(from[0], to[0], e);
    let fy = lerp(from[1], to[1], e);
    if (k < 0) {
      fx = path[4][0] + prog(t, T.picks[4] + 0.2, T.s2) * 200 * U;
      fy = path[4][1] + prog(t, T.picks[4] + 0.2, T.s2) * 400 * U;
    }
    const press = T.picks.some((a) => t >= a - 0.08 && t < a + 0.12);
    g.save();
    g.globalAlpha = prog(t, T.s1, T.s1 + 0.2) * (1 - prog(t, T.s2 - 0.3, T.s2));
    g.fillStyle = '#ffffffcc';
    g.strokeStyle = NAVY;
    g.lineWidth = 5 * U;
    g.beginPath();
    g.arc(fx, fy, (press ? 26 : 34) * U, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.restore();
    T.picks.forEach((a, j) => {
      const [x, y] = path[j];
      tapRipple(x, y, t, a);
      ring(x, y, t, a, 0.5, 90, TEAL, 8);
    });
  }
  stepCard('02', 'DEPLOY SOL', 'YOUR SOL GOES ON THE SPOTS YOU PICKED', t, T.s2, T.s2Out);
  // SOL coins arc from the bottom of the screen into each pick, an eighth note apart
  if (t > T.s2 && t < T.s2Out) {
    PICKS.forEach((i, k) => {
      const land = T.deploy + k * b(0.5);
      const p = prog(t, land - 0.45, land);
      if (p <= 0 || p >= 1) return;
      const [x1, y1] = onScreen(i);
      coin(lerp(W / 2, x1, p), lerp(H + 40 * U, y1, p) - Math.sin(p * Math.PI) * 260 * U, 30 * U, SOLG);
    });
    PICKS.forEach((i, k) => {
      const [x, y] = onScreen(i);
      ring(x, y, t, T.deploy + k * b(0.5), 0.45, 70, SOLG, 7);
    });
  }
  if (t > T.deploy && t < T.s2Out + 0.3) {
    const a = prog(t, T.deploy, T.deploy + 0.25) * (1 - prog(t, T.s2Out, T.s2Out + 0.3));
    const n = Math.min(5, T.picks.length === 5 ? [0, 1, 2, 3, 4].filter((k) => t >= T.deploy + k * b(0.5)).length : 0);
    g.save();
    g.globalAlpha = a;
    const y = PORTRAIT ? H - 470 * U : H - 100 * U;
    const big = (PORTRAIT ? 120 : 92) * U;
    font(big);
    g.textAlign = 'center';
    g.fillStyle = SOLG;
    g.fillText(`${(n * 0.01).toFixed(2)} SOL`, W / 2, y);
    font(26 * U, BODY);
    g.fillStyle = MUTED;
    g.fillText(`ON ${n} SPOTS`, W / 2, y + 52 * U);
    g.restore();
  }
  // the countdown: one digit a beat, each slammed in over speed lines
  const cy = H * (PORTRAIT ? 0.47 : 0.52);
  ['3', '2', '1'].forEach((d, k) => {
    const t0 = T.count[k];
    const p = prog(t, t0, t0 + BEAT);
    if (p <= 0 || p >= 1) return;
    speedLines(W / 2, cy, 1 - prog(t, t0, t0 + 0.3), k === 2 ? '#ff4d5e' : '#ffffff', false, k + 5);
    const s = 1.7 - 0.7 * outBack(prog(t, t0, t0 + 0.2));
    g.save();
    g.globalAlpha = 1 - inCubic(prog(t, t0 + 0.34, t0 + BEAT));
    g.translate(W / 2, cy);
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
  if (t >= T.locked && t < T.settle + 0.3) {
    const p = outBack(prog(t, T.locked, T.locked + 0.18));
    g.save();
    g.globalAlpha = 1 - prog(t, T.settle, T.settle + 0.3);
    g.translate(W / 2, cy);
    g.scale(p, p);
    font(120 * U);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ff4d5e';
    g.fillText('LOCKED', 0, 0);
    g.restore();
  }
  stepCard('03', 'ONE SPOT STRIKES GOLD', "YOUR SOL COMES BACK, LESS ORE'S FEES", t, T.s3, T.s3Out);
  // STRUCK GOLD, on the downbeat
  if (t >= T.strike - 0.05 && t < T.dive + 0.3) {
    const [x, y] = onScreen(WINNER);
    if (crossed(t, T.strike)) {
      burst(x, y, 140, 1500, [GOLD, '#fff1a8', '#ffffff', GOLD2, SOLG], 10, 1200, 1.6);
      shake = 1;
    }
    flash(0.85 * (1 - prog(t, T.strike, T.strike + 0.12)));
    speedLines(x, y, 1 - prog(t, T.strike, T.strike + 0.5), '#fff1a8', false, 11);
    ring(x, y, t, T.strike, 0.8, 700, '#fff1a8', 16);
    const s = 1 + 0.5 * (1 - outElastic(prog(t, T.strike, T.strike + 0.9)));
    const out2 = inExpo(prog(t, T.s3Out, T.dive));
    const ty = PORTRAIT ? H * 0.68 : H * 0.8;
    g.save();
    g.translate(W / 2, ty);
    g.scale(s * (1 - out2), s * (1 - out2));
    font(150 * U);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const split = (1 - prog(t, T.strike, T.strike + 0.25)) * 14 * U;
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = '#ff2255';
    g.fillText('STRUCK GOLD!', -split, 0);
    g.fillStyle = '#22ccff';
    g.fillText('STRUCK GOLD!', split, 0);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#3a1800';
    g.fillText('STRUCK GOLD!', 6 * U, 8 * U);
    g.fillStyle = goldFill(-70 * U, 140 * U);
    g.fillText('STRUCK GOLD!', 0, 0);
    // the payout rolls up underneath, over one bar
    const pay = 0.0455 * outCubic(prog(t, T.strike + b(0.75), T.strike + b(2.5)));
    g.globalAlpha = prog(t, T.strike + b(0.6), T.strike + b(0.9));
    font(76 * U);
    g.fillStyle = SOLG;
    g.fillText(`${pay.toFixed(4)} SOL BACK`, 0, 118 * U);
    g.restore();
  }
  // the dive: lines rush inward toward the winning claim
  if (t >= T.dive - 0.2 && t < T.dive + 0.7) {
    const [x, y] = onScreen(WINNER);
    const k = Math.sin(Math.PI * prog(t, T.dive - 0.2, T.dive + 0.7));
    speedLines(PORTRAIT ? x : W / 2, PORTRAIT ? y : H / 2, k, '#ffffff', true, 21);
  }
}

function sceneInside(t: number) {
  if (t < T.dive || t > T.exit + 0.2) return;
  stepCard('04', 'MINE ORE', 'EVERY ROUND MINES 1 ORE FOR THE WINNERS', t, T.s4, T.s4Out, PORTRAIT ? undefined : 380 * U);
  // ORE ticker, one step per swing (a swing is a beat)
  if (t > T.s4 && t < T.exit) {
    const a = prog(t, T.s4 + 0.2, T.s4 + 0.5) * (1 - prog(t, T.mlOut, T.exit));
    const hits = Math.max(0, Math.floor((t - T.s4 - b(2)) / BEAT));
    const val = 0.03 + hits * 0.0125;
    const pulse = 1 + 0.08 * (1 - prog((t - T.s4 - b(2)) % BEAT, 0, 0.18));
    g.save();
    g.globalAlpha = a;
    const x = PORTRAIT ? W / 2 : 380 * U;
    const y = PORTRAIT ? H - 250 * U : H * 0.66;
    panel(x - 230 * U, y - 90 * U, 460 * U, 150 * U, a, SKR);
    g.translate(x, y);
    g.scale(hits > 0 ? pulse : 1, hits > 0 ? pulse : 1);
    font(88 * U);
    g.textAlign = 'center';
    g.fillStyle = SKR;
    g.fillText(`${val.toFixed(3)} ORE`, 0, 10 * U);
    font(22 * U, BODY);
    g.fillStyle = MUTED;
    g.fillText('MINED THIS SESSION', 0, 44 * U);
    g.restore();
  }
  // the motherlode meter
  if (t > T.ml && t < T.exit) {
    const a = prog(t, T.ml, T.ml + 0.3) * (1 - prog(t, T.mlOut, T.exit - 0.1));
    const fill = inOut(prog(t, T.ml + 0.1, T.mlFull));
    const full = t >= T.mlFull;
    const cx = PORTRAIT ? W / 2 : 380 * U;
    const cy = PORTRAIT ? 300 * U : H * 0.3;
    if (crossed(t, T.mlFull)) {
      burst(cx, cy, 120, 1400, [SKR, '#efffc9', GOLD, '#ffffff'], 9, 1100, 1.4);
      shake = 0.8;
    }
    const bw = (PORTRAIT ? 640 : 560) * U;
    g.save();
    g.globalAlpha = a;
    const pop = full ? 1 + 0.08 * (1 - outElastic(prog(t, T.mlFull, T.mlFull + 0.8))) : 1;
    g.translate(cx, cy);
    g.scale(pop, pop);
    g.translate(-cx, -cy);
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
    rr(cx - bw / 2, cy, bw * Math.max(0.001, fill), 44 * U, 10 * U);
    g.clip();
    const gr = g.createLinearGradient(cx - bw / 2, 0, cx + bw / 2, 0);
    gr.addColorStop(0, '#7fbf3c');
    gr.addColorStop(1, SKR);
    g.fillStyle = gr;
    g.fillRect(cx - bw / 2, cy, bw, 44 * U);
    for (let k = 0; k < 10; k++) {
      g.fillStyle = '#ffffff44';
      g.fillRect(cx - bw / 2 + ((k * 90 * U + t * 320 * U) % bw), cy + 6 * U, 22 * U, 8 * U);
    }
    g.restore();
    font(30 * U, BODY);
    g.fillStyle = full ? GOLD : WHITE;
    g.fillText(full ? '1 IN 500 ROUNDS PAYS IT ALL' : 'EVERY ROUND ADDS TO THE POOL', cx, cy + 100 * U);
    g.restore();
  }
}

function sceneLiving(t: number) {
  if (t < T.living || t > T.shutIn + 0.2) return;
  const y = PORTRAIT ? 330 * U : 110 * U;
  kinetic('A LIVING ISLAND', W / 2, y, (PORTRAIT ? 110 : 90) * U, t, T.living, { color: WHITE, shadow: '#000000aa', stagger: 0.045, dur: 0.5, out: T.livingOut });
  g.save();
  g.globalAlpha = prog(t, T.living + b(1.5), T.living + b(2.2)) * (1 - prog(t, T.livingOut, T.livingOut + 0.25));
  font(28 * U, BODY);
  g.textAlign = 'center';
  g.fillStyle = MUTED;
  g.fillText('DAY · NIGHT · WEATHER · SHIPS · MINERS LIVE ON THE MAP', W / 2, y + 60 * U);
  g.restore();
  // a clock face ticks the day away in the corner
  const k = prog(t, T.lapse[0], T.lapse[1]);
  if (k > 0 && k < 1) {
    const r = 46 * U;
    const cx = PORTRAIT ? W / 2 : W - 140 * U;
    const cy = PORTRAIT ? H - 300 * U : H - 140 * U;
    g.save();
    g.globalAlpha = Math.min(prog(t, T.lapse[0], T.lapse[0] + 0.3), 1 - prog(t, T.lapse[1] - 0.3, T.lapse[1]));
    g.strokeStyle = '#ffffffaa';
    g.lineWidth = 4 * U;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.stroke();
    const a = -Math.PI / 2 + inOut(k) * Math.PI * 2 * 1.5;
    g.lineWidth = 6 * U;
    g.strokeStyle = GOLD;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * r * 0.8, cy + Math.sin(a) * r * 0.8);
    g.stroke();
    g.restore();
  }
}

function sceneGear(t: number) {
  if (t < T.gear - 0.3 || t > T.end + 0.5) return;
  g.fillStyle = NAVY;
  g.fillRect(-60, -60, W + 120, H + 120);
  const sg = g.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.6);
  sg.addColorStop(0, '#2c56a855');
  sg.addColorStop(1, '#00000000');
  g.fillStyle = sg;
  g.fillRect(0, 0, W, H);
  const rowsOf = [GEAR_KEYS.slice(0, 6), GEAR_KEYS.slice(6, 12), GEAR_KEYS.slice(12, 17), GEAR_KEYS.slice(17)];
  const rows = rowsOf.length;
  const cell = (PORTRAIT ? 172 : 150) * U;
  const gy = H / 2 - (rows * cell) / 2 + (PORTRAIT ? 40 : 60) * U;
  const RC: Record<string, string> = { wood: '#b8c4d6', iron: '#b8c4d6', gold: '#4aa8ff', gem: '#b86bff', neon: '#ffb13d', seeker: '#ffb13d', yellow: '#b8c4d6', red: '#b8c4d6', teal: '#4aa8ff', songkok: '#b86bff', crown: '#ffb13d', astro: '#ffb13d', blue: '#b8c4d6', khaki: '#b8c4d6', batik: '#4aa8ff', hazard: '#b86bff', mole: '#b8c4d6', bat: '#4aa8ff', sprite: '#b86bff', firefly: '#ffb13d' };
  const leave = inExpo(prog(t, T.gearOut, T.end));
  rowsOf.forEach((keys, row) => {
    // each row lands on a beat, its items an eighth apart
    keys.forEach((k, col) => {
      const t0 = T.gear + b(0.5) + b(row) + col * b(0.125);
      const p = outBack(prog(t, t0, t0 + 0.45), 2.2);
      if (p <= 0) return;
      const i = row * 6 + col;
      const bob = Math.sin(t * 4 + i) * 4 * U;
      const x = W / 2 - (keys.length * cell) / 2 + col * cell + cell / 2;
      const y = gy + row * cell + cell / 2 + bob + leave * (i % 2 ? 1 : -1) * H * 0.7;
      const sz = cell * 0.84 * p;
      const rc = RC[k.split('-')[1]] ?? '#b8c4d6';
      const glint = Math.max(0, 1 - Math.abs(t - (T.glint + i * b(0.125))) / 0.18);
      g.save();
      g.translate(x, y);
      g.rotate((1 - p) * 0.6 + leave * (i % 2 ? 0.8 : -0.8));
      const gs = 1 + glint * 0.12;
      g.scale(gs, gs);
      rr(-sz / 2, -sz / 2, sz, sz, 16 * U);
      g.fillStyle = '#0f1c3f';
      g.fill();
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
      // once the glint has passed, each item carries an NFT tag: gear is tradeable
      const tag = outBack(prog(t, T.glint + i * b(0.125), T.glint + i * b(0.125) + 0.3), 2.4);
      if (tag > 0) {
        const tw = 46 * U * tag;
        const th = 22 * U * tag;
        g.imageSmoothingEnabled = true;
        rr(sz / 2 - tw * 0.82, -sz / 2 - th * 0.35, tw, th, 6 * U);
        g.fillStyle = GOLD;
        g.fill();
        font(15 * U * tag, BODY);
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = '#2a1a00';
        g.fillText('NFT', sz / 2 - tw * 0.32, -sz / 2 + th * 0.18);
      }
      g.restore();
    });
  });
  const ty = PORTRAIT ? gy - 120 * U : gy - 70 * U;
  kinetic('GEAR MARKET', W / 2, ty, (PORTRAIT ? 104 : 100) * U, t, T.gear, { color: GOLD, shadow: '#3a1800', out: T.gearOut, stagger: 0.045, dur: 0.55 });
  // "coming soon" sits over the title, so nobody takes the market for live
  {
    const a = prog(t, T.gear + b(1), T.gear + b(1.6)) * (1 - prog(t, T.gearOut, T.gearOut + 0.25));
    if (a > 0) {
      g.save();
      g.globalAlpha = a;
      font(24 * U, BODY);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const label = 'COMING SOON';
      const pw = g.measureText(label).width + 36 * U;
      const py = ty - (PORTRAIT ? 128 : 118) * U;
      rr(W / 2 - pw / 2, py - 20 * U, pw, 40 * U, 10 * U);
      g.fillStyle = GOLD;
      g.fill();
      g.fillStyle = '#2a1a00';
      g.fillText(label, W / 2, py + 2 * U);
      g.restore();
    }
  }
  g.save();
  g.globalAlpha = prog(t, T.gear + b(4.5), T.gear + b(5.2)) * (1 - prog(t, T.gearOut, T.gearOut + 0.25));
  font(28 * U, BODY);
  g.textAlign = 'center';
  g.fillStyle = MUTED;
  g.fillText('GEAR AS NFTS · MINT, TRADE, COLLECT · COSMETIC ONLY', W / 2, gy + rows * cell + 50 * U);
  g.restore();
}

function sceneEnd(t: number) {
  if (t < T.end - 0.3) return;
  g.save();
  g.globalAlpha = 0.78 + 0.22 * (1 - prog(t, T.end, T.end + 0.5));
  g.fillStyle = NAVY;
  g.fillRect(-60, -60, W + 120, H + 120);
  g.restore();
  const cy = PORTRAIT ? H * 0.38 : H * 0.36;
  if (crossed(t, T.end)) {
    burst(W / 2, cy, 120, 1300, [GOLD, '#fff1a8', '#ffffff', GOLD2], 9, 1100, 1.3);
    shake = 1;
  }
  speedLines(W / 2, cy, 1 - prog(t, T.end, T.end + 0.4), GOLD, false, 31);
  const p = prog(t, T.end - 0.25, T.end);
  const s = t < T.end ? lerp(2.4, 1.1, inCubic(p)) : 1.1 - 0.1 * outElastic(prog(t, T.end, T.end + 0.9));
  const r = logoRect(s, cy);
  ring(W / 2, cy, t, T.end, 0.8, 1200, GOLD, 12);
  drawLogo(r, t < T.sweep2 - 1 ? prog(t, T.end + b(1), T.end + b(2.5)) : prog(t, T.sweep2, T.sweep2 + b(2)), clamp01(p * 2));
  const ty = cy + (PORTRAIT ? 310 : 250) * U;
  const size = (PORTRAIT ? 70 : 60) * U;
  kinetic('DEPLOY SOL', W / 2, ty, size, t, T.line1, { color: WHITE, stagger: 0.05, dur: 0.55 });
  kinetic('STRIKE GOLD', W / 2, ty + size * 1.05, size, t, T.line2, { color: GOLD, stagger: 0.05, dur: 0.55 });
  kinetic('MINE ORE', W / 2, ty + size * 2.1, size, t, T.line3, { color: SKR, stagger: 0.05, dur: 0.55 });
  const bp = outBack(prog(t, T.badge, T.badge + 0.4));
  if (bp > 0) {
    g.save();
    const by = ty + size * 2.1 + 110 * U;
    const label = 'BUILT FOR SOLANA SEEKER';
    font(34 * U, BODY);
    const bw = g.measureText(label).width + 80 * U;
    g.translate(W / 2, by - 9 * U);
    g.scale(bp, bp);
    g.globalAlpha = clamp01(bp);
    rr(-bw / 2, -35 * U, bw, 70 * U, 35 * U);
    g.fillStyle = '#0c1734';
    g.fill();
    g.strokeStyle = SOLG;
    g.lineWidth = 3 * U;
    g.stroke();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = WHITE;
    g.fillText(label, 0, 2 * U);
    g.restore();
  }
  g.save();
  g.globalAlpha = inOut(prog(t, T.fade, T.total));
  g.fillStyle = '#000';
  g.fillRect(-60, -60, W + 120, H + 120);
  g.restore();
}

/* ---------------- one frame ---------------- */
let prevT = 0;
function render(frame: number) {
  const t = frame / FPS;
  clock.ms = t * 1000;
  drive(t);
  engine.push(snapshot(t));
  const dt = Math.max(1 / FPS, t - prevT);
  prevT = t;
  const sx = shake > 0.01 ? (Math.random() - 0.5) * 40 * U * shake : 0;
  const sy = shake > 0.01 ? (Math.random() - 0.5) * 40 * U * shake : 0;
  shake *= 0.86;

  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  g.translate(sx, sy);

  if (t >= T.wipe - 0.1) {
    E.frame(clock.ms);
    g.imageSmoothingEnabled = false;
    const windowed = !PORTRAIT && inside(t);
    if (windowed) {
      // landscape: the diorama opens in a framed window on the right
      if (islandStill) {
        g.save();
        g.filter = 'blur(14px) brightness(0.45) saturate(1.2)';
        g.drawImage(islandStill, -40, -40, W + 80, H + 80);
        g.restore();
      }
      const inK = outExpo(prog(t, T.dive, T.dive + 0.6));
      const outK = inExpo(prog(t, T.exit - 0.3, T.exit));
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
    } else g.drawImage(game, 0, 0, game.width, game.height, 0, 0, W, H);
    // vignette
    const v = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
    v.addColorStop(0, '#00000000');
    v.addColorStop(1, '#000000aa');
    g.fillStyle = v;
    g.fillRect(-60, -60, W + 120, H + 120);
    sceneIsland(t);
    sceneSteps(t);
    sceneInside(t);
    sceneLiving(t);
    // the cut back up out of the claim, under a flash that lands on the bar
    if (t >= T.exit - 0.15 && t < T.exit + 0.45) flash(t < T.exit ? prog(t, T.exit - 0.15, T.exit) : 1 - outCubic(prog(t, T.exit, T.exit + 0.45)));
    if (t >= T.gear && t < T.end) sceneGear(t);
    if (t >= T.end) sceneEnd(t);
    // shutters close over the island and open on the gear, then again onto the end card
    if (t >= T.shutIn && t < T.gear + 0.6) shutters(prog(t, T.shutIn, T.gear), prog(t, T.gear, T.gear + 0.6));
    if (t >= T.gearOut + 0.3 && t < T.end + 0.4) shutters(prog(t, T.gearOut + 0.3, T.end), prog(t, T.end, T.end + 0.4));
  }
  if (t < T.wipe) sceneIntro(t);
  else if (t < T.wipe + b(1.5)) blockWipe(t, T.wipe, b(1.5));
  stepSparks(dt);
  lastSceneT = t;
}

(window as unknown as Record<string, unknown>).gali = {
  ready: load().then(() => true),
  render,
  frames: Math.round(FPS * DUR),
  grab: (quality = 0.93) => out.toDataURL('image/jpeg', quality),
  events: () => events,
  timeline: () => ({ ...T, beat: BEAT, reveal: REVEAL_AT }),
};
