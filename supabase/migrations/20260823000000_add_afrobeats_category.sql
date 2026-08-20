alter table public.questions
  drop constraint questions_category_check,
  add constraint questions_category_check
    check (category in ('football', 'general_knowledge', 'afrobeats'));

alter table public.matches
  drop constraint matches_category_check,
  add constraint matches_category_check
    check (category in ('football', 'general_knowledge', 'afrobeats'));

alter table public.matchmaking_queue
  drop constraint matchmaking_queue_category_check,
  add constraint matchmaking_queue_category_check
    check (category in ('football', 'general_knowledge', 'afrobeats'));
