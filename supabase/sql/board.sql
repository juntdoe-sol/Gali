-- The docs notice board (docs.gali.lol #board): anonymous ideas, replies and up/down votes.
-- Only the `board` edge function (service role) and the admin page (team function) touch these tables.
create table if not exists board_posts (
  id text primary key,
  author_id text not null,
  title text not null check (char_length(title) between 4 and 90),
  body text not null default '' check (char_length(body) <= 600),
  tag text not null default 'idea' check (tag in ('idea','island','lobby','arcade','gear')),
  ip_hash text,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists board_posts_created on board_posts (created_at desc);
create index if not exists board_posts_author on board_posts (author_id, created_at desc);

create table if not exists board_replies (
  id text primary key,
  post_id text not null references board_posts(id) on delete cascade,
  author_id text not null,
  body text not null check (char_length(body) between 1 and 400),
  ip_hash text,
  created_at timestamptz not null default now()
);
create index if not exists board_replies_post on board_replies (post_id, created_at);
create index if not exists board_replies_author on board_replies (author_id, created_at desc);

create table if not exists board_votes (
  post_id text not null references board_posts(id) on delete cascade,
  voter_id text not null,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (post_id, voter_id)
);

alter table board_posts enable row level security;
alter table board_replies enable row level security;
alter table board_votes enable row level security;
