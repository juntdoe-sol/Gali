/**
 * Instruction builders for the $ORE program.
 *
 * Steel encodes an instruction as one discriminant byte followed by a #[repr(C)]
 * args struct, so the bodies here are plain little-endian writes. Every account
 * list below was read off ORE's program/src/*.rs, where the accounts slice is
 * destructured positionally. Order is load-bearing: Steel never looks an account
 * up by name, so a list that is merely complete but out of order will fail in
 * confusing ways or, worse, pass the wrong account.
 */
import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import {
  automationPda,
  BOARD_ADDRESS,
  CONFIG_ADDRESS,
  ENTROPY_PROGRAM_ID,
  minerPda,
  ORE_IX,
  ORE_MINT,
  ORE_PROGRAM_ID,
  roundPda,
  TREASURY_ADDRESS,
  VAR_ADDRESS,
} from './consts';

const meta = (pubkey: PublicKey, isSigner: boolean, isWritable: boolean) => ({ pubkey, isSigner, isWritable });

/** The RN Buffer shim has no writeBigUInt64LE, so go through a DataView like the rest of the app. */
const putU64 = (b: Buffer, offset: number, n: bigint) =>
  new DataView(b.buffer, b.byteOffset, b.length).setBigUint64(offset, n, true);
const putU32 = (b: Buffer, offset: number, n: number) =>
  new DataView(b.buffer, b.byteOffset, b.length).setUint32(offset, n >>> 0, true);

/**
 * Put SOL on a set of squares in the current round.
 *
 * `signer` pays and signs. `authority` is the miner the deploy belongs to. They are
 * the same for a normal deploy and differ when an automation executor deploys for a
 * player, which is how Gali runs a round with no wallet pop-up.
 *
 * Accounts: signer, authority, automation, board, config, miner, round, treasury,
 * system, ore_program, then entropy's var and program. ORE splits the list at ten,
 * and only reads the entropy pair on the deploy that starts a round, but that deploy
 * is the one that has to be ready, so both are always sent.
 */
export function deployIx(args: {
  signer: PublicKey;
  authority: PublicKey;
  roundId: bigint | number;
  /** lamports per square */
  amount: bigint;
  /** bitmask of the 25 squares */
  squares: number;
}): TransactionInstruction {
  const data = Buffer.alloc(13);
  data.writeUInt8(ORE_IX.Deploy, 0);
  putU64(data, 1, args.amount);
  putU32(data, 9, args.squares);
  return new TransactionInstruction({
    programId: ORE_PROGRAM_ID,
    data,
    keys: [
      meta(args.signer, true, true),
      meta(args.authority, false, true),
      meta(automationPda(args.authority), false, true),
      meta(BOARD_ADDRESS, false, true),
      meta(CONFIG_ADDRESS, false, false),
      meta(minerPda(args.authority), false, true),
      meta(roundPda(args.roundId), false, true),
      meta(TREASURY_ADDRESS, false, true),
      meta(SystemProgram.programId, false, false),
      meta(ORE_PROGRAM_ID, false, false),
      meta(VAR_ADDRESS, false, true),
      meta(ENTROPY_PROGRAM_ID, false, false),
    ],
  });
}

/**
 * Claim mined ORE to the signer's own ORE account, creating it if needed.
 * `bps` is how much of the balance to take, so 10000 is all of it. ORE charges
 * its own refining fee on the unrefined part; that is their mechanic.
 *
 * The miner account is derived from the signer, so this cannot be cranked for
 * someone else.
 */
export function claimOreIx(args: { authority: PublicKey; bps?: number }): TransactionInstruction {
  const data = Buffer.alloc(9);
  data.writeUInt8(ORE_IX.ClaimORE, 0);
  putU64(data, 1, BigInt(args.bps ?? 10_000));
  const recipient = getAssociatedTokenAddressSync(ORE_MINT, args.authority, true);
  const treasuryTokens = getAssociatedTokenAddressSync(ORE_MINT, TREASURY_ADDRESS, true);
  return new TransactionInstruction({
    programId: ORE_PROGRAM_ID,
    data,
    keys: [
      meta(args.authority, true, true),
      meta(BOARD_ADDRESS, false, false),
      meta(minerPda(args.authority), false, true),
      meta(ORE_MINT, false, false),
      meta(recipient, false, true),
      meta(TREASURY_ADDRESS, false, true),
      meta(treasuryTokens, false, true),
      meta(SystemProgram.programId, false, false),
      meta(TOKEN_PROGRAM_ID, false, false),
      meta(ASSOCIATED_TOKEN_PROGRAM_ID, false, false),
      meta(ORE_PROGRAM_ID, false, false),
    ],
  });
}

/** Claim SOL returned to a miner. Accounts: signer, board, miner, system, ore_program. */
export function claimSolIx(args: { authority: PublicKey }): TransactionInstruction {
  return new TransactionInstruction({
    programId: ORE_PROGRAM_ID,
    data: Buffer.from([ORE_IX.ClaimSOL]),
    keys: [
      meta(args.authority, true, true),
      meta(BOARD_ADDRESS, false, false),
      meta(minerPda(args.authority), false, true),
      meta(SystemProgram.programId, false, false),
      meta(ORE_PROGRAM_ID, false, false),
    ],
  });
}

/**
 * Settle a miner's position for a finished round. Permissionless, and ORE pays the
 * caller a 10,000 lamport fee, so cranking for other players is not a loss.
 *
 * Accounts: signer, authority, automation, board, miner, round, treasury, system.
 */
export function checkpointIx(args: {
  signer: PublicKey;
  authority: PublicKey;
  roundId: bigint | number;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: ORE_PROGRAM_ID,
    data: Buffer.from([ORE_IX.Checkpoint]),
    keys: [
      meta(args.signer, true, true),
      meta(args.authority, false, true),
      meta(automationPda(args.authority), false, false),
      meta(BOARD_ADDRESS, false, false),
      meta(minerPda(args.authority), false, true),
      meta(roundPda(args.roundId), false, true),
      meta(TREASURY_ADDRESS, false, true),
      meta(SystemProgram.programId, false, false),
    ],
  });
}

/**
 * Create or update an automation: how much SOL to deploy each round, on which
 * squares, and who may execute it. Gali sets its own device key as `executor`, so a
 * player approves once and every later round deploys with no pop-up. `fee` is what
 * the executor earns per deploy, paid by ORE.
 *
 * Sends the v1 args struct, which ORE accepts and fills with default conditions.
 * Accounts: signer, automation, executor, miner, system.
 */
export function automateIx(args: {
  authority: PublicKey;
  /** lamports per square each round */
  amount: bigint;
  /** lamports to add to the automation's balance */
  deposit: bigint;
  /** lamports the executor earns per deploy */
  fee: bigint;
  /** bitmask of squares, or a count when the strategy is Random */
  mask: number;
  strategy: number;
  /** roll winnings back into the balance */
  reload: boolean;
  executor: PublicKey;
}): TransactionInstruction {
  // amount, deposit, fee, mask: u64 each; strategy: u8; reload: u64
  const data = Buffer.alloc(42);
  let o = 0;
  data.writeUInt8(ORE_IX.Automate, o); o += 1;
  putU64(data, o, args.amount); o += 8;
  putU64(data, o, args.deposit); o += 8;
  putU64(data, o, args.fee); o += 8;
  putU64(data, o, BigInt(args.mask >>> 0)); o += 8;
  data.writeUInt8(args.strategy, o); o += 1;
  putU64(data, o, args.reload ? 1n : 0n);
  return new TransactionInstruction({
    programId: ORE_PROGRAM_ID,
    data,
    keys: [
      meta(args.authority, true, true),
      meta(automationPda(args.authority), false, true),
      meta(args.executor, false, false),
      meta(minerPda(args.authority), false, true),
      meta(SystemProgram.programId, false, false),
    ],
  });
}
