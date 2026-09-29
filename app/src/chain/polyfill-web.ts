// Globals that @solana/web3.js, Anchor and spl-token expect when they evaluate.
// Every chain module imports this FIRST, so on web it runs inside the lazily loaded
// chain chunk before any of those libraries. Browsers already have TextEncoder and
// crypto.getRandomValues; native gets the full set from src/polyfills.native.ts.
import { Buffer } from 'buffer';

const g = globalThis as unknown as { Buffer?: typeof Buffer; process?: { env: Record<string, string> } };
if (!g.Buffer) g.Buffer = Buffer;
if (!g.process) g.process = { env: {} };
