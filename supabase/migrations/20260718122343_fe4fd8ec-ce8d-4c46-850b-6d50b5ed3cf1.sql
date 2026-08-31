-- 1) Audit table for SECURITY DEFINER RPC calls
CREATE TABLE IF NOT EXISTS public.security_definer_audit_log (
  id BIGSERIAL PRIMARY KEY,
  called_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  function_name TEXT NOT NULL,
  caller_user_id UUID,
  caller_role TEXT,
  caller_company_id UUID,
  is_super_admin BOOLEAN,
  tenant_check TEXT,
  tenant_check_passed BOOLEAN,
  args JSONB,
  result TEXT,
  error_message TEXT
);

GRANT SELECT ON public.security_definer_audit_log TO authenticated;
GRANT ALL ON public.security_definer_audit_log TO service_role;

ALTER TABLE public.security_definer_audit_log ENABLE ROW LEVEL SECURITY;

-- Only super admins can read the audit log
CREATE POLICY sdal_super_admin_read
  ON public.security_definer_audit_log FOR SELECT
  TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- No client writes; only SECURITY DEFINER helper below writes rows.
-- (No INSERT/UPDATE/DELETE policies => denied for authenticated/anon.)

CREATE INDEX IF NOT EXISTS idx_sdal_called_at ON public.security_definer_audit_log(called_at DESC);
CREATE INDEX IF NOT EXISTS idx_sdal_function ON public.security_definer_audit_log(function_name, called_at DESC);
CREATE INDEX IF NOT EXISTS idx_sdal_user ON public.security_definer_audit_log(caller_user_id, called_at DESC);
CREATE INDEX IF NOT EXISTS idx_sdal_company ON public.security_definer_audit_log(caller_company_id, called_at DESC);

-- 2) Helper to log a SECURITY DEFINER RPC invocation. SECURITY DEFINER so any
-- caller-context function can write, but not directly callable by clients.
CREATE OR REPLACE FUNCTION public.log_security_definer_call(
  _function_name TEXT,
  _tenant_check TEXT DEFAULT NULL,
  _tenant_check_passed BOOLEAN DEFAULT NULL,
  _args JSONB DEFAULT NULL,
  _result TEXT DEFAULT 'ok',
  _error_message TEXT DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_role TEXT := current_setting('request.jwt.claim.role', true);
  v_company UUID;
  v_super BOOLEAN := false;
BEGIN
  BEGIN
    v_company := public.current_company_id();
  EXCEPTION WHEN OTHERS THEN
    v_company := NULL;
  END;
  BEGIN
    v_super := public.is_super_admin(v_uid);
  EXCEPTION WHEN OTHERS THEN
    v_super := false;
  END;

  INSERT INTO public.security_definer_audit_log(
    function_name, caller_user_id, caller_role, caller_company_id,
    is_super_admin, tenant_check, tenant_check_passed, args, result, error_message
  ) VALUES (
    _function_name, v_uid, v_role, v_company,
    v_super, _tenant_check, _tenant_check_passed, _args, _result, _error_message
  );
EXCEPTION WHEN OTHERS THEN
  -- Never fail the caller because of audit issues
  NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.log_security_definer_call(TEXT,TEXT,BOOLEAN,JSONB,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_security_definer_call(TEXT,TEXT,BOOLEAN,JSONB,TEXT,TEXT) TO service_role;

-- 3) Instrument the highest-risk SECURITY DEFINER RPCs with audit calls.
-- Each rewrite preserves existing behaviour and adds a log row on entry and
-- on any handled error path.

-- admin_set_role: writes user_roles
CREATE OR REPLACE FUNCTION public.admin_set_role(_user UUID, _role app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company UUID := public.current_company_id();
  v_ok BOOLEAN;
BEGIN
  v_ok := public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner') OR public.is_super_admin(auth.uid());
  PERFORM public.log_security_definer_call(
    'admin_set_role',
    'admin|owner|super_admin required',
    v_ok,
    jsonb_build_object('target_user', _user, 'role', _role, 'company_id', v_company)
  );
  IF NOT v_ok THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.user_roles(user_id, role, company_id)
  VALUES (_user, _role, v_company)
  ON CONFLICT (user_id, role, company_id) DO NOTHING;
END;
$$;

-- admin_set_user_active
CREATE OR REPLACE FUNCTION public.admin_set_user_active(_user UUID, _active BOOLEAN)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok BOOLEAN;
BEGIN
  v_ok := public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner') OR public.is_super_admin(auth.uid());
  PERFORM public.log_security_definer_call(
    'admin_set_user_active',
    'admin|owner|super_admin required',
    v_ok,
    jsonb_build_object('target_user', _user, 'active', _active)
  );
  IF NOT v_ok THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles SET is_active = _active WHERE id = _user;
END;
$$;

-- admin_deactivate_company (super-admin only)
CREATE OR REPLACE FUNCTION public.admin_deactivate_company(_company_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok BOOLEAN := public.is_super_admin(auth.uid());
BEGIN
  PERFORM public.log_security_definer_call(
    'admin_deactivate_company',
    'super_admin required',
    v_ok,
    jsonb_build_object('company_id', _company_id)
  );
  IF NOT v_ok THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  UPDATE public.companies SET is_active = false WHERE id = _company_id;
END;
$$;

-- bootstrap_company: user-invoked; log company creation
CREATE OR REPLACE FUNCTION public.bootstrap_company(_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_company UUID;
BEGIN
  IF v_uid IS NULL THEN
    PERFORM public.log_security_definer_call('bootstrap_company', 'auth.uid() required', false, jsonb_build_object('name', _name), 'error', 'unauthenticated');
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.companies(name, owner_user_id, is_active)
  VALUES (_name, v_uid, true)
  RETURNING id INTO v_company;

  INSERT INTO public.user_roles(user_id, role, company_id)
  VALUES (v_uid, 'owner', v_company)
  ON CONFLICT DO NOTHING;

  UPDATE public.profiles SET company_id = v_company WHERE id = v_uid;

  PERFORM public.log_security_definer_call(
    'bootstrap_company',
    'authenticated user creates own company',
    true,
    jsonb_build_object('company_id', v_company, 'name', _name)
  );

  RETURN v_company;
END;
$$;

-- admin_delete_payment
CREATE OR REPLACE FUNCTION public.admin_delete_payment(_payment_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company UUID := public.current_company_id();
  v_pay_company UUID;
  v_ok BOOLEAN;
BEGIN
  SELECT company_id INTO v_pay_company FROM public.payments WHERE id = _payment_id;
  v_ok := (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'owner') OR public.is_super_admin(auth.uid()))
          AND (public.is_super_admin(auth.uid()) OR v_pay_company = v_company);

  PERFORM public.log_security_definer_call(
    'admin_delete_payment',
    'company_id match + admin|owner|super_admin',
    v_ok,
    jsonb_build_object('payment_id', _payment_id, 'payment_company', v_pay_company, 'caller_company', v_company)
  );
  IF NOT v_ok THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.payments WHERE id = _payment_id;
END;
$$;

-- Ensure grants preserved after CREATE OR REPLACE
GRANT EXECUTE ON FUNCTION public.admin_set_role(UUID, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_active(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_deactivate_company(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_company(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_payment(UUID) TO authenticated;