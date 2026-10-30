-- Count ORE (and SOL) from when a miner joined Gali, not ORE's lifetime counter.
-- Run once in the Supabase SQL editor, then deploy the play and ore-hits functions.
--
-- ORE's Miner account counts everything a wallet ever mined on ORE's board, on any site. Gali keeps a baseline per
-- wallet: the counters at the moment it joined. Gali's numbers are then "counter now - baseline".
--   ore_base       lifetime ORE when the wallet joined. Early miners (before 31 Oct): their first daily snapshot
--                  (gali_miner_days, kept since 21 Oct). New miners: read from ORE at their first check-in.
--   sol_in_base    lifetime SOL deployed at the baseline (early miners: today, as no SOL history was kept)
--   sol_back_base  lifetime SOL ORE paid back at the baseline (same)
-- The play function (check-in) and the ore-hits job (every 5 minutes) fill a missing baseline from the chain.
-- Nothing a player sends can change a baseline: only the service role writes these columns.

alter table public.gali_miners add column if not exists ore_base numeric;
alter table public.gali_miners add column if not exists sol_in_base numeric;
alter table public.gali_miners add column if not exists sol_back_base numeric;
alter table public.gali_miners add column if not exists base_at timestamptz;

-- early miners: ORE from their first snapshot
update public.gali_miners m set ore_base = s.first_ore, base_at = coalesce(m.base_at, s.first_day::timestamptz)
from (
  select wallet,
         (array_agg(coalesce(ore_open, ore_close) order by day) filter (where coalesce(ore_open, ore_close) is not null))[1] as first_ore,
         min(day) filter (where coalesce(ore_open, ore_close) is not null) as first_day
  from public.gali_miner_days group by wallet
) s
where s.wallet = m.wallet and m.ore_base is null and s.first_ore is not null;

-- set a missing baseline (never overwrites one). Called by the play function and the ore-hits job.
create or replace function public.gali_set_base(p_wallet text, p_ore numeric, p_sol_in numeric, p_sol_back numeric)
returns void language sql security definer set search_path to 'public' as $$
  update gali_miners set
    ore_base = coalesce(ore_base, p_ore),
    sol_in_base = coalesce(sol_in_base, p_sol_in),
    sol_back_base = coalesce(sol_back_base, p_sol_back),
    base_at = coalesce(base_at, now())
  where wallet = p_wallet and (ore_base is null or sol_in_base is null or sol_back_base is null);
$$;
revoke all on function public.gali_set_base(text, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function public.gali_set_base(text, numeric, numeric, numeric) to service_role;

-- Gali-wide ORE mined since joining: each wallet's latest snapshot minus its baseline
create or replace function public.gali_ore_total()
returns table(miners bigint, ore numeric) language sql stable security definer set search_path to 'public' as $$
  select count(*), coalesce(sum(greatest(0, t.m - g.ore_base)), 0)
  from (select wallet, max(ore_close) as m from gali_miner_days where ore_close is not null group by wallet) t
  join gali_miners g on g.wallet = t.wallet and g.ore_base is not null
$$;
