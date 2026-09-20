-- The join RPC must see the active session before the new anonymous guest is
-- a member. Keep the table/session RLS policies unchanged; only this narrowly
-- scoped RPC runs as definer and returns the caller's own guest row.
alter function public.customer_open_table_session(uuid) security definer;
