
CREATE TABLE public.super_admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NOT NULL,
  actor_email text,
  action text NOT NULL,
  company_id uuid,
  company_name text,
  target_user_id uuid,
  target_user_email text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sa_audit_created_at ON public.super_admin_audit_log(created_at DESC);
CREATE INDEX idx_sa_audit_company ON public.super_admin_audit_log(company_id);
CREATE INDEX idx_sa_audit_actor ON public.super_admin_audit_log(actor_id);

GRANT SELECT ON public.super_admin_audit_log TO authenticated;
GRANT ALL ON public.super_admin_audit_log TO service_role;

ALTER TABLE public.super_admin_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins can view audit log"
  ON public.super_admin_audit_log
  FOR SELECT
  TO authenticated
  USING (public.is_super_admin(auth.uid()));
