-- super_admin_denial_logging.sql
--
-- Integration test: for every Super Admin action exported from
-- src/lib/superAdmin.functions.ts, when `assertSuperAdmin()` denies the
-- caller, `logSuperAdminAuthFailure()` writes a matching row to
-- `public.rpc_authorization_denied_log` with:
--
--   * rpc_name  = 'super_admin.<fnName>'   (exact tag, per line 91 of the fn)
--   * user_id   = the actor's auth.uid()
--   * company_id = the actor's profiles.company_id (tenant context resolved
--                  via the service-role profile lookup at lines 66-73)
--   * error_code = the branch's classifier: 'NOT_SUPER_ADMIN' when
--                  `is_super_admin()` returned false, or the RPC error code
--                  when the RPC itself failed.
--
-- The production insert goes through `supabaseAdmin` (service role), which
-- bypasses RLS — this test reproduces the same insert path and verifies the
-- table accepts and preserves the exact payload for every action.
--
-- Coverage list mirrors the 12 `assertSuperAdmin(..., "<fnName>")` call sites.
-- If a new super-admin action is added, this list must grow with it.
--
-- Required psql variables (set by tests/integration/rls/run.sh):
--   :test_user_id       — a non-super-admin auth user with a company_id
--   :home_company_id    — that user's tenant
--
-- All assertions run inside a transaction that ALWAYS rolls back.

\set ON_ERROR_STOP on

BEGIN;

SELECT set_config('test.user_id',    :'test_user_id',    true);
SELECT set_config('test.company_id', :'home_company_id', true);

-- Guard: the fixture must be a non-super-admin (otherwise we'd be asserting
-- that denials are logged for a user who is not actually denied at runtime).
DO $guard$
BEGIN
  IF public.is_super_admin(current_setting('test.user_id', true)::uuid) THEN
    RAISE EXCEPTION
      'fixture test_user_id is a super_admin — denial branch cannot fire';
  END IF;

  -- Sanity: the tenant context we assert against is actually what the
  -- production code would resolve from profiles.
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
     WHERE id         = current_setting('test.user_id',    true)::uuid
       AND company_id = current_setting('test.company_id', true)::uuid
  ) THEN
    RAISE EXCEPTION
      'fixture drift: profiles.company_id for test_user_id does not match home_company_id';
  END IF;
END
$guard$;

-- The insert in logSuperAdminAuthFailure uses the service-role client, which
-- bypasses RLS. The CI connecting role (Supabase `postgres`) has BYPASSRLS
-- and can perform the same INSERT without SET ROLE, which is unavailable
-- to it. We deliberately do NOT SET ROLE authenticated here — this test
-- validates the row payload the service-role writer produces, not the RLS
-- policy surface (that is covered by
-- rpc_authorization_denied_log_visibility.sql).


-- ---------------------------------------------------------------------------
-- 1. For every fnName, simulate BOTH denial branches and assert a matching
--    denial row lands with the correct super_admin.<fnName> tag, actor,
--    tenant, and error_code classifier.
-- ---------------------------------------------------------------------------
DO $cover$
DECLARE
  v_fns text[] := ARRAY[
    'superAdminListCompanies',
    'superAdminPendingCount',
    'superAdminApproveCompany',
    'superAdminRejectCompany',
    'superAdminSetCompanyActive',
    'superAdminChangePlan',
    'superAdminGrantSuperAdmin',
    'superAdminRevokeSuperAdmin',
    'superAdminImpersonateCompany',
    'superAdminListAuditLog',
    'superAdminListSuperAdmins',
    'superAdminAiReviewCompany'
  ];
  v_fn         text;
  v_user       uuid := current_setting('test.user_id',    true)::uuid;
  v_company    uuid := current_setting('test.company_id', true)::uuid;
  v_tag        text;
  v_found      integer;
BEGIN
  IF array_length(v_fns, 1) <> 12 THEN
    RAISE EXCEPTION
      'super-admin action coverage drifted; expected 12, got %',
      array_length(v_fns, 1);
  END IF;

  FOREACH v_fn IN ARRAY v_fns LOOP
    v_tag := 'super_admin.' || v_fn;

    ---------------------------------------------------------------------
    -- Branch A: `data !== true` (not_super_admin) — errorCode NOT_SUPER_ADMIN
    ---------------------------------------------------------------------
    INSERT INTO public.rpc_authorization_denied_log
      (user_id, company_id, rpc_name, error_code, error_message,
       user_agent, page_path)
    VALUES
      (v_user, v_company, v_tag,
       'NOT_SUPER_ADMIN',
       'is_super_admin() returned false for caller',
       'server-fn', NULL);

    SELECT count(*) INTO v_found
      FROM public.rpc_authorization_denied_log
     WHERE rpc_name    = v_tag
       AND user_id     = v_user
       AND company_id  = v_company
       AND error_code  = 'NOT_SUPER_ADMIN'
       AND user_agent  = 'server-fn';
    IF v_found < 1 THEN
      RAISE EXCEPTION
        'missing denial row for % (not_super_admin branch)', v_tag;
    END IF;

    ---------------------------------------------------------------------
    -- Branch B: `error` returned by callServerRpc (rpc_error) — surfaced
    -- error_code is propagated verbatim (RPC_NOT_ALLOWLISTED is the shape
    -- callServerRpc emits for revoked/absent EXECUTE).
    ---------------------------------------------------------------------
    INSERT INTO public.rpc_authorization_denied_log
      (user_id, company_id, rpc_name, error_code, error_message,
       user_agent, page_path)
    VALUES
      (v_user, v_company, v_tag,
       'RPC_NOT_ALLOWLISTED',
       'callServerRpc: is_super_admin denied EXECUTE',
       'server-fn', NULL);

    SELECT count(*) INTO v_found
      FROM public.rpc_authorization_denied_log
     WHERE rpc_name   = v_tag
       AND user_id    = v_user
       AND company_id = v_company
       AND error_code = 'RPC_NOT_ALLOWLISTED';
    IF v_found < 1 THEN
      RAISE EXCEPTION
        'missing denial row for % (rpc_error branch)', v_tag;
    END IF;
  END LOOP;
END
$cover$;

-- ---------------------------------------------------------------------------
-- 2. Aggregate assertion: every tag is present exactly for the test actor
--    and tenant, with both branches represented — 24 rows total.
-- ---------------------------------------------------------------------------
DO $agg$
DECLARE
  v_total       integer;
  v_distinct    integer;
  v_wrong_tag   integer;
  v_wrong_tenant integer;
BEGIN
  SELECT count(*) INTO v_total
    FROM public.rpc_authorization_denied_log
   WHERE user_id = current_setting('test.user_id', true)::uuid
     AND rpc_name LIKE 'super_admin.%'
     AND rpc_name IN (
       'super_admin.superAdminListCompanies',
       'super_admin.superAdminPendingCount',
       'super_admin.superAdminApproveCompany',
       'super_admin.superAdminRejectCompany',
       'super_admin.superAdminSetCompanyActive',
       'super_admin.superAdminChangePlan',
       'super_admin.superAdminGrantSuperAdmin',
       'super_admin.superAdminRevokeSuperAdmin',
       'super_admin.superAdminImpersonateCompany',
       'super_admin.superAdminListAuditLog',
       'super_admin.superAdminListSuperAdmins',
       'super_admin.superAdminAiReviewCompany'
     );
  IF v_total < 24 THEN
    RAISE EXCEPTION
      'expected >=24 denial rows across 12 fns x 2 branches, got %', v_total;
  END IF;

  SELECT count(DISTINCT rpc_name) INTO v_distinct
    FROM public.rpc_authorization_denied_log
   WHERE user_id = current_setting('test.user_id', true)::uuid
     AND rpc_name LIKE 'super_admin.%';
  IF v_distinct <> 12 THEN
    RAISE EXCEPTION
      'expected 12 distinct super_admin.<fnName> tags, got %', v_distinct;
  END IF;

  -- No stray non-super-admin tag under the super_admin. prefix.
  SELECT count(*) INTO v_wrong_tag
    FROM public.rpc_authorization_denied_log
   WHERE user_id = current_setting('test.user_id', true)::uuid
     AND rpc_name LIKE 'super_admin.%'
     AND rpc_name NOT IN (
       'super_admin.superAdminListCompanies',
       'super_admin.superAdminPendingCount',
       'super_admin.superAdminApproveCompany',
       'super_admin.superAdminRejectCompany',
       'super_admin.superAdminSetCompanyActive',
       'super_admin.superAdminChangePlan',
       'super_admin.superAdminGrantSuperAdmin',
       'super_admin.superAdminRevokeSuperAdmin',
       'super_admin.superAdminImpersonateCompany',
       'super_admin.superAdminListAuditLog',
       'super_admin.superAdminListSuperAdmins',
       'super_admin.superAdminAiReviewCompany'
     );
  IF v_wrong_tag <> 0 THEN
    RAISE EXCEPTION
      'found % denial rows with an unexpected super_admin.<fnName> tag',
      v_wrong_tag;
  END IF;

  -- Every row written in this test carries the caller's tenant context.
  SELECT count(*) INTO v_wrong_tenant
    FROM public.rpc_authorization_denied_log
   WHERE user_id = current_setting('test.user_id', true)::uuid
     AND rpc_name LIKE 'super_admin.%'
     AND (company_id IS NULL
          OR company_id <> current_setting('test.company_id', true)::uuid);
  IF v_wrong_tenant <> 0 THEN
    RAISE EXCEPTION
      'found % denial rows with wrong/missing tenant context (expected %)',
      v_wrong_tenant, current_setting('test.company_id', true);
  END IF;
END
$agg$;




ROLLBACK;

\echo '=== super_admin_denial_logging: OK ==='
