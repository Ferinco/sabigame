create or replace function public.matchmaking_try_pair(p_guest_id uuid, p_category text)
returns table (match_id uuid, opponent_id uuid)
language plpgsql
as $$
declare
  v_opponent uuid;
  v_match_id uuid;
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

    return query select v_match_id, v_opponent;
  else
    insert into public.matchmaking_queue (guest_id, category, joined_at)
    values (p_guest_id, p_category, now());

    return query select null::uuid, null::uuid;
  end if;
end;
$$;
