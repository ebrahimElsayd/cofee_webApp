alter table public.order_items
  add column if not exists session_id uuid references public.table_sessions(id) on delete cascade,
  add column if not exists cafe_id uuid references public.cafes(id) on delete restrict;

update public.order_items i
set session_id = o.session_id,
    cafe_id = o.cafe_id
from public.orders o
where o.id = i.order_id
  and (i.session_id is null or i.cafe_id is null);

alter table public.order_items alter column session_id set not null;
alter table public.order_items alter column cafe_id set not null;
create index if not exists order_items_session_status_idx on public.order_items(session_id, status);
create index if not exists order_items_cafe_created_idx on public.order_items(cafe_id, created_at desc);

create or replace function public.set_order_item_scope()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  select o.session_id, o.cafe_id into new.session_id, new.cafe_id
  from public.orders o where o.id = new.order_id;
  if new.session_id is null or new.cafe_id is null then
    raise exception 'Order item parent order is invalid';
  end if;
  return new;
end;
$$;

drop trigger if exists order_items_set_scope on public.order_items;
create trigger order_items_set_scope
before insert or update of order_id on public.order_items
for each row execute function public.set_order_item_scope();

create or replace function public.sync_parent_order_status_from_items()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_current text; v_next text;
begin
  select status into v_current from public.orders where id = new.order_id for update;
  if v_current in ('completed','cancelled') then return new; end if;

  select case
    when bool_and(status = 'cancelled') then 'cancelled'
    when bool_and(status in ('served','cancelled')) and bool_or(status = 'served') then 'served'
    when bool_and(status in ('ready','served','cancelled')) and bool_or(status = 'ready') then 'ready'
    when bool_or(status in ('preparing','ready','served')) then 'preparing'
    else 'received'
  end into v_next
  from public.order_items where order_id = new.order_id;

  if v_next is distinct from v_current then
    update public.orders set status = v_next, updated_at = now() where id = new.order_id;
    insert into public.order_status_history(order_id, from_status, to_status, changed_by)
    values (new.order_id, v_current, v_next, auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists order_items_sync_parent_status on public.order_items;
create trigger order_items_sync_parent_status
after update of status on public.order_items
for each row when (old.status is distinct from new.status)
execute function public.sync_parent_order_status_from_items();

create or replace function public.manager_set_order_item_status(p_order_item_id uuid, p_status text, p_note text default null)
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
  if v_order.status in ('completed','cancelled') then
    raise exception 'Order is terminal: %', v_order.status using errcode = '22023';
  end if;
  if p_status = v_item.status then return v_order; end if;
  if v_item.status in ('served','cancelled') then
    raise exception 'Item is terminal: %', v_item.status using errcode = '22023';
  end if;
  if p_status = 'served' and v_item.status <> 'ready' then
    raise exception 'Invalid item transition: % -> %', v_item.status, p_status using errcode = '22023';
  end if;

  update public.order_items set
    status = p_status,
    notes = coalesce(nullif(p_note,''), notes),
    ready_at = case when p_status = 'ready' then now() else null end,
    served_at = case when p_status = 'served' then now() else null end
  where id = p_order_item_id;
  insert into public.item_status_history(order_item_id, from_status, to_status, changed_by)
  values (p_order_item_id, v_item.status, p_status, auth.uid());
  return (select o from public.orders o where o.id = v_item.order_id);
end;
$$;

create or replace function public.manager_set_order_status(p_order_id uuid, p_status text)
returns public.orders language plpgsql security invoker set search_path = public
as $$
declare v_order public.orders;
begin
  if p_status not in ('received','preparing','ready','served','completed','cancelled') then
    raise exception 'Invalid order status: %', p_status using errcode = '22023';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order % was not found', p_order_id using errcode = 'P0002'; end if;
  if p_status = v_order.status then return v_order; end if;
  if v_order.status in ('completed','cancelled') then
    raise exception 'Order is terminal: %', v_order.status using errcode = '22023';
  end if;
  if v_order.status = 'served' and p_status <> 'completed' then
    raise exception 'Invalid order transition: % -> %', v_order.status, p_status using errcode = '22023';
  end if;
  if p_status = 'served' and v_order.status <> 'ready' then
    raise exception 'Invalid order transition: % -> %', v_order.status, p_status using errcode = '22023';
  end if;

  if p_status in ('received','preparing','ready') then
    update public.order_items set status = p_status,
      ready_at = case when p_status = 'ready' then now() else null end,
      served_at = null
    where order_id = p_order_id and status not in ('served','cancelled');
  elsif p_status in ('served','completed') then
    update public.order_items set status = 'served', served_at = coalesce(served_at, now())
    where order_id = p_order_id and status <> 'cancelled';
  elsif p_status = 'cancelled' then
    update public.order_items set status = 'cancelled'
    where order_id = p_order_id and status <> 'served';
  end if;

  update public.orders set status = p_status,
    closed_at = case when p_status in ('completed','cancelled') then coalesce(closed_at, now()) else null end,
    updated_at = now()
  where id = p_order_id;
  insert into public.order_status_history(order_id, from_status, to_status, changed_by)
  values (p_order_id, v_order.status, p_status, auth.uid());
  return (select o from public.orders o where o.id = p_order_id);
end;
$$;

revoke all on function public.manager_set_order_item_status(uuid,text,text) from public;
revoke all on function public.manager_set_order_status(uuid,text) from public;
grant execute on function public.manager_set_order_item_status(uuid,text,text) to authenticated;
grant execute on function public.manager_set_order_status(uuid,text) to authenticated;

alter table public.order_items replica identity full;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='order_items') then
    alter publication supabase_realtime add table public.order_items;
  end if;
end $$;
