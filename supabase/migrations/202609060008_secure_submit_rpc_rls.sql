-- The customer submit RPC performs an atomic lock and updates the order/cart.
-- Keep the caller authenticated and session-member checks in the function, but
-- run the bounded transaction as the owner so customer RLS cannot block FOR UPDATE.
ALTER FUNCTION public.submit_table_order(uuid, uuid, jsonb, text, text)
  SECURITY DEFINER;

ALTER FUNCTION public.submit_table_order(uuid, uuid, jsonb, text, text)
  SET search_path = public;

REVOKE ALL ON FUNCTION public.submit_table_order(uuid, uuid, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_table_order(uuid, uuid, jsonb, text, text) TO authenticated;
