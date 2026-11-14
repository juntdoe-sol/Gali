-- Every top-up of the autopilot fee wallet (the executor that pays the network fee on autopilot sends).
-- The owner sends it from the admin page with their own wallet; the team function checks the transfer on chain
-- before it writes a row, so a row is always a real transfer. No key is kept on the server.
drop table if exists public.gali_fee_topups;
create table public.gali_fee_topups (
  id bigint generated always as identity primary key,
  at timestamptz not null,
  recorded_at timestamptz not null default now(),
  from_wallet text not null,
  to_wallet text not null,
  lamports bigint not null check (lamports > 0),
  from_before bigint,
  fee_before bigint,
  fee_after bigint,
  signature text not null unique,
  recorded_by text not null
);
create index gali_fee_topups_at on public.gali_fee_topups (at desc);
alter table public.gali_fee_topups enable row level security;
revoke all on public.gali_fee_topups from anon, authenticated;
comment on table public.gali_fee_topups is 'Autopilot fee wallet top-ups, one row per on-chain transfer, recorded from the admin page by the team function.';
