create or replace function public.sync_table_occupancy_from_session()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('open', 'ordering', 'payment_pending') then
    update public.cafe_tables
    set status = 'occupied'
    where id = new.table_id
      and status is distinct from 'occupied';
  elsif new.status = 'closed' then
    update public.cafe_tables t
    set status = 'available'
    where t.id = new.table_id
      and not exists (
        select 1
        from public.table_sessions s
        where s.table_id = new.table_id
          and s.id <> new.id
          and s.status in ('open', 'ordering', 'payment_pending')
      )
      and t.status is distinct from 'available';
  end if;

  return new;
end;
$$;

drop trigger if exists table_sessions_sync_table_occupancy on public.table_sessions;
create trigger table_sessions_sync_table_occupancy
after insert or update of status on public.table_sessions
for each row execute function public.sync_table_occupancy_from_session();

update public.cafe_tables t
set status = case
  when exists (
    select 1
    from public.table_sessions s
    where s.table_id = t.id
      and s.status in ('open', 'ordering', 'payment_pending')
  ) then 'occupied'
  else 'available'
end;

