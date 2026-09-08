-- Scalable customer ordering schema.  This migration is intentionally separate
-- from the table-session migration so it can be applied safely after it.

create extension if not exists pgcrypto;

create table if not exists public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes(id) on delete cascade,
  code text not null,
  name text not null,
  name_ar text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (cafe_id, code)
);

create table if not exists public.menu_products (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes(id) on delete cascade,
  category_id uuid references public.menu_categories(id) on delete set null,
  slug text not null,
  name text not null,
  name_ar text not null,
  description text,
  description_ar text,
  image_url text,
  base_price numeric(12,2) not null check (base_price >= 0),
  cost_price numeric(12,2) check (cost_price is null or cost_price >= 0),
  availability text not null default 'available' check (availability in ('available','unavailable','hidden')),
  allows_notes boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cafe_id, slug)
);

create table if not exists public.modifier_groups (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes(id) on delete cascade,
  code text not null,
  name text not null,
  name_ar text not null,
  selection_type text not null default 'single' check (selection_type in ('single','multiple','slider')),
  is_required boolean not null default false,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  unique (cafe_id, code)
);

create table if not exists public.modifier_options (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.modifier_groups(id) on delete cascade,
  code text not null,
  name text not null,
  name_ar text not null,
  price_delta numeric(12,2) not null default 0 check (price_delta >= 0),
  is_available boolean not null default true,
  sort_order integer not null default 0,
  unique (group_id, code)
);

create table if not exists public.product_modifier_groups (
  product_id uuid not null references public.menu_products(id) on delete cascade,
  group_id uuid not null references public.modifier_groups(id) on delete cascade,
  sort_order integer not null default 0,
  primary key (product_id, group_id)
);

create table if not exists public.product_availability (
  product_id uuid primary key references public.menu_products(id) on delete cascade,
  is_available boolean not null default true,
  reason text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table if not exists public.carts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.table_sessions(id) on delete cascade,
  status text not null default 'active' check (status in ('active','submitted','abandoned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists one_active_cart_per_session on public.carts(session_id) where status = 'active';

create table if not exists public.cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references public.carts(id) on delete cascade,
  guest_id uuid references public.table_guests(id) on delete set null,
  product_id uuid not null references public.menu_products(id) on delete restrict,
  recipient_name text not null default 'Guest',
  quantity integer not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  selected_options jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.table_sessions(id) on delete restrict,
  cart_id uuid references public.carts(id) on delete set null,
  order_number bigint generated always as identity unique,
  status text not null default 'received' check (status in ('received','preparing','ready','served','completed','cancelled')),
  total_amount numeric(12,2) not null default 0 check (total_amount >= 0),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','pending','paid','refunded','failed')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  guest_id uuid references public.table_guests(id) on delete set null,
  product_id uuid references public.menu_products(id) on delete set null,
  product_name text not null,
  recipient_name text not null default 'Guest',
  quantity integer not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  cost_price numeric(12,2) check (cost_price is null or cost_price >= 0),
  status text not null default 'received' check (status in ('received','preparing','ready','served','cancelled')),
  selected_options jsonb not null default '{}'::jsonb,
  notes text,
  created_at timestamptz not null default now(),
  ready_at timestamptz,
  served_at timestamptz
);

create table if not exists public.order_item_modifiers (
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  option_id uuid references public.modifier_options(id) on delete set null,
  option_name text not null,
  price_delta numeric(12,2) not null default 0,
  primary key (order_item_id, option_name)
);

create table if not exists public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.item_status_history (
  id uuid primary key default gen_random_uuid(),
  order_item_id uuid not null references public.order_items(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.table_sessions(id) on delete restrict,
  order_id uuid references public.orders(id) on delete set null,
  amount numeric(12,2) not null check (amount > 0),
  method text not null check (method in ('cash','card','wallet','online')),
  status text not null default 'pending' check (status in ('pending','paid','failed','refunded')),
  provider_reference text,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.service_requests (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.table_sessions(id) on delete cascade,
  guest_id uuid references public.table_guests(id) on delete set null,
  type text not null check (type in ('waiter','tissues','water','bill','other')),
  status text not null default 'open' check (status in ('open','acknowledged','resolved','cancelled')),
  note text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.table_sessions(id) on delete cascade,
  guest_id uuid references public.table_guests(id) on delete cascade,
  order_id uuid references public.orders(id) on delete cascade,
  type text not null check (type in ('order_status','service','system')),
  title text not null,
  body text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  cafe_id uuid not null references public.cafes(id) on delete cascade,
  name text not null,
  unit text not null default 'unit',
  current_quantity numeric(12,3) not null default 0,
  reorder_level numeric(12,3) not null default 0,
  cost_per_unit numeric(12,2) not null default 0,
  is_active boolean not null default true,
  unique (cafe_id, name)
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items(id) on delete cascade,
  quantity_delta numeric(12,3) not null,
  reason text not null check (reason in ('purchase','sale','waste','adjustment','return')),
  order_id uuid references public.orders(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists menu_products_cafe_category_idx on public.menu_products(cafe_id, category_id, availability);
create index if not exists cart_items_cart_idx on public.cart_items(cart_id, created_at);
create index if not exists orders_session_created_idx on public.orders(session_id, created_at desc);
create index if not exists order_items_order_status_idx on public.order_items(order_id, status);
create index if not exists notifications_guest_idx on public.notifications(guest_id, created_at desc);
create index if not exists service_requests_session_idx on public.service_requests(session_id, created_at desc);

create or replace function public.is_session_member(p_session_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (
  select 1 from public.table_guests g
  where g.session_id = p_session_id and g.auth_user_id = auth.uid()
); $$;

alter table public.menu_categories enable row level security;
alter table public.menu_products enable row level security;
alter table public.modifier_groups enable row level security;
alter table public.modifier_options enable row level security;
alter table public.product_modifier_groups enable row level security;
alter table public.product_availability enable row level security;
alter table public.carts enable row level security;
alter table public.cart_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_item_modifiers enable row level security;
alter table public.order_status_history enable row level security;
alter table public.item_status_history enable row level security;
alter table public.payments enable row level security;
alter table public.service_requests enable row level security;
alter table public.notifications enable row level security;
alter table public.inventory_items enable row level security;
alter table public.stock_movements enable row level security;

create policy "authenticated can read active catalog" on public.menu_categories for select to authenticated using (is_active);
create policy "authenticated can read products" on public.menu_products for select to authenticated using (availability <> 'hidden');
create policy "authenticated can read modifier groups" on public.modifier_groups for select to authenticated using (is_active);
create policy "authenticated can read modifier options" on public.modifier_options for select to authenticated using (true);
create policy "authenticated can read product modifiers" on public.product_modifier_groups for select to authenticated using (true);
create policy "authenticated can read availability" on public.product_availability for select to authenticated using (true);

create policy "members can read carts" on public.carts for select to authenticated using (public.is_session_member(session_id));
create policy "members can create carts" on public.carts for insert to authenticated with check (public.is_session_member(session_id));
create policy "members can update carts" on public.carts for update to authenticated using (public.is_session_member(session_id)) with check (public.is_session_member(session_id));
create policy "members can read cart items" on public.cart_items for select to authenticated using (exists (select 1 from public.carts c where c.id = cart_id and public.is_session_member(c.session_id)));
create policy "members can write cart items" on public.cart_items for all to authenticated using (exists (select 1 from public.carts c where c.id = cart_id and public.is_session_member(c.session_id))) with check (exists (select 1 from public.carts c where c.id = cart_id and public.is_session_member(c.session_id)));

create policy "members can read orders" on public.orders for select to authenticated using (public.is_session_member(session_id));
create policy "members can create orders" on public.orders for insert to authenticated with check (public.is_session_member(session_id) and (created_by is null or created_by = auth.uid()));
create policy "members can read order items" on public.order_items for select to authenticated using (exists (select 1 from public.orders o where o.id = order_id and public.is_session_member(o.session_id)));
create policy "members can read order history" on public.order_status_history for select to authenticated using (exists (select 1 from public.orders o where o.id = order_id and public.is_session_member(o.session_id)));
create policy "members can read item history" on public.item_status_history for select to authenticated using (exists (select 1 from public.order_items i join public.orders o on o.id = i.order_id where i.id = order_item_id and public.is_session_member(o.session_id)));
create policy "members can read payments" on public.payments for select to authenticated using (public.is_session_member(session_id));
create policy "members can read services" on public.service_requests for select to authenticated using (public.is_session_member(session_id));
create policy "members can create services" on public.service_requests for insert to authenticated with check (public.is_session_member(session_id));
create policy "members can read notifications" on public.notifications for select to authenticated using (guest_id is null or exists (select 1 from public.table_guests g where g.id = guest_id and g.auth_user_id = auth.uid()) or (session_id is not null and public.is_session_member(session_id)));
create policy "members can update notifications" on public.notifications for update to authenticated using (guest_id is null or exists (select 1 from public.table_guests g where g.id = guest_id and g.auth_user_id = auth.uid()));

-- Realtime is used only for live customer tracking and service updates.
do $$ begin
  begin alter publication supabase_realtime add table public.orders; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.order_items; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.service_requests; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.notifications; exception when duplicate_object then null; end;
end $$;

-- Initial catalog categories. Products and modifiers are seeded by the app's
-- catalog import so the same source can be reused by the barista dashboard.
insert into public.menu_categories (cafe_id, code, name, name_ar, sort_order)
select '00000000-0000-0000-0000-000000000001', v.code, v.name, v.name_ar, v.sort_order
from (values
  ('espresso','Espresso','إسبريسو',1),
  ('tea','Tea','شاي',2),
  ('cold','Cold','بارد',3),
  ('soft-drinks','Soft Drinks','مشروبات',4),
  ('specialty','Specialty','مميز',5),
  ('food','Food','طعام',6)
) v(code,name,name_ar,sort_order)
on conflict (cafe_id, code) do update set name = excluded.name, name_ar = excluded.name_ar, sort_order = excluded.sort_order;
