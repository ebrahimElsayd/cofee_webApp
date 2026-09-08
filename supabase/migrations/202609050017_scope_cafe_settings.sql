-- Keep cafe profile data tenant-scoped like the rest of the manager surface.
drop policy if exists "staff can read cafe settings" on public.cafe_settings;
drop policy if exists "staff can update cafe settings" on public.cafe_settings;

create policy "staff can read own cafe settings" on public.cafe_settings
  for select to authenticated
  using (public.is_staff_user() and id = public.current_staff_cafe_id());

create policy "staff can manage own cafe settings" on public.cafe_settings
  for all to authenticated
  using (public.is_staff_user() and id = public.current_staff_cafe_id())
  with check (public.is_staff_user() and id = public.current_staff_cafe_id());
