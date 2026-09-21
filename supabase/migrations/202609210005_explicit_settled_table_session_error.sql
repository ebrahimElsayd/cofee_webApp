-- Return a deterministic error instead of a unique-index error when a paid
-- payment_pending session still awaits the cashier's table-close action.
create or replace function public.customer_open_table_session(p_table_id uuid)
returns table(session_id uuid, guest_id uuid, cafe_id uuid, table_number integer, outcome text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cafe_id uuid;
  v_table_number integer;
  v_session_id uuid;
  v_settled_session_id uuid;
  v_outcome text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select t.cafe_id, t.table_number into v_cafe_id, v_table_number from public.cafe_tables t where t.id = p_table_id for update;
  if not found then raise exception 'Table was not found' using errcode = 'P0002'; end if;

  select s.id into v_settled_session_id
  from public.table_sessions s
  where s.table_id = p_table_id and s.status = 'payment_pending' and public.session_has_paid_payment(s.id)
  order by s.opened_at desc limit 1 for update;
  if v_settled_session_id is not null then
    raise exception 'TABLE_SESSION_SETTLED' using errcode = 'P0001';
  end if;

  select s.id into v_session_id from public.table_sessions s
  where s.table_id = p_table_id and (s.status in ('open','ordering') or (s.status='payment_pending' and not public.session_has_paid_payment(s.id)))
  order by s.opened_at desc limit 1 for update;
  if v_session_id is null then
    insert into public.table_sessions (table_id,status) values (p_table_id,'open') returning id into v_session_id;
    v_outcome := 'created';
  else v_outcome := 'joined'; end if;
  insert into public.table_guests (session_id,auth_user_id) values (v_session_id,auth.uid()) on conflict on constraint table_guests_session_id_auth_user_id_key do nothing;
  return query select v_session_id,g.id,v_cafe_id,v_table_number,v_outcome from public.table_guests g where g.session_id=v_session_id and g.auth_user_id=auth.uid();
end;
$$;

revoke all on function public.customer_open_table_session(uuid) from public;
grant execute on function public.customer_open_table_session(uuid) to authenticated;
