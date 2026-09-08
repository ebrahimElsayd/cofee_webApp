-- Prevent direct financial completion through the workflow RPC.
-- Cash settlement updates payment/order state atomically through its own RPC.
create or replace function public.manager_set_order_status(p_order_id uuid, p_status text)
returns public.orders
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order public.orders;
begin
  if p_status not in ('received','preparing','ready','served','completed','cancelled') then
    raise exception 'Invalid order status: %', p_status using errcode = '22023';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;
  if not found then
    raise exception 'Order % was not found', p_order_id using errcode = 'P0002';
  end if;
  if p_status = v_order.status then return v_order; end if;
  if v_order.status in ('completed','cancelled') then
    raise exception 'Order is terminal: %', v_order.status using errcode = '22023';
  end if;
  if p_status = 'completed' and v_order.status <> 'served' then
    raise exception 'Invalid order transition: % -> %', v_order.status, p_status using errcode = '22023';
  end if;
  if v_order.status = 'served' and p_status <> 'completed' then
    raise exception 'Invalid order transition: % -> %', v_order.status, p_status using errcode = '22023';
  end if;
  if p_status = 'served' and v_order.status <> 'ready' then
    raise exception 'Invalid order transition: % -> %', v_order.status, p_status using errcode = '22023';
  end if;

  if p_status in ('received','preparing','ready') then
    update public.order_items
    set status = p_status,
        ready_at = case when p_status = 'ready' then now() else null end,
        served_at = null
    where order_id = p_order_id and status not in ('served','cancelled');
  elsif p_status in ('served','completed') then
    update public.order_items
    set status = 'served', served_at = coalesce(served_at, now())
    where order_id = p_order_id and status <> 'cancelled';
  elsif p_status = 'cancelled' then
    update public.order_items set status = 'cancelled'
    where order_id = p_order_id and status <> 'served';
  end if;

  update public.orders
  set status = p_status,
      closed_at = case when p_status in ('completed','cancelled') then coalesce(closed_at, now()) else null end,
      updated_at = now()
  where id = p_order_id;

  insert into public.order_status_history(order_id, from_status, to_status, changed_by)
  values (p_order_id, v_order.status, p_status, auth.uid());
  return (select o from public.orders o where o.id = p_order_id);
end;
$$;

revoke all on function public.manager_set_order_status(uuid, text) from public;
grant execute on function public.manager_set_order_status(uuid, text) to authenticated;
