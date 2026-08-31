
-- 1. New columns
ALTER TABLE public.adjustments
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS approval_date date,
  ADD COLUMN IF NOT EXISTS realization_date date,
  ADD COLUMN IF NOT EXISTS approved_by text;

-- 2. Backfill existing rows as REALIZED
UPDATE public.adjustments
   SET status = COALESCE(status, 'REALIZED'),
       approval_date = COALESCE(approval_date, created_at::date),
       realization_date = COALESCE(realization_date, created_at::date)
 WHERE status IS NULL;

ALTER TABLE public.adjustments ALTER COLUMN status SET DEFAULT 'PENDING';
ALTER TABLE public.adjustments ALTER COLUMN status SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'adjustments_status_chk') THEN
    ALTER TABLE public.adjustments
      ADD CONSTRAINT adjustments_status_chk CHECK (status IN ('PENDING','REALIZED','WAIVED'));
  END IF;
END $$;

-- 3. Auto ADJ-###### codes
CREATE SEQUENCE IF NOT EXISTS public.adjustments_seq START 1;

SELECT setval(
  'public.adjustments_seq',
  GREATEST(
    (SELECT COALESCE(MAX(NULLIF(regexp_replace(adjustment_id, '\D', '', 'g'), '')::bigint), 0)
       FROM public.adjustments),
    1
  ),
  true
);

CREATE OR REPLACE FUNCTION public.next_adjustment_id()
RETURNS text
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT 'ADJ-' || lpad(nextval('public.adjustments_seq')::text, 6, '0') $$;

-- 4. Internal ledger recompute that skips the writer-role guard so triggers
--    (and migrations) can call it. Body mirrors recalculate_ledger_for_booking
--    but without the auth check, because SECURITY DEFINER triggers on the
--    adjustments table are already policy-gated.
CREATE OR REPLACE FUNCTION public.recalculate_ledger_for_booking_internal(_booking_id text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
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

  SELECT COALESCE(SUM(pa.amount), 0) INTO v_manual_total
  FROM public.payment_allocations pa
  JOIN public.payments p ON p.receipt_no = pa.receipt_no
  WHERE p.booking_id = _booking_id
    AND COALESCE(p.status, 'Posted') <> 'Cancelled';

  v_auto_pool := GREATEST(0::numeric, v_effective - v_manual_total);

  WITH manual AS (
    SELECT il.ledger_id, COALESCE(SUM(pa.amount), 0) AS manual_paid
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
    SELECT ledger_id, due_date, due_amount, manual_paid,
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
END $$;

-- 5. Trigger: recompute booking.adjustment_credit + ledger on any change.
CREATE OR REPLACE FUNCTION public.trg_sync_booking_adjustment_credit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_bid text; v_total numeric;
BEGIN
  v_bid := COALESCE(NEW.booking_id, OLD.booking_id);
  IF v_bid IS NULL THEN RETURN COALESCE(NEW, OLD); END IF;

  SELECT COALESCE(SUM(approved_value), 0) INTO v_total
    FROM public.adjustments
   WHERE booking_id = v_bid AND status <> 'WAIVED';

  UPDATE public.bookings
     SET adjustment_credit = v_total, updated_at = now()
   WHERE booking_id = v_bid;

  PERFORM public.recalculate_ledger_for_booking_internal(v_bid);

  IF TG_OP = 'UPDATE' AND OLD.booking_id IS DISTINCT FROM NEW.booking_id
     AND OLD.booking_id IS NOT NULL THEN
    SELECT COALESCE(SUM(approved_value), 0) INTO v_total
      FROM public.adjustments
     WHERE booking_id = OLD.booking_id AND status <> 'WAIVED';
    UPDATE public.bookings
       SET adjustment_credit = v_total, updated_at = now()
     WHERE booking_id = OLD.booking_id;
    PERFORM public.recalculate_ledger_for_booking_internal(OLD.booking_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS adjustments_sync_booking_credit ON public.adjustments;
CREATE TRIGGER adjustments_sync_booking_credit
AFTER INSERT OR UPDATE OR DELETE ON public.adjustments
FOR EACH ROW EXECUTE FUNCTION public.trg_sync_booking_adjustment_credit();

-- 6. BEFORE trigger: derive company_loss_gain + loss_gain_type from status.
CREATE OR REPLACE FUNCTION public.trg_adjustments_derive_lossgain()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_diff numeric;
BEGIN
  IF NEW.status = 'REALIZED' AND NEW.realized_value IS NOT NULL THEN
    v_diff := COALESCE(NEW.realized_value, 0) - COALESCE(NEW.approved_value, 0);
    NEW.company_loss_gain := v_diff;
    NEW.loss_gain_type := CASE WHEN v_diff > 0 THEN 'Gain'
                               WHEN v_diff < 0 THEN 'Loss'
                               ELSE 'Even' END;
  ELSIF NEW.status = 'WAIVED' THEN
    NEW.company_loss_gain := 0;
    NEW.loss_gain_type := 'Waived';
    NEW.realized_value := COALESCE(NEW.realized_value, 0);
  ELSE
    NEW.company_loss_gain := 0;
    NEW.loss_gain_type := 'Pending';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS adjustments_derive_lossgain ON public.adjustments;
CREATE TRIGGER adjustments_derive_lossgain
BEFORE INSERT OR UPDATE ON public.adjustments
FOR EACH ROW EXECUTE FUNCTION public.trg_adjustments_derive_lossgain();
