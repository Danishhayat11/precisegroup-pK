
-- Add RESTRICTIVE tenant isolation policies to profiles and _seed_* tables.
-- RESTRICTIVE combines with existing PERMISSIVE policies via AND, so admins
-- can still see their own company's rows but not other companies'.
-- Super admins bypass tenant scoping (cross-tenant maintenance).

CREATE POLICY "profiles_tenant_isolation"
  ON public.profiles
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (company_id = public.current_company_id() OR public.is_super_admin(auth.uid()))
  WITH CHECK (company_id = public.current_company_id() OR public.is_super_admin(auth.uid()));

CREATE POLICY "_seed_adjustments_tenant_isolation"
  ON public._seed_adjustments AS RESTRICTIVE FOR ALL TO authenticated
  USING (company_id = public.current_company_id() OR public.is_super_admin(auth.uid()))
  WITH CHECK (company_id = public.current_company_id() OR public.is_super_admin(auth.uid()));

CREATE POLICY "_seed_bookings_tenant_isolation"
  ON public._seed_bookings AS RESTRICTIVE FOR ALL TO authenticated
  USING (company_id = public.current_company_id() OR public.is_super_admin(auth.uid()))
  WITH CHECK (company_id = public.current_company_id() OR public.is_super_admin(auth.uid()));

CREATE POLICY "_seed_clients_tenant_isolation"
  ON public._seed_clients AS RESTRICTIVE FOR ALL TO authenticated
  USING (company_id = public.current_company_id() OR public.is_super_admin(auth.uid()))
  WITH CHECK (company_id = public.current_company_id() OR public.is_super_admin(auth.uid()));

CREATE POLICY "_seed_dealers_tenant_isolation"
  ON public._seed_dealers AS RESTRICTIVE FOR ALL TO authenticated
  USING (company_id = public.current_company_id() OR public.is_super_admin(auth.uid()))
  WITH CHECK (company_id = public.current_company_id() OR public.is_super_admin(auth.uid()));

CREATE POLICY "_seed_installment_ledger_tenant_isolation"
  ON public._seed_installment_ledger AS RESTRICTIVE FOR ALL TO authenticated
  USING (company_id = public.current_company_id() OR public.is_super_admin(auth.uid()))
  WITH CHECK (company_id = public.current_company_id() OR public.is_super_admin(auth.uid()));

CREATE POLICY "_seed_payments_tenant_isolation"
  ON public._seed_payments AS RESTRICTIVE FOR ALL TO authenticated
  USING (company_id = public.current_company_id() OR public.is_super_admin(auth.uid()))
  WITH CHECK (company_id = public.current_company_id() OR public.is_super_admin(auth.uid()));

CREATE POLICY "_seed_projects_tenant_isolation"
  ON public._seed_projects AS RESTRICTIVE FOR ALL TO authenticated
  USING (company_id = public.current_company_id() OR public.is_super_admin(auth.uid()))
  WITH CHECK (company_id = public.current_company_id() OR public.is_super_admin(auth.uid()));

CREATE POLICY "_seed_units_tenant_isolation"
  ON public._seed_units AS RESTRICTIVE FOR ALL TO authenticated
  USING (company_id = public.current_company_id() OR public.is_super_admin(auth.uid()))
  WITH CHECK (company_id = public.current_company_id() OR public.is_super_admin(auth.uid()));
