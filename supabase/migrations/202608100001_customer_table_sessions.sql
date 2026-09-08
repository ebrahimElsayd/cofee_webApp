create extension if not exists pgcrypto;

create table if not exists public.cafes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.cafe_tables (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes(id) on delete cascade,
  table_number integer not null check (table_number > 0),
  status text not null default 'available' check (status in ('available', 'occupied', 'cleaning', 'offline')),
  created_at timestamptz not null default now(),
  unique (cafe_id, table_number)
);

create table if not exists public.table_sessions (
  id uuid primary key default gen_random_uuid(),
  table_id uuid not null references public.cafe_tables(id) on delete restrict,
  status text not null default 'open' check (status in ('open', 'ordering', 'payment_pending', 'closed', 'cancelled')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid,
  check ((status in ('closed', 'cancelled')) = (closed_at is not null))
);

create unique index if not exists one_active_session_per_table
  on public.table_sessions (table_id)
  where status in ('open', 'ordering', 'payment_pending');

create table if not exists public.table_guests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.table_sessions(id) on delete cascade,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null default 'Guest' check (char_length(display_name) between 1 and 40),
  joined_at timestamptz not null default now(),
  unique (session_id, auth_user_id)
);

alter table public.cafes enable row level security;
alter table public.cafe_tables enable row level security;
alter table public.table_sessions enable row level security;
alter table public.table_guests enable row level security;

create policy "authenticated users can read cafes" on public.cafes for select to authenticated using (true);
create policy "authenticated users can read tables" on public.cafe_tables for select to authenticated using (true);
create policy "authenticated users can read sessions" on public.table_sessions for select to authenticated using (true);
create policy "authenticated users can create sessions" on public.table_sessions for insert to authenticated with check (true);
create policy "authenticated users can update sessions" on public.table_sessions for update to authenticated using (true) with check (true);
create policy "guests can read table guests" on public.table_guests for select to authenticated using (true);
create policy "guests can join a session" on public.table_guests for insert to authenticated with check (auth.uid() = auth_user_id);
create policy "guests can update their name" on public.table_guests for update to authenticated using (auth.uid() = auth_user_id) with check (auth.uid() = auth_user_id);

insert into public.cafes (id, name)
values ('00000000-0000-0000-0000-000000000001', 'King''s Café')
on conflict (id) do nothing;

insert into public.cafe_tables (cafe_id, table_number)
values ('00000000-0000-0000-0000-000000000001', 12)
on conflict (cafe_id, table_number) do nothing;

alter publication supabase_realtime add table public.table_sessions, public.table_guests;
