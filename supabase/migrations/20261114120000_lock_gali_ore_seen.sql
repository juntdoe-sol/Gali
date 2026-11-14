-- ORE check-ins only through the play function, which reads the wallet's ORE on chain.
-- ranks-periods.sql had granted this to anon/authenticated again after signed-reports.sql revoked it,
-- so anyone could set any named miner's ORE (up to 100M) and fake the ORE ranks and totals.
revoke execute on function public.gali_ore_seen(text, numeric) from public, anon, authenticated;
grant execute on function public.gali_ore_seen(text, numeric) to service_role;
