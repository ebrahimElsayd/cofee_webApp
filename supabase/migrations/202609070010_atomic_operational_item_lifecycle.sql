drop function if exists public.manager_set_order_item_status(uuid, text, text);

create function public.manager_set_order_item_status(p_order_item_id uuid, p_status text, p_note text default null)
returns public.orders language plpgsql security definer set search_path = public
as $$
declare v_item public.order_items; v_order public.orders; v_order_id uuid; v_session_status text; v_parent_status text;
begin
  if p_status not in ('received','preparing','ready','served','cancelled') then raise exception 'Invalid item status: %', p_status using errcode='22023'; end if;
  select order_id into v_order_id from public.order_items where id=p_order_item_id;
  if not found then raise exception 'Order item % was not found',p_order_item_id using errcode='P0002'; end if;
  select * into v_order from public.orders where id=v_order_id for update;
  select status into v_session_status from public.table_sessions where id=v_order.session_id for update;
  select * into v_item from public.order_items where id=p_order_item_id for update;

  if coalesce(auth.jwt()->>'role','') <> 'service_role' and (not public.is_staff_user() or public.auth_manager_cafe_id() is distinct from v_order.cafe_id) then raise exception 'Not authorized for this cafe' using errcode='42501'; end if;
  if v_session_status in ('closed','cancelled') then raise exception 'Table session is archived: %',v_session_status using errcode='22023'; end if;
  if v_order.status='cancelled' or v_item.status='cancelled' then raise exception 'Cancelled orders and items cannot be changed' using errcode='22023'; end if;
  if p_status=v_item.status then return v_order; end if;

  if v_item.status in ('received','preparing','ready') and p_status in ('received','preparing','ready') then null;
  elsif v_item.status='ready' and p_status='served' then null;
  elsif v_item.status in ('received','preparing','ready') and p_status='cancelled' then null;
  else raise exception 'Invalid item transition: % -> %',v_item.status,p_status using errcode='22023'; end if;

  if v_order.status in ('served','completed') then update public.orders set status='preparing',closed_at=null,updated_at=now() where id=v_order_id; end if;
  update public.order_items set status=p_status,notes=coalesce(nullif(p_note,''),notes),ready_at=case when p_status='ready' then now() else null end,served_at=case when p_status='served' then now() else null end where id=p_order_item_id;

  select case
    when count(*) filter(where status<>'cancelled')=0 then 'cancelled'
    when bool_and(status in ('ready','served','cancelled')) then 'ready'
    when bool_or(status in ('received','preparing')) then 'preparing'
    else 'preparing' end
  into v_parent_status from public.order_items where order_id=v_order_id;
  update public.orders set status=v_parent_status,updated_at=now(),closed_at=case when v_parent_status in ('received','preparing','ready') then null else closed_at end where id=v_order_id and status<>'cancelled';
  insert into public.item_status_history(order_item_id,from_status,to_status,changed_by) values(p_order_item_id,v_item.status,p_status,auth.uid());
  return (select o from public.orders o where o.id=v_order_id);
end;
$$;

revoke all on function public.manager_set_order_item_status(uuid,text,text) from public;
grant execute on function public.manager_set_order_item_status(uuid,text,text) to authenticated,anon,service_role;
alter table public.orders replica identity full;
alter table public.order_items replica identity full;
do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='orders') then alter publication supabase_realtime add table public.orders; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='order_items') then alter publication supabase_realtime add table public.order_items; end if;
end $$;
