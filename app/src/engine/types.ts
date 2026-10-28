/**
 * What crosses between the React Native app and the canvas engine.
 *
 * On Android the engine runs inside a WebView (an Expo DOM component), so both
 * directions are plain JSON. The app sends a Snapshot whenever the game changes;
 * the engine sends events back. Everything animates inside the engine; the
 * snapshot only says what is true.
 */

export type Pose = 'idle' | 'walk' | 'swing' | 'cheer' | 'carry' | 'dance1' | 'dance2' | 'dance3';

/** A lobby ride's kind, as the canvas sees it (game/rideRules.ts has the rules). */
export type RideKindView = 'cart' | 'scoot';
export interface RideView {
  id: number;
  k: RideKindView;
  x: number;
  y: number;
  f: 1 | -1;
  /** a lobby id, 'me' for you, or null when parked */
  rider: string | null;
}

export interface Look {
  hat: string; // helmet gear key, e.g. 'hat-yellow'
  fit: string; // overalls colour
  pick: string; // pick head colour
  handle: string; // pick handle colour
  pet: string | null; // pet gear key
  glow: 'none' | 'rare' | 'epic' | 'legendary'; // pick rarity, for sparkles
  /** which miner body: 'f' draws the girl miner. Anything else is the boy. */
  sex?: 'm' | 'f';
}

export interface PeerView {
  id: string;
  name: string;
  x: number; // feet, map pixels
  y: number;
  tx: number;
  ty: number;
  facing: 1 | -1;
  pose: Pose;
  look: Look;
  tone: 'verified' | 'guest' | 'bot';
  emoji: string | null;
}

export interface Snapshot {
  /** CSS pixels covered by the HUD above and the dock below */
  /** screen CSS px the interface covers on each side; left/right are a desktop rail and side panel */
  view: { top: number; bottom: number; left?: number; right?: number };
  /** a touch screen on the island: where the walking stick's centre sits (CSS px from the left and the bottom) */
  stick?: { left: number; bottom: number } | null;
  phase: string;
  roundId: number;
  roundEndsAt: number; // wall-clock ms
  lockMs: number;
  settleStartAt: number;
  revealStartAt: number;
  winner: number | null;
  motherlode: boolean;
  caveIn: boolean;
  selected: number[];
  pending: number; // bitmask of claims you deployed on this round
  solo: number; // bitmask of solo claims this round
  perBlock: number[]; // SOL on each claim
  mine: number[]; // your SOL on each claim
  me: { look: Look; emoji: string | null; emoteAt: number; name: string };
  peers: PeerView[];
  practice: boolean;
  /** 0 = low effects (older phones), 1 = full */
  quality: number;
  /** draw the SOL on every claim (PRO); otherwise only a heat tint */
  amounts: boolean;
  /** Wall-clock ms of the latest confirmed claim; the island sprays coins once per new stamp. Cosmetic only. */
  claimedAt?: number;
  /** true while the player is on the island (not in the lobby). Arriving lands the miner on the helipad. */
  onIsland?: boolean;
  brawl?: BrawlSnap;
  /** the first-visit tutorial: point the miner at the nearest mining spot */
  guide?: boolean;
}

/** One fighter, as the canvas sees it. Times are wall-clock ms (Date.now), 0 when not set. */
export interface BrawlView {
  hp: number;
  /** when the knockdown started */
  ko: number;
  /** when the shield ends */
  sh: number;
  /** last hit taken, last swing */
  hit: number;
  sw: number;
  /** Brawl on for them: show the HP bar, and they can be hit */
  on: boolean;
}
export interface BrawlSnap {
  /** your own Brawl switch */
  on: boolean;
  /** you; rs counts stand-ups (move back to the spawn), hx/hy where the last hit came from */
  me: BrawlView & { rs: number; hx: number; hy: number };
  /** players running a build with Brawl (others have no entry and no HP bar) */
  peers: Record<string, BrawlView>;
  /** when each player last jumped (wall ms), so everyone sees the hop */
  jumps?: Record<string, number>;
}

export type EngineEvent =
  | { t: 'ready' }
  | { t: 'focus'; claim: number }
  | { t: 'toggle'; claim: number }
  | { t: 'bonk' }
  | { t: 'sfx'; name: 'hit' | 'pop' | 'crack' | 'select' | 'deselect' | 'whoosh' | 'bonk' }
  | { t: 'me'; x: number; y: number; tx: number; ty: number; facing: 1 | -1; pose: Pose }
  | { t: 'peer'; id: string }
  | { t: 'emote' }
  | { t: 'perf'; fps: number; quality: number }
  /** your miner swung its pickaxe; target is the player it hit, if any */
  | { t: 'swing'; target: string | null; x: number; y: number }
  /** your miner jumped */
  | { t: 'jump' }
  /** tutorial: your miner reached a mining spot */
  | { t: 'arrived'; claim: number };
