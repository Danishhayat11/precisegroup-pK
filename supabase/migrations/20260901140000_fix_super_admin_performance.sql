-- Fix N+1 SECURITY DEFINER overhead causing 100% CPU
-- Instead of calling is_super_admin() which creates a new execution context per row,
-- we inline the check into a single EXISTS query on user_roles.

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
      AND (
        (role = _role AND company_id = public.current_company_id())
        OR role = 'super_admin'::public.app_role
      )
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
      AND (
        (role IN ('admin','manager','staff') AND company_id = public.current_company_id())
        OR role = 'super_admin'::public.app_role
      )
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
      AND (
        company_id = public.current_company_id()
        OR role = 'super_admin'::public.app_role
      )
  )
$function$;
