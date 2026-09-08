alter table public.orders
  add column if not exists idempotency_key text,
  add column if not exists customer_notes text;

create index if not exists orders_session_idempotency_created_idx
  on public.orders (session_id, idempotency_key, created_at desc)
  where idempotency_key is not null;

drop function if exists public.submit_table_order(uuid, uuid, numeric, uuid, jsonb);
drop function if exists public.submit_table_order(uuid, uuid, jsonb, text, text);

create function public.submit_table_order(
  p_session_id uuid,
  p_table_id uuid,
  p_items jsonb,
  p_customer_notes text default null,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cafe_id uuid;
  v_order_id uuid;
  v_item jsonb;
  v_product_id uuid;
  v_product_name text;
  v_base_price numeric(12,2);
  v_cost_price numeric(12,2);
  v_modifier_total numeric(12,2);
  v_item_price numeric(12,2);
  v_line_total numeric(12,2);
  v_order_total numeric(12,2) := 0;
  v_quantity integer;
  v_modifier_ids uuid[];
  v_modifier_count integer;
  v_selected_options jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  perform id
  from public.table_sessions
  where id = p_session_id
    and table_id = p_table_id
    and status in ('open', 'ordering', 'payment_pending')
  for update;
  if not found then
    raise exception 'Table session is missing or closed' using errcode = '55000';
  end if;

  select ct.cafe_id
    into v_cafe_id
  from public.cafe_tables ct
  where ct.id = p_table_id;
  if v_cafe_id is null then
    raise exception 'Table does not exist' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.table_guests tg
    where tg.session_id = p_session_id
      and tg.auth_user_id = auth.uid()
  ) then
    raise exception 'User does not belong to this table session' using errcode = '42501';
  end if;

  if nullif(trim(p_idempotency_key), '') is not null then
    select o.id
      into v_order_id
    from public.orders o
    where o.session_id = p_session_id
      and o.idempotency_key = trim(p_idempotency_key)
      and o.created_at >= now() - interval '60 seconds'
    order by o.created_at desc
    limit 1;
    if v_order_id is not null then
      return v_order_id;
    end if;
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Order must contain at least one item' using errcode = '22023';
  end if;

  insert into public.orders (
    session_id, status, total_amount, payment_status, created_by,
    idempotency_key, customer_notes
  ) values (
    p_session_id, 'received', 0, 'unpaid', auth.uid(),
    nullif(trim(p_idempotency_key), ''), nullif(trim(p_customer_notes), '')
  ) returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Invalid order item' using errcode = '22023';
    end if;

    begin
      v_product_id := (v_item->>'product_id')::uuid;
      v_quantity := (v_item->>'quantity')::integer;
    exception when others then
      raise exception 'Invalid product_id or quantity' using errcode = '22023';
    end;
    if v_quantity not between 1 and 10 then
      raise exception 'Quantity must be between 1 and 10' using errcode = '22023';
    end if;

    select mp.name, mp.base_price, mp.cost_price
      into v_product_name, v_base_price, v_cost_price
    from public.menu_products mp
    left join public.product_availability pa on pa.product_id = mp.id
    where mp.id = v_product_id
      and mp.cafe_id = v_cafe_id
      and mp.availability = 'available'
      and coalesce(pa.is_available, true)
    for update of mp;
    if not found then
      raise exception 'Product % is unavailable or belongs to another cafe', v_product_id using errcode = '22023';
    end if;

    begin
      select coalesce(array_agg(value::uuid), '{}'::uuid[])
        into v_modifier_ids
      from jsonb_array_elements_text(coalesce(v_item->'selected_modifier_option_ids', '[]'::jsonb));
    exception when others then
      raise exception 'Invalid modifier option id' using errcode = '22023';
    end;

    if cardinality(v_modifier_ids) <> cardinality(array(select distinct unnest(v_modifier_ids))) then
      raise exception 'Duplicate modifier options are not allowed' using errcode = '22023';
    end if;

    select
      count(mo.id)::integer,
      coalesce(sum(mo.price_delta), 0)::numeric(12,2),
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'optionId', mo.id,
            'label', mo.name,
            'labelAr', mo.name_ar,
            'price', mo.price_delta
          ) order by mo.id
        ) filter (where mo.id is not null),
        '[]'::jsonb
      )
      into v_modifier_count, v_modifier_total, v_selected_options
    from unnest(v_modifier_ids) selected(option_id)
    join public.modifier_options mo on mo.id = selected.option_id and mo.is_available
    join public.modifier_groups mg on mg.id = mo.group_id and mg.cafe_id = v_cafe_id and mg.is_active
    join public.product_modifier_groups pmg on pmg.group_id = mg.id and pmg.product_id = v_product_id;

    if v_modifier_count <> cardinality(v_modifier_ids) then
      raise exception 'A modifier option is invalid for product %', v_product_id using errcode = '22023';
    end if;

    if exists (
      select 1
      from public.product_modifier_groups pmg
      join public.modifier_groups mg on mg.id = pmg.group_id
      where pmg.product_id = v_product_id
        and mg.is_active
        and mg.is_required
        and not exists (
          select 1 from public.modifier_options mo
          where mo.group_id = mg.id and mo.id = any(v_modifier_ids)
        )
    ) then
      raise exception 'A required modifier is missing for product %', v_product_id using errcode = '22023';
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

    v_item_price := (v_base_price + v_modifier_total)::numeric(12,2);
    v_line_total := (v_item_price * v_quantity)::numeric(12,2);
    v_order_total := (v_order_total + v_line_total)::numeric(12,2);

    insert into public.order_items (
      order_id, product_id, product_name, recipient_name, quantity,
      unit_price, cost_price, status, selected_options, notes
    ) values (
      v_order_id, v_product_id, v_product_name,
      coalesce(nullif(trim(v_item->>'recipient_name'), ''), 'Guest'),
      v_quantity, v_item_price, v_cost_price, 'received', v_selected_options,
      nullif(trim(v_item->>'notes'), '')
    );
  end loop;

  update public.orders
  set total_amount = v_order_total, updated_at = now()
  where id = v_order_id;

  update public.carts
  set status = 'submitted', updated_at = now()
  where session_id = p_session_id and status = 'active';

  insert into public.order_status_history (order_id, to_status, changed_by)
  values (v_order_id, 'received', auth.uid());

  return v_order_id;
end;
$$;

revoke all on function public.submit_table_order(uuid, uuid, jsonb, text, text) from public;
grant execute on function public.submit_table_order(uuid, uuid, jsonb, text, text) to authenticated;
