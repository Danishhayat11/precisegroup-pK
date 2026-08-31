
CREATE OR REPLACE FUNCTION public.reconcile_payment_allocations(
  _receipt_no text,
  _booking_id text,
  _amount numeric,
  _allocations jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
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
  IF _allocations IS NULL OR jsonb_typeof(_allocations) <> 'array' OR jsonb_array_length(_allocations) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'sum', 0, 'issues', '[]'::jsonb);
  END IF;

  -- Sum + per-row structural / referential checks
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

    -- What was previously allocated to this row from THIS receipt (edit case).
    SELECT COALESCE(SUM(amount),0) INTO v_existing_this
      FROM payment_allocations
     WHERE ledger_id = v_led_id
       AND (_receipt_no IS NOT NULL AND receipt_no = _receipt_no);

    v_remaining := (v_due - v_paid) + v_existing_this;  -- headroom after removing our own prior alloc
    IF v_amt > v_remaining + v_tol THEN
      v_issues := v_issues || jsonb_build_object(
        'code','OVER_INSTALLMENT','ledger_id',v_led_id,
        'due', v_due, 'already_paid', v_paid - v_existing_this,
        'headroom', GREATEST(v_remaining,0), 'proposed', v_amt,
        'message', format('Allocation exceeds this installment''s remaining balance (headroom PKR %s).',
                          to_char(GREATEST(v_remaining,0),'FM999,999,999,990.00')));
    END IF;
  END LOOP;

  -- Sum must equal payment amount
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

  -- Overall booking outstanding sanity: sum of allocations must not exceed booking outstanding balance.
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
$$;

REVOKE EXECUTE ON FUNCTION public.reconcile_payment_allocations(text,text,numeric,jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reconcile_payment_allocations(text,text,numeric,jsonb) TO authenticated, service_role;
