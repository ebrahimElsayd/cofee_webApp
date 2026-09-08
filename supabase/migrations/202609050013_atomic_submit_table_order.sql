-- Atomic customer checkout: order, items, history, and cart transition either
-- all succeed or all roll back together.
create or replace function public.submit_table_order(
  p_session_id uuid,
  p_cart_id uuid,
  p_total numeric,
  p_created_by uuid,
  p_items jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order_id uuid;
  v_item jsonb;
begin
  if p_created_by is distinct from auth.uid() then
    raise exception 'created_by must match the authenticated guest';
  end if;
  if not public.is_session_member(p_session_id) then
    raise exception 'guest is not a member of this table session';
  end if;
  if not exists (select 1 from public.carts where id = p_cart_id and session_id = p_session_id and status = 'active') then
    raise exception 'cart is not active for this table session';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'an order must contain at least one item';
  end if;

  insert into public.orders(session_id, cart_id, status, total_amount, created_by)
  values (p_session_id, p_cart_id, 'received', greatest(coalesce(p_total, 0), 0), p_created_by)
  returning id into v_order_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    insert into public.order_items(order_id, product_id, product_name, recipient_name, quantity, unit_price, selected_options, notes, status)
    values (
      v_order_id,
      nullif(v_item->>'product_id', '')::uuid,
      coalesce(nullif(v_item->>'product_name', ''), 'Product'),
      coalesce(nullif(v_item->>'recipient_name', ''), 'Guest'),
      greatest(coalesce((v_item->>'quantity')::integer, 1), 1),
      greatest(coalesce((v_item->>'unit_price')::numeric, 0), 0),
      coalesce(v_item->'selected_options', '[]'::jsonb),
      nullif(v_item->>'notes', ''),
      'received'
    );
  end loop;

  insert into public.order_status_history(order_id, to_status, changed_by)
  values (v_order_id, 'received', p_created_by);
  update public.carts set status = 'submitted', updated_at = now() where id = p_cart_id;
  return v_order_id;
end;
$$;

revoke all on function public.submit_table_order(uuid, uuid, numeric, uuid, jsonb) from public;
grant execute on function public.submit_table_order(uuid, uuid, numeric, uuid, jsonb) to authenticated;
