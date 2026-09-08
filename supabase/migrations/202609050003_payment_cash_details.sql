-- Store the cash tender details on the single payment record for a table session.
alter table public.payments
  add column if not exists received numeric(12,2),
  add column if not exists change_amount numeric(12,2),
  add column if not exists paid_by uuid references auth.users(id) on delete set null;

comment on column public.payments.received is 'Cash received from the customer';
comment on column public.payments.change_amount is 'Change returned to the customer';

