
-- Tighten crm_leads: admin-only CRUD, still tenant-scoped.
DROP POLICY IF EXISTS "crm_leads_select" ON public.crm_leads;
DROP POLICY IF EXISTS "crm_leads_insert" ON public.crm_leads;
DROP POLICY IF EXISTS "crm_leads_update" ON public.crm_leads;
DROP POLICY IF EXISTS "crm_leads_delete" ON public.crm_leads;
DROP POLICY IF EXISTS "Users can view leads in their company" ON public.crm_leads;
DROP POLICY IF EXISTS "Users can insert leads in their company" ON public.crm_leads;
DROP POLICY IF EXISTS "Users can update leads in their company" ON public.crm_leads;
DROP POLICY IF EXISTS "Users can delete leads in their company" ON public.crm_leads;

CREATE POLICY "crm_leads_admin_select"
  ON public.crm_leads FOR SELECT TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  );

CREATE POLICY "crm_leads_admin_insert"
  ON public.crm_leads FOR INSERT TO authenticated
  WITH CHECK (
    company_id = public.current_company_id()
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  );

CREATE POLICY "crm_leads_admin_update"
  ON public.crm_leads FOR UPDATE TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  )
  WITH CHECK (
    company_id = public.current_company_id()
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  );

CREATE POLICY "crm_leads_admin_delete"
  ON public.crm_leads FOR DELETE TO authenticated
  USING (
    company_id = public.current_company_id()
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  );
