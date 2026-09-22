-- The first guest who successfully adds to a shared cart owns submission of
-- that cart. Ownership is claimed under the cart row lock, so concurrent
-- first-add attempts cannot create two responsible guests.
alter table public.carts
  add column if not exists responsible_guest_id uuid
  references public.table_guests(id) on delete set null,
  add column if not exists responsible_name text;

update public.carts c
set responsible_guest_id = (
  select ci.guest_id
  from public.cart_items ci
  where ci.cart_id = c.id and ci.guest_id is not null
  order by ci.created_at, ci.id
  limit 1
)
where c.responsible_guest_id is null
  and exists (
    select 1 from public.cart_items ci
    where ci.cart_id = c.id and ci.guest_id is not null
  );

update public.carts c
set responsible_name = (
  select ci.recipient_name
  from public.cart_items ci
  where ci.cart_id = c.id and ci.guest_id = c.responsible_guest_id
  order by ci.created_at, ci.id
  limit 1
)
where c.responsible_guest_id is not null
  and nullif(trim(c.responsible_name), '') is null;

create index if not exists carts_responsible_guest_idx
  on public.carts(responsible_guest_id)
  where responsible_guest_id is not null;

alter function public.add_table_cart_item(uuid, uuid, uuid, integer, uuid[], text, text, text)
  rename to add_table_cart_item_without_responsibility;

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
  v_item_id uuid;
  v_cart_id uuid;
  v_guest_id uuid;
begin
  v_item_id := public.add_table_cart_item_without_responsibility(
    p_session_id, p_table_id, p_product_id, p_quantity,
    p_selected_modifier_option_ids, p_recipient_name, p_notes,
    p_idempotency_key
  );

  select ci.cart_id, ci.guest_id
    into v_cart_id, v_guest_id
  from public.cart_items ci
  where ci.id = v_item_id;

  if v_cart_id is null or v_guest_id is null then
    raise exception 'Cart ownership could not be established' using errcode = '55000';
  end if;

  -- The underlying add RPC locks the active cart until this transaction ends.
  update public.carts
  set responsible_guest_id = coalesce(responsible_guest_id, v_guest_id),
      responsible_name = coalesce(nullif(trim(responsible_name), ''), coalesce(nullif(trim(p_recipient_name), ''), 'Guest')),
      updated_at = now()
  where id = v_cart_id;

  return v_item_id;
end;
$$;

revoke all on function public.add_table_cart_item(uuid, uuid, uuid, integer, uuid[], text, text, text) from public;
grant execute on function public.add_table_cart_item(uuid, uuid, uuid, integer, uuid[], text, text, text) to authenticated;
revoke all on function public.add_table_cart_item_without_responsibility(uuid, uuid, uuid, integer, uuid[], text, text, text) from public, authenticated;

alter function public.submit_table_order(uuid, uuid, jsonb, text, text)
  rename to submit_table_order_without_responsibility;

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
  v_responsible_guest_id uuid;
  v_current_guest_id uuid;
  v_existing_order_id uuid;
begin
  if nullif(trim(p_idempotency_key), '') is not null then
    select o.id into v_existing_order_id
    from public.orders o
    where o.session_id = p_session_id
      and o.idempotency_key = trim(p_idempotency_key)
      and o.created_at >= now() - interval '60 seconds'
    order by o.created_at desc
    limit 1;
    if v_existing_order_id is not null then
      return v_existing_order_id;
    end if;
  end if;

  select c.responsible_guest_id
    into v_responsible_guest_id
  from public.carts c
  where c.session_id = p_session_id and c.status = 'active'
  for update;

  select tg.id
    into v_current_guest_id
  from public.table_guests tg
  where tg.session_id = p_session_id and tg.auth_user_id = auth.uid();

  if v_responsible_guest_id is null then
    raise exception 'The active cart has no responsible guest' using errcode = '55000';
  end if;
  if v_current_guest_id is distinct from v_responsible_guest_id then
    raise exception 'Only the responsible guest can submit this cart' using errcode = '42501';
  end if;

  return public.submit_table_order_without_responsibility(
    p_session_id, p_table_id, p_items, p_customer_notes, p_idempotency_key
  );
end;
$$;

alter function public.submit_table_order(uuid, uuid, jsonb, text, text) security definer;
revoke all on function public.submit_table_order(uuid, uuid, jsonb, text, text) from public;
grant execute on function public.submit_table_order(uuid, uuid, jsonb, text, text) to authenticated;
revoke all on function public.submit_table_order_without_responsibility(uuid, uuid, jsonb, text, text) from public, authenticated;

-- One event is emitted only when cart state actually changes. Keeping the
-- channel open is idle and does not poll the database.
do $$ begin
  begin alter publication supabase_realtime add table public.carts; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.cart_items; exception when duplicate_object then null; end;
end $$;
