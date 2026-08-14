drop function if exists public.matchmaking_try_pair(uuid, text);
drop function if exists public.matchmaking_bot_fallback(uuid);

create or replace function public.advance_match_round(p_match_id uuid, p_current_round_number smallint)
returns table (match_ended boolean, next_round_id uuid)
language plpgsql
as $$
declare
  v_question_count smallint;
  v_category text;
  v_question_duration_ms integer;
  v_next_round_number smallint;
  v_existing_round_id uuid;
  v_question_id uuid;
  v_question_text text;
  v_options text[];
  v_next_round_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext(p_match_id::text)::bigint);

  select question_count, category, question_duration_ms
  into v_question_count, v_category, v_question_duration_ms
  from public.matches
  where id = p_match_id;

  if v_question_count is null then
    raise exception 'match not found';
  end if;

  v_next_round_number := p_current_round_number + 1;

  select id into v_existing_round_id
  from public.match_rounds
  where match_id = p_match_id and round_number = v_next_round_number;

  if v_existing_round_id is not null then
    return query select false, v_existing_round_id;
    return;
  end if;

  if p_current_round_number >= v_question_count then
    update public.matches set ended_at = now() where id = p_match_id and ended_at is null;
    return query select true, null::uuid;
    return;
  end if;

  select q.id, q.question, q.options
  into v_question_id, v_question_text, v_options
  from public.questions q
  where q.category = v_category
    and q.id not in (
      select mr.question_id from public.match_rounds mr where mr.match_id = p_match_id
    )
  order by random()
  limit 1;

  if v_question_id is null then
    update public.matches set ended_at = now() where id = p_match_id and ended_at is null;
    return query select true, null::uuid;
    return;
  end if;

  insert into public.match_rounds (match_id, round_number, question_id, question_text, options, started_at, expires_at)
  values (
    p_match_id,
    v_next_round_number,
    v_question_id,
    v_question_text,
    v_options,
    now(),
    now() + (v_question_duration_ms || ' milliseconds')::interval
  )
  returning id into v_next_round_id;

  return query select false, v_next_round_id;
end;
$$;

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

create or replace function public.submit_answer(p_round_id uuid, p_guest_id uuid, p_answer_index int)
returns table (
  correct boolean,
  claimed boolean,
  match_ended boolean,
  next_round_id uuid
)
language plpgsql
as $$
declare
  v_match_id uuid;
  v_round_number smallint;
  v_correct_index smallint;
  v_rows int;
  v_correct boolean;
  v_claimed boolean := false;
  v_match_ended boolean := false;
  v_next_round_id uuid;
begin
  select mr.match_id, mr.round_number, q.correct_answer_index
  into v_match_id, v_round_number, v_correct_index
  from public.match_rounds mr
  join public.questions q on q.id = mr.question_id
  where mr.id = p_round_id;

  if v_match_id is null then
    raise exception 'round not found';
  end if;

  v_correct := (p_answer_index = v_correct_index);

  if v_correct then
    update public.match_rounds
    set winner_guest_id = p_guest_id, answered_at = now()
    where id = p_round_id and winner_guest_id is null;

    get diagnostics v_rows = row_count;
    v_claimed := v_rows > 0;
  end if;

  if v_claimed then
    update public.match_results
    set score = score + 1
    where match_id = v_match_id and player_id = p_guest_id;

    select a.match_ended, a.next_round_id into v_match_ended, v_next_round_id
    from public.advance_match_round(v_match_id, v_round_number) a;
  end if;

  return query select v_correct, v_claimed, v_match_ended, v_next_round_id;
end;
$$;

create or replace function public.expire_round(p_round_id uuid)
returns table (
  match_ended boolean,
  next_round_id uuid
)
language plpgsql
as $$
declare
  v_match_id uuid;
  v_round_number smallint;
  v_winner uuid;
  v_expires_at timestamptz;
  v_match_ended boolean := false;
  v_next_round_id uuid;
begin
  select mr.match_id, mr.round_number, mr.winner_guest_id, mr.expires_at
  into v_match_id, v_round_number, v_winner, v_expires_at
  from public.match_rounds mr
  where mr.id = p_round_id;

  if v_match_id is null then
    raise exception 'round not found';
  end if;

  if v_winner is not null then
    return query select false, null::uuid;
    return;
  end if;

  if now() < v_expires_at then
    return query select false, null::uuid;
    return;
  end if;

  select a.match_ended, a.next_round_id into v_match_ended, v_next_round_id
  from public.advance_match_round(v_match_id, v_round_number) a;

  return query select v_match_ended, v_next_round_id;
end;
$$;
