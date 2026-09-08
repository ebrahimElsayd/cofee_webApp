-- Harden the customer bootstrap boundary. Customers enter through a QR URL
-- carrying the cafe scope, then use the controlled RPCs to join a session.
drop policy if exists "authenticated users can read cafes" on public.cafes;
drop policy if exists "authenticated users can read tables" on public.cafe_tables;
drop policy if exists "authenticated users can read sessions" on public.table_sessions;
drop policy if exists "authenticated users can create sessions" on public.table_sessions;
drop policy if exists "authenticated users can update sessions" on public.table_sessions;
drop policy if exists "guests can read table guests" on public.table_guests;
drop policy if exists "guests can join a session" on public.table_guests;
drop policy if exists "guests can update their name" on public.table_guests;

create policy "members can read sessions" on public.table_sessions
  for select to authenticated using (public.is_session_member(id));

create policy "members can read guests" on public.table_guests
  for select to authenticated
  using (auth.uid() = auth_user_id or public.is_session_member(session_id));

create policy "members can update own guest" on public.table_guests
  for update to authenticated
  using (auth.uid() = auth_user_id)
  with check (auth.uid() = auth_user_id);

-- These functions are the only customer bootstrap entry points. They validate
-- the QR cafe scope and bypass base-table RLS only for their bounded operation.
create or replace function public.customer_resolve_table(
  p_cafe_id uuid,
  p_table_number integer
)
returns table(id uuid, cafe_id uuid, table_number integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_cafe_id is null then raise exception 'Cafe QR scope is required' using errcode = '22023'; end if;
  if p_table_number is null or p_table_number < 1 then
    raise exception 'Invalid table number' using errcode = '22023';
  end if;
  return query
  select t.id, t.cafe_id, t.table_number
  from public.cafe_tables t
  where t.cafe_id = p_cafe_id and t.table_number = p_table_number;
end;
$$;

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
  v_outcome text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  select t.cafe_id, t.table_number into v_cafe_id, v_table_number
  from public.cafe_tables t where t.id = p_table_id for update;
  if not found then raise exception 'Table was not found' using errcode = 'P0002'; end if;

  select s.id into v_session_id
  from public.table_sessions s
  where s.table_id = p_table_id and s.status in ('open', 'ordering', 'payment_pending')
  order by s.opened_at desc
  limit 1 for update;

  if v_session_id is null then
    insert into public.table_sessions (table_id, status)
    values (p_table_id, 'open') returning id into v_session_id;
    v_outcome := 'created';
  else
    v_outcome := 'joined';
  end if;

  insert into public.table_guests (session_id, auth_user_id)
  values (v_session_id, auth.uid())
  on conflict on constraint table_guests_session_id_auth_user_id_key do nothing;

  return query
  select v_session_id, g.id, v_cafe_id, v_table_number, v_outcome
  from public.table_guests g
  where g.session_id = v_session_id and g.auth_user_id = auth.uid();
end;
$$;

revoke all on function public.customer_resolve_table(uuid, integer) from public;
revoke all on function public.customer_open_table_session(uuid) from public;
grant execute on function public.customer_resolve_table(uuid, integer) to authenticated;
grant execute on function public.customer_open_table_session(uuid) to authenticated;
