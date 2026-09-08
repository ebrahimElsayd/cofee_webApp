-- Keep one notification row per order item and update it through the lifecycle.
create or replace function public.notify_order_item_status_changed()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_session_id uuid; v_cafe_id uuid; v_title text; v_body text;
begin
  if new.status = old.status then return new; end if;
  select o.session_id, ct.cafe_id into v_session_id, v_cafe_id
  from public.orders o
  join public.table_sessions ts on ts.id = o.session_id
  join public.cafe_tables ct on ct.id = ts.table_id
  where o.id = new.order_id;

  if new.status not in ('preparing','ready','served','cancelled') then return new; end if;
  v_title := case new.status
    when 'preparing' then 'بدأ تحضير مشروبك'
    when 'ready' then 'مشروبك جاهز'
    when 'served' then 'تم تقديم مشروبك'
    else 'تم إلغاء مشروبك'
  end;
  v_body := case new.status
    when 'preparing' then new.product_name || ' قيد التحضير الآن.'
    when 'ready' then new.product_name || ' جاهز للاستلام.'
    when 'served' then new.product_name || ' تم تقديمه.'
    else new.product_name || ' تم إلغاؤه.'
  end;

  insert into public.notifications(
    session_id, cafe_id, order_id, order_item_id, type, title, body, event_key, is_read
  ) values (
    v_session_id, v_cafe_id, new.order_id, new.id, 'order_status', v_title, v_body,
    'item:' || new.id, false
  )
  on conflict (event_key) do update set
    session_id = excluded.session_id,
    cafe_id = excluded.cafe_id,
    order_id = excluded.order_id,
    order_item_id = excluded.order_item_id,
    type = excluded.type,
    title = excluded.title,
    body = excluded.body,
    is_read = false,
    created_at = now();
  return new;
end;
$$;