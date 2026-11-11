/**
 * The callout card to post on X (1200 x 630), street version: THE CAGE behind, a neon GALI FIGHTCLUB sign, caution
 * tape across the corners reading CALLOUT, a sprayed VS with drips between the two miners, names on strips of tape,
 * and the room code stencilled on a steel plate with the link under it.
 */
import { makeCanvas, ctx2d, text, textWidth, type Ctx } from './art';
import { drawMiner } from './actors';
import type { Look } from './types';
import { WH, WW, WX0, WY0, type Scene } from './fightclubArt';
import { paintGaliLogo, GALI_LOGO } from './fightLogos';

export interface CardInfo {
  me: { name: string; look: Look };
  rival: { name: string; look?: Look | null };
  code: string;
  link: string;
  when?: string | null;
  /** the special move's name and colour, shown under your name */
  special?: { name: string; color: string } | null;
}

export function paintStreetCard(scene: Scene, o: CardInfo): HTMLCanvasElement {
  const W = 1200, H = 630;
  const cv = makeCanvas(W, H);
  const c = ctx2d(cv);
  c.imageSmoothingEnabled = false;
  // the stage behind, zoomed on the ring, darkened at the top and bottom
  const Z = 2.6, cx = 240, cy = 120;
  c.drawImage(scene.cv, W / 2 - (cx - WX0) * Z, H / 2 - (cy - WY0) * Z, WW * Z, WH * Z);
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(8,4,12,0.82)');
  g.addColorStop(0.4, 'rgba(8,4,12,0.3)');
  g.addColorStop(1, 'rgba(8,4,12,0.88)');
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);

  const mid = (s: string, y: number, sc: number, col: string, shadow?: string) => text(c, s, W / 2 - (textWidth(s) * sc) / 2, y, sc, col, shadow);
  // the neon sign: a halo, then the tubes
  const glow = (s: string, y: number, sc: number, col: string, halo: string) => {
    for (const [dx, dy] of [[-3, 0], [3, 0], [0, -3], [0, 3], [-6, 0], [6, 0], [0, -6], [0, 6]] as const) text(c, s, W / 2 - (textWidth(s) * sc) / 2 + dx, y + dy, sc, halo);
    mid(s, y, sc, col);
  };
  const sw = textWidth('FIGHTCLUB') * 7 + 70;
  c.fillStyle = 'rgba(14,8,16,0.92)';
  c.fillRect(W / 2 - sw / 2, 18, sw, 104);
  c.fillStyle = '#3a2a3c';
  c.fillRect(W / 2 - sw / 2, 18, sw, 3);
  glow('GALI', 28, 4, '#9ffff0', 'rgba(61,224,200,0.25)');
  // Gali's mark either side of the sign
  const fill = (x: number, y: number, w: number, h: number, col: string) => {
    c.fillStyle = col;
    c.fillRect(x, y, w, h);
  };
  paintGaliLogo(fill, W / 2 - sw / 2 - 30 - GALI_LOGO.small.w * 3, 26, 'small', 3);
  paintGaliLogo(fill, W / 2 + sw / 2 + 30, 26, 'small', 3);
  glow('FIGHTCLUB', 62, 7, '#ff3fa4', 'rgba(255,63,164,0.3)');

  // caution tape across two corners: CALLOUT
  const tape = (x: number, y: number, ang: number, len: number) => {
    c.save();
    c.translate(x, y);
    c.rotate(ang);
    c.fillStyle = '#ffc93c';
    c.fillRect(-len / 2, -22, len, 44);
    c.fillStyle = '#140c10';
    for (let k = -len / 2; k < len / 2; k += 120) {
      text(c, 'CALLOUT', k + 10, -14, 4, '#140c10');
      c.fillRect(k + 108, -22, 6, 44);
    }
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.fillRect(-len / 2, 18, len, 4);
    c.restore();
  };
  tape(120, 210, -0.55, 520);
  tape(W - 120, 210, 0.55, 520);

  // the miners, face to face; an unknown rival is a dark silhouette with a question mark
  drawMiner(c, o.me.look, 'swing', 2, 330, 480, 9, 1);
  if (o.rival.look) drawMiner(c, o.rival.look, 'swing', 2, 870, 480, 9, -1);
  else {
    const tmp = makeCanvas(W, H);
    const t = ctx2d(tmp);
    drawMiner(t, o.me.look, 'idle', 0, 870, 480, 9, -1);
    t.globalCompositeOperation = 'source-atop';
    t.fillStyle = '#1a1024';
    t.fillRect(0, 0, W, H);
    c.drawImage(tmp, 0, 0);
    text(c, '?', 870 - (textWidth('?') * 12) / 2, 250, 12, '#ff3fa4', '#0a0608');
  }

  // a sprayed VS: white, black outline, drips
  const vs = 'VS', vsc = 14, vx = W / 2 - (textWidth(vs) * vsc) / 2, vy = 250;
  for (const [dx, dy] of [[-6, 0], [6, 0], [0, -6], [0, 6], [5, 5]] as const) text(c as Ctx, vs, vx + dx, vy + dy, vsc, '#0a0608');
  text(c as Ctx, vs, vx, vy, vsc, '#f4f0f8');
  c.fillStyle = '#f4f0f8';
  const vw = textWidth(vs) * vsc;
  for (const [f, len] of [[0.12, 34], [0.34, 20], [0.66, 46], [0.88, 16]] as const) {
    c.fillRect(vx + vw * f, vy + 5 * vsc - 4, 6, len);
    c.fillRect(vx + vw * f - 1, vy + 5 * vsc - 4 + len, 8, 6);
  }
  if (o.when) {
    const s = `FIGHT AT ${o.when}`.toUpperCase();
    mid(s, 150, 3, '#f4ecff', '#0a0608');
  }

  // names on strips of tape
  const label = (s: string, x: number, col: string, ink: string, tilt: number) => {
    const up = s.toUpperCase().slice(0, 16);
    const sc = up.length > 11 ? 3 : 4;
    const w = textWidth(up) * sc + 36;
    c.save();
    c.translate(x, 516);
    c.rotate(tilt);
    c.fillStyle = col;
    c.fillRect(-w / 2, -6, w, sc * 5 + 16);
    c.fillStyle = 'rgba(0,0,0,0.18)';
    for (let k = -w / 2; k < w / 2; k += 7) c.fillRect(k, -6, 2, 3);
    text(c, up, -w / 2 + 18, 2, sc, ink);
    c.restore();
  };
  label(o.me.name, 330, '#ffc93c', '#140c10', -0.04);
  label(o.rival.name, 870, '#ff3fa4', '#14040c', 0.04);
  if (o.special) text(c, o.special.name.toUpperCase(), 330 - (textWidth(o.special.name) * 2) / 2, 556, 2, o.special.color, '#0a0608');

  // the room code on a steel plate, the link under it
  const code = `ROOM ${o.code}`;
  const pw = textWidth(code) * 5 + 48;
  c.fillStyle = '#5a5e6a';
  c.fillRect(W / 2 - pw / 2, 528, pw, 50);
  c.fillStyle = '#8a8e9a';
  c.fillRect(W / 2 - pw / 2, 528, pw, 3);
  c.fillStyle = '#2a2a34';
  for (const [bx, by] of [[8, 8], [pw - 14, 8], [8, 38], [pw - 14, 38]] as const) c.fillRect(W / 2 - pw / 2 + bx, 528 + by, 5, 5);
  mid(code, 540, 5, '#ffc93c', '#140c10');
  // the pixel font has no ? = or &, so only the site goes on the card
  mid(`FIGHT AT ${o.link.replace(/^https?:\/\//, '').split(/[/?]/)[0]}`.toUpperCase(), 590, 3, '#e8e4ee', '#0a0608');
  return cv;
}
