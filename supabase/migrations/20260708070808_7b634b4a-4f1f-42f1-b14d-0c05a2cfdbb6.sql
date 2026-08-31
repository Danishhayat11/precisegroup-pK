DROP POLICY IF EXISTS "bk_read" ON public.bookings;
DROP POLICY IF EXISTS "bookings_read" ON public.bookings;
CREATE POLICY "bookings_read" ON public.bookings
  FOR SELECT TO authenticated
  USING (public.is_writer(auth.uid()));

DROP POLICY IF EXISTS "adj_read" ON public.adjustments;
DROP POLICY IF EXISTS "adjustments_read" ON public.adjustments;
CREATE POLICY "adjustments_read" ON public.adjustments
  FOR SELECT TO authenticated
  USING (public.is_writer(auth.uid()));