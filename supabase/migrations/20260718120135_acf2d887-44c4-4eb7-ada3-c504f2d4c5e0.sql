-- Prevent privilege escalation: only existing super_admins may grant/modify/remove the super_admin role.
CREATE OR REPLACE FUNCTION public.enforce_super_admin_grant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
  caller_is_super boolean := public.is_super_admin(caller);
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.role = 'super_admin'::public.app_role AND NOT caller_is_super THEN
      RAISE EXCEPTION 'Only super admins can grant the super_admin role'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF (NEW.role = 'super_admin'::public.app_role OR OLD.role = 'super_admin'::public.app_role)
       AND NOT caller_is_super THEN
      RAISE EXCEPTION 'Only super admins can modify super_admin role assignments'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.role = 'super_admin'::public.app_role AND NOT caller_is_super THEN
      RAISE EXCEPTION 'Only super admins can revoke the super_admin role'
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_super_admin_grant ON public.user_roles;
CREATE TRIGGER trg_enforce_super_admin_grant
BEFORE INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.enforce_super_admin_grant();