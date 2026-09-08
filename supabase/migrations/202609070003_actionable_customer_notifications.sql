-- Customer notifications are actionable only: ready item or explicit cashier alert.
create or replace function public.notify_order_status_changed()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_cafe_id uuid;
begin
  if new.status = old.status or new.status <> 'ready' then return new; end if;
  select ct.cafe_id into v_cafe_id
  from public.table_sessions ts join public.cafe_tables ct on ct.id = ts.table_id
  where ts.id = new.session_id;
  insert into public.notifications(session_id, cafe_id, order_id, type, title, body, event_key)
  values (new.session_id, v_cafe_id, new.id, 'order_status', 'الطلب جاهز', 'طلبك جاهز للاستلام.', 'order:' || new.id || ':ready')
  on conflict (event_key) do nothing;
  return new;
end;
$$;

create or replace function public.notify_order_item_status_changed()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_session_id uuid; v_cafe_id uuid;
begin
  if new.status <> 'ready' or new.status = old.status then return new; end if;
  select o.session_id, ct.cafe_id into v_session_id, v_cafe_id
  from public.orders o
  join public.table_sessions ts on ts.id = o.session_id
  join public.cafe_tables ct on ct.id = ts.table_id
  where o.id = new.order_id;
  insert into public.notifications(session_id, cafe_id, order_id, order_item_id, type, title, body, event_key, is_read)
  values (v_session_id, v_cafe_id, new.order_id, new.id, 'customer_alert', 'مشروبك جاهز', new.product_name || ' جاهز للاستلام.', 'item:' || new.id, false)
  on conflict (event_key) do update set
    session_id = excluded.session_id, cafe_id = excluded.cafe_id,
    order_id = excluded.order_id, order_item_id = excluded.order_item_id,
    type = excluded.type, title = excluded.title, body = excluded.body,
    is_read = false, created_at = now();
  return new;
end;
$$;

revoke all on function public.notify_order_status_changed() from public;
revoke all on function public.notify_order_item_status_changed() from public;
