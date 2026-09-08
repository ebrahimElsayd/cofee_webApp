-- Production hardening: cash tender integrity, permanent idempotency and tenant isolation.

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS received_amount numeric(12,2);

CREATE UNIQUE INDEX IF NOT EXISTS orders_session_idempotency_key_uidx
  ON public.orders (session_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.manager_record_cash_payment(
  p_session_id uuid,
  p_apply_tax boolean DEFAULT true,
  p_apply_service boolean DEFAULT true,
  p_received_amount numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_cafe_id uuid;
  v_subtotal numeric(12,2);
  v_service_pct numeric := 0;
  v_tax_pct numeric := 0;
  v_service numeric(12,2);
  v_tax numeric(12,2);
  v_total numeric(12,2);
  v_change numeric(12,2) := 0;
  v_payment_id uuid;
BEGIN
  SELECT t.cafe_id INTO v_cafe_id
  FROM public.table_sessions s
  JOIN public.cafe_tables t ON t.id = s.table_id
  WHERE s.id = p_session_id
    AND s.status IN ('open', 'ordering', 'payment_pending')
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Session is missing or closed' USING ERRCODE = '55000';
  END IF;

  PERFORM id FROM public.orders
  WHERE session_id = p_session_id AND payment_status <> 'paid'
  FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE session_id = p_session_id
      AND status NOT IN ('served', 'completed', 'cancelled')
  ) THEN
    RAISE EXCEPTION 'All active orders must be delivered before payment' USING ERRCODE = '55000';
  END IF;

  SELECT COALESCE(SUM(total_amount), 0)::numeric(12,2) INTO v_subtotal
  FROM public.orders
  WHERE session_id = p_session_id
    AND status <> 'cancelled'
    AND payment_status <> 'paid';
  IF v_subtotal <= 0 THEN
    RAISE EXCEPTION 'There is no payable amount for this session' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(service_percentage, 0), COALESCE(tax_percentage, 0)
    INTO v_service_pct, v_tax_pct
  FROM public.cafe_settings
  WHERE id = v_cafe_id;

  v_service := CASE WHEN p_apply_service
    THEN ROUND(v_subtotal * v_service_pct / 100.0, 2) ELSE 0 END;
  v_tax := CASE WHEN p_apply_tax
    THEN ROUND((v_subtotal + v_service) * v_tax_pct / 100.0, 2) ELSE 0 END;
  v_total := ROUND(v_subtotal + v_service + v_tax, 2);

  IF p_received_amount IS NOT NULL AND p_received_amount < v_total THEN
    RAISE EXCEPTION 'Received amount is insufficient' USING ERRCODE = '22003';
  END IF;
  IF p_received_amount IS NOT NULL THEN
    v_change := ROUND(p_received_amount - v_total, 2);
  END IF;

  INSERT INTO public.payments
    (session_id, amount, method, status, received, received_amount, change_amount,
     paid_by, paid_at, subtotal, service_amount, tax_amount, grand_total,
     payment_method, service_applied, tax_applied)
  VALUES
    (p_session_id, v_total, 'cash', 'paid', p_received_amount, p_received_amount,
     v_change, auth.uid(), now(), v_subtotal, v_service, v_tax, v_total,
     'cash', p_apply_service, p_apply_tax)
  RETURNING id INTO v_payment_id;

  UPDATE public.orders
  SET payment_status = 'paid', status = 'completed', closed_at = COALESCE(closed_at, now()), updated_at = now()
  WHERE session_id = p_session_id
    AND status <> 'cancelled'
    AND payment_status <> 'paid';

  UPDATE public.table_sessions
  SET status = 'closed', closed_at = now(), closed_by = auth.uid()
  WHERE id = p_session_id;

  RETURN jsonb_build_object(
    'payment_id', v_payment_id,
    'session_id', p_session_id,
    'subtotal', v_subtotal,
    'service_amount', v_service,
    'tax_amount', v_tax,
    'grand_total', v_total,
    'received_amount', p_received_amount,
    'change_amount', v_change
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.manager_record_cash_payment(
  p_session_id uuid,
  p_apply_tax boolean DEFAULT true,
  p_apply_service boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT public.manager_record_cash_payment(p_session_id, p_apply_tax, p_apply_service, NULL::numeric);
$$;

REVOKE ALL ON FUNCTION public.manager_record_cash_payment(uuid, boolean, boolean, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.manager_record_cash_payment(uuid, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.manager_record_cash_payment(uuid, boolean, boolean, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.manager_record_cash_payment(uuid, boolean, boolean) TO authenticated;

-- Remove broad legacy member/staff policies before recreating mutually exclusive scopes.
DROP POLICY IF EXISTS "members can read notifications" ON public.notifications;
DROP POLICY IF EXISTS "members can update notifications" ON public.notifications;
DROP POLICY IF EXISTS "members and staff can read notifications" ON public.notifications;
DROP POLICY IF EXISTS "members and staff can update notifications" ON public.notifications;
DROP POLICY IF EXISTS "members can read session notifications" ON public.notifications;
DROP POLICY IF EXISTS "members can update session notifications" ON public.notifications;
DROP POLICY IF EXISTS "staff can read cafe notifications" ON public.notifications;
DROP POLICY IF EXISTS "staff can update cafe notifications" ON public.notifications;
DROP POLICY IF EXISTS "manager can read cafe notifications" ON public.notifications;
DROP POLICY IF EXISTS "manager can update cafe notifications" ON public.notifications;
DROP POLICY IF EXISTS "manager can insert cafe notifications" ON public.notifications;
DROP POLICY IF EXISTS "members can read services" ON public.service_requests;
DROP POLICY IF EXISTS "members can create services" ON public.service_requests;
DROP POLICY IF EXISTS "members can read service requests" ON public.service_requests;
DROP POLICY IF EXISTS "members can create service requests" ON public.service_requests;
DROP POLICY IF EXISTS "manager can read cafe service requests" ON public.service_requests;
DROP POLICY IF EXISTS "manager can update cafe service requests" ON public.service_requests;

CREATE POLICY "manager read cafe notifications" ON public.notifications
  FOR SELECT TO authenticated
  USING (public.is_staff_user() AND cafe_id = public.auth_manager_cafe_id());
CREATE POLICY "manager update cafe notifications" ON public.notifications
  FOR UPDATE TO authenticated
  USING (public.is_staff_user() AND cafe_id = public.auth_manager_cafe_id())
  WITH CHECK (public.is_staff_user() AND cafe_id = public.auth_manager_cafe_id());
CREATE POLICY "manager insert cafe notifications" ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (public.is_staff_user() AND cafe_id = public.auth_manager_cafe_id());
CREATE POLICY "guest read active session notifications" ON public.notifications
  FOR SELECT TO authenticated
  USING (NOT public.is_staff_user() AND session_id IS NOT NULL AND public.is_session_member(session_id)
    AND EXISTS (SELECT 1 FROM public.table_sessions s WHERE s.id = session_id AND s.status IN ('open','ordering','payment_pending')));
CREATE POLICY "guest update active session notifications" ON public.notifications
  FOR UPDATE TO authenticated
  USING (NOT public.is_staff_user() AND session_id IS NOT NULL AND public.is_session_member(session_id)
    AND EXISTS (SELECT 1 FROM public.table_sessions s WHERE s.id = session_id AND s.status IN ('open','ordering','payment_pending')))
  WITH CHECK (NOT public.is_staff_user() AND session_id IS NOT NULL AND public.is_session_member(session_id));

CREATE POLICY "manager read cafe service requests" ON public.service_requests
  FOR SELECT TO authenticated
  USING (public.is_staff_user() AND cafe_id = public.auth_manager_cafe_id());
CREATE POLICY "manager update cafe service requests" ON public.service_requests
  FOR UPDATE TO authenticated
  USING (public.is_staff_user() AND cafe_id = public.auth_manager_cafe_id())
  WITH CHECK (public.is_staff_user() AND cafe_id = public.auth_manager_cafe_id());
CREATE POLICY "guest read active service requests" ON public.service_requests
  FOR SELECT TO authenticated
  USING (NOT public.is_staff_user() AND public.is_session_member(session_id)
    AND EXISTS (SELECT 1 FROM public.table_sessions s WHERE s.id = session_id AND s.status IN ('open','ordering','payment_pending')));
CREATE POLICY "guest create active service requests" ON public.service_requests
  FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_staff_user() AND public.is_session_member(session_id)
    AND EXISTS (SELECT 1 FROM public.table_sessions s WHERE s.id = session_id AND s.status IN ('open','ordering','payment_pending')));
