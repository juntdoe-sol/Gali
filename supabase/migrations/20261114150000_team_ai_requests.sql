-- "AI content" requests from the admin page: a team member asks for a video or image (announcement, GM post,
-- monthly top players...), Claude makes it on the owner's PC and uploads the result to the gali-content bucket.
-- Written by the team function (requests) and by Claude through the service role (status, results).
create table if not exists public.team_ai_requests (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  created_by text not null,
  kind text not null check (kind in ('video', 'image')),
  purpose text not null check (purpose in ('announcement', 'gm', 'monthly', 'update', 'event', 'other')),
  format text not null default 'square' check (format in ('square', 'portrait', 'wide')),
  language text not null default 'en' check (language in ('en', 'ms', 'both')),
  title text not null check (char_length(title) between 1 and 120),
  brief text not null default '' check (char_length(brief) <= 2000),
  due_on date,
  status text not null default 'new' check (status in ('new', 'making', 'done', 'cancelled', 'failed')),
  result_url text,
  result_note text check (char_length(result_note) <= 1000),
  updated_at timestamptz not null default now()
);
create index if not exists team_ai_requests_created on public.team_ai_requests (created_at desc);
alter table public.team_ai_requests enable row level security;
revoke all on public.team_ai_requests from anon, authenticated;

-- finished files: public, since they are made to be posted
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gali-content', 'gali-content', true, 104857600, array['video/mp4', 'video/webm', 'image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;
