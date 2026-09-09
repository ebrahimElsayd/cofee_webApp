-- Keep one active bill request per table session. Repeated taps/retries are
-- idempotent and must not create multiple cashier alerts.
WITH duplicate_bill_requests AS (
  SELECT id,
         row_number() OVER (PARTITION BY session_id, type ORDER BY created_at, id) AS request_rank
  FROM public.service_requests
  WHERE type = 'bill' AND status = 'open'
)
UPDATE public.service_requests AS requests
SET status = 'cancelled',
    note = concat_ws(' ', nullif(requests.note, ''), '[duplicate bill request]')
FROM duplicate_bill_requests AS duplicates
WHERE requests.id = duplicates.id
  AND duplicates.request_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS service_requests_one_open_bill_per_session
  ON public.service_requests (session_id, type)
  WHERE status = 'open' AND type = 'bill';
