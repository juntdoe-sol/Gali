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
import '../polyfill-web';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ComputeBudgetProgram, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { assertSessionFundingAllowed, connection, sendWithKey, sendWithWallet } from '../client';
import { LIVE_AUTOPILOT_MAX_SOL } from '../light';
import { AUTOMATION_STRATEGY, EXECUTOR_ADDRESS } from './consts';
import { automateIx, checkpointIx, claimOreIx, claimSolIx, deployIx } from './ix';
import { fetchClock, fetchOreAutomation, fetchOreMiner, needsCheckpoint } from './read';

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
 * A small priority fee, so a wallet-signed transaction still lands when mainnet is
 * busy. 20,000 micro-lamports per compute unit is about 0.000004 SOL per 200k units.
 */
export const PRIORITY_MICROLAMPORTS = 20_000;
const priorityIx = () => ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICROLAMPORTS });

/** A checkpoint for the finished round this miner still holds, or nothing. Signed by the owner. */
async function checkpointFirst(owner: PublicKey): Promise<TransactionInstruction[]> {
  const [clock, miner] = await Promise.all([fetchClock(connection), fetchOreMiner(connection, owner)]);
  const pending = needsCheckpoint(miner, clock);
  return pending === null ? [] : [checkpointIx({ signer: owner, authority: owner, roundId: pending })];
}

/**
 * Slots before the end of mining when the app stops offering a deploy. A wallet
 * approval takes a few seconds, and a deploy that lands after the round closes fails.
 */
export const LIVE_LOCK_SLOTS = 15;

/**
 * Deploy into the current ORE round, signed and paid by the player's own wallet.
 * No session key and no Gali program: this is a plain ORE deploy, the same one
 * ORE's own site sends. Checkpoints the previous round first when ORE needs it.
 *
 * Returns the round it deployed into, read at signing time, because ORE's round
 * id is the board's and not something the app can work out from the clock.
 */
export async function oreDeployWithWallet(
  squares: number[],
  lamportsPerSquare: bigint,
  expectedOwner?: PublicKey,
): Promise<{ sig: string; roundId: bigint }> {
  let roundId = 0n;
  const sig = await sendWithWallet(async (owner) => {
    const [clock, miner] = await Promise.all([fetchClock(connection), fetchOreMiner(connection, owner)]);
    if (clock.phase === 'intermission' || (clock.phase === 'mining' && clock.slotsLeft < LIVE_LOCK_SLOTS)) {
      throw new Error('RoundLocked');
    }
    roundId = clock.roundId;
    const ixs: TransactionInstruction[] = [priorityIx()];
    const pending = needsCheckpoint(miner, clock);
    if (pending !== null) ixs.push(checkpointIx({ signer: owner, authority: owner, roundId: pending }));
    ixs.push(
      deployIx({ signer: owner, authority: owner, roundId, amount: lamportsPerSquare, squares: squaresToMask(squares) }),
    );
    return ixs;
  }, expectedOwner);
  return { sig, roundId };
}

/**
 * Claim mined ORE to the player's own token account.
 *
 * `bps` is how much of the balance to take; 10,000 is all of it. ORE charges its
 * own 10% on the unrefined part. That is their mechanic and their fee, and the UI
 * shows it before the player signs rather than after.
 *
 * A round that finished but was never checkpointed is settled in the same
 * transaction, so its rewards are part of the claim.
 */
export async function oreClaimOre(bps = 10_000, expectedOwner?: PublicKey): Promise<string> {
  return sendWithWallet(async (owner) => [priorityIx(), ...(await checkpointFirst(owner)), claimOreIx({ authority: owner, bps })], expectedOwner);
}

/** Claim SOL that ORE returned to the player, checkpointing a finished round first. */
export async function oreClaimSol(expectedOwner?: PublicKey): Promise<string> {
  return sendWithWallet(async (owner) => [priorityIx(), ...(await checkpointFirst(owner)), claimSolIx({ authority: owner })], expectedOwner);
}

/**
 * What Gali charges to run a player's automation, in basis points of what they
 * deploy that round. 100 is 1%.
 *
 * This is the platform's recurring revenue, and it is deliberately a share of
 * volume rather than a flat amount per round: a player putting 0.05 SOL on the
 * board costs us the same transaction as one putting 5 SOL, but the second is
 * worth far more to run well. ORE pays it to whoever signed the deploy, out of the
 * automation balance, once per round.
 *
 * For scale, ORE's own take is 1% of every square plus 10% of every losing one, so
 * 1% on top is a small part of what a round costs a player. The player sets it, so
 * it can be undercut, which is the honest shape for a fee we charge rather than a
 * rake we impose.
 */
export const EXECUTOR_FEE_BPS = 100n;

/** What one round of a given automation costs, including Gali's fee. */
export const automationRoundCost = (lamportsPerSquare: bigint, squares: number) => {
  const deployed = lamportsPerSquare * BigInt(squares);
  return deployed + (deployed * EXECUTOR_FEE_BPS) / 10_000n;
};

/**
 * Hand the session key the right to deploy for this player, and fund it.
 *
 * `rounds` is how many rounds of play to top the automation up for, which is the
 * number a player actually thinks in.
 *
 * The strategy is DiscretionaryBps, which is the one where the executor supplies
 * the squares. That matches what Gali already does for a player who taps Smart
 * pick, and it is the only strategy where the fee is a share of the deploy rather
 * than a flat amount.
 */
export async function startOreAutomation(args: {
  session: Keypair;
  squares: number[];
  lamportsPerSquare: bigint;
  rounds: number;
  /** Basis points of each round's deploy. Defaults to Gali's rate. */
  feeBps?: bigint;
  /** Let any bot run it instead of Gali's key. */
  openExecutor?: boolean;
}): Promise<string> {
  assertSessionFundingAllowed();
  const mask = squaresToMask(args.squares);
  const feeBps = args.feeBps ?? EXECUTOR_FEE_BPS;
  const deployed = args.lamportsPerSquare * BigInt(args.squares.length);
  const perRound = deployed + (deployed * feeBps) / 10_000n;
  const deposit = perRound * BigInt(Math.max(1, args.rounds));
  return sendWithWallet(async (owner) => [
    automateIx({
      authority: owner,
      amount: args.lamportsPerSquare,
      deposit,
      fee: feeBps,
      mask,
      strategy: AUTOMATION_STRATEGY.DiscretionaryBps,
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
      strategy: AUTOMATION_STRATEGY.DiscretionaryBps,
      reload: false,
      executor: session.publicKey,
    }),
  ]);
}

/* ---------------- live autopilot: ORE's own automation ----------------
 * One wallet approval funds an ORE automation account and names a small device key as its
 * executor. After that the device key deploys each round with no pop-up. What the key can do
 * is fixed by ORE: it can only deploy the automation's balance onto the board (never withdraw
 * it), and the player can close the automation any time and get the balance back.
 */
/** SOL left on the executor key to pay its own transaction fees. A system account must stay above rent-exempt (~0.00089 SOL). */
export const EXECUTOR_TOPUP_LAMPORTS = 2_000_000;
const EXECUTOR_MIN_LAMPORTS = 1_500_000;
const execKey = (owner: PublicKey) => `gali-ore-exec-${owner.toBase58()}`;

/** The device key that runs this player's automation. Created on first use, kept on the device. */
export async function loadExecutor(owner: PublicKey, create = false): Promise<Keypair | null> {
  const raw = await AsyncStorage.getItem(execKey(owner));
  if (raw) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  if (!create) return null;
  const k = Keypair.generate();
  await AsyncStorage.setItem(execKey(owner), JSON.stringify(Array.from(k.secretKey)));
  return k;
}

/** The player's automation as the app needs it, or null when they deploy by hand. */
export async function readAutomation(owner: PublicKey) {
  const a = await fetchOreAutomation(connection, owner);
  if (!a) return null;
  const mine = (await loadExecutor(owner))?.publicKey;
  return {
    balance: toSol(a.balance),
    perSpot: toSol(a.amount),
    spent: toSol(a.totalSolSpent),
    executor: a.executor,
    runnable: Boolean(mine && a.executor.equals(mine)),
  };
}

/**
 * Fund an automation and hand the device key the right to run it. `maxSquares` is the most
 * spots any round will use; the deposit covers `rounds` rounds of that. One wallet approval.
 */
export async function startLiveAutomation(args: {
  lamportsPerSquare: bigint;
  maxSquares: number;
  rounds: number;
  expectedOwner?: PublicKey;
}): Promise<void> {
  if (args.rounds < 1 || args.maxSquares < 1 || args.maxSquares > 25) throw new Error('Bad autopilot setup');
  const deposit = args.lamportsPerSquare * BigInt(args.maxSquares) * BigInt(args.rounds);
  if (Number(deposit) / LAMPORTS_PER_SOL > LIVE_AUTOPILOT_MAX_SOL + 1e-9) throw new Error(`Autopilot is capped at ${LIVE_AUTOPILOT_MAX_SOL} SOL`);
  await sendWithWallet(async (owner) => {
    if (await fetchOreAutomation(connection, owner)) throw new Error('Autopilot is already on. Stop it first');
    const exec = (await loadExecutor(owner, true)) as Keypair;
    const have = await connection.getBalance(exec.publicKey);
    const ixs: TransactionInstruction[] = [priorityIx()];
    if (have < EXECUTOR_MIN_LAMPORTS) ixs.push(SystemProgram.transfer({ fromPubkey: owner, toPubkey: exec.publicKey, lamports: EXECUTOR_TOPUP_LAMPORTS - have }));
    ixs.push(
      automateIx({
        authority: owner,
        amount: args.lamportsPerSquare,
        deposit,
        fee: 0n,
        mask: 0,
        strategy: AUTOMATION_STRATEGY.DiscretionaryBps,
        reload: false,
        executor: exec.publicKey,
      }),
    );
    return ixs;
  }, args.expectedOwner);
}

/**
 * Deploy one round from the automation, signed by the device key: no wallet pop-up.
 * Checkpoints the previous round first when ORE needs it. Returns the round it went into.
 */
export async function deployFromAutomation(owner: PublicKey, squares: number[], lamportsPerSquare: bigint): Promise<bigint> {
  const exec = await loadExecutor(owner);
  if (!exec) throw new Error('This device does not hold the autopilot key. Stop autopilot from the wallet panel');
  const [clock, miner] = await Promise.all([fetchClock(connection), fetchOreMiner(connection, owner)]);
  if (clock.phase === 'intermission' || (clock.phase === 'mining' && clock.slotsLeft < LIVE_LOCK_SLOTS)) throw new Error('RoundLocked');
  const ixs: TransactionInstruction[] = [priorityIx()];
  const pending = needsCheckpoint(miner, clock);
  if (pending !== null) ixs.push(checkpointIx({ signer: exec.publicKey, authority: owner, roundId: pending }));
  ixs.push(deployIx({ signer: exec.publicKey, authority: owner, roundId: clock.roundId, amount: lamportsPerSquare, squares: squaresToMask(squares) }));
  await sendWithKey(exec, ixs);
  return clock.roundId;
}

/** Close the automation and get what is left of its balance back. One wallet approval. */
export async function closeLiveAutomation(expectedOwner?: PublicKey): Promise<void> {
  await sendWithWallet(async (owner) => {
    if (!(await fetchOreAutomation(connection, owner))) throw new Error('Autopilot is not running');
    return [
      priorityIx(),
      // a zero executor tells ORE to close the account and return its balance to the player
      automateIx({ authority: owner, amount: 0n, deposit: 0n, fee: 0n, mask: 0, strategy: AUTOMATION_STRATEGY.DiscretionaryBps, reload: false, executor: PublicKey.default }),
    ];
  }, expectedOwner);
}

/** Lamports to whole SOL, for display. */
export const toSol = (lamports: bigint) => Number(lamports) / LAMPORTS_PER_SOL;
/** Grams of ORE to whole ORE, for display. ORE has 11 decimals. */
export const toOre = (grams: bigint) => Number(grams) / 1e11;
