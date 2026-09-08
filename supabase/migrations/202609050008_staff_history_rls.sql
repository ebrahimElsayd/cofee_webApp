-- Staff RPCs write audit history as part of status transitions.
drop policy if exists "staff can insert order history" on public.order_status_history;
create policy "staff can insert order history" on public.order_status_history
  for insert to authenticated
  with check (public.is_staff_user());

drop policy if exists "staff can insert item history" on public.item_status_history;
create policy "staff can insert item history" on public.item_status_history
  for insert to authenticated
  with check (public.is_staff_user());
