-- Weekly Brawl ranks. Run once in the Supabase SQL Editor.
-- KOs are reported by the player who was knocked out; wins by the arena host.
-- The public key can only insert rows (with limits) and read the ranking view.

create table if not exists public.brawl_kos (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  killer text not null check (char_length(killer) between 1 and 24),
  victim text not null check (char_length(victim) between 1 and 24),
  scope text not null check (scope in ('lobby', 'island', 'arena'))
);
create table if not exists public.brawl_wins (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  winner text not null check (char_length(winner) between 1 and 24),
  host text not null check (char_length(host) between 1 and 24),
  mode text not null check (mode in ('lms', 'koth', 'boss')),
  players int not null check (players between 2 and 12)
);
create index if not exists brawl_kos_at on public.brawl_kos (at);
create index if not exists brawl_wins_at on public.brawl_wins (at);

-- one KO per pair per 2 minutes, one win per winner per 60 seconds: extra rows are dropped quietly
create or replace function public.brawl_ko_gate() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.killer = new.victim then return null; end if;
  if exists (select 1 from brawl_kos where killer = new.killer and victim = new.victim and at > now() - interval '2 minutes') then return null; end if;
  return new;
end $$;
drop trigger if exists brawl_ko_gate on public.brawl_kos;
create trigger brawl_ko_gate before insert on public.brawl_kos for each row execute function public.brawl_ko_gate();

create or replace function public.brawl_win_gate() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from brawl_wins where winner = new.winner and at > now() - interval '60 seconds') then return null; end if;
  return new;
end $$;
drop trigger if exists brawl_win_gate on public.brawl_wins;
create trigger brawl_win_gate before insert on public.brawl_wins for each row execute function public.brawl_win_gate();

alter table public.brawl_kos enable row level security;
alter table public.brawl_wins enable row level security;
drop policy if exists "anyone reports a ko" on public.brawl_kos;
create policy "anyone reports a ko" on public.brawl_kos for insert to anon, authenticated with check (true);
drop policy if exists "anyone reports a win" on public.brawl_wins;
create policy "anyone reports a win" on public.brawl_wins for insert to anon, authenticated with check (true);
revoke select, update, delete on public.brawl_kos, public.brawl_wins from anon, authenticated;
grant insert on public.brawl_kos, public.brawl_wins to anon, authenticated;

-- the last 7 days: 1 point per KO (each victim counts at most 3 times a day per winner), 3 per win
create or replace view public.brawl_ranks with (security_invoker = false) as
with k as (
  select killer as name, count(*) as kos from (
    select killer, victim, date_trunc('day', at) d, row_number() over (partition by killer, victim, date_trunc('day', at) order by at) n
    from public.brawl_kos where at > now() - interval '7 days'
  ) x where n <= 3 group by killer
), w as (
  select winner as name, count(*) as wins from public.brawl_wins where at > now() - interval '7 days' group by winner
)
select coalesce(k.name, w.name) as name, coalesce(k.kos, 0)::int as kos, coalesce(w.wins, 0)::int as wins,
       (coalesce(k.kos, 0) + 3 * coalesce(w.wins, 0))::int as points
from k full join w on k.name = w.name;
grant select on public.brawl_ranks to anon, authenticated;
