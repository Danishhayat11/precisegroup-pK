
-- ============================================================
-- 1. System date (uses existing public.app_settings key/value table)
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_system_date()
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    NULLIF((SELECT value->>'date' FROM public.app_settings WHERE key = 'system_date_override'), '')::date,
    current_date
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_system_date() TO authenticated, service_role;

-- ============================================================
-- 2. Light enum guards (additive — accept current data)
-- ============================================================
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_mode_chk;
ALTER TABLE public.payments ADD CONSTRAINT payments_mode_chk
  CHECK (payment_mode IS NULL OR payment_mode IN
    ('Cash','Online','Cheque','Bank Transfer','Rent Adjustment','Adjustment','Adjustment/Asset'));

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_status_chk;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_status_chk
  CHECK (booking_status IS NULL OR booking_status IN ('Active','Completed','Cancelled','Transferred'));

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_risk_chk;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_risk_chk
  CHECK (risk_level IS NULL OR risk_level IN ('LOW','MEDIUM','HIGH'));

-- ============================================================
-- 3. FIFO ledger recalculation engine (single source of truth)
-- ============================================================
CREATE OR REPLACE FUNCTION public.recalculate_ledger_for_booking(_booking_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_today date := public.get_system_date();
  v_cash numeric := 0;
  v_adj numeric := 0;
  v_effective numeric := 0;
  v_contract numeric := 0;
BEGIN
  IF _booking_id IS NULL THEN RETURN; END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_cash
  FROM public.payments
  WHERE booking_id = _booking_id
    AND COALESCE(cash_bank_include, true) = true
    AND COALESCE(status, 'Posted') <> 'Cancelled';

  SELECT COALESCE(adjustment_credit, 0), COALESCE(total_contract_value, 0)
    INTO v_adj, v_contract
  FROM public.bookings WHERE booking_id = _booking_id;

  v_effective := v_cash + COALESCE(v_adj, 0);

  WITH ordered AS (
    SELECT ledger_id,
           due_date,
           COALESCE(due_amount, 0) AS due_amount,
           SUM(COALESCE(due_amount, 0)) OVER (
             ORDER BY due_date NULLS LAST, term_no NULLS LAST, ledger_id
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
           ) AS cum_due
    FROM public.installment_ledger
    WHERE booking_id = _booking_id
  ),
  alloc AS (
    SELECT ledger_id, due_date, due_amount, cum_due,
           GREATEST(0::numeric,
             LEAST(due_amount, v_effective - (cum_due - due_amount))
           ) AS paid_alloc
    FROM ordered
  )
  UPDATE public.installment_ledger l
  SET paid_amount = a.paid_alloc,
      running_balance = GREATEST(0::numeric, a.due_amount - a.paid_alloc),
      days_overdue = CASE
        WHEN a.due_date IS NOT NULL AND a.due_date < v_today AND (a.due_amount - a.paid_alloc) > 0
        THEN (v_today - a.due_date)
        ELSE 0
      END,
      status = CASE
        WHEN v_effective >= a.cum_due THEN 'Paid'
        WHEN a.paid_alloc > 0 AND a.due_date IS NOT NULL AND a.due_date < v_today THEN 'Partially Paid Overdue'
        WHEN a.paid_alloc > 0 THEN 'Partially Paid'
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
  WHERE booking_id = _booking_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recalculate_ledger_for_booking(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.recompute_all_bookings()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN SELECT booking_id FROM public.bookings LOOP
    PERFORM public.recalculate_ledger_for_booking(r.booking_id);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION public.recompute_all_bookings() TO authenticated, service_role;

-- ============================================================
-- 4. Triggers
-- ============================================================
CREATE OR REPLACE FUNCTION public.trg_recalc_from_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE bid text;
BEGIN
  bid := COALESCE(NEW.booking_id, OLD.booking_id);
  IF bid IS NOT NULL THEN
    PERFORM public.recalculate_ledger_for_booking(bid);
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.booking_id IS DISTINCT FROM NEW.booking_id AND OLD.booking_id IS NOT NULL THEN
    PERFORM public.recalculate_ledger_for_booking(OLD.booking_id);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS payments_recalc ON public.payments;
CREATE TRIGGER payments_recalc
AFTER INSERT OR UPDATE OR DELETE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.trg_recalc_from_payment();

CREATE OR REPLACE FUNCTION public.trg_recalc_from_booking()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.booking_id IS NOT NULL THEN
    PERFORM public.recalculate_ledger_for_booking(NEW.booking_id);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS bookings_recalc ON public.bookings;
CREATE TRIGGER bookings_recalc
AFTER UPDATE OF adjustment_credit, total_contract_value ON public.bookings
FOR EACH ROW
WHEN (OLD.adjustment_credit IS DISTINCT FROM NEW.adjustment_credit
   OR OLD.total_contract_value IS DISTINCT FROM NEW.total_contract_value)
EXECUTE FUNCTION public.trg_recalc_from_booking();

-- ============================================================
-- 5. Data Health view + summary
-- ============================================================
CREATE OR REPLACE VIEW public.data_health_issues AS
WITH today AS (SELECT public.get_system_date() AS d),
ledger_agg AS (
  SELECT booking_id,
    COALESCE(SUM(GREATEST(0, COALESCE(due_amount,0) - COALESCE(paid_amount,0))) FILTER (
      WHERE due_date < (SELECT d FROM today)
    ), 0) AS overdue_amt_live,
    COUNT(*) FILTER (
      WHERE due_date < (SELECT d FROM today)
        AND GREATEST(0, COALESCE(due_amount,0) - COALESCE(paid_amount,0)) > 0
        AND COALESCE(status,'') NOT ILIKE '%overdue%'
    ) AS past_due_not_flagged,
    COUNT(*) FILTER (
      WHERE due_date >= (SELECT d FROM today)
        AND COALESCE(status,'') ILIKE '%overdue%'
    ) AS future_marked_overdue
  FROM public.installment_ledger GROUP BY booking_id
),
pay_agg AS (
  SELECT booking_id,
    COALESCE(SUM(amount) FILTER (WHERE COALESCE(cash_bank_include,true) AND COALESCE(status,'Posted') <> 'Cancelled'), 0) AS cash
  FROM public.payments GROUP BY booking_id
)
SELECT b.booking_id,
       b.client_name,
       b.total_contract_value,
       b.adjustment_credit,
       b.down_payment,
       b.no_of_installments,
       b.installment_amount,
       b.possession_amount,
       COALESCE(p.cash,0) AS cash_received,
       GREATEST(0, COALESCE(b.total_contract_value,0) - COALESCE(p.cash,0) - COALESCE(b.adjustment_credit,0)) AS total_balance_live,
       COALESCE(la.overdue_amt_live, 0) AS overdue_amt_live,
       COALESCE(la.past_due_not_flagged, 0) AS past_due_not_flagged,
       COALESCE(la.future_marked_overdue, 0) AS future_marked_overdue,
       ROUND(COALESCE(b.down_payment,0) + COALESCE(b.adjustment_credit,0)
             + COALESCE(b.installment_amount,0) * COALESCE(b.no_of_installments,0)
             + COALESCE(b.possession_amount,0), 2) AS plan_sum,
       ARRAY_REMOVE(ARRAY[
         CASE WHEN COALESCE(la.overdue_amt_live,0) >
                   GREATEST(0, COALESCE(b.total_contract_value,0) - COALESCE(p.cash,0) - COALESCE(b.adjustment_credit,0)) + 1
              THEN 'overdue_exceeds_balance' END,
         CASE WHEN ABS(
                ROUND(COALESCE(b.down_payment,0) + COALESCE(b.adjustment_credit,0)
                  + COALESCE(b.installment_amount,0) * COALESCE(b.no_of_installments,0)
                  + COALESCE(b.possession_amount,0), 2)
                - COALESCE(b.total_contract_value,0)
              ) > 1
              THEN 'plan_identity_mismatch' END,
         CASE WHEN COALESCE(la.past_due_not_flagged,0) > 0 THEN 'past_due_not_flagged' END,
         CASE WHEN COALESCE(la.future_marked_overdue,0) > 0 THEN 'future_marked_overdue' END,
         CASE WHEN b.current_overdue_count IS DISTINCT FROM (
                SELECT COUNT(*) FROM public.installment_ledger l
                WHERE l.booking_id = b.booking_id
                  AND l.due_date < (SELECT d FROM today)
                  AND GREATEST(0, COALESCE(l.due_amount,0) - COALESCE(l.paid_amount,0)) > 0
              ) THEN 'cached_overdue_drift' END
       ], NULL) AS issues
FROM public.bookings b
LEFT JOIN ledger_agg la ON la.booking_id = b.booking_id
LEFT JOIN pay_agg p ON p.booking_id = b.booking_id;

GRANT SELECT ON public.data_health_issues TO authenticated;

CREATE OR REPLACE FUNCTION public.data_health_summary()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') THEN
      jsonb_build_object(
        'system_date', public.get_system_date(),
        'total_bookings', (SELECT COUNT(*) FROM public.bookings),
        'with_issues', (SELECT COUNT(*) FROM public.data_health_issues WHERE COALESCE(array_length(issues,1),0) > 0),
        'overdue_exceeds_balance', (SELECT COUNT(*) FROM public.data_health_issues WHERE 'overdue_exceeds_balance' = ANY(issues)),
        'plan_identity_mismatch', (SELECT COUNT(*) FROM public.data_health_issues WHERE 'plan_identity_mismatch' = ANY(issues)),
        'past_due_not_flagged', (SELECT COUNT(*) FROM public.data_health_issues WHERE 'past_due_not_flagged' = ANY(issues)),
        'future_marked_overdue', (SELECT COUNT(*) FROM public.data_health_issues WHERE 'future_marked_overdue' = ANY(issues)),
        'cached_overdue_drift', (SELECT COUNT(*) FROM public.data_health_issues WHERE 'cached_overdue_drift' = ANY(issues))
      )
    ELSE NULL
  END;
$$;
GRANT EXECUTE ON FUNCTION public.data_health_summary() TO authenticated, service_role;

-- ============================================================
-- 6. Backfill all bookings now with the new engine
-- ============================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT booking_id FROM public.bookings LOOP
    PERFORM public.recalculate_ledger_for_booking(r.booking_id);
  END LOOP;
END $$;
