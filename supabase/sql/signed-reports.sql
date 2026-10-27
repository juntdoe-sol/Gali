-- Signed reports: the public key can no longer write ranks, check-ins or lobby chat directly. Every write now goes
-- through the `play` edge function, which acts only for the wallet that signed in (supabase/functions/play).
-- Run once in the Supabase SQL Editor, after deploying the `play` function. Safe to run again.
-- App builds older than 1.7 stop saving KOs, wins, check-ins and chat history until players update.

/* ---------------- Brawl: rows name wallets now ---------------- */
alter table public.brawl_kos drop constraint if exists brawl_kos_killer_check;
alter table public.brawl_kos drop constraint if exists brawl_kos_victim_check;
alter table public.brawl_kos add constraint brawl_kos_killer_check check (char_length(killer) between 1 and 44);
alter table public.brawl_kos add constraint brawl_kos_victim_check check (char_length(victim) between 1 and 44);
alter table public.brawl_wins drop constraint if exists brawl_wins_winner_check;
alter table public.brawl_wins drop constraint if exists brawl_wins_host_check;
alter table public.brawl_wins add constraint brawl_wins_winner_check check (char_length(winner) between 1 and 44);
alter table public.brawl_wins add constraint brawl_wins_host_check check (char_length(host) between 1 and 44);

drop policy if exists "anyone reports a ko" on public.brawl_kos;
drop policy if exists "anyone reports a win" on public.brawl_wins;
revoke all on public.brawl_kos, public.brawl_wins from anon, authenticated;

-- Limits: one KO per pair per 2 minutes, at most 60 KOs credited to one killer a day;
-- one win per wallet per 60 seconds, at most 60 a day. Extra rows are dropped quietly.
create or replace function public.brawl_ko_gate() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.killer = new.victim then return null; end if;
  if exists (select 1 from brawl_kos where killer = new.killer and victim = new.victim and at > now() - interval '2 minutes') then return null; end if;
  if (select count(*) from brawl_kos where killer = new.killer and at > now() - interval '1 day') >= 60 then return null; end if;
  return new;
end $$;
create or replace function public.brawl_win_gate() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from brawl_wins where winner = new.winner and at > now() - interval '60 seconds') then return null; end if;
  if (select count(*) from brawl_wins where winner = new.winner and at > now() - interval '1 day') >= 60 then return null; end if;
  return new;
end $$;

-- The name shown for a ranks row: a wallet's saved miner name, or the short wallet; older rows kept their name.
create or replace function public.gali_display_name(p_key text) returns text
language sql stable security definer set search_path = public as $$
  select case
    when p_key ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then
      coalesce(nullif((select name from gali_miners where wallet = p_key), ''), left(p_key, 4) || '…' || right(p_key, 4))
    else p_key
  end
$$;

create or replace function public.brawl_ranks_period(p_period text default 'all', p_limit int default 50)
returns table (name text, kos int, wins int, bosses int, points int)
language sql stable security definer set search_path = public as $$
  with s as (select gali_period_start(p_period) as t0),
  k as (
    select killer as who, count(*) as kos from (
      select killer, row_number() over (partition by killer, victim, date_trunc('day', at) order by at) n
      from brawl_kos, s where s.t0 is null or at >= s.t0
    ) x where n <= 3 group by killer
  ), w as (
    select winner as who,
           count(*) filter (where mode not in ('boss', 'waves')) as wins,
           count(*) filter (where mode in ('boss', 'waves')) as bosses
    from brawl_wins, s where s.t0 is null or at >= s.t0 group by winner
  ), r as (
    select coalesce(k.who, w.who) as who, coalesce(k.kos, 0)::int as kos, coalesce(w.wins, 0)::int as wins, coalesce(w.bosses, 0)::int as bosses,
           (coalesce(k.kos, 0) + 3 * coalesce(w.wins, 0) + 2 * coalesce(w.bosses, 0))::int as points
    from k full join w on k.who = w.who
    order by points desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  )
  select gali_display_name(who), kos, wins, bosses, points from r order by points desc
$$;
grant execute on function public.brawl_ranks_period(text, int) to anon, authenticated;

create or replace view public.brawl_ranks with (security_invoker = false) as
select name, kos, wins, points, bosses from public.brawl_ranks_period('week', 100);
grant select on public.brawl_ranks to anon, authenticated;

/* ---------------- check-ins: only through `play`, only for the signed-in wallet ---------------- */
revoke execute on function public.gali_seen(text, text, int, bigint, bigint) from public, anon, authenticated;
revoke execute on function public.gali_ore_seen(text, numeric) from public, anon, authenticated;
grant execute on function public.gali_seen(text, text, int, bigint, bigint) to service_role;
grant execute on function public.gali_ore_seen(text, numeric) to service_role;

/* ---------------- lobby chat: only through `play`, limits per wallet ---------------- */
drop policy if exists "anyone adds a line" on public.lobby_chat;
revoke insert on public.lobby_chat from anon, authenticated;
create or replace function public.lobby_chat_gate() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.at := now();
  new.hidden := false;
  if new.wallet is null then return null; end if;
  if exists (select 1 from lobby_chat where mid = new.mid) then return null; end if;
  if exists (select 1 from lobby_chat_muted where wallet = new.wallet) then return null; end if;
  if exists (select 1 from lobby_chat where wallet = new.wallet and at > now() - interval '800 milliseconds') then return null; end if;
  if (select count(*) from lobby_chat where wallet = new.wallet and at > now() - interval '1 minute') >= 20 then return null; end if;
  if (select count(*) from lobby_chat where at > now() - interval '1 minute') >= 300 then return null; end if;
  return new;
end $$;
create index if not exists lobby_chat_wallet_at on public.lobby_chat (wallet, at desc);
