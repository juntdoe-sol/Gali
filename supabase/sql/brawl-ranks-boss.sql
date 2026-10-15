-- Brawl ranks, update 2: beating the Mole King counts. Run once in the Supabase SQL Editor (safe to run again).
-- Each miner who fought reports their own boss win, so a solo boss fight counts too (players can be 1).
-- Points this week: 1 per KO (each victim at most 3 times a day per winner), 3 per match win, 2 per boss down.

alter table public.brawl_wins drop constraint if exists brawl_wins_players_check;
alter table public.brawl_wins add constraint brawl_wins_players_check check (players between 1 and 12);

create or replace view public.brawl_ranks with (security_invoker = false) as
with k as (
  select killer as name, count(*) as kos from (
    select killer, victim, date_trunc('day', at) d, row_number() over (partition by killer, victim, date_trunc('day', at) order by at) n
    from public.brawl_kos where at > now() - interval '7 days'
  ) x where n <= 3 group by killer
), w as (
  select winner as name,
         count(*) filter (where mode <> 'boss') as wins,
         count(*) filter (where mode = 'boss') as bosses
  from public.brawl_wins where at > now() - interval '7 days' group by winner
)
select coalesce(k.name, w.name) as name, coalesce(k.kos, 0)::int as kos, coalesce(w.wins, 0)::int as wins,
       (coalesce(k.kos, 0) + 3 * coalesce(w.wins, 0) + 2 * coalesce(w.bosses, 0))::int as points,
       coalesce(w.bosses, 0)::int as bosses
from k full join w on k.name = w.name;
grant select on public.brawl_ranks to anon, authenticated;
