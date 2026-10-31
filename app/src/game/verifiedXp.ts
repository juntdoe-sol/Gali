/**
 * The level the game shows, for a connected wallet, is the server's: gali_miners.xp, which counts scored live rounds,
 * the old XP carried over, and bonus XP (fights, quests, moles) reported through the `play` function under its daily
 * cap. It is the same number the Quest tab, the ranks and the certificate mint use, so everywhere agrees.
 *
 * XP earned here shows at once as `pending` on top of it; the next read from the server replaces it with what the
 * server actually counted. Without a wallet the game keeps its own count on this device.
 */
import { create } from 'zustand';
import { publicKey, restBase } from './world';

interface Verified {
  wallet: string | null;
  /** the server's XP for `wallet`, null until read */
  xp: number | null;
  /** XP earned since that read, not yet counted by the server */
  pending: number;
  at: number;
}
export const useVerified = create<Verified>(() => ({ wallet: null, xp: null, pending: 0, at: 0 }));

let timer: ReturnType<typeof setTimeout> | null = null;
let poll: ReturnType<typeof setInterval> | null = null;

/** Read the server's XP for a wallet (null: back to this device's own count). */
export async function loadVerified(wallet: string | null) {
  if (wallet !== useVerified.getState().wallet) useVerified.setState({ wallet, xp: null, pending: 0, at: 0 });
  if (poll) clearInterval(poll);
  poll = null;
  if (!wallet) return;
  poll = setInterval(() => void read(), 60_000);
  await read();
}

async function read() {
  const wallet = useVerified.getState().wallet;
  const base = restBase();
  if (!wallet || !base) return;
  try {
    const r = await fetch(`${base}/rest/v1/gali_miners?select=xp&wallet=eq.${encodeURIComponent(wallet)}`, { headers: { apikey: publicKey(), authorization: `Bearer ${publicKey()}` } });
    if (!r.ok) return;
    const rows = (await r.json()) as { xp: number | string }[];
    if (useVerified.getState().wallet !== wallet) return;
    // a wallet the server has not seen yet starts at 0
    useVerified.setState({ xp: Number(rows[0]?.xp ?? 0) || 0, pending: 0, at: Date.now() });
  } catch {
    /* keep the last read */
  }
}

/** XP just earned here: shown now, checked at the next read. */
export function addPending(n: number) {
  if (!(n > 0) || !useVerified.getState().wallet) return;
  useVerified.setState((s) => ({ pending: s.pending + n }));
}

/** A report just went to the server: read again shortly. */
export function readSoon(ms = 4000) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void read();
  }, ms);
}
