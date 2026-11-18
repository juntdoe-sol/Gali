-- Funds Gali has won, applied for or received (hackathon prizes, grants, investment), shown in the
-- admin page's Money > Funds tab. Only the service role (the team function) touches this table.
create table if not exists public.team_funds (
  id          bigint generated always as identity primary key,
  name        text not null,
  source      text not null default '',                -- who pays: organiser, grant program, investor
  kind        text not null default 'prize' check (kind in ('prize', 'grant', 'investment', 'other')),
  amount      numeric not null default 0,
  currency    text not null default 'USD',
  status      text not null default 'won' check (status in ('applied', 'won', 'claiming', 'received', 'lost')),
  expected_on date,
  received_on date,
  to_wallet   text,
  tx_sig      text,
  link        text,
  notes       text not null default '',
  steps       jsonb not null default '[]'::jsonb,      -- [{text, done}] what we must do to claim it
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.team_funds enable row level security;
revoke all on table public.team_funds from anon, authenticated;

-- the two Clock In prizes (claim steps are a starting list: change them once the organisers say what they need)
insert into public.team_funds (name, source, kind, amount, currency, status, notes, steps)
select * from (values
  ('Clock In: 5th place', 'Radiants · Clock In, the Solana Mobile hackathon', 'prize', 10000, 'USD', 'won',
   'Top 5 overall.',
   '[{"text":"Save the winner announcement or email link here","done":false},
     {"text":"Reply to the organisers with what they ask for (team details, payout wallet)","done":false},
     {"text":"Fill in any KYC or tax form they send","done":false},
     {"text":"Confirm the payout token and wallet","done":false},
     {"text":"Payment arrives: paste the transaction and mark it received","done":false}]'::jsonb),
  ('Clock In: ORE Track winner', 'Radiants · Clock In, ORE Track', 'prize', 10000, 'USD', 'won',
   'Winner of the ORE Track.',
   '[{"text":"Save the winner announcement or email link here","done":false},
     {"text":"Reply to the organisers with what they ask for (team details, payout wallet)","done":false},
     {"text":"Fill in any KYC or tax form they send","done":false},
     {"text":"Confirm the payout token and wallet","done":false},
     {"text":"Payment arrives: paste the transaction and mark it received","done":false}]'::jsonb)
) v(name, source, kind, amount, currency, status, notes, steps)
where not exists (select 1 from public.team_funds);
