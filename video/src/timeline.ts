/**
 * The timeline, in beats. The score runs at 111.1 BPM, a beat every 0.54 s, which is also one pickaxe swing in the
 * engine, so the miners dig in time with the music. Scenes change on bar lines (every 4 beats).
 */
import { b } from './kit';

export const T = {
  hit: b(4), // the pickaxe strikes the logo
  tagA: b(4.75),
  tagB: b(5.5),
  sub: b(6.5),
  introOut: b(7.25),
  wipe: b(7.5), // block wipe onto the island, lands on b8
  island: b(8),
  welcome: b(9),
  wave: b(12.5),
  welcomeOut: b(15),
  s1: b(16),
  picks: [17, 18, 19, 20, 21].map(b),
  s1Out: b(23.25),
  s2: b(24),
  deploy: b(24.5),
  s2Out: b(27.25),
  count: [28, 29, 30].map(b),
  locked: b(31),
  settle: b(32),
  s3: b(32),
  strike: b(36),
  s3Out: b(39),
  dive: b(39.5),
  s4: b(41),
  dig: b(40.25), // a new round starts as the dive settles; you're mining this claim
  s4Out: b(44.75),
  ml: b(45.5),
  mlFull: b(48),
  mlOut: b(51.25),
  exit: b(52),
  living: b(52.75),
  lapse: [b(53), b(59)],
  livingOut: b(59.25),
  // autopilot: the island at night, rounds deploying by themselves
  auto: b(60),
  autoTicks: [60.5, 61, 61.5, 62, 62.5, 63].map(b),
  autoOut: b(63.25),
  shutIn: b(63.5), // shutters close over the island, open on the lobby
  // ---- the lobby ----
  lobby: b(64),
  lobbyOut: b(71.25),
  chat: b(72),
  says: [72.5, 74, 75.5, 77].map(b),
  emotes: [73, 73.5, 74.5, 75, 76, 76.5, 77.5, 78].map(b),
  chatOut: b(79.25),
  dusk: [b(77.5), b(81)],
  dance: b(80),
  dance2: b(84),
  rain: b(86),
  dance3: b(88),
  bolts: [b(88), b(90)],
  danceOut: b(91.25),
  dawn: [b(90.5), b(93)],
  tips: b(92),
  tipCoins: [93, 93.5, 94].map(b),
  tipsOut: b(95.25),
  tour: b(96),
  stops: [96, 98, 100, 102].map(b), // the cave, the market, the pier, the games row
  tourOut: b(103.25),
  // ---- Cave Run ----
  caveIn: b(103.5),
  cave: b(104),
  caveOut: b(111.25),
  caveExit: b(111.5),
  // ---- the mini games ----
  games: b(112),
  gamesOut: b(115.25),
  tunnel: b(116),
  pot: b(124),
  crash: b(132),
  fair: b(140),
  fairOut: b(143.25),
  shut2: b(143.5), // shutters again, onto the gear
  gear: b(144),
  glint: b(148),
  gearOut: b(151.25),
  end: b(152),
  line1: b(154),
  line2: b(155),
  line3: b(156),
  badge: b(158),
  sweep2: b(160),
  fade: b(163),
  total: b(165),
};
export const REVEAL_AT = T.strike - 1.1; // the engine shows gold 1.1 s into its reveal
export const DUR = T.total;
