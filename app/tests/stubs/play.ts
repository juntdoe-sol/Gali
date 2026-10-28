// test stub for game/play.ts: tickets signed with a test key, for the wallet this player was loaded with
import { ed25519 } from '@noble/curves/ed25519.js';
const g: any = globalThis;
const wallet: string | null = g.__wallet ?? null;
const seed: Uint8Array | null = g.__ticketSeed ?? null;
export const playWallet = () => wallet;
export function playReport() {}
export function setPlayPass() {}
export function addBonusXp() {}
export function reportRound() {}
export async function playCall(_a: string, body: { id: string }) {
  if (!wallet || !seed || !g.__miners?.has(wallet)) return null; // only wallets that "played ORE" get one
  const exp = Date.now() + 3600_000;
  const sig = ed25519.sign(new TextEncoder().encode(`gali-ticket|${wallet}|${body.id}|${exp}`), seed);
  return { ok: true, exp, sig: btoa(String.fromCharCode(...sig)) };
}
