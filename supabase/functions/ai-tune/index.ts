// Gali AI tuner, run by pg_cron (see ../../sql/ai-mining.sql): every 3 hours on Haiku, and once a day on Sonnet with
// body {"kind":"daily"}. A team of four Claude agents reviews the last day and week of rounds plus subscribers'
// feedback and picks the settings until the next review (who does what: tune.ts). tune.ts clamps whatever comes back,
// so a bad answer cannot push the AI outside safe limits. If the lead agent is unreachable or refuses, the settings
// stay as they are.
// Claude spend is capped: every call's cost is recorded in gali_ai_claude_spend, a review is skipped when nothing new
// happened since the last one of its kind, and none starts unless its worst case fits the month's budget (both kinds
// together) and spending is on pace.
// Secrets: ANTHROPIC_API_KEY, CRON_SECRET. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY come with every edge function.
// Optional: AI_TUNE_MODEL (3-hourly, default claude-haiku-5-5), AI_DAILY_MODEL (default claude-sonnet-5-5),
// AI_MONTHLY_BUDGET_USD (default 8).
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0';
import { clampParams, DEFAULT_PARAMS, type AiParams } from '../_shared/aiStrategy.ts';
import {
  ANALYST, ANALYST_SCHEMA, analystPrompt, apply, budgetCheck, callCost, commentBlock, FEEDBACK, FEEDBACK_SCHEMA, feedbackPrompt, hasNews, LEAD,
  LEAD_SCHEMA, leadPrompt, monthBounds, RISK, RISK_SCHEMA, riskLimits, riskPrompt, summarize, tally, text, worstReviewCost, type FeedbackRow, type RoundRow,
} from './tune.ts';

const REGULAR_MODEL = Deno.env.get('AI_TUNE_MODEL') || 'claude-haiku-5-5';
const DAILY_MODEL = Deno.env.get('AI_DAILY_MODEL') || 'claude-sonnet-5-5';
const BUDGET_USD = Number(Deno.env.get('AI_MONTHLY_BUDGET_USD') || 8);
/** The answers are short JSON; this leaves room for thinking and keeps the worst case of a review small. */
const MAX_TOKENS = 8000;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return json(401, { error: 'not allowed' });
  const base = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!base || !key || !Deno.env.get('ANTHROPIC_API_KEY')) return json(500, { error: 'missing ANTHROPIC_API_KEY or Supabase env' });
  const daily = ((await req.json().catch(() => ({}))) as { kind?: string }).kind === 'daily';
  const MODEL = daily ? DAILY_MODEL : REGULAR_MODEL;
  const SOURCE = daily ? 'claude-daily' : 'claude';
  const h ={ apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' };
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

  // subscribers' feedback from the last 24 hours
  const fb: FeedbackRow[] = await get(`gali_ai_feedback?select=wallet,vote,comment,at&at=gt.${encodeURIComponent(new Date(dayAgo).toISOString())}&order=at.desc&limit=2000`).catch(() => []);
  const votes = tally(fb);
  const history = paramRows.slice(0, 5).map((r: { at: string; note: string | null }) => ({ at: r.at, note: r.note }));

  // nothing new since the last review of this kind: nothing to learn, so no Claude calls
  const lastAt = daily ? (await get(`gali_ai_params?select=at&source=eq.${SOURCE}&order=id.desc&limit=1`))[0]?.at : p?.at;
  if (!hasNews(lastAt, rows.map((r: { settled_at: string }) => r.settled_at), fb.map((f) => f.at))) return json(200, { kept: current, reason: 'nothing new since the last review' });
  // the month's Claude budget
  const now = new Date();
  const spentRes = await fetch(`${base}/rest/v1/rpc/gali_ai_claude_spent`, { method: 'POST', headers: h, body: JSON.stringify({ p_since: monthBounds(now)[0].toISOString() }) });
  if (!spentRes.ok) return json(500, { error: `could not read Claude spend: ${spentRes.status}` });
  const spent = Number(await spentRes.json()) || 0;
  const budget = budgetCheck(spent, BUDGET_USD, worstReviewCost(MODEL, MAX_TOKENS), now);
  if (!budget.ok) return json(200, { kept: current, reason: budget.why });

  const client = new Anthropic();
  const spend: { model: string; agent: string; input_tokens: number; output_tokens: number; usd: number }[] = [];
  /** Writes what this review cost so far. Every return after the first call goes through it. */
  const saveSpend = async () => {
    if (!spend.length) return;
    const r = await fetch(`${base}/rest/v1/gali_ai_claude_spend`, { method: 'POST', headers: h, body: JSON.stringify(spend.splice(0)) });
    // an unrecorded cost would let the budget overspend, so a failed write stops the review loudly
    if (!r.ok) throw new Error(`could not record Claude spend: ${r.status}`);
  };
  /** One agent's turn: a JSON answer that matches `schema`, or the reason it has none. */
  const ask = async (agent: string, system: string, user: string, schema: Record<string, unknown>, effort: 'medium' | 'high' = 'medium'): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; why: string }> => {
    try {
      const res = await client.beta.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        // server-side fallback is for Sonnet on the Claude API; Haiku has none
        ...(MODEL.startsWith('claude-sonnet') ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
        output_config: { effort, format: { type: 'json_schema', schema } },
        system,
        messages: [{ role: 'user', content: user }],
      });
      spend.push({ model: res.model, agent, input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens, usd: callCost(res.model, res.usage) });
      if (res.stop_reason === 'refusal') return { ok: false, why: `refusal ${res.stop_details?.category ?? ''}`.trim() };
      if (res.stop_reason === 'max_tokens') return { ok: false, why: 'max_tokens' };
      return { ok: true, data: JSON.parse(res.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('')) };
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) return { ok: false, why: 'rate limited' };
      if (e instanceof Anthropic.APIError) return { ok: false, why: `claude ${e.status}` };
      if (e instanceof SyntaxError) return { ok: false, why: 'answer was not JSON' };
      throw e;
    }
  };
  const said = (r: Awaited<ReturnType<typeof ask>>) => (r.ok ? JSON.stringify(r.data) : `(unavailable: ${r.why})`);

  // the analyst and the feedback reader work at the same time; the risk checker reads both; the lead decides
  const [analyst, feedback] = await Promise.all([
    ask('analyst', ANALYST, analystPrompt(current, last24h, last7d, history), ANALYST_SCHEMA),
    votes.wallets ? ask('feedback', FEEDBACK, feedbackPrompt(votes, commentBlock(fb)), FEEDBACK_SCHEMA) : Promise.resolve({ ok: false as const, why: 'no feedback in the last 24 hours' }),
  ]);
  const risk = await ask('risk', RISK, riskPrompt(current, last24h, last7d, said(analyst), said(feedback), votes), RISK_SCHEMA);
  const lead = await ask('lead', LEAD, leadPrompt(current, last24h, last7d, said(analyst), said(feedback), said(risk), votes, daily), LEAD_SCHEMA, 'high');
  await saveSpend();
  if (!lead.ok) return json(200, { kept: current, reason: `lead: ${lead.why}` });

  const { params, note, learned, feedbackReply } = apply(lead.data, current, risk.ok ? riskLimits(risk.data) : undefined);
  const agents = {
    votes,
    analyst: analyst.ok ? { findings: text(analyst.data.findings, 900), confidence: analyst.data.confidence } : { unavailable: analyst.why },
    feedback: feedback.ok ? { summary: text(feedback.data.summary, 900), lean: feedback.data.lean } : { unavailable: feedback.why },
    risk: risk.ok ? { concerns: text(risk.data.concerns, 900), ...riskLimits(risk.data) } : { unavailable: risk.why },
  };
  const ins = await fetch(`${base}/rest/v1/gali_ai_params`, {
    method: 'POST',
    headers: h,
    body: JSON.stringify({
      min_edge: params.minEdge, crowd_buffer: params.crowdBuffer, max_round_share: params.maxRoundShare, target_slots_left: params.targetSlotsLeft,
      source: SOURCE, note: note || null, learned: learned || null, feedback_reply: feedbackReply || null, agents, stats: { last24h, last7d },
    }),
  });
  if (!ins.ok) return json(500, { error: `save failed: ${ins.status}` });
  return json(200, { kind: daily ? 'daily' : '3-hourly', model: MODEL, from: current, to: params, note, plays24h: last24h.plays, plays7d: last7d.plays, voters: votes.wallets, agents: { analyst: analyst.ok, feedback: feedback.ok, risk: risk.ok } });
});
