-- Milestone certificates for Levels 3, 6, 15 and 30 (adds to Level 10 and 20). Run once in the Supabase SQL editor.
alter table public.milestone_claims drop constraint if exists milestone_claims_kind_check;
alter table public.milestone_claims add constraint milestone_claims_kind_check check (kind in ('lv3', 'lv6', 'lv10', 'lv15', 'lv20', 'lv30'));
