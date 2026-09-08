-- Customer notifications are signals, not a duplicate order-status history.
drop trigger if exists order_items_notify_status on public.order_items;

create or replace function public.notify_order_status_changed()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_cafe_id uuid;
begin
  if new.status = old.status or new.status <> 'ready' then return new; end if;
  select ct.cafe_id into v_cafe_id
  from public.table_sessions ts join public.cafe_tables ct on ct.id = ts.table_id
  where ts.id = new.session_id;
  insert into public.notifications(session_id,cafe_id,order_id,type,title,body,event_key,is_read)
  values (new.session_id,v_cafe_id,new.id,'order_status','الطلب جاهز','طلبك جاهز للاستلام.','order:' || new.id || ':ready',false)
  on conflict (event_key) do nothing;
  return new;
end;
$$;

revoke all on function public.notify_order_status_changed() from public;
