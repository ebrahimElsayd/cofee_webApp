-- Persistent cross-app notifications. Realtime delivers them instantly while
-- this table preserves them across refreshes, devices, and closed tabs.
alter table public.notifications add column if not exists cafe_id uuid references public.cafes(id) on delete cascade;
alter table public.notifications add column if not exists order_item_id uuid references public.order_items(id) on delete cascade;
alter table public.notifications add column if not exists event_key text;

create unique index if not exists notifications_event_key_idx
  on public.notifications(event_key);
create index if not exists notifications_session_created_idx
  on public.notifications(session_id, created_at desc);
create index if not exists notifications_cafe_created_idx
  on public.notifications(cafe_id, created_at desc);

drop policy if exists "members can read notifications" on public.notifications;
drop policy if exists "members can update notifications" on public.notifications;
create policy "members and staff can read notifications" on public.notifications
  for select to authenticated
  using (public.is_staff_user() or (session_id is not null and public.is_session_member(session_id)));
create policy "members and staff can update notifications" on public.notifications
  for update to authenticated
  using (public.is_staff_user() or (session_id is not null and public.is_session_member(session_id)))
  with check (public.is_staff_user() or (session_id is not null and public.is_session_member(session_id)));

do $$ begin
  begin alter publication supabase_realtime add table public.notifications; exception when duplicate_object then null; end;
end $$;

create or replace function public.notify_order_created()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_cafe_id uuid;
begin
  select ct.cafe_id into v_cafe_id
  from public.table_sessions ts join public.cafe_tables ct on ct.id = ts.table_id
  where ts.id = new.session_id;
  insert into public.notifications(session_id, cafe_id, order_id, type, title, body, event_key)
  values (new.session_id, v_cafe_id, new.id, 'order_status', 'تم استلام طلبك', 'تم إرسال الطلب إلى الباريستا.', 'order:' || new.id || ':received')
  on conflict (event_key) do nothing;
  return new;
end;
$$;

create or replace function public.notify_order_status_changed()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_cafe_id uuid; v_title text; v_body text;
begin
  if new.status = old.status then return new; end if;
  select ct.cafe_id into v_cafe_id
  from public.table_sessions ts join public.cafe_tables ct on ct.id = ts.table_id
  where ts.id = new.session_id;
  v_title := case new.status when 'preparing' then 'بدأ تحضير الطلب' when 'ready' then 'الطلب جاهز' when 'served' then 'تم تقديم الطلب' when 'cancelled' then 'تم إلغاء الطلب' else 'تحديث الطلب' end;
  v_body := case new.status when 'preparing' then 'بدأ الباريستا تجهيز طلبك.' when 'ready' then 'طلبك جاهز للاستلام.' when 'served' then 'تم تقديم الطلب.' when 'cancelled' then 'تم إلغاء الطلب.' else 'تم تحديث حالة الطلب.' end;
  insert into public.notifications(session_id, cafe_id, order_id, type, title, body, event_key)
  values (new.session_id, v_cafe_id, new.id, 'order_status', v_title, v_body, 'order:' || new.id || ':' || new.status)
  on conflict (event_key) do nothing;
  return new;
end;
$$;

create or replace function public.notify_order_item_status_changed()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_session_id uuid; v_cafe_id uuid; v_title text; v_body text;
begin
  if new.status = old.status then return new; end if;
  select o.session_id, ct.cafe_id into v_session_id, v_cafe_id
  from public.orders o join public.table_sessions ts on ts.id = o.session_id join public.cafe_tables ct on ct.id = ts.table_id
  where o.id = new.order_id;
  if new.status not in ('preparing','ready','served','cancelled') then return new; end if;
  v_title := case new.status when 'preparing' then 'بدأ تحضير مشروبك' when 'ready' then 'مشروبك جاهز' when 'served' then 'تم تقديم مشروبك' else 'تم إلغاء مشروبك' end;
  v_body := case new.status when 'preparing' then new.product_name || ' قيد التحضير الآن.' when 'ready' then new.product_name || ' جاهز للاستلام.' when 'served' then new.product_name || ' تم تقديمه.' else new.product_name || ' تم إلغاؤه.' end;
  insert into public.notifications(session_id, cafe_id, order_id, order_item_id, type, title, body, event_key)
  values (v_session_id, v_cafe_id, new.order_id, new.id, 'order_status', v_title, v_body, 'item:' || new.id || ':' || new.status)
  on conflict (event_key) do nothing;
  return new;
end;
$$;

drop trigger if exists orders_notify_created on public.orders;
create trigger orders_notify_created after insert on public.orders for each row execute function public.notify_order_created();
drop trigger if exists orders_notify_status on public.orders;
create trigger orders_notify_status after update of status on public.orders for each row execute function public.notify_order_status_changed();
drop trigger if exists order_items_notify_status on public.order_items;
create trigger order_items_notify_status after update of status on public.order_items for each row execute function public.notify_order_item_status_changed();

revoke all on function public.notify_order_created() from public;
revoke all on function public.notify_order_status_changed() from public;
revoke all on function public.notify_order_item_status_changed() from public;
