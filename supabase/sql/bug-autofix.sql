-- Applied 2026-11-18 (migrations bug_autofix, game_report_bug, bugfix_done_status).
-- In-game bug reports and admin-approved auto-fix (worker: ~/gali-bugfix on the owner's Mac).
alter table beta_bugs add column if not exists fix_status text check (fix_status in ('approved','fixing','shipped','failed','cancelled'));
alter table beta_bugs add column if not exists fix_note text;
alter table beta_bugs add column if not exists fix_approved_by text;
alter table beta_bugs add column if not exists fix_approved_at timestamptz;
alter table beta_bugs add column if not exists fix_started_at timestamptz;
alter table beta_bugs add column if not exists fix_done_at timestamptz;
alter table beta_bugs add column if not exists source text;           -- 'game' for reports from the game
create table if not exists bugfix_worker (id int primary key default 1 check (id = 1), token_hash text not null, updated_at timestamptz not null default now());
alter table bugfix_worker enable row level security;                 -- sha256 of ~/gali-bugfix/token only
-- functions (security definer, see the database for the bodies):
--   game_report_bug(...)            anon: beta_report_bug's checks and limits, then source = 'game'
--   bugfix_claim(p_token)           anon with the worker token: oldest 'approved' bug -> 'fixing' (one at a time, 45 min timeout)
--   bugfix_done(p_token, id, ok, note, fixed_in)  'shipped' + status fixed, or 'failed' + status back to confirmed
-- The admin page approves through the team function (bug-fix-approve / bug-fix-cancel, cap 'release').
