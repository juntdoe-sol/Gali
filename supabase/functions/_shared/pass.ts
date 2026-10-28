// The Gali sign-in pass, shared by every function that acts for a wallet (dm, play).
// A player signs one short text with their wallet (no transaction, no fee); the function checks the signature and
// hands back a pass, an HMAC over {wallet, expiry} with DM_SECRET. Every later call carries the pass instead of
// a signature, and the function only ever acts for the pass's own wallet.
import { ed25519 } from 'npm:@noble/curves@2.4.0/ed25519.js';
import bs58 from 'npm:bs58@6';

const PASS_DAYS = 30;
const LOGIN_WINDOW_MS = 10 * 60_000;
/** The domain the sign-in text names, so a signature made for another site is useless here. */
export const SIGNIN_DOMAIN = 'galiisland.bounded.page';

const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const isWallet = (w: unknown): w is string => {
  if (typeof w !== 'string' || !B58.test(w)) return false;
  try {
    return bs58.decode(w).length === 32;
  } catch {
    return false;
  }
};

const enc = new TextEncoder();
const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
let hmacKey: CryptoKey | null = null;
async function mac(data: string) {
  const secret = Deno.env.get('DM_SECRET');
  if (!secret || secret.length < 32) throw new Error('DM_SECRET is not set');
  hmacKey ??= await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, enc.encode(data)));
}
export async function makePass(wallet: string) {
  const exp = Date.now() + PASS_DAYS * 86_400_000;
  const head = b64url(enc.encode(JSON.stringify({ w: wallet, e: exp })));
  return { pass: `${head}.${b64url(await mac(head))}`, exp };
}
/** The pass's wallet, or null when the pass is forged, broken or expired. */
export async function readPass(pass: unknown): Promise<string | null> {
  if (typeof pass !== 'string' || pass.length > 400) return null;
  const [head, sig] = pass.split('.');
  if (!head || !sig) return null;
  const want = b64url(await mac(head));
  if (want.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff) return null;
  try {
    const { w, e } = JSON.parse(new TextDecoder().decode(fromB64url(head)));
    return isWallet(w) && Number(e) > Date.now() ? w : null;
  } catch {
    return null;
  }
}

/** What the wallet signs to sign in. The app builds the same text (app/src/game/dm.ts). */
export const signInText = (wallet: string, ts: number) =>
  `${SIGNIN_DOMAIN} wants you to sign in to Gali.\nWallet: ${wallet}\nTime: ${ts}\nThis costs nothing and sends no transaction.`;
/** The text app 1.6 and older signed. Still accepted for messages only. */
export const oldSignInText = (wallet: string, ts: number) => `Gali: sign in to your messages\nWallet: ${wallet}\nTime: ${ts}\nThis costs nothing and sends no transaction.`;

/** Checks a sign-in signature. Returns which text it matched, or null. */
export function checkSignIn(wallet: unknown, ts: unknown, sigB64: unknown): 'new' | 'old' | null {
  const t = Number(ts);
  if (!isWallet(wallet) || !Number.isFinite(t) || typeof sigB64 !== 'string' || sigB64.length > 200) return null;
  if (Math.abs(Date.now() - t) > LOGIN_WINDOW_MS) return null;
  let sig: Uint8Array;
  try {
    sig = Uint8Array.from(atob(sigB64), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
  const key = bs58.decode(wallet);
  try {
    if (ed25519.verify(sig, enc.encode(signInText(wallet, t)), key)) return 'new';
    if (ed25519.verify(sig, enc.encode(oldSignInText(wallet, t)), key)) return 'old';
  } catch {
    return null;
  }
  return null;
}
