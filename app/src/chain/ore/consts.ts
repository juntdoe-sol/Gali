/**
 * $ORE protocol constants.
 *
 * ORE is built with Steel, not Anchor, so there is no IDL and no generated client.
 * Every value here is copied from ore-api's consts.rs and checked against live
 * mainnet accounts by scripts/ore-probe.ts, whose output is scripts/ore-layout.json.
 *
 * ORE runs on mainnet only. There is no devnet deployment; local testing uses
 * ORE's own localnet.sh.
 */
import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';

export const ORE_PROGRAM_ID = new PublicKey('oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv');
export const ORE_MINT = new PublicKey('oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp');

/**
 * entropy-api's program id. Not in ore-api's consts, and the copy in ORE's own
 * Config account is stale (it reads as the system program), so this is taken from
 * the owner of the var account on mainnet, which is the only authority the deploy
 * handler actually checks against.
 */
export const ENTROPY_PROGRAM_ID = new PublicKey('3jSkUuYBoJzQPMEzTvkDFXCZUBksPamrVhrnHR9igu2X');

/** ORE has 11 decimals, so one whole ORE is 100,000,000,000 indivisible units ("grams"). */
export const ORE_DECIMALS = 11;
export const ONE_ORE = 100_000_000_000n;

/** Singleton accounts at fixed addresses, not derived per call. */
export const BOARD_ADDRESS = new PublicKey('BrcSxdp1nXFzou1YyDnQJcPNBNHgoypZmTsyKBSLLXzi');
export const TREASURY_ADDRESS = new PublicKey('45db2FSR4mcXdSVVZbKbwojU6uYDpMyhpEi7cC8nHaWG');
export const CONFIG_ADDRESS = new PublicKey('9c9X7aDRAF41faiDs94ELjT19UrGnn72wBW9hPsS4Awy');
/** Entropy's var account, only needed by the deploy that starts a round. */
export const VAR_ADDRESS = new PublicKey('BWCaDY96Xe4WkFq1M7UiCCRcChsJ3p51L5KrGzhxgm2E');

/** Marks a round whose reward is split between everyone on the winning square. */
export const SPLIT_ADDRESS = new PublicKey('SpLiT11111111111111111111111111111111111112');
export const ORE_SPLIT_ADDRESS_B58 = 'SpLiT11111111111111111111111111111111111112';
/** Set as an automation's executor to let anyone run it. */
export const EXECUTOR_ADDRESS = new PublicKey('executor11111111111111111111111111111111112');

/** Paid to whoever checkpoints a miner, in lamports. */
export const CHECKPOINT_FEE = 10_000n;

/**
 * A round is 200 slots of mining then 40 slots of intermission, read from ORE's
 * Config on mainnet. Rounds are measured in slots, not wall-clock seconds, and the
 * clock only starts on the round's first deploy: until then Board.end_slot is
 * u64::MAX. At roughly 400ms a slot that is about 80 seconds of play.
 *
 * These are defaults for laying out the UI before Config has loaded. The live values
 * come from the Config account, which the admin can change.
 */
export const ROUND_SLOTS = 200n;
export const INTERMISSION_SLOTS = 40n;
/** Board.end_slot while a round is waiting for its first deploy. */
export const ROUND_NOT_STARTED = 18_446_744_073_709_551_615n;

export const CONFIG_SEED = Buffer.from('config');
export const BOARD_SEED = Buffer.from('board');
export const MINER_SEED = Buffer.from('miner');
export const ROUND_SEED = Buffer.from('round');
export const AUTOMATION_SEED = Buffer.from('automation');

/** The RN Buffer shim has no writeBigUInt64LE, so go through a DataView like the rest of the app. */
const u64le = (n: bigint | number) => {
  const b = Buffer.alloc(8);
  new DataView(b.buffer, b.byteOffset, 8).setBigUint64(0, BigInt(n), true);
  return b;
};

export const minerPda = (authority: PublicKey) =>
  PublicKey.findProgramAddressSync([MINER_SEED, authority.toBuffer()], ORE_PROGRAM_ID)[0];

export const roundPda = (roundId: bigint | number) =>
  PublicKey.findProgramAddressSync([ROUND_SEED, u64le(roundId)], ORE_PROGRAM_ID)[0];

export const automationPda = (authority: PublicKey) =>
  PublicKey.findProgramAddressSync([AUTOMATION_SEED, authority.toBuffer()], ORE_PROGRAM_ID)[0];

/**
 * Steel dispatches on a single leading byte. These are the values of
 * ore_api::instruction::OreInstruction.
 */
export const ORE_IX = {
  Automate: 0,
  Checkpoint: 2,
  ClaimSOL: 3,
  ClaimORE: 4,
  Close: 5,
  Deploy: 6,
  Log: 8,
  Reset: 9,
} as const;

/**
 * Automation strategies, from ore_api::state::AutomationStrategy. The order is not
 * alphabetical and not what you would guess: Random is zero.
 */
export const AUTOMATION_STRATEGY = {
  Random: 0,
  Preferred: 1,
  Discretionary: 2,
  DiscretionaryBps: 3,
} as const;
