/**
 * The two logos as pixel art, for the painted scenes: Gali's (the gold peak with the pickaxe and the white crescent,
 * from the brand's pixel mark) and ORE's (a ring with a slash through it). Painted with any fill function, so the
 * lobby sprites, the fight stages and the callout card all share them. (logos.ts holds the partner marks for the
 * billboard; ORE's big mark comes from there.)
 */
import { ORE_MARK } from './logos';

type Fill = (x: number, y: number, w: number, h: number, c: string) => void;

/** y gold, w cream, k outline, . clear. 62 x 59 at 1 px a cell. */
const GALI_BIG = [
  '.............................kkkk.............................',
  '............................kkyyk.............................',
  '...........................kkyyykk............................',
  '..........................kkyyyyykk..............kkk..........',
  '..........................kyyyyyyyk.............kkwkk.........',
  '.........................kkyyyyyyykk...........kkwwwkk........',
  '........................kkyyyyyyyyyk..........kkwwwwwkk.......',
  '.......................kkyyyyyyyyyykkkk......kkwwwwwwwkk......',
  '...................kkkkkyyyyyyyyyyyykwkkkk..kkwwwwwwwwwkk.....',
  '.................kkkwwkyyyyyyyyyyyyykkkyykkkkwwwwwwwwwwwk.....',
  '................kkwwwkkyyyyyyyyyyyyyykyyykwwwwwwwwwwwwwkk.....',
  '...............kkwwwkkyyyyyyyyyyyyyyyyyyykkwwwwwwwwwwwkk......',
  '..............kkwwwkkyyyyyyyyyyyyyyyyyyyyykwwwwwwwwwwkk.......',
  '.............kkwwwwkyyyyyyyyyyyyyyyyyyyyyykkwwwwwwwwkk........',
  '............kkwwwwkkyyyyyyyyyyyyyyyyyyyyyyykwwwwwwwkk.........',
  '...........kkwwwwwkyyyyyyyyyyyyyyyyyyyyyyyykwwwwwwkk..........',
  '...........kwwwwwkkyyyyyyyyyyyyyyyyyyyyyyyykkwwwwwk...........',
  '..........kkwwwwwkyyyyyyyyyyyyyyyyyyyyyyyyyykwwwwwkk..........',
  '..........kwwwwwkkyyyyyyyyyyykkkkyyyyyyyyyyykkwwwwwk..........',
  '.........kkwwwwwkyyyyyyyyykkkkkkkkkkyyyyyyyyykwwwwwkk.........',
  '.........kwwwwwwkyyyyyykkkkkkkkkkkkkkkkyyyyyykkwwwwwk.........',
  '.........kwwwwwkkyyyykkkkkkkkkkkkkkkkkkkkyyyyykwwwwwk.........',
  '........kkwwwwwkyyyykkkkkkkkkkkkkkkkkkkkkkyyyykwwwwwkk........',
  '........kwwwwwwkyyykkkkkkkkkkkkkkkkkkkkkkkkyyykkwwwwwk........',
  '........kwwwwwwkkkkkkkkkkkkkkkkkkkkkkkkkkkkkyyykwwwwwk........',
  '........kwwwwwwwwkkkkkkkkyyyykkkkyyyykkkkkkkkyykkwwwwk........',
  '........kwwwwwwwwkkkkyyyyyyyykkkkyyyyyyyykkkkkyykwwwwk........',
  '........kwwwwwwwwkkyyyyyyyyyykkkkyyyyyyyyyykkkyykkwwwk........',
  '........kwwwwwwwwkyyyyyyyyyyykkkkyyyyyyyyyyyykkyykwwwk........',
  '........kwwwwwwwwkyyyyyyyyyyykkkkyyyyyyyyyyyyykyykwwwk........',
  '........kwwwwwwwwkyyyyyyyyyyykkkkyyyyyyyyyyyyyyyykkwwk........',
  '........kwwwwwwwwkyyyyyyyyyyykkkkyyyyyyyyyyyyyyyyykwwk........',
  '........kwwwwwwwwkkyyyyyyyyyykkkkyyyyyyyyyyyyyyyyykkwk........',
  '........kwwwwwwwwwkyyyyyyyyyykkkkyyyyyyyyyyyyyyyyyykwk........',
  '........kwwwwwwwwwkyyyyyyyyyykkkkyyyyyyyyyyyyyyyyyykkk........',
  '........kkwwwwwwwwkkyyyyyyyyykkkkyyyyyyyyyyyyyyyyyyyk.........',
  '.........kwwwwwwwwwkkyyyyyyyykkkkyyyyyyyyyyyyyyyyyyyk.........',
  '.........kwwwwwwwwwwkyyyyyyyykkkkyyyyyyyyyyyyyyyyyyykk........',
  '........kkkwwwwwwwwwkkyyyyyyykkkkyyyyyyyyyyyyyyyyyyyyk........',
  '.......kkykwwwwwwwwwwkkkyyyyykkkkyyyyyyyyyyyyyyyyyyyykk.......',
  '.......kyykkwwwwwwwwwwwkkyyyykkkkyyyyyyyyyyyyyyyyyyyyyk.......',
  '.......kyyykwwwwwwwwwwwwkkkkykkkkyyyyyyyyyyyyyyyyyyyyykk......',
  '......kkyykkwwwwwwwwwwwwwwwkkkkkkyyykyyyyyyyyyyyyyyyyyyk......',
  '......kyykkwwwwwwwwwwwwwwwwwwwwwkkkkkkyyyyyyyyyyyyyyyyyk......',
  '.....kkykkwwwwwwwwwwwwwwwwwwwwwwwwwwwkyyyyyyyyyyyyyyyyykk.....',
  '.....kykkwwwwwwwwwwwwwwwwwwwwwwwwwwwwkyyyyyyyyyyyyyyyyyyk.....',
  '.....kkkwwwwwwwwwwwwwwwwwwwwwwwwwwwwwkkyyyyyyyyyyyyyyyyykk....',
  '.....kkwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwkyyyyyyyyyyyyyyyyyyk....',
  '.....kwwwwwwwwwwwkkkwwwwwwwwwwwwwwwwwwkkyyyyyyyyyyyyyyyyykk...',
  '...kkkkwwwwwwwwwkkykkkwwwwwwwwwwwwwwwwwkyyyyyyyyyyyyyyyyyyk...',
  '...kyykkwwwwwwwkkyyyykkkkwwwwwwwwwwwwkkkkyyyyyyyyyyyyyyyyyk...',
  '..kkyyykkwwwwwkkyyyyyk..kkkkkkkkkkkkkk..kyyyyyyyyyyyyyyyyykk..',
  '..kyyyyykkwwwkkyyyyykk..................kkyyyyyyyyyyyyyyyyyk..',
  '.kkyyyyyykkwkkyykkkkk....................kkkkkyyyyyyyyyyyyykk.',
  '.kyyyyyyyykkkkkkk............................kkkkyyyyyyyyyyyk.',
  '.kyyyyyyykk.....................................kkkkkyyyyyyyk.',
  'kkyyyykkkk..........................................kkkkyyyykk',
  'kykkkkk................................................kkkkkyk',
  'kkk........................................................kkk',
];
/** The same mark at half size, 31 x 30. */
const GALI_SMALL = [
  '..............kyk..............',
  '.............kyyk........k.....',
  '.............yyyyk......kwk....',
  '............kyyyyyk....kwwwk...',
  '.........kwkyyyyyykkkkkwwwwwk..',
  '........kwkyyyyyyyyyywwwwwwk...',
  '.......kwwyyyyyyyyyyykwwwwk....',
  '......kwwkyyyyyyyyyyyywwwk.....',
  '.....kwwwyyyyyyyyyyyyywwwk.....',
  '.....wwwkyyyyykkkyyyyykwww.....',
  '....kwwwyyykkkkkkkkkyyywwwk....',
  '....kwwwyykkkkkkkkkkkyykwwk....',
  '....wwwwkkkkkykkkykkkkyywww....',
  '....wwwwwkyyyyykyyyyykkykww....',
  '....wwwwwyyyyyykyyyyyyyyyww....',
  '....wwwwwyyyyyykyyyyyyyyyww....',
  '....wwwwwyyyyyykyyyyyyyyykw....',
  '....kwwwwkyyyyykyyyyyyyyyyk....',
  '....kwwwwwyyyyykyyyyyyyyyyk....',
  '....kwwwwwkyyyykyyyyyyyyyyy....',
  '...kykwwwwwwkyykyyyyyyyyyyyk...',
  '...kykwwwwwwwwwwkykyyyyyyyyy...',
  '..kykwwwwwwwwwwwwwwyyyyyyyyyk..',
  '..kkwwwwwwwwwwwwwwwyyyyyyyyyk..',
  '..kwwwwwkkwwwwwwwwwkyyyyyyyyyk.',
  '.kykwwwkyyykkwwwwwkkyyyyyyyyyk.',
  '.yyykwkyyyk.........kyyyyyyyyy.',
  'kyyyykkk...............kkyyyyyk',
  'kyykk.....................kkyyk',
  'kk...........................kk',
];

const GALI_INK: Record<string, string> = { y: '#f2b01e', w: '#ece6da', k: '#140c10' };

export const GALI_LOGO = { big: { w: GALI_BIG[0].length, h: GALI_BIG.length }, small: { w: GALI_SMALL[0].length, h: GALI_SMALL.length } };

/**
 * Gali's mark with its top-left at (x, y), `s` px a cell. `mono` paints every lit cell one colour (a stencil or a
 * neon tube) and skips the outline.
 */
export function paintGaliLogo(P: Fill, x: number, y: number, size: 'big' | 'small' = 'small', s = 1, mono?: string) {
  const rows = size === 'big' ? GALI_BIG : GALI_SMALL;
  for (let j = 0; j < rows.length; j++) {
    const r = rows[j];
    let i = 0;
    while (i < r.length) {
      const ch = r[i];
      let n = 1;
      while (i + n < r.length && r[i + n] === ch) n++;
      if (ch !== '.' && !(mono && ch === 'k')) P(x + i * s, y + j * s, n * s, s, mono ?? GALI_INK[ch]);
      i += n;
    }
  }
}

/**
 * ORE's mark: a ring with a slash through it, centred on (cx, cy), `d` px across the ring. The slash runs from the
 * lower left to the upper right and shows only outside the ring, like the logo.
 */
export function paintOreLogo(P: Fill, cx: number, cy: number, d: number, color = '#f4f0f8') {
  // 20 px and up: ORE's own traced mark (logos.ts), scaled by whole pixels; smaller ones are drawn to size
  if (d >= 20) {
    const s = Math.max(1, Math.round(d / 18));
    const n = ORE_MARK.length;
    const x0 = Math.round(cx - (n * s) / 2), y0 = Math.round(cy - (n * s) / 2);
    for (let j = 0; j < n; j++) for (let i = 0; i < ORE_MARK[j].length; i++) if (ORE_MARK[j][i] === '#') P(x0 + i * s, y0 + j * s, s, s, color);
    return;
  }
  const R = d / 2, t = Math.max(1, Math.round(d * 0.2));
  const span = Math.ceil(R + d * 0.42);
  for (let y = -span; y <= span; y++) {
    for (let x = -span; x <= span; x++) {
      const r = Math.hypot(x + 0.5, y + 0.5);
      const ring = r <= R && r >= R - t;
      // the slash: a band along the line y = -x, beyond the ring, out to `span`
      const along = (x - y) / Math.SQRT2, across = Math.abs(x + y + 1) / Math.SQRT2;
      const slash = across <= t * 0.55 && Math.abs(along) > R - t * 0.5 && Math.abs(along) <= R + d * 0.3;
      if (ring || slash) P(cx + x, cy + y, 1, 1, color);
    }
  }
}
