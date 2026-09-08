-- Cancel an order and all of its items in one authorized transaction.
create or replace function public.manager_cancel_order(
  p_order_id uuid,
  p_reason text default null
)
returns public.orders
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order public.orders;
  v_item public.order_items;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order % was not found', p_order_id using errcode = 'P0002';
  end if;

  if v_order.status <> 'cancelled' then
    update public.orders
    set status = 'cancelled',
        closed_at = coalesce(closed_at, now()),
        updated_at = now()
    where id = p_order_id;

    for v_item in
      select * from public.order_items where order_id = p_order_id for update
    loop
      if v_item.status <> 'cancelled' then
        update public.order_items
        set status = 'cancelled',
            notes = coalesce(v_reason, notes, 'Cancelled by staff')
        where id = v_item.id;

        insert into public.item_status_history (order_item_id, from_status, to_status, changed_by)
        values (v_item.id, v_item.status, 'cancelled', auth.uid());
      end if;
    end loop;

    insert into public.order_status_history (order_id, from_status, to_status, changed_by)
    values (p_order_id, v_order.status, 'cancelled', auth.uid());
  end if;

  select * into v_order from public.orders where id = p_order_id;
  return v_order;
end;
$$;

revoke all on function public.manager_cancel_order(uuid, text) from public;
grant execute on function public.manager_cancel_order(uuid, text) to authenticated;
