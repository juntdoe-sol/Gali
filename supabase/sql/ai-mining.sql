-- Gali AI mining. Run once in the Supabase SQL Editor after ore-hits.sql (it reads gali_ore_market for prices) and
-- after deploying the ai-miner, ai-tune and ai-pass functions. Safe to run again.
-- Before running, replace the two values in the cron section at the bottom:
--   <PROJECT_REF>   your Supabase project ref (the part before .supabase.co)
--   <CRON_SECRET>   the same random string the autopilot cron uses (supabase secrets set CRON_SECRET=...)
--
-- Tables are closed to the app. The app reads through the gali_ai_* functions below with the public key; only the
-- edge functions (service role) write.

create table if not exists public.gali_ai_passes (
  wallet text primary key,
  expires_at timestamptz not null,
  paid_lamports bigint not null default 0,
  created_at timestamptz not null default now()
);

-- one row per pass payment, so a transaction can never buy two weeks
create table if not exists public.gali_ai_payments (
  signature text primary key,
  wallet text not null,
  lamports bigint not null,
  at timestamptz not null default now()
);

-- the AI's settings, newest last. ai-tune adds a row every 3 hours (source 'claude') and once a day ('claude-daily');
-- the executor reads the newest.
create table if not exists public.gali_ai_params (
  id bigserial primary key,
  min_edge numeric not null,
  crowd_buffer numeric not null,
  max_round_share numeric not null,
  target_slots_left int not null,
  source text not null default 'default',
  note text,
  at timestamptz not null default now()
);

-- every round the AI played for a player, and (once drawn) what ORE paid for it
create table if not exists public.gali_ai_rounds (
  wallet text not null,
  round_id bigint not null,
  stake bigint[] not null,            -- lamports on each of the 25 squares
  total bigint not null,              -- lamports staked
  fee bigint not null default 0,      -- Gali's 0.25% on the round, lamports (ORE pays it to the AI key)
  ev numeric not null,                -- expected profit in lamports when played (cautious)
  board_before bigint not null,       -- lamports on the chosen squares when played
  prize numeric not null,             -- SOL value of one square's prize, lamports
  signature text not null,
  played_at timestamptz not null default now(),
  settled_at timestamptz,
  void boolean not null default false, -- the deploy never landed
  sol_back bigint,
  ore_grams bigint,
  won boolean,
  motherlode boolean,
  exact boolean,
  board_after bigint,                 -- lamports on the chosen squares when the round closed
  primary key (wallet, round_id)
);
-- the free first week: one per wallet, and only for a wallet that never had a pass
create table if not exists public.gali_ai_trials (
  wallet text primary key,
  at timestamptz not null default now()
);

-- subscribers' feedback, at most one every 2 hours per wallet (ai-pass enforces it). The hourly review reads it.
create table if not exists public.gali_ai_feedback (
  id bigserial primary key,
  wallet text not null,
  vote text not null check (vote in ('more', 'same', 'safer')),
  comment text check (char_length(comment) <= 200),
  at timestamptz not null default now()
);
create index if not exists gali_ai_feedback_wallet on public.gali_ai_feedback (wallet, at desc);
create index if not exists gali_ai_feedback_at on public.gali_ai_feedback (at desc);

-- ai-pass calls this for a signed-in wallet with a live pass. Refuses a second one inside 2 hours.
create or replace function public.gali_ai_feedback_add(p_wallet text, p_vote text, p_comment text)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v_last timestamptz;
begin
  -- one at a time per wallet, so two quick taps can't both get in
  perform pg_advisory_xact_lock(hashtext('gali_ai_feedback:' || p_wallet));
  select max(at) into v_last from gali_ai_feedback where wallet = p_wallet;
  if v_last is not null and v_last > now() - interval '2 hours' then
    raise exception 'too soon until %', v_last + interval '2 hours';
  end if;
  insert into gali_ai_feedback (wallet, vote, comment) values (p_wallet, p_vote, nullif(p_comment, ''));
  return now() + interval '2 hours';
end $$;
revoke all on function public.gali_ai_feedback_add(text, text, text) from public;
grant execute on function public.gali_ai_feedback_add(text, text, text) to service_role;

-- what Claude learned at each review (subscribers only; read through ai-pass)
alter table public.gali_ai_params add column if not exists learned text;
alter table public.gali_ai_params add column if not exists stats jsonb;
-- what each agent of a review said, and how the review used subscribers' feedback
alter table public.gali_ai_params add column if not exists agents jsonb;
alter table public.gali_ai_params add column if not exists feedback_reply text;

-- what each Claude call of a review cost; ai-tune keeps the month under AI_MONTHLY_BUDGET_USD with it
create table if not exists public.gali_ai_claude_spend (
  id bigserial primary key,
  at timestamptz not null default now(),
  model text not null,
  agent text not null,
  input_tokens int not null,
  output_tokens int not null,
  usd numeric not null
);
create index if not exists gali_ai_claude_spend_at on public.gali_ai_claude_spend (at desc);

-- what the AI saw and decided in each round's deploy window (ai-miner writes one row a round), for the AI tab
create table if not exists public.gali_ai_thoughts (
  round_id bigint primary key,
  at timestamptz not null default now(),
  slots_left int not null,
  motherlode_grams bigint not null,
  prize bigint not null,       -- lamports: one winning square's prize, motherlode share included
  board bigint not null,       -- lamports on the whole board
  quietest bigint not null,    -- lamports on the quietest square
  join_limit bigint not null,  -- lamports: a square holding more is not worth joining at these settings
  played int not null,         -- wallets the AI played for
  skipped int not null,        -- wallets it sat out for
  min_edge numeric not null,
  crowd_buffer numeric not null
);
create index if not exists gali_ai_thoughts_at on public.gali_ai_thoughts (at desc);
alter table public.gali_ai_thoughts enable row level security;
revoke all on public.gali_ai_thoughts from anon, authenticated;

-- Everyone: the AI's latest decisions, newest first (board numbers only, nothing per wallet)
create or replace function public.gali_ai_thoughts(p_limit int default 10)
returns table (round_id bigint, at timestamptz, slots_left int, motherlode_grams bigint, prize bigint, board bigint, quietest bigint, join_limit bigint, played int, skipped int, min_edge numeric, crowd_buffer numeric)
language sql stable security definer set search_path = public as $$
  select round_id, at, slots_left, motherlode_grams, prize, board, quietest, join_limit, played, skipped, min_edge, crowd_buffer
  from gali_ai_thoughts order by round_id desc limit least(greatest(p_limit, 1), 50)
$$;
revoke all on function public.gali_ai_thoughts(int) from public;
grant execute on function public.gali_ai_thoughts(int) to anon, authenticated, service_role;

-- the round reviewer's lessons (ai-tune {"kind":"rounds"}, every 15 minutes, Haiku); the review team reads them
create table if not exists public.gali_ai_lessons (
  id bigserial primary key,
  at timestamptz not null default now(),
  from_round bigint not null,
  to_round bigint not null,
  rounds int not null,
  played int not null,
  model text not null,
  lessons text not null,
  watch text,
  confidence text
);
alter table public.gali_ai_lessons enable row level security;
revoke all on public.gali_ai_lessons from anon, authenticated;

-- Everyone: the round reviewer's latest lessons, newest first (board-level, nothing per wallet)
create or replace function public.gali_ai_lessons(p_limit int default 3)
returns table (at timestamptz, from_round bigint, to_round bigint, rounds int, played int, lessons text, watch text, confidence text)
language sql stable security definer set search_path = public as $$
  select at, from_round, to_round, rounds, played, lessons, watch, confidence
  from gali_ai_lessons order by id desc limit least(greatest(p_limit, 1), 20)
$$;
revoke all on function public.gali_ai_lessons(int) from public;
grant execute on function public.gali_ai_lessons(int) to anon, authenticated, service_role;

-- ai-tune reads the month's Claude spend before each review
create or replace function public.gali_ai_claude_spent(p_since timestamptz)
returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(usd), 0) from gali_ai_claude_spend where at >= p_since
$$;
revoke all on function public.gali_ai_claude_spent(timestamptz) from public;
grant execute on function public.gali_ai_claude_spent(timestamptz) to service_role;

create index if not exists gali_ai_rounds_pending on public.gali_ai_rounds (round_id) where settled_at is null;
create index if not exists gali_ai_rounds_settled on public.gali_ai_rounds (settled_at desc) where settled_at is not null;

alter table public.gali_ai_passes enable row level security;
alter table public.gali_ai_payments enable row level security;
alter table public.gali_ai_params enable row level security;
alter table public.gali_ai_rounds enable row level security;
alter table public.gali_ai_trials enable row level security;
alter table public.gali_ai_feedback enable row level security;
alter table public.gali_ai_claude_spend enable row level security;
revoke all on public.gali_ai_passes, public.gali_ai_payments, public.gali_ai_params, public.gali_ai_rounds, public.gali_ai_trials, public.gali_ai_feedback, public.gali_ai_claude_spend from anon, authenticated;

insert into public.gali_ai_params (min_edge, crowd_buffer, max_round_share, target_slots_left, source, note)
select 0.08, 0.25, 0.05, 40, 'default', 'Starting settings'
where not exists (select 1 from public.gali_ai_params);

-- ai-pass calls this after checking the payment on chain. Adds 7 days to the pass (from now, or from when the
-- current pass runs out, whichever is later). Raises when the payment was already used.
create or replace function public.gali_ai_pass_add(p_wallet text, p_signature text, p_lamports bigint)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v_exp timestamptz;
begin
  insert into gali_ai_payments (signature, wallet, lamports) values (p_signature, p_wallet, p_lamports);
  insert into gali_ai_passes (wallet, expires_at, paid_lamports) values (p_wallet, now() + interval '7 days', p_lamports)
  on conflict (wallet) do update
    set expires_at = greatest(gali_ai_passes.expires_at, now()) + interval '7 days',
        paid_lamports = gali_ai_passes.paid_lamports + excluded.paid_lamports
  returning expires_at into v_exp;
  return v_exp;
exception when unique_violation then
  raise exception 'payment already used';
end $$;
revoke all on function public.gali_ai_pass_add(text, text, bigint) from public;
grant execute on function public.gali_ai_pass_add(text, text, bigint) to service_role;

-- ai-pass calls this for a signed-in wallet. 7 free days, once, and only if the wallet never had a pass.
create or replace function public.gali_ai_trial(p_wallet text)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v_exp timestamptz;
begin
  if exists (select 1 from gali_ai_passes where wallet = p_wallet) then raise exception 'trial not available'; end if;
  insert into gali_ai_trials (wallet) values (p_wallet);
  insert into gali_ai_passes (wallet, expires_at, paid_lamports) values (p_wallet, now() + interval '7 days', 0)
  returning expires_at into v_exp;
  return v_exp;
exception when unique_violation then
  raise exception 'trial not available';
end $$;
revoke all on function public.gali_ai_trial(text) from public;
grant execute on function public.gali_ai_trial(text) to service_role;

-- Everyone: how many miners use Gali AI and what it made them, all together. What the AI learned at each review is
-- for subscribers only: ai-pass serves it to signed-in wallets with a live pass.
drop function if exists public.gali_ai_stats();
create or replace function public.gali_ai_stats()
returns table (active_miners int, miners int, rounds bigint, wins bigint, motherlodes bigint, deployed_sol numeric, returned_sol numeric,
               ore numeric, fees_sol numeric, sol_usd numeric, ore_usd numeric, tuned_at timestamptz)
language sql stable security definer set search_path = public as $$
  select
    (select count(*)::int from gali_ai_passes where expires_at > now()),
    (select count(distinct wallet)::int from gali_ai_rounds where settled_at is not null and not void),
    count(*), count(*) filter (where r.won), count(*) filter (where r.motherlode),
    coalesce(sum(r.total), 0) / 1e9, coalesce(sum(r.sol_back), 0) / 1e9, coalesce(sum(r.ore_grams), 0) / 1e11, coalesce(sum(r.fee), 0) / 1e9,
    (select sol_usd from gali_ore_market where id = 1), (select ore_usd from gali_ore_market where id = 1),
    (select at from gali_ai_params order by id desc limit 1)
  from gali_ai_rounds r where r.settled_at is not null and not r.void
$$;

-- Everyone: each miner's AI results, best first (ORE valued at today's ORE/SOL price after the 10% claim fee).
create or replace function public.gali_ai_board(p_limit int default 50)
returns table (wallet text, name text, active boolean, rounds bigint, wins bigint, deployed_sol numeric, returned_sol numeric, ore numeric, fees_sol numeric, net_sol numeric)
language sql stable security definer set search_path = public as $$
  with px as (select coalesce(ore_usd / nullif(sol_usd, 0), 0) as ore_sol from gali_ore_market where id = 1),
  t as (
    select r.wallet, count(*) as rounds, count(*) filter (where r.won) as wins,
           sum(r.total) / 1e9 as deployed_sol, sum(r.sol_back) / 1e9 as returned_sol, sum(r.ore_grams) / 1e11 as ore, sum(r.fee) / 1e9 as fees_sol
    from gali_ai_rounds r where r.settled_at is not null and not r.void group by r.wallet
  )
  select t.wallet, m.name, coalesce(p.expires_at > now(), false), t.rounds, t.wins, t.deployed_sol, t.returned_sol, t.ore, t.fees_sol,
         t.returned_sol - t.deployed_sol - t.fees_sol + t.ore * 0.9 * coalesce((select ore_sol from px), 0)
  from t
  left join gali_miners m on m.wallet = t.wallet
  left join gali_ai_passes p on p.wallet = t.wallet
  order by 10 desc
  limit least(greatest(p_limit, 1), 200)
$$;

drop function if exists public.gali_ai_me(text);
-- Everyone: one wallet's pass and results (wallets and rounds are public on chain anyway).
create or replace function public.gali_ai_me(p_wallet text)
returns table (expires_at timestamptz, trial_open boolean, next_feedback_at timestamptz, rounds bigint, wins bigint, deployed_sol numeric, returned_sol numeric, ore numeric, fees_sol numeric, pending bigint)
language sql stable security definer set search_path = public as $$
  select (select expires_at from gali_ai_passes where wallet = p_wallet),
         not exists (select 1 from gali_ai_passes where wallet = p_wallet),
         (select max(at) + interval '2 hours' from gali_ai_feedback where wallet = p_wallet),
         count(*) filter (where settled_at is not null and not void),
         count(*) filter (where won),
         coalesce(sum(total) filter (where settled_at is not null and not void), 0) / 1e9,
         coalesce(sum(sol_back) filter (where not void), 0) / 1e9,
         coalesce(sum(ore_grams) filter (where not void), 0) / 1e11,
         coalesce(sum(fee) filter (where settled_at is not null and not void), 0) / 1e9,
         count(*) filter (where settled_at is null)
  from gali_ai_rounds where wallet = p_wallet
$$;

revoke all on function public.gali_ai_stats(), public.gali_ai_board(int), public.gali_ai_me(text) from public;
grant execute on function public.gali_ai_stats(), public.gali_ai_board(int), public.gali_ai_me(text) to anon, authenticated, service_role;

-- ---------------- Bot and AI bot ----------------
-- Each wallet picks Bot (its own rules, no AI) or AI bot (a style the agents tune). One pass covers both.
create table if not exists public.gali_bot_settings (
  wallet text primary key,
  mode text not null default 'ai' check (mode in ('bot', 'ai')),
  style text not null default 'safe' check (style in ('safe', 'balance', 'solo', 'motherlode')),
  spots int not null default 10 check (spots between 1 and 25),   -- Bot: the quietest this many squares
  per_spot_sol numeric not null default 0.002 check (per_spot_sol > 0),
  max_spot_sol numeric check (max_spot_sol > 0),                  -- Bot: skip squares holding more
  min_motherlode_ore numeric check (min_motherlode_ore > 0),      -- Bot: only play big motherlodes
  max_round_sol numeric check (max_round_sol > 0),                -- both: most SOL in one round
  stop_loss_sol numeric check (stop_loss_sol > 0),                -- both: stop after losing this much
  started_at timestamptz not null default now(),                  -- the stop-loss counts from here
  updated_at timestamptz not null default now()
);
alter table public.gali_bot_settings enable row level security;
revoke all on public.gali_bot_settings from anon, authenticated;

-- which mode and style played each round, and per-style settings the agents tune
alter table public.gali_ai_rounds add column if not exists mode text not null default 'ai';
alter table public.gali_ai_rounds add column if not exists style text not null default 'safe';
alter table public.gali_ai_params add column if not exists style text not null default 'safe';
alter table public.gali_ai_params add column if not exists min_motherlode numeric not null default 0;
insert into public.gali_ai_params (min_edge, crowd_buffer, max_round_share, target_slots_left, min_motherlode, style, source, note)
select -0.05, 0.1, 0.05, 30, 0, 'solo', 'default', 'Solo hunter starting settings'
where not exists (select 1 from public.gali_ai_params where style = 'solo');
insert into public.gali_ai_params (min_edge, crowd_buffer, max_round_share, target_slots_left, min_motherlode, style, source, note)
select -0.2, 0.1, 0.05, 30, 150, 'motherlode', 'default', 'Motherlode chaser starting settings'
where not exists (select 1 from public.gali_ai_params where style = 'motherlode');
insert into public.gali_ai_params (min_edge, crowd_buffer, max_round_share, target_slots_left, min_motherlode, style, source, note)
select 0, 0.2, 0.03, 30, 0, 'balance', 'default', 'Balance starting settings'
where not exists (select 1 from public.gali_ai_params where style = 'balance');
alter table public.gali_bot_settings drop constraint if exists gali_bot_settings_style_check;
alter table public.gali_bot_settings add constraint gali_bot_settings_style_check check (style in ('safe', 'balance', 'solo', 'motherlode'));

-- Everyone: a wallet's Bot settings (nothing secret: they are rules, not keys)
create or replace function public.gali_bot_settings_of(p_wallet text)
returns setof public.gali_bot_settings
language sql stable security definer set search_path = public as $$
  select * from gali_bot_settings where wallet = p_wallet
$$;

-- The miner: each wallet's result since its settings started (SOL back + ORE at today's price - SOL played - fees),
-- for the stop-loss. Rounds not drawn yet count as played and lost until they are.
create or replace function public.gali_bot_net()
returns table (wallet text, net_sol numeric)
language sql stable security definer set search_path = public as $$
  select r.wallet,
         (coalesce(sum(r.sol_back), 0) + coalesce(sum(r.ore_grams), 0) / 1e2 * coalesce((select ore_usd / nullif(sol_usd, 0) from gali_ore_market where id = 1), 0)
          - sum(r.total) - sum(r.fee)) / 1e9
  from gali_ai_rounds r join gali_bot_settings s on s.wallet = r.wallet
  where not r.void and r.played_at >= s.started_at
  group by r.wallet
$$;
revoke all on function public.gali_bot_settings_of(text), public.gali_bot_net() from public;
grant execute on function public.gali_bot_settings_of(text) to anon, authenticated, service_role;
grant execute on function public.gali_bot_net() to service_role;

-- How every solo 1 ORE winner played (any wallet), read by ai-miner early in the next round. The AI agents study it.
create table if not exists public.gali_solo_wins (
  round_id bigint primary key,
  at timestamptz not null default now(),
  wallet text not null,
  square int not null,
  square_total bigint not null,  -- lamports on the winning square, all miners
  stake bigint not null,         -- the winner's lamports on it
  squares int not null,          -- squares the winner covered
  deployed bigint not null,      -- the winner's lamports across the board
  motherlode boolean not null default false
);
create index if not exists gali_solo_wins_at on public.gali_solo_wins (at desc);
alter table public.gali_solo_wins enable row level security;
revoke all on public.gali_solo_wins from anon, authenticated;

-- Every miner on the board, every round (any wallet), grouped by squares covered and SOL per square: what the AI agents
-- study. groups: {"<squares>|<SOL per square>": {miners, deployed, back, onWin, ore, solo}} in lamports and grams.
create table if not exists public.gali_board_rounds (
  round_id bigint primary key,
  at timestamptz not null default now(),
  miners int not null,
  deployed bigint not null,
  seen real not null,
  win_square int not null,
  split boolean not null,
  reward bigint not null,
  motherlode bigint not null,
  solo_wallet text,
  solo_stake bigint,
  solo_square_total bigint,
  solo_squares int,
  groups jsonb not null
);
create index if not exists gali_board_rounds_at on public.gali_board_rounds (at desc);
alter table public.gali_board_rounds enable row level security;
revoke all on public.gali_board_rounds from anon, authenticated;

-- ---------------- schedules ----------------
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- the AI plays every minute; each run covers about 50 seconds
select cron.unschedule('gali-ai-miner') where exists (select 1 from cron.job where jobname = 'gali-ai-miner');
select cron.schedule('gali-ai-miner', '* * * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/ai-miner',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{}'::jsonb,
    timeout_milliseconds := 58000
  );
$$);

-- Claude reviews the last rounds and retunes the settings every 3 hours (Haiku)
select cron.unschedule('gali-ai-tune') where exists (select 1 from cron.job where jobname = 'gali-ai-tune');
select cron.schedule('gali-ai-tune', '17 */3 * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/ai-tune',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
$$);

-- the round reviewer reads every round every 15 minutes (Haiku), a few minutes before each review at :17
select cron.unschedule('gali-ai-rounds') where exists (select 1 from cron.job where jobname = 'gali-ai-rounds');
select cron.schedule('gali-ai-rounds', '12,27,42,57 * * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/ai-tune',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{"kind":"rounds"}'::jsonb,
    timeout_milliseconds := 120000
  );
$$);

-- and once a day a deeper review that weighs the week (Sonnet), at 04:00 UTC (12:00 noon UTC+8)
select cron.unschedule('gali-ai-tune-daily') where exists (select 1 from cron.job where jobname = 'gali-ai-tune-daily');
select cron.schedule('gali-ai-tune-daily', '0 4 * * *', $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/ai-tune',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{"kind":"daily"}'::jsonb,
    timeout_milliseconds := 120000
  );
$$);
