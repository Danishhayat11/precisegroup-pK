
DROP POLICY IF EXISTS units_read ON public.units;
CREATE POLICY units_read ON public.units
  FOR SELECT
  TO authenticated
  USING (public.is_writer(auth.uid()));
