DROP POLICY IF EXISTS "pay_read" ON public.payments;
CREATE POLICY "pay_read" ON public.payments
  FOR SELECT TO authenticated
  USING (public.is_writer(auth.uid()));