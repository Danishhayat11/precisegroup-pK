CREATE TABLE public.ai_tool_call_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  request_id text NOT NULL,
  round integer NOT NULL DEFAULT 0,
  tool_name text,
  tool_args jsonb,
  tool_result jsonb,
  success boolean NOT NULL DEFAULT true,
  error_message text,
  duration_ms integer,
  gateway_status integer,
  gateway_model text,
  retry_strategy text
);

CREATE INDEX ai_tool_call_log_created_at_idx ON public.ai_tool_call_log (created_at DESC);
CREATE INDEX ai_tool_call_log_user_id_idx ON public.ai_tool_call_log (user_id);
CREATE INDEX ai_tool_call_log_request_id_idx ON public.ai_tool_call_log (request_id);

GRANT SELECT, INSERT ON public.ai_tool_call_log TO authenticated;
GRANT ALL ON public.ai_tool_call_log TO service_role;

ALTER TABLE public.ai_tool_call_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read all AI tool call logs"
  ON public.ai_tool_call_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Users insert their own AI tool call logs"
  ON public.ai_tool_call_log
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);