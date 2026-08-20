create table if not exists public.rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  count int not null default 0
);

alter table public.rate_limits enable row level security;

create or replace function public.check_rate_limit(p_key text, p_max_requests int, p_window_seconds int)
returns boolean
language plpgsql
as $$
declare
  v_count int;
begin
  insert into public.rate_limits (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
  set
    count = case
      when public.rate_limits.window_start < now() - (p_window_seconds || ' seconds')::interval
        then 1
      else public.rate_limits.count + 1
    end,
    window_start = case
      when public.rate_limits.window_start < now() - (p_window_seconds || ' seconds')::interval
        then now()
      else public.rate_limits.window_start
    end
  returning count into v_count;

  return v_count <= p_max_requests;
end;
$$;
