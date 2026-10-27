/** The TV's palette and fonts: the same values as src/ui/kit.tsx (TONE, F), so the TV matches the phone app. */
export const C = {
  ocean: '#091330',
  panel: '#152046',
  bevelHi: '#33498c',
  bevelLo: '#0c1430',
  edge: '#04060f',
  well: '#060a1c',
  gold: '#ffc93c',
  goldDark: '#d27a12',
  skr: '#a8e05a',
  skrDark: '#5d9a26',
  teal: '#2fc7dd',
  tealDark: '#15809a',
  steel: '#2e4d94',
  steelHi: '#5f86d8',
  pink: '#ff6ec0',
  plum: '#7b2d63',
  red: '#e2493b',
  text: '#f2f5ff',
  dim: '#8c9cc8',
};

export const F = {
  display: 'Jersey15_400Regular',
  body: 'PixelifySans_400Regular',
  bold: 'PixelifySans_600SemiBold',
  tiny: 'Silkscreen_400Regular',
};

/** Whole-pixel unit for borders and bevels. The TV renders 1920x1080 dp, so 4 matches the reference. */
export const U = 4;

/** Everything stays 5% inside the screen edge (TV overscan). */
export const SAFE_X = 96;
export const SAFE_Y = 54;
