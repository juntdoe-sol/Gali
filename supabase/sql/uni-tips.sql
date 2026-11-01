-- University of ORE: miners' tips. Signed-in Gali miners share mining tips and strategies; others upvote or report.
-- Writes go through the play function (actions tip, tipvote), which checks the signed pass. The public key can only
-- read tips that are not hidden. A tip with 3 reports hides itself until the team looks at it (set hidden = false
-- to bring it back, or delete it).
create table if not exists gali_uni_tips (
  id bigint generated always as identity primary key,
  wallet text not null,
  name text not null,
  body text not null check (char_length(body) between 8 and 200),
  ups int not null default 0,
  reports int not null default 0,
  hidden boolean not null default false,
  at timestamptz not null default now()
);
create index if not exists gali_uni_tips_wallet_at on gali_uni_tips (wallet, at desc);
create index if not exists gali_uni_tips_rank on gali_uni_tips (hidden, ups desc, at desc);

create table if not exists gali_uni_tip_votes (
  tip_id bigint not null references gali_uni_tips (id) on delete cascade,
  wallet text not null,
  kind text not null check (kind in ('up', 'report')),
  at timestamptz not null default now(),
  primary key (tip_id, wallet, kind)
);

alter table gali_uni_tips enable row level security;
alter table gali_uni_tip_votes enable row level security;
drop policy if exists "read shown tips" on gali_uni_tips;
create policy "read shown tips" on gali_uni_tips for select to anon, authenticated using (not hidden);
-- votes stay private: the counts on the tip are what the app shows

-- one vote: count it once, and hide the tip at 3 reports. Returns false if this wallet already did it.
create or replace function gali_tip_vote(p_tip bigint, p_wallet text, p_kind text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  insert into gali_uni_tip_votes (tip_id, wallet, kind) values (p_tip, p_wallet, p_kind) on conflict do nothing;
  if not found then return false; end if;
  if p_kind = 'up' then
    update gali_uni_tips set ups = ups + 1 where id = p_tip;
  else
    update gali_uni_tips set reports = reports + 1, hidden = hidden or reports + 1 >= 3 where id = p_tip;
  end if;
  return true;
end $$;
revoke all on function gali_tip_vote(bigint, text, text) from public, anon, authenticated;
