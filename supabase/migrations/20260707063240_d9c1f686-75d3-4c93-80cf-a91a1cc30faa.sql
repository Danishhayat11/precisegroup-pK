CREATE TABLE public.erp_action_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  args JSONB NOT NULL DEFAULT '{}'::jsonb,
  before_state JSONB,
  after_state JSONB,
  executed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  rolled_back_at TIMESTAMP WITH TIME ZONE,
  rollback_reason TEXT,
  rollback_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX erp_action_log_user_recent_idx
  ON public.erp_action_log (user_id, executed_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.erp_action_log TO authenticated;
GRANT ALL ON public.erp_action_log TO service_role;

ALTER TABLE public.erp_action_log ENABLE ROW LEVEL SECURITY;

-- Users see only their own action history.
CREATE POLICY "Users read their own ERP actions"
  ON public.erp_action_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Only the acting user may append their own audit rows.
CREATE POLICY "Users insert their own ERP actions"
  ON public.erp_action_log FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Rollback flip is limited to the original acting user, and only fields
-- related to rollback state may be changed (enforced structurally by
-- the server code — the policy just scopes rows).
CREATE POLICY "Users mark their own ERP actions as rolled back"
  ON public.erp_action_log FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);