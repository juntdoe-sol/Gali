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
/** Most SOL a live autopilot (ORE automation) may be funded with at once. */
export const LIVE_AUTOPILOT_MAX_SOL = 1;

// Public transaction transport/local validator only. EXPO_PUBLIC_* is bundled;
// never configure a credential-bearing provider URL here.
export const RPC_URL =
  process.env.EXPO_PUBLIC_RPC_URL || (oreLive ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com');
// Enable only after the Bounded read proxy is deployed and verified. No secrets.
const READ_RPC_URL = oreLive ? process.env.EXPO_PUBLIC_RPC_READ_URL : undefined;
/** An optional second copy of the read proxy, tried when the first is down. */
const READ_RPC_URL2 = oreLive ? process.env.EXPO_PUBLIC_RPC_READ_URL2 : undefined;
const PUBLIC_MAINNET_RPC = 'https://api.mainnet-beta.solana.com';
const MAINNET_FALLBACK = oreLive && RPC_URL !== PUBLIC_MAINNET_RPC;
const PROXIED_READS = new Set([
  'getSlot', 'getBlockTime', 'getBlockHeight', 'getLatestBlockhash',
  'getBalance', 'getTokenAccountBalance', 'getAccountInfo', 'getMultipleAccounts', 'getSignatureStatuses', 'sendTransaction',
]);

/** True when an RPC turned us away for asking too often (public endpoints do this a lot). */
export const isRateLimited = (e: unknown) => /\b429\b|rate limit|too many requests/i.test(String((e as Error)?.message ?? e));

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch with a deadline. React Native's fetch has none, and a request that is in
 * flight while the app is in the background (a wallet approval does that) can hang
 * for good. A hung read left the live board "syncing" until the app was restarted.
 */
async function timedFetch(target: RequestInfo, init: RequestInit | undefined, ms: number): Promise<Response> {
  if (typeof AbortController === 'undefined') return fetch(target, init);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(target, { ...(init ?? {}), signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Whether a JSON-RPC body is a read the proxy accepts.  */
function proxiedRead(body: string): boolean {
  try {
    const b = JSON.parse(body) as { method?: string; params?: unknown[] };
    if (!b || typeof b.method !== 'string' || !PROXIED_READS.has(b.method)) return false;
    return true;
  } catch {
    return false; // malformed or non-JSON: leave it to its original transport
  }
}

/**
 * The transport for every RPC call. Reads go through the read proxy when one is
 * configured, and fall back to the direct endpoint when the proxy is rate-limited
 * (its limit is shared by every player in a region), down or slow. 429s on the
 * direct endpoint are retried with a growing pause. Every attempt has a deadline.
 */
const downUntil = new Map<string, number>();
export const retryingFetch: typeof fetch = async (input, init) => {
  if (READ_RPC_URL && String(input) === RPC_URL && typeof init?.body === 'string' && proxiedRead(init.body)) {
    // a proxy that just failed is skipped for a minute, so a dead one does not add its timeout to every read
    const now = Date.now();
    const order = [READ_RPC_URL, READ_RPC_URL2].filter((u): u is string => Boolean(u)).sort((a, b) => (downUntil.get(a) ?? 0) - (downUntil.get(b) ?? 0));
    for (const u of order) {
      try {
        const res = await timedFetch(u, init as RequestInit, 6_000);
        if (res.ok) {
          downUntil.delete(u);
          return res;
        }
        if (res.status >= 500) downUntil.set(u, Date.now() + 60_000);
      } catch {
        downUntil.set(u, Date.now() + 60_000);
      }
    }
  }
  let last: Response | undefined;
  try {
    for (let i = 0; i < 4; i++) {
      const res = await timedFetch(input as RequestInfo, init as RequestInit, 10_000);
      if (res.status !== 429 && res.status < 500 && res.status !== 403) return res;
      last = res;
      await wait(400 * 2 ** i);
      if (res.status >= 500 || res.status === 403) break; // refused or down: do not hammer it, use the last resort
    }
  } catch (e) {
    // a browser blocks cross-origin calls the provider does not allow; fall through to the last resort
    if (!MAINNET_FALLBACK || String(input) !== RPC_URL) throw e;
  }
  // last resort, mainnet only: the public endpoint is rate-limited but keeps the board alive when the proxy
  // and the provider are both unreachable
  if (MAINNET_FALLBACK && String(input) === RPC_URL && typeof init?.body === 'string') {
    try {
      return await timedFetch(PUBLIC_MAINNET_RPC, init as RequestInit, 10_000);
    } catch {
      /* fall through */
    }
  }
  if (last) return last;
  return timedFetch(input as RequestInfo, init as RequestInit, 10_000);
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

/** The SKR token's mint, for lobby tips. Set EXPO_PUBLIC_SKR_MINT at build time; with none, the SKR tip option is hidden. */
const SKR_TIP = (process.env.EXPO_PUBLIC_SKR_MINT ?? 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3').trim();
export const TIP_SKR_MINT: string = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(SKR_TIP) ? SKR_TIP : '';
export const TIP_LIMITS = { SOL: [0.001, 0.005, 0.01], ORE: [0.01, 0.05, 0.1], SKR: [10, 50, 100] } as const;

/** The arcade house (a Bounded function next to the RPC proxy). Set EXPO_PUBLIC_GAMES_URL, or it sits beside the read proxy as /games. */
export const ARCADE_URL: string = (process.env.EXPO_PUBLIC_GAMES_URL ?? '').trim() || (READ_RPC_URL ?? '').replace(/\/rpc\/?$/, '/games');
