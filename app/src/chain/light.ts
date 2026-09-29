/**
 * The small, dependency-free part of the chain layer.
 *
 * Everything the first screen needs to know about the chain lives here: whether
 * on-chain mode is deployed, which cluster, the program and mint addresses as
 * strings, and a few pure helpers. It must not import @solana/web3.js, Anchor,
 * spl-token, bn.js or anything under ./client, ./board, ./webWallet or ./ore at
 * runtime: this file is in the startup bundle, and the heavy chain code is only
 * fetched (see ./lazy) when a wallet or an on-chain read actually needs it.
 *
 * client.ts and board.ts re-export these values, so this is the one source.
 */
import deployment from './deployment.json';
import type { Claimable } from './board';

export type { ChainPlayer, Economy, LeaderRow, WebWalletInfo } from './client';
export type { BoardRound, Claimable, OreClock, RoundOutcome } from './board';

export const CLUSTER = deployment.cluster as 'devnet';
export const PROGRAM_ID_STR: string = deployment.programId;
export const SKR_MINT_STR: string = deployment.skrMint;
export const chainReady = deployment.skrMint !== '11111111111111111111111111111111';

// EXPO_PUBLIC_RPC_URL overrides the endpoint at build time (e.g. a private devnet RPC, or a local validator for tests).
export const RPC_URL = process.env.EXPO_PUBLIC_RPC_URL || 'https://api.devnet.solana.com';

/** True when an RPC turned us away for asking too often (public endpoints do this a lot). */
export const isRateLimited = (e: unknown) => /\b429\b|rate limit|too many requests/i.test(String((e as Error)?.message ?? e));

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Retries 429s with a growing pause, so a busy RPC slows the app down instead of breaking it. */
export const retryingFetch: typeof fetch = async (input, init) => {
  let last: Response | undefined;
  for (let i = 0; i < 4; i++) {
    const res = await fetch(input as RequestInfo, init as RequestInit);
    if (res.status !== 429) return res;
    last = res;
    await wait(400 * 2 ** i);
  }
  return last as Response;
};

/** A bare JSON-RPC call, for the one read the app makes before the chain code has loaded. */
async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await retryingFetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const j = (await res.json()) as { result?: T; error?: { code: number; message: string } };
  if (j.error) throw new Error(`${method}: ${j.error.code} ${j.error.message}`);
  return j.result as T;
}

/**
 * Chain clock minus device clock, in ms. Same two reads as web3's
 * connection.getSlot() + getBlockTime() at 'confirmed', without loading web3.
 */
export async function clockOffsetMs(): Promise<number> {
  const slot = await rpc<number>('getSlot', [{ commitment: 'confirmed' }]);
  const t = await rpc<number | null>('getBlockTime', [slot]);
  return t ? t * 1000 - Date.now() : 0;
}

export const MAX_SESSION_FUND_SOL = 1;

/**
 * What ORE charges on claiming ORE that has not been refined yet. Their fee, not Gali's.
 * Copied from ORE_REFINING_BPS (1_000n) in ./ore/read.ts, which pulls in web3;
 * board.ts checks the two agree when the chain code loads.
 */
export const REFINING_FEE_BPS = 1_000;
export const REFINING_FEE = REFINING_FEE_BPS / 10_000;

export const NOTHING_CLAIMABLE: Claimable = {
  sol: 0,
  unrefined: 0,
  refined: 0,
  fee: 0,
  roundId: 0,
  settled: true,
};

export const short = (k: string) => `${k.slice(0, 4)}…${k.slice(-4)}`;
export const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=${CLUSTER}`;

/** The web wallet picker error, recognised without loading the class that throws it. */
export const isPickWalletError = (e: unknown): e is Error & { wallets: import('./client').WebWalletInfo[] } =>
  (e as Error)?.name === 'PickWalletError' && Array.isArray((e as { wallets?: unknown }).wallets);
