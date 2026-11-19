/**
 * Saving play records (check-ins, ORE marks, KOs, wins, lobby chat lines) through the `play` function
 * (supabase/functions/play). Each call carries the sign-in pass from game/dm.ts, so the server only ever writes for
 * the wallet that signed in. Without a pass nothing is saved; a few reports wait for the sign-in.
 */
import { publicKey, restBase } from './world';
import { readSoon } from './verifiedXp';

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
export async function playCall<T>(a: 'ticket' | 'fight' | 'cards' | 'skills', body: Record<string, unknown>): Promise<T | null> {
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

/** A call whose error message the player should see (University tips): { ok } or { error }. */
export async function playAsk<T>(a: 'tip' | 'tipvote' | 'buyskill', body: Record<string, unknown>): Promise<(T & { ok: true }) | { ok?: false; error: string }> {
  const base = restBase();
  if (!base || !pass) return { error: 'Sign in first.' };
  try {
    const r = await fetch(`${base}/functions/v1/play`, {
      method: 'POST',
      headers: { apikey: publicKey(), authorization: `Bearer ${publicKey()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, a, pass }),
    });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (r.ok && j.ok) return j as T & { ok: true };
    return { error: typeof j.error === 'string' ? j.error : 'Could not send. Try again.' };
  } catch {
    return { error: 'No connection. Try again.' };
  }
}

export type RenameResult = { ok: true; name: string } | { pay: true; lamports: number; next: string | null } | { error: string };
/** Change this wallet's Gali name on the server: free once every 30 days, sooner with `sig` (a paid transfer). */
export async function playRename(name: string, sig?: string): Promise<RenameResult> {
  const base = restBase();
  if (!base || !pass) return { error: 'Connect your wallet and sign in to change your name.' };
  try {
    const r = await fetch(`${base}/functions/v1/play`, {
      method: 'POST',
      headers: { apikey: publicKey(), authorization: `Bearer ${publicKey()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ a: 'rename', name, sig, pass }),
    });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (r.ok && j.ok) return { ok: true, name: String(j.name ?? name) };
    if (r.status === 402 && j.pay) return { pay: true, lamports: Number(j.lamports) || 100_000_000, next: typeof j.next === 'string' ? j.next : null };
    return { error: typeof j.error === 'string' ? j.error : 'Could not change the name. Try again.' };
  } catch {
    return { error: 'No connection. Try again.' };
  }
}

export interface OwnedCard { code: string; value: number; sol_lamports: number; bought_at?: string; redeemed_at?: string; payout_sig?: string | null }
/** This wallet's Mining Cards: unused ones it bought (with their codes) and ones it redeemed. Null without a pass. */
export async function playCards(): Promise<{ unused: OwnedCard[]; redeemed: OwnedCard[] } | null> {
  const r = await playCall<{ ok: boolean; unused: OwnedCard[]; redeemed: OwnedCard[] }>('cards', {});
  return r?.ok ? { unused: r.unused ?? [], redeemed: r.redeemed ?? [] } : null;
}

export type RedeemResult =
  | { ok: true; code: string; value: number; sol_lamports: number; rewards: { xp: number; nugs?: number; items: { n: number; rarity: string }[]; extras: string[] }; payout: string | null }
  | { error: string };
/** Use a Mining Card code for this wallet. */
export async function playRedeem(code: string): Promise<RedeemResult> {
  const base = restBase();
  if (!base || !pass) return { error: 'Connect your wallet and sign in to use a card.' };
  try {
    const r = await fetch(`${base}/functions/v1/play`, {
      method: 'POST',
      headers: { apikey: publicKey(), authorization: `Bearer ${publicKey()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ a: 'redeem', code, pass }),
    });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (r.ok && j.ok) return j as RedeemResult;
    return { error: typeof j.error === 'string' ? j.error : 'Could not use the card. Try again.' };
  } catch {
    return { error: 'No connection. Try again.' };
  }
}

function send(a: string, body: Record<string, unknown>) {
  const base = restBase();
  if (!base || !pass) return;
  void fetch(`${base}/functions/v1/play`, {
    method: 'POST',
    headers: { apikey: publicKey(), authorization: `Bearer ${publicKey()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ...body, a, pass }),
  })
    .then(() => {
      // XP reports change the server's count: read it again
      if (a === 'bonus' || a === 'round' || a === 'seen') readSoon();
    })
    .catch(() => undefined);
}

/** Fire and forget. `keep` holds the report (up to 20) until the player signs in. */
export type PlayAction = 'seen' | 'ore' | 'ko' | 'win' | 'chat' | 'bonus' | 'cave' | 'round';
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

/* ---------- Cave Run XP: its own server pool (100 a report, 400 a day), so fights and quests can't use it up ---------- */
let cave = 0;
let caveTimer: ReturnType<typeof setTimeout> | null = null;
function flushCave() {
  caveTimer = null;
  while (cave > 0) {
    const n = Math.min(100, cave);
    cave -= n;
    playReport('cave', { n }, true);
  }
}
export function addCaveXp(n: number) {
  const add = Math.max(0, Math.floor(n));
  if (!add) return;
  cave = Math.min(400, cave + add);
  if (cave >= 100) flushCave();
  else if (!caveTimer) caveTimer = setTimeout(flushCave, 20_000);
}

/** Ask the server to score a finished live round from ORE's own accounts (it checks everything itself). */
export function reportRound(roundId: bigint | number) {
  playReport('round', { round: Number(roundId) }, true);
}
