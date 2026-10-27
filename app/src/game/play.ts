/**
 * Saving play records (check-ins, ORE marks, KOs, wins, lobby chat lines) through the `play` function
 * (supabase/functions/play). Each call carries the sign-in pass from game/dm.ts, so the server only ever writes for
 * the wallet that signed in. Without a pass nothing is saved; a few reports wait for the sign-in.
 */
import { publicKey, restBase } from './world';

let pass: string | null = null;
let passWallet: string | null = null;
const waiting: { a: string; body: Record<string, unknown> }[] = [];

/** Called by game/dm.ts whenever the pass changes (sign in, sign out, another wallet). */
export function setPlayPass(p: string | null, wallet: string | null) {
  pass = p;
  passWallet = p ? wallet : null;
  if (!p) waiting.length = 0;
  else while (waiting.length) { const w = waiting.shift()!; send(w.a, w.body); }
}
/** The wallet the pass is for, when signed in. */
export const playWallet = () => passWallet;

function send(a: string, body: Record<string, unknown>) {
  const base = restBase();
  if (!base || !pass) return;
  void fetch(`${base}/functions/v1/play`, {
    method: 'POST',
    headers: { apikey: publicKey(), authorization: `Bearer ${publicKey()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, a, pass }),
  }).catch(() => undefined);
}

/** Fire and forget. `keep` holds the report (up to 20) until the player signs in. */
export function playReport(a: 'seen' | 'ore' | 'ko' | 'win' | 'chat', body: Record<string, unknown>, keep = false) {
  if (pass) return send(a, body);
  if (keep && waiting.length < 20) waiting.push({ a, body });
}
