// Saves ORE's refining factor once an hour (pg_cron, see ../../sql/ore-stats.sql), so the app can show how much
// refined ORE a miner earned in the last 24 hours: unrefined x (factor now - factor 24h ago) / 2^48.
// Secrets: RPC_URL (any mainnet RPC; the autopilot already has one) and CRON_SECRET (pg_cron sends it).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided to every edge function by Supabase.
const TREASURY = '45db2FSR4mcXdSVVZbKbwojU6uYDpMyhpEi7cC8nHaWG';
const ORE_PROGRAM = 'oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** The u128 refining factor in ORE's Treasury account: bytes 16..32, little-endian (after the 8-byte tag and the motherlode). */
export function factorOf(data: Uint8Array): bigint {
  if (data.length !== 48) throw new Error(`treasury is ${data.length} bytes, expected 48`);
  let v = 0n;
  for (let i = 31; i >= 16; i--) v = (v << 8n) | BigInt(data[i]);
  return v;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return json(401, { error: 'not allowed' });
  const rpc = Deno.env.get('RPC_URL');
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!rpc || !url || !key) return json(500, { error: 'missing RPC_URL or Supabase env' });
  const r = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [TREASURY, { encoding: 'base64', commitment: 'finalized' }] }),
  });
  const j = await r.json().catch(() => null);
  const v = j?.result?.value;
  if (!v || v.owner !== ORE_PROGRAM) return json(502, { error: 'could not read ORE treasury' });
  const factor = factorOf(Uint8Array.from(atob(v.data[0]), (c) => c.charCodeAt(0)));
  const ins = await fetch(`${url}/rest/v1/rpc/gali_ore_rate_save`, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_factor: factor.toString() }),
  });
  if (!ins.ok) return json(500, { error: `save failed: ${ins.status} ${await ins.text()}` });
  return json(200, { factor: factor.toString() });
});
