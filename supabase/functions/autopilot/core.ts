/**
 * Gali autopilot executor: presses "deploy" on ORE automations every round, so a player's
 * autopilot keeps playing with the app closed.
 *
 * Safe by construction. It only runs automations that are open to any executor (ORE's
 * EXECUTOR_ADDRESS) and whose strategy fixes the spots and the amount on chain (Preferred or
 * Random). For those ORE ignores what the executor sends: the executor cannot choose spots,
 * change the amount, or touch the balance. ORE pays the executor the automation's fee on the
 * first deploy of a round and ignores any later deploy in the same round, so the server, the
 * player's phone and any other bot can all try without double spending.
 *
 * Costs: each deploy is one transaction paid by the server key; the automation's fee (Gali
 * sets 0.00001 SOL) pays it back. Automations whose fee would not cover the cost are skipped.
 */
import { Buffer, ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from './deps.ts';

export const ORE_PROGRAM_ID = new PublicKey('oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv');
const ENTROPY_PROGRAM_ID = new PublicKey('3jSkUuYBoJzQPMEzTvkDFXCZUBksPamrVhrnHR9igu2X');
const BOARD = new PublicKey('BrcSxdp1nXFzou1YyDnQJcPNBNHgoypZmTsyKBSLLXzi');
const TREASURY = new PublicKey('45db2FSR4mcXdSVVZbKbwojU6uYDpMyhpEi7cC8nHaWG');
const CONFIG = new PublicKey('9c9X7aDRAF41faiDs94ELjT19UrGnn72wBW9hPsS4Awy');
const VAR = new PublicKey('BWCaDY96Xe4WkFq1M7UiCCRcChsJ3p51L5KrGzhxgm2E');
export const EXECUTOR_ADDRESS = new PublicKey('executor11111111111111111111111111111111112');
const IX_DEPLOY = 6;
const IX_CHECKPOINT = 2;
const DISC = 8;
export const SIZE = { board: DISC + 32, miner: DISC + 744, automation: DISC + 152 };
const NOT_STARTED = 18_446_744_073_709_551_615n;
/** don't send into the last slots of a round: it would land after the round closes */
export const LOCK_SLOTS = 15;
/** the least fee worth a transaction (base fee plus a small priority fee) */
export const MIN_FEE = 10_000n;
const CU_LIMIT = 200_000;
const CU_PRICE = 5_000; // micro-lamports per CU: at most 1,000 lamports of priority
/** most deploys in one pass, so a flood of automations can't drain the server key */
export const MAX_PER_PASS = 40;

export const STRATEGY = { Random: 0n, Preferred: 1n, Discretionary: 2n, DiscretionaryBps: 3n };

const pda = (seed: string, k: Buffer) => PublicKey.findProgramAddressSync([Buffer.from(seed), k], ORE_PROGRAM_ID)[0];
const minerPda = (a: PublicKey) => pda('miner', a.toBuffer());
const automationPda = (a: PublicKey) => pda('automation', a.toBuffer());
const roundPda = (id: bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(id);
  return pda('round', b);
};

const u64 = (d: Buffer, o: number) => d.readBigUInt64LE(DISC + o);
const key = (d: Buffer, o: number) => new PublicKey(d.subarray(DISC + o, DISC + o + 32));

export interface Board { roundId: bigint; startSlot: bigint; endSlot: bigint }
export function decodeBoard(d: Buffer): Board {
  if (d.length !== SIZE.board) throw new Error(`board is ${d.length} bytes`);
  return { roundId: u64(d, 0), startSlot: u64(d, 8), endSlot: u64(d, 16) };
}
export interface Auto { authority: PublicKey; amount: bigint; balance: bigint; executor: PublicKey; fee: bigint; strategy: bigint; mask: bigint }
export function decodeAutomation(d: Buffer): Auto {
  if (d.length !== SIZE.automation) throw new Error(`automation is ${d.length} bytes`);
  return { amount: u64(d, 0), authority: key(d, 8), balance: u64(d, 40), executor: key(d, 48), fee: u64(d, 80), strategy: u64(d, 88), mask: u64(d, 96) };
}
export interface Miner { authority: PublicKey; deployed: bigint[]; roundId: bigint; checkpointId: bigint }
/** Only the fields the executor needs. Offsets as in app/src/chain/ore/accounts.ts. */
export function decodeMiner(d: Buffer): Miner {
  if (d.length !== SIZE.miner) throw new Error(`miner is ${d.length} bytes`);
  const deployed = Array.from({ length: 25 }, (_, i) => u64(d, 56 + i * 8));
  return { authority: key(d, 0), deployed, checkpointId: u64(d, 40), roundId: u64(d, 656) };
}

const bits = (m: bigint) => {
  let n = 0;
  for (let i = 0n; i < 25n; i++) if (m & (1n << i)) n++;
  return n;
};

/** Is this automation one we run, and can it pay for a round? */
export function runnable(a: Auto): boolean {
  if (!a.executor.equals(EXECUTOR_ADDRESS)) return false;
  if (a.strategy !== STRATEGY.Preferred && a.strategy !== STRATEGY.Random) return false;
  if (a.fee < MIN_FEE) return false;
  const n = BigInt(bits(a.mask));
  if (n === 0n || a.amount === 0n) return false;
  return a.balance >= a.amount * n + a.fee;
}

export type Phase = 'waiting' | 'mining' | 'locked' | 'intermission';
export function phaseOf(b: Board, slot: number): Phase {
  if (b.endSlot === NOT_STARTED) return 'waiting';
  const s = BigInt(slot);
  if (s >= b.endSlot) return 'intermission';
  if (b.endSlot - s < BigInt(LOCK_SLOTS)) return 'locked';
  return 'mining';
}

function deployIx(signer: PublicKey, authority: PublicKey, roundId: bigint, mask: number): TransactionInstruction {
  const data = Buffer.alloc(13);
  data.writeUInt8(IX_DEPLOY, 0);
  data.writeBigUInt64LE(0n, 1); // ignored: the automation sets the amount
  data.writeUInt32LE(mask >>> 0, 9); // ignored for Preferred and Random
  const m = (pubkey: PublicKey, isSigner: boolean, isWritable: boolean) => ({ pubkey, isSigner, isWritable });
  return new TransactionInstruction({
    programId: ORE_PROGRAM_ID,
    data,
    keys: [
      m(signer, true, true),
      m(authority, false, true),
      m(automationPda(authority), false, true),
      m(BOARD, false, true),
      m(CONFIG, false, true),
      m(minerPda(authority), false, true),
      m(roundPda(roundId), false, true),
      m(TREASURY, false, true),
      m(SystemProgram.programId, false, false),
      m(ORE_PROGRAM_ID, false, false),
      m(VAR, false, true),
      m(ENTROPY_PROGRAM_ID, false, false),
    ],
  });
}
function checkpointIx(signer: PublicKey, authority: PublicKey, roundId: bigint): TransactionInstruction {
  const m = (pubkey: PublicKey, isSigner: boolean, isWritable: boolean) => ({ pubkey, isSigner, isWritable });
  return new TransactionInstruction({
    programId: ORE_PROGRAM_ID,
    data: Buffer.from([IX_CHECKPOINT]),
    keys: [
      m(signer, true, true),
      m(authority, false, true),
      m(automationPda(authority), false, true),
      m(BOARD, false, true),
      m(minerPda(authority), false, true),
      m(roundPda(roundId), false, true),
      m(TREASURY, false, true),
      m(SystemProgram.programId, false, false),
    ],
  });
}

/** The instructions for one automation this round, or null when there is nothing to do. */
export function planFor(a: Auto, miner: Miner | null, roundId: bigint, signer: PublicKey): TransactionInstruction[] | null {
  if (!runnable(a)) return null;
  // already played this round (by us, the phone, or another executor)
  if (miner && miner.roundId === roundId && miner.deployed.some((x) => x > 0n)) return null;
  const ixs: TransactionInstruction[] = [ComputeBudgetProgram.setComputeUnitLimit({ units: CU_LIMIT }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: CU_PRICE })];
  // ORE refuses a deploy until the miner's last round is settled
  if (miner && miner.checkpointId !== miner.roundId && miner.roundId < roundId) ixs.push(checkpointIx(signer, a.authority, miner.roundId));
  ixs.push(deployIx(signer, a.authority, roundId, Number(a.mask & 0x1ffffffn)));
  return ixs;
}

export interface PassResult { phase: Phase; round: string; candidates: number; sent: number; skipped: number; failed: number; errors: string[]; /** slots until the round ends (mining or locked), else 0 */ slotsLeft: number }

/**
 * One pass: read the board, find automations to run, send one transaction each.
 * `done` remembers (authority, round) pairs already sent this invocation.
 */
export async function pass(conn: Connection, signer: Keypair, done: Set<string>): Promise<PassResult> {
  const [boardInfo, slot] = await Promise.all([conn.getAccountInfo(BOARD), conn.getSlot('confirmed')]);
  if (!boardInfo) throw new Error('ORE board not found');
  const board = decodeBoard(Buffer.from(boardInfo.data));
  const phase = phaseOf(board, slot);
  const slotsLeft = phase === 'mining' || phase === 'locked' ? Number(board.endSlot - BigInt(slot)) : 0;
  const res: PassResult = { phase, round: board.roundId.toString(), candidates: 0, sent: 0, skipped: 0, failed: 0, errors: [], slotsLeft };
  if (phase === 'locked' || phase === 'intermission') return res;
  const accounts = await conn.getProgramAccounts(ORE_PROGRAM_ID, {
    commitment: 'confirmed',
    filters: [{ dataSize: SIZE.automation }, { memcmp: { offset: DISC + 48, bytes: EXECUTOR_ADDRESS.toBase58() } }],
  });
  const autos = accounts.map((x) => decodeAutomation(Buffer.from(x.account.data))).filter(runnable).filter((a) => !done.has(`${a.authority.toBase58()}:${board.roundId}`));
  res.candidates = autos.length;
  const batch = autos.slice(0, MAX_PER_PASS);
  const miners = batch.length ? await conn.getMultipleAccountsInfo(batch.map((a) => minerPda(a.authority)), 'confirmed') : [];
  const { blockhash } = batch.length ? await conn.getLatestBlockhash('confirmed') : { blockhash: '' };
  await Promise.all(
    batch.map(async (a, i) => {
      const info = miners[i];
      const miner = info && info.data.length === SIZE.miner ? decodeMiner(Buffer.from(info.data)) : null;
      const ixs = planFor(a, miner, board.roundId, signer.publicKey);
      const tag = `${a.authority.toBase58()}:${board.roundId}`;
      if (!ixs) {
        done.add(tag);
        res.skipped++;
        return;
      }
      try {
        const tx = new Transaction({ feePayer: signer.publicKey, recentBlockhash: blockhash }).add(...ixs);
        tx.sign(signer);
        await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 2 });
        done.add(tag);
        res.sent++;
      } catch (e) {
        res.failed++;
        if (res.errors.length < 5) res.errors.push(`${a.authority.toBase58().slice(0, 6)}: ${String((e as Error)?.message ?? e).slice(0, 160)}`);
      }
    }),
  );
  return res;
}

const SLOT_MS = 400;
/**
 * How long to wait after a pass. Busy moments (a new round, a failed send) are checked again in a few
 * seconds; once a round is fully played, sleep until it is over, so the RPC is not asked every few seconds.
 */
export function nextGap(r: PassResult, gapMs: number): number {
  if (r.failed > 0 || r.phase === 'intermission' || r.phase === 'waiting') return gapMs;
  if (r.phase === 'locked') return Math.max(gapMs, r.slotsLeft * SLOT_MS);
  // mining: everything we could play is played; look again as the next round opens
  if (r.sent + r.skipped >= r.candidates) return Math.max(gapMs, r.slotsLeft * SLOT_MS + 2000);
  return gapMs;
}

/** Run passes until `budgetMs` is used up, so every round in the window is played. */
export async function run(conn: Connection, signer: Keypair, budgetMs: number, gapMs = 4000, now: () => number = Date.now, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<PassResult[]> {
  const done = new Set<string>();
  const out: PassResult[] = [];
  const end = now() + budgetMs;
  while (now() < end) {
    let r: PassResult;
    try {
      r = await pass(conn, signer, done);
    } catch (e) {
      r = { phase: 'waiting', round: '?', candidates: 0, sent: 0, skipped: 0, failed: 1, errors: [String((e as Error)?.message ?? e).slice(0, 160)], slotsLeft: 0 };
    }
    out.push(r);
    const gap = nextGap(r, gapMs);
    if (now() + gap >= end) break;
    await sleep(gap);
  }
  return out;
}

/** The server key from its secret: a JSON array of 64 numbers (solana-keygen format) or base64. */
export function loadKey(raw: string): Keypair {
  const t = raw.trim();
  const bytes = t.startsWith('[') ? Uint8Array.from(JSON.parse(t)) : Uint8Array.from(Buffer.from(t, 'base64'));
  return Keypair.fromSecretKey(bytes);
}
