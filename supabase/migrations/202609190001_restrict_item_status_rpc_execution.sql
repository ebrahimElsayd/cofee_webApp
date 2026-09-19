-- Defense in depth: item status changes are staff operations. The function
-- already validates cafe membership, but anonymous callers do not need EXECUTE.
revoke execute on function public.manager_set_order_item_status(uuid, text, text) from anon;
revoke all on function public.manager_set_order_item_status(uuid, text, text) from public;
grant execute on function public.manager_set_order_item_status(uuid, text, text) to authenticated, service_role;
