create table if not exists public.matchmaking_queue (
  guest_id uuid primary key,
  category text not null check (category in ('football', 'general_knowledge')),
  joined_at timestamptz not null default now()
);

create index if not exists matchmaking_queue_category_idx on public.matchmaking_queue (category, joined_at);

alter table public.matchmaking_queue enable row level security;
