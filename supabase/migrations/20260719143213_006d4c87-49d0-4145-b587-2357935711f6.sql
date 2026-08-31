
CREATE TABLE public.super_admin_denial_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type text NOT NULL CHECK (alert_type IN ('actor','company')),
  subject_id uuid NOT NULL,
  subject_label text,
  denial_count integer NOT NULL,
  threshold integer NOT NULL,
  window_minutes integer NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  sample_rpc_names text[] NOT NULL DEFAULT '{}',
  sample_correlation_ids text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution_notes text
);

CREATE INDEX idx_sa_denial_alerts_created ON public.super_admin_denial_alerts (created_at DESC);
CREATE INDEX idx_sa_denial_alerts_subject ON public.super_admin_denial_alerts (alert_type, subject_id, created_at DESC);
CREATE INDEX idx_sa_denial_alerts_unresolved ON public.super_admin_denial_alerts (created_at DESC) WHERE resolved_at IS NULL;

GRANT SELECT, UPDATE ON public.super_admin_denial_alerts TO authenticated;
GRANT ALL ON public.super_admin_denial_alerts TO service_role;

ALTER TABLE public.super_admin_denial_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins read all denial alerts"
  ON public.super_admin_denial_alerts FOR SELECT
  TO authenticated
  USING (public.is_super_admin(auth.uid()));

CREATE POLICY "Super admins resolve denial alerts"
  ON public.super_admin_denial_alerts FOR UPDATE
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));
