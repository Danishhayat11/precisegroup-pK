CREATE TABLE IF NOT EXISTS public.tenant_scope_logs (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID,
  company_id UUID,
  fn_path TEXT,
  status TEXT NOT NULL CHECK (status IN ('ok','err')),
  duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS tenant_scope_logs_occurred_at_idx ON public.tenant_scope_logs (occurred_at DESC);
CREATE INDEX IF NOT EXISTS tenant_scope_logs_company_idx ON public.tenant_scope_logs (company_id, occurred_at DESC);
GRANT SELECT ON public.tenant_scope_logs TO authenticated;
GRANT ALL ON public.tenant_scope_logs TO service_role;
ALTER TABLE public.tenant_scope_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view all tenant scope logs" ON public.tenant_scope_logs FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));