create table if not exists public.cafe_settings (
  id uuid primary key,
  cafe_name text not null default 'King''s Cafe',
  phone text not null default '',
  currency text not null default 'EGP — Egyptian Pound',
  address text not null default '',
  logo_url text not null default ''
);

alter table public.cafe_settings add column if not exists branch_name text not null default 'Main Branch';
alter table public.cafe_settings add column if not exists updated_at timestamptz not null default now();

alter table public.cafe_settings enable row level security;

drop policy if exists "staff can read cafe settings" on public.cafe_settings;
create policy "staff can read cafe settings" on public.cafe_settings
  for select to authenticated using (public.is_staff_user());

drop policy if exists "staff can update cafe settings" on public.cafe_settings;
create policy "staff can update cafe settings" on public.cafe_settings
  for all to authenticated using (public.is_staff_user()) with check (public.is_staff_user());

insert into public.cafe_settings (id, cafe_name, phone, currency, address, logo_url, branch_name)
values ('00000000-0000-0000-0000-000000000001', 'King''s Cafe', '', 'EGP — Egyptian Pound', '', '', 'Main Branch')
on conflict (id) do nothing;
