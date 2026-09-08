-- Atomic manager mutations for the canonical customer/manager schema.
-- These functions intentionally run as SECURITY INVOKER so staff RLS remains
-- the authorization boundary.

create or replace function public.manager_set_order_status(
  p_order_id uuid,
  p_status text
)
returns public.orders
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order public.orders;
begin
  if p_status not in ('received', 'preparing', 'ready', 'served', 'completed', 'cancelled') then
    raise exception 'Invalid order status: %', p_status using errcode = '22023';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order % was not found', p_order_id using errcode = 'P0002';
  end if;

  update public.orders
  set status = p_status,
      closed_at = case when p_status in ('served', 'completed', 'cancelled') then closed_at else null end,
      updated_at = now()
  where id = p_order_id;

  if p_status in ('ready', 'served', 'cancelled') then
    update public.order_items
    set status = case when p_status = 'ready' then 'ready' when p_status = 'served' then 'served' else 'cancelled' end,
        ready_at = case when p_status = 'ready' then coalesce(ready_at, now()) else ready_at end,
        served_at = case when p_status = 'served' then coalesce(served_at, now()) else served_at end,
        notes = case when p_status = 'cancelled' then coalesce(notes, 'Cancelled by staff') else notes end
    where order_id = p_order_id and (p_status = 'cancelled' or status <> 'cancelled');
  end if;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by)
  values (p_order_id, v_order.status, p_status, auth.uid());

  select * into v_order from public.orders where id = p_order_id;
  return v_order;
end;
$$;

create or replace function public.manager_set_order_item_status(
  p_order_item_id uuid,
  p_status text,
  p_note text default null
)
returns public.orders
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_item public.order_items;
  v_next_order_status text;
  v_order public.orders;
begin
  if p_status not in ('received', 'preparing', 'ready', 'served', 'cancelled') then
    raise exception 'Invalid item status: %', p_status using errcode = '22023';
  end if;

  select * into v_item from public.order_items where id = p_order_item_id for update;
  if not found then
    raise exception 'Order item % was not found', p_order_item_id using errcode = 'P0002';
  end if;

  select * into v_order from public.orders where id = v_item.order_id for update;

  update public.order_items
  set status = p_status,
      notes = case when p_note is not null then p_note else notes end,
      ready_at = case when p_status = 'ready' then coalesce(ready_at, now()) else ready_at end,
      served_at = case when p_status = 'served' then coalesce(served_at, now()) else served_at end
  where id = p_order_item_id;

  select case
    when bool_and(status = 'cancelled') then 'cancelled'
    when bool_and(status in ('served', 'completed')) then 'served'
    when bool_and(status in ('ready', 'served', 'completed')) then 'ready'
    when bool_or(status = 'preparing') then 'preparing'
    else 'received'
  end into v_next_order_status
  from public.order_items
  where order_id = v_item.order_id;

  update public.orders
  set status = v_next_order_status, updated_at = now()
  where id = v_item.order_id;

  insert into public.item_status_history (order_item_id, from_status, to_status, changed_by)
  values (p_order_item_id, v_item.status, p_status, auth.uid());
  insert into public.order_status_history (order_id, from_status, to_status, changed_by)
  values (v_item.order_id, v_order.status, v_next_order_status, auth.uid());

  return v_order;
end;
$$;

create or replace function public.manager_record_cash_payment(
  p_cafe_id uuid,
  p_table_number integer,
  p_received numeric
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_table_id uuid;
  v_session_id uuid;
  v_total numeric(12,2);
  v_change numeric(12,2);
  v_payment_id uuid;
  v_open_orders integer;
begin
  select id into v_table_id
  from public.cafe_tables
  where cafe_id = p_cafe_id and table_number = p_table_number
  for update;
  if not found then raise exception 'Table % was not found', p_table_number using errcode = 'P0002'; end if;

  select id into v_session_id
  from public.table_sessions
  where table_id = v_table_id and status in ('open', 'ordering', 'payment_pending')
  for update;
  if not found then raise exception 'Table % has no active session', p_table_number using errcode = 'P0002'; end if;

  select count(*) into v_open_orders
  from public.orders
  where session_id = v_session_id and status not in ('cancelled', 'served', 'completed');
  if v_open_orders > 0 then raise exception 'All active orders must be delivered before payment' using errcode = '55000'; end if;

  select coalesce(sum(total_amount), 0)::numeric(12,2) into v_total
  from public.orders
  where session_id = v_session_id and status <> 'cancelled' and closed_at is null;
  if v_total <= 0 then raise exception 'There is no payable amount for this session' using errcode = '22023'; end if;
  if p_received < v_total then raise exception 'Received amount is less than the total' using errcode = '22003'; end if;

  if exists (select 1 from public.payments where session_id = v_session_id and status = 'paid') then
    raise exception 'This session is already paid' using errcode = '23505';
  end if;

  v_change := (p_received - v_total)::numeric(12,2);
  insert into public.payments (session_id, amount, method, status, received, change_amount, paid_by, paid_at)
  values (v_session_id, v_total, 'cash', 'paid', p_received, v_change, auth.uid(), now())
  returning id into v_payment_id;

  update public.orders
  set payment_status = 'paid', updated_at = now()
  where session_id = v_session_id and status <> 'cancelled' and closed_at is null;

  update public.table_sessions
  set status = 'payment_pending'
  where id = v_session_id and status in ('open', 'ordering');

  return jsonb_build_object('payment_id', v_payment_id, 'session_id', v_session_id, 'total', v_total, 'received', p_received, 'change', v_change);
end;
$$;

revoke all on function public.manager_set_order_status(uuid, text) from public;
revoke all on function public.manager_set_order_item_status(uuid, text, text) from public;
revoke all on function public.manager_record_cash_payment(uuid, integer, numeric) from public;
grant execute on function public.manager_set_order_status(uuid, text) to authenticated;
grant execute on function public.manager_set_order_item_status(uuid, text, text) to authenticated;
grant execute on function public.manager_record_cash_payment(uuid, integer, numeric) to authenticated;
