create table if not exists public.profiles (
  id uuid primary key references auth.users (id),
  nickname text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create index if not exists match_results_player_id_idx on public.match_results (player_id);

create or replace view public.leaderboard as
select
  mr.player_id,
  p.nickname,
  sum(mr.score) as total_score,
  count(distinct mr.match_id) as matches_played
from public.match_results mr
join public.profiles p on p.id = mr.player_id
where mr.is_locked = true
group by mr.player_id, p.nickname;
