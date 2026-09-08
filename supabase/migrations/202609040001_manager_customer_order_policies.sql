-- Required for customer orders to reach the manager dashboard.
drop policy if exists "members can create order items" on public.order_items;
create policy "members can create order items" on public.order_items
  for insert to authenticated
  with check (exists (select 1 from public.orders o where o.id = order_id and public.is_session_member(o.session_id)));

drop policy if exists "members can create order history" on public.order_status_history;
create policy "members can create order history" on public.order_status_history
  for insert to authenticated
  with check (exists (select 1 from public.orders o where o.id = order_id and public.is_session_member(o.session_id)));

-- Manager staff need to see and operate on every cafe session/order.
drop policy if exists "manager can read tables" on public.cafe_tables;
create policy "manager can read tables" on public.cafe_tables
  for select to authenticated using (true);
drop policy if exists "manager can read sessions" on public.table_sessions;
create policy "manager can read sessions" on public.table_sessions
  for select to authenticated using (true);
drop policy if exists "manager can read orders" on public.orders;
create policy "manager can read orders" on public.orders
  for select to authenticated using (true);
drop policy if exists "manager can update orders" on public.orders;
create policy "manager can update orders" on public.orders
  for update to authenticated using (true) with check (true);
drop policy if exists "manager can read order items" on public.order_items;
create policy "manager can read order items" on public.order_items
  for select to authenticated using (true);
drop policy if exists "manager can update order items" on public.order_items;
create policy "manager can update order items" on public.order_items
  for update to authenticated using (true) with check (true);
drop policy if exists "manager can read payments" on public.payments;
create policy "manager can read payments" on public.payments
  for select to authenticated using (true);
drop policy if exists "manager can insert payments" on public.payments;
create policy "manager can insert payments" on public.payments
  for insert to authenticated with check (true);
