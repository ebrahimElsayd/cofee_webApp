-- Expose only the current guest's table-session facts without granting guests
-- direct read access to cafe_tables (which is intentionally staff-only).
create or replace function public.customer_validate_table_session(p_session_id uuid)
returns table (
  session_id uuid,
  table_id uuid,
  session_status text,
  cafe_id uuid,
  table_number integer
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.table_id, s.status, t.cafe_id, t.table_number
  from public.table_sessions s
  join public.cafe_tables t on t.id = s.table_id
  where s.id = p_session_id
    and auth.uid() is not null
    and exists (
      select 1
      from public.table_guests g
      where g.session_id = s.id
        and g.auth_user_id = auth.uid()
    );
$$;

revoke all on function public.customer_validate_table_session(uuid) from public;
grant execute on function public.customer_validate_table_session(uuid) to authenticated;

-- Catalog policies must not join back into the staff-only cafe_tables RLS
-- policy. Resolve cafe membership in a bounded definer helper instead.
create or replace function public.customer_is_cafe_session_member(p_cafe_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.table_guests g
    join public.table_sessions s on s.id = g.session_id
    join public.cafe_tables t on t.id = s.table_id
    where g.auth_user_id = auth.uid()
      and t.cafe_id = p_cafe_id
      and s.status in ('open', 'ordering', 'payment_pending')
  );
$$;
revoke all on function public.customer_is_cafe_session_member(uuid) from public;
grant execute on function public.customer_is_cafe_session_member(uuid) to authenticated;

drop policy if exists "members can read cafe categories" on public.menu_categories;
create policy "members can read cafe categories" on public.menu_categories
  for select to authenticated
  using (is_active and public.customer_is_cafe_session_member(cafe_id));

drop policy if exists "members can read cafe products" on public.menu_products;
create policy "members can read cafe products" on public.menu_products
  for select to authenticated
  using (availability <> 'hidden' and public.customer_is_cafe_session_member(cafe_id));

drop policy if exists "members can read cafe modifier groups" on public.modifier_groups;
create policy "members can read cafe modifier groups" on public.modifier_groups
  for select to authenticated
  using (is_active and public.customer_is_cafe_session_member(cafe_id));

drop policy if exists "members can read cafe modifier options" on public.modifier_options;
create policy "members can read cafe modifier options" on public.modifier_options
  for select to authenticated
  using (exists (
    select 1 from public.modifier_groups g
    where g.id = group_id and g.is_active
      and public.customer_is_cafe_session_member(g.cafe_id)
  ));

drop policy if exists "members can read cafe product modifiers" on public.product_modifier_groups;
create policy "members can read cafe product modifiers" on public.product_modifier_groups
  for select to authenticated
  using (exists (
    select 1 from public.menu_products p
    join public.modifier_groups g on g.id = group_id and g.cafe_id = p.cafe_id
    where p.id = product_id and p.availability <> 'hidden'
      and public.customer_is_cafe_session_member(p.cafe_id)
  ));
