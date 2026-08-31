CREATE OR REPLACE VIEW public.data_health_issues
WITH (security_invoker = true)
AS
WITH today AS (
  SELECT public.get_system_date() AS d
),
ledger_agg AS (
  SELECT booking_id,
    COALESCE(SUM(GREATEST(0::numeric, COALESCE(due_amount,0) - COALESCE(paid_amount,0)))
      FILTER (WHERE due_date < (SELECT d FROM today)), 0) AS overdue_amt_live,
    COUNT(*) FILTER (
      WHERE due_date < (SELECT d FROM today)
        AND GREATEST(0::numeric, COALESCE(due_amount,0) - COALESCE(paid_amount,0)) > 0
        AND COALESCE(status,'') NOT ILIKE '%overdue%'
    ) AS past_due_not_flagged,
    COUNT(*) FILTER (
      WHERE due_date >= (SELECT d FROM today)
        AND COALESCE(status,'') ILIKE '%overdue%'
    ) AS future_marked_overdue,
    COALESCE(SUM(COALESCE(due_amount,0)), 0) AS plan_total_actual
  FROM public.installment_ledger
  GROUP BY booking_id
),
pay_agg AS (
  SELECT booking_id,
    COALESCE(SUM(amount) FILTER (
      WHERE COALESCE(cash_bank_include,true) AND COALESCE(status,'Posted') <> 'Cancelled'
    ), 0) AS cash
  FROM public.payments
  GROUP BY booking_id
)
SELECT b.booking_id,
       b.client_name,
       b.total_contract_value,
       b.adjustment_credit,
       b.down_payment,
       b.no_of_installments,
       b.installment_amount,
       b.possession_amount,
       COALESCE(p.cash, 0) AS cash_received,
       GREATEST(0::numeric, COALESCE(b.total_contract_value,0) - COALESCE(p.cash,0) - COALESCE(b.adjustment_credit,0)) AS total_balance_live,
       COALESCE(la.overdue_amt_live, 0) AS overdue_amt_live,
       COALESCE(la.past_due_not_flagged, 0) AS past_due_not_flagged,
       COALESCE(la.future_marked_overdue, 0) AS future_marked_overdue,
       ROUND(COALESCE(la.plan_total_actual, 0), 2) AS plan_sum,
       array_remove(ARRAY[
         CASE WHEN COALESCE(la.overdue_amt_live,0) >
              (GREATEST(0::numeric, COALESCE(b.total_contract_value,0) - COALESCE(p.cash,0) - COALESCE(b.adjustment_credit,0)) + 1)
           THEN 'overdue_exceeds_balance' END,
         CASE WHEN ABS(ROUND(COALESCE(la.plan_total_actual,0),2) - COALESCE(b.total_contract_value,0)) > 1
           THEN 'plan_identity_mismatch' END,
         CASE WHEN COALESCE(la.past_due_not_flagged,0) > 0 THEN 'past_due_not_flagged' END,
         CASE WHEN COALESCE(la.future_marked_overdue,0) > 0 THEN 'future_marked_overdue' END,
         CASE WHEN b.current_overdue_count IS DISTINCT FROM (
           SELECT COUNT(*) FROM public.installment_ledger l
           WHERE l.booking_id = b.booking_id
             AND l.due_date < (SELECT d FROM today)
             AND GREATEST(0::numeric, COALESCE(l.due_amount,0) - COALESCE(l.paid_amount,0)) > 0
         ) THEN 'cached_overdue_drift' END
       ], NULL) AS issues
FROM public.bookings b
LEFT JOIN ledger_agg la ON la.booking_id = b.booking_id
LEFT JOIN pay_agg    p  ON p.booking_id  = b.booking_id;

REVOKE ALL ON public.data_health_issues FROM anon;
GRANT SELECT ON public.data_health_issues TO authenticated, service_role;