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

/** One call that needs the answer (an arena ticket). Null without a pass or on any failure. */
export async function playCall<T>(a: 'ticket', body: Record<string, unknown>): Promise<T | null> {
  const base = restBase();
  if (!base || !pass) return null;
  try {
    const r = await fetch(`${base}/functions/v1/play`, {
      method: 'POST',
      headers: { apikey: publicKey(), authorization: `Bearer ${publicKey()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, a, pass }),
    });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

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
export type PlayAction = 'seen' | 'ore' | 'ko' | 'win' | 'chat' | 'bonus' | 'round';
export function playReport(a: PlayAction, body: Record<string, unknown>, keep = false) {
  if (pass) return send(a, body);
  if (keep && waiting.length < 20) waiting.push({ a, body });
}

/* ---------- bonus XP (fights, quests, moles): sent in batches, capped by the server at 100 a report, 600 a day ---------- */
let bonus = 0;
let bonusTimer: ReturnType<typeof setTimeout> | null = null;
function flushBonus() {
  bonusTimer = null;
  while (bonus > 0) {
    const n = Math.min(100, bonus);
    bonus -= n;
    playReport('bonus', { n }, true);
  }
}
/** XP the server cannot see happen. It counts on the boards up to the server's daily cap. */
export function addBonusXp(n: number) {
  const add = Math.max(0, Math.floor(n));
  if (!add) return;
  bonus = Math.min(600, bonus + add);
  if (bonus >= 100) flushBonus();
  else if (!bonusTimer) bonusTimer = setTimeout(flushBonus, 20_000);
}

/** Ask the server to score a finished live round from ORE's own accounts (it checks everything itself). */
export function reportRound(roundId: bigint | number) {
  playReport('round', { round: Number(roundId) }, true);
}
