
-- 1) hr_employees: remove staff read access to sensitive PII
DROP POLICY IF EXISTS hr_employees_select ON public.hr_employees;
CREATE POLICY hr_employees_select ON public.hr_employees
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'manager'::app_role)
  );

-- 2) companies: mirror admin check in WITH CHECK
DROP POLICY IF EXISTS companies_update_admin ON public.companies;
CREATE POLICY companies_update_admin ON public.companies
  FOR UPDATE TO authenticated
  USING (
    id = current_company_id()
    AND has_role(auth.uid(), 'admin'::app_role)
  )
  WITH CHECK (
    id = current_company_id()
    AND has_role(auth.uid(), 'admin'::app_role)
  );

-- 3) projects: add explicit tenant check in permissive SELECT policy
DROP POLICY IF EXISTS projects_read ON public.projects;
CREATE POLICY projects_read ON public.projects
  FOR SELECT TO authenticated
  USING (company_id = current_company_id());
