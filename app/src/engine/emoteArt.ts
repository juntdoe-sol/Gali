/**
 * Emotes: a small speech bubble over a miner with a pixel picture in it. It pops in, wobbles a little and
 * fades out. Pure drawing: the arena calls it with the bubble's bottom middle on screen.
 */
import { text, textWidth, type Ctx } from './art';
import type { Emote } from '../game/arenaMap';

const PAL: Record<string, string> = {
  K: '#1a0c10',
  Y: '#ffd24a',
  R: '#e8323e',
  W: '#f2f5ff',
  H: '#f2c99a',
  P: '#ff8aa0',
};
/** 9 wide, 8 tall; '.' is see-through */
const ART: Partial<Record<Emote, string[]>> = {
  wave: ['.H.H.H...', '.H.H.H.H.', '.HHHHHHH.', '.HHHHHHH.', 'HHHHHHHH.', '.HHHHHHH.', '..HHHHH..', '...HHH...'],
  laugh: ['..YYYYY..', '.YYYYYYY.', 'YYKYYYKYY', 'YKYKYKYKY', 'YYYYYYYYY', 'YKKKKKKKY', '.YKPPPKY.', '..YYYYY..'],
  angry: ['..RRRRR..', '.RRRRRRR.', 'RKKRRRKKR', 'RRWKRKWRR', 'RRRRRRRRR', 'RRKKKKKRR', '.RKRRRKR.', '..RRRRR..'],
  heart: ['.RR...RR.', 'RRRR.RRRR', 'RRWRRRRRR', 'RRRRRRRRR', '.RRRRRRR.', '..RRRRR..', '...RRR...', '....R....'],
  skull: ['..WWWWW..', '.WWWWWWW.', 'WWWWWWWWW', 'WKKWWWKKW', 'WKKWWWKKW', 'WWWWKWWWW', '.WWWWWWW.', '..WKWKW..'],
};

/** Draw emote `e` with the bubble's bottom middle at (X, Y) screen px; `z` screen px per map px. */
export function drawEmote(c: Ctx, e: Emote, X: number, Y: number, z: number, age: number, total: number) {
  const pop = age < 120 ? 0.6 + (0.4 * age) / 120 : 1;
  const fade = age > total - 400 ? Math.max(0, (total - age) / 400) : 1;
  const p = Math.max(1, Math.round(z * pop));
  const bw = 13;
  const bh = 12;
  const x0 = Math.round(X - (bw * p) / 2);
  const y0 = Math.round(Y - (bh + 2) * p);
  c.save();
  c.globalAlpha = fade;
  // the bubble, with its tail pointing down at the miner
  c.fillStyle = PAL.K;
  c.fillRect(x0 - p, y0, (bw + 2) * p, bh * p);
  c.fillRect(x0, y0 - p, bw * p, (bh + 2) * p);
  c.fillStyle = PAL.W;
  c.fillRect(x0, y0, bw * p, bh * p);
  c.fillStyle = PAL.K;
  c.fillRect(Math.round(X - p), y0 + bh * p, 3 * p, p);
  c.fillRect(Math.round(X), y0 + (bh + 1) * p, p, p);
  c.fillStyle = PAL.W;
  c.fillRect(Math.round(X), y0 + bh * p - p, p, 2 * p);
  if (e === 'gg') {
    const sc = p;
    const w = textWidth('GG') * sc;
    text(c, 'GG', Math.round(X - w / 2), y0 + 3 * p, sc, '#2f5fd0');
  } else {
    const art = ART[e];
    if (art) {
      // the wave waggles side to side; the laugh bounces
      const dx = e === 'wave' ? (Math.floor(age / 140) % 2 ? p : -p) : 0;
      const dy = e === 'laugh' ? (Math.floor(age / 110) % 2) * -p : 0;
      art.forEach((row, j) => {
        for (let i = 0; i < row.length; i++) {
          const col = PAL[row[i]];
          if (!col) continue;
          c.fillStyle = col;
          c.fillRect(x0 + (2 + i) * p + dx, y0 + (2 + j) * p + dy, p, p);
        }
      });
    }
  }
  c.restore();
}
