-- Gali Fightclub: online match results and the Brawl rank (rating + tier). Run once in the Supabase SQL Editor,
-- then deploy the `play` function (it settles matches). Safe to run again.
--
-- How a result counts (anti-cheat): every wallet in an online match reports the finishing order itself, signed in
-- (supabase/functions/play, action `fight`). A match only changes ranks once every listed wallet has reported the
-- same order. One pair of wallets counts at most 5 rated matches a day, so farming a friend or a second account
-- stops early. Bots never count.

create table if not exists public.fc_matches (
  mid text primary key check (char_length(mid) between 6 and 64),
  mode text not null check (mode in ('1v1', 'ffa')),
  players text[] not null,
  at timestamptz not null default now(),
  settled boolean not null default false
);
create table if not exists public.fc_reports (
  mid text not null references public.fc_matches (mid) on delete cascade,
  wallet text not null check (char_length(wallet) between 32 and 44),
  ord text[] not null,
  at timestamptz not null default now(),
  primary key (mid, wallet)
);
create table if not exists public.fc_ratings (
  wallet text primary key check (char_length(wallet) between 32 and 44),
  rating int not null default 1000,
  games int not null default 0,
  wins int not null default 0,
  at timestamptz not null default now()
);
create table if not exists public.fc_results (
  mid text not null,
  wallet text not null,
  place int not null,
  delta int not null,
  rating int not null,
  at timestamptz not null default now(),
  primary key (mid, wallet)
);
create index if not exists fc_results_at on public.fc_results (at);
create index if not exists fc_matches_at on public.fc_matches (at);

alter table public.fc_matches enable row level security;
alter table public.fc_reports enable row level security;
alter table public.fc_ratings enable row level security;
alter table public.fc_results enable row level security;
revoke all on public.fc_matches, public.fc_reports, public.fc_ratings, public.fc_results from anon, authenticated;

/** The tier a rating is in. */
create or replace function public.fc_tier(p_rating int) returns text language sql immutable as $$
  select case
    when p_rating >= 1600 then 'DIAMOND'
    when p_rating >= 1400 then 'GOLD'
    when p_rating >= 1250 then 'SILVER'
    when p_rating >= 1100 then 'IRON'
    else 'COPPER'
  end
$$;

/** The Fightclub board: everyone who played a rated match, highest rating first. */
create or replace function public.fc_ranks(p_limit int default 50)
returns table (wallet text, name text, rating int, tier text, games int, wins int)
language sql stable security definer set search_path = public as $$
  select r.wallet, coalesce(nullif(m.name, ''), left(r.wallet, 4) || '…' || right(r.wallet, 4)), r.rating, fc_tier(r.rating), r.games, r.wins
  from fc_ratings r left join gali_miners m on m.wallet = r.wallet
  where r.games > 0
  order by r.rating desc, r.wins desc, r.at asc
  limit least(greatest(p_limit, 1), 100)
$$;

/** One wallet's rank (any wallet; starting value if it never played). */
create or replace function public.fc_rank_of(p_wallet text)
returns table (rating int, tier text, games int, wins int, place int)
language sql stable security definer set search_path = public as $$
  select coalesce(r.rating, 1000), fc_tier(coalesce(r.rating, 1000)), coalesce(r.games, 0), coalesce(r.wins, 0),
         case when r.games > 0 then (select count(*)::int + 1 from fc_ratings o where o.games > 0 and o.rating > r.rating) else null end
  from (select 1) x left join fc_ratings r on r.wallet = p_wallet
$$;

grant execute on function public.fc_ranks(int), public.fc_rank_of(text), public.fc_tier(int) to anon, authenticated;

/** Rated matches two wallets played together in the last day (the play function skips a pair after 5). */
create or replace function public.fc_pair_count(p_a text, p_b text) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from fc_results x join fc_results y on x.mid = y.mid
  where x.wallet = p_a and y.wallet = p_b and x.at > now() - interval '1 day'
$$;
revoke execute on function public.fc_pair_count(text, text) from public, anon, authenticated;
