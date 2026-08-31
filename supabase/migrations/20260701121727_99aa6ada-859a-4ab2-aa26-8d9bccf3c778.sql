
-- =============================================================
-- 1. payment_allocations — one payment split across ledger rows
-- =============================================================
CREATE TABLE IF NOT EXISTS public.payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_no text NOT NULL REFERENCES public.payments(receipt_no) ON DELETE CASCADE,
  ledger_id  text NOT NULL REFERENCES public.installment_ledger(ledger_id) ON DELETE CASCADE,
  head_label text,
  amount     numeric(14,2) NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_allocations TO authenticated;
GRANT ALL ON public.payment_allocations TO service_role;
ALTER TABLE public.payment_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pa_read   ON public.payment_allocations;
DROP POLICY IF EXISTS pa_insert ON public.payment_allocations;
DROP POLICY IF EXISTS pa_update ON public.payment_allocations;
DROP POLICY IF EXISTS pa_delete ON public.payment_allocations;
CREATE POLICY pa_read   ON public.payment_allocations FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY pa_insert ON public.payment_allocations FOR INSERT WITH CHECK (public.is_writer(auth.uid()));
CREATE POLICY pa_update ON public.payment_allocations FOR UPDATE
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY pa_delete ON public.payment_allocations FOR DELETE USING (public.has_role(auth.uid(),'admin'));

CREATE INDEX IF NOT EXISTS ix_pa_receipt ON public.payment_allocations(receipt_no);
CREATE INDEX IF NOT EXISTS ix_pa_ledger  ON public.payment_allocations(ledger_id);

-- =============================================================
-- 2. payment_edit_history — audit trail for admin edits
-- =============================================================
CREATE TABLE IF NOT EXISTS public.payment_edit_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_no text NOT NULL,
  booking_id text,
  field_changed text NOT NULL,
  old_value text,
  new_value text,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  edited_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  edited_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.payment_edit_history TO authenticated;
GRANT ALL ON public.payment_edit_history TO service_role;
ALTER TABLE public.payment_edit_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS peh_read   ON public.payment_edit_history;
DROP POLICY IF EXISTS peh_insert ON public.payment_edit_history;
CREATE POLICY peh_read   ON public.payment_edit_history FOR SELECT USING (auth.uid() IS NOT NULL);
-- Only inserted via admin_edit_payment(); block direct inserts by non-admins.
CREATE POLICY peh_insert ON public.payment_edit_history FOR INSERT
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE INDEX IF NOT EXISTS ix_peh_receipt ON public.payment_edit_history(receipt_no);
CREATE INDEX IF NOT EXISTS ix_peh_booking ON public.payment_edit_history(booking_id);

-- =============================================================
-- 3. plan_restructure_history — audit trail for plan changes
-- =============================================================
CREATE TABLE IF NOT EXISTS public.plan_restructure_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id text NOT NULL,
  before jsonb NOT NULL,
  after  jsonb NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  restructured_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  restructured_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.plan_restructure_history TO authenticated;
GRANT ALL ON public.plan_restructure_history TO service_role;
ALTER TABLE public.plan_restructure_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS prh_read   ON public.plan_restructure_history;
DROP POLICY IF EXISTS prh_insert ON public.plan_restructure_history;
CREATE POLICY prh_read   ON public.plan_restructure_history FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY prh_insert ON public.plan_restructure_history FOR INSERT
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX IF NOT EXISTS ix_prh_booking ON public.plan_restructure_history(booking_id);

-- =============================================================
-- 4. Ledger recalculation engine v2 — manual splits first, then FIFO
-- =============================================================
CREATE OR REPLACE FUNCTION public.recalculate_ledger_for_booking(_booking_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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

  SELECT COALESCE(SUM(amount), 0) INTO v_cash
  FROM public.payments
  WHERE booking_id = _booking_id
    AND COALESCE(cash_bank_include, true) = true
    AND COALESCE(status, 'Posted') <> 'Cancelled';

  SELECT COALESCE(adjustment_credit, 0), COALESCE(total_contract_value, 0), booking_date
    INTO v_adj, v_contract, v_booking_date
  FROM public.bookings WHERE booking_id = _booking_id;

  v_effective := v_cash + COALESCE(v_adj, 0);

  -- Total manual allocations tied to non-cancelled payments for this booking
  SELECT COALESCE(SUM(pa.amount), 0) INTO v_manual_total
  FROM public.payment_allocations pa
  JOIN public.payments p ON p.receipt_no = pa.receipt_no
  WHERE p.booking_id = _booking_id
    AND COALESCE(p.status, 'Posted') <> 'Cancelled';

  -- Auto pool is whatever cash/credit is left after manual splits
  v_auto_pool := GREATEST(0::numeric, v_effective - v_manual_total);

  -- Apply manual first, then FIFO the rest across remaining_after_manual
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

  -- paid_date attribution:
  --   * fully manual → date of the latest allocated payment
  --   * fully auto/mixed → FIFO across cash receipts, same as before
  --   * covered entirely by adjustment_credit → booking_date
  --   * partial → last cash payment date, else manual date
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

-- =============================================================
-- 5. Trigger to recalc when allocations change
-- =============================================================
CREATE OR REPLACE FUNCTION public.trg_recalc_from_allocation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE bid text;
BEGIN
  SELECT booking_id INTO bid FROM public.payments
    WHERE receipt_no = COALESCE(NEW.receipt_no, OLD.receipt_no);
  IF bid IS NOT NULL THEN
    PERFORM public.recalculate_ledger_for_booking(bid);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_pa_recalc ON public.payment_allocations;
CREATE TRIGGER trg_pa_recalc
  AFTER INSERT OR UPDATE OR DELETE ON public.payment_allocations
  FOR EACH ROW EXECUTE FUNCTION public.trg_recalc_from_allocation();

-- =============================================================
-- 6. Admin-only edit payment: patches selected fields + logs diff + reason
-- =============================================================
CREATE OR REPLACE FUNCTION public.admin_edit_payment(
  _receipt_no text,
  _patch jsonb,
  _reason text,
  _allocations jsonb DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_old jsonb;
  v_bid text;
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

  SELECT to_jsonb(p), p.booking_id INTO v_old, v_bid
    FROM public.payments p WHERE receipt_no = _receipt_no;
  IF v_old IS NULL THEN
    RAISE EXCEPTION 'payment % not found', _receipt_no;
  END IF;

  -- Whitelist of patchable columns
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

  -- Log every field that actually changed
  FOR k IN SELECT jsonb_object_keys(_patch) LOOP
    old_val := v_old->>k;
    new_val := _patch->>k;
    IF COALESCE(old_val,'') IS DISTINCT FROM COALESCE(new_val,'') THEN
      INSERT INTO public.payment_edit_history(receipt_no, booking_id, field_changed, old_value, new_value, reason, edited_by)
      VALUES (_receipt_no, v_bid, k, old_val, new_val, _reason, v_uid);
    END IF;
  END LOOP;

  -- Optional: replace allocations wholesale
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
            (SELECT jsonb_agg(pa) FROM public.payment_allocations pa WHERE pa.receipt_no = _receipt_no)::text,
            _allocations::text, _reason, v_uid);
  END IF;

  PERFORM public.recalculate_ledger_for_booking(v_bid);
  RETURN jsonb_build_object('ok', true, 'receipt_no', _receipt_no);
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_edit_payment(text, jsonb, text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_edit_payment(text, jsonb, text, jsonb) TO authenticated;

-- =============================================================
-- 7. Admin-only restructure plan: rebuild only unpaid future rows
-- =============================================================
CREATE OR REPLACE FUNCTION public.admin_restructure_plan(
  _booking_id text,
  _new_schedule jsonb,   -- [{particulars, due_date, due_amount, term_no}, ...]
  _plan_meta jsonb,      -- { no_of_installments, installment_amount, frequency, first_installment_due, possession_amount, possession_due_date }
  _reason text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
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

  SELECT total_contract_value INTO v_contract FROM public.bookings WHERE booking_id = _booking_id;
  IF v_contract IS NULL THEN RAISE EXCEPTION 'booking % not found', _booking_id; END IF;

  SELECT COALESCE(SUM((r->>'due_amount')::numeric), 0)
    INTO v_new_total
    FROM jsonb_array_elements(_new_schedule) r;

  -- Snapshot BEFORE (booking + full schedule)
  SELECT jsonb_build_object(
    'booking',  to_jsonb(b),
    'schedule', COALESCE((SELECT jsonb_agg(to_jsonb(il) ORDER BY il.due_date, il.term_no)
                          FROM public.installment_ledger il WHERE il.booking_id = _booking_id), '[]'::jsonb)
  ) INTO v_before
  FROM public.bookings b WHERE b.booking_id = _booking_id;

  -- Only touch rows with no payments applied yet (fully unpaid future rows).
  -- Rows that are Paid or Partially Paid are preserved verbatim.
  DELETE FROM public.installment_ledger
  WHERE booking_id = _booking_id
    AND COALESCE(paid_amount, 0) = 0
    AND NOT EXISTS (
      SELECT 1 FROM public.payment_allocations pa WHERE pa.ledger_id = installment_ledger.ledger_id
    );

  -- Insert new schedule rows. Caller supplies particulars/due_date/due_amount/term_no.
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

  -- Update plan meta on the booking (frequency/amount/count/etc.) if provided
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

  RETURN jsonb_build_object('ok', true, 'new_plan_total', v_new_total, 'contract', v_contract);
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_restructure_plan(text, jsonb, jsonb, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_restructure_plan(text, jsonb, jsonb, text) TO authenticated;
