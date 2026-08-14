drop function if exists public.submit_answer(uuid, uuid, int);

create table if not exists public.round_answers (
  round_id uuid not null references public.match_rounds (id),
  player_id uuid not null,
  answer_index smallint not null,
  is_correct boolean not null,
  answered_at timestamptz not null default now(),
  primary key (round_id, player_id)
);

create index if not exists round_answers_round_id_idx on public.round_answers (round_id);

alter table public.round_answers enable row level security;

alter table public.match_rounds
  drop column if exists winner_guest_id,
  drop column if exists answered_at,
  add column if not exists resolved_at timestamptz;

create or replace function public.resolve_round(p_round_id uuid)
returns table (match_ended boolean, next_round_id uuid)
language plpgsql
as $$
declare
  v_match_id uuid;
  v_round_number smallint;
  v_resolved_at timestamptz;
  v_points smallint[] := array[10, 8, 7, 6];
  v_rank int := 1;
  rec record;
  v_match_ended boolean;
  v_next_round_id uuid;
begin
  select mr.match_id, mr.round_number
  into v_match_id, v_round_number
  from public.match_rounds mr
  where mr.id = p_round_id;

  if v_match_id is null then
    raise exception 'round not found';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_match_id::text)::bigint);

  select resolved_at into v_resolved_at from public.match_rounds where id = p_round_id;
  if v_resolved_at is not null then
    return query select false, null::uuid;
    return;
  end if;

  for rec in
    select player_id from public.round_answers
    where round_id = p_round_id and is_correct = true
    order by answered_at asc
  loop
    if v_rank <= array_length(v_points, 1) then
      update public.match_results
      set score = score + v_points[v_rank]
      where match_id = v_match_id and player_id = rec.player_id;
    end if;
    v_rank := v_rank + 1;
  end loop;

  update public.match_rounds set resolved_at = now() where id = p_round_id;

  select a.match_ended, a.next_round_id into v_match_ended, v_next_round_id
  from public.advance_match_round(v_match_id, v_round_number) a;

  return query select v_match_ended, v_next_round_id;
end;
$$;

create or replace function public.submit_answer(p_round_id uuid, p_guest_id uuid, p_answer_index int)
returns table (
  correct boolean,
  recorded boolean,
  match_ended boolean,
  next_round_id uuid
)
language plpgsql
as $$
declare
  v_match_id uuid;
  v_correct_index smallint;
  v_resolved_at timestamptz;
  v_correct boolean;
  v_rows int;
  v_recorded boolean := false;
  v_match_ended boolean := false;
  v_next_round_id uuid;
  v_answered_count int;
  v_participant_count int;
begin
  select mr.match_id, q.correct_answer_index, mr.resolved_at
  into v_match_id, v_correct_index, v_resolved_at
  from public.match_rounds mr
  join public.questions q on q.id = mr.question_id
  where mr.id = p_round_id;

  if v_match_id is null then
    raise exception 'round not found';
  end if;

  v_correct := (p_answer_index = v_correct_index);

  if v_resolved_at is not null then
    return query select v_correct, false, false, null::uuid;
    return;
  end if;

  insert into public.round_answers (round_id, player_id, answer_index, is_correct)
  values (p_round_id, p_guest_id, p_answer_index, v_correct)
  on conflict (round_id, player_id) do nothing;

  get diagnostics v_rows = row_count;
  v_recorded := v_rows > 0;

  if v_recorded then
    select count(*) into v_answered_count from public.round_answers where round_id = p_round_id;
    select count(*) into v_participant_count from public.match_results where match_id = v_match_id;

    if v_answered_count >= v_participant_count then
      select r.match_ended, r.next_round_id into v_match_ended, v_next_round_id
      from public.resolve_round(p_round_id) r;
    end if;
  end if;

  return query select v_correct, v_recorded, v_match_ended, v_next_round_id;
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
  v_expires_at timestamptz;
  v_resolved_at timestamptz;
begin
  select expires_at, resolved_at into v_expires_at, v_resolved_at
  from public.match_rounds
  where id = p_round_id;

  if v_expires_at is null then
    raise exception 'round not found';
  end if;

  if v_resolved_at is not null then
    return query select false, null::uuid;
    return;
  end if;

  if now() < v_expires_at then
    return query select false, null::uuid;
    return;
  end if;

  return query select r.match_ended, r.next_round_id from public.resolve_round(p_round_id) r;
end;
$$;
