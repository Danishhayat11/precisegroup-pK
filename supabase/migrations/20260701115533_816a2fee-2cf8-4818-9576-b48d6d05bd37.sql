
CREATE OR REPLACE FUNCTION public.recalculate_ledger_for_booking(_booking_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := public.get_system_date();
  v_cash numeric := 0;
  v_adj numeric := 0;
  v_effective numeric := 0;
  v_contract numeric := 0;
  v_booking_date date;
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

  WITH ordered AS (
    SELECT ledger_id, due_date,
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
           GREATEST(0::numeric, LEAST(due_amount, v_effective - (cum_due - due_amount))) AS paid_alloc
    FROM ordered
  )
  UPDATE public.installment_ledger l
  SET paid_amount = a.paid_alloc,
      running_balance = GREATEST(0::numeric, a.due_amount - a.paid_alloc),
      days_overdue = CASE
        WHEN a.due_date IS NOT NULL AND a.due_date < v_today AND (a.due_amount - a.paid_alloc) > 0
        THEN (v_today - a.due_date) ELSE 0 END,
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

  -- Assign paid_date per row via FIFO across actual receipts.
  --   * Fully cash-paid row → payment_date of the receipt that first covers cum_due.
  --   * Row covered entirely by adjustment_credit → booking_date.
  --   * Partially paid row → most recent payment_date (last cash contribution).
  --   * Untouched row → NULL.
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
  ordered AS (
    SELECT ledger_id,
           COALESCE(due_amount,0) AS due_amount,
           SUM(COALESCE(due_amount,0)) OVER (
             ORDER BY due_date NULLS LAST, term_no NULLS LAST, ledger_id
             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
           ) AS cum_due
    FROM public.installment_ledger
    WHERE booking_id = _booking_id
  ),
  row_date AS (
    SELECT o.ledger_id,
      CASE
        WHEN o.due_amount = 0 THEN NULL
        -- entirely covered by adjustment credit (no cash needed for this row)
        WHEN COALESCE(v_adj,0) >= o.cum_due THEN v_booking_date
        -- fully paid: first receipt whose cumulative cash covers row-end
        WHEN v_effective >= o.cum_due THEN (
          SELECT p.payment_date FROM pays p
          WHERE p.cum_paid >= (o.cum_due - COALESCE(v_adj,0))
          ORDER BY p.payment_date, p.receipt_no
          LIMIT 1
        )
        -- partial: most recent cash contribution
        WHEN v_effective > (o.cum_due - o.due_amount) THEN (SELECT d FROM max_pay)
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

-- Backfill every booking so historic paid_date columns are corrected in place.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT booking_id FROM public.bookings LOOP
    PERFORM public.recalculate_ledger_for_booking(r.booking_id);
  END LOOP;
END $$;
