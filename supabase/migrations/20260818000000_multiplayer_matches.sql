alter table public.matches
  drop column if exists player_1_id,
  drop column if exists player_2_id,
  drop column if exists is_bot_match,
  add column if not exists question_count smallint not null default 10,
  add column if not exists question_duration_ms integer not null default 5000;

create table if not exists public.match_results (
  match_id uuid not null references public.matches (id),
  player_id uuid not null,
  is_bot boolean not null default false,
  score integer not null default 0,
  is_locked boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (match_id, player_id)
);

create index if not exists match_results_match_id_idx on public.match_results (match_id);

alter table public.match_results enable row level security;

create policy "match results are publicly readable"
  on public.match_results
  for select
  using (true);

create policy "matches are publicly readable"
  on public.matches
  for select
  using (true);

alter publication supabase_realtime add table public.matches;
alter publication supabase_realtime add table public.match_results;
