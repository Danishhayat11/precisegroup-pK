DROP POLICY IF EXISTS peh_read ON public.payment_edit_history;
CREATE POLICY peh_read ON public.payment_edit_history
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS prh_read ON public.plan_restructure_history;
CREATE POLICY prh_read ON public.plan_restructure_history
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));