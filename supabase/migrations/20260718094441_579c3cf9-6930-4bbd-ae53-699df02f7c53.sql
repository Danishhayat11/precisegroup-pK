DROP POLICY IF EXISTS "peh_insert" ON public.payment_edit_history;
CREATE POLICY "peh_insert" ON public.payment_edit_history AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "peh_read" ON public.payment_edit_history;
CREATE POLICY "peh_read" ON public.payment_edit_history AS PERMISSIVE FOR SELECT TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "pay_delete" ON public.payments;
CREATE POLICY "pay_delete" ON public.payments AS PERMISSIVE FOR DELETE TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "pay_read" ON public.payments;
CREATE POLICY "pay_read" ON public.payments AS PERMISSIVE FOR SELECT TO authenticated USING (((is_writer(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "pay_update" ON public.payments;
CREATE POLICY "pay_update" ON public.payments AS PERMISSIVE FOR UPDATE TO authenticated USING (((is_writer(auth.uid())) AND (company_id = public.current_company_id()))) WITH CHECK (((is_writer(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "pay_write" ON public.payments;
CREATE POLICY "pay_write" ON public.payments AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((is_writer(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "prh_insert" ON public.plan_restructure_history;
CREATE POLICY "prh_insert" ON public.plan_restructure_history AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "prh_read" ON public.plan_restructure_history;
CREATE POLICY "prh_read" ON public.plan_restructure_history AS PERMISSIVE FOR SELECT TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "projects_update" ON public.projects;
CREATE POLICY "projects_update" ON public.projects AS PERMISSIVE FOR UPDATE TO authenticated USING (((is_writer(auth.uid())) AND (company_id = public.current_company_id()))) WITH CHECK (((is_writer(auth.uid())) AND (company_id = public.current_company_id())));

DROP POLICY IF EXISTS "Admins can view all tenant scope logs" ON public.tenant_scope_logs;
CREATE POLICY "Admins can view all tenant scope logs" ON public.tenant_scope_logs AS PERMISSIVE FOR SELECT TO authenticated USING (((has_role(auth.uid(), 'admin'::app_role)) AND (company_id = public.current_company_id())));