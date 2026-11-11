// Gali AI tuner, run by pg_cron (see ../../sql/ai-mining.sql) in three kinds:
//   {"kind":"rounds"}  every 15 minutes, Haiku: the round reviewer reads every round since its last look and writes
//                      lessons (gali_ai_lessons). It changes nothing itself.
//   {}                 every 3 hours, Haiku: a team of four Claude agents reviews the last day and week of rounds, the
//                      round reviewer's lessons and subscribers' feedback, and picks the settings until the next review.
//   {"kind":"daily"}   once a day, Sonnet: the same team, weighing the week.
// Who does what: tune.ts. tune.ts clamps whatever comes back, so a bad answer cannot push the AI outside safe limits.
// If the lead agent is unreachable or refuses, the settings stay as they are.
// Claude spend is capped: every call's cost is recorded in gali_ai_claude_spend, a review is skipped when nothing new
// happened since the last one of its kind, and none starts unless its worst case fits the month's budget (all kinds
// together) and spending is on pace.
// Secrets: ANTHROPIC_API_KEY, CRON_SECRET. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY come with every edge function.
// Optional: AI_TUNE_MODEL (3-hourly, default claude-haiku-5-5), AI_DAILY_MODEL (default claude-sonnet-5-5),
// AI_ROUNDS_MODEL (default claude-haiku-5-5), AI_MONTHLY_BUDGET_USD (default 10).
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0';
import { clampParams, DEFAULT_PARAMS, isStyle, STYLE_BOUNDS, STYLE_DEFAULTS, PLAYER_STYLES, STYLES, type AiParams, type Style } from '../_shared/aiStrategy.ts';
import {
  ANALYST, ANALYST_SCHEMA, analystPrompt, apply, budgetCheck, callCost, commentBlock, FEEDBACK, FEEDBACK_SCHEMA, feedbackPrompt, hasNews, LEAD,
  LEAD_SCHEMA, leadPrompt, monthBounds, RISK, RISK_SCHEMA, riskLimits, riskPrompt, ROUNDS, ROUNDS_SCHEMA, roundsPrompt, summarize, tally, text,
  worstReviewCost, type BoardRow, type FeedbackRow, type PlayRow, type RoundRow, type SoloRow, type ThoughtRow,
} from './tune.ts';

const MODELS = {
  regular: Deno.env.get('AI_TUNE_MODEL') || 'claude-haiku-5-5',
  daily: Deno.env.get('AI_DAILY_MODEL') || 'claude-sonnet-5-5',
  rounds: Deno.env.get('AI_ROUNDS_MODEL') || 'claude-haiku-5-5',
};
const BUDGET_USD = Number(Deno.env.get('AI_MONTHLY_BUDGET_USD') || 10);
/** The answers are short JSON; this leaves room for thinking and keeps the worst case of a review small. */
const MAX_TOKENS = 8000;
/** The round reviewer reads at most this many rounds a look (a little over 3 hours). */
const ROUNDS_MAX = 200;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return json(401, { error: 'not allowed' });
  const base = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!base || !key || !Deno.env.get('ANTHROPIC_API_KEY')) return json(500, { error: 'missing ANTHROPIC_API_KEY or Supabase env' });
  const k = ((await req.json().catch(() => ({}))) as { kind?: string }).kind;
  const kind: keyof typeof MODELS = k === 'daily' || k === 'rounds' ? k : 'regular';
  const daily = kind === 'daily';
  const MODEL = MODELS[kind];
  const SOURCE = daily ? 'claude-daily' : 'claude';
  const h = { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' };
  const get = async (path: string) => {
    const r = await fetch(`${base}/rest/v1/${path}`, { headers: h });
    if (!r.ok) throw new Error(`${path.split('?')[0]} ${r.status}`);
    return r.json();
  };

  /** The month's Claude budget, before any call: the reason a review may not run, or null. */
  const overBudget = async (calls: number): Promise<string | null> => {
    const now = new Date();
    const r = await fetch(`${base}/rest/v1/rpc/gali_ai_claude_spent`, { method: 'POST', headers: h, body: JSON.stringify({ p_since: monthBounds(now)[0].toISOString() }) });
    if (!r.ok) throw new Error(`could not read Claude spend: ${r.status}`);
    const b = budgetCheck(Number(await r.json()) || 0, BUDGET_USD, worstReviewCost(MODEL, MAX_TOKENS, 8000, calls), now);
    return b.ok ? null : b.why;
  };
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
  const ask = async (agent: string, system: string, user: string, schema: Record<string, unknown>, effort: 'low' | 'medium' | 'high' = 'medium'): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; why: string }> => {
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

  // the round reviewer reads against the safe style's settings (the board-level numbers it sees are the safe style's)
  const p = (await get("gali_ai_params?select=min_edge,crowd_buffer,max_round_share,target_slots_left,min_motherlode&style=eq.safe&order=id.desc&limit=1"))[0];
  const current: AiParams = p ? clampParams({ minEdge: p.min_edge, crowdBuffer: p.crowd_buffer, maxRoundShare: p.max_round_share, targetSlotsLeft: p.target_slots_left, minMotherlode: p.min_motherlode }) : DEFAULT_PARAMS;

  // ---------------- the round reviewer ----------------
  if (kind === 'rounds') {
    const last = (await get('gali_ai_lessons?select=to_round&order=id.desc&limit=1'))[0];
    const thoughts: ThoughtRow[] = await get(`gali_ai_thoughts?select=round_id,slots_left,motherlode_grams,quietest,join_limit,board,played,skipped&round_id=gt.${last?.to_round ?? 0}&order=round_id.asc&limit=${ROUNDS_MAX}`);
    // nobody playing: no bot rounds, so the reviewer studies the whole board's rounds instead
    const boardOnly: { round_id: number | string }[] = thoughts.length
      ? []
      : await get(`gali_board_rounds?select=round_id&round_id=gt.${last?.to_round ?? 0}&order=round_id.asc&limit=${ROUNDS_MAX}`).catch(() => []);
    const span = thoughts.length ? thoughts : boardOnly;
    if (!span.length) return json(200, { kind, reason: 'no new rounds since the last look' });
    const from = span[0].round_id;
    const to = span[span.length - 1].round_id;
    const [plays, market, solos, boards]: [PlayRow[], { sol_usd: number; ore_usd: number }[], SoloRow[], BoardRow[]] = await Promise.all([
      get(`gali_ai_rounds?select=round_id,total,sol_back,ore_grams,won,board_before,board_after,stake,settled_at,void&round_id=gte.${from}&round_id=lte.${to}&limit=5000`),
      get('gali_ore_market?select=sol_usd,ore_usd&id=eq.1').catch(() => []),
      get(`gali_solo_wins?select=wallet,square_total,stake,squares,deployed,motherlode&round_id=gte.${from}&round_id=lte.${to}&limit=1000`).catch(() => []),
      get(`gali_board_rounds?select=round_id,miners,deployed,seen,split,motherlode,groups&round_id=gte.${from}&round_id=lte.${to}&limit=1000`).catch(() => []),
    ]);
    const oreSol = market[0] && Number(market[0].sol_usd) > 0 ? Number(market[0].ore_usd) / Number(market[0].sol_usd) : 0;
    const why = await overBudget(1);
    if (why) return json(200, { kind, reason: why });
    const r = await ask('rounds', ROUNDS, roundsPrompt(current, thoughts, plays, oreSol, solos, boards), ROUNDS_SCHEMA, 'low');
    await saveSpend();
    if (!r.ok) return json(200, { kind, reason: `round reviewer: ${r.why}` });
    const ins = await fetch(`${base}/rest/v1/gali_ai_lessons`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({
        from_round: from, to_round: to, rounds: span.length, played: thoughts.filter((t) => t.played > 0).length, model: MODEL,
        lessons: text(r.data.lessons, 900), watch: text(r.data.watch, 300), confidence: r.data.confidence,
      }),
    });
    if (!ins.ok) return json(500, { error: `save failed: ${ins.status}` });
    return json(200, { kind, model: MODEL, from, to, rounds: thoughts.length, lessons: text(r.data.lessons, 900) });
  }

  // ---------------- the review team: one review per AI style players use ----------------
  const [market, rows, passes, settingsRows] = await Promise.all([
    get('gali_ore_market?select=sol_usd,ore_usd&id=eq.1'),
    get(`gali_ai_rounds?select=wallet,style,mode,total,fee,ev,board_before,board_after,sol_back,ore_grams,won,motherlode,stake,settled_at&void=eq.false&settled_at=gt.${encodeURIComponent(new Date(Date.now() - 7 * 86_400_000).toISOString())}&order=settled_at.desc&limit=20000`),
    get(`gali_ai_passes?select=wallet&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`),
    get('gali_bot_settings?select=wallet,mode,style&limit=10000'),
  ]);
  const chosen = new Map<string, { mode: string; style: string }>(settingsRows.map((r: { wallet: string; mode: string; style: string }) => [r.wallet, r]));
  const inUse = new Set<Style>();
  for (const { wallet } of passes as { wallet: string }[]) {
    const c = chosen.get(wallet);
    if (!c) inUse.add('safe');
    else if (c.mode === 'ai' && isStyle(c.style)) inUse.add(c.style);
  }
  // the team tunes every style players can pick, even with nobody playing: the whole board is enough to learn from
  for (const s of PLAYER_STYLES) inUse.add(s);
  const styles = STYLES.filter((x) => inUse.has(x));

  const oreSol = market[0] && Number(market[0].sol_usd) > 0 ? Number(market[0].ore_usd) / Number(market[0].sol_usd) : 0;
  const toRow = (r: Record<string, unknown>) => ({
    wallet: String(r.wallet),
    total: Number(r.total), fee: Number(r.fee), ev: Number(r.ev), board_before: Number(r.board_before),
    board_after: r.board_after === null ? null : Number(r.board_after), sol_back: r.sol_back === null ? null : Number(r.sol_back),
    ore_grams: r.ore_grams === null ? null : Number(r.ore_grams), won: r.won as boolean | null, motherlode: r.motherlode as boolean | null,
    squares: (r.stake as (number | string)[]).filter((x) => Number(x) > 0).length,
  });
  const dayAgo = Date.now() - 86_400_000;
  // subscribers' feedback from the last 24 hours (it applies to every style)
  const fb: FeedbackRow[] = await get(`gali_ai_feedback?select=wallet,vote,comment,at&at=gt.${encodeURIComponent(new Date(dayAgo).toISOString())}&order=at.desc&limit=2000`).catch(() => []);
  const votes = tally(fb);
  // how solo 1 ORE winners played in the last 24 hours, for every style's review
  const solos: SoloRow[] = await get(`gali_solo_wins?select=wallet,square_total,stake,squares,deployed,motherlode&at=gt.${encodeURIComponent(new Date(dayAgo).toISOString())}&limit=2000`).catch(() => []);
  // how every miner on the board played in the last 24 hours, by style
  const boards: BoardRow[] = await get(`gali_board_rounds?select=round_id,at,miners,deployed,seen,split,motherlode,groups&at=gt.${encodeURIComponent(new Date(dayAgo).toISOString())}&limit=2000`).catch(() => []);

  const results: Record<string, unknown>[] = [];
  for (const style of styles) {
    const mine = rows.filter((r: { mode: string; style: string }) => r.mode !== 'bot' && (r.style ?? 'safe') === style);
    const paramRows = await get(`gali_ai_params?select=min_edge,crowd_buffer,max_round_share,target_slots_left,min_motherlode,note,at&style=eq.${style}&order=id.desc&limit=6`);
    const p = paramRows[0];
    const current: AiParams = p
      ? clampParams({ minEdge: p.min_edge, crowdBuffer: p.crowd_buffer, maxRoundShare: p.max_round_share, targetSlotsLeft: p.target_slots_left, minMotherlode: p.min_motherlode }, STYLE_DEFAULTS[style], STYLE_BOUNDS[style])
      : STYLE_DEFAULTS[style];
    const all: (RoundRow & { wallet: string })[] = mine.map(toRow);
    const last24h = summarize(all.filter((_r, i) => Date.parse(mine[i].settled_at) > dayAgo), oreSol);
    const last7d = summarize(all, oreSol);
    const history = paramRows.slice(0, 5).map((r: { at: string; note: string | null }) => ({ at: r.at, note: r.note }));

    // nothing new for this style since its last review of this kind: nothing to learn, so no Claude calls
    const lastAt = daily ? (await get(`gali_ai_params?select=at&source=eq.${SOURCE}&style=eq.${style}&order=id.desc&limit=1`))[0]?.at : p?.at;
    if (!hasNews(lastAt, [...mine.map((r: { settled_at: string }) => r.settled_at), ...boards.map((b) => b.at ?? '')], fb.map((f) => f.at))) {
      results.push({ style, kept: current, reason: 'nothing new since the last review' });
      continue;
    }
    // the round reviewer's lessons since this style's last review (the daily one reads its most recent day's worth)
    const lessons: { at: string; lessons: string }[] = await get(
      `gali_ai_lessons?select=at,lessons&order=id.desc&limit=${daily ? 24 : 12}${lastAt ? `&at=gt.${encodeURIComponent(lastAt)}` : ''}`,
    ).catch(() => []);
    const why = await overBudget(4);
    if (why) {
      results.push({ style, kept: current, reason: why });
      break;
    }

    // the analyst and the feedback reader work at the same time; the risk checker reads both; the lead decides
    const [analyst, feedback] = await Promise.all([
      ask('analyst', ANALYST, analystPrompt(current, last24h, last7d, history, lessons, style, solos, boards), ANALYST_SCHEMA),
      votes.wallets ? ask('feedback', FEEDBACK, feedbackPrompt(votes, commentBlock(fb)), FEEDBACK_SCHEMA) : Promise.resolve({ ok: false as const, why: 'no feedback in the last 24 hours' }),
    ]);
    const risk = await ask('risk', RISK, riskPrompt(current, last24h, last7d, said(analyst), said(feedback), votes, style), RISK_SCHEMA);
    const lead = await ask('lead', LEAD, leadPrompt(current, last24h, last7d, said(analyst), said(feedback), said(risk), votes, daily, style, boards), LEAD_SCHEMA, 'high');
    await saveSpend();
    if (!lead.ok) {
      results.push({ style, kept: current, reason: `lead: ${lead.why}` });
      continue;
    }

    const { params, note, learned, feedbackReply } = apply(lead.data, current, risk.ok ? riskLimits(risk.data, style) : undefined, style);
    const agents = {
      votes,
      lessons: lessons.length,
      analyst: analyst.ok ? { findings: text(analyst.data.findings, 900), confidence: analyst.data.confidence } : { unavailable: analyst.why },
      feedback: feedback.ok ? { summary: text(feedback.data.summary, 900), lean: feedback.data.lean } : { unavailable: feedback.why },
      risk: risk.ok ? { concerns: text(risk.data.concerns, 900), ...riskLimits(risk.data, style) } : { unavailable: risk.why },
    };
    const ins = await fetch(`${base}/rest/v1/gali_ai_params`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify({
        style, min_edge: params.minEdge, crowd_buffer: params.crowdBuffer, max_round_share: params.maxRoundShare, target_slots_left: params.targetSlotsLeft,
        min_motherlode: params.minMotherlode, source: SOURCE, note: note || null, learned: learned || null, feedback_reply: feedbackReply || null, agents, stats: { last24h, last7d },
      }),
    });
    if (!ins.ok) return json(500, { error: `save failed: ${ins.status}` });
    results.push({ style, from: current, to: params, note, plays24h: last24h.plays, plays7d: last7d.plays, lessons: lessons.length });
  }
  return json(200, { kind: daily ? 'daily' : '3-hourly', model: MODEL, voters: votes.wallets, styles: results });
});
