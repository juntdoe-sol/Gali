// Make a new Solana key for the autopilot server, without any packages.
// Usage: node scripts/executor-key.mjs <out.json>
// Writes the secret in solana-keygen format (a JSON array of 64 numbers) and prints the public key.
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';

const out = process.argv[2];
if (!out) throw new Error('usage: node scripts/executor-key.mjs <out.json>');
if (existsSync(out)) throw new Error(`${out} already exists; not overwriting a key`);
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
writeFileSync(out, JSON.stringify([...seed, ...pub]), { mode: 0o600 });

const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
let n = BigInt('0x' + Buffer.from(pub).toString('hex'));
let s = '';
while (n > 0n) {
  s = A[Number(n % 58n)] + s;
  n /= 58n;
}
for (const b of pub) {
  if (b !== 0) break;
  s = '1' + s;
}
console.log(`server key saved to ${out}`);
console.log(`public key (send ~0.05 SOL here): ${s}`);
