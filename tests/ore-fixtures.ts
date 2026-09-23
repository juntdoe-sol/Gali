/**
 * Byte-level fixtures for ORE's accounts.
 *
 * These build the exact layouts Gali's program reads, at the offsets confirmed
 * against live mainnet accounts (`scripts/ore-layout.json`). They are written out
 * by the `ore-mock` program, which is deployed at ORE's address on the test
 * validator and does nothing except put these bytes at ORE's own PDAs.
 *
 * The point of building them by hand is that it makes the rare cases reachable.
 * ORE's motherlode hits one round in 500, and a solo square that a specific wallet
 * takes is rarer still; waiting for one on mainnet is not a test strategy. If an
 * offset here and an offset in the program ever disagree, the tests fail loudly
 * rather than quietly reading the wrong field.
 */
import { PublicKey } from '@solana/web3.js';

/** Steel prefixes every account with an 8-byte discriminator. */
const DISC = 8;

export const BOARD_LEN = DISC + 32;
export const ROUND_LEN = DISC + 944;
export const MINER_LEN = DISC + 744;

export const ORE_PROGRAM_ID = new PublicKey('oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv');
export const ORE_SPLIT = new PublicKey('SpLiT11111111111111111111111111111111111112');

/** ORE's round expiry sits one day of slots past the slot mining closed. */
export const ONE_DAY_SLOTS = 24 * 60 * 200;

const put64 = (b: Buffer, structOffset: number, v: bigint | number) =>
  b.writeBigUInt64LE(BigInt(v), DISC + structOffset);
const putKey = (b: Buffer, structOffset: number, k: PublicKey) =>
  k.toBuffer().copy(b, DISC + structOffset);
const putSquares = (b: Buffer, structOffset: number, v: (bigint | number)[]) =>
  v.forEach((x, i) => put64(b, structOffset + i * 8, x));

export const zeros25 = () => Array.from({ length: 25 }, () => 0);

export interface BoardFixture {
  roundId: number;
  startSlot?: number;
  endSlot?: number;
  productionCostEma?: number;
}

export function boardBytes(f: BoardFixture): Buffer {
  const b = Buffer.alloc(BOARD_LEN);
  put64(b, 0, f.roundId);
  put64(b, 8, f.startSlot ?? 0);
  put64(b, 16, f.endSlot ?? 0);
  put64(b, 24, f.productionCostEma ?? 0);
  return b;
}

export interface RoundFixture {
  id: number;
  /** Lamports on each of the 25 squares. */
  deployed: (bigint | number)[];
  /** Which square should win. Leave undefined for a round that never drew. */
  winningSquare?: number;
  /** Grams of ORE the motherlode paid, non-zero to simulate a hit. */
  motherlode?: bigint | number;
  /** The solo winner, or ORE_SPLIT for a shared square. */
  topMiner?: PublicKey;
  /** Grams of ORE the winning square mined. */
  reward?: bigint | number;
  totalMiners?: number;
  totalVaulted?: bigint | number;
  totalReturnedSol?: bigint | number;
  /** The slot mining closed. Drives `expires_at`, which the boost rule reads. */
  endSlot?: number;
}

/**
 * ORE derives the winning square by xoring the four words of the entropy and
 * taking that mod 25, so putting the square in the first word and leaving the rest
 * zero produces exactly the square asked for. An all-zero entropy is what ORE
 * leaves on a round that never drew, and the program treats it as unsettled.
 */
export function roundBytes(f: RoundFixture): Buffer {
  const b = Buffer.alloc(ROUND_LEN);
  put64(b, 0, f.id);
  putSquares(b, 8, f.deployed);

  if (f.winningSquare !== undefined) {
    // Square 0 would give an all-zero entropy, which reads as "not drawn", so add a
    // multiple of 25 to keep the value non-zero without moving the square.
    const rng = f.winningSquare === 0 ? 25 : f.winningSquare;
    b.writeBigUInt64LE(BigInt(rng), DISC + 608);
  }

  const endSlot = f.endSlot ?? 0;
  put64(b, 640, endSlot + ONE_DAY_SLOTS);
  put64(b, 648, f.motherlode ?? 0);
  putKey(b, 656, PublicKey.default);
  put64(b, 688, f.reward ?? 0);
  put64(b, 888, f.totalVaulted ?? 0);
  put64(b, 896, f.totalReturnedSol ?? 0);
  put64(b, 904, f.totalMiners ?? 0);
  putKey(b, 912, f.topMiner ?? ORE_SPLIT);
  return b;
}

export interface MinerFixture {
  authority: PublicKey;
  roundId: number;
  deployed: (bigint | number)[];
  cumulative?: (bigint | number)[];
  /** Defaults to `roundId`, which is what ORE writes once the round is settled. */
  checkpointId?: number;
  rewardsSol?: bigint | number;
  refinedOre?: bigint | number;
  rewardsOre?: bigint | number;
}

export function minerBytes(f: MinerFixture): Buffer {
  const b = Buffer.alloc(MINER_LEN);
  putKey(b, 0, f.authority);
  put64(b, 32, 1); // auto_return
  put64(b, 40, f.checkpointId ?? f.roundId);
  put64(b, 48, 0); // checkpoint_fee
  putSquares(b, 56, f.deployed);
  putSquares(b, 456, f.cumulative ?? zeros25());
  put64(b, 656, f.roundId);
  // 664 is rewards_factor, a 16-byte Numeric; zero is the right starting value.
  put64(b, 680, f.rewardsSol ?? 0);
  put64(b, 688, f.refinedOre ?? 0);
  put64(b, 696, f.rewardsOre ?? 0);
  return b;
}

export const oreRoundPda = (roundId: number) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from('round'), (() => {
      const x = Buffer.alloc(8);
      x.writeBigUInt64LE(BigInt(roundId));
      return x;
    })()],
    ORE_PROGRAM_ID,
  )[0];

export const oreMinerPda = (authority: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from('miner'), authority.toBuffer()], ORE_PROGRAM_ID)[0];

export const oreBoardPda = () =>
  PublicKey.findProgramAddressSync([Buffer.from('board')], ORE_PROGRAM_ID)[0];
