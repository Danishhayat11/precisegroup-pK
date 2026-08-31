
CREATE TABLE public.hr_final_settlements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  settlement_date DATE NOT NULL DEFAULT CURRENT_DATE,
  last_working_date DATE,
  reason TEXT NOT NULL CHECK (reason IN ('Resigned','Terminated')),
  years_of_service NUMERIC(6,2) NOT NULL DEFAULT 0,
  basic_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  allowances NUMERIC(12,2) NOT NULL DEFAULT 0,
  unpaid_salary NUMERIC(12,2) NOT NULL DEFAULT 0,
  leave_encashment NUMERIC(12,2) NOT NULL DEFAULT 0,
  gratuity NUMERIC(12,2) NOT NULL DEFAULT 0,
  bonus NUMERIC(12,2) NOT NULL DEFAULT 0,
  other_additions NUMERIC(12,2) NOT NULL DEFAULT 0,
  deductions NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_payable NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Finalized','Paid')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (employee_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_final_settlements TO authenticated;
GRANT ALL ON public.hr_final_settlements TO service_role;

ALTER TABLE public.hr_final_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY hr_final_settlements_select ON public.hr_final_settlements
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'manager') OR has_role(auth.uid(),'staff'));

CREATE POLICY hr_final_settlements_insert ON public.hr_final_settlements
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'manager'));

CREATE POLICY hr_final_settlements_update ON public.hr_final_settlements
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'manager'))
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'manager'));

CREATE POLICY hr_final_settlements_delete ON public.hr_final_settlements
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(),'admin'));

CREATE TRIGGER hr_final_settlements_set_updated_at
  BEFORE UPDATE ON public.hr_final_settlements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
