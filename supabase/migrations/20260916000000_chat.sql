-- Miners chat. Anyone can read; only the chat-post edge function (service role) can write.
create table if not exists public.messages (
  id bigserial primary key,
  room text not null default 'global',
  wallet text not null,
  name text not null,
  level int not null default 1,
  kind text not null default 'msg' check (kind in ('msg', 'tip')),
  body text not null check (char_length(body) between 1 and 280),
  tip_to text,
  tip_amount numeric,
  tip_sig text unique,
  created_at timestamptz not null default now()
);

create index if not exists messages_room_id on public.messages (room, id desc);
create index if not exists messages_wallet_time on public.messages (wallet, created_at desc);

alter table public.messages enable row level security;

drop policy if exists "anyone can read chat" on public.messages;
create policy "anyone can read chat" on public.messages for select using (true);
-- no insert/update/delete policies: writes go through the edge function only
