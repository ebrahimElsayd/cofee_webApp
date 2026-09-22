-- The first submission is controlled by the guest who claimed the cart.
-- Once the session already has an order, every session guest may submit a
-- subsequent active cart. This keeps one session/receipt while allowing the
-- normal "order again" flow from any phone at the table.

create or replace function public.submit_table_order(
  p_session_id uuid,
  p_table_id uuid,
  p_items jsonb,
  p_customer_notes text default null,
  p_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_responsible_guest_id uuid;
  v_current_guest_id uuid;
  v_existing_order_id uuid;
  v_has_previous_orders boolean;
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

  if v_current_guest_id is null then
    raise exception 'User does not belong to this table session' using errcode = '42501';
  end if;

  select exists (
    select 1 from public.orders o where o.session_id = p_session_id
  ) into v_has_previous_orders;

  -- Only the first submission is owner-controlled. Follow-up carts are
  -- independent batches under the same session and can be sent by any guest.
  if not v_has_previous_orders and v_current_guest_id is distinct from v_responsible_guest_id then
    raise exception 'Only the responsible guest can submit the first order' using errcode = '42501';
  end if;

  return public.submit_table_order_without_responsibility(
    p_session_id, p_table_id, p_items, p_customer_notes, p_idempotency_key
  );
end;
$$;

revoke all on function public.submit_table_order(uuid, uuid, jsonb, text, text) from public;
grant execute on function public.submit_table_order(uuid, uuid, jsonb, text, text) to authenticated;
