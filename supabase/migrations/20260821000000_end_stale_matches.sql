create extension if not exists pg_cron;

create or replace function public.end_stale_matches()
returns void
language plpgsql
as $$
declare
  rec record;
begin
  for rec in
    select m.id as match_id, mr.id as round_id
    from public.matches m
    join public.match_rounds mr on mr.match_id = m.id
    where m.ended_at is null
      and mr.resolved_at is null
      and mr.expires_at < now() - interval '60 seconds'
      and mr.round_number = (
        select max(mr2.round_number)
        from public.match_rounds mr2
        where mr2.match_id = m.id
      )
  loop
    update public.match_rounds set resolved_at = now() where id = rec.round_id;
    update public.matches set ended_at = now() where id = rec.match_id;
  end loop;
end;
$$;

select cron.schedule('end-stale-matches', '* * * * *', $$select public.end_stale_matches();$$);
