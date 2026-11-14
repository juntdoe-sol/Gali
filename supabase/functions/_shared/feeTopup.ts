// Autopilot fee wallet top-ups, sent by the owner from the admin page and recorded by the team function.
// Pure and dependency-free, so the Node tests can check it (app/tests/fee-topup.cjs).

/** The autopilot executor: it pays the network fee on every autopilot send. */
export const FEE_WALLET = '24Rviw6dqRReqd4UDUyRzJw45hCkKKrrariNGpbmKmmj';
/** Below this the admin page's Overview asks the owner to top it up (0.03 SOL, about 3,000 autopilot sends). */
export const FEE_LOW_LAMPORTS = 30_000_000;
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
export const SIG_RE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

export interface FeeTransfer { from: string; lamports: number; at: string; fromBefore: number | null; feeBefore: number | null; feeAfter: number | null }

/**
 * What a confirmed transaction (getTransaction, jsonParsed) sent to the fee wallet with plain system transfers, or
 * why it does not count. Only top-level transfers from one wallet count, so the record matches what the owner sent.
 */
export function feeTransfer(tx: any, feeWallet = FEE_WALLET): FeeTransfer | string {
  if (!tx || !tx.meta || !tx.transaction?.message) return 'That transaction was not found yet. Wait a few seconds and try again.';
  if (tx.meta.err !== null && tx.meta.err !== undefined) return 'That transaction failed on chain.';
  let lamports = 0;
  let from: string | null = null;
  for (const ix of tx.transaction.message.instructions ?? []) {
    if (ix?.programId !== SYSTEM_PROGRAM || ix?.parsed?.type !== 'transfer') continue;
    const info = ix.parsed.info ?? {};
    if (info.destination !== feeWallet || !Number.isSafeInteger(info.lamports) || info.lamports <= 0) continue;
    if (from && info.source !== from) return 'That transaction sends to the fee wallet from more than one wallet.';
    from = String(info.source);
    lamports += info.lamports;
  }
  if (!from || lamports <= 0) return 'That transaction sent no SOL to the autopilot fee wallet.';
  const keys: string[] = tx.transaction.message.accountKeys.map((k: any) => (typeof k === 'string' ? k : k.pubkey));
  const bal = (list: number[] | undefined, who: string) => {
    const i = keys.indexOf(who);
    return i >= 0 && Array.isArray(list) && Number.isFinite(list[i]) ? list[i] : null;
  };
  const at = Number(tx.blockTime) > 0 ? new Date(Number(tx.blockTime) * 1000).toISOString() : new Date().toISOString();
  return { from, lamports, at, fromBefore: bal(tx.meta.preBalances, from), feeBefore: bal(tx.meta.preBalances, feeWallet), feeAfter: bal(tx.meta.postBalances, feeWallet) };
}
