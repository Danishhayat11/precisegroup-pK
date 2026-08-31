
DROP POLICY IF EXISTS pay_read ON public.payments;
CREATE POLICY pay_read ON public.payments
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid()));
