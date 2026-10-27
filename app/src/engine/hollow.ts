/** Hollow Night props drawn into the worlds: jack-o'-lanterns that flicker and light the ground. */
import type { Ctx } from './art';

const PUMPKIN = [
  '....gg...',
  '...gg....',
  '.ooOoOoo.',
  'oooOoOooo',
  'oyyOoOyyo',
  'oooOyOooo',
  'oyoyyyoyo',
  'ooyoyoyoo',
  '.ooOoOoo.',
];
const PW = PUMPKIN[0].length, PH = PUMPKIN.length;

/** The face flickers like a candle. 0..1, steady per pumpkin through `seed`. */
export const flicker = (now: number, seed: number) => 0.75 + 0.15 * Math.sin(now / 90 + seed * 7.1) + 0.1 * Math.sin(now / 37 + seed * 3.3);

/**
 * One jack-o'-lantern standing at (X, Y), its base centre, `z` screen pixels per art pixel.
 * Faces left or right by `seed` so a row of them doesn't look stamped.
 */
export function drawPumpkin(c: Ctx, X: number, Y: number, z: number, now: number, seed: number) {
  const q = Math.max(1, z);
  const fl = flicker(now, seed);
  const face = `rgb(255,${Math.round(170 + 70 * fl)},${Math.round(40 + 40 * fl)})`;
  const flip = seed % 2 === 1;
  // a soft shadow under it
  c.fillStyle = 'rgba(0,0,0,0.35)';
  c.fillRect(Math.round(X - (PW / 2) * q), Math.round(Y - q * 0.5), Math.round(PW * q), Math.ceil(q));
  for (let ry = 0; ry < PH; ry++) {
    const row = PUMPKIN[ry];
    for (let rx = 0; rx < PW; rx++) {
      const ch = row[flip ? PW - 1 - rx : rx];
      if (ch === '.') continue;
      c.fillStyle = ch === 'g' ? '#4f8a2c' : ch === 'O' ? '#b4520e' : ch === 'y' ? face : '#e8741c';
      c.fillRect(Math.round(X + (rx - PW / 2) * q), Math.round(Y + (ry - PH) * q), Math.ceil(q), Math.ceil(q));
    }
  }
}

export const PUMPKIN_LIGHT = '#ff8a1e';
