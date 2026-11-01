// Gali AI pass: 0.1 SOL buys 7 days of AI mining. The app sends the SOL to Gali's revenue wallet from the player's
// own wallet, then posts the transaction signature here. This checks the transfer on chain and adds 7 days to that
// wallet's pass. A signature counts once (gali_ai_pass_add refuses a repeat), and only the wallet that paid gets
// the days, so posting someone else's signature does nothing for you.
// Secrets: RPC_URL. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY come with every edge function.
import { isWallet } from '../_shared/pass.ts';

export const PASS_LAMPORTS = 100_000_000; // 0.1 SOL
export const REVENUE_WALLET = 'HDa2MTDdZXnrjTs6RRUUzEqCcrWMWu1fM673Cg7pzQMw';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
/** A payment older than this is not accepted: the app posts right after it confirms. */
const MAX_AGE_S = 60 * 60;
const SIG = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

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
  const body = await req.json().catch(() => null);
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

  const r = await fetch(`${base}/rest/v1/rpc/gali_ai_pass_add`, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_wallet: wallet, p_signature: signature, p_lamports: paid }),
  });
  if (!r.ok) {
    const t = await r.text();
    return json(/already used/.test(t) ? 409 : 500, { error: /already used/.test(t) ? 'this payment was already used' : 'could not save the pass' });
  }
  const expiresAt = await r.json();
  return json(200, { expiresAt });
});
