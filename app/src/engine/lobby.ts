/**
 * The lobby, drawn and walked: one canvas, one loop.
 *
 * A pixel town every player shares: a plaza with a fountain in the middle, a pier to
 * Gali Island on the east shore, the Cave Run mouth under the cliff in the north west,
 * and the market hall in the north east. Everyone is a miner you can see walking about.
 * Tap or drag to walk. Walk into a door to go through it.
 *
 * What is where, and the way across it, lives in game/lobbyMap.ts. This file draws it
 * and moves the people in it. It reuses the island's atlas, miner, pets, sky and
 * particles, so your miner looks the same here as everywhere else.
 *
 * It tells the app three things: where your miner is (to share), that you walked through a
 * door, and a few sounds.
 */
import { draw, has, makeCanvas, ctx2d, rect, sprite, text, textCentered, textWidth, loadAtlas, type Ctx } from './art';
import { drawMiner, drawPet, frameAt, lampOf, stepBody, type Body } from './actors';
import { Particles } from './particles';
import { Sky } from './sky';
import type { Look } from './types';
import { CLIFF, DOORS, STRUCTURES, doorAt, GRASS, HALL, LCOLS, LH, LROWS, LT, LW, lidx, lobbyMap, lobbyPath, PLANK, PLAZA, ROAD, SAND, SPAWNS, standable, tileCentre, tileOf, WATER, type DoorId } from '../game/lobbyMap';

export type LobbyEvent =
  | { t: 'ready' }
  | { t: 'me'; x: number; y: number; tx: number; ty: number; facing: 1 | -1; pose: string }
  | { t: 'door'; id: DoorId }
  | { t: 'peer'; id: string }
  | { t: 'sfx'; name: 'step' | 'door' | 'pop' };

export interface LobbyPeerView {
  id: string;
  name: string;
  x: number;
  y: number;
  tx: number;
  ty: number;
  f: 1 | -1;
  p: string;
  look: Look;
  say: string | null;
  emoji: string | null;
}
export interface LobbySnap {
  peers: LobbyPeerView[];
  say: string | null;
  emoji: string | null;
}
export interface LobbyOpts {
  spawn: 'start' | DoorId;
  /** CSS pixels the header covers, and the bottom panel covers */
  top: number;
  bottom: number;
}

const SPEED = 58;
const seeded = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const DOOR_COLOR: Record<DoorId, string> = { island: '#3de0c8', cave: '#ff9a3d', market: '#b86bff' };

interface Walker extends Body {
  tx: number;
  ty: number;
  lastTx: number;
  lastTy: number;
  fp: string;
}
interface Item {
  y: number;
  draw: () => void;
}

/** The sky's clouds are laid out for the island; the lobby map is about 2.5x wider, so spread and enlarge them. */
const CLOUD_KX = 2.4;
const CLOUD_KY = 3.4;
const CLOUD_S = 1.9;

export class LobbyEngine {
  private c: Ctx;
  private dpr = 1;
  private W = 1;
  private H = 1;
  private z = 3;
  private zoomK = 1;
  private cam = { x: 0, y: 0 };
  private sky = new Sky();
  private parts = new Particles();
  private ground: HTMLCanvasElement | null = null;
  private mini: HTMLCanvasElement | null = null;
  private shimmer: { x: number; y: number; ph: number }[] = [];
  private pondPads: { x: number; y: number }[] = [];
  private raf = 0;
  private last = 0;
  private ready = false;
  private snap: LobbySnap = { peers: [], say: null, emoji: null };
  private peers = new Map<string, Walker & { view: LobbyPeerView }>();
  private me: Walker;
  private mySayAt = 0;
  private myEmojiAt = 0;
  private lastSay: string | null = null;
  private lastEmoji: string | null = null;
  private pointers = new Map<number, { x: number; y: number; x0: number; y0: number; t0: number }>();
  private pinch = 0;
  private steering = false;
  private steerAt = 0;
  private keys = new Set<string>();
  private keyAt = 0;
  /** the on-screen stick: which finger holds it, and how far it is pushed (-1..1) */
  private stick: { id: number; dx: number; dy: number } | null = null;
  private direct = false;
  private tapMark: { x: number; y: number; at: number } | null = null;
  private leaving: { id: DoorId; at: number; sent: boolean } | null = null;
  private born = 0;
  private lastStep = 0;
  private lastEmit = 0;
  private lastEmitKey = '';
  private lastBeat = 0;
  private quality = 1;
  private fpsAcc = { n: 0, t: 0 };
  private minimapRect = { x: 0, y: 0, w: 1, h: 1 };
  private flagFrames = 1;
  private onKey = (e: KeyboardEvent) => this.key(e, true);
  private onKeyUp = (e: KeyboardEvent) => this.key(e, false);

  constructor(
    private canvas: HTMLCanvasElement,
    private emit: (e: LobbyEvent) => void,
    private look: Look,
    private opts: LobbyOpts,
  ) {
    this.c = ctx2d(canvas);
    const [sx, sy] = tileCentre(...SPAWNS[opts.spawn]);
    this.me = { x: sx, y: sy, path: [], pose: 'idle', since: 0, facing: 1, tx: sx, ty: sy, lastTx: sx, lastTy: sy, fp: '' };
    this.cam = { x: sx, y: sy };
    this.bindInput();
    (globalThis as unknown as { __galiLobby?: LobbyEngine }).__galiLobby = this;
  }

  setLook(l: Look) {
    this.look = l;
  }
  setOpts(o: Partial<LobbyOpts>) {
    this.opts = { ...this.opts, ...o };
  }
  push(s: LobbySnap) {
    this.snap = s;
    this.syncPeers(s.peers);
    if (s.say && s.say !== this.lastSay) this.mySayAt = Date.now();
    this.lastSay = s.say;
    if (s.emoji && s.emoji !== this.lastEmoji) this.myEmojiAt = Date.now();
    this.lastEmoji = s.emoji;
  }
  /** Walk to a door (the buttons in the app use this). */
  goTo(id: DoorId) {
    const d = DOORS.find((k) => k.id === id);
    if (!d) return;
    const [x, y] = tileCentre(d.x + Math.floor(d.w / 2), d.y + Math.floor(d.h / 2));
    this.walkTo(x, y);
  }

  async start(atlasUrl: string) {
    await loadAtlas(atlasUrl);
    this.flagFrames = Math.max(1, [0, 1, 2, 3, 4, 5].filter((k) => has(`fx-flag-${k}`)).length);
    this.buildGround();
    this.born = performance.now();
    this.last = performance.now();
    const loop = (t: number) => {
      this.raf = requestAnimationFrame(loop);
      this.frame(t);
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop() {
    cancelAnimationFrame(this.raf);
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKey);
      window.removeEventListener('keyup', this.onKeyUp);
    }
  }

  /* ------------------------------------------------------------------ */
  /* the ground, painted once                                            */
  /* ------------------------------------------------------------------ */
  private buildGround() {
    const m = lobbyMap();
    const cv = makeCanvas(LW, LH);
    const g = ctx2d(cv);
    const T = LT;
    const px = (x: number, y: number, w: number, h: number, col: string) => {
      g.fillStyle = col;
      g.fillRect(x, y, w, h);
    };
    const GR = ['#69a846', '#5f9d41', '#74b34e', '#6aa944'];
    const at = (tx: number, ty: number) => (tx < 0 || ty < 0 || tx >= LCOLS || ty >= LROWS ? WATER : m.terrain[lidx(tx, ty)]);

    for (let ty = 0; ty < LROWS; ty++)
      for (let tx = 0; tx < LCOLS; tx++) {
        const t = at(tx, ty);
        const x = tx * T;
        const y = ty * T;
        const n = (k: number) => seeded(tx * 31 + ty * 57 + k * 13.7);
        if (t === WATER) {
          px(x, y, T, T, '#2f7fc4');
          for (let k = 0; k < 3; k++) px(x + Math.floor(n(k) * 12), y + Math.floor(n(k + 5) * 14), 4, 1, '#3a8fd6');
          for (let k = 0; k < 2; k++) px(x + Math.floor(n(k + 9) * 12), y + Math.floor(n(k + 3) * 14), 3, 1, '#2a72b0');
        } else if (t === SAND) {
          px(x, y, T, T, '#e6d29a');
          for (let k = 0; k < 7; k++) px(x + Math.floor(n(k) * 15), y + Math.floor(n(k + 4) * 15), 1, 1, k % 2 ? '#d6c084' : '#f2e2b0');
        } else if (t === PLAZA) {
          px(x, y, T, T, (tx + ty) % 2 ? '#bab3a7' : '#b1aa9e');
          px(x, y + T - 1, T, 1, '#9d968a');
          px(x + T - 1, y, 1, T, '#9d968a');
          px(x, y, T, 1, '#cbc5ba');
          for (let k = 0; k < 4; k++) px(x + Math.floor(n(k) * 14), y + Math.floor(n(k + 6) * 14), 2, 1, k % 2 ? '#a39c90' : '#c4beb2');
        } else if (t === ROAD) {
          px(x, y, T, T, '#c9a572');
          for (let k = 0; k < 9; k++) px(x + Math.floor(n(k) * 15), y + Math.floor(n(k + 4) * 15), k % 3 === 0 ? 2 : 1, 1, k % 2 ? '#b38f5e' : '#dcbb88');
        } else if (t === CLIFF || t === HALL) {
          px(x, y, T, T, '#4d4858');
        } else if (t === PLANK) {
          px(x, y, T, T, '#2f7fc4');
        } else {
          const base = GR[Math.floor(n(1) * 4)];
          px(x, y, T, T, base);
          for (let k = 0; k < 5; k++) px(x + Math.floor(n(k + 2) * 15), y + Math.floor(n(k + 8) * 14), 1, 2, k % 2 ? '#55903a' : '#82c25a');
        }
      }
    // foam where water meets land
    for (let ty = 0; ty < LROWS; ty++)
      for (let tx = 0; tx < LCOLS; tx++) {
        if (at(tx, ty) !== WATER) continue;
        const x = tx * T;
        const y = ty * T;
        if (at(tx - 1, ty) !== WATER && at(tx - 1, ty) !== PLANK) px(x, y, 2, T, '#cfeaff');
        if (at(tx + 1, ty) !== WATER && at(tx + 1, ty) !== PLANK) px(x + T - 2, y, 2, T, '#cfeaff');
        if (at(tx, ty - 1) !== WATER && at(tx, ty - 1) !== PLANK) px(x, y, T, 2, '#cfeaff');
        if (at(tx, ty + 1) !== WATER && at(tx, ty + 1) !== PLANK) px(x, y + T - 2, T, 2, '#cfeaff');
        if (seeded(tx * 3 + ty * 7) < 0.1) this.shimmer.push({ x: x + 3, y: y + 5, ph: seeded(tx + ty * 9) * 6.28 });
        else if (seeded(tx * 5 + ty * 3) < 0.07) this.shimmer.push({ x: x + 6, y: y + 10, ph: seeded(tx * 2 + ty) * 6.28 });
      }

    // lily pads on the pond
    for (let k = 0; k < 9; k++) {
      const x = (8 + Math.floor(seeded(k * 4.3) * 13)) * T + 4;
      const y = (37 + Math.floor(seeded(k * 9.1) * 8)) * T + 4;
      if (at(Math.floor(x / T), Math.floor(y / T)) !== WATER) continue;
      px(x, y, 7, 4, '#3f9a4a');
      px(x + 1, y - 1, 5, 1, '#4fb25a');
      px(x + 3, y + 1, 2, 1, '#2f7fc4');
      if (k % 3 === 0) px(x + 2, y - 2, 2, 2, '#ffb3d9');
    }

    // cave cliff
    this.paintCliff(g, px);
    // market hall
    this.paintHall(g, px);
    // pier
    this.paintPier(g, px);
    this.paintPlaces(g, px);
    // plaza: a ring round the fountain, and the name in the stone
    this.paintPlaza(g, px);

    // soft shadows under things that stand
    g.fillStyle = 'rgba(25,45,25,0.28)';
    for (const t of m.trees) {
      g.beginPath();
      g.ellipse(t.x * T + 8, t.y * T + 14, 9, 3.4, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = 'rgba(0,0,0,0.22)';
    g.fillRect(5 * T, 12 * T, 21 * T, 5);
    g.fillRect(45 * T, 9 * T, 15 * T, 5);

    // flowers, tufts, bushes and stones: small things, scaled so they read beside a miner
    for (const d of m.decor) {
      const sp = sprite(`${d.s}-0`);
      const r = rect(`${d.s}-0`);
      if (!sp || !r) continue;
      const s = d.s.includes('flower') || d.s.includes('tuft') ? 2 : 2;
      const dx = d.x * T + 8 + Math.floor((seeded(d.x * 3 + d.y) - 0.5) * 6);
      const dy = d.y * T + 12 + Math.floor(seeded(d.x + d.y * 5) * 3);
      g.drawImage(sp, dx - r[4] * s, dy - r[5] * s, r[2] * s, r[3] * s);
    }
    this.ground = cv;
    this.buildMini();
  }

  private paintCliff(g: Ctx, px: (x: number, y: number, w: number, h: number, c: string) => void) {
    const x0 = 5 * LT;
    const y0 = 1 * LT;
    const w = 21 * LT;
    const h = 11 * LT;
    const m = lobbyMap();
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const tx = Math.floor((x0 + x) / LT);
        const ty = Math.floor((y0 + y) / LT);
        if (m.terrain[lidx(tx, ty)] !== CLIFF) continue;
        const k = y / h;
        const n = seeded(x * 1.7 + y * 9.3);
        let col = k < 0.2 ? '#9a95a2' : k < 0.55 ? '#7b7685' : k < 0.85 ? '#645f70' : '#514c5c';
        if (n < 0.12) col = k < 0.5 ? '#a7a2ae' : '#6e6979';
        else if (n > 0.9) col = '#4a4556';
        // ledges
        if (y % 26 === 0 && seeded(Math.floor(x / 14) + y) > 0.35) col = '#b3aeb9';
        if (y % 26 === 1 && seeded(Math.floor(x / 14) + y - 1) > 0.35) col = '#3f3a48';
        // cracks
        if (seeded(Math.floor(x / 3) * 7.1 + Math.floor(y / 22)) > 0.93 && y % 22 > 3) col = '#3b3644';
        px(x0 + x, y0 + y, 1, 1, col);
      }
    // moss
    for (let k = 0; k < 70; k++) {
      const x = x0 + Math.floor(seeded(k * 2.1) * w);
      const y = y0 + Math.floor(seeded(k * 5.3) * h * 0.8);
      const tx = Math.floor(x / LT);
      const ty = Math.floor(y / LT);
      if (m.terrain[lidx(tx, ty)] !== CLIFF) continue;
      px(x, y, 3 + (k % 3), 2, '#5b8f4a');
      px(x + 1, y - 1, 2, 1, '#74b34e');
    }
    // the mouth: an arch of stone round a dark opening
    const cx = 15 * LT + 8;
    const top = 7 * LT;
    const bottom = 11 * LT;
    for (let y = top - 6; y < bottom; y++) {
      for (let x = cx - 44; x <= cx + 44; x++) {
        const dx = x - cx;
        const arc = y < top + 28 ? Math.sqrt(Math.max(0, 40 * 40 - Math.pow(Math.max(0, top + 28 - y), 2) * 1.55)) : 40;
        if (Math.abs(dx) <= 40 + 4 && Math.abs(dx) > arc - 0 && y >= top - 2 && Math.abs(dx) <= 44) px(x, y, 1, 1, (x + y) % 5 === 0 ? '#bdb7c4' : '#a49eac');
        if (Math.abs(dx) <= arc - 1 && y >= top + 2) {
          const k = (y - top) / (bottom - top);
          px(x, y, 1, 1, k < 0.5 ? '#0c0711' : k < 0.8 ? '#150d1b' : '#1e1426');
        }
      }
    }
    // stone blocks on the arch
    for (let a = -2; a <= 2; a++) px(cx + a * 15 - 2, top - 5, 4, 5, '#8c8694');
    // wooden posts and a beam
    px(cx - 40, top + 14, 5, bottom - top - 14, '#6b4a2b');
    px(cx + 36, top + 14, 5, bottom - top - 14, '#6b4a2b');
    px(cx - 40, top + 14, 5, 2, '#8b6a42');
    px(cx + 36, top + 14, 5, 2, '#8b6a42');
    px(cx - 42, top + 12, 85, 5, '#7b5a35');
    px(cx - 42, top + 12, 85, 1, '#9b7a50');
    // lamp hooks
    px(cx - 30, top + 17, 1, 6, '#3b2a18');
    px(cx + 30, top + 17, 1, 6, '#3b2a18');
    // rails running out onto the road
    for (let y = 10 * LT; y < 12 * LT; y += 4) {
      px(cx - 12, y + 1, 24, 2, '#6b4a2b');
    }
    px(cx - 8, 10 * LT, 2, 2 * LT, '#8a8a96');
    px(cx + 6, 10 * LT, 2, 2 * LT, '#8a8a96');
  }

  private paintHall(g: Ctx, px: (x: number, y: number, w: number, h: number, c: string) => void) {
    const x0 = 45 * LT;
    const y0 = 2 * LT;
    const w = 15 * LT;
    const h = 7 * LT;
    // wall
    px(x0, y0 + 40, w, h - 40, '#e8d5a3');
    for (let y = y0 + 40; y < y0 + h; y += 8) px(x0, y, w, 1, '#d9c48c');
    // timber frame
    for (let k = 0; k <= 5; k++) px(x0 + k * 48 - (k === 5 ? 6 : 0), y0 + 40, 6, h - 40, '#7a5330');
    px(x0, y0 + 40, w, 4, '#7a5330');
    px(x0, y0 + h - 5, w, 5, '#5e4126');
    // windows
    for (const wx of [x0 + 14, x0 + 62, x0 + 158, x0 + 206]) {
      px(wx, y0 + 56, 28, 22, '#5b3b22');
      px(wx + 2, y0 + 58, 24, 18, '#2a4a7a');
      px(wx + 2, y0 + 58, 24, 5, '#3d6ba8');
      px(wx + 13, y0 + 58, 2, 18, '#5b3b22');
      px(wx - 3, y0 + 56, 4, 22, '#2f7a6a');
      px(wx + 27, y0 + 56, 4, 22, '#2f7a6a');
    }
    // roof
    for (let y = 0; y < 42; y++) {
      const row = Math.floor(y / 6);
      for (let x = 0; x < w; x++) {
        const shift = row % 2 ? 6 : 0;
        const edge = (x + shift) % 12 === 0 || y % 6 === 5;
        const k = y / 42;
        px(x0 + x, y0 + y, 1, 1, edge ? '#8f3322' : k < 0.3 ? '#d86a45' : k < 0.7 ? '#c4533a' : '#ac4430');
      }
    }
    px(x0 - 4, y0 + 38, w + 8, 5, '#6e2a1c');
    px(x0 - 4, y0 + 38, w + 8, 1, '#a8452f');
    // a little gable over the door
    for (let y = 0; y < 22; y++) px(x0 + 6 * 16 - y * 0 - 8 + (22 - y), y0 + 20 + y, 60 - (22 - y) * 2, 1, y > 18 ? '#6e2a1c' : '#e6c26a');
    // the door: a high arch, warm inside
    const dx = 51 * LT;
    for (let y = 0; y < 44; y++)
      for (let x = 0; x < 48; x++) {
        const cx = x - 24;
        const topCurve = y < 16 ? Math.sqrt(Math.max(0, 24 * 24 - Math.pow(16 - y, 2) * 2.3)) : 24;
        if (Math.abs(cx) <= topCurve) px(dx + x, y0 + h - 44 + y, 1, 1, y < 14 ? '#3a2412' : '#4a2e18');
      }
    for (let y = 0; y < 44; y++) px(dx + 4, y0 + h - 44 + y, 40, 1, y < 12 ? '#3a2412' : seeded(y) > 0.5 ? '#5a3a1e' : '#4e3219');
    px(dx - 4, y0 + h - 46, 4, 46, '#7a5330');
    px(dx + 48, y0 + h - 46, 4, 46, '#7a5330');
    px(dx + 22, y0 + h - 30, 4, 30, '#2c1a0c');
    // stalls either side of the door
    const stall = (sx: number, c1: string, c2: string) => {
      for (let x = 0; x < 64; x += 8) {
        px(sx + x, y0 + h - 40, 8, 12, (x / 8) % 2 ? c1 : c2);
        px(sx + x, y0 + h - 28, 8, 3, (x / 8) % 2 ? c2 : c1);
      }
      px(sx - 2, y0 + h - 42, 68, 2, '#5e4126');
      px(sx, y0 + h - 25, 4, 25, '#5e4126');
      px(sx + 60, y0 + h - 25, 4, 25, '#5e4126');
      px(sx, y0 + h - 16, 64, 11, '#8a6238');
      px(sx, y0 + h - 16, 64, 2, '#a97b48');
      // goods
      const gem = ['#3de0c8', '#ff4fd8', '#ffd24a', '#8fb8ff', '#c7f284', '#ff6a4f'];
      for (let k = 0; k < 8; k++) {
        const gx = sx + 6 + k * 7;
        px(gx, y0 + h - 21, 4, 5, gem[k % 6]);
        px(gx, y0 + h - 21, 4, 1, '#ffffffaa');
      }
    };
    stall(x0 + 14, '#d8483a', '#f4eadb');
    stall(x0 + 158, '#2f9a8a', '#f4eadb');
    // barrels and crates
    px(x0 + 94, y0 + h - 18, 10, 14, '#7a5330');
    px(x0 + 94, y0 + h - 14, 10, 1, '#3b2a18');
    px(x0 + 94, y0 + h - 8, 10, 1, '#3b2a18');
    px(x0 + 138, y0 + h - 14, 12, 10, '#a97b48');
    px(x0 + 138, y0 + h - 14, 12, 1, '#c79a60');
    // finial on the roof
    px(x0 + w / 2 - 2, y0 - 8, 4, 10, '#e6c26a');
    px(x0 + w / 2 - 4, y0 - 4, 8, 2, '#e6c26a');
  }

  private paintPier(g: Ctx, px: (x: number, y: number, w: number, h: number, c: string) => void) {
    const x0 = 57 * LT;
    const y0 = 26 * LT;
    const w = 13 * LT;
    const h = 3 * LT;
    // the shadow on the water, and the piles it stands on
    px(x0 + 20, y0 + h, w - 20, 7, 'rgba(8,30,60,0.38)');
    for (let x = 18; x < w; x += 32) {
      px(x0 + x, y0 + h - 2, 5, 12, '#4a331c');
      px(x0 + x, y0 + h - 2, 1, 12, '#6b4a2b');
      px(x0 + x - 1, y0 + h + 8, 7, 2, '#cfeaff');
    }
    // planks, laid crosswise
    for (let x = 0; x < w; x += 8) {
      px(x0 + x, y0, 8, h, (x / 8) % 2 ? '#a8743f' : '#b78049');
      px(x0 + x, y0, 1, h, '#6e4a26');
      for (let y = 6; y < h; y += 16) {
        px(x0 + x + 1, y0 + y, 1, 1, '#3b2a18');
        px(x0 + x + 6, y0 + y + 3, 1, 1, '#3b2a18');
      }
    }
    // long beams along both sides
    px(x0, y0, w, 3, '#c99560');
    px(x0, y0 + 3, w, 1, '#6e4a26');
    px(x0, y0 + h - 4, w, 4, '#8a5a30');
    px(x0, y0 + h - 4, w, 1, '#c99560');
    // rail posts and rope on the sea side
    for (let x = 6; x < w; x += 32) {
      px(x0 + x, y0 - 9, 4, 12, '#5e4126');
      px(x0 + x, y0 - 9, 4, 2, '#8b6a42');
      px(x0 + x, y0 + h - 3, 4, 12, '#5e4126');
    }
    for (let x = 6; x < w - 32; x += 32) {
      px(x0 + x + 4, y0 - 6, 28, 1, '#e0c890');
      px(x0 + x + 14, y0 - 5, 8, 1, '#e0c890');
    }
    // the end of the jetty: a wider landing with mooring bollards
    px(x0 + w - 56, y0 - 3, 56, h + 6, '#9a6a38');
    for (let x = 0; x < 56; x += 8) px(x0 + w - 56 + x, y0 - 3, 1, h + 6, '#6e4a26');
    px(x0 + w - 56, y0 - 3, 56, 2, '#c99560');
    px(x0 + w - 56, y0 + h + 1, 56, 2, '#6e4a26');
    for (const bx of [w - 12]) for (const by of [-1, h - 3]) {
      px(x0 + bx, y0 + by, 5, 5, '#2c2a34');
      px(x0 + bx + 1, y0 + by - 1, 3, 1, '#4a4858');
    }
    // the shore end: a short ramp of stones
    px(x0 - 6, y0, 8, h, '#8f887c');
    px(x0 - 6, y0, 8, 2, '#b9b2a6');
  }

  /** The things around each door that make it a place and not a square: islets, a mining camp, bunting. */
  private paintPlaces(g: Ctx, px: (x: number, y: number, w: number, h: number, c: string) => void) {
    const put = (name: string, x: number, y: number, s: number) => {
      const sp = sprite(name);
      const r = rect(name);
      if (!sp || !r) return;
      g.drawImage(sp, x - r[4] * s, y - r[5] * s, r[2] * s, r[3] * s);
    };
    // islets out at sea, with a ripple of foam round each
    for (const [n, x, y] of [['islet-palm', 1046, 292], ['islet-rock', 1102, 620], ['islet-bare', 1020, 706], ['islet-palm', 1098, 150]] as [string, number, number][]) {
      g.fillStyle = 'rgba(207,234,255,0.5)';
      g.beginPath();
      g.ellipse(x, y + 4, 44, 14, 0, 0, Math.PI * 2);
      g.fill();
      put(n, x, y, 2);
    }
    // rails running from the cave mouth out to the camp
    const cx = 15 * LT + 8;
    for (let y = 12 * LT; y < 17 * LT; y += 5) px(cx - 12, y + 1, 24, 2, '#6b4a2b');
    px(cx - 8, 12 * LT, 2, 5 * LT, '#8a8a96');
    px(cx + 6, 12 * LT, 2, 5 * LT, '#8a8a96');
    // a dirt yard in front of the camp
    for (let k = 0; k < 90; k++) {
      const x = 4 * LT + Math.floor(seeded(k * 3.3) * 10 * LT);
      const y = 13 * LT + Math.floor(seeded(k * 7.7) * 7 * LT);
      px(x, y, 3, 2, k % 2 ? '#b38f5e' : '#c9a572');
    }
    // the market sign over the door, and bunting across the square
    const sx = 51 * LT - 8;
    const sy = 2 * LT + 62;
    px(sx, sy, 64, 14, '#4a2e18');
    px(sx + 1, sy + 1, 62, 12, '#7a5330');
    px(sx + 2, sy + 2, 60, 10, '#5e3b1e');
    text(g, 'MARKET', Math.round(sx + 32 - textWidth('MARKET') / 2), sy + 4, 1, '#ffd24a');
    const bx0 = 45 * LT;
    const bx1 = 60 * LT;
    const by = 9 * LT + 2;
    const cols = ['#d8483a', '#ffd24a', '#2f9a8a', '#f4eadb', '#b86bff'];
    for (let x = bx0; x < bx1; x++) px(x, by + Math.round(Math.sin(((x - bx0) / (bx1 - bx0)) * Math.PI) * 5), 1, 1, '#3b2a18');
    for (let x = bx0 + 4, k = 0; x < bx1 - 4; x += 12, k++) {
      const yy = by + Math.round(Math.sin(((x - bx0) / (bx1 - bx0)) * Math.PI) * 5);
      for (let t = 0; t < 5; t++) px(x + t, yy + 1 + t, 5 - t * 2 > 0 ? 6 - t * 2 : 1, 1, cols[k % 5]);
    }
  }

  private paintPlaza(g: Ctx, px: (x: number, y: number, w: number, h: number, c: string) => void) {
    // fountain basin
    const cx = 36 * LT + 8;
    const cy = 28 * LT + 8;
    const R = 25;
    g.fillStyle = '#8f887c';
    g.beginPath();
    g.ellipse(cx, cy + 3, R + 3, R * 0.78 + 3, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#cfc9be';
    g.beginPath();
    g.ellipse(cx, cy, R + 3, R * 0.78 + 3, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#a49d92';
    g.beginPath();
    g.ellipse(cx, cy, R, R * 0.78, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#3d94d8';
    g.beginPath();
    g.ellipse(cx, cy + 1, R - 3, R * 0.78 - 3, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#7cc4f2';
    g.beginPath();
    g.ellipse(cx - 3, cy - 2, R - 10, R * 0.78 - 9, 0, 0, Math.PI * 2);
    g.fill();
    // the column in the middle
    px(cx - 4, cy - 8, 8, 12, '#b9b2a6');
    px(cx - 4, cy - 8, 8, 2, '#d9d3c8');
    px(cx - 6, cy + 2, 12, 3, '#9d968a');
    // a golden ring of stones round the fountain
    for (let a = 0; a < 40; a++) {
      const ang = (a / 40) * Math.PI * 2;
      const rx = cx + Math.cos(ang) * (R + 12);
      const ry = cy + Math.sin(ang) * (R * 0.78 + 10);
      px(Math.round(rx) - 1, Math.round(ry) - 1, 3, 2, a % 2 ? '#d9b24a' : '#f2d27a');
    }
    // the name in the stone
    const label = (t: string, y: number, s: number, c: string) => text(g, t, Math.round(36 * LT + 8 - (textWidth(t) * s) / 2), y, s, c);
    label('GALI', 33 * LT + 4, 4, '#9a9388');
    label('THE ORE MINING GAME', 33 * LT + 4 + 36, 1, '#9a9388');
    // benches and the notice board stand where the map blocks them; sorted props draw them
  }

  private buildMini() {
    const m = lobbyMap();
    const cv = makeCanvas(LCOLS, LROWS);
    const g = ctx2d(cv);
    for (let ty = 0; ty < LROWS; ty++)
      for (let tx = 0; tx < LCOLS; tx++) {
        const t = m.terrain[lidx(tx, ty)];
        g.fillStyle = t === WATER ? '#2f7fc4' : t === SAND ? '#e6d29a' : t === PLAZA ? '#bab3a7' : t === ROAD ? '#c9a572' : t === CLIFF ? '#6f6a78' : t === HALL ? '#c4533a' : t === PLANK ? '#a8743f' : '#5f9d41';
        g.fillRect(tx, ty, 1, 1);
      }
    g.fillStyle = '#2f6a2f';
    for (const t of m.trees) g.fillRect(t.x, t.y, 1, 1);
    this.mini = cv;
  }

  /* ------------------------------------------------------------------ */
  /* people                                                              */
  /* ------------------------------------------------------------------ */
  private syncPeers(views: LobbyPeerView[]) {
    const seen = new Set<string>();
    const m = lobbyMap();
    for (const v of views) {
      seen.add(v.id);
      let p = this.peers.get(v.id);
      if (!p) {
        p = { x: v.x, y: v.y, path: [], pose: 'idle', since: Date.now(), facing: v.f, tx: v.tx, ty: v.ty, lastTx: -1, lastTy: -1, fp: '', view: v };
        this.peers.set(v.id, p);
      }
      p.view = v;
      if (Math.abs(v.tx - p.lastTx) > 2 || Math.abs(v.ty - p.lastTy) > 2) {
        p.lastTx = v.tx;
        p.lastTy = v.ty;
        // they jumped (a late join, a lag spike): start from where they say they are
        if (Math.hypot(p.x - v.x, p.y - v.y) > 40) {
          p.x = v.x;
          p.y = v.y;
        }
        if (v.p === 'walk' || Math.hypot(v.tx - p.x, v.ty - p.y) > 3) p.path = lobbyPath(m, p.x, p.y, v.tx, v.ty);
      }
    }
    for (const id of [...this.peers.keys()]) if (!seen.has(id)) this.peers.delete(id);
  }

  private walkTo(wx: number, wy: number) {
    const m = lobbyMap();
    const path = lobbyPath(m, this.me.x, this.me.y, wx, wy);
    this.me.path = path;
    if (path.length) {
      const e = path[path.length - 1];
      this.me.tx = e[0];
      this.me.ty = e[1];
    }
  }

  /* ------------------------------------------------------------------ */
  /* input                                                               */
  /* ------------------------------------------------------------------ */
  private worldAt(sx: number, sy: number): [number, number] {
    return [this.cam.x + (sx - this.W / 2) / this.z, this.cam.y + (sy - this.centreY()) / this.z];
  }
  private centreY() {
    return this.opts.top + (this.H - this.opts.top - this.opts.bottom) / 2;
  }

  private bindInput() {
    const cv = this.canvas;
    const pos = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    cv.addEventListener('pointerdown', (e) => {
      const p = pos(e);
      const sb = this.stickBase();
      if (!this.stick && Math.hypot(p.x - sb.x, p.y - sb.y) < sb.r * 1.35) {
        this.stick = { id: e.pointerId, dx: 0, dy: 0 };
        this.stickMove(p.x, p.y);
        try {
          cv.setPointerCapture(e.pointerId);
        } catch {
          /* not capturable */
        }
        return;
      }
      this.pointers.set(e.pointerId, { ...p, x0: p.x, y0: p.y, t0: performance.now() });
      try {
        cv.setPointerCapture(e.pointerId);
      } catch {
        /* not capturable */
      }
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = Math.hypot(a.x - b.x, a.y - b.y);
        this.steering = false;
        this.me.path = [];
      }
    });
    cv.addEventListener('pointermove', (e) => {
      if (this.stick && this.stick.id === e.pointerId) {
        const sp = pos(e);
        this.stickMove(sp.x, sp.y);
        return;
      }
      const q = this.pointers.get(e.pointerId);
      if (!q) return;
      const p = pos(e);
      q.x = p.x;
      q.y = p.y;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch > 0) this.zoomK = Math.max(0.6, Math.min(2.2, this.zoomK * (d / this.pinch)));
        this.pinch = d;
        return;
      }
      if (this.inMini(q.x0, q.y0)) return;
      if (!this.steering && Math.hypot(p.x - q.x0, p.y - q.y0) > 9) this.steering = true;
      if (this.steering) this.steer(p.x, p.y);
    });
    const up = (e: PointerEvent) => {
      if (this.stick && this.stick.id === e.pointerId) {
        this.stick = null;
        return;
      }
      const q = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      this.pinch = 0;
      if (!q) return;
      if (this.pointers.size > 0) return;
      if (this.steering) {
        // let go: stop where you are
        this.steering = false;
        this.me.path = [];
        return;
      }
      if (performance.now() - q.t0 > 600 || Math.hypot(q.x - q.x0, q.y - q.y0) > 14) return;
      if (this.inMini(q.x, q.y)) {
        const r = this.minimapRect;
        this.walkTo(((q.x - r.x) / r.w) * LW, ((q.y - r.y) / r.h) * LH);
        this.tapMark = null;
        return;
      }
      const [wx, wy] = this.worldAt(q.x, q.y);
      // a tap on another player opens their tip sheet instead of walking
      let hit: string | null = null;
      let best = Infinity;
      for (const [id, p] of this.peers) {
        const dx = Math.abs(wx - p.x);
        const dy = wy - (p.y - 12);
        if (dx < 12 && Math.abs(dy) < 20 && dx + Math.abs(dy) < best) {
          best = dx + Math.abs(dy);
          hit = id;
        }
      }
      if (hit) {
        this.emit({ t: 'peer', id: hit });
        this.tapMark = null;
        return;
      }
      this.walkTo(wx, wy);
      this.tapMark = { x: wx, y: wy, at: performance.now() };
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.zoomK = Math.max(0.6, Math.min(2.2, this.zoomK * (e.deltaY < 0 ? 1.1 : 0.91)));
      },
      { passive: false },
    );
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.onKey);
      window.addEventListener('keyup', this.onKeyUp);
    }
  }

  /** Where the stick sits: bottom left, just above the chat panel. */
  private stickBase() {
    return { x: 16 + 52, y: this.H - this.opts.bottom - 52 - 12, r: 52 };
  }
  private stickMove(x: number, y: number) {
    if (!this.stick) return;
    const b = this.stickBase();
    let dx = (x - b.x) / b.r;
    let dy = (y - b.y) / b.r;
    const n = Math.hypot(dx, dy);
    if (n > 1) {
      dx /= n;
      dy /= n;
    }
    this.stick.dx = dx;
    this.stick.dy = dy;
    // taking the stick cancels a tap-to-walk in progress
    this.me.path = [];
  }

  /** Walk straight in a direction, sliding along whatever is in the way. */
  private moveDir(dx: number, dy: number, dt: number, now: number): boolean {
    const n = Math.hypot(dx, dy);
    if (n < 0.18) return false;
    const m = lobbyMap();
    const me = this.me;
    const sp = SPEED * Math.min(1, n * 1.15);
    const ux = dx / n;
    const uy = dy / n;
    const ok = (x: number, y: number) => standable(m, x, y) && standable(m, x - 5, y) && standable(m, x + 5, y);
    const nx = me.x + ux * sp * dt;
    const ny = me.y + uy * sp * dt;
    if (ok(nx, ny)) {
      me.x = nx;
      me.y = ny;
    } else if (ok(nx, me.y)) me.x = nx;
    else if (ok(me.x, ny)) me.y = ny;
    else return false;
    if (Math.abs(ux) > 0.25) me.facing = ux > 0 ? 1 : -1;
    me.tx = me.x + ux * 32;
    me.ty = me.y + uy * 32;
    me.path = [];
    if (me.pose !== 'walk') {
      me.pose = 'walk';
      me.since = now;
    }
    if (now - this.lastStep > 200) {
      this.lastStep = now;
      this.parts.spawn('dust', me.x - 2 * me.facing, me.y, { vx: -6 * me.facing, vz: 8, life: 0.4, c: '#e8d4b0' });
    }
    return true;
  }

  private inMini(x: number, y: number) {
    const r = this.minimapRect;
    return x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;
  }

  /** Held finger or mouse: walk toward it, no matter how far, until let go. */
  private steer(sx: number, sy: number) {
    const now = performance.now();
    if (now - this.steerAt < 110) return;
    this.steerAt = now;
    const [wx, wy] = this.worldAt(sx, sy);
    // aim a few steps ahead along the line, so the miner follows the finger smoothly
    const dx = wx - this.me.x;
    const dy = wy - this.me.y;
    const d = Math.hypot(dx, dy);
    if (d < 6) return;
    const k = Math.min(1, 48 / d);
    this.walkTo(this.me.x + dx * k, this.me.y + dy * k);
  }

  private key(e: KeyboardEvent, down: boolean) {
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA)$/.test(t.tagName)) return;
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'].includes(k)) {
      if (down) this.keys.add(k);
      else this.keys.delete(k);
      e.preventDefault();
    }
  }

  /* ------------------------------------------------------------------ */
  /* the loop                                                            */
  /* ------------------------------------------------------------------ */
  /** For screenshots and demos: 0 midnight, 0.5 noon. */
  setTime(f: number) {
    this.sky.setTime(f);
  }
  setRain(k: number) {
    (this.sky as unknown as { rainTarget: number }).rainTarget = k;
    this.sky.rain = k;
  }

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

  private frame(t: number) {
    const dt = Math.min(0.1, (t - this.last) / 1000);
    this.last = t;
    const now = Date.now();
    this.resize();
    this.perf(dt);
    // the same living sky as the island: a turning day, drifting clouds, passing showers and lightning
    this.sky.update(dt, now, this.quality);
    this.parts.budget = this.quality ? 1 : 0.4;
    this.parts.update(dt, 0.2 + this.sky.wind * 0.5);
    this.think(dt, now);
    this.draw(now);
    if (!this.ready && this.ground) {
      this.ready = true;
      this.canvas.dataset.ready = '1';
      this.emit({ t: 'ready' });
    }
  }

  private perf(dt: number) {
    if (performance.now() - this.born < 5000) return;
    this.fpsAcc.n++;
    this.fpsAcc.t += dt;
    if (this.fpsAcc.t < 2.5) return;
    const fps = this.fpsAcc.n / this.fpsAcc.t;
    this.fpsAcc = { n: 0, t: 0 };
    if (fps < 38 && this.quality === 1) this.quality = 0;
  }

  private think(dt: number, now: number) {
    const m = lobbyMap();
    const me = this.me;
    // the stick and the keys walk you straight; a tap walks you along a route
    let kx = 0;
    let ky = 0;
    if (this.keys.has('arrowleft') || this.keys.has('a')) kx -= 1;
    if (this.keys.has('arrowright') || this.keys.has('d')) kx += 1;
    if (this.keys.has('arrowup') || this.keys.has('w')) ky -= 1;
    if (this.keys.has('arrowdown') || this.keys.has('s')) ky += 1;
    const ix = this.stick ? this.stick.dx : kx;
    const iy = this.stick ? this.stick.dy : ky;
    this.direct = false;
    if ((this.stick || kx || ky) && !this.leaving) {
      this.direct = this.moveDir(ix, iy, dt, now);
      if (!this.direct && me.pose === 'walk') {
        me.pose = 'idle';
        me.since = now;
      }
    }
    // me
    const wasWalking = me.path.length > 0;
    if (me.path.length) {
      if (now - this.lastStep > 200) {
        this.lastStep = now;
        this.parts.spawn('dust', me.x - 2 * me.facing, me.y, { vx: -6 * me.facing, vz: 8, life: 0.4, c: '#e8d4b0' });
      }
      stepBody(me, dt, SPEED, now);
    }
    if (wasWalking && !me.path.length && !this.direct) {
      me.pose = 'idle';
      me.since = now;
    }
    if (!me.path.length && !this.direct && me.pose === 'walk') {
      me.pose = 'idle';
      me.since = now;
    }
    // walking through a door
    if (!this.leaving && performance.now() - this.born > 700) {
      const d = doorAt(me.x, me.y);
      if (d) {
        this.leaving = { id: d, at: performance.now(), sent: false };
        me.path = [];
        me.pose = 'idle';
        this.emit({ t: 'sfx', name: 'door' });
      }
    }
    if (this.leaving && !this.leaving.sent && performance.now() - this.leaving.at > 260) {
      this.leaving.sent = true;
      const id = this.leaving.id;
      this.emit({ t: 'door', id });
      // if the app keeps the lobby open behind a door (the cave, the market), step back out to its front
      setTimeout(() => {
        this.leaving = null;
        const [bx, by] = tileCentre(...SPAWNS[id]);
        me.x = bx;
        me.y = by;
        me.path = [];
        this.cam.x = bx;
        this.cam.y = by;
      }, 420);
    }
    // tell the app where we are, ten times a second at most, and only when it changed
    if (performance.now() - this.lastEmit > 100) {
      this.lastEmit = performance.now();
      const moving = me.path.length > 0 || this.direct;
      const tx = moving ? me.tx : me.x;
      const ty = moving ? me.ty : me.y;
      const pose = moving ? 'walk' : this.snap.emoji && now - this.myEmojiAt < 2200 ? 'cheer' : 'idle';
      const key = `${Math.round(tx)},${Math.round(ty)},${pose},${me.facing}`;
      if (key !== this.lastEmitKey || performance.now() - this.lastBeat > 1000) {
        this.lastEmitKey = key;
        this.lastBeat = performance.now();
        this.emit({ t: 'me', x: me.x, y: me.y, tx, ty, facing: me.facing, pose });
      }
    }
    // everyone else walks the same road to where they said they were going
    for (const p of this.peers.values()) {
      if (p.path.length) stepBody(p, dt, SPEED, now);
      const walking = p.path.length > 0;
      const want = walking ? 'walk' : p.view.p === 'cheer' ? 'cheer' : 'idle';
      if (p.pose !== want) {
        p.pose = want;
        p.since = now;
      }
      // a heartbeat that says they have stopped, while ours still walks: let us arrive
      if (!walking && p.view.p === 'idle' && Math.hypot(p.x - p.view.x, p.y - p.view.y) > 24) {
        p.x += (p.view.x - p.x) * Math.min(1, dt * 4);
        p.y += (p.view.y - p.y) * Math.min(1, dt * 4);
      }
    }
    void m;
  }

  /* ------------------------------------------------------------------ */
  private draw(now: number) {
    const c = this.c;
    const { W, H, dpr } = this;
    const m = lobbyMap();
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.imageSmoothingEnabled = false;
    c.fillStyle = '#2f7fc4';
    c.fillRect(0, 0, W, H);
    if (!this.ground) return;

    // zoom: about 200 art pixels across a phone, in whole device pixels so nothing blurs
    const base = Math.max(1.6, Math.min(5, (this.W / 200) * this.zoomK));
    this.z = Math.max(1 / dpr, Math.round(base * dpr) / dpr);
    const z = this.z;
    const cy = this.centreY();
    // follow me, and stay inside the map
    const hw = W / 2 / z;
    const hh = (H - this.opts.top - this.opts.bottom) / 2 / z;
    const clampAxis = (v: number, half: number, size: number) => (half * 2 >= size ? size / 2 : Math.max(half, Math.min(size - half, v)));
    const tx = clampAxis(this.me.x, hw, LW);
    const ty = clampAxis(this.me.y - 6, hh, LH);
    this.cam.x += (tx - this.cam.x) * Math.min(1, 0.12 + 0.0);
    this.cam.y += (ty - this.cam.y) * Math.min(1, 0.12);
    const ox = Math.round((W / 2 - this.cam.x * z) * dpr) / dpr;
    const oy = Math.round((cy - this.cam.y * z) * dpr) / dpr;
    const sx = (wx: number) => ox + wx * z;
    const sy = (wy: number) => oy + wy * z;

    // ground
    const vx0 = Math.max(0, Math.floor(-ox / z));
    const vy0 = Math.max(0, Math.floor(-oy / z));
    const vx1 = Math.min(LW, Math.ceil((W - ox) / z));
    const vy1 = Math.min(LH, Math.ceil((H - oy) / z));
    if (vx1 > vx0 && vy1 > vy0) c.drawImage(this.ground, vx0, vy0, vx1 - vx0, vy1 - vy0, ox + vx0 * z, oy + vy0 * z, (vx1 - vx0) * z, (vy1 - vy0) * z);

    // the water moves
    const sh = Math.max(1, Math.round(z));
    for (const s of this.shimmer) {
      if (s.x < vx0 - 8 || s.x > vx1 || s.y < vy0 - 8 || s.y > vy1) continue;
      const a = 0.5 + 0.5 * Math.sin(now / 520 + s.ph);
      if (a < 0.35) continue;
      c.globalAlpha = a * 0.7;
      c.fillStyle = '#cfeaff';
      c.fillRect(Math.round(sx(s.x)), Math.round(sy(s.y)), 3 * sh, sh);
    }
    c.globalAlpha = 1;
    // lily pad bob and a dock lantern glow are in the sorted pass

    // things that stand: trees, lamps, boards, people. Sorted by their feet.
    const items: Item[] = [];
    const lights: { x: number; y: number; r: number; c: string; k: number }[] = [];
    const inView = (wx: number, wy: number, pad = 40) => wx > vx0 - pad && wx < vx1 + pad && wy > vy0 - pad && wy < vy1 + pad + 30;
    for (const t of m.trees) {
      const wx = t.x * LT + 8;
      const wy = t.y * LT + 14;
      if (!inView(wx, wy, 24)) continue;
      const name = `prop-${t.kind}-${'abc'[t.v]}-0`;
      const sway = Math.sin(now / 900 + t.x * 1.3 + t.y) * 0.4;
      items.push({ y: wy, draw: () => draw(c, name, sx(wx + sway), sy(wy), z * 2) });
    }
    for (const [lx, ly] of m.lamps) {
      const wx = lx * LT + 8;
      const wy = ly * LT + 14;
      if (!inView(wx, wy)) continue;
      items.push({ y: wy, draw: () => this.lampPost(c, sx(wx), sy(wy), z, now) });
    }
    // the fountain's spout
    {
      const wx = 36 * LT + 8;
      const wy = 29 * LT + 6;
      if (inView(wx, wy, 60)) items.push({ y: wy, draw: () => this.spout(c, sx(36 * LT + 8), sy(28 * LT + 8), z, now) });
    }
    // notice board and benches
    for (const [bx, by, kind] of [[31, 34, 'board'], [41, 34, 'bench'], [31, 22, 'bench']] as [number, number, string][]) {
      const wx = bx * LT + 16;
      const wy = by * LT + 14;
      if (inView(wx, wy)) items.push({ y: wy, draw: () => this.furniture(c, kind, sx(wx), sy(wy), z) });
    }
    // flags on the market roof, and the boat at the end of the pier
    for (const fx of [45 * LT + 8, 59 * LT + 2]) {
      const wy = 2 * LT + 4;
      if (inView(fx, wy)) items.push({ y: wy, draw: () => draw(c, `fx-flag-${Math.floor(now / 170) % this.flagFrames}`, sx(fx), sy(wy), z * 1.5) });
    }
    {
      const bx = 67 * LT + 8;
      const by = 30 * LT + 14 + Math.sin(now / 700) * 1.4;
      if (inView(bx, by, 50)) items.push({ y: by, draw: () => draw(c, 'ship-sloop', sx(bx), sy(by), z * 3) });
    }
    for (const st of STRUCTURES) {
      const wx = (st.at[0] + st.at[2] / 2) * LT;
      const wy = (st.at[1] + st.at[3]) * LT - 1;
      if (!inView(wx, wy, 40)) continue;
      items.push({ y: wy, draw: () => this.drawStruct(c, st.kind, sx(wx), sy(wy), z, now, lights) });
    }

    // people
    const meSay = this.snap.say && now - this.mySayAt < 6000 ? this.snap.say : null;
    const meEmoji = this.snap.emoji && now - this.myEmojiAt < 3000 ? this.snap.emoji : null;
    const near: { id: string; d: number }[] = [];
    const people: { id: string; b: Walker; look: Look; name: string; say: string | null; emoji: string | null; emojiAt: number; mine: boolean }[] = [];
    people.push({ id: 'me', b: this.me, look: this.look, name: 'YOU', say: meSay, emoji: meEmoji, emojiAt: this.myEmojiAt, mine: true });
    for (const p of this.peers.values()) {
      if (!inView(p.x, p.y, 30)) continue;
      people.push({ id: p.view.id, b: p, look: p.view.look, name: p.view.name, say: p.view.say, emoji: p.view.emoji, emojiAt: now - 1000, mine: false });
      near.push({ id: p.view.id, d: Math.hypot(p.x - this.me.x, p.y - this.me.y) });
    }
    // names only for the nearest few, so a crowd stays readable
    near.sort((a, b) => a.d - b.d);
    const named = new Set(near.slice(0, 9).map((n) => n.id));
    const labels: (() => void)[] = [];
    for (const pr of people) {
      const { b } = pr;
      items.push({
        y: b.y,
        draw: () => {
          const f = frameAt(b.pose, b.since, now);
          const X = sx(b.x);
          const Y = sy(b.y);
          if (pr.mine) {
            // a ring so you can find yourself in a crowd
            c.strokeStyle = 'rgba(255,214,90,0.8)';
            c.lineWidth = Math.max(1, z * 0.7);
            c.beginPath();
            c.ellipse(X, Y - 1, 9 * z, 3.6 * z, 0, 0, Math.PI * 2);
            c.stroke();
          }
          if (pr.look.pet) drawPet(c, pr.look.pet, now, X - 15 * z * b.facing, Y + 1 * z, z, b.facing);
          drawMiner(c, pr.look, b.pose as never, f, X, Y, z, b.facing);
          const lamp = lampOf(pr.look, b.pose as never, f, b.facing);
          if (lamp) lights.push({ x: (X + lamp[0] * z) * dpr, y: (Y + lamp[1] * z) * dpr, r: 34 * z * dpr, c: '#ffe3a0', k: 1 });
          const show = pr.mine || pr.say || named.has(pr.id);
          if (show) labels.push(() => this.tag(c, pr.name, pr.say, pr.emoji, now - pr.emojiAt, X, Y - 30 * z, z, pr.mine));
        },
      });
    }
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();

    // footstep dust, coins and so on
    this.parts.draw(c, ox, oy, z);

    // cloud shadows slide over the ground (the sky's clouds are sized for the island, so spread them over this bigger map)
    if (this.quality) {
      c.globalAlpha = 0.1 + 0.08 * (1 - this.sky.night);
      for (const cl of this.sky.clouds) c.drawImage(cl.shadow, Math.round(ox + (cl.x * CLOUD_KX + 26) * z), Math.round(oy + (cl.y * CLOUD_KY + 34) * z), cl.w * CLOUD_S * z, cl.shadow.height * CLOUD_S * z);
      c.globalAlpha = 1;
    }

    // a ring where you tapped
    if (this.tapMark) {
      const k = (performance.now() - this.tapMark.at) / 650;
      if (k < 1) {
        c.strokeStyle = `rgba(255,255,255,${0.8 * (1 - k)})`;
        c.lineWidth = Math.max(1, z * 0.6);
        c.beginPath();
        c.ellipse(sx(this.tapMark.x), sy(this.tapMark.y), (3 + k * 7) * z, (1.4 + k * 3) * z, 0, 0, Math.PI * 2);
        c.stroke();
      } else this.tapMark = null;
    }

    // night: lamps, windows, the cave mouth, the fountain
    for (const [lx, ly] of m.lamps) {
      const X = sx(lx * LT + 8);
      const Y = sy(ly * LT - 8);
      if (X > -80 && X < W + 80 && Y > -80 && Y < H + 80) lights.push({ x: X * dpr, y: Y * dpr, r: 52 * z * dpr, c: '#ffcf80', k: 0.9 + 0.1 * Math.sin(now / 300 + lx) });
    }
    lights.push({ x: sx(15 * LT + 8) * dpr, y: sy(10 * LT) * dpr, r: 70 * z * dpr, c: '#ff9a3d', k: 1 });
    lights.push({ x: sx(52 * LT + 8) * dpr, y: sy(8 * LT) * dpr, r: 80 * z * dpr, c: '#ffcf80', k: 1 });
    lights.push({ x: sx(36 * LT + 8) * dpr, y: sy(28 * LT + 8) * dpr, r: 60 * z * dpr, c: '#8fd8ff', k: 1 });
    c.setTransform(1, 0, 0, 1, 0, 0);
    this.sky.applyLight(c, this.canvas.width, this.canvas.height, lights);
    // clouds, rain and lightning sit above the light, in screen pixels
    c.globalAlpha = (0.55 + this.sky.rain * 0.2) * (1 - this.sky.night * 0.35);
    for (const cl of this.sky.clouds) c.drawImage(cl.cv, Math.round((ox + cl.x * CLOUD_KX * z) * dpr), Math.round((oy + cl.y * CLOUD_KY * z) * dpr), cl.w * CLOUD_S * z * dpr, cl.cv.height * CLOUD_S * z * dpr);
    c.globalAlpha = 1;
    this.sky.drawRain(c, this.canvas.width, this.canvas.height, Math.max(1, Math.round(dpr)));
    if (this.sky.lightning > 0.3) {
      c.fillStyle = `rgba(255,255,255,${(this.sky.lightning - 0.3) * 0.5})`;
      c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.imageSmoothingEnabled = false;

    // names and bubbles sit above the light
    for (const l of labels) l();
    this.doorSigns(c, sx, sy, z, now);
    this.minimap(c, W, now);
    this.drawStick(c);

    // the fade as you step through a door
    if (this.leaving) {
      const k = Math.min(1, (performance.now() - this.leaving.at) / 260);
      c.fillStyle = `rgba(7,13,32,${k})`;
      c.fillRect(0, 0, W, H);
    } else {
      const k = 1 - Math.min(1, (performance.now() - this.born) / 380);
      if (k > 0) {
        c.fillStyle = `rgba(7,13,32,${k})`;
        c.fillRect(0, 0, W, H);
      }
    }
  }

  /** Each structure is painted once into its own small canvas, then drawn scaled. */
  private structCache = new Map<string, HTMLCanvasElement>();
  private structSprite(kind: string): HTMLCanvasElement {
    const hit = this.structCache.get(kind);
    if (hit) return hit;
    const dims: Record<string, [number, number]> = { tent: [50, 40], fire: [20, 8], cart: [44, 26], crates: [20, 22], barrel: [14, 18], 'stall-red': [52, 46], 'stall-teal': [52, 46], rack: [36, 24], boulder: [30, 22], 'sol-crystal': [30, 54], 'ore-vein': [34, 26], lighthouse: [1, 1] };
    const [w, h] = dims[kind] ?? [16, 16];
    const cv = makeCanvas(w, h);
    const g = ctx2d(cv);
    const P = (x: number, y: number, ww: number, hh: number, col: string) => {
      g.fillStyle = col;
      g.fillRect(x, y, ww, hh);
    };
    if (kind === 'tent') {
      for (let y = 0; y < 34; y++) {
        const hw = Math.round(1 + (y / 33) * 23);
        for (let x = -hw; x < hw; x++) {
          const band = Math.floor((x + 24) / 7) % 2;
          const shade = x > 6 ? 0.82 : 1;
          const base = band ? [244, 234, 219] : [216, 72, 58];
          P(25 + x, 2 + y, 1, 1, `rgb(${Math.round(base[0] * shade)},${Math.round(base[1] * shade)},${Math.round(base[2] * shade)})`);
        }
      }
      P(25, 0, 1, 4, '#5e4126');
      P(25, 0, 6, 3, '#ffd24a');
      for (let y = 0; y < 16; y++) P(25 - Math.round(1 + (y / 15) * 6), 22 + y, Math.round(2 + (y / 15) * 12), 1, '#2a1a10');
      P(2, 36, 46, 2, '#3b6a2a');
    } else if (kind === 'fire') {
      P(3, 3, 14, 3, '#4a331c');
      P(3, 3, 14, 1, '#6b4a2b');
      P(5, 1, 3, 3, '#5e4126');
      P(12, 1, 3, 3, '#5e4126');
      P(1, 5, 18, 3, '#8f887c');
    } else if (kind === 'cart') {
      P(0, 22, 44, 2, '#8a8a96');
      P(6, 6, 32, 14, '#6b4a2b');
      P(6, 6, 32, 2, '#8b6a42');
      P(6, 18, 32, 2, '#4a331c');
      for (let k = 0; k < 9; k++) P(9 + k * 3, 3 + (k % 3), 3, 4, k % 2 ? '#ffd24a' : '#f2a020');
      P(12, 1, 3, 3, '#ffe27a');
      for (const wx of [10, 30]) {
        P(wx, 18, 6, 6, '#26202e');
        P(wx + 2, 20, 2, 2, '#8a8a96');
      }
    } else if (kind === 'crates') {
      P(1, 10, 18, 12, '#a97b48');
      P(1, 10, 18, 2, '#c79a60');
      P(1, 20, 18, 2, '#6e4a26');
      P(9, 10, 2, 12, '#6e4a26');
      P(4, 0, 13, 11, '#b78049');
      P(4, 0, 13, 2, '#d8a468');
      P(10, 0, 1, 11, '#6e4a26');
    } else if (kind === 'barrel') {
      P(1, 2, 12, 15, '#7a5330');
      P(2, 0, 10, 3, '#8f6a3e');
      P(1, 5, 12, 1, '#3b2a18');
      P(1, 12, 12, 1, '#3b2a18');
      P(3, 3, 2, 13, '#9a7040');
      P(0, 16, 14, 2, 'rgba(0,0,0,0.25)');
    } else if (kind === 'stall-red' || kind === 'stall-teal') {
      const c1 = kind === 'stall-red' ? '#d8483a' : '#2f9a8a';
      for (let x = 0; x < 52; x += 6) {
        P(x, 8, 6, 12, (x / 6) % 2 ? '#f4eadb' : c1);
        P(x, 20, 6, 3, (x / 6) % 2 ? c1 : '#f4eadb');
      }
      P(-0, 6, 52, 2, '#5e4126');
      P(2, 22, 3, 22, '#5e4126');
      P(47, 22, 3, 22, '#5e4126');
      P(4, 30, 44, 14, '#8a6238');
      P(4, 30, 44, 2, '#a97b48');
      const gem = ['#3de0c8', '#ff4fd8', '#ffd24a', '#8fb8ff', '#c7f284', '#ff6a4f'];
      for (let k = 0; k < 8; k++) {
        P(8 + k * 5, 25, 3, 5, gem[(k + (kind === 'stall-red' ? 0 : 2)) % 6]);
        P(8 + k * 5, 25, 3, 1, 'rgba(255,255,255,0.7)');
      }
      P(0, 44, 52, 2, 'rgba(0,0,0,0.22)');
    } else if (kind === 'rack') {
      P(1, 6, 3, 18, '#5e4126');
      P(32, 6, 3, 18, '#5e4126');
      P(0, 4, 36, 3, '#7a5330');
      for (const x of [7, 16, 25]) {
        P(x + 1, 8, 2, 12, '#8b6a42');
        P(x - 3, 8, 10, 2, '#b8c4d6');
        P(x - 3, 10, 2, 2, '#b8c4d6');
        P(x + 5, 10, 2, 2, '#b8c4d6');
      }
    } else if (kind === 'boulder') {
      const sp = sprite('prop-boulder-b-0');
      const r = rect('prop-boulder-b-0');
      if (sp && r) g.drawImage(sp, 0, 0, r[2], r[3], 0, 0, 30, 22);
    } else if (kind === 'sol-crystal') {
      // our own crystal pillar: a stone plinth under a tall faceted shard, violet at the root, green at the tip
      P(3, 46, 24, 8, '#4a4458');
      P(3, 46, 24, 2, '#6a6480');
      P(6, 42, 18, 4, '#3b3544');
      const rows = 40;
      for (let y = 0; y < rows; y++) {
        const t = y / (rows - 1);
        const hw = y < 8 ? 2 + y : 10 - Math.round(Math.max(0, y - 24) * 0.3);
        const r = Math.round(150 - 110 * (1 - t)), gg = Math.round(60 + 170 * (1 - t)), b = Math.round(240 - 40 * (1 - t));
        for (let x = -hw; x < hw; x++) {
          const sh = x > 2 ? 0.72 : x < -5 ? 1.12 : 1;
          P(15 + x, 2 + y, 1, 1, `rgb(${Math.min(255, Math.round(r * sh))},${Math.min(255, Math.round(gg * sh))},${Math.min(255, Math.round(b * sh))})`);
        }
      }
      P(14, 4, 2, 24, 'rgba(255,255,255,0.35)');
      P(15, 0, 1, 3, '#d8fff4');
    } else if (kind === 'ore-vein') {
      // a dark rock with warm ore running through it
      for (let y = 0; y < 22; y++) {
        const hw = Math.round(5 + Math.sin((y / 21) * Math.PI) * 11);
        for (let x = -hw; x < hw; x++) P(17 + x, 2 + y, 1, 1, x > 3 ? '#3b3544' : y < 6 ? '#6a6480' : '#4a4458');
      }
      for (const [x, y, c] of [[9, 8, '#ffd24a'], [14, 14, '#f2a020'], [21, 9, '#ffe27a'], [24, 16, '#ffd24a'], [17, 5, '#fff3b0']] as [number, number, string][]) {
        P(x, y, 4, 4, c);
        P(x, y, 4, 1, 'rgba(255,255,255,0.7)');
      }
      P(2, 24, 30, 2, 'rgba(0,0,0,0.25)');
    }
    this.structCache.set(kind, cv);
    return cv;
  }

  private drawStruct(c: Ctx, kind: string, X: number, Y: number, z: number, now: number, lights: { x: number; y: number; r: number; c: string; k: number }[]) {
    if (kind === 'lighthouse') {
      draw(c, 'prop-lighthouse-0', X, Y, z * 2);
      const night = this.sky.night;
      if (night > 0.2) {
        c.fillStyle = '#ffe9a0';
        c.fillRect(X - 3 * z, Y - 56 * z, 6 * z, 5 * z);
        lights.push({ x: X * this.dpr, y: (Y - 52 * z) * this.dpr, r: 60 * z * this.dpr, c: '#ffe9a0', k: 1 });
      }
      return;
    }
    const sp = this.structSprite(kind);
    const w = sp.width;
    const h = sp.height;
    const scale = kind === 'boulder' ? 1 : 1;
    c.drawImage(sp, 0, 0, w, h, Math.round((X - (w / 2) * z) * this.dpr) / this.dpr, Math.round((Y - h * z) * this.dpr) / this.dpr, w * z * scale, h * z * scale);
    if (kind === 'fire') {
      const f = Math.floor(now / 110) % 3;
      const fl = ['#ff9a3d', '#ffd24a', '#ff6a2a'];
      for (let k = 0; k < 3; k++) {
        const hgt = 7 + ((f + k) % 3) * 3;
        c.fillStyle = fl[(k + f) % 3];
        c.fillRect(X + (-4 + k * 3) * z, Y - (3 + hgt) * z, 3 * z, hgt * z);
      }
      if (Math.random() < 0.2) this.parts.spawn('ember', X / z * 0 + this.cam.x + (X - this.W / 2) / z, this.cam.y + (Y - this.centreY()) / z - 6, { vz: 14, life: 0.8, c: '#ffb347' });
      lights.push({ x: X * this.dpr, y: (Y - 6 * z) * this.dpr, r: 70 * z * this.dpr, c: '#ff9a3d', k: 0.85 + 0.15 * Math.sin(now / 90) });
    } else if (kind === 'stall-red' || kind === 'stall-teal') {
      lights.push({ x: X * this.dpr, y: (Y - 30 * z) * this.dpr, r: 40 * z * this.dpr, c: '#ffcf80', k: 1 });
    } else if (kind === 'sol-crystal') {
      const k = 0.8 + 0.2 * Math.sin(now / 420 + X);
      lights.push({ x: X * this.dpr, y: (Y - 30 * z) * this.dpr, r: 58 * z * this.dpr, c: '#9a6bff', k });
      c.fillStyle = '#7ff5c8';
      for (let i = 0; i < 3; i++) {
        const t = (now / 1800 + i / 3) % 1;
        c.globalAlpha = 1 - t;
        c.fillRect(Math.round(X + Math.sin(i * 2.4 + now / 900) * 9 * z), Math.round(Y - (20 + t * 40) * z), 2 * z, 2 * z);
      }
      c.globalAlpha = 1;
    } else if (kind === 'ore-vein') {
      lights.push({ x: X * this.dpr, y: (Y - 12 * z) * this.dpr, r: 34 * z * this.dpr, c: '#ffcf60', k: 0.7 + 0.3 * Math.sin(now / 300 + Y) });
    } else if (kind === 'tent') {
      lights.push({ x: X * this.dpr, y: (Y - 8 * z) * this.dpr, r: 26 * z * this.dpr, c: '#ffb870', k: 0.9 });
    }
  }

  private lampPost(c: Ctx, X: number, Y: number, z: number, now: number) {
    const u = Math.max(1, Math.round(z));
    c.fillStyle = '#3b3544';
    c.fillRect(X - u, Y - 20 * u, 2 * u, 20 * u);
    c.fillRect(X - 3 * u, Y - 2 * u, 6 * u, 2 * u);
    c.fillStyle = '#26202e';
    c.fillRect(X - 3 * u, Y - 25 * u, 6 * u, 1 * u);
    c.fillStyle = this.sky.night > 0.2 ? '#ffe6a0' : '#d8c890';
    c.fillRect(X - 2 * u, Y - 24 * u, 4 * u, 4 * u);
    c.fillStyle = '#26202e';
    c.fillRect(X - 3 * u, Y - 20 * u, 6 * u, 1 * u);
    c.fillRect(X - 1 * u, Y - 27 * u, 2 * u, 2 * u);
    void now;
  }

  private spout(c: Ctx, X: number, Y: number, z: number, now: number) {
    const u = Math.max(1, Math.round(z));
    c.fillStyle = '#e6f6ff';
    for (let k = 0; k < 14; k++) {
      const t = ((now / 900 + k / 14) % 1);
      const a = (k / 14) * Math.PI * 2;
      const r = Math.sin(t * Math.PI) * 0 + t * 15;
      const h = Math.sin(t * Math.PI) * 17;
      c.globalAlpha = 0.9 - t * 0.4;
      c.fillRect(Math.round(X + Math.cos(a) * r * z), Math.round(Y - 8 * z - h * z + t * 4 * z), u * 1.5, u * 1.5);
    }
    c.globalAlpha = 1;
    // the top jet
    for (let k = 0; k < 5; k++) {
      const t = ((now / 700 + k / 5) % 1);
      c.fillStyle = '#ffffff';
      c.fillRect(Math.round(X - u / 2), Math.round(Y - 10 * z - (t < 0.5 ? t : 1 - t) * 30 * z), u, u * 2);
    }
    // ripples on the basin
    c.strokeStyle = 'rgba(255,255,255,0.45)';
    c.lineWidth = Math.max(1, z * 0.5);
    for (let k = 0; k < 2; k++) {
      const t = ((now / 1500 + k / 2) % 1);
      c.beginPath();
      c.ellipse(X, Y + 1 * z, (6 + t * 14) * z, (4.6 + t * 10) * z * 0.78, 0, 0, Math.PI * 2);
      c.globalAlpha = 1 - t;
      c.stroke();
    }
    c.globalAlpha = 1;
  }

  private furniture(c: Ctx, kind: string, X: number, Y: number, z: number) {
    const u = Math.max(1, Math.round(z));
    if (kind === 'board') {
      c.fillStyle = '#5e4126';
      c.fillRect(X - 14 * u, Y - 22 * u, 2 * u, 22 * u);
      c.fillRect(X + 12 * u, Y - 22 * u, 2 * u, 22 * u);
      c.fillStyle = '#8a6238';
      c.fillRect(X - 16 * u, Y - 28 * u, 32 * u, 18 * u);
      c.fillStyle = '#c79a60';
      c.fillRect(X - 14 * u, Y - 26 * u, 28 * u, 14 * u);
      for (const [px, py, col] of [[-12, -25, '#fff6d8'], [-3, -25, '#ffe9a6'], [6, -24, '#d8f0ff'], [-9, -18, '#ffd8e6'], [2, -18, '#fff6d8']] as [number, number, string][]) {
        c.fillStyle = col;
        c.fillRect(X + px * u, Y + py * u, 7 * u, 5 * u);
        c.fillStyle = '#d8483a';
        c.fillRect(X + (px + 3) * u, Y + (py - 1) * u, u, u);
      }
    } else {
      c.fillStyle = '#5e4126';
      c.fillRect(X - 14 * u, Y - 4 * u, 2 * u, 5 * u);
      c.fillRect(X + 12 * u, Y - 4 * u, 2 * u, 5 * u);
      c.fillStyle = '#a97b48';
      c.fillRect(X - 15 * u, Y - 8 * u, 30 * u, 4 * u);
      c.fillStyle = '#c79a60';
      c.fillRect(X - 15 * u, Y - 8 * u, 30 * u, u);
      c.fillStyle = '#8a6238';
      c.fillRect(X - 15 * u, Y - 14 * u, 30 * u, 3 * u);
    }
  }

  /** A name, and what someone just said, above their head. */
  private tag(c: Ctx, name: string, say: string | null, emoji: string | null, emojiAge: number, X: number, Y: number, z: number, mine: boolean) {
    const fs = Math.max(1, Math.round(1.6 * this.dpr) / this.dpr);
    const w = textWidth(name) * fs;
    const padX = 3 * fs;
    let y = Y - 9 * fs;
    c.fillStyle = mine ? 'rgba(60,40,0,0.78)' : 'rgba(7,13,32,0.72)';
    c.fillRect(Math.round(X - w / 2 - padX), Math.round(y - 2 * fs), Math.round(w + padX * 2), Math.round(9 * fs));
    text(c, name, Math.round(X - w / 2), Math.round(y), fs, mine ? '#ffd24a' : '#ffffff');
    if (say) {
      const lines = wrap(say.toUpperCase(), 20);
      const lw = Math.max(...lines.map((l) => textWidth(l))) * fs;
      const lh = 8 * fs;
      const bw = lw + 8 * fs;
      const bh = lines.length * lh + 6 * fs;
      const bx = Math.round(X - bw / 2);
      const by = Math.round(y - 6 * fs - bh);
      c.fillStyle = '#ffffff';
      c.fillRect(bx, by, Math.round(bw), Math.round(bh));
      c.fillStyle = '#1a1a2e';
      c.fillRect(bx, by, Math.round(bw), Math.round(fs));
      c.fillRect(bx, by + Math.round(bh) - Math.round(fs), Math.round(bw), Math.round(fs));
      c.fillRect(bx, by, Math.round(fs), Math.round(bh));
      c.fillRect(bx + Math.round(bw) - Math.round(fs), by, Math.round(fs), Math.round(bh));
      // the little tail
      c.fillStyle = '#ffffff';
      c.fillRect(Math.round(X - 2 * fs), by + Math.round(bh), Math.round(4 * fs), Math.round(3 * fs));
      c.fillStyle = '#1a1a2e';
      c.fillRect(Math.round(X - 2 * fs), by + Math.round(bh), Math.round(fs), Math.round(3 * fs));
      c.fillRect(Math.round(X + fs), by + Math.round(bh), Math.round(fs), Math.round(3 * fs));
      lines.forEach((l, i) => text(c, l, Math.round(X - (textWidth(l) * fs) / 2), by + Math.round(3 * fs + i * lh), fs, '#1a1a2e'));
      y = by - 6 * fs;
    }
    if (emoji) {
      c.font = `${Math.round(13 * z * 0.8 + 6)}px serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.globalAlpha = Math.max(0, 1 - emojiAge / 3000);
      c.fillText(emoji, X, y - 4 * fs - Math.min(10, emojiAge / 160) * fs);
      c.globalAlpha = 1;
    }
  }

  /** The signs over the three doors, and an arrow at the screen edge for any that are out of view. */
  private doorSigns(c: Ctx, sx: (x: number) => number, sy: (y: number) => number, z: number, now: number) {
    const fs = Math.max(1, Math.round(1.7 * this.dpr) / this.dpr);
    const { W, H } = this;
    const top = this.opts.top + 6;
    const bottom = H - this.opts.bottom - 6;
    for (const d of DOORS) {
      const wx = (d.x + d.w / 2) * LT;
      const wy = d.id === 'cave' ? d.y * LT - 20 : d.id === 'market' ? d.y * LT - 66 : d.y * LT - 34;
      const X = sx(wx);
      const Y = sy(wy) + Math.sin(now / 420 + d.x) * 2;
      const near = Math.hypot(this.me.x - wx, this.me.y - d.y * LT) < 110;
      const col = DOOR_COLOR[d.id];
      if (X > 24 && X < W - 24 && Y > top && Y < bottom) {
        const tw = Math.max(textWidth(d.label), textWidth(d.sub) * 0.6) * fs;
        const bw = tw + 12 * fs;
        const bh = 20 * fs;
        const bx = Math.round(X - bw / 2);
        const by = Math.round(Y - bh);
        c.fillStyle = 'rgba(7,13,32,0.86)';
        c.fillRect(bx, by, Math.round(bw), Math.round(bh));
        c.fillStyle = col;
        c.fillRect(bx, by, Math.round(bw), Math.round(2 * fs));
        c.fillRect(bx, by + Math.round(bh - fs), Math.round(bw), Math.round(fs));
        textCentered(c, d.label, X, by + 5 * fs, fs, near ? '#ffffff' : col);
        textCentered(c, d.sub.toUpperCase(), X, by + 13 * fs, fs * 0.6 < 1 ? 1 : fs * 0.6, '#c9d4ff');
        // an arrow pointing down at the door
        c.fillStyle = col;
        const ay = by + Math.round(bh) + 2;
        c.fillRect(Math.round(X - 3 * fs), ay, Math.round(6 * fs), Math.round(fs));
        c.fillRect(Math.round(X - 2 * fs), ay + Math.round(fs), Math.round(4 * fs), Math.round(fs));
        c.fillRect(Math.round(X - fs), ay + Math.round(2 * fs), Math.round(2 * fs), Math.round(fs));
      } else {
        // off screen: a coloured dot on the edge, pointing the way
        const ex = Math.max(18, Math.min(W - 18, X));
        const ey = Math.max(top + 12, Math.min(bottom - 12, Y));
        c.fillStyle = 'rgba(7,13,32,0.86)';
        c.beginPath();
        c.arc(ex, ey, 11, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = col;
        c.lineWidth = 2;
        c.stroke();
        textCentered(c, d.id === 'island' ? 'I' : d.id === 'cave' ? 'C' : 'M', ex, ey - 3 * fs, fs, col);
      }
    }
  }

  private drawStick(c: Ctx) {
    if (this.leaving) return;
    const b = this.stickBase();
    const on = Boolean(this.stick);
    c.globalAlpha = on ? 0.95 : 0.7;
    c.fillStyle = 'rgba(7,13,32,0.55)';
    c.beginPath();
    c.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#ffd24a';
    c.lineWidth = 2;
    c.stroke();
    c.fillStyle = 'rgba(255,210,74,0.55)';
    for (const [ax, ay] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      c.beginPath();
      c.moveTo(b.x + ax * (b.r - 7) - ay * 6, b.y + ay * (b.r - 7) + ax * 6);
      c.lineTo(b.x + ax * (b.r - 7) + ay * 6, b.y + ay * (b.r - 7) - ax * 6);
      c.lineTo(b.x + ax * (b.r - 16), b.y + ay * (b.r - 16));
      c.fill();
    }
    const kx = b.x + (this.stick ? this.stick.dx : 0) * b.r * 0.62;
    const ky = b.y + (this.stick ? this.stick.dy : 0) * b.r * 0.62;
    c.fillStyle = on ? '#ffd24a' : '#e6b83a';
    c.beginPath();
    c.arc(kx, ky, 21, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#fff1a8';
    c.beginPath();
    c.arc(kx - 5, ky - 6, 7, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#8a4b0a';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(kx, ky, 21, 0, Math.PI * 2);
    c.stroke();
    c.globalAlpha = 1;
  }

  private minimap(c: Ctx, W: number, now: number) {
    if (!this.mini) return;
    const k = 1.7;
    const w = Math.round(LCOLS * k);
    const h = Math.round(LROWS * k);
    const x = W - w - 10;
    const y = this.opts.top + 6;
    this.minimapRect = { x, y, w, h };
    c.globalAlpha = 0.92;
    c.fillStyle = '#070d20';
    c.fillRect(x - 2, y - 2, w + 4, h + 4);
    c.drawImage(this.mini, x, y, w, h);
    c.globalAlpha = 1;
    c.strokeStyle = '#ffd24a';
    c.lineWidth = 1;
    c.strokeRect(x - 1.5, y - 1.5, w + 3, h + 3);
    const to = (wx: number, wy: number): [number, number] => [x + (wx / LW) * w, y + (wy / LH) * h];
    for (const d of DOORS) {
      const [dx, dy] = to((d.x + d.w / 2) * LT, d.y * LT);
      c.fillStyle = DOOR_COLOR[d.id];
      c.fillRect(Math.round(dx) - 2, Math.round(dy) - 2, 5, 5);
    }
    c.fillStyle = '#ffffff';
    for (const p of this.peers.values()) {
      const [px, py] = to(p.x, p.y);
      c.fillRect(Math.round(px) - 1, Math.round(py) - 1, 2, 2);
    }
    const [mx, my] = to(this.me.x, this.me.y);
    const blink = Math.floor(now / 350) % 2 === 0;
    c.fillStyle = '#070d20';
    c.fillRect(Math.round(mx) - 3, Math.round(my) - 3, 6, 6);
    c.fillStyle = blink ? '#ffd24a' : '#ffffff';
    c.fillRect(Math.round(mx) - 2, Math.round(my) - 2, 4, 4);
  }
}

/** Break a line of chat into lines of at most `n` characters, on spaces where possible. */
function wrap(s: string, n: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of s.split(' ')) {
    if (word.length > n) {
      if (line) out.push(line);
      for (let i = 0; i < word.length; i += n) out.push(word.slice(i, i + n));
      line = '';
      continue;
    }
    if ((line + ' ' + word).trim().length > n) {
      out.push(line);
      line = word;
    } else line = (line + ' ' + word).trim();
  }
  if (line) out.push(line);
  return out.slice(0, 4);
}

// keep these imported helpers referenced for tree-shaking-safe builds
void GRASS;
void standable;
void tileOf;
