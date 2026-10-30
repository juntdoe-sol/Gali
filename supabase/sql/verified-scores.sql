-- Verified scores: the boards stop trusting XP and points sent by the app. Run once in the Supabase SQL Editor,
-- after signed-reports.sql and after deploying the new `play` and `autopilot` functions. Safe to run again.
--
-- From now on a wallet's board XP and points are:
--   legacy  what it had when this file first ran, frozen (it was reported by the app, so it never grows again)
--   rounds  every live ORE round the server scored itself from ORE's own accounts (gali_rounds)
--   bonus   XP from fights, quests, moles and the like, at most 100 a report and 600 a day (Malaysia time)
-- The day, week, month and year boards count gains only, so they are fully verified from the first day.

alter table public.gali_miners add column if not exists legacy_xp bigint;
alter table public.gali_miners add column if not exists legacy_points bigint;
alter table public.gali_miners add column if not exists bonus_xp bigint not null default 0;
alter table public.gali_miners add column if not exists bonus_day date;
alter table public.gali_miners add column if not exists bonus_today int not null default 0;
-- freeze what every existing wallet had; wallets that arrive later start from 0
update public.gali_miners set legacy_xp = xp, legacy_points = points where legacy_xp is null;
create or replace function public.gali_miners_new_legacy() returns trigger language plpgsql as $$
begin
  new.legacy_xp := coalesce(new.legacy_xp, 0);
  new.legacy_points := coalesce(new.legacy_points, 0);
  return new;
end $$;
drop trigger if exists gali_miners_new_legacy on public.gali_miners;
create trigger gali_miners_new_legacy before insert on public.gali_miners for each row execute function public.gali_miners_new_legacy();

create table if not exists public.gali_rounds (
  wallet text not null references public.gali_miners (wallet) on delete cascade,
  round_id bigint not null,
  covered int not null check (covered between 1 and 25),
  won boolean not null,
  motherlode boolean not null,
  points bigint not null check (points between 0 and 20000),
  xp int not null check (xp between 0 and 100),
  at timestamptz not null default now(),
  primary key (wallet, round_id)
);
alter table public.gali_rounds enable row level security;
revoke all on public.gali_rounds from anon, authenticated;

/* ---------------- the totals, always worked out on the server ---------------- */
create or replace function public.gali_level_of(p_xp bigint) returns int language sql immutable as $$
  -- the largest level L with 100 * (L - 1) * L / 2 <= xp (app/src/game/constants.ts levelFromXp)
  select least(200, greatest(1, floor((1 + sqrt(1 + 8 * greatest(p_xp, 0) / 100.0)) / 2)::int))
$$;

create or replace function public.gali_recompute(p_wallet text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_xp bigint;
  v_pts bigint;
begin
  select coalesce(m.legacy_xp, 0) + m.bonus_xp + coalesce(sum(r.xp), 0),
         coalesce(m.legacy_points, 0) + coalesce(sum(r.points), 0)
    into v_xp, v_pts
  from gali_miners m left join gali_rounds r on r.wallet = m.wallet
  where m.wallet = p_wallet
  group by m.wallet, m.legacy_xp, m.bonus_xp, m.legacy_points;
  if v_xp is null then return; end if;
  v_xp := least(v_xp, 50000000);
  v_pts := least(v_pts, 500000000);
  update gali_miners set xp = v_xp, points = v_pts, level = gali_level_of(v_xp), seen = now() where wallet = p_wallet;
  -- the day's marks for the period boards (open = first of the day, close = highest)
  insert into gali_miner_days as d (wallet, day, xp_open, xp_close, pts_open, pts_close)
  values (p_wallet, gali_today(), v_xp, v_xp, v_pts, v_pts)
  on conflict (wallet, day) do update set
    xp_open = coalesce(d.xp_open, excluded.xp_open),
    pts_open = coalesce(d.pts_open, excluded.pts_open),
    xp_close = greatest(coalesce(d.xp_close, 0), excluded.xp_close),
    pts_close = greatest(coalesce(d.pts_close, 0), excluded.pts_close);
end $$;

-- Check in: the name only. Level, XP and points are the server's own numbers.
create or replace function public.gali_checkin(p_wallet text, p_name text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_wallet is null or p_wallet !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then return; end if;
  insert into gali_miners as m (wallet, name) values (p_wallet, left(coalesce(p_name, ''), 24))
  on conflict (wallet) do update set name = case when excluded.name <> '' then excluded.name else m.name end, seen = now();
  perform gali_recompute(p_wallet);
end $$;

-- The old check-in keeps working for anything still calling it, but its XP and points are ignored.
create or replace function public.gali_seen(p_wallet text, p_name text, p_level int, p_xp bigint, p_points bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform gali_checkin(p_wallet, p_name);
end $$;

-- One live round, scored by the server from ORE's accounts (play and autopilot functions). Each round counts once.
create or replace function public.gali_score_round(p_wallet text, p_round bigint, p_covered int, p_won boolean, p_motherlode boolean, p_points bigint, p_xp int)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_new boolean;
begin
  if p_wallet is null or p_wallet !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then return false; end if;
  insert into gali_miners (wallet) values (p_wallet) on conflict (wallet) do nothing;
  insert into gali_rounds (wallet, round_id, covered, won, motherlode, points, xp)
  values (p_wallet, p_round, p_covered, p_won, p_motherlode, p_points, p_xp)
  on conflict (wallet, round_id) do nothing;
  v_new := found;
  -- the big-hits list in Rounds (ore-hits.sql): the ore-hits job fills in the ORE
  if p_motherlode and p_won then
    insert into ore_hits (round_id, kind, wallet, ore, at, approx) values (p_round, 'motherlode', p_wallet, null, now(), false)
    on conflict (round_id, kind, wallet) do nothing;
  end if;
  if v_new then perform gali_recompute(p_wallet); end if;
  return v_new;
end $$;

-- XP the server cannot see happen (fights, quests, moles): at most 100 a report, 600 a day per wallet.
create or replace function public.gali_bonus_xp(p_wallet text, p_n int) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_add int;
  v_today date := gali_today();
begin
  if p_wallet is null or p_wallet !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then return 0; end if;
  insert into gali_miners (wallet) values (p_wallet) on conflict (wallet) do nothing;
  update gali_miners set bonus_today = 0, bonus_day = v_today where wallet = p_wallet and bonus_day is distinct from v_today;
  select least(greatest(coalesce(p_n, 0), 0), 100, 600 - bonus_today) into v_add from gali_miners where wallet = p_wallet;
  if v_add is null or v_add <= 0 then return 0; end if;
  update gali_miners set bonus_xp = bonus_xp + v_add, bonus_today = bonus_today + v_add where wallet = p_wallet;
  perform gali_recompute(p_wallet);
  return v_add;
end $$;

revoke execute on function public.gali_recompute(text), public.gali_checkin(text, text),
  public.gali_score_round(text, bigint, int, boolean, boolean, bigint, int), public.gali_bonus_xp(text, int),
  public.gali_seen(text, text, int, bigint, bigint) from public, anon, authenticated;
grant execute on function public.gali_recompute(text), public.gali_checkin(text, text),
  public.gali_score_round(text, bigint, int, boolean, boolean, bigint, int), public.gali_bonus_xp(text, int),
  public.gali_seen(text, text, int, bigint, bigint) to service_role;
