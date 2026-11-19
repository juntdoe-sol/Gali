// Browser wallets for the web build (Mobile Wallet Adapter only works on Android).
// Finds wallets two ways:
//  - Wallet Standard (Jupiter, Phantom, Solflare, Backpack and most current extensions)
//  - older injected providers (window.phantom.solana, window.solflare, window.backpack, window.solana)
// Transactions are signed by the wallet and sent through our own connection to CLUSTER, so the
// wallet's network setting doesn't matter for sending (switch it to the same network to see balances).
import './polyfill-web';
import { PublicKey, Transaction } from '@solana/web3.js';
import { CLUSTER, RPC_URL } from './light';

export interface WebWalletInfo {
  name: string;
  icon?: string;
}

interface Adapter extends WebWalletInfo {
  connect(silent: boolean): Promise<PublicKey | null>;
  current(): PublicKey | null;
  disconnect(): Promise<void>;
  signTransaction(tx: Transaction): Promise<Transaction>;
  /** sign plain bytes (a sign-in text); returns the 64-byte signature */
  signMessage?(msg: Uint8Array): Promise<Uint8Array>;
}

/* ---------- Wallet Standard ---------- */

interface StdAccount {
  address: string;
  publicKey: Uint8Array;
  chains: readonly string[];
}
interface StdWallet {
  name: string;
  icon?: string;
  chains: readonly string[];
  accounts: readonly StdAccount[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  features: Record<string, any>;
}

const standard: StdWallet[] = [];
const CHOICE_KEY = 'gali-web-wallet';
const CHAIN = `solana:${CLUSTER}`;

function registerStd(...wallets: StdWallet[]) {
  for (const w of wallets) {
    if (!standard.includes(w) && w.features?.['solana:signTransaction'] && w.features?.['standard:connect']) standard.push(w);
  }
  return () => undefined;
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  const api = Object.freeze({ register: registerStd });
  window.addEventListener('wallet-standard:register-wallet', (e: Event) => {
    const cb = (e as CustomEvent).detail;
    if (typeof cb === 'function') cb(api);
  });
  try {
    window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api }));
  } catch {
    /* very old browser */
  }
}

function stdAdapter(w: StdWallet): Adapter {
  let account: StdAccount | null = null;
  const pick = (list: readonly StdAccount[]) => list.find((a) => !a.chains?.length || a.chains.some((c) => c.startsWith('solana:'))) ?? list[0] ?? null;
  const adapter: Adapter = {
    name: w.name,
    icon: w.icon,
    current: () => {
      account = account ?? pick(w.accounts);
      return account ? new PublicKey(account.publicKey) : null;
    },
    async connect(silent) {
      if (!silent || w.accounts.length === 0) {
        const res = await w.features['standard:connect'].connect(silent ? { silent: true } : undefined);
        account = pick(res?.accounts?.length ? res.accounts : w.accounts);
      } else account = pick(w.accounts);
      return account ? new PublicKey(account.publicKey) : null;
    },
    async disconnect() {
      account = null;
      try {
        await w.features['standard:disconnect']?.disconnect?.();
      } catch {
        /* ignore */
      }
    },
    async signTransaction(tx) {
      if (!account) await adapter.connect(false);
      if (!account) throw new Error('Wallet did not share an address');
      const bytes = tx.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });
      const input: Record<string, unknown> = {
        transaction: new Uint8Array(bytes),
        account,
      };
      // only name the chain when the wallet lists it; some mainnet-only wallets reject unknown chains
      if (w.chains?.includes(CHAIN)) input.chain = CHAIN;
      const [out] = await w.features['solana:signTransaction'].signTransaction(input);
      return Transaction.from(out.signedTransaction);
    },
    async signMessage(msg) {
      const f = w.features['solana:signMessage'];
      if (!f) throw new Error(`${w.name} can't sign a message. Try another wallet.`);
      if (!account) await adapter.connect(false);
      if (!account) throw new Error('Wallet did not share an address');
      const [out] = await f.signMessage({ account, message: msg });
      return new Uint8Array(out.signature);
    },
  };
  return adapter;
}

/* ---------- Older injected providers ---------- */

interface InjectedProvider {
  publicKey?: { toString(): string } | null;
  isConnected?: boolean;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey?: { toString(): string } } | void>;
  disconnect?(): Promise<void>;
  signTransaction<T extends Transaction>(tx: T): Promise<T>;
  signMessage?(msg: Uint8Array, display?: string): Promise<{ signature: Uint8Array } | Uint8Array>;
}

type W = typeof globalThis & {
  phantom?: { solana?: InjectedProvider };
  solflare?: InjectedProvider;
  backpack?: InjectedProvider;
  jupiter?: { solana?: InjectedProvider };
  solana?: InjectedProvider;
};

function injectedAdapter(name: string, p: InjectedProvider): Adapter {
  return {
    name,
    current: () => (p.publicKey && p.isConnected !== false ? new PublicKey(p.publicKey.toString()) : null),
    async connect(silent) {
      const res = await p.connect(silent ? { onlyIfTrusted: true } : undefined);
      const k = (res && res.publicKey) || p.publicKey;
      return k ? new PublicKey(k.toString()) : null;
    },
    async disconnect() {
      await p.disconnect?.().catch(() => undefined);
    },
    signTransaction: (tx) => p.signTransaction(tx),
    async signMessage(msg) {
      if (typeof p.signMessage !== 'function') throw new Error(`${name} can't sign a message. Try another wallet.`);
      const out = await p.signMessage(msg, 'utf8');
      return new Uint8Array(out instanceof Uint8Array ? out : out.signature);
    },
  };
}

const injectedCache = new Map<InjectedProvider, Adapter>();

function injected(): Adapter[] {
  const w = globalThis as W;
  const out: Adapter[] = [];
  const add = (name: string, p?: InjectedProvider) => {
    if (!p || typeof p.signTransaction !== 'function' || out.some((a) => injectedCache.get(p) === a)) return;
    if (!injectedCache.has(p)) injectedCache.set(p, injectedAdapter(name, p));
    out.push(injectedCache.get(p)!);
  };
  add('Phantom', w.phantom?.solana);
  add('Jupiter', w.jupiter?.solana);
  add('Solflare', w.solflare);
  add('Backpack', w.backpack);
  add('Solana wallet', w.solana);
  return out;
}

/* ---------- Email (Privy embedded wallet) ---------- */

/** Privy app id (public). Empty: no Email option. */
const PRIVY_APP_ID = process.env.EXPO_PUBLIC_PRIVY_APP_ID || '';
export const EMAIL_WALLET = 'Email';

/** What email-login/index.tsx exports (kept by hand: type-checking Privy's types here runs tsc out of memory). */
interface EmailApi {
  emailConnect(cfg: { appId: string; cluster: 'mainnet' | 'devnet'; rpcUrl: string }, silent: boolean): Promise<string | null>;
  emailSignTransaction(bytes: Uint8Array): Promise<Uint8Array>;
  emailSignMessage(msg: Uint8Array): Promise<Uint8Array>;
  emailExportKey(): Promise<void>;
  emailLogout(): Promise<void>;
}
let privyP: Promise<EmailApi> | null = null;
/** Adds public/email-login.js (Privy, built on its own) the first time it's needed; it sets window.GaliEmail. */
const privy = () =>
  (privyP ??= new Promise<EmailApi>((ok, fail) => {
    const w = globalThis as typeof globalThis & { GaliEmail?: EmailApi };
    if (w.GaliEmail) return ok(w.GaliEmail);
    const s = document.createElement('script');
    s.src = '/email-login.js';
    s.async = true;
    s.onload = () => (w.GaliEmail ? ok(w.GaliEmail) : fail(new Error('Email sign-in did not load. Refresh and try again.')));
    s.onerror = () => fail(new Error('Email sign-in could not load. Check your connection and try again.'));
    document.head.appendChild(s);
  }).catch((e) => {
    privyP = null;
    throw e;
  }));
const EMAIL_CFG = { appId: PRIVY_APP_ID, cluster: CLUSTER, rpcUrl: RPC_URL };

let emailCached: Adapter | null = null;
function emailAdapter(): Adapter {
  if (emailCached) return emailCached;
  let key: PublicKey | null = null;
  emailCached = {
    name: EMAIL_WALLET,
    current: () => key,
    async connect(silent) {
      const a = await (await privy()).emailConnect(EMAIL_CFG, silent);
      key = a ? new PublicKey(a) : null;
      return key;
    },
    async disconnect() {
      key = null;
      if (privyP) await (await privy()).emailLogout();
    },
    async signTransaction(tx) {
      const bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
      return Transaction.from((await (await privy()).emailSignTransaction(new Uint8Array(bytes))));
    },
    signMessage: async (msg) => (await privy()).emailSignMessage(msg),
  };
  return emailCached;
}

/** Show the email wallet's private key in Privy's own window (to move it to another wallet). */
export async function exportEmailWallet() {
  await (await privy()).emailExportKey();
}

/* ---------- Picking a wallet ---------- */

const stdCache = new Map<StdWallet, Adapter>();

function adapters(): Adapter[] {
  const list: Adapter[] = standard.map((w) => {
    if (!stdCache.has(w)) stdCache.set(w, stdAdapter(w));
    return stdCache.get(w)!;
  });
  const names = list.map((a) => a.name.toLowerCase());
  for (const a of injected()) {
    const n = a.name.toLowerCase();
    // the Wallet Standard version of the same wallet wins; a bare window.solana is dropped when anything else exists
    if (names.some((s) => s.includes(n) || n.includes(s))) continue;
    if (a.name === 'Solana wallet' && list.length) continue;
    list.push(a);
  }
  if (PRIVY_APP_ID) list.push(emailAdapter());
  return list;
}

export function listWebWallets(): WebWalletInfo[] {
  return adapters().map(({ name, icon }) => ({ name, icon }));
}

const choice = {
  get: () => {
    try {
      return globalThis.localStorage?.getItem(CHOICE_KEY) ?? null;
    } catch {
      return null;
    }
  },
  set: (v: string | null) => {
    try {
      if (v) globalThis.localStorage?.setItem(CHOICE_KEY, v);
      else globalThis.localStorage?.removeItem(CHOICE_KEY);
    } catch {
      /* private mode */
    }
  },
};

/** Thrown when several wallets are installed and the player hasn't picked one yet. */
export class PickWalletError extends Error {
  wallets: WebWalletInfo[];
  constructor(wallets: WebWalletInfo[]) {
    super('Pick a wallet');
    this.name = 'PickWalletError';
    this.wallets = wallets;
  }
}

function chosen(): Adapter {
  const all = adapters();
  // no wallet in this browser: an empty pick list, so the app can offer to open Gali inside a wallet's own browser
  if (!all.length) throw new PickWalletError([]);
  const saved = choice.get();
  const hit = saved ? all.find((a) => a.name === saved) : undefined;
  if (hit) return hit;
  // a lone browser wallet connects straight away; Email alone still shows the list, with the wallet-app tips
  if (all.length === 1 && all[0].name !== EMAIL_WALLET) return all[0];
  throw new PickWalletError(all.map(({ name, icon }) => ({ name, icon })));
}

/** Connect with a pop-up. Pass `name` after the player picks from the list. */
export async function webConnect(name?: string): Promise<PublicKey> {
  if (name) choice.set(name);
  const a = chosen();
  // a failed or closed email sign-in forgets the choice, so the next tap shows the list again
  const key = await a.connect(false).catch((e) => {
    if (a.name === EMAIL_WALLET) choice.set(null);
    throw e;
  });
  if (!key) throw new Error('Wallet did not share an address');
  choice.set(a.name);
  return key;
}

/** Reconnect without a pop-up if the site is already trusted; otherwise ask. */
export async function webOwner(): Promise<PublicKey> {
  const a = chosen();
  const now = a.current();
  if (now) return now;
  try {
    const key = await a.connect(true);
    if (key) return key;
  } catch {
    /* not trusted yet */
  }
  return webConnect();
}

export async function webDisconnect() {
  try {
    await chosen().disconnect();
  } catch {
    /* nothing connected */
  }
  choice.set(null);
}

export async function webSignMessage(msg: Uint8Array): Promise<Uint8Array> {
  const a = chosen();
  if (!a.signMessage) throw new Error(`${a.name} can't sign a message. Try another wallet.`);
  return a.signMessage(msg);
}
export async function webSign<T extends Transaction>(tx: T): Promise<T> {
  return (await chosen().signTransaction(tx)) as T;
}
