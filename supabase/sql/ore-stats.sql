-- ORE stats panel on desktop ORE Island (app/src/game/oreStats.ts).
--   1. gali_ore_rate: ORE's refining factor, saved once an hour by the ore-rate edge function.
--      The app reads the value from about 24 hours ago to show a miner's refined ORE gained in 24 hours.
--   2. gali_ore_total(): every Gali miner's all-time ORE added up (from gali_miner_days, ranks-periods.sql).
-- Run after ranks-periods.sql. Then deploy the function and schedule it (bottom of this file).

create table if not exists public.gali_ore_rate (
  at timestamptz primary key,
  factor numeric(40, 0) not null check (factor >= 0)
);
alter table public.gali_ore_rate enable row level security;
-- no policies: nobody reads or writes the table directly; the functions below do

-- Only the service role (the edge function) saves. One row per hour; the factor only ever goes up.
create or replace function public.gali_ore_rate_save(p_factor text)
returns void language plpgsql security definer set search_path = public as $$
declare v numeric; v_last numeric;
begin
  if p_factor !~ '^[0-9]{1,40}$' then raise exception 'bad factor'; end if;
  v := p_factor::numeric;
  select factor into v_last from gali_ore_rate order by at desc limit 1;
  if v_last is not null and v < v_last then return; end if;
  insert into gali_ore_rate (at, factor) values (date_trunc('hour', now()), v)
  on conflict (at) do update set factor = greatest(gali_ore_rate.factor, excluded.factor);
  delete from gali_ore_rate where at < now() - interval '14 days';
end $$;
revoke all on function public.gali_ore_rate_save(text) from public, anon, authenticated;
grant execute on function public.gali_ore_rate_save(text) to service_role;

-- The factor saved closest to (and not after) p_hours ago; while the history is younger, the oldest row.
create or replace function public.gali_ore_rate_ago(p_hours int default 24)
returns table (at timestamptz, factor text) language sql stable security definer set search_path = public as $$
  select at, factor::text from (
    (select at, factor from gali_ore_rate where at <= now() - make_interval(hours => least(greatest(p_hours, 1), 168)) order by at desc limit 1)
    union all
    (select at, factor from gali_ore_rate order by at asc limit 1)
  ) x order by at desc limit 1
$$;
grant execute on function public.gali_ore_rate_ago(int) to anon, authenticated;

-- All Gali miners: how many, and their all-time ORE added up (each wallet's highest reading).
create or replace function public.gali_ore_total()
returns table (miners bigint, ore numeric) language sql stable security definer set search_path = public as $$
  select count(*), coalesce(sum(m), 0) from (select wallet, max(ore_close) as m from gali_miner_days where ore_close is not null group by wallet) t
$$;
grant execute on function public.gali_ore_total() to anon, authenticated;

-- Schedule: every hour at minute 7. Replace <PROJECT_REF> and <CRON_SECRET> (the same values as autopilot-cron.sql).
-- First deploy the function:  supabase functions deploy ore-rate --no-verify-jwt
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('gali-ore-rate') where exists (select 1 from cron.job where jobname = 'gali-ore-rate');
select cron.schedule(
  'gali-ore-rate',
  '7 * * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/ore-rate',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);
