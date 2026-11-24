-- Dropzone X — Supabase schema
-- Paste this whole file into your Supabase project's SQL Editor and run it once.
-- The game server connects with the service-role key (which bypasses RLS);
-- RLS stays enabled with no public policies so the tables are never exposed
-- directly to browsers via the anon key.

create table if not exists public.players (
  id text primary key,
  username text unique not null,
  email text default '',
  password_hash text not null,
  created_at timestamptz not null default now(),
  stats jsonb not null default '{"matches":0,"wins":0,"kills":0,"deaths":0,"top10":0,"damage":0}'::jsonb,
  level int not null default 1,
  xp int not null default 0,
  vbucks int not null default 500,
  skin text not null default 'default',
  owned_skins jsonb not null default '["default"]'::jsonb,
  character text not null default 'recruit',
  owned_characters jsonb not null default '["recruit"]'::jsonb,
  armor text not null default 'standard',
  owned_armors jsonb not null default '["standard"]'::jsonb,
  guest boolean not null default false
);

-- Safe upgrade for projects that ran an earlier version of this schema:
alter table public.players add column if not exists guest boolean not null default false;

create table if not exists public.matches (
  id bigint generated always as identity primary key,
  user_id text not null,
  placement int not null,
  kills int not null default 0,
  damage int not null default 0,
  won boolean not null default false,
  total_players int not null default 24,
  at timestamptz not null default now()
);

create index if not exists matches_user_idx on public.matches (user_id);
create index if not exists matches_at_idx on public.matches (at desc);

alter table public.players enable row level security;
alter table public.matches enable row level security;
-- No policies on purpose: only the server (service-role key) can read/write.
