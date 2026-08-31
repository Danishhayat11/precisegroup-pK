
-- 1) Recreate policies scoped to authenticated role
DROP POLICY IF EXISTS pa_insert ON public.payment_allocations;
CREATE POLICY pa_insert ON public.payment_allocations
  FOR INSERT TO authenticated
  WITH CHECK (is_writer(auth.uid()));

DROP POLICY IF EXISTS roles_admin_delete ON public.user_roles;
CREATE POLICY roles_admin_delete ON public.user_roles
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS roles_admin_insert ON public.user_roles;
CREATE POLICY roles_admin_insert ON public.user_roles
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS roles_admin_update ON public.user_roles;
CREATE POLICY roles_admin_update ON public.user_roles
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 2) Prevent regular users from changing profiles.company_id (tenant hijack guard)
CREATE OR REPLACE FUNCTION public.prevent_company_id_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    IF NOT (has_role(auth.uid(), 'super_admin'::app_role) OR has_role(auth.uid(), 'admin'::app_role)) THEN
      RAISE EXCEPTION 'company_id can only be changed by an admin or super_admin'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_prevent_company_id_change ON public.profiles;
CREATE TRIGGER trg_profiles_prevent_company_id_change
  BEFORE UPDATE OF company_id ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_company_id_change();
