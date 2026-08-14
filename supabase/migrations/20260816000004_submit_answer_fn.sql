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
  v_correct_index smallint;
  v_category text;
  v_started_at timestamptz;
  v_rows int;
  v_correct boolean;
  v_claimed boolean := false;
  v_match_ended boolean := false;
  v_next_round_id uuid;
  v_next_question_id uuid;
  v_next_question_text text;
  v_next_options text[];
begin
  select mr.match_id, q.correct_answer_index
  into v_match_id, v_correct_index
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
    select m.started_at, m.category into v_started_at, v_category
    from public.matches m where m.id = v_match_id;

    if now() >= v_started_at + interval '15 seconds' then
      v_match_ended := true;
      update public.matches set ended_at = now() where id = v_match_id and ended_at is null;
    else
      select q.id, q.question, q.options
      into v_next_question_id, v_next_question_text, v_next_options
      from public.questions q
      where q.category = v_category
        and q.id not in (
          select mr2.question_id from public.match_rounds mr2 where mr2.match_id = v_match_id
        )
      order by random()
      limit 1;

      if v_next_question_id is null then
        v_match_ended := true;
        update public.matches set ended_at = now() where id = v_match_id and ended_at is null;
      else
        insert into public.match_rounds (match_id, question_id, question_text, options, started_at)
        values (v_match_id, v_next_question_id, v_next_question_text, v_next_options, now())
        returning id into v_next_round_id;
      end if;
    end if;
  end if;

  return query select v_correct, v_claimed, v_match_ended, v_next_round_id;
end;
$$;
