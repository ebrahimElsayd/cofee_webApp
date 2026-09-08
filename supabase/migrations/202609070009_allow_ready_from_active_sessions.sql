create or replace function public.manager_set_order_item_status(
  p_order_item_id uuid,
  p_status text,
  p_note text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item public.order_items;
  v_order public.orders;
  v_order_id uuid;
  v_session_status text;
begin
  if p_status not in ('received','preparing','ready','served','cancelled') then
    raise exception 'Invalid item status: %', p_status using errcode = '22023';
  end if;

  select order_id into v_order_id
  from public.order_items where id = p_order_item_id;
  if not found then
    raise exception 'Order item % was not found', p_order_item_id using errcode = 'P0002';
  end if;

  select * into v_order from public.orders where id = v_order_id for update;
  select status into v_session_status from public.table_sessions where id = v_order.session_id;
  select * into v_item from public.order_items where id = p_order_item_id for update;

  if coalesce(auth.jwt()->>'role', '') <> 'service_role' and (
    not public.is_staff_user()
    or public.auth_manager_cafe_id() is distinct from v_order.cafe_id
  ) then
    raise exception 'Not authorized for this cafe' using errcode = '42501';
  end if;

  if v_order.status = 'cancelled' or v_item.status = 'cancelled' then
    raise exception 'Cancelled orders and items cannot be changed' using errcode = '22023';
  end if;
  if p_status = v_item.status then return v_order; end if;

  -- Legacy payment logic could leave an active session with a served/completed
  -- parent and a preparing child. Re-open only that active parent for correction.
  if v_order.status in ('served','completed') then
    if v_session_status not in ('open','ordering','payment_pending') then
      raise exception 'Delivered order belongs to a closed session' using errcode = '22023';
    end if;
    update public.orders
    set status = 'preparing', closed_at = null, updated_at = now()
    where id = v_order_id;
  end if;

  -- Operational stages are freely correctable in either direction.
  if v_item.status in ('received','preparing','ready')
     and p_status in ('received','preparing','ready') then
    null;
  elsif p_status = 'served' and v_item.status = 'ready' then
    null;
  else
    raise exception 'Invalid item transition: % -> %', v_item.status, p_status using errcode = '22023';
  end if;

  update public.order_items
  set status = p_status,
      notes = coalesce(nullif(p_note, ''), notes),
      ready_at = case when p_status = 'ready' then now() else null end,
      served_at = case when p_status = 'served' then now() else null end
  where id = p_order_item_id;

  insert into public.item_status_history(order_item_id, from_status, to_status, changed_by)
  values (p_order_item_id, v_item.status, p_status, auth.uid());

  return (select o from public.orders o where o.id = v_order_id);
end;
$$;

revoke all on function public.manager_set_order_item_status(uuid,text,text) from public;
grant execute on function public.manager_set_order_item_status(uuid,text,text)
  to authenticated, anon, service_role;
