// Browser wallets for the web build (Mobile Wallet Adapter only works on Android).
// Uses the wallet's injected provider: Phantom, Solflare, Backpack, or any `window.solana`.
// Transactions are signed by the wallet and sent through our own devnet connection, so the
// wallet's network setting doesn't matter for sending (switch it to devnet to see balances).
import { PublicKey, type Transaction } from '@solana/web3.js';

interface InjectedProvider {
  publicKey?: { toString(): string } | null;
  isConnected?: boolean;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey?: { toString(): string } } | void>;
  disconnect?(): Promise<void>;
  signTransaction<T extends Transaction>(tx: T): Promise<T>;
}

type W = typeof globalThis & {
  phantom?: { solana?: InjectedProvider };
  solflare?: InjectedProvider;
  backpack?: InjectedProvider;
  solana?: InjectedProvider;
};

export function findProvider(): { name: string; provider: InjectedProvider } | null {
  const w = globalThis as W;
  if (w.phantom?.solana) return { name: 'Phantom', provider: w.phantom.solana };
  if (w.solflare) return { name: 'Solflare', provider: w.solflare };
  if (w.backpack) return { name: 'Backpack', provider: w.backpack };
  if (w.solana) return { name: 'Solana wallet', provider: w.solana };
  return null;
}

function need() {
  const found = findProvider();
  if (!found) throw new Error('No Solana wallet found. Install Phantom or Solflare in this browser.');
  return found.provider;
}

export async function webConnect(): Promise<PublicKey> {
  const p = need();
  const res = await p.connect();
  const key = (res && res.publicKey) || p.publicKey;
  if (!key) throw new Error('Wallet did not share an address');
  return new PublicKey(key.toString());
}

/** Reconnect without a pop-up if the site is already trusted; otherwise ask. */
export async function webOwner(): Promise<PublicKey> {
  const p = need();
  if (p.publicKey && p.isConnected !== false) return new PublicKey(p.publicKey.toString());
  try {
    const res = await p.connect({ onlyIfTrusted: true });
    const key = (res && res.publicKey) || p.publicKey;
    if (key) return new PublicKey(key.toString());
  } catch {
    /* not trusted yet */
  }
  return webConnect();
}

export async function webDisconnect() {
  await findProvider()?.provider.disconnect?.().catch(() => undefined);
}

export async function webSign<T extends Transaction>(tx: T): Promise<T> {
  return need().signTransaction(tx);
}
