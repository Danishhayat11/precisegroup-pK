
-- Indexes to speed up AiDiagnosticsPage filters + sorts on ai_tool_call_log.
-- All sorts add `id DESC` as final tiebreaker, so composite indexes end with id DESC.
-- Default sort is created_at DESC; tool_name / success sorts always add created_at DESC after the primary key.

CREATE INDEX IF NOT EXISTS ai_tool_call_log_created_at_id_desc_idx
  ON public.ai_tool_call_log (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS ai_tool_call_log_tool_name_created_at_id_idx
  ON public.ai_tool_call_log (tool_name, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS ai_tool_call_log_success_created_at_id_idx
  ON public.ai_tool_call_log (success, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS ai_tool_call_log_retry_strategy_created_at_id_idx
  ON public.ai_tool_call_log (retry_strategy, created_at DESC, id DESC)
  WHERE retry_strategy IS NOT NULL;

-- Partial index for the "gateway-error" status filter (gateway_status >= 400).
CREATE INDEX IF NOT EXISTS ai_tool_call_log_gateway_error_created_at_idx
  ON public.ai_tool_call_log (gateway_status, created_at DESC, id DESC)
  WHERE gateway_status >= 400;
