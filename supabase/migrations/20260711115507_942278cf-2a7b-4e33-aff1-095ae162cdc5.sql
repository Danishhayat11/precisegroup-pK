-- New tenant signups must be reviewed by a super admin before they can use the app.
-- Company starts as pending + inactive; onboarding is blocked until approved.
CREATE OR REPLACE FUNCTION public.bootstrap_company(_company_name text, _phone text, _plan company_plan)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_current_company uuid;
  v_new_company uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF _company_name IS NULL OR btrim(_company_name) = '' THEN
    RAISE EXCEPTION 'company name required' USING ERRCODE = '22023';
  END IF;

  SELECT company_id INTO v_current_company
    FROM public.profiles WHERE id = v_caller;

  -- Only allow when caller is still on the seed default company.
  IF v_current_company IS DISTINCT FROM '00000000-0000-0000-0000-000000000001'::uuid THEN
    RAISE EXCEPTION 'company already assigned' USING ERRCODE = '42501';
  END IF;

  -- Self-serve signups land as PENDING and INACTIVE. A super admin must
  -- approve them via the Super Admin page before any tenant user can use
  -- the platform.
  INSERT INTO public.companies (name, plan, is_active, approval_status, onboarding_completed_at)
  VALUES (
    btrim(_company_name),
    COALESCE(_plan,'starter'::public.company_plan),
    false,
    'pending',
    NULL
  )
  RETURNING id INTO v_new_company;

  UPDATE public.profiles
     SET company_id = v_new_company,
         phone = COALESCE(NULLIF(btrim(_phone),''), phone),
         updated_at = now()
   WHERE id = v_caller;

  -- Remove any seed-company roles and grant admin on the new company.
  DELETE FROM public.user_roles WHERE user_id = v_caller;
  INSERT INTO public.user_roles (user_id, role, company_id)
  VALUES (v_caller, 'admin'::public.app_role, v_new_company);

  RETURN v_new_company;
END $function$;