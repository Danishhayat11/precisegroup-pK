
-- Construction module: per-project budgets and cost entries.

CREATE TABLE public.construction_project_budgets (
  project_code text PRIMARY KEY REFERENCES public.projects(project_code) ON DELETE CASCADE,
  approved_budget numeric(14,2) NOT NULL DEFAULT 0 CHECK (approved_budget >= 0),
  progress_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.construction_project_budgets TO authenticated;
GRANT ALL ON public.construction_project_budgets TO service_role;

ALTER TABLE public.construction_project_budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read budgets"   ON public.construction_project_budgets FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert budgets" ON public.construction_project_budgets FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update budgets" ON public.construction_project_budgets FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth delete budgets" ON public.construction_project_budgets FOR DELETE TO authenticated USING (true);

CREATE TABLE public.construction_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_code text NOT NULL REFERENCES public.projects(project_code) ON DELETE RESTRICT,
  cost_date date NOT NULL,
  category text NOT NULL,
  party_type text NOT NULL DEFAULT 'Vendor' CHECK (party_type IN ('Vendor','Contractor')),
  party_name text,
  work_description text NOT NULL,
  quantity numeric(14,3),
  unit text,
  rate numeric(14,2),
  amount numeric(14,2) NOT NULL CHECK (amount >= 0),
  amount_paid numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  payment_mode text,
  reference_no text,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX construction_costs_project_idx ON public.construction_costs(project_code, cost_date DESC);
CREATE INDEX construction_costs_category_idx ON public.construction_costs(project_code, category);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.construction_costs TO authenticated;
GRANT ALL ON public.construction_costs TO service_role;

ALTER TABLE public.construction_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read costs"   ON public.construction_costs FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert costs" ON public.construction_costs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update costs" ON public.construction_costs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth delete costs" ON public.construction_costs FOR DELETE TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER construction_budgets_touch BEFORE UPDATE ON public.construction_project_budgets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER construction_costs_touch BEFORE UPDATE ON public.construction_costs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
