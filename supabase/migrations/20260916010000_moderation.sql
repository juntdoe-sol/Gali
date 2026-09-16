-- Chat moderation: hidden messages and muted wallets. Only the chat-admin edge function writes these.
alter table public.messages add column if not exists hidden boolean not null default false;

create table if not exists public.muted_wallets (
  wallet text primary key,
  reason text,
  muted_by text not null,
  created_at timestamptz not null default now()
);
alter table public.muted_wallets enable row level security;
-- no policies: only the service role (edge functions) can read or write

-- replace the read policy so hidden messages never reach the app
drop policy if exists "anyone can read chat" on public.messages;
create policy "anyone can read visible chat" on public.messages for select using (hidden = false);
