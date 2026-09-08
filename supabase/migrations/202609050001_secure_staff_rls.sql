-- Replace the initial authenticated=true policies with role-aware access.
-- Customer accounts are session members; staff accounts are represented by
-- staff_profiles (or an explicit staff role in JWT app_metadata).

create table if not exists public.staff_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Staff',
  role text not null default 'cashier' check (role in ('owner','manager','cashier','barista')),
  recovery_phone text,
  created_at timestamptz not null default now()
);
alter table public.staff_profiles enable row level security;

create or replace function public.is_staff_user()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.staff_profiles where user_id = auth.uid())
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') in ('owner','manager','cashier','barista');
$$;

revoke all on function public.is_staff_user() from public;
grant execute on function public.is_staff_user() to authenticated;

drop policy if exists "manager can read tables" on public.cafe_tables;
drop policy if exists "manager can read sessions" on public.table_sessions;
drop policy if exists "manager can read orders" on public.orders;
drop policy if exists "manager can update orders" on public.orders;
drop policy if exists "manager can read order items" on public.order_items;
drop policy if exists "manager can update order items" on public.order_items;
drop policy if exists "manager can read payments" on public.payments;
drop policy if exists "manager can insert payments" on public.payments;

-- Policies from the original manager schema were intentionally permissive.
-- Drop them only when their legacy table exists in this deployment.
do $$
declare table_name text;
begin
  foreach table_name in array array['cafe_settings','products','product_customization_groups','product_customization_choices','cafe_tables','orders','order_items','order_payments','cafes','branches','staff_profiles','categories','customer_sessions'] loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('drop policy if exists %I_authenticated_access on public.%I', table_name, table_name);
    end if;
  end loop;
end $$;

create policy "staff can read tables" on public.cafe_tables for select to authenticated using (public.is_staff_user());
create policy "staff can update tables" on public.cafe_tables for update to authenticated using (public.is_staff_user()) with check (public.is_staff_user());
create policy "staff can read sessions" on public.table_sessions for select to authenticated using (public.is_staff_user());
create policy "staff can update sessions" on public.table_sessions for update to authenticated using (public.is_staff_user()) with check (public.is_staff_user());
create policy "staff can read orders" on public.orders for select to authenticated using (public.is_staff_user());
create policy "staff can update orders" on public.orders for update to authenticated using (public.is_staff_user()) with check (public.is_staff_user());
create policy "staff can read order items" on public.order_items for select to authenticated using (public.is_staff_user());
create policy "staff can update order items" on public.order_items for update to authenticated using (public.is_staff_user()) with check (public.is_staff_user());
create policy "staff can read payments" on public.payments for select to authenticated using (public.is_staff_user());
create policy "staff can insert payments" on public.payments for insert to authenticated with check (public.is_staff_user());

create policy "staff can manage menu products" on public.menu_products for all to authenticated using (public.is_staff_user()) with check (public.is_staff_user());
create policy "staff can manage menu categories" on public.menu_categories for all to authenticated using (public.is_staff_user()) with check (public.is_staff_user());
create policy "staff can manage modifier groups" on public.modifier_groups for all to authenticated using (public.is_staff_user()) with check (public.is_staff_user());
create policy "staff can manage modifier options" on public.modifier_options for all to authenticated using (public.is_staff_user()) with check (public.is_staff_user());
create policy "staff can manage product modifiers" on public.product_modifier_groups for all to authenticated using (public.is_staff_user()) with check (public.is_staff_user());

drop policy if exists staff_profiles_authenticated_access on public.staff_profiles;
create policy "users can read own staff profile" on public.staff_profiles for select to authenticated using (user_id = auth.uid());
