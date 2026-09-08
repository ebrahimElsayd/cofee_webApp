-- Customers may browse only the catalog belonging to the cafe of their
-- active table session. Staff policies remain separate and cafe-scoped.
drop policy if exists "authenticated can read active catalog" on public.menu_categories;
create policy "members can read cafe categories" on public.menu_categories
  for select to authenticated
  using (
    is_active and exists (
      select 1
      from public.table_sessions s
      join public.cafe_tables t on t.id = s.table_id
      where t.cafe_id = menu_categories.cafe_id
        and public.is_session_member(s.id)
    )
  );

drop policy if exists "authenticated can read products" on public.menu_products;
create policy "members can read cafe products" on public.menu_products
  for select to authenticated
  using (
    availability <> 'hidden' and exists (
      select 1
      from public.table_sessions s
      join public.cafe_tables t on t.id = s.table_id
      where t.cafe_id = menu_products.cafe_id
        and public.is_session_member(s.id)
    )
  );

drop policy if exists "authenticated can read modifier groups" on public.modifier_groups;
create policy "members can read cafe modifier groups" on public.modifier_groups
  for select to authenticated
  using (
    is_active and exists (
      select 1
      from public.table_sessions s
      join public.cafe_tables t on t.id = s.table_id
      where t.cafe_id = modifier_groups.cafe_id
        and public.is_session_member(s.id)
    )
  );

drop policy if exists "authenticated can read modifier options" on public.modifier_options;
create policy "members can read cafe modifier options" on public.modifier_options
  for select to authenticated
  using (
    exists (
      select 1
      from public.modifier_groups g
      join public.table_sessions s on true
      join public.cafe_tables t on t.id = s.table_id
      where g.id = modifier_options.group_id
        and t.cafe_id = g.cafe_id
        and public.is_session_member(s.id)
    )
  );

drop policy if exists "authenticated can read product modifiers" on public.product_modifier_groups;
create policy "members can read cafe product modifiers" on public.product_modifier_groups
  for select to authenticated
  using (
    exists (
      select 1
      from public.modifier_groups g
      join public.menu_products p on p.id = product_id and p.cafe_id = g.cafe_id
      join public.table_sessions s on true
      join public.cafe_tables t on t.id = s.table_id
      where g.id = group_id
        and t.cafe_id = g.cafe_id
        and public.is_session_member(s.id)
    )
  );
