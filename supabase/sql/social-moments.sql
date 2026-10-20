-- Gali social moments: the posting log plus two pg_cron jobs. Run once in the Supabase SQL Editor,
-- after deploying the social-moments function.
-- Replace <CRON_SECRET> with the contents of ~/gali-cron-secret.txt (the same secret autopilot uses).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- One row per moment. The key (e.g. motherlode:61234) stops a moment posting twice.
-- status: sending, draft (saved in Zernio), posted, failed. Delete a failed row to let it try again.
create table if not exists public.social_moments (
  key text primary key,
  kind text not null,
  content text not null,
  status text not null default 'sending',
  zernio_id text,
  error text,
  at timestamptz not null default now()
);
alter table public.social_moments enable row level security;
revoke all on public.social_moments from anon, authenticated;

-- Motherlode check every 2 minutes.
select cron.unschedule('gali-moments-motherlode') where exists (select 1 from cron.job where jobname = 'gali-moments-motherlode');
select cron.schedule(
  'gali-moments-motherlode',
  '*/2 * * * *',
  $$
  select net.http_post(
    url := 'https://rckvfpwtdyvvvjqqlffn.supabase.co/functions/v1/social-moments',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{"job":"motherlode"}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- Brawl top 3 every Sunday 13:00 UTC (9pm Malaysia time).
select cron.unschedule('gali-moments-brawl') where exists (select 1 from cron.job where jobname = 'gali-moments-brawl');
select cron.schedule(
  'gali-moments-brawl',
  '0 13 * * 0',
  $$
  select net.http_post(
    url := 'https://rckvfpwtdyvvvjqqlffn.supabase.co/functions/v1/social-moments',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{"job":"brawl"}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
