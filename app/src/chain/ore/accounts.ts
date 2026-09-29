/**
 * Decoders for the $ORE program's accounts.
 *
 * Steel has no IDL, so these are hand-written against ore-api's structs, which are
 * `#[repr(C)]` and made entirely of u64, i64, Pubkey and fixed arrays. That means no
 * padding and no length prefixes: every offset is a running total, and each account
 * is one fixed size. The offsets and sizes here were checked against live mainnet
 * accounts; scripts/ore-probe.ts re-runs that check and writes scripts/ore-layout.json.
 *
 * A size mismatch means ORE redeployed with a changed struct. The decoders throw
 * rather than return plausible nonsense, because reading a wrong offset would show a
 * player the wrong balance.
 */
import '../polyfill-web';
import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';

/** Steel prefixes every account with an 8-byte discriminator. */
const DISC = 8;

/** Steel's fixed-point Numeric is a u128. Confirmed by the Miner and Treasury sizes. */
const NUMERIC = 16;

export const ORE_ACCOUNT_SIZE = {
  board: DISC + 32,
  round: DISC + 944,
  miner: DISC + 744,
  config: DISC + 224,
  treasury: DISC + 40,
  automation: DISC + 152,
} as const;

const view = (data: Buffer | Uint8Array) => {
  const b = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return new DataView(b.buffer, b.byteOffset, b.length);
};

const check = (data: Buffer | Uint8Array, expected: number, what: string) => {
  if (data.length !== expected) {
    throw new Error(`ORE ${what} account is ${data.length} bytes, expected ${expected}. ORE has changed its layout; rerun scripts/ore-probe.ts.`);
  }
};

const u64 = (dv: DataView, o: number) => dv.getBigUint64(DISC + o, true);
const i64 = (dv: DataView, o: number) => dv.getBigInt64(DISC + o, true);
const u16 = (dv: DataView, o: number) => dv.getUint16(DISC + o, true);
const u128 = (dv: DataView, o: number) =>
  dv.getBigUint64(DISC + o, true) + (dv.getBigUint64(DISC + o + 8, true) << 64n);
const key = (data: Buffer | Uint8Array, o: number) =>
  new PublicKey(data.slice(DISC + o, DISC + o + 32));
const squares = (dv: DataView, o: number) =>
  Array.from({ length: 25 }, (_, i) => u64(dv, o + i * 8));

export type OreBoard = {
  roundId: bigint;
  startSlot: bigint;
  endSlot: bigint;
  /** Lamports per whole ORE, as an exponential moving average. */
  productionCostEma: bigint;
};

/**
 * The board is a singleton at a fixed address. `endSlot` is u64::MAX while a round
 * waits for its first deploy, so `started` is what to branch on, not a timer.
 */
export function decodeBoard(data: Buffer | Uint8Array): OreBoard {
  check(data, ORE_ACCOUNT_SIZE.board, 'board');
  const dv = view(data);
  return {
    roundId: u64(dv, 0),
    startSlot: u64(dv, 8),
    endSlot: u64(dv, 16),
    productionCostEma: u64(dv, 24),
  };
}

export type OreRound = {
  id: bigint;
  /** Lamports deployed on each of the 25 squares. */
  deployed: bigint[];
  /** Unique miners on each square. */
  count: bigint[];
  /** Entropy for the round. All zeroes until the round is settled. */
  slotHash: Uint8Array;
  /** Slot after which this account may be closed and its rewards are forfeit. */
  expiresAt: bigint;
  /** ORE paid out as the motherlode this round, in grams. */
  motherlode: bigint;
  rentPayer: PublicKey;
  /** ORE to hand out per square, in grams. Only the winning square is non-zero. */
  rewards: bigint[];
  /** Lamports kept by the protocol. */
  totalVaulted: bigint;
  /** Lamports returned to miners. */
  totalReturnedSol: bigint;
  totalMiners: bigint;
  /**
   * The solo winner, or SPLIT_ADDRESS when the square's reward is shared between
   * everyone on it. Zeroed until the round settles.
   */
  topMiner: PublicKey;
};

export function decodeRound(data: Buffer | Uint8Array): OreRound {
  check(data, ORE_ACCOUNT_SIZE.round, 'round');
  const dv = view(data);
  return {
    id: u64(dv, 0),
    deployed: squares(dv, 8),
    // 208 is Round.mass, which the deployed program never writes. Skipped on purpose.
    count: squares(dv, 408),
    slotHash: Uint8Array.prototype.slice.call(data, DISC + 608, DISC + 640),
    expiresAt: u64(dv, 640),
    motherlode: u64(dv, 648),
    rentPayer: key(data, 656),
    rewards: squares(dv, 688),
    totalVaulted: u64(dv, 888),
    totalReturnedSol: u64(dv, 896),
    totalMiners: u64(dv, 904),
    topMiner: key(data, 912),
  };
}

export type OreMiner = {
  authority: PublicKey;
  /** Non-zero to have SOL winnings sent straight back to the wallet. */
  autoReturn: bigint;
  /** The last round this miner was settled for. Equal to roundId means settled. */
  checkpointId: bigint;
  /** Lamports held back to pay whoever checkpoints this miner. */
  checkpointFee: bigint;
  /** Lamports this miner has on each square in the current round. */
  deployed: bigint[];
  /**
   * The running total already on each square when this miner deployed there. ORE
   * samples a point in [0, square total) to pick the solo winner and gives it to
   * whoever's [cumulative, cumulative + deployed) interval contains it, so a
   * deploy's odds are its share of the square, not how early it landed.
   */
  cumulative: bigint[];
  roundId: bigint;
  /** Steel fixed-point. Only meaningful against the treasury's own factor. */
  rewardsFactor: bigint;
  /** Lamports returned and claimable. */
  rewardsSol: bigint;
  /** Grams of ORE already refined, claimable with no fee. */
  refinedOre: bigint;
  /** Grams of ORE mined but unrefined. ORE takes 10% of this on claim. */
  rewardsOre: bigint;
  lastClaimOreAt: bigint;
  lastClaimSolAt: bigint;
  lifetimeRewardsOre: bigint;
  lifetimeDeployed: bigint;
  lifetimeRewardsSol: bigint;
};

export function decodeMiner(data: Buffer | Uint8Array): OreMiner {
  check(data, ORE_ACCOUNT_SIZE.miner, 'miner');
  const dv = view(data);
  return {
    authority: key(data, 0),
    autoReturn: u64(dv, 32),
    checkpointId: u64(dv, 40),
    checkpointFee: u64(dv, 48),
    deployed: squares(dv, 56),
    // 256 is Miner.mass, never written by the deployed program.
    cumulative: squares(dv, 456),
    roundId: u64(dv, 656),
    rewardsFactor: u128(dv, 664),
    rewardsSol: u64(dv, 680),
    refinedOre: u64(dv, 688),
    rewardsOre: u64(dv, 696),
    lastClaimOreAt: i64(dv, 704),
    lastClaimSolAt: i64(dv, 712),
    lifetimeRewardsOre: u64(dv, 720),
    lifetimeDeployed: u64(dv, 728),
    lifetimeRewardsSol: u64(dv, 736),
  };
}

export type OreConfig = {
  adminAuthority: PublicKey;
  adminFeeCollector: PublicKey;
  /** Basis points taken by the admin. 100 is 1%. */
  adminFeeRate: bigint;
  protocolAuthority: PublicKey;
  protocolFeeCollector: PublicKey;
  /** Basis points taken by the protocol from losing squares. 1000 is 10%. */
  protocolFeeRate: bigint;
  intermissionSlots: bigint;
  roundSlots: bigint;
};

/**
 * Round length lives here, so read it rather than assuming 200 slots. The account's
 * entropy fields are left out: they read as the system program on mainnet and the
 * deploy handler checks its own hardcoded addresses instead.
 */
export function decodeConfig(data: Buffer | Uint8Array): OreConfig {
  check(data, ORE_ACCOUNT_SIZE.config, 'config');
  const dv = view(data);
  return {
    adminAuthority: key(data, 0),
    adminFeeCollector: key(data, 32),
    adminFeeRate: u64(dv, 64),
    protocolAuthority: key(data, 72),
    protocolFeeCollector: key(data, 104),
    protocolFeeRate: u64(dv, 136),
    intermissionSlots: u64(dv, 144),
    roundSlots: u64(dv, 152),
  };
}

export type OreTreasury = {
  /** Grams of ORE sitting in the motherlode pool. */
  motherlode: bigint;
  minerRewardsFactor: bigint;
  totalRefined: bigint;
  totalUnclaimed: bigint;
};

export function decodeTreasury(data: Buffer | Uint8Array): OreTreasury {
  check(data, ORE_ACCOUNT_SIZE.treasury, 'treasury');
  const dv = view(data);
  return {
    motherlode: u64(dv, 0),
    minerRewardsFactor: u128(dv, 8),
    totalRefined: u64(dv, 24),
    totalUnclaimed: u64(dv, 32),
  };
}

export type OreAutomation = {
  /** Lamports to deploy on each chosen square, per round. */
  amount: bigint;
  authority: PublicKey;
  /** Lamports left to spend. */
  balance: bigint;
  /** Who may run this. EXECUTOR_ADDRESS means anyone. */
  executor: PublicKey;
  /** Lamports the executor earns per deploy. */
  fee: bigint;
  strategy: bigint;
  /** Bitmask of squares, or a square count when the strategy is Random. */
  mask: bigint;
  /** Non-zero to roll winnings back into the balance. */
  reload: bigint;
  totalSolSpent: bigint;
  totalOreEarned: bigint;
  conditions: {
    maxProductionCost: bigint;
    /** Whole ORE, not grams. */
    minMotherlode: number;
    maxMotherlode: number;
    splitTiles: number;
    soloTiles: number;
  };
};

/**
 * An automation is optional; a miner who deploys by hand has no such account, and
 * getAccountInfo returns null. Callers should treat that as "not automated" rather
 * than an error.
 */
export function decodeAutomation(data: Buffer | Uint8Array): OreAutomation {
  check(data, ORE_ACCOUNT_SIZE.automation, 'automation');
  const dv = view(data);
  return {
    amount: u64(dv, 0),
    authority: key(data, 8),
    balance: u64(dv, 40),
    executor: key(data, 48),
    fee: u64(dv, 80),
    strategy: u64(dv, 88),
    mask: u64(dv, 96),
    reload: u64(dv, 104),
    totalSolSpent: u64(dv, 112),
    totalOreEarned: u64(dv, 120),
    conditions: {
      maxProductionCost: u64(dv, 128),
      minMotherlode: u16(dv, 136),
      maxMotherlode: u16(dv, 138),
      splitTiles: u16(dv, 140),
      soloTiles: u16(dv, 142),
    },
  };
}

/**
 * Which of the 25 squares pay one winner rather than splitting, for a given round.
 * This is ORE's own rule, reimplemented: keccak the round id, Fisher-Yates shuffle
 * the indices with it, and the first ten are the solo squares. A set bit means solo.
 *
 * Gali needs this before the round settles, to show a player what they are buying
 * into. It has to match ORE exactly or the UI lies, so it is covered by a test
 * against known round ids.
 */
export function distributionMask(roundId: bigint, keccak256: (data: Uint8Array) => Uint8Array): number {
  const id = Buffer.alloc(8);
  new DataView(id.buffer, id.byteOffset, 8).setBigUint64(0, roundId, true);
  let randomness = keccak256(id);
  let offset = 0;

  const indices = Array.from({ length: 25 }, (_, i) => i);
  for (let i = 24; i >= 1; i--) {
    if (offset + 2 > randomness.length) {
      randomness = keccak256(randomness);
      offset = 0;
    }
    const r = randomness[offset] | (randomness[offset + 1] << 8);
    const j = r % (i + 1);
    [indices[i], indices[j]] = [indices[j], indices[i]];
    offset += 2;
  }

  let mask = 0;
  for (const idx of indices.slice(0, 10)) mask |= 1 << idx;
  return mask >>> 0;
}

/** True when the square's ORE reward is shared by everyone on it. */
export const isSplitSquare = (mask: number, square: number) => (mask & (1 << square)) === 0;
