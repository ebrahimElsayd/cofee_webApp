-- Keep item state consistent whenever an order is delivered/completed.
create or replace function public.manager_set_order_status(p_order_id uuid, p_status text)
returns public.orders
language plpgsql
security invoker
set search_path = public
as $$
declare v_order public.orders;
begin
  if p_status not in ('received','preparing','ready','served','completed','cancelled') then
    raise exception 'Invalid order status: %', p_status using errcode = '22023';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order % was not found', p_order_id using errcode = 'P0002'; end if;
  if not ((v_order.status = 'received' and p_status in ('preparing','cancelled'))
      or (v_order.status = 'preparing' and p_status in ('ready','cancelled'))
      or (v_order.status = 'ready' and p_status = 'served')
      or (v_order.status = 'served' and p_status = 'completed')) then
    raise exception 'Invalid order transition: % -> %', v_order.status, p_status using errcode = '22023';
  end if;

  if p_status in ('served','completed') then
    insert into public.item_status_history(order_item_id, from_status, to_status, changed_by)
    select id, status, 'served', auth.uid()
    from public.order_items
    where order_id = p_order_id and status not in ('served','cancelled');
    update public.order_items
    set status = 'served', served_at = coalesce(served_at, now())
    where order_id = p_order_id and status not in ('served','cancelled');
  end if;

  update public.orders
  set status = p_status,
      closed_at = case when p_status in ('completed','cancelled') then coalesce(closed_at, now()) else closed_at end,
      updated_at = now()
  where id = p_order_id;
  insert into public.order_status_history(order_id, from_status, to_status, changed_by)
  values (p_order_id, v_order.status, p_status, auth.uid());
  return (select o from public.orders o where o.id = p_order_id);
end;
$$;

revoke all on function public.manager_set_order_status(uuid,text) from public;
grant execute on function public.manager_set_order_status(uuid,text) to authenticated;

-- Repair already-delivered orders whose item rows were left behind at Ready.
insert into public.item_status_history(order_item_id, from_status, to_status, changed_by)
select i.id, i.status, 'served', null
from public.order_items i
join public.orders o on o.id = i.order_id
where o.status in ('served','completed') and i.status not in ('served','cancelled');

update public.order_items i
set status = 'served', served_at = coalesce(served_at, now())
from public.orders o
where o.id = i.order_id
  and o.status in ('served','completed')
  and i.status not in ('served','cancelled');
