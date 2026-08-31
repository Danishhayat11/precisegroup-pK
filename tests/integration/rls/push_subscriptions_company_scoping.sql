-- Integration test: push_subscriptions RLS enforces company_id scoping.
--
-- Verifies the hardening from the "push_subscriptions_missing_company_scoping"
-- security finding — INSERT and UPDATE policies must both check
-- `company_id = public.current_company_id()` in WITH CHECK, so an
-- authenticated user cannot write a row bound to another tenant.
--
-- The test reuses REAL rows (a profile and two companies) rather than
-- inserting into auth.users so it works under the managed exec role,
-- which does not have `permission for schema auth`. Everything runs in
-- a transaction that ALWAYS ROLLBACKs — no persisted data changes.
--
-- Required psql variables:
--   :test_user_id       — an auth.uid() with a profiles row
--   :home_company_id    — that user's profiles.company_id
--   :foreign_company_id — any other public.companies.id
--
-- Runner script: tests/integration/rls/run.sh — picks fixtures live.

\set ON_ERROR_STOP on

BEGIN;

-- Stash the fixture ids in custom GUCs so DO blocks can read them via
-- current_setting(). Custom GUCs are settable by any role.
SELECT set_config('test.user_id',            :'test_user_id',       true);
SELECT set_config('test.home_company_id',    :'home_company_id',    true);
SELECT set_config('test.foreign_company_id', :'foreign_company_id', true);

-- Simulate a signed-in user: switch to the `authenticated` role and set
-- the JWT claims PostgREST would normally attach. RLS is enforced from
-- here on (authenticated is not BYPASSRLS).
SET LOCAL role = 'authenticated';
SELECT set_config(
  'request.jwt.claims',
  json_build_object('sub', :'test_user_id', 'role', 'authenticated')::text,
  true
);

-- Sanity: current_company_id() must resolve to the home tenant.
DO $sanity$
DECLARE
  v_home uuid := current_setting('test.home_company_id', true)::uuid;
BEGIN
  IF public.current_company_id() <> v_home THEN
    RAISE EXCEPTION
      'sanity: current_company_id()=% expected home=%',
      public.current_company_id(), v_home;
  END IF;
END
$sanity$;

-- --------------------------------------------------------------------
-- 1. INSERT with a foreign company_id must be DENIED.
-- --------------------------------------------------------------------
DO $insert_wrong$
DECLARE
  v_denied boolean := false;
  v_user   uuid := current_setting('test.user_id', true)::uuid;
  v_foreign uuid := current_setting('test.foreign_company_id', true)::uuid;
BEGIN
  BEGIN
    INSERT INTO public.push_subscriptions
      (user_id, company_id, endpoint, p256dh, auth)
    VALUES
      (v_user, v_foreign, 'https://push.example.com/rls-wrong',
       'p256dh-key', 'auth-key');
  EXCEPTION
    WHEN insufficient_privilege OR check_violation THEN
      v_denied := true;
  END;

  IF NOT v_denied THEN
    RAISE EXCEPTION
      'FAIL: INSERT into push_subscriptions with foreign company_id was allowed — policy regressed';
  END IF;
  RAISE NOTICE 'PASS: INSERT with foreign company_id denied';
END
$insert_wrong$;

-- --------------------------------------------------------------------
-- 2. INSERT with the user's own company_id must SUCCEED (baseline).
-- --------------------------------------------------------------------
DO $insert_own$
DECLARE
  v_id     uuid;
  v_user   uuid := current_setting('test.user_id', true)::uuid;
  v_home   uuid := current_setting('test.home_company_id', true)::uuid;
BEGIN
  INSERT INTO public.push_subscriptions
    (user_id, company_id, endpoint, p256dh, auth)
  VALUES
    (v_user, v_home, 'https://push.example.com/rls-right',
     'p256dh-key', 'auth-key')
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'FAIL: INSERT with own company_id did not return a row';
  END IF;
  RAISE NOTICE 'PASS: INSERT with own company_id allowed';
END
$insert_own$;

-- --------------------------------------------------------------------
-- 3. UPDATE rewriting company_id to a foreign tenant must be DENIED.
-- --------------------------------------------------------------------
DO $update_wrong$
DECLARE
  v_denied boolean := false;
  v_target uuid;
  v_foreign uuid := current_setting('test.foreign_company_id', true)::uuid;
BEGIN
  SELECT id INTO v_target
    FROM public.push_subscriptions
   WHERE endpoint = 'https://push.example.com/rls-right';

  BEGIN
    UPDATE public.push_subscriptions
       SET company_id = v_foreign
     WHERE id = v_target;
  EXCEPTION
    WHEN insufficient_privilege OR check_violation THEN
      v_denied := true;
  END;

  IF NOT v_denied THEN
    -- Some setups swallow WITH CHECK failures as a 0-row update instead
    -- of raising. Confirm the row was NOT mutated either way.
    PERFORM 1
      FROM public.push_subscriptions
     WHERE id = v_target
       AND company_id = v_foreign;
    IF FOUND THEN
      RAISE EXCEPTION
        'FAIL: UPDATE rewrote push_subscriptions.company_id to a foreign tenant — policy regressed';
    END IF;
  END IF;
  RAISE NOTICE 'PASS: UPDATE rewriting company_id to a foreign tenant denied';
END
$update_wrong$;

-- --------------------------------------------------------------------
-- 4. UPDATE within own company_id must SUCCEED (baseline).
-- --------------------------------------------------------------------
DO $update_ok$
DECLARE
  v_target uuid;
  v_after  timestamptz;
BEGIN
  SELECT id INTO v_target
    FROM public.push_subscriptions
   WHERE endpoint = 'https://push.example.com/rls-right';

  UPDATE public.push_subscriptions
     SET last_used_at = now()
   WHERE id = v_target
  RETURNING last_used_at INTO v_after;

  IF v_after IS NULL THEN
    RAISE EXCEPTION 'FAIL: UPDATE within own company_id was rejected';
  END IF;
  RAISE NOTICE 'PASS: UPDATE within own company_id allowed';
END
$update_ok$;

ROLLBACK;
