/**
 * Gali AI miner: plays ORE rounds for players who bought an AI pass and funded an ORE automation that names the
 * Gali AI key as its executor (Discretionary strategy).
 *
 * What the key can do is set by ORE, not by us: with a Discretionary automation the executor picks the squares and
 * the amount per square (never more than the player's own per-square limit) and pays from the automation's balance
 * into ORE's round. It cannot withdraw, change the limit or touch anything else. Only the player can close the
 * automation, and closing returns the balance to them. On each round it plays, ORE pays the executor Gali's fee:
 * 0.25% of the SOL deployed, the same as LITE and PRO (DiscretionaryBps). Rounds the AI sits out cost nothing. The
 * fees pile up on the AI key; sweepFees sends everything above a float for network fees to Gali's revenue wallet.
 *
 * Each round it waits until near the end, reads the board, and plays only squares that clear the margin
 * (see ../_shared/aiStrategy.ts). After the round is drawn it works out what each player got back from ORE's own
 * accounts and saves it, so the profit the app shows is what ORE paid, not what we hoped.
 */
import { Buffer, ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from './deps.ts';
import { decodeAutomation, decodeBoard, LOCK_SLOTS, ORE_PROGRAM_ID, phaseOf, SIZE, STRATEGY, type Auto, type Phase } from '../autopilot/core.ts';
import { addToBoard, AI_FEE_BPS, BLOCKS, planFee, roundBudget, botPlan, huntPlan, joinLimitLamports, MAX_FEE_BPS, MIN_STAKE, planRound, prizeLamports, roundRng, settleRound, type AiParams, type Plan, type Rules, type Settled, type Style } from '../_shared/aiStrategy.ts';

const ENTROPY_PROGRAM_ID = new PublicKey('3jSkUuYBoJzQPMEzTvkDFXCZUBksPamrVhrnHR9igu2X');
const BOARD = new PublicKey('BrcSxdp1nXFzou1YyDnQJcPNBNHgoypZmTsyKBSLLXzi');
const TREASURY = new PublicKey('45db2FSR4mcXdSVVZbKbwojU6uYDpMyhpEi7cC8nHaWG');
const CONFIG = new PublicKey('9c9X7aDRAF41faiDs94ELjT19UrGnn72wBW9hPsS4Awy');
const VAR = new PublicKey('BWCaDY96Xe4WkFq1M7UiCCRcChsJ3p51L5KrGzhxgm2E');
const SPLIT_ADDRESS = new PublicKey('SpLiT11111111111111111111111111111111111112');
const IX_DEPLOY = 6;
const IX_CHECKPOINT = 2;
const DISC = 8;
export const ROUND_SIZE = DISC + 944;
export const TREASURY_SIZE = DISC + 40;
/** a checkpoint plus up to four deploys */
/**
 * Compute a deploy may use. A checkpoint plus two deploys measured 57,000 to 60,000 units on mainnet (Nov 2026): this
 * leaves 2.5x room. Solana ranks transactions by fee per unit requested, so asking for 400,000 (as before) made the
 * same fee rank 2.7x lower, and 15% of deploys were dropped or landed after the round closed.
 */
export const CU_LIMIT = 150_000;
/** Micro-lamports per CU: 3,750 lamports of priority a deploy, paid by the AI key from Gali's 0.25%. */
export const CU_PRICE = 25_000;
/** most players one round plays, so a crowd of tiny automations cannot drain the key on network fees */
export const MAX_PER_ROUND = 60;
export const SLOT_MS = 400;

const pda = (seed: string, k: Buffer) => PublicKey.findProgramAddressSync([Buffer.from(seed), k], ORE_PROGRAM_ID)[0];
const minerPda = (a: PublicKey) => pda('miner', a.toBuffer());
const automationPda = (a: PublicKey) => pda('automation', a.toBuffer());
export const roundPda = (id: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(id);
  return pda('round', b);
};

const u64 = (d: Buffer, o: number) => d.readBigUInt64LE(DISC + o);
const squares = (d: Buffer, o: number) => Array.from({ length: BLOCKS }, (_, i) => u64(d, o + i * 8));

export interface RoundAcc { id: bigint; deployed: bigint[]; entropy: Uint8Array; motherlode: bigint; reward: bigint; split: boolean; top: PublicKey }
export function decodeRound(d: Buffer): RoundAcc {
  if (d.length !== ROUND_SIZE) throw new Error(`round is ${d.length} bytes`);
  return {
    id: u64(d, 0),
    deployed: squares(d, 8),
    entropy: Uint8Array.from(d.subarray(DISC + 608, DISC + 640)),
    motherlode: u64(d, 648),
    reward: squares(d, 688).reduce((a, b) => a + b, 0n),
    split: new PublicKey(d.subarray(DISC + 912, DISC + 944)).equals(SPLIT_ADDRESS),
    // the solo winner (ORE's top miner), unless the round was shared
    top: new PublicKey(d.subarray(DISC + 912, DISC + 944)),
  };
}
export interface MinerAcc { authority: PublicKey; checkpointId: bigint; deployed: bigint[]; cumulative: bigint[]; roundId: bigint }
export function decodeMiner(d: Buffer): MinerAcc {
  if (d.length !== SIZE.miner) throw new Error(`miner is ${d.length} bytes`);
  return { authority: new PublicKey(d.subarray(DISC, DISC + 32)), checkpointId: u64(d, 40), deployed: squares(d, 56), cumulative: squares(d, 456), roundId: u64(d, 656) };
}
export const decodeMotherlode = (d: Buffer) => {
  if (d.length !== TREASURY_SIZE) throw new Error(`treasury is ${d.length} bytes`);
  return u64(d, 0);
};

const m = (pubkey: PublicKey, isSigner: boolean, isWritable: boolean) => ({ pubkey, isSigner, isWritable });

export function deployIx(signer: PublicKey, authority: PublicKey, roundId: bigint, amount: bigint, mask: number): TransactionInstruction {
  const data = Buffer.alloc(13);
  data.writeUInt8(IX_DEPLOY, 0);
  data.writeBigUInt64LE(amount, 1); // ORE uses min(this, the automation's amount)
  data.writeUInt32LE(mask >>> 0, 9);
  return new TransactionInstruction({
    programId: ORE_PROGRAM_ID,
    data,
    keys: [
      m(signer, true, true), m(authority, false, true), m(automationPda(authority), false, true), m(BOARD, false, true), m(CONFIG, false, true),
      m(minerPda(authority), false, true), m(roundPda(roundId), false, true), m(TREASURY, false, true), m(SystemProgram.programId, false, false),
      m(ORE_PROGRAM_ID, false, false), m(VAR, false, true), m(ENTROPY_PROGRAM_ID, false, false),
    ],
  });
}
function checkpointIx(signer: PublicKey, authority: PublicKey, roundId: bigint): TransactionInstruction {
  return new TransactionInstruction({
    programId: ORE_PROGRAM_ID,
    data: Buffer.from([IX_CHECKPOINT]),
    keys: [
      m(signer, true, true), m(authority, false, true), m(automationPda(authority), false, true), m(BOARD, false, true),
      m(minerPda(authority), false, true), m(roundPda(roundId), false, true), m(TREASURY, false, true), m(SystemProgram.programId, false, false),
    ],
  });
}

/** Is this an automation the AI runs (Gali's fee set, at most ORE's 1% cap), and can it pay for anything? */
export function aiRunnable(a: Auto, aiKey: PublicKey): boolean {
  return a.executor.equals(aiKey) && a.strategy === STRATEGY.DiscretionaryBps && a.fee >= AI_FEE_BPS && a.fee <= MAX_FEE_BPS && a.amount >= MIN_STAKE && a.balance > MIN_STAKE * 2n;
}

export const REVENUE_WALLET = new PublicKey('HDa2MTDdZXnrjTs6RRUUzEqCcrWMWu1fM673Cg7pzQMw');
/** SOL kept on the AI key for its own network fees; anything above this plus a margin goes to the revenue wallet. */
export const FEE_FLOAT = 50_000_000n; // 0.05 SOL
const SWEEP_MIN = 10_000_000n; // don't bother moving less than 0.01 SOL

/** Sends the fees the AI key collected to Gali's revenue wallet, keeping FEE_FLOAT. Returns lamports sent. */
export async function sweepFees(conn: Connection, signer: Keypair): Promise<bigint> {
  const have = BigInt(await conn.getBalance(signer.publicKey, 'confirmed'));
  const extra = have - FEE_FLOAT;
  if (extra < SWEEP_MIN) return 0n;
  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  const tx = new Transaction({ feePayer: signer.publicKey, recentBlockhash: blockhash }).add(
    SystemProgram.transfer({ fromPubkey: signer.publicKey, toPubkey: REVENUE_WALLET, lamports: extra }),
  );
  tx.sign(signer);
  await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 2 });
  return extra;
}

/** The instructions for one player's plan: settle their last round when ORE needs it, then one deploy per stake group. */
export function txFor(plan: Plan, a: Auto, miner: MinerAcc, roundId: bigint, signer: PublicKey): TransactionInstruction[] {
  const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units: CU_LIMIT }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: CU_PRICE })];
  if (miner.checkpointId !== miner.roundId && miner.roundId < roundId) ixs.push(checkpointIx(signer, a.authority, miner.roundId));
  for (const g of plan.groups) ixs.push(deployIx(signer, a.authority, roundId, g.amount, g.mask));
  return ixs;
}

export interface Played {
  wallet: string;
  round: bigint;
  mode?: 'bot' | 'ai';
  style?: Style;
  /** lamports staked on each square */
  stake: bigint[];
  total: bigint;
  /** Gali's fee ORE took for the round, lamports */
  fee: bigint;
  /** expected profit in lamports (cautious) */
  ev: number;
  boardBefore: bigint;
  prize: number;
  signature: string;
}
export interface Pending { wallet: string; round: bigint; stake: bigint[] }

/** Where the AI reads its settings and the players' passes, and writes what it did. index.ts backs these with Supabase. */
/** A wallet's choice: Bot (its own rules, no AI) or AI bot (a style), plus its own limits. No row: AI bot, safe. */
export interface BotChoice {
  mode: 'bot' | 'ai';
  style: Style;
  rules: Rules;
  /** stop once the result since the settings were saved is this much SOL down */
  stopLossSol: number | null;
  /** when the player's run ends (ms); the AI paces each bet to it. null: runs until stopped */
  runUntil?: number | null;
}
export const DEFAULT_CHOICE: BotChoice = { mode: 'ai', style: 'safe', rules: { spots: 10, perSpotSol: 0.002, maxSpotSol: null, minMotherlodeOre: null, maxRoundSol: null }, stopLossSol: null, runUntil: null };

export interface Hooks {
  /** the AI settings for a style (the agents tune each style separately) */
  params(style?: Style): Promise<AiParams>;
  /** each wallet's Bot or AI bot choice */
  choices?(): Promise<Map<string, BotChoice>>;
  /** each wallet's result in SOL since its settings were saved, for the stop-loss */
  net?(): Promise<Map<string, number>>;
  /** One ORE in SOL, or null when the price is missing or stale (the AI then sits out). */
  price(): Promise<number | null>;
  /** Wallets with a live AI pass. */
  active(): Promise<Set<string>>;
  played(p: Played): Promise<void>;
  /** Played rounds not yet settled, older than `before`. */
  pending(before: bigint): Promise<Pending[]>;
  /** `s` null: the deploy never landed. */
  settled(wallet: string, round: bigint, s: Settled | null, boardAfter: bigint): Promise<void>;
  /** What the AI saw and decided in a round's deploy window, for the AI tab. */
  thought?(t: Thought): Promise<void>;
  /** How a round's solo 1 ORE winner played, for the agents to study. */
  soloWin?(w: SoloWin): Promise<void>;
  /** How every miner on the board played a finished round, grouped by style, for the agents to study. */
  boardRound?(b: BoardStudy): Promise<void>;
}

/** One round's decision in numbers a player can follow. Lamports and grams. */
export interface Thought {
  round: bigint;
  slotsLeft: number;
  motherlode: bigint;
  prize: number;
  board: bigint;
  quietest: bigint;
  /** a square holding more than this is not worth joining */
  joinLimit: number;
  played: number;
  skipped: number;
  params: AiParams;
}

export interface PassResult {
  phase: Phase;
  round: string;
  slotsLeft: number;
  candidates: number;
  sent: number;
  skipped: number;
  failed: number;
  settled: number;
  errors: string[];
  /** how long the loop can sleep before the next pass is worth it */
  waitMs: number;
}

/**
 * slotMs: the measured slot time. Solana's slots run faster than the nominal 400 ms (about 215 ms in Nov 2026), and
 * sleeping by the nominal figure overshoots the deploy window, so the AI never plays. Each pass refines the estimate.
 */
export interface State { done: Set<string>; settleAt: number; slotMs: number; lastSlot?: number; lastAt?: number; studied?: bigint; boardStudied?: bigint; snap?: { round: bigint; miners: Map<string, bigint[]> } }
export const newState = (slotMs = SLOT_MS): State => ({ done: new Set(), settleAt: 0, slotMs });

/** How one solo 1 ORE winner played their round (lamports), for the AI agents to learn from. Any wallet, not only ours. */
export interface SoloWin {
  round: bigint;
  wallet: string;
  square: number;
  /** SOL on the winning square, all miners */
  squareTotal: bigint;
  /** the winner's stake on the winning square */
  stake: bigint;
  /** squares the winner covered, and their SOL across the board */
  squares: number;
  deployed: bigint;
  motherlode: boolean;
}

/**
 * Reads how the last round's solo winner played, while their ORE Miner still holds that round (it moves on at their next
 * deploy, so this runs early in the next round). Shared rounds and winners already moved on are skipped.
 */
export async function studySolo(conn: Connection, hooks: Hooks, current: bigint, st: State): Promise<SoloWin | null> {
  const prev = current - 1n;
  if (!hooks.soloWin || (st.studied !== undefined && st.studied >= prev)) return null;
  st.studied = prev;
  const info = await conn.getAccountInfo(roundPda(prev), 'confirmed');
  if (!info || info.data.length !== ROUND_SIZE) return null;
  const r = decodeRound(Buffer.from(info.data));
  if (r.split || r.top.equals(PublicKey.default)) return null;
  const win = settleRound(r, Array.from({ length: BLOCKS }, () => 0n), null)?.winningSquare;
  if (win === undefined) return null;
  const mi = await conn.getAccountInfo(minerPda(r.top), 'confirmed');
  const m = mi && mi.data.length === SIZE.miner ? decodeMiner(Buffer.from(mi.data)) : null;
  if (!m || m.roundId !== prev || !(m.deployed[win] > 0n)) return null;
  const w: SoloWin = {
    round: prev, wallet: r.top.toBase58(), square: win, squareTotal: r.deployed[win], stake: m.deployed[win],
    squares: m.deployed.filter((x) => x > 0n).length, deployed: m.deployed.reduce((a, b) => a + b, 0n), motherlode: r.motherlode > 0n,
  };
  await hooks.soloWin(w);
  return w;
}
/** How miners played, by how many squares they covered and their average SOL per covered square. */
export const TILE_BUCKETS = ['1-5', '6-15', '16-22', '23-25'] as const;
export const SIZE_BUCKETS = ['<0.001', '0.001-0.01', '0.01-0.1', '0.1+'] as const;
export const tileBucket = (n: number) => (n <= 5 ? '1-5' : n <= 15 ? '6-15' : n <= 22 ? '16-22' : '23-25');
export const sizeBucket = (lamportsPerSquare: number) => {
  const sol = lamportsPerSquare / 1e9;
  return sol < 0.001 ? '<0.001' : sol < 0.01 ? '0.001-0.01' : sol < 0.1 ? '0.01-0.1' : '0.1+';
};
/** One style group's round: miners, SOL in and back (lamports), on the winning square, ORE mined (grams), solo wins. */
export interface StyleGroup { miners: number; deployed: number; back: number; onWin: number; ore: number; solo: number }
/** Every miner's play in one finished round, any wallet, grouped by style. Lamports and grams. */
export interface BoardStudy {
  round: bigint;
  miners: number;
  deployed: bigint;
  /** SOL of the miners we read, against the round's total: under 1 when some miners had moved on before we looked */
  seen: number;
  winSquare: number;
  split: boolean;
  reward: bigint;
  motherlode: bigint;
  /** the solo winner's stake, the SOL on the winning square, and the squares they covered (null in shared rounds) */
  solo: { wallet: string; stake: bigint; squareTotal: bigint; squares: number } | null;
  /** key: "<squares bucket>|<SOL per square bucket>" */
  groups: Record<string, StyleGroup>;
}

/** Groups every miner's result in a drawn round. Pure: `miners` maps wallet to SOL on each square. */
export function studyRound(r: RoundAcc, miners: Map<string, bigint[]>): BoardStudy | null {
  const zero = Array.from({ length: BLOCKS }, () => 0n);
  const win = settleRound(r, zero, null)?.winningSquare;
  if (win === undefined) return null;
  const groups: Record<string, StyleGroup> = {};
  let deployed = 0n;
  let solo: BoardStudy['solo'] = null;
  const top = r.split || r.top.equals(PublicKey.default) ? null : r.top.toBase58();
  for (const [wallet, d] of miners) {
    const total = d.reduce((a, b) => a + b, 0n);
    if (total <= 0n) continue;
    deployed += total;
    const n = d.filter((x) => x > 0n).length;
    const key = `${tileBucket(n)}|${sizeBucket(Number(total) / n)}`;
    const g = (groups[key] ??= { miners: 0, deployed: 0, back: 0, onWin: 0, ore: 0, solo: 0 });
    const s = settleRound(r, d, null);
    let ore = s ? Number(s.oreGrams) : 0;
    if (wallet === top && d[win] > 0n) {
      ore += Number(r.reward);
      g.solo++;
      solo = { wallet, stake: d[win], squareTotal: r.deployed[win], squares: n };
    }
    g.miners++;
    g.deployed += Number(total);
    g.back += s ? Number(s.solBack) : 0;
    g.onWin += d[win] > 0n ? 1 : 0;
    g.ore += ore;
  }
  const roundTotal = r.deployed.reduce((a, b) => a + b, 0n);
  return {
    round: r.id, miners: [...miners.values()].filter((d) => d.some((x) => x > 0n)).length, deployed,
    seen: roundTotal > 0n ? Math.min(1, Number(deployed) / Number(roundTotal)) : 0,
    winSquare: win, split: r.split, reward: r.reward, motherlode: r.motherlode, solo, groups,
  };
}

/** Every ORE miner whose account still holds `roundId`, with their SOL on each square. */
export async function minersIn(conn: Connection, roundId: bigint): Promise<Map<string, bigint[]>> {
  const id = Buffer.alloc(8);
  id.writeBigUInt64LE(roundId);
  const accounts = await conn.getProgramAccounts(ORE_PROGRAM_ID, {
    commitment: 'confirmed',
    filters: [{ dataSize: SIZE.miner }, { memcmp: { offset: DISC + 656, bytes: id.toString('base64'), encoding: 'base64' } as never }],
    dataSlice: { offset: DISC, length: 256 },
  });
  const out = new Map<string, bigint[]>();
  for (const a of accounts) {
    const d = Buffer.from(a.account.data);
    if (d.length < 256) continue;
    out.set(new PublicKey(d.subarray(0, 32)).toBase58(), Array.from({ length: BLOCKS }, (_, i) => d.readBigUInt64LE(56 + i * 8)));
  }
  return out;
}

/**
 * Studies the last round's whole board once it is drawn. Uses the snapshot taken between rounds (nobody can deploy then,
 * and nobody has moved on), or reads the miners now, missing those who already deployed in the new round.
 */
export async function studyBoard(conn: Connection, hooks: Hooks, current: bigint, st: State): Promise<BoardStudy | null> {
  const prev = current - 1n;
  if (!hooks.boardRound || (st.boardStudied !== undefined && st.boardStudied >= prev)) return null;
  const info = await conn.getAccountInfo(roundPda(prev), 'confirmed');
  if (!info || info.data.length !== ROUND_SIZE) return null;
  const r = decodeRound(Buffer.from(info.data));
  if (!roundRng(r.entropy)) return null; // not drawn yet: try again next pass
  st.boardStudied = prev;
  const miners = st.snap?.round === prev && st.snap.miners.size ? st.snap.miners : await minersIn(conn, prev);
  st.snap = undefined;
  const b = studyRound(r, miners);
  if (b) await hooks.boardRound(b);
  return b;
}

/** Never sleep longer than this while waiting for the deploy window, so a wrong slot estimate can't skip it. */
export const MAX_WAIT_MS = 8000;

/** Folds the slot progress seen since the last pass into the slot-time estimate. */
export function trackSlot(st: State, slot: number, now: number): void {
  if (st.lastSlot !== undefined && st.lastAt !== undefined && slot > st.lastSlot && now - st.lastAt >= 1500) {
    const seen = (now - st.lastAt) / (slot - st.lastSlot);
    st.slotMs = Math.min(600, Math.max(100, (st.slotMs + seen) / 2));
  }
  st.lastSlot = slot;
  st.lastAt = now;
}

/** Work out what each played round paid. Runs at most every 10 s. */
export async function settle(conn: Connection, hooks: Hooks, current: bigint, st: State, now = Date.now()): Promise<number> {
  if (now - st.settleAt < 10_000) return 0;
  st.settleAt = now;
  const rows = (await hooks.pending(current)).slice(0, 100);
  if (!rows.length) return 0;
  const ids = [...new Set(rows.map((r) => r.round))];
  const owners = rows.map((r) => new PublicKey(r.wallet));
  const [rInfos, mInfos] = await Promise.all([conn.getMultipleAccountsInfo(ids.map(roundPda), 'confirmed'), conn.getMultipleAccountsInfo(owners.map(minerPda), 'confirmed')]);
  const rounds = new Map<bigint, RoundAcc | null>();
  ids.forEach((id, i) => {
    const inf = rInfos[i];
    rounds.set(id, inf && inf.owner?.equals(ORE_PROGRAM_ID) && inf.data.length === ROUND_SIZE ? decodeRound(Buffer.from(inf.data)) : null);
  });
  let n = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const r = rounds.get(row.round);
    if (!r || r.id !== row.round) continue; // not readable yet (or closed): try again later
    const mi = mInfos[i];
    const miner = mi && mi.data.length === SIZE.miner ? decodeMiner(Buffer.from(mi.data)) : null;
    // the miner still holds this round: ORE's own numbers. It never got there: our deploy did not land.
    // It moved on (the player deployed by hand since): what we sent, without the solo draw.
    let deployed = row.stake;
    let cumulative: bigint[] | null = null;
    if (miner && miner.roundId === row.round) {
      deployed = miner.deployed;
      cumulative = miner.cumulative;
    } else if (!miner || miner.roundId < row.round) {
      await hooks.settled(row.wallet, row.round, null, 0n);
      n++;
      continue;
    }
    if (!deployed.some((x) => x > 0n)) {
      await hooks.settled(row.wallet, row.round, null, 0n);
      n++;
      continue;
    }
    const s = settleRound(r, deployed, cumulative);
    if (!s) continue; // not drawn yet
    const boardAfter = deployed.reduce((sum, x, k) => (x > 0n ? sum + r.deployed[k] : sum), 0n);
    await hooks.settled(row.wallet, row.round, s, boardAfter);
    n++;
  }
  return n;
}

/** One pass: settle what can be settled; near the end of a round, plan and send each player's deploy. */
export async function pass(conn: Connection, signer: Keypair, hooks: Hooks, st: State, now = Date.now()): Promise<PassResult> {
  const [boardInfo, slot] = await Promise.all([conn.getAccountInfo(BOARD), conn.getSlot('confirmed')]);
  if (!boardInfo) throw new Error('ORE board not found');
  trackSlot(st, slot, now);
  const board = decodeBoard(Buffer.from(boardInfo.data));
  const phase = phaseOf(board, slot);
  const slotsLeft = phase === 'mining' || phase === 'locked' ? Number(board.endSlot - BigInt(slot)) : 0;
  const res: PassResult = { phase, round: board.roundId.toString(), slotsLeft, candidates: 0, sent: 0, skipped: 0, failed: 0, settled: 0, errors: [], waitMs: 2000 };
  const err = (tag: string, e: unknown) => res.errors.length < 6 && res.errors.push(`${tag}: ${String((e as Error)?.message ?? e).slice(0, 160)}`);

  if (phase !== 'waiting') res.settled = await settle(conn, hooks, board.roundId, st, now).catch((e) => (err('settle', e), 0));
  // early in a round: how the last round's solo winner played, before their next deploy moves their miner on
  if (phase === 'mining') await studySolo(conn, hooks, board.roundId, st).catch((e) => err('study', e));
  if (phase === 'mining') await studyBoard(conn, hooks, board.roundId, st).catch((e) => err('board', e));
  // between rounds nobody can deploy and nobody has moved on: the whole board, complete
  if (phase === 'intermission' && hooks.boardRound && st.snap?.round !== board.roundId) {
    st.snap = { round: board.roundId, miners: await minersIn(conn, board.roundId).catch((e) => (err('snap', e), new Map())) };
  }
  if (phase !== 'mining') {
    if (phase === 'locked') res.waitMs = Math.max(1000, slotsLeft * st.slotMs + 1500);
    return res;
  }
  const params = await hooks.params();
  // each player deploys on their own style's timing (the review team tunes targetSlotsLeft per style): wake for the
  // earliest window still to come this round, and leave players whose window is not open yet for a later pass
  const [active, choices] = await Promise.all([
    hooks.active(),
    hooks.choices?.().catch((e) => (err('choices', e), new Map<string, BotChoice>())) ?? Promise.resolve(new Map<string, BotChoice>()),
  ]);
  const styleParams = new Map<Style, AiParams>();
  const paramsOf = async (c: BotChoice): Promise<AiParams> => {
    if (c.mode !== 'ai') return params;
    if (!styleParams.has(c.style)) styleParams.set(c.style, await hooks.params(c.style));
    return styleParams.get(c.style)!;
  };
  const targets = new Map<string, number>();
  for (const w of active) if (!st.done.has(`${w}:${board.roundId}`)) targets.set(w, (await paramsOf(choices.get(w) ?? DEFAULT_CHOICE)).targetSlotsLeft);
  const firstOpen = targets.size ? Math.max(...targets.values()) : params.targetSlotsLeft;
  if (slotsLeft > firstOpen) {
    // sleep until just before the deploy window, checking back at least every MAX_WAIT_MS
    res.waitMs = Math.min(MAX_WAIT_MS, Math.max(300, (slotsLeft - firstOpen) * st.slotMs - 300));
    return res;
  }
  // players whose window opens later in this round: come back for the next one, else sleep to the round's end
  const later = [...targets.values()].filter((t) => t < slotsLeft && t >= LOCK_SLOTS + 2);
  res.waitMs = later.length ? Math.max(300, (slotsLeft - Math.max(...later)) * st.slotMs - 300) : Math.max(1000, slotsLeft * st.slotMs + 1500);
  // too close to the lock: anything sent now may land after it
  if (slotsLeft < LOCK_SLOTS + 2) return res;
  const windowOpen = (w: string) => (targets.get(w) ?? firstOpen) >= slotsLeft;

  const accounts = await conn.getProgramAccounts(ORE_PROGRAM_ID, {
    commitment: 'confirmed',
    filters: [{ dataSize: SIZE.automation }, { memcmp: { offset: DISC + 48, bytes: signer.publicKey.toBase58() } }],
  });
  const autos = accounts
    .map((x) => decodeAutomation(Buffer.from(x.account.data)))
    .filter((a) => aiRunnable(a, signer.publicKey) && active.has(a.authority.toBase58()) && windowOpen(a.authority.toBase58()) && !st.done.has(`${a.authority.toBase58()}:${board.roundId}`))
    .sort((x, y) => (y.balance > x.balance ? 1 : y.balance < x.balance ? -1 : 0))
    .slice(0, MAX_PER_ROUND);
  res.candidates = autos.length;
  if (!autos.length) return res;

  const price = await hooks.price();
  if (!price) {
    autos.forEach((a) => st.done.add(`${a.authority.toBase58()}:${board.roundId}`));
    res.skipped = autos.length;
    err('price', 'no fresh ORE price: sitting this round out');
    return res;
  }
  const [roundInfo, treasuryInfo, minerInfos] = await Promise.all([
    conn.getAccountInfo(roundPda(board.roundId), 'confirmed'),
    conn.getAccountInfo(TREASURY, 'confirmed'),
    conn.getMultipleAccountsInfo(autos.map((a) => minerPda(a.authority)), 'confirmed'),
  ]);
  if (!roundInfo || !treasuryInfo) throw new Error('ORE round or treasury not found');
  const round = decodeRound(Buffer.from(roundInfo.data));
  const motherlode = decodeMotherlode(Buffer.from(treasuryInfo.data));
  const prize = prizeLamports(motherlode, price);

  // plan one player at a time, each seeing the stakes of the ones before, so the AI does not crowd itself
  let onBoard = round.deployed;
  const sends: { a: Auto; plan: Plan; ixs: TransactionInstruction[]; choice: BotChoice }[] = [];
  const nets: Map<string, number> = (await hooks.net?.().catch((e) => (err('net', e), new Map()))) ?? new Map();
  for (const a of autos) await paramsOf(choices.get(a.authority.toBase58()) ?? DEFAULT_CHOICE);
  autos.forEach((a, i) => {
    const tag = `${a.authority.toBase58()}:${board.roundId}`;
    const info = minerInfos[i];
    const miner = info && info.data.length === SIZE.miner ? decodeMiner(Buffer.from(info.data)) : null;
    st.done.add(tag);
    // ORE opens the miner when the player funds the automation; already played this round: leave it
    if (!miner || (miner.roundId === board.roundId && miner.deployed.some((x) => x > 0n))) {
      res.skipped++;
      return;
    }
    const choice: BotChoice = choices.get(a.authority.toBase58()) ?? DEFAULT_CHOICE;
    // the player's stop-loss: down this much since the settings were saved, it stops until they change something
    if (choice.stopLossSol && (nets.get(a.authority.toBase58()) ?? 0) <= -choice.stopLossSol) {
      res.skipped++;
      return;
    }
    // the player's run time is over: it stops until they start it again
    if (choice.runUntil && now >= choice.runUntil) {
      res.skipped++;
      return;
    }
    const pace = choice.mode === 'ai' && choice.runUntil ? roundBudget(a.balance, a.fee, choice.runUntil, now) : null;
    const base = { onBoard, motherlodeGrams: motherlode, orePriceSol: price, maxPerSquare: a.amount, balance: a.balance, feeBps: a.fee, roundBudget: pace };
    const sp = styleParams.get(choice.style) ?? params;
    const plan =
      choice.mode === 'bot'
        ? botPlan({ ...base, rules: choice.rules })
        : choice.style === 'safe'
          ? capRound(planRound({ ...base, params: sp }), choice.rules.maxRoundSol)
          : huntPlan({ ...base, params: sp, style: choice.style, maxRoundSol: choice.rules.maxRoundSol });
    if (!plan) {
      res.skipped++;
      return;
    }
    onBoard = addToBoard(onBoard, plan);
    sends.push({ a, plan, ixs: txFor(plan, a, miner, board.roundId, signer.publicKey), choice });
  });
  const logged = sends[0]?.choice.mode === 'ai' ? (styleParams.get(sends[0].choice.style) ?? params) : params;
  await hooks
    .thought?.({
      round: board.roundId, slotsLeft, motherlode, prize,
      board: round.deployed.reduce((n, x) => n + x, 0n),
      quietest: round.deployed.reduce((m, x) => (x < m ? x : m), round.deployed[0]),
      // the settings of the style that played (the first player's), so the round reviewer compares like with like
      joinLimit: joinLimitLamports(prize, logged), played: sends.length, skipped: res.skipped, params: logged,
    })
    .catch((e) => err('thought', e));
  if (!sends.length) return res;

  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  // resending the same signed transaction costs nothing (one signature, paid once) and gets bets through busy slots
  const until = now + Math.max(0, slotsLeft - LOCK_SLOTS) * st.slotMs;
  await Promise.all(
    sends.map(async ({ a, plan, ixs, choice }) => {
      try {
        const tx = new Transaction({ feePayer: signer.publicKey, recentBlockhash: blockhash }).add(...ixs);
        tx.sign(signer);
        const raw = tx.serialize();
        const signature = await conn.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 2 });
        res.sent++;
        const stake = Array.from({ length: BLOCKS }, () => 0n);
        for (const g of plan.groups) for (let s = 0; s < BLOCKS; s++) if (g.mask & (1 << s)) stake[s] += g.amount;
        await hooks.played({ wallet: a.authority.toBase58(), round: board.roundId, mode: choice.mode, style: choice.style, stake, total: plan.total, fee: planFee(plan, a.fee), ev: plan.ev, boardBefore: plan.boardBefore, prize, signature }).catch((e) => err('save', e));
        await rebroadcast(conn, raw, signature, until).catch((e) => err('resend', e));
      } catch (e) {
        res.failed++;
        err(a.authority.toBase58().slice(0, 6), e);
      }
    }),
  );
  return res;
}

/** A safe-style plan over the player's most per round is dropped rather than resized (its stakes were sized for the margin). */
export const capRound = (plan: Plan | null, maxRoundSol: number | null): Plan | null =>
  plan && maxRoundSol && Number(plan.total) > maxRoundSol * 1e9 ? null : plan;

/** How often a sent bet is checked and resent until it lands. */
export const RESEND_MS = 400;

/**
 * Resends `raw` every RESEND_MS until its signature is seen or `until` (ORE's lock) passes. A deploy that misses the
 * lock never lands, and the round is then settled as void. Throws if the transaction landed with an error.
 */
export async function rebroadcast(conn: Connection, raw: Buffer | Uint8Array, signature: string, until: number, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<boolean> {
  if (!conn.getSignatureStatuses) return false;
  while (Date.now() < until) {
    await sleep(RESEND_MS);
    const { value } = await conn.getSignatureStatuses([signature]);
    const s = value[0];
    if (s?.err) throw new Error(`landed with an error: ${JSON.stringify(s.err).slice(0, 120)}`);
    if (s?.confirmationStatus) return true;
    await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => undefined);
  }
  return false;
}

/** Passes until `budgetMs` is used up, sleeping between them for as long as nothing needs doing. */
export async function run(conn: Connection, signer: Keypair, hooks: Hooks, budgetMs: number, now: () => number = Date.now, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<PassResult[]> {
  const end = now() + budgetMs;
  // start from the network's recent slot time rather than the nominal 400 ms
  const samples = await conn.getRecentPerformanceSamples?.(4).catch(() => []) ?? [];
  const slots = samples.reduce((n, s) => n + s.numSlots, 0);
  const st = newState(slots > 0 ? Math.min(600, Math.max(100, (samples.reduce((n, s) => n + s.samplePeriodSecs, 0) * 1000) / slots)) : SLOT_MS);
  const out: PassResult[] = [];
  while (now() < end) {
    let r: PassResult;
    try {
      r = await pass(conn, signer, hooks, st, now());
    } catch (e) {
      r = { phase: 'waiting', round: '?', slotsLeft: 0, candidates: 0, sent: 0, skipped: 0, failed: 1, settled: 0, errors: [String((e as Error)?.message ?? e).slice(0, 160)], waitMs: 2000 };
    }
    out.push(r);
    const left = end - now();
    if (left <= 0) break;
    await sleep(Math.min(r.waitMs, left));
  }
  return out;
}
