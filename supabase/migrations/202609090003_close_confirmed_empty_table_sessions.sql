-- One-time repair for tables the operator confirmed are empty.
-- The NOT EXISTS guard prevents closing a session that received an order.
with empty_sessions as (
  select s.id
  from public.table_sessions s
  join public.cafe_tables t on t.id = s.table_id
  where t.cafe_id = '00000000-0000-0000-0000-000000000001'::uuid
    and t.table_number in (12, 14, 20)
    and s.status in ('open', 'ordering', 'payment_pending')
    and not exists (
      select 1 from public.orders o where o.session_id = s.id
    )
)
update public.table_sessions s
set status = 'closed',
    closed_at = coalesce(s.closed_at, now())
where s.id in (select id from empty_sessions);

update public.cafe_tables t
set status = 'available'
where t.cafe_id = '00000000-0000-0000-0000-000000000001'::uuid
  and t.table_number in (12, 14, 20)
  and not exists (
    select 1
    from public.table_sessions s
    where s.table_id = t.id
      and s.status in ('open', 'ordering', 'payment_pending')
  );
