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
import {
  b, BEAT, BODY, DISPLAY, FPS, GOLD, GOLD2, H, MUTED, NAVY, PORTRAIT, SKR, SOLG, TEAL, U, W, WHITE,
  background, burst, clamp01, crossed, flash, font, fx, g, goldFill, hash, inCubic, inExpo, inOut, kinetic, lerp, out, outBack, outCubic, outElastic, outExpo,
  panel, prog, ring, rr, shutters, speedLines, st, stepCard, stepSparks, tapRipple, textW, events, tagCard, caption,
} from './kit';
import { DUR, REVEAL_AT, T } from './timeline';
import { LOOK } from './cast';
import { driveTown, loadTown, sceneTown, townCv } from './town';
import { caveCv, driveCave, loadCave, sceneCave } from './dig';
import { sceneGames } from './games';
import { Engine } from '../../app/src/engine/engine';
import art from '../../app/src/engine/art.json';
import type { EngineEvent, Look, PeerView, Snapshot } from '../../app/src/engine/types';


const game = document.createElement('canvas');
game.style.cssText = `position:absolute;left:0;top:0;width:${W / 2}px;height:${H / 2}px;visibility:hidden`;
document.body.appendChild(game);

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
  await loadTown();
  await loadCave();
}

/* ---------------- the script the engine plays ---------------- */
const PICKS = [3, 12, 7, 18, 21];
const WINNER = 7;
const mask = (ids: number[]) => ids.reduce((m, i) => m | (1 << i), 0);
const others = Array.from({ length: 25 }, (_, i) => 0.004 + hash(i * 3.7) * 0.07);

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
  if (t >= T.auto && t < T.lobby + 0.2) pending = mask(PICKS);
  const heat = prog(t, T.s1 + 1, T.count[0]);
  const round2 = t >= T.dig;
  const perBlock = others.map((v, i) => (round2 ? (i === WINNER ? 0.062 : v * 0.6) : v * heat) + (pending & (1 << i) ? 0.01 : 0));
  const mine = perBlock.map((_, i) => (pending & (1 << i) ? 0.01 : 0));
  let phase = 'mining';
  if (!round2 && t >= T.settle) phase = t >= REVEAL_AT ? 'reveal' : 'settling';
  return {
    view,
    phase,
    roundId: (round2 ? 45801 : 45800) + T.autoTicks.filter((a) => t >= a).length,
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
  if (cue(T.shut2 + b(0.4))) E.sky.setTime(0.3); // dawn behind the shutters, ready for the end card
  lastT = t;
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
    fx.shake = 1;
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
    g.fillText('A NEW ROUND ABOUT EVERY MINUTE', W / 2, y + 56 * U);
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
      fx.shake = 1;
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
      burst(cx, cy, 120, 1400, [TEAL, '#d6fbff', GOLD, '#ffffff'], 9, 1100, 1.4);
      fx.shake = 0.8;
    }
    const bw = (PORTRAIT ? 640 : 560) * U;
    g.save();
    g.globalAlpha = a;
    const pop = full ? 1 + 0.08 * (1 - outElastic(prog(t, T.mlFull, T.mlFull + 0.8))) : 1;
    g.translate(cx, cy);
    g.scale(pop, pop);
    g.translate(-cx, -cy);
    panel(cx - bw / 2 - 30 * U, cy - 110 * U, bw + 60 * U, 250 * U, a, TEAL);
    font(58 * U);
    g.textAlign = 'center';
    g.fillStyle = TEAL;
    g.fillText('ORE MOTHERLODE', cx, cy - 36 * U);
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
    gr.addColorStop(0, '#1f9fc4');
    gr.addColorStop(1, TEAL);
    g.fillStyle = gr;
    g.fillRect(cx - bw / 2, cy, bw, 44 * U);
    for (let k = 0; k < 10; k++) {
      g.fillStyle = '#ffffff44';
      g.fillRect(cx - bw / 2 + ((k * 90 * U + t * 320 * U) % bw), cy + 6 * U, 22 * U, 8 * U);
    }
    g.restore();
    font(30 * U, BODY);
    g.fillStyle = full ? GOLD : WHITE;
    g.fillText(full ? '1 IN 500 ROUNDS PAYS IT ALL' : 'EVERY ROUND ADDS 0.2 ORE TO THE POOL', cx, cy + 100 * U);
    g.restore();
  }
}

function sceneLiving(t: number) {
  if (t < T.living || t > T.auto + 0.2) return;
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

/** Autopilot: the island at night, and a round going out on every half beat without a tap. */
function sceneAuto(t: number) {
  if (t < T.auto || t > T.lobby + 0.1) return;
  tagCard('bot', 'AUTOPILOT', 'ONE WALLET APPROVAL · YOUR ROUNDS DEPLOY THEMSELVES', t, T.auto, T.autoOut);
  const n = T.autoTicks.filter((a) => t >= a).length;
  T.autoTicks.forEach((land, k) => {
    PICKS.forEach((i, j) => {
      const p = prog(t, land - 0.26, land);
      const [x1, y1] = onScreen(i);
      if (p > 0 && p < 1) coin(lerp(W / 2, x1, p), lerp(H + 40 * U, y1, p) - Math.sin(p * Math.PI) * (160 + j * 20) * U, 22 * U, SOLG);
      ring(x1, y1, t, land, 0.35, 60, SOLG, 6);
    });
    void k;
  });
  const a = prog(t, T.auto + b(0.3), T.auto + b(0.6)) * (1 - prog(t, T.autoOut, T.autoOut + 0.2));
  if (a <= 0) return;
  const y = PORTRAIT ? H - 470 * U : H - 120 * U;
  const big = (PORTRAIT ? 110 : 88) * U;
  g.save();
  g.globalAlpha = a;
  const bump = n > 0 ? 1 + 0.1 * (1 - prog(t, T.autoTicks[n - 1], T.autoTicks[n - 1] + 0.14)) : 1;
  g.translate(W / 2, y);
  g.scale(bump, bump);
  font(big);
  g.textAlign = 'center';
  g.fillStyle = '#000000aa';
  g.fillText(`ROUND ${Math.max(1, n)} OF ${T.autoTicks.length}`, 5 * U, 6 * U);
  g.fillStyle = SOLG;
  g.fillText(`ROUND ${Math.max(1, n)} OF ${T.autoTicks.length}`, 0, 0);
  g.restore();
  // a pip for every round the run has sent
  const pw = 44 * U;
  const gap = 14 * U;
  const x0 = W / 2 - (T.autoTicks.length * pw + (T.autoTicks.length - 1) * gap) / 2;
  g.save();
  g.globalAlpha = a;
  T.autoTicks.forEach((_, k) => {
    rr(x0 + k * (pw + gap), y + 26 * U, pw, 14 * U, 6 * U);
    g.fillStyle = k < n ? SOLG : 'rgba(255,255,255,0.22)';
    g.fill();
  });
  g.restore();
  caption('STOP ANY TIME AND THE UNUSED SOL COMES BACK', W / 2, y + 96 * U, 25 * U, a * prog(t, T.auto + b(1.5), T.auto + b(2)));
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
    fx.shake = 1;
  }
  speedLines(W / 2, cy, 1 - prog(t, T.end, T.end + 0.4), GOLD, false, 31);
  const p = prog(t, T.end - 0.25, T.end);
  const s = t < T.end ? lerp(2.4, 1.1, inCubic(p)) : 1.1 - 0.1 * outElastic(prog(t, T.end, T.end + 0.9));
  const r = logoRect(s, cy);
  ring(W / 2, cy, t, T.end, 0.8, 1200, GOLD, 12);
  drawLogo(r, t < T.sweep2 - 1 ? prog(t, T.end + b(1), T.end + b(2.5)) : prog(t, T.sweep2, T.sweep2 + b(2)), clamp01(p * 2));
  const ty = cy + (PORTRAIT ? 310 : 250) * U;
  const size = (PORTRAIT ? 70 : 60) * U;
  kinetic('MINE ORE', W / 2, ty, size, t, T.line1, { color: WHITE, stagger: 0.05, dur: 0.55 });
  kinetic('MEET MINERS', W / 2, ty + size * 1.05, size, t, T.line2, { color: GOLD, stagger: 0.05, dur: 0.55 });
  kinetic('PLAY TOGETHER', W / 2, ty + size * 2.1, size, t, T.line3, { color: SKR, stagger: 0.05, dur: 0.55 });
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

/** A square stage in a gold-trimmed window on the right of a wide frame: the dive, and the cave. */
let townStill: HTMLCanvasElement | null = null;
function framed(src: HTMLCanvasElement, inK: number, outK: number) {
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
  g.drawImage(src, 0, 0, src.width, src.height, -side / 2, -side / 2, side, side);
  g.restore();
  rr(-side / 2, -side / 2, side, side, 26 * U);
  g.lineWidth = 6 * U;
  g.strokeStyle = '#c9a24e';
  g.stroke();
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
  const sx = fx.shake > 0.01 ? (Math.random() - 0.5) * 40 * U * fx.shake : 0;
  const sy = fx.shake > 0.01 ? (Math.random() - 0.5) * 40 * U * fx.shake : 0;
  fx.shake *= 0.86;

  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  g.translate(sx, sy);

  const inTown = t >= T.lobby && t < T.gear;
  const inCave = t >= T.cave && t < T.caveExit;
  if (t >= T.wipe - 0.1) {
    // only the engine on screen draws; the lobby keeps walking behind the cave so nobody freezes
    if (!inTown) E.frame(clock.ms);
    driveTown(t);
    driveCave(t);
    if (!PORTRAIT && st.last < T.cave - 0.04 && t >= T.cave - 0.04) {
      const cv = document.createElement('canvas');
      cv.width = W;
      cv.height = H;
      cv.getContext('2d')!.drawImage(townCv, 0, 0, W, H);
      townStill = cv;
    }
    g.imageSmoothingEnabled = false;
    if (inCave) {
      if (PORTRAIT) g.drawImage(caveCv, 0, 0, caveCv.width, caveCv.height, 0, 0, W, H);
      else {
        g.fillStyle = '#05030a';
        g.fillRect(-60, -60, W + 120, H + 120);
        if (townStill) {
          g.save();
          g.filter = 'blur(18px) brightness(0.5) saturate(1.2)';
          g.drawImage(townStill, -40, -40, W + 80, H + 80);
          g.restore();
        }
        framed(caveCv, outExpo(prog(t, T.cave, T.cave + 0.6)), inExpo(prog(t, T.caveExit - 0.3, T.caveExit)));
      }
    } else if (inTown) g.drawImage(townCv, 0, 0, townCv.width, townCv.height, 0, 0, W, H);
    else {
      const windowed = !PORTRAIT && inside(t);
      if (windowed) {
        // landscape: the diorama opens in a framed window on the right
        if (islandStill) {
          g.save();
          g.filter = 'blur(14px) brightness(0.45) saturate(1.2)';
          g.drawImage(islandStill, -40, -40, W + 80, H + 80);
          g.restore();
        }
        framed(game, outExpo(prog(t, T.dive, T.dive + 0.6)), inExpo(prog(t, T.exit - 0.3, T.exit)));
      } else g.drawImage(game, 0, 0, game.width, game.height, 0, 0, W, H);
    }
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
    sceneAuto(t);
    sceneTown(t);
    sceneCave(t);
    sceneGames(t);
    // the cut back up out of the claim, under a flash that lands on the bar
    if (t >= T.exit - 0.15 && t < T.exit + 0.45) flash(t < T.exit ? prog(t, T.exit - 0.15, T.exit) : 1 - outCubic(prog(t, T.exit, T.exit + 0.45)));
    // into the cave through the dark, and back out into daylight
    if (t >= T.caveIn && t < T.cave + 0.4) flash(t < T.cave ? inCubic(prog(t, T.caveIn, T.cave)) : 1 - outCubic(prog(t, T.cave, T.cave + 0.4)), '5,3,10');
    if (t >= T.caveExit - 0.15 && t < T.caveExit + 0.45) flash(t < T.caveExit ? prog(t, T.caveExit - 0.15, T.caveExit) : 1 - outCubic(prog(t, T.caveExit, T.caveExit + 0.45)));
    if (t >= T.gear && t < T.end) sceneGear(t);
    if (t >= T.end) sceneEnd(t);
    // shutters: island to lobby, lobby to gear, gear to the end card
    if (t >= T.shutIn && t < T.lobby + 0.6) shutters(prog(t, T.shutIn, T.lobby), prog(t, T.lobby, T.lobby + 0.6));
    if (t >= T.shut2 && t < T.gear + 0.6) shutters(prog(t, T.shut2, T.gear), prog(t, T.gear, T.gear + 0.6));
    if (t >= T.gearOut + 0.3 && t < T.end + 0.4) shutters(prog(t, T.gearOut + 0.3, T.end), prog(t, T.end, T.end + 0.4));
  }
  if (t < T.wipe) sceneIntro(t);
  else if (t < T.wipe + b(1.5)) blockWipe(t, T.wipe, b(1.5));
  stepSparks(dt);
  st.last = t;
}

(window as unknown as Record<string, unknown>).gali = {
  ready: load().then(() => true),
  render,
  frames: Math.round(FPS * DUR),
  grab: (quality = 0.93) => out.toDataURL('image/jpeg', quality),
  events: () => events,
  timeline: () => ({ ...T, beat: BEAT, reveal: REVEAL_AT }),
};

