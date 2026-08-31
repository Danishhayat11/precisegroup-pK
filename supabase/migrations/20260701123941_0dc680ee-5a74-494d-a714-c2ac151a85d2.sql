
-- Extend admin RPCs so every admin-resolved change (payment edit, split, plan restructure, delete)
-- is mirrored into public.audit_logs with actor + before/after payload.

CREATE OR REPLACE FUNCTION public.admin_edit_payment(_receipt_no text, _patch jsonb, _reason text, _allocations jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_old jsonb;
  v_new jsonb;
  v_bid text;
  v_old_alloc jsonb;
  v_new_alloc jsonb;
  k text;
  new_val text;
  old_val text;
BEGIN
  IF NOT public.has_role(v_uid,'admin') THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE='42501';
  END IF;
  IF _reason IS NULL OR length(btrim(_reason)) = 0 THEN
    RAISE EXCEPTION 'reason required';
  END IF;

  SELECT email INTO v_email FROM public.profiles WHERE id = v_uid;

  SELECT to_jsonb(p), p.booking_id INTO v_old, v_bid
    FROM public.payments p WHERE receipt_no = _receipt_no;
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'payment % not found', _receipt_no;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(pa)), '[]'::jsonb) INTO v_old_alloc
    FROM public.payment_allocations pa WHERE pa.receipt_no = _receipt_no;

  UPDATE public.payments p SET
    payment_date  = COALESCE((_patch->>'payment_date')::date, p.payment_date),
    payment_mode  = COALESCE(_patch->>'payment_mode', p.payment_mode),
    payment_head  = COALESCE(_patch->>'payment_head', p.payment_head),
    amount        = COALESCE((_patch->>'amount')::numeric, p.amount),
    account       = COALESCE(_patch->>'account', p.account),
    cheque_txn_no = COALESCE(_patch->>'cheque_txn_no', p.cheque_txn_no),
    posted_by     = COALESCE(_patch->>'posted_by', p.posted_by),
    remarks       = COALESCE(_patch->>'remarks', p.remarks),
    cash_bank_include = CASE
      WHEN _patch ? 'payment_mode'
        THEN (COALESCE(_patch->>'payment_mode', p.payment_mode) <> 'Adjustment/Asset')
      ELSE p.cash_bank_include END,
    non_cash_adjustment = CASE
      WHEN _patch ? 'payment_mode'
        THEN (COALESCE(_patch->>'payment_mode', p.payment_mode) = 'Adjustment/Asset')
      ELSE p.non_cash_adjustment END,
    safe_cash_amount = CASE
      WHEN COALESCE(_patch->>'payment_mode', p.payment_mode) = 'Adjustment/Asset'
        THEN 0
      ELSE COALESCE((_patch->>'amount')::numeric, p.amount) END,
    updated_at = now()
  WHERE receipt_no = _receipt_no;

  FOR k IN SELECT jsonb_object_keys(_patch) LOOP
    old_val := v_old->>k;
    new_val := _patch->>k;
    IF COALESCE(old_val,'') IS DISTINCT FROM COALESCE(new_val,'') THEN
      INSERT INTO public.payment_edit_history(receipt_no, booking_id, field_changed, old_value, new_value, reason, edited_by)
      VALUES (_receipt_no, v_bid, k, old_val, new_val, _reason, v_uid);
    END IF;
  END LOOP;

  IF _allocations IS NOT NULL THEN
    DELETE FROM public.payment_allocations WHERE receipt_no = _receipt_no;
    INSERT INTO public.payment_allocations(receipt_no, ledger_id, head_label, amount, created_by)
      SELECT _receipt_no,
             (a->>'ledger_id')::text,
             a->>'head_label',
             (a->>'amount')::numeric,
             v_uid
      FROM jsonb_array_elements(_allocations) a;
    INSERT INTO public.payment_edit_history(receipt_no, booking_id, field_changed, old_value, new_value, reason, edited_by)
    VALUES (_receipt_no, v_bid, 'allocations',
            v_old_alloc::text, _allocations::text, _reason, v_uid);
  END IF;

  PERFORM public.recalculate_ledger_for_booking(v_bid);

  SELECT to_jsonb(p) INTO v_new FROM public.payments p WHERE receipt_no = _receipt_no;
  SELECT COALESCE(jsonb_agg(to_jsonb(pa)), '[]'::jsonb) INTO v_new_alloc
    FROM public.payment_allocations pa WHERE pa.receipt_no = _receipt_no;

  INSERT INTO public.audit_logs(actor_id, actor_email, action, entity, entity_id, before, after)
  VALUES (
    v_uid, v_email,
    CASE WHEN _allocations IS NOT NULL THEN 'payment.edit+split' ELSE 'payment.edit' END,
    'payment', _receipt_no,
    jsonb_build_object('payment', v_old, 'allocations', v_old_alloc, 'booking_id', v_bid),
    jsonb_build_object('payment', v_new, 'allocations', v_new_alloc, 'patch', _patch, 'reason', _reason)
  );

  RETURN jsonb_build_object('ok', true, 'receipt_no', _receipt_no);
END $function$;

CREATE OR REPLACE FUNCTION public.admin_restructure_plan(_booking_id text, _new_schedule jsonb, _plan_meta jsonb, _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_before jsonb;
  v_after  jsonb;
  v_contract numeric;
  v_new_total numeric;
BEGIN
  IF NOT public.has_role(v_uid,'admin') THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE='42501';
  END IF;
  IF _reason IS NULL OR length(btrim(_reason)) = 0 THEN
    RAISE EXCEPTION 'reason required';
  END IF;
  IF _new_schedule IS NULL OR jsonb_typeof(_new_schedule) <> 'array' OR jsonb_array_length(_new_schedule) = 0 THEN
    RAISE EXCEPTION 'new schedule required';
  END IF;

  SELECT email INTO v_email FROM public.profiles WHERE id = v_uid;

  SELECT total_contract_value INTO v_contract FROM public.bookings WHERE booking_id = _booking_id;
  IF v_contract IS NULL THEN RAISE EXCEPTION 'booking % not found', _booking_id; END IF;

  SELECT COALESCE(SUM((r->>'due_amount')::numeric), 0)
    INTO v_new_total
    FROM jsonb_array_elements(_new_schedule) r;

  SELECT jsonb_build_object(
    'booking',  to_jsonb(b),
    'schedule', COALESCE((SELECT jsonb_agg(to_jsonb(il) ORDER BY il.due_date, il.term_no)
                          FROM public.installment_ledger il WHERE il.booking_id = _booking_id), '[]'::jsonb)
  ) INTO v_before
  FROM public.bookings b WHERE b.booking_id = _booking_id;

  DELETE FROM public.installment_ledger
  WHERE booking_id = _booking_id
    AND COALESCE(paid_amount, 0) = 0
    AND NOT EXISTS (
      SELECT 1 FROM public.payment_allocations pa WHERE pa.ledger_id = installment_ledger.ledger_id
    );

  INSERT INTO public.installment_ledger
    (ledger_id, booking_id, client_name, project, unit_no,
     term_no, particulars, due_date, due_amount, paid_amount, running_balance, status)
  SELECT
    'L-' || _booking_id || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8),
    _booking_id,
    (SELECT client_name FROM public.bookings WHERE booking_id = _booking_id),
    (SELECT project_name FROM public.bookings WHERE booking_id = _booking_id),
    (SELECT unit_id FROM public.bookings WHERE booking_id = _booking_id),
    NULLIF(r->>'term_no','')::int,
    r->>'particulars',
    NULLIF(r->>'due_date','')::date,
    (r->>'due_amount')::numeric,
    0, (r->>'due_amount')::numeric, 'Pending'
  FROM jsonb_array_elements(_new_schedule) r;

  UPDATE public.bookings b SET
    no_of_installments   = COALESCE((_plan_meta->>'no_of_installments')::int,   b.no_of_installments),
    installment_amount   = COALESCE((_plan_meta->>'installment_amount')::numeric, b.installment_amount),
    installment_frequency= COALESCE(_plan_meta->>'installment_frequency',        b.installment_frequency),
    first_installment_due= COALESCE((_plan_meta->>'first_installment_due')::date, b.first_installment_due),
    possession_amount    = COALESCE((_plan_meta->>'possession_amount')::numeric, b.possession_amount),
    possession_due_date  = COALESCE((_plan_meta->>'possession_due_date')::date,  b.possession_due_date),
    updated_at = now()
  WHERE b.booking_id = _booking_id;

  PERFORM public.recalculate_ledger_for_booking(_booking_id);

  SELECT jsonb_build_object(
    'booking',  to_jsonb(b),
    'schedule', COALESCE((SELECT jsonb_agg(to_jsonb(il) ORDER BY il.due_date, il.term_no)
                          FROM public.installment_ledger il WHERE il.booking_id = _booking_id), '[]'::jsonb)
  ) INTO v_after
  FROM public.bookings b WHERE b.booking_id = _booking_id;

  INSERT INTO public.plan_restructure_history(booking_id, before, after, reason, restructured_by)
  VALUES (_booking_id, v_before, v_after, _reason, v_uid);

  INSERT INTO public.audit_logs(actor_id, actor_email, action, entity, entity_id, before, after)
  VALUES (
    v_uid, v_email, 'plan.restructure', 'booking', _booking_id,
    v_before,
    jsonb_build_object('booking', v_after->'booking', 'schedule', v_after->'schedule',
                       'plan_meta', _plan_meta, 'new_plan_total', v_new_total, 'reason', _reason)
  );

  RETURN jsonb_build_object('ok', true, 'new_plan_total', v_new_total, 'contract', v_contract);
END $function$;

-- Delete payment (admin only, reason required, logged)
CREATE OR REPLACE FUNCTION public.admin_delete_payment(_receipt_no text, _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_old jsonb;
  v_old_alloc jsonb;
  v_bid text;
BEGIN
  IF NOT public.has_role(v_uid,'admin') THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE='42501';
  END IF;
  IF _reason IS NULL OR length(btrim(_reason)) = 0 THEN
    RAISE EXCEPTION 'reason required';
  END IF;

  SELECT email INTO v_email FROM public.profiles WHERE id = v_uid;

  SELECT to_jsonb(p), p.booking_id INTO v_old, v_bid
    FROM public.payments p WHERE receipt_no = _receipt_no;
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'payment % not found', _receipt_no;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(pa)), '[]'::jsonb) INTO v_old_alloc
    FROM public.payment_allocations pa WHERE pa.receipt_no = _receipt_no;

  DELETE FROM public.payment_allocations WHERE receipt_no = _receipt_no;
  DELETE FROM public.payments WHERE receipt_no = _receipt_no;

  IF v_bid IS NOT NULL THEN
    PERFORM public.recalculate_ledger_for_booking(v_bid);
  END IF;

  INSERT INTO public.audit_logs(actor_id, actor_email, action, entity, entity_id, before, after)
  VALUES (
    v_uid, v_email, 'payment.delete', 'payment', _receipt_no,
    jsonb_build_object('payment', v_old, 'allocations', v_old_alloc, 'booking_id', v_bid),
    jsonb_build_object('reason', _reason, 'deleted_at', now())
  );

  RETURN jsonb_build_object('ok', true, 'receipt_no', _receipt_no);
END $function$;

REVOKE EXECUTE ON FUNCTION public.admin_delete_payment(text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_delete_payment(text, text) TO authenticated;
