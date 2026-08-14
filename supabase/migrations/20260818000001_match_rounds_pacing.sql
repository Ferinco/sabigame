truncate table public.match_rounds, public.match_results, public.matches, public.matchmaking_queue cascade;

alter table public.match_rounds
  add column if not exists round_number smallint not null default 1,
  add column if not exists expires_at timestamptz not null default (now() + interval '5 seconds');

alter table public.match_rounds drop constraint if exists match_rounds_match_id_round_number_key;
alter table public.match_rounds add constraint match_rounds_match_id_round_number_key unique (match_id, round_number);
