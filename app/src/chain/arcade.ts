/**
 * The arcade's chain side: ask the house for the tables and each round's commitment, send a stake
 * (an SPL transfer to the house token account plus a memo that names the table, round and choice),
 * and ask for a round to be settled. The house wallet and the rules live in rpc-backend/functions/games.mjs.
 */
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { ASSOCIATED_TOKEN_PROGRAM_ID, connection, sendWithWallet, withTimeout } from './client';
import { ARCADE_URL } from './light';

const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const TOKEN_2022 = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

export const arcadeConfigured = Boolean(ARCADE_URL);

/** One request to the house. Errors carry the house's own sentence. */
export async function arcadeCall<T = Record<string, unknown>>(body: Record<string, unknown>, ms = 12_000): Promise<T> {
  if (!ARCADE_URL) throw new Error('The arcade is not available in this build');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(ARCADE_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    const json = (await res.json().catch(() => null)) as (T & { ok?: boolean; error?: string }) | null;
    if (!json) throw new Error('The arcade did not answer. Try again in a moment.');
    if (json.ok === false && !('early' in json)) throw new Error(json.error || 'The arcade is busy. Try again.');
    return json;
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw new Error('The arcade took too long to answer. Try again.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export interface StakeTable {
  mint: string;
  houseAta: string;
  decimals: number;
  program: string;
}

const unitsOf = (ui: string, decimals: number): bigint => {
  const [w, f = ''] = ui.split('.');
  return BigInt(w) * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals) || '0');
};

/** How much of a token the connected wallet holds (0 when it has no account for it yet). */
export async function tokenBalance(owner: PublicKey, t: Pick<StakeTable, 'mint' | 'program'>): Promise<number> {
  const mint = new PublicKey(t.mint);
  const prog = new PublicKey(t.program);
  const ata = PublicKey.findProgramAddressSync([owner.toBuffer(), prog.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];
  try {
    const r = await withTimeout(connection.getTokenAccountBalance(ata));
    return Number(r.value.uiAmountString ?? r.value.uiAmount ?? 0);
  } catch {
    return 0;
  }
}

/** Send one stake. `memo` is `gali1|<game>|<token>|<round>|<choice>`. Returns the transaction signature. */
export async function sendStake(t: StakeTable, amountUi: string, memo: string): Promise<string> {
  if (!/^gali1\|[tpc]\|[os]\|\d{1,9}\|\d{1,4}$/.test(memo)) throw new Error('Bad stake');
  return sendWithWallet(async (owner) => {
    const mint = new PublicKey(t.mint);
    const prog = new PublicKey(t.program);
    if (!prog.equals(TOKEN_PROGRAM) && !prog.equals(TOKEN_2022)) throw new Error('Unsupported token');
    const src = PublicKey.findProgramAddressSync([owner.toBuffer(), prog.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];
    const units = unitsOf(amountUi, t.decimals);
    const data = Buffer.alloc(10);
    data[0] = 12; // TransferChecked
    new DataView(data.buffer, data.byteOffset, 10).setBigUint64(1, units, true);
    data[9] = t.decimals;
    return [
      new TransactionInstruction({
        programId: prog,
        keys: [
          { pubkey: src, isSigner: false, isWritable: true },
          { pubkey: mint, isSigner: false, isWritable: false },
          { pubkey: new PublicKey(t.houseAta), isSigner: false, isWritable: true },
          { pubkey: owner, isSigner: true, isWritable: false },
        ],
        data,
      }),
      new TransactionInstruction({ programId: MEMO_PROGRAM, keys: [], data: Buffer.from(memo, 'utf8') }),
    ];
  });
}
