// Builds email-login/index.tsx into public/email-login.js (see the note at the top of index.tsx).
// Run: npm run build:email   (build:web runs it first)
import { build } from 'esbuild';

await build({
  entryPoints: ['email-login/index.tsx'],
  outfile: 'public/email-login.js',
  bundle: true,
  format: 'iife',
  globalName: 'GaliEmail',
  platform: 'browser',
  target: 'es2020',
  minify: true,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
  // optional extras inside Privy that Gali doesn't use (card payments, smart wallets, Farcaster)
  external: ['@stripe/stripe-js', 'permissionless', '@farcaster/mini-app-solana', '@abstract-foundation/agw-client'],
  logLevel: 'warning',
  legalComments: 'none',
});
