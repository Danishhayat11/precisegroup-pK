DROP POLICY IF EXISTS "ssr_alert_config_admin_select" ON public.ssr_alert_config;
DROP POLICY IF EXISTS "ssr_alert_config_admin_update" ON public.ssr_alert_config;

CREATE POLICY "ssr_alert_config_super_admin_select"
  ON public.ssr_alert_config
  FOR SELECT
  TO authenticated
  USING (public.is_super_admin(auth.uid()));

CREATE POLICY "ssr_alert_config_super_admin_update"
  ON public.ssr_alert_config
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));