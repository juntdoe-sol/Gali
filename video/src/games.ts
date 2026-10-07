/**
 * The three mini games, explained in motion.
 *
 * Each game gets a glass card over the lobby, in the look of the game window in the app: the round clock, the
 * choice, the stake chips. The card then plays one round in a few seconds so the rule is plain: what you pick,
 * what happens, who gets paid. The numbers on screen follow the real rules (5% fee, survivors split the collapsed
 * tunnel, the pot goes to one ticket, a cash-out pays stake times the multiplier).
 */
import {
  b, BEAT, BODY, GOLD, H, PORTRAIT, U, W, WHITE,
  burst, caption, clamp01, crossed, flash, font, fx, g, glass, hash, icon, inCubic, inExpo, kinetic, lerp, outBack, outCubic, outElastic, outExpo, prog, ring, rr, textW,
} from './kit';
import { T } from './timeline';

const CW = 820;
const CH = 1000;
const EDGE = 'rgba(255,255,255,0.16)';
const IN = 'rgba(255,255,255,0.07)';
const MUTE = '#9fb0e8';
const GREEN = '#4be38a';
const RED = '#ff4d5e';

interface Frame {
  cx: number;
  cy: number;
  k: number;
}
function frame(): Frame {
  if (PORTRAIT) return { cx: W / 2, cy: H * 0.535, k: (W * 0.86) / CW };
  const k = (H * 0.9) / CH;
  return { cx: W - 70 * U - (CW * k) / 2, cy: H / 2, k };
}
/** A point inside the card, on the video frame. */
const toScreen = (f: Frame, x: number, y: number): [number, number] => [f.cx + (x - CW / 2) * f.k, f.cy + (y - CH / 2) * f.k];

function txt(s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left', fam = BODY) {
  font(size, fam);
  g.textAlign = align;
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.fillText(s, x, y);
}
function pill(x: number, y: number, w: number, h: number, fill: string, edge = EDGE, lw = 3) {
  rr(x, y, w, h, h / 2);
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = lw;
  g.strokeStyle = edge;
  g.stroke();
}
function finger(x: number, y: number, press: boolean, a: number) {
  if (a <= 0) return;
  g.save();
  g.globalAlpha = a;
  g.fillStyle = '#ffffffdd';
  g.strokeStyle = '#070d20';
  g.lineWidth = 5;
  g.beginPath();
  g.arc(x, y, press ? 24 : 32, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  g.restore();
}
/** Where the finger is: it glides between the things it taps, and dips on each tap. */
function fingerAt(u: number, stops: [number, number, number][]): { x: number; y: number; press: boolean; a: number } {
  let i = stops.findIndex((s) => u < s[0]);
  if (i < 0) i = stops.length;
  const to = stops[Math.min(i, stops.length - 1)];
  const from = i === 0 ? ([to[0] - 0.7, to[1] + 180, to[2] + 260] as [number, number, number]) : stops[i - 1];
  const e = i >= stops.length ? 1 : clamp01((u - from[0] - 0.12) / Math.max(0.01, to[0] - from[0] - 0.2));
  const k = e < 0.5 ? 4 * e * e * e : 1 - Math.pow(-2 * e + 2, 3) / 2;
  const press = stops.some((s) => u >= s[0] - 0.12 && u < s[0] + 0.2);
  const lastT = stops[stops.length - 1][0];
  return { x: lerp(from[1], to[1], k), y: lerp(from[2], to[2], k), press, a: prog(u, stops[0][0] - 0.7, stops[0][0] - 0.4) * (1 - prog(u, lastT + 0.4, lastT + 0.8)) };
}

/* ---------------- the parts every game window shares ---------------- */
const CHIPS = ['0.01', '0.05', '0.1'];
const U_CHIP = 1.25;
const U_STAKE = 1.75;
const U_CLOSE = 3.5;
const U_REVEAL = 4;
const U_OUT = 7.25;
const CHIP_AT: [number, number] = [CW / 2, 824];
const STAKE_AT: [number, number] = [CW / 2, 928];

function header(name: string, line: string, color: string, ic: string) {
  rr(24, 24, 100, 100, 22);
  g.fillStyle = IN;
  g.fill();
  g.lineWidth = 4;
  g.strokeStyle = color;
  g.stroke();
  icon(ic, 74, 74, 80);
  txt(name, 146, 58, 62, color, 'left', 'Jersey15');
  txt(line, 148, 104, 25, MUTE);
  // the ORE and SKR tables
  const tw = (CW - 48 - 14) / 2;
  rr(24, 146, tw, 62, 18);
  g.fillStyle = color;
  g.fill();
  txt('ORE TABLE', 24 + tw / 2, 178, 26, '#10162c', 'center');
  rr(24 + tw + 14, 146, tw, 62, 18);
  g.fillStyle = IN;
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = EDGE;
  g.stroke();
  txt('SKR TABLE', 24 + tw + 14 + tw / 2, 178, 26, WHITE, 'center');
}
function roundClock(u: number, color: string) {
  const open = u < U_CLOSE;
  const k = clamp01(u / U_REVEAL);
  rr(24, 226, CW - 48, 118, 22);
  g.fillStyle = IN;
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = open ? color : EDGE;
  g.stroke();
  txt(open ? 'STAKES OPEN' : u < U_REVEAL ? 'STAKES CLOSED' : 'ROUND SETTLED', 48, 264, 26, open ? GREEN : u < U_REVEAL ? RED : MUTE);
  const left = Math.max(0, Math.ceil(40 * (1 - k)));
  txt(`${left}s`, CW - 48, 264, 58, open ? color : MUTE, 'right', 'Jersey15');
  const sw = (CW - 96 - 19 * 6) / 20;
  for (let i = 0; i < 20; i++) {
    const on = (i + 1) / 20 <= k + 0.0001;
    const late = (i + 0.5) / 20 >= U_CLOSE / U_REVEAL;
    rr(48 + i * (sw + 6), 300, sw, 18, 6);
    g.fillStyle = on ? (late ? RED : color) : 'rgba(255,255,255,0.12)';
    g.fill();
  }
}
function stakeRow(u: number, color: string) {
  const dim = u >= U_REVEAL ? 0.3 : 1;
  g.save();
  g.globalAlpha *= dim;
  const w = (CW - 48 - 28) / 3;
  CHIPS.forEach((c, i) => {
    const sel = i === 1 && u >= U_CHIP;
    const pop = sel ? 1 + 0.12 * (1 - outElastic(prog(u, U_CHIP, U_CHIP + 0.9))) : 1;
    const x = 24 + i * (w + 14);
    g.save();
    g.translate(x + w / 2, 824);
    g.scale(pop, pop);
    if (sel) {
      g.shadowColor = color;
      g.shadowBlur = 26;
    }
    pill(-w / 2, -40, w, 80, sel ? color : IN, sel ? '#ffffff' : EDGE, 4);
    g.shadowBlur = 0;
    txt(c, 0, -8, 44, sel ? '#10162c' : WHITE, 'center', 'Jersey15');
    txt('ORE', 0, 22, 17, sel ? '#10162c' : MUTE, 'center');
    g.restore();
  });
  // the stake button
  const done = u >= U_STAKE;
  const press = 1 - 0.06 * (1 - prog(u, U_STAKE, U_STAKE + 0.25)) * (done ? 1 : 0);
  g.save();
  g.translate(CW / 2, 928);
  g.scale(press, press);
  rr(-(CW - 48) / 2, -44, CW - 48, 88, 26);
  const gr = g.createLinearGradient(0, -44, 0, 44);
  if (done) {
    gr.addColorStop(0, '#1d3f36');
    gr.addColorStop(1, '#12302a');
  } else {
    gr.addColorStop(0, '#fff2b8');
    gr.addColorStop(0.5, GOLD);
    gr.addColorStop(1, '#e08a1e');
  }
  g.fillStyle = gr;
  g.fill();
  if (done) {
    g.lineWidth = 3;
    g.strokeStyle = GREEN;
    g.stroke();
    icon('check', -150, 0, 48);
    txt('STAKED 0.05 ORE', 14, 2, 40, GREEN, 'center', 'Jersey15');
  } else txt(u >= U_CHIP ? 'STAKE 0.05 ORE' : 'STAKE', 0, 2, 44, '#3a1800', 'center', 'Jersey15');
  g.restore();
  g.restore();
}

/** Open a game window: everything `body` draws is in the card's own 820 x 1000 space. */
function card(t: number, t0: number, color: string, body: (u: number, f: Frame) => void) {
  const u = (t - t0) / BEAT;
  if (u < -0.05 || u > 8) return;
  const f = frame();
  const p = outBack(prog(u, 0, 0.7), 1.3);
  const o = inExpo(prog(u, U_OUT, U_OUT + 0.7));
  if (p <= 0 || o >= 1) return;
  g.save();
  g.globalAlpha = clamp01(p * 1.6) * (1 - o);
  g.translate(f.cx, f.cy - o * H * 0.25);
  const sc = f.k * (0.82 + 0.18 * p) * (1 - o * 0.15);
  g.scale(sc, sc);
  g.translate(-CW / 2, -CH / 2);
  glass(0, 0, CW, CH, 34, color, 'rgba(10,16,40,0.8)', color + 'aa');
  body(u, f);
  g.restore();
}

/** The rule, in big type: above the card on a phone, beside it on a wide screen. */
function headline(t: number, t0: number, n: number, lines: string[], color: string, after: string) {
  const t1 = t0 + b(U_OUT);
  const colW = PORTRAIT ? W * 0.92 : W - CW * frame().k - 70 * U - 120 * U;
  const cx = PORTRAIT ? W / 2 : 60 * U + colW / 2;
  const top = PORTRAIT ? 250 * U : H * 0.3;
  // a tag: which game of the three
  const a = prog(t, t0 + 0.05, t0 + 0.3) * (1 - prog(t, t1, t1 + 0.25));
  if (a > 0) {
    g.save();
    g.globalAlpha = a;
    font(24 * U, BODY);
    const label = `MINI GAME ${n} OF 3`;
    const pw = g.measureText(label).width + 40 * U;
    rr(cx - pw / 2, top - 26 * U, pw, 46 * U, 23 * U);
    g.fillStyle = color;
    g.fill();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#10162c';
    g.fillText(label, cx, top - 2 * U);
    g.restore();
  }
  const rows = PORTRAIT ? [lines.join(' ')] : lines;
  let size = (PORTRAIT ? 78 : 118) * U;
  for (const r of rows) size = Math.min(size, (size * colW) / Math.max(colW, textW(r, size)));
  rows.forEach((r, i) => kinetic(r, cx, top + 44 * U + size * (i + 0.95), size, t, t0 + b(0.25) + i * b(0.5), { color: i === rows.length - 1 ? color : WHITE, shadow: '#000000cc', stagger: 0.025, dur: 0.4, out: t1 + i * 0.04 }));
  const ya = PORTRAIT ? H - 250 * U : top + 44 * U + size * (rows.length + 0.9);
  caption(after, cx, ya, (PORTRAIT ? 27 : 26) * U, prog(t, t0 + b(U_REVEAL + 0.6), t0 + b(U_REVEAL + 1)) * (1 - prog(t, t1, t1 + 0.25)), '#ffffff');
}

/* ---------------- Tunnel Collapse ---------------- */
const T_COL = '#ff9a3d';
const POOLS = [3, 4, 2, 6, 5]; // stakes of 0.05 in each tunnel
const MY_TUNNEL = 1;
const COLLAPSED = 3;
const PIP_COLORS = ['#2f5fd0', '#e0a92a', '#2f9a8a', '#b8456b', '#5b4bc4', '#3a8f4a', '#c94a3a', '#ff7a00'];
const ARCH = (i: number) => ({ x: 28 + i * 156, y: 372, w: 140, h: 236 });
function archPath(i: number) {
  const a = ARCH(i);
  g.beginPath();
  g.moveTo(a.x, a.y + a.h);
  g.lineTo(a.x, a.y + 70);
  g.arc(a.x + 70, a.y + 70, 70, Math.PI, 0);
  g.lineTo(a.x + a.w, a.y + a.h);
  g.closePath();
}
function tunnelBody(u: number, f: Frame) {
  header('TUNNEL COLLAPSE', 'Pick a tunnel. One caves in.', T_COL, 'tunnel');
  roundClock(u, T_COL);
  const revealed = u >= U_REVEAL;
  let seq = 0;
  for (let i = 0; i < 5; i++) {
    const a = ARCH(i);
    const mine = i === MY_TUNNEL && u >= 1;
    const dead = revealed && i === COLLAPSED;
    const safe = revealed && i !== COLLAPSED;
    g.save();
    if (mine || safe) {
      g.shadowColor = safe ? GREEN : T_COL;
      g.shadowBlur = safe ? 18 + 14 * Math.sin(u * 6) : 24;
    }
    archPath(i);
    const gr = g.createLinearGradient(0, a.y, 0, a.y + a.h);
    gr.addColorStop(0, '#07050f');
    gr.addColorStop(1, '#231636');
    g.fillStyle = gr;
    g.fill();
    g.restore();
    // who is in it: one block per stake, stacked from the floor
    g.save();
    archPath(i);
    g.clip();
    for (let n = 0; n < POOLS[i]; n++) {
      const you = i === MY_TUNNEL && n === 1;
      const at = you ? U_STAKE : 0.35 + ((seq * 0.61) % 1) * 2.9 + (seq % 3) * 0.05;
      seq++;
      const p = outBack(prog(u, at, at + 0.35), 2.2);
      if (p <= 0) continue;
      const col = n % 2;
      const row = Math.floor(n / 2);
      const bx = a.x + 28 + col * 46;
      const by = a.y + a.h - 46 - row * 46;
      g.save();
      g.translate(bx + 19, by + 19 - (1 - p) * 60);
      g.scale(p, p);
      rr(-19, -19, 38, 38, 8);
      g.fillStyle = you ? GOLD : PIP_COLORS[(i * 3 + n) % PIP_COLORS.length];
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(-13, -13, 26, 6);
      if (you) {
        g.lineWidth = 4;
        g.strokeStyle = '#ffffff';
        rr(-19, -19, 38, 38, 8);
        g.stroke();
      }
      g.restore();
    }
    // the cave-in: rock drops and fills the tunnel
    if (dead) {
      for (let k = 0; k < 22; k++) {
        const land = U_REVEAL + hash(k * 3.3) * 0.5;
        const p = clamp01((u - land + 0.45) / 0.45);
        if (p <= 0) continue;
        const col2 = k % 3;
        const row2 = Math.floor(k / 3);
        const fy = a.y + a.h - 34 - row2 * 30 + hash(k) * 8;
        const fx2 = a.x + 8 + col2 * 44 + hash(k * 7) * 8;
        const y = lerp(a.y - 80, fy, p * p) - (p >= 1 ? Math.abs(Math.sin((u - land) * 9)) * 10 * Math.max(0, 1 - (u - land) * 2.5) : 0);
        const s = 34 + hash(k * 5) * 14;
        g.fillStyle = ['#6f768a', '#8a5a2e', '#5e3a1e', '#4a4f60'][k % 4];
        g.fillRect(fx2, y, s, s * 0.8);
        g.fillStyle = 'rgba(255,255,255,0.18)';
        g.fillRect(fx2, y, s, 5);
      }
      g.fillStyle = `rgba(255,77,94,${0.22 * prog(u, U_REVEAL, U_REVEAL + 0.3)})`;
      g.fillRect(a.x, a.y, a.w, a.h);
    }
    g.restore();
    // the timber frame
    archPath(i);
    g.lineWidth = 9;
    g.strokeStyle = dead ? RED : safe ? GREEN : mine ? T_COL : '#8a5a2e';
    g.stroke();
    txt(String(i + 1), a.x + 70, a.y + 44, 46, dead ? RED : mine ? T_COL : '#cfd6e6', 'center', 'Jersey15');
    if (mine) {
      const p = outBack(prog(u, 1, 1.4), 2.4);
      g.save();
      g.translate(a.x + 70, a.y - 20);
      g.scale(p, p);
      pill(-44, -18, 88, 36, GOLD, '#ffffff', 3);
      txt('YOU', 0, 1, 20, '#2b1600', 'center');
      g.restore();
    }
    // what is staked in it
    const shown = (() => {
      let n = 0;
      let s2 = 0;
      for (let j = 0; j < i; j++) s2 += POOLS[j];
      for (let k = 0; k < POOLS[i]; k++) {
        const you = i === MY_TUNNEL && k === 1;
        const at = you ? U_STAKE : 0.35 + (((s2 + k) * 0.61) % 1) * 2.9 + ((s2 + k) % 3) * 0.05;
        if (u >= at) n++;
      }
      return n;
    })();
    txt(`${(shown * 0.05).toFixed(2)}`, a.x + 70, a.y + a.h + 30, 26, dead ? RED : WHITE, 'center');
  }
  if (revealed) {
    // CAVED IN, across the tunnel
    const a = ARCH(COLLAPSED);
    const p = outBack(prog(u, U_REVEAL + 0.1, U_REVEAL + 0.45), 2.6);
    g.save();
    g.translate(a.x + 70, a.y + 130);
    g.rotate(-0.16);
    g.scale(p, p);
    rr(-112, -30, 224, 60, 12);
    g.fillStyle = RED;
    g.fill();
    txt('CAVED IN', 0, 2, 44, '#ffffff', 'center', 'Jersey15');
    g.restore();
    // its stakes fly out to the four tunnels still standing
    for (let i = 0; i < 5; i++) {
      if (i === COLLAPSED) continue;
      const d = ARCH(i);
      for (let n = 0; n < 4; n++) {
        const t0 = U_REVEAL + 0.7 + n * 0.12 + i * 0.06;
        const p2 = prog(u, t0, t0 + 0.55);
        if (p2 <= 0 || p2 >= 1) continue;
        const x = lerp(a.x + 70, d.x + 70, p2);
        const y = lerp(a.y + 150, d.y + 150, p2) - Math.sin(p2 * Math.PI) * 120;
        g.fillStyle = GOLD;
        g.fillRect(x - 9, y - 9, 18, 18);
        g.fillStyle = '#fff2b8';
        g.fillRect(x - 9, y - 9, 18, 5);
      }
    }
    // what came back to you
    const ra = prog(u, U_REVEAL + 0.5, U_REVEAL + 0.9);
    g.save();
    g.globalAlpha *= ra;
    rr(24, 664, CW - 48, 100, 22);
    g.fillStyle = 'rgba(75,227,138,0.14)';
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = GREEN;
    g.stroke();
    txt('TUNNEL 4 CAVED IN', 48, 698, 26, RED);
    txt('YOUR TUNNEL HELD', 48, 734, 22, MUTE);
    const pay = 0.0204 * outCubic(prog(u, U_REVEAL + 0.9, U_REVEAL + 2.2));
    txt(`+${pay.toFixed(4)} ORE`, CW - 48, 716, 66, GREEN, 'right', 'Jersey15');
    g.restore();
  }
  stakeRow(u, T_COL);
  const a1 = ARCH(MY_TUNNEL);
  const fg = fingerAt(u, [[1, a1.x + 70, a1.y + 150], [U_CHIP, CHIP_AT[0], CHIP_AT[1]], [U_STAKE, STAKE_AT[0], STAKE_AT[1]]]);
  finger(fg.x, fg.y, fg.press, fg.a);
  void f;
}

/* ---------------- Gold Rush Pot ---------------- */
const P_COL = '#ffcf4a';
const PLAYERS: [string, string][] = [['RAJ', '0.10'], ['AYU', '0.10'], ['MEI', '0.10'], ['TOMI', '0.10'], ['SITI', '0.10'], ['KAI', '0.10'], ['LINA', '0.10'], ['ZACK', '0.10']];
const WIN = 2; // MEI
const slot = (k: number): [number, number] => [k < 4 ? 32 : CW - 32 - 214, 372 + (k % 4) * 68];
const YOU_SLOT: [number, number] = [32, 372 + 4 * 68];
const POT_AT: [number, number] = [CW / 2, 500];
function potBody(u: number, f: Frame) {
  header('GOLD RUSH POT', 'Buy in. One miner strikes gold.', P_COL, 'pot');
  roundClock(u, P_COL);
  const arrive = (k: number) => 0.4 + k * 0.36;
  const revealed = u >= U_REVEAL;
  // the wheel: a light runs round the players and slows onto the winner
  const order = [0, 1, 2, 3, 8, 7, 6, 5, 4]; // 8 is you
  let lit = -1;
  if (u >= U_CLOSE - 0.5 && !revealed) {
    const k = prog(u, U_CLOSE - 0.5, U_REVEAL);
    const steps = Math.floor((1 - Math.pow(1 - k, 2.2)) * (order.length * 3 + order.indexOf(WIN)));
    lit = order[steps % order.length];
  } else if (revealed) lit = WIN;
  let pot = 0;
  const chip = (k: number, name: string, amt: string, x: number, y: number, at: number, you = false) => {
    const p = outBack(prog(u, at, at + 0.35), 2);
    if (p <= 0) return;
    pot += Number(amt);
    const on = lit === k;
    const won = revealed && k === WIN;
    g.save();
    g.translate(x + 107, y + 28);
    g.scale(p * (won ? 1 + 0.1 * (1 - outElastic(prog(u, U_REVEAL, U_REVEAL + 0.9))) : 1), p);
    if (on) {
      g.shadowColor = P_COL;
      g.shadowBlur = 30;
    }
    pill(-107, -28, 214, 56, won ? P_COL : on ? 'rgba(255,207,74,0.35)' : you ? 'rgba(255,207,74,0.16)' : IN, on || you ? P_COL : EDGE, on ? 5 : 3);
    g.shadowBlur = 0;
    g.globalAlpha *= revealed && !won ? (you ? 1 - prog(u, U_REVEAL, U_REVEAL + 0.3) : 0.5) : 1;
    txt(name, -84, 1, 24, won ? '#2b1600' : you ? P_COL : WHITE);
    txt(amt, 84, 1, 24, won ? '#2b1600' : P_COL, 'right');
    g.restore();
    // its stake drops into the pot
    const c = prog(u, at + 0.1, at + 0.5);
    if (c > 0 && c < 1) {
      const cx = lerp(x + 107, POT_AT[0], c);
      const cy = lerp(y + 28, POT_AT[1] - 60, c) - Math.sin(c * Math.PI) * 90;
      g.fillStyle = '#d9961e';
      g.beginPath();
      g.arc(cx, cy, 15, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = P_COL;
      g.beginPath();
      g.arc(cx - 2, cy - 2, 11, 0, Math.PI * 2);
      g.fill();
    }
  };
  PLAYERS.forEach(([n, a], k) => chip(k, n, a, ...slot(k), arrive(k)));
  chip(8, 'YOU', '0.05', ...YOU_SLOT, U_STAKE, true);
  // the pot swells a little with every stake
  const bumps = [...PLAYERS.map((_, k) => arrive(k) + 0.5), U_STAKE + 0.5];
  let bump = 0;
  for (const at of bumps) bump = Math.max(bump, 1 - prog(u, at, at + 0.3));
  const glow = revealed ? 1 : 0;
  g.save();
  g.translate(POT_AT[0], POT_AT[1]);
  const ps = 1 + 0.07 * bump + 0.1 * glow * (1 - outElastic(prog(u, U_REVEAL, U_REVEAL + 0.9)));
  g.scale(ps, ps);
  if (revealed) {
    g.shadowColor = P_COL;
    g.shadowBlur = 50;
  }
  icon('pot', 0, 0, 208);
  g.restore();
  txt('IN THE POT', POT_AT[0], 384, 20, MUTE, 'center');
  txt(`${pot.toFixed(2)} ORE`, POT_AT[0], 632, 56, P_COL, 'center', 'Jersey15');
  if (u >= U_STAKE + 0.3 && !revealed) {
    g.save();
    g.globalAlpha *= prog(u, U_STAKE + 0.3, U_STAKE + 0.6);
    txt('YOUR STAKE IS 6% OF THE TICKETS', CW - 34, 676, 18, MUTE, 'right');
    g.restore();
  }
  if (revealed) {
    const [wx, wy] = slot(WIN);
    for (let n = 0; n < 10; n++) {
      const t0 = U_REVEAL + 0.25 + n * 0.07;
      const c = prog(u, t0, t0 + 0.5);
      if (c <= 0 || c >= 1) continue;
      const cx = lerp(POT_AT[0], wx + 107, c);
      const cy = lerp(POT_AT[1] - 40, wy + 28, c) - Math.sin(c * Math.PI) * 110;
      g.fillStyle = P_COL;
      g.beginPath();
      g.arc(cx, cy, 13, 0, Math.PI * 2);
      g.fill();
    }
    const ra = prog(u, U_REVEAL + 0.3, U_REVEAL + 0.7);
    g.save();
    g.globalAlpha *= ra;
    rr(24, 664, CW - 48, 100, 22);
    g.fillStyle = 'rgba(255,207,74,0.14)';
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = P_COL;
    g.stroke();
    icon('trophy', 76, 714, 64);
    txt('MEI TAKES THE POT', 124, 698, 28, WHITE);
    txt('0.85 ORE MINUS THE 5% FEE', 124, 734, 20, MUTE);
    const pay = 0.8075 * outCubic(prog(u, U_REVEAL + 0.7, U_REVEAL + 2.1));
    txt(`${pay.toFixed(4)} ORE`, CW - 48, 716, 60, P_COL, 'right', 'Jersey15');
    g.restore();
  }
  stakeRow(u, P_COL);
  const fg = fingerAt(u, [[U_CHIP, CHIP_AT[0], CHIP_AT[1]], [U_STAKE, STAKE_AT[0], STAKE_AT[1]]]);
  finger(fg.x, fg.y, fg.press, fg.a);
  void f;
}

/* ---------------- Crash Cart ---------------- */
const C_COL = '#3de0c8';
const TARGETS = ['1.2x', '1.5x', '2.0x', '3.0x', '5.0x', '10x'];
const MY_TARGET = 2;
const U_GO = 4;
const U_CASH = 5.25;
const U_CRASH = 6.25;
const RATE = Math.log(2) / (U_CASH - U_GO);
const mult = (u: number) => Math.exp(RATE * (Math.min(u, U_CRASH) - U_GO));
const CRASH_AT = mult(U_CRASH); // 3.48x
const CX0 = 100;
const CX1 = 760;
const yOf = (m: number) => 726 - ((m - 1) / 3) * 240;
const xOf = (u: number) => CX0 + ((u - U_GO) / (U_CRASH - U_GO + 0.15)) * (CX1 - CX0);
function crashBody(u: number, f: Frame) {
  header('CRASH CART', 'Pick a cash-out. Beat the crash.', C_COL, 'cart');
  roundClock(u, C_COL);
  // the cash-out you choose before the round
  const tw = (CW - 48 - 5 * 10) / 6;
  TARGETS.forEach((tg, i) => {
    const sel = i === MY_TARGET && u >= 0.75;
    const x = 24 + i * (tw + 10);
    g.save();
    if (sel) {
      g.shadowColor = C_COL;
      g.shadowBlur = 22;
    }
    rr(x, 362, tw, 62, 16);
    g.fillStyle = sel ? 'rgba(61,224,200,0.3)' : IN;
    g.fill();
    g.lineWidth = sel ? 4 : 3;
    g.strokeStyle = sel ? C_COL : EDGE;
    g.stroke();
    g.restore();
    txt(tg, x + tw / 2, 394, 34, sel ? C_COL : WHITE, 'center', 'Jersey15');
  });
  // the chart
  rr(24, 440, CW - 48, 324, 22);
  g.fillStyle = 'rgba(0,0,0,0.28)';
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = EDGE;
  g.stroke();
  for (const m of [1, 2, 3, 4]) {
    g.fillStyle = 'rgba(255,255,255,0.1)';
    g.fillRect(CX0 - 10, yOf(m), CX1 - CX0 + 20, 2);
    txt(`${m}x`, CX0 - 22, yOf(m), 20, MUTE, 'right');
  }
  const going = u >= U_GO;
  const cashed = u >= U_CASH;
  const crashed = u >= U_CRASH;
  // your line
  if (u >= 0.75) {
    const a = prog(u, 0.75, 1.1);
    g.save();
    g.globalAlpha *= a;
    g.setLineDash([14, 10]);
    g.lineWidth = 4;
    g.strokeStyle = cashed ? GREEN : GOLD;
    g.beginPath();
    g.moveTo(CX0 - 10, yOf(2));
    g.lineTo(CX1 + 10, yOf(2));
    g.stroke();
    g.setLineDash([]);
    if (!cashed) {
      font(20, BODY);
      const lw = g.measureText('YOUR CASH-OUT 2.0x').width + 28;
      pill(CX1 + 10 - lw, yOf(2) - 44, lw, 34, 'rgba(10,16,40,0.9)', GOLD, 3);
      txt('YOUR CASH-OUT 2.0x', CX1 + 10 - lw / 2, yOf(2) - 26, 20, GOLD, 'center');
    }
    g.restore();
  }
  // a friend who wanted more
  if (u >= 2.2) {
    g.save();
    g.globalAlpha *= prog(u, 2.2, 2.6) * (crashed ? 0.9 : 1);
    font(20, BODY);
    const label = crashed ? 'RAJ WANTED 5.0x: STAKE LOST' : 'RAJ IS GOING FOR 5.0x';
    const lw = g.measureText(label).width + 28;
    pill(CX1 + 10 - lw, 454, lw, 34, 'rgba(10,16,40,0.9)', crashed ? RED : '#ff8fd8', 3);
    txt(label, CX1 + 10 - lw / 2, 472, 20, crashed ? RED : '#ff8fd8', 'center');
    g.restore();
  }
  if (!going) {
    txt(u < U_CLOSE ? 'THE CART ROLLS WHEN STAKES CLOSE' : 'HOLD ON…', (CX0 + CX1) / 2, 690, 22, MUTE, 'center');
    icon('cart', CX0 + 30, yOf(1) - 34, 80);
  } else {
    // the climb
    const head = Math.min(u, U_CRASH);
    g.save();
    g.lineWidth = 8;
    g.lineJoin = 'round';
    g.strokeStyle = crashed ? RED : C_COL;
    g.shadowColor = crashed ? RED : C_COL;
    g.shadowBlur = 18;
    g.beginPath();
    for (let v = U_GO; v <= head + 1e-6; v += 0.03) {
      const x = xOf(v);
      const y = yOf(mult(v));
      if (v === U_GO) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.lineTo(xOf(head), yOf(mult(head)));
    g.stroke();
    g.restore();
    const hx = xOf(head);
    const hy = yOf(mult(head));
    if (!crashed) {
      g.save();
      g.translate(hx, hy - 34 + Math.sin(u * 30) * 2);
      g.rotate(-0.18 - (mult(u) - 1) * 0.08);
      icon('cart', 0, 0, 80);
      g.restore();
    } else {
      // the cart goes over
      const d = u - U_CRASH;
      g.save();
      g.globalAlpha *= clamp01(1 - d / 1.4);
      g.translate(hx + d * 70, hy - 34 - d * 160 + d * d * 300);
      g.rotate(d * 5);
      icon('cart', 0, 0, 80);
      g.restore();
    }
    // the multiplier
    const m = mult(u);
    const pop = crashed ? 1 + 0.25 * (1 - outElastic(prog(u, U_CRASH, U_CRASH + 0.9))) : 1;
    g.save();
    g.translate(CX0 + 10, 520);
    g.scale(pop, pop);
    txt(`${m.toFixed(2)}x`, 0, 0, 96, crashed ? RED : C_COL, 'left', 'Jersey15');
    if (crashed) txt('CRASHED', 4, 56, 26, RED);
    g.restore();
    // cashed out
    if (cashed) {
      const p = outBack(prog(u, U_CASH, U_CASH + 0.35), 2.4);
      const cxx = xOf(U_CASH);
      g.save();
      g.translate(cxx, yOf(2));
      g.fillStyle = GREEN;
      g.beginPath();
      g.arc(0, 0, 14, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#ffffff';
      g.lineWidth = 4;
      g.stroke();
      g.translate(0, 64);
      g.scale(p, p);
      font(22, BODY);
      const label = 'CASHED OUT AT 2.0x';
      const lw = g.measureText(label).width + 84;
      pill(-lw / 2 + 60, -44, lw, 88, 'rgba(12,40,32,0.96)', GREEN, 4);
      icon('check', -lw / 2 + 96, 0, 48);
      txt(label, -lw / 2 + 132, -17, 22, GREEN);
      txt('0.10 ORE BACK', -lw / 2 + 132, 15, 36, '#ffffff', 'left', 'Jersey15');
      g.restore();
    }
  }
  stakeRow(u, C_COL);
  const tx = 24 + MY_TARGET * (tw + 10) + tw / 2;
  const fg = fingerAt(u, [[0.75, tx, 394], [U_CHIP, CHIP_AT[0], CHIP_AT[1]], [U_STAKE, STAKE_AT[0], STAKE_AT[1]]]);
  finger(fg.x, fg.y, fg.press, fg.a);
  void f;
}

/* ---------------- how a round can be checked ---------------- */
function sceneFair(t: number) {
  const t0 = T.fair;
  const t1 = T.fairOut;
  if (t < t0 - 0.05 || t > t1 + 0.5) return;
  const u = (t - t0) / BEAT;
  const size = (PORTRAIT ? 70 : 92) * U;
  const topY = PORTRAIT ? 340 * U : 150 * U;
  kinetic('EVERY ROUND CAN BE CHECKED', W / 2, topY, size, t, t0 + b(0.1), { color: WHITE, shadow: '#000000cc', stagger: 0.02, dur: 0.4, out: t1 });
  const pw = PORTRAIT ? W * 0.88 : W * 0.6;
  const rowH = (PORTRAIT ? 190 : 150) * U;
  const y0 = topY + (PORTRAIT ? 90 : 70) * U;
  const o = inExpo(prog(t, t1, t1 + 0.4));
  const ROWS: [string, string, string, string][] = [
    ['1', 'BEFORE THE ROUND', 'THE HOUSE SHOWS A HASH OF ITS SECRET', '481b365da8c0…2e7b44'],
    ['2', 'AFTER THE ROUND', 'IT SHOWS THE SECRET, AND THE DRAW COMES FROM IT', 'c41e9f07b2d6…9a03f1'],
    ['3', 'ANYONE CAN CHECK', 'THE HASH OF THE SECRET MUST MATCH', 'SHA-256(SECRET) = HASH'],
  ];
  ROWS.forEach(([n, title, sub, mono], k) => {
    const at = 0.6 + k * 0.75;
    const p = outExpo(prog(u, at, at + 0.6));
    if (p <= 0) return;
    const x = W / 2 - pw / 2 + (1 - p) * (k % 2 ? 1 : -1) * W * 0.5 + o * (k % 2 ? 1 : -1) * W;
    const y = y0 + k * (rowH + 18 * U);
    g.save();
    g.globalAlpha = clamp01(p * 1.5) * (1 - o);
    const last = k === 2;
    glass(x, y, pw, rowH, 26 * U, last ? GREEN : EDGE, 'rgba(10,16,40,0.82)', last ? GREEN + '88' : undefined);
    // the number
    const tile = rowH - 44 * U;
    rr(x + 22 * U, y + 22 * U, tile, tile, 18 * U);
    g.fillStyle = last ? GREEN : GOLD;
    g.fill();
    if (last) icon('check', x + 22 * U + tile / 2, y + rowH / 2, Math.floor((tile * 0.7) / 16) * 16);
    else txt(n, x + 22 * U + tile / 2, y + rowH / 2 + 4 * U, tile * 0.8, '#2b1600', 'center', 'Jersey15');
    const tx = x + tile + 50 * U;
    txt(title, tx, y + rowH * 0.24, (PORTRAIT ? 36 : 32) * U, last ? GREEN : WHITE);
    let ss = (PORTRAIT ? 22 : 21) * U;
    ss = Math.min(ss, (ss * (pw - tile - 80 * U)) / textW(sub, ss, BODY));
    txt(sub, tx, y + rowH * 0.5, ss, MUTE);
    // the value, in a slot
    font((PORTRAIT ? 26 : 24) * U, BODY);
    const mw = g.measureText(mono).width + 36 * U;
    rr(tx, y + rowH * 0.66, mw, 46 * U, 12 * U);
    g.fillStyle = 'rgba(0,0,0,0.4)';
    g.fill();
    txt(mono, tx + 18 * U, y + rowH * 0.66 + 24 * U, (PORTRAIT ? 26 : 24) * U, last ? GREEN : '#7fe3ff');
    g.restore();
    if (last && crossed(t, t0 + b(at + 0.3))) {
      burst(x + 22 * U + tile / 2, y + rowH / 2, 60, 900, [GREEN, '#ffffff', GOLD], 8, 900, 1);
      fx.shake = 0.4;
    }
  });
  caption('WINNERS ARE PAID FROM THE HOUSE WALLET AUTOMATICALLY · 5% FEE', W / 2, y0 + 3 * (rowH + 18 * U) + 40 * U, (PORTRAIT ? 24 : 25) * U, prog(u, 2.9, 3.2) * (1 - prog(t, t1, t1 + 0.2)));
}

/* ---------------- the scene ---------------- */
const GAMES: { t0: number; n: number; color: string; lines: string[]; after: string; body: (u: number, f: Frame) => void }[] = [
  { t0: T.tunnel, n: 1, color: T_COL, lines: ['PICK A TUNNEL.', 'ONE CAVES IN.'], after: 'THE OTHER FOUR SPLIT ITS STAKES, MINUS A 5% FEE', body: tunnelBody },
  { t0: T.pot, n: 2, color: P_COL, lines: ['BUY IN.', 'ONE MINER', 'TAKES THE POT.'], after: 'A BIGGER STAKE HOLDS MORE TICKETS', body: potBody },
  { t0: T.crash, n: 3, color: C_COL, lines: ['SET A CASH-OUT.', 'BEAT THE CRASH.'], after: 'REACH YOUR CASH-OUT AND WIN STAKE × CASH-OUT', body: crashBody },
];

export function sceneGames(t: number) {
  if (t < T.tunnel - 0.1 || t > T.gear + 0.2) return;
  // the lobby steps back behind the card, as it does in the app
  const dim = prog(t, T.tunnel, T.tunnel + 0.3) * (1 - prog(t, T.shut2, T.gear));
  g.fillStyle = `rgba(3,6,18,${0.5 * dim})`;
  g.fillRect(-60, -60, W + 120, H + 120);
  for (const gm of GAMES) {
    const u = (t - gm.t0) / BEAT;
    if (u < -0.1 || u > 8.2) continue;
    const f = frame();
    headline(t, gm.t0, gm.n, gm.lines, gm.color, gm.after);
    card(t, gm.t0, gm.color, gm.body);
    // the moments that land on a bar
    const at = (uu: number) => gm.t0 + b(uu);
    if (crossed(t, at(U_STAKE))) burst(...toScreen(f, STAKE_AT[0], STAKE_AT[1]), 30, 700, [gm.color, '#ffffff'], 7, 900, 0.7);
    if (gm.n === 1) {
      const a = ARCH(COLLAPSED);
      const [x, y] = toScreen(f, a.x + 70, a.y + 120);
      if (crossed(t, at(U_REVEAL))) {
        burst(x, y, 110, 1200, ['#8a5a2e', '#6f768a', '#cdbfae', '#5e3a1e'], 10, 1500, 1.3);
        fx.shake = 1;
      }
      flash(0.5 * (1 - prog(t, at(U_REVEAL), at(U_REVEAL) + 0.15)) * (t >= at(U_REVEAL) ? 1 : 0), '255,120,90');
      ring(x, y, t, at(U_REVEAL), 0.7, 520, RED, 14);
    }
    if (gm.n === 2) {
      const [x, y] = toScreen(f, POT_AT[0], POT_AT[1]);
      if (crossed(t, at(U_REVEAL))) {
        burst(x, y, 150, 1500, [GOLD, '#fff1a8', '#ffffff', '#e08a1e'], 10, 1200, 1.6);
        fx.shake = 0.9;
      }
      flash(0.6 * (1 - prog(t, at(U_REVEAL), at(U_REVEAL) + 0.14)) * (t >= at(U_REVEAL) ? 1 : 0));
      ring(x, y, t, at(U_REVEAL), 0.8, 620, '#fff1a8', 14);
    }
    if (gm.n === 3) {
      const [x1, y1] = toScreen(f, xOf(U_CASH), yOf(2));
      if (crossed(t, at(U_CASH))) burst(x1, y1, 60, 900, [GREEN, '#ffffff'], 8, 900, 0.9);
      ring(x1, y1, t, at(U_CASH), 0.6, 300, GREEN, 10);
      const [x2, y2] = toScreen(f, xOf(U_CRASH), yOf(CRASH_AT) - 30);
      if (crossed(t, at(U_CRASH))) {
        burst(x2, y2, 130, 1400, [RED, '#ffb060', '#ffffff', '#6f768a'], 10, 1300, 1.3);
        fx.shake = 1;
      }
      flash(0.55 * (1 - prog(t, at(U_CRASH), at(U_CRASH) + 0.15)) * (t >= at(U_CRASH) ? 1 : 0), '255,90,100');
      ring(x2, y2, t, at(U_CRASH), 0.7, 520, RED, 14);
    }
  }
  sceneFair(t);
  void inCubic;
  void hash;
}

/** For the score: when each game's stake, close, reveal and out land. */
export const GAME_BEATS = { chip: U_CHIP, stake: U_STAKE, close: U_CLOSE, reveal: U_REVEAL, out: U_OUT, go: U_GO, cash: U_CASH, crash: U_CRASH };
