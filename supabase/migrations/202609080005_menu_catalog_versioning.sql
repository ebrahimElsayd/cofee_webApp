alter table public.cafe_settings
  add column if not exists menu_version bigint not null default 1;

create or replace function public.bump_cafe_menu_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cafe_id uuid;
  v_product_id uuid;
  v_group_id uuid;
begin
  if tg_table_name = 'menu_products' then
    v_cafe_id := coalesce(new.cafe_id, old.cafe_id);
  elsif tg_table_name = 'menu_categories' or tg_table_name = 'modifier_groups' then
    v_cafe_id := coalesce(new.cafe_id, old.cafe_id);
  elsif tg_table_name = 'modifier_options' then
    v_group_id := coalesce(new.group_id, old.group_id);
    select cafe_id into v_cafe_id from public.modifier_groups where id = v_group_id;
  elsif tg_table_name = 'product_modifier_groups' then
    v_product_id := coalesce(new.product_id, old.product_id);
    select cafe_id into v_cafe_id from public.menu_products where id = v_product_id;
  elsif tg_table_name = 'product_availability' then
    v_product_id := coalesce(new.product_id, old.product_id);
    select cafe_id into v_cafe_id from public.menu_products where id = v_product_id;
  end if;

  if v_cafe_id is not null then
    insert into public.cafe_settings (id, menu_version)
    values (v_cafe_id, 2)
    on conflict (id) do update
      set menu_version = public.cafe_settings.menu_version + 1,
          updated_at = now();
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists bump_menu_version_products on public.menu_products;
create trigger bump_menu_version_products after insert or update or delete on public.menu_products
for each row execute function public.bump_cafe_menu_version();

drop trigger if exists bump_menu_version_categories on public.menu_categories;
create trigger bump_menu_version_categories after insert or update or delete on public.menu_categories
for each row execute function public.bump_cafe_menu_version();

drop trigger if exists bump_menu_version_groups on public.modifier_groups;
create trigger bump_menu_version_groups after insert or update or delete on public.modifier_groups
for each row execute function public.bump_cafe_menu_version();

drop trigger if exists bump_menu_version_options on public.modifier_options;
create trigger bump_menu_version_options after insert or update or delete on public.modifier_options
for each row execute function public.bump_cafe_menu_version();

drop trigger if exists bump_menu_version_product_groups on public.product_modifier_groups;
create trigger bump_menu_version_product_groups after insert or update or delete on public.product_modifier_groups
for each row execute function public.bump_cafe_menu_version();

drop trigger if exists bump_menu_version_availability on public.product_availability;
create trigger bump_menu_version_availability after insert or update or delete on public.product_availability
for each row execute function public.bump_cafe_menu_version();

create or replace function public.get_customer_menu_version(
  p_cafe_id uuid,
  p_session_id uuid
)
returns bigint
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_version bigint;
begin
  if not exists (
    select 1
    from public.table_sessions s
    join public.cafe_tables t on t.id = s.table_id
    where s.id = p_session_id
      and t.cafe_id = p_cafe_id
      and s.status in ('open', 'ordering', 'payment_pending')
  ) then
    raise exception 'Active table session is required' using errcode = '42501';
  end if;

  select menu_version into v_version
  from public.cafe_settings
  where id = p_cafe_id;
  return coalesce(v_version, 1);
end;
$$;

revoke all on function public.get_customer_menu_version(uuid, uuid) from public;
grant execute on function public.get_customer_menu_version(uuid, uuid) to anon, authenticated;
