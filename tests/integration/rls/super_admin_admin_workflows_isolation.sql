-- Integration test: tenant isolation invariants for super_admin-run
-- admin workflows.
--
-- Super admins hold cross-tenant SELECT via the `super_admin` ALL policies,
-- but the *admin workflows* they invoke (SECURITY DEFINER RPCs used from
-- the Admin Hub) MUST still bind their writes to the caller's own tenant
-- via `public.current_company_id()`. This regression suite asserts that
-- invariant so a future change cannot silently let an admin RPC spill
-- writes into a foreign tenant when a super_admin runs it.
--
-- Scenarios (all inside a transaction that ALWAYS ROLLBACKs):
--
--   1. current_company_id()      — returns the super_admin's OWN company,
--                                   never any other tenant, even though
--                                   super_admins can SELECT other tenants.
--   2. has_role(super, 'admin')  — company-scoped: true only when the
--                                   super_admin also holds `admin` in their
--                                   current company. In either case the
--                                   check is bound to `current_company_id()`,
--                                   so it cannot authorize action in a
--                                   foreign tenant.
--   3. mark_onboarding_complete()— touches ONLY the caller's own company row
--                                   and leaves the foreign company's
--                                   `onboarding_completed_at` untouched.
--   4. admin_create_invitation() — issues an invitation whose `company_id`
--                                   equals the super_admin's home company,
--                                   never the foreign company.
--   5. admin_deactivate_company()— cannot be pointed at a foreign tenant
--                                   (function takes no company_id and
--                                   reads current_company_id()); running
--                                   it leaves foreign `is_active` unchanged.
--
-- Required psql variables (set by tests/integration/rls/run.sh):
--   :super_admin_id     — a user_roles.user_id with role = 'super_admin'
--   :foreign_company_id — any public.companies.id that is NOT the super
--                          admin's own company_id
--
-- The super_admin's home_company_id is looked up live from profiles so the
-- test stays valid as fixtures change.

\set ON_ERROR_STOP on

BEGIN;

SELECT set_config('test.super_admin_id',     :'super_admin_id',     true);
SELECT set_config('test.foreign_company_id', :'foreign_company_id', true);

-- Resolve the super_admin's home company from live data and stash it.
DO $resolve$
DECLARE
  v_home uuid;
BEGIN
  SELECT company_id INTO v_home
    FROM public.profiles
   WHERE id = current_setting('test.super_admin_id', true)::uuid;
  IF v_home IS NULL THEN
    RAISE EXCEPTION 'fixture super_admin % has no profiles.company_id',
      current_setting('test.super_admin_id', true);
  END IF;
  IF v_home = current_setting('test.foreign_company_id', true)::uuid THEN
    RAISE EXCEPTION
      'fixture selection error: super_admin home_company_id (%) equals foreign_company_id',
      v_home;
  END IF;
  PERFORM set_config('test.home_company_id', v_home::text, true);
END
$resolve$;

SET LOCAL role = 'authenticated';
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', :'super_admin_id', 'role', 'authenticated')::text,
  true
);

-- Guard: the fixture user IS a super_admin (otherwise we're not exercising
-- the intended surface). is_super_admin() is SECURITY DEFINER, safe to call.
DO $guard$
BEGIN
  IF NOT public.is_super_admin(current_setting('test.super_admin_id', true)::uuid) THEN
    RAISE EXCEPTION
      'fixture user % is not a super_admin; pick a super_admin profile',
      current_setting('test.super_admin_id', true);
  END IF;
END
$guard$;

-- --------------------------------------------------------------------
-- 1. current_company_id() returns the caller's own tenant only.
-- --------------------------------------------------------------------
DO $current_company$
DECLARE
  v_home uuid := current_setting('test.home_company_id',    true)::uuid;
  v_forg uuid := current_setting('test.foreign_company_id', true)::uuid;
  v_seen uuid;
BEGIN
  SELECT public.current_company_id() INTO v_seen;
  IF v_seen IS DISTINCT FROM v_home THEN
    RAISE EXCEPTION
      'FAIL: current_company_id() returned % for super_admin (expected home %)',
      v_seen, v_home;
  END IF;
  IF v_seen = v_forg THEN
    RAISE EXCEPTION 'FAIL: current_company_id() equals foreign_company_id';
  END IF;
  RAISE NOTICE 'PASS: current_company_id() bound to super_admin home tenant';
END
$current_company$;

-- --------------------------------------------------------------------
-- 2. has_role() is company-scoped even for a super_admin.
--    A role held only in a different tenant must NOT authorize actions
--    in the current tenant.
-- --------------------------------------------------------------------
DO $has_role_scope$
DECLARE
  v_super uuid := current_setting('test.super_admin_id',    true)::uuid;
  v_home  uuid := current_setting('test.home_company_id',   true)::uuid;
  v_has_admin_in_home boolean;
  v_admin_rows_in_home int;
BEGIN
  SELECT count(*) INTO v_admin_rows_in_home
    FROM public.user_roles
   WHERE user_id = v_super
     AND role = 'admin'
     AND company_id = v_home;

  SELECT public.has_role(v_super, 'admin'::public.app_role) INTO v_has_admin_in_home;

  IF v_has_admin_in_home <> (v_admin_rows_in_home > 0) THEN
    RAISE EXCEPTION
      'FAIL: has_role(admin) reported % but user_roles rows in home tenant = %',
      v_has_admin_in_home, v_admin_rows_in_home;
  END IF;
  RAISE NOTICE
    'PASS: has_role(admin) is company-scoped to current_company_id() (result=%)',
    v_has_admin_in_home;
END
$has_role_scope$;

-- --------------------------------------------------------------------
-- 3. mark_onboarding_complete() only touches the caller's own company.
--    Requires admin in the home tenant; if the fixture super_admin does
--    not hold admin at home, we skip the write assertion but still verify
--    the foreign row is untouched by the call attempt.
-- --------------------------------------------------------------------
DO $mark_onboarding$
DECLARE
  v_home uuid := current_setting('test.home_company_id',    true)::uuid;
  v_forg uuid := current_setting('test.foreign_company_id', true)::uuid;
  v_home_before  timestamptz;
  v_home_after   timestamptz;
  v_forg_before  timestamptz;
  v_forg_after   timestamptz;
  v_has_admin    boolean;
BEGIN
  SELECT onboarding_completed_at INTO v_home_before FROM public.companies WHERE id = v_home;
  SELECT onboarding_completed_at INTO v_forg_before FROM public.companies WHERE id = v_forg;

  SELECT public.has_role(
    current_setting('test.super_admin_id', true)::uuid,
    'admin'::public.app_role
  ) INTO v_has_admin;

  IF v_has_admin THEN
    PERFORM public.mark_onboarding_complete();
  ELSE
    BEGIN
      PERFORM public.mark_onboarding_complete();
    EXCEPTION WHEN insufficient_privilege THEN
      NULL; -- expected: no admin role in home tenant
    END;
  END IF;

  SELECT onboarding_completed_at INTO v_home_after FROM public.companies WHERE id = v_home;
  SELECT onboarding_completed_at INTO v_forg_after FROM public.companies WHERE id = v_forg;

  -- Home row: either untouched (already onboarded) or set to a non-null value.
  IF v_has_admin AND v_home_after IS NULL THEN
    RAISE EXCEPTION
      'FAIL: mark_onboarding_complete did not populate onboarding_completed_at for home tenant';
  END IF;

  -- Foreign row must be byte-for-byte identical after the call.
  IF v_forg_before IS DISTINCT FROM v_forg_after THEN
    RAISE EXCEPTION
      'FAIL: mark_onboarding_complete leaked to foreign tenant (before=%, after=%)',
      v_forg_before, v_forg_after;
  END IF;

  RAISE NOTICE
    'PASS: mark_onboarding_complete() bound to home tenant (foreign untouched)';
END
$mark_onboarding$;

-- --------------------------------------------------------------------
-- 4. admin_create_invitation() writes the caller's own company_id.
--    Run only when the super_admin also holds admin or owner in their
--    current tenant (the function requires it).
-- --------------------------------------------------------------------
DO $invitation_scope$
DECLARE
  v_super uuid := current_setting('test.super_admin_id',    true)::uuid;
  v_home  uuid := current_setting('test.home_company_id',   true)::uuid;
  v_forg  uuid := current_setting('test.foreign_company_id',true)::uuid;
  v_can_invite boolean;
  v_token uuid;
  v_expires timestamptz;
  v_inv_company uuid;
  v_email text := 'rls-super-admin-isolation-' || substr(md5(random()::text),1,10) || '@example.test';
BEGIN
  v_can_invite :=
       public.has_role(v_super, 'admin'::public.app_role)
    OR public.has_role(v_super, 'owner'::public.app_role);

  IF NOT v_can_invite THEN
    RAISE NOTICE
      'SKIP: super_admin does not hold admin/owner in home tenant; invitation path not exercised';
    RETURN;
  END IF;

  SELECT token, expires_at
    INTO v_token, v_expires
    FROM public.admin_create_invitation(v_email, 'viewer'::public.app_role);

  SELECT company_id INTO v_inv_company
    FROM public.company_invitations
   WHERE token = v_token;

  IF v_inv_company IS DISTINCT FROM v_home THEN
    RAISE EXCEPTION
      'FAIL: admin_create_invitation wrote company_id=% (expected home %)',
      v_inv_company, v_home;
  END IF;
  IF v_inv_company = v_forg THEN
    RAISE EXCEPTION 'FAIL: invitation targeted foreign tenant';
  END IF;

  RAISE NOTICE 'PASS: admin_create_invitation bound to home tenant';
END
$invitation_scope$;

-- --------------------------------------------------------------------
-- 5. admin_deactivate_company() cannot deactivate a foreign tenant.
--    The function reads current_company_id() and requires the 'owner'
--    role. If the super_admin is not an owner in their home tenant, the
--    call is rejected — and either way the foreign company's is_active
--    must be unchanged.
-- --------------------------------------------------------------------
DO $deactivate_scope$
DECLARE
  v_super uuid := current_setting('test.super_admin_id',    true)::uuid;
  v_forg  uuid := current_setting('test.foreign_company_id',true)::uuid;
  v_forg_before boolean;
  v_forg_after  boolean;
BEGIN
  SELECT is_active INTO v_forg_before FROM public.companies WHERE id = v_forg;

  BEGIN
    PERFORM public.admin_deactivate_company('rls regression — must never persist');
  EXCEPTION
    WHEN insufficient_privilege THEN NULL; -- expected when not owner
    WHEN OTHERS THEN
      -- Any other error (e.g. explicit RAISE) is fine — we only care that
      -- the foreign row wasn't touched.
      NULL;
  END;

  SELECT is_active INTO v_forg_after FROM public.companies WHERE id = v_forg;

  IF v_forg_before IS DISTINCT FROM v_forg_after THEN
    RAISE EXCEPTION
      'FAIL: admin_deactivate_company changed foreign is_active (before=%, after=%)',
      v_forg_before, v_forg_after;
  END IF;

  RAISE NOTICE 'PASS: admin_deactivate_company cannot reach foreign tenant';
END
$deactivate_scope$;

ROLLBACK;
