
CREATE OR REPLACE FUNCTION public.audit_companies_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_actor uuid := auth.uid();
  v_email text;
  v_before jsonb;
  v_after  jsonb;
  v_changed jsonb := '{}'::jsonb;
  v_action text;
  v_company_id uuid;
  v_key text;
BEGIN
  IF v_actor IS NOT NULL THEN
    SELECT email INTO v_email FROM public.profiles WHERE id = v_actor;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_action := 'company.created';
    v_company_id := NEW.id;
    v_before := NULL;
    v_after := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'company.updated';
    v_company_id := NEW.id;
    v_before := to_jsonb(OLD);
    v_after := to_jsonb(NEW);
    -- Diff: keep only fields that actually changed.
    FOR v_key IN SELECT jsonb_object_keys(v_after) LOOP
      IF (v_before->v_key) IS DISTINCT FROM (v_after->v_key) THEN
        v_changed := v_changed || jsonb_build_object(
          v_key,
          jsonb_build_object('from', v_before->v_key, 'to', v_after->v_key)
        );
      END IF;
    END LOOP;
    IF v_changed = '{}'::jsonb THEN
      RETURN NEW; -- no-op update, skip logging
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    v_action := 'company.deleted';
    v_company_id := OLD.id;
    v_before := to_jsonb(OLD);
    v_after := NULL;
  END IF;

  INSERT INTO public.audit_logs(
    actor_id, actor_email, action, entity, entity_id,
    before, after, company_id
  )
  VALUES (
    v_actor, v_email, v_action, 'company', v_company_id::text,
    v_before,
    CASE WHEN TG_OP = 'UPDATE'
         THEN jsonb_build_object('changed', v_changed, 'after', v_after)
         ELSE v_after END,
    v_company_id
  );

  RETURN COALESCE(NEW, OLD);
END
$fn$;

DROP TRIGGER IF EXISTS trg_audit_companies_ins ON public.companies;
DROP TRIGGER IF EXISTS trg_audit_companies_upd ON public.companies;
DROP TRIGGER IF EXISTS trg_audit_companies_del ON public.companies;

CREATE TRIGGER trg_audit_companies_ins
AFTER INSERT ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.audit_companies_changes();

CREATE TRIGGER trg_audit_companies_upd
AFTER UPDATE ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.audit_companies_changes();

CREATE TRIGGER trg_audit_companies_del
AFTER DELETE ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.audit_companies_changes();
