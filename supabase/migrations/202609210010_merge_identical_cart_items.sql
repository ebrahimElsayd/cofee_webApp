-- Keep separate order submissions, but merge identical lines inside the
-- current cart. The legacy RPC still validates the full product/options/session
-- contract; this wrapper adds the quantity merge after that validation.

alter function public.add_table_cart_item(uuid, uuid, uuid, integer, uuid[], text, text, text)
  rename to add_table_cart_item_legacy;

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
  v_cart_id uuid;
  v_guest_id uuid;
  v_existing_id uuid;
  v_new_id uuid;
  v_match_id uuid;
  v_selected_options jsonb;
  v_notes text := nullif(trim(p_notes), '');
  v_recipient_name text := coalesce(nullif(trim(p_recipient_name), ''), 'Guest');
  v_unit_price numeric(12,2);
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  -- Repeated retries with the same key must return the original line without
  -- incrementing its quantity a second time.
  select c.id into v_cart_id
  from public.carts c
  where c.session_id = p_session_id and c.status = 'active'
  for update;

  if v_cart_id is not null and nullif(trim(p_idempotency_key), '') is not null then
    select ci.id into v_existing_id
    from public.cart_items ci
    where ci.cart_id = v_cart_id
      and ci.idempotency_key = trim(p_idempotency_key);
    if v_existing_id is not null then
      return v_existing_id;
    end if;
  end if;

  select tg.id into v_guest_id
  from public.table_guests tg
  where tg.session_id = p_session_id and tg.auth_user_id = auth.uid();

  v_new_id := public.add_table_cart_item_legacy(
    p_session_id,
    p_table_id,
    p_product_id,
    p_quantity,
    p_selected_modifier_option_ids,
    p_recipient_name,
    p_notes,
    p_idempotency_key
  );

  select ci.cart_id, ci.selected_options, ci.notes, ci.recipient_name, ci.unit_price
    into v_cart_id, v_selected_options, v_notes, v_recipient_name, v_unit_price
  from public.cart_items ci
  where ci.id = v_new_id;

  -- The cart row lock taken by the legacy function serializes concurrent adds.
  -- Matching includes every value that changes the customer's requested drink.
  select ci.id into v_match_id
  from public.cart_items ci
  where ci.cart_id = v_cart_id
    and ci.id <> v_new_id
    and ci.product_id = p_product_id
    and ci.guest_id is not distinct from v_guest_id
    and ci.recipient_name = v_recipient_name
    and ci.notes is not distinct from v_notes
    and ci.unit_price = v_unit_price
    and ci.selected_options = v_selected_options
  order by ci.created_at asc
  limit 1
  for update;

  if v_match_id is null then
    return v_new_id;
  end if;

  update public.cart_items
  set quantity = least(10, quantity + p_quantity)
  where id = v_match_id;

  delete from public.cart_items where id = v_new_id;
  return v_match_id;
end;
$$;

revoke all on function public.add_table_cart_item(uuid, uuid, uuid, integer, uuid[], text, text, text) from public;
grant execute on function public.add_table_cart_item(uuid, uuid, uuid, integer, uuid[], text, text, text) to authenticated;
