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
import { addToBoard, AI_FEE_BPS, aiFee, BLOCKS, MAX_FEE_BPS, MIN_STAKE, planRound, prizeLamports, settleRound, type AiParams, type Plan, type Settled } from '../_shared/aiStrategy.ts';

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
const CU_LIMIT = 400_000;
const CU_PRICE = 5_000; // micro-lamports per CU: at most 2,000 lamports of priority, inside the 10,000 fee
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

export interface RoundAcc { id: bigint; deployed: bigint[]; entropy: Uint8Array; motherlode: bigint; reward: bigint; split: boolean }
export function decodeRound(d: Buffer): RoundAcc {
  if (d.length !== ROUND_SIZE) throw new Error(`round is ${d.length} bytes`);
  return {
    id: u64(d, 0),
    deployed: squares(d, 8),
    entropy: Uint8Array.from(d.subarray(DISC + 608, DISC + 640)),
    motherlode: u64(d, 648),
    reward: squares(d, 688).reduce((a, b) => a + b, 0n),
    split: new PublicKey(d.subarray(DISC + 912, DISC + 944)).equals(SPLIT_ADDRESS),
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
export interface Hooks {
  params(): Promise<AiParams>;
  /** One ORE in SOL, or null when the price is missing or stale (the AI then sits out). */
  price(): Promise<number | null>;
  /** Wallets with a live AI pass. */
  active(): Promise<Set<string>>;
  played(p: Played): Promise<void>;
  /** Played rounds not yet settled, older than `before`. */
  pending(before: bigint): Promise<Pending[]>;
  /** `s` null: the deploy never landed. */
  settled(wallet: string, round: bigint, s: Settled | null, boardAfter: bigint): Promise<void>;
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

export interface State { done: Set<string>; settleAt: number }
export const newState = (): State => ({ done: new Set(), settleAt: 0 });

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
  const board = decodeBoard(Buffer.from(boardInfo.data));
  const phase = phaseOf(board, slot);
  const slotsLeft = phase === 'mining' || phase === 'locked' ? Number(board.endSlot - BigInt(slot)) : 0;
  const res: PassResult = { phase, round: board.roundId.toString(), slotsLeft, candidates: 0, sent: 0, skipped: 0, failed: 0, settled: 0, errors: [], waitMs: 2000 };
  const err = (tag: string, e: unknown) => res.errors.length < 6 && res.errors.push(`${tag}: ${String((e as Error)?.message ?? e).slice(0, 160)}`);

  if (phase !== 'waiting') res.settled = await settle(conn, hooks, board.roundId, st, now).catch((e) => (err('settle', e), 0));
  if (phase !== 'mining') {
    if (phase === 'locked') res.waitMs = Math.max(1000, slotsLeft * SLOT_MS + 1500);
    return res;
  }
  const params = await hooks.params();
  if (slotsLeft > params.targetSlotsLeft) {
    // sleep until just before the deploy window
    res.waitMs = Math.max(500, (slotsLeft - params.targetSlotsLeft) * SLOT_MS - 300);
    return res;
  }
  res.waitMs = Math.max(1000, slotsLeft * SLOT_MS + 1500);
  // too close to the lock: anything sent now may land after it
  if (slotsLeft < LOCK_SLOTS + 2) return res;

  const accounts = await conn.getProgramAccounts(ORE_PROGRAM_ID, {
    commitment: 'confirmed',
    filters: [{ dataSize: SIZE.automation }, { memcmp: { offset: DISC + 48, bytes: signer.publicKey.toBase58() } }],
  });
  const active = await hooks.active();
  const autos = accounts
    .map((x) => decodeAutomation(Buffer.from(x.account.data)))
    .filter((a) => aiRunnable(a, signer.publicKey) && active.has(a.authority.toBase58()) && !st.done.has(`${a.authority.toBase58()}:${board.roundId}`))
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
  const sends: { a: Auto; plan: Plan; ixs: TransactionInstruction[] }[] = [];
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
    const plan = planRound({ onBoard, motherlodeGrams: motherlode, orePriceSol: price, maxPerSquare: a.amount, balance: a.balance, feeBps: a.fee, params });
    if (!plan) {
      res.skipped++;
      return;
    }
    onBoard = addToBoard(onBoard, plan);
    sends.push({ a, plan, ixs: txFor(plan, a, miner, board.roundId, signer.publicKey) });
  });
  if (!sends.length) return res;

  const { blockhash } = await conn.getLatestBlockhash('confirmed');
  await Promise.all(
    sends.map(async ({ a, plan, ixs }) => {
      try {
        const tx = new Transaction({ feePayer: signer.publicKey, recentBlockhash: blockhash }).add(...ixs);
        tx.sign(signer);
        const signature = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 2 });
        res.sent++;
        const stake = Array.from({ length: BLOCKS }, () => 0n);
        for (const g of plan.groups) for (let s = 0; s < BLOCKS; s++) if (g.mask & (1 << s)) stake[s] = g.amount;
        await hooks.played({ wallet: a.authority.toBase58(), round: board.roundId, stake, total: plan.total, fee: aiFee(plan.total, a.fee), ev: plan.ev, boardBefore: plan.boardBefore, prize, signature }).catch((e) => err('save', e));
      } catch (e) {
        res.failed++;
        err(a.authority.toBase58().slice(0, 6), e);
      }
    }),
  );
  return res;
}

/** Passes until `budgetMs` is used up, sleeping between them for as long as nothing needs doing. */
export async function run(conn: Connection, signer: Keypair, hooks: Hooks, budgetMs: number, now: () => number = Date.now, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<PassResult[]> {
  const st = newState();
  const out: PassResult[] = [];
  const end = now() + budgetMs;
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
