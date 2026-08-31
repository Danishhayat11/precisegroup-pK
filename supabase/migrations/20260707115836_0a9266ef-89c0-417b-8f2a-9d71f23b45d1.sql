
-- Enable pg_trgm so ILIKE '%…%' can use a GIN index instead of a seq scan.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- One GIN trigram index per column the AiDiagnosticsPage search fans out
-- across (`tool_name.ilike.%q% OR error_message.ilike.%q% OR
-- retry_strategy.ilike.%q% OR gateway_model.ilike.%q%`). GIN + gin_trgm_ops
-- turns those into index scans at any row count.
CREATE INDEX IF NOT EXISTS ai_tool_call_log_tool_name_trgm_idx
  ON public.ai_tool_call_log USING gin (tool_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ai_tool_call_log_error_message_trgm_idx
  ON public.ai_tool_call_log USING gin (error_message gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ai_tool_call_log_retry_strategy_trgm_idx
  ON public.ai_tool_call_log USING gin (retry_strategy gin_trgm_ops);

CREATE INDEX IF NOT EXISTS ai_tool_call_log_gateway_model_trgm_idx
  ON public.ai_tool_call_log USING gin (gateway_model gin_trgm_ops);
