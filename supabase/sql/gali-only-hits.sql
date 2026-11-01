-- Big Hits (and Gali's boards) count only miners who joined Gali: wallets that checked in with a name in the game.
-- Gali's autopilot executor also presses deploy on ORE automations set up elsewhere (ORE's own site), and scoring
-- those used to add the wallet to gali_miners, so a motherlode won on ORE's platform showed up in Gali.
-- Run once in the Supabase SQL Editor. Safe to run again.

-- Score a round only for a wallet that joined Gali; never create a miner from a score.
create or replace function public.gali_score_round(p_wallet text, p_round bigint, p_covered integer, p_won boolean, p_motherlode boolean, p_points bigint, p_xp integer)
returns boolean language plpgsql security definer set search_path to 'public' as $function$
declare
  v_new boolean;
begin
  if p_wallet is null or p_wallet !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then return false; end if;
  if not exists (select 1 from gali_miners where wallet = p_wallet and coalesce(name, '') <> '') then return false; end if;
  insert into gali_rounds (wallet, round_id, covered, won, motherlode, points, xp)
  values (p_wallet, p_round, p_covered, p_won, p_motherlode, p_points, p_xp)
  on conflict (wallet, round_id) do nothing;
  v_new := found;
  if p_motherlode and p_won then
    insert into ore_hits (round_id, kind, wallet, ore, at, approx) values (p_round, 'motherlode', p_wallet, null, now(), false)
    on conflict (round_id, kind, wallet) do nothing;
  end if;
  if v_new then perform gali_recompute(p_wallet); end if;
  return v_new;
end $function$;

-- Big Hits shows Gali miners only.
create or replace function public.gali_ore_hits(p_limit integer default 100)
returns table(round_id bigint, kind text, wallet text, name text, ore numeric, share numeric, motherlode_ore numeric, at timestamptz, approx boolean, sol_in numeric, sol_back numeric, sol_exact boolean)
language sql stable security definer set search_path to 'public' as $function$
  select h.round_id, h.kind, h.wallet, m.name, h.ore, h.share, h.motherlode_ore, h.at, h.approx, h.sol_in, h.sol_back, h.sol_exact
  from ore_hits h join gali_miners m on m.wallet = h.wallet and coalesce(m.name, '') <> ''
  order by h.round_id desc, h.kind, h.ore desc nulls last
  limit least(greatest(p_limit, 1), 500)
$function$;

-- Clear the big hits recorded for wallets that never joined (the miner rows stay: a wallet that connected but has
-- not picked a name yet keeps its row, and counts once it does).
delete from ore_hits h where not exists (select 1 from gali_miners m where m.wallet = h.wallet and coalesce(m.name, '') <> '');
