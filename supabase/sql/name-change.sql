-- Gali names belong to the wallet on the server (gali_miners.name). The first name is free and set at check-in.
-- After that, a rename is free once every 30 days; sooner costs 0.1 SOL, paid to Gali's revenue wallet. The play
-- function checks the payment on chain and calls gali_rename with its signature; each signature counts once.
-- Applied 2026-11-19.

alter table public.gali_miners add column if not exists name_changed_at timestamptz;

create table if not exists public.gali_name_payments (
  sig text primary key,
  wallet text not null,
  lamports bigint not null,
  name text not null,
  created_at timestamptz not null default now()
);
alter table public.gali_name_payments enable row level security;
revoke all on public.gali_name_payments from anon, authenticated;

-- check-in only fills in a missing name: renames go through gali_rename
create or replace function public.gali_checkin(p_wallet text, p_name text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if p_wallet is null or p_wallet !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then return; end if;
  insert into gali_miners as m (wallet, name) values (p_wallet, left(coalesce(p_name, ''), 24))
  on conflict (wallet) do update set name = case when coalesce(m.name, '') = '' and excluded.name <> '' then excluded.name else m.name end, seen = now();
  perform gali_recompute(p_wallet);
end $function$;

-- returns 'ok', 'same', 'pay' (a paid signature is needed), 'used' (that signature already paid for a rename) or 'none'
create or replace function public.gali_rename(p_wallet text, p_name text, p_sig text, p_lamports bigint)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  m gali_miners;
begin
  if p_wallet is null or p_wallet !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' or coalesce(p_name, '') = '' then return 'none'; end if;
  select * into m from gali_miners where wallet = p_wallet for update;
  if not found then
    insert into gali_miners (wallet, name) values (p_wallet, left(p_name, 24));
    return 'ok';
  end if;
  if m.name = p_name then return 'same'; end if;
  -- no name yet: the first one is free and doesn't start the 30 days
  if coalesce(m.name, '') = '' then
    update gali_miners set name = left(p_name, 24) where wallet = p_wallet;
    return 'ok';
  end if;
  if m.name_changed_at is not null and m.name_changed_at > now() - interval '30 days' then
    if p_sig is null then return 'pay'; end if;
    begin
      insert into gali_name_payments (sig, wallet, lamports, name) values (p_sig, p_wallet, p_lamports, left(p_name, 24));
    exception when unique_violation then
      return 'used';
    end;
  end if;
  update gali_miners set name = left(p_name, 24), name_changed_at = now() where wallet = p_wallet;
  return 'ok';
end $function$;

revoke all on function public.gali_rename(text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.gali_rename(text, text, text, bigint) to service_role;
