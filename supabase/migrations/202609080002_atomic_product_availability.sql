create or replace function public.manager_set_product_availability(
  p_product_id uuid,
  p_available boolean
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_cafe_id uuid;
begin
  if not public.is_staff_user() then
    raise exception 'Staff authentication required' using errcode = '42501';
  end if;

  select cafe_id into v_cafe_id
  from public.menu_products
  where id = p_product_id
  for update;

  if v_cafe_id is null or v_cafe_id <> public.current_staff_cafe_id() then
    raise exception 'Product does not belong to the active cafe' using errcode = '42501';
  end if;

  update public.menu_products
  set availability = case when p_available then 'available' else 'unavailable' end,
      updated_at = now()
  where id = p_product_id;

  insert into public.product_availability (product_id, is_available, updated_at)
  values (p_product_id, p_available, now())
  on conflict (product_id) do update
  set is_available = excluded.is_available,
      updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.manager_set_product_availability(uuid, boolean) from public;
grant execute on function public.manager_set_product_availability(uuid, boolean) to authenticated, service_role;
