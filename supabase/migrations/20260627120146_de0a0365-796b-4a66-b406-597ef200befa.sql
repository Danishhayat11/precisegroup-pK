
-- Snapshot tables (structure mirrors live tables)
CREATE TABLE IF NOT EXISTS public._seed_projects           (LIKE public.projects           INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public._seed_clients            (LIKE public.clients            INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public._seed_units              (LIKE public.units              INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public._seed_dealers            (LIKE public.dealers            INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public._seed_bookings           (LIKE public.bookings           INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public._seed_payments           (LIKE public.payments           INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public._seed_installment_ledger (LIKE public.installment_ledger INCLUDING ALL);
CREATE TABLE IF NOT EXISTS public._seed_adjustments        (LIKE public.adjustments        INCLUDING ALL);

-- Lock these down: admins only via the SECURITY DEFINER function. No anon/auth direct access.
REVOKE ALL ON public._seed_projects, public._seed_clients, public._seed_units, public._seed_dealers,
              public._seed_bookings, public._seed_payments, public._seed_installment_ledger, public._seed_adjustments
       FROM PUBLIC, anon, authenticated;
GRANT ALL ON public._seed_projects, public._seed_clients, public._seed_units, public._seed_dealers,
             public._seed_bookings, public._seed_payments, public._seed_installment_ledger, public._seed_adjustments
       TO service_role;

ALTER TABLE public._seed_projects           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._seed_clients            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._seed_units              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._seed_dealers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._seed_bookings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._seed_payments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._seed_installment_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public._seed_adjustments        ENABLE ROW LEVEL SECURITY;
-- No policies => no Data API access. Function uses SECURITY DEFINER to read them.

-- Reseed function: admin-only, upserts every snapshot into the live tables.
CREATE OR REPLACE FUNCTION public.reseed_demo_data()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_counts jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Only admins can reseed demo data';
  END IF;

  -- Parents first
  INSERT INTO public.projects SELECT * FROM public._seed_projects
    ON CONFLICT (project_code) DO UPDATE SET
      project_name=EXCLUDED.project_name, location=EXCLUDED.location, status=EXCLUDED.status,
      start_date=EXCLUDED.start_date, expected_completion_date=EXCLUDED.expected_completion_date, notes=EXCLUDED.notes;

  INSERT INTO public.dealers SELECT * FROM public._seed_dealers
    ON CONFLICT (name) DO NOTHING;

  INSERT INTO public.clients SELECT * FROM public._seed_clients
    ON CONFLICT (client_ref) DO UPDATE SET
      name=EXCLUDED.name, so_wo=EXCLUDED.so_wo, cnic=EXCLUDED.cnic,
      mobile=EXCLUDED.mobile, address=EXCLUDED.address;

  INSERT INTO public.units SELECT * FROM public._seed_units
    ON CONFLICT (unit_id) DO UPDATE SET
      project_code=EXCLUDED.project_code, project_name=EXCLUDED.project_name, unit_no=EXCLUDED.unit_no,
      unit_type=EXCLUDED.unit_type, floor=EXCLUDED.floor, size_sqft=EXCLUDED.size_sqft,
      base_rate=EXCLUDED.base_rate, standard_value=EXCLUDED.standard_value, status=EXCLUDED.status,
      linked_booking_id=EXCLUDED.linked_booking_id, booked_by=EXCLUDED.booked_by, notes=EXCLUDED.notes;

  INSERT INTO public.bookings SELECT * FROM public._seed_bookings
    ON CONFLICT (booking_id) DO UPDATE SET
      booking_date=EXCLUDED.booking_date, project_code=EXCLUDED.project_code, project_name=EXCLUDED.project_name,
      unit_id=EXCLUDED.unit_id, client_ref=EXCLUDED.client_ref, client_name=EXCLUDED.client_name,
      so_wo=EXCLUDED.so_wo, cnic=EXCLUDED.cnic, mobile=EXCLUDED.mobile, address=EXCLUDED.address,
      unit_type=EXCLUDED.unit_type, floor=EXCLUDED.floor, size_sqft=EXCLUDED.size_sqft,
      base_rate=EXCLUDED.base_rate, standard_value=EXCLUDED.standard_value, sold_rate=EXCLUDED.sold_rate,
      sold_total_override=EXCLUDED.sold_total_override, sold_unit_value=EXCLUDED.sold_unit_value,
      adjustment_credit=EXCLUDED.adjustment_credit, total_contract_value=EXCLUDED.total_contract_value,
      price_loss=EXCLUDED.price_loss, dealer_name=EXCLUDED.dealer_name,
      dealer_commission_pct=EXCLUDED.dealer_commission_pct, dealer_commission_fixed=EXCLUDED.dealer_commission_fixed,
      dealer_commission_amount=EXCLUDED.dealer_commission_amount, net_company_value=EXCLUDED.net_company_value,
      down_payment=EXCLUDED.down_payment, no_of_installments=EXCLUDED.no_of_installments,
      installment_frequency=EXCLUDED.installment_frequency, installment_amount=EXCLUDED.installment_amount,
      possession_amount=EXCLUDED.possession_amount, first_installment_due=EXCLUDED.first_installment_due,
      possession_due_date=EXCLUDED.possession_due_date, cash_received=EXCLUDED.cash_received,
      remaining_balance=EXCLUDED.remaining_balance, current_overdue_count=EXCLUDED.current_overdue_count,
      total_overdue_amount=EXCLUDED.total_overdue_amount, oldest_overdue_date=EXCLUDED.oldest_overdue_date,
      latest_overdue_date=EXCLUDED.latest_overdue_date, booking_status=EXCLUDED.booking_status,
      risk_level=EXCLUDED.risk_level, next_action=EXCLUDED.next_action, notes=EXCLUDED.notes;

  INSERT INTO public.payments SELECT * FROM public._seed_payments
    ON CONFLICT (receipt_no) DO UPDATE SET
      payment_date=EXCLUDED.payment_date, booking_id=EXCLUDED.booking_id, client_name=EXCLUDED.client_name,
      cnic=EXCLUDED.cnic, project=EXCLUDED.project, unit_no=EXCLUDED.unit_no, payment_head=EXCLUDED.payment_head,
      payment_mode=EXCLUDED.payment_mode, amount=EXCLUDED.amount, cheque_txn_no=EXCLUDED.cheque_txn_no,
      account=EXCLUDED.account, received_from=EXCLUDED.received_from, memo=EXCLUDED.memo,
      posted_by=EXCLUDED.posted_by, status=EXCLUDED.status, remarks=EXCLUDED.remarks,
      cash_bank_include=EXCLUDED.cash_bank_include, non_cash_adjustment=EXCLUDED.non_cash_adjustment,
      safe_cash_amount=EXCLUDED.safe_cash_amount;

  INSERT INTO public.installment_ledger SELECT * FROM public._seed_installment_ledger
    ON CONFLICT (ledger_id) DO UPDATE SET
      booking_id=EXCLUDED.booking_id, client_name=EXCLUDED.client_name, project=EXCLUDED.project,
      unit_no=EXCLUDED.unit_no, term_no=EXCLUDED.term_no, particulars=EXCLUDED.particulars,
      due_date=EXCLUDED.due_date, due_amount=EXCLUDED.due_amount, paid_amount=EXCLUDED.paid_amount,
      paid_date=EXCLUDED.paid_date, running_balance=EXCLUDED.running_balance, status=EXCLUDED.status,
      days_overdue=EXCLUDED.days_overdue, aging_level=EXCLUDED.aging_level, next_action=EXCLUDED.next_action;

  INSERT INTO public.adjustments SELECT * FROM public._seed_adjustments
    ON CONFLICT (adjustment_id) DO UPDATE SET
      booking_id=EXCLUDED.booking_id, client_ref=EXCLUDED.client_ref, client_name=EXCLUDED.client_name,
      unit_id=EXCLUDED.unit_id, asset_description=EXCLUDED.asset_description,
      approved_value=EXCLUDED.approved_value, realized_value=EXCLUDED.realized_value,
      company_loss_gain=EXCLUDED.company_loss_gain, loss_gain_type=EXCLUDED.loss_gain_type,
      applied_to_ledger=EXCLUDED.applied_to_ledger, risk_check=EXCLUDED.risk_check, note=EXCLUDED.note;

  SELECT jsonb_build_object(
    'projects',           (SELECT count(*) FROM public.projects),
    'clients',            (SELECT count(*) FROM public.clients),
    'units',              (SELECT count(*) FROM public.units),
    'dealers',            (SELECT count(*) FROM public.dealers),
    'bookings',           (SELECT count(*) FROM public.bookings),
    'payments',           (SELECT count(*) FROM public.payments),
    'installment_ledger', (SELECT count(*) FROM public.installment_ledger),
    'adjustments',        (SELECT count(*) FROM public.adjustments)
  ) INTO v_counts;

  RETURN jsonb_build_object('ok', true, 'counts', v_counts, 'reseeded_at', now());
END
$fn$;

REVOKE ALL ON FUNCTION public.reseed_demo_data() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reseed_demo_data() TO authenticated;
