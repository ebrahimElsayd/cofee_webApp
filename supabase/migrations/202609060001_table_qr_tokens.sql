-- Stable, revocable QR identity per cafe table. Existing cafe+table QR links remain valid during rollout.
alter table public.cafe_tables add column if not exists qr_token uuid;
update public.cafe_tables set qr_token = gen_random_uuid() where qr_token is null;
alter table public.cafe_tables alter column qr_token set default gen_random_uuid();
alter table public.cafe_tables alter column qr_token set not null;
create unique index if not exists cafe_tables_qr_token_key on public.cafe_tables(qr_token);

create or replace function public.customer_resolve_table(
  p_cafe_id uuid,
  p_table_number integer,
  p_qr_token uuid default null
)
returns table(id uuid, cafe_id uuid, table_number integer, qr_token uuid)
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  if p_cafe_id is null then raise exception 'Cafe QR scope is required' using errcode = '22023'; end if;
  if p_table_number is null or p_table_number < 1 then raise exception 'Invalid table number' using errcode = '22023'; end if;
  return query
  select t.id, t.cafe_id, t.table_number, t.qr_token
  from public.cafe_tables t
  where t.cafe_id = p_cafe_id
    and t.table_number = p_table_number
    and (p_qr_token is null or t.qr_token = p_qr_token);
end;
$$;

revoke all on function public.customer_resolve_table(uuid, integer, uuid) from public;
grant execute on function public.customer_resolve_table(uuid, integer, uuid) to authenticated;