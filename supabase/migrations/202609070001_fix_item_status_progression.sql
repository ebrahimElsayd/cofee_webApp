-- Allow independent item progression without rolling back the parent order.
-- Backward transitions remain rejected; a direct Ready selection is treated as
-- a forward transition for the item and keeps the order aggregate monotonic.
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
  v_order public.orders;
  v_next text;
  v_current_rank int;
  v_target_rank int;
begin
  if p_status not in ('received','preparing','ready','served','cancelled') then
    raise exception 'Invalid item status: %', p_status using errcode = '22023';
  end if;

  select * into v_item from public.order_items where id = p_order_item_id for update;
  if not found then
    raise exception 'Order item % was not found', p_order_item_id using errcode = 'P0002';
  end if;

  select * into v_order from public.orders where id = v_item.order_id for update;
  if p_status = v_item.status then
    return v_order;
  end if;

  if p_status = 'cancelled' then
    if v_item.status not in ('received','preparing','ready') then
      raise exception 'Invalid item transition: % -> %', v_item.status, p_status using errcode = '22023';
    end if;
  else
    v_current_rank := case v_item.status when 'received' then 0 when 'preparing' then 1 when 'ready' then 2 when 'served' then 3 else -1 end;
    v_target_rank := case p_status when 'received' then 0 when 'preparing' then 1 when 'ready' then 2 when 'served' then 3 else -1 end;
    if v_target_rank <= v_current_rank then
      raise exception 'Invalid item transition: % -> %', v_item.status, p_status using errcode = '22023';
    end if;
  end if;

  update public.order_items
  set status = p_status,
      notes = coalesce(nullif(p_note,''), notes),
      ready_at = case when p_status = 'ready' then coalesce(ready_at, now()) else ready_at end,
      served_at = case when p_status = 'served' then coalesce(served_at, now()) else served_at end
  where id = p_order_item_id;

  select case
    when bool_and(status = 'cancelled') then 'cancelled'
    when bool_and(status in ('served','completed')) then 'served'
    when bool_and(status in ('ready','served','completed')) then 'ready'
    when bool_or(status in ('preparing','ready','served','completed')) then 'preparing'
    else 'received'
  end into v_next
  from public.order_items where order_id = v_item.order_id;

  -- The order aggregate may stay at its current state while individual items
  -- progress independently; it must never move backward.
  if v_next <> v_order.status and (
    (v_order.status = 'received' and v_next in ('preparing','cancelled')) or
    (v_order.status = 'preparing' and v_next in ('ready','cancelled')) or
    (v_order.status = 'ready' and v_next = 'served') or
    (v_order.status = 'served' and v_next = 'completed')
  ) then
    update public.orders
    set status = v_next,
        updated_at = now()
    where id = v_order.id;
    insert into public.order_status_history(order_id, from_status, to_status, changed_by)
    values (v_order.id, v_order.status, v_next, auth.uid());
  end if;

  insert into public.item_status_history(order_item_id, from_status, to_status, changed_by)
  values (p_order_item_id, v_item.status, p_status, auth.uid());

  return (select o from public.orders o where o.id = v_order.id);
end;
$$;

revoke all on function public.manager_set_order_item_status(uuid,text,text) from public;
grant execute on function public.manager_set_order_item_status(uuid,text,text) to authenticated;
