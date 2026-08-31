
-- Structured audit logging for /security-review access attempts.
-- Rides on the existing public.audit_logs table so admins keep a single
-- searchable feed. Runs SECURITY DEFINER because the INSERT policy on
-- audit_logs requires actor_id = auth.uid(), which excludes anonymous
-- redirects; we validate + normalize inputs inside the function instead.
CREATE OR REPLACE FUNCTION public.log_security_review_access(
  _event_type text,
  _path       text DEFAULT NULL,
  _note       text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid  := auth.uid();
  v_email   text;
  v_id      uuid;
  v_path    text  := left(COALESCE(_path, ''), 200);
  v_note    text  := left(COALESCE(_note, ''), 500);
  v_event   text;
BEGIN
  -- Whitelist event types so callers can't spam arbitrary strings.
  IF _event_type NOT IN (
    'unauthenticated_redirect',
    'denied_non_admin',
    'granted_admin'
  ) THEN
    RAISE EXCEPTION 'invalid event_type: %', _event_type
      USING ERRCODE = '22023';
  END IF;
  v_event := _event_type;

  -- Server-side integrity: an anonymous session cannot claim to be an admin,
  -- and an authenticated non-admin cannot claim `granted_admin`.
  IF v_event = 'granted_admin'
     AND (v_uid IS NULL OR NOT public.has_role(v_uid, 'admin'::app_role)) THEN
    RAISE EXCEPTION 'granted_admin requires an authenticated admin'
      USING ERRCODE = '42501';
  END IF;
  IF v_event = 'denied_non_admin' AND v_uid IS NULL THEN
    RAISE EXCEPTION 'denied_non_admin requires an authenticated caller'
      USING ERRCODE = '42501';
  END IF;
  IF v_event = 'unauthenticated_redirect' AND v_uid IS NOT NULL THEN
    RAISE EXCEPTION 'unauthenticated_redirect requires an anonymous caller'
      USING ERRCODE = '42501';
  END IF;

  IF v_uid IS NOT NULL THEN
    SELECT email INTO v_email FROM public.profiles WHERE id = v_uid;
  END IF;

  INSERT INTO public.audit_logs
    (actor_id, actor_email, action, entity, entity_id, before, after)
  VALUES (
    v_uid,
    v_email,
    'security_review.access',
    'security_review',
    v_event,
    NULL,
    jsonb_build_object(
      'event_type', v_event,
      'path',       NULLIF(v_path, ''),
      'note',       NULLIF(v_note, ''),
      'occurred_at', now()
    )
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

-- Anyone can call it (including signed-out visitors being redirected away).
-- The function itself hard-codes actor_id from auth.uid(), so a caller
-- cannot forge identity — anonymous rows land with actor_id = NULL.
REVOKE ALL ON FUNCTION public.log_security_review_access(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_security_review_access(text, text, text)
  TO anon, authenticated, service_role;
