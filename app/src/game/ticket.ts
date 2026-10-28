/**
 * Arena tickets. The `play` function (supabase/functions/play) signs `gali-ticket|<wallet>|<id>|<exp>` for a signed-in
 * wallet that has played ORE at least once, with a key whose public half is fixed in the app
 * (EXPO_PUBLIC_TICKET_KEY). A ticket proves a player id belongs to a real ORE miner for the next hour. The arena host
 * is chosen only among ticketed players (game/arena.ts), so a made-up id can never run matches while a real miner
 * is in the hall.
 */
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { PublicKey } from '@solana/web3.js';
import { playCall } from './play';

const KEY_B58 = process.env.EXPO_PUBLIC_TICKET_KEY ?? '';
let key: Uint8Array | null = null;
try {
  key = KEY_B58 ? new PublicKey(KEY_B58).toBytes() : null;
} catch {
  key = null;
}
/** Tickets are on in this build (the key is set). Without it the arena falls back to the smallest id. */
export const ticketsOn = () => key !== null;
export const ticketText = (wallet: string, id: string, exp: number) => `gali-ticket|${wallet}|${id}|${exp}`;
export type Ticket = { exp: number; sig: string };

const seen = new Map<string, boolean>();
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
/** True when `t` is a ticket from Gali's key for this wallet and id that has not run out. */
export function ticketOk(wallet: string | null, id: string, t: unknown): t is Ticket {
  if (!key || !wallet || !t || typeof t !== 'object') return false;
  const { exp, sig } = t as Ticket;
  if (!Number.isSafeInteger(exp) || exp < Date.now() || exp > Date.now() + 2 * 3600_000 || typeof sig !== 'string' || sig.length > 100) return false;
  const k = `${wallet}|${id}|${exp}|${sig}`;
  const hit = seen.get(k);
  if (hit !== undefined) return hit;
  let ok = false;
  try {
    ok = ed25519.verify(unb64(sig), new TextEncoder().encode(ticketText(wallet, id, exp)), key);
  } catch {
    ok = false;
  }
  if (seen.size > 500) seen.clear();
  seen.set(k, ok);
  return ok;
}

let mine: { id: string; t: Ticket } | null = null;
let asking: Promise<void> | null = null;
/** This player's ticket for `id`, fetched (and refreshed 10 minutes before it runs out) when needed. */
export function myTicket(id: string): Ticket | null {
  if (!key) return null;
  const fresh = mine && mine.id === id && mine.t.exp - Date.now() > 10 * 60_000;
  if (!fresh && !asking) {
    asking = playCall<{ ok?: boolean; exp?: number; sig?: string }>('ticket', { id })
      .then((r) => {
        if (r?.ok && typeof r.exp === 'number' && typeof r.sig === 'string') mine = { id, t: { exp: r.exp, sig: r.sig } };
      })
      .finally(() => {
        setTimeout(() => (asking = null), 30_000); // a refusal (no ORE miner yet) is not asked again for 30 s
      });
  }
  return mine && mine.id === id && mine.t.exp > Date.now() ? mine.t : null;
}

/**
 * The order in which ticketed players take the host's seat: a hash of the wallet with the current half hour.
 * Nobody can pick their place, since a wallet's hash changes every half hour, and every client works out the same
 * order from the same players.
 */
export function hostRank(wallet: string, now = Date.now()): string {
  const epoch = Math.floor(now / (30 * 60_000));
  const h = sha256(new TextEncoder().encode(`gali-host|${epoch}|${wallet}`));
  return Array.from(h.slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
}
