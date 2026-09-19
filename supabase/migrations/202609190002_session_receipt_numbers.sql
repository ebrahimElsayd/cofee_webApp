-- One immutable, cafe-scoped receipt per table session. Existing duplicate
-- payment rows are preserved as financial history; the earliest paid row is
-- selected as the canonical receipt for that session.
create table if not exists public.cafe_receipt_counters (
  cafe_id uuid primary key references public.cafes(id) on delete cascade,
  last_number bigint not null default 0 check (last_number >= 0)
);

create table if not exists public.session_receipts (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes(id) on delete restrict,
  session_id uuid not null references public.table_sessions(id) on delete restrict,
  payment_id uuid not null references public.payments(id) on delete restrict,
  receipt_number bigint not null check (receipt_number > 0),
  issued_at timestamptz not null default now(),
  subtotal numeric(12,2) not null,
  service_amount numeric(12,2) not null default 0,
  tax_amount numeric(12,2) not null default 0,
  grand_total numeric(12,2) not null,
  received_amount numeric(12,2),
  change_amount numeric(12,2) not null default 0,
  unique (session_id),
  unique (payment_id),
  unique (cafe_id, receipt_number)
);

alter table public.cafe_receipt_counters enable row level security;
alter table public.session_receipts enable row level security;

create policy "staff can read cafe receipts" on public.session_receipts
for select to authenticated
using (public.is_staff_user() and cafe_id = public.auth_manager_cafe_id());

with canonical as (
  select distinct on (p.session_id)
    p.id as payment_id,
    p.session_id,
    t.cafe_id,
    coalesce(p.paid_at, p.created_at) as issued_at,
    coalesce(p.subtotal, p.amount)::numeric(12,2) as subtotal,
    coalesce(p.service_amount, 0)::numeric(12,2) as service_amount,
    coalesce(p.tax_amount, 0)::numeric(12,2) as tax_amount,
    coalesce(p.grand_total, p.amount)::numeric(12,2) as grand_total,
    coalesce(p.received_amount, p.received) as received_amount,
    coalesce(p.change_amount, 0)::numeric(12,2) as change_amount
  from public.payments p
  join public.table_sessions s on s.id = p.session_id
  join public.cafe_tables t on t.id = s.table_id
  where p.status = 'paid'
  order by p.session_id, coalesce(p.paid_at, p.created_at), p.id
), numbered as (
  select canonical.*,
    row_number() over (partition by cafe_id order by issued_at, session_id)::bigint as receipt_number
  from canonical
)
insert into public.session_receipts (
  cafe_id, session_id, payment_id, receipt_number, issued_at, subtotal,
  service_amount, tax_amount, grand_total, received_amount, change_amount
)
select cafe_id, session_id, payment_id, receipt_number, issued_at, subtotal,
  service_amount, tax_amount, grand_total, received_amount, change_amount
from numbered
on conflict (session_id) do nothing;

insert into public.cafe_receipt_counters (cafe_id, last_number)
select cafe_id, max(receipt_number)
from public.session_receipts
group by cafe_id
on conflict (cafe_id) do update
set last_number = greatest(public.cafe_receipt_counters.last_number, excluded.last_number);

create or replace function public.manager_record_cash_payment(
  p_session_id uuid,
  p_apply_tax boolean default true,
  p_apply_service boolean default true,
  p_received_amount numeric default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cafe_id uuid; v_subtotal numeric(12,2); v_service_type text; v_tax_type text;
  v_service_value numeric; v_tax_value numeric; v_service_enabled boolean; v_tax_enabled boolean;
  v_service numeric(12,2); v_tax numeric(12,2); v_total numeric(12,2);
  v_change numeric(12,2) := 0; v_payment_id uuid; v_receipt_number bigint;
  v_issued_at timestamptz; v_session_status text; v_existing public.session_receipts%rowtype;
begin
  select t.cafe_id, s.status into v_cafe_id, v_session_status
  from public.table_sessions s
  join public.cafe_tables t on t.id = s.table_id
  where s.id = p_session_id
  for update of s;
  if not found then raise exception 'Session is missing' using errcode='55000'; end if;
  if not public.is_staff_user() or public.auth_manager_cafe_id() is distinct from v_cafe_id then
    raise exception 'Not authorized for this cafe' using errcode='42501';
  end if;

  select * into v_existing from public.session_receipts where session_id = p_session_id;
  if found then
    return jsonb_build_object(
      'payment_id',v_existing.payment_id,'session_id',p_session_id,
      'receipt_number',v_existing.receipt_number,'receipt_issued_at',v_existing.issued_at,
      'subtotal',v_existing.subtotal,'service_amount',v_existing.service_amount,
      'tax_amount',v_existing.tax_amount,'grand_total',v_existing.grand_total,
      'received_amount',v_existing.received_amount,'change_amount',v_existing.change_amount,
      'session_status','payment_pending','reused',true
    );
  end if;
  if v_session_status not in ('open','ordering','payment_pending') then
    raise exception 'Session is closed and has no recorded receipt' using errcode='55000';
  end if;

  perform id from public.orders where session_id=p_session_id and payment_status<>'paid' for update;
  if exists(select 1 from public.orders where session_id=p_session_id and status not in ('served','completed','cancelled')) then
    raise exception 'All active orders must be delivered before payment' using errcode='55000';
  end if;

  select coalesce(sum(oi.quantity * oi.unit_price),0)::numeric(12,2) into v_subtotal
  from public.orders o join public.order_items oi on oi.order_id=o.id
  where o.session_id=p_session_id and o.status<>'cancelled'
    and o.payment_status<>'paid' and oi.status<>'cancelled';
  if v_subtotal<=0 then raise exception 'There is no payable amount for this session' using errcode='22023'; end if;

  select service_charge_type,service_charge_value,service_charge_enabled,
    tax_charge_type,tax_charge_value,tax_charge_enabled
  into v_service_type,v_service_value,v_service_enabled,v_tax_type,v_tax_value,v_tax_enabled
  from public.cafe_settings where id=v_cafe_id;
  v_service_value := greatest(coalesce(v_service_value,0),0);
  v_tax_value := greatest(coalesce(v_tax_value,0),0);
  v_service := case when not (p_apply_service and v_service_enabled) then 0 when v_service_type='fixed' then round(v_service_value,2) else round(v_subtotal*v_service_value/100.0,2) end;
  v_tax := case when not (p_apply_tax and v_tax_enabled) then 0 when v_tax_type='fixed' then round(v_tax_value,2) else round((v_subtotal+v_service)*v_tax_value/100.0,2) end;
  v_total := round(v_subtotal+v_service+v_tax,2);
  if p_received_amount is not null and p_received_amount<v_total then raise exception 'Received amount is insufficient' using errcode='22003'; end if;
  if p_received_amount is not null then v_change:=round(p_received_amount-v_total,2); end if;

  insert into public.payments(session_id,amount,method,status,received,received_amount,change_amount,paid_by,paid_at,
    subtotal,service_amount,tax_amount,grand_total,payment_method,service_applied,tax_applied)
  values(p_session_id,v_total,'cash','paid',p_received_amount,p_received_amount,v_change,auth.uid(),now(),
    v_subtotal,v_service,v_tax,v_total,'cash',p_apply_service,p_apply_tax)
  returning id, paid_at into v_payment_id, v_issued_at;

  insert into public.cafe_receipt_counters(cafe_id,last_number) values(v_cafe_id,1)
  on conflict(cafe_id) do update set last_number=public.cafe_receipt_counters.last_number+1
  returning last_number into v_receipt_number;

  insert into public.session_receipts(cafe_id,session_id,payment_id,receipt_number,issued_at,
    subtotal,service_amount,tax_amount,grand_total,received_amount,change_amount)
  values(v_cafe_id,p_session_id,v_payment_id,v_receipt_number,v_issued_at,
    v_subtotal,v_service,v_tax,v_total,p_received_amount,v_change);

  update public.orders set payment_status='paid',updated_at=now()
    where session_id=p_session_id and status<>'cancelled' and payment_status<>'paid';
  update public.table_sessions set status='payment_pending' where id=p_session_id;
  return jsonb_build_object(
    'payment_id',v_payment_id,'session_id',p_session_id,
    'receipt_number',v_receipt_number,'receipt_issued_at',v_issued_at,
    'subtotal',v_subtotal,'service_amount',v_service,'tax_amount',v_tax,
    'grand_total',v_total,'received_amount',p_received_amount,'change_amount',v_change,
    'session_status','payment_pending','reused',false
  );
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
