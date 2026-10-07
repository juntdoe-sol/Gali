/**
 * Cave Run, on film.
 *
 * The real mini game (app/src/engine/cave.ts), played by a small script instead of a thumb: it finds a way to the
 * nearest loot or the ladder, walks the on-screen stick that way, and swings at whatever rock or bat is in front.
 * Nothing about the game is changed; the script only holds the controls.
 */
import { clock } from './clock';
import { b, GOLD, H, PORTRAIT, U, W, events, font, g, panel, prog, tagCard, caption, TEAL, BODY, MUTED } from './kit';
import { T } from './timeline';
import { LOOK } from './cast';
import { CaveEngine } from '../../app/src/engine/cave';
import { CAVE_COLS as COLS, CAVE_ROWS as ROWS, ROCK, TILE, WALL } from '../../app/src/game/cave';

/** A phone-shaped stage on a phone; a square window on a wide screen. */
export const caveCv = document.createElement('canvas');
const CSS_W = PORTRAIT ? W / 2 : H / 2;
const CSS_H = H / 2;
caveCv.style.cssText = `position:absolute;left:0;top:0;width:${CSS_W}px;height:${CSS_H}px;visibility:hidden`;
document.body.appendChild(caveCv);

let xp = 0;
const cave = new CaveEngine(
  caveCv,
  (e) => {
    if (e.t === 'sfx') events.push({ t: clock.ms / 1000, name: `cave:${e.name}` });
    if (e.t === 'xp') xp += e.n;
  },
  LOOK,
  { spot: 7, runs: 3, best: 2, top: PORTRAIT ? 215 : 6, bottom: PORTRAIT ? 205 : 6 },
);
interface Bat {
  x: number;
  y: number;
  awake: boolean;
  dead: boolean;
}
const C = cave as unknown as {
  frame: (t: number) => void;
  begin: () => void;
  phase: string;
  x: number;
  y: number;
  H: number;
  runXp: number;
  opts: { bottom: number };
  level: { cells: number[]; hp: number[]; ladder: [number, number] };
  items: { x: number; y: number; z: number }[];
  bats: Bat[];
  stick: { id: number; bx: number; by: number; x: number; y: number } | null;
  swingHeld: Set<number>;
};

export async function loadCave() {
  await cave.start('pixel/atlas.png');
}

/** The next cell on the cheapest way to (gx, gy): floor is quick, rock costs its hits, walls are closed. */
function nextStep(cx: number, cy: number, gx: number, gy: number): [number, number] | null {
  const n = COLS * ROWS;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const s = cy * COLS + cx;
  dist[s] = 0;
  for (;;) {
    let best = -1;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (best < 0 || dist[i] < dist[best])) best = i;
    if (best < 0) break;
    done[best] = 1;
    if (best === gy * COLS + gx) break;
    const x = best % COLS;
    const y = Math.floor(best / COLS);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      const j = ny * COLS + nx;
      const k = C.level.cells[j];
      if (k === WALL) continue;
      const cost = k === ROCK && C.level.hp[j] > 0 ? 1 + C.level.hp[j] * 2.5 : 1;
      if (dist[best] + cost < dist[j]) {
        dist[j] = dist[best] + cost;
        prev[j] = best;
      }
    }
  }
  let at = gy * COLS + gx;
  if (prev[at] < 0) return null;
  while (prev[at] !== s && prev[at] >= 0) at = prev[at];
  return [at % COLS, Math.floor(at / COLS)];
}

function play() {
  if (C.phase !== 'play') {
    C.stick = null;
    C.swingHeld.clear();
    return;
  }
  const cx = Math.floor(C.x / TILE);
  const cy = Math.floor((C.y - 3) / TILE);
  let ux = 0;
  let uy = 0;
  let swing = false;
  // a bat in reach: turn on it and swing
  const bat = C.bats.find((bt) => !bt.dead && bt.awake && Math.hypot(bt.x - C.x, bt.y - (C.y - 6)) < 24);
  if (bat) {
    const d = Math.hypot(bat.x - C.x, bat.y - (C.y - 6)) || 1;
    ux = (bat.x - C.x) / d;
    uy = (bat.y - (C.y - 6)) / d;
    swing = true;
  } else {
    // loot on the floor first, then the ladder
    let goal: [number, number] = C.level.ladder;
    let bestD = Infinity;
    for (const it of C.items) {
      const d = Math.hypot(it.x - C.x, it.y - C.y);
      if (d < bestD && d < 70) {
        bestD = d;
        goal = [Math.floor(it.x / TILE), Math.floor(it.y / TILE)];
      }
    }
    const step = cx === goal[0] && cy === goal[1] ? goal : nextStep(cx, cy, goal[0], goal[1]);
    if (step) {
      const j = step[1] * COLS + step[0];
      const rock = C.level.cells[j] === ROCK && C.level.hp[j] > 0;
      const tx = step[0] * TILE + TILE / 2;
      const ty = step[1] * TILE + TILE - 4;
      const dx = step[0] - cx;
      const dy = step[1] - cy;
      if (rock) {
        // line up with the rock, then dig into it
        const offX = dy !== 0 ? cx * TILE + TILE / 2 - C.x : 0;
        const offY = dx !== 0 ? cy * TILE + TILE - 4 - C.y : 0;
        if (Math.abs(offX) > 2.5 || Math.abs(offY) > 2.5) {
          ux = Math.sign(offX) * (Math.abs(offX) > 2.5 ? 1 : 0);
          uy = Math.sign(offY) * (Math.abs(offY) > 2.5 ? 1 : 0);
        } else {
          ux = dx;
          uy = dy;
          swing = true;
        }
      } else {
        const ddx = tx - C.x;
        const ddy = ty - C.y;
        // square up on the cross axis before going through a gap
        if (dx !== 0 && Math.abs(ddy) > 2.5) uy = Math.sign(ddy);
        else if (dy !== 0 && Math.abs(ddx) > 2.5) ux = Math.sign(ddx);
        if (Math.abs(ddx) > 1.5 && (dx !== 0 || ux !== 0 || dy === 0)) ux = Math.sign(ddx);
        if (Math.abs(ddy) > 1.5 && (dy !== 0 || uy !== 0 || dx === 0)) uy = Math.sign(ddy);
      }
    }
  }
  const bx = 78;
  const by = C.H - C.opts.bottom - 92;
  const d = Math.hypot(ux, uy);
  C.stick = d > 0 ? { id: 99, bx, by, x: bx + (ux / d) * 40, y: by + (uy / d) * 40 } : null;
  if (swing) C.swingHeld.add(98);
  else C.swingHeld.clear();
}

export const caveOn = (t: number) => t >= T.cave - 0.5 && t < T.caveExit + 0.1;
let begun = false;
export function driveCave(t: number) {
  if (!caveOn(t)) return;
  if (!begun) {
    begun = true;
    C.begin();
  }
  play();
  C.frame(clock.ms);
}

export function sceneCave(t: number) {
  if (t < T.cave || t > T.caveExit + 0.2) return;
  const at = PORTRAIT ? undefined : 400 * U;
  tagCard('pick', 'CAVE RUN', 'BREAK ROCK · GRAB GEMS · DODGE BATS', t, T.cave + b(0.25), T.caveOut, at, PORTRAIT ? 250 * U : 150 * U);
  // the XP the run has earned so far
  const a = prog(t, T.cave + b(1), T.cave + b(1.5)) * (1 - prog(t, T.caveOut, T.caveOut + 0.25));
  if (a > 0) {
    const x = PORTRAIT ? W / 2 : 400 * U;
    const y = PORTRAIT ? H - 250 * U : H * 0.62;
    g.save();
    g.globalAlpha = a;
    panel(x - 230 * U, y - 90 * U, 460 * U, 150 * U, a, TEAL);
    font(88 * U);
    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#8ff0ff';
    g.fillText(`+${Math.max(xp, C.runXp)} XP`, x, y + 10 * U);
    font(22 * U, BODY);
    g.fillStyle = MUTED;
    g.fillText('FOR YOUR MINER LEVEL', x, y + 44 * U);
    g.restore();
    if (!PORTRAIT) caption('FREE RUNS EVERY DAY · IT NEVER SPENDS SOL', x, y + 130 * U, 24 * U, a * prog(t, T.cave + b(2), T.cave + b(2.5)));
    else caption('FREE RUNS EVERY DAY · IT NEVER SPENDS SOL', x, y + 120 * U, 24 * U, a * prog(t, T.cave + b(2), T.cave + b(2.5)));
  }
  void GOLD;
}
