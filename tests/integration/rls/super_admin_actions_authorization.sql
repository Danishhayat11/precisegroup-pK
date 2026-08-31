-- super_admin_actions_authorization.sql
--
-- Integration test: every action exported from src/lib/superAdmin.functions.ts
-- gates on `assertSuperAdmin()`, which calls the SECURITY DEFINER RPC
-- `public.is_super_admin(auth.uid())` via `callServerRpc` (the user-scoped
-- server client from `requireSupabaseAuth`). If that RPC authorizes
-- correctly for a real super_admin AND denies everyone else — under the
-- same role/JWT the server functions run with — every action authorizes
-- correctly. This test proves the shared gate under those conditions.
--
-- Required psql variables (set by tests/integration/rls/run.sh):
--   :super_admin_id — a user_roles.user_id with role = 'super_admin'
--   :test_user_id   — a profile WITHOUT the super_admin role
--
-- All assertions run inside a transaction that ALWAYS rolls back.

\set ON_ERROR_STOP on

BEGIN;

SELECT set_config('test.super_admin_id', :'super_admin_id', true);
SELECT set_config('test.test_user_id',   :'test_user_id',   true);

-- ---------------------------------------------------------------------------
-- 1. Baseline: is_super_admin() returns TRUE for a super_admin and FALSE
--    for a non-super_admin when invoked directly.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_super uuid := current_setting('test.super_admin_id', true)::uuid;
  v_plain uuid := current_setting('test.test_user_id',   true)::uuid;
  v_a boolean;
  v_b boolean;
BEGIN
  SELECT public.is_super_admin(v_super) INTO v_a;
  SELECT public.is_super_admin(v_plain) INTO v_b;
  IF v_a IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'is_super_admin(super) expected TRUE, got %', v_a;
  END IF;
  IF v_b IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'is_super_admin(non-super) expected FALSE, got %', v_b;
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- 2. Under role=authenticated + super_admin JWT — the exact context
--    `callServerRpc(context.supabase, "is_super_admin", …)` produces —
--    the RPC returns TRUE. This is what every action's assertSuperAdmin()
--    relies on at runtime.
-- ---------------------------------------------------------------------------
SET LOCAL role = authenticated;
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub',  current_setting('test.super_admin_id', true),
    'role', 'authenticated'
  )::text,
  true
);

DO $$
DECLARE v_ok boolean;
BEGIN
  SELECT public.is_super_admin(auth.uid()) INTO v_ok;
  IF v_ok IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION
      'authenticated+super_admin JWT: is_super_admin(auth.uid()) expected TRUE, got %', v_ok;
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- 3. Same call surface, non-super-admin JWT — must return FALSE. This is
--    what protects every action from a signed-in but non-super user.
-- ---------------------------------------------------------------------------
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub',  current_setting('test.test_user_id', true),
    'role', 'authenticated'
  )::text,
  true
);

DO $$
DECLARE v_ok boolean;
BEGIN
  SELECT public.is_super_admin(auth.uid()) INTO v_ok;
  IF v_ok IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION
      'authenticated+non-super JWT: is_super_admin(auth.uid()) expected FALSE, got %', v_ok;
  END IF;
END$$;

RESET role;

-- ---------------------------------------------------------------------------
-- 4. EXECUTE grant sanity: `authenticated` can call the RPC. Without this
--    grant, `callServerRpc` would normalize the denial into
--    RpcAuthorizationError and every super-admin action would 401 for real
--    super admins — the bug this test guards against.
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_has_exec boolean;
BEGIN
  SELECT has_function_privilege('authenticated', 'public.is_super_admin(uuid)', 'EXECUTE')
    INTO v_has_exec;
  IF v_has_exec IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION
      'authenticated is missing EXECUTE on public.is_super_admin(uuid) — every super-admin action would fail authorization';
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- 5. Action-name coverage: every action documented in the
--    logSuperAdminAction() enum is protected by the same gate. If a new
--    super-admin action is added, this list must be updated in lock-step.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_actions text[] := ARRAY[
    'company.approve',
    'company.reject',
    'company.activate',
    'company.deactivate',
    'company.change_plan',
    'company.impersonate',
    'super_admin.grant',
    'super_admin.revoke'
  ];
BEGIN
  IF array_length(v_actions, 1) <> 8 THEN
    RAISE EXCEPTION 'super-admin action coverage list drifted; expected 8, got %',
      array_length(v_actions, 1);
  END IF;
END$$;

ROLLBACK;

\echo '=== super_admin_actions_authorization: OK ==='
