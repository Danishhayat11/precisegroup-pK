-- Roles enum + table
CREATE TYPE public.app_role AS ENUM ('admin','manager','staff','viewer');

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_update_self" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid()=id);

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=_role)
$$;

CREATE OR REPLACE FUNCTION public.is_writer(_uid UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=_uid AND role IN ('admin','manager','staff'))
$$;

CREATE POLICY profiles_select_self_or_admin ON public.profiles FOR SELECT
TO authenticated
USING (auth.uid() = id OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'));

CREATE POLICY roles_select_self_or_admin ON public.user_roles FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));

-- Auto-create profile + grant admin to FIRST user only
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE existing_count INT;
BEGIN
  INSERT INTO public.profiles(id,email,full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)));
  SELECT COUNT(*) INTO existing_count FROM public.user_roles;
  IF existing_count = 0 THEN
    INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles(user_id, role) VALUES (NEW.id, 'viewer');
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- PROJECTS
CREATE TABLE public.projects (
  project_code TEXT PRIMARY KEY,
  project_name TEXT NOT NULL,
  location TEXT,
  status TEXT,
  start_date DATE,
  expected_completion_date DATE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "projects_read" ON public.projects FOR SELECT TO authenticated USING (true);
CREATE POLICY "projects_write" ON public.projects FOR INSERT TO authenticated WITH CHECK (public.is_writer(auth.uid()));
CREATE POLICY "projects_update" ON public.projects FOR UPDATE TO authenticated USING (public.is_writer(auth.uid()));
CREATE POLICY "projects_delete" ON public.projects FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER t_projects_upd BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- UNITS
CREATE TABLE public.units (
  unit_id TEXT PRIMARY KEY,
  project_code TEXT NOT NULL REFERENCES public.projects(project_code) ON DELETE RESTRICT,
  project_name TEXT,
  unit_no TEXT,
  unit_type TEXT,
  floor TEXT,
  size_sqft NUMERIC,
  base_rate NUMERIC,
  standard_value NUMERIC,
  status TEXT DEFAULT 'Available',
  linked_booking_id TEXT,
  booked_by TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_units_project ON public.units(project_code);
CREATE INDEX idx_units_status ON public.units(status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.units TO authenticated;
GRANT ALL ON public.units TO service_role;
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;
CREATE POLICY "units_read" ON public.units FOR SELECT TO authenticated USING (true);
CREATE POLICY "units_write" ON public.units FOR INSERT TO authenticated WITH CHECK (public.is_writer(auth.uid()));
CREATE POLICY "units_update" ON public.units FOR UPDATE TO authenticated USING (public.is_writer(auth.uid()));
CREATE POLICY "units_delete" ON public.units FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER t_units_upd BEFORE UPDATE ON public.units FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- CLIENTS
CREATE TABLE public.clients (
  client_ref TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  so_wo TEXT,
  cnic TEXT,
  mobile TEXT,
  address TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_clients_cnic ON public.clients(cnic);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;
GRANT ALL ON public.clients TO service_role;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clients_read" ON public.clients FOR SELECT TO authenticated USING (true);
CREATE POLICY "clients_write" ON public.clients FOR INSERT TO authenticated WITH CHECK (public.is_writer(auth.uid()));
CREATE POLICY "clients_update" ON public.clients FOR UPDATE TO authenticated USING (public.is_writer(auth.uid()));
CREATE POLICY "clients_delete" ON public.clients FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER t_clients_upd BEFORE UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- DEALERS
CREATE TABLE public.dealers (
  name TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dealers TO authenticated;
GRANT ALL ON public.dealers TO service_role;
ALTER TABLE public.dealers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "dealers_read" ON public.dealers FOR SELECT TO authenticated USING (true);
CREATE POLICY "dealers_write" ON public.dealers FOR ALL TO authenticated USING (public.is_writer(auth.uid())) WITH CHECK (public.is_writer(auth.uid()));

-- BOOKINGS
CREATE TABLE public.bookings (
  booking_id TEXT PRIMARY KEY,
  booking_date DATE,
  project_code TEXT REFERENCES public.projects(project_code),
  project_name TEXT,
  unit_id TEXT REFERENCES public.units(unit_id),
  client_ref TEXT REFERENCES public.clients(client_ref),
  client_name TEXT,
  so_wo TEXT,
  cnic TEXT,
  mobile TEXT,
  address TEXT,
  unit_type TEXT, floor TEXT, size_sqft NUMERIC,
  base_rate NUMERIC, standard_value NUMERIC,
  sold_rate NUMERIC, sold_total_override NUMERIC, sold_unit_value NUMERIC,
  adjustment_credit NUMERIC DEFAULT 0,
  total_contract_value NUMERIC,
  price_loss NUMERIC,
  dealer_name TEXT,
  dealer_commission_pct NUMERIC,
  dealer_commission_fixed NUMERIC,
  dealer_commission_amount NUMERIC,
  net_company_value NUMERIC,
  down_payment NUMERIC DEFAULT 0,
  no_of_installments INT,
  installment_frequency TEXT,
  installment_amount NUMERIC,
  possession_amount NUMERIC,
  first_installment_due DATE,
  possession_due_date DATE,
  cash_received NUMERIC DEFAULT 0,
  remaining_balance NUMERIC,
  current_overdue_count INT DEFAULT 0,
  total_overdue_amount NUMERIC DEFAULT 0,
  oldest_overdue_date DATE,
  latest_overdue_date DATE,
  booking_status TEXT DEFAULT 'Active',
  risk_level TEXT DEFAULT 'LOW',
  next_action TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_bookings_unit ON public.bookings(unit_id);
CREATE INDEX idx_bookings_project ON public.bookings(project_code);
CREATE INDEX idx_bookings_client ON public.bookings(client_ref);
CREATE INDEX idx_bookings_status ON public.bookings(booking_status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bookings TO authenticated;
GRANT ALL ON public.bookings TO service_role;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bookings_read" ON public.bookings FOR SELECT TO authenticated USING (true);
CREATE POLICY "bookings_write" ON public.bookings FOR INSERT TO authenticated WITH CHECK (public.is_writer(auth.uid()));
CREATE POLICY "bookings_update" ON public.bookings FOR UPDATE TO authenticated USING (public.is_writer(auth.uid()));
CREATE POLICY "bookings_delete" ON public.bookings FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER t_bookings_upd BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- PAYMENTS
CREATE TABLE public.payments (
  receipt_no TEXT PRIMARY KEY,
  payment_date DATE,
  booking_id TEXT REFERENCES public.bookings(booking_id) ON DELETE CASCADE,
  client_name TEXT, cnic TEXT, project TEXT, unit_no TEXT,
  payment_head TEXT,
  payment_mode TEXT,
  amount NUMERIC NOT NULL CHECK (amount >= 0),
  cheque_txn_no TEXT,
  account TEXT,
  received_from TEXT,
  memo TEXT,
  posted_by TEXT,
  status TEXT DEFAULT 'Posted',
  remarks TEXT,
  cash_bank_include BOOLEAN DEFAULT true,
  non_cash_adjustment BOOLEAN DEFAULT false,
  safe_cash_amount NUMERIC,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_pay_booking ON public.payments(booking_id);
CREATE INDEX idx_pay_date ON public.payments(payment_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pay_read" ON public.payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "pay_write" ON public.payments FOR INSERT TO authenticated WITH CHECK (public.is_writer(auth.uid()));
CREATE POLICY "pay_update" ON public.payments FOR UPDATE TO authenticated USING (public.is_writer(auth.uid()));
CREATE POLICY "pay_delete" ON public.payments FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER t_pay_upd BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ADJUSTMENTS
CREATE TABLE public.adjustments (
  adjustment_id TEXT PRIMARY KEY,
  booking_id TEXT REFERENCES public.bookings(booking_id) ON DELETE CASCADE,
  client_ref TEXT, client_name TEXT, unit_id TEXT,
  asset_description TEXT,
  approved_value NUMERIC DEFAULT 0,
  realized_value NUMERIC DEFAULT 0,
  company_loss_gain NUMERIC DEFAULT 0,
  loss_gain_type TEXT,
  applied_to_ledger TEXT,
  risk_check TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.adjustments TO authenticated;
GRANT ALL ON public.adjustments TO service_role;
ALTER TABLE public.adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "adj_read" ON public.adjustments FOR SELECT TO authenticated USING (true);
CREATE POLICY "adj_write" ON public.adjustments FOR INSERT TO authenticated WITH CHECK (public.is_writer(auth.uid()));
CREATE POLICY "adj_update" ON public.adjustments FOR UPDATE TO authenticated USING (public.is_writer(auth.uid()));
CREATE POLICY "adj_delete" ON public.adjustments FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- INSTALLMENT LEDGER
CREATE TABLE public.installment_ledger (
  ledger_id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES public.bookings(booking_id) ON DELETE CASCADE,
  client_name TEXT, project TEXT, unit_no TEXT,
  term_no INT,
  particulars TEXT,
  due_date DATE,
  due_amount NUMERIC DEFAULT 0,
  paid_amount NUMERIC DEFAULT 0,
  paid_date DATE,
  running_balance NUMERIC,
  status TEXT,
  days_overdue INT DEFAULT 0,
  aging_level TEXT,
  next_action TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_led_booking ON public.installment_ledger(booking_id);
CREATE INDEX idx_led_due ON public.installment_ledger(due_date);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.installment_ledger TO authenticated;
GRANT ALL ON public.installment_ledger TO service_role;
ALTER TABLE public.installment_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "led_read" ON public.installment_ledger FOR SELECT TO authenticated USING (true);
CREATE POLICY "led_write" ON public.installment_ledger FOR INSERT TO authenticated WITH CHECK (public.is_writer(auth.uid()));
CREATE POLICY "led_update" ON public.installment_ledger FOR UPDATE TO authenticated USING (public.is_writer(auth.uid()));
CREATE POLICY "led_delete" ON public.installment_ledger FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- AUDIT LOG
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID,
  actor_email TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  before JSONB,
  after JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_created ON public.audit_logs(created_at DESC);
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_insert_self ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (actor_id = auth.uid());
CREATE POLICY audit_read_admin ON public.audit_logs FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- APP SETTINGS
CREATE TABLE public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings_read" ON public.app_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "settings_write" ON public.app_settings FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_writer(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
