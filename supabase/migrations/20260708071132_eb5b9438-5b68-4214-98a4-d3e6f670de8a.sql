DROP POLICY IF EXISTS "pa_read" ON public.payment_allocations;
CREATE POLICY "pa_read" ON public.payment_allocations
  FOR SELECT TO authenticated
  USING (public.is_writer(auth.uid()));