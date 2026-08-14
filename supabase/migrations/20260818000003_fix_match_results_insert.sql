create or replace function public.matchmaking_try_form_match(p_guest_id uuid, p_category text)
returns table (match_id uuid, first_round_id uuid)
language plpgsql
as $$
declare
  v_match_id uuid;
  v_question_id uuid;
  v_question_text text;
  v_options text[];
  v_first_round_id uuid;
  v_question_duration_ms integer;
  v_claimed_ids uuid[];
begin
  delete from public.matchmaking_queue where guest_id = p_guest_id;
  insert into public.matchmaking_queue (guest_id, category, joined_at)
  values (p_guest_id, p_category, now());

  select array_agg(guest_id) into v_claimed_ids
  from (
    select guest_id from public.matchmaking_queue
    where category = p_category
    order by joined_at asc
    for update skip locked
    limit 4
  ) sub;

  if coalesce(array_length(v_claimed_ids, 1), 0) < 4 then
    return query select null::uuid, null::uuid;
    return;
  end if;

  delete from public.matchmaking_queue where guest_id = any(v_claimed_ids);

  insert into public.matches (category, started_at)
  values (p_category, now())
  returning id, question_duration_ms into v_match_id, v_question_duration_ms;

  insert into public.match_results (match_id, player_id, is_bot)
  select v_match_id, unnest(v_claimed_ids), false;

  select q.id, q.question, q.options
  into v_question_id, v_question_text, v_options
  from public.questions q
  where q.category = p_category
  order by random()
  limit 1;

  insert into public.match_rounds (match_id, round_number, question_id, question_text, options, started_at, expires_at)
  values (v_match_id, 1, v_question_id, v_question_text, v_options, now(), now() + (v_question_duration_ms || ' milliseconds')::interval)
  returning id into v_first_round_id;

  return query select v_match_id, v_first_round_id;
end;
$$;

create or replace function public.matchmaking_bot_fallback(p_guest_id uuid)
returns table (match_id uuid, first_round_id uuid)
language plpgsql
as $$
declare
  v_category text;
  v_joined_at timestamptz;
  v_match_id uuid;
  v_question_id uuid;
  v_question_text text;
  v_options text[];
  v_first_round_id uuid;
  v_question_duration_ms integer;
  v_claimed_ids uuid[];
  v_bot_id uuid;
  i int;
begin
  select category, joined_at into v_category, v_joined_at
  from public.matchmaking_queue
  where guest_id = p_guest_id;

  if v_category is null then
    return query select null::uuid, null::uuid;
    return;
  end if;

  if now() < v_joined_at + interval '15 seconds' then
    return query select null::uuid, null::uuid;
    return;
  end if;

  select array_agg(guest_id) into v_claimed_ids
  from (
    select guest_id from public.matchmaking_queue
    where category = v_category
    order by joined_at asc
    for update skip locked
    limit 4
  ) sub;

  if v_claimed_ids is null or not (p_guest_id = any(v_claimed_ids)) then
    return query select null::uuid, null::uuid;
    return;
  end if;

  delete from public.matchmaking_queue where guest_id = any(v_claimed_ids);

  insert into public.matches (category, started_at)
  values (v_category, now())
  returning id, question_duration_ms into v_match_id, v_question_duration_ms;

  insert into public.match_results (match_id, player_id, is_bot)
  select v_match_id, unnest(v_claimed_ids), false;

  for i in 1..(4 - array_length(v_claimed_ids, 1)) loop
    v_bot_id := gen_random_uuid();
    insert into public.match_results (match_id, player_id, is_bot) values (v_match_id, v_bot_id, true);
  end loop;

  select q.id, q.question, q.options
  into v_question_id, v_question_text, v_options
  from public.questions q
  where q.category = v_category
  order by random()
  limit 1;

  insert into public.match_rounds (match_id, round_number, question_id, question_text, options, started_at, expires_at)
  values (v_match_id, 1, v_question_id, v_question_text, v_options, now(), now() + (v_question_duration_ms || ' milliseconds')::interval)
  returning id into v_first_round_id;

  return query select v_match_id, v_first_round_id;
end;
$$;
