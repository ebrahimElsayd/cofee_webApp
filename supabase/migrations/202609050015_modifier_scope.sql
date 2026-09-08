drop policy if exists "staff can manage modifier options" on public.modifier_options;
create policy "staff can manage modifier options" on public.modifier_options for all to authenticated
  using (public.is_staff_user() and exists (select 1 from public.modifier_groups g where g.id = group_id and g.cafe_id = public.current_staff_cafe_id()))
  with check (public.is_staff_user() and exists (select 1 from public.modifier_groups g where g.id = group_id and g.cafe_id = public.current_staff_cafe_id()));
drop policy if exists "staff can manage product modifiers" on public.product_modifier_groups;
create policy "staff can manage product modifiers" on public.product_modifier_groups for all to authenticated
  using (public.is_staff_user() and exists (select 1 from public.menu_products p where p.id = product_id and p.cafe_id = public.current_staff_cafe_id()))
  with check (public.is_staff_user() and exists (select 1 from public.menu_products p where p.id = product_id and p.cafe_id = public.current_staff_cafe_id()));
