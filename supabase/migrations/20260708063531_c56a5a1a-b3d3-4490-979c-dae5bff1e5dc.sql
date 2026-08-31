
DROP POLICY IF EXISTS led_read ON public.installment_ledger;
CREATE POLICY led_read ON public.installment_ledger
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid()));
