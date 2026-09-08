alter table public.cart_items
  add column if not exists idempotency_key text;

create unique index if not exists cart_items_cart_idempotency_uidx
  on public.cart_items (cart_id, idempotency_key)
  where idempotency_key is not null;

drop function if exists public.add_table_cart_item(uuid, uuid, uuid, integer, uuid[], text, text, text);

create function public.add_table_cart_item(
  p_session_id uuid,
  p_table_id uuid,
  p_product_id uuid,
  p_quantity integer,
  p_selected_modifier_option_ids uuid[] default '{}'::uuid[],
  p_recipient_name text default 'Guest',
  p_notes text default null,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cafe_id uuid;
  v_cart_id uuid;
  v_cart_item_id uuid;
  v_guest_id uuid;
  v_base_price numeric(12,2);
  v_modifier_total numeric(12,2) := 0;
  v_modifier_count integer := 0;
  v_modifier_ids uuid[] := coalesce(p_selected_modifier_option_ids, '{}'::uuid[]);
  v_selected_options jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  if p_quantity not between 1 and 10 then
    raise exception 'Quantity must be between 1 and 10' using errcode = '22023';
  end if;

  select ct.cafe_id
    into v_cafe_id
  from public.table_sessions ts
  join public.cafe_tables ct on ct.id = ts.table_id
  where ts.id = p_session_id
    and ts.table_id = p_table_id
    and ts.status in ('open', 'ordering', 'payment_pending')
  for update of ts;

  if not found then
    raise exception 'Table session is missing or closed' using errcode = '55000';
  end if;

  select tg.id
    into v_guest_id
  from public.table_guests tg
  where tg.session_id = p_session_id
    and tg.auth_user_id = auth.uid();

  if v_guest_id is null then
    raise exception 'User does not belong to this table session' using errcode = '42501';
  end if;

  select mp.base_price
    into v_base_price
  from public.menu_products mp
  left join public.product_availability pa on pa.product_id = mp.id
  where mp.id = p_product_id
    and mp.cafe_id = v_cafe_id
    and mp.availability = 'available'
    and coalesce(pa.is_available, true)
  for update of mp;

  if not found then
    raise exception 'Product is unavailable or belongs to another cafe' using errcode = '22023';
  end if;

  if cardinality(v_modifier_ids) <> cardinality(array(select distinct unnest(v_modifier_ids))) then
    raise exception 'Duplicate modifier options are not allowed' using errcode = '22023';
  end if;

  select
    count(mo.id)::integer,
    coalesce(sum(mo.price_delta), 0)::numeric(12,2),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'groupId', mg.id,
          'groupLabel', mg.name,
          'groupLabelAr', mg.name_ar,
          'optionId', mo.id,
          'optionLabel', mo.name,
          'optionLabelAr', mo.name_ar,
          'price', mo.price_delta
        ) order by mg.sort_order, mo.sort_order, mo.id
      ) filter (where mo.id is not null),
      '[]'::jsonb
    )
    into v_modifier_count, v_modifier_total, v_selected_options
  from unnest(v_modifier_ids) selected(option_id)
  join public.modifier_options mo
    on mo.id = selected.option_id and mo.is_available
  join public.modifier_groups mg
    on mg.id = mo.group_id and mg.cafe_id = v_cafe_id and mg.is_active
  join public.product_modifier_groups pmg
    on pmg.group_id = mg.id and pmg.product_id = p_product_id;

  if v_modifier_count <> cardinality(v_modifier_ids) then
    raise exception 'A modifier option is invalid for this product' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.product_modifier_groups pmg
    join public.modifier_groups mg on mg.id = pmg.group_id
    where pmg.product_id = p_product_id
      and mg.is_active
      and mg.is_required
      and not exists (
        select 1
        from public.modifier_options mo
        where mo.group_id = mg.id
          and mo.id = any(v_modifier_ids)
          and mo.is_available
      )
  ) then
    raise exception 'A required modifier is missing' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.modifier_options mo
    join public.modifier_groups mg on mg.id = mo.group_id
    where mo.id = any(v_modifier_ids)
      and mg.selection_type in ('single', 'slider')
    group by mg.id
    having count(*) > 1
  ) then
    raise exception 'Too many options selected for a single-choice modifier' using errcode = '22023';
  end if;

  select c.id
    into v_cart_id
  from public.carts c
  where c.session_id = p_session_id and c.status = 'active'
  for update;

  if v_cart_id is null then
    begin
      insert into public.carts (session_id, status)
      values (p_session_id, 'active')
      returning id into v_cart_id;
    exception when unique_violation then
      select c.id into v_cart_id
      from public.carts c
      where c.session_id = p_session_id and c.status = 'active'
      for update;
    end;
  end if;

  if nullif(trim(p_idempotency_key), '') is not null then
    select ci.id
      into v_cart_item_id
    from public.cart_items ci
    where ci.cart_id = v_cart_id
      and ci.idempotency_key = trim(p_idempotency_key);

    if v_cart_item_id is not null then
      return v_cart_item_id;
    end if;
  end if;

  insert into public.cart_items (
    cart_id, guest_id, product_id, recipient_name, quantity, unit_price,
    selected_options, notes, idempotency_key
  ) values (
    v_cart_id, v_guest_id, p_product_id,
    coalesce(nullif(trim(p_recipient_name), ''), 'Guest'),
    p_quantity, (v_base_price + v_modifier_total)::numeric(12,2),
    v_selected_options, nullif(trim(p_notes), ''),
    nullif(trim(p_idempotency_key), '')
  )
  returning id into v_cart_item_id;

  return v_cart_item_id;
end;
$$;

revoke all on function public.add_table_cart_item(uuid, uuid, uuid, integer, uuid[], text, text, text) from public;
grant execute on function public.add_table_cart_item(uuid, uuid, uuid, integer, uuid[], text, text, text) to authenticated;
