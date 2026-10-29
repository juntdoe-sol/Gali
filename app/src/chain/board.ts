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
import { Buffer } from 'buffer';
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { connection, fetchOreBalance, fetchSolBalance } from './client';
import { NOTHING_CLAIMABLE, REFINING_FEE, REFINING_FEE_BPS } from './light';
import { ORE_MINT, ORE_SPLIT_ADDRESS_B58, TREASURY_ADDRESS } from './ore/consts';
import {
  fetchClock,
  readClock,
  fetchOreMiner,
  fetchOreRound,
  fetchOreRounds,
  fetchOreTreasury,
  needsCheckpoint,
  ORE_REFINING_BPS,
  readRewards,
} from './ore/read';
import { closeLiveAutomation, deployFromAutomation, oreCheckpoint, oreClaimOre, oreClaimSol, oreDeploy, oreDeployWithWallet, readAutomation, startLiveAutomation, toOre, toSol } from './ore/tx';
import { decodeBoard, decodeMiner, decodeRound, decodeTreasury, distributionMask, type OreMiner, type OreRound } from './ore/accounts';
import { minerPda } from './ore/consts';

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
  return r ? boardRoundOf(r) : null;
}

/** An already-read ORE round in the shape the quarry and the Rounds tab want. */
function boardRoundOf(r: OreRound): BoardRound {

  const perSquare = r.deployed.map((v) => Number(v) / LAMPORTS_PER_SOL);
  const total = perSquare.reduce((a, b) => a + b, 0);
  const winning = winningOf(r);
  const settled = rngOf(r) !== null;

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

/**
 * The last `limit` finished rounds, newest first, in one batched read. ORE reclaims a round's rent about a
 * day after it ends, so older ids come back empty and are skipped.
 */
export async function fetchPastBoardRounds(beforeRound: number, limit = 12): Promise<BoardRound[]> {
  const ids: bigint[] = [];
  for (let id = beforeRound - 1; id > 0 && ids.length < limit + 8; id--) ids.push(BigInt(id));
  const rounds = await fetchOreRounds(connection, ids);
  const out: BoardRound[] = [];
  for (const r of rounds) {
    if (!r) continue;
    const b = boardRoundOf(r);
    if (b.settled) out.push(b);
    if (out.length >= limit) break;
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
  let sol = toSol(r.sol);
  let unrefined = toOre(r.unrefined);
  // A finished round ORE has not checkpointed yet is not in the miner's balances,
  // but a claim checkpoints it first, so show what it paid as part of the claim.
  const pending = needsCheckpoint(miner, clock);
  if (pending !== null && miner) {
    const round = await fetchOreRound(connection, pending).catch(() => null);
    const out = round ? outcomeOf(round, miner, owner) : null;
    if (out) {
      sol += out.payout;
      unrefined += out.oreMined + out.oreMotherlode;
    }
  }
  return {
    sol,
    unrefined,
    refined: toOre(r.refined),
    fee: unrefined * REFINING_FEE,
    roundId: Number(r.roundId),
    settled: r.checkpointed,
  };
}

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
 * A drawn round's random number, as ORE's Round::rng reads it: the four u64s of the
 * slot hash XORed. Null before the draw. 'refund' when the hash is all 0xff, ORE's
 * mark for a round that could not be drawn and refunds everyone in full.
 */
function rngOf(r: OreRound): bigint | null | 'refund' {
  if (r.slotHash.every((b) => b === 0)) return null;
  if (r.slotHash.every((b) => b === 0xff)) return 'refund';
  let rng = 0n;
  for (let i = 0; i < 4; i++) {
    const view = new DataView(r.slotHash.buffer, r.slotHash.byteOffset + i * 8, 8);
    rng ^= view.getBigUint64(0, true);
  }
  return rng;
}

/** The winning square of a drawn round. Null before the draw and on a refunded round. */
function winningOf(r: OreRound): number | null {
  const rng = rngOf(r);
  return typeof rng === 'bigint' ? Number(rng % 25n) : null;
}

/** u64::reverse_bits, which ORE uses to sample the solo winner. */
function reverseBits64(x: bigint): bigint {
  let out = 0n;
  for (let i = 0; i < 64; i++) {
    out = (out << 1n) | (x & 1n);
    x >>= 1n;
  }
  return out;
}

/**
 * What a drawn round paid this miner, or null if it is not drawn yet or the miner
 * account has moved on to a later round.
 *
 * The figures are recomputed from the round and miner accounts rather than read
 * back as a balance change, because a balance delta cannot tell a round's payout
 * apart from anything else that touched the account in the same slot. The
 * arithmetic mirrors ORE's own checkpoint, fee for fee, so it is right whether or
 * not the round has been checkpointed yet.
 */
function outcomeOf(round: OreRound, miner: Pick<OreMiner, 'roundId' | 'deployed' | 'cumulative'>, owner: PublicKey, cumKnown = true): RoundOutcome | null {
  const rng = rngOf(round);
  if (rng === null || miner.roundId !== round.id) return null;
  if (rng === 'refund') {
    // ORE could not draw this round and gives every lamport back
    const back = miner.deployed.reduce((a, b) => a + b, 0n);
    return { roundId: Number(round.id), winning: -1, motherlode: false, split: true, lucky: false, payout: Number(back) / LAMPORTS_PER_SOL, oreMined: 0, oreMotherlode: 0, share: 0 };
  }
  const w = Number(rng % 25n);

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

  const split = round.topMiner.toBase58() === ORE_SPLIT_ADDRESS_B58;
  const sqTotal = round.deployed[w];
  const mineOnWin = miner.deployed[w];
  const rewardGrams = round.rewards.reduce((a, b) => a + b, 0n);

  let oreGrams = 0n;
  let lucky = false;
  if (sqTotal > 0n && mineOnWin > 0n) {
    if (split) {
      oreGrams = (rewardGrams * mineOnWin) / sqTotal;
    } else {
      // ORE's own rule: sample a point on the square and see whose slice it lands in.
      // Reset usually writes the winner into top_miner, but checkpoint is the one that pays.
      const sample = reverseBits64(rng) % sqTotal;
      const cum = miner.cumulative[w];
      // without the miner account (overwritten by a later deploy) only ORE's recorded winner is known
      lucky = round.topMiner.equals(owner) || (cumKnown && sample >= cum && sample < cum + mineOnWin);
      if (lucky) oreGrams = rewardGrams;
    }
  }
  const motherGrams =
    round.motherlode > 0n && sqTotal > 0n && mineOnWin > 0n
      ? (round.motherlode * mineOnWin) / sqTotal
      : 0n;

  return {
    roundId: Number(round.id),
    winning: w,
    motherlode: round.motherlode > 0n,
    split,
    lucky,
    payout: Number(lamports) / LAMPORTS_PER_SOL,
    oreMined: Number(oreGrams) / ORE_UNIT,
    oreMotherlode: Number(motherGrams) / ORE_UNIT,
    share: sqTotal > 0n ? Number(mineOnWin) / Number(sqTotal) : 0,
  };
}

/** What this player put on the board in a round, when the game knows it: the spots and the SOL on each. */
export interface KnownDeploy {
  mask: number;
  lamportsPerSquare: bigint;
}

/**
 * Read what a round paid this player. Throws while it is not drawn, or once it is gone.
 *
 * ORE's miner account only holds the player's latest round, so during autopilot the next round's
 * deploy can overwrite it before the result is read. With `known` (what the game deployed that
 * round) the result is worked out from the round account alone, with the same arithmetic.
 */
export async function readOutcome(owner: PublicKey, roundId: number, known?: KnownDeploy): Promise<RoundOutcome> {
  const [round, miner] = await Promise.all([
    fetchOreRound(connection, BigInt(roundId)),
    fetchOreMiner(connection, owner),
  ]);
  if (!round) throw new Error(`ORE round ${roundId} is gone; it expired before it was settled`);
  if ((!miner || miner.roundId !== BigInt(roundId)) && known && known.mask && known.lamportsPerSquare > 0n) {
    const deployed = Array.from({ length: 25 }, (_, i) => (known.mask & (1 << i) ? known.lamportsPerSquare : 0n));
    const out = outcomeOf(round, { roundId: round.id, deployed, cumulative: Array(25).fill(0n) }, owner, false);
    if (!out) throw new Error(`ORE round ${roundId} has not been drawn`);
    return out;
  }
  if (!miner) throw new Error(`ORE round ${roundId} is gone; it expired before it was settled`);
  if (miner.roundId !== BigInt(roundId)) throw new Error(`ORE round ${roundId} was replaced by a later deploy`);
  const out = outcomeOf(round, miner, owner);
  if (!out) throw new Error(`ORE round ${roundId} has not been drawn`);
  return out;
}

/** Settle a round for this player with the session key, then read what it paid them. */
export async function settleAndRead(
  owner: PublicKey,
  session: Keypair,
  roundId: number,
): Promise<RoundOutcome> {
  await settleBoardRound(owner, session).catch(() => null);
  return readOutcome(owner, roundId);
}

/** True once ORE has drawn this round (or marked it for a refund). */
export async function isRoundDrawn(roundId: number): Promise<boolean> {
  const r = await fetchOreRound(connection, BigInt(roundId));
  return Boolean(r && rngOf(r) !== null);
}

/* ---------- live mode: ORE's mainnet board, signed by the player's wallet ---------- */

/** ORE's board clock, for the live round timer. */
export const fetchOreClock = () => fetchClock(connection);

/**
 * The same answers from the relay's board feed (app/src/game/relay.ts), which reads ORE's accounts once
 * for everyone. Inputs are the raw account data in base64 and the slot they were read at.
 */
export const clockFromFeed = (boardB64: string, slot: number) => readClock(decodeBoard(Buffer.from(boardB64, 'base64')), slot);
export const boardRoundFromFeed = (roundB64: string): BoardRound | null => {
  try {
    return boardRoundOf(decodeRound(Buffer.from(roundB64, 'base64')));
  } catch {
    return null;
  }
};

/**
 * The round's ten solo squares as a bitmask (a set bit pays one miner the whole
 * ORE). ORE's own Round::distribution_mask, so it is known before the draw.
 */
/** Optional display-only mask. Loaded lazily so hashing can never block the ORE clock/board on Android. */
export async function oreSoloMask(roundId: number): Promise<number> {
  const { keccak_256 } = await import('@noble/hashes/sha3');
  return distributionMask(BigInt(roundId), keccak_256);
}

/** Put SOL on squares in the live round, signed by the player's wallet. Returns the round it went into. */
export async function deployLive(squares: number[], solPerSquare: number, expectedOwner?: PublicKey): Promise<number> {
  const { roundId } = await oreDeployWithWallet(squares, BigInt(Math.floor(solPerSquare * LAMPORTS_PER_SOL)), expectedOwner);
  return Number(roundId);
}

/** Live autopilot (ORE's automation). One approval to start, none per round, one to stop and refund. */
export const startAutopilot = (perSpotSol: number, squares: number[], random: boolean, rounds: number, expectedOwner?: PublicKey, topUpKey?: PublicKey) =>
  startLiveAutomation({ lamportsPerSquare: BigInt(Math.floor(perSpotSol * LAMPORTS_PER_SOL)), maxSquares: squares.length, squares, random, rounds, expectedOwner, topUpKey });
export const stopAutopilot = (expectedOwner?: PublicKey) => closeLiveAutomation(expectedOwner);
export const readAutopilot = (owner: PublicKey) => readAutomation(owner);
export async function deployAutopilot(owner: PublicKey, squares: number[], solPerSquare: number): Promise<number> {
  return Number(await deployFromAutomation(owner, squares, BigInt(Math.floor(solPerSquare * LAMPORTS_PER_SOL))));
}

/** Everything the wallet panel shows in live mode. Reads ORE and the wallet only. */
export async function fetchLiveWallet(owner: PublicKey, knownSol?: number) {
  // The ORE balance and the motherlode are extras: one failing must never hide the SOL waiting to be claimed.
  const [sol, ore, orePool, unclaimed] = await Promise.all([
    knownSol === undefined ? fetchSolBalance(owner) : Promise.resolve(knownSol),
    fetchOreBalance(owner, ORE_MINT.toBase58()).catch(() => undefined),
    fetchOreMotherlode().catch(() => undefined),
    fetchClaimable(owner),
  ]);
  return { sol, unclaimed, ...(ore === undefined ? {} : { ore }), ...(orePool === undefined ? {} : { orePool }) };
}

/** Whole ORE waiting in ORE's motherlode right now. */
export async function fetchOreMotherlode(): Promise<number> {
  const t = await fetchOreTreasury(connection);
  return Number(t.motherlode) / ORE_UNIT;
}

export const claimBoardSol = (expectedOwner?: PublicKey) => oreClaimSol(expectedOwner);
export const claimBoardOre = (expectedOwner?: PublicKey) => oreClaimOre(10_000, expectedOwner);

/** ORE's refining factor is Steel fixed point (48 fraction bits): refined ORE = unrefined x (factor now - factor then) / 2^48. */
export const FACTOR_ONE = 1n << 48n;

export interface OreStats {
  /** whole ORE this wallet ever mined on ORE's board (ORE's own lifetime counter) */
  lifetime: number;
  /** whole ORE mined and not yet claimed or refined */
  unrefined: number;
  /** whole refined ORE ready to claim, including what accrued since ORE last updated the miner */
  refined: number;
  /** unrefined in grams, and ORE's refining factor now (as a decimal string), for the 24 hour gain */
  unrefinedGrams: string;
  factor: string;
}

/** One read: the wallet's ORE miner account and ORE's treasury. A wallet that never mined reads all zeros. */
export async function fetchOreStats(owner: PublicKey): Promise<OreStats> {
  const [mi, ti] = await connection.getMultipleAccountsInfo([minerPda(owner), TREASURY_ADDRESS]);
  if (!ti) throw new Error('ORE treasury not found');
  const t = decodeTreasury(ti.data);
  const factor = t.minerRewardsFactor.toString();
  if (!mi) return { lifetime: 0, unrefined: 0, refined: 0, unrefinedGrams: '0', factor };
  const m = decodeMiner(mi.data);
  const accrued = t.minerRewardsFactor > m.rewardsFactor ? (m.rewardsOre * (t.minerRewardsFactor - m.rewardsFactor)) / FACTOR_ONE : 0n;
  return {
    lifetime: toOre(m.lifetimeRewardsOre),
    unrefined: toOre(m.rewardsOre),
    refined: toOre(m.refinedOre + accrued),
    unrefinedGrams: m.rewardsOre.toString(),
    factor,
  };
}

/** Lifetime ORE mined and SOL deployed for each wallet, read from ORE's Miner accounts (100 per call). */
export async function fetchMinerLifetimes(wallets: string[]): Promise<Record<string, { ore: number; deployed: number }>> {
  const out: Record<string, { ore: number; deployed: number }> = {};
  const keys: { w: string; pda: PublicKey }[] = [];
  for (const w of wallets) {
    try {
      keys.push({ w, pda: minerPda(new PublicKey(w)) });
    } catch {
      /* not a wallet */
    }
  }
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    const infos = await connection.getMultipleAccountsInfo(chunk.map((k) => k.pda));
    infos.forEach((info, j) => {
      if (!info) return;
      try {
        const m = decodeMiner(info.data);
        out[chunk[j].w] = { ore: toOre(m.lifetimeRewardsOre), deployed: toSol(m.lifetimeDeployed) };
      } catch {
        /* an older layout: skip */
      }
    });
  }
  return out;
}
