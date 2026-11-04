// Gali AI miner, run every minute by pg_cron (see ../../sql/ai-mining.sql). Each call plays for about 50 seconds,
// then returns a short report. What it does and what it can't do: core.ts.
// Secrets: AI_EXECUTOR_KEY (the AI's own key, solana-keygen JSON; not the autopilot key), RPC_URL (mainnet RPC with
// getProgramAccounts), CRON_SECRET (pg_cron sends it). SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY come with every
// edge function.
import { Connection } from './deps.ts';
import { loadKey } from '../autopilot/core.ts';
import { clampParams, isStyle, STYLE_BOUNDS, STYLE_DEFAULTS, type AiParams, type Style } from '../_shared/aiStrategy.ts';
import { botAllowed } from '../_shared/botAccess.ts';
import { run, sweepFees, type BotChoice, type Hooks } from './core.ts';

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
    params: (() => {
      const byStyle = new Map<Style, () => Promise<AiParams>>();
      return (style: Style = 'safe') => {
        if (!byStyle.has(style)) {
          byStyle.set(style, cache(60_000, async (): Promise<AiParams> => {
            const rows = await get(`gali_ai_params?select=min_edge,crowd_buffer,max_round_share,target_slots_left,min_motherlode&style=eq.${style}&order=id.desc&limit=1`).catch(() => []);
            const r = rows[0];
            const d = STYLE_DEFAULTS[style];
            return r ? clampParams({ minEdge: r.min_edge, crowdBuffer: r.crowd_buffer, maxRoundShare: r.max_round_share, targetSlotsLeft: r.target_slots_left, minMotherlode: r.min_motherlode }, d, STYLE_BOUNDS[style]) : d;
          }));
        }
        return byStyle.get(style)!();
      };
    })(),
    choices: cache(20_000, async () => {
      const rows: Record<string, unknown>[] = await get('gali_bot_settings?select=*&limit=10000');
      const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
      return new Map(rows.map((r): [string, BotChoice] => [String(r.wallet), {
        mode: r.mode === 'bot' ? 'bot' : 'ai',
        style: isStyle(r.style) ? r.style : 'safe',
        rules: { spots: Number(r.spots), perSpotSol: Number(r.per_spot_sol), maxSpotSol: n(r.max_spot_sol), minMotherlodeOre: n(r.min_motherlode_ore), maxRoundSol: n(r.max_round_sol) },
        stopLossSol: n(r.stop_loss_sol),
      }]));
    }),
    net: cache(30_000, async () => {
      const r = await fetch(`${base}/rest/v1/rpc/gali_bot_net`, { method: 'POST', headers: h, body: '{}' });
      if (!r.ok) throw new Error(`net ${r.status}`);
      const rows: { wallet: string; net_sol: number }[] = await r.json();
      return new Map(rows.map((x) => [x.wallet, Number(x.net_sol)]));
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
      return new Set(rows.map((r) => r.wallet).filter(botAllowed));
    }),
    async played(p) {
      const r = await fetch(`${base}/rest/v1/gali_ai_rounds`, {
        method: 'POST',
        headers: { ...h, prefer: 'resolution=ignore-duplicates' },
        body: JSON.stringify({
          wallet: p.wallet, round_id: p.round.toString(), mode: p.mode ?? 'ai', style: p.style ?? 'safe', stake: p.stake.map(String), total: p.total.toString(), fee: p.fee.toString(), ev: p.ev,
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
    async soloWin(w) {
      const r = await fetch(`${base}/rest/v1/gali_solo_wins`, {
        method: 'POST',
        headers: { ...h, prefer: 'resolution=ignore-duplicates' },
        body: JSON.stringify({
          round_id: w.round.toString(), wallet: w.wallet, square: w.square, square_total: w.squareTotal.toString(), stake: w.stake.toString(),
          squares: w.squares, deployed: w.deployed.toString(), motherlode: w.motherlode,
        }),
      });
      if (!r.ok) throw new Error(`solo ${r.status}`);
    },
    async boardRound(b) {
      const r = await fetch(`${base}/rest/v1/gali_board_rounds`, {
        method: 'POST',
        headers: { ...h, prefer: 'resolution=ignore-duplicates' },
        body: JSON.stringify({
          round_id: b.round.toString(), miners: b.miners, deployed: b.deployed.toString(), seen: b.seen, win_square: b.winSquare, split: b.split,
          reward: b.reward.toString(), motherlode: b.motherlode.toString(), solo_wallet: b.solo?.wallet ?? null, solo_stake: b.solo?.stake.toString() ?? null,
          solo_square_total: b.solo?.squareTotal.toString() ?? null, solo_squares: b.solo?.squares ?? null, groups: b.groups,
        }),
      });
      if (!r.ok) throw new Error(`board ${r.status}`);
    },
    async thought(t) {
      const r = await fetch(`${base}/rest/v1/gali_ai_thoughts`, {
        method: 'POST',
        headers: { ...h, prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({
          round_id: t.round.toString(), slots_left: t.slotsLeft, motherlode_grams: t.motherlode.toString(), prize: Math.round(t.prize),
          board: t.board.toString(), quietest: t.quietest.toString(), join_limit: Math.round(t.joinLimit), played: t.played, skipped: t.skipped,
          min_edge: t.params.minEdge, crowd_buffer: t.params.crowdBuffer,
        }),
      });
      if (!r.ok) throw new Error(`thought ${r.status}`);
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
  const conn = new Connection(rpc, 'confirmed');
  const passes = await run(conn, signer, supabaseHooks(base, key), 50_000);
  // Gali's 0.25% collects on the AI key round by round; move it on to the revenue wallet
  const swept = await sweepFees(conn, signer).catch((e) => (console.log(`sweep: ${String((e as Error)?.message ?? e).slice(0, 160)}`), 0n));
  const report = {
    executor: signer.publicKey.toBase58(),
    passes: passes.length,
    rounds: [...new Set(passes.map((p) => p.round))],
    sent: passes.reduce((n, p) => n + p.sent, 0),
    skipped: passes.reduce((n, p) => n + p.skipped, 0),
    failed: passes.reduce((n, p) => n + p.failed, 0),
    settled: passes.reduce((n, p) => n + p.settled, 0),
    sweptSol: Number(swept) / 1e9,
    errors: passes.flatMap((p) => p.errors).slice(0, 8),
  };
  console.log(JSON.stringify(report));
  return json(200, report);
});
