alter table public.rooms
  drop constraint if exists rooms_phase_check;

alter table public.rooms
  add constraint rooms_phase_check
  check (phase in ('lobby', 'private_input', 'voting', 'reveal', 'ended'));

create table if not exists public.private_submissions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  round integer not null,
  node_id text not null,
  prompt_key text not null,
  target_player_id uuid not null references public.players(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists private_submissions_one_per_round_node_prompt
  on public.private_submissions (room_id, player_id, round, node_id, prompt_key);

alter table public.game_events
  add column if not exists spotlight_player_id uuid references public.players(id) on delete set null,
  add column if not exists spotlight_label text,
  add column if not exists private_vote_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists instigator_player_ids jsonb not null default '[]'::jsonb,
  add column if not exists private_resolution_type text not null default 'majority',
  add column if not exists consequence_line text not null default '',
  add column if not exists receipt_line text not null default '';

alter table public.private_submissions enable row level security;

drop policy if exists "anon can read private submissions" on public.private_submissions;
create policy "anon can read private submissions"
  on public.private_submissions for select
  to anon
  using (true);

alter table public.private_submissions replica identity full;
alter publication supabase_realtime add table public.private_submissions;
