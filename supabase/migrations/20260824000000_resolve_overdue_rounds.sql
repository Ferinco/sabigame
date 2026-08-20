create or replace function public.end_stale_matches()
returns void
language plpgsql
as $$
declare
  rec record;
begin
  for rec in
    select mr.id as round_id
    from public.matches m
    join public.match_rounds mr on mr.match_id = m.id
    where m.ended_at is null
      and mr.resolved_at is null
      and mr.expires_at < now()
      and mr.round_number = (
        select max(mr2.round_number)
        from public.match_rounds mr2
        where mr2.match_id = m.id
      )
  loop
    perform public.resolve_round(rec.round_id);
  end loop;
end;
$$;
