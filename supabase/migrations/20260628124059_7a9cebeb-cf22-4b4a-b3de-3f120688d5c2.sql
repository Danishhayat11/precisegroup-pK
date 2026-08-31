
CREATE OR REPLACE FUNCTION public.recompute_booking_overdue()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  WITH truth AS (
    SELECT l.booking_id,
      COUNT(*) FILTER (
        WHERE l.due_date < CURRENT_DATE
          AND GREATEST(COALESCE(l.due_amount,0) - COALESCE(l.paid_amount,0), 0) > 0
          AND l.particulars !~* 'down payment|possession'
      ) AS od_count,
      COALESCE(SUM(GREATEST(COALESCE(l.due_amount,0) - COALESCE(l.paid_amount,0), 0))
        FILTER (
          WHERE l.due_date < CURRENT_DATE
            AND l.particulars !~* 'down payment|possession'
        ), 0) AS od_amount,
      COALESCE(SUM(GREATEST(COALESCE(l.due_amount,0) - COALESCE(l.paid_amount,0), 0)), 0) AS total_remaining
    FROM public.installment_ledger l
    GROUP BY l.booking_id
  )
  UPDATE public.bookings b
  SET current_overdue_count = COALESCE(t.od_count, 0),
      total_overdue_amount  = LEAST(COALESCE(t.od_amount, 0), COALESCE(t.total_remaining, b.remaining_balance, 0)),
      remaining_balance     = COALESCE(t.total_remaining, b.remaining_balance)
  FROM truth t
  WHERE t.booking_id = b.booking_id;

  -- Bookings with no ledger rows: zero them out
  UPDATE public.bookings b
  SET current_overdue_count = 0,
      total_overdue_amount = 0
  WHERE NOT EXISTS (SELECT 1 FROM public.installment_ledger l WHERE l.booking_id = b.booking_id);
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_booking_overdue() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_booking_overdue() TO authenticated, service_role;

SELECT public.recompute_booking_overdue();
