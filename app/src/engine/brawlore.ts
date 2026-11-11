/**
 * Gali Fightclub, drawn and played: the platform fighter's canvas (rules: game/brawl2/sim.ts, bots: game/brawl2/bots.ts).
 * The place is an underground fight pit dug into an ORE mine.
 *
 * The match runs right here at a fixed 60 steps a second, so a button press moves your miner on the very next
 * frame. Phone controls are drawn and heard inside the canvas too (a floating stick on the left half, four buttons
 * on the right), with no trip through the app, which is what made the old arena's buttons feel late.
 *
 * Keys (computer): A / D or arrows move, W / Up / Space jump, S / Down drop through or aim down,
 * J or left click light attack, K or right click heavy attack, L or Shift dodge, I or E or middle click special.
 */
import { canvasDpr, reducedMotion } from './screen';
import { ctx2d, loadAtlas, makeCanvas, text, textWidth, type Ctx } from './art';
import { drawMiner, frameAt } from './actors';
import type { Look } from './types';
import { Bots } from '../game/brawl2/bots';
import { FPS, METER_FULL, STAGES, moveHitbox, moveOf, newMatch, NO_INPUT, poseOf, step, STOCKS, type Difficulty, type Fighter, type Input, type Match, type MatchEvent, type Mode, type SpecialId, type Weapon } from '../game/brawl2/sim';
import { SPECIAL_INFO } from '../game/brawl2/specials';
import { WH, WW, WX0, WY0, type Scene } from './fightclubArt';
import { animateStreetScene, paintStreetScene } from './fightclubStreetStages';
import { paintStreetCard } from './fightclubStreetCard';
import { adoptSelf, applySelf, packSelf, packSnap, setFighter, type NetPlayer, type Snap } from '../game/brawl2/net';

export interface BrawlSetup {
  mode: Mode;
  diff: Difficulty;
  name: string;
  look: Look;
  weapon: Weapon;
  /** your special move (game/brawl2/specials.ts specialOf your weapon) */
  special: SpecialId;
  seed?: number;
  /** online (game/brawl2/online.ts): this miner's id, the match, and who hosts it */
  net?: { role: 'host' | 'guest'; me: string; mid: string; host: string; players: NetPlayer[] };
}
export interface BrawlResult {
  online?: boolean;
  /** said under the result, e.g. when the host left */
  note?: string;
  mode: Mode;
  diff: Difficulty;
  place: number;
  of: number;
  kos: number;
  falls: number;
  /** everyone, in finishing order */
  table: { id: string; name: string; place: number; kos: number; falls: number; you: boolean; bot: boolean }[];
  /** online: the match id */
  mid?: string;
}
export type BrawlEvent =
  | { t: 'ready' }
  | { t: 'end'; result: BrawlResult }
  | { t: 'sfx'; name: 'swing' | 'hit' | 'pop' | 'slam' | 'cheer' | 'ko' | 'pick' | 'throw' | 'special' | 'ready' }
  | { t: 'menu' }
  /** a callout card, as a PNG data URL */
  | { t: 'card'; url: string }
  /** online: a message for the app to send ('bos' from the host, 'boi' from a guest) */
  | { t: 'net'; e: 'bos' | 'boi'; p: Record<string, unknown> };

/** your fighter's id offline */
const ME = 'me';
/** a guest whose host goes quiet this long ends the match; a guest the host stops hearing becomes a bot */
const HOST_LOST_MS = 3500;
const GUEST_LOST_MS = 5000;
const NET_MS = 100;
/**
 * Other online fighters are drawn this far in the past, between the two real positions around that moment, so they
 * move smoothly even when messages arrive unevenly (the relay batches them, phones and Wi-Fi bunch them up).
 */
const INTERP_MS = 130;
/** A trail with nothing newer than this is stale: draw the fighter where this copy has it. */
const TRAIL_STALE_MS = 400;
/** A correction up to this far (px) glides instead of jumping. 60 was too little: a dash or a knockback seen 150 ms late is more. */
const EASE_MAX = 150;
/** How fast a correction glides away (s). */
const EASE_S = 0.07;
/** each fighter's colour: you are gold */
const COLORS = ['#ffc93c', '#ff5a6a', '#4fd6ef', '#8ef06a'];
const BOT_NAMES = ['Rusty', 'Clank', 'Pebble', 'Grit'];
const BOT_SPECIALS: SpecialId[] = ['rush', 'quake', 'moon', 'whirl'];
const BOT_LOOKS: Look[] = [
  { hat: 'hat-red', fit: '#7a2f5c', pick: '#b8c4d6', handle: '#6b4a32', pet: null, glow: 'none', sex: 'm' },
  { hat: 'hat-teal', fit: '#8a7a4a', pick: '#3de0c8', handle: '#2b2140', pet: null, glow: 'none', sex: 'f' },
  { hat: 'hat-songkok', fit: '#ff7a00', pick: '#ffc83d', handle: '#5a3a24', pet: null, glow: 'none', sex: 'm' },
];

interface Fx {
  k: 'spark' | 'ring' | 'beam' | 'dust' | 'word';
  x: number;
  y: number;
  t0: number;
  dur: number;
  c: string;
  vx?: number;
  vy?: number;
  s?: number;
  word?: string;
  ang?: number;
  /** a smaller word (special names) */
  small?: boolean;
}

export class BrawlEngine {
  private c: Ctx;
  private W = 0;
  private H = 0;
  private dpr = 1;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private scenes = new Map<string, Scene>();
  private ready2 = false;
  private match: Match | null = null;
  private setup: BrawlSetup | null = null;
  private bots = new Bots();
  private looks = new Map<string, Look>();
  private colorOf = new Map<string, string>();
  private fx: Fx[] = [];
  private shake = { until: 0, mag: 0 };
  private cam = { x: 240, y: 170, z: 2 };
  private sent = false;
  private ready = false;
  private since = new Map<string, { pose: string; at: number }>();
  /* online */
  private me = ME;
  private role: 'solo' | 'host' | 'guest' = 'solo';
  private mid = '';
  private hostId = '';
  private remoteIn = new Map<string, Input>();
  private heard = new Map<string, number>();
  private hostHeard = 0;
  private outbox: MatchEvent[] = [];
  private netAt = 0;
  private overSends = 0;
  private note: string | undefined;
  private lastIn: Input = NO_INPUT;
  /** where a fighter was drawn before a correction moved it: eased away over a few frames */
  private off = new Map<string, { x: number; y: number }>();
  /** where each other online fighter really was, and when we heard it (see INTERP_MS) */
  private trail = new Map<string, { t: number; x: number; y: number }[]>();
  /* input */
  private keys = new Set<string>();
  private mouse = { light: false, heavy: false, special: false };
  /** your meter was full last frame (for the READY call) */
  private wasFull = false;
  private stick: { id: number; ox: number; oy: number; x: number; y: number } | null = null;
  private held = new Map<number, 'jump' | 'light' | 'heavy' | 'dodge' | 'special'>();

  constructor(
    private canvas: HTMLCanvasElement,
    private emit: (e: BrawlEvent) => void,
    private touch: boolean,
  ) {
    this.c = ctx2d(canvas);
    this.bind();
    (globalThis as unknown as { __brawlore?: BrawlEngine }).__brawlore = this;
  }

  async start(atlasUrl: string) {
    await loadAtlas(atlasUrl);
    this.ready2 = true;
    this.last = performance.now();
    const loop = (t: number) => {
      this.raf = requestAnimationFrame(loop);
      this.frame(t);
    };
    this.raf = requestAnimationFrame(loop);
    this.ready = true;
    this.emit({ t: 'ready' });
  }
  stop() {
    cancelAnimationFrame(this.raf);
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.onKey, true);
      window.removeEventListener('keyup', this.onKeyUp, true);
      window.removeEventListener('blur', this.onBlur);
    }
  }
  setTouch(on: boolean) {
    this.touch = on;
  }

  /** Start a match against bots. */
  begin(s: BrawlSetup) {
    this.setup = s;
    const net = s.net;
    this.role = net ? net.role : 'solo';
    this.me = net ? net.me : ME;
    this.mid = net?.mid ?? '';
    this.hostId = net?.host ?? '';
    this.remoteIn.clear();
    this.heard.clear();
    this.outbox = [];
    this.overSends = 0;
    this.note = undefined;
    this.off.clear();
    this.trail.clear();
    this.hostHeard = performance.now();
    this.looks.clear();
    this.colorOf.clear();
    const players: { id: string; name: string; bot: Difficulty | null; weapon: Weapon; special: SpecialId }[] = [];
    if (net) {
      // the same list, in the same order, on every device in the match
      for (const p of net.players) {
        players.push({ id: p.id, name: p.id === this.me ? s.name || 'You' : p.name, bot: null, weapon: 'pick', special: p.id === this.me ? s.special : ((p.sp as SpecialId) ?? 'quake') });
        this.looks.set(p.id, p.id === this.me ? s.look : ((p.look as Look) ?? BOT_LOOKS[0]));
        if (p.id !== this.me) this.heard.set(p.id, performance.now());
      }
    } else {
      players.push({ id: ME, name: s.name || 'You', bot: null, weapon: s.weapon, special: s.special ?? 'quake' });
      this.looks.set(ME, s.look);
    }
    const want = s.mode === '1v1' ? 2 : 4;
    for (let k = 0; players.length < want; k++) {
      players.push({ id: `bot${k}`, name: BOT_NAMES[k], bot: (net ? 'normal' : s.diff) as Difficulty, weapon: 'pick', special: BOT_SPECIALS[k % BOT_SPECIALS.length] });
      this.looks.set(`bot${k}`, BOT_LOOKS[k % BOT_LOOKS.length]);
    }
    this.match = newMatch({ mode: s.mode, players, seed: s.seed ?? Math.floor(Math.random() * 1e9) });
    if (this.role === 'guest') {
      this.match.authority = false;
      this.match.local = this.me;
    }
    this.bots = new Bots();
    // you are always gold
    let ci = 1;
    for (const p of players) this.colorOf.set(p.id, p.id === this.me ? COLORS[0] : COLORS[ci++ % COLORS.length]);
    this.fx = [];
    this.sent = false;
    this.acc = 0;
    this.cam = { x: 240, y: 170, z: this.cam.z };
  }
  /** Leave the match (back to the menu). */
  quit() {
    this.match = null;
    this.role = 'solo';
  }

  /**
   * A callout card to post on X (1200 x 630): your miner against the rival in a Fightclub stage, the room code
   * and the link. A rival whose look is unknown (a friend on X) is a dark silhouette with a question mark.
   */
  card(o: { me: { name: string; look: Look; special: SpecialId }; rival: { name: string; look?: Look | null }; code: string; link: string; when?: string | null }) {
    // always THE CAGE behind: the ring reads best at a glance
    const stage = STAGES.find((x) => x.id === 'pit') ?? STAGES[0];
    let scene = this.scenes.get(stage.id);
    if (!scene) this.scenes.set(stage.id, (scene = paintStreetScene(stage)));
    const sp = SPECIAL_INFO[o.me.special];
    // the pixel font has no ? = or &: the card names the site, the post carries the full link
    const site = o.link.replace(/^https?:\/\//, '').split(/[/?]/)[0];
    const cv = paintStreetCard(scene, { me: o.me, rival: o.rival, code: o.code, link: site, when: o.when, special: { name: sp.name, color: sp.color } });
    const url = cv.toDataURL('image/png');
    this.emit({ t: 'card', url });
    return url;
  }

  /** Online: a message from the room (see game/brawl2/online.ts). */
  feed(e: string, p: Record<string, unknown>) {
    const m = this.match;
    if (!m || !p) return;
    const from = typeof p.id === 'string' ? p.id : '';
    if (this.role === 'host') {
      const f = m.fighters.find((x) => x.id === from);
      if (!f || from === this.me) return;
      if (e === 'boi' && !f.bot) {
        this.heard.set(from, performance.now());
        let i = this.remoteIn.get(from);
        if (!i) this.remoteIn.set(from, (i = { ...NO_INPUT }));
        const ox = f.x, oy = f.y;
        if (applySelf(f, p.s as number[], i)) this.ease(f, ox, oy);
        // their report, or (while they reel from a hit) where the host's own physics have them: the truth either way
        this.mark(f);
      } else if (e === 'bol' || e === 'bye') this.toBot(f);
    } else if (this.role === 'guest') {
      if (from !== this.hostId) return;
      if (e === 'bos') this.onSnap(m, p as unknown as Snap);
      else if (e === 'bol' || e === 'bye') this.hostLeft(m);
    }
  }
  private toBot(f: Fighter) {
    if (f.bot) return;
    f.bot = 'normal';
    this.remoteIn.delete(f.id);
  }
  private hostLeft(m: Match) {
    if (m.over) return;
    this.note = 'The host left the match.';
    m.over = true;
    // whoever left loses; the rest finish in order of lives, then damage
    const host = m.fighters.find((f) => f.id === this.hostId);
    if (host) host.stocks = 0;
    const left = [...m.fighters].filter((f) => f.stocks > 0).sort((a, b) => b.stocks - a.stocks || a.dmg - b.dmg);
    left.forEach((f, k) => (f.place = k + 1));
    if (host) host.place = left.length + 1;
  }
  private onSnap(m: Match, sn: Snap) {
    if (!sn || !Array.isArray(sn.f) || !Array.isArray(sn.m) || sn.f.length !== m.fighters.length) return;
    this.hostHeard = performance.now();
    m.frame = sn.m[0];
    m.countdown = sn.m[1];
    m.timeLeft = sn.m[2];
    m.fighters.forEach((f, k) => {
      const ox = f.x, oy = f.y;
      if (f.id === this.me) {
        if (adoptSelf(f, sn.f[k])) this.ease(f, ox, oy);
      } else {
        setFighter(f, sn.f[k], true);
        this.ease(f, ox, oy);
        this.mark(f);
      }
    });
    if (Array.isArray(sn.e)) {
      // your own swings already showed their sparks; the rest is news
      const news = sn.e.filter((ev) => ev && typeof ev === 'object' && !(ev.t === 'hit' && ev.by === this.me) && !(ev.id === this.me && ['jump', 'dodge', 'land', 'swing', 'recover', 'special', 'grab'].includes(ev.t)));
      this.react(m, news);
    }
    if (sn.m[4] === 1) m.sudden = true;
    if (sn.m[3] === 1 && !m.over) m.over = true;
  }
  /** Note where another fighter really is now. A respawn starts its trail again (it really does jump). */
  private mark(f: Fighter, now = performance.now()) {
    let tr = this.trail.get(f.id);
    if (!tr || f.respawn > 0) this.trail.set(f.id, (tr = []));
    tr.push({ t: now, x: f.x, y: f.y });
    while (tr.length > 2 && now - tr[1].t > 1000) tr.shift();
  }
  /** Where to draw another fighter: INTERP_MS ago on its trail, or null to draw it where this copy has it. */
  private trailAt(id: string, now: number): { x: number; y: number } | null {
    const tr = this.trail.get(id);
    if (!tr || !tr.length || now - tr[tr.length - 1].t > TRAIL_STALE_MS) return null;
    const at = now - INTERP_MS;
    if (at <= tr[0].t) return tr[0];
    for (let k = tr.length - 1; k > 0; k--) {
      const a = tr[k - 1], b = tr[k];
      if (at >= a.t) {
        if (at >= b.t) return b;
        const u = (at - a.t) / Math.max(1, b.t - a.t);
        return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
      }
    }
    return tr[tr.length - 1];
  }
  /** Draw a corrected fighter where it was, easing to where it is. */
  private ease(f: Fighter, ox: number, oy: number) {
    const dx = ox - f.x, dy = oy - f.y;
    const o = this.off.get(f.id) ?? { x: 0, y: 0 };
    // a respawn is a real jump; anything else (a late snapshot, a knockback the copy had not seen) glides there
    if (f.respawn > 0 || Math.hypot(dx + o.x, dy + o.y) > EASE_MAX) this.off.delete(f.id);
    else this.off.set(f.id, { x: o.x + dx, y: o.y + dy });
  }
  private netTick(m: Match, now: number) {
    if (this.role === 'solo' || now - this.netAt < NET_MS) return;
    this.netAt = now;
    if (this.role === 'host') {
      if (m.over && ++this.overSends > 15) return;
      const ins: Record<string, Input> = {};
      for (const [id, i] of this.remoteIn) ins[id] = i;
      ins[this.me] = this.lastIn;
      this.emit({ t: 'net', e: 'bos', p: { ...packSnap(this.mid, m, ins, this.outbox) } as unknown as Record<string, unknown> });
      this.outbox = [];
      for (const f of m.fighters) if (!f.bot && f.id !== this.me && now - (this.heard.get(f.id) ?? now) > GUEST_LOST_MS) this.toBot(f);
    } else {
      if (m.over) return;
      const f = m.fighters.find((x) => x.id === this.me);
      if (f) this.emit({ t: 'net', e: 'boi', p: { mid: this.mid, s: packSelf(f, this.lastIn) } });
      if (now - this.hostHeard > HOST_LOST_MS) this.hostLeft(m);
    }
  }

  /* ---------------- input ---------------- */
  private onKey = (e: KeyboardEvent) => {
    const k = e.key.toLowerCase();
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(k)) e.preventDefault();
    if (k === 'escape') this.emit({ t: 'menu' });
    this.keys.add(k);
  };
  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
  private onBlur = () => {
    this.keys.clear();
    this.mouse = { light: false, heavy: false, special: false };
  };
  private bind() {
    if (typeof window === 'undefined') return;
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    window.addEventListener('blur', this.onBlur);
    const cv = this.canvas;
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
    cv.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') {
        if (e.button === 0) this.mouse.light = true;
        if (e.button === 2) this.mouse.heavy = true;
        if (e.button === 1) {
          e.preventDefault();
          this.mouse.special = true;
        }
        return;
      }
      e.preventDefault();
      cv.setPointerCapture?.(e.pointerId);
      const x = e.offsetX;
      const y = e.offsetY;
      const b = this.buttonAt(x, y);
      if (b) this.held.set(e.pointerId, b);
      else if (x < this.W * 0.5 && !this.stick) this.stick = { id: e.pointerId, ox: x, oy: y, x, y };
    });
    cv.addEventListener('pointermove', (e) => {
      if (this.stick && e.pointerId === this.stick.id) {
        this.stick.x = e.offsetX;
        this.stick.y = e.offsetY;
      }
    });
    const up = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') {
        if (e.button === 0) this.mouse.light = false;
        if (e.button === 2) this.mouse.heavy = false;
        if (e.button === 1) this.mouse.special = false;
        return;
      }
      this.held.delete(e.pointerId);
      if (this.stick?.id === e.pointerId) this.stick = null;
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
  }

  /** The phone buttons, in CSS px: [id, x, y, radius, label]. */
  private buttons(): ['jump' | 'light' | 'heavy' | 'dodge' | 'special', number, number, number, string][] {
    const r = Math.max(26, Math.min(40, this.H * 0.085));
    const bx = this.W - r * 1.6;
    const by = this.H - r * 1.5;
    return [
      ['light', bx, by - r * 2.3, r, 'LIGHT'],
      ['heavy', bx - r * 2.3, by - r * 0.9, r, 'HEAVY'],
      ['jump', bx, by, r * 1.05, 'JUMP'],
      ['dodge', bx - r * 2.4, by - r * 3.2, r * 0.8, 'DODGE'],
      ['special', bx - r * 4.4, by - r * 0.4, r * 0.9, 'SPECIAL'],
    ];
  }
  private buttonAt(x: number, y: number) {
    if (!this.touch) return null;
    for (const [id, bx, by, r] of this.buttons()) if (Math.hypot(x - bx, y - by) < r * 1.15) return id;
    return null;
  }

  private myInput(): Input {
    const k = this.keys;
    let mx = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
    let my = (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0);
    if (this.stick) {
      const dx = this.stick.x - this.stick.ox;
      const dy = this.stick.y - this.stick.oy;
      const R = 46;
      mx = Math.abs(dx) < 10 ? 0 : Math.max(-1, Math.min(1, dx / R));
      my = Math.abs(dy) < 14 ? 0 : Math.max(-1, Math.min(1, dy / R));
    }
    const held = new Set(this.held.values());
    return {
      mx,
      my,
      jump: k.has('w') || k.has('arrowup') || k.has(' ') || held.has('jump'),
      light: k.has('j') || this.mouse.light || held.has('light'),
      heavy: k.has('k') || this.mouse.heavy || held.has('heavy'),
      dodge: k.has('l') || k.has('shift') || held.has('dodge'),
      special: k.has('i') || k.has('e') || this.mouse.special || held.has('special'),
    };
  }

  /* ---------------- the loop ---------------- */
  private resize() {
    const cssW = this.canvas.clientWidth || window.innerWidth;
    const cssH = this.canvas.clientHeight || window.innerHeight;
    const dpr = canvasDpr(cssW, cssH, 2);
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
    this.resize();
    const m = this.match;
    if (m && !m.over) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= 1 / FPS && n < 5) {
        this.acc -= 1 / FPS;
        n++;
        const guest = this.role === 'guest';
        const inputs: Record<string, Input> = guest ? {} : this.bots.inputs(m);
        const meF = m.fighters.find((f) => f.id === this.me);
        this.lastIn = meF && meF.stocks > 0 ? this.myInput() : NO_INPUT;
        inputs[this.me] = this.lastIn;
        for (const f of m.fighters) {
          if (f.id === this.me || f.bot) continue;
          // the others: online players hold what they last sent (host) or what the snapshot said (guest)
          const r = guest ? f.prev : this.remoteIn.get(f.id);
          inputs[f.id] = { ...NO_INPUT, mx: r?.mx ?? 0, my: r?.my ?? 0 };
        }
        if (guest) for (const f of m.fighters) if (f.bot) inputs[f.id] = { ...NO_INPUT, mx: f.prev.mx, my: f.prev.my };
        step(m, inputs);
        if (this.role === 'host') for (const e of m.events) if (e.t !== 'swing' && e.t !== 'recover') this.outbox.push({ ...e });
        // a guest's own copy only speaks for its own miner; the host's snapshots bring the rest
        this.react(m, guest ? m.events.filter((e) => (e.id === this.me && ['jump', 'dodge', 'land', 'swing', 'recover', 'special', 'grab'].includes(e.t)) || (e.t === 'hit' && e.by === this.me)) : m.events);
      }
      if (n === 5) this.acc = 0;
    }
    if (m) this.netTick(m, t);
    if (m) {
      const meF = m.fighters.find((f) => f.id === this.me);
      const full = Boolean(meF && meF.meter >= METER_FULL && meF.stocks > 0);
      if (full && !this.wasFull && !m.over && m.countdown === 0) {
        this.fx.push({ k: 'word', x: 240, y: 110, t0: performance.now(), dur: 800, c: SPECIAL_INFO[meF!.special].color, word: 'SPECIAL READY', small: true });
        this.emit({ t: 'sfx', name: 'ready' });
      }
      this.wasFull = full;
    }
    // the same glide on every screen: about 70 ms to close two thirds of the gap, whatever the refresh rate
    const keep = Math.exp(-dt / EASE_S);
    for (const [id, o] of this.off) {
      o.x *= keep;
      o.y *= keep;
      if (Math.abs(o.x) + Math.abs(o.y) < 0.3) this.off.delete(id);
    }
    if (m && m.over && !this.sent) {
      this.sent = true;
      const me = m.fighters.find((f) => f.id === this.me) ?? m.fighters[0];
      const table = [...m.fighters].sort((a, b) => (a.place || 99) - (b.place || 99)).map((f) => ({ id: f.id, name: f.name, place: f.place, kos: f.kos, falls: f.falls, you: f.id === this.me, bot: Boolean(f.bot) }));
      const result: BrawlResult = { mode: m.mode, diff: this.setup!.diff, place: me.place, of: m.fighters.length, kos: me.kos, falls: me.falls, table, online: this.role !== 'solo', note: this.note, mid: this.mid || undefined };
      setTimeout(() => this.emit({ t: 'end', result }), this.note ? 200 : 1400);
    }
    this.draw(t);
  }

  /** Effects and sounds for what happened this step. */
  private react(m: Match, events: MatchEvent[]) {
    const now = performance.now();
    for (const e of events) {
      const col = (e.id && this.colorOf.get(e.id)) || '#fff';
      if (e.t === 'hit') {
        const big = Boolean(e.heavy);
        for (let k = 0; k < (big ? 14 : 7); k++) {
          const a = Math.random() * Math.PI * 2;
          const v = (big ? 120 : 70) * (0.5 + Math.random());
          this.fx.push({ k: 'spark', x: e.x!, y: e.y!, t0: now, dur: 260 + Math.random() * 200, c: k % 3 ? '#fff6c0' : this.colorOf.get(e.by!) ?? '#fff', vx: Math.cos(a) * v, vy: Math.sin(a) * v });
        }
        this.fx.push({ k: 'ring', x: e.x!, y: e.y!, t0: now, dur: big ? 320 : 200, c: '#ffffff', s: big ? 22 : 12 });
        if (big) this.kick(260, 3.2);
        else this.kick(90, 1.2);
        this.emit({ t: 'sfx', name: big ? 'slam' : 'hit' });
      } else if (e.t === 'ko') {
        const b = m.stage.blast;
        const ang = e.x! <= b.x0 + 1 ? 0 : e.x! >= b.x1 - 1 ? Math.PI : e.y! <= b.y0 + 1 ? Math.PI / 2 : -Math.PI / 2;
        this.fx.push({ k: 'beam', x: e.x!, y: e.y!, t0: now, dur: 700, c: col, ang });
        this.fx.push({ k: 'word', x: 240, y: 110, t0: now, dur: 1000, c: col, word: e.by === this.me ? 'KO!' : e.id === this.me ? 'OUCH' : 'KO' });
        this.kick(420, 5);
        this.emit({ t: 'sfx', name: 'ko' });
      } else if (e.t === 'land' && e.heavy) {
        for (let k = 0; k < 6; k++) this.fx.push({ k: 'dust', x: e.x! + (k - 3) * 3, y: e.y!, t0: now, dur: 420, c: '#b9a8c8', vx: (k - 3) * 20, vy: -30 });
      } else if (e.t === 'jump') {
        this.fx.push({ k: 'dust', x: e.x!, y: e.y!, t0: now, dur: 300, c: '#9a8aa8', vx: 0, vy: -10 });
      } else if (e.t === 'swing' && e.id === this.me) {
        this.emit({ t: 'sfx', name: 'swing' });
      } else if (e.t === 'special') {
        const f = m.fighters.find((x) => x.id === e.id);
        const info = f ? SPECIAL_INFO[f.special] : null;
        if (info) {
          this.fx.push({ k: 'ring', x: e.x!, y: e.y! - 12, t0: now, dur: 420, c: info.color, s: 30 });
          this.fx.push({ k: 'ring', x: e.x!, y: e.y! - 12, t0: now + 80, dur: 420, c: '#ffffff', s: 18 });
          this.fx.push({ k: 'word', x: 240, y: 110, t0: now, dur: 900, c: info.color, word: e.id === this.me ? info.name : `${f!.name.slice(0, 8)}: ${info.name}`, small: true });
          if (f!.special === 'quake') for (let k = 0; k < 12; k++) this.fx.push({ k: 'dust', x: e.x! + (k - 6) * 6, y: e.y!, t0: now + 180, dur: 500, c: '#c8a070', vx: (k - 6) * 30, vy: -40 });
          this.kick(200, 2.5);
          this.emit({ t: 'sfx', name: 'special' });
        }
      } else if (e.t === 'sudden') {
        this.fx.push({ k: 'word', x: 240, y: 110, t0: now, dur: 1600, c: '#ff5a6a', word: 'SUDDEN DEATH' });
        this.kick(300, 3);
        this.emit({ t: 'sfx', name: 'ko' });
      } else if (e.t === 'grab') {
        this.fx.push({ k: 'dust', x: e.x!, y: e.y!, t0: now, dur: 260, c: '#c8b090', vx: 0, vy: -20 });
        if (e.id === this.me) this.emit({ t: 'sfx', name: 'pick' });
      } else if (e.t === 'counter') {
        this.fx.push({ k: 'ring', x: e.x!, y: e.y!, t0: now, dur: 380, c: '#c8f0ff', s: 34 });
        this.fx.push({ k: 'word', x: 240, y: 110, t0: now, dur: 900, c: '#c8f0ff', word: 'COUNTER!', small: true });
        this.kick(300, 4);
      } else if (e.t === 'dodge') {
        this.fx.push({ k: 'ring', x: e.x!, y: e.y! - 10, t0: now, dur: 220, c: '#c8f0ff', s: 10 });
      } else if (e.t === 'go') {
        this.fx.push({ k: 'word', x: 240, y: 110, t0: now, dur: 800, c: '#ffc93c', word: 'BRAWL!' });
        this.emit({ t: 'sfx', name: 'cheer' });
      } else if (e.t === 'end') {
        this.fx.push({ k: 'word', x: 240, y: 110, t0: now, dur: 1400, c: '#ffc93c', word: 'GAME!' });
        this.emit({ t: 'sfx', name: 'cheer' });
      }
    }
  }
  private kick(ms: number, mag: number) {
    if (reducedMotion()) return;
    const now = performance.now();
    this.shake = { until: now + ms, mag: Math.max(mag, this.shake.until > now ? this.shake.mag : 0) };
  }

  /* ---------------- drawing ---------------- */
  private draw(now: number) {
    const c = this.c;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.imageSmoothingEnabled = false;
    c.fillStyle = '#0b0712';
    c.fillRect(0, 0, this.W, this.H);
    if (!this.ready2) return;
    const m = this.match;
    const stage = m?.stage ?? STAGES[0];
    let scene = this.scenes.get(stage.id);
    if (!scene) this.scenes.set(stage.id, (scene = paintStreetScene(stage)));
    // the camera: everyone in play, and the main stage, in view
    let x0 = 120, x1 = 360, y0 = 120, y1 = 210;
    if (m) {
      for (const f of m.fighters) {
        if (f.stocks <= 0 || f.respawn > 0) continue;
        x0 = Math.min(x0, f.x - 30);
        x1 = Math.max(x1, f.x + 30);
        y0 = Math.min(y0, f.y - 50);
        y1 = Math.max(y1, f.y + 20);
      }
      x0 = Math.max(x0, m.stage.blast.x0 + 10);
      x1 = Math.min(x1, m.stage.blast.x1 - 10);
      y0 = Math.max(y0, m.stage.blast.y0 + 10);
      y1 = Math.min(y1, m.stage.blast.y1 - 30);
    }
    const zFit = Math.min(this.W / (x1 - x0 + 60), this.H / (y1 - y0 + 70));
    const zMax = this.touch ? 3.2 : 3;
    // never zoomed out past the painted world
    const zMin = Math.max(this.W / WW, this.H / WH);
    const z = Math.max(zMin, Math.min(Math.max(zMax, zMin), zFit));
    this.cam.z += (z - this.cam.z) * 0.06;
    if (this.cam.z < zMin) this.cam.z = zMin;
    this.cam.x += ((x0 + x1) / 2 - this.cam.x) * 0.1;
    this.cam.y += ((y0 + y1) / 2 - this.cam.y) * 0.1;
    const Z = this.cam.z;
    // and never looking past its edges
    const hw = this.W / 2 / Z, hh = this.H / 2 / Z;
    this.cam.x = Math.max(WX0 + hw, Math.min(WX0 + WW - hw, this.cam.x));
    this.cam.y = Math.max(WY0 + hh, Math.min(WY0 + WH - hh, this.cam.y));
    let shx = 0, shy = 0;
    if (now < this.shake.until) {
      shx = (Math.random() - 0.5) * this.shake.mag * 2;
      shy = (Math.random() - 0.5) * this.shake.mag * 2;
    }
    const ox = this.W / 2 - this.cam.x * Z + shx;
    const oy = this.H / 2 - this.cam.y * Z + shy;
    const sx = (x: number) => ox + x * Z;
    const sy = (y: number) => oy + y * Z;
    c.drawImage(scene.cv, sx(WX0), sy(WY0), WW * Z, WH * Z);
    animateStreetScene(c, stage, now, sx, sy, Z);
    // mine lamps swing a little and flicker
    for (const [tx, ty] of scene.lamps) {
      const fl = 0.8 + 0.2 * Math.sin(now / 90 + tx) * Math.sin(now / 37 + ty);
      const sw = Math.sin(now / 900 + tx) * 1.5;
      const lx = tx + sw;
      const gl = c.createRadialGradient(sx(lx), sy(ty + 4), 0, sx(lx), sy(ty + 4), 40 * Z);
      gl.addColorStop(0, hexA(scene.lamp, 0.3 * fl));
      gl.addColorStop(1, hexA(scene.lamp, 0));
      c.fillStyle = gl;
      c.fillRect(sx(lx - 40), sy(ty - 36), 80 * Z, 80 * Z);
      c.strokeStyle = '#8a8a96';
      c.lineWidth = Math.max(1, Z * 0.6);
      c.beginPath();
      c.moveTo(sx(tx), sy(2));
      c.lineTo(sx(lx), sy(ty));
      c.stroke();
      c.fillStyle = '#2a2a34';
      c.fillRect(sx(lx - 3), sy(ty), 6 * Z, 2 * Z);
      c.fillStyle = `rgba(255,${Math.round(200 + 40 * fl)},120,1)`;
      c.fillRect(sx(lx - 2), sy(ty + 2), 4 * Z, 4 * Z);
      c.fillStyle = '#2a2a34';
      c.fillRect(sx(lx - 3), sy(ty + 6), 6 * Z, 1 * Z);
    }
    // the crowd's helmet lamps, and a cheer that runs through them when someone is knocked out
    const cheer = now < this.shake.until;
    for (let k = 0; k < scene.crowd.length; k++) {
      const [cx, cy] = scene.crowd[k];
      const on = (Math.floor(now / 400) + k * 7) % 11 !== 0;
      if (!on) continue;
      const hop = cheer && k % 2 ? Math.round(Math.sin(now / 60 + k)) : 0;
      c.fillStyle = '#fff3b0';
      c.fillRect(sx(cx), sy(cy - 1 + hop), Math.max(1, Z), Math.max(1, Z));
    }
    if (!m) {
      this.drawTouch(now, false);
      return;
    }
    // fighters
    const order = [...m.fighters].sort((a, b) => (a.id === this.me ? 1 : 0) - (b.id === this.me ? 1 : 0));
    for (const f of order) {
      // other online fighters glide along where they really were; your own (and the host's bots) draw as they are
      const p = f.id !== this.me && this.role !== 'solo' ? this.trailAt(f.id, now) : null;
      const o = p ? null : this.off.get(f.id);
      this.drawFighter(c, p ? { ...f, x: p.x, y: p.y } : o ? { ...f, x: f.x + o.x, y: f.y + o.y } : f, m, sx, sy, Z, now);
    }
    // effects
    this.fx = this.fx.filter((e) => now - e.t0 < e.dur);
    for (const e of this.fx) this.drawFx(c, e, now, sx, sy, Z);
    // someone off screen: a bubble at the edge pointing at them
    for (const f of m.fighters) {
      if (f.stocks <= 0 || f.respawn > 0) continue;
      const X = sx(f.x), Y = sy(f.y - 12);
      if (X > 0 && X < this.W && Y > 0 && Y < this.H) continue;
      const bx = Math.max(22, Math.min(this.W - 22, X));
      const by = Math.max(22, Math.min(this.H - 22, Y));
      c.fillStyle = 'rgba(10,6,18,0.85)';
      c.beginPath();
      c.arc(bx, by, 16, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = this.colorOf.get(f.id) ?? '#fff';
      c.lineWidth = 2;
      c.stroke();
      drawMiner(c, this.looks.get(f.id)!, 'idle', 0, bx, by + 10, 1, f.facing);
    }
    this.drawHud(c, m, now);
    this.drawTouch(now, !m.over);
  }

  private drawFighter(c: Ctx, f: Fighter, m: Match, sx: (x: number) => number, sy: (y: number) => number, Z: number, now: number) {
    if (f.stocks <= 0 || f.respawn > 0) return;
    const look = this.looks.get(f.id)!;
    const col = this.colorOf.get(f.id) ?? '#fff';
    const pv = poseOf(f);
    const prev = this.since.get(f.id);
    if (!prev || prev.pose !== pv.pose) this.since.set(f.id, { pose: pv.pose, at: now });
    const k = pv.k >= 0 ? pv.k : frameAt(pv.pose, this.since.get(f.id)!.at, now);
    // the floor under them, for the shadow
    const under = m.stage.plats.filter((p) => f.x >= p.x0 && f.x <= p.x1 && p.y >= f.y - 1).sort((a, b) => a.y - b.y)[0];
    const gy = under ? under.y : f.y;
    const lift = under ? Math.min(60, gy - f.y) : 0;
    const blink = f.invuln > 0 && Math.floor(now / 80) % 2 === 0;
    const tilt = f.hitstun > 0 ? Math.max(-0.9, Math.min(0.9, (f.vx / 400) * -f.facing)) : f.dodge > 0 ? 0.3 * f.facing : 0;
    // the active hit: a slash arc where the weapon is
    if (f.act) {
      const mv = moveOf(f, f.act.move);
      const sp = f.act.move === 'special' ? SPECIAL_INFO[f.special] : null;
      if (sp) {
        // the special's aura: the item's own colour round the miner
        const a = 0.35 + 0.2 * Math.sin(now / 50);
        const gl = c.createRadialGradient(sx(f.x), sy(f.y - 12), 0, sx(f.x), sy(f.y - 12), 30 * Z);
        gl.addColorStop(0, hexA(look.pick, a));
        gl.addColorStop(1, hexA(look.pick, 0));
        c.fillStyle = gl;
        c.fillRect(sx(f.x - 30), sy(f.y - 42), 60 * Z, 60 * Z);
        if (mv.guard && f.act.f < mv.start + mv.active) {
          // Diamond Hands: a diamond of light round the miner
          c.strokeStyle = sp.color;
          c.lineWidth = Math.max(2, Z * 1.4);
          c.beginPath();
          c.moveTo(sx(f.x), sy(f.y - 34));
          c.lineTo(sx(f.x + 14), sy(f.y - 14));
          c.lineTo(sx(f.x), sy(f.y + 4));
          c.lineTo(sx(f.x - 14), sy(f.y - 14));
          c.closePath();
          c.stroke();
        }
      }
      if (!mv.guard && f.act.f >= mv.start - 1 && f.act.f < mv.start + mv.active + 1) {
        const hb = moveHitbox(f, mv);
        c.strokeStyle = sp ? sp.color : f.act.move.endsWith('Heavy') || f.act.move === 'pound' ? '#fff3b0' : 'rgba(255,255,255,0.85)';
        c.lineWidth = Math.max(2, Z * (sp ? 2.6 : 1.6));
        c.beginPath();
        const cx = sx((hb.x0 + hb.x1) / 2), cy = sy((hb.y0 + hb.y1) / 2);
        const r = Math.max(hb.x1 - hb.x0, hb.y1 - hb.y0) * 0.55 * Z;
        const a0 = f.facing > 0 ? -1.4 : Math.PI - 0.4;
        c.arc(cx, cy, r, a0, a0 + 1.8);
        c.stroke();
      }
    }
    if (f.dodge > 0) {
      c.globalAlpha = 0.35;
      drawMiner(c, look, pv.pose, k, sx(f.x - f.vx * 0.04), sy(gy), Z, f.facing, 0.5, lift, tilt);
      c.globalAlpha = 1;
    }
    drawMiner(c, look, pv.pose, k, sx(f.x), sy(gy), Z, f.facing, blink ? 0.35 : f.dodge > 0 ? 0.6 : 1, lift, tilt);
    // name over the head, YOU arrow
    const label = f.id === this.me ? 'YOU' : f.name;
    const ts = Math.max(1, Math.round(Z * 0.5));
    const tw = textWidth(label) * ts;
    const ty = sy(f.y - 34);
    text(c, label, sx(f.x) - tw / 2, ty, ts, col, '#120c1a');
    if (f.id === this.me) {
      c.fillStyle = col;
      const ax = sx(f.x);
      c.beginPath();
      c.moveTo(ax - 3 * ts, ty + 7 * ts);
      c.lineTo(ax + 3 * ts, ty + 7 * ts);
      c.lineTo(ax, ty + 10 * ts);
      c.fill();
    }
  }

  private drawFx(c: Ctx, e: Fx, now: number, sx: (x: number) => number, sy: (y: number) => number, Z: number) {
    const p = (now - e.t0) / e.dur;
    const t = (now - e.t0) / 1000;
    if (e.k === 'spark' || e.k === 'dust') {
      const x = e.x + (e.vx ?? 0) * t;
      const y = e.y + (e.vy ?? 0) * t + (e.k === 'dust' ? 0 : 180 * t * t);
      c.globalAlpha = 1 - p;
      c.fillStyle = e.c;
      const s = (e.k === 'dust' ? 2 : 1.5) * Z;
      c.fillRect(sx(x) - s / 2, sy(y) - s / 2, s, s);
      c.globalAlpha = 1;
    } else if (e.k === 'ring') {
      c.globalAlpha = 1 - p;
      c.strokeStyle = e.c;
      c.lineWidth = Math.max(1.5, Z * (1 - p) * 2);
      c.beginPath();
      c.arc(sx(e.x), sy(e.y), (e.s ?? 10) * (0.4 + p) * Z, 0, Math.PI * 2);
      c.stroke();
      c.globalAlpha = 1;
    } else if (e.k === 'beam') {
      // the KO blast: a wide beam of the fighter's colour from where they flew out
      c.save();
      c.translate(sx(e.x), sy(e.y));
      c.rotate(e.ang ?? 0);
      c.globalAlpha = Math.max(0, 1 - p);
      const g = c.createLinearGradient(0, 0, 260 * Z, 0);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.25, e.c);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      const h = (18 + 30 * (1 - p)) * Z;
      c.fillRect(0, -h / 2, 260 * Z, h);
      c.restore();
      c.globalAlpha = 1;
    } else if (e.k === 'word') {
      // big centred word on the screen
      const s = Math.max(e.small ? 2 : 3, Math.round(Math.min(this.W, this.H) / (e.small ? 180 : 70)));
      const pop = p < 0.15 ? 1 + (0.15 - p) * 4 : 1;
      const ss = Math.round(s * pop);
      const w = textWidth(e.word!) * ss;
      c.globalAlpha = p > 0.75 ? (1 - p) * 4 : 1;
      text(c, e.word!, this.W / 2 - w / 2, this.H * (e.small ? 0.22 : 0.3), ss, e.c, '#120c1a');
      c.globalAlpha = 1;
    }
  }

  private drawHud(c: Ctx, m: Match, now: number) {
    const s = Math.max(2, Math.round(Math.min(this.W, this.H) / 200));
    // countdown, then the clock
    if (m.countdown > 0) {
      const n = Math.ceil(m.countdown / FPS);
      const big = s * 4;
      const w = textWidth(String(n)) * big;
      text(c, String(n), this.W / 2 - w / 2, this.H * 0.3, big, '#ffc93c', '#120c1a');
      // where you are fighting
      const nm = m.stage.name;
      const ns = Math.max(2, s);
      text(c, nm, this.W / 2 - (textWidth(nm) * ns) / 2, this.H * 0.3 + big * 8, ns, '#f4ecff', '#120c1a');
    } else {
      const secs = Math.max(0, Math.ceil(m.timeLeft / FPS));
      const t = m.sudden ? 'SUDDEN DEATH' : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      const w = textWidth(t) * s;
      text(c, t, this.W / 2 - w / 2, 12, s, m.sudden || secs <= 10 ? '#ff5a6a' : '#f4ecff', '#120c1a');
    }
    // a card per fighter along the bottom (on a phone, along the top so thumbs don't cover it)
    const n = m.fighters.length;
    const cw = Math.min(s * 58, (this.W - 40) / n - 8);
    // the text scale the card fits ("12345678" over "999%")
    const hs = Math.max(1, Math.min(s, Math.floor(cw / 58)));
    const ch = 16 * hs;
    const total = n * cw + (n - 1) * 8;
    const left = this.touch ? this.W / 2 - total / 2 : this.W / 2 - total / 2;
    const top = this.touch ? 12 + 10 * s : this.H - ch - 12;
    m.fighters.forEach((f, k) => {
      const x = left + k * (cw + 8);
      const col = this.colorOf.get(f.id) ?? '#fff';
      c.fillStyle = 'rgba(12,8,22,0.82)';
      c.fillRect(x, top, cw, ch);
      c.fillStyle = col;
      c.fillRect(x, top, 3, ch);
      const name = (f.id === this.me ? 'YOU' : f.name).slice(0, 8);
      text(c, name, x + 7, top + 3, Math.max(1, hs - 1), col);
      // damage %: white to yellow to red as it rises; out = grey
      const d = Math.round(f.dmg);
      const dc = f.stocks <= 0 ? '#5a5070' : d < 50 ? '#ffffff' : d < 100 ? '#ffe46a' : d < 150 ? '#ff9a3a' : '#ff4a4a';
      const ds = f.stocks <= 0 ? 'OUT' : `${d}%`;
      const shakeX = f.hitstun > 0 && f.stocks > 0 ? Math.round((Math.random() - 0.5) * 3) : 0;
      text(c, ds, x + cw - textWidth(ds) * (hs + 1) - 6 + shakeX, top + 3 + hs * 2, hs + 1, dc, '#120c1a');
      for (let i = 0; i < STOCKS; i++) {
        c.fillStyle = i < f.stocks ? col : 'rgba(255,255,255,0.15)';
        c.fillRect(x + 7 + i * (hs * 4), top + ch - hs * 4, hs * 3, hs * 3);
      }
      // the special meter along the bottom edge; full, it glows in the special's colour
      const full = f.meter >= METER_FULL;
      const spc = SPECIAL_INFO[f.special].color;
      c.fillStyle = 'rgba(255,255,255,0.1)';
      c.fillRect(x + 3, top + ch - 2, cw - 3, 2);
      c.fillStyle = full ? (Math.floor(now / 200) % 2 ? spc : '#ffffff') : spc;
      c.fillRect(x + 3, top + ch - 2, ((cw - 3) * Math.min(METER_FULL, f.meter)) / METER_FULL, 2);
      if (full && f.stocks > 0) text(c, 'SP', x + 7 + STOCKS * hs * 4 + hs, top + ch - hs * 4 - Math.max(0, hs - 1), Math.max(1, hs - 1), spc, '#120c1a');
      if (f.respawn > 0 && f.stocks > 0) {
        c.globalAlpha = 0.6;
        c.fillStyle = '#000';
        c.fillRect(x, top, cw, ch);
        c.globalAlpha = 1;
      }
    });
  }

  private drawTouch(now: number, live: boolean) {
    if (!this.touch || !live) return;
    const c = this.c;
    const held = new Set(this.held.values());
    const meF = this.match?.fighters.find((f) => f.id === this.me);
    const ready = Boolean(meF && meF.meter >= METER_FULL);
    for (const [id, x, y, r, label] of this.buttons()) {
      const on = held.has(id);
      if (id === 'special') {
        // fills up as the meter does
        const k = meF ? Math.min(1, meF.meter / METER_FULL) : 0;
        const col = meF ? SPECIAL_INFO[meF.special].color : '#ffffff';
        c.fillStyle = 'rgba(14,10,26,0.55)';
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = col;
        c.lineWidth = 3;
        c.beginPath();
        c.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
        c.stroke();
        if (ready) {
          c.globalAlpha = 0.25 + 0.2 * Math.sin(now / 120);
          c.fillStyle = col;
          c.beginPath();
          c.arc(x, y, r, 0, Math.PI * 2);
          c.fill();
          c.globalAlpha = 1;
        }
        text(c, 'SP', x - textWidth('SP'), y - 3 * 2, 2, ready ? '#ffffff' : 'rgba(244,236,255,0.5)', '#120c1a');
        continue;
      }
      c.fillStyle = on ? 'rgba(255,201,60,0.55)' : 'rgba(14,10,26,0.55)';
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = id === 'jump' ? '#ffc93c' : id === 'heavy' ? '#ff7a4a' : id === 'dodge' ? '#8fd8ff' : '#f4ecff';
      c.lineWidth = 2.5;
      c.stroke();
      const s = r > 34 ? 2 : 1;
      text(c, label, x - (textWidth(label) * s) / 2, y - 3 * s, s, '#f4ecff', '#120c1a');
    }
    if (this.stick) {
      const { ox, oy, x, y } = this.stick;
      c.strokeStyle = 'rgba(244,236,255,0.5)';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(ox, oy, 46, 0, Math.PI * 2);
      c.stroke();
      const dx = x - ox, dy = y - oy;
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(46, d) / d;
      c.fillStyle = 'rgba(255,201,60,0.7)';
      c.beginPath();
      c.arc(ox + dx * k, oy + dy * k, 18, 0, Math.PI * 2);
      c.fill();
    } else {
      // a hint where the stick goes
      c.globalAlpha = 0.35 + 0.15 * Math.sin(now / 500);
      text(c, 'MOVE', 40, this.H - 40, 2, '#f4ecff', '#120c1a');
      c.globalAlpha = 1;
    }
  }
}

/** '#rrggbb' with alpha */
function hexA(hex: string, a: number) {
  const h = /^#([0-9a-f]{6})$/i.test(hex) ? hex.slice(1) : 'ffc93c';
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}
