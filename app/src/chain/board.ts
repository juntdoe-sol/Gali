/**
 * The board, as the rest of the app sees it.
 *
 * The game asks the same questions it always did: what is on the board this
 * round, what did the last round pay, what is waiting for me to claim, put my
 * SOL on these squares. Those questions still make sense now that the round
 * belongs to ORE. What changed is where the answers come from.
 *
 * So this is the seam. Everything above it is the game; everything below it is
 * ORE's program. Nothing here invents a number: each field traces to an account
 * ORE owns, and the ones ORE does not track are absent rather than faked.
 */
import './polyfill-web';
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { connection } from './client';
import { NOTHING_CLAIMABLE, REFINING_FEE, REFINING_FEE_BPS } from './light';
import { ORE_SPLIT_ADDRESS_B58 } from './ore/consts';
import {
  fetchClock,
  fetchOreMiner,
  fetchOreRound,
  fetchOreTreasury,
  needsCheckpoint,
  ORE_REFINING_BPS,
  readRewards,
} from './ore/read';
import { oreCheckpoint, oreClaimOre, oreClaimSol, oreDeploy, toOre, toSol } from './ore/tx';

export type { OreClock } from './ore/read';

/** ORE has 11 decimals; one whole ORE is 100 billion grams. */
export const ORE_UNIT = 100_000_000_000;

/** What ORE charges on claiming ORE that has not been refined yet. Their fee, not Gali's. */
export { REFINING_FEE };
// light.ts keeps a copy of ORE's refining fee so the startup bundle can show it without web3.
if (Number(ORE_REFINING_BPS) !== REFINING_FEE_BPS)
  console.error(`[gali] light.ts REFINING_FEE_BPS (${REFINING_FEE_BPS}) is out of step with ORE_REFINING_BPS (${ORE_REFINING_BPS})`);

/** A round's state, as the quarry renders it. */
export interface BoardRound {
  roundId: number;
  /** Lamports on each of the 25 squares, in SOL. */
  perSquare: number[];
  /** Total SOL on the board. */
  total: number;
  /** SOL returned to the winning square, after ORE's fees. */
  returned: number;
  /** SOL ORE kept: 1% of every square plus 10% of each losing square. */
  fees: number;
  /** Whole ORE mined by the winning square. */
  oreReward: number;
  /** Whole ORE paid from ORE's motherlode, non-zero only on a hit. */
  motherlodeOre: number;
  /** True when ORE's motherlode paid out this round. */
  motherlode: boolean;
  /** True when the winning square is shared rather than taken by one wallet. */
  split: boolean;
  /** The solo winner once the round has settled, else null. */
  winner: string | null;
  /** Unique wallets that played. */
  miners: number;
  /** The winning square, or null before the draw. */
  winning: number | null;
  settled: boolean;
}

/** Reads one ORE round into the shape the quarry and the Rounds tab want. */
export async function fetchBoardRound(roundId: number | bigint): Promise<BoardRound | null> {
  const r = await fetchOreRound(connection, BigInt(roundId));
  if (!r) return null;

  const perSquare = r.deployed.map((v) => Number(v) / LAMPORTS_PER_SOL);
  const total = perSquare.reduce((a, b) => a + b, 0);
  const settled = r.slotHash.some((b) => b !== 0);

  let winning: number | null = null;
  if (settled) {
    let rng = 0n;
    for (let i = 0; i < 4; i++) {
      const view = new DataView(r.slotHash.buffer, r.slotHash.byteOffset + i * 8, 8);
      rng ^= view.getBigUint64(0, true);
    }
    winning = Number(rng % 25n);
  }

  const top = r.topMiner.toBase58();
  const split = top === ORE_SPLIT_ADDRESS_B58;
  return {
    roundId: Number(r.id),
    perSquare,
    total,
    returned: Number(r.totalReturnedSol) / LAMPORTS_PER_SOL,
    fees: Number(r.totalVaulted) / LAMPORTS_PER_SOL,
    oreReward: r.rewards.reduce((a, b) => a + Number(b), 0) / ORE_UNIT,
    motherlodeOre: Number(r.motherlode) / ORE_UNIT,
    motherlode: r.motherlode > 0n,
    split,
    winner: settled && !split && !r.topMiner.equals(PublicKey.default) ? top : null,
    miners: Number(r.totalMiners),
    winning,
    settled,
  };
}

/** The last `limit` finished rounds, newest first. Stops at the first one ORE has closed. */
export async function fetchPastBoardRounds(beforeRound: number, limit = 12): Promise<BoardRound[]> {
  const out: BoardRound[] = [];
  for (let id = beforeRound - 1; id > 0 && out.length < limit; id--) {
    const r = await fetchBoardRound(id);
    // ORE reclaims a round's rent a day after it ends, so a gap here is the end of history.
    if (!r) break;
    if (r.settled) out.push(r);
  }
  return out;
}

/** What the rewards panel shows, read off the player's own ORE miner account. */
export interface Claimable {
  /** SOL returned by ORE and waiting. */
  sol: number;
  /** Whole ORE mined but not refined. Claiming costs ORE's 10%. */
  unrefined: number;
  /** Whole ORE already refined. Claims with no fee. */
  refined: number;
  /** What the 10% would cost right now. */
  fee: number;
  /** The round the miner account currently holds. */
  roundId: number;
  /** False while a finished round still needs checkpointing. */
  settled: boolean;
}

export { NOTHING_CLAIMABLE };

export async function fetchClaimable(owner: PublicKey): Promise<Claimable> {
  const [clock, miner] = await Promise.all([
    fetchClock(connection),
    fetchOreMiner(connection, owner),
  ]);
  const r = readRewards(miner, clock);
  return {
    sol: toSol(r.sol),
    unrefined: toOre(r.unrefined),
    refined: toOre(r.refined),
    fee: toOre(r.refiningFee),
    roundId: Number(r.roundId),
    settled: r.checkpointed,
  };
}

/** The live round, its phase, and how long is left in it. */
/** Put SOL on squares in the live round, signed by the session key. */
export async function deployToBoard(
  owner: PublicKey,
  session: Keypair,
  squares: number[],
  solPerSquare: number,
): Promise<string> {
  return oreDeploy(owner, session, squares, BigInt(Math.floor(solPerSquare * LAMPORTS_PER_SOL)));
}

/**
 * Settle a finished round for this player so ORE credits them and lets them play
 * again. Returns the round it settled, or null when there was nothing to do.
 */
export async function settleBoardRound(
  owner: PublicKey,
  session: Keypair,
): Promise<bigint | null> {
  const [clock, miner] = await Promise.all([
    fetchClock(connection),
    fetchOreMiner(connection, owner),
  ]);
  const pending = needsCheckpoint(miner, clock);
  if (pending === null) return null;
  await oreCheckpoint(session, owner, pending);
  return pending;
}

/** What a finished round paid this player. */
export interface RoundOutcome {
  roundId: number;
  /** The square that struck gold. */
  winning: number;
  /** True when ORE's motherlode paid out this round. */
  motherlode: boolean;
  /** True when the winning square was shared rather than taken by one wallet. */
  split: boolean;
  /** True when this player took the solo reward. */
  lucky: boolean;
  /** SOL ORE returned to this player for the round. */
  payout: number;
  /** Whole ORE this player mined. */
  oreMined: number;
  /** Whole ORE from ORE's motherlode, non-zero only on a hit they shared in. */
  oreMotherlode: number;
  /** This player's share of the SOL on the winning square, 0 to 1. Gali's SKR jackpot splits the same way. */
  share: number;
}

/** ORE takes 1% of every square, and 10% of each losing square on top. */
const squareAdmin = (total: bigint) => (total / 100n > 0n ? total / 100n : 1n);
const squareProtocol = (rest: bigint) => (rest / 10n > 0n ? rest / 10n : 1n);

/**
 * Settle a round for this player and work out what it paid them.
 *
 * The figures are recomputed here from the round and miner accounts rather than
 * read back as a balance change, because a balance delta cannot tell a round's
 * payout apart from anything else that touched the account in the same slot.
 * The arithmetic mirrors ORE's own checkpoint, fee for fee.
 */
export async function settleAndRead(
  owner: PublicKey,
  session: Keypair,
  roundId: number,
): Promise<RoundOutcome> {
  await settleBoardRound(owner, session).catch(() => null);

  const [round, miner] = await Promise.all([
    fetchOreRound(connection, BigInt(roundId)),
    fetchOreMiner(connection, owner),
  ]);
  if (!round || !miner) throw new Error(`ORE round ${roundId} is gone; it expired before it was settled`);

  const view = await fetchBoardRound(roundId);
  if (!view || view.winning === null) throw new Error(`ORE round ${roundId} has not been drawn`);
  const w = view.winning;

  let lamports = 0n;
  for (let i = 0; i < 25; i++) {
    const total = round.deployed[i];
    const mine = miner.deployed[i];
    if (total === 0n || mine === 0n) continue;
    const admin = squareAdmin(total);
    const rest = total - admin;
    const returned = i === w ? rest : rest - squareProtocol(rest);
    lamports += (mine * returned) / total;
  }

  const sqTotal = round.deployed[w];
  const mineOnWin = miner.deployed[w];
  const rewardGrams = round.rewards.reduce((a, b) => a + b, 0n);

  let oreGrams = 0n;
  let lucky = false;
  if (sqTotal > 0n && mineOnWin > 0n) {
    if (view.split) {
      oreGrams = (rewardGrams * mineOnWin) / sqTotal;
    } else {
      lucky = round.topMiner.equals(owner);
      if (lucky) oreGrams = rewardGrams;
    }
  }
  const motherGrams =
    round.motherlode > 0n && sqTotal > 0n && mineOnWin > 0n
      ? (round.motherlode * mineOnWin) / sqTotal
      : 0n;

  return {
    roundId,
    winning: w,
    motherlode: round.motherlode > 0n,
    split: view.split,
    lucky,
    payout: Number(lamports) / LAMPORTS_PER_SOL,
    oreMined: Number(oreGrams) / ORE_UNIT,
    oreMotherlode: Number(motherGrams) / ORE_UNIT,
    share: sqTotal > 0n ? Number(mineOnWin) / Number(sqTotal) : 0,
  };
}

/** Whole ORE waiting in ORE's motherlode right now. */
export async function fetchOreMotherlode(): Promise<number> {
  const t = await fetchOreTreasury(connection);
  return Number(t.motherlode) / ORE_UNIT;
}

export const claimBoardSol = oreClaimSol;
export const claimBoardOre = oreClaimOre;
