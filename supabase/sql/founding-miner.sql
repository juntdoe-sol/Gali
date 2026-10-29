-- Founding Miner certificate (closed beta reward) and the Gali NFT storage bucket.
-- Run once in the Supabase SQL editor before deploying the `nft` function.
--
-- founding_miners: a wallet's closed-beta mining, worked out by the `nft` function from the chain (ORE Deploy
--   instructions that name the wallet as authority between the beta start and end). Cached so a wallet is scanned
--   once and then only for new transactions.
-- cert_claims: one certificate per wallet. A row is `reserved` while the miner signs the mint and `minted` once
--   the asset is on chain. Serials are handed out in claim order.

create table if not exists public.founding_miners (
  wallet text primary key,
  rounds int not null default 0,
  round_keys text[] not null default '{}',
  first_at timestamptz,
  last_sig text,
  scanned_at timestamptz not null default now()
);
-- a long history is read over several calls (see supabase/functions/nft scan())
alter table public.founding_miners add column if not exists pass_top text;
alter table public.founding_miners add column if not exists scan_cursor text;
alter table public.founding_miners add column if not exists done boolean not null default false;

create table if not exists public.cert_claims (
  serial int generated always as identity primary key,
  wallet text not null unique,
  asset text not null,
  status text not null default 'reserved' check (status in ('reserved', 'minted')),
  rounds int not null default 0,
  first_at timestamptz,
  sig text,
  reserved_at timestamptz not null default now(),
  minted_at timestamptz
);

-- Only the service role (the `nft` function) reads or writes these.
alter table public.founding_miners enable row level security;
alter table public.cert_claims enable row level security;
revoke all on public.founding_miners from anon, authenticated;
revoke all on public.cert_claims from anon, authenticated;

-- Public bucket for NFT metadata and images (certificate JSON, the certificate GIF, the collection image).
insert into storage.buckets (id, name, public)
values ('gali-nft', 'gali-nft', true)
on conflict (id) do update set public = true;
