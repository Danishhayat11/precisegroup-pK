DROP POLICY IF EXISTS "dealers_read" ON public.dealers;
CREATE POLICY "dealers_read" ON public.dealers
  FOR SELECT TO authenticated
  USING (public.is_writer(auth.uid()));

DROP POLICY IF EXISTS "settings_read" ON public.app_settings;
CREATE POLICY "settings_read" ON public.app_settings
  FOR SELECT TO authenticated
  USING (public.is_writer(auth.uid()));