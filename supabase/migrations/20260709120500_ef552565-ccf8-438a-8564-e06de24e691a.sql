
-- Transfer ownership: only current owner can call; new owner must belong to same company.
CREATE OR REPLACE FUNCTION public.admin_transfer_ownership(_new_owner uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_company uuid := public.current_company_id();
  v_new_company uuid;
  v_email text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501';
  END IF;
  IF NOT public.has_role(v_caller, 'owner') THEN
    RAISE EXCEPTION 'only the current owner can transfer ownership' USING ERRCODE='42501';
  END IF;
  IF _new_owner IS NULL OR _new_owner = v_caller THEN
    RAISE EXCEPTION 'choose a different user to transfer ownership to';
  END IF;
  SELECT company_id INTO v_new_company FROM public.profiles WHERE id = _new_owner;
  IF v_new_company IS DISTINCT FROM v_company THEN
    RAISE EXCEPTION 'target user is not a member of your company' USING ERRCODE='42501';
  END IF;

  -- Promote new owner (replace whatever role they had).
  DELETE FROM public.user_roles WHERE user_id = _new_owner;
  INSERT INTO public.user_roles(user_id, role, company_id) VALUES (_new_owner, 'owner', v_company);

  -- Demote previous owner to admin (keep write access).
  DELETE FROM public.user_roles WHERE user_id = v_caller;
  INSERT INTO public.user_roles(user_id, role, company_id) VALUES (v_caller, 'admin', v_company);

  SELECT email INTO v_email FROM public.profiles WHERE id = v_caller;
  INSERT INTO public.audit_logs(actor_id, actor_email, action, entity, entity_id, before, after)
  VALUES (
    v_caller, v_email, 'company.transfer_ownership', 'company', v_company::text,
    jsonb_build_object('previous_owner', v_caller),
    jsonb_build_object('new_owner', _new_owner, 'at', now())
  );
END $function$;

REVOKE ALL ON FUNCTION public.admin_transfer_ownership(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_transfer_ownership(uuid) TO authenticated;

-- Deactivate company: owner only.
CREATE OR REPLACE FUNCTION public.admin_deactivate_company(_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_company uuid := public.current_company_id();
  v_email text;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501';
  END IF;
  IF NOT public.has_role(v_caller, 'owner') THEN
    RAISE EXCEPTION 'only the company owner can deactivate the company' USING ERRCODE='42501';
  END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 3 THEN
    RAISE EXCEPTION 'a reason is required to deactivate the company';
  END IF;

  UPDATE public.companies SET is_active = false, updated_at = now() WHERE id = v_company;

  SELECT email INTO v_email FROM public.profiles WHERE id = v_caller;
  INSERT INTO public.audit_logs(actor_id, actor_email, action, entity, entity_id, before, after)
  VALUES (
    v_caller, v_email, 'company.deactivate', 'company', v_company::text,
    NULL, jsonb_build_object('reason', _reason, 'at', now())
  );
END $function$;

REVOKE ALL ON FUNCTION public.admin_deactivate_company(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_deactivate_company(text) TO authenticated;

-- Convenience: admin-scoped create-invitation that returns the token.
-- Insert-side RLS on company_invitations already restricts to admins in the same company.
CREATE OR REPLACE FUNCTION public.admin_create_invitation(_email text, _role app_role)
RETURNS TABLE(token uuid, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_company uuid := public.current_company_id();
  v_token uuid;
  v_expires timestamptz;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501';
  END IF;
  IF NOT public.has_role(v_caller, 'admin') AND NOT public.has_role(v_caller, 'owner') THEN
    RAISE EXCEPTION 'admin or owner required' USING ERRCODE='42501';
  END IF;
  IF _email IS NULL OR length(btrim(_email)) < 3 THEN
    RAISE EXCEPTION 'email required';
  END IF;
  IF _role = 'owner' THEN
    RAISE EXCEPTION 'cannot invite as owner; transfer ownership instead';
  END IF;

  INSERT INTO public.company_invitations(company_id, email, role, invited_by)
  VALUES (v_company, lower(btrim(_email)), _role, v_caller)
  RETURNING company_invitations.token, company_invitations.expires_at
  INTO v_token, v_expires;

  RETURN QUERY SELECT v_token, v_expires;
END $function$;

REVOKE ALL ON FUNCTION public.admin_create_invitation(text, app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_create_invitation(text, app_role) TO authenticated;
