-- Guest sessions: one row per anonymous visitor, keyed by the UUID issued
-- via the sabigame_guest_id cookie (see src/lib/guest). Nickname is set
-- once the player enters it on the landing page, so it's nullable here.
create table if not exists public.guest_sessions (
  anonymous_id uuid primary key,
  nickname text,
  created_at timestamptz not null default now()
);

alter table public.guest_sessions enable row level security;

-- Guests aren't Supabase Auth users, so there's no auth.uid() to key
-- policies off of. Reads/writes go through server code using the service
-- role key (bypasses RLS) — no anon/authenticated policies are defined
-- here, so direct client access is denied by default.
