create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('football', 'general_knowledge')),
  player_1_id uuid not null,
  player_2_id uuid,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create index if not exists matches_player_1_idx on public.matches (player_1_id);
create index if not exists matches_player_2_idx on public.matches (player_2_id);

alter table public.matches enable row level security;
