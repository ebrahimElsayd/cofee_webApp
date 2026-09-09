-- One-time repair for the current cafe after the operator confirmed that
-- tables 12, 14 and 20 are empty. Financial and workflow guards remain intact.
with target_cafes as (
  select id
  from public.cafe_settings
  where cafe_name = 'ابراهيم'
    and branch_name = 'ثلغحف'
), closable_sessions as (
  select s.id
  from public.table_sessions s
  join public.cafe_tables t on t.id = s.table_id
  where t.cafe_id in (select id from target_cafes)
    and t.table_number in (12, 14, 20)
    and s.status in ('open', 'ordering', 'payment_pending')
    and not exists (
      select 1
      from public.orders o
      where o.session_id = s.id
        and o.status not in ('served', 'completed', 'cancelled')
    )
    and not exists (
      select 1
      from public.orders o
      where o.session_id = s.id
        and o.status <> 'cancelled'
        and o.payment_status <> 'paid'
    )
)
update public.table_sessions s
set status = 'closed',
    closed_at = coalesce(s.closed_at, now())
where s.id in (select id from closable_sessions);

with target_cafes as (
  select id
  from public.cafe_settings
  where cafe_name = 'ابراهيم'
    and branch_name = 'ثلغحف'
)
update public.cafe_tables t
set status = 'available'
where t.cafe_id in (select id from target_cafes)
  and t.table_number in (12, 14, 20)
  and not exists (
    select 1
    from public.table_sessions s
    where s.table_id = t.id
      and s.status in ('open', 'ordering', 'payment_pending')
  );
