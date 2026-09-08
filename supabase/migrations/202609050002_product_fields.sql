-- Product fields used by the manager editor.
alter table public.menu_products
  add column if not exists available_for_takeaway boolean not null default true;
