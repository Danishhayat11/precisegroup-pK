-- redirect_events: scope reads to caller's company; super_admin sees all
DROP POLICY IF EXISTS "redirect_events: admins read" ON public.redirect_events;
CREATE POLICY "redirect_events: admins read"
  ON public.redirect_events
  FOR SELECT
  TO authenticated
  USING (
    public.is_super_admin(auth.uid())
    OR (
      (public.has_role(auth.uid(), 'admin'::public.app_role)
       OR public.has_role(auth.uid(), 'manager'::public.app_role))
      AND company_id IS NOT DISTINCT FROM public.current_company_id()
    )
  );

-- ssr_error_events: no per-row tenant context is captured (SSR fallback path
-- has no user session). Restrict reads to super admins to prevent tenant
-- admins/managers from seeing other tenants' error paths and messages.
DROP POLICY IF EXISTS "ssr_error_events_admin_select" ON public.ssr_error_events;
CREATE POLICY "ssr_error_events_super_admin_select"
  ON public.ssr_error_events
  FOR SELECT
  TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- Align the stats RPC with the new visibility rules.
CREATE OR REPLACE FUNCTION public.get_ssr_error_stats()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN public.is_super_admin(auth.uid()) THEN
      jsonb_build_object(
        'last_5m',  (SELECT COUNT(*) FROM ssr_error_events WHERE occurred_at >= now() - interval '5 minutes'),
        'last_1h',  (SELECT COUNT(*) FROM ssr_error_events WHERE occurred_at >= now() - interval '1 hour'),
        'last_24h', (SELECT COUNT(*) FROM ssr_error_events WHERE occurred_at >= now() - interval '24 hours'),
        'per_minute_60', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('bucket', b, 'count', c) ORDER BY b)
          FROM (
            SELECT date_trunc('minute', occurred_at) AS b, COUNT(*) AS c
            FROM ssr_error_events
            WHERE occurred_at >= now() - interval '60 minutes'
            GROUP BY 1
          ) t
        ), '[]'::jsonb),
        'recent', COALESCE((
          SELECT jsonb_agg(to_jsonb(r) ORDER BY r.occurred_at DESC)
          FROM (
            SELECT id, occurred_at, kind, method, path, error_id, message, user_agent
            FROM ssr_error_events
            ORDER BY occurred_at DESC
            LIMIT 50
          ) r
        ), '[]'::jsonb),
        'config', (SELECT to_jsonb(c) FROM ssr_alert_config c LIMIT 1)
      )
    ELSE NULL
  END;
$function$;