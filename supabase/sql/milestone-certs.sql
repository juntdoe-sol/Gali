-- Milestone certificates: Level 10 (one Rare weapon) and Level 20 (one Legendary weapon), each rolled at random
-- from its three when the Gali NFT market opens. Run once in the Supabase SQL editor (after founding-miner.sql).
--
-- milestone_claims: one certificate per wallet per milestone. `reserved` while the miner signs the mint, `minted`
--   once the asset is on chain. Serials count per milestone, in claim order. The level a wallet needs is read from
--   gali_miners.level, which the server works out from verified XP (verified-scores.sql).

create table if not exists public.milestone_claims (
  id bigint generated always as identity primary key,
  wallet text not null,
  kind text not null check (kind in ('lv3', 'lv6', 'lv10', 'lv15', 'lv20', 'lv30')),
  serial int not null,
  asset text not null,
  status text not null default 'reserved' check (status in ('reserved', 'minted')),
  level int not null default 0,
  sig text,
  reserved_at timestamptz not null default now(),
  minted_at timestamptz,
  unique (wallet, kind),
  unique (kind, serial)
);

alter table public.milestone_claims enable row level security;
revoke all on public.milestone_claims from anon, authenticated;
