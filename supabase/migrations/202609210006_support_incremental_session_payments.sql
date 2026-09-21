-- Support a safe recovery path for legacy sessions that received a payment
-- before all of their orders were added. New customer writes remain blocked
-- after the first payment by session_accepts_customer_orders().

alter table public.session_receipts
  drop constraint if exists session_receipts_session_id_key;

create or replace function public.manager_record_cash_payment(
  p_session_id uuid,
  p_apply_tax boolean default true,
  p_apply_service boolean default true,
  p_received_amount numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cafe_id uuid;
  v_subtotal numeric(12,2);
  v_service_type text;
  v_tax_type text;
  v_service_value numeric;
  v_tax_value numeric;
  v_service_enabled boolean;
  v_tax_enabled boolean;
  v_service numeric(12,2);
  v_tax numeric(12,2);
  v_total numeric(12,2);
  v_change numeric(12,2) := 0;
  v_payment_id uuid;
  v_receipt_number bigint;
  v_issued_at timestamptz;
  v_session_status text;
  v_existing public.session_receipts%rowtype;
begin
  select t.cafe_id, s.status
    into v_cafe_id, v_session_status
  from public.table_sessions s
  join public.cafe_tables t on t.id = s.table_id
  where s.id = p_session_id
  for update of s;

  if not found then
    raise exception 'Session is missing' using errcode = '55000';
  end if;
  if not public.is_staff_user()
     or public.auth_manager_cafe_id() is distinct from v_cafe_id then
    raise exception 'Not authorized for this cafe' using errcode = '42501';
  end if;
  if v_session_status not in ('open','ordering','payment_pending') then
    raise exception 'Session is closed and has no payable balance' using errcode = '55000';
  end if;

  perform id
  from public.orders
  where session_id = p_session_id and payment_status <> 'paid'
  for update;

  if exists (
    select 1 from public.orders
    where session_id = p_session_id
      and status not in ('served','completed','cancelled')
  ) then
    raise exception 'All active orders must be delivered before payment' using errcode = '55000';
  end if;

  select coalesce(sum(oi.quantity * oi.unit_price), 0)::numeric(12,2)
    into v_subtotal
  from public.orders o
  join public.order_items oi on oi.order_id = o.id
  where o.session_id = p_session_id
    and o.status <> 'cancelled'
    and o.payment_status <> 'paid'
    and oi.status <> 'cancelled';

  if v_subtotal <= 0 then
    select * into v_existing
    from public.session_receipts
    where session_id = p_session_id
    order by issued_at desc, id desc
    limit 1;
    if found then
      return jsonb_build_object(
        'payment_id', v_existing.payment_id,
        'session_id', p_session_id,
        'receipt_number', v_existing.receipt_number,
        'receipt_issued_at', v_existing.issued_at,
        'subtotal', v_existing.subtotal,
        'service_amount', v_existing.service_amount,
        'tax_amount', v_existing.tax_amount,
        'grand_total', v_existing.grand_total,
        'received_amount', v_existing.received_amount,
        'change_amount', v_existing.change_amount,
        'session_status', 'payment_pending',
        'reused', true
      );
    end if;
    raise exception 'There is no payable amount for this session' using errcode = '22023';
  end if;

  select service_charge_type, service_charge_value, service_charge_enabled,
         tax_charge_type, tax_charge_value, tax_charge_enabled
    into v_service_type, v_service_value, v_service_enabled,
         v_tax_type, v_tax_value, v_tax_enabled
  from public.cafe_settings
  where id = v_cafe_id;

  v_service_value := greatest(coalesce(v_service_value, 0), 0);
  v_tax_value := greatest(coalesce(v_tax_value, 0), 0);
  v_service := case
    when not (p_apply_service and v_service_enabled) then 0
    when v_service_type = 'fixed' then round(v_service_value, 2)
    else round(v_subtotal * v_service_value / 100.0, 2)
  end;
  v_tax := case
    when not (p_apply_tax and v_tax_enabled) then 0
    when v_tax_type = 'fixed' then round(v_tax_value, 2)
    else round((v_subtotal + v_service) * v_tax_value / 100.0, 2)
  end;
  v_total := round(v_subtotal + v_service + v_tax, 2);

  if p_received_amount is not null and p_received_amount < v_total then
    raise exception 'Received amount is insufficient' using errcode = '22003';
  end if;
  if p_received_amount is not null then
    v_change := round(p_received_amount - v_total, 2);
  end if;

  insert into public.payments(
    session_id, amount, method, status, received, received_amount,
    change_amount, paid_by, paid_at, subtotal, service_amount, tax_amount,
    grand_total, payment_method, service_applied, tax_applied
  ) values (
    p_session_id, v_total, 'cash', 'paid', p_received_amount,
    p_received_amount, v_change, auth.uid(), now(), v_subtotal,
    v_service, v_tax, v_total, 'cash', p_apply_service, p_apply_tax
  ) returning id, paid_at into v_payment_id, v_issued_at;

  insert into public.cafe_receipt_counters(cafe_id, last_number)
    values (v_cafe_id, 1)
    on conflict(cafe_id) do update
      set last_number = public.cafe_receipt_counters.last_number + 1
    returning last_number into v_receipt_number;

  insert into public.session_receipts(
    cafe_id, session_id, payment_id, receipt_number, issued_at, subtotal,
    service_amount, tax_amount, grand_total, received_amount, change_amount
  ) values (
    v_cafe_id, p_session_id, v_payment_id, v_receipt_number, v_issued_at,
    v_subtotal, v_service, v_tax, v_total, p_received_amount, v_change
  );

  update public.orders
  set payment_status = 'paid', updated_at = now()
  where session_id = p_session_id
    and status <> 'cancelled'
    and payment_status <> 'paid';

  update public.table_sessions
  set status = 'payment_pending'
  where id = p_session_id;

  return jsonb_build_object(
    'payment_id', v_payment_id,
    'session_id', p_session_id,
    'receipt_number', v_receipt_number,
    'receipt_issued_at', v_issued_at,
    'subtotal', v_subtotal,
    'service_amount', v_service,
    'tax_amount', v_tax,
    'grand_total', v_total,
    'received_amount', p_received_amount,
    'change_amount', v_change,
    'session_status', 'payment_pending',
    'reused', false
  );
end;
$$;

revoke all on function public.manager_record_cash_payment(uuid,boolean,boolean,numeric) from public;
grant execute on function public.manager_record_cash_payment(uuid,boolean,boolean,numeric) to authenticated;
