alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check
  check (type in ('order_status','service','system','customer_alert'));

comment on constraint notifications_type_check on public.notifications is
  'Notification types emitted by order, service, system and explicit customer alert workflows.';
