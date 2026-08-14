create table if not exists public.match_rounds (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id),
  question_id uuid not null references public.questions (id),
  question_text text not null,
  options text[] not null,
  started_at timestamptz not null default now(),
  winner_guest_id uuid,
  answered_at timestamptz
);

create index if not exists match_rounds_match_id_idx on public.match_rounds (match_id, started_at);

alter table public.match_rounds enable row level security;

create policy "match rounds are publicly readable"
  on public.match_rounds
  for select
  using (true);
