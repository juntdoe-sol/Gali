-- Run the autopilot executor every minute. Each run plays rounds for about 50 seconds.
-- Before running this, set the two values below (Project Settings, then Edge Functions has the URL):
--   <PROJECT_REF>   your Supabase project ref (the part before .supabase.co)
--   <CRON_SECRET>   the same random string you set with: supabase secrets set CRON_SECRET=...
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('gali-autopilot') where exists (select 1 from cron.job where jobname = 'gali-autopilot');
select cron.schedule(
  'gali-autopilot',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/autopilot',
    headers := jsonb_build_object('content-type', 'application/json', 'x-cron-secret', '<CRON_SECRET>'),
    body := '{}'::jsonb,
    timeout_milliseconds := 58000
  );
  $$
);
