import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import '@solana/wallet-adapter-react-ui/styles.css';
import type { Adapter } from '@solana/wallet-adapter-base';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { RPC_URL } from './chain';
import './styles.css';

// Wallets that support the Wallet Standard (Phantom, Solflare, Backpack…) are detected automatically.
// VITE_BURNER=1 (local testing only) adds a throwaway in-browser wallet; production builds never include it.
const wallets: Adapter[] = [];
if (import.meta.env.DEV && import.meta.env.VITE_BURNER === '1') {
  const { UnsafeBurnerWalletAdapter } = await import('@solana/wallet-adapter-unsafe-burner');
  wallets.push(new UnsafeBurnerWalletAdapter());
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConnectionProvider endpoint={RPC_URL}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <App />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  </StrictMode>,
);
