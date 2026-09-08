create or replace function public.manager_close_table_session(p_cafe_id uuid, p_table_number integer)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_table_id uuid;
  v_session_id uuid;
  v_open_orders integer;
  v_unpaid_orders integer;
begin
  if not public.is_staff_user() then raise exception 'Staff access required'; end if;
  select id into v_table_id from public.cafe_tables where cafe_id = p_cafe_id and table_number = p_table_number for update;
  if v_table_id is null then raise exception 'Table not found'; end if;
  select id into v_session_id from public.table_sessions where table_id = v_table_id and status in ('open','ordering','payment_pending') order by opened_at desc limit 1 for update;
  if v_session_id is null then return true; end if;
  select count(*) into v_open_orders from public.orders where session_id = v_session_id and closed_at is null and status not in ('served','completed','cancelled');
  if v_open_orders > 0 then raise exception 'All orders must be delivered or cancelled before closing the table'; end if;
  select count(*) into v_unpaid_orders from public.orders where session_id = v_session_id and closed_at is null and status not in ('cancelled') and payment_status <> 'paid';
  if v_unpaid_orders > 0 then raise exception 'The table invoice must be paid before closing'; end if;
  update public.orders set closed_at = now(), updated_at = now() where session_id = v_session_id and closed_at is null;
  update public.table_sessions set status = 'closed', closed_at = now(), closed_by = auth.uid() where id = v_session_id;
  update public.cafe_tables set status = 'available' where id = v_table_id;
  return true;
end;
$$;

revoke all on function public.manager_close_table_session(uuid, integer) from public;
grant execute on function public.manager_close_table_session(uuid, integer) to authenticated;
