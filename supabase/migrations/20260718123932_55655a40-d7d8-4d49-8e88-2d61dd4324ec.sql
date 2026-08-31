CREATE TABLE public.rpc_authorization_denied_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID DEFAULT public.current_company_id(),
  rpc_name TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  user_agent TEXT,
  page_path TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rpc_auth_denied_occurred_at
  ON public.rpc_authorization_denied_log (occurred_at DESC);
CREATE INDEX idx_rpc_auth_denied_user
  ON public.rpc_authorization_denied_log (user_id, occurred_at DESC);
CREATE INDEX idx_rpc_auth_denied_rpc
  ON public.rpc_authorization_denied_log (rpc_name, occurred_at DESC);

GRANT SELECT, INSERT ON public.rpc_authorization_denied_log TO authenticated;
GRANT ALL ON public.rpc_authorization_denied_log TO service_role;

ALTER TABLE public.rpc_authorization_denied_log ENABLE ROW LEVEL SECURITY;

-- Signed-in users can insert only rows stamped with their own auth.uid().
CREATE POLICY "Users log their own RPC denials"
  ON public.rpc_authorization_denied_log
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Super admins can read every row for audit review.
CREATE POLICY "Super admins read all RPC denials"
  ON public.rpc_authorization_denied_log
  FOR SELECT
  TO authenticated
  USING (public.is_super_admin(auth.uid()));

-- No UPDATE / DELETE policies for authenticated: rows are append-only for
-- regular users. Super admins retain full control via service_role paths.
