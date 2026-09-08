-- Atomic customer table entry. This is SECURITY INVOKER by design so the
-- existing RLS policies remain the authorization boundary.
create or replace function public.customer_resolve_table(
  p_cafe_id uuid,
  p_table_number integer
)
returns table(id uuid, cafe_id uuid, table_number integer)
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_table_number is null or p_table_number < 1 then
    raise exception 'Invalid table number' using errcode = '22023';
  end if;
  return query
  select t.id, t.cafe_id, t.table_number
  from public.cafe_tables t
  where t.table_number = p_table_number
    and (p_cafe_id is null or t.cafe_id = p_cafe_id)
  order by t.cafe_id
  limit 2;
end;
$$;

create or replace function public.customer_open_table_session(p_table_id uuid)
returns table(session_id uuid, guest_id uuid, cafe_id uuid, table_number integer, outcome text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cafe_id uuid;
  v_table_number integer;
  v_session_id uuid;
  v_outcome text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select t.cafe_id, t.table_number into v_cafe_id, v_table_number
  from public.cafe_tables t where t.id = p_table_id for update;
  if not found then raise exception 'Table was not found' using errcode = 'P0002'; end if;

  select s.id into v_session_id
  from public.table_sessions s
  where s.table_id = p_table_id and s.status in ('open', 'ordering', 'payment_pending')
  order by s.opened_at desc
  limit 1
  for update;

  if v_session_id is null then
    insert into public.table_sessions (table_id, status)
    values (p_table_id, 'open')
    returning id into v_session_id;
    v_outcome := 'created';
  else
    v_outcome := 'joined';
  end if;

  insert into public.table_guests (session_id, auth_user_id)
  values (v_session_id, auth.uid())
  on conflict (session_id, auth_user_id) do nothing;

  return query
  select v_session_id, g.id, v_cafe_id, v_table_number, v_outcome
  from public.table_guests g
  where g.session_id = v_session_id and g.auth_user_id = auth.uid();
end;
$$;

revoke all on function public.customer_resolve_table(uuid, integer) from public;
revoke all on function public.customer_open_table_session(uuid) from public;
grant execute on function public.customer_resolve_table(uuid, integer) to authenticated;
grant execute on function public.customer_open_table_session(uuid) to authenticated;
