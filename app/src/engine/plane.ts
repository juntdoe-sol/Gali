/**
 * Now and then a little prop plane crosses the sky over the island towing a banner:
 * "CHASE THE MOTHERLODE", "GMINER!" or "GALI MORNING". Pure decoration, drawn in map pixels.
 */
import { text, textWidth, type Ctx } from './art';

export const BANNERS = ['CHASE THE MOTHERLODE', 'GMINER!', 'GALI MORNING'];

// facing right, one character = one map pixel
const ART = [
  'TT..................',
  'TTT.........WWW.....',
  'TTTT.......WWWW.....',
  '.BBBBBBBBBBBBBBCC..P',
  '.BBBBBBBBBBBBBBBBB.P',
  '..DBBBBBBBBBBBBBBBNP',
  '...DDDDDDDDDDDDDDD.P',
  '...........WWWW.....',
  '............K..K....',
];
const COL: Record<string, string> = { T: '#e04848', W: '#c0392b', B: '#f4f1e8', C: '#5ec8ff', D: '#8a93a8', P: '#cfd6e6', N: '#5a6275', K: '#2a2f3d' };
const Z = 2; // map px per art pixel
const PW = ART[0].length * Z;
const GAP_MIN = 100_000; // ms between flights
const GAP_MAX = 220_000;
const SPEED = 24; // map px a second

interface Flight { x: number; y: number; dir: 1 | -1; msg: string }

export class BannerPlane {
  private flight: Flight | null = null;
  private next = performance.now() + 25_000; // the first one comes soon after you land
  private last = -1;

  /** fx, fy, fw, fh: the part of the map the camera frames (the island). */
  draw(c: Ctx, OX: number, OY: number, S: number, now: number, dt: number, fx: number, fy: number, fw: number, fh: number) {
    if (!this.flight) {
      if (now < this.next) return;
      let k = Math.floor(Math.random() * BANNERS.length);
      if (k === this.last) k = (k + 1) % BANNERS.length;
      this.last = k;
      const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
      const tow = textWidth(BANNERS[k]) + 30;
      this.flight = { x: dir > 0 ? fx - PW - tow - 20 : fx + fw + tow + 20, y: fy + 12 + Math.random() * fh * 0.3, dir, msg: BANNERS[k] };
    }
    const f = this.flight;
    f.x += SPEED * f.dir * dt;
    const tw = textWidth(f.msg);
    if ((f.dir > 0 && f.x > fx + fw + 40) || (f.dir < 0 && f.x < fx - tw - 60 - PW)) {
      this.flight = null;
      this.next = now + GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN);
      return;
    }
    const px = (n: number) => Math.round(n * S);
    const bob = Math.round(Math.sin(now / 600) * 1.5);
    const y0 = f.y + bob;
    // the plane (x is its nose for dir 1, its tail for dir -1 mirrored)
    const left = f.dir > 0 ? f.x - PW : f.x;
    const spin = Math.floor(now / 60) % 2;
    const aw = ART[0].length;
    for (let r = 0; r < ART.length; r++)
      for (let i = 0; i < aw; i++) {
        const ch = ART[r][f.dir > 0 ? i : aw - 1 - i];
        if (ch === '.') continue;
        if (ch === 'P' && (r + spin) % 2 === 1) continue; // the propeller flickers
        c.fillStyle = COL[ch];
        c.fillRect(OX + px(left + i * Z), OY + px(y0 + r * Z), Math.ceil(S * Z), Math.ceil(S * Z));
      }
    // the tow rope and the banner behind the tail
    const bw = tw + 6;
    const bh = 9;
    const ry = y0 + 4 * Z; // the rope leaves the tail at body height
    const tail = f.dir > 0 ? left : left + PW;
    const rope = 10;
    const bx = f.dir > 0 ? tail - rope - bw : tail + rope;
    const by = ry - 2;
    c.fillStyle = '#d8d2c0';
    for (let i = 0; i < rope; i += 2) c.fillRect(OX + px(f.dir > 0 ? tail - i - 1 : tail + i), OY + px(ry + i / 6), Math.ceil(S), Math.ceil(S));
    // banner cloth with a red border, its far edge flapping
    const flap = Math.sin(now / 140) > 0 ? 1 : 0;
    c.fillStyle = '#c0392b';
    c.fillRect(OX + px(bx - 1), OY + px(by - 1), px(bw + 2), px(bh + 2));
    c.fillStyle = '#fff4d6';
    c.fillRect(OX + px(bx), OY + px(by), px(bw), px(bh));
    const far = f.dir > 0 ? bx - 3 : bx + bw + 1;
    c.fillStyle = '#c0392b';
    c.fillRect(OX + px(far), OY + px(by + flap), px(2), px(bh - 2 * flap + 1));
    text(c, f.msg, OX + px(bx + 3), OY + px(by + 2), S, '#7a1d12');
  }
}
