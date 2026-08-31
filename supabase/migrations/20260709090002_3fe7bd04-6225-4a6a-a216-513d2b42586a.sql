-- HR & Payroll: employees master table.
-- Employee IDs use a dedicated sequence + BEFORE INSERT trigger to render
-- as "EMP-001" style codes, zero-padded to 3 digits and monotonically
-- increasing. Allocating from a sequence (not max()+1) is race-safe under
-- concurrent inserts.

CREATE SEQUENCE IF NOT EXISTS public.hr_employee_id_seq START WITH 1 INCREMENT BY 1;

CREATE TABLE public.hr_employees (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     TEXT NOT NULL UNIQUE,
  full_name       TEXT NOT NULL,
  father_name     TEXT,
  cnic            TEXT,
  mobile          TEXT,
  address         TEXT,
  designation     TEXT,
  department      TEXT NOT NULL CHECK (department IN (
                    'Management','Sales','Accounts','Admin','Security',
                    'Housekeeping','Site Staff','Project Engineer',
                    'Site Engineer','Other'
                  )),
  join_date       DATE,
  basic_salary    NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (basic_salary >= 0),
  allowances      NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (allowances >= 0),
  total_salary    NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (total_salary >= 0),
  bank_account    TEXT,
  bank_name       TEXT,
  emergency_contact TEXT,
  emergency_mobile  TEXT,
  status          TEXT NOT NULL DEFAULT 'Active' CHECK (status IN (
                    'Active','On Leave','Resigned','Terminated'
                  )),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- GRANTs — required for PostgREST access. Reads for anyone signed in with
-- an HR-visible role; writes for admin/manager only, but policy scoping is
-- enforced separately below.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hr_employees TO authenticated;
GRANT ALL ON public.hr_employees TO service_role;
GRANT USAGE ON SEQUENCE public.hr_employee_id_seq TO authenticated, service_role;

-- Auto-populate employee_id on insert when caller didn't provide one.
CREATE OR REPLACE FUNCTION public.hr_employee_assign_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.employee_id IS NULL OR NEW.employee_id = '' THEN
    NEW.employee_id := 'EMP-' || lpad(nextval('public.hr_employee_id_seq')::text, 3, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER hr_employees_assign_id
BEFORE INSERT ON public.hr_employees
FOR EACH ROW EXECUTE FUNCTION public.hr_employee_assign_id();

-- Reuse the shared updated_at trigger if it exists; otherwise create a local one.
CREATE OR REPLACE FUNCTION public.hr_employees_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER hr_employees_touch
BEFORE UPDATE ON public.hr_employees
FOR EACH ROW EXECUTE FUNCTION public.hr_employees_touch_updated_at();

CREATE INDEX idx_hr_employees_status     ON public.hr_employees(status);
CREATE INDEX idx_hr_employees_department ON public.hr_employees(department);

ALTER TABLE public.hr_employees ENABLE ROW LEVEL SECURITY;

-- Read: admin, manager, staff — same audience as the rest of the ERP's
-- writer/reader triad. Adjust here later if HR should be more restricted.
CREATE POLICY "hr_employees_select" ON public.hr_employees
FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(),'admin')
  OR public.has_role(auth.uid(),'manager')
  OR public.has_role(auth.uid(),'staff')
);

-- Write: admin + manager only. Staff can read but not mutate payroll data.
CREATE POLICY "hr_employees_insert" ON public.hr_employees
FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(),'admin')
  OR public.has_role(auth.uid(),'manager')
);

CREATE POLICY "hr_employees_update" ON public.hr_employees
FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(),'admin')
  OR public.has_role(auth.uid(),'manager')
)
WITH CHECK (
  public.has_role(auth.uid(),'admin')
  OR public.has_role(auth.uid(),'manager')
);

CREATE POLICY "hr_employees_delete" ON public.hr_employees
FOR DELETE TO authenticated
USING (public.has_role(auth.uid(),'admin'));
