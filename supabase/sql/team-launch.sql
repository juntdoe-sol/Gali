-- The pre-launch checklist in the admin page (Team > Launch): what must be settled before Gali goes public.
-- Costs are rough estimates in USD to plan with, not quotes. Only the team function touches this table.
create table if not exists public.team_launch (
  id         bigint generated always as identity primary key,
  sort       integer not null default 0,
  area       text not null default 'product',
  title      text not null,
  detail     text not null default '',
  priority   text not null default 'must' check (priority in ('must', 'should', 'nice')),
  cost_min   numeric,
  cost_max   numeric,
  cost_kind  text not null default 'once' check (cost_kind in ('once', 'month')),
  cost_note  text not null default '',
  owner      text,
  due_on     date,
  done       boolean not null default false,
  done_by    text,
  done_at    timestamptz,
  created_by text,
  updated_at timestamptz not null default now()
);
alter table public.team_launch enable row level security;
revoke all on table public.team_launch from anon, authenticated;

insert into public.team_launch (sort, area, title, detail, priority, cost_min, cost_max, cost_kind, cost_note, due_on)
select * from (values
  (10,  'deadline', 'Publish Gali on the Solana Mobile dApp Store', 'Needed for the Clock In prizes ($20K): approved and live within 30 days of the winners announcement. Publisher, app and release NFTs, store listing (icon, screenshots, description, video), release APK signed with the production key.', 'must', 0, 50, 'once', 'SOL for the dApp Store NFT mints', date '2026-12-14'),
  (20,  'deadline', 'KYC/KYB with Radiants for the prizes', 'On solanamobile.radiant.nexus (Sumsub). Official contact only from @RadiantsDAO, that site or an @radiant.nexus email.', 'must', 0, 0, 'once', '', null),
  (30,  'deadline', 'Pick the public launch date', 'Agree the date as a team once the must-do items below are close. The dApp Store listing can go live before the public push.', 'must', null, null, 'once', '', null),

  (100, 'legal', 'Register a company to receive funds', 'Needed for KYB, a bank account, contracts and tax. Decide the country (for example a Sdn Bhd) and who the directors are.', 'must', 500, 3000, 'once', 'registration and company secretary; yearly fees extra', null),
  (110, 'legal', 'Legal review of the arcade games and SOL stakes', 'Tunnel Collapse, Gold Rush Pot and Crash Cart take SOL stakes with a house edge, which many countries treat as gambling. Ask a lawyer where Gali can run and whether the arcade should be limited or off at launch.', 'must', 2000, 10000, 'once', 'lawyer fees vary by country', null),
  (120, 'legal', 'Terms of Service and risk notice', 'The docs have a Privacy Policy. Add Terms (risk of loss, fees, eligibility, no guarantees) and a risk notice in the app before the first deposit.', 'must', 0, 1500, 'once', 'free from a template, more with a lawyer', null),
  (130, 'legal', 'Block restricted countries and confirm 18+', 'Block the countries the lawyer flags, and sanctioned ones, from deposits and the arcade. Ask players to confirm they are 18 or over.', 'must', 0, 0, 'once', '', null),
  (140, 'legal', 'Trademark for the Gali name', 'Protects the name and logo in the main markets.', 'nice', 300, 1500, 'once', 'per country', null),

  (200, 'security', 'Security review of Gali''s on-chain program', 'The program holds the pools, treasury and staked SKR. Choose a full audit, or an independent review plus a bug bounty.', 'must', 3000, 30000, 'once', 'audit firms vary a lot', null),
  (210, 'security', 'Move upgrade authority and wallets to a Squads multisig', 'Program upgrade authority, config admin, the fund wallet GAL1… and the revenue wallet, 2 of 3 founders to sign.', 'must', 0, 5, 'once', 'account rent only', null),
  (220, 'security', 'Check every server secret and database rule', 'Rotate keys used in the beta, run the Supabase security advisors, check row level security on every table, remove test wallets and devnet keys.', 'must', 0, 0, 'once', '', null),
  (230, 'security', 'Test the pause switch and set limits on mainnet', 'Pause works, house bankroll and per-bet limits are set, and the autopilot limit (1 SOL in the beta) is decided for launch.', 'must', 0, 0, 'once', '', null),
  (240, 'security', 'Bug bounty', 'A public page with rewards for valid security reports.', 'should', 500, 5000, 'once', 'paid per valid report', null),

  (300, 'infra', 'Paid Solana RPC', 'A Helius or Triton plan sized for launch traffic, with a backup provider.', 'must', 50, 500, 'month', '', null),
  (310, 'infra', 'Supabase Pro plan', 'Backups, more compute and no project pausing.', 'must', 25, 100, 'month', 'Pro plus compute add-on if needed', null),
  (320, 'infra', 'Load test the game server, relay and functions', 'Simulate launch-day players on rounds, chat, the arcade and claims; fix what breaks.', 'must', 0, 0, 'once', '', null),
  (330, 'infra', 'Uptime and error alerts', 'Alerts to the team when the game server, relay, RPC or a function fails.', 'should', 0, 30, 'month', '', null),
  (340, 'infra', 'Back up the Android signing key and EAS credentials', 'Losing the key means the app can never be updated in the stores.', 'must', 0, 0, 'once', '', null),

  (400, 'product', 'Switch the app to mainnet and test with real SOL', 'A mainnet build; each founder deposits a small amount, mines, claims and withdraws.', 'must', 0, 100, 'once', 'test SOL', null),
  (410, 'product', 'Fix every open high-priority beta bug', 'The Bugs tab and the daily bug check are clear of high items.', 'must', 0, 0, 'once', '', null),
  (420, 'product', 'Final fee settings and fee wallet top-up', 'Mining fee 1% in the app (the server still accepts 0.25%), arcade 5%, NFT claim fee. Top up the autopilot fee wallet.', 'must', 0, 200, 'once', 'SOL for transaction fees', null),
  (430, 'product', 'First-time guide and FAQ', 'A short guide in the app and an FAQ in the docs: deposit, mine, claim, risks.', 'should', 0, 0, 'once', '', null),
  (440, 'product', 'Support channel and who answers it', 'Discord or Telegram, who is on duty, a pinned FAQ and a scam warning.', 'should', 0, 0, 'once', '', null),

  (500, 'money', 'Fund the arcade house bankroll', 'Enough SOL for Crash Cart and the pots to pay big wins.', 'must', null, null, 'once', 'the team decides the amount', null),
  (510, 'money', 'Seed the SKR and ORE reward pools', 'Starting rewards so the first players see payouts.', 'should', null, null, 'once', 'the team decides the amount', null),
  (520, 'money', 'Bookkeeping for prizes, revenue and spends', 'One place for income, spends and tax records.', 'should', 0, 50, 'month', 'accounting software', null),

  (600, 'marketing', 'Launch plan: announcement, waitlist email, video, press kit', 'Email the waitlist, a launch thread and video, a press kit for media and KOLs.', 'should', 0, 500, 'once', '', null),
  (610, 'marketing', 'KOL and community campaign', 'Paid and free posts around launch week.', 'should', 1000, 5000, 'once', '', null),
  (620, 'marketing', 'Co-marketing with Solana Mobile and ORE', 'Ask for a feature on the dApp Store and posts from both teams.', 'should', 0, 0, 'once', '', null)
) v(sort, area, title, detail, priority, cost_min, cost_max, cost_kind, cost_note, due_on)
where not exists (select 1 from public.team_launch);
