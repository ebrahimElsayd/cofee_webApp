-- Bill requests must be rejected once the session is settled or closed.
-- The existing unique index/RPC still deduplicates concurrent open requests.
-- service_requests_one_open_bill_per_session is created by the preceding migration.
CREATE OR REPLACE FUNCTION public.request_table_bill(p_session_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id uuid;
  v_last_reminded_at timestamptz;
  v_status text;
BEGIN
  IF NOT public.is_session_member(p_session_id) THEN
    RAISE EXCEPTION 'Session is not available for this guest';
  END IF;

  SELECT status INTO v_status
  FROM public.table_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF v_status IS NULL OR NOT (
    v_status IN ('open', 'ordering')
    OR (v_status = 'payment_pending' AND NOT public.session_has_paid_payment(p_session_id))
  ) THEN
    RAISE EXCEPTION 'The table session is no longer accepting bill requests';
  END IF;

  SELECT id, last_reminded_at INTO v_request_id, v_last_reminded_at
  FROM public.service_requests
  WHERE session_id = p_session_id AND type = 'bill' AND status = 'open'
  ORDER BY created_at ASC LIMIT 1 FOR UPDATE;

  IF v_request_id IS NOT NULL THEN
    IF v_last_reminded_at IS NULL OR v_last_reminded_at <= now() - interval '60 seconds' THEN
      UPDATE public.service_requests SET last_reminded_at = now() WHERE id = v_request_id;
    END IF;
    RETURN v_request_id;
  END IF;

  INSERT INTO public.service_requests (session_id, type, last_reminded_at)
  VALUES (p_session_id, 'bill', NULL)
  RETURNING id INTO v_request_id;
  RETURN v_request_id;
EXCEPTION
  WHEN unique_violation THEN
    SELECT id INTO v_request_id FROM public.service_requests
    WHERE session_id = p_session_id AND type = 'bill' AND status = 'open'
    ORDER BY created_at ASC LIMIT 1;
    IF v_request_id IS NULL THEN RAISE; END IF;
    RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.request_table_bill(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_table_bill(uuid) TO authenticated;
