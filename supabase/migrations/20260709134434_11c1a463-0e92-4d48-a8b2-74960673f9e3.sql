-- 1. Add phone to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone text;

-- 2. bootstrap_company: creates a new company for the calling user and
--    reassigns their profile + role. Only usable while the caller is still
--    on the seed company AND has no existing owner/admin role elsewhere.
CREATE OR REPLACE FUNCTION public.bootstrap_company(
  _company_name text,
  _phone text,
  _plan public.company_plan
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
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

  INSERT INTO public.companies (name, plan, is_active, onboarding_completed_at)
  VALUES (btrim(_company_name), COALESCE(_plan,'starter'::public.company_plan), true, NULL)
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
END $$;

REVOKE ALL ON FUNCTION public.bootstrap_company(text,text,public.company_plan) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.bootstrap_company(text,text,public.company_plan) TO authenticated;

-- 3. mark_onboarding_complete: allows any admin of a company to mark the
--    wizard as complete. Idempotent.
CREATE OR REPLACE FUNCTION public.mark_onboarding_complete()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_company uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT company_id INTO v_company FROM public.profiles WHERE id = v_caller;
  IF v_company IS NULL THEN RETURN; END IF;
  IF NOT public.has_role(v_caller, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  UPDATE public.companies
     SET onboarding_completed_at = COALESCE(onboarding_completed_at, now())
   WHERE id = v_company;
END $$;

REVOKE ALL ON FUNCTION public.mark_onboarding_complete() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_onboarding_complete() TO authenticated;