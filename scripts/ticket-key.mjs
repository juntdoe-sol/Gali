// Make the arena ticket key, without any packages. Run once, on your own computer.
// Usage: node scripts/ticket-key.mjs <out.txt>
// Saves the secret seed (hex) to <out.txt> and prints the two settings to copy:
//   TICKET_KEY             the secret: a Supabase secret for the `play` function, never anywhere in the app
//   EXPO_PUBLIC_TICKET_KEY the public half: goes into the app build (eas.json apk-live env and the web build)
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';

const out = process.argv[2];
if (!out) throw new Error('usage: node scripts/ticket-key.mjs <out.txt>');
if (existsSync(out)) throw new Error(`${out} already exists; not overwriting a key`);
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const seed = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32);
const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
writeFileSync(out, Buffer.from(seed).toString('hex') + '\n', { mode: 0o600 });

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
console.log(`secret saved to ${out}`);
console.log(`npx supabase secrets set TICKET_KEY=$(cat ${out})`);
console.log(`EXPO_PUBLIC_TICKET_KEY=${s}`);
