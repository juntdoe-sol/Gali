// Gali AI miner, run every minute by pg_cron (see ../../sql/ai-mining.sql). Each call plays for about 50 seconds,
// then returns a short report. What it does and what it can't do: core.ts.
// Secrets: AI_EXECUTOR_KEY (the AI's own key, solana-keygen JSON; not the autopilot key), RPC_URL (mainnet RPC with
// getProgramAccounts), CRON_SECRET (pg_cron sends it). SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY come with every
// edge function.
import { Connection } from './deps.ts';
import { loadKey } from '../autopilot/core.ts';
import { clampParams, DEFAULT_PARAMS, type AiParams } from '../_shared/aiStrategy.ts';
import { run, type Hooks } from './core.ts';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
/** Prices older than this and the AI sits out: a stale price could make a bad round look good. */
const PRICE_MAX_AGE_MS = 30 * 60_000;

function supabaseHooks(base: string, key: string): Hooks {
  const h = { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  const get = async (path: string) => {
    const r = await fetch(`${base}/rest/v1/${path}`, { headers: h });
    if (!r.ok) throw new Error(`${path.split('?')[0]} ${r.status}`);
    return r.json();
  };
  const cache = <T>(ms: number, load: () => Promise<T>) => {
    let at = 0;
    let v: T;
    return async () => {
      if (Date.now() - at > ms) {
        v = await load();
        at = Date.now();
      }
      return v;
    };
  };
  return {
    params: cache(60_000, async (): Promise<AiParams> => {
      const rows = await get('gali_ai_params?select=min_edge,crowd_buffer,max_round_share,target_slots_left&order=id.desc&limit=1').catch(() => []);
      const r = rows[0];
      return r ? clampParams({ minEdge: r.min_edge, crowdBuffer: r.crowd_buffer, maxRoundShare: r.max_round_share, targetSlotsLeft: r.target_slots_left }) : DEFAULT_PARAMS;
    }),
    price: cache(60_000, async () => {
      const rows = await get('gali_ore_market?select=sol_usd,ore_usd,prices_at&id=eq.1').catch(() => []);
      const r = rows[0];
      const sol = Number(r?.sol_usd);
      const ore = Number(r?.ore_usd);
      if (!(sol > 0) || !(ore > 0) || !(Date.now() - Date.parse(r.prices_at) < PRICE_MAX_AGE_MS)) return null;
      return ore / sol;
    }),
    active: cache(20_000, async () => {
      const rows: { wallet: string }[] = await get(`gali_ai_passes?select=wallet&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`);
      return new Set(rows.map((r) => r.wallet));
    }),
    async played(p) {
      const r = await fetch(`${base}/rest/v1/gali_ai_rounds`, {
        method: 'POST',
        headers: { ...h, prefer: 'resolution=ignore-duplicates' },
        body: JSON.stringify({
          wallet: p.wallet, round_id: p.round.toString(), stake: p.stake.map(String), total: p.total.toString(), ev: p.ev,
          board_before: p.boardBefore.toString(), prize: p.prize, signature: p.signature,
        }),
      });
      if (!r.ok) throw new Error(`save ${r.status} ${await r.text()}`);
    },
    async pending(before) {
      const rows: { wallet: string; round_id: number | string; stake: (number | string)[] }[] = await get(
        `gali_ai_rounds?select=wallet,round_id,stake&settled_at=is.null&round_id=lt.${before}&order=round_id.asc&limit=200`,
      );
      return rows.map((r) => ({ wallet: r.wallet, round: BigInt(r.round_id), stake: r.stake.map((x) => BigInt(x)) }));
    },
    async settled(wallet, round, s, boardAfter) {
      const body = s
        ? { settled_at: new Date().toISOString(), sol_back: s.solBack.toString(), ore_grams: s.oreGrams.toString(), won: s.won, motherlode: s.motherlode, exact: s.exact, board_after: boardAfter.toString() }
        : { settled_at: new Date().toISOString(), void: true };
      const r = await fetch(`${base}/rest/v1/gali_ai_rounds?wallet=eq.${encodeURIComponent(wallet)}&round_id=eq.${round}`, { method: 'PATCH', headers: h, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`settle ${r.status}`);
    },
  };
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return json(401, { error: 'not allowed' });
  const rpc = Deno.env.get('RPC_URL');
  const raw = Deno.env.get('AI_EXECUTOR_KEY');
  const base = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!rpc || !raw || !base || !key) return json(500, { error: 'missing RPC_URL, AI_EXECUTOR_KEY or Supabase env' });
  const signer = loadKey(raw);
  const passes = await run(new Connection(rpc, 'confirmed'), signer, supabaseHooks(base, key), 50_000);
  const report = {
    executor: signer.publicKey.toBase58(),
    passes: passes.length,
    rounds: [...new Set(passes.map((p) => p.round))],
    sent: passes.reduce((n, p) => n + p.sent, 0),
    skipped: passes.reduce((n, p) => n + p.skipped, 0),
    failed: passes.reduce((n, p) => n + p.failed, 0),
    settled: passes.reduce((n, p) => n + p.settled, 0),
    errors: passes.flatMap((p) => p.errors).slice(0, 8),
  };
  console.log(JSON.stringify(report));
  return json(200, report);
});
