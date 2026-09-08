-- Repair legacy rows that were marked completed by the old payment flow while
-- their table session remained active. Their state must be derived from items.
with active_order_state as (
  select o.id,
    case
      when bool_and(i.status = 'cancelled') then 'cancelled'
      when bool_and(i.status in ('served','cancelled')) and bool_or(i.status = 'served') then 'served'
      when bool_and(i.status in ('ready','served','cancelled')) and bool_or(i.status = 'ready') then 'ready'
      when bool_or(i.status in ('preparing','ready','served')) then 'preparing'
      else 'received'
    end as repaired_status
  from public.orders o
  join public.table_sessions ts on ts.id = o.session_id
  join public.order_items i on i.order_id = o.id
  where ts.status in ('open','ordering','payment_pending')
    and o.status = 'completed'
  group by o.id
)
update public.orders o
set status = s.repaired_status,
    closed_at = null,
    updated_at = now()
from active_order_state s
where o.id = s.id;

create or replace function public.manager_set_order_item_status(
  p_order_item_id uuid,
  p_status text,
  p_note text default null
)
returns public.orders language plpgsql security invoker set search_path = public
as $$
declare v_item public.order_items; v_order public.orders; v_order_id uuid;
begin
  if p_status not in ('received','preparing','ready','served','cancelled') then
    raise exception 'Invalid item status: %', p_status using errcode = '22023';
  end if;

  select order_id into v_order_id from public.order_items where id = p_order_item_id;
  if not found then raise exception 'Order item % was not found', p_order_item_id using errcode = 'P0002'; end if;
  select * into v_order from public.orders where id = v_order_id for update;
  select * into v_item from public.order_items where id = p_order_item_id for update;

  -- served/completed are the persisted equivalents of Delivered.
  if v_order.status in ('served','completed','cancelled') then
    raise exception 'Order is terminal: %', v_order.status using errcode = '22023';
  end if;
  if v_item.status in ('served','cancelled') then
    raise exception 'Item is terminal: %', v_item.status using errcode = '22023';
  end if;
  if p_status = v_item.status then return v_order; end if;
  if p_status = 'served' and v_item.status <> 'ready' then
    raise exception 'Invalid item transition: % -> %', v_item.status, p_status using errcode = '22023';
  end if;

  -- received, preparing and ready are operator-correctable in both directions.
  update public.order_items set
    status = p_status,
    notes = coalesce(nullif(p_note,''), notes),
    ready_at = case when p_status = 'ready' then now() else null end,
    served_at = case when p_status = 'served' then now() else null end
  where id = p_order_item_id;

  insert into public.item_status_history(order_item_id, from_status, to_status, changed_by)
  values (p_order_item_id, v_item.status, p_status, auth.uid());
  return (select o from public.orders o where o.id = v_order_id);
end;
$$;

revoke all on function public.manager_set_order_item_status(uuid,text,text) from public;
grant execute on function public.manager_set_order_item_status(uuid,text,text) to authenticated;
