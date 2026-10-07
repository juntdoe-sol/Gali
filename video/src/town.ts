/**
 * The lobby, on film.
 *
 * This is the real lobby engine (app/src/engine/lobby.ts): the same map, the same miners, the same sky, the same
 * speech bubbles, emotes and dances. What is scripted here is who walks where and when, what they say, and where
 * the camera looks. The engine's `director` hook lets the film place the camera; nothing else about it is special.
 */
import { clock } from './clock';
import {
  b, BEAT, BODY, GOLD, H, MUTED, PORTRAIT, SKR, SOLG, TEAL, U, W, WHITE,
  burst, caption, clamp01, crossed, events, flash, font, g, hash, icon, inCubic, inExpo, inOut, kinetic, lerp, outBack, outCubic, outExpo, prog, ring, rr, speedLines, tagCard, textW, fx,
} from './kit';
import { T } from './timeline';
import { CAST, FRIENDS, LOOK } from './cast';
import { LobbyEngine, type LobbyPeerView, type LobbySnap } from '../../app/src/engine/lobby';
import { POSES } from '../../app/src/engine/actors';
import { isFree, LCOLS, lidx, lobbyMap, LROWS, LT, PLAZA, ROAD } from '../../app/src/game/lobbyMap';

/* ---------------- the stage ---------------- */
export const townCv = document.createElement('canvas');
townCv.style.cssText = `position:absolute;left:0;top:0;width:${W / 2}px;height:${H / 2}px;visibility:hidden`;
document.body.appendChild(townCv);

const town = new LobbyEngine(
  townCv,
  (e) => {
    if (e.t === 'sfx') events.push({ t: clock.ms / 1000, name: `town:${e.name}` });
  },
  LOOK,
  { spawn: 'start', top: 0, bottom: 0 },
);
type Cam = { x: number; y: number; z: number };
const L = town as unknown as {
  frame: (t: number) => void;
  me: { x: number; y: number; path: unknown[]; pose: string; since: number; facing: number };
  peers: Map<string, { x: number; y: number }>;
  sky: { setTime: (f: number) => void; rain: number; rainTarget: number; lightning: number; nextWeather: number; wind: number };
  walkTo: (wx: number, wy: number) => void;
  director: { x: number; y: number; z?: number; hide?: { stick?: boolean; mini?: boolean; signs?: boolean } } | null;
};

export async function loadTown() {
  // the dances land on the beat: one pogo a beat, one disco or wiggle loop every two
  POSES.dance1.ms = 180;
  POSES.dance2.ms = 135;
  POSES.dance3.ms = 180;
  await town.start('pixel/atlas.png');
  L.sky.nextWeather = Number.MAX_SAFE_INTEGER; // the weather is scripted here
  L.sky.wind = 0.5;
}

const tc = (tx: number, ty: number): [number, number] => [tx * LT + LT / 2, ty * LT + LT / 2];

/* ---------------- the camera ---------------- */
// [beat, tile x, portrait tile y, portrait zoom, landscape tile y, landscape zoom]
const CAM: [number, number, number, number, number, number][] = [
  [63.5, 36.5, 26, 1.5, 27, 2],
  [70, 36.5, 31, 2.5, 31, 3],
  [72, 36.5, 31.6, 3, 31.6, 3.5],
  [79.5, 36.5, 31.9, 3, 31.9, 3.5],
  [80.5, 36.5, 32, 3.5, 32, 4], // a punch in as the dance starts
  [84, 36.5, 32, 3, 32, 3.5],
  [87.5, 36.5, 32, 3, 32, 3.5],
  [89, 36.5, 31.5, 2, 31.5, 2.5], // pull back: the whole plaza, dancing in the rain
  [91.5, 36.5, 31.5, 2, 31.5, 2.5],
  [92.5, 37, 31.8, 4, 31.8, 4.5], // the tip, close
  [95.7, 37, 31.8, 4, 31.8, 4.5],
  [96.9, 52.5, 12.5, 2.5, 10.5, 3], // the market
  [97.7, 52.5, 12.3, 2.5, 10.3, 3],
  [98.9, 63.5, 27.5, 2.5, 27.5, 3], // the pier
  [99.7, 64, 27.5, 2.5, 27.5, 3],
  [100.9, 36.5, 33, 1.5, 41.5, 2.5], // the games row
  [101.7, 36.5, 33, 1.5, 41.3, 2.5],
  [102.9, 15.5, 12.5, 2.5, 11.5, 3], // the cave mouth
  [103.3, 15.5, 12.4, 2.5, 11.4, 3],
  [104, 15.5, 10.6, 7, 10.6, 8], // and in
  [111.4, 15.5, 10.6, 7, 10.6, 8],
  [111.5, 36.5, 33, 1.5, 41.5, 2.5], // back out, onto the games row
  [115.4, 36.5, 32.7, 1.58, 41.2, 2.62],
  [116.4, 27.5, 39, 2.5, 41.5, 3], // Tunnel Collapse
  [123.4, 27.5, 39, 2.5, 41.5, 3],
  [124.4, 36.5, 39, 2.5, 41.5, 3], // Gold Rush Pot
  [131.4, 36.5, 39, 2.5, 41.5, 3],
  [132.4, 45.5, 39, 2.5, 41.5, 3], // Crash Cart
  [139.4, 45.5, 39, 2.5, 41.5, 3],
  [140.4, 36.5, 33, 1.5, 41.5, 2.5],
  [146, 36.5, 33, 1.5, 41.5, 2.5],
];
export function townCam(t: number): Cam {
  const bt = t / BEAT;
  let i = 0;
  while (i < CAM.length - 2 && bt >= CAM[i + 1][0]) i++;
  const a = CAM[i];
  const c = CAM[i + 1];
  const k = inOut(clamp01((bt - a[0]) / (c[0] - a[0])));
  const yi = PORTRAIT ? 2 : 4;
  return { x: lerp(a[1], c[1], k) * LT + LT / 2, y: lerp(a[yi], c[yi], k) * LT + LT / 2, z: lerp(a[yi + 1], c[yi + 1], k) };
}
let cam: Cam = { x: 0, y: 0, z: 2 };
/** A point of the lobby map on the video frame. */
export const onTown = (wx: number, wy: number): [number, number] => [(W / 4 + (wx - cam.x) * cam.z) * 2, (H / 4 + (wy - cam.y) * cam.z) * 2];
export const onTownTile = (tx: number, ty: number) => onTown(...tc(tx, ty));

/* ---------------- who goes where ---------------- */
type Key = [beat: number, tx: number, ty: number];
// the friends you meet at the fountain: AYU, RAJ, MEI, TOMI, SITI, KAI
const FRIEND_KEYS: Key[][] = [
  [[0, 40, 30], [68, 38, 32], [95.5, 39, 45]],
  [[0, 31, 26], [68.5, 34, 32], [77.75, 32, 32], [92, 30, 26], [104, 29, 45]],
  [[0, 41, 25], [67.5, 37, 34], [77.75, 40, 32], [92, 38, 45]],
  [[0, 29, 31], [68, 35, 34], [77.75, 34, 32], [92, 34, 45]],
  [[0, 43, 31], [69, 33, 30], [77.75, 30, 32], [92, 26, 45]],
  [[0, 33, 24], [69, 39, 30], [77.75, 42, 32], [92, 46, 45]],
];
/** Where the rest of the town stands when the mini games are on: in front of the three pavilions. */
const ROW_SPOTS: [number, number][] = [[25, 43], [29, 43], [28, 45], [33, 43], [38, 43], [43, 43], [47, 43], [44, 45], [35, 45], [24, 45]];

let SPOTS: [number, number][] = [];
function spots() {
  if (SPOTS.length) return SPOTS;
  const m = lobbyMap();
  for (let ty = 19; ty <= 38; ty++)
    for (let tx = 22; tx <= 50; tx++) {
      const k = m.terrain[lidx(tx, ty)];
      // keep the dance floor clear for the dancers
      const floor = ty >= 30 && ty <= 36 && tx >= 28 && tx <= 44;
      if ((k === PLAZA || k === ROAD) && isFree(m, tx, ty) && !floor && tx < LCOLS && ty < LROWS) SPOTS.push([tx, ty]);
    }
  return SPOTS;
}
/** A wanderer strolls from spot to spot round the plaza, and stops to dance when the music starts. */
function wander(k: number, bt: number): [number, number] {
  const period = 7 + (k % 4) * 2;
  const off = hash(k * 5.3) * period;
  // nobody sets off across the square in the middle of the dance
  const frozen = Math.min(bt, 80.5);
  const at = bt > 92.5 ? bt - 12 : frozen;
  const n = Math.floor((at + off) / period);
  const s = spots();
  return s[Math.floor(hash(k * 17.1 + n * 3.7) * s.length) % s.length];
}
function targetOf(k: number, bt: number): [number, number] {
  if (k < FRIENDS) {
    const keys = FRIEND_KEYS[k];
    let cur = keys[0];
    for (const key of keys) if (bt >= key[0]) cur = key;
    return [cur[1], cur[2]];
  }
  const w = k - FRIENDS;
  if (w < ROW_SPOTS.length && bt >= 99 + (w % 5) * 0.8) return ROW_SPOTS[w];
  return wander(k, bt);
}

const SAY: { who: number | 'me'; at: number; text: string; beats: number }[] = [
  { who: 1, at: T.says[0], text: 'gm miners', beats: 3 },
  { who: 2, at: T.says[1], text: 'spot 7 hit gold!', beats: 3 },
  { who: 'me', at: T.says[2], text: 'lets goooo', beats: 3 },
  { who: 0, at: T.says[3], text: 'dance party?', beats: 2.75 },
  { who: 0, at: T.tipCoins[2] + b(0.4), text: 'ty!!', beats: 2.2 },
  { who: 5, at: b(112.75), text: 'who is in?', beats: 2.5 },
];
const EMOTE: { who: number | 'me'; at: number; e: string; beats: number }[] = [
  { who: 0, at: T.emotes[0], e: 'wave', beats: 1.6 },
  { who: 3, at: T.emotes[1], e: 'laugh', beats: 1.6 },
  { who: 4, at: T.emotes[2], e: 'heart', beats: 1.6 },
  { who: 5, at: T.emotes[3], e: 'fire', beats: 1.6 },
  { who: 1, at: T.emotes[4], e: 'pick', beats: 1.6 },
  { who: 2, at: T.emotes[5], e: 'gem', beats: 1.6 },
  { who: 'me', at: T.emotes[6], e: 'fire', beats: 2 },
  { who: 3, at: T.emotes[7], e: 'wave', beats: 1.5 },
  { who: 0, at: T.tipCoins[2] + b(0.2), e: 'heart', beats: 3 },
  { who: 'me', at: b(113.5), e: 'pick', beats: 2 },
];
const active = <X extends { at: number; beats: number }>(list: X[], who: number | 'me', t: number, pred: (x: X) => boolean) => list.find((x) => pred(x) && t >= x.at && t < x.at + b(x.beats)) ?? null;
const danceAt = (t: number) => (t < T.dance || t >= T.danceOut + b(0.5) ? 0 : t < T.dance2 ? 1 : t < T.dance3 ? 2 : 3);

function snapshot(t: number): LobbySnap {
  const bt = t / BEAT;
  const dance = danceAt(t);
  const peers: LobbyPeerView[] = CAST.map((p, k) => {
    const [tx, ty] = tc(...targetOf(k, bt));
    const cur = L.peers.get(p.id);
    // friends are on the floor from the first beat; the town joins in a moment later, a few at a time
    const joins = k < FRIENDS ? T.dance : T.dance + b(1.5 + (k % 5) * 0.5);
    const dancing = dance > 0 && t >= joins;
    const say = active(SAY, k, t, (x) => x.who === k);
    const em = active(EMOTE, k, t, (x) => x.who === k);
    return {
      id: p.id,
      name: p.name,
      x: cur ? cur.x : tx,
      y: cur ? cur.y : ty,
      tx,
      ty,
      f: k % 2 ? 1 : -1,
      p: dancing ? `dance${dance}` : 'idle',
      look: p.look,
      say: say ? say.text : null,
      emoji: em ? em.e : null,
    };
  });
  const meSay = active(SAY, 'me', t, (x) => x.who === 'me');
  const meEm = active(EMOTE, 'me', t, (x) => x.who === 'me');
  return { peers, say: meSay ? meSay.text : null, emoji: meEm ? meEm.e : null, dance };
}

/* ---------------- one frame of the lobby ---------------- */
export const townOn = (t: number) => t >= T.shutIn - 0.6 && t < T.gear + 0.7;
let last = -1;
export function driveTown(t: number) {
  if (!townOn(t)) return;
  const cue = (at: number) => last < at && t >= at;
  if (last < 0) L.sky.setTime(0.4);
  // you: in from the gate to the fountain, then down to the games, then along the row from game to game
  const go = (at: number, tx: number, ty: number) => {
    if (cue(at)) L.walkTo(...tc(tx, ty));
  };
  go(b(64.2), 36, 32);
  go(b(96), 36, 44);
  go(b(115.6), 27, 44);
  go(b(123.6), 36, 44);
  go(b(131.6), 45, 44);
  go(b(139.6), 36, 44);
  // the sky: dusk as the chat winds up, night for the dance, rain in the last third, dawn for the tip
  if (t >= T.dusk[0] && t <= T.dusk[1]) L.sky.setTime(0.45 + inOut(prog(t, T.dusk[0], T.dusk[1])) * 0.55);
  if (t >= T.dawn[0] && t <= T.dawn[1]) L.sky.setTime(1.0 + inOut(prog(t, T.dawn[0], T.dawn[1])) * 0.4);
  const rain = t < T.rain ? 0 : t < T.dawn[0] ? prog(t, T.rain, T.rain + b(1.5)) * 0.92 : (1 - prog(t, T.dawn[0], T.dawn[0] + b(1.5))) * 0.92;
  L.sky.rain = rain;
  L.sky.rainTarget = rain;
  for (const at of T.bolts) if (cue(at)) L.sky.lightning = 0.95;
  cam = townCam(t);
  const touring = t >= T.tour && t < T.caveIn + 0.2;
  const map = touring || (t >= T.caveExit && t < T.gamesOut + 0.3);
  L.director = { x: cam.x, y: cam.y, z: cam.z, hide: { stick: true, mini: !map, signs: !touring } };
  town.push(snapshot(t));
  L.frame(clock.ms);
  last = t;
}

/* ---------------- the motion graphics over it ---------------- */
function tokenCoin(x: number, y: number, r: number, color: string, rim: string, label: string) {
  g.save();
  g.fillStyle = '#00000055';
  g.beginPath();
  g.arc(x + 4 * U, y + 6 * U, r, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = rim;
  g.lineWidth = 4 * U;
  g.stroke();
  font(r * 0.72, BODY);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = rim;
  g.fillText(label, x, y + 2 * U);
  g.restore();
}

const DANCE_NAMES = ['DISCO', 'POGO', 'WIGGLE'];
const DANCE_AT = [T.dance, T.dance2, T.dance3];
const WASH = ['255,79,216', '62,230,255', '255,207,74'];

export function sceneTown(t: number) {
  if (!townOn(t)) return;
  const topY = PORTRAIT ? 270 * U : 70 * U;
  const lowY = PORTRAIT ? H - 420 * U : H - 150 * U;

  /* ---- arriving ---- */
  if (t < T.chat + 0.4) {
    const sz = (PORTRAIT ? 64 : 48) * U;
    kinetic('MEET EVERYONE IN', W / 2, topY + sz, sz * 0.55, t, T.lobby + b(0.5), { fam: BODY, color: '#c9d4ff', spacing: 0.25, out: T.lobbyOut, shadow: '#000000aa' });
    kinetic('THE LOBBY', W / 2, topY + sz * 2.4, sz * 2.2, t, T.lobby + b(1), { color: GOLD, shadow: '#000000dd', stagger: 0.05, out: T.lobbyOut + 0.05 });
    // the town fills up: a head count
    const a = prog(t, T.lobby + b(2.5), T.lobby + b(3)) * (1 - prog(t, T.lobbyOut, T.lobbyOut + 0.25));
    if (a > 0) {
      const n = Math.round(1 + outCubic(prog(t, T.lobby + b(2.5), T.lobby + b(5.5))) * CAST.length);
      g.save();
      g.globalAlpha = a;
      const big = (PORTRAIT ? 140 : 104) * U;
      const numW = textW(String(n), big);
      const labW = textW(' MINERS IN TOWN', big * 0.42);
      const x0 = W / 2 - (numW + labW) / 2;
      font(big);
      g.textAlign = 'left';
      g.textBaseline = 'alphabetic';
      g.fillStyle = '#000000aa';
      g.fillText(String(n), x0 + 5 * U, lowY + 6 * U);
      g.fillStyle = TEAL;
      g.fillText(String(n), x0, lowY);
      font(big * 0.42);
      g.fillStyle = '#000000aa';
      g.fillText(' MINERS IN TOWN', x0 + numW + 4 * U, lowY + 4 * U);
      g.fillStyle = WHITE;
      g.fillText(' MINERS IN TOWN', x0 + numW, lowY);
      g.restore();
      caption('A LIVE TOWN SQUARE · UP TO 100 PLAYERS IN ONE LOBBY', W / 2, lowY + 62 * U, 26 * U, a);
    }
  }

  /* ---- talking ---- */
  tagCard('chat', 'CHAT AND EMOTES', 'TALK TO THE WHOLE TOWN · REACT WITH PIXEL EMOTES', t, T.chat, T.chatOut);
  if (t >= T.chat && t < T.dance) {
    // a pop where each line and each emote lands
    const who = (w: number | 'me'): [number, number] => {
      if (w === 'me') return onTown(L.me.x, L.me.y - 30);
      const p = L.peers.get(CAST[w].id);
      return p ? onTown(p.x, p.y - 30) : [W / 2, H / 2];
    };
    for (const s of SAY) if (s.at < T.dance) ring(...who(s.who), t, s.at, 0.45, 110, '#ffffff', 7);
    for (const e of EMOTE) if (e.at < T.dance) ring(...who(e.who), t, e.at, 0.4, 80, GOLD, 6);
  }

  /* ---- dancing ---- */
  if (t >= T.dance - 0.1 && t < T.tips + 0.3) {
    const live = prog(t, T.dance, T.dance + 0.3) * (1 - prog(t, T.danceOut, T.danceOut + 0.4));
    // the square takes a colour on every beat
    const beat = t / BEAT;
    const pulse = Math.pow(1 - (beat % 1), 2.2);
    g.save();
    g.globalCompositeOperation = 'lighter';
    const wash = g.createRadialGradient(W / 2, H * 0.52, 0, W / 2, H * 0.52, Math.max(W, H) * 0.7);
    wash.addColorStop(0, `rgba(${WASH[Math.floor(beat) % 3]},${0.2 * pulse * live})`);
    wash.addColorStop(1, `rgba(${WASH[Math.floor(beat) % 3]},0)`);
    g.fillStyle = wash;
    g.fillRect(0, 0, W, H);
    g.restore();
    // notes float up off the dancers
    const dancers: [number, number][] = [[L.me.x, L.me.y]];
    for (let k = 0; k < FRIENDS; k++) {
      const p = L.peers.get(CAST[k].id);
      if (p) dancers.push([p.x, p.y]);
    }
    dancers.forEach(([wx, wy], i) => {
      for (let n = 0; n < 2; n++) {
        const period = b(2);
        const u = ((t - T.dance + i * 0.31 + n * period * 0.5) % period) / period;
        if (t - T.dance < i * 0.31 + n * period * 0.5) return;
        const [x, y] = onTown(wx + Math.sin(u * 5 + i) * 5, wy - 30 - u * 34);
        icon('note', x, y, Math.round(cam.z * 2) * 8, Math.sin(Math.PI * Math.min(1, u * 1.15)) * live);
      }
    });
    kinetic('DANCE TOGETHER', W / 2, topY + (PORTRAIT ? 150 : 96) * U, (PORTRAIT ? 118 : 98) * U, t, T.dance, { color: WHITE, shadow: '#000000cc', stagger: 0.04, dur: 0.5, out: T.dance2 - b(0.75) });
    caption('EVERYONE NEARBY KEEPS THE SAME BEAT', W / 2, topY + (PORTRAIT ? 220 : 160) * U, 26 * U, prog(t, T.dance + b(1.2), T.dance + b(1.7)) * (1 - prog(t, T.dance2 - b(0.75), T.dance2 - b(0.4))));
    // the name of each dance slams in as the floor changes to it
    DANCE_NAMES.forEach((name, k) => {
      const t0 = DANCE_AT[k] + (k === 0 ? b(2) : 0);
      const t1 = k < 2 ? DANCE_AT[k + 1] - b(0.25) : T.danceOut;
      if (t < t0 || t > t1 + 0.3) return;
      const p = outBack(prog(t, t0, t0 + 0.22), 2.4);
      const o = inCubic(prog(t, t1, t1 + 0.25));
      const col = ['#ff8fd8', TEAL, GOLD][k];
      if (crossed(t, t0)) {
        burst(W / 2, lowY - 30 * U, 46, 900, [col, '#ffffff'], 8, 900, 0.9);
        fx.shake = 0.45;
      }
      speedLines(W / 2, lowY - 30 * U, (1 - prog(t, t0, t0 + 0.3)) * 0.7, col, false, 40 + k);
      g.save();
      g.translate(W / 2, lowY - 30 * U);
      g.scale(p * (1 - o), p * (1 - o));
      g.globalAlpha = 1 - o;
      const big = (PORTRAIT ? 170 : 140) * U;
      font(big);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#000000bb';
      g.fillText(name, 8 * U, 10 * U);
      g.fillStyle = col;
      g.fillText(name, 0, 0);
      font(26 * U, BODY);
      g.fillStyle = '#ffffff';
      g.fillText(`DANCE ${k + 1} OF 3`, 0, big * 0.52);
      g.restore();
    });
    caption('DAY · NIGHT · RAIN: THE LOBBY LIVES LIKE THE ISLAND', W / 2, topY + (PORTRAIT ? 150 : 96) * U, 28 * U, prog(t, T.rain + b(0.5), T.rain + b(1.1)) * (1 - prog(t, T.danceOut, T.danceOut + 0.3)));
    for (const at of T.bolts) flash(0.5 * (1 - prog(t, at, at + 0.18)) * (t >= at ? 1 : 0), '220,235,255');
  }

  /* ---- tipping ---- */
  tagCard('gift', 'TIP A FRIEND', 'TAP A MINER · SEND SOL, ORE OR SKR TO THEIR WALLET', t, T.tips, T.tipsOut);
  if (t >= T.tips && t < T.tour + 0.2) {
    const ayu = L.peers.get(CAST[0].id);
    const from = onTown(L.me.x, L.me.y - 16);
    const to = ayu ? onTown(ayu.x, ayu.y - 16) : from;
    const COINS: [string, string, string, string][] = [[SOLG, '#0a3a28', 'SOL', '+0.05 SOL'], ['#e9edf7', '#3b4460', 'ORE', '+0.01 ORE'], [SKR, '#3d5a14', 'SKR', '+50 SKR']];
    // a tap on the friend opens the tip
    ring(...to, t, T.tips + b(0.5), 0.5, 120, TEAL, 8);
    T.tipCoins.forEach((land, k) => {
      const p = prog(t, land - 0.42, land);
      const [col, rim, lab, amt] = COINS[k];
      if (p > 0 && p < 1) tokenCoin(lerp(from[0], to[0], p), lerp(from[1], to[1], p) - Math.sin(p * Math.PI) * 190 * U, 34 * U, col, rim, lab);
      if (crossed(t, land)) burst(to[0], to[1], 26, 700, [col, '#ffffff'], 7, 900, 0.8);
      ring(to[0], to[1], t, land, 0.45, 110, col, 8);
      // the amount lifts off where the coin landed
      const f = prog(t, land, land + b(1.6));
      if (f > 0 && f < 1) {
        g.save();
        g.globalAlpha = 1 - inCubic(f);
        font(54 * U);
        g.textAlign = 'center';
        g.fillStyle = '#000000aa';
        const ax = to[0] + (k - 1) * 150 * U;
        const ay = to[1] - (130 + (k % 2) * 60) * U - outCubic(f) * 110 * U;
        g.fillText(amt, ax + 4 * U, ay + 5 * U);
        g.fillStyle = col;
        g.fillText(amt, ax, ay);
        g.restore();
      }
    });
  }

  /* ---- the tour ---- */
  tagCard('star', 'WALK ANYWHERE', 'TAP, DRAG OR USE THE STICK · EVERY DOOR IS A PLACE', t, T.tour, T.tourOut, PORTRAIT ? undefined : W * 0.42);
  if (t >= T.tour && t < T.cave + 0.3) {
    const STOPS: [string, string][] = [
      ['GEAR MARKET', 'PICKS · HATS · OUTFITS · PETS'],
      ['THE PIER', 'WALK ON BOARD TO GALI ISLAND AND MINE ORE'],
      ['THE GAMES ROW', 'THREE MINI GAMES, COMING UP'],
      ['THE CAVE', 'CAVE RUN: A MINI GAME FOR XP'],
    ];
    STOPS.forEach(([name, sub], k) => {
      const t0 = T.stops[k] + b(0.75);
      const t1 = T.stops[k] + b(1.8);
      if (t < t0 - 0.05 || t > t1 + 0.4) return;
      kinetic(name, W / 2, lowY, (PORTRAIT ? 120 : 104) * U, t, t0, { color: GOLD, shadow: '#000000cc', stagger: 0.03, dur: 0.35, out: t1 });
      caption(sub, W / 2, lowY + 64 * U, 27 * U, prog(t, t0 + 0.2, t0 + 0.4) * (1 - prog(t, t1, t1 + 0.2)));
    });
    // whip lines on each pan
    for (const at of T.stops) {
      const k = Math.sin(Math.PI * prog(t, at, at + b(0.9)));
      if (k > 0.02) {
        g.save();
        g.globalAlpha = k * 0.5;
        g.fillStyle = '#ffffff';
        for (let i = 0; i < 26; i++) {
          const y = hash(i * 3.1 + at) * H;
          const span = W * 1.4;
          const x = ((((hash(i * 7.7 + at) * span - t * W * 3.2) % span) + span) % span) - W * 0.2;
          g.fillRect(x, y, (120 + hash(i) * 380) * U, (2 + hash(i * 2) * 4) * U);
        }
        g.restore();
      }
    }
    // into the cave mouth
    if (t >= T.caveIn) speedLines(W / 2, H / 2, prog(t, T.caveIn, T.cave), '#ffffff', true, 51);
  }

  /* ---- the games row ---- */
  if (t >= T.caveExit && t < T.tunnel + 0.4) {
    const sz = (PORTRAIT ? 64 : 48) * U;
    kinetic('THREE WAYS TO PLAY TOGETHER', W / 2, topY + sz, sz * 0.55, t, T.games + b(0.25), { fam: BODY, color: '#c9d4ff', spacing: 0.25, out: T.gamesOut, shadow: '#000000aa' });
    kinetic('MINI GAMES', W / 2, topY + sz * 2.4, sz * 2.2, t, T.games + b(0.5), { color: GOLD, shadow: '#000000dd', stagger: 0.05, out: T.gamesOut + 0.05 });
    const a = prog(t, T.games + b(1.5), T.games + b(2)) * (1 - prog(t, T.gamesOut, T.gamesOut + 0.25));
    caption('STAKE ORE OR SKR · A NEW ROUND EVERY 40 SECONDS', W / 2, lowY, 30 * U, a, '#ffffff');
    caption('ONE SHARED ROUND FOR THE WHOLE LOBBY', W / 2, lowY + 62 * U, 26 * U, a * prog(t, T.games + b(2), T.games + b(2.5)));
    // each pavilion takes a ring on its own beat
    ([[27.5, 40, '#ff9a3d'], [36.5, 40, '#ffcf4a'], [45.5, 40, '#3de0c8']] as [number, number, string][]).forEach(([tx, ty, col], k) => ring(...onTownTile(tx - 0.5, ty), t, T.games + b(1 + k * 0.5), 0.6, 260, col, 10));
  }
  void MUTED;
  void inExpo;
  void outExpo;
  void rr;
}
