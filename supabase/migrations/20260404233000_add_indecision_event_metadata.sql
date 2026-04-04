alter table public.game_events
  add column if not exists resolution_type text not null default 'majority',
  add column if not exists resolution_label text not null default 'Majority decided';
