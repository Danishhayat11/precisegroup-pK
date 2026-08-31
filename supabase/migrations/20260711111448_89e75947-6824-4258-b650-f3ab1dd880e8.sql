-- 1. Approval columns on companies
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'approved'
    CHECK (approval_status IN ('pending','approved','rejected')),
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejection_reason text;

-- Backfill: all existing rows are approved (they were live before this feature).
UPDATE public.companies SET approval_status = 'approved' WHERE approval_status IS NULL;

-- 2. is_super_admin() helper (SECURITY DEFINER so it bypasses user_roles RLS)
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'super_admin'::public.app_role
  )
$$;

REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated, service_role;

-- 3. Super-admin cross-tenant policies on companies
DROP POLICY IF EXISTS companies_super_admin_all ON public.companies;
CREATE POLICY companies_super_admin_all ON public.companies
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- 4. Super-admin cross-tenant policies on user_roles
DROP POLICY IF EXISTS user_roles_super_admin_all ON public.user_roles;
CREATE POLICY user_roles_super_admin_all ON public.user_roles
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- 5. Super-admin cross-tenant read/update on profiles
DROP POLICY IF EXISTS profiles_super_admin_all ON public.profiles;
CREATE POLICY profiles_super_admin_all ON public.profiles
  FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- 6. Seed super_admin role for existing seed-company admins (danish + mushtaq + others).
--    UNIQUE(user_id, role) makes this idempotent.
INSERT INTO public.user_roles (user_id, role, company_id)
SELECT DISTINCT ur.user_id, 'super_admin'::public.app_role, ur.company_id
FROM public.user_roles ur
WHERE ur.company_id = '00000000-0000-0000-0000-000000000001'::uuid
  AND ur.role IN ('owner'::public.app_role, 'admin'::public.app_role)
ON CONFLICT (user_id, role) DO NOTHING;