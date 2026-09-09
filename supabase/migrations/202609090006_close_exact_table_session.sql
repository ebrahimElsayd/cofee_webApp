create or replace function public.manager_close_table_session_by_id(p_session_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_table_id uuid;
  v_cafe_id uuid;
  v_status text;
  v_open_orders integer;
  v_unpaid_orders integer;
begin
  if not public.is_staff_user() then
    raise exception 'Staff access required';
  end if;

  select s.table_id, t.cafe_id, s.status
    into v_table_id, v_cafe_id, v_status
  from public.table_sessions s
  join public.cafe_tables t on t.id = s.table_id
  where s.id = p_session_id
  for update of s, t;

  if v_table_id is null then raise exception 'Table session not found'; end if;
  if v_cafe_id is distinct from public.auth_manager_cafe_id() then
    raise exception 'Table session is outside the active cafe';
  end if;
  if v_status in ('closed', 'cancelled') then return true; end if;

  select count(*) into v_open_orders
  from public.orders
  where session_id = p_session_id
    and status not in ('served', 'completed', 'cancelled');
  if v_open_orders > 0 then
    raise exception 'All orders must be delivered or cancelled before closing the table';
  end if;

  select count(*) into v_unpaid_orders
  from public.orders
  where session_id = p_session_id
    and status <> 'cancelled'
    and payment_status <> 'paid';
  if v_unpaid_orders > 0 then
    raise exception 'The table invoice must be paid before closing';
  end if;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by)
  select id, status, 'completed', auth.uid()
  from public.orders
  where session_id = p_session_id and status = 'served';

  update public.orders
  set status = case when status = 'served' then 'completed' else status end,
      closed_at = coalesce(closed_at, now()),
      updated_at = now()
  where session_id = p_session_id;

  update public.table_sessions
  set status = 'closed', closed_at = now(), closed_by = auth.uid()
  where id = p_session_id;

  update public.cafe_tables t
  set status = 'available'
  where t.id = v_table_id
    and not exists (
      select 1 from public.table_sessions s
      where s.table_id = v_table_id
        and s.id <> p_session_id
        and s.status in ('open', 'ordering', 'payment_pending')
    );

  return true;
end;
$$;

revoke all on function public.manager_close_table_session_by_id(uuid) from public;
grant execute on function public.manager_close_table_session_by_id(uuid) to authenticated;
