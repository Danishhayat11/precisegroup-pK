-- Scope role-check SECURITY DEFINER helpers to the caller's current active
-- company. Without this, a role row from a different tenant could satisfy a
-- has_role / is_writer / has_any_role check in the caller's current tenant.
--
-- current_company_id() reads profiles.company_id for auth.uid(), so it
-- always reflects the CALLER's active tenant regardless of which _user_id
-- argument is passed to these helpers.

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS(
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
      AND company_id = public.current_company_id()
  )
$function$;

CREATE OR REPLACE FUNCTION public.is_writer(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS(
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _uid
      AND role IN ('admin','manager','staff')
      AND company_id = public.current_company_id()
  )
$function$;

CREATE OR REPLACE FUNCTION public.has_any_role(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS(
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _uid
      AND company_id = public.current_company_id()
  )
$function$;