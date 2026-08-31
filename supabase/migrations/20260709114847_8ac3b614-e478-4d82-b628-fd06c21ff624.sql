
-- =========================================================================
-- PHASE 1: Multi-tenant SaaS foundation
-- =========================================================================

-- 1. Enums --------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.company_plan AS ENUM ('starter','professional','builder');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Add 'owner' to app_role (not USED in this migration, avoids PG 12+ enum-in-txn restriction)
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'owner' BEFORE 'admin';

-- 2. Companies table ----------------------------------------------------
CREATE TABLE IF NOT EXISTS public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  logo_url text,
  address text,
  city text,
  phone text,
  email text,
  currency text NOT NULL DEFAULT 'PKR',
  financial_year_start smallint NOT NULL DEFAULT 7 CHECK (financial_year_start BETWEEN 1 AND 12),
  plan public.company_plan NOT NULL DEFAULT 'starter',
  is_active boolean NOT NULL DEFAULT true,
  default_project_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.companies TO authenticated;
GRANT ALL ON public.companies TO service_role;

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS trg_companies_updated_at ON public.companies;
CREATE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Seed the default company ------------------------------------------
INSERT INTO public.companies (id, name, city, currency, financial_year_start, plan, is_active)
VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'Precise Realtors and Builders',
  'Pakistan',
  'PKR', 7, 'builder', true
)
ON CONFLICT (id) DO NOTHING;

-- 4. Profiles: attach to company + activation flag ---------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id),
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

UPDATE public.profiles
   SET company_id = '00000000-0000-0000-0000-000000000001'::uuid
 WHERE company_id IS NULL;

ALTER TABLE public.profiles ALTER COLUMN company_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS profiles_company_id_idx ON public.profiles(company_id);

-- 5. Tenant helper functions -------------------------------------------
CREATE OR REPLACE FUNCTION public.current_company_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT company_id FROM public.profiles WHERE id = auth.uid() $$;

CREATE OR REPLACE FUNCTION public.has_role_in_company(_uid uuid, _company uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.user_id = _uid AND ur.role = _role AND p.company_id = _company
  )
$$;

CREATE OR REPLACE FUNCTION public.is_writer_in_company(_uid uuid, _company uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE ur.user_id = _uid
      AND ur.role IN ('admin','manager','staff')
      AND p.company_id = _company
  )
$$;

-- 6. RLS on companies ---------------------------------------------------
DROP POLICY IF EXISTS companies_select_own ON public.companies;
CREATE POLICY companies_select_own ON public.companies
  FOR SELECT TO authenticated
  USING (id = public.current_company_id());

DROP POLICY IF EXISTS companies_update_admin ON public.companies;
CREATE POLICY companies_update_admin ON public.companies
  FOR UPDATE TO authenticated
  USING (id = public.current_company_id() AND public.has_role(auth.uid(),'admin'))
  WITH CHECK (id = public.current_company_id());

-- 7. Company invitations table -----------------------------------------
CREATE TABLE IF NOT EXISTS public.company_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  email text NOT NULL,
  role public.app_role NOT NULL,
  token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_invitations TO authenticated;
GRANT ALL ON public.company_invitations TO service_role;

ALTER TABLE public.company_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invitations_admin_all ON public.company_invitations;
CREATE POLICY invitations_admin_all ON public.company_invitations
  FOR ALL TO authenticated
  USING (company_id = public.current_company_id() AND public.has_role(auth.uid(),'admin'))
  WITH CHECK (company_id = public.current_company_id() AND public.has_role(auth.uid(),'admin'));

CREATE INDEX IF NOT EXISTS company_invitations_company_idx ON public.company_invitations(company_id);
CREATE INDEX IF NOT EXISTS company_invitations_email_idx   ON public.company_invitations(email);

-- 8. Add company_id to EVERY domain table + backfill + tenant isolation
DO $$
DECLARE
  t text;
  domain_tables text[] := ARRAY[
    'bookings','payments','installment_ledger','payment_allocations','payment_comments','payment_edit_history',
    'projects','units','clients','dealers','adjustments','plan_restructure_history','booking_documents',
    'crm_leads','office_expenses','construction_costs','construction_project_budgets',
    'hr_employees','hr_attendance','hr_payroll_runs','hr_payslips','hr_final_settlements',
    'maintenance_schedules','maintenance_charges','maintenance_payments','maintenance_expenses',
    'audit_logs','audit_reviewed_issues','erp_action_log','import_validation_audit',
    'ai_tool_call_log','assistant_messages','app_settings','user_roles'
  ];
BEGIN
  FOREACH t IN ARRAY domain_tables LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id) DEFAULT ''00000000-0000-0000-0000-000000000001''::uuid',
      t
    );
    EXECUTE format(
      'UPDATE public.%I SET company_id = ''00000000-0000-0000-0000-000000000001''::uuid WHERE company_id IS NULL',
      t
    );
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN company_id SET NOT NULL', t);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN company_id DROP DEFAULT', t);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I(company_id)', t || '_company_id_idx', t);

    -- RESTRICTIVE tenant isolation: hard perimeter around each tenant.
    -- ANDed with existing permissive role policies — never grants access on its own.
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_isolation', t
    );
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (company_id = public.current_company_id()) WITH CHECK (company_id = public.current_company_id())',
      t || '_tenant_isolation', t
    );
  END LOOP;
END $$;

-- 9. Seed tables (used by reseed_demo_data) get company_id too ---------
DO $$
DECLARE t text;
  seed_tables text[] := ARRAY[
    '_seed_projects','_seed_clients','_seed_units','_seed_dealers','_seed_bookings',
    '_seed_payments','_seed_installment_ledger','_seed_adjustments'
  ];
BEGIN
  FOREACH t IN ARRAY seed_tables LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS company_id uuid NOT NULL DEFAULT ''00000000-0000-0000-0000-000000000001''::uuid REFERENCES public.companies(id)',
      t
    );
  END LOOP;
END $$;

-- 10. Rewrite handle_new_user to honour invitations + assign company ---
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_role       public.app_role;
  v_token      uuid;
  v_inv        public.company_invitations;
  v_existing   integer;
BEGIN
  v_token := NULLIF(NEW.raw_user_meta_data->>'invitation_token','')::uuid;
  IF v_token IS NOT NULL THEN
    SELECT * INTO v_inv
      FROM public.company_invitations
     WHERE token = v_token
       AND accepted_at IS NULL
       AND expires_at > now();
    IF FOUND THEN
      v_company_id := v_inv.company_id;
      v_role       := v_inv.role;
      UPDATE public.company_invitations SET accepted_at = now() WHERE id = v_inv.id;
    END IF;
  END IF;

  IF v_company_id IS NULL THEN
    v_company_id := '00000000-0000-0000-0000-000000000001'::uuid;
    SELECT COUNT(*) INTO v_existing FROM public.user_roles;
    v_role := CASE WHEN v_existing = 0 THEN 'admin'::public.app_role
                   ELSE 'viewer'::public.app_role END;
  END IF;

  INSERT INTO public.profiles(id, email, full_name, company_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1)),
    v_company_id
  );

  INSERT INTO public.user_roles(user_id, role, company_id)
  VALUES (NEW.id, v_role, v_company_id);

  RETURN NEW;
END $$;

-- 11. Scope admin_list_users to the caller's own company ---------------
DROP FUNCTION IF EXISTS public.admin_list_users();
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE(id uuid, email text, full_name text, role public.app_role, last_sign_in_at timestamptz, is_active boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_company uuid := public.current_company_id();
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT p.id, p.email, p.full_name,
    (SELECT ur.role
       FROM public.user_roles ur
      WHERE ur.user_id = p.id
      ORDER BY CASE ur.role
        WHEN 'owner'   THEN 0
        WHEN 'admin'   THEN 1
        WHEN 'manager' THEN 2
        WHEN 'staff'   THEN 3
        WHEN 'viewer'  THEN 4
        ELSE 5 END
      LIMIT 1) AS role,
    u.last_sign_in_at,
    p.is_active
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  WHERE p.company_id = v_company
  ORDER BY p.full_name NULLS LAST;
END $$;

-- 12. Prevent cross-company role grants --------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_role(_user uuid, _role public.app_role)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller_company uuid := public.current_company_id();
  v_target_company uuid;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  SELECT company_id INTO v_target_company FROM public.profiles WHERE id = _user;
  IF v_target_company IS DISTINCT FROM v_caller_company THEN
    RAISE EXCEPTION 'cannot manage users outside your own company' USING ERRCODE = '42501';
  END IF;
  IF _user = auth.uid() THEN
    IF (SELECT COUNT(*) FROM public.user_roles ur
        JOIN public.profiles p ON p.id = ur.user_id
        WHERE p.company_id = v_caller_company AND ur.role = 'admin') <= 1
       AND _role <> 'admin' THEN
      RAISE EXCEPTION 'cannot remove the last admin of this company';
    END IF;
  END IF;
  DELETE FROM public.user_roles WHERE user_id = _user;
  INSERT INTO public.user_roles(user_id, role, company_id) VALUES (_user, _role, v_caller_company);
END $$;

-- 13. Convenience: activation toggle for a user (admin only) -----------
CREATE OR REPLACE FUNCTION public.admin_set_user_active(_user uuid, _active boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_caller_company uuid := public.current_company_id(); v_target_company uuid;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE='42501';
  END IF;
  SELECT company_id INTO v_target_company FROM public.profiles WHERE id = _user;
  IF v_target_company IS DISTINCT FROM v_caller_company THEN
    RAISE EXCEPTION 'cannot manage users outside your own company' USING ERRCODE='42501';
  END IF;
  UPDATE public.profiles SET is_active = _active WHERE id = _user;
END $$;
