-- The QR-aware resolver has a default token argument, so the legacy two-argument
-- overload makes PostgREST reject otherwise valid calls as ambiguous.
drop function if exists public.customer_resolve_table(uuid, integer);

revoke all on function public.customer_resolve_table(uuid, integer, uuid) from public;
grant execute on function public.customer_resolve_table(uuid, integer, uuid) to authenticated;
