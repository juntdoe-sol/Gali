/**
 * Playing ORE's board from the app.
 *
 * Gali's old round had the app talk only to Gali's program. On ORE's board the
 * player's position belongs to ORE, so deploying, checkpointing and claiming are
 * all calls to ORE. Gali's program is only told about a round after it finishes,
 * to award points and its SKR jackpot.
 *
 * The session key does not disappear; it changes job. Instead of holding a Gali
 * session that may deploy, it is registered as the *executor* of the player's ORE
 * automation. One wallet approval, and after that the key can deploy on the
 * player's behalf every round with no pop-up, exactly as before, except the rule
 * is enforced by ORE rather than by us and ORE pays the key a fee for the work.
 */
import { Keypair, LAMPORTS_PER_SOL, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { connection, sendWithKey, sendWithWallet } from '../client';
import { AUTOMATION_STRATEGY, EXECUTOR_ADDRESS } from './consts';
import { automateIx, checkpointIx, claimOreIx, claimSolIx, deployIx } from './ix';
import { fetchClock, fetchOreMiner, needsCheckpoint } from './read';

/** Turn a set of chosen squares into the 25-bit mask ORE expects. */
export const squaresToMask = (squares: number[]) =>
  squares.reduce((m, i) => (i >= 0 && i < 25 ? m | (1 << i) : m), 0) >>> 0;

export const maskToSquares = (mask: number) =>
  Array.from({ length: 25 }, (_, i) => i).filter((i) => (mask & (1 << i)) !== 0);

/**
 * Deploy into the current ORE round, paid and signed by the session key.
 *
 * ORE refuses a deploy while the previous round is unsettled, so this checkpoints
 * first when it has to. That is not a nicety: without it the deploy fails with an
 * assertion from inside ORE that means nothing to a player.
 */
export async function oreDeploy(
  owner: PublicKey,
  session: Keypair,
  squares: number[],
  lamportsPerSquare: bigint,
): Promise<string> {
  const clock = await fetchClock(connection);
  const miner = await fetchOreMiner(connection, owner);

  const ixs: TransactionInstruction[] = [];
  const pending = needsCheckpoint(miner, clock);
  if (pending !== null) {
    ixs.push(checkpointIx({ signer: session.publicKey, authority: owner, roundId: pending }));
  }
  ixs.push(
    deployIx({
      signer: session.publicKey,
      authority: owner,
      roundId: clock.roundId,
      amount: lamportsPerSquare,
      squares: squaresToMask(squares),
    }),
  );
  return sendWithKey(session, ixs);
}

/**
 * Settle a finished round for a player. Permissionless, and ORE pays the caller
 * 10,000 lamports for it, so cranking for other players costs nothing.
 */
export async function oreCheckpoint(
  signer: Keypair,
  authority: PublicKey,
  roundId: bigint,
): Promise<string> {
  return sendWithKey(signer, [checkpointIx({ signer: signer.publicKey, authority, roundId })]);
}

/**
 * Claim mined ORE to the player's own token account.
 *
 * `bps` is how much of the balance to take; 10,000 is all of it. ORE charges its
 * own 10% on the unrefined part. That is their mechanic and their fee, and the UI
 * shows it before the player signs rather than after.
 */
export async function oreClaimOre(bps = 10_000): Promise<string> {
  return sendWithWallet(async (owner) => [claimOreIx({ authority: owner, bps })]);
}

/** Claim SOL that ORE returned to the player. */
export async function oreClaimSol(): Promise<string> {
  return sendWithWallet(async (owner) => [claimSolIx({ authority: owner })]);
}

/** What one round of a given automation costs, before ORE's executor fee. */
export const automationRoundCost = (lamportsPerSquare: bigint, squares: number) =>
  lamportsPerSquare * BigInt(squares);

/**
 * Hand the session key the right to deploy for this player, and fund it.
 *
 * `rounds` is how many rounds of play to top the automation up for, which is the
 * number a player actually thinks in. `feePerDeploy` is what the executor earns
 * from ORE for each deploy it runs; it is set by the player, so Gali can be
 * undercut on it, which is the right shape for a fee we charge.
 */
export async function startOreAutomation(args: {
  session: Keypair;
  squares: number[];
  lamportsPerSquare: bigint;
  rounds: number;
  feePerDeploy: bigint;
  /** Let any bot run it instead of Gali's key. */
  openExecutor?: boolean;
}): Promise<string> {
  const mask = squaresToMask(args.squares);
  const perRound = automationRoundCost(args.lamportsPerSquare, args.squares.length) + args.feePerDeploy;
  const deposit = perRound * BigInt(Math.max(1, args.rounds));
  return sendWithWallet(async (owner) => [
    automateIx({
      authority: owner,
      amount: args.lamportsPerSquare,
      deposit,
      fee: args.feePerDeploy,
      mask,
      strategy: AUTOMATION_STRATEGY.Preferred,
      reload: false,
      executor: args.openExecutor ? EXECUTOR_ADDRESS : args.session.publicKey,
    }),
  ]);
}

/**
 * Stop automating: set the deposit to zero and the amount to zero.
 *
 * ORE closes an automation itself once its balance cannot cover another round, so
 * this drains it rather than fighting for a close instruction that does not exist.
 */
export async function stopOreAutomation(session: Keypair): Promise<string> {
  return sendWithWallet(async (owner) => [
    automateIx({
      authority: owner,
      amount: 0n,
      deposit: 0n,
      fee: 0n,
      mask: 0,
      strategy: AUTOMATION_STRATEGY.Preferred,
      reload: false,
      executor: session.publicKey,
    }),
  ]);
}

/** Lamports to whole SOL, for display. */
export const toSol = (lamports: bigint) => Number(lamports) / LAMPORTS_PER_SOL;
/** Grams of ORE to whole ORE, for display. ORE has 11 decimals. */
export const toOre = (grams: bigint) => Number(grams) / 1e11;
