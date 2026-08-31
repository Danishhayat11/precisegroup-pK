
CREATE TABLE public.hr_payroll_runs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  period_month DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Finalized')),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (period_month)
);

CREATE TABLE public.hr_payslips (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES public.hr_payroll_runs(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES public.hr_employees(id) ON DELETE CASCADE,
  basic_salary NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (basic_salary >= 0),
  allowances NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (allowances >= 0),
  gross_salary NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (gross_salary >= 0),
  working_days INTEGER NOT NULL DEFAULT 0 CHECK (working_days >= 0),
  present_days INTEGER NOT NULL DEFAULT 0 CHECK (present_days >= 0),
  absent_days INTEGER NOT NULL DEFAULT 0 CHECK (absent_days >= 0),
  leave_days INTEGER NOT NULL DEFAULT 0 CHECK (leave_days >= 0),
  half_days INTEGER NOT NULL DEFAULT 0 CHECK (half_days >= 0),
  late_days INTEGER NOT NULL DEFAULT 0 CHECK (late_days >= 0),
  deduction NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (deduction >= 0),
  net_salary NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (net_salary >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, employee_id)
);

CREATE INDEX idx_hr_payslips_run ON public.hr_payslips(run_id);
CREATE INDEX idx_hr_payslips_employee ON public.hr_payslips(employee_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_payroll_runs TO authenticated;
GRANT ALL ON public.hr_payroll_runs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_payslips TO authenticated;
GRANT ALL ON public.hr_payslips TO service_role;

ALTER TABLE public.hr_payroll_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hr_payslips ENABLE ROW LEVEL SECURITY;

-- Runs
CREATE POLICY "hr_payroll_runs_select" ON public.hr_payroll_runs
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'manager'::app_role)
    OR public.has_role(auth.uid(),'staff'::app_role)
  );
CREATE POLICY "hr_payroll_runs_insert" ON public.hr_payroll_runs
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'manager'::app_role)
  );
CREATE POLICY "hr_payroll_runs_update" ON public.hr_payroll_runs
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'manager'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'manager'::app_role)
  );
CREATE POLICY "hr_payroll_runs_delete" ON public.hr_payroll_runs
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role));

-- Payslips
CREATE POLICY "hr_payslips_select" ON public.hr_payslips
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'manager'::app_role)
    OR public.has_role(auth.uid(),'staff'::app_role)
  );
CREATE POLICY "hr_payslips_insert" ON public.hr_payslips
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'manager'::app_role)
  );
CREATE POLICY "hr_payslips_update" ON public.hr_payslips
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'manager'::app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'manager'::app_role)
  );
CREATE POLICY "hr_payslips_delete" ON public.hr_payslips
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role));

CREATE TRIGGER hr_payroll_runs_touch
  BEFORE UPDATE ON public.hr_payroll_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER hr_payslips_touch
  BEFORE UPDATE ON public.hr_payslips
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
