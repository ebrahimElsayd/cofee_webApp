-- Make guest service requests idempotent under repeated taps and concurrent retries.
-- A resolved request may be created again; only one open request per service type
-- is allowed for a session at a time.
CREATE UNIQUE INDEX IF NOT EXISTS service_requests_one_open_request_per_type
  ON public.service_requests (session_id, type)
  WHERE status = 'open' AND type IN ('waiter', 'tissues', 'water');

CREATE OR REPLACE FUNCTION public.request_table_service(
  p_session_id uuid,
  p_type text,
  p_note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id uuid;
  v_status text;
BEGIN
  IF p_type NOT IN ('waiter', 'tissues', 'water') THEN
    RAISE EXCEPTION 'Unsupported table service';
  END IF;
  IF NOT public.is_session_member(p_session_id) THEN
    RAISE EXCEPTION 'Session is not available for this guest';
  END IF;
  SELECT status INTO v_status FROM public.table_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_status IS NULL OR v_status NOT IN ('open', 'ordering', 'payment_pending')
     OR (v_status = 'payment_pending' AND public.session_has_paid_payment(p_session_id)) THEN
    RAISE EXCEPTION 'The table session is no longer accepting service requests';
  END IF;
  SELECT id INTO v_request_id FROM public.service_requests
  WHERE session_id = p_session_id AND type = p_type AND status = 'open'
  ORDER BY created_at ASC LIMIT 1 FOR UPDATE;
  IF v_request_id IS NOT NULL THEN RETURN v_request_id; END IF;
  INSERT INTO public.service_requests (session_id, type, note)
  VALUES (p_session_id, p_type, NULLIF(trim(p_note), ''))
  RETURNING id INTO v_request_id;
  RETURN v_request_id;
EXCEPTION
  WHEN unique_violation THEN
    SELECT id INTO v_request_id FROM public.service_requests
    WHERE session_id = p_session_id AND type = p_type AND status = 'open'
    ORDER BY created_at ASC LIMIT 1;
    IF v_request_id IS NULL THEN RAISE; END IF;
    RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.request_table_service(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_table_service(uuid, text, text) TO authenticated;
