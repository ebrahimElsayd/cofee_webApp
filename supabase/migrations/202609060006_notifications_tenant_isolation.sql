-- Tenant keys are denormalized for safe RLS and server-side Realtime filters.
alter table public.notifications
  add column if not exists cafe_id uuid references public.cafes(id) on delete cascade,
  add column if not exists table_id uuid references public.cafe_tables(id) on delete set null;
alter table public.service_requests
  add column if not exists cafe_id uuid references public.cafes(id) on delete cascade,
  add column if not exists table_id uuid references public.cafe_tables(id) on delete set null;

update public.notifications n
set cafe_id = t.cafe_id,
    table_id = s.table_id
from public.table_sessions s
join public.cafe_tables t on t.id = s.table_id
where n.session_id = s.id and (n.cafe_id is null or n.table_id is null);
update public.service_requests r
set cafe_id = t.cafe_id,
    table_id = s.table_id
from public.table_sessions s
join public.cafe_tables t on t.id = s.table_id
where r.session_id = s.id and (r.cafe_id is null or r.table_id is null);

create or replace function public.populate_notification_tenant_keys()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.session_id is not null then
    select s.table_id, t.cafe_id into new.table_id, new.cafe_id
    from public.table_sessions s
    join public.cafe_tables t on t.id = s.table_id
    where s.id = new.session_id;
  end if;
  return new;
end;
$$;
drop trigger if exists notifications_populate_tenant_keys on public.notifications;
create trigger notifications_populate_tenant_keys
before insert or update of session_id on public.notifications
for each row execute function public.populate_notification_tenant_keys();
drop trigger if exists service_requests_populate_tenant_keys on public.service_requests;
create trigger service_requests_populate_tenant_keys
before insert or update of session_id on public.service_requests
for each row execute function public.populate_notification_tenant_keys();

create index if not exists notifications_cafe_table_created_idx on public.notifications(cafe_id, table_id, created_at desc);
create index if not exists service_requests_cafe_status_created_idx on public.service_requests(cafe_id, status, created_at asc);

create or replace function public.auth_manager_cafe_id()
returns uuid language sql stable security definer set search_path = public
as $$ select public.current_staff_cafe_id() $$;
revoke all on function public.auth_manager_cafe_id() from public;
grant execute on function public.auth_manager_cafe_id() to authenticated;

drop policy if exists "staff can read cafe notifications" on public.notifications;
drop policy if exists "staff can update cafe notifications" on public.notifications;
drop policy if exists "manager can read cafe notifications" on public.notifications;
drop policy if exists "manager can update cafe notifications" on public.notifications;
drop policy if exists "manager can insert cafe notifications" on public.notifications;
create policy "manager can read cafe notifications" on public.notifications
  for select to authenticated
  using (public.is_staff_user() and cafe_id = public.auth_manager_cafe_id());
create policy "manager can update cafe notifications" on public.notifications
  for update to authenticated
  using (public.is_staff_user() and cafe_id = public.auth_manager_cafe_id())
  with check (public.is_staff_user() and cafe_id = public.auth_manager_cafe_id());
create policy "manager can insert cafe notifications" on public.notifications
  for insert to authenticated
  with check (public.is_staff_user() and cafe_id = public.auth_manager_cafe_id());

drop policy if exists "manager can read cafe service requests" on public.service_requests;
drop policy if exists "manager can update cafe service requests" on public.service_requests;
create policy "manager can read cafe service requests" on public.service_requests
  for select to authenticated
  using (public.is_staff_user() and cafe_id = public.auth_manager_cafe_id());
create policy "manager can update cafe service requests" on public.service_requests
  for update to authenticated
  using (public.is_staff_user() and cafe_id = public.auth_manager_cafe_id())
  with check (public.is_staff_user() and cafe_id = public.auth_manager_cafe_id());

alter table public.notifications replica identity full;
alter table public.service_requests replica identity full;
