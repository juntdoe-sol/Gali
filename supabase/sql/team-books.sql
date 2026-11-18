-- Money > Books in the admin page: one ledger of income and spending with USD and MYR values,
-- for the accountant. On-chain records come from the existing tables; this adds the bills paid off chain
-- (card, bank, cash), a daily price cache, and a daily revenue summary. Only the team function uses them.

-- bills and income that never touch a Gali wallet
create table if not exists public.team_ledger (
  id          bigint generated always as identity primary key,
  on_date     date not null,
  kind        text not null check (kind in ('income', 'expense')),
  category    text not null default 'other',
  description text not null,
  amount      numeric not null check (amount > 0),
  currency    text not null default 'MYR' check (currency in ('MYR', 'USD', 'SOL', 'USDC')),
  paid_by     text not null default 'company',   -- 'company', or the member wallet that paid it personally
  receipt     text,
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists team_ledger_date_idx on public.team_ledger (on_date desc);
alter table public.team_ledger enable row level security;
revoke all on table public.team_ledger from anon, authenticated;

-- daily prices: sym 'SOL' = USD per SOL (Kraken daily close), sym 'MYR' = MYR per USD (ECB via Frankfurter)
create table if not exists public.team_prices (
  day   date not null,
  sym   text not null,
  value numeric not null,
  primary key (day, sym)
);
alter table public.team_prices enable row level security;
revoke all on table public.team_prices from anon, authenticated;

-- revenue wallet income summed per day and source (mining, arcade, nft), so the ledger is one row per day
create or replace function public.team_revenue_daily(p_from date, p_to date)
returns table (day date, source text, sol numeric, ore numeric, skr numeric)
language sql stable security definer set search_path = public as $$
  select (at at time zone 'Asia/Kuala_Lumpur')::date, source, sum(sol), sum(ore), sum(skr)
  from team_revenue
  where not failed and source in ('mining', 'arcade', 'nft')
    and (at at time zone 'Asia/Kuala_Lumpur')::date between p_from and p_to
  group by 1, 2 order by 1, 2;
$$;
revoke all on function public.team_revenue_daily(date, date) from public, anon, authenticated;
