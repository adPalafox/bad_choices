create extension if not exists pgcrypto;

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_session_id text not null,
  status text not null check (status in ('lobby', 'active', 'ended')),
  scenario_pack text not null,
  phase text not null check (phase in ('lobby', 'voting', 'reveal', 'ended')),
  round integer not null default 0,
  current_node_id text,
  pending_node_id text,
  phase_deadline timestamptz,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  session_id text not null,
  nickname text not null,
  is_host boolean not null default false,
  connected boolean not null default true,
  joined_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  round integer not null,
  node_id text not null,
  selected_choice_id text not null,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists votes_one_per_round_node
  on public.votes (room_id, player_id, round, node_id);

create table if not exists public.game_events (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round integer not null,
  node_id text not null,
  prompt text not null,
  selected_choice_id text not null,
  selected_choice_label text not null,
  next_node_id text not null,
  result_text text not null,
  resolution_type text not null default 'majority',
  resolution_label text not null default 'Majority decided',
  vote_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists game_events_one_per_round
  on public.game_events (room_id, round);

alter table public.rooms enable row level security;
alter table public.players enable row level security;
alter table public.votes enable row level security;
alter table public.game_events enable row level security;

drop policy if exists "anon can read rooms" on public.rooms;
create policy "anon can read rooms"
  on public.rooms for select
  to anon
  using (true);

drop policy if exists "anon can read players" on public.players;
create policy "anon can read players"
  on public.players for select
  to anon
  using (true);

drop policy if exists "anon can read votes" on public.votes;
create policy "anon can read votes"
  on public.votes for select
  to anon
  using (true);

drop policy if exists "anon can read game events" on public.game_events;
create policy "anon can read game events"
  on public.game_events for select
  to anon
  using (true);

alter table public.rooms replica identity full;
alter table public.players replica identity full;
alter table public.votes replica identity full;
alter table public.game_events replica identity full;

alter publication supabase_realtime add table public.rooms;
alter publication supabase_realtime add table public.players;
alter publication supabase_realtime add table public.votes;
alter publication supabase_realtime add table public.game_events;
