-- Redirect reason logging: records why the app sent a user from one route to
-- another, so production misroutes (session flapping, onboarding loops,
-- admin gate false-positives, etc.) are auditable instead of invisible.

CREATE TABLE public.redirect_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NULL,
  company_id uuid NULL,
  reason text NOT NULL,
  from_path text NULL,
  to_path text NULL,
  session_present boolean NULL,
  is_admin boolean NULL,
  onboarding_completed boolean NULL,
  plan text NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_agent text NULL
);

GRANT SELECT ON public.redirect_events TO authenticated;
GRANT ALL    ON public.redirect_events TO service_role;

ALTER TABLE public.redirect_events ENABLE ROW LEVEL SECURITY;

-- Only admins/managers can browse the log directly.
CREATE POLICY "redirect_events: admins read"
  ON public.redirect_events FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
  );

-- No direct INSERT policy — writes go through the SECURITY DEFINER RPC below
-- so we can sanitize inputs and cap volume without granting a raw INSERT.

CREATE INDEX redirect_events_occurred_at_idx
  ON public.redirect_events (occurred_at DESC);
CREATE INDEX redirect_events_reason_idx
  ON public.redirect_events (reason, occurred_at DESC);
CREATE INDEX redirect_events_user_idx
  ON public.redirect_events (user_id, occurred_at DESC);

-- Whitelisted redirect reasons — keeps the log queryable and refuses
-- arbitrary strings from a compromised client. Extend deliberately.
CREATE OR REPLACE FUNCTION public.log_redirect_reason(
  _reason text,
  _from_path text DEFAULT NULL,
  _to_path text DEFAULT NULL,
  _meta jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_company uuid;
  v_id uuid;
  v_from text := left(COALESCE(_from_path, ''), 300);
  v_to   text := left(COALESCE(_to_path,   ''), 300);
  v_meta jsonb := COALESCE(_meta, '{}'::jsonb);
  v_ua   text;
  v_session_present boolean := (v_uid IS NOT NULL);
  v_is_admin boolean := NULL;
  v_onboarded boolean := NULL;
  v_plan text := NULL;
BEGIN
  IF _reason IS NULL OR _reason NOT IN (
    'no_session_redirect_to_login',
    'signed_out_redirect_to_login',
    'onboarding_incomplete_redirect',
    'onboarding_complete_leave_wizard',
    'non_admin_denied',
    'admin_granted',
    'invite_accepted_redirect',
    'oauth_return_to_intended',
    'root_marketing_redirect',
    'plan_gate_blocked'
  ) THEN
    RAISE EXCEPTION 'invalid redirect reason: %', _reason USING ERRCODE = '22023';
  END IF;

  IF jsonb_typeof(v_meta) <> 'object' THEN
    v_meta := '{}'::jsonb;
  END IF;

  v_ua := left(COALESCE(v_meta->>'user_agent', ''), 500);

  IF v_uid IS NOT NULL THEN
    SELECT p.company_id
      INTO v_company
      FROM public.profiles p
     WHERE p.id = v_uid;

    v_is_admin := public.has_role(v_uid, 'admin'::public.app_role);

    IF v_company IS NOT NULL THEN
      SELECT (c.onboarding_completed_at IS NOT NULL),
             c.plan::text
        INTO v_onboarded, v_plan
        FROM public.companies c
       WHERE c.id = v_company;
    END IF;
  END IF;

  INSERT INTO public.redirect_events (
    user_id, company_id, reason,
    from_path, to_path,
    session_present, is_admin, onboarding_completed, plan,
    meta, user_agent
  )
  VALUES (
    v_uid, v_company, _reason,
    NULLIF(v_from, ''), NULLIF(v_to, ''),
    v_session_present, v_is_admin, v_onboarded, v_plan,
    v_meta - 'user_agent', NULLIF(v_ua, '')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END $$;

-- Allow both signed-in and anonymous callers (pre-auth redirects need this).
-- Reason whitelist + SECURITY DEFINER keep the surface tight.
GRANT EXECUTE ON FUNCTION public.log_redirect_reason(text, text, text, jsonb)
  TO anon, authenticated;
