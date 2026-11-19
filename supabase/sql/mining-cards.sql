-- Gali Mining Cards (app/src/game/miningCards.ts). A card is a one-time code worth a fixed amount of SOL for autopilot
-- mining, plus a fixed free pack (XP now, items booked for the NFT market). Bought in the Market with SKR or ORE
-- (not open yet: no codes exist until it is). Only the play function (service role) reads or writes these tables.
-- Applied 2026-11-19.

create table if not exists public.mining_cards (
  code text primary key check (code ~ '^GALI-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$'),
  value int not null check (value in (10, 25, 50, 75, 100, 250, 500, 1000)),
  sol_lamports bigint not null check (sol_lamports > 0),
  owner text not null,                 -- the wallet that bought it (it can give the code away)
  paid_token text check (paid_token in ('SKR', 'ORE')),
  paid_amount numeric,
  paid_sig text unique,
  bought_at timestamptz not null default now(),
  status text not null default 'unused' check (status in ('unused', 'redeemed')),
  redeemed_by text,
  redeemed_at timestamptz,
  payout_sig text,                     -- Gali's house wallet sending the card's SOL to redeemed_by
  rewards jsonb                        -- the pack as booked at redemption: {xp, items: [{n, rarity}], extras}
);
create index if not exists mining_cards_owner on public.mining_cards (owner) where status = 'unused';
create index if not exists mining_cards_redeemer on public.mining_cards (redeemed_by);
alter table public.mining_cards enable row level security;
revoke all on public.mining_cards from anon, authenticated;

-- the fixed pack of each card (keep in step with CARD_TIERS in app/src/game/miningCards.ts)
create or replace function public.mining_card_pack(p_value int)
 returns jsonb
 language sql
 immutable
as $$
  select case p_value
    when 10 then '{"xp":500,"items":[{"n":1,"rarity":"Common"},{"n":1,"rarity":"Uncommon"}],"extras":[]}'
    when 25 then '{"xp":1500,"items":[{"n":2,"rarity":"Common"},{"n":1,"rarity":"Uncommon"}],"extras":[]}'
    when 50 then '{"xp":3500,"items":[{"n":2,"rarity":"Uncommon"},{"n":1,"rarity":"Rare"}],"extras":[]}'
    when 75 then '{"xp":6000,"items":[{"n":1,"rarity":"Uncommon"},{"n":2,"rarity":"Rare"}],"extras":[]}'
    when 100 then '{"xp":9000,"items":[{"n":3,"rarity":"Rare"}],"extras":["Platinum badge"]}'
    when 250 then '{"xp":25000,"items":[{"n":2,"rarity":"Rare"},{"n":1,"rarity":"Legendary"}],"extras":["Gold name for 30 days"]}'
    when 500 then '{"xp":55000,"items":[{"n":1,"rarity":"Rare"},{"n":2,"rarity":"Legendary"}],"extras":["Gold name for 30 days","Master badge"]}'
    when 1000 then '{"xp":120000,"items":[{"n":3,"rarity":"Legendary"}],"extras":["\"Legend\" title","Gold name for 90 days","Legend card frame"]}'
  end::jsonb
$$;

-- Use a code: marks it redeemed by p_wallet, adds the XP and books the pack. Returns the card, or an error word:
-- 'unknown', 'used'. The SOL payout is a separate step (the payout_sig column), done by Gali's house wallet.
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
  update gali_miners set bonus_xp = coalesce(bonus_xp, 0) + (pack->>'xp')::bigint where wallet = p_wallet;
  perform gali_recompute(p_wallet);
  return jsonb_build_object('value', c.value, 'sol_lamports', c.sol_lamports, 'rewards', pack);
end $function$;

revoke all on function public.mining_card_redeem(text, text) from public, anon, authenticated;
grant execute on function public.mining_card_redeem(text, text) to service_role;
