/**
 * Reading ORE's board from the app.
 *
 * Gali's own round was a pure function of the clock: `unix_time / 60`, the same
 * answer on every device with no network call. ORE's round is not. It lives in
 * the Board account, it is measured in slots rather than seconds, and it does
 * not start until somebody makes the round's first deploy. So the app has to ask
 * the chain what round it is, and keep asking.
 *
 * Everything here is a read. Nothing in this file signs or sends.
 */
import '../polyfill-web';
import { Connection, PublicKey } from '@solana/web3.js';
import {
  automationPda,
  BOARD_ADDRESS,
  CONFIG_ADDRESS,
  INTERMISSION_SLOTS,
  minerPda,
  ROUND_NOT_STARTED,
  ROUND_SLOTS,
  roundPda,
  TREASURY_ADDRESS,
} from './consts';
import {
  decodeAutomation,
  decodeBoard,
  decodeConfig,
  decodeMiner,
  decodeRound,
  decodeTreasury,
  distributionMask,
  isSplitSquare,
  type OreAutomation,
  type OreBoard,
  type OreConfig,
  type OreMiner,
  type OreRound,
  type OreTreasury,
} from './accounts';

/** Mainnet's average slot time. Only ever used to turn slots into a countdown. */
export const SLOT_MS = 400;

/**
 * Where a round is in its cycle.
 *
 * `waiting` is the state Gali's own round never had: the round account exists,
 * the id is current, but the clock has not started because nobody has deployed
 * yet. The UI has to say "waiting for the first deploy" rather than show a
 * countdown from nowhere.
 */
export type RoundPhase = 'waiting' | 'mining' | 'intermission';

export interface OreClock {
  roundId: bigint;
  phase: RoundPhase;
  /** Slots until mining closes. Zero outside the mining phase. */
  slotsLeft: number;
  /** Rough milliseconds until mining closes, for the countdown only. */
  msLeft: number;
  /** 0 to 1 through the mining window, for the quarry shake. */
  progress: number;
  startSlot: bigint;
  endSlot: bigint;
  /** Lamports per whole ORE, ORE's own moving average of what mining costs. */
  productionCostEma: bigint;
}

/**
 * Turns a Board plus the current slot into something the UI can render.
 *
 * Deliberately takes the slot as an argument rather than fetching it: the caller
 * already has to poll, and a clock that quietly makes its own RPC call is a clock
 * that lies about when it was measured.
 */
export function readClock(board: OreBoard, slot: number): OreClock {
  const current = BigInt(slot);
  const notStarted = board.endSlot === ROUND_NOT_STARTED;

  let phase: RoundPhase;
  if (notStarted) phase = 'waiting';
  else if (current < board.endSlot) phase = 'mining';
  else phase = 'intermission';

  const slotsLeft = phase === 'mining' ? Number(board.endSlot - current) : 0;
  const span = notStarted ? Number(ROUND_SLOTS) : Number(board.endSlot - board.startSlot);
  const elapsed = phase === 'mining' ? span - slotsLeft : span;

  return {
    roundId: board.roundId,
    phase,
    slotsLeft,
    msLeft: slotsLeft * SLOT_MS,
    progress: phase === 'waiting' ? 0 : Math.min(1, Math.max(0, elapsed / Math.max(1, span))),
    startSlot: board.startSlot,
    endSlot: board.endSlot,
    productionCostEma: board.productionCostEma,
  };
}

/** The board and the slot it was read at, in one round trip each. */
export async function fetchClock(conn: Connection): Promise<OreClock> {
  const [info, slot] = await Promise.all([
    conn.getAccountInfo(BOARD_ADDRESS),
    conn.getSlot(),
  ]);
  if (!info) throw new Error('ORE board not found. Wrong cluster?');
  return readClock(decodeBoard(info.data), slot);
}

export async function fetchOreConfig(conn: Connection): Promise<OreConfig> {
  const info = await conn.getAccountInfo(CONFIG_ADDRESS);
  if (!info) throw new Error('ORE config not found. Wrong cluster?');
  return decodeConfig(info.data);
}

export async function fetchOreTreasury(conn: Connection): Promise<OreTreasury> {
  const info = await conn.getAccountInfo(TREASURY_ADDRESS);
  if (!info) throw new Error('ORE treasury not found. Wrong cluster?');
  return decodeTreasury(info.data);
}

/** A round account, or null once ORE has closed and reclaimed it. */
export async function fetchOreRound(conn: Connection, roundId: bigint): Promise<OreRound | null> {
  const info = await conn.getAccountInfo(roundPda(roundId));
  return info ? decodeRound(info.data) : null;
}

/** A player's miner account, or null if they have never deployed. */
export async function fetchOreMiner(conn: Connection, authority: PublicKey): Promise<OreMiner | null> {
  const info = await conn.getAccountInfo(minerPda(authority));
  return info ? decodeMiner(info.data) : null;
}

/** A player's automation, or null if they deploy by hand. */
export async function fetchOreAutomation(
  conn: Connection,
  authority: PublicKey,
): Promise<OreAutomation | null> {
  const info = await conn.getAccountInfo(automationPda(authority));
  return info ? decodeAutomation(info.data) : null;
}

/**
 * The ten squares that pay a single winner this round, as an array the board can
 * star directly. Pure arithmetic on the round id, so it is known before the round
 * is drawn and needs no network call.
 */
export function soloSquares(roundId: bigint, keccak256: (d: Uint8Array) => Uint8Array): boolean[] {
  const mask = distributionMask(roundId, keccak256);
  return Array.from({ length: 25 }, (_, i) => !isSplitSquare(mask, i));
}

export interface OreRewards {
  /** Lamports returned and claimable. */
  sol: bigint;
  /** Grams of ORE already refined. Claims with no fee. */
  refined: bigint;
  /** Grams of ORE mined but unrefined. ORE takes 10% of this on claim. */
  unrefined: bigint;
  /** What the 10% would cost on the unrefined part right now. */
  refiningFee: bigint;
  /** The round the miner account is currently holding. */
  roundId: bigint;
  /** True once ORE has settled that round for this miner. */
  checkpointed: boolean;
  /** True when the player has SOL on the board in the live round. */
  deployedNow: boolean;
}

/** ORE charges 10% on claiming unrefined ORE. Their mechanic, not Gali's. */
export const ORE_REFINING_BPS = 1_000n;

/**
 * What the rewards panel shows. Reads the player's ORE miner account rather than
 * anything of Gali's, because on ORE's board the position is theirs and Gali is
 * not in the middle of it.
 */
export function readRewards(miner: OreMiner | null, clock: OreClock): OreRewards {
  if (!miner) {
    return {
      sol: 0n,
      refined: 0n,
      unrefined: 0n,
      refiningFee: 0n,
      roundId: 0n,
      checkpointed: true,
      deployedNow: false,
    };
  }
  const unrefined = miner.rewardsOre;
  return {
    sol: miner.rewardsSol,
    refined: miner.refinedOre,
    unrefined,
    refiningFee: (unrefined * ORE_REFINING_BPS) / 10_000n,
    roundId: miner.roundId,
    checkpointed: miner.checkpointId === miner.roundId,
    deployedNow:
      miner.roundId === clock.roundId && miner.deployed.some((v) => v > 0n),
  };
}

/**
 * Whether this miner still needs checkpointing for a finished round.
 *
 * Two things hang off this. ORE refuses the next deploy until the previous round
 * is checkpointed, so the app has to do it before a player can play again. And
 * Gali's own `record_ore_round` reads the settled result, so points wait on it too.
 */
export function needsCheckpoint(miner: OreMiner | null, clock: OreClock): bigint | null {
  if (!miner) return null;
  if (miner.checkpointId === miner.roundId) return null;
  if (miner.roundId >= clock.roundId) return null;
  return miner.roundId;
}
