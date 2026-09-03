-- Fix authorization logic for payment editing and deletion by explicit role checks
CREATE OR REPLACE FUNCTION public.admin_edit_payment(_receipt_no text, _patch jsonb, _reason text, _allocations jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_company_id uuid := public.current_company_id();
  v_is_super_admin boolean := false;
  v_is_admin boolean := false;
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
  -- Explicitly check roles inside this function context
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role = 'super_admin') INTO v_is_super_admin;
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role = 'admin' AND company_id = v_company_id) INTO v_is_admin;

  IF NOT (v_is_admin OR v_is_super_admin) THEN
    -- Fallback to has_role just in case
    IF NOT public.has_role(v_uid, 'admin') THEN
       RAISE EXCEPTION 'admin only' USING ERRCODE='42501';
    END IF;
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
    instrument_no = COALESCE(_patch->>'instrument_no', p.instrument_no),
    drawn_on      = COALESCE(_patch->>'drawn_on', p.drawn_on),
    booking_id    = COALESCE(_patch->>'booking_id', p.booking_id)
  WHERE receipt_no = _receipt_no
  RETURNING to_jsonb(p) INTO v_new;

  IF _allocations IS NOT NULL THEN
    DELETE FROM public.payment_allocations WHERE receipt_no = _receipt_no;
    IF jsonb_array_length(_allocations) > 0 THEN
      INSERT INTO public.payment_allocations (receipt_no, ledger_id, amount_allocated)
      SELECT _receipt_no, (a->>'ledger_id')::uuid, (a->>'amount_allocated')::numeric
      FROM jsonb_array_elements(_allocations) a;
    END IF;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(pa)), '[]'::jsonb) INTO v_new_alloc
    FROM public.payment_allocations pa WHERE pa.receipt_no = _receipt_no;

  IF v_old->>'booking_id' <> v_new->>'booking_id' THEN
    INSERT INTO public.payment_edit_history(receipt_no, booking_id, field_changed, old_value, new_value, reason, edited_by)
    VALUES (_receipt_no, v_bid, 'booking_id', v_old->>'booking_id', v_new->>'booking_id', _reason, v_uid);
  END IF;

  FOR k IN SELECT * FROM jsonb_object_keys(v_new) LOOP
    IF k = 'updated_at' THEN CONTINUE; END IF;
    old_val := v_old->>k;
    new_val := v_new->>k;
    IF old_val IS DISTINCT FROM new_val THEN
      INSERT INTO public.payment_edit_history(receipt_no, booking_id, field_changed, old_value, new_value, reason, edited_by)
      VALUES (_receipt_no, v_bid, k, old_val, new_val, _reason, v_uid);
    END IF;
  END LOOP;

  IF v_old_alloc::text <> v_new_alloc::text THEN
    INSERT INTO public.payment_edit_history(receipt_no, booking_id, field_changed, old_value, new_value, reason, edited_by)
    VALUES (_receipt_no, v_bid, 'allocations', v_old_alloc::text, v_new_alloc::text, _reason, v_uid);
  END IF;

  PERFORM public.recalculate_ledger_for_booking(v_bid);
  IF v_old->>'booking_id' <> v_new->>'booking_id' THEN
    PERFORM public.recalculate_ledger_for_booking(v_new->>'booking_id');
  END IF;

END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_delete_payment(_receipt_no text, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_company_id uuid := public.current_company_id();
  v_is_super_admin boolean := false;
  v_is_admin boolean := false;
  v_bid text;
  v_email text;
  v_old jsonb;
BEGIN
  -- Explicitly check roles inside this function context
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role = 'super_admin') INTO v_is_super_admin;
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role = 'admin' AND company_id = v_company_id) INTO v_is_admin;

  IF NOT (v_is_admin OR v_is_super_admin) THEN
    IF NOT public.has_role(v_uid, 'admin') THEN
       RAISE EXCEPTION 'admin only' USING ERRCODE='42501';
    END IF;
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

  INSERT INTO public.payment_edit_history(receipt_no, booking_id, field_changed, old_value, new_value, reason, edited_by)
  VALUES (_receipt_no, v_bid, 'DELETED', v_old::text, NULL, _reason, v_uid);

  DELETE FROM public.payments WHERE receipt_no = _receipt_no;
  PERFORM public.recalculate_ledger_for_booking(v_bid);
END;
$function$;

CREATE OR REPLACE FUNCTION public.recalculate_ledger_for_booking(_booking_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_company_id uuid := public.current_company_id();
  v_is_super_admin boolean := false;
  v_is_writer boolean := false;
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

  -- Verify permissions explicitly
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role = 'super_admin') INTO v_is_super_admin;
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role IN ('admin','manager','staff') AND company_id = v_company_id) INTO v_is_writer;

  IF NOT (v_is_writer OR v_is_super_admin) THEN
    IF NOT public.is_writer(v_uid) THEN
      RAISE EXCEPTION 'writer role required' USING ERRCODE='42501';
    END IF;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_cash
  FROM public.payments
  WHERE booking_id = _booking_id
    AND payment_head = 'installment';

  SELECT COALESCE(SUM(amount), 0) INTO v_adj
  FROM public.adjustments
  WHERE booking_id = _booking_id;

  v_effective := v_cash + v_adj;

  SELECT b.contract_amount, b.booking_date INTO v_contract, v_booking_date
  FROM public.bookings b
  WHERE b.booking_id = _booking_id;

  IF v_contract IS NULL THEN RETURN; END IF;

  UPDATE public.installment_ledger l
  SET 
    is_paid = false,
    balance = l.amount,
    paid_date = NULL
  WHERE l.booking_id = _booking_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_manual_total
  FROM public.installment_ledger
  WHERE booking_id = _booking_id AND is_manual = true;

  v_auto_pool := GREATEST(v_contract - v_manual_total, 0);

  UPDATE public.installment_ledger
  SET amount = v_auto_pool / (
    SELECT COUNT(*) FROM public.installment_ledger 
    WHERE booking_id = _booking_id AND is_manual = false
  )
  WHERE booking_id = _booking_id AND is_manual = false;

  WITH ordered AS (
    SELECT id, amount 
    FROM public.installment_ledger 
    WHERE booking_id = _booking_id
    ORDER BY due_date ASC, seq_no ASC
  ),
  running AS (
    SELECT 
      id, amount,
      SUM(amount) OVER (ORDER BY due_date ASC, seq_no ASC) as cum_due
    FROM ordered
  ),
  calc AS (
    SELECT
      id,
      CASE 
        WHEN v_effective >= cum_due THEN 0 
        WHEN v_effective > (cum_due - amount) THEN cum_due - v_effective 
        ELSE amount 
      END as new_balance,
      CASE 
        WHEN v_effective >= cum_due THEN true 
        ELSE false 
      END as new_paid,
      CASE 
        WHEN v_effective >= cum_due THEN v_today 
        ELSE NULL 
      END as new_paid_date
    FROM running
  )
  UPDATE public.installment_ledger l
  SET 
    balance = c.new_balance,
    is_paid = c.new_paid,
    paid_date = c.new_paid_date
  FROM calc c
  WHERE l.id = c.id;

END;
$function$;
