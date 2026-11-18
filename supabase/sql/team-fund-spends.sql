-- Spending from the fund wallet (GAL1…Mz6): a team member asks, founders (owner + admins) approve,
-- a founder pays from the wallet and pastes the transaction. Read and written only by the team function.
create table if not exists public.team_fund_spends (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  created_by   text not null,
  category     text not null,
  amount_usd   numeric not null check (amount_usd > 0),
  token        text not null default 'USDC' check (token in ('USDC', 'SOL', 'ORE', 'SKR')),
  token_amount numeric not null check (token_amount > 0),
  to_wallet    text not null,
  purpose      text not null,
  link         text,
  status       text not null default 'requested' check (status in ('requested', 'approved', 'rejected', 'cancelled', 'paid')),
  approvals    jsonb not null default '[]'::jsonb,   -- [{wallet, at}]
  decided_by   text,
  decided_at   timestamptz,
  decision_note text,
  tx_sig       text unique,
  paid_at      timestamptz,
  paid_by      text
);
create index if not exists team_fund_spends_created_idx on public.team_fund_spends (created_at desc);
alter table public.team_fund_spends enable row level security;
revoke all on table public.team_fund_spends from anon, authenticated;

-- the budget split and approval limits (the owner changes them in Money > Funds)
insert into public.team_settings (key, value, updated_at)
values ('fund_rules', '{
  "solo": 200, "two": 1000,
  "cats": [
    {"k": "infra",     "label": "Infra",                  "pct": 20, "about": "Servers, RPC, Supabase, EAS, domains"},
    {"k": "marketing", "label": "Marketing",              "pct": 25, "about": "KOLs, giveaways, events, ads"},
    {"k": "dev",       "label": "Dev & audit",            "pct": 20, "about": "Contract audit, tools, freelancers"},
    {"k": "pool",      "label": "Liquidity / reward pool", "pct": 15, "about": "SKR and ORE pools in the game"},
    {"k": "team",      "label": "Team",                   "pct": 10, "about": "Founder pay, by milestone"},
    {"k": "reserve",   "label": "Reserve",                "pct": 10, "about": "Emergencies only, every founder approves"}
  ]
}'::jsonb, now())
on conflict (key) do nothing;
