-- Keep the central notification stream tenant-isolated for cashier clients.
drop policy if exists "members and staff can read notifications" on public.notifications;
drop policy if exists "members and staff can update notifications" on public.notifications;
create policy "members can read session notifications" on public.notifications
  for select to authenticated
  using (session_id is not null and public.is_session_member(session_id));
create policy "staff can read cafe notifications" on public.notifications
  for select to authenticated
  using (public.is_staff_user() and cafe_id = public.current_staff_cafe_id());
create policy "members can update session notifications" on public.notifications
  for update to authenticated
  using (session_id is not null and public.is_session_member(session_id))
  with check (session_id is not null and public.is_session_member(session_id));
create policy "staff can update cafe notifications" on public.notifications
  for update to authenticated
  using (public.is_staff_user() and cafe_id = public.current_staff_cafe_id())
  with check (public.is_staff_user() and cafe_id = public.current_staff_cafe_id());
