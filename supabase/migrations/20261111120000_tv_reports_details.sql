-- Daily bug check: the scheduled check writes its full report here; the team function's bug-reports action reads it.
alter table public.tv_reports add column if not exists details jsonb;
comment on column public.tv_reports.details is 'Daily bug check: {commit, text, findings:[{severity,status,area,text}]}. Written by the service role only.';
