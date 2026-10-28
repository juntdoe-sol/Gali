-- Gali arcade ledger. The arcade house (Bounded function `games`) records each round's result once and
-- every transfer it makes, so a round can never be settled twice with different results and no transfer
-- is ever sent twice. Run once in the Supabase SQL Editor. Only the service role can touch these tables.

create table if not exists public.arcade_rounds (
  key text primary key,                 -- '<game><token><round>', e.g. 'to123456'
  token text not null check (token in ('o', 's')),
  round bigint not null,
  result jsonb not null,                -- what settle returns to players (outcome, bets, pays, secret, seed)
  created_at timestamptz not null default now()
);

create table if not exists public.arcade_sends (
  label text primary key,               -- one transfer batch; never reused
  round_key text,                       -- null for sweeps
  token text not null check (token in ('o', 's')),
  items jsonb not null,                 -- [{"to": "<token account>", "amount": "<raw units>"}]
  pre jsonb not null default '[]',      -- [{"ata","owner"}]: token accounts to open first (revenue wallet only)
  memo text not null,
  state text not null default 'new' check (state in ('new', 'sending', 'paid', 'failed', 'split')),
  tx text,                              -- signed transaction (base64), kept so a resend uses the same bytes
  sig text,
  last_valid bigint,                    -- block height after which tx can no longer land
  attempts int not null default 0,
  error text,
  lease_until timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists arcade_sends_open on public.arcade_sends (token) where state <> 'paid' and state <> 'split';

alter table public.arcade_rounds enable row level security;
alter table public.arcade_sends enable row level security;
revoke all on public.arcade_rounds, public.arcade_sends from anon, authenticated;

-- Token units the house still owes (transfers recorded but not yet confirmed paid).
create or replace function public.arcade_owed(p_token text)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum((i->>'amount')::numeric), 0)
  from arcade_sends s, jsonb_array_elements(s.items) i
  where s.token = p_token and s.state in ('new', 'sending', 'failed');
$$;

-- Stores a round's result and its transfers once. The first caller wins; later callers get the stored result.
-- p_need > 0 asks for a bankroll check: refuses (returns null) when the house balance minus what it already
-- owes is below p_need. One lock per token makes the check and the insert atomic across tables.
create or replace function public.arcade_store(p_key text, p_token text, p_round bigint, p_result jsonb, p_sends jsonb, p_need numeric, p_balance numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('gali-arcade-' || p_token));
  select result into v from arcade_rounds where key = p_key;
  if v is not null then return v; end if;
  if p_need > 0 and p_balance - arcade_owed(p_token) < p_need then return null; end if;
  insert into arcade_rounds (key, token, round, result) values (p_key, p_token, p_round, p_result);
  insert into arcade_sends (label, round_key, token, items, pre, memo)
  select s->>'label', p_key, p_token, s->'items', coalesce(s->'pre', '[]'::jsonb), s->>'memo'
  from jsonb_array_elements(p_sends) s
  on conflict (label) do nothing;
  return p_result;
end $$;

-- Takes a short lease on one transfer so two settle calls never work on it at once. Returns the row or nothing.
create or replace function public.arcade_lease(p_label text, p_secs int)
returns setof public.arcade_sends language sql security definer set search_path = public as $$
  update arcade_sends set lease_until = now() + make_interval(secs => p_secs), updated_at = now()
  where label = p_label and state not in ('paid', 'split') and (lease_until is null or lease_until < now())
  returning *;
$$;

-- Records a sweep or other one-off transfer that has no round.
create or replace function public.arcade_add_send(p_label text, p_token text, p_items jsonb, p_pre jsonb, p_memo text, p_need numeric, p_balance numeric)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('gali-arcade-' || p_token));
  if exists (select 1 from arcade_sends where label = p_label) then return true; end if;
  if p_need > 0 and p_balance - arcade_owed(p_token) < p_need then return false; end if;
  insert into arcade_sends (label, token, items, pre, memo) values (p_label, p_token, p_items, p_pre, p_memo);
  return true;
end $$;

revoke all on function public.arcade_owed(text), public.arcade_store(text, text, bigint, jsonb, jsonb, numeric, numeric),
  public.arcade_lease(text, int), public.arcade_add_send(text, text, jsonb, jsonb, text, numeric, numeric) from public, anon, authenticated;
grant execute on function public.arcade_owed(text), public.arcade_store(text, text, bigint, jsonb, jsonb, numeric, numeric),
  public.arcade_lease(text, int), public.arcade_add_send(text, text, jsonb, jsonb, text, numeric, numeric) to service_role;
