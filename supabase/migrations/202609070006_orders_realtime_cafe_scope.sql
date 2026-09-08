alter table public.orders
  add column if not exists cafe_id uuid references public.cafes(id) on delete restrict;

update public.orders o
set cafe_id = ct.cafe_id
from public.table_sessions ts
join public.cafe_tables ct on ct.id = ts.table_id
where ts.id = o.session_id
  and o.cafe_id is null;

alter table public.orders alter column cafe_id set not null;
create index if not exists orders_cafe_created_idx on public.orders(cafe_id, created_at desc);

create or replace function public.set_order_cafe_from_session()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  select ct.cafe_id into new.cafe_id
  from public.table_sessions ts
  join public.cafe_tables ct on ct.id = ts.table_id
  where ts.id = new.session_id;
  if new.cafe_id is null then
    raise exception 'Order session is invalid';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_set_cafe_from_session on public.orders;
create trigger orders_set_cafe_from_session
before insert or update of session_id on public.orders
for each row execute function public.set_order_cafe_from_session();

alter table public.orders replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;
