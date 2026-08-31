
-- ================================================================
-- Tighten RLS on construction_costs & construction_project_budgets
-- ================================================================

-- construction_costs: drop permissive true policies + broad tenant ALL
DROP POLICY IF EXISTS "auth read costs"   ON public.construction_costs;
DROP POLICY IF EXISTS "auth insert costs" ON public.construction_costs;
DROP POLICY IF EXISTS "auth update costs" ON public.construction_costs;
DROP POLICY IF EXISTS "auth delete costs" ON public.construction_costs;
DROP POLICY IF EXISTS "construction_costs_tenant_isolation" ON public.construction_costs;

CREATE POLICY "construction_costs_select_tenant"
  ON public.construction_costs FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());

CREATE POLICY "construction_costs_insert_writer"
  ON public.construction_costs FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.current_company_id()
    AND (public.is_writer(auth.uid()) OR public.has_role(auth.uid(), 'admin'::app_role))
  );

CREATE POLICY "construction_costs_update_writer"
  ON public.construction_costs FOR UPDATE TO authenticated
  USING (
    company_id = public.current_company_id()
    AND (public.is_writer(auth.uid()) OR public.has_role(auth.uid(), 'admin'::app_role))
  )
  WITH CHECK (
    company_id = public.current_company_id()
    AND (public.is_writer(auth.uid()) OR public.has_role(auth.uid(), 'admin'::app_role))
  );

CREATE POLICY "construction_costs_delete_admin"
  ON public.construction_costs FOR DELETE TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );

-- construction_project_budgets: same shape
DROP POLICY IF EXISTS "auth read budgets"   ON public.construction_project_budgets;
DROP POLICY IF EXISTS "auth insert budgets" ON public.construction_project_budgets;
DROP POLICY IF EXISTS "auth update budgets" ON public.construction_project_budgets;
DROP POLICY IF EXISTS "auth delete budgets" ON public.construction_project_budgets;
DROP POLICY IF EXISTS "construction_project_budgets_tenant_isolation" ON public.construction_project_budgets;

CREATE POLICY "construction_project_budgets_select_tenant"
  ON public.construction_project_budgets FOR SELECT TO authenticated
  USING (company_id = public.current_company_id());

CREATE POLICY "construction_project_budgets_insert_writer"
  ON public.construction_project_budgets FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.current_company_id()
    AND (public.is_writer(auth.uid()) OR public.has_role(auth.uid(), 'admin'::app_role))
  );

CREATE POLICY "construction_project_budgets_update_writer"
  ON public.construction_project_budgets FOR UPDATE TO authenticated
  USING (
    company_id = public.current_company_id()
    AND (public.is_writer(auth.uid()) OR public.has_role(auth.uid(), 'admin'::app_role))
  )
  WITH CHECK (
    company_id = public.current_company_id()
    AND (public.is_writer(auth.uid()) OR public.has_role(auth.uid(), 'admin'::app_role))
  );

CREATE POLICY "construction_project_budgets_delete_admin"
  ON public.construction_project_budgets FOR DELETE TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );

-- ================================================================
-- Storage: employee-photos — scope by hr_employees.company_id
-- ================================================================
DROP POLICY IF EXISTS "Authenticated read employee photos"   ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload employee photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated update employee photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated delete employee photos" ON storage.objects;

CREATE POLICY "Employee photos read same-company"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'employee-photos'
    AND EXISTS (
      SELECT 1 FROM public.hr_employees e
      WHERE e.photo_path = storage.objects.name
        AND e.company_id = public.current_company_id()
    )
  );

CREATE POLICY "Employee photos insert writer"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'employee-photos'
    AND (public.is_writer(auth.uid()) OR public.has_role(auth.uid(), 'admin'::app_role))
  );

CREATE POLICY "Employee photos update writer same-company"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'employee-photos'
    AND (public.is_writer(auth.uid()) OR public.has_role(auth.uid(), 'admin'::app_role))
    AND EXISTS (
      SELECT 1 FROM public.hr_employees e
      WHERE e.photo_path = storage.objects.name
        AND e.company_id = public.current_company_id()
    )
  )
  WITH CHECK (
    bucket_id = 'employee-photos'
    AND (public.is_writer(auth.uid()) OR public.has_role(auth.uid(), 'admin'::app_role))
  );

CREATE POLICY "Employee photos delete admin same-company"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'employee-photos'
    AND public.has_role(auth.uid(), 'admin'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.hr_employees e
      WHERE e.photo_path = storage.objects.name
        AND e.company_id = public.current_company_id()
    )
  );

-- ================================================================
-- Storage: expense-receipts — scope by office_expenses.company_id
-- ================================================================
DROP POLICY IF EXISTS "expense receipts read"   ON storage.objects;
DROP POLICY IF EXISTS "expense receipts insert" ON storage.objects;
DROP POLICY IF EXISTS "expense receipts update" ON storage.objects;
DROP POLICY IF EXISTS "expense receipts delete" ON storage.objects;

CREATE POLICY "Expense receipts read same-company"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND EXISTS (
      SELECT 1 FROM public.office_expenses o
      WHERE o.receipt_attachment_path = storage.objects.name
        AND o.company_id = public.current_company_id()
    )
  );

CREATE POLICY "Expense receipts insert writer"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'expense-receipts'
    AND (public.is_writer(auth.uid()) OR public.has_role(auth.uid(), 'admin'::app_role))
  );

CREATE POLICY "Expense receipts update writer same-company"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND (public.is_writer(auth.uid()) OR public.has_role(auth.uid(), 'admin'::app_role))
    AND EXISTS (
      SELECT 1 FROM public.office_expenses o
      WHERE o.receipt_attachment_path = storage.objects.name
        AND o.company_id = public.current_company_id()
    )
  )
  WITH CHECK (
    bucket_id = 'expense-receipts'
    AND (public.is_writer(auth.uid()) OR public.has_role(auth.uid(), 'admin'::app_role))
  );

CREATE POLICY "Expense receipts delete admin same-company"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'expense-receipts'
    AND public.has_role(auth.uid(), 'admin'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.office_expenses o
      WHERE o.receipt_attachment_path = storage.objects.name
        AND o.company_id = public.current_company_id()
    )
  );
