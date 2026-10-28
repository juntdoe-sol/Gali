// How a finished ORE round scores on Gali's boards, worked out from ORE's own accounts so no app can claim it.
// Pure: no Deno or Node APIs, so the play and autopilot functions and the Node tests all use this one file.
// The same rules as the app (app/src/game/constants.ts pointsFor, app/src/game/store.ts round XP) and as the
// Gali program's record_ore_round.

export const BLOCKS = 25;
export const BASE_POINTS = 40;
export const MOTHERLODE_POINTS = 10_000;
/** Until Gali's program (and its staking boost) is live, every round scores at 1x. */
export const NO_BOOST_BPS = 10_000;

/** ORE's winning square for a round's entropy: null while undrawn (all 0x00) or refunded (all 0xFF). */
export function winningSquare(entropy: Uint8Array): number | null {
  if (entropy.length !== 32 || entropy.every((b) => b === 0) || entropy.every((b) => b === 0xff)) return null;
  let rng = 0n;
  for (let w = 0; w < 4; w++) {
    let v = 0n;
    for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(entropy[w * 8 + i]);
    rng ^= v;
  }
  return Number(rng % 25n);
}

export const pointsFor = (covered: number, motherlode: boolean, boostBps = NO_BOOST_BPS) =>
  Math.floor(((Math.floor((BASE_POINTS * BLOCKS) / Math.max(1, covered)) + (motherlode ? MOTHERLODE_POINTS : 0)) * boostBps) / 10_000);

export interface RoundScore {
  covered: number;
  won: boolean;
  motherlode: boolean;
  points: number;
  xp: number;
}

/**
 * The score for one miner in one round. `deployed` is the miner's lamports per square for that round (ORE's Miner
 * account while it still holds the round), `entropy` and `motherlode` come from ORE's Round account. Null when the
 * miner did not play, or the round has not been drawn yet.
 */
export function scoreRound(deployed: bigint[], entropy: Uint8Array, motherlodeGrams: bigint): RoundScore | null {
  const covered = deployed.filter((v) => v > 0n).length;
  if (!covered) return null;
  if (entropy.every((b) => b === 0)) return null; // not drawn yet
  const square = winningSquare(entropy);
  const won = square !== null && deployed[square] > 0n;
  const motherlode = won && motherlodeGrams > 0n;
  // playing a live round is 10 XP plus one per spot; a win adds 50 (app/src/game/store.ts)
  return { covered, won, motherlode, points: won ? pointsFor(covered, motherlode) : 0, xp: 10 + covered + (won ? 50 : 0) };
}

/* ---------- ORE account bytes (layouts as in app/src/chain/ore/accounts.ts) ---------- */
const DISC = 8;
export const MINER_SIZE = DISC + 744;
export const ROUND_SIZE = DISC + 944;
export const BOARD_SIZE = DISC + 32;
const u64 = (d: Uint8Array, o: number) => {
  let v = 0n;
  for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(d[DISC + o + i]);
  return v;
};
export function minerFields(d: Uint8Array) {
  if (d.length !== MINER_SIZE) throw new Error('bad miner');
  return {
    authority: d.slice(DISC, DISC + 32),
    checkpointId: u64(d, 40),
    deployed: Array.from({ length: BLOCKS }, (_, i) => u64(d, 56 + i * 8)),
    roundId: u64(d, 656),
    lifetimeRewardsOre: u64(d, 720),
    lifetimeDeployed: u64(d, 728),
  };
}
export function roundFields(d: Uint8Array) {
  if (d.length !== ROUND_SIZE) throw new Error('bad round');
  return { id: u64(d, 0), entropy: d.slice(DISC + 608, DISC + 640), motherlode: u64(d, 648) };
}
export const boardRoundId = (d: Uint8Array) => {
  if (d.length !== BOARD_SIZE) throw new Error('bad board');
  return u64(d, 0);
};
