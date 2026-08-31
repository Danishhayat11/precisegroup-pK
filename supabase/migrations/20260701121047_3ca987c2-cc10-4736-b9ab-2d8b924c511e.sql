
-- 1. Tighten UPDATE policies: only admin may edit existing rows
DROP POLICY IF EXISTS pay_update ON public.payments;
CREATE POLICY pay_update ON public.payments FOR UPDATE
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS led_update ON public.installment_ledger;
CREATE POLICY led_update ON public.installment_ledger FOR UPDATE
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS bookings_update ON public.bookings;
CREATE POLICY bookings_update ON public.bookings FOR UPDATE
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS adj_update ON public.adjustments;
CREATE POLICY adj_update ON public.adjustments FOR UPDATE
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

-- 2. user_roles: admin-only writes
DROP POLICY IF EXISTS roles_admin_insert ON public.user_roles;
DROP POLICY IF EXISTS roles_admin_update ON public.user_roles;
DROP POLICY IF EXISTS roles_admin_delete ON public.user_roles;
CREATE POLICY roles_admin_insert ON public.user_roles FOR INSERT
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY roles_admin_update ON public.user_roles FOR UPDATE
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE POLICY roles_admin_delete ON public.user_roles FOR DELETE
  USING (public.has_role(auth.uid(),'admin'));

-- 3. profiles: admin can view every profile row (was manager too — keep it simple)
DROP POLICY IF EXISTS profiles_select_self_or_admin ON public.profiles;
CREATE POLICY profiles_select_self_or_admin ON public.profiles FOR SELECT
  USING (auth.uid() = id OR public.has_role(auth.uid(),'admin'));

-- 4. payment_comments table (staff can comment / request edits; admin manages)
CREATE TABLE IF NOT EXISTS public.payment_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_receipt_no text,
  booking_id text,
  body text NOT NULL CHECK (length(btrim(body)) > 0),
  kind text NOT NULL DEFAULT 'comment' CHECK (kind IN ('comment','edit_request')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_comments TO authenticated;
GRANT ALL ON public.payment_comments TO service_role;

ALTER TABLE public.payment_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pc_read ON public.payment_comments;
DROP POLICY IF EXISTS pc_insert ON public.payment_comments;
DROP POLICY IF EXISTS pc_update ON public.payment_comments;
DROP POLICY IF EXISTS pc_delete ON public.payment_comments;

CREATE POLICY pc_read ON public.payment_comments FOR SELECT
  USING (auth.uid() IS NOT NULL);
CREATE POLICY pc_insert ON public.payment_comments FOR INSERT
  WITH CHECK (auth.uid() = created_by);
CREATE POLICY pc_update ON public.payment_comments FOR UPDATE
  USING (public.has_role(auth.uid(),'admin') OR created_by = auth.uid())
  WITH CHECK (public.has_role(auth.uid(),'admin') OR created_by = auth.uid());
CREATE POLICY pc_delete ON public.payment_comments FOR DELETE
  USING (public.has_role(auth.uid(),'admin'));

CREATE INDEX IF NOT EXISTS ix_pc_receipt ON public.payment_comments(payment_receipt_no);
CREATE INDEX IF NOT EXISTS ix_pc_booking ON public.payment_comments(booking_id);
CREATE INDEX IF NOT EXISTS ix_pc_open    ON public.payment_comments(status) WHERE status = 'open';

-- 5. Helper functions consumed by the UI
CREATE OR REPLACE FUNCTION public.list_admin_contacts()
RETURNS TABLE(email text, full_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.email, p.full_name
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.id
  WHERE ur.role = 'admin'
  ORDER BY p.full_name NULLS LAST;
$$;
REVOKE EXECUTE ON FUNCTION public.list_admin_contacts() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.list_admin_contacts() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE(id uuid, email text, full_name text, role public.app_role, last_sign_in_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
         WHEN 'admin'   THEN 1
         WHEN 'manager' THEN 2
         WHEN 'staff'   THEN 3
         WHEN 'viewer'  THEN 4
         ELSE 5 END
       LIMIT 1) AS role,
    u.last_sign_in_at
  FROM public.profiles p
  LEFT JOIN auth.users u ON u.id = p.id
  ORDER BY p.full_name NULLS LAST;
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_list_users() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_role(_user uuid, _role public.app_role)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN
    RAISE EXCEPTION 'admin only' USING ERRCODE = '42501';
  END IF;
  IF _user = auth.uid() AND _role <> 'admin' THEN
    -- Prevent an admin from accidentally demoting themself and losing access
    IF (SELECT COUNT(*) FROM public.user_roles WHERE role = 'admin') <= 1 THEN
      RAISE EXCEPTION 'cannot remove the last admin';
    END IF;
  END IF;
  DELETE FROM public.user_roles WHERE user_id = _user;
  INSERT INTO public.user_roles(user_id, role) VALUES (_user, _role);
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_set_role(uuid, public.app_role) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_role(uuid, public.app_role) TO authenticated;
