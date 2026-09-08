create or replace function public.manager_get_report_snapshot(
  p_start timestamptz,
  p_end timestamptz,
  p_timezone text default 'UTC'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cafe_id uuid;
  v_result jsonb;
begin
  if p_start is null or p_end is null or p_start >= p_end then
    raise exception 'Invalid report period' using errcode = '22023';
  end if;
  if not public.is_staff_user() then
    raise exception 'Staff authentication is required' using errcode = '42501';
  end if;
  v_cafe_id := public.auth_manager_cafe_id();
  if v_cafe_id is null then
    raise exception 'Staff account is not linked to a cafe' using errcode = '42501';
  end if;

  -- Validate the supplied IANA timezone before using it in aggregation.
  perform now() at time zone p_timezone;

  with payment_scope as (
    select p.session_id,
           coalesce(p.grand_total, p.amount, 0)::numeric as total,
           p.paid_at
    from public.payments p
    join public.table_sessions s on s.id = p.session_id
    join public.cafe_tables t on t.id = s.table_id
    where t.cafe_id = v_cafe_id
      and p.status = 'paid'
      and p.paid_at >= p_start
      and p.paid_at < p_end
  ), paid_sessions as (
    select distinct session_id from payment_scope
  ), paid_orders as (
    select distinct o.id
    from public.orders o
    join paid_sessions s on s.session_id = o.session_id
    where o.payment_status = 'paid' and o.status <> 'cancelled'
  ), product_totals as (
    select oi.product_name as name,
           sum(oi.quantity)::bigint as sold,
           round(sum(oi.quantity * oi.unit_price), 2) as revenue
    from public.order_items oi
    join paid_orders o on o.id = oi.order_id
    where oi.status <> 'cancelled'
    group by oi.product_name
  ), daily_totals as (
    select (p.paid_at at time zone p_timezone)::date as day,
           round(sum(p.total), 2) as amount
    from payment_scope p
    group by (p.paid_at at time zone p_timezone)::date
  )
  select jsonb_build_object(
    'totalSales', coalesce((select round(sum(total), 2) from payment_scope), 0),
    'orderCount', (select count(*) from paid_orders),
    'products', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', name,
        'arabic', '',
        'sold', sold,
        'revenue', revenue
      ) order by sold desc, revenue desc, name)
      from product_totals
    ), '[]'::jsonb),
    'chart', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', to_char(day, 'YYYY-MM-DD'),
        'amount', amount
      ) order by day)
      from daily_totals
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

create index if not exists payments_paid_at_session_idx
  on public.payments(paid_at, session_id)
  where status = 'paid';

revoke all on function public.manager_get_report_snapshot(timestamptz, timestamptz, text) from public;
grant execute on function public.manager_get_report_snapshot(timestamptz, timestamptz, text) to authenticated;

create or replace function public.manager_get_paid_revenue(p_start timestamptz, p_end timestamptz)
returns numeric
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_cafe_id uuid;
  v_total numeric;
begin
  if p_start is null or p_end is null or p_start >= p_end then
    raise exception 'Invalid revenue period' using errcode = '22023';
  end if;
  if not public.is_staff_user() then
    raise exception 'Staff authentication is required' using errcode = '42501';
  end if;
  v_cafe_id := public.auth_manager_cafe_id();
  select coalesce(round(sum(coalesce(p.grand_total, p.amount, 0)), 2), 0)
  into v_total
  from public.payments p
  join public.table_sessions s on s.id = p.session_id
  join public.cafe_tables t on t.id = s.table_id
  where t.cafe_id = v_cafe_id
    and p.status = 'paid'
    and p.paid_at >= p_start
    and p.paid_at < p_end;
  return v_total;
end;
$$;

revoke all on function public.manager_get_paid_revenue(timestamptz, timestamptz) from public;
grant execute on function public.manager_get_paid_revenue(timestamptz, timestamptz) to authenticated;
