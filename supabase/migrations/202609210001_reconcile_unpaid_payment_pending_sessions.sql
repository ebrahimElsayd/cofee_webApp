-- A payment_pending marker is only a settlement lock when a paid payment exists.
-- This repairs stale markers without weakening the lock for real payments.
create or replace function public.session_has_paid_payment(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.payments p
    where p.session_id = p_session_id and p.status = 'paid'
  );
$$;

revoke all on function public.session_has_paid_payment(uuid) from public;
grant execute on function public.session_has_paid_payment(uuid) to authenticated;

create or replace function public.session_accepts_customer_orders(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.table_sessions s
    where s.id = p_session_id
      and (
        s.status in ('open', 'ordering')
        or (s.status = 'payment_pending' and not public.session_has_paid_payment(s.id))
      )
  );
$$;

revoke all on function public.session_accepts_customer_orders(uuid) from public;
grant execute on function public.session_accepts_customer_orders(uuid) to authenticated;
