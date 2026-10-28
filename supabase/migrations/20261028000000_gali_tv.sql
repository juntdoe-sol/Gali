-- Gali TV: episodes of the pixel cartoon and updates from the team, uploaded from the admin page.
-- Anyone can read published videos; every write goes through the tv-admin edge function (service role).
create table if not exists public.gali_tv_videos (
  id uuid primary key default gen_random_uuid(),
  series text not null check (series in ('cartoon', 'team')),
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '' check (char_length(description) <= 600),
  episode int check (episode is null or episode between 0 and 9999),
  video_path text not null,
  poster_path text,
  duration_s numeric(8, 2),
  width int,
  height int,
  tiktok_url text check (tiktok_url is null or tiktok_url ~ '^https://(www\.|vm\.|vt\.)?tiktok\.com/'),
  published boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists gali_tv_videos_feed on public.gali_tv_videos (published, created_at desc);
alter table public.gali_tv_videos enable row level security;
drop policy if exists "published videos are public" on public.gali_tv_videos;
create policy "published videos are public" on public.gali_tv_videos for select to anon, authenticated using (published);

-- Wallets allowed to manage Gali TV. No policies: only the service role reads it.
create table if not exists public.gali_tv_admins (
  wallet text primary key check (wallet ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  added_at timestamptz not null default now()
);
alter table public.gali_tv_admins enable row level security;

-- Public bucket: the TV page streams videos and reads feed.json straight from the CDN, with no API key.
-- Uploads only through signed URLs from tv-admin; feed.json is rewritten by tv-admin on every change.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gali-tv', 'gali-tv', true, 52428800, array['video/mp4', 'video/webm', 'video/quicktime', 'image/jpeg', 'image/png', 'image/webp', 'application/json'])
on conflict (id) do nothing;
