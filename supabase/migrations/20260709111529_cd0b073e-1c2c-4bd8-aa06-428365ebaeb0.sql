
-- =====================================================================
-- MAINTENANCE MODULE
-- =====================================================================

-- Sequences for human-readable IDs
CREATE SEQUENCE IF NOT EXISTS public.maintenance_charge_seq START 1;
CREATE SEQUENCE IF NOT EXISTS public.maintenance_receipt_seq START 1;
CREATE SEQUENCE IF NOT EXISTS public.maintenance_expense_seq START 1;

-- ---------------------------------------------------------------------
-- 1) maintenance_schedules
-- ---------------------------------------------------------------------
CREATE TABLE public.maintenance_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_code TEXT NOT NULL REFERENCES public.projects(project_code) ON DELETE RESTRICT,
  charge_name TEXT NOT NULL,
  charge_type TEXT NOT NULL CHECK (charge_type IN ('Monthly','Quarterly','Annually','One-Time')),
  fixed_amount NUMERIC(14,2),
  amount_per_sqft NUMERIC(14,4),
  applicable_to TEXT NOT NULL DEFAULT 'All Units'
    CHECK (applicable_to IN ('All Units','Apartments Only','Shops Only','Offices Only','Custom Selection')),
  custom_unit_ids TEXT[] NOT NULL DEFAULT '{}',
  effective_from DATE NOT NULL,
  due_day SMALLINT CHECK (due_day BETWEEN 1 AND 28),
  late_fee NUMERIC(14,2) NOT NULL DEFAULT 0,
  grace_period_days SMALLINT NOT NULL DEFAULT 7,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (fixed_amount IS NOT NULL OR amount_per_sqft IS NOT NULL)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.maintenance_schedules TO authenticated;
GRANT ALL ON public.maintenance_schedules TO service_role;
ALTER TABLE public.maintenance_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "roled users read schedules" ON public.maintenance_schedules
  FOR SELECT TO authenticated USING (public.has_any_role(auth.uid()));
CREATE POLICY "writers manage schedules" ON public.maintenance_schedules
  FOR ALL TO authenticated
  USING (public.is_writer(auth.uid()))
  WITH CHECK (public.is_writer(auth.uid()));
CREATE POLICY "admins delete schedules" ON public.maintenance_schedules
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_maint_sched_updated BEFORE UPDATE ON public.maintenance_schedules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------
-- 2) maintenance_charges
-- ---------------------------------------------------------------------
CREATE TABLE public.maintenance_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id TEXT NOT NULL UNIQUE
    DEFAULT ('MC-' || lpad(nextval('public.maintenance_charge_seq')::text, 5, '0')),
  schedule_id UUID NOT NULL REFERENCES public.maintenance_schedules(id) ON DELETE CASCADE,
  unit_id TEXT NOT NULL REFERENCES public.units(unit_id) ON DELETE RESTRICT,
  booking_id TEXT REFERENCES public.bookings(booking_id) ON DELETE SET NULL,
  project_code TEXT NOT NULL,
  project_name TEXT,
  client_name TEXT,
  charge_name TEXT NOT NULL,
  period TEXT NOT NULL,          -- e.g. 2026-07 or 2026-Q3 or 2026 or ONE-TIME
  period_start DATE NOT NULL,
  amount_due NUMERIC(14,2) NOT NULL DEFAULT 0,
  late_fee NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_due NUMERIC(14,2) NOT NULL DEFAULT 0,
  due_date DATE NOT NULL,
  paid_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid_date DATE,
  balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Upcoming'
    CHECK (status IN ('Paid','Overdue','Due Soon','Upcoming','Partial','Waived')),
  waived BOOLEAN NOT NULL DEFAULT FALSE,
  waived_reason TEXT,
  waived_by UUID,
  waived_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (schedule_id, unit_id, period)
);
CREATE INDEX ON public.maintenance_charges (project_code);
CREATE INDEX ON public.maintenance_charges (unit_id);
CREATE INDEX ON public.maintenance_charges (status);
CREATE INDEX ON public.maintenance_charges (due_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.maintenance_charges TO authenticated;
GRANT ALL ON public.maintenance_charges TO service_role;
ALTER TABLE public.maintenance_charges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "roled users read charges" ON public.maintenance_charges
  FOR SELECT TO authenticated USING (public.has_any_role(auth.uid()));
CREATE POLICY "writers manage charges" ON public.maintenance_charges
  FOR ALL TO authenticated
  USING (public.is_writer(auth.uid()))
  WITH CHECK (public.is_writer(auth.uid()));
CREATE POLICY "admins delete charges" ON public.maintenance_charges
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_maint_charge_updated BEFORE UPDATE ON public.maintenance_charges
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------
-- 3) maintenance_payments
-- ---------------------------------------------------------------------
CREATE TABLE public.maintenance_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_no TEXT NOT NULL UNIQUE
    DEFAULT ('MC-RC-' || lpad(nextval('public.maintenance_receipt_seq')::text, 5, '0')),
  charge_id TEXT NOT NULL REFERENCES public.maintenance_charges(charge_id) ON DELETE RESTRICT,
  unit_id TEXT NOT NULL,
  client_name TEXT,
  amount_paid NUMERIC(14,2) NOT NULL CHECK (amount_paid > 0),
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_mode TEXT NOT NULL CHECK (payment_mode IN ('Cash','Cheque','Online Transfer','Bank Draft')),
  reference_no TEXT,
  received_by TEXT,
  late_fee_waived BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.maintenance_payments (charge_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.maintenance_payments TO authenticated;
GRANT ALL ON public.maintenance_payments TO service_role;
ALTER TABLE public.maintenance_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "roled users read payments" ON public.maintenance_payments
  FOR SELECT TO authenticated USING (public.has_any_role(auth.uid()));
CREATE POLICY "writers manage payments" ON public.maintenance_payments
  FOR ALL TO authenticated
  USING (public.is_writer(auth.uid()))
  WITH CHECK (public.is_writer(auth.uid()));
CREATE POLICY "admins delete payments" ON public.maintenance_payments
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_maint_pay_updated BEFORE UPDATE ON public.maintenance_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------
-- 4) maintenance_expenses
-- ---------------------------------------------------------------------
CREATE TABLE public.maintenance_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_no TEXT NOT NULL UNIQUE
    DEFAULT ('ME-' || lpad(nextval('public.maintenance_expense_seq')::text, 5, '0')),
  project_code TEXT REFERENCES public.projects(project_code) ON DELETE SET NULL,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  category TEXT NOT NULL CHECK (category IN (
    'Lift/Elevator Repair','Generator Maintenance','Water Pump',
    'Common Area Cleaning','Plumbing Repair','Electrical Repair',
    'Painting/Whitewash','Security Services','Gardening/Landscaping',
    'Roof Repair','Building Insurance','Other'
  )),
  description TEXT,
  vendor TEXT,
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  paid_by TEXT,
  reference_no TEXT,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON public.maintenance_expenses (project_code);
CREATE INDEX ON public.maintenance_expenses (date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.maintenance_expenses TO authenticated;
GRANT ALL ON public.maintenance_expenses TO service_role;
ALTER TABLE public.maintenance_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "roled users read expenses" ON public.maintenance_expenses
  FOR SELECT TO authenticated USING (public.has_any_role(auth.uid()));
CREATE POLICY "writers manage expenses" ON public.maintenance_expenses
  FOR ALL TO authenticated
  USING (public.is_writer(auth.uid()))
  WITH CHECK (public.is_writer(auth.uid()));
CREATE POLICY "admins delete expenses" ON public.maintenance_expenses
  FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_maint_exp_updated BEFORE UPDATE ON public.maintenance_expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------
-- Helper: recompute a charge's paid/balance/status after a payment change
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalc_maintenance_charge(_charge_id TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_paid NUMERIC := 0;
  v_max_date DATE;
  v_row public.maintenance_charges;
  v_today DATE := CURRENT_DATE;
  v_effective_total NUMERIC;
  v_new_status TEXT;
  v_late_fee_waived BOOLEAN := FALSE;
BEGIN
  SELECT * INTO v_row FROM public.maintenance_charges WHERE charge_id = _charge_id;
  IF v_row.id IS NULL THEN RETURN; END IF;

  SELECT COALESCE(SUM(amount_paid),0), MAX(payment_date),
         bool_or(late_fee_waived)
    INTO v_paid, v_max_date, v_late_fee_waived
  FROM public.maintenance_payments WHERE charge_id = _charge_id;

  v_effective_total := v_row.amount_due + CASE WHEN v_late_fee_waived THEN 0 ELSE v_row.late_fee END;

  IF v_row.waived THEN
    v_new_status := 'Waived';
  ELSIF v_paid >= v_effective_total AND v_effective_total > 0 THEN
    v_new_status := 'Paid';
  ELSIF v_paid > 0 THEN
    v_new_status := 'Partial';
  ELSIF v_row.due_date < v_today THEN
    v_new_status := 'Overdue';
  ELSIF v_row.due_date <= v_today + 7 THEN
    v_new_status := 'Due Soon';
  ELSE
    v_new_status := 'Upcoming';
  END IF;

  UPDATE public.maintenance_charges
     SET paid_amount = v_paid,
         paid_date = v_max_date,
         total_due = v_effective_total,
         balance = GREATEST(0::numeric, v_effective_total - v_paid),
         status = v_new_status,
         updated_at = now()
   WHERE charge_id = _charge_id;
END $$;

-- Trigger: after any payment change, recalc parent charge
CREATE OR REPLACE FUNCTION public.trg_recalc_maintenance_charge()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_cid TEXT;
BEGIN
  v_cid := COALESCE(NEW.charge_id, OLD.charge_id);
  IF v_cid IS NOT NULL THEN
    PERFORM public.recalc_maintenance_charge(v_cid);
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER trg_maint_pay_recalc
AFTER INSERT OR UPDATE OR DELETE ON public.maintenance_payments
FOR EACH ROW EXECUTE FUNCTION public.trg_recalc_maintenance_charge();

-- ---------------------------------------------------------------------
-- Helper: generate charges for a schedule from effective_from up to _through
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_maintenance_charges(_schedule_id UUID, _through DATE)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sched public.maintenance_schedules;
  v_proj_name TEXT;
  v_step INTERVAL;
  v_period_date DATE;
  v_period_label TEXT;
  v_due DATE;
  v_unit RECORD;
  v_inserted INTEGER := 0;
  v_amount NUMERIC;
BEGIN
  IF NOT public.is_writer(auth.uid()) THEN
    RAISE EXCEPTION 'writer role required' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_sched FROM public.maintenance_schedules WHERE id = _schedule_id;
  IF v_sched.id IS NULL THEN RAISE EXCEPTION 'schedule not found'; END IF;
  SELECT project_name INTO v_proj_name FROM public.projects WHERE project_code = v_sched.project_code;

  v_step := CASE v_sched.charge_type
    WHEN 'Monthly'   THEN INTERVAL '1 month'
    WHEN 'Quarterly' THEN INTERVAL '3 months'
    WHEN 'Annually'  THEN INTERVAL '1 year'
    ELSE NULL
  END;

  v_period_date := date_trunc('month', v_sched.effective_from)::date;
  IF v_sched.charge_type = 'Quarterly' THEN
    v_period_date := date_trunc('quarter', v_sched.effective_from)::date;
  ELSIF v_sched.charge_type = 'Annually' THEN
    v_period_date := date_trunc('year', v_sched.effective_from)::date;
  END IF;

  LOOP
    -- Exit conditions
    IF v_sched.charge_type <> 'One-Time' AND v_period_date > _through THEN EXIT; END IF;

    -- Compute period label + due date
    v_period_label := CASE v_sched.charge_type
      WHEN 'Monthly'   THEN to_char(v_period_date,'YYYY-MM')
      WHEN 'Quarterly' THEN to_char(v_period_date,'YYYY') || '-Q' || to_char(v_period_date,'Q')
      WHEN 'Annually'  THEN to_char(v_period_date,'YYYY')
      ELSE 'ONE-TIME'
    END;

    v_due := CASE v_sched.charge_type
      WHEN 'Monthly'   THEN (date_trunc('month', v_period_date) + make_interval(days => COALESCE(v_sched.due_day,1) - 1))::date
      WHEN 'Quarterly' THEN (v_period_date + INTERVAL '1 month')::date
      WHEN 'Annually'  THEN (v_period_date + INTERVAL '1 month')::date
      ELSE v_sched.effective_from
    END;

    -- Insert one row per applicable unit
    FOR v_unit IN
      SELECT u.unit_id, u.unit_type, u.size_sqft, u.linked_booking_id,
             b.client_name
        FROM public.units u
        LEFT JOIN public.bookings b ON b.booking_id = u.linked_booking_id
       WHERE u.project_code = v_sched.project_code
         AND (
           v_sched.applicable_to = 'All Units'
           OR (v_sched.applicable_to = 'Apartments Only' AND u.unit_type ILIKE 'apartment%')
           OR (v_sched.applicable_to = 'Shops Only'      AND u.unit_type ILIKE 'shop%')
           OR (v_sched.applicable_to = 'Offices Only'    AND u.unit_type ILIKE 'office%')
           OR (v_sched.applicable_to = 'Custom Selection' AND u.unit_id = ANY(v_sched.custom_unit_ids))
         )
    LOOP
      v_amount := COALESCE(v_sched.fixed_amount, 0);
      IF v_sched.amount_per_sqft IS NOT NULL AND v_unit.size_sqft IS NOT NULL THEN
        v_amount := v_amount + (v_sched.amount_per_sqft * v_unit.size_sqft);
      END IF;

      INSERT INTO public.maintenance_charges
        (schedule_id, unit_id, booking_id, project_code, project_name, client_name,
         charge_name, period, period_start, amount_due, late_fee, total_due, due_date, balance, status)
      VALUES
        (v_sched.id, v_unit.unit_id, v_unit.linked_booking_id, v_sched.project_code, v_proj_name, v_unit.client_name,
         v_sched.charge_name, v_period_label, v_period_date, v_amount, v_sched.late_fee,
         v_amount + v_sched.late_fee, v_due, v_amount + v_sched.late_fee,
         CASE
           WHEN v_due < CURRENT_DATE THEN 'Overdue'
           WHEN v_due <= CURRENT_DATE + 7 THEN 'Due Soon'
           ELSE 'Upcoming'
         END)
      ON CONFLICT (schedule_id, unit_id, period) DO NOTHING;

      IF FOUND THEN v_inserted := v_inserted + 1; END IF;
    END LOOP;

    IF v_sched.charge_type = 'One-Time' THEN EXIT; END IF;
    v_period_date := (v_period_date + v_step)::date;
  END LOOP;

  RETURN v_inserted;
END $$;

-- ---------------------------------------------------------------------
-- Helper: admin waive a charge (writes audit log)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.waive_maintenance_charge(_charge_id TEXT, _reason TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_email TEXT;
  v_before JSONB;
BEGIN
  IF NOT public.has_role(v_uid,'admin') THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE='42501';
  END IF;
  IF _reason IS NULL OR length(btrim(_reason)) = 0 THEN
    RAISE EXCEPTION 'reason required';
  END IF;

  SELECT email INTO v_email FROM public.profiles WHERE id = v_uid;
  SELECT to_jsonb(c) INTO v_before FROM public.maintenance_charges c WHERE charge_id = _charge_id;

  UPDATE public.maintenance_charges
     SET waived = TRUE, waived_reason = _reason, waived_by = v_uid, waived_at = now(), status = 'Waived',
         balance = 0, updated_at = now()
   WHERE charge_id = _charge_id;

  INSERT INTO public.audit_logs(actor_id, actor_email, action, entity, entity_id, before, after)
  VALUES (v_uid, v_email, 'maintenance_charge.waive', 'maintenance_charge', _charge_id,
          v_before, jsonb_build_object('reason', _reason));
END $$;
