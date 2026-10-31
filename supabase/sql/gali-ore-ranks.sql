-- ORE ranks worked out on the server (no chain reads in the player's browser).
-- Run once in the Supabase SQL editor (after gali-since-join.sql), then deploy the ore-hits function and the web build.
--
-- gali_ore_snap: the ore-hits job writes every Gali wallet's ORE lifetime counter into gali_miner_days every 5 minutes.
-- gali_ore_ranks: ORE mined in Gali for a period. Latest counter minus the later of the period's start mark and the
--   wallet's join baseline (ore_base), so mining from before joining Gali never counts. 'all' = since joining.

create or replace function public.gali_ore_snap(p_wallets text[], p_ore numeric[])
returns void language sql security definer set search_path to 'public' as $$
  insert into gali_miner_days as d (wallet, day, ore_open, ore_close)
  select t.w, gali_today(), t.o, t.o
  from unnest(p_wallets, p_ore) as t(w, o)
  where t.o is not null and t.o >= 0 and exists (select 1 from gali_miners m where m.wallet = t.w)
  on conflict (wallet, day) do update set
    ore_open = coalesce(d.ore_open, excluded.ore_open),
    ore_close = greatest(coalesce(d.ore_close, 0), excluded.ore_close);
$$;
revoke all on function public.gali_ore_snap(text[], numeric[]) from public, anon, authenticated;
grant execute on function public.gali_ore_snap(text[], numeric[]) to service_role;

create or replace function public.gali_ore_ranks(p_period text, p_limit int default 100)
returns table(wallet text, name text, level int, ore numeric)
language sql stable security definer set search_path to 'public' as $$
  with latest as (
    select d.wallet, max(d.ore_close) as l from gali_miner_days d where d.ore_close is not null group by d.wallet
  ), marks as (
    select b.wallet, b.ore from gali_period_base(p_period) b where p_period in ('day', 'month', 'year') and b.ore is not null
  ), g as (
    select m.wallet, m.name, m.level, l.l - greatest(m.ore_base, coalesce(k.ore, m.ore_base)) as gain
    from gali_miners m
    join latest l on l.wallet = m.wallet
    left join marks k on k.wallet = m.wallet
    where m.ore_base is not null
  )
  select g.wallet, g.name, g.level, round(g.gain, 6) from g
  where g.gain > 0
  order by g.gain desc
  limit least(greatest(coalesce(p_limit, 100), 1), 200)
$$;
revoke all on function public.gali_ore_ranks(text, int) from public;
grant execute on function public.gali_ore_ranks(text, int) to anon, authenticated, service_role;
