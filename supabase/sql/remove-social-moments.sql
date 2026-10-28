-- Removes the old social-moments (Zernio) posting jobs and their log table.
-- Run once in the Supabase SQL Editor. Safe to run again.
select cron.unschedule('gali-moments-motherlode') where exists (select 1 from cron.job where jobname = 'gali-moments-motherlode');
select cron.unschedule('gali-moments-brawl') where exists (select 1 from cron.job where jobname = 'gali-moments-brawl');
drop table if exists public.social_moments;

-- Then, from a terminal in the repo:
--   npx supabase functions delete social-moments
--   npx supabase secrets unset ZERNIO_API_KEY ZERNIO_ACCOUNTS ZERNIO_LIVE MOMENTS_OFF
-- and revoke the API key in the Zernio dashboard.
