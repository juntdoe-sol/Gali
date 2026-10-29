// The few Solana pieces the relay needs, with no packages: base58, and ORE's round address
// (a program-derived address: sha256 over the seeds, retried until it lands off the ed25519 curve).

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const INDEX = new Map([...ALPHABET].map((c, i) => [c, i]));

export function b58encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  return '1'.repeat(zeros) + out;
}

export function b58decode(s: string): Uint8Array {
  let zeros = 0;
  while (zeros < s.length && s[zeros] === '1') zeros++;
  let n = 0n;
  for (const c of s) {
    const v = INDEX.get(c);
    if (v === undefined) throw new Error('bad base58');
    n = n * 58n + BigInt(v);
  }
  const body: number[] = [];
  while (n > 0n) {
    body.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  return new Uint8Array([...new Array(zeros).fill(0), ...body]);
}

/* ed25519: is this 32-byte string a valid compressed point? (A PDA must not be one.) */
const P = 2n ** 255n - 19n;
const mod = (a: bigint) => ((a % P) + P) % P;
function pow(b: bigint, e: bigint): bigint {
  let r = 1n;
  b = mod(b);
  while (e > 0n) {
    if (e & 1n) r = mod(r * b);
    b = mod(b * b);
    e >>= 1n;
  }
  return r;
}
const D = mod(-121665n * pow(121666n, P - 2n));
const SQRT_M1 = pow(2n, (P - 1n) / 4n);

export function isOnCurve(bytes: Uint8Array): boolean {
  if (bytes.length !== 32) return false;
  const b = bytes.slice();
  b[31] &= 0x7f;
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(b[i]);
  if (y >= P) return false;
  const y2 = mod(y * y);
  const u = mod(y2 - 1n);
  const v = mod(D * y2 + 1n);
  // x = sqrt(u/v) via x = u v^3 (u v^7)^((p-5)/8)
  const v3 = mod(v * v * v);
  let x = mod(u * v3 * pow(u * v3 * v3 * v, (P - 5n) / 8n));
  const vx2 = mod(v * x * x);
  if (vx2 === u) return true;
  if (vx2 === mod(-u)) {
    x = mod(x * SQRT_M1);
    return true;
  }
  return false;
}

const enc = new TextEncoder();

async function sha256(parts: Uint8Array[]): Promise<Uint8Array> {
  const len = parts.reduce((a, p) => a + p.length, 0);
  const buf = new Uint8Array(len);
  let o = 0;
  for (const p of parts) {
    buf.set(p, o);
    o += p.length;
  }
  return new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
}

export async function findProgramAddress(seeds: Uint8Array[], programId: string): Promise<string> {
  const pid = b58decode(programId);
  const tag = enc.encode('ProgramDerivedAddress');
  for (let bump = 255; bump >= 0; bump--) {
    const h = await sha256([...seeds, new Uint8Array([bump]), pid, tag]);
    if (!isOnCurve(h)) return b58encode(h);
  }
  throw new Error('no program address');
}

export const ORE_PROGRAM_ID = 'oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv';
export const BOARD_ADDRESS = 'BrcSxdp1nXFzou1YyDnQJcPNBNHgoypZmTsyKBSLLXzi';

const u64le = (n: bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return b;
};

const roundCache = new Map<string, string>();
/** ORE's round account for a round id (seeds "round" + u64 LE), cached. */
export async function roundAddress(id: bigint): Promise<string> {
  const k = id.toString();
  const hit = roundCache.get(k);
  if (hit) return hit;
  const a = await findProgramAddress([enc.encode('round'), u64le(id)], ORE_PROGRAM_ID);
  if (roundCache.size > 64) roundCache.clear();
  roundCache.set(k, a);
  return a;
}

export const boardAddressCheck = () => findProgramAddress([enc.encode('board')], ORE_PROGRAM_ID);
