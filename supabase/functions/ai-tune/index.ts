// Gali AI tuner, run once an hour by pg_cron (see ../../sql/ai-mining.sql). Claude reads how the AI's recent rounds
// went and picks the settings for the next hour; tune.ts clamps whatever comes back, so a bad answer cannot push the
// AI outside safe limits. If Claude is unreachable or refuses, the settings stay as they are.
// Secrets: ANTHROPIC_API_KEY, CRON_SECRET. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY come with every edge function.
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0';
import { clampParams, DEFAULT_PARAMS, type AiParams } from '../_shared/aiStrategy.ts';
import { apply, OUTPUT_SCHEMA, prompt, summarize, SYSTEM, type RoundRow } from './tune.ts';

const MODEL = 'claude-sonnet-5-5';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return json(401, { error: 'not allowed' });
  const base = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!base || !key || !Deno.env.get('ANTHROPIC_API_KEY')) return json(500, { error: 'missing ANTHROPIC_API_KEY or Supabase env' });
  const h = { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  const get = async (path: string) => {
    const r = await fetch(`${base}/rest/v1/${path}`, { headers: h });
    if (!r.ok) throw new Error(`${path.split('?')[0]} ${r.status}`);
    return r.json();
  };

  const [paramRows, market, rows] = await Promise.all([
    get('gali_ai_params?select=min_edge,crowd_buffer,max_round_share,target_slots_left,note,at&order=id.desc&limit=6'),
    get('gali_ore_market?select=sol_usd,ore_usd&id=eq.1'),
    get(`gali_ai_rounds?select=wallet,total,fee,ev,board_before,board_after,sol_back,ore_grams,won,motherlode,stake,settled_at&void=eq.false&settled_at=gt.${encodeURIComponent(new Date(Date.now() - 7 * 86_400_000).toISOString())}&order=settled_at.desc&limit=20000`),
  ]);
  const p = paramRows[0];
  const current: AiParams = p ? clampParams({ minEdge: p.min_edge, crowdBuffer: p.crowd_buffer, maxRoundShare: p.max_round_share, targetSlotsLeft: p.target_slots_left }) : DEFAULT_PARAMS;
  const oreSol = market[0] && Number(market[0].sol_usd) > 0 ? Number(market[0].ore_usd) / Number(market[0].sol_usd) : 0;
  const toRow = (r: Record<string, unknown>) => ({
    wallet: String(r.wallet),
    total: Number(r.total), fee: Number(r.fee), ev: Number(r.ev), board_before: Number(r.board_before),
    board_after: r.board_after === null ? null : Number(r.board_after), sol_back: r.sol_back === null ? null : Number(r.sol_back),
    ore_grams: r.ore_grams === null ? null : Number(r.ore_grams), won: r.won as boolean | null, motherlode: r.motherlode as boolean | null,
    squares: (r.stake as (number | string)[]).filter((x) => Number(x) > 0).length,
  });
  const all: (RoundRow & { wallet: string })[] = rows.map(toRow);
  const dayAgo = Date.now() - 86_400_000;
  const last24h = summarize(all.filter((_r, i) => Date.parse(rows[i].settled_at) > dayAgo), oreSol);
  const last7d = summarize(all, oreSol);

  const client = new Anthropic();
  let answer: unknown;
  try {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: OUTPUT_SCHEMA as unknown as Record<string, unknown> } },
      system: SYSTEM,
      messages: [{ role: 'user', content: prompt(current, last24h, last7d, paramRows.slice(0, 5).map((r: { at: string; note: string | null }) => ({ at: r.at, note: r.note }))) }],
    });
    if (res.stop_reason === 'refusal') return json(200, { kept: current, reason: 'refusal', category: res.stop_details?.category ?? null });
    if (res.stop_reason === 'max_tokens') return json(200, { kept: current, reason: 'max_tokens' });
    const text = res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
    answer = JSON.parse(text);
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json(200, { kept: current, reason: 'rate limited' });
    if (e instanceof Anthropic.APIError) return json(502, { kept: current, reason: `claude ${e.status}`, error: e.message.slice(0, 200) });
    if (e instanceof SyntaxError) return json(502, { kept: current, reason: 'answer was not JSON' });
    throw e;
  }

  const { params, note } = apply(answer, current);
  const ins = await fetch(`${base}/rest/v1/gali_ai_params`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({ min_edge: params.minEdge, crowd_buffer: params.crowdBuffer, max_round_share: params.maxRoundShare, target_slots_left: params.targetSlotsLeft, source: 'claude', note: note || null }),
  });
  if (!ins.ok) return json(500, { error: `save failed: ${ins.status}` });
  return json(200, { from: current, to: params, note, plays24h: last24h.plays, plays7d: last7d.plays });
});
