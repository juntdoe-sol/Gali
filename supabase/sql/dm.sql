-- Direct messages between players. Run once in the Supabase SQL Editor (the same project as lobby_chat).
-- Only the `dm` edge function (service role) reads and writes these tables: the public key can't touch
-- them at all, so a player's messages are only ever shown to the two wallets in the conversation.
-- Messages are kept 30 days.

create table if not exists public.dms (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  sender text not null check (sender ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  recipient text not null check (recipient ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  sender_name text not null default '' check (char_length(sender_name) <= 14),
  kind text not null default 'msg' check (kind in ('msg', 'tip')),
  body text not null check (char_length(body) between 1 and 280),
  tip_token text check (tip_token is null or tip_token in ('SOL', 'ORE', 'SKR')),
  tip_amount numeric,
  tip_sig text unique,
  read_at timestamptz,
  check (sender <> recipient)
);
create index if not exists dms_recipient_id on public.dms (recipient, id desc);
create index if not exists dms_sender_id on public.dms (sender, id desc);

-- A player who blocked another: the blocked one's messages are refused.
create table if not exists public.dm_blocks (
  wallet text not null,
  blocked text not null,
  at timestamptz not null default now(),
  primary key (wallet, blocked)
);

alter table public.dms enable row level security;
alter table public.dm_blocks enable row level security;
revoke all on public.dms from anon, authenticated;
revoke all on public.dm_blocks from anon, authenticated;

-- Messages older than 30 days are deleted every night at 04:17 Malaysia time (20:17 UTC).
create extension if not exists pg_cron;
select cron.unschedule('gali-dm-cleanup') where exists (select 1 from cron.job where jobname = 'gali-dm-cleanup');
select cron.schedule('gali-dm-cleanup', '17 20 * * *', $$ delete from public.dms where at < now() - interval '30 days' $$);

-- Moderation, from the SQL Editor:
--   recent messages:  select id, at, sender, recipient, body from public.dms order by id desc limit 50;
--   remove one:       delete from public.dms where id = <id>;
