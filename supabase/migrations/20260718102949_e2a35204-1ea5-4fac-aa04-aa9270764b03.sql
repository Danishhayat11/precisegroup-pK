-- Strict INSERT/DELETE policies for public.companies.
--
-- Baseline today:
--   * companies_super_admin_all (PERMISSIVE, ALL) — allows super admins full access.
--   * companies_select_own / companies_update_admin — tenant scoped reads + admin updates.
--   * No INSERT or DELETE policy for regular authenticated users, so those
--     actions are already denied for anyone who isn't a super admin.
--   * `public.bootstrap_company` is SECURITY DEFINER and bypasses RLS, so
--     self-serve signup still works.
--
-- To harden against future permissive policies accidentally opening INSERT
-- or DELETE to non-super-admins, add explicit *RESTRICTIVE* policies that
-- AND with every other policy: a row can only be inserted or deleted when
-- the caller is a super admin. This makes the intent explicit and defends
-- in depth without breaking the signup flow (SECURITY DEFINER still bypasses).

DROP POLICY IF EXISTS companies_insert_super_admin_only ON public.companies;
DROP POLICY IF EXISTS companies_delete_super_admin_only ON public.companies;

CREATE POLICY companies_insert_super_admin_only
  ON public.companies
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY companies_delete_super_admin_only
  ON public.companies
  AS RESTRICTIVE
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin(auth.uid()));