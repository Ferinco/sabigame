create table if not exists public.guest_sessions (
  anonymous_id uuid primary key,
  nickname text,
  created_at timestamptz not null default now()
);

alter table public.guest_sessions enable row level security;
