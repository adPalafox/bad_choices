alter table public.private_submissions
  alter column target_player_id drop not null;

alter table public.private_submissions
  add column if not exists selected_option_id text;

alter table public.game_events
  add column if not exists template_id text not null default 'scapegoat',
  add column if not exists leading_private_option_id text,
  add column if not exists leading_private_option_label text,
  add column if not exists distribution_line text,
  add column if not exists power_holder_player_id uuid references public.players(id) on delete set null,
  add column if not exists power_holder_label text,
  add column if not exists power_altered_outcome boolean not null default false;
