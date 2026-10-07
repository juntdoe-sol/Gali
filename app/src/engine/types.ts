/**
 * What crosses between the React Native app and the canvas engine.
 *
 * On Android the engine runs inside a WebView (an Expo DOM component), so both
 * directions are plain JSON. The app sends a Snapshot whenever the game changes;
 * the engine sends events back. Everything animates inside the engine; the
 * snapshot only says what is true.
 */

export type Pose = 'idle' | 'walk' | 'swing' | 'cheer' | 'carry' | 'dance1' | 'dance2' | 'dance3';

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
  view: { top: number; bottom: number };
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
  | { t: 'perf'; fps: number; quality: number };
