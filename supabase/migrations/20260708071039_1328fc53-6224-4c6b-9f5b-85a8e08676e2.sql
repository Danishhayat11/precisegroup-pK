DROP POLICY IF EXISTS "pc_read" ON public.payment_comments;
CREATE POLICY "pc_read" ON public.payment_comments
  FOR SELECT TO authenticated
  USING (public.is_writer(auth.uid()));