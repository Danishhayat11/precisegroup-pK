CREATE TABLE public.office_expenses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount >= 0),
  paid_by TEXT NOT NULL,
  paid_to TEXT,
  receipt_ref TEXT,
  project_code TEXT,
  notes TEXT,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX office_expenses_date_idx ON public.office_expenses (expense_date DESC);
CREATE INDEX office_expenses_category_idx ON public.office_expenses (category);
CREATE INDEX office_expenses_project_idx ON public.office_expenses (project_code);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.office_expenses TO authenticated;
GRANT ALL ON public.office_expenses TO service_role;

ALTER TABLE public.office_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY office_expenses_select ON public.office_expenses
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'manager') OR has_role(auth.uid(),'staff'));

CREATE POLICY office_expenses_insert ON public.office_expenses
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'manager'));

CREATE POLICY office_expenses_update ON public.office_expenses
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'manager'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'manager'));

CREATE POLICY office_expenses_delete ON public.office_expenses
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'admin'));

CREATE TRIGGER office_expenses_set_updated_at
  BEFORE UPDATE ON public.office_expenses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();