-- Integration test: tenant policy coverage.
--
-- Catalog-level regression that fails CI when a tenant-scoped table
-- loses RLS or its `company_id`-scoping policies. Runs from the
-- connecting role — no SET ROLE, no fixture data changes.
--
-- Guarantees for every table listed in `tenant_tables` below:
--   * `company_id` column exists.
--   * Row Level Security is ENABLED and FORCED-or-default (relrowsecurity=t).
--   * At least one policy exists whose USING or WITH CHECK expression
--     references `current_company_id()` (directly or via has_role() etc.
--     that themselves scope to the current tenant).
--
-- Update the `tenant_tables` array below whenever a new tenant-scoped
-- table is introduced. The list intentionally mirrors the set enumerated
-- in `public.admin_cleanup_test_tenant` so both stay in sync.

\set ON_ERROR_STOP on

BEGIN;

DO $coverage$
DECLARE
  tenant_tables text[] := ARRAY[
    'adjustments','ai_tool_call_log','app_settings','assistant_messages',
    'audit_logs','audit_reviewed_issues','booking_documents','bookings',
    'clients','construction_costs','construction_project_budgets','crm_leads',
    'dealers','erp_action_log','hr_attendance','hr_employees','hr_final_settlements',
    'hr_payroll_runs','hr_payslips','import_validation_audit','installment_ledger',
    'maintenance_charges','maintenance_expenses','maintenance_payments',
    'maintenance_schedules','office_expenses','payment_allocations',
    'payment_comments','payment_edit_history','payments','plan_restructure_history',
    'projects','tenant_scope_logs','units'
  ];
  t text;
  v_has_col boolean;
  v_rls boolean;
  v_policy_count int;
  v_failures text := '';
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    -- Column presence.
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = t
         AND column_name = 'company_id'
    ) INTO v_has_col;
    IF NOT v_has_col THEN
      v_failures := v_failures || format(E'\n  - %I: missing company_id column', t);
      CONTINUE;
    END IF;

    -- RLS enabled.
    SELECT c.relrowsecurity INTO v_rls
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = t;
    IF NOT COALESCE(v_rls, false) THEN
      v_failures := v_failures || format(E'\n  - %I: RLS not enabled', t);
    END IF;

    -- At least one policy references current_company_id() (directly, or via
    -- a helper such as public.has_role() / public.is_writer() whose
    -- definition scopes to current_company_id()).
    SELECT count(*) INTO v_policy_count
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = t
       AND (
            COALESCE(qual, '')       ILIKE '%current_company_id()%'
         OR COALESCE(with_check, '') ILIKE '%current_company_id()%'
         OR COALESCE(qual, '')       ILIKE '%has_role(%'
         OR COALESCE(with_check, '') ILIKE '%has_role(%'
         OR COALESCE(qual, '')       ILIKE '%is_writer(%'
         OR COALESCE(with_check, '') ILIKE '%is_writer(%'
       );
    IF v_policy_count = 0 THEN
      v_failures := v_failures || format(
        E'\n  - %I: no policy references current_company_id() / has_role / is_writer',
        t
      );
    END IF;
  END LOOP;

  IF length(v_failures) > 0 THEN
    RAISE EXCEPTION E'FAIL: tenant policy coverage gaps:%', v_failures;
  END IF;
  RAISE NOTICE 'PASS: tenant policy coverage — % tables checked', array_length(tenant_tables, 1);
END
$coverage$;

-- --------------------------------------------------------------------
-- companies-specific policy checks (structure, not just coverage).
-- --------------------------------------------------------------------
DO $companies_checks$
DECLARE
  v_rls boolean;
  v_ins_restrictive int;
  v_del_restrictive int;
  v_super_admin_all int;
BEGIN
  SELECT c.relrowsecurity INTO v_rls
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'companies';
  IF NOT COALESCE(v_rls, false) THEN
    RAISE EXCEPTION 'FAIL: public.companies has RLS disabled';
  END IF;

  -- RESTRICTIVE INSERT gate limited to super admins.
  SELECT count(*) INTO v_ins_restrictive
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename  = 'companies'
     AND cmd        = 'INSERT'
     AND permissive = 'RESTRICTIVE'
     AND COALESCE(with_check, '') ILIKE '%is_super_admin(%';
  IF v_ins_restrictive = 0 THEN
    RAISE EXCEPTION
      'FAIL: public.companies has no RESTRICTIVE INSERT policy gated on is_super_admin()';
  END IF;

  -- RESTRICTIVE DELETE gate limited to super admins.
  SELECT count(*) INTO v_del_restrictive
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename  = 'companies'
     AND cmd        = 'DELETE'
     AND permissive = 'RESTRICTIVE'
     AND COALESCE(qual, '') ILIKE '%is_super_admin(%';
  IF v_del_restrictive = 0 THEN
    RAISE EXCEPTION
      'FAIL: public.companies has no RESTRICTIVE DELETE policy gated on is_super_admin()';
  END IF;

  -- Super admin ALL still present (so operational access is not blocked).
  SELECT count(*) INTO v_super_admin_all
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename  = 'companies'
     AND cmd        = 'ALL'
     AND COALESCE(qual, '') ILIKE '%is_super_admin(%';
  IF v_super_admin_all = 0 THEN
    RAISE EXCEPTION
      'FAIL: public.companies missing super-admin ALL policy — operators cannot manage tenants';
  END IF;

  RAISE NOTICE 'PASS: public.companies has RLS + RESTRICTIVE INSERT/DELETE + super_admin ALL';
END
$companies_checks$;

ROLLBACK;
