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

export type { ChainPlayer, LeaderRow, ShopConfig, WebWalletInfo } from './client';
export type { BoardRound, Claimable, OreClock, RoundOutcome } from './board';

/**
 * Which network the build talks to. EXPO_PUBLIC_NETWORK=mainnet turns on ORE live
 * mode: real rounds on ORE's mainnet board, each deploy and claim signed by the
 * player's own wallet. Gali's program is not needed for that, so it stays off on
 * mainnet until deployment.json names a mainnet deploy.
 */
export const NETWORK: 'devnet' | 'mainnet' = process.env.EXPO_PUBLIC_NETWORK === 'mainnet' ? 'mainnet' : 'devnet';
export const oreLive = NETWORK === 'mainnet';
export const CLUSTER: 'devnet' | 'mainnet' = oreLive ? 'mainnet' : (deployment.cluster as 'devnet');
export const PROGRAM_ID_STR: string = deployment.programId;
export const SKR_MINT_STR: string = deployment.skrMint;
/** Gali's own program (points, SKR jackpot, gear) is deployed on the network this build uses. */
export const chainReady =
  deployment.skrMint !== '11111111111111111111111111111111' && (deployment.cluster as string) === CLUSTER;
/** Anything on chain at all: Gali's program, or ORE's board in live mode. */
export const onChainMode = chainReady || oreLive;

/** Most SOL a live player may put on the board in one round. A guard against a slipped finger, not a limit on ORE. */
export const LIVE_MAX_ROUND_SOL = 0.5;

// Public transaction transport/local validator only. EXPO_PUBLIC_* is bundled;
// never configure a credential-bearing provider URL here.
export const RPC_URL =
  process.env.EXPO_PUBLIC_RPC_URL || (oreLive ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com');
// Enable only after the Bounded read proxy is deployed and verified. No secrets.
const READ_RPC_URL = oreLive ? process.env.EXPO_PUBLIC_RPC_READ_URL : undefined;
const PROXIED_READS = new Set([
  'getSlot', 'getBlockTime', 'getBlockHeight', 'getLatestBlockhash',
  'getBalance', 'getTokenAccountBalance', 'getAccountInfo', 'getSignatureStatuses',
]);

/** True when an RPC turned us away for asking too often (public endpoints do this a lot). */
export const isRateLimited = (e: unknown) => /\b429\b|rate limit|too many requests/i.test(String((e as Error)?.message ?? e));

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Retries 429s with a growing pause, so a busy RPC slows the app down instead of breaking it. */
export const retryingFetch: typeof fetch = async (input, init) => {
  let target = input;
  if (READ_RPC_URL && String(input) === RPC_URL && typeof init?.body === 'string') {
    try {
      const body = JSON.parse(init.body) as { method?: string };
      if (body && typeof body.method === 'string' && PROXIED_READS.has(body.method)) target = READ_RPC_URL;
    } catch { /* Leave malformed/non-JSON requests to their original transport. */ }
  }
  let last: Response | undefined;
  for (let i = 0; i < 4; i++) {
    const res = await fetch(target as RequestInfo, init as RequestInit);
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
export const explorer = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}${CLUSTER === 'mainnet' ? '' : `?cluster=${CLUSTER}`}`;

/** The web wallet picker error, recognised without loading the class that throws it. */
export const isPickWalletError = (e: unknown): e is Error & { wallets: import('./client').WebWalletInfo[] } =>
  (e as Error)?.name === 'PickWalletError' && Array.isArray((e as { wallets?: unknown }).wallets);
