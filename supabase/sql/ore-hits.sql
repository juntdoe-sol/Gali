-- Applied 30 Oct 2026. Run after ore-stats.sql. Deploy the ore-hits function too (supabase/functions/ore-hits).
-- Gali miners' solo wins and motherlode hits on ORE's board, plus ORE/SOL prices and Gali-wide profit for the
-- ORE stats panel. The ore-hits edge function (pg_cron, every minute) writes all of it with the service key.

create table if not exists ore_hits (
  round_id bigint not null,
  kind text not null check (kind in ('solo', 'motherlode')),
  wallet text not null,
  square int,
  ore numeric,            -- ORE this wallet won: the whole round's ORE (solo) or its share of the motherlode
  share numeric,                   -- its share of SOL on the gold spot (1 for solo)
  round_sol numeric,               -- SOL on the gold spot
  motherlode_ore numeric,          -- the whole motherlode that round (motherlode rows)
  at timestamptz not null default now(),
  approx boolean not null default false, -- time estimated from the round number (rounds found by the first catch-up)
  primary key (round_id, kind, wallet)
);
create index if not exists ore_hits_at_idx on ore_hits (at desc);

create table if not exists ore_hits_state (
  id int primary key check (id = 1),
  last_round bigint,
  updated_at timestamptz default now()
);

create table if not exists gali_ore_market (
  id int primary key check (id = 1),
  sol_usd numeric,
  ore_usd numeric,
  prices_at timestamptz,
  miners int,
  ore numeric,             -- all-time ORE mined by Gali wallets (ORE's lifetime counter)
  deployed_sol numeric,    -- all-time SOL they put on the board
  returned_sol numeric,    -- all-time SOL ORE gave back to them
  totals_at timestamptz
);

alter table ore_hits enable row level security;
alter table ore_hits_state enable row level security;
alter table gali_ore_market enable row level security;
revoke all on ore_hits, ore_hits_state, gali_ore_market from anon, authenticated;

-- The game reads through these two functions with the public key.
create or replace function gali_ore_hits(p_limit int default 100)
returns table (round_id bigint, kind text, wallet text, name text, ore numeric, share numeric, motherlode_ore numeric, at timestamptz, approx boolean)
language sql stable security definer set search_path = public as $$
  select h.round_id, h.kind, h.wallet, m.name, h.ore, h.share, h.motherlode_ore, h.at, h.approx
  from ore_hits h left join gali_miners m on m.wallet = h.wallet
  order by h.round_id desc, h.kind, h.ore desc
  limit least(greatest(p_limit, 1), 500)
$$;
create or replace function gali_ore_market()
returns table (sol_usd numeric, ore_usd numeric, prices_at timestamptz, miners int, ore numeric, deployed_sol numeric, returned_sol numeric, totals_at timestamptz)
language sql stable security definer set search_path = public as $$
  select sol_usd, ore_usd, prices_at, miners, ore, deployed_sol, returned_sol, totals_at from gali_ore_market where id = 1
$$;
revoke all on function gali_ore_hits(int), gali_ore_market() from public;
grant execute on function gali_ore_hits(int), gali_ore_market() to anon, authenticated, service_role;

-- every minute; reuses the ore-rate job's call (and its cron secret) so no secret is written here
select cron.unschedule('gali-ore-hits') where exists (select 1 from cron.job where jobname = 'gali-ore-hits');
select cron.schedule('gali-ore-hits', '* * * * *', replace((select command from cron.job where jobname = 'gali-ore-rate'), '/functions/v1/ore-rate', '/functions/v1/ore-hits'));

-- Called by the autopilot and play functions with each Gali miner's finished round, scored from ORE's own
-- accounts just before the miner's next deploy replaces it. Gali's points boards (verified-scores.sql) are not
-- live yet, so for now this only records motherlode hits; the ore-hits job fills in the ORE from ORE's accounts.
-- verified-scores.sql has the same insert, so applying it later keeps this working.
create or replace function public.gali_score_round(p_wallet text, p_round bigint, p_covered int, p_won boolean, p_motherlode boolean, p_points bigint, p_xp int)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if p_wallet is null or p_wallet !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then return false; end if;
  if p_motherlode and p_won then
    insert into ore_hits (round_id, kind, wallet, ore, at, approx)
    values (p_round, 'motherlode', p_wallet, null, now(), false)
    on conflict (round_id, kind, wallet) do nothing;
  end if;
  return false;
end $$;
revoke all on function public.gali_score_round(text, bigint, int, boolean, boolean, bigint, int) from public, anon, authenticated;
grant execute on function public.gali_score_round(text, bigint, int, boolean, boolean, bigint, int) to service_role;

-- 30 Oct: what each winner put in and got back that round
alter table ore_hits add column if not exists sol_in numeric, add column if not exists sol_back numeric, add column if not exists sol_exact boolean;
drop function if exists gali_ore_hits(int);
create function gali_ore_hits(p_limit int default 100)
returns table (round_id bigint, kind text, wallet text, name text, ore numeric, share numeric, motherlode_ore numeric, at timestamptz, approx boolean, sol_in numeric, sol_back numeric, sol_exact boolean)
language sql stable security definer set search_path = public as $$
  select h.round_id, h.kind, h.wallet, m.name, h.ore, h.share, h.motherlode_ore, h.at, h.approx, h.sol_in, h.sol_back, h.sol_exact
  from ore_hits h left join gali_miners m on m.wallet = h.wallet
  order by h.round_id desc, h.kind, h.ore desc nulls last
  limit least(greatest(p_limit, 1), 500)
$$;
revoke all on function gali_ore_hits(int) from public;
grant execute on function gali_ore_hits(int) to anon, authenticated, service_role;
