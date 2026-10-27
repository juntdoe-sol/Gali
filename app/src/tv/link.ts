/**
 * TV pairing, shared by the TV and the phone.
 *
 * The TV shows a QR of a gali:// link (the phone app's own scheme, so the Seeker's camera opens Gali straight on the
 * approve sheet) and the same 6-character code for typing in. Both sides then meet on the Supabase realtime channel
 * gali-tv:<code>:
 *   TV    -> req   { tv, lpr, rounds, spots, exp }   the run it is asking for (sent again whenever a phone says hello)
 *   phone -> hello {}                                 a phone that only has the code asks for the request
 *   phone -> owner { owner }                          sent after the wallet approved
 *   TV    -> ack   { owner, ok }                      the TV found (or did not find) the matching automation on chain
 * The TV trusts the chain, not the message: `owner` only tells it where to look.
 */
import type { RealtimeChannel, RealtimeClient } from '@supabase/realtime-js';
import cfg from '../chain/chat.json';

/** A code is good for five minutes. */
export const PAIR_TTL_MS = 5 * 60_000;
/** The TV only plays every spot (Lite, all 25). */
export const TV_SPOTS = 25;

export interface PairRequest {
  code: string;
  /** the TV's fee-payer key, base58 */
  tv: string;
  /** lamports per round, all spots together */
  lpr: number;
  rounds: number;
  spots: 'all';
  /** ms since epoch when the code stops working */
  exp: number;
}

export type TvLink = ({ kind: 'pair' } & PairRequest) | { kind: 'stop'; owner: string } | { kind: 'code'; code: string };

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const CODE = /^[A-HJ-NP-Z2-9]{6}$/;

export function makeCode(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

/** K7Q49F -> K7Q4-9F, as the TV shows it. */
export const prettyCode = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`;
export const cleanCode = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Lamports for each of the 25 spots, as ORE's automation stores it. */
export const perSpotLamports = (lpr: number) => Math.floor(lpr / TV_SPOTS);

export const pairUrl = (r: PairRequest) =>
  `gali://tv?v=1&code=${r.code}&tv=${r.tv}&lpr=${r.lpr}&rounds=${r.rounds}&spots=all&exp=${r.exp}`;
export const stopUrl = (owner: string) => `gali://tv?v=1&action=stop&owner=${owner}`;

/** Reads a gali://tv link. Anything malformed is null, so a bad QR can never reach the wallet. */
export function parseTvUrl(url: string): TvLink | null {
  const m = /^gali:\/\/tv\/?\?([^#]*)$/i.exec(url.trim());
  if (!m) return null;
  const q: Record<string, string> = {};
  for (const part of m[1].split('&')) {
    const [k, v = ''] = part.split('=');
    if (k) q[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  if (q.v !== '1') return null;
  if (q.action === 'stop') return B58.test(q.owner ?? '') ? { kind: 'stop', owner: q.owner } : null;
  const code = cleanCode(q.code ?? '');
  if (!CODE.test(code)) return null;
  if (!q.tv) return { kind: 'code', code };
  const lpr = Number(q.lpr);
  const rounds = Number(q.rounds);
  const exp = Number(q.exp);
  if (!B58.test(q.tv) || !Number.isSafeInteger(lpr) || lpr <= 0 || !Number.isSafeInteger(rounds) || rounds < 1 || rounds > 1000) return null;
  return { kind: 'pair', code, tv: q.tv, lpr, rounds, spots: 'all', exp: Number.isFinite(exp) ? exp : Date.now() + PAIR_TTL_MS };
}

/** Validates a request that arrived over the channel (same rules as the link). */
export function readRequest(p: unknown): PairRequest | null {
  const r = p as Partial<PairRequest> | null;
  if (!r || typeof r.code !== 'string' || typeof r.tv !== 'string') return null;
  const link = parseTvUrl(pairUrl({ code: r.code, tv: r.tv, lpr: Number(r.lpr), rounds: Number(r.rounds), spots: 'all', exp: Number(r.exp) }));
  return link?.kind === 'pair' ? { code: link.code, tv: link.tv, lpr: link.lpr, rounds: link.rounds, spots: 'all', exp: link.exp } : null;
}

/* ---------------- the channel ---------------- */

const URL_ = process.env.EXPO_PUBLIC_WORLD_URL || (cfg.url ? `${cfg.url.replace(/^http/, 'ws')}/realtime/v1` : '');
const KEY = process.env.EXPO_PUBLIC_WORLD_KEY || cfg.anonKey;
export const linkReady = Boolean(URL_ && KEY);

export interface PairChannel {
  send: (event: 'req' | 'hello' | 'owner' | 'ack', payload: Record<string, unknown>) => void;
  close: () => void;
}

/** Joins gali-tv:<code>. `on` gets every broadcast; `onUp` fires once the channel is subscribed. */
export async function openPairChannel(code: string, on: (event: string, payload: Record<string, unknown>) => void, onUp?: () => void): Promise<PairChannel> {
  if (!linkReady) throw new Error('No realtime server in this build');
  const { RealtimeClient: Ctor } = await import('@supabase/realtime-js');
  const client: RealtimeClient = new Ctor(URL_, { params: { apikey: KEY }, vsn: '1.0.0' } as ConstructorParameters<typeof RealtimeClient>[1]);
  const ch: RealtimeChannel = client.channel(`gali-tv:${code}`, { config: { broadcast: { self: false, ack: false } } });
  for (const ev of ['req', 'hello', 'owner', 'ack']) ch.on('broadcast', { event: ev }, ({ payload }) => on(ev, (payload ?? {}) as Record<string, unknown>));
  ch.subscribe((status) => status === 'SUBSCRIBED' && onUp?.());
  return {
    send: (event, payload) => void ch.send({ type: 'broadcast', event, payload }),
    close: () => {
      void ch.unsubscribe();
      client.disconnect();
    },
  };
}
