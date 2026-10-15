-- Gali miner ranks. Run once in the Supabase SQL Editor (safe to run again).
-- Every Gali player with a wallet checks in here (wallet, name, level, XP, season points).
-- The app reads each listed wallet's lifetime ORE straight from ORE's Miner account on chain,
-- so the "ORE mined" board can't be faked. Level, XP and points come from the app itself.

create table if not exists public.gali_miners (
  wallet text primary key check (wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  name text not null default '' check (char_length(name) <= 24),
  level int not null default 1 check (level between 1 and 200),
  xp bigint not null default 0 check (xp between 0 and 50000000),
  points bigint not null default 0 check (points between 0 and 500000000),
  first_seen timestamptz not null default now(),
  seen timestamptz not null default now()
);
create index if not exists gali_miners_points on public.gali_miners (points desc);
create index if not exists gali_miners_xp on public.gali_miners (xp desc);

-- Check in: XP, level and points only ever go up; at most one update per wallet every 10 seconds.
create or replace function public.gali_seen(p_wallet text, p_name text, p_level int, p_xp bigint, p_points bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_wallet is null or p_wallet !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then return; end if;
  insert into gali_miners as m (wallet, name, level, xp, points)
  values (p_wallet, left(coalesce(p_name, ''), 24), least(greatest(coalesce(p_level, 1), 1), 200),
          least(greatest(coalesce(p_xp, 0), 0), 50000000), least(greatest(coalesce(p_points, 0), 0), 500000000))
  on conflict (wallet) do update set
    name = case when excluded.name <> '' then excluded.name else m.name end,
    level = greatest(m.level, excluded.level),
    xp = greatest(m.xp, excluded.xp),
    points = greatest(m.points, excluded.points),
    seen = now()
  where m.seen < now() - interval '10 seconds';
end $$;

alter table public.gali_miners enable row level security;
drop policy if exists "anyone reads miners" on public.gali_miners;
create policy "anyone reads miners" on public.gali_miners for select to anon, authenticated using (true);
revoke insert, update, delete on public.gali_miners from anon, authenticated;
grant select on public.gali_miners to anon, authenticated;
grant execute on function public.gali_seen(text, text, int, bigint, bigint) to anon, authenticated;
