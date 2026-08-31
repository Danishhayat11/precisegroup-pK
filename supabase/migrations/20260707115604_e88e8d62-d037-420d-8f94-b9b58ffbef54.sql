
-- Admin-only helper: return `EXPLAIN (ANALYZE, BUFFERS)` plan text for the
-- exact query AiDiagnosticsPage runs, so admins can inspect index usage /
-- row estimates directly from the UI. SECURITY DEFINER + inline role check
-- so callers can't bypass the admin gate.
CREATE OR REPLACE FUNCTION public.explain_ai_tool_call_log(
  p_status text        DEFAULT 'all',       -- all | success | failed | gateway-error
  p_retry text         DEFAULT 'all',       -- all | primary | sanitized | safe-default | non-primary
  p_tool_name text     DEFAULT 'all',       -- 'all' or exact tool name
  p_search text        DEFAULT '',          -- ilike term (empty = no search)
  p_sort_key text      DEFAULT 'time',      -- time | status | tool
  p_sort_dir text      DEFAULT 'desc',      -- asc | desc
  p_limit int          DEFAULT 25,
  p_offset int         DEFAULT 0
)
RETURNS SETOF text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sql text;
  v_where text := 'TRUE';
  v_order_col text;
  v_ascending text;
  v_pat text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  -- Guard rails so callers can't paginate off the end into a runaway plan.
  p_limit  := GREATEST(1, LEAST(COALESCE(p_limit, 25), 200));
  p_offset := GREATEST(0, COALESCE(p_offset, 0));

  -- Status filter — mirrors buildFilteredQuery in AiDiagnosticsPage.
  IF p_status = 'success' THEN
    v_where := v_where || ' AND success = TRUE';
  ELSIF p_status = 'failed' THEN
    v_where := v_where || ' AND success = FALSE';
  ELSIF p_status = 'gateway-error' THEN
    v_where := v_where || ' AND gateway_status >= 400';
  END IF;

  -- Retry filter.
  IF p_retry = 'non-primary' THEN
    v_where := v_where || ' AND retry_strategy IS NOT NULL AND retry_strategy <> ''primary''';
  ELSIF p_retry <> 'all' THEN
    v_where := v_where || format(' AND retry_strategy = %L', p_retry);
  END IF;

  -- Tool filter.
  IF p_tool_name <> 'all' THEN
    v_where := v_where || format(' AND tool_name = %L', p_tool_name);
  END IF;

  -- Search: same ilike-across-columns fan-out the UI builds.
  IF length(coalesce(p_search, '')) > 0 THEN
    v_pat := '%' || replace(replace(replace(p_search, ',', ' '), '(', ' '), ')', ' ') || '%';
    v_where := v_where || format(
      ' AND (tool_name ILIKE %L OR error_message ILIKE %L OR retry_strategy ILIKE %L OR gateway_model ILIKE %L)',
      v_pat, v_pat, v_pat, v_pat
    );
  END IF;

  -- Sort column mapping matches AiDiagnosticsPage.
  v_order_col := CASE p_sort_key
    WHEN 'status' THEN 'success'
    WHEN 'tool'   THEN 'tool_name'
    ELSE               'created_at'
  END;
  v_ascending := CASE lower(p_sort_dir) WHEN 'asc' THEN 'ASC' ELSE 'DESC' END;

  v_sql := format(
    'SELECT id, created_at, request_id, round, tool_name, tool_args, tool_result,
            success, error_message, duration_ms, gateway_status, gateway_model, retry_strategy
       FROM public.ai_tool_call_log
       WHERE %s
       ORDER BY %I %s NULLS LAST%s, id DESC
       LIMIT %s OFFSET %s',
    v_where,
    v_order_col, v_ascending,
    CASE WHEN v_order_col = 'created_at' THEN '' ELSE ', created_at DESC' END,
    p_limit, p_offset
  );

  RETURN QUERY EXECUTE 'EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT) ' || v_sql;
END;
$$;

REVOKE ALL ON FUNCTION public.explain_ai_tool_call_log(text, text, text, text, text, text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.explain_ai_tool_call_log(text, text, text, text, text, text, int, int) TO authenticated;
