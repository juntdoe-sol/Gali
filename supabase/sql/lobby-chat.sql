-- Lobby chat history. Run once in the Supabase SQL Editor.
-- Live chat still travels over realtime; every line is also saved here so a player who
-- opens the app sees the last lines even when nobody else is online.
-- The public key can only add lines (with limits) and read the last 7 days of visible ones.

create table if not exists public.lobby_chat (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  mid text not null unique check (mid ~ '^[a-z0-9-]{4,40}$'),
  sender text not null check (char_length(sender) between 1 and 16),
  name text not null check (char_length(name) between 2 and 14),
  body text not null check (char_length(body) between 1 and 80),
  wallet text check (wallet is null or wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  hidden boolean not null default false
);
create index if not exists lobby_chat_at on public.lobby_chat (at desc);
create index if not exists lobby_chat_sender_at on public.lobby_chat (sender, at desc);

-- Muted wallets: their lines are dropped. Add one with:
--   insert into public.lobby_chat_muted (wallet) values ('<wallet>');
create table if not exists public.lobby_chat_muted (
  wallet text primary key,
  at timestamptz not null default now()
);
alter table public.lobby_chat_muted enable row level security;

-- Limits, enforced by the database: one line per sender per 0.8 s, 20 per sender per minute,
-- 300 for the whole lobby per minute, no repeats, no muted wallets. Extra lines are dropped quietly.
create or replace function public.lobby_chat_gate() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.at := now();
  new.hidden := false;
  if exists (select 1 from lobby_chat where mid = new.mid) then return null; end if;
  if new.wallet is not null and exists (select 1 from lobby_chat_muted where wallet = new.wallet) then return null; end if;
  if exists (select 1 from lobby_chat where sender = new.sender and at > now() - interval '800 milliseconds') then return null; end if;
  if (select count(*) from lobby_chat where sender = new.sender and at > now() - interval '1 minute') >= 20 then return null; end if;
  if (select count(*) from lobby_chat where at > now() - interval '1 minute') >= 300 then return null; end if;
  return new;
end $$;
drop trigger if exists lobby_chat_gate on public.lobby_chat;
create trigger lobby_chat_gate before insert on public.lobby_chat for each row execute function public.lobby_chat_gate();

alter table public.lobby_chat enable row level security;
drop policy if exists "anyone adds a line" on public.lobby_chat;
create policy "anyone adds a line" on public.lobby_chat for insert to anon, authenticated with check (true);
drop policy if exists "anyone reads recent visible lines" on public.lobby_chat;
create policy "anyone reads recent visible lines" on public.lobby_chat for select to anon, authenticated
  using (hidden = false and at > now() - interval '7 days');
revoke all on public.lobby_chat from anon, authenticated;
grant insert (mid, sender, name, body, wallet) on public.lobby_chat to anon, authenticated;
grant select (id, at, mid, sender, name, body) on public.lobby_chat to anon, authenticated;
revoke all on public.lobby_chat_muted from anon, authenticated;

-- Lines older than 7 days are deleted every night at 04:07 Malaysia time (20:07 UTC).
create extension if not exists pg_cron;
select cron.unschedule('gali-lobby-chat-cleanup') where exists (select 1 from cron.job where jobname = 'gali-lobby-chat-cleanup');
select cron.schedule('gali-lobby-chat-cleanup', '7 20 * * *', $$ delete from public.lobby_chat where at < now() - interval '7 days' $$);

-- Moderation, from the SQL Editor:
--   see recent lines:  select id, at, name, wallet, body from public.lobby_chat order by id desc limit 50;
--   hide a line:       update public.lobby_chat set hidden = true where id = <id>;
--   mute a wallet:     insert into public.lobby_chat_muted (wallet) values ('<wallet>');
