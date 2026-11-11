// Gali autopilot executor, run every minute by pg_cron (see ../../sql/autopilot-cron.sql).
// Each call plays rounds for about 50 seconds, then returns a short report.
// Secrets: EXECUTOR_KEY (the server key, solana-keygen JSON), RPC_URL (a mainnet RPC with getProgramAccounts),
// CRON_SECRET (pg_cron sends it in x-cron-secret; nobody else can trigger a run).
// Before each deploy it scores the player's finished round on Gali's boards (sql/verified-scores.sql), so rounds
// played by autopilot while the app is closed still count.
// It only plays for named Gali miners (gali_miners.name set, the rule gali_score_round uses). If that list can't be
// read, it plays for nobody this run: the server key must never pay for ORE miners outside Gali.
import { Connection } from './deps.ts';
import { loadKey, run, type Allow, type ScoreHook } from './core.ts';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return json(401, { error: 'not allowed' });
  const rpc = Deno.env.get('RPC_URL');
  const raw = Deno.env.get('EXECUTOR_KEY');
  if (!rpc || !raw) return json(500, { error: 'missing RPC_URL or EXECUTOR_KEY' });
  const signer = loadKey(raw);
  const conn = new Connection(rpc, 'confirmed');
  const base = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const onScore: ScoreHook | undefined = base && key
    ? async (wallet, roundId, s) => {
        const r = await fetch(`${base}/rest/v1/rpc/gali_score_round`, {
          method: 'POST',
          headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify({ p_wallet: wallet, p_round: Number(roundId), p_covered: s.covered, p_won: s.won, p_motherlode: s.motherlode, p_points: s.points, p_xp: s.xp }),
        });
        if (!r.ok) throw new Error(`score ${r.status}`);
      }
    : undefined;
  let players = new Set<string>();
  let listError: string | null = null;
  try {
    if (!base || !key) throw new Error('missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    const r = await fetch(`${base}/rest/v1/gali_miners?select=wallet,name&limit=100000`, { headers: { apikey: key, authorization: `Bearer ${key}` } });
    if (!r.ok) throw new Error(`gali_miners ${r.status}`);
    players = new Set(((await r.json()) as { wallet: string; name: string | null }[]).filter((x) => (x.name ?? '') !== '').map((x) => x.wallet));
  } catch (e) {
    listError = `players: ${String((e as Error)?.message ?? e).slice(0, 120)}`;
  }
  const allow: Allow = (wallet) => players.has(wallet);
  const passes = listError ? [] : await run(conn, signer, 50_000, 4000, Date.now, (ms) => new Promise((r) => setTimeout(r, ms)), onScore, allow);
  const sent = passes.reduce((n, p) => n + p.sent, 0);
  const failed = passes.reduce((n, p) => n + p.failed, 0);
  const report = { executor: signer.publicKey.toBase58(), passes: passes.length, sent, failed, rounds: [...new Set(passes.map((p) => p.round))], players: players.size, errors: [...(listError ? [listError] : []), ...passes.flatMap((p) => p.errors)].slice(0, 8) };
  console.log(JSON.stringify(report));
  return json(200, report);
});
