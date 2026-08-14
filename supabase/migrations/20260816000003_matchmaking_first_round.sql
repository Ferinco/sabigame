drop function if exists public.matchmaking_try_pair(uuid, text);

create or replace function public.matchmaking_try_pair(p_guest_id uuid, p_category text)
returns table (match_id uuid, opponent_id uuid, first_round_id uuid)
language plpgsql
as $$
declare
  v_opponent uuid;
  v_match_id uuid;
  v_question_id uuid;
  v_question_text text;
  v_options text[];
  v_first_round_id uuid;
begin
  delete from public.matchmaking_queue where guest_id = p_guest_id;

  select mq.guest_id into v_opponent
  from public.matchmaking_queue mq
  where mq.category = p_category
  order by mq.joined_at asc
  for update skip locked
  limit 1;

  if v_opponent is not null then
    delete from public.matchmaking_queue where guest_id = v_opponent;

    insert into public.matches (category, player_1_id, player_2_id, started_at)
    values (p_category, v_opponent, p_guest_id, now())
    returning id into v_match_id;

    select q.id, q.question, q.options
    into v_question_id, v_question_text, v_options
    from public.questions q
    where q.category = p_category
    order by random()
    limit 1;

    insert into public.match_rounds (match_id, question_id, question_text, options, started_at)
    values (v_match_id, v_question_id, v_question_text, v_options, now())
    returning id into v_first_round_id;

    return query select v_match_id, v_opponent, v_first_round_id;
  else
    insert into public.matchmaking_queue (guest_id, category, joined_at)
    values (p_guest_id, p_category, now());

    return query select null::uuid, null::uuid, null::uuid;
  end if;
end;
$$;
