alter table public.matches add column if not exists is_bot_match boolean not null default false;

create or replace function public.matchmaking_bot_fallback(p_guest_id uuid)
returns table (match_id uuid, opponent_id uuid, first_round_id uuid)
language plpgsql
as $$
declare
  v_category text;
  v_joined_at timestamptz;
  v_match_id uuid;
  v_bot_id uuid := gen_random_uuid();
  v_question_id uuid;
  v_question_text text;
  v_options text[];
  v_first_round_id uuid;
begin
  select mq.category, mq.joined_at into v_category, v_joined_at
  from public.matchmaking_queue mq
  where mq.guest_id = p_guest_id
  for update skip locked;

  if v_category is null then
    return query select null::uuid, null::uuid, null::uuid;
    return;
  end if;

  if now() < v_joined_at + interval '15 seconds' then
    return query select null::uuid, null::uuid, null::uuid;
    return;
  end if;

  delete from public.matchmaking_queue where guest_id = p_guest_id;

  insert into public.matches (category, player_1_id, player_2_id, started_at, is_bot_match)
  values (v_category, p_guest_id, v_bot_id, now(), true)
  returning id into v_match_id;

  select q.id, q.question, q.options
  into v_question_id, v_question_text, v_options
  from public.questions q
  where q.category = v_category
  order by random()
  limit 1;

  insert into public.match_rounds (match_id, question_id, question_text, options, started_at)
  values (v_match_id, v_question_id, v_question_text, v_options, now())
  returning id into v_first_round_id;

  return query select v_match_id, v_bot_id, v_first_round_id;
end;
$$;
