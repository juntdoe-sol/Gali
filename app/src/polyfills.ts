// Must load before @solana/web3.js / anchor.
import 'react-native-get-random-values';
import 'text-encoding-polyfill';
import { Buffer } from 'buffer';

const g = globalThis as unknown as { Buffer?: typeof Buffer; process?: { env: Record<string, string> } };
if (!g.Buffer) g.Buffer = Buffer;
if (!g.process) g.process = { env: {} };
