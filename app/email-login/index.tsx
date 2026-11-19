/**
 * Email login for the web build: Privy signs the player in with an emailed code and makes them a Solana wallet
 * (an embedded wallet: Privy holds the key in its secure setup; Gali never sees it).
 *
 * Built on its own with esbuild (`npm run build:email`) into public/email-login.js, a script that sets
 * window.GaliEmail. src/chain/webWallet.ts adds that script the first time a player picks Email. It is kept out
 * of the Metro bundle because Privy's many internal chunks would land in __common, which every player downloads
 * at startup.
 *
 * Privy is React hooks, but the wallet code is plain functions, so Privy runs in its own small React root
 * (outside the game's tree) and a bridge component hands its functions and state out to this module.
 */
import { createRoot } from 'react-dom/client';
import { useEffect } from 'react';
import { PrivyProvider, useLogin, usePrivy, type PrivyClientConfig } from '@privy-io/react-auth';
import { useExportWallet, useSignMessage, useSignTransaction, useWallets, type ConnectedStandardSolanaWallet } from '@privy-io/react-auth/solana';
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';

export interface EmailConfig {
  appId: string;
  cluster: 'mainnet' | 'devnet';
  rpcUrl: string;
}
type Chain = 'solana:mainnet' | 'solana:devnet';
let CHAIN: Chain = 'solana:mainnet';

interface State {
  ready: boolean;
  authenticated: boolean;
  wallet: ConnectedStandardSolanaWallet | null;
}
interface Fns {
  login: () => void;
  logout: () => Promise<void>;
  signTransaction: ReturnType<typeof useSignTransaction>['signTransaction'];
  signMessage: ReturnType<typeof useSignMessage>['signMessage'];
  exportWallet: ReturnType<typeof useExportWallet>['exportWallet'];
}

let state: State = { ready: false, authenticated: false, wallet: null };
let fns: Fns | null = null;
const waiters = new Set<() => void>();
const changed = () => waiters.forEach((w) => w());
/** The result of the login modal: resolve on success, reject when the player closes it. */
let loginDone: { ok: () => void; fail: (e: Error) => void } | null = null;

function Bridge() {
  const { ready, authenticated, logout } = usePrivy();
  const { login } = useLogin({
    onComplete: () => loginDone?.ok(),
    onError: (e) => loginDone?.fail(new Error(e === 'exited_auth_flow' ? 'Email sign-in was closed.' : `Email sign-in failed (${String(e)}).`)),
  });
  const { wallets, ready: walletsReady } = useWallets();
  const { signTransaction } = useSignTransaction();
  const { signMessage } = useSignMessage();
  const { exportWallet } = useExportWallet();
  const wallet = wallets.find((w) => (w.standardWallet as { isPrivyWallet?: boolean }).isPrivyWallet) ?? wallets[0] ?? null;
  useEffect(() => {
    fns = { login: () => login({ loginMethods: ['email'] }), logout, signTransaction, signMessage, exportWallet };
    state = { ready: ready && (!authenticated || walletsReady), authenticated, wallet };
    changed();
  });
  return null;
}

let started = false;
function start(cfg: EmailConfig) {
  if (started) return;
  started = true;
  CHAIN = cfg.cluster === 'mainnet' ? 'solana:mainnet' : 'solana:devnet';
  const ws = cfg.cluster === 'mainnet' ? 'wss://api.mainnet-beta.solana.com' : 'wss://api.devnet.solana.com';
  // Privy's type asks for a test-cluster RPC (with airdrops); the mainnet one works the same for signing
  const rpcs = { [CHAIN]: { rpc: createSolanaRpc(cfg.rpcUrl), rpcSubscriptions: createSolanaRpcSubscriptions(ws) } } as unknown as NonNullable<NonNullable<PrivyClientConfig['solana']>['rpcs']>;
  const host = document.createElement('div');
  host.id = 'gali-email-login';
  document.body.appendChild(host);
  // The game's open React Native modals trap focus (a capture 'focus' listener on document pulls it back inside
  // them), so Privy's email box could not be typed in. Window capture runs first: stop focus events inside Privy's
  // windows there (its dialogs render in a headlessui portal on <body>, not inside `host`). React's own onFocus
  // uses 'focusin', so Privy keeps working.
  window.addEventListener(
    'focus',
    (e) => {
      const t = e.target;
      if (t instanceof Element && (host.contains(t) || t.closest('#headlessui-portal-root, #privy-dialog'))) e.stopImmediatePropagation();
    },
    true,
  );
  createRoot(host).render(
    <PrivyProvider
      appId={cfg.appId}
      config={{
        loginMethods: ['email'],
        appearance: { theme: '#070d20', accentColor: '#ffcf4a', walletChainType: 'solana-only' },
        embeddedWallets: { solana: { createOnLogin: 'users-without-wallets' }, ethereum: { createOnLogin: 'off' } },
        solana: { rpcs },
      }}
    >
      <Bridge />
    </PrivyProvider>,
  );
}

/** Wait until `test` holds (checked on every Privy state change), or fail after `ms`. */
function until(test: () => boolean, ms: number, why: string): Promise<void> {
  if (test()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      waiters.delete(check);
      reject(new Error(why));
    }, ms);
    const check = () => {
      if (!test()) return;
      clearTimeout(t);
      waiters.delete(check);
      resolve();
    };
    waiters.add(check);
  });
}

const need = () => {
  if (!fns || !state.wallet) throw new Error('Sign in with email first.');
  return { f: fns, wallet: state.wallet };
};

/** The address of the signed-in player's email wallet, or null. `silent` never opens the login window. */
export async function emailConnect(cfg: EmailConfig, silent: boolean): Promise<string | null> {
  start(cfg);
  await until(() => Boolean(fns && state.ready), 20_000, 'Email sign-in could not load. Check your connection and try again.');
  if (state.authenticated && state.wallet) return state.wallet.address;
  if (silent) return null;
  if (!state.authenticated) {
    await new Promise<void>((ok, fail) => {
      loginDone = { ok, fail };
      fns!.login();
    }).finally(() => {
      loginDone = null;
    });
  }
  // createOnLogin makes the wallet right after the code is accepted; give it a moment to show up
  await until(() => Boolean(state.authenticated && state.wallet), 30_000, 'Your email wallet did not load. Try again.');
  return state.wallet!.address;
}

export function emailAddress(): string | null {
  return state.authenticated && state.wallet ? state.wallet.address : null;
}

export async function emailSignTransaction(bytes: Uint8Array): Promise<Uint8Array> {
  const { f, wallet } = need();
  const { signedTransaction } = await f.signTransaction({ transaction: bytes, wallet, chain: CHAIN });
  return signedTransaction;
}

export async function emailSignMessage(msg: Uint8Array): Promise<Uint8Array> {
  const { f, wallet } = need();
  const { signature } = await f.signMessage({ message: msg, wallet });
  return signature;
}

/** Privy's own window that shows the wallet's private key, so the player can move it to Phantom or Solflare. */
export async function emailExportKey(): Promise<void> {
  const { f, wallet } = need();
  await f.exportWallet({ address: wallet.address });
}

export async function emailLogout(): Promise<void> {
  if (fns && state.authenticated) await fns.logout().catch(() => undefined);
}
