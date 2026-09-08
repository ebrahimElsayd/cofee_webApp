-- Payment and table departure are separate business events.
-- Payment keeps the session visible as payment_pending until the cashier
-- explicitly confirms that the customer left.
create or replace function public.manager_record_cash_payment(
  p_session_id uuid,
  p_apply_tax boolean default true,
  p_apply_service boolean default true,
  p_received_amount numeric default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_cafe_id uuid;
  v_subtotal numeric(12,2);
  v_service_pct numeric := 0;
  v_tax_pct numeric := 0;
  v_service numeric(12,2);
  v_tax numeric(12,2);
  v_total numeric(12,2);
  v_change numeric(12,2) := 0;
  v_payment_id uuid;
begin
  select t.cafe_id into v_cafe_id
  from public.table_sessions s
  join public.cafe_tables t on t.id = s.table_id
  where s.id = p_session_id and s.status in ('open','ordering','payment_pending')
  for update;
  if not found then raise exception 'Session is missing or closed' using errcode = '55000'; end if;

  perform id from public.orders
  where session_id = p_session_id and payment_status <> 'paid'
  for update;

  if exists (select 1 from public.orders where session_id = p_session_id and status not in ('served','completed','cancelled')) then
    raise exception 'All active orders must be delivered before payment' using errcode = '55000';
  end if;

  select coalesce(sum(total_amount),0)::numeric(12,2) into v_subtotal
  from public.orders
  where session_id = p_session_id and status <> 'cancelled' and payment_status <> 'paid';
  if v_subtotal <= 0 then raise exception 'There is no payable amount for this session' using errcode = '22023'; end if;

  select coalesce(service_percentage,0), coalesce(tax_percentage,0)
    into v_service_pct, v_tax_pct from public.cafe_settings where id = v_cafe_id;
  v_service := case when p_apply_service then round(v_subtotal * v_service_pct / 100.0, 2) else 0 end;
  v_tax := case when p_apply_tax then round((v_subtotal + v_service) * v_tax_pct / 100.0, 2) else 0 end;
  v_total := round(v_subtotal + v_service + v_tax, 2);
  if p_received_amount is not null and p_received_amount < v_total then
    raise exception 'Received amount is insufficient' using errcode = '22003';
  end if;
  if p_received_amount is not null then v_change := round(p_received_amount - v_total, 2); end if;

  insert into public.payments
    (session_id, amount, method, status, received, received_amount, change_amount, paid_by, paid_at,
     subtotal, service_amount, tax_amount, grand_total, payment_method, service_applied, tax_applied)
  values
    (p_session_id, v_total, 'cash', 'paid', p_received_amount, p_received_amount, v_change, auth.uid(), now(),
     v_subtotal, v_service, v_tax, v_total, 'cash', p_apply_service, p_apply_tax)
  returning id into v_payment_id;

  update public.orders
  set payment_status = 'paid', updated_at = now()
  where session_id = p_session_id and status <> 'cancelled' and payment_status <> 'paid';

  update public.table_sessions
  set status = 'payment_pending'
  where id = p_session_id;

  return jsonb_build_object('payment_id',v_payment_id,'session_id',p_session_id,'subtotal',v_subtotal,
    'service_amount',v_service,'tax_amount',v_tax,'grand_total',v_total,
    'received_amount',p_received_amount,'change_amount',v_change,'session_status','payment_pending');
end;
$$;

create or replace function public.manager_record_cash_payment(
  p_session_id uuid,
  p_apply_tax boolean default true,
  p_apply_service boolean default true
)
returns jsonb language sql security invoker set search_path = public as $$
  select public.manager_record_cash_payment(p_session_id,p_apply_tax,p_apply_service,null::numeric);
$$;

revoke all on function public.manager_record_cash_payment(uuid,boolean,boolean,numeric) from public;
revoke all on function public.manager_record_cash_payment(uuid,boolean,boolean) from public;
grant execute on function public.manager_record_cash_payment(uuid,boolean,boolean,numeric) to authenticated;
grant execute on function public.manager_record_cash_payment(uuid,boolean,boolean) to authenticated;
