-- Question bank for SabiGame trivia matches.
create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('football', 'general_knowledge')),
  question text not null,
  options text[] not null check (array_length(options, 1) = 4),
  correct_answer_index smallint not null check (correct_answer_index between 0 and 3),
  created_at timestamptz not null default now()
);

create index if not exists questions_category_idx on public.questions (category);

alter table public.questions enable row level security;

-- Questions are game content, safe to read for anyone (including anon/guest players).
-- No insert/update/delete policy: writes go through the service role only.
create policy "questions are publicly readable"
  on public.questions
  for select
  using (true);
