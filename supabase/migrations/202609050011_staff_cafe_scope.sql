-- Give every staff identity an explicit cafe scope. Existing single-cafe
-- installations are backfilled to the legacy cafe and remain compatible.
alter table public.staff_profiles add column if not exists cafe_id uuid references public.cafes(id) on delete cascade;
update public.staff_profiles
set cafe_id = '00000000-0000-0000-0000-000000000001'
where cafe_id is null;
create index if not exists staff_profiles_cafe_idx on public.staff_profiles(cafe_id);

create or replace function public.current_staff_cafe_id()
returns uuid language sql stable security definer set search_path = public
as $$ select cafe_id from public.staff_profiles where user_id = auth.uid() limit 1 $$;
revoke all on function public.current_staff_cafe_id() from public;
grant execute on function public.current_staff_cafe_id() to authenticated;

drop policy if exists "staff can read tables" on public.cafe_tables;
drop policy if exists "staff can update tables" on public.cafe_tables;
create policy "staff can read tables" on public.cafe_tables for select to authenticated using (public.is_staff_user() and cafe_id = public.current_staff_cafe_id());
create policy "staff can update tables" on public.cafe_tables for update to authenticated using (public.is_staff_user() and cafe_id = public.current_staff_cafe_id()) with check (public.is_staff_user() and cafe_id = public.current_staff_cafe_id());

drop policy if exists "staff can read sessions" on public.table_sessions;
drop policy if exists "staff can update sessions" on public.table_sessions;
create policy "staff can read sessions" on public.table_sessions for select to authenticated using (public.is_staff_user() and exists (select 1 from public.cafe_tables t where t.id = table_id and t.cafe_id = public.current_staff_cafe_id()));
create policy "staff can update sessions" on public.table_sessions for update to authenticated using (public.is_staff_user() and exists (select 1 from public.cafe_tables t where t.id = table_id and t.cafe_id = public.current_staff_cafe_id())) with check (public.is_staff_user() and exists (select 1 from public.cafe_tables t where t.id = table_id and t.cafe_id = public.current_staff_cafe_id()));

drop policy if exists "staff can read orders" on public.orders;
drop policy if exists "staff can update orders" on public.orders;
create policy "staff can read orders" on public.orders for select to authenticated using (public.is_staff_user() and exists (select 1 from public.table_sessions s join public.cafe_tables t on t.id = s.table_id where s.id = session_id and t.cafe_id = public.current_staff_cafe_id()));
create policy "staff can update orders" on public.orders for update to authenticated using (public.is_staff_user() and exists (select 1 from public.table_sessions s join public.cafe_tables t on t.id = s.table_id where s.id = session_id and t.cafe_id = public.current_staff_cafe_id())) with check (public.is_staff_user() and exists (select 1 from public.table_sessions s join public.cafe_tables t on t.id = s.table_id where s.id = session_id and t.cafe_id = public.current_staff_cafe_id()));

drop policy if exists "staff can read order items" on public.order_items;
drop policy if exists "staff can update order items" on public.order_items;
create policy "staff can read order items" on public.order_items for select to authenticated using (public.is_staff_user() and exists (select 1 from public.orders o join public.table_sessions s on s.id = o.session_id join public.cafe_tables t on t.id = s.table_id where o.id = order_id and t.cafe_id = public.current_staff_cafe_id()));
create policy "staff can update order items" on public.order_items for update to authenticated using (public.is_staff_user() and exists (select 1 from public.orders o join public.table_sessions s on s.id = o.session_id join public.cafe_tables t on t.id = s.table_id where o.id = order_id and t.cafe_id = public.current_staff_cafe_id())) with check (public.is_staff_user() and exists (select 1 from public.orders o join public.table_sessions s on s.id = o.session_id join public.cafe_tables t on t.id = s.table_id where o.id = order_id and t.cafe_id = public.current_staff_cafe_id()));

drop policy if exists "staff can read payments" on public.payments;
drop policy if exists "staff can insert payments" on public.payments;
create policy "staff can read payments" on public.payments for select to authenticated using (public.is_staff_user() and exists (select 1 from public.table_sessions s join public.cafe_tables t on t.id = s.table_id where s.id = session_id and t.cafe_id = public.current_staff_cafe_id()));
create policy "staff can insert payments" on public.payments for insert to authenticated with check (public.is_staff_user() and exists (select 1 from public.table_sessions s join public.cafe_tables t on t.id = s.table_id where s.id = session_id and t.cafe_id = public.current_staff_cafe_id()));

drop policy if exists "staff can manage menu products" on public.menu_products;
create policy "staff can manage menu products" on public.menu_products for all to authenticated using (public.is_staff_user() and cafe_id = public.current_staff_cafe_id()) with check (public.is_staff_user() and cafe_id = public.current_staff_cafe_id());
drop policy if exists "staff can manage menu categories" on public.menu_categories;
create policy "staff can manage menu categories" on public.menu_categories for all to authenticated using (public.is_staff_user() and cafe_id = public.current_staff_cafe_id()) with check (public.is_staff_user() and cafe_id = public.current_staff_cafe_id());
drop policy if exists "staff can manage modifier groups" on public.modifier_groups;
create policy "staff can manage modifier groups" on public.modifier_groups for all to authenticated using (public.is_staff_user() and cafe_id = public.current_staff_cafe_id()) with check (public.is_staff_user() and cafe_id = public.current_staff_cafe_id());
