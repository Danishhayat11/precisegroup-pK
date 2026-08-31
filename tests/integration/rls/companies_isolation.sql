-- Integration test: `public.companies` RLS regression suite.
--
-- Verifies the guarantees that keep each tenant's company row invisible to
-- everyone else, and that non-super-admin callers cannot INSERT into or
-- DELETE from `public.companies` directly:
--
--   1. SELECT   — authenticated caller sees ONLY their own company row.
--   2. SELECT   — a foreign company row is not visible.
--   3. INSERT   — an authenticated non-super-admin cannot create a row
--                 (blocked by the RESTRICTIVE companies_insert_super_admin_only
--                  policy, no matter the target company_id).
--   4. DELETE   — an authenticated non-super-admin cannot delete their own
--                 (or any) company row (RESTRICTIVE companies_delete_super_admin_only).
--   5. UPDATE   — an authenticated caller cannot update a foreign company row
--                 (companies_update_admin scopes to id = current_company_id()).
--
-- Runs entirely inside a transaction that ALWAYS ROLLBACKs.
--
-- Required psql variables (same as push_subscriptions test):
--   :test_user_id       — an auth.uid() with a profiles row + admin role
--                          on their own company (best-effort; the caller
--                          may be any non-super-admin — the test's assertions
--                          only require non-super-admin, INSERT/DELETE are
--                          rejected for every non-super-admin role).
--   :home_company_id    — that user's profiles.company_id
--   :foreign_company_id — any other public.companies.id
--
-- Runner script: tests/integration/rls/run.sh

\set ON_ERROR_STOP on

BEGIN;

SELECT set_config('test.user_id',            :'test_user_id',       true);
SELECT set_config('test.home_company_id',    :'home_company_id',    true);
SELECT set_config('test.foreign_company_id', :'foreign_company_id', true);

SET LOCAL role = 'authenticated';
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', :'test_user_id', 'role', 'authenticated')::text,
  true
);

-- Guard: the fixture user must NOT be a super_admin — otherwise the
-- super-admin ALL policy would legitimately allow INSERT/DELETE and we'd
-- be asserting the wrong thing.
DO $guard$
BEGIN
  IF public.is_super_admin(current_setting('test.user_id', true)::uuid) THEN
    RAISE EXCEPTION
      'test fixture user % is a super_admin; pick a non-super-admin profile',
      current_setting('test.user_id', true);
  END IF;
END
$guard$;

-- --------------------------------------------------------------------
-- 1. SELECT — only the caller's own company row is visible.
-- --------------------------------------------------------------------
DO $select_own$
DECLARE
  v_home uuid := current_setting('test.home_company_id', true)::uuid;
  v_seen int;
BEGIN
  SELECT count(*) INTO v_seen FROM public.companies WHERE id = v_home;
  IF v_seen <> 1 THEN
    RAISE EXCEPTION 'FAIL: caller could not SELECT own company row (seen=%)', v_seen;
  END IF;
  RAISE NOTICE 'PASS: SELECT own company row visible';
END
$select_own$;

-- --------------------------------------------------------------------
-- 2. SELECT — foreign company row is filtered out.
-- --------------------------------------------------------------------
DO $select_foreign$
DECLARE
  v_foreign uuid := current_setting('test.foreign_company_id', true)::uuid;
  v_seen int;
BEGIN
  SELECT count(*) INTO v_seen FROM public.companies WHERE id = v_foreign;
  IF v_seen <> 0 THEN
    RAISE EXCEPTION 'FAIL: foreign company row leaked to caller (seen=%)', v_seen;
  END IF;
  RAISE NOTICE 'PASS: foreign company row hidden';
END
$select_foreign$;

-- --------------------------------------------------------------------
-- 3. INSERT — denied for non-super-admin, regardless of company_id.
-- --------------------------------------------------------------------
DO $insert_denied$
DECLARE
  v_denied boolean := false;
  v_row_id uuid;
BEGIN
  BEGIN
    INSERT INTO public.companies (name, plan, is_active, approval_status)
    VALUES ('rls-regression-should-fail', 'starter', false, 'pending')
    RETURNING id INTO v_row_id;
  EXCEPTION
    WHEN insufficient_privilege OR check_violation THEN
      v_denied := true;
  END;

  -- Some RLS setups silently reject (RETURNING is NULL) instead of raising.
  IF NOT v_denied AND v_row_id IS NULL THEN
    v_denied := true;
  END IF;

  IF NOT v_denied THEN
    RAISE EXCEPTION
      'FAIL: non-super-admin INSERT into public.companies succeeded (id=%)',
      v_row_id;
  END IF;
  RAISE NOTICE 'PASS: INSERT into public.companies denied for non-super-admin';
END
$insert_denied$;

-- --------------------------------------------------------------------
-- 4. DELETE — denied for non-super-admin (own or foreign row).
-- --------------------------------------------------------------------
DO $delete_denied$
DECLARE
  v_home uuid := current_setting('test.home_company_id', true)::uuid;
  v_before int;
  v_after int;
  v_denied boolean := false;
BEGIN
  SELECT count(*) INTO v_before FROM public.companies WHERE id = v_home;

  BEGIN
    DELETE FROM public.companies WHERE id = v_home;
  EXCEPTION
    WHEN insufficient_privilege THEN
      v_denied := true;
  END;

  SELECT count(*) INTO v_after FROM public.companies WHERE id = v_home;

  -- Either the DELETE raised, or the row is still visible (silent no-op).
  IF NOT v_denied AND v_after < v_before THEN
    RAISE EXCEPTION
      'FAIL: non-super-admin DELETE removed own company row (before=%, after=%)',
      v_before, v_after;
  END IF;
  RAISE NOTICE 'PASS: DELETE from public.companies denied for non-super-admin';
END
$delete_denied$;

-- --------------------------------------------------------------------
-- 5. UPDATE — foreign company row is not writable.
-- --------------------------------------------------------------------
DO $update_foreign_denied$
DECLARE
  v_foreign uuid := current_setting('test.foreign_company_id', true)::uuid;
  v_updated int;
BEGIN
  WITH u AS (
    UPDATE public.companies
       SET updated_at = now()
     WHERE id = v_foreign
    RETURNING 1
  )
  SELECT count(*) INTO v_updated FROM u;

  IF v_updated <> 0 THEN
    RAISE EXCEPTION
      'FAIL: non-super-admin UPDATE on foreign company row affected % rows',
      v_updated;
  END IF;
  RAISE NOTICE 'PASS: UPDATE on foreign company row rejected';
END
$update_foreign_denied$;

ROLLBACK;
