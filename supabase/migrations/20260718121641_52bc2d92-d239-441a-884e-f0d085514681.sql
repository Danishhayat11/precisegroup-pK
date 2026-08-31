
-- 1) active_project_code: only allow self-lookup
CREATE OR REPLACE FUNCTION public.active_project_code(_uid uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT active_project_code
  FROM public.profiles
  WHERE id = _uid
    AND _uid = auth.uid()
$function$;

-- 2) booking_project_code: tenant-scoped
CREATE OR REPLACE FUNCTION public.booking_project_code(_booking_id text)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT project_code
  FROM public.bookings
  WHERE booking_id = _booking_id
    AND (company_id = public.current_company_id()
         OR public.is_super_admin(auth.uid()))
$function$;

-- 3) list_admin_contacts: scope to current company
CREATE OR REPLACE FUNCTION public.list_admin_contacts()
RETURNS TABLE(email text, full_name text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid := public.current_company_id();
BEGIN
  IF auth.uid() IS NULL OR v_company IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT p.email, p.full_name
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id
  WHERE ur.role = 'admin'
    AND ur.company_id = v_company
    AND p.company_id = v_company
  ORDER BY p.full_name NULLS LAST;
END
$function$;

-- 4) next_adjustment_id: require writer role
CREATE OR REPLACE FUNCTION public.next_adjustment_id()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_writer(auth.uid()) THEN
    RAISE EXCEPTION 'writer role required' USING ERRCODE='42501';
  END IF;
  RETURN 'ADJ-' || lpad(nextval('public.adjustments_seq')::text, 6, '0');
END
$function$;

-- 5) recalc_maintenance_charge: require writer + tenant match
CREATE OR REPLACE FUNCTION public.recalc_maintenance_charge(_charge_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_paid NUMERIC := 0;
  v_max_date DATE;
  v_row public.maintenance_charges;
  v_today DATE := CURRENT_DATE;
  v_effective_total NUMERIC;
  v_new_status TEXT;
  v_late_fee_waived BOOLEAN := FALSE;
  v_company uuid;
  v_is_super boolean := public.is_super_admin(auth.uid());
BEGIN
  IF NOT public.is_writer(auth.uid()) AND NOT v_is_super THEN
    RAISE EXCEPTION 'writer role required' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_row FROM public.maintenance_charges WHERE charge_id = _charge_id;
  IF v_row.id IS NULL THEN RETURN; END IF;

  -- Enforce tenant scope via the parent project (maintenance_charges has no company_id column;
  -- projects.project_code is company-scoped).
  SELECT company_id INTO v_company
  FROM public.projects
  WHERE project_code = v_row.project_code;

  IF NOT v_is_super AND v_company IS DISTINCT FROM public.current_company_id() THEN
    RAISE EXCEPTION 'charge does not belong to current company' USING ERRCODE='42501';
  END IF;

  SELECT COALESCE(SUM(amount_paid),0), MAX(payment_date),
         bool_or(late_fee_waived)
    INTO v_paid, v_max_date, v_late_fee_waived
  FROM public.maintenance_payments WHERE charge_id = _charge_id;

  v_effective_total := v_row.amount_due + CASE WHEN v_late_fee_waived THEN 0 ELSE v_row.late_fee END;

  IF v_row.waived THEN
    v_new_status := 'Waived';
  ELSIF v_paid >= v_effective_total AND v_effective_total > 0 THEN
    v_new_status := 'Paid';
  ELSIF v_paid > 0 THEN
    v_new_status := 'Partial';
  ELSIF v_row.due_date < v_today THEN
    v_new_status := 'Overdue';
  ELSIF v_row.due_date <= v_today + 7 THEN
    v_new_status := 'Due Soon';
  ELSE
    v_new_status := 'Upcoming';
  END IF;

  UPDATE public.maintenance_charges
     SET paid_amount = v_paid,
         paid_date = v_max_date,
         total_due = v_effective_total,
         balance = GREATEST(0::numeric, v_effective_total - v_paid),
         status = v_new_status,
         updated_at = now()
   WHERE charge_id = _charge_id;
END
$function$;

-- 6) Revoke direct EXECUTE on the internal ledger helper (only server-side callers use it)
REVOKE EXECUTE ON FUNCTION public.recalculate_ledger_for_booking_internal(text) FROM PUBLIC, anon, authenticated;

-- 7) Revoke EXECUTE on trigger-only functions (they still run via triggers as the definer)
REVOKE EXECUTE ON FUNCTION public.audit_companies_changes() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_push_subscriptions_company_id() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_super_admin_grant() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_company_id_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_adjustments_derive_lossgain() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_recalc_maintenance_charge() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_sync_booking_adjustment_credit() FROM PUBLIC, anon, authenticated;
