-- Integration test: `public.rpc_authorization_denied_log` RLS visibility.
--
-- Confirms:
--   1. INSERT — an authenticated caller can log their own denial row
--               (WITH CHECK user_id = auth.uid()).
--   2. INSERT — an authenticated caller CANNOT log a denial as another user
--               (user_id spoofing rejected).
--   3. SELECT — a non-super-admin authenticated caller sees ZERO rows,
--               even ones they themselves inserted (the only SELECT policy
--               is `is_super_admin(auth.uid())`).
--   4. SELECT — a super_admin caller can see rows logged by other users.
--   5. INDEX  — the page_path and rpc_name indexes exist for admin filtering.
--
-- Runs entirely inside a transaction that ALWAYS ROLLBACKs.
--
-- Required psql variables:
--   :test_user_id       — a non-super-admin auth.uid()
--   :super_admin_id     — an auth.uid() with role 'super_admin'
--   :home_company_id, :foreign_company_id — unused here (shared with runner).

\set ON_ERROR_STOP on

BEGIN;

SELECT set_config('test.user_id',        :'test_user_id',    true);
SELECT set_config('test.super_admin_id', :'super_admin_id',  true);

-- Guard: fixtures must have the expected role shape or we'd be asserting
-- the wrong thing.
DO $guard$
BEGIN
  IF public.is_super_admin(current_setting('test.user_id', true)::uuid) THEN
    RAISE EXCEPTION 'fixture test_user_id is a super_admin — cannot assert non-super-admin blindness';
  END IF;
  IF NOT public.is_super_admin(current_setting('test.super_admin_id', true)::uuid) THEN
    RAISE EXCEPTION 'fixture super_admin_id is not actually a super_admin';
  END IF;
END
$guard$;

------------------------------------------------------------------
-- Act as the non-super-admin user.
------------------------------------------------------------------
SET LOCAL role = 'authenticated';
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub',  current_setting('test.user_id', true),
    'role', 'authenticated'
  )::text,
  true
);

-- 1. Self-insert is allowed.
INSERT INTO public.rpc_authorization_denied_log (user_id, rpc_name, error_code, page_path)
VALUES (
  current_setting('test.user_id', true)::uuid,
  'test_rpc_self',
  'RPC_NOT_ALLOWLISTED',
  '/admin/self'
);

-- 2. Spoofed insert is rejected.
DO $spoof$
DECLARE
  spoofed boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.rpc_authorization_denied_log (user_id, rpc_name)
    VALUES (current_setting('test.super_admin_id', true)::uuid, 'test_rpc_spoof');
    spoofed := true;
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN
    NULL; -- expected: WITH CHECK (user_id = auth.uid())
  END;
  IF spoofed THEN
    RAISE EXCEPTION 'RLS regression: non-super-admin inserted a row with a foreign user_id';
  END IF;
END
$spoof$;

-- 3. Non-super-admin cannot SEE any rows, including the one they just wrote.
DO $blind$
DECLARE
  visible integer;
BEGIN
  SELECT count(*) INTO visible FROM public.rpc_authorization_denied_log;
  IF visible <> 0 THEN
    RAISE EXCEPTION 'RLS regression: non-super-admin sees % denial rows (expected 0)', visible;
  END IF;
END
$blind$;

------------------------------------------------------------------
-- Switch to a super_admin and confirm they can read the row.
------------------------------------------------------------------
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub',  current_setting('test.super_admin_id', true),
    'role', 'authenticated'
  )::text,
  true
);

DO $sa$
DECLARE
  self_row_visible integer;
BEGIN
  SELECT count(*) INTO self_row_visible
    FROM public.rpc_authorization_denied_log
   WHERE rpc_name = 'test_rpc_self'
     AND user_id  = current_setting('test.user_id', true)::uuid;
  IF self_row_visible < 1 THEN
    RAISE EXCEPTION 'RLS regression: super_admin cannot see the denial row logged by another user (got %)', self_row_visible;
  END IF;
END
$sa$;

------------------------------------------------------------------
-- Confirm the expected indexes are present.
------------------------------------------------------------------
DO $idx$
DECLARE
  needed text[] := ARRAY[
    'idx_rpc_auth_denied_page_path',
    'idx_rpc_auth_denied_rpc_name',
    'idx_rpc_auth_denied_rpc'
  ];
  missing text;
BEGIN
  FOREACH missing IN ARRAY needed LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
       WHERE schemaname = 'public'
         AND tablename  = 'rpc_authorization_denied_log'
         AND indexname  = missing
    ) THEN
      RAISE EXCEPTION 'missing expected index on rpc_authorization_denied_log: %', missing;
    END IF;
  END LOOP;
END
$idx$;

ROLLBACK;
