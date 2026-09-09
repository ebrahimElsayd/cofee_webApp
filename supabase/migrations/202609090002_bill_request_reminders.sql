-- Allow a delayed customer reminder without creating duplicate bill rows.
ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS last_reminded_at timestamptz;

CREATE OR REPLACE FUNCTION public.request_table_bill(p_session_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_id uuid;
  v_last_reminded_at timestamptz;
BEGIN
  IF NOT public.is_session_member(p_session_id) THEN
    RAISE EXCEPTION 'Session is not available for this guest';
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
