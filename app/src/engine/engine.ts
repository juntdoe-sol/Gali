/**
 * Gali's renderer: one canvas, one loop, everything on the island.
 *
 * The app tells the engine what is true (a Snapshot: the round, your picks, the
 * SOL on each claim, who else is here). The engine decides how it looks and
 * moves: water, weather, the day, miners walking and swinging, the reveal, and
 * the dive into a claim. It runs at the display's refresh rate and steps its
 * effects down on its own if a phone can't keep up.
 */
import { ACTORS, ISLE, blit, draw, drawCanvas, has, makeCanvas, ctx2d, sprite, text, textCentered, textWidth, loadAtlas, type Ctx } from './art';
import { drawMiner, drawPet, frameAt, HIT_FRAME, IMPACT, lampOf, moleNames, petFlies, petLight, POSES, stepBody, type Body } from './actors';
import { Camera } from './camera';
import { buildScene, drawScene, newVisit, paintUnderground, SCENE_CX, SH, type Scene, type Visit } from './closeup';
import { landedSince, rumbleAmp, shouldCelebrate } from './juice';
import { CLAIMS, MAP_H, MAP_W, REGIONS, claimForTap, shipAt, toLand } from './island';
import { Particles } from './particles';
import { findPath } from './path';
import { Sky } from './sky';
import type { EngineEvent, Look, PeerView, Pose, Snapshot } from './types';
import { Water } from './water';

const BLOCKS = 25;
const SWING_MS = POSES.swing.n * POSES.swing.ms;
const HOME = ISLE.home as [number, number];
const standOf = (i: number) => CLAIMS[i].stand as [number, number];
const [FIT_X, FIT_Y, FIT_W, FIT_H] = ISLE.fit as [number, number, number, number];
const seeded = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
/** Compact SOL for a claim label: 0, .004, 0.12, 1.2, 12 */
const fmtAmt = (v: number) =>
  v <= 0 ? '0' : v < 0.001 ? '<.001' : v < 0.01 ? `.${Math.round(v * 1000).toString().padStart(3, '0')}` : v < 1 ? v.toFixed(2) : v < 10 ? v.toFixed(1) : Math.round(v).toString();

const DEFAULT_LOOK: Look = { hat: 'hat-yellow', fit: '#2f5fd0', pick: '#c9c9c9', handle: '#9b6b43', pet: null, glow: 'none' };
const SPARKS: Record<Look['glow'], string[]> = {
  none: ['#fff1c8'],
  rare: ['#fff1a8', '#ffd24a'],
  epic: ['#c8fff6', '#3de0c8', '#b86bff'],
  legendary: ['#ff4fd8', '#c7f284', '#ffffff'],
};

/** Islets out in open water beyond the painted board, for tall screens. */
const FAR_ISLETS: [string, number, number][] = [
  ['islet-palm', 40, -44],
  ['islet-rock', 318, -34],
  ['islet-bare', 86, 258],
  ['islet-palm', 290, 250],
  ['islet-rock', -30, 110],
  ['islet-bare', 392, 96],
];

type Mode = 'island' | 'enter' | 'closeup' | 'exit';

interface Me extends Body {
  target: number;
  hitCycle: number;
  swings: number;
  manualUntil: number;
}
interface PeerDisp {
  x: number;
  y: number;
  since: number;
  pose: Pose;
  lastSwing: number;
}

export class Engine {
  private c: Ctx;
  private dpr = 1;
  private W = 1; // css px
  private H = 1;
  private snap: Snapshot | null = null;
  private cam = new Camera();
  private sky = new Sky();
  private water: Water | null = null;
  private parts = new Particles();
  private me: Me = { x: HOME[0], y: HOME[1], path: [], pose: 'idle', since: 0, facing: 1, target: -1, hitCycle: -1, swings: 0, manualUntil: 0 };
  private petPos = { x: HOME[0] - 12, y: HOME[1] + 2 };
  private peers = new Map<string, PeerDisp>();
  private hits = new Map<number, number>();
  /** when each claim's flag went in this round, for the planting animation */
  private planted = new Map<number, number>();
  private prevPending = 0;
  private celebrated = -1;
  /** feed + claim juice (cosmetic): last pot read, its round, floating labels, last claim stamp */
  private potPrev: number[] | null = null;
  private potRound = -1;
  private landed: { i: number; add: number; at: number }[] = [];
  private claimSeen = 0;
  private lastRumbleDust = 0;
  private punched = -1;
  private mole = { idx: -1, start: 0, nextAt: Date.now() + 5000, bonkedAt: -1 };
  private flocks = Array.from({ length: 5 }, (_, i) => ({ x: -60 + seeded(i * 3.1) * 480, y: -30 + seeded(i * 5.7) * 260, sp: 6 + seeded(i * 9.3) * 8, dir: seeded(i * 11.9) > 0.5 ? 1 : -1, n: 2 + Math.floor(seeded(i * 7.1) * 3) }));
  private props = (ISLE.props as { s: string; x: number; y: number; n: number; ms: number; sway: number }[]).slice();
  private mode: Mode = 'island';
  private modeAt = 0;
  private focus = -1;
  private scenes = new Map<number, Scene>();
  private visit: Visit | null = null;
  private layer: HTMLCanvasElement | null = null;
  private mask: HTMLCanvasElement | null = null;
  private patterns = new Map<HTMLCanvasElement, CanvasPattern>();
  private last = 0;
  private raf = 0;
  private lastMe = 0;
  private fpsAcc = { n: 0, t: 0 };
  quality = 1;
  private ready = false;
  private pointers = new Map<number, { x: number; y: number; x0: number; y0: number; t0: number }>();
  private pinch: { d: number; mx: number; my: number } | null = null;
  private pressTimer: ReturnType<typeof setTimeout> | null = null;
  private moved = false;
  private longPressed = false;
  private lastTap = { t: 0, x: 0, y: 0, hit: -1 };
  /** A single tap on a spot waits this long for a second tap before it counts as a pick. */
  private tapTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private emit: (e: EngineEvent) => void,
  ) {
    this.c = ctx2d(canvas);
    this.bindInput();
    (globalThis as unknown as { __galiEngine?: Engine }).__galiEngine = this;
  }

  boot: Record<string, number> = {};
  async start(atlasUrl: string) {
    const b0 = performance.now();
    this.boot.startAt = b0;
    await loadAtlas(atlasUrl);
    this.boot.atlas = performance.now() - b0;
    // the coast, read from the ground layer's alpha
    const g = sprite('ground');
    if (g) {
      const d = g.getContext('2d')!.getImageData(0, 0, g.width, g.height).data;
      const w0 = performance.now();
      this.water = new Water(d);
      this.boot.water = performance.now() - w0;
    }
    this.last = performance.now();
    const loop = (t: number) => {
      this.raf = requestAnimationFrame(loop);
      this.frame(t);
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop() {
    cancelAnimationFrame(this.raf);
    this.cancelPress();
    this.cancelTap();
  }

  push(s: Snapshot) {
    this.snap = s;
  }
  /** Dive into claim `i`, or -1 to come back up. */
  setFocus(i: number) {
    if (i === this.focus) return;
    const now = performance.now();
    if (i < 0) {
      if (this.mode === 'island') return;
      this.mode = 'exit';
      this.modeAt = now;
      this.cam.home(650);
      this.focus = -1;
      this.emit({ t: 'focus', claim: -1 });
      return;
    }
    if (!this.scenes.has(i)) this.scenes.set(i, buildScene(i));
    if (this.mode === 'closeup' || this.mode === 'enter') {
      // next/previous claim from inside: a short cut through black
      this.focus = i;
      this.visit = newVisit(Date.now());
      this.mode = 'enter';
      this.modeAt = now - 520;
    } else {
      this.focus = i;
      this.visit = newVisit(Date.now());
      this.mode = 'enter';
      this.modeAt = now;
      const c = CLAIMS[i];
      this.cam.flyTo(c.cx, c.cy, this.cam.fitZ * 4.2, 700);
    }
    this.emit({ t: 'sfx', name: 'whoosh' });
    this.emit({ t: 'focus', claim: i });
  }
  /** For screenshots and demos: 0 midnight, 0.5 noon. */
  setTime(f: number) {
    this.sky.setTime(f);
  }
  setRain(k: number) {
    (this.sky as unknown as { rainTarget: number }).rainTarget = k;
    this.sky.rain = k;
  }

  /* ------------------------------------------------------------------ */
  private resize() {
    const cssW = this.canvas.clientWidth || window.innerWidth;
    const cssH = this.canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.quality ? 2.5 : 1.5);
    if (cssW !== this.W || cssH !== this.H || dpr !== this.dpr) {
      this.W = cssW;
      this.H = cssH;
      this.dpr = dpr;
      this.canvas.width = Math.round(cssW * dpr);
      this.canvas.height = Math.round(cssH * dpr);
      this.c = ctx2d(this.canvas);
    }
  }

  private revealEl(now: number) {
    const s = this.snap;
    if (!s) return -1;
    if (s.phase === 'settling') return Math.min(1300, now - s.settleStartAt);
    if (s.phase === 'reveal') return 1400 + (now - s.revealStartAt);
    return -1;
  }

  private prof(name: string, t0: number) {
    const P = (globalThis as unknown as { __galiProf?: Record<string, number> }).__galiProf;
    if (P) P[name] = (P[name] ?? 0) + performance.now() - t0;
  }

  private frame(t: number) {
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    const now = Date.now();
    this.resize();
    this.perf(dt);
    const s = this.snap;
    const top = Math.min(s?.view.top ?? 200, this.H * 0.45);
    const bottom = Math.min(s?.view.bottom ?? 150, this.H * 0.55);
    const band = Math.max(120, this.H - top - bottom);
    this.cam.setView(0, top, this.W, band);
    this.cam.update(t);
    this.sky.update(dt, now, this.quality);
    let t0 = performance.now();
    this.water?.update(now, 1 + this.sky.wind * 0.5, this.quality);
    this.prof('water', t0);
    this.parts.budget = this.quality ? 1 : 0.4;
    this.parts.update(dt, this.sky.wind);

    const c = this.c;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.imageSmoothingEnabled = false;
    const el = this.revealEl(now);
    this.think(dt, now, el);

    t0 = performance.now();
    if (this.mode === 'island') this.drawIsland(c, now, dt, el);
    else if (this.mode === 'closeup') this.drawCloseup(c, now, dt, el);
    else this.drawTransition(c, t, now, dt, el);
    this.prof('draw', t0);

    if (!this.ready) {
      this.ready = true;
      this.canvas.dataset.ready = '1';
      this.emit({ t: 'ready' });
    }
  }

  private lowWindows = 0;
  private perfFrom = performance.now() + 6000; // ignore start-up hitches
  private perf(dt: number) {
    if (performance.now() < this.perfFrom) return;
    this.fpsAcc.n++;
    this.fpsAcc.t += dt;
    if (this.fpsAcc.t < 2.5) return;
    const fps = this.fpsAcc.n / this.fpsAcc.t;
    this.fpsAcc = { n: 0, t: 0 };
    // two slow windows in a row, not one hiccup, before stepping the effects down
    this.lowWindows = fps < 40 ? this.lowWindows + 1 : 0;
    if (this.lowWindows >= 2 && this.quality === 1) {
      this.quality = 0;
      this.emit({ t: 'perf', fps, quality: 0 });
    }
  }

  /* ---------------- simulation ---------------- */
  private think(dt: number, now: number, el: number) {
    const s = this.snap;
    const me = this.me;
    const pend = s?.pending ?? 0;
    const deployed = [...Array(BLOCKS).keys()].filter((i) => pend & (1 << i));
    // a deploy lands: flags go in claim by claim, each with a puff of dust
    if (pend !== this.prevPending) {
      const fresh = deployed.filter((i) => !(this.prevPending & (1 << i)));
      fresh.forEach((i, k) => this.planted.set(i, now + k * 45));
      if (!pend) this.planted.clear();
      this.prevPending = pend;
    }
    for (const [i, at] of this.planted) {
      if (at > 0 && now >= at) {
        const cl = CLAIMS[i];
        this.parts.burst('dust', cl.cx + 8, cl.cy, 5, 14, 10, ['#f2e6c8', '#d8c8a8'], 0.6);
        this.parts.burst('star', cl.cx + 8, cl.cy - 10, 2, 10, 14, ['#ffd84a'], 0.5);
        this.planted.set(i, -at);
      }
    }
    // live deploy feed: SOL other miners put on spots since the last pot read (cosmetic, 3 labels max)
    if (s) {
      if (s.roundId !== this.potRound) { this.potRound = s.roundId; this.potPrev = null; this.landed = []; }
      const pot = s.perBlock;
      if (this.potPrev === null || pot.some((v, i) => v !== this.potPrev![i])) {
        for (const l of landedSince(this.potPrev, pot, pend)) {
          // one label per spot: a second landing folds into the first instead of stacking
          this.landed = this.landed.filter((x) => x.i !== l.i);
          this.landed.push({ ...l, at: now });
          const cl = CLAIMS[l.i];
          this.parts.burst('dust', cl.cx + 8, cl.cy - 2, 3, 10, 8, ['#bfe9ff', '#8fb8ff'], 0.5);
        }
        this.landed = this.landed.slice(-3);
        this.potPrev = pot.slice();
      }
    }
    this.landed = this.landed.filter((l) => now - l.at < 2200);
    // During the final lock window, one mine mouth occasionally coughs dust. Cosmetic only.
    const lockAmp = s ? rumbleAmp(s.roundEndsAt - Date.now(), s.lockMs, s.phase, this.quality) : 0;
    if (lockAmp > 0 && now - this.lastRumbleDust > 480) {
      this.lastRumbleDust = now;
      const i = Math.floor(seeded(now / 480 + (s?.roundId ?? 0)) * CLAIMS.length);
      const cl = CLAIMS[i];
      this.parts.burst('dust', cl.cx + 7, cl.cy - 2, 3, 9, 8, ['#d8c8a8', '#f2e6c8'], 0.55);
    }
    // claim confirmed in the app: one coin spray from your miner
    if (shouldCelebrate(this.claimSeen, s?.claimedAt)) {
      this.claimSeen = s!.claimedAt!;
      if (this.mode === 'island') {
        this.parts.burst('coin', me.x, me.y - 14, 36, 34, 70, ['#ffd24a', '#fff1a8', '#e0a020'], 1.4);
        this.parts.burst('star', me.x, me.y - 22, 10, 30, 30, ['#ffffff', '#fff1a8'], 0.9);
        this.emit({ t: 'sfx', name: 'pop' });
      }
    }
    const w = s?.winner ?? null;
    // the camera leans in on the strike, and eases back out when the next round opens
    if (w !== null && el > 2450 && this.punched !== s!.roundId && this.mode === 'island' && !this.cam.userZoomed) {
      this.punched = s!.roundId;
      const cl = CLAIMS[w];
      const z = this.cam.fitZ * 1.7;
      // don't push the winner off the edge of the band
      this.cam.hold = true;
      this.cam.flyTo(cl.cx * 0.55 + (FIT_X + FIT_W / 2) * 0.45, cl.cy * 0.55 + (FIT_Y + FIT_H / 2) * 0.45, z, 520);
      this.emit({ t: 'sfx', name: 'whoosh' });
    } else if (this.punched >= 0 && (s?.phase === 'mining' || this.mode !== 'island') && this.punched !== -2) {
      if (!this.cam.userZoomed) this.cam.home(700);
      this.punched = -2;
    }
    // the strike pays you: coins spray out of the winning claim
    if (w !== null && el > 2550 && this.celebrated !== s!.roundId && this.mode === 'island') {
      this.celebrated = s!.roundId;
      const cl = CLAIMS[w];
      const mineWon = Boolean(pend & (1 << w));
      this.parts.burst('coin', cl.cx, cl.cy - 4, mineWon ? 40 : 14, 34, 70, ['#ffd24a', '#fff1a8', '#e0a020'], 1.4);
      this.parts.burst('star', cl.cx, cl.cy - 14, 12, 30, 30, ['#ffffff', '#fff1a8'], 0.9);
    }
    const work = el >= 0 ? [] : deployed.length ? deployed : (s?.selected ?? []);
    const goTo = (x: number, y: number, target: number) => {
      me.path = findPath(me.x, me.y, x, y);
      me.target = target;
      me.pose = 'walk';
      me.since = now;
      me.swings = 0;
    };
    const winner = s?.winner ?? null;
    const won = winner !== null && pend & (1 << winner) && el > 2600;
    if (me.path.length) {
      const arrived = stepBody(me, dt, won ? 40 : 52, now);
      if (won && me.pose === 'walk') me.pose = 'carry';
      if (me.target >= 0 && !work.includes(me.target)) {
        me.path = [];
        me.target = -1;
        me.pose = 'idle';
        me.since = now;
      } else if (arrived) {
        me.pose = me.target >= 0 ? 'swing' : 'idle';
        me.since = now;
        me.hitCycle = -1;
        if (me.target >= 0) me.facing = 1;
      }
    } else if (me.pose === 'swing' && me.target >= 0) {
      const cycle = Math.floor((now - me.since) / SWING_MS);
      const f = Math.floor(((now - me.since) % SWING_MS) / POSES.swing.ms);
      if (f >= HIT_FRAME && cycle !== me.hitCycle) {
        me.hitCycle = cycle;
        me.swings++;
        this.hits.set(me.target, now);
        if (this.mode === 'island') {
          this.emit({ t: 'sfx', name: 'hit' });
          this.impact(me.x + (IMPACT[0] - ACTORS.miner.ax) * me.facing, me.y, s?.me.look ?? DEFAULT_LOOK);
        }
      }
      if (!work.includes(me.target) || me.swings >= 3) {
        const next = work.length ? work[(work.indexOf(me.target) + 1) % work.length] : -1;
        if (next >= 0 && next !== me.target) goTo(...standOf(next), next);
        else if (next < 0) goTo(HOME[0], HOME[1], -1);
        else me.swings = 0;
      }
    } else if (now < me.manualUntil) {
      // walked somewhere by hand: stay a while
    } else if (work.length) {
      goTo(...standOf(work[0]), work[0]);
    } else if (el >= 0 && Math.hypot(me.x - HOME[0], me.y - HOME[1]) > 2 && me.target >= 0) {
      goTo(HOME[0], HOME[1], -1);
    }
    const dancing = won || (s && now - s.me.emoteAt < 2200);
    if (dancing && !me.path.length && me.pose !== 'cheer') {
      me.pose = 'cheer';
      me.since = now;
    } else if (!dancing && me.pose === 'cheer' && now - me.since > POSES.cheer.n * POSES.cheer.ms) {
      me.pose = me.target >= 0 && !me.path.length ? 'swing' : 'idle';
      me.since = now;
    } else if (me.pose === 'cheer' && now - me.since > POSES.cheer.n * POSES.cheer.ms) me.since = now;

    // pet follows at heel
    const pk = s?.me.look.pet ?? null;
    if (pk) {
      const tx = me.x - 11 * me.facing;
      const ty = me.y + (petFlies(pk) ? -14 : 2);
      this.petPos.x += (tx - this.petPos.x) * Math.min(1, dt * 3);
      this.petPos.y += (ty - this.petPos.y) * Math.min(1, dt * 3);
    }

    // tell the app where we are, a few times a second
    if (now - this.lastMe > 250) {
      this.lastMe = now;
      const end = me.path.length ? me.path[me.path.length - 1] : [me.x, me.y];
      const legacy: Pose = me.pose === 'carry' ? 'walk' : me.pose === 'cheer' ? 'idle' : me.pose;
      this.emit({ t: 'me', x: me.x, y: me.y, tx: end[0], ty: end[1], facing: me.facing, pose: legacy });
    }

    // other miners: glide toward where the network says they are
    const seen = new Set<string>();
    for (const p of s?.peers ?? []) {
      seen.add(p.id);
      let d = this.peers.get(p.id);
      if (!d) {
        d = { x: p.x, y: p.y, since: now - seeded(p.id.length) * 1000, pose: p.pose, lastSwing: -1 };
        this.peers.set(p.id, d);
      }
      const k = Math.min(1, dt * 8);
      const moving = Math.hypot(p.x - d.x, p.y - d.y) > 0.4;
      d.x += (p.x - d.x) * k;
      d.y += (p.y - d.y) * k;
      const pose: Pose = moving ? 'walk' : p.pose === 'walk' ? 'idle' : p.pose;
      if (pose !== d.pose) {
        d.pose = pose;
        d.since = now;
      }
      if (pose === 'swing' && this.mode === 'island') {
        const cycle = Math.floor((now - d.since) / SWING_MS);
        const f = Math.floor(((now - d.since) % SWING_MS) / POSES.swing.ms);
        if (f >= HIT_FRAME && cycle !== d.lastSwing) {
          d.lastSwing = cycle;
          this.impact(d.x + (IMPACT[0] - ACTORS.miner.ax) * p.facing, d.y, p.look, 0.5);
        }
      }
    }
    for (const id of [...this.peers.keys()]) if (!seen.has(id)) this.peers.delete(id);

    // the mole pops up on claims nobody picked, while a round is open
    const mo = this.mole;
    const mining = Boolean(s && s.phase === 'mining' && s.roundEndsAt - now > 5000 && this.mode === 'island');
    const UP = 2400;
    if (mo.idx < 0) {
      if (mining && now > mo.nextAt) {
        const free = [...Array(BLOCKS).keys()].filter((i) => !(pend & (1 << i)) && !s!.selected.includes(i));
        if (free.length) {
          mo.idx = free[Math.floor(Math.random() * free.length)];
          mo.start = now;
          mo.bonkedAt = -1;
          this.emit({ t: 'sfx', name: 'pop' });
        } else mo.nextAt = now + 3000;
      }
    } else {
      const age = now - mo.start;
      const bonked = mo.bonkedAt > 0;
      if ((!bonked && age > UP) || (bonked && now - mo.bonkedAt > 800) || !mining || s!.selected.includes(mo.idx)) {
        mo.idx = -1;
        mo.nextAt = now + 5000 + Math.random() * 6000;
      }
    }

    // smoke from chimneys and the campfire, the odd firefly after dark
    if (this.mode === 'island') {
      for (const [sx, sy] of ISLE.smoke as number[][]) if (Math.random() < dt * 3) this.parts.spawn('smoke', sx + Math.random() * 2, sy, { vx: 1, vz: 6 + Math.random() * 4, life: 2.6, c: '#d8d4cc' });
      if (this.sky.night > 0.5 && Math.random() < dt * 2) {
        const pr = this.props[Math.floor(Math.random() * this.props.length)];
        if (pr) this.parts.spawn('fly', pr.x + (Math.random() - 0.5) * 16, pr.y - 4 - Math.random() * 6, { vx: Math.random() * 9, vy: Math.random() * 9, life: 5, c: '#e6ff9a' });
      }
      if (this.sky.rain > 0.3 && this.water && Math.random() < dt * 10 * this.sky.rain) {
        this.parts.spawn('ring', FIT_X + Math.random() * FIT_W, FIT_Y + Math.random() * FIT_H, { life: 0.7, c: '#cfe6ff' });
      }
      if (this.sky.wind > 0.9 && Math.random() < dt * 2) {
        const pr = this.props[Math.floor(Math.random() * this.props.length)];
        if (pr && /oak|palm|bush|sapling/.test(pr.s)) this.parts.spawn('leaf', pr.x, pr.y - 8, { vx: 4, vy: 2, z: 8, life: 3, c: '#6aa54a' });
      }
    }
  }

  /** Dust, chips and sparks where a pick lands. */
  private impact(x: number, y: number, look: Look, k = 1) {
    this.parts.burst('dust', x, y, Math.round(3 * k), 10, 8, ['#e8d4b0', '#cbb690'], 0.7);
    this.parts.burst('chip', x, y, Math.round(3 * k), 26, 26, ['#7d7a78', '#a09a90', '#5e5a58'], 0.7);
    if (look.glow !== 'none') this.parts.burst('spark', x, y - 3, Math.round(4 * k), 30, 22, SPARKS[look.glow], 0.55);
  }

  /* ---------------- the island ---------------- */
  private pattern(cv: HTMLCanvasElement) {
    let p = this.patterns.get(cv);
    if (!p) {
      p = this.c.createPattern(cv, 'repeat')!;
      this.patterns.set(cv, p);
    }
    return p;
  }

  private drawIsland(c: Ctx, now: number, dt: number, el: number, forClose = false) {
    const s = this.snap;
    const dpr = this.dpr;
    const cam = this.cam;
    const S = cam.z * dpr;
    let shake = 0;
    if (el >= 0 && el < 1400) shake = (seeded(now / 50) - 0.5) * 2 * Math.min(1, el / 700);
    else if (el > 2500 && el < 2850) shake = (seeded(now / 40) - 0.5) * 3;
    // last seconds of a live round (the deploy lock window): a low rumble. Render-only, under 2px.
    const msLeft = s ? s.roundEndsAt - Date.now() : 0;
    const amp = s ? rumbleAmp(msLeft, s.lockMs, s.phase, this.quality) : 0;
    // Existing strike shake is map-space. Lock rumble is added AFTER zoom/DPR, so it stays <2 physical screen px.
    // Quantize after capping: strict ±1 physical canvas pixel, independent of zoom/DPR and base rounding.
    const rumblePx = amp > 0 ? Math.max(-1, Math.min(1, Math.round((seeded(now / 45) - 0.5) * 2 * amp))) : 0;
    const OX = Math.round((cam.ox + shake * cam.z) * dpr) + rumblePx;
    const OY = Math.round(cam.oy * dpr);
    const DW = this.canvas.width;
    const DH = this.canvas.height;
    const water = this.water;
    const winner = s?.winner ?? null;
    const pend = s?.pending ?? 0;

    let tIs = performance.now();
    // open ocean, anchored to the map so it doesn't slide under a pan
    if (water) {
      const pat = this.pattern(water.deepFrame(now));
      pat.setTransform(new DOMMatrix([S, 0, 0, S, OX, OY]));
      c.fillStyle = pat;
      c.fillRect(0, 0, DW, DH);
      c.drawImage(water.shore, OX, OY, MAP_W * S, MAP_H * S);
    } else {
      c.fillStyle = '#123a6b';
      c.fillRect(0, 0, DW, DH);
    }
    const on = (x: number, y: number, m = 40) => {
      const X = OX + x * S;
      const Y = OY + y * S;
      return X > -m * S && Y > -m * S && X < DW + m * S && Y < DH + m * S;
    };
    // islets out at sea
    for (const [n, x, y] of FAR_ISLETS) if (on(x, y)) draw(c, n, OX + x * S, OY + y * S, S);
    // ships, with a wake
    (ISLE.ships as { kind: string; from: number; speed: number; path: number[][] }[]).forEach((sh, k) => {
      const [mx, my, dir] = shipAt(sh.path, sh.from + (now / 1000) * sh.speed);
      const bob = Math.sin(now / 420 + k * 2) > 0 ? 0 : 1;
      if (Math.random() < dt * 6) this.parts.spawn('ring', mx - dir * 8, my + 3, { life: 1.2, c: '#9fd6ee' });
      draw(c, `ship-${sh.kind}`, OX + mx * S, OY + (my + bob) * S, S, dir < 0);
    });

    this.prof('sea', tIs);
    tIs = performance.now();
    // the land
    blit(c, 'ground', OX, OY, MAP_W * S, MAP_H * S);
    water?.drawRiver(c, now, OX, OY, S);

    // heat: the more SOL on a claim, the warmer it glows
    if (s && el < 0) {
      const maxV = Math.max(1e-9, ...s.perBlock);
      for (let i = 0; i < BLOCKS; i++) {
        const v = s.perBlock[i] ?? 0;
        if (v <= 0 || s.selected.includes(i) || pend & (1 << i)) continue;
        const [bx, by, bw, bh] = CLAIMS[i].box;
        const f = sprite(`claim-${i}-fill`, '#ff9a3c');
        if (!f) continue;
        c.globalAlpha = 0.05 + 0.22 * Math.sqrt(v / maxV);
        c.drawImage(f, OX + bx * S, OY + by * S, bw * S, bh * S);
      }
      c.globalAlpha = 1;
    }
    // claim lighting: picked, deployed, the winner, the losers going dark
    for (let i = 0; i < BLOCKS; i++) {
      const [bx, by, bw, bh] = CLAIMS[i].box;
      const isWin = winner === i && el >= 2500;
      let tint = '';
      let fill = 0;
      let edge = 0;
      if (el >= 1400 && winner !== null && winner !== i) {
        const order = (i * 11) % BLOCKS;
        fill = Math.max(0, Math.min(1, (el - 1400 - order * 40) / 300)) * 0.62;
        tint = '#02050f';
      } else if (isWin) {
        tint = '#ffcf4a';
        fill = 0.4 + 0.18 * Math.sin(now / 140);
        edge = 1;
      } else if (el < 0 && pend & (1 << i)) {
        tint = '#ffd84a';
        fill = 0.26;
        edge = 1;
      } else if (el < 0 && s?.selected.includes(i)) {
        tint = '#5ceeff';
        fill = 0.3 + 0.1 * Math.sin(now / 260);
        edge = 0.9;
      }
      if (!tint) continue;
      const f = sprite(`claim-${i}-fill`, tint);
      if (f && fill > 0) {
        c.globalAlpha = fill;
        c.drawImage(f, OX + bx * S, OY + by * S, bw * S, bh * S);
      }
      const e = sprite(`claim-${i}-edge`, tint);
      if (e && edge > 0) {
        c.globalAlpha = edge;
        c.drawImage(e, OX + bx * S, OY + by * S, bw * S, bh * S);
      }
      c.globalAlpha = 1;
    }

    // everything that stands, sorted by where its feet are
    type Item = { z: number; f: () => void };
    const items: Item[] = [];
    const wind = this.sky.wind;
    for (const p of this.props) {
      if (!on(p.x, p.y)) continue;
      let f = 0;
      if (p.sway) {
        const v = (Math.sin(now / (650 - wind * 200) + p.x * 0.07 + p.y * 0.03) * 0.5 + 0.5) * Math.min(1, wind * 1.2);
        f = Math.min(p.n - 1, Math.round(v * (p.n - 1)));
      } else if (p.ms) f = Math.floor(now / p.ms) % p.n;
      const name = `${p.s}-${f}`;
      items.push({ z: p.y, f: () => draw(c, name, OX + p.x * S, OY + p.y * S, S) });
    }
    for (let i = 0; i < BLOCKS; i++) {
      const cl = CLAIMS[i];
      const isWin = winner === i && el >= 2500;
      const hitAge = now - (this.hits.get(i) ?? 0);
      const lift = isWin ? 3 + Math.abs(Math.sin(now / 160)) * 2 : s?.selected.includes(i) ? 1 : hitAge < 160 ? 1 : 0;
      items.push({
        z: cl.cy,
        f: () => {
          draw(c, `icon-${cl.kind}`, OX + cl.cx * S, OY + (cl.cy - lift) * S, S);
          if (pend & (1 << i)) {
            const at = Math.abs(this.planted.get(i) ?? 0);
            const k = at ? Math.max(0, Math.min(1, (now - at) / 220)) : 1;
            if (k > 0) {
              const rise = Math.round((1 - k) * 10);
              c.save();
              c.beginPath();
              c.rect(OX + (cl.cx - 2) * S, OY + (cl.cy - 30) * S, 24 * S, 30 * S);
              c.clip();
              draw(c, `fx-flag-${Math.floor(now / 300) % 2}`, OX + (cl.cx + 7) * S, OY + (cl.cy - 8 + rise) * S, S);
              c.restore();
            }
          }
          if (isWin) draw(c, `fx-sparkle-${Math.floor(now / 110) % 3}`, OX + cl.cx * S, OY + (cl.cy - 10) * S, S);
        },
      });
    }
    const mo = this.mole;
    if (mo.idx >= 0) {
      const cl = CLAIMS[mo.idx];
      const age = now - mo.start;
      const UP = 2400;
      let name = moleNames.idle[Math.floor(age / moleNames.idleMs) % moleNames.idle.length];
      const u = moleNames.up;
      if (mo.bonkedAt > 0) name = moleNames.bonk;
      else if (age < u.length * moleNames.ms) name = u[Math.floor(age / moleNames.ms)];
      else if (age > UP - u.length * moleNames.ms) name = u[Math.max(0, u.length - 1 - Math.floor((age - (UP - u.length * moleNames.ms)) / moleNames.ms))];
      items.push({ z: cl.cy + 3, f: () => draw(c, name, OX + (cl.cx - 12) * S, OY + (cl.cy + 4) * S, S) });
    }
    const me = this.me;
    const look = s?.me.look ?? DEFAULT_LOOK;
    const mf = frameAt(me.pose, me.since, now);
    items.push({ z: me.y, f: () => drawMiner(c, look, me.pose, mf, OX + me.x * S, OY + me.y * S, S, me.facing) });
    if (look.pet) items.push({ z: this.petPos.y + (petFlies(look.pet) ? 16 : 0), f: () => drawPet(c, look.pet!, now, OX + this.petPos.x * S, OY + this.petPos.y * S, S, me.facing) });
    for (const p of s?.peers ?? []) {
      const d = this.peers.get(p.id);
      if (!d) continue;
      const pf = frameAt(d.pose, d.since, now);
      items.push({ z: d.y, f: () => drawMiner(c, p.look, d.pose, pf, OX + d.x * S, OY + d.y * S, S, p.facing) });
      if (p.look.pet) {
        const fly = petFlies(p.look.pet);
        const px = d.x - 11 * p.facing;
        const py = d.y + (fly ? -14 : 2);
        items.push({ z: py + (fly ? 16 : 0), f: () => drawPet(c, p.look.pet!, now, OX + px * S, OY + py * S, S, p.facing) });
      }
    }
    items.sort((a, b) => a.z - b.z);
    this.prof('ground+claims', tIs);
    tIs = performance.now();
    for (const it of items) it.f();
    this.prof('items', tIs);
    tIs = performance.now();

    this.parts.draw(c, OX, OY, S);
    if (this.quality && el < 1400) this.sky.drawShadows(c, OX, OY, S);

    // falling rock on a cave-in round
    if (el >= 0 && s?.caveIn) {
      for (let k = 0; k < 14; k++) {
        const tt = Math.max(0, el / 1000 - seeded(k + 400) * 1.2);
        const tx = MAP_W * 0.15 + seeded(k + 200) * MAP_W * 0.7;
        const ty = MAP_H * 0.25 + seeded(k + 300) * MAP_H * 0.55;
        const y = Math.min(ty, -MAP_H * 0.1 + MAP_H * 0.9 * tt * tt);
        if (tt > 0) draw(c, 'fx-rock-0', OX + tx * S, OY + y * S, S);
      }
    }

    // light: lamps, windows, the lighthouse, helmet lamps; skipped at noon
    const lights: { x: number; y: number; r: number; c: string; k: number }[] = [];
    const L = (x: number, y: number, r: number, col: string, k = 1) => lights.push({ x: OX + x * S, y: OY + y * S, r: r * S, c: col, k });
    const night = this.sky.night;
    if (night > 0.02 || this.sky.rain > 0.3) {
      for (const l of ISLE.lights as { x: number; y: number; r: number; c: string; f: number }[]) {
        const fl = 1 - l.f * 0.5 + Math.sin(now / 80 + l.x) * l.f * 0.25 + Math.random() * l.f * 0.15;
        L(l.x, l.y, l.r * fl, l.c, fl);
      }
      const addLamp = (lk: Look, pose: Pose, f: number, x: number, y: number, facing: number) => {
        const lp = lampOf(lk, pose, f, facing);
        if (lp) L(x + lp[0], y + lp[1], 22, '#fff1c8');
        const pl = petLight(lk.pet);
        if (pl) L(x - 11 * facing, y - 12, 16, pl);
      };
      addLamp(look, me.pose, mf, me.x, me.y, me.facing);
      for (const p of s?.peers ?? []) {
        const d = this.peers.get(p.id);
        if (d) addLamp(p.look, d.pose, frameAt(d.pose, d.since, now), d.x, d.y, p.facing);
      }
    }
    if (winner !== null && el >= 2500) {
      const cl = CLAIMS[winner];
      L(cl.cx, cl.cy - 6, 70 * Math.min(1, (el - 2500) / 300), '#ffd24a');
    }
    this.prof('parts+shadows', tIs);
    tIs = performance.now();
    this.sky.applyLight(c, DW, DH, lights);
    this.prof('light', tIs);
    tIs = performance.now();
    // the lighthouse sweeps the water at night
    if (night > 0.3) {
      const lh = ISLE.lighthouse as { x: number; y: number };
      const a = now / 1600;
      c.save();
      c.globalCompositeOperation = 'lighter';
      c.globalAlpha = night * 0.16;
      c.fillStyle = '#fff1b8';
      c.beginPath();
      const X = OX + lh.x * S;
      const Y = OY + lh.y * S;
      const R = 260 * S;
      c.moveTo(X, Y);
      c.lineTo(X + Math.cos(a - 0.09) * R, Y + Math.sin(a - 0.09) * R * 0.55);
      c.lineTo(X + Math.cos(a + 0.09) * R, Y + Math.sin(a + 0.09) * R * 0.55);
      c.closePath();
      c.fill();
      c.restore();
    }

    // the winner's beam of light
    if (winner !== null && el >= 2500) {
      const cl = CLAIMS[winner];
      const k = Math.min(1, (el - 2500) / 300);
      c.save();
      c.globalCompositeOperation = 'lighter';
      const R = 46 * S * (0.9 + 0.1 * Math.sin(now / 120));
      const gr = c.createRadialGradient(OX + cl.cx * S, OY + cl.cy * S, 0, OX + cl.cx * S, OY + cl.cy * S, R);
      gr.addColorStop(0, `rgba(255,210,74,${0.55 * k})`);
      gr.addColorStop(1, 'rgba(255,210,74,0)');
      c.fillStyle = gr;
      c.fillRect(OX + cl.cx * S - R, OY + cl.cy * S - R, R * 2, R * 2);
      draw(c, 'fx-beam-0', OX + cl.cx * S, OY + (cl.cy + 2) * S, S, false, 0.85 * k);
      c.restore();
      if (Math.random() < 0.5) this.parts.burst('star', cl.cx + (Math.random() - 0.5) * 16, cl.cy - Math.random() * 30, 1, 4, 6, ['#fff1a8', '#ffffff'], 0.9);
      if (s?.motherlode && el < 5000 && Math.random() < 0.8)
        this.parts.spawn('coin', FIT_X + Math.random() * FIT_W, cl.cy, { z: 90 + Math.random() * 60, vz: -10, life: 2.4, c: Math.random() < 0.5 ? '#ffd24a' : '#fff1a8', s: 2 });
    }

    // birds, then clouds over it all; the clouds thin as the camera comes down
    const zoomK = cam.z / cam.fitZ;
    const [bw] = [0];
    void bw;
    for (const f of this.flocks) {
      f.x += f.sp * f.dir * dt;
      if (f.x > 520) f.x = -140;
      if (f.x < -140) f.x = 520;
      for (let b = 0; b < f.n; b++) {
        const bx = f.x - f.dir * b * 9;
        const by = f.y + Math.sin(now / 700 + b) * 3 + b * 4;
        const up = Math.sin(now / 160 + b * 1.7) > 0;
        draw(c, up ? 'bird-0' : 'bird-1', OX + bx * S, OY + by * S, S, f.dir < 0, 0.9);
      }
    }
    const parting = el >= 1400 ? Math.max(0.1, 1 - (el - 1400) / 600) : 1;
    this.sky.drawClouds(c, OX, OY, S, Math.max(0, Math.min(1, 1.6 - zoomK * 0.6)) * parting);
    this.sky.drawRain(c, DW, DH, Math.max(1, Math.round(dpr)));
    if (this.sky.lightning > 0.3) {
      c.fillStyle = `rgba(255,255,255,${(this.sky.lightning - 0.3) * 0.5})`;
      c.fillRect(0, 0, DW, DH);
    }

    this.prof('sky', tIs);
    if (forClose) return;
    tIs = performance.now();
    this.drawLabels(c, now, el, OX, OY, S);
    this.prof('labels', tIs);
  }

  /** Text on the map: region names, the SOL on each claim, solo stars, name tags. */
  private drawLabels(c: Ctx, now: number, el: number, OX: number, OY: number, S: number) {
    const s = this.snap;
    const dpr = this.dpr;
    const zoomK = this.cam.z / this.cam.fitZ;
    const fs = Math.max(1, Math.round(dpr * Math.min(2, 1.25 + (zoomK - 1) * 0.5)));
    const regionA = Math.max(0, Math.min(1, (zoomK - 1.3) * 2)) * Math.max(0, Math.min(1, 3.2 - zoomK));
    if (regionA > 0) {
      c.globalAlpha = regionA * 0.75;
      for (const [name, x, y] of REGIONS) textCentered(c, name, OX + x * S, OY + y * S, fs, '#eef4ff', 'rgba(2,5,15,0.6)');
      c.globalAlpha = 1;
    }
    const winner = s?.winner ?? null;
    if (s && (el < 0 || el < 2500)) {
      const solo = s.solo;
      for (let i = 0; i < BLOCKS; i++) {
        const cl = CLAIMS[i];
        const v = s.perBlock[i] ?? 0;
        const mine = Boolean(s.pending & (1 << i));
        const picked = s.selected.includes(i);
        const star = Boolean(solo & (1 << i)) && !(el >= 1400 && winner !== null && winner !== i);
        const zoomedIn = this.cam.z / this.cam.fitZ >= 1.4;
        if (!(s.amounts || zoomedIn) || (v <= 0 && !mine && !picked)) {
          if (star) text(c, '*', Math.round(OX + (cl.cx + 5) * S), Math.round(OY + (cl.cy - 14) * S), fs, '#ffd84a', '#3a1d00');
          continue;
        }
        const t = fmtAmt(v);
        const w = (textWidth(t) + 4) * fs;
        const h = 8 * fs;
        const X = Math.round(OX + cl.cx * S - w / 2);
        const Y = Math.round(OY + (cl.cy + 5) * S);
        c.fillStyle = mine ? '#ffd84a' : '#2a4480';
        c.fillRect(X - fs, Y - fs, w + 2 * fs, h + 2 * fs);
        c.fillStyle = 'rgba(7,13,32,0.9)';
        c.fillRect(X, Y, w, h);
        text(c, t, X + 2 * fs, Y + Math.round(1.5 * fs), fs, v > 0 ? (mine ? '#ffd84a' : '#bfe9ff') : '#6f82b0');
        if (star) text(c, '*', X + w + 2 * fs, Y - 4 * fs, fs, '#ffd84a', '#3a1d00');
      }
    }
    // live deploy feed labels: "+0.12" on a dark plate, rising over the spot for ~2s (readable on any terrain)
    for (const l of this.landed) {
      const age = now - l.at;
      const cl = CLAIMS[l.i];
      const k = Math.max(fs + 1, Math.round(fs * 1.6));
      const t = `+${fmtAmt(l.add)}`;
      const w = (textWidth(t) + 4) * k;
      const h = 8 * k;
      const X = Math.round(OX + (cl.cx + 6) * S - w / 2);
      const Y = Math.round(OY + (cl.cy - 24) * S - Math.min(age, 1200) / 40 * fs);
      c.globalAlpha = Math.max(0, Math.min(1, (2200 - age) / 700));
      c.fillStyle = '#ffffff';
      c.fillRect(X - k, Y - k, w + 2 * k, h + 2 * k);
      c.fillStyle = 'rgba(7,13,32,0.95)';
      c.fillRect(X, Y, w, h);
      text(c, t, X + 2 * k, Y + Math.round(1.5 * k), k, '#7fe3ff', '#02050f');
    }
    c.globalAlpha = 1;
    // name tags
    const tag = (label: string, x: number, y: number, col: string, emoji: string | null) => {
      const w = (textWidth(label) + 4) * fs;
      const X = Math.round(OX + x * S - w / 2);
      const Y = Math.round(OY + (y - 31) * S - 9 * fs);
      c.fillStyle = 'rgba(7,13,32,0.85)';
      c.fillRect(X, Y, w, 8 * fs);
      c.fillStyle = col;
      c.fillRect(X, Y + 8 * fs, w, Math.max(1, fs / 2));
      text(c, label, X + 2 * fs, Y + Math.round(1.5 * fs), fs, col);
      if (emoji) {
        c.font = `${Math.round(10 * fs)}px sans-serif`;
        c.textAlign = 'center';
        c.fillText(emoji, X + w / 2, Y - 2 * fs);
      }
    };
    const me = this.me;
    tag('YOU', me.x, me.y, '#ffcf4a', s && now - s.me.emoteAt < 2500 ? s.me.emoji : null);
    for (const p of s?.peers ?? []) {
      const d = this.peers.get(p.id);
      if (!d) continue;
      // other people's names only once you've zoomed in, or when they wave
      if (zoomK < 1.5 && !p.emoji) continue;
      const near = Math.hypot(d.x - me.x, d.y - me.y) < 28;
      tag(`${p.name}${near ? ' - TAP' : ''}`, d.x, d.y, p.tone === 'bot' ? '#8ea2cc' : p.tone === 'verified' ? '#14f195' : '#f2f5ff', p.emoji);
    }
  }

  /* ---------------- inside a claim ---------------- */
  private closeupGeom() {
    const cam = this.cam;
    const dpr = this.dpr;
    const vw = this.W;
    const vh = cam.vh;
    // whole device pixels per art pixel where the screen allows it; a fraction on
    // small or low-density screens rather than a scene too small to read
    const raw = Math.min(vw / 168, vh / (SH - 44)) * dpr;
    const s = raw >= 3 ? Math.floor(raw) : Math.max(1, raw);
    const ox = Math.round((vw * dpr) / 2 - SCENE_CX * s);
    const oy = Math.round(cam.vy * dpr + (vh * dpr - (SH - 40) * s) / 2 - 20 * s);
    return { s, ox, oy };
  }

  private drawCloseup(c: Ctx, now: number, dt: number, el: number) {
    const s = this.snap;
    const sc = this.scenes.get(this.focus);
    if (!sc || !this.visit) return;
    const { s: S, ox, oy } = this.closeupGeom();
    const DW = this.canvas.width;
    const DH = this.canvas.height;
    const deep = sc.biome.deep[2];
    c.fillStyle = deep;
    c.fillRect(0, 0, DW, DH);
    const i = sc.i;
    const lights = drawScene(
      c,
      sc,
      this.visit,
      {
        now,
        dt,
        el,
        winner: s?.winner ?? null,
        sol: s?.perBlock[i] ?? 0,
        mine: s?.mine[i] ?? 0,
        picked: Boolean(s?.selected.includes(i)),
        deployed: Boolean(s && s.pending & (1 << i)),
        solo: Boolean(s && s.solo & (1 << i)),
        look: s?.me.look ?? DEFAULT_LOOK,
        night: this.sky.night,
        skyAmbient: this.sky.ambient(),
        wind: this.sky.wind,
        quality: this.quality,
      },
      ox,
      oy,
      S,
      this.parts,
      (n) => this.emit({ t: 'sfx', name: n }),
    );
    this.parts.draw(c, ox, oy, S);
    this.sky.applyLight(c, DW, DH, lights, 0, paintUnderground(sc, ox, oy, S, DW, DH, this.sky.ambient()));
    // edge vignette so the diorama sits in the screen rather than on it
    const g = c.createLinearGradient(0, 0, DW, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.18)');
    g.addColorStop(0.12, 'rgba(0,0,0,0)');
    g.addColorStop(0.88, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.18)');
    c.fillStyle = g;
    c.fillRect(0, 0, DW, DH);
  }

  /** Dive in or climb out: the camera flies, then the picture dissolves in pixel blocks. */
  private drawTransition(c: Ctx, t: number, now: number, dt: number, el: number) {
    const k = (t - this.modeAt) / (this.mode === 'enter' ? 760 : 700);
    const DW = this.canvas.width;
    const DH = this.canvas.height;
    if (k >= 1) {
      this.mode = this.mode === 'enter' ? 'closeup' : 'island';
      if (this.mode === 'island') this.visit = null;
      if (this.mode === 'closeup') this.drawCloseup(c, now, dt, el);
      else this.drawIsland(c, now, dt, el);
      return;
    }
    // how much of the close-up shows: none until the fly-in is well under way
    const reveal = this.mode === 'enter' ? Math.max(0, Math.min(1, (k - 0.45) / 0.5)) : Math.max(0, Math.min(1, 1 - k / 0.55));
    if (reveal < 1) this.drawIsland(c, now, dt, el, true);
    if (reveal <= 0) return;
    if (!this.layer || this.layer.width !== DW || this.layer.height !== DH) {
      this.layer = makeCanvas(DW, DH);
      this.mask = makeCanvas(Math.ceil(DW / (8 * this.dpr)), Math.ceil(DH / (8 * this.dpr)));
    }
    const lg = ctx2d(this.layer);
    lg.globalCompositeOperation = 'source-over';
    lg.clearRect(0, 0, DW, DH);
    this.drawCloseup(lg, now, dt, el);
    // an ordered-dither dissolve, in chunky blocks, radiating from the centre
    const m = this.mask!;
    const mg = ctx2d(m);
    mg.clearRect(0, 0, m.width, m.height);
    mg.fillStyle = '#000';
    const BY = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    for (let y = 0; y < m.height; y++)
      for (let x = 0; x < m.width; x++) {
        const dx = (x - m.width / 2) / m.width;
        const dy = (y - m.height / 2) / m.height;
        const th = (BY[(y & 3) * 4 + (x & 3)] / 16) * 0.55 + Math.hypot(dx, dy) * 0.9;
        if (th < reveal * 1.45) mg.fillRect(x, y, 1, 1);
      }
    lg.globalCompositeOperation = 'destination-in';
    lg.imageSmoothingEnabled = false;
    lg.drawImage(m, 0, 0, m.width, m.height, 0, 0, m.width * 8 * this.dpr, m.height * 8 * this.dpr);
    c.drawImage(this.layer, 0, 0);
  }

  /* ---------------- input ---------------- */
  private bindInput() {
    const cv = this.canvas;
    cv.style.touchAction = 'none';
    const pos = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    cv.addEventListener('pointerdown', (e) => {
      const p = pos(e);
      cv.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: p.x, y: p.y, x0: p.x, y0: p.y, t0: performance.now() });
      this.moved = false;
      this.longPressed = false;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
        this.cancelPress();
      } else if (this.pointers.size === 1 && this.mode === 'island') {
        this.cancelPress();
        this.pressTimer = setTimeout(() => this.longPress(p.x, p.y), 430);
      }
    });
    cv.addEventListener('pointermove', (e) => {
      const q = this.pointers.get(e.pointerId);
      if (!q) return;
      const p = pos(e);
      const dx = p.x - q.x;
      const dy = p.y - q.y;
      q.x = p.x;
      q.y = p.y;
      if (Math.hypot(p.x - q.x0, p.y - q.y0) > 9) {
        this.moved = true;
        this.cancelPress();
      }
      if (this.mode !== 'island') return;
      if (this.pointers.size === 2 && this.pinch) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        this.cam.zoomAt(mx, my, d / this.pinch.d);
        this.cam.pan(mx - this.pinch.mx, my - this.pinch.my);
        this.pinch = { d, mx, my };
      } else if (this.moved && this.cam.userZoomed) this.cam.pan(dx, dy);
    });
    const up = (e: PointerEvent) => {
      const q = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = null;
      this.cancelPress();
      if (!q || this.longPressed) return;
      const dt = performance.now() - q.t0;
      const dx = q.x - q.x0;
      if (this.mode === 'closeup' && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(q.y - q.y0) * 1.5 && dt < 600) {
        // swipe between claims
        const next = (this.focus + (dx < 0 ? 1 : BLOCKS - 1)) % BLOCKS;
        this.setFocus(next);
        return;
      }
      if (this.moved || dt > 600 || this.pointers.size > 0) return;
      this.tap(q.x, q.y);
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', (e) => {
      this.pointers.delete(e.pointerId);
      this.pinch = null;
      this.cancelPress();
    });
    cv.addEventListener(
      'wheel',
      (e) => {
        if (this.mode !== 'island') return;
        e.preventDefault();
        const r = cv.getBoundingClientRect();
        this.cam.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
      },
      { passive: false },
    );
  }
  private cancelPress() {
    if (this.pressTimer) clearTimeout(this.pressTimer);
    this.pressTimer = null;
  }
  private cancelTap() {
    if (this.tapTimer) clearTimeout(this.tapTimer);
    this.tapTimer = null;
  }
  /** Press and hold a spot to dive into it: the same as a double tap, for anyone who misses one. */
  private longPress(x: number, y: number) {
    this.pressTimer = null;
    if (this.moved || this.mode !== 'island') return;
    const [mx, my] = this.cam.toMap(x, y);
    const hit = claimForTap(mx, my);
    if (hit < 0) return;
    this.longPressed = true;
    this.cancelTap();
    this.setFocus(hit);
  }
  /** A single tap on a spot picks or unpicks it. Ignored while a round is being revealed. */
  private pick(hit: number) {
    this.tapTimer = null;
    if (this.mode !== 'island' || this.revealEl(Date.now()) >= 0) return;
    const cl = CLAIMS[hit];
    this.parts.burst('star', cl.cx, cl.cy, 8, 30, 20, ['#5ceeff', '#ffffff'], 0.6);
    this.emit({ t: 'toggle', claim: hit });
  }

  private tap(x: number, y: number) {
    const now = Date.now();
    const s = this.snap;
    if (this.mode === 'closeup') {
      // tap your miner for a cheer; anything else, nothing
      const { s: S, ox, oy } = this.closeupGeom();
      const v = this.visit;
      if (v) {
        const px = (ox + v.me.x * S) / this.dpr;
        const py = (oy + v.me.y * S) / this.dpr;
        if (Math.abs(x - px) < 16 && y < py + 4 && y > py - 40) this.emit({ t: 'emote' });
      }
      return;
    }
    if (this.mode !== 'island') return;
    const [mx, my] = this.cam.toMap(x, y);
    // double tap: on a spot it dives in, anywhere else it zooms in or back out
    if (now - this.lastTap.t < 280 && Math.hypot(x - this.lastTap.x, y - this.lastTap.y) < 24) {
      const prev = this.lastTap.hit;
      this.lastTap.t = 0;
      this.cancelTap();
      if (prev >= 0) {
        this.setFocus(prev);
        return;
      }
      if (this.cam.userZoomed) this.cam.home(360);
      else {
        this.cam.userZoomed = true;
        this.cam.flyTo(mx, my, this.cam.fitZ * 2.4, 360);
      }
      return;
    }
    this.lastTap = { t: now, x, y, hit: -1 };
    const hitR = 11;
    // you, then other miners
    if (Math.abs(mx - this.me.x) < 8 && my < this.me.y + 2 && my > this.me.y - 24) return this.emit({ t: 'emote' });
    for (const p of s?.peers ?? []) {
      const d = this.peers.get(p.id);
      if (d && Math.abs(mx - d.x) < 8 && my < d.y + 2 && my > d.y - 24) return this.emit({ t: 'peer', id: p.id });
    }
    const hit = claimForTap(mx, my);
    const el = this.revealEl(now);
    if (hit >= 0) {
      this.lastTap.hit = hit;
      const mo = this.mole;
      if (mo.idx === hit && mo.bonkedAt < 0 && el < 0) {
        const cl = CLAIMS[hit];
        if (Math.hypot(mx - (cl.cx - 12), my - (cl.cy + 2)) < hitR + 6) {
          mo.bonkedAt = now;
          this.parts.burst('star', cl.cx - 12, cl.cy - 6, 6, 24, 18, ['#ffd84a', '#ffffff'], 0.6);
          this.emit({ t: 'bonk' });
          return;
        }
      }
      // wait out the double-tap window, then count it as a pick
      this.cancelTap();
      this.tapTimer = setTimeout(() => this.pick(hit), 260);
      return;
    }
    // open ground or sea: walk to the nearest dry land
    const [gx, gy] = toLand(mx, my);
    this.me.path = findPath(this.me.x, this.me.y, gx, gy);
    this.me.target = -1;
    this.me.pose = 'walk';
    this.me.since = now;
    this.me.manualUntil = now + 8000;
    this.parts.spawn('ring', gx, gy, { life: 0.5, c: '#ffffff' });
  }
}

export type { Snapshot, EngineEvent, PeerView };
export { has, drawCanvas };
