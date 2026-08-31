
-- 1. recompute_all_bookings: admin only
CREATE OR REPLACE FUNCTION public.recompute_all_bookings()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r record; n integer := 0;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE='42501';
  END IF;
  FOR r IN SELECT booking_id FROM public.bookings LOOP
    PERFORM public.recalculate_ledger_for_booking(r.booking_id);
    n := n + 1;
  END LOOP;
  RETURN n;
END $function$;

-- 2. recalculate_ledger_for_booking: writers (admin/manager/staff)
CREATE OR REPLACE FUNCTION public.recalculate_ledger_for_booking(_booking_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := public.get_system_date();
  v_cash numeric := 0;
  v_adj  numeric := 0;
  v_effective numeric := 0;
  v_contract  numeric := 0;
  v_booking_date date;
  v_manual_total numeric := 0;
  v_auto_pool numeric := 0;
BEGIN
  IF _booking_id IS NULL THEN RETURN; END IF;
  IF NOT public.is_writer(auth.uid()) THEN
    RAISE EXCEPTION 'writer role required' USING ERRCODE='42501';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_cash
  FROM public.payments
  WHERE booking_id = _booking_id
    AND COALESCE(cash_bank_include, true) = true
    AND COALESCE(status, 'Posted') <> 'Cancelled';

  SELECT COALESCE(adjustment_credit, 0), COALESCE(total_contract_value, 0), booking_date
    INTO v_adj, v_contract, v_booking_date
  FROM public.bookings WHERE booking_id = _booking_id;

  v_effective := v_cash + COALESCE(v_adj, 0);

  SELECT COALESCE(SUM(pa.amount), 0) INTO v_manual_total
  FROM public.payment_allocations pa
  JOIN public.payments p ON p.receipt_no = pa.receipt_no
  WHERE p.booking_id = _booking_id
    AND COALESCE(p.status, 'Posted') <> 'Cancelled';

  v_auto_pool := GREATEST(0::numeric, v_effective - v_manual_total);

  WITH manual AS (
    SELECT il.ledger_id, COALESCE(SUM(pa.amount), 0) AS manual_paid,
           MAX(p.payment_date) AS manual_max_date
    FROM public.installment_ledger il
    LEFT JOIN public.payment_allocations pa ON pa.ledger_id = il.ledger_id
    LEFT JOIN public.payments p ON p.receipt_no = pa.receipt_no
       AND COALESCE(p.status,'Posted') <> 'Cancelled'
    WHERE il.booking_id = _booking_id
    GROUP BY il.ledger_id
  ),
  ordered AS (
    SELECT il.ledger_id, il.due_date, il.term_no,
           COALESCE(il.due_amount, 0) AS due_amount,
           COALESCE(m.manual_paid, 0) AS manual_paid,
           m.manual_max_date,
           GREATEST(0::numeric, COALESCE(il.due_amount,0) - COALESCE(m.manual_paid,0)) AS remaining_after_manual
    FROM public.installment_ledger il
    LEFT JOIN manual m ON m.ledger_id = il.ledger_id
    WHERE il.booking_id = _booking_id
  ),
  seq AS (
    SELECT o.*,
      SUM(o.remaining_after_manual) OVER (
        ORDER BY o.due_date NULLS LAST, o.term_no NULLS LAST, o.ledger_id
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS cum_rem
    FROM ordered o
  ),
  alloc AS (
    SELECT ledger_id, due_date, due_amount, manual_paid, manual_max_date,
           remaining_after_manual, cum_rem,
           GREATEST(0::numeric,
             LEAST(remaining_after_manual, v_auto_pool - (cum_rem - remaining_after_manual))
           ) AS auto_paid
    FROM seq
  )
  UPDATE public.installment_ledger l
  SET paid_amount = a.manual_paid + a.auto_paid,
      running_balance = GREATEST(0::numeric, a.due_amount - a.manual_paid - a.auto_paid),
      days_overdue = CASE
        WHEN a.due_date IS NOT NULL AND a.due_date < v_today
             AND (a.due_amount - a.manual_paid - a.auto_paid) > 0
        THEN (v_today - a.due_date) ELSE 0 END,
      status = CASE
        WHEN (a.manual_paid + a.auto_paid) >= a.due_amount AND a.due_amount > 0 THEN 'Paid'
        WHEN (a.manual_paid + a.auto_paid) > 0 AND a.due_date IS NOT NULL AND a.due_date < v_today THEN 'Partially Paid Overdue'
        WHEN (a.manual_paid + a.auto_paid) > 0 THEN 'Partially Paid'
        WHEN a.due_date IS NOT NULL AND a.due_date < v_today THEN 'Overdue'
        ELSE 'Pending'
      END,
      updated_at = now()
  FROM alloc a
  WHERE l.ledger_id = a.ledger_id;

  WITH pays AS (
    SELECT payment_date, receipt_no,
           SUM(amount) OVER (ORDER BY payment_date, receipt_no
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_paid
    FROM public.payments
    WHERE booking_id = _booking_id
      AND COALESCE(cash_bank_include, true) = true
      AND COALESCE(status, 'Posted') <> 'Cancelled'
  ),
  max_pay AS (SELECT MAX(payment_date) AS d FROM pays),
  manual AS (
    SELECT il.ledger_id, COALESCE(SUM(pa.amount), 0) AS manual_paid,
           MAX(p.payment_date) AS manual_max_date
    FROM public.installment_ledger il
    LEFT JOIN public.payment_allocations pa ON pa.ledger_id = il.ledger_id
    LEFT JOIN public.payments p ON p.receipt_no = pa.receipt_no
       AND COALESCE(p.status,'Posted') <> 'Cancelled'
    WHERE il.booking_id = _booking_id
    GROUP BY il.ledger_id
  ),
  ordered AS (
    SELECT il.ledger_id, COALESCE(il.due_amount,0) AS due_amount,
           COALESCE(m.manual_paid,0) AS manual_paid,
           m.manual_max_date,
           GREATEST(0::numeric, COALESCE(il.due_amount,0) - COALESCE(m.manual_paid,0)) AS remaining_after_manual,
           SUM(GREATEST(0::numeric, COALESCE(il.due_amount,0) - COALESCE(m.manual_paid,0))) OVER (
             ORDER BY il.due_date NULLS LAST, il.term_no NULLS LAST, il.ledger_id
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
           ) AS cum_rem
    FROM public.installment_ledger il
    LEFT JOIN manual m ON m.ledger_id = il.ledger_id
    WHERE il.booking_id = _booking_id
  ),
  row_date AS (
    SELECT o.ledger_id,
      CASE
        WHEN o.due_amount = 0 THEN NULL
        WHEN o.manual_paid >= o.due_amount THEN o.manual_max_date
        WHEN v_auto_pool >= o.cum_rem THEN COALESCE((
          SELECT p.payment_date FROM pays p
          WHERE p.cum_paid >= (o.cum_rem - GREATEST(0::numeric, v_adj - LEAST(v_adj, GREATEST(0::numeric, o.cum_rem - o.manual_paid))))
          ORDER BY p.payment_date, p.receipt_no
          LIMIT 1
        ), o.manual_max_date, v_booking_date)
        WHEN v_auto_pool > (o.cum_rem - o.remaining_after_manual) THEN COALESCE((SELECT d FROM max_pay), o.manual_max_date)
        WHEN o.manual_paid > 0 THEN o.manual_max_date
        ELSE NULL
      END AS paid_date
    FROM ordered o
  )
  UPDATE public.installment_ledger l
  SET paid_date = rd.paid_date
  FROM row_date rd
  WHERE l.ledger_id = rd.ledger_id
    AND l.paid_date IS DISTINCT FROM rd.paid_date;

  UPDATE public.bookings b
  SET cash_received = v_cash,
      remaining_balance = GREATEST(0::numeric, v_contract - v_effective),
      current_overdue_count = COALESCE((
        SELECT COUNT(*) FROM public.installment_ledger
        WHERE booking_id = _booking_id
          AND due_date IS NOT NULL AND due_date < v_today
          AND COALESCE(running_balance,0) > 0
      ), 0),
      total_overdue_amount = LEAST(
        GREATEST(0::numeric, v_contract - v_effective),
        COALESCE((
          SELECT SUM(COALESCE(running_balance,0)) FROM public.installment_ledger
          WHERE booking_id = _booking_id
            AND due_date IS NOT NULL AND due_date < v_today
            AND COALESCE(running_balance,0) > 0
        ), 0)
      ),
      oldest_overdue_date = (
        SELECT MIN(due_date) FROM public.installment_ledger
        WHERE booking_id = _booking_id AND due_date < v_today AND COALESCE(running_balance,0) > 0
      ),
      latest_overdue_date = (
        SELECT MAX(due_date) FROM public.installment_ledger
        WHERE booking_id = _booking_id AND due_date < v_today AND COALESCE(running_balance,0) > 0
      ),
      updated_at = now()
  WHERE b.booking_id = _booking_id;
END;
$function$;

-- 3. reconcile_payment_allocations: writers only (leaks balances otherwise)
CREATE OR REPLACE FUNCTION public.reconcile_payment_allocations(_receipt_no text, _booking_id text, _amount numeric, _allocations jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tol         numeric := 0.005;
  v_sum         numeric := 0;
  v_issues      jsonb   := '[]'::jsonb;
  v_row         jsonb;
  v_led_id      text;
  v_head        text;
  v_amt         numeric;
  v_due         numeric;
  v_paid        numeric;
  v_led_book    text;
  v_this_alloc  numeric;
  v_remaining   numeric;
  v_booking_out numeric;
  v_existing_this numeric := 0;
BEGIN
  IF NOT public.is_writer(auth.uid()) THEN
    RAISE EXCEPTION 'writer role required' USING ERRCODE='42501';
  END IF;
  IF _allocations IS NULL OR jsonb_typeof(_allocations) <> 'array' OR jsonb_array_length(_allocations) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'sum', 0, 'issues', '[]'::jsonb);
  END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(_allocations)
  LOOP
    v_led_id := NULLIF(v_row->>'ledger_id','');
    v_head   := COALESCE(NULLIF(v_row->>'head_label',''), '');
    v_amt    := COALESCE((v_row->>'amount')::numeric, 0);

    IF v_led_id IS NULL THEN
      v_issues := v_issues || jsonb_build_object(
        'code','MISSING_TARGET','ledger_id',NULL,'message','A row has no installment/head selected.');
      CONTINUE;
    END IF;

    IF v_amt <= 0 THEN
      v_issues := v_issues || jsonb_build_object(
        'code','NON_POSITIVE','ledger_id',v_led_id,'message','Allocation amount must be greater than zero.');
      CONTINUE;
    END IF;

    v_sum := v_sum + v_amt;

    SELECT booking_id, COALESCE(due_amount,0), COALESCE(paid_amount,0)
      INTO v_led_book, v_due, v_paid
      FROM installment_ledger WHERE ledger_id = v_led_id;

    IF NOT FOUND THEN
      v_issues := v_issues || jsonb_build_object(
        'code','UNKNOWN_LEDGER','ledger_id',v_led_id,
        'message', format('Installment %s no longer exists.', v_led_id));
      CONTINUE;
    END IF;

    IF v_led_book IS DISTINCT FROM _booking_id THEN
      v_issues := v_issues || jsonb_build_object(
        'code','WRONG_BOOKING','ledger_id',v_led_id,
        'message', format('Installment %s belongs to booking %s, not %s.', v_led_id, v_led_book, _booking_id));
      CONTINUE;
    END IF;

    SELECT COALESCE(SUM(amount),0) INTO v_existing_this
      FROM payment_allocations
     WHERE ledger_id = v_led_id
       AND (_receipt_no IS NOT NULL AND receipt_no = _receipt_no);

    v_remaining := (v_due - v_paid) + v_existing_this;
    IF v_amt > v_remaining + v_tol THEN
      v_issues := v_issues || jsonb_build_object(
        'code','OVER_INSTALLMENT','ledger_id',v_led_id,
        'due', v_due, 'already_paid', v_paid - v_existing_this,
        'headroom', GREATEST(v_remaining,0), 'proposed', v_amt,
        'message', format('Allocation exceeds this installment''s remaining balance (headroom PKR %s).',
                          to_char(GREATEST(v_remaining,0),'FM999,999,999,990.00')));
    END IF;
  END LOOP;

  IF ABS(v_sum - COALESCE(_amount,0)) > v_tol THEN
    v_issues := v_issues || jsonb_build_object(
      'code','SUM_MISMATCH','ledger_id',NULL,
      'sum', v_sum, 'expected', _amount,
      'delta', v_sum - _amount,
      'message', format('Allocation total PKR %s does not match payment amount PKR %s (off by PKR %s).',
                        to_char(v_sum,'FM999,999,999,990.00'),
                        to_char(_amount,'FM999,999,999,990.00'),
                        to_char(v_sum - _amount,'FM999,999,999,990.00')));
  END IF;

  SELECT COALESCE(SUM(due_amount - paid_amount),0) INTO v_booking_out
    FROM installment_ledger WHERE booking_id = _booking_id;

  SELECT COALESCE(SUM(amount),0) INTO v_existing_this
    FROM payment_allocations
    WHERE _receipt_no IS NOT NULL AND receipt_no = _receipt_no;

  v_this_alloc := v_sum;
  IF v_this_alloc > v_booking_out + v_existing_this + v_tol THEN
    v_issues := v_issues || jsonb_build_object(
      'code','OVER_BOOKING','ledger_id',NULL,
      'outstanding', v_booking_out + v_existing_this,
      'proposed', v_this_alloc,
      'message', format('This payment would exceed the booking''s outstanding balance (PKR %s available).',
                        to_char(v_booking_out + v_existing_this,'FM999,999,999,990.00')));
  END IF;

  RETURN jsonb_build_object(
    'ok', jsonb_array_length(v_issues) = 0,
    'sum', v_sum,
    'expected', COALESCE(_amount,0),
    'booking_outstanding', v_booking_out,
    'issues', v_issues
  );
END;
$function$;

-- 4. list_admin_contacts: authenticated only (returns NULL/empty to anon)
CREATE OR REPLACE FUNCTION public.list_admin_contacts()
 RETURNS TABLE(email text, full_name text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT p.email, p.full_name
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id
  WHERE ur.role = 'admin'
  ORDER BY p.full_name NULLS LAST;
END $function$;

-- Lock down EXECUTE: revoke default PUBLIC grant, restore to intended callers.
REVOKE EXECUTE ON FUNCTION public.recompute_all_bookings() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.recalculate_ledger_for_booking(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reconcile_payment_allocations(text, text, numeric, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.list_admin_contacts() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.recompute_all_bookings() TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_ledger_for_booking(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_payment_allocations(text, text, numeric, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_admin_contacts() TO authenticated;
