// Gali autopilot executor, run every minute by pg_cron (see ../../sql/autopilot-cron.sql).
// Each call plays rounds for about 50 seconds, then returns a short report.
// Secrets: EXECUTOR_KEY (the server key, solana-keygen JSON), RPC_URL (a mainnet RPC with getProgramAccounts),
// CRON_SECRET (pg_cron sends it in x-cron-secret; nobody else can trigger a run).
import { Connection } from './deps.ts';
import { loadKey, run } from './core.ts';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return json(401, { error: 'not allowed' });
  const rpc = Deno.env.get('RPC_URL');
  const raw = Deno.env.get('EXECUTOR_KEY');
  if (!rpc || !raw) return json(500, { error: 'missing RPC_URL or EXECUTOR_KEY' });
  const signer = loadKey(raw);
  const conn = new Connection(rpc, 'confirmed');
  const passes = await run(conn, signer, 50_000);
  const sent = passes.reduce((n, p) => n + p.sent, 0);
  const failed = passes.reduce((n, p) => n + p.failed, 0);
  const report = { executor: signer.publicKey.toBase58(), passes: passes.length, sent, failed, rounds: [...new Set(passes.map((p) => p.round))], errors: passes.flatMap((p) => p.errors).slice(0, 8) };
  console.log(JSON.stringify(report));
  return json(200, report);
});
