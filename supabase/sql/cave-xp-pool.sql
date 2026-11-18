-- Applied 2026-11-18 (migration cave_xp_pool). Cave Run XP has its own daily pool (400), apart from the 600
-- shared by fights, quests and moles; it still lands in bonus_xp. Called by the play function's `cave` action.
alter table gali_miners add column if not exists cave_today int not null default 0;
alter table gali_miners add column if not exists cave_day date;
-- function: public.gali_cave_xp(p_wallet text, p_n integer) returns integer
--   resets cave_today on a new gali_today(), adds least(p_n, 100, 400 - cave_today) to bonus_xp, runs gali_recompute.
--   security definer; execute revoked from public, anon, authenticated (service role only).
