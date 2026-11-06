-- Gali AI mining, the parts the live database has on top of ai-mining.sql: per-player bot settings (styles, run time,
-- stop-loss), the per-round decision log, the round reviewer's lessons, and the board studies the review team reads.
-- Written from the live database (project rckvfpwtdyvvvjqqlffn) on 6 Nov 2026, so the repo can rebuild what runs.
-- Run after ai-mining.sql. Safe to run again.

-- ---------------- styles on the existing tables ----------------
alter table public.gali_ai_params add column if not exists style text not null default 'safe';
alter table public.gali_ai_params add column if not exists min_motherlode numeric not null default 0;
alter table public.gali_ai_rounds add column if not exists mode text not null default 'ai';
alter table public.gali_ai_rounds add column if not exists style text not null default 'safe';

-- ---------------- each player's bot settings, fixed while the bot runs (ai-pass "settings") ----------------
create table if not exists public.gali_bot_settings (
  wallet text primary key,
  mode text not null default 'ai' check (mode = any (array['bot', 'ai'])),
  style text not null default 'safe' check (style = any (array['safe', 'balance', 'solo', 'motherlode'])),
  spots integer not null default 10 check (spots >= 1 and spots <= 25),
  per_spot_sol numeric not null default 0.002 check (per_spot_sol > 0),
  max_spot_sol numeric check (max_spot_sol > 0),
  min_motherlode_ore numeric check (min_motherlode_ore > 0),
  max_round_sol numeric check (max_round_sol > 0),
  stop_loss_sol numeric check (stop_loss_sol > 0),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- how long the bot runs from START (up to 30 days); null: until stopped
  run_hours numeric check (run_hours > 0 and run_hours <= 720),
  run_until timestamptz
);

-- ---------------- what the AI saw and did each round it watched ----------------
create table if not exists public.gali_ai_thoughts (
  round_id bigint primary key,
  at timestamptz not null default now(),
  slots_left integer not null,
  motherlode_grams bigint not null,
  prize bigint not null,
  board bigint not null,
  quietest bigint not null,
  join_limit bigint not null,
  played integer not null,
  skipped integer not null,
  min_edge numeric not null,
  crowd_buffer numeric not null
);
create index if not exists gali_ai_thoughts_at on public.gali_ai_thoughts (at desc);

-- ---------------- the round reviewer's lessons (ai-tune {"kind":"rounds"}) ----------------
create table if not exists public.gali_ai_lessons (
  id bigserial primary key,
  at timestamptz not null default now(),
  from_round bigint not null,
  to_round bigint not null,
  rounds integer not null,
  played integer not null,
  model text not null,
  lessons text not null,
  watch text,
  confidence text
);

-- ---------------- board studies: every round's miners, and who won the solo ORE ----------------
create table if not exists public.gali_board_rounds (
  round_id bigint primary key,
  at timestamptz not null default now(),
  miners integer not null,
  deployed bigint not null,
  seen real not null,
  win_square integer not null,
  split boolean not null,
  reward bigint not null,
  motherlode bigint not null,
  solo_wallet text,
  solo_stake bigint,
  solo_square_total bigint,
  solo_squares integer,
  groups jsonb not null
);
create index if not exists gali_board_rounds_at on public.gali_board_rounds (at desc);

create table if not exists public.gali_solo_wins (
  round_id bigint primary key,
  at timestamptz not null default now(),
  wallet text not null,
  square integer not null,
  square_total bigint not null,
  stake bigint not null,
  squares integer not null,
  deployed bigint not null,
  motherlode boolean not null default false
);
create index if not exists gali_solo_wins_at on public.gali_solo_wins (at desc);

alter table public.gali_bot_settings enable row level security;
alter table public.gali_ai_thoughts enable row level security;
alter table public.gali_ai_lessons enable row level security;
alter table public.gali_board_rounds enable row level security;
alter table public.gali_solo_wins enable row level security;
revoke all on public.gali_bot_settings, public.gali_ai_thoughts, public.gali_ai_lessons, public.gali_board_rounds, public.gali_solo_wins from anon, authenticated;

-- ---------------- what the app reads ----------------
create or replace function public.gali_ai_day(p_wallet text)
returns table (rounds bigint, wins bigint, deployed_sol numeric, returned_sol numeric, ore numeric, fees_sol numeric)
language sql stable security definer set search_path = public as $$
  select count(*), count(*) filter (where won), coalesce(sum(total), 0) / 1e9, coalesce(sum(sol_back), 0) / 1e9, coalesce(sum(ore_grams), 0) / 1e11, coalesce(sum(fee), 0) / 1e9
  from gali_ai_rounds
  where wallet = p_wallet and settled_at is not null and not void and played_at > now() - interval '24 hours'
$$;

create or replace function public.gali_ai_lessons(p_limit integer default 3)
returns table (at timestamptz, from_round bigint, to_round bigint, rounds integer, played integer, lessons text, watch text, confidence text)
language sql stable security definer set search_path = public as $$
  select at, from_round, to_round, rounds, played, lessons, watch, confidence
  from gali_ai_lessons order by id desc limit least(greatest(p_limit, 1), 20)
$$;

create or replace function public.gali_ai_thoughts(p_limit integer default 10)
returns table (round_id bigint, at timestamptz, slots_left integer, motherlode_grams bigint, prize bigint, board bigint, quietest bigint, join_limit bigint, played integer, skipped integer, min_edge numeric, crowd_buffer numeric)
language sql stable security definer set search_path = public as $$
  select round_id, at, slots_left, motherlode_grams, prize, board, quietest, join_limit, played, skipped, min_edge, crowd_buffer
  from gali_ai_thoughts order by round_id desc limit least(greatest(p_limit, 1), 50)
$$;

create or replace function public.gali_ai_my_rounds(p_wallet text, p_limit integer default 100)
returns table (round_id bigint, at timestamptz, played boolean, landed boolean, squares integer, sol numeric, back numeric, ore numeric, won boolean, settled boolean, board_sol numeric, quietest_sol numeric, join_limit_sol numeric, motherlode_ore numeric, bots_played integer, win_square integer)
language sql stable security definer set search_path = public as $$
  with since as (
    select coalesce((select started_at from gali_bot_settings where wallet = p_wallet), now() - interval '7 days') as t
  ),
  mine as (
    select r.* from gali_ai_rounds r where r.wallet = p_wallet and r.played_at >= (select t from since) - interval '5 minutes'
  ),
  ids as (
    select t.round_id from gali_ai_thoughts t where t.at >= (select t from since)
    union select b.round_id from gali_board_rounds b where b.at >= (select t from since)
    union select m.round_id from mine m
  )
  select i.round_id,
         coalesce(m.played_at, t.at, b.at),
         m.round_id is not null,
         m.round_id is not null and not coalesce(m.void, false),
         (select count(*)::int from unnest(m.stake) x where x::bigint > 0),
         m.total / 1e9, m.sol_back / 1e9, m.ore_grams / 1e11, m.won, m.settled_at is not null,
         coalesce(t.board, b.deployed) / 1e9, t.quietest / 1e9, t.join_limit / 1e9, t.motherlode_grams / 1e11, t.played, b.win_square
  from ids i
  left join mine m on m.round_id = i.round_id
  left join gali_ai_thoughts t on t.round_id = i.round_id
  left join gali_board_rounds b on b.round_id = i.round_id
  order by i.round_id desc
  limit least(greatest(p_limit, 1), 300)
$$;

-- each bot's result since its settings were saved (the stop-loss reads this): ORE at today's price, lamports in, SOL out
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

create or replace function public.gali_bot_settings_of(p_wallet text)
returns setof public.gali_bot_settings
language sql stable security definer set search_path = public as $$
  select * from gali_bot_settings where wallet = p_wallet
$$;

revoke all on function public.gali_ai_day(text), public.gali_ai_lessons(integer), public.gali_ai_thoughts(integer), public.gali_ai_my_rounds(text, integer),
  public.gali_bot_net(), public.gali_bot_settings_of(text) from public;
grant execute on function public.gali_ai_day(text), public.gali_ai_lessons(integer), public.gali_ai_thoughts(integer), public.gali_ai_my_rounds(text, integer),
  public.gali_bot_net(), public.gali_bot_settings_of(text) to anon, authenticated, service_role;

-- ---------------- schedules, as live ----------------
-- Same pattern as ai-mining.sql (replace <PROJECT_REF> and <CRON_SECRET>; keep the secret in Vault, never in git):
--   gali-ai-miner       * * * * *            ai-miner  {}
--   gali-ai-rounds      12,27,42,57 * * * *  ai-tune   {"kind":"rounds"}   round reviewer, Haiku
--   gali-ai-tune        17 */3 * * *         ai-tune   {}                  review team per style, Haiku
--   gali-ai-tune-daily  0 4 * * *            ai-tune   {"kind":"daily"}    review team per style, Sonnet
