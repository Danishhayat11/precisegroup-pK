
CREATE TABLE public.ssr_error_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  kind        text NOT NULL CHECK (kind IN ('catastrophic','thrown')),
  method      text,
  path        text,
  error_id    text,
  message     text,
  user_agent  text
);
CREATE INDEX ssr_error_events_occurred_at_idx ON public.ssr_error_events(occurred_at DESC);

GRANT SELECT ON public.ssr_error_events TO authenticated;
GRANT ALL    ON public.ssr_error_events TO service_role;
ALTER TABLE public.ssr_error_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY ssr_error_events_admin_select ON public.ssr_error_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'));

CREATE TABLE public.ssr_alert_config (
  id                  boolean PRIMARY KEY DEFAULT true CHECK (id),
  threshold_per_5min  integer NOT NULL DEFAULT 5,
  cooldown_minutes    integer NOT NULL DEFAULT 30,
  last_alerted_at     timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.ssr_alert_config (id) VALUES (true) ON CONFLICT DO NOTHING;

GRANT SELECT, UPDATE ON public.ssr_alert_config TO authenticated;
GRANT ALL            ON public.ssr_alert_config TO service_role;
ALTER TABLE public.ssr_alert_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY ssr_alert_config_admin_select ON public.ssr_alert_config
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'));

CREATE POLICY ssr_alert_config_admin_update ON public.ssr_alert_config
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE OR REPLACE FUNCTION public.get_ssr_error_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager') THEN
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
$$;
REVOKE ALL    ON FUNCTION public.get_ssr_error_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ssr_error_stats() TO authenticated;

CREATE OR REPLACE FUNCTION public.check_ssr_spike()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count       integer;
  v_threshold   integer;
  v_cooldown    integer;
  v_last        timestamptz;
  v_alert       boolean := false;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager')) THEN
    RETURN NULL;
  END IF;

  SELECT threshold_per_5min, cooldown_minutes, last_alerted_at
    INTO v_threshold, v_cooldown, v_last
  FROM public.ssr_alert_config FOR UPDATE LIMIT 1;

  SELECT COUNT(*) INTO v_count
  FROM public.ssr_error_events
  WHERE occurred_at >= now() - interval '5 minutes';

  IF v_count >= v_threshold
     AND (v_last IS NULL OR v_last < now() - make_interval(mins => v_cooldown)) THEN
    UPDATE public.ssr_alert_config SET last_alerted_at = now(), updated_at = now() WHERE id = true;
    v_alert := true;
  END IF;

  RETURN jsonb_build_object(
    'alert', v_alert,
    'count_5m', v_count,
    'threshold', v_threshold,
    'cooldown_minutes', v_cooldown,
    'last_alerted_at', v_last
  );
END
$$;
REVOKE ALL    ON FUNCTION public.check_ssr_spike() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_ssr_spike() TO authenticated;
