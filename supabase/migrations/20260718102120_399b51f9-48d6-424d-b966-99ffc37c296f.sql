CREATE OR REPLACE FUNCTION public.enforce_push_subscriptions_company_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ctx_company_id uuid;
BEGIN
  -- Allow privileged/service-role paths (no auth uid) to bypass, e.g. maintenance jobs.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  ctx_company_id := public.current_company_id();

  IF ctx_company_id IS NULL THEN
    RAISE EXCEPTION 'push_subscriptions: no tenant context resolved for auth.uid()=%', auth.uid()
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.company_id IS NULL OR NEW.company_id <> ctx_company_id THEN
    RAISE EXCEPTION 'push_subscriptions.company_id (%) must match current tenant context (%)',
      NEW.company_id, ctx_company_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Also block user_id spoofing at the DB layer for defense in depth.
  IF NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'push_subscriptions.user_id (%) must match auth.uid() (%)',
      NEW.user_id, auth.uid()
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_push_subscriptions_enforce_company_id ON public.push_subscriptions;

CREATE TRIGGER trg_push_subscriptions_enforce_company_id
BEFORE INSERT OR UPDATE ON public.push_subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_push_subscriptions_company_id();