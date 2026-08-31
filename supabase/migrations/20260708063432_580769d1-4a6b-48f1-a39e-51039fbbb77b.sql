
CREATE OR REPLACE FUNCTION public.has_any_role(_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = _uid)
$$;

DROP POLICY IF EXISTS clients_read ON public.clients;

CREATE POLICY clients_read ON public.clients
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid()));
