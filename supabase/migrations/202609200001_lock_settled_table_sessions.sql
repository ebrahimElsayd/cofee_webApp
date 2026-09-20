-- A table session has exactly one settlement. Once cash is recorded the
-- session stays visible while guests leave, but accepts no more customer writes.
create or replace function public.session_accepts_customer_orders(p_session_id uuid)
returns boolean language sql stable security invoker set search_path = public as $$
  select exists (select 1 from public.table_sessions s where s.id=p_session_id and s.status in ('open','ordering'));
$$;

create or replace function public.enforce_orderable_table_session()
returns trigger language plpgsql security invoker set search_path = public as $$
declare v_session_id uuid;
begin
  v_session_id := case when tg_table_name in ('orders','carts') then new.session_id
    else (select c.session_id from public.carts c where c.id=new.cart_id) end;
  if tg_table_name='carts' and new.status<>'active' then return new; end if;
  if not public.session_accepts_customer_orders(v_session_id) then
    raise exception 'This table bill is paid. Close the visit before starting a new order.' using errcode='55000';
  end if;
  return new;
end; $$;

drop trigger if exists orders_require_orderable_session on public.orders;
create trigger orders_require_orderable_session before insert on public.orders for each row execute function public.enforce_orderable_table_session();
drop trigger if exists active_carts_require_orderable_session on public.carts;
create trigger active_carts_require_orderable_session before insert or update of status,session_id on public.carts for each row execute function public.enforce_orderable_table_session();
drop trigger if exists cart_items_require_orderable_session on public.cart_items;
create trigger cart_items_require_orderable_session before insert or update on public.cart_items for each row execute function public.enforce_orderable_table_session();

create or replace function public.abandon_cart_when_session_is_settled()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status='payment_pending' and old.status is distinct from new.status then
    update public.carts set status='abandoned' where session_id=new.id and status='active';
  end if;
  return new;
end; $$;
drop trigger if exists abandon_cart_when_session_is_settled on public.table_sessions;
create trigger abandon_cart_when_session_is_settled after update of status on public.table_sessions for each row execute function public.abandon_cart_when_session_is_settled();

drop policy if exists "members can create carts" on public.carts;
create policy "members can create carts" on public.carts for insert to authenticated
with check (public.is_session_member(session_id) and public.session_accepts_customer_orders(session_id));
drop policy if exists "members can create orders" on public.orders;
create policy "members can create orders" on public.orders for insert to authenticated
with check (public.is_session_member(session_id) and public.session_accepts_customer_orders(session_id) and (created_by is null or created_by=auth.uid()));

revoke all on function public.session_accepts_customer_orders(uuid) from public;
grant execute on function public.session_accepts_customer_orders(uuid) to authenticated;
