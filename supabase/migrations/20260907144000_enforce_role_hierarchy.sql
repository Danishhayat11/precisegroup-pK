-- 1. Create an immutable function to assign numeric weights to roles
CREATE OR REPLACE FUNCTION public.role_weight(r public.app_role) 
RETURNS int 
LANGUAGE sql 
IMMUTABLE
AS $$
  SELECT CASE r
    WHEN 'super_admin'::public.app_role THEN 50
    WHEN 'owner'::public.app_role THEN 40
    WHEN 'admin'::public.app_role THEN 40
    WHEN 'manager'::public.app_role THEN 30
    WHEN 'staff'::public.app_role THEN 20
    WHEN 'viewer'::public.app_role THEN 10
    ELSE 0
  END;
$$;

-- 2. Update has_role to enforce hierarchy
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
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
        (public.role_weight(role) >= public.role_weight(_role) AND company_id = public.current_company_id())
        OR role = 'super_admin'::public.app_role
      )
  )
$function$;

-- 3. Update is_writer to use the hierarchy
CREATE OR REPLACE FUNCTION public.is_writer(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.has_role(_uid, 'staff'::public.app_role)
$function$;

-- 4. Update admin_list_users to completely exclude admin/super_admin users from the list
DROP FUNCTION IF EXISTS public.admin_list_users();
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE(id uuid, email text, full_name text, role public.app_role, last_sign_in_at timestamptz, is_active boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_company uuid := public.current_company_id();
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  
  RETURN QUERY
  SELECT p.id, p.email, p.full_name,
    (SELECT ur.role
       FROM public.user_roles ur
      WHERE ur.user_id = p.id
      ORDER BY public.role_weight(ur.role) DESC
      LIMIT 1) AS role,
    u.last_sign_in_at,
    p.is_active
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  WHERE p.company_id = v_company
    AND NOT EXISTS (
      -- Exclude anyone who has an admin or super_admin role
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = p.id
        AND public.role_weight(ur.role) >= 40
    )
  ORDER BY p.full_name NULLS LAST;
END $$;
