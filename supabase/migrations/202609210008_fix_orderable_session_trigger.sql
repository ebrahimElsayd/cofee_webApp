-- Fix the shared trigger function so PostgreSQL does not resolve a field
-- that is absent from the row type of another table using the same trigger.
-- The previous implementation referenced NEW.cart_id and NEW.session_id in
-- different CASE branches; PL/pgSQL still validates NEW against the current
-- trigger row type, causing cart_items inserts to fail in production.
create or replace function public.enforce_orderable_table_session()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_session_id uuid;
  v_session_id_text text;
  v_cart_id_text text;
begin
  v_session_id_text := to_jsonb(new)->>'session_id';
  v_cart_id_text := to_jsonb(new)->>'cart_id';

  if tg_table_name in ('orders', 'carts') then
    v_session_id := nullif(v_session_id_text, '')::uuid;
  else
    v_session_id := (
      select c.session_id
      from public.carts c
      where c.id = nullif(v_cart_id_text, '')::uuid
    );
  end if;

  if tg_table_name = 'carts' and coalesce(to_jsonb(new)->>'status', '') <> 'active' then
    return new;
  end if;

  if not public.session_accepts_customer_orders(v_session_id) then
    raise exception 'This table bill is paid. Close the visit before starting a new order.'
      using errcode = '55000';
  end if;

  return new;
end;
$$;
