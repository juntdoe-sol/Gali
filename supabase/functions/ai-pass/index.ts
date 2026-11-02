// Gali AI pass. Three calls:
//   pay    0.1 SOL buys 7 days. The app sends the SOL to Gali's revenue wallet from the player's own wallet, then posts
//          the signature here. This checks the transfer on chain; a signature counts once (gali_ai_pass_add refuses a
//          repeat), and only the wallet that paid gets the days, so posting someone else's signature does nothing.
//   trial  7 free days, once per wallet, only for a wallet that never had a pass. Needs the sign-in pass (a signed
//          message, no fee), so nobody can use up someone else's free week.
//   log       what the AI learned at each review (every 3 hours, and daily), for a signed-in wallet with a live pass.
//   feedback  a vote (play more / keep it / play safer) and an optional comment, for a signed-in wallet with a live
//             pass, at most one every 2 hours. The hourly review reads it as players' opinions, never as orders.
// Secrets: RPC_URL, DM_SECRET (the same one dm and play use for sign-in). SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
// come with every edge function.
import { isWallet, readPass } from '../_shared/pass.ts';
import { cleanComment } from '../_shared/aiText.ts';

export const PASS_LAMPORTS = 100_000_000; // 0.1 SOL
export const REVENUE_WALLET = 'HDa2MTDdZXnrjTs6RRUUzEqCcrWMWu1fM673Cg7pzQMw';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
/** A payment older than this is not accepted: the app posts right after it confirms. */
const MAX_AGE_S = 60 * 60;
const SIG = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
/** How far back the log goes. */
const LOG_DAYS = 14;
const VOTES = ['more', 'same', 'safer'] as const;


const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, apikey, content-type', 'access-control-allow-methods': 'POST, OPTIONS' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...cors } });

/** Lamports the transaction moved from `wallet` to the revenue wallet with plain system transfers. */
export function paidLamports(tx: { meta?: { err: unknown } | null; transaction?: { message?: { instructions?: unknown[] } } } | null, wallet: string): number {
  if (!tx || !tx.meta || tx.meta.err !== null) return 0;
  let paid = 0;
  for (const ix of tx.transaction?.message?.instructions ?? []) {
    const i = ix as { programId?: string; parsed?: { type?: string; info?: { source?: string; destination?: string; lamports?: number } } };
    if (i.programId !== SYSTEM_PROGRAM || i.parsed?.type !== 'transfer') continue;
    const info = i.parsed.info;
    if (info?.source === wallet && info.destination === REVENUE_WALLET && Number.isSafeInteger(info.lamports)) paid += info.lamports!;
  }
  return paid;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  const rpc = Deno.env.get('RPC_URL');
  const base = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!rpc || !base || !key) return json(500, { error: 'server is not set up' });
  const h = { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  const body = await req.json().catch(() => null);
  const a = body?.a ?? 'pay';

  if (a === 'trial' || a === 'log' || a === 'feedback') {
    const wallet = await readPass(body?.pass).catch(() => null);
    if (!wallet) return json(401, { error: 'sign in first' });

    if (a === 'trial') {
      const r = await fetch(`${base}/rest/v1/rpc/gali_ai_trial`, { method: 'POST', headers: h, body: JSON.stringify({ p_wallet: wallet }) });
      if (!r.ok) {
        const t = await r.text();
        return /not available/.test(t) ? json(409, { error: 'The free week is for wallets that never had a pass' }) : json(500, { error: 'could not start the free week' });
      }
      return json(200, { expiresAt: await r.json() });
    }

    // log and feedback: only for a live pass
    const p = await fetch(`${base}/rest/v1/gali_ai_passes?select=expires_at&wallet=eq.${encodeURIComponent(wallet)}`, { headers: h });
    const rows = p.ok ? await p.json() : [];
    if (!rows[0] || !(Date.parse(rows[0].expires_at) > Date.now())) return json(403, { error: a === 'log' ? 'The learning log is for miners with a pass' : 'Feedback is for miners with a pass' });

    if (a === 'feedback') {
      const vote = body?.vote;
      if (!VOTES.includes(vote)) return json(400, { error: 'Pick play more, keep it, or play safer' });
      const r = await fetch(`${base}/rest/v1/rpc/gali_ai_feedback_add`, { method: 'POST', headers: h, body: JSON.stringify({ p_wallet: wallet, p_vote: vote, p_comment: cleanComment(body?.comment) }) });
      if (!r.ok) {
        const t = await r.text();
        const until = t.match(/too soon until ([0-9T:+.\- ]+)/)?.[1];
        return until ? json(429, { error: 'You can send feedback once every 2 hours', nextAt: until.trim() }) : json(500, { error: 'could not save your feedback' });
      }
      return json(200, { nextAt: await r.json() });
    }

    const since = new Date(Date.now() - LOG_DAYS * 86_400_000).toISOString();
    const l = await fetch(
      `${base}/rest/v1/gali_ai_params?select=at,source,note,learned,feedback_reply,min_edge,crowd_buffer,max_round_share,target_slots_left,stats&source=in.(claude,claude-daily)&at=gt.${encodeURIComponent(since)}&order=id.desc&limit=400`,
      { headers: h },
    );
    if (!l.ok) return json(500, { error: 'could not read the log' });
    return json(200, { log: await l.json() });
  }

  if (a !== 'pay') return json(400, { error: 'bad request' });
  const wallet = body?.wallet;
  const signature = body?.signature;
  if (!isWallet(wallet) || typeof signature !== 'string' || !SIG.test(signature)) return json(400, { error: 'bad request' });

  // the app posts right after the wallet confirms; give the RPC a few tries to see it
  let tx: Record<string, unknown> | null = null;
  for (let i = 0; i < 5 && !tx; i++) {
    if (i) await new Promise((r) => setTimeout(r, 2000));
    const r = await fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }] }),
    }).catch(() => null);
    tx = (await r?.json().catch(() => null))?.result ?? null;
  }
  if (!tx) return json(404, { error: 'payment not found yet, try again in a moment' });
  const blockTime = Number(tx.blockTime);
  if (!(blockTime > 0) || Date.now() / 1000 - blockTime > MAX_AGE_S) return json(400, { error: 'payment is too old' });
  const paid = paidLamports(tx as Parameters<typeof paidLamports>[0], wallet);
  if (paid < PASS_LAMPORTS) return json(400, { error: 'no 0.1 SOL payment from this wallet in that transaction' });

  const r = await fetch(`${base}/rest/v1/rpc/gali_ai_pass_add`, { method: 'POST', headers: h, body: JSON.stringify({ p_wallet: wallet, p_signature: signature, p_lamports: paid }) });
  if (!r.ok) {
    const t = await r.text();
    return json(/already used/.test(t) ? 409 : 500, { error: /already used/.test(t) ? 'this payment was already used' : 'could not save the pass' });
  }
  return json(200, { expiresAt: await r.json() });
});
