-- 060002 is already used by the notification migration; this migration is the
-- next immutable migration and contains the requested order/payment contract.
alter table public.cafe_settings
  add column if not exists service_percentage numeric(7,3) not null default 0 check (service_percentage >= 0),
  add column if not exists tax_percentage numeric(7,3) not null default 0 check (tax_percentage >= 0);

alter table public.payments
  add column if not exists subtotal numeric(12,2),
  add column if not exists service_amount numeric(12,2),
  add column if not exists tax_amount numeric(12,2),
  add column if not exists grand_total numeric(12,2),
  add column if not exists payment_method text,
  add column if not exists service_applied boolean not null default false,
  add column if not exists tax_applied boolean not null default false;

create or replace function public.manager_set_order_status(p_order_id uuid, p_status text)
returns public.orders language plpgsql security invoker set search_path = public as $$
declare v_order public.orders;
begin
  if p_status not in ('received','preparing','ready','served','completed','cancelled') then
    raise exception 'Invalid order status: %', p_status using errcode = '22023';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Order % was not found', p_order_id using errcode = 'P0002'; end if;
  if not ((v_order.status = 'received' and p_status in ('preparing','cancelled'))
      or (v_order.status = 'preparing' and p_status in ('ready','cancelled'))
      or (v_order.status = 'ready' and p_status = 'served')
      or (v_order.status = 'served' and p_status = 'completed')) then
    raise exception 'Invalid order transition: % -> %', v_order.status, p_status using errcode = '22023';
  end if;
  update public.orders set status=p_status, closed_at=case when p_status in ('completed','cancelled') then coalesce(closed_at,now()) else closed_at end, updated_at=now() where id=p_order_id;
  insert into public.order_status_history(order_id,from_status,to_status,changed_by) values (p_order_id,v_order.status,p_status,auth.uid());
  return (select o from public.orders o where o.id=p_order_id);
end;
$$;

create or replace function public.manager_set_order_item_status(p_order_item_id uuid,p_status text,p_note text default null)
returns public.orders language plpgsql security invoker set search_path = public as $$
declare v_item public.order_items; v_order public.orders; v_next text;
begin
  if p_status not in ('received','preparing','ready','served','cancelled') then raise exception 'Invalid item status: %',p_status using errcode='22023'; end if;
  select * into v_item from public.order_items where id=p_order_item_id for update;
  if not found then raise exception 'Order item % was not found',p_order_item_id using errcode='P0002'; end if;
  select * into v_order from public.orders where id=v_item.order_id for update;
  if not ((v_item.status='received' and p_status in ('preparing','cancelled')) or (v_item.status='preparing' and p_status in ('ready','cancelled')) or (v_item.status='ready' and p_status='served')) then
    raise exception 'Invalid item transition: % -> %',v_item.status,p_status using errcode='22023';
  end if;
  update public.order_items set status=p_status,notes=coalesce(nullif(p_note,''),notes),ready_at=case when p_status='ready' then coalesce(ready_at,now()) else ready_at end,served_at=case when p_status='served' then coalesce(served_at,now()) else served_at end where id=p_order_item_id;
  select case when bool_and(status='cancelled') then 'cancelled' when bool_and(status in ('served','completed')) then 'served' when bool_and(status in ('ready','served','completed')) then 'ready' when bool_or(status='preparing') then 'preparing' else 'received' end into v_next from public.order_items where order_id=v_item.order_id;
  if v_next <> v_order.status and not ((v_order.status='received' and v_next in ('preparing','cancelled')) or (v_order.status='preparing' and v_next in ('ready','cancelled')) or (v_order.status='ready' and v_next='served') or (v_order.status='served' and v_next='completed')) then
    raise exception 'Invalid order transition: % -> %',v_order.status,v_next using errcode='22023';
  end if;
  if v_next <> v_order.status then update public.orders set status=v_next,updated_at=now() where id=v_order.id; end if;
  insert into public.item_status_history(order_item_id,from_status,to_status,changed_by) values(p_order_item_id,v_item.status,p_status,auth.uid());
  if v_next <> v_order.status then insert into public.order_status_history(order_id,from_status,to_status,changed_by) values(v_order.id,v_order.status,v_next,auth.uid()); end if;
  return (select o from public.orders o where o.id=v_order.id);
end;
$$;

create or replace function public.manager_record_cash_payment(p_session_id uuid,p_apply_tax boolean default true,p_apply_service boolean default true)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_cafe_id uuid; v_subtotal numeric(12,2); v_service_pct numeric:=0; v_tax_pct numeric:=0; v_service numeric(12,2); v_tax numeric(12,2); v_total numeric(12,2); v_payment_id uuid;
begin
  select cafe_id into v_cafe_id from public.table_sessions s join public.cafe_tables t on t.id=s.table_id where s.id=p_session_id and s.status in ('open','ordering','payment_pending') for update;
  if not found then raise exception 'Session is missing or closed' using errcode='55000'; end if;
  perform id from public.orders where session_id=p_session_id and payment_status <> 'paid' for update;
  select coalesce(sum(total_amount),0)::numeric(12,2) into v_subtotal from public.orders where session_id=p_session_id and status <> 'cancelled' and closed_at is null;
  if v_subtotal <= 0 then raise exception 'There is no payable amount for this session' using errcode='22023'; end if;
  select service_percentage,tax_percentage into v_service_pct,v_tax_pct from public.cafe_settings where id=v_cafe_id;
  v_service := case when p_apply_service then round(v_subtotal*(coalesce(v_service_pct,0)/100.0),2) else 0 end;
  v_tax := case when p_apply_tax then round((v_subtotal+v_service)*(coalesce(v_tax_pct,0)/100.0),2) else 0 end;
  v_total := (v_subtotal+v_service+v_tax)::numeric(12,2);
  insert into public.payments(session_id,amount,method,status,paid_at,subtotal,service_amount,tax_amount,grand_total,payment_method,service_applied,tax_applied)
  values(p_session_id,v_total,'cash','paid',now(),v_subtotal,v_service,v_tax,v_total,'cash',p_apply_service,p_apply_tax) returning id into v_payment_id;
  update public.orders set payment_status='paid',status=case when status <> 'cancelled' then 'completed' else status end,closed_at=case when status <> 'cancelled' then coalesce(closed_at,now()) else closed_at end,updated_at=now() where session_id=p_session_id and payment_status <> 'paid';
  update public.table_sessions set status='closed',closed_at=now(),closed_by=auth.uid() where id=p_session_id;
  return jsonb_build_object('payment_id',v_payment_id,'session_id',p_session_id,'subtotal',v_subtotal,'service_amount',v_service,'tax_amount',v_tax,'grand_total',v_total);
end;
$$;

revoke all on function public.manager_set_order_status(uuid,text) from public;
revoke all on function public.manager_set_order_item_status(uuid,text,text) from public;
revoke all on function public.manager_record_cash_payment(uuid,boolean,boolean) from public;
grant execute on function public.manager_set_order_status(uuid,text) to authenticated;
grant execute on function public.manager_set_order_item_status(uuid,text,text) to authenticated;
grant execute on function public.manager_record_cash_payment(uuid,boolean,boolean) to authenticated;
