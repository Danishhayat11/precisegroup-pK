DROP POLICY IF EXISTS "led_read" ON public.installment_ledger;
CREATE POLICY "led_read" ON public.installment_ledger
  FOR SELECT TO authenticated
  USING (public.is_writer(auth.uid()));