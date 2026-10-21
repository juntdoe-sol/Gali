-- Ranks by period: today, this week, this month, this year and all time. Run once in the Supabase SQL Editor
-- (safe to run again), after brawl-ranks.sql, brawl-ranks-boss.sql and miner-ranks.sql.
--
-- Days, weeks (from Monday), months and years start at midnight Malaysia time (UTC+8). The week is
-- for the lobby's Player of the Week board: the most XP gained since Monday.
--
-- Brawl: counted straight from the KO and win rows, for any period.
-- Level (XP) and ORE mined: the totals only ever go up, so a period's score is how much a wallet gained
-- in it. Each wallet's totals are written down once a day (gali_miner_days), and the gain is today's
-- total minus the last total written before the period began. History starts the day this file runs:
-- until then the day, month and year boards fill up as miners play.

create or replace function public.gali_period_start(p_period text) returns timestamptz
language sql stable as $$
  select case p_period
    when 'day' then date_trunc('day', now() at time zone 'Asia/Kuala_Lumpur') at time zone 'Asia/Kuala_Lumpur'
    when 'week' then date_trunc('week', now() at time zone 'Asia/Kuala_Lumpur') at time zone 'Asia/Kuala_Lumpur'
    when 'month' then date_trunc('month', now() at time zone 'Asia/Kuala_Lumpur') at time zone 'Asia/Kuala_Lumpur'
    when 'year' then date_trunc('year', now() at time zone 'Asia/Kuala_Lumpur') at time zone 'Asia/Kuala_Lumpur'
    else null
  end
$$;
create or replace function public.gali_today() returns date language sql stable as $$
  select (now() at time zone 'Asia/Kuala_Lumpur')::date
$$;

/* ---------------- Brawl ---------------- */
-- 1 point a KO (each victim counts at most 3 times a day per winner), 3 a match win, 2 a raid won
-- (a Boss Raid, or Crawler Waves held to the end).
-- Crawler Waves wins are kept too (the table took only lms, koth and boss before).
alter table public.brawl_wins drop constraint if exists brawl_wins_mode_check;
alter table public.brawl_wins add constraint brawl_wins_mode_check check (mode in ('lms', 'koth', 'boss', 'waves'));
create or replace function public.brawl_ranks_period(p_period text default 'all', p_limit int default 50)
returns table (name text, kos int, wins int, bosses int, points int)
language sql stable security definer set search_path = public as $$
  with s as (select gali_period_start(p_period) as t0),
  k as (
    select killer as name, count(*) as kos from (
      select killer, row_number() over (partition by killer, victim, date_trunc('day', at) order by at) n
      from brawl_kos, s where s.t0 is null or at >= s.t0
    ) x where n <= 3 group by killer
  ), w as (
    select winner as name,
           count(*) filter (where mode not in ('boss', 'waves')) as wins,
           count(*) filter (where mode in ('boss', 'waves')) as bosses
    from brawl_wins, s where s.t0 is null or at >= s.t0 group by winner
  )
  select coalesce(k.name, w.name), coalesce(k.kos, 0)::int, coalesce(w.wins, 0)::int, coalesce(w.bosses, 0)::int,
         (coalesce(k.kos, 0) + 3 * coalesce(w.wins, 0) + 2 * coalesce(w.bosses, 0))::int as points
  from k full join w on k.name = w.name
  order by points desc
  limit least(greatest(coalesce(p_limit, 50), 1), 100)
$$;
grant execute on function public.brawl_ranks_period(text, int) to anon, authenticated;

/* ---------------- daily totals per wallet ---------------- */
create table if not exists public.gali_miner_days (
  wallet text not null references public.gali_miners (wallet) on delete cascade,
  day date not null,
  xp_open bigint, xp_close bigint,
  pts_open bigint, pts_close bigint,
  ore_open numeric, ore_close numeric,
  primary key (wallet, day)
);
alter table public.gali_miner_days enable row level security;
revoke all on public.gali_miner_days from anon, authenticated;

-- The check-in now also writes the day's totals (open = first of the day, close = highest).
create or replace function public.gali_seen(p_wallet text, p_name text, p_level int, p_xp bigint, p_points bigint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_xp bigint := least(greatest(coalesce(p_xp, 0), 0), 50000000);
  v_pts bigint := least(greatest(coalesce(p_points, 0), 0), 500000000);
begin
  if p_wallet is null or p_wallet !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then return; end if;
  insert into gali_miners as m (wallet, name, level, xp, points)
  values (p_wallet, left(coalesce(p_name, ''), 24), least(greatest(coalesce(p_level, 1), 1), 200), v_xp, v_pts)
  on conflict (wallet) do update set
    name = case when excluded.name <> '' then excluded.name else m.name end,
    level = greatest(m.level, excluded.level),
    xp = greatest(m.xp, excluded.xp),
    points = greatest(m.points, excluded.points),
    seen = now()
  where m.seen < now() - interval '10 seconds';
  -- the day's totals, from what the table now holds (it only keeps rises)
  insert into gali_miner_days as d (wallet, day, xp_open, xp_close, pts_open, pts_close)
  select wallet, gali_today(), xp, xp, points, points from gali_miners where wallet = p_wallet
  on conflict (wallet, day) do update set
    xp_open = coalesce(d.xp_open, excluded.xp_open),
    pts_open = coalesce(d.pts_open, excluded.pts_open),
    xp_close = greatest(coalesce(d.xp_close, 0), excluded.xp_close),
    pts_close = greatest(coalesce(d.pts_close, 0), excluded.pts_close);
end $$;
grant execute on function public.gali_seen(text, text, int, bigint, bigint) to anon, authenticated;

-- Lifetime ORE mined, as the app read it from ORE's Miner account on chain. The board shows the chain's
-- number for the total; this only keeps the daily marks for the gain. A mark never goes down, so nobody
-- can drag a wallet's starting point lower to inflate its gain.
create or replace function public.gali_ore_seen(p_wallet text, p_ore numeric)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_max numeric;
begin
  if p_wallet is null or p_ore is null or p_ore < 0 or p_ore > 100000000 then return; end if;
  if not exists (select 1 from gali_miners where wallet = p_wallet) then return; end if;
  select max(ore_close) into v_max from gali_miner_days where wallet = p_wallet;
  if v_max is not null and p_ore < v_max then return; end if;
  insert into gali_miner_days as d (wallet, day, ore_open, ore_close)
  values (p_wallet, gali_today(), p_ore, p_ore)
  on conflict (wallet, day) do update set
    ore_open = coalesce(d.ore_open, excluded.ore_open),
    ore_close = greatest(coalesce(d.ore_close, 0), excluded.ore_close);
end $$;
grant execute on function public.gali_ore_seen(text, numeric) to anon, authenticated;

-- Where each wallet stood when the period began: the last close before it, else the first open in it.
create or replace function public.gali_period_base(p_period text)
returns table (wallet text, xp bigint, points bigint, ore numeric)
language sql stable security definer set search_path = public as $$
  with s as (select (gali_period_start(p_period) at time zone 'Asia/Kuala_Lumpur')::date as d0)
  select m.wallet,
    coalesce((select x.xp_close from gali_miner_days x, s where x.wallet = m.wallet and x.day < s.d0 and x.xp_close is not null order by x.day desc limit 1),
             (select x.xp_open from gali_miner_days x, s where x.wallet = m.wallet and x.day >= s.d0 and x.xp_open is not null order by x.day limit 1), m.xp),
    coalesce((select x.pts_close from gali_miner_days x, s where x.wallet = m.wallet and x.day < s.d0 and x.pts_close is not null order by x.day desc limit 1),
             (select x.pts_open from gali_miner_days x, s where x.wallet = m.wallet and x.day >= s.d0 and x.pts_open is not null order by x.day limit 1), m.points),
    coalesce((select x.ore_close from gali_miner_days x, s where x.wallet = m.wallet and x.day < s.d0 and x.ore_close is not null order by x.day desc limit 1),
             (select x.ore_open from gali_miner_days x, s where x.wallet = m.wallet and x.day >= s.d0 and x.ore_open is not null order by x.day limit 1))
  from gali_miners m
  where p_period in ('day', 'week', 'month', 'year')
$$;
grant execute on function public.gali_period_base(text) to anon, authenticated;

-- XP (and points) gained in the period, highest first.
create or replace function public.gali_miner_ranks(p_period text default 'all', p_limit int default 100)
returns table (wallet text, name text, level int, xp bigint, points bigint, gain bigint)
language sql stable security definer set search_path = public as $$
  select m.wallet, m.name, m.level, m.xp, m.points,
         case when p_period in ('day', 'week', 'month', 'year') then m.xp - b.xp else m.xp end as gain
  from gali_miners m left join gali_period_base(p_period) b on b.wallet = m.wallet
  where p_period not in ('day', 'week', 'month', 'year') or m.xp - b.xp > 0
  order by gain desc
  limit least(greatest(coalesce(p_limit, 100), 1), 200)
$$;
grant execute on function public.gali_miner_ranks(text, int) to anon, authenticated;

-- The ORE marks for a period, for the wallets on the board (the app subtracts them from the chain's total).
create or replace function public.gali_ore_base(p_period text)
returns table (wallet text, ore numeric)
language sql stable security definer set search_path = public as $$
  select wallet, ore from gali_period_base(p_period) where ore is not null
$$;
grant execute on function public.gali_ore_base(text) to anon, authenticated;
