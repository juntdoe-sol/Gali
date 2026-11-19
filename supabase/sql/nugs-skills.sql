-- NUGS: Gali's in-game coin (not a crypto token: never bought, sold or withdrawn). A wallet's NUGS are
--   floor(xp / 10) + nugs_bonus - nugs_spent
-- so every XP the server counts (live rounds, fights, quests, cave runs) earns NUGS, players who already have XP have
-- their NUGS from the start, and spending never lowers XP or the level. Fight Club skills are bought with NUGS
-- (app/src/game/brawl2/specials.ts SKILL_INFO; prices kept in step with gali_skill_price below).
-- Applied 2026-11-19.

alter table public.gali_miners add column if not exists nugs_bonus bigint not null default 0;
alter table public.gali_miners add column if not exists nugs_spent bigint not null default 0;

create table if not exists public.gali_skills (
  wallet text not null,
  skill text not null,
  price bigint not null,
  bought_at timestamptz not null default now(),
  primary key (wallet, skill)
);
alter table public.gali_skills enable row level security;
revoke all on public.gali_skills from anon, authenticated;

-- null: not for sale (the six starter skills are free for everyone and never bought)
create or replace function public.gali_skill_price(p_skill text)
 returns bigint
 language sql
 immutable
as $$
  select case p_skill
    when 'grab' then 300
    when 'magnet' then 400
    when 'dynamite' then 600
    when 'geyser' then 800
    when 'cavein' then 1000
    when 'tunnel' then 1500
  end::bigint
$$;

create or replace function public.gali_nugs(p_wallet text)
 returns bigint
 language sql
 stable
 security definer
 set search_path to 'public'
as $$
  select coalesce(floor(xp / 10)::bigint + nugs_bonus - nugs_spent, 0) from gali_miners where wallet = p_wallet
$$;

-- returns 'ok', 'owned', 'unknown' (no such skill for sale) or 'short' (not enough NUGS)
create or replace function public.gali_buy_skill(p_wallet text, p_skill text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  price bigint := gali_skill_price(p_skill);
  m gali_miners;
begin
  if price is null then return 'unknown'; end if;
  select * into m from gali_miners where wallet = p_wallet for update;
  if not found then return 'short'; end if;
  if exists (select 1 from gali_skills where wallet = p_wallet and skill = p_skill) then return 'owned'; end if;
  if floor(m.xp / 10)::bigint + m.nugs_bonus - m.nugs_spent < price then return 'short'; end if;
  insert into gali_skills (wallet, skill, price) values (p_wallet, p_skill, price);
  update gali_miners set nugs_spent = nugs_spent + price where wallet = p_wallet;
  return 'ok';
end $function$;

revoke all on function public.gali_nugs(text) from public, anon, authenticated;
revoke all on function public.gali_buy_skill(text, text) from public, anon, authenticated;
grant execute on function public.gali_nugs(text) to service_role;
grant execute on function public.gali_buy_skill(text, text) to service_role;

-- Mining Cards: each pack also gives NUGS (a tenth of its XP), booked at redemption
create or replace function public.mining_card_pack(p_value int)
 returns jsonb
 language sql
 immutable
as $$
  select case p_value
    when 10 then '{"xp":500,"nugs":50,"items":[{"n":1,"rarity":"Common"},{"n":1,"rarity":"Uncommon"}],"extras":[]}'
    when 25 then '{"xp":1500,"nugs":150,"items":[{"n":2,"rarity":"Common"},{"n":1,"rarity":"Uncommon"}],"extras":[]}'
    when 50 then '{"xp":3500,"nugs":350,"items":[{"n":2,"rarity":"Uncommon"},{"n":1,"rarity":"Rare"}],"extras":[]}'
    when 75 then '{"xp":6000,"nugs":600,"items":[{"n":1,"rarity":"Uncommon"},{"n":2,"rarity":"Rare"}],"extras":[]}'
    when 100 then '{"xp":9000,"nugs":900,"items":[{"n":3,"rarity":"Rare"}],"extras":["Platinum badge"]}'
    when 250 then '{"xp":25000,"nugs":2500,"items":[{"n":2,"rarity":"Rare"},{"n":1,"rarity":"Legendary"}],"extras":["Gold name for 30 days"]}'
    when 500 then '{"xp":55000,"nugs":5500,"items":[{"n":1,"rarity":"Rare"},{"n":2,"rarity":"Legendary"}],"extras":["Gold name for 30 days","Master badge"]}'
    when 1000 then '{"xp":120000,"nugs":12000,"items":[{"n":3,"rarity":"Legendary"}],"extras":["\"Legend\" title","Gold name for 90 days","Legend card frame"]}'
  end::jsonb
$$;

create or replace function public.mining_card_redeem(p_wallet text, p_code text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  c mining_cards;
  pack jsonb;
begin
  if p_wallet is null or p_wallet !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then return jsonb_build_object('error', 'unknown'); end if;
  select * into c from mining_cards where code = p_code for update;
  if not found then return jsonb_build_object('error', 'unknown'); end if;
  if c.status <> 'unused' then return jsonb_build_object('error', 'used'); end if;
  pack := mining_card_pack(c.value);
  update mining_cards set status = 'redeemed', redeemed_by = p_wallet, redeemed_at = now(), rewards = pack where code = p_code;
  insert into gali_miners (wallet, name) values (p_wallet, '') on conflict (wallet) do nothing;
  update gali_miners set bonus_xp = coalesce(bonus_xp, 0) + (pack->>'xp')::bigint,
    nugs_bonus = nugs_bonus + coalesce((pack->>'nugs')::bigint, 0) where wallet = p_wallet;
  perform gali_recompute(p_wallet);
  return jsonb_build_object('value', c.value, 'sol_lamports', c.sol_lamports, 'rewards', pack);
end $function$;
